-- Event-owned draft workspace and immutable publications. Team identities always reference existing registration ids.
create table event_schedules (
 event_id uuid primary key references events(id) on delete cascade,
 revision integer not null default 0,draft jsonb not null,published jsonb,published_at timestamptz,
 updated_by uuid references auth.users(id),updated_at timestamptz not null default now()
);
create table schedule_history (
 id uuid primary key default gen_random_uuid(),event_id uuid not null references events(id) on delete cascade,
 revision integer not null,action text not null check(action in ('save','publish')),document jsonb not null,
 changed_by uuid not null references auth.users(id),changed_at timestamptz not null default clock_timestamp()
);
alter table event_schedules enable row level security;
alter table schedule_history enable row level security;
revoke all on event_schedules,schedule_history from public,anon,authenticated;
create trigger spectator_read_only before insert or update or delete on event_schedules for each row execute function spectator_write_guard();
create trigger spectator_read_only before insert or update or delete on schedule_history for each row execute function spectator_write_guard();
create function empty_schedule() returns jsonb language sql immutable as $$
 select '{"timezone":"Asia/Kolkata","days":[],"streams":[],"allocations":[],"exemptions":[],"resources":[],"activities":[]}'::jsonb
$$;
create function schedule_activity_teams(p_event uuid,d jsonb,a jsonb) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
 select coalesce(array_agg(t.id),'{}'::uuid[]) from teams t where t.event_id=p_event and
 (a->>'scope'='all' or (a->>'scope'='teams' and a->'teamIds' @> jsonb_build_array(t.id::text)) or
 (a->>'scope'='stream' and exists(select 1 from jsonb_array_elements(d->'allocations') x where x->>'teamId'=t.id::text and x->>'streamId'=a->>'streamId')))
$$;
create function schedule_team_exempt(d jsonb,t uuid,p text) returns boolean language sql immutable as $$
 select exists(select 1 from jsonb_array_elements(d->'exemptions') x where x->>'teamId'=t::text and x->>'panel' in ('all',p))
$$;
create function schedule_issues(p_event uuid,d jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare issues jsonb:='[]';x jsonb;a jsonb;b jsonb;t uuid;start_local timestamp;end_local timestamp;day jsonb;pair record;
begin
 if d is null or jsonb_typeof(d)<>'object' or length(d::text)>2000000 then raise exception 'invalid scheduling document' using errcode='22023'; end if;
 if not exists(select 1 from pg_timezone_names where name=d->>'timezone') then raise exception 'invalid event timezone' using errcode='22023'; end if;
 for x in select to_jsonb(k) from unnest(array['days','streams','allocations','exemptions','resources','activities']) k loop
  if jsonb_typeof(d->(x#>>'{}')) is distinct from 'array' then raise exception 'missing scheduling list' using errcode='22023'; end if;
 end loop;
 if jsonb_array_length(d->'activities')>1500 or jsonb_array_length(d->'streams')>200 or jsonb_array_length(d->'resources')>1000 then raise exception 'schedule is too large' using errcode='22023'; end if;
 if (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(d->'streams') x) or
 (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(d->'activities') x) or
 (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(d->'resources') x) or
 (select count(*)<>count(distinct x->>'date') from jsonb_array_elements(d->'days') x) then raise exception 'duplicate or missing scheduling identifiers' using errcode='22023'; end if;
 if jsonb_array_length(d->'days')=0 then issues:=issues||jsonb_build_array(jsonb_build_object('severity','error','code','days','message','Configure at least one event day and its operating hours.')); end if;
 for x in select * from jsonb_array_elements(d->'days') loop
  if (x->>'date') is null or (x->>'date') !~ '^\d{4}-\d{2}-\d{2}$' or (x->>'opens') is null or (x->>'closes') is null or x->>'opens' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or x->>'closes' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (x->>'opens')::time >= (x->>'closes')::time then raise exception 'invalid event operating hours' using errcode='22023'; end if;
  perform (x->>'date')::date;
 end loop;
 for x in select * from jsonb_array_elements(d->'streams') loop
  if coalesce(length(x->>'id'),0) not between 1 and 100 or coalesce(length(btrim(x->>'name')),0) not between 1 and 100 or coalesce(x->>'name','') !~ '^Stream [A-Z]+$' then raise exception 'invalid stream' using errcode='22023'; end if;
  if (select count(*) from jsonb_array_elements(d->'allocations') y where y->>'streamId'=x->>'id')>10 then issues:=issues||jsonb_build_array(jsonb_build_object('severity','error','code','capacity','message',(x->>'name')||' exceeds 10 teams.')); end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(d->'allocations') x group by x->>'teamId' having count(*)>1) then issues:=issues||'[{"severity":"error","code":"duplicate","message":"A team belongs to multiple streams."}]'; end if;
 for x in select * from jsonb_array_elements(d->'allocations') loop
  if not exists(select 1 from teams where event_id=p_event and id=(x->>'teamId')::uuid) or not exists(select 1 from jsonb_array_elements(d->'streams') s where s->>'id'=x->>'streamId') then issues:=issues||'[{"severity":"error","code":"allocation","message":"An allocation references a removed team or unknown stream."}]'; end if;
 end loop;
 for t in select id from teams where event_id=p_event and not exists(select 1 from jsonb_array_elements(d->'allocations') x where x->>'teamId'=id::text) loop
  issues:=issues||jsonb_build_array(jsonb_build_object('severity','error','code','unallocated','teamId',t,'message','A registered team is awaiting stream allocation.'));
 end loop;
 for x in select * from jsonb_array_elements(d->'exemptions') loop
  if not exists(select 1 from teams where event_id=p_event and id=(x->>'teamId')::uuid) or coalesce(x->>'panel','') not in ('all','verbal','design_engineering','enterprise','project_management','scrutineering') or coalesce(length(btrim(x->>'reason')),0) not between 3 and 500 then raise exception 'invalid team judging exemption or reason' using errcode='22023'; end if;
 end loop;
 for x in select * from jsonb_array_elements(d->'resources') loop
  if coalesce(length(x->>'id'),0) not between 1 and 100 or coalesce(length(btrim(x->>'name')),0) not between 1 and 150 or coalesce(x->>'kind','') not in ('track','room','panel','other') then raise exception 'invalid schedule resource' using errcode='22023'; end if;
 end loop;
 for a in select * from jsonb_array_elements(d->'activities') loop
  if coalesce(length(a->>'id'),0) not between 1 and 100 or coalesce(length(btrim(a->>'title')),0) not between 1 and 200 or coalesce(a->>'kind','') not in ('ceremony','activity','judging','racing') or coalesce(a->>'scope','') not in ('all','stream','teams') or jsonb_typeof(a->'teamIds') is distinct from 'array' or jsonb_typeof(a->'resourceIds') is distinct from 'array' or jsonb_typeof(a->'point') is distinct from 'boolean' or coalesce(length(a->>'location'),0)>200 then raise exception 'invalid schedule activity' using errcode='22023'; end if;
  if (a->>'start') is null or a->>'start' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or not isfinite((a->>'start')::timestamptz) then raise exception 'activity start requires a timezone' using errcode='22023'; end if;
  if (a->>'point')::boolean then
   if a->>'end' is not null then raise exception 'point activities must not have an end' using errcode='22023'; end if;
  elsif a->>'end' is null or a->>'end' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' or not isfinite((a->>'end')::timestamptz) or (a->>'end')::timestamptz<=(a->>'start')::timestamptz then raise exception 'activity requires a valid end or point-in-time format' using errcode='22023'; end if;
  start_local:=(a->>'start')::timestamptz at time zone (d->>'timezone');end_local:=coalesce((a->>'end')::timestamptz,(a->>'start')::timestamptz) at time zone (d->>'timezone');
  select x into day from jsonb_array_elements(d->'days') x where x->>'date'=start_local::date::text;
  if day is null or end_local::date<>start_local::date or start_local::time<(day->>'opens')::time or end_local::time>(day->>'closes')::time then issues:=issues||jsonb_build_array(jsonb_build_object('severity','error','code','hours','activityId',a->>'id','message',(a->>'title')||' is outside event dates or operating hours.')); end if;
  if a->>'scope'='stream' and not exists(select 1 from jsonb_array_elements(d->'streams') s where s->>'id'=a->>'streamId') then issues:=issues||jsonb_build_array(jsonb_build_object('severity','error','code','stream','activityId',a->>'id','message','Activity references an unknown stream.')); end if;
  if a->>'scope'='teams' then
   if jsonb_array_length(a->'teamIds')=0 or exists(select 1 from jsonb_array_elements_text(a->'teamIds') id where not exists(select 1 from teams where teams.id=id::uuid and event_id=p_event)) then issues:=issues||jsonb_build_array(jsonb_build_object('severity','error','code','team','activityId',a->>'id','message','Appointment requires registered teams.')); end if;
   if a->>'streamId' is not null and exists(select 1 from jsonb_array_elements_text(a->'teamIds') id where not exists(select 1 from jsonb_array_elements(d->'allocations') x where x->>'teamId'=id and x->>'streamId'=a->>'streamId')) then issues:=issues||jsonb_build_array(jsonb_build_object('severity','error','code','stream_assignment','activityId',a->>'id','message','Appointment no longer matches its team stream.')); end if;
  end if;
  if a->>'kind'='judging' then
   if coalesce(a->>'panel','') not in ('verbal','design_engineering','enterprise','project_management','scrutineering') then raise exception 'judging category required' using errcode='22023'; end if;
   if a->>'scope'='teams' then foreach t in array schedule_activity_teams(p_event,d,a) loop
    if schedule_team_exempt(d,t,a->>'panel') then issues:=issues||jsonb_build_array(jsonb_build_object('severity','error','code','exempt','activityId',a->>'id','teamId',t,'message','Judging appointment includes an exempt team.')); end if;
   end loop; end if;
  end if;
  if a->>'kind'='racing' and a->>'scope'<>'teams' then raise exception 'racing requires individual team appointments' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements_text(a->'resourceIds') id where not exists(select 1 from jsonb_array_elements(d->'resources') r where r->>'id'=id)) then raise exception 'unknown scheduling resource' using errcode='22023'; end if;
 end loop;
 -- Only overlapping pairs are expanded; touching interval boundaries do not conflict.
 for pair in select a.x a,b.x b from jsonb_array_elements(d->'activities') with ordinality a(x,n) join jsonb_array_elements(d->'activities') with ordinality b(x,n) on a.n<b.n
 where case when (a.x->>'point')::boolean and (b.x->>'point')::boolean then (a.x->>'start')::timestamptz=(b.x->>'start')::timestamptz
 when (a.x->>'point')::boolean then (a.x->>'start')::timestamptz>=(b.x->>'start')::timestamptz and (a.x->>'start')::timestamptz<(b.x->>'end')::timestamptz
 when (b.x->>'point')::boolean then (b.x->>'start')::timestamptz>=(a.x->>'start')::timestamptz and (b.x->>'start')::timestamptz<(a.x->>'end')::timestamptz
 else (a.x->>'start')::timestamptz<(b.x->>'end')::timestamptz and (b.x->>'start')::timestamptz<(a.x->>'end')::timestamptz end loop
  a:=pair.a;b:=pair.b;
  if not (a->>'kind'='judging' and a->>'scope'<>'teams') and not (b->>'kind'='judging' and b->>'scope'<>'teams') then
   foreach t in array schedule_activity_teams(p_event,d,a) loop
    if t=any(schedule_activity_teams(p_event,d,b)) then issues:=issues||jsonb_build_array(jsonb_build_object('severity','error','code','overlap','activityId',a->>'id','teamId',t,'message',(a->>'title')||' overlaps '||(b->>'title')||' for a team.')); end if;
   end loop;
  end if;
  if exists(select 1 from jsonb_array_elements_text(a->'resourceIds') id where b->'resourceIds' @> jsonb_build_array(id)) or (btrim(coalesce(a->>'location',''))<>'' and lower(btrim(a->>'location'))=lower(btrim(b->>'location'))) then issues:=issues||jsonb_build_array(jsonb_build_object('severity','warning','code','resource_overlap','activityId',a->>'id','message',(a->>'title')||' and '||(b->>'title')||' overlap at a shared room, panel or track.')); end if;
 end loop;
 return issues;
end $$;
create function scheduling_state(p_event uuid) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s event_schedules;d jsonb;
begin
 if not event_active(p_event) or not (is_chair_or_organiser(p_event) or platform_spectator()) then raise exception 'organiser workspace required' using errcode='42501'; end if;
 select * into s from event_schedules where event_id=p_event;d:=coalesce(s.draft,empty_schedule());
 return jsonb_build_object('revision',coalesce(s.revision,0),'draft',d,'published',s.published,'publishedAt',s.published_at,'issues',schedule_issues(p_event,d),'judgeExemptions',(select coalesce(jsonb_agg(jsonb_build_object('teamId',x.team_id,'judgeName',coalesce((select nullif(r.display_name,'') from event_roles r where r.event_id=p_event and r.user_id=x.judge_id order by r.id limit 1),'Assigned judge'),'reason',x.reason)),'[]') from judge_exemptions x where x.event_id=p_event and organiser_identity_visible(x.judge_id,null)),'history',(select coalesce(jsonb_agg(jsonb_build_object('revision',h.revision,'action',h.action,'at',h.changed_at,'actor',case when organiser_identity_visible(h.changed_by,null) then coalesce((select nullif(p.display_name,'') from platform_organisers p where p.user_id=h.changed_by),(select nullif(r.display_name,'') from event_roles r where r.event_id=p_event and r.user_id=h.changed_by order by r.id limit 1),(select u.email from auth.users u where u.id=h.changed_by),'Event staff') else 'Event staff' end) order by h.changed_at desc),'[]') from (select * from schedule_history where event_id=p_event order by changed_at desc limit 50) h));
end $$;
create function save_schedule(p_event uuid,p_revision integer,p_document jsonb) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare issues jsonb;
begin
 perform 1 from events where id=p_event for update;
 if not event_active(p_event) or platform_spectator() or not is_chair_or_organiser(p_event) then raise exception 'event organiser required' using errcode='42501'; end if;
 if p_revision is distinct from coalesce((select revision from event_schedules where event_id=p_event),0) then raise exception 'schedule changed; reload before saving' using errcode='40001'; end if;
 issues:=schedule_issues(p_event,p_document);
 if exists(select 1 from jsonb_array_elements(issues) i where i->>'code' in ('capacity','duplicate','allocation')) then raise exception 'stream allocations are invalid or exceed capacity' using errcode='22023'; end if;
 insert into event_schedules(event_id,revision,draft,updated_by) values(p_event,p_revision+1,p_document,auth.uid()) on conflict(event_id) do update set revision=excluded.revision,draft=excluded.draft,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 insert into schedule_history(event_id,revision,action,document,changed_by) values(p_event,p_revision+1,'save',p_document,auth.uid());
 perform audit_write(p_event,'schedule_save','event_schedules',p_event::text,jsonb_build_object('revision',p_revision+1));
end $$;
create function publish_schedule(p_event uuid,p_revision integer) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare s event_schedules;issues jsonb;
begin
 perform 1 from events where id=p_event for update;
 if not event_active(p_event) or platform_spectator() or not is_chair_or_organiser(p_event) then raise exception 'event organiser required' using errcode='42501'; end if;
 select * into s from event_schedules where event_id=p_event;
 if s.event_id is null or s.revision is distinct from p_revision then raise exception 'save and review the current draft before publishing' using errcode='40001'; end if;
 issues:=schedule_issues(p_event,s.draft);
 if exists(select 1 from jsonb_array_elements(issues) i where i->>'severity'='error') then raise exception 'resolve blocking schedule errors before publication' using errcode='55000'; end if;
 update event_schedules set published=draft,published_at=clock_timestamp(),revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() where event_id=p_event;
 insert into schedule_history(event_id,revision,action,document,changed_by) values(p_event,p_revision+1,'publish',s.draft,auth.uid());
 perform audit_write(p_event,'schedule_publish','event_schedules',p_event::text,jsonb_build_object('revision',p_revision+1));
end $$;
create function my_schedule(p_event uuid) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s event_schedules;result jsonb:='[]';t record;items jsonb;stream text;
begin
 if not event_active(p_event) or not exists(select 1 from event_roles where event_id=p_event and user_id=auth.uid() and role='team_manager') then raise exception 'team manager required' using errcode='42501'; end if;
 select * into s from event_schedules where event_id=p_event;
 for t in select id from teams where event_id=p_event and manages_team(p_event,id) loop
  stream:=null;items:='[]';
  if s.published is not null then
   select st->>'name' into stream from jsonb_array_elements(s.published->'streams') st join jsonb_array_elements(s.published->'allocations') x on st->>'id'=x->>'streamId' where x->>'teamId'=t.id::text;
   select coalesce(jsonb_agg(a||jsonb_build_object('teamIds',case when a->>'scope'='teams' then jsonb_build_array(t.id) else '[]'::jsonb end,'resourceNames',(select coalesce(jsonb_agg(r->>'name'),'[]') from jsonb_array_elements(s.published->'resources') r where a->'resourceIds' @> jsonb_build_array(r->>'id'))) order by (a->>'start')::timestamptz,a->>'id'),'[]') into items from jsonb_array_elements(s.published->'activities') a where t.id=any(schedule_activity_teams(p_event,s.published,a)) and not (a->>'kind'='judging' and schedule_team_exempt(s.published,t.id,a->>'panel'));
  end if;
  result:=result||jsonb_build_array(jsonb_build_object('teamId',t.id,'stream',stream,'activities',items));
 end loop;
 return jsonb_build_object('timezone',coalesce(s.published->>'timezone','Asia/Kolkata'),'publishedAt',s.published_at,'teams',result);
end $$;
revoke execute on function empty_schedule(),schedule_activity_teams(uuid,jsonb,jsonb),schedule_team_exempt(jsonb,uuid,text),schedule_issues(uuid,jsonb),scheduling_state(uuid),save_schedule(uuid,integer,jsonb),publish_schedule(uuid,integer),my_schedule(uuid) from public,anon,authenticated;
grant execute on function scheduling_state(uuid),save_schedule(uuid,integer,jsonb),publish_schedule(uuid,integer),my_schedule(uuid) to authenticated;
