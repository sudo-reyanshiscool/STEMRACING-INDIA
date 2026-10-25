-- Server-timed portfolio receipts and configurable automatic late penalties.
alter table team_files add column submitted_at timestamptz;
update team_files set submitted_at=updated_at where kind<>'logo';
create function portfolio_receipt_guard() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
 if new.kind<>'logo' then new.submitted_at:=case when tg_op='UPDATE' then coalesce(old.submitted_at,clock_timestamp()) else clock_timestamp() end; end if;
 return new;
end $$;
create trigger portfolio_receipt before insert or update on team_files for each row execute function portfolio_receipt_guard();
create table submission_settings (
 event_id uuid primary key references events(id) on delete cascade,
 revision integer not null check(revision>0), rules jsonb not null,updated_at timestamptz not null default now()
);
alter table submission_settings enable row level security;
revoke all on submission_settings from public,anon,authenticated;
create trigger spectator_read_only before insert or update or delete on submission_settings for each row execute function spectator_write_guard();
create function save_submission_rules(p_event uuid,p_revision integer,p_rules jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
 perform 1 from events where id=p_event for update;
 if not event_active(p_event) or not is_chair_or_organiser(p_event) or platform_spectator() then raise exception 'only event organisers may configure submissions' using errcode='42501'; end if;
 if event_released(p_event) then raise exception 'results released' using errcode='55000'; end if;
 if jsonb_typeof(p_rules) is distinct from 'array' or jsonb_array_length(p_rules)<>3 then raise exception 'three portfolio rules required' using errcode='22023'; end if;
 if (select count(distinct x->>'kind') from jsonb_array_elements(p_rules) x)<>3 then raise exception 'duplicate portfolio rules' using errcode='22023'; end if;
 for r in select * from jsonb_array_elements(p_rules) loop
  if (r->>'kind') is null or r->>'kind' not in ('design_portfolio','enterprise_portfolio','project_portfolio') or jsonb_typeof(r->'pointsPerHour') is distinct from 'number' or (r->>'pointsPerHour')::numeric not between 0 and 1000 or round((r->>'pointsPerHour')::numeric,1)<>(r->>'pointsPerHour')::numeric then raise exception 'invalid portfolio rule' using errcode='22023'; end if;
  if r->>'deadline' is not null and (not isfinite((r->>'deadline')::timestamptz) or (r->>'deadline') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$') then raise exception 'deadline must include timezone' using errcode='22023'; end if;
 end loop;
 if p_revision is distinct from coalesce((select revision from submission_settings where event_id=p_event),0) then raise exception 'submission rules changed; reload' using errcode='40001'; end if;
 insert into submission_settings(event_id,revision,rules) values(p_event,p_revision+1,p_rules)
 on conflict(event_id) do update set rules=excluded.rules,revision=excluded.revision,updated_at=clock_timestamp();
end $$;
-- Internal canonical calculation: no client clock, no mutable manual penalty row.
create function portfolio_submission_rows(p_event uuid)
returns table(team_id uuid,kind text,submitted_at timestamptz,deadline timestamptz,points numeric,status text)
language sql stable security definer set search_path = public, pg_temp as $$
 with cfg as (select coalesce((select rules from submission_settings where event_id=p_event),'[{"kind":"design_portfolio","deadline":null,"pointsPerHour":5},{"kind":"enterprise_portfolio","deadline":null,"pointsPerHour":5},{"kind":"project_portfolio","deadline":null,"pointsPerHour":5}]'::jsonb) rules),
 timing as (select case when event_released(p_event) then coalesce((select created_at from ranking_snapshots where event_id=p_event order by created_at desc,id desc limit 1),statement_timestamp()) else statement_timestamp() end at),
 rows as (select t.id team_id,r->>'kind' kind,f.submitted_at,(r->>'deadline')::timestamptz deadline,(r->>'pointsPerHour')::numeric rate,timing.at
 from teams t cross join cfg cross join lateral jsonb_array_elements(cfg.rules) r cross join timing left join team_files f on f.event_id=p_event and f.team_id=t.id and f.kind=r->>'kind' where t.event_id=p_event)
 select team_id,kind,submitted_at,deadline,case when deadline is null then 0 else greatest(0,ceil(extract(epoch from (coalesce(submitted_at,at)-deadline))/3600))*rate end,
 case when deadline is null then 'not_open' when submitted_at is not null then case when submitted_at>deadline then 'late' else 'on_time' end when at>deadline then 'overdue' else 'pending' end from rows
$$;
create function submission_state(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
 if not event_active(p_event) or not (is_chair_or_organiser(p_event) or platform_spectator() or exists(select 1 from event_roles where event_id=p_event and user_id=auth.uid() and role='team_manager')) then raise exception 'submissions unavailable' using errcode='42501'; end if;
 return jsonb_build_object('revision',coalesce((select revision from submission_settings where event_id=p_event),0),
 'rules',coalesce((select rules from submission_settings where event_id=p_event),'[{"kind":"design_portfolio","deadline":null,"pointsPerHour":5},{"kind":"enterprise_portfolio","deadline":null,"pointsPerHour":5},{"kind":"project_portfolio","deadline":null,"pointsPerHour":5}]'::jsonb),
 'rows',(select coalesce(jsonb_agg(jsonb_build_object('teamId',team_id,'kind',kind,'submittedAt',submitted_at,'deadline',deadline,'points',points,'status',status)),'[]') from portfolio_submission_rows(p_event) where is_chair_or_organiser(p_event) or platform_spectator() or manages_team(p_event,team_id)));
end $$;
create function all_event_penalties(p_event uuid)
returns table(id text,event_id uuid,team_id uuid,points numeric,reason text)
language sql stable security definer set search_path = public, pg_temp as $$
 select id::text,event_id,team_id,points,reason from penalties where event_id=p_event
 union all select 'submission:'||team_id||':'||kind,p_event,team_id,points,'Automatic submission penalty · '||replace(kind,'_',' ') from portfolio_submission_rows(p_event) where points>0
$$;
create function list_event_penalties(p_event uuid)
returns table(id text,event_id uuid,team_id uuid,points numeric,reason text)
language sql stable security definer set search_path = public, pg_temp as $$
 select * from all_event_penalties(p_event) where event_active(p_event) and (is_chair_or_organiser(p_event) or platform_spectator() or (manages_team(p_event,team_id) and (event_released(p_event) or id like 'submission:%')))
$$;
create function validate_submission_penalties(p_event uuid,p_inputs jsonb) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare expected jsonb; actual jsonb;
begin
 if not exists(select 1 from submission_settings s cross join lateral jsonb_array_elements(s.rules) r where s.event_id=p_event and r->>'deadline' is not null) then return; end if;
 select coalesce(jsonb_agg(jsonb_build_object('teamId',team_id,'points',points) order by team_id,points),'[]') into expected from all_event_penalties(p_event);
 select coalesce(jsonb_agg(jsonb_build_object('teamId',x->>'teamId','points',(x->>'points')::numeric) order by x->>'teamId',(x->>'points')::numeric),'[]') into actual from jsonb_array_elements(coalesce(p_inputs->'penalties','[]')) x;
 if expected is distinct from actual then raise exception 'submission penalties changed; refresh and publish rankings again' using errcode='55000'; end if;
end $$;
revoke execute on function portfolio_receipt_guard(),save_submission_rules(uuid,integer,jsonb),portfolio_submission_rows(uuid),submission_state(uuid),all_event_penalties(uuid),list_event_penalties(uuid),validate_submission_penalties(uuid,jsonb) from public,anon,authenticated;
grant execute on function save_submission_rules(uuid,integer,jsonb),submission_state(uuid),list_event_penalties(uuid) to authenticated;

create or replace function snapshots_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.ruleset_id is distinct from (select ruleset ->> 'id' from events where id = new.event_id) then
    raise exception 'snapshot ruleset does not match the ruleset pinned to the event' using errcode = '22023';
  end if;
  if new.released is distinct from true then
    raise exception 'a ranking snapshot is always released-capable; released cannot be false' using errcode = '23514';
  end if;
  perform validate_submission_penalties(new.event_id,new.inputs);
  new.created_by := auth.uid();
  new.created_at := now();
  return new;
end $$;

create or replace function release_results(p_event uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare e events; s ranking_snapshots; n int; arr jsonb;
begin
  if auth.uid() is null or not has_role(p_event, 'chair') then
    raise exception 'only the Chair can release results' using errcode = '42501';
  end if;
  select * into e from events where id = p_event for update;
  if not found then raise exception 'only the Chair can release results' using errcode = '42501'; end if;
  if e.results_released then return; end if;

  select * into s from ranking_snapshots where event_id = p_event order by created_at desc, id desc limit 1;
  if not found or not s.released then
    raise exception 'publish a ranking before releasing it' using errcode = '55000';
  end if;

  -- Anything counted that is newer than the snapshot makes it out of date: a card submitted, an override set or
  -- changed, a penalty recorded, a team added.
  if exists (select 1 from scorecards where event_id = p_event and status = 'submitted' and submitted_at > s.created_at)
     or exists (select 1 from score_overrides where event_id = p_event and updated_at > s.created_at)
     or exists (select 1 from penalties where event_id = p_event and created_at > s.created_at)
     or exists (select 1 from teams where event_id = p_event and created_at > s.created_at) then
    raise exception 'the published ranking is out of date; publish it again before releasing' using errcode = '55000';
  end if;
  -- Deletions leave no later timestamp (a penalty or override removed, a card reopened, a team removed), so the
  -- counts of what the snapshot says it counted must match too.
  for arr, n in
    select s.inputs -> 'cards', (select count(*) from scorecards where event_id = p_event and status = 'submitted')
    union all select s.inputs -> 'overrides', (select count(*) from score_overrides where event_id = p_event)
    union all select s.inputs -> 'penalties', (select count(*) from all_event_penalties(p_event))
    union all select s.inputs -> 'teams', (select count(*) from teams where event_id = p_event)
  loop
    if jsonb_typeof(arr) = 'array' and jsonb_array_length(arr) <> n then
      raise exception 'the published ranking is out of date; publish it again before releasing' using errcode = '55000';
    end if;
  end loop;

  perform validate_submission_penalties(p_event,s.inputs);
  update events set results_released = true where id = p_event;
end $$;

create or replace function team_results_packet(p_event uuid,p_team uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s ranking_snapshots; t teams; winner jsonb;
begin
 if not (is_chair_or_organiser(p_event) or (platform_spectator() and event_active(p_event))) then raise exception 'only event staff can preview results PDFs' using errcode='42501'; end if;
 select * into t from teams where id=p_team and event_id=p_event;
 if not found then raise exception 'team not found' using errcode='22023'; end if;
 select * into s from ranking_snapshots where event_id=p_event and released order by created_at desc,id desc limit 1;
 if not found or not exists(select 1 from jsonb_array_elements(s.rows) r where r->>'teamId'=p_team::text) then raise exception 'publish a ranking containing this team before generating results PDFs' using errcode='55000'; end if;
 return jsonb_build_object('released',event_released(p_event),'awardsConfirmed',coalesce((select awards_confirmed from result_mail_settings where event_id=p_event),false),'eventName',(select name from events where id=p_event),'eventId',p_event,'snapshotId',s.id,'createdAt',s.created_at,'ruleset',(select ruleset from events where id=p_event),
 'team',jsonb_build_object('id',t.id,'number',t.number,'name',t.name,'school',t.school),
 'standings',(select coalesce(jsonb_agg(jsonb_build_object('rank',r->'rank','teamId',r->'teamId','number',r->'number','name',r->'name','school',(select tt.school from teams tt where tt.id=(r->>'teamId')::uuid and tt.event_id=p_event),'total',r->'total') order by ord),'[]') from jsonb_array_elements(s.rows) with ordinality x(r,ord)),
 'teamResult',(select r from jsonb_array_elements(s.rows) r where r->>'teamId'=p_team::text),
 'awards',(select coalesce(jsonb_agg(jsonb_build_object('title',a.title,'teamNumber',tt.number,'teamName',tt.name,'teamSchool',tt.school) order by a.title),'[]') from event_awards a join teams tt on tt.id=a.team_id where a.event_id=p_event),
 'cards',(select coalesce(jsonb_agg(jsonb_build_object('areaId',c.area_id,'scores',(select coalesce(jsonb_object_agg(ss.criterion_id,ss.score),'{}') from scorecard_scores ss where ss.scorecard_id=c.id),
 'feedback',jsonb_build_object('overall',f.overall,'strengths',f.strengths,'improvements',f.improvements)) order by c.area_id,c.id),'[]') from scorecards c left join scorecard_feedback f on f.scorecard_id=c.id where c.event_id=p_event and c.team_id=p_team and c.status='submitted'),
 'penalties',(select coalesce(jsonb_agg(jsonb_build_object('points',p.points,'reason',p.reason)),'[]') from all_event_penalties(p_event) p where p.team_id=p_team),
 'benchmarks',(select coalesce(jsonb_object_agg(key,jsonb_build_object('low',lo,'median',med,'high',hi)),'{}') from (
  select key,min(value::numeric) lo,percentile_cont(0.5) within group(order by value::numeric) med,max(value::numeric) hi from (
   select e.key,e.value from jsonb_array_elements(s.rows) r cross join lateral jsonb_each(r->'areas') e where jsonb_typeof(e.value)='number'
   union all select '__total',r->'total' from jsonb_array_elements(s.rows) r where jsonb_typeof(r->'total')='number'
  ) values_by_area group by key) aggregates),
 'races',(select coalesce(jsonb_agg(jsonb_build_object('number',h.heat_number,'label',h.label,'phase',h.phase,'lane',v.lane,'car',v.car,'status',v.status,'totalMs',v.total_ms,'reactionMs',v.reaction_ms) order by h.heat_number,v.lane),'[]') from race_heats h cross join lateral (values (1,h.lane1_team,h.lane1_car,h.lane1_status,h.lane1_total_ms,h.lane1_reaction_ms),(2,h.lane2_team,h.lane2_car,h.lane2_status,h.lane2_total_ms,h.lane2_reaction_ms)) v(lane,team_id,car,status,total_ms,reaction_ms) where h.event_id=p_event and v.team_id=p_team and v.status<>'pending'),
 'inspections',(select coalesce(jsonb_agg(jsonb_build_object('car',i.car,'rulesetId',i.ruleset_id,'selectedArticles',i.selected_articles,'measurements',i.measurements) order by i.car),'[]') from technical_inspections i where i.event_id=p_event and i.team_id=p_team and i.status='submitted'));
end $$;
