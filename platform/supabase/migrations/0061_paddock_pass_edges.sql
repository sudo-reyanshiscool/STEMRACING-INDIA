-- Paddock Pass: the smaller findings from its review.

-- A time written as text, or null when it is not one. An upload of door checks must not fail on one bad row.
create function pass_time(t text) returns timestamptz language plpgsql immutable set search_path = public, pg_temp as $$
begin
 return t::timestamptz;
exception when others then
 return null;
end $$;

-- Checks made while the scanner had no signal. Anything that is not a check of this event's passes is dropped,
-- and so is a row whose time is not a time: before, one such row failed the whole upload, again on every retry.
create or replace function record_pass_checks(p_event uuid,p_checks jsonb) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer; uuid_re constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
 if not pass_staff(p_event) then raise exception 'door checks are for event organisers' using errcode='42501'; end if;
 if p_checks is null or jsonb_typeof(p_checks)<>'array' or jsonb_array_length(p_checks)>500 then raise exception 'send up to 500 checks at a time' using errcode='22023'; end if;
 insert into pass_checks(id,pass_id,event_id,step,result,presenter,gate,device,scanned_at,scanned_by)
 select (c->>'id')::uuid,p.id,p_event,(c->>'step')::bigint,c->>'result',coalesce(c->>'presenter','')='true',left(btrim(coalesce(c->>'gate','')),40),left(coalesce(c->>'device',''),64),
  least(t.at,clock_timestamp()),auth.uid()
 from jsonb_array_elements(p_checks) c join passes p on p.event_id=p_event and p.id::text=lower(c->>'passId')
  cross join lateral (select case when c->>'scannedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then pass_time(c->>'scannedAt') end at) t
 where jsonb_typeof(c)='object' and c->>'id' ~ uuid_re and c->>'result' in ('genuine','replay') and c->>'step' ~ '^[0-9]{1,12}$' and t.at is not null
 on conflict(id) do nothing;
 get diagnostics n=row_count;
 return n;
end $$;

-- The door. One check of a pass at a time: two scanners reading the same code at the same instant used to both be
-- told it was genuine, because neither had recorded its check when the other looked.
create or replace function check_pass(p_event uuid,p_code text,p_gate text default '',p_check uuid default null,p_device text default '') returns jsonb
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
 perform pg_advisory_xact_lock(hashtext('stem_racing_pass_check:'||p.id::text));
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

-- The small copy of a portrait, with which picture it was made from. The page says which version of the member's
-- portrait it saw when it read the passes; if the member's picture has changed since, the copy stays marked out of
-- date and is made again, where before it was marked current whatever it had been made from.
create function set_pass_portrait(p_pass uuid,p_jpeg text,p_source text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare p passes; b bytea;
begin
 p:=pass_guard(p_pass);
 if p.kind='manager' and p.user_id is distinct from auth.uid() and not pass_staff(p.event_id) then raise exception 'a manager adds their own portrait' using errcode='42501'; end if;
 b:=media_bytes(p_jpeg,65536);
 if octet_length(b)<4 or substring(b from 1 for 3)<>'\xffd8ff'::bytea then raise exception 'the portrait must be a JPEG' using errcode='22023'; end if;
 update passes set portrait=b,portrait_hash=coalesce(left(p_source,64),source_hash) where id=p.id;
end $$;

-- The Paddock Passes page, now saying which version of each member's portrait a pass's small copy should be made from.
create or replace function team_passes(p_event uuid,p_team uuid) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s jsonb;
begin
 perform pass_team_access(p_event,p_team); perform pass_sync(p_event,p_team);
 s:=pass_schedule(p_event,p_team);
 return jsonb_build_object('now',floor(extract(epoch from clock_timestamp())*1000)::bigint,
  'team',(select jsonb_build_object('id',id,'number',number,'name',name,'school',school) from teams where id=p_team),
  'event',(select jsonb_build_object('id',id,'name',name,'startsOn',starts_on,'days',s->'days') from events where id=p_event),
  'stream',s->'stream','activities',s->'activities','timezone',s->>'timezone','pulseKey',encode(pass_pulse(p_event),'hex'),
  'passes',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'kind',p.kind,'memberId',p.member_id,'name',x.h->>'name','role',x.h->>'role',
    'status',case when p.holder_secret is not null then 'claimed' when p.claim_hash is not null then 'sent' else 'new' end,
    'claimedAt',p.claimed_at,'linkSentAt',p.link_sent_at,'portrait',case when p.portrait is null then null else pass_b64(p.portrait) end,
    'portraitStale',p.kind='student' and (p.portrait is null or p.portrait_hash is distinct from p.source_hash),'sourceHash',p.source_hash,
    'mine',p.user_id is not distinct from auth.uid() and p.kind='manager')
    order by p.kind,coalesce(o.n,0),p.created_at,p.id),'[]')
   from passes p cross join lateral (select pass_holder(p) h) x
   left join lateral (select m.ordinality n from team_media_details d, jsonb_array_elements(d.members) with ordinality m where d.event_id=p_event and d.team_id=p_team and m.value->>'id'=p.member_id limit 1) o on true
   where p.event_id=p_event and p.team_id=p_team and x.h is not null));
end $$;

-- A team manager's pass carries the name they type. Until it has one there is nothing to show or send:
-- at the door it would read as a genuine pass belonging to nobody in particular.
create or replace function pass_link(p_pass uuid) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare p passes; token text:=encode(pass_random(),'hex');
begin
 p:=pass_guard(p_pass);
 if p.kind='manager' and p.user_id is distinct from auth.uid() and not pass_staff(p.event_id) then raise exception 'a manager sends their own pass to their own phone' using errcode='42501'; end if;
 if p.kind='manager' and p.holder_name='' then raise exception 'add the manager''s name to the pass first' using errcode='22023'; end if;
 update passes set claim_hash=sha256(convert_to(token,'utf8')),holder_secret=null,claimed_at=null,link_sent_at=clock_timestamp(),
  resets=resets+case when p.holder_secret is null then 0 else 1 end where id=p.id;
 perform audit_write(p.event_id,'pass_link','passes',p.id::text,null);
 return token;
end $$;
create or replace function present_pass(p_pass uuid) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare p passes;
begin
 p:=pass_guard(p_pass);
 if p.kind='manager' and p.holder_name='' then raise exception 'add the manager''s name to the pass first' using errcode='22023'; end if;
 if p.presenter_secret is null then update passes set presenter_secret=pass_random() where id=p.id returning * into p; end if;
 return encode(p.presenter_secret,'hex');
end $$;

revoke execute on function pass_time(text),set_pass_portrait(uuid,text,text) from public,anon,authenticated;
grant execute on function set_pass_portrait(uuid,text,text) to authenticated;
