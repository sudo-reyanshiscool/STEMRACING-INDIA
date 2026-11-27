-- Makes the schedule check fast enough for a full regional. Only the overlap section changes; the rest is as in 0040.
create or replace function schedule_issues(p_event uuid,d jsonb) returns jsonb
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
 -- Overlap check. Each activity's teams are worked out once, then clashing pairs are found in one query.
 -- Before, every overlapping pair re-derived its teams once per team, which took over 8 seconds for a
 -- full regional (about 360 activities) and hit the API's statement timeout. Touching boundaries still
 -- do not conflict, and judging that is not booked per team still never blocks a team.
 with acts as (
  select n,x,(x->>'point')::boolean pt,(x->>'start')::timestamptz s,(x->>'end')::timestamptz e
  from jsonb_array_elements(d->'activities') with ordinality q(x,n)
 ),alloc as (
  select x->>'teamId' team_id,x->>'streamId' stream_id from jsonb_array_elements(d->'allocations') x
 ),need as (
  select a.n,t.id team_id from acts a join teams t on t.event_id=p_event
  where a.x->>'scope'='all' and a.x->>'kind'<>'judging'
  union
  select a.n,t.id from acts a cross join jsonb_array_elements_text(a.x->'teamIds') i(team_id) join teams t on t.event_id=p_event and t.id::text=i.team_id
  where a.x->>'scope'='teams'
  union
  select a.n,t.id from acts a join alloc l on l.stream_id=a.x->>'streamId' join teams t on t.event_id=p_event and t.id::text=l.team_id
  where a.x->>'scope'='stream' and a.x->>'kind'<>'judging'
 ),pairs as (
  select a.n an,b.n bn,a.x ax,b.x bx from acts a join acts b on a.n<b.n
  where case when a.pt and b.pt then a.s=b.s
  when a.pt then a.s>=b.s and a.s<b.e
  when b.pt then b.s>=a.s and b.s<a.e
  else a.s<b.e and b.s<a.e end
 ),found as (
  select p.an,p.bn,0 k,na.team_id::text t,jsonb_build_object('severity','error','code','overlap','activityId',p.ax->>'id','teamId',na.team_id,'message',(p.ax->>'title')||' overlaps '||(p.bx->>'title')||' for a team.') issue
  from pairs p join need na on na.n=p.an join need nb on nb.n=p.bn and nb.team_id=na.team_id
  union all
  select p.an,p.bn,1,'',jsonb_build_object('severity','warning','code','resource_overlap','activityId',p.ax->>'id','message',(p.ax->>'title')||' and '||(p.bx->>'title')||' overlap at a shared room, panel or track.')
  from pairs p where exists(select 1 from jsonb_array_elements_text(p.ax->'resourceIds') id where p.bx->'resourceIds' @> jsonb_build_array(id))
   or (btrim(coalesce(p.ax->>'location',''))<>'' and lower(btrim(p.ax->>'location'))=lower(btrim(p.bx->>'location')))
 )
 select issues||coalesce(jsonb_agg(issue order by an,bn,k,t),'[]') into issues from found;
 return issues;
end $$;
