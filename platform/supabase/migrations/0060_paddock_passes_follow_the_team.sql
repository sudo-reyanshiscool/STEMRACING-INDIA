-- Paddock Passes follow the team as it changes, without anyone having to open the Paddock Passes page first.
-- Until now a pass was only re-linked or removed when that page was opened, so a member corrected on the submission
-- page (removed, then added again under a new id) was refused at the door, and a removed team manager was not.

-- When a student pass was first found without its member. Kept for a week in case the member is being corrected.
alter table passes add column orphaned_at timestamptz;

-- A manager's pass is good only while they still manage the team.
create or replace function pass_holder(p passes) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
 select case when p.kind='manager' then (select jsonb_build_object('name',p.holder_name,'role','Team Manager')
  where exists(select 1 from event_roles r where r.event_id=p.event_id and r.team_id=p.team_id and r.user_id=p.user_id and r.role='team_manager'))
 else (select jsonb_build_object('name',btrim(regexp_replace(coalesce(m->>'name',''),'\s+',' ','g')),'role',btrim(coalesce(m->>'role','')))
  from team_media_details d, jsonb_array_elements(d.members) m where d.event_id=p.event_id and d.team_id=p.team_id and m->>'id'=p.member_id limit 1) end
$$;
-- The same answer for every pass at an event, reading each team's members once. A team's members carry their full
-- portraits, so asking pass by pass read megabytes again for every pass on the door list.
create function pass_holders(p_event uuid) returns table(pass_id uuid,name text,role text) language sql stable security definer set search_path = public, pg_temp as $$
 with mem as materialized (select distinct on (d.team_id,m->>'id') d.team_id,m->>'id' id,btrim(regexp_replace(coalesce(m->>'name',''),'\s+',' ','g')) name,btrim(coalesce(m->>'role','')) role
  from team_media_details d cross join lateral jsonb_array_elements(d.members) m where d.event_id=p_event order by d.team_id,m->>'id')
 select p.id,mem.name,mem.role from passes p join mem on mem.team_id=p.team_id and mem.id=p.member_id where p.event_id=p_event and p.kind='student'
 union all
 select p.id,p.holder_name,'Team Manager' from passes p where p.event_id=p_event and p.kind='manager'
  and exists(select 1 from event_roles r where r.event_id=p.event_id and r.team_id=p.team_id and r.user_id=p.user_id and r.role='team_manager')
$$;

-- Brings the team's passes in line with its members and managers.
create or replace function pass_sync(p_event uuid,p_team uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare m jsonb; live text[]; hit uuid; h text; nk text;
begin
 -- The event first, as saving a team's details does, so the two can never wait on each other. Then one sync per team at a time.
 perform 1 from events where id=p_event for key share;
 perform pg_advisory_xact_lock(hashtext('stem_racing_pass_sync:'||p_team::text));
 select coalesce(array_agg(x->>'id'),'{}') into live from team_media_details d, jsonb_array_elements(d.members) x where d.event_id=p_event and d.team_id=p_team;
 for m in select x from team_media_details d, jsonb_array_elements(d.members) x where d.event_id=p_event and d.team_id=p_team loop
  h:=md5(coalesce(m->>'photoBase64','')); nk:=pass_name_key(m->>'name');
  if exists(select 1 from passes where event_id=p_event and team_id=p_team and kind='student' and member_id=m->>'id') then
   update passes set name_key=nk,source_hash=h,orphaned_at=null where event_id=p_event and team_id=p_team and kind='student' and member_id=m->>'id'
    and (name_key<>nk or source_hash is distinct from h or orphaned_at is not null);
  else
   -- Correcting a member removes and re-adds them under a new id. The same portrait or the same name is the same person.
   select id into hit from passes where event_id=p_event and team_id=p_team and kind='student' and not (member_id=any(live))
    and ((source_hash=h and coalesce(m->>'photoBase64','')<>'') or (name_key=nk and nk<>'')) order by (source_hash=h) desc,created_at limit 1;
   if hit is not null then update passes set member_id=m->>'id',name_key=nk,source_hash=h,orphaned_at=null where id=hit;
   else insert into passes(event_id,team_id,kind,member_id,name_key,source_hash) values(p_event,p_team,'student',m->>'id',nk,h); end if;
  end if;
 end loop;
 -- A pass whose member has gone is refused everywhere from this moment. One that reached a phone, or has a link out,
 -- is kept for a week: the member may be part-way through being corrected, and comes back under a new id.
 update passes set orphaned_at=clock_timestamp() where event_id=p_event and team_id=p_team and kind='student' and not (member_id=any(live)) and orphaned_at is null;
 delete from passes where event_id=p_event and team_id=p_team and kind='student' and not (member_id=any(live))
  and ((holder_secret is null and claim_hash is null) or orphaned_at<clock_timestamp()-interval '7 days');
 insert into passes(event_id,team_id,kind,user_id) select distinct p_event,p_team,'manager',r.user_id from event_roles r
  where r.event_id=p_event and r.team_id=p_team and r.role='team_manager' on conflict(event_id,team_id,user_id) where kind='manager' do nothing;
 delete from passes where event_id=p_event and team_id=p_team and kind='manager'
  and user_id not in (select r.user_id from event_roles r where r.event_id=p_event and r.team_id=p_team and r.role='team_manager');
end $$;

-- Saving a team's members brings its passes in line there and then.
create function pass_follow_members() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if tg_op='UPDATE' and new.members is not distinct from old.members then return null; end if;
 begin
  perform pass_sync(new.event_id,new.team_id);
 exception when others then
  -- A team's submission must never fail because of its passes. They are brought in line when the Paddock Passes page is next opened.
  raise warning 'passes not brought in line for team %: %',new.team_id,sqlerrm;
 end;
 return null;
end $$;
create trigger team_media_details_passes after insert or update of members on team_media_details for each row execute function pass_follow_members();

-- A team manager who is removed loses their pass, and whatever they were showing on the team's behalf stops with them.
create function pass_follow_roles() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if old.role='team_manager' and old.team_id is not null
  and not exists(select 1 from event_roles r where r.event_id=old.event_id and r.team_id=old.team_id and r.user_id=old.user_id and r.role='team_manager') then
  update passes set claim_hash=null,holder_secret=null,presenter_secret=null,claimed_at=null,link_sent_at=null
   where event_id=old.event_id and team_id=old.team_id and kind='manager' and user_id=old.user_id;
  update passes set presenter_secret=null where event_id=old.event_id and team_id=old.team_id and kind='student' and presenter_secret is not null;
 end if;
 return null;
end $$;
create trigger roles_passes after delete or update on event_roles for each row execute function pass_follow_roles();

-- The Paddock Passes page: the team's passes, with what the cards show. A manager's pass can now sit on a phone like a student's.
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
    'portraitStale',p.kind='student' and (p.portrait is null or p.portrait_hash is distinct from p.source_hash),'mine',p.user_id is not distinct from auth.uid() and p.kind='manager')
    order by p.kind,coalesce(o.n,0),p.created_at,p.id),'[]')
   from passes p cross join lateral (select pass_holder(p) h) x
   left join lateral (select m.ordinality n from team_media_details d, jsonb_array_elements(d.members) with ordinality m where d.event_id=p_event and d.team_id=p_team and m.value->>'id'=p.member_id limit 1) o on true
   where p.event_id=p_event and p.team_id=p_team and x.h is not null));
end $$;

-- A fresh single-use link. Any earlier link stops working, and so does the phone that held the pass.
-- A manager's own pass can be sent to their phone too, by them or by an organiser, so it works at the door without signal.
create or replace function pass_link(p_pass uuid) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare p passes; token text:=encode(pass_random(),'hex');
begin
 p:=pass_guard(p_pass);
 if p.kind='manager' and p.user_id is distinct from auth.uid() and not pass_staff(p.event_id) then raise exception 'a manager sends their own pass to their own phone' using errcode='42501'; end if;
 update passes set claim_hash=sha256(convert_to(token,'utf8')),holder_secret=null,claimed_at=null,link_sent_at=clock_timestamp(),
  resets=resets+case when p.holder_secret is null then 0 else 1 end where id=p.id;
 perform audit_write(p.event_id,'pass_link','passes',p.id::text,null);
 return token;
end $$;

-- Lets a signed-in phone show this pass. Everyone allowed to show it shares one secret, so a second person showing it,
-- or the same person reloading the page, does not stop the first. Resetting the pass replaces it.
create or replace function present_pass(p_pass uuid) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare p passes;
begin
 p:=pass_guard(p_pass);
 if p.presenter_secret is null then update passes set presenter_secret=pass_random() where id=p.id returning * into p; end if;
 return encode(p.presenter_secret,'hex');
end $$;

create or replace function door_list(p_event uuid) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare d jsonb;
begin
 if not pass_staff(p_event) then raise exception 'door checks are for event organisers' using errcode='42501'; end if;
 select published into d from event_schedules where event_id=p_event;
 return jsonb_build_object('now',floor(extract(epoch from clock_timestamp())*1000)::bigint,'timezone',coalesce(d->>'timezone','Asia/Kolkata'),'pulseKey',encode(pass_pulse(p_event),'hex'),
  'passes',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'kind',p.kind,'name',x.name,'role',x.role,'team',jsonb_build_object('number',t.number,'name',t.name),
    'stream',pass_stream(d,p.team_id),'holder',encode(p.holder_secret,'hex'),'presenter',encode(p.presenter_secret,'hex'),'hasPortrait',p.portrait is not null) order by t.number,p.kind,p.created_at,p.id),'[]')
   from pass_holders(p_event) x join passes p on p.id=x.pass_id join teams t on t.id=p.team_id));
end $$;
create or replace function pass_arrivals(p_event uuid) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare tz text; today date; who jsonb;
begin
 if not pass_staff(p_event) then raise exception 'door checks are for event organisers' using errcode='42501'; end if;
 select coalesce(published->>'timezone','Asia/Kolkata') into tz from event_schedules where event_id=p_event; tz:=coalesce(tz,'Asia/Kolkata');
 today:=(clock_timestamp() at time zone tz)::date;
 select coalesce(jsonb_object_agg(x.pass_id::text,x.name),'{}') into who from pass_holders(p_event) x;
 return jsonb_build_object('day',today,
  'total',(select count(*) from jsonb_object_keys(who)),
  'arrived',(select coalesce(jsonb_agg(jsonb_build_object('passId',p.id,'name',who->>p.id::text,'kind',p.kind,'teamNumber',t.number,'teamName',t.name,'firstSeen',f.scanned_at,'gate',f.gate) order by f.scanned_at desc,p.id),'[]')
   from passes p join teams t on t.id=p.team_id
   join lateral (select c.scanned_at,c.gate from pass_checks c where c.pass_id=p.id and c.result='genuine' and (c.scanned_at at time zone tz)::date=today order by c.scanned_at limit 1) f on true
   where p.event_id=p_event and who ? p.id::text));
end $$;

revoke execute on function pass_holders(uuid),pass_follow_members(),pass_follow_roles() from public,anon,authenticated;
