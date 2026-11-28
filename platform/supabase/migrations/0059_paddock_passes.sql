-- Paddock Pass: digital ID cards for students and team managers, in place of printed ones.
-- A pass is shown on a phone. Its QR is a short message signed with a secret that only that phone and this database
-- hold, and with the current 30-second window, so a screenshot stops working within a minute and a half.
-- Students have no accounts: the team manager sends each one a single-use link, and the first phone to open it
-- receives the secret. Nothing here is readable through the tables; every read and write goes through the functions.

-- HMAC-SHA256 (RFC 2104) on the server's own sha256, so the live database and the test database agree without an extension.
create function hmac_sha256(p_key bytea,p_msg bytea) returns bytea language plpgsql immutable set search_path = public, pg_temp as $$
declare k bytea:=p_key; ipad bytea:=decode(repeat('36',64),'hex'); opad bytea:=decode(repeat('5c',64),'hex'); i integer;
begin
 if length(k)>64 then k:=sha256(k); end if;
 k:=k||decode(repeat('00',64-length(k)),'hex');
 for i in 0..63 loop
  ipad:=set_byte(ipad,i,get_byte(k,i) # 54);
  opad:=set_byte(opad,i,get_byte(k,i) # 92);
 end loop;
 return sha256(opad||sha256(ipad||p_msg));
end $$;
-- 32 bytes from two random UUIDs: 244 random bits.
create function pass_random() returns bytea language sql volatile set search_path = public, pg_temp as $$
 select decode(replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),'hex')
$$;
create function pass_b64(b bytea) returns text language sql immutable set search_path = public, pg_temp as $$ select translate(encode(b,'base64'),E'\n','') $$;
-- Two spellings of one name compare equal: case and spacing are ignored.
create function pass_name_key(n text) returns text language sql immutable set search_path = public, pg_temp as $$
 select lower(regexp_replace(btrim(coalesce(n,'')),'\s+',' ','g'))
$$;

create table event_pass_keys (
 event_id uuid primary key references events(id) on delete cascade,
 pulse_key bytea not null default pass_random()
);
create table passes (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references events(id) on delete cascade,
 team_id uuid not null,
 kind text not null check(kind in ('student','manager')),
 -- A student pass points at a member of the team's media submission; a manager pass at the manager's account.
 member_id text,
 user_id uuid references auth.users(id) on delete cascade,
 holder_name text not null default '' check(char_length(holder_name)<=100 and holder_name=btrim(holder_name)),
 -- What the member looked like when last seen, so a member who is removed and re-added to fix a typo keeps the pass.
 name_key text not null default '',
 source_hash text,
 portrait bytea check(portrait is null or octet_length(portrait) between 4 and 65536),
 portrait_hash text,
 claim_hash bytea,
 holder_secret bytea,
 presenter_secret bytea,
 link_sent_at timestamptz,
 claimed_at timestamptz,
 resets integer not null default 0,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(team_id,event_id) references teams(id,event_id) on delete cascade,
 check((kind='student')=(member_id is not null)),
 check((kind='manager')=(user_id is not null))
);
create unique index passes_student on passes(event_id,team_id,member_id) where kind='student';
create unique index passes_manager on passes(event_id,team_id,user_id) where kind='manager';
create table pass_checks (
 -- Made on the scanning phone, so a check uploaded twice is stored once.
 id uuid primary key,
 pass_id uuid not null references passes(id) on delete cascade,
 event_id uuid not null references events(id) on delete cascade,
 step bigint not null,
 result text not null check(result in ('genuine','replay')),
 presenter boolean not null default false,
 gate text not null default '' check(char_length(gate)<=40),
 device text not null default '' check(char_length(device)<=64),
 scanned_at timestamptz not null,
 -- Kept for audit. No function returns it.
 scanned_by uuid,
 recorded_at timestamptz not null default clock_timestamp()
);
create index pass_checks_pass on pass_checks(pass_id,step);
create index pass_checks_event on pass_checks(event_id,scanned_at);
alter table event_pass_keys enable row level security;
alter table passes enable row level security;
alter table pass_checks enable row level security;
revoke all on event_pass_keys,passes,pass_checks from public,anon,authenticated;

-- Organisers and the Chair. Platform spectators look but never issue or scan.
create function pass_staff(p_event uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
 select auth.uid() is not null and event_active(p_event) and is_chair_or_organiser(p_event) and not platform_spectator()
$$;
create function pass_team_access(p_event uuid,p_team uuid) returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
 if auth.uid() is null or not event_active(p_event) or not exists(select 1 from teams where id=p_team and event_id=p_event)
  or not (pass_staff(p_event) or (manages_team(p_event,p_team) and not platform_spectator())) then
  raise exception 'passes are for the team and event organisers' using errcode='42501';
 end if;
end $$;
-- The pass, for someone allowed to manage it. An unknown id reads the same as a forbidden one.
create function pass_guard(p_pass uuid) returns passes language plpgsql security definer set search_path = public, pg_temp as $$
declare p passes;
begin
 select * into p from passes where id=p_pass for update;
 if p.id is null then raise exception 'passes are for the team and event organisers' using errcode='42501'; end if;
 perform pass_team_access(p.event_id,p.team_id);
 return p;
end $$;
create function pass_pulse(p_event uuid) returns bytea language plpgsql security definer set search_path = public, pg_temp as $$
declare k bytea;
begin
 insert into event_pass_keys(event_id) values(p_event) on conflict(event_id) do nothing;
 select pulse_key into k from event_pass_keys where event_id=p_event;
 return k;
end $$;
-- Name and role, read live. Null when a student's member is no longer in the submission.
create function pass_holder(p passes) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
 select case when p.kind='manager' then jsonb_build_object('name',p.holder_name,'role','Team Manager')
 else (select jsonb_build_object('name',btrim(regexp_replace(coalesce(m->>'name',''),'\s+',' ','g')),'role',btrim(coalesce(m->>'role','')))
  from team_media_details d, jsonb_array_elements(d.members) m where d.event_id=p.event_id and d.team_id=p.team_id and m->>'id'=p.member_id limit 1) end
$$;
create function pass_stream(d jsonb,p_team uuid) returns jsonb language sql immutable set search_path = public, pg_temp as $$
 select jsonb_build_object('name',s.value->>'name','index',s.ordinality-1)
 from jsonb_array_elements(coalesce(d->'streams','[]')) with ordinality s join jsonb_array_elements(coalesce(d->'allocations','[]')) x on s.value->>'id'=x->>'streamId'
 where x->>'teamId'=p_team::text limit 1
$$;
-- The team's stream and its own activities from the published schedule, as My Schedule reads them.
create function pass_schedule(p_event uuid,p_team uuid) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare d jsonb;
begin
 select published into d from event_schedules where event_id=p_event;
 if d is null then return jsonb_build_object('stream',null,'activities','[]'::jsonb,'timezone','Asia/Kolkata','days','[]'::jsonb); end if;
 return jsonb_build_object('stream',pass_stream(d,p_team),'timezone',coalesce(d->>'timezone','Asia/Kolkata'),
  'days',(select coalesce(jsonb_agg(x->>'date' order by x->>'date'),'[]') from jsonb_array_elements(coalesce(d->'days','[]')) x),
  'activities',(select coalesce(jsonb_agg(jsonb_build_object('title',a->>'title','kind',a->>'kind','start',a->>'start','end',a->>'end','location',coalesce(a->>'location','')) order by (a->>'start')::timestamptz,a->>'id'),'[]')
   from jsonb_array_elements(coalesce(d->'activities','[]')) a
   where p_team=any(schedule_activity_teams(p_event,d,a)) and not (a->>'kind'='judging' and schedule_team_exempt(d,p_team,a->>'panel'))));
end $$;
-- Everything a phone needs to draw the card and keep it right without signal.
create function pass_card_data(p passes) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare h jsonb:=pass_holder(p); s jsonb:=pass_schedule(p.event_id,p.team_id);
begin
 return jsonb_build_object('passId',p.id,'kind',p.kind,'name',h->>'name','role',h->>'role',
  'team',(select jsonb_build_object('number',number,'name',name,'school',school) from teams where id=p.team_id),
  'event',(select jsonb_build_object('id',id,'name',name,'startsOn',starts_on,'days',s->'days') from events where id=p.event_id),
  'stream',s->'stream','activities',s->'activities','timezone',s->>'timezone',
  'portrait',case when p.portrait is null then null else pass_b64(p.portrait) end,
  'pulseKey',encode(pass_pulse(p.event_id),'hex'),'now',floor(extract(epoch from clock_timestamp())*1000)::bigint);
end $$;

-- Brings the team's passes in line with its members and managers.
create function pass_sync(p_event uuid,p_team uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare m jsonb; live text[]; hit uuid; h text; nk text;
begin
 perform 1 from teams where id=p_team and event_id=p_event for update;
 select coalesce(array_agg(x->>'id'),'{}') into live from team_media_details d, jsonb_array_elements(d.members) x where d.event_id=p_event and d.team_id=p_team;
 for m in select x from team_media_details d, jsonb_array_elements(d.members) x where d.event_id=p_event and d.team_id=p_team loop
  h:=md5(coalesce(m->>'photoBase64','')); nk:=pass_name_key(m->>'name');
  if exists(select 1 from passes where event_id=p_event and team_id=p_team and kind='student' and member_id=m->>'id') then
   update passes set name_key=nk,source_hash=h where event_id=p_event and team_id=p_team and kind='student' and member_id=m->>'id' and (name_key<>nk or source_hash is distinct from h);
  else
   -- Correcting a member removes and re-adds them under a new id. The same portrait or the same name is the same person.
   select id into hit from passes where event_id=p_event and team_id=p_team and kind='student' and not (member_id=any(live))
    and ((source_hash=h and coalesce(m->>'photoBase64','')<>'') or (name_key=nk and nk<>'')) order by (source_hash=h) desc,created_at limit 1;
   if hit is not null then update passes set member_id=m->>'id',name_key=nk,source_hash=h where id=hit;
   else insert into passes(event_id,team_id,kind,member_id,name_key,source_hash) values(p_event,p_team,'student',m->>'id',nk,h); end if;
  end if;
 end loop;
 delete from passes where event_id=p_event and team_id=p_team and kind='student' and not (member_id=any(live));
 insert into passes(event_id,team_id,kind,user_id) select distinct p_event,p_team,'manager',r.user_id from event_roles r
  where r.event_id=p_event and r.team_id=p_team and r.role='team_manager' on conflict(event_id,team_id,user_id) where kind='manager' do nothing;
 delete from passes where event_id=p_event and team_id=p_team and kind='manager'
  and user_id not in (select r.user_id from event_roles r where r.event_id=p_event and r.team_id=p_team and r.role='team_manager');
end $$;

-- The Paddock Passes page: the team's passes, with what the cards show.
create function team_passes(p_event uuid,p_team uuid) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s jsonb;
begin
 perform pass_team_access(p_event,p_team); perform pass_sync(p_event,p_team);
 s:=pass_schedule(p_event,p_team);
 return jsonb_build_object('now',floor(extract(epoch from clock_timestamp())*1000)::bigint,
  'team',(select jsonb_build_object('id',id,'number',number,'name',name,'school',school) from teams where id=p_team),
  'event',(select jsonb_build_object('id',id,'name',name,'startsOn',starts_on,'days',s->'days') from events where id=p_event),
  'stream',s->'stream','activities',s->'activities','timezone',s->>'timezone','pulseKey',encode(pass_pulse(p_event),'hex'),
  'passes',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'kind',p.kind,'memberId',p.member_id,'name',x.h->>'name','role',x.h->>'role',
    'status',case when p.kind='manager' then case when p.presenter_secret is not null then 'claimed' else 'new' end
     when p.holder_secret is not null then 'claimed' when p.claim_hash is not null then 'sent' else 'new' end,
    'claimedAt',p.claimed_at,'linkSentAt',p.link_sent_at,'portrait',case when p.portrait is null then null else pass_b64(p.portrait) end,
    'portraitStale',p.kind='student' and (p.portrait is null or p.portrait_hash is distinct from p.source_hash),'mine',p.user_id is not distinct from auth.uid() and p.kind='manager')
    order by p.kind,coalesce(o.n,0),p.created_at,p.id),'[]')
   from passes p cross join lateral (select pass_holder(p) h) x
   left join lateral (select m.ordinality n from team_media_details d, jsonb_array_elements(d.members) with ordinality m where d.event_id=p_event and d.team_id=p_team and m.value->>'id'=p.member_id limit 1) o on true
   where p.event_id=p_event and p.team_id=p_team and x.h is not null));
end $$;

-- The small copy of the portrait that cards and the door list carry. JPEG only, made on the manager's device.
create function set_pass_portrait(p_pass uuid,p_jpeg text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare p passes; b bytea;
begin
 p:=pass_guard(p_pass);
 if p.kind='manager' and p.user_id is distinct from auth.uid() and not pass_staff(p.event_id) then raise exception 'a manager adds their own portrait' using errcode='42501'; end if;
 b:=media_bytes(p_jpeg,65536);
 if octet_length(b)<4 or substring(b from 1 for 3)<>'\xffd8ff'::bytea then raise exception 'the portrait must be a JPEG' using errcode='22023'; end if;
 update passes set portrait=b,portrait_hash=source_hash where id=p.id;
end $$;
create function set_manager_pass_name(p_pass uuid,p_name text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare p passes; n text:=btrim(regexp_replace(coalesce(p_name,''),'\s+',' ','g'));
begin
 p:=pass_guard(p_pass);
 if p.kind<>'manager' or char_length(n) not between 1 and 100 then raise exception 'enter the manager''s name, up to 100 characters' using errcode='22023'; end if;
 if p.user_id is distinct from auth.uid() and not pass_staff(p.event_id) then raise exception 'a manager names their own pass' using errcode='42501'; end if;
 update passes set holder_name=n where id=p.id;
end $$;

-- A fresh single-use link for a student. Any earlier link stops working, and so does the phone that held the pass.
create function pass_link(p_pass uuid) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare p passes; token text:=encode(pass_random(),'hex');
begin
 p:=pass_guard(p_pass);
 if p.kind<>'student' then raise exception 'a manager''s pass opens when the manager signs in' using errcode='22023'; end if;
 update passes set claim_hash=sha256(convert_to(token,'utf8')),holder_secret=null,claimed_at=null,link_sent_at=clock_timestamp(),
  resets=resets+case when p.holder_secret is null then 0 else 1 end where id=p.id;
 perform audit_write(p.event_id,'pass_link','passes',p.id::text,null);
 return token;
end $$;
create function reset_pass(p_pass uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare p passes;
begin
 p:=pass_guard(p_pass);
 update passes set claim_hash=null,holder_secret=null,presenter_secret=null,claimed_at=null,link_sent_at=null,resets=resets+1 where id=p.id;
 perform audit_write(p.event_id,'pass_reset','passes',p.id::text,null);
end $$;
-- Lets the signed-in phone show this pass: the manager's own, or a student's who has no phone. The student's own phone keeps working.
create function present_pass(p_pass uuid) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare p passes; k bytea:=pass_random();
begin
 p:=pass_guard(p_pass);
 update passes set presenter_secret=k where id=p.id;
 return encode(k,'hex');
end $$;

-- Opened from the link, with no account. The token works once; the secret is returned once.
create function claim_pass(p_pass uuid,p_token text) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p passes;
begin
 select * into p from passes where id=p_pass and claim_hash is not null and claim_hash=sha256(convert_to(coalesce(p_token,''),'utf8')) for update;
 if p.id is null or not event_active(p.event_id) or pass_holder(p) is null then raise exception 'pass link not valid' using errcode='42501'; end if;
 update passes set holder_secret=pass_random(),claim_hash=null,claimed_at=clock_timestamp() where id=p.id returning * into p;
 return jsonb_build_object('secret',encode(p.holder_secret,'hex'),'card',pass_card_data(p));
end $$;

create function pass_mac(p_secret bytea,p_pass uuid,p_step bigint) returns text language sql immutable set search_path = public, pg_temp as $$
 select upper(encode(substring(hmac_sha256(p_secret,convert_to('SRI1|'||p_pass::text||'|'||p_step::text,'utf8')) from 1 for 8),'hex'))
$$;
-- Which of the pass's two secrets made this code, if either.
create function pass_signer(p passes,p_step bigint,p_mac text) returns text language sql immutable set search_path = public, pg_temp as $$
 select case when p.holder_secret is not null and pass_mac(p.holder_secret,p.id,p_step)=upper(coalesce(p_mac,'')) then 'holder'
 when p.presenter_secret is not null and pass_mac(p.presenter_secret,p.id,p_step)=upper(coalesce(p_mac,'')) then 'presenter' end
$$;
create function pass_step() returns bigint language sql stable set search_path = public, pg_temp as $$ select floor(extract(epoch from clock_timestamp())/30)::bigint $$;

-- A phone that holds the pass asks for fresh details by proving it holds the secret.
create function pass_card(p_pass uuid,p_step bigint,p_mac text) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p passes;
begin
 select * into p from passes where id=p_pass;
 if p.id is null or p_step is null or abs(p_step-pass_step())>1 or pass_signer(p,p_step,p_mac) is null or not event_active(p.event_id) or pass_holder(p) is null then
  raise exception 'pass not valid' using errcode='42501';
 end if;
 return pass_card_data(p);
end $$;

-- The door. Checks one scanned code and records it.
create function check_pass(p_event uuid,p_code text,p_gate text default '',p_check uuid default null,p_device text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c text:=upper(btrim(coalesce(p_code,''))); parts text[]; p passes; st bigint; signer text; prior pass_checks; h jsonb; outcome text; first_seen timestamptz; tz text;
 device_id text:=left(coalesce(p_device,''),64);
begin
 if not pass_staff(p_event) then raise exception 'door checks are for event organisers' using errcode='42501'; end if;
 if c !~ '^SRI1\.[0-9A-F]{32}\.[0-9]{1,12}\.[0-9A-F]{16}$' then return jsonb_build_object('result','unknown'); end if;
 parts:=string_to_array(c,'.'); st:=parts[3]::bigint;
 select * into p from passes where id=parts[2]::uuid;
 if p.id is null then return jsonb_build_object('result','unknown'); end if;
 if p.event_id<>p_event then return jsonb_build_object('result','wrong_event'); end if;
 h:=pass_holder(p); signer:=pass_signer(p,st,parts[4]);
 if h is null or signer is null then return jsonb_build_object('result','invalid'); end if;
 if abs(st-pass_step())>1 then return jsonb_build_object('result','expired'); end if;
 select coalesce(published->>'timezone','Asia/Kolkata') into tz from event_schedules where event_id=p_event; tz:=coalesce(tz,'Asia/Kolkata');
 -- The holder's phone and the manager's make different codes in the same window, so a repeat is judged per signer.
 select * into prior from pass_checks where pass_id=p.id and step=st and presenter=(signer='presenter' and p.kind='student') order by scanned_at limit 1;
 select min(scanned_at) into first_seen from pass_checks where pass_id=p.id and result='genuine' and id is distinct from prior.id
  and (scanned_at at time zone tz)::date=(clock_timestamp() at time zone tz)::date;
 -- The very same code again is how a passed-back screenshot looks, unless it is this scanner reading it twice.
 outcome:=case when prior.id is null then 'genuine' when prior.result='genuine' and prior.device=device_id and prior.scanned_at>clock_timestamp()-interval '5 seconds' then 'same' else 'replay' end;
 if outcome<>'same' then
  insert into pass_checks(id,pass_id,event_id,step,result,presenter,gate,device,scanned_at,scanned_by)
  values(coalesce(p_check,gen_random_uuid()),p.id,p_event,st,outcome,signer='presenter' and p.kind='student',left(btrim(coalesce(p_gate,'')),40),device_id,clock_timestamp(),auth.uid())
  on conflict(id) do nothing;
 end if;
 return jsonb_build_object('result',case when outcome='same' then 'genuine' else outcome end,'presenter',signer='presenter' and p.kind='student','firstSeenToday',first_seen,
  'holder',h||jsonb_build_object('kind',p.kind,'team',(select jsonb_build_object('number',number,'name',name) from teams where id=p.team_id),
   'stream',(select pass_stream(published,p.team_id) from event_schedules where event_id=p_event),
   'portrait',case when p.portrait is null then null else pass_b64(p.portrait) end));
end $$;

-- Everything a scanner needs to check passes with no signal. Portraits come separately, a page at a time.
create function door_list(p_event uuid) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare d jsonb;
begin
 if not pass_staff(p_event) then raise exception 'door checks are for event organisers' using errcode='42501'; end if;
 select published into d from event_schedules where event_id=p_event;
 return jsonb_build_object('now',floor(extract(epoch from clock_timestamp())*1000)::bigint,'timezone',coalesce(d->>'timezone','Asia/Kolkata'),'pulseKey',encode(pass_pulse(p_event),'hex'),
  'passes',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'kind',p.kind,'name',x.h->>'name','role',x.h->>'role','team',jsonb_build_object('number',t.number,'name',t.name),
    'stream',pass_stream(d,p.team_id),'holder',encode(p.holder_secret,'hex'),'presenter',encode(p.presenter_secret,'hex'),'hasPortrait',p.portrait is not null) order by t.number,p.kind,p.created_at,p.id),'[]')
   from passes p join teams t on t.id=p.team_id cross join lateral (select pass_holder(p) h) x where p.event_id=p_event and x.h is not null));
end $$;
create function door_portraits(p_event uuid,p_after uuid default null,p_limit integer default 40) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
 if not pass_staff(p_event) then raise exception 'door checks are for event organisers' using errcode='42501'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'portrait',pass_b64(q.portrait)) order by q.id),'[]') from
  (select id,portrait from passes where event_id=p_event and portrait is not null and (p_after is null or id>p_after) order by id limit least(greatest(coalesce(p_limit,40),1),100)) q);
end $$;
-- Checks made while the scanner had no signal. Anything that is not a check of this event's passes is dropped.
create function record_pass_checks(p_event uuid,p_checks jsonb) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer; uuid_re constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
 if not pass_staff(p_event) then raise exception 'door checks are for event organisers' using errcode='42501'; end if;
 if p_checks is null or jsonb_typeof(p_checks)<>'array' or jsonb_array_length(p_checks)>500 then raise exception 'send up to 500 checks at a time' using errcode='22023'; end if;
 insert into pass_checks(id,pass_id,event_id,step,result,presenter,gate,device,scanned_at,scanned_by)
 select (c->>'id')::uuid,p.id,p_event,(c->>'step')::bigint,c->>'result',coalesce((c->>'presenter')::boolean,false),left(btrim(coalesce(c->>'gate','')),40),left(coalesce(c->>'device',''),64),
  least((c->>'scannedAt')::timestamptz,clock_timestamp()),auth.uid()
 from jsonb_array_elements(p_checks) c join passes p on p.event_id=p_event and p.id::text=lower(c->>'passId')
 where c->>'id' ~ uuid_re and c->>'result' in ('genuine','replay') and c->>'step' ~ '^[0-9]{1,12}$' and c->>'scannedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
 on conflict(id) do nothing;
 get diagnostics n=row_count;
 return n;
end $$;
-- Who has arrived today, in the event's timezone.
create function pass_arrivals(p_event uuid) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare tz text; today date;
begin
 if not pass_staff(p_event) then raise exception 'door checks are for event organisers' using errcode='42501'; end if;
 select coalesce(published->>'timezone','Asia/Kolkata') into tz from event_schedules where event_id=p_event; tz:=coalesce(tz,'Asia/Kolkata');
 today:=(clock_timestamp() at time zone tz)::date;
 return jsonb_build_object('day',today,
  'total',(select count(*) from passes p where p.event_id=p_event and pass_holder(p) is not null),
  'arrived',(select coalesce(jsonb_agg(jsonb_build_object('passId',p.id,'name',x.h->>'name','kind',p.kind,'teamNumber',t.number,'teamName',t.name,'firstSeen',f.scanned_at,'gate',f.gate) order by f.scanned_at desc,p.id),'[]')
   from passes p join teams t on t.id=p.team_id cross join lateral (select pass_holder(p) h) x
   join lateral (select c.scanned_at,c.gate from pass_checks c where c.pass_id=p.id and c.result='genuine' and (c.scanned_at at time zone tz)::date=today order by c.scanned_at limit 1) f on true
   where p.event_id=p_event and x.h is not null));
end $$;
-- The key behind the sync pulse, for everyone with a staff role at the event, so they can see the reference.
create function pass_pulse_key(p_event uuid) returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if auth.uid() is null or platform_spectator() or not is_member(p_event) or not sees_all_teams(p_event) then raise exception 'the pass reference is for event staff' using errcode='42501'; end if;
 return encode(pass_pulse(p_event),'hex');
end $$;

revoke execute on function hmac_sha256(bytea,bytea),pass_random(),pass_b64(bytea),pass_name_key(text),pass_staff(uuid),pass_team_access(uuid,uuid),pass_guard(uuid),pass_pulse(uuid),
 pass_holder(passes),pass_stream(jsonb,uuid),pass_schedule(uuid,uuid),pass_card_data(passes),pass_sync(uuid,uuid),pass_mac(bytea,uuid,bigint),pass_signer(passes,bigint,text),pass_step(),
 team_passes(uuid,uuid),set_pass_portrait(uuid,text),set_manager_pass_name(uuid,text),pass_link(uuid),reset_pass(uuid),present_pass(uuid),claim_pass(uuid,text),pass_card(uuid,bigint,text),
 check_pass(uuid,text,text,uuid,text),door_list(uuid),door_portraits(uuid,uuid,integer),record_pass_checks(uuid,jsonb),pass_arrivals(uuid),pass_pulse_key(uuid) from public,anon,authenticated;
grant execute on function team_passes(uuid,uuid),set_pass_portrait(uuid,text),set_manager_pass_name(uuid,text),pass_link(uuid),reset_pass(uuid),present_pass(uuid),
 check_pass(uuid,text,text,uuid,text),door_list(uuid),door_portraits(uuid,uuid,integer),record_pass_checks(uuid,jsonb),pass_arrivals(uuid),pass_pulse_key(uuid) to authenticated;
-- The student's phone has no account.
grant execute on function claim_pass(uuid,text),pass_card(uuid,bigint,text) to anon,authenticated;
