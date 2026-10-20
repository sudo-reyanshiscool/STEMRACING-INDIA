-- Event-specific top-64 racing setup. No existing race data is rewritten.
create table racing_setup (
  event_id uuid primary key references events on delete cascade,
  revision integer not null default 1,
  seeds jsonb not null default '[]',
  reaction_complete boolean not null default false,
  points jsonb not null default '[null,null,null,85,106,null,135,10]',
  updated_at timestamptz not null default clock_timestamp()
);
alter table racing_setup enable row level security;
revoke all on racing_setup from public, anon, authenticated;
create trigger racing_setup_audit after insert or update or delete on racing_setup for each row execute function audit_row();
alter table race_heats add column bracket_round integer, add column bracket_slot integer;
alter table race_heats add constraint bracket_position check (
  (bracket_round is null and bracket_slot is null) or
  (phase='knockout' and bracket_round is not null and bracket_slot is not null and bracket_round between 1 and 6 and bracket_slot between 1 and (64 / power(2,bracket_round))::integer)
);

-- Includes deletions/reopens as well as writes. Kept separate from rank inputs to preserve existing counts.
create function racing_version(p_event uuid) returns text language sql stable security definer set search_path = public, pg_temp as $$
  select md5(jsonb_build_object(
    'setup',(select to_jsonb(s) from racing_setup s where event_id=p_event),
    'races',coalesce((select jsonb_agg(to_jsonb(r) order by id) from race_heats r where event_id=p_event),'[]'),
    'inspections',coalesce((select jsonb_agg(to_jsonb(i) order by id) from technical_inspections i where event_id=p_event),'[]')
  )::text)
$$;
create function racing_state(p_event uuid) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s racing_setup;
begin
  if not is_member(p_event) or not sees_all_teams(p_event) then raise exception 'event staff required' using errcode='42501'; end if;
  select * into s from racing_setup where event_id=p_event;
  return jsonb_build_object('revision',coalesce(s.revision,0),'seeds',coalesce(s.seeds,'[]'),'reactionComplete',coalesce(s.reaction_complete,false),'points',coalesce(s.points,'[null,null,null,85,106,null,135,10]'),'version',racing_version(p_event));
end $$;
create function save_racing_setup(p_event uuid,p_revision integer,p_input jsonb) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare e events; s racing_setup; seeds jsonb; points jsonb; complete boolean;
begin
  select * into e from events where id=p_event for update;
  if not found or e.deleted_at is not null or not is_chair_or_organiser(p_event) then raise exception 'organiser or Chair required' using errcode='42501'; end if;
  if e.results_released then raise exception 'results released' using errcode='55000'; end if;
  select * into s from racing_setup where event_id=p_event;
  if p_revision is null or p_revision<>coalesce(s.revision,0) then raise exception 'racing setup changed; reload' using errcode='40001'; end if;
  seeds:=p_input->'seeds'; points:=p_input->'points';
  if jsonb_typeof(seeds) is distinct from 'array' or jsonb_typeof(points) is distinct from 'array' or jsonb_typeof(p_input->'reactionComplete') is distinct from 'boolean' then raise exception 'invalid racing setup' using errcode='22023'; end if;
  complete:=(p_input->>'reactionComplete')::boolean;
  if jsonb_array_length(seeds)>64 or jsonb_array_length(points)<>8 then raise exception 'invalid stage or seed count' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(points) v where v<>'null'::jsonb and (jsonb_typeof(v)<>'number' or (v#>>'{}')::numeric<0 or (v#>>'{}')::numeric>135 or (v#>>'{}')::numeric<>round((v#>>'{}')::numeric,1))) then raise exception 'invalid stage points' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements_text(seeds) v left join teams t on t.id::text=v and t.event_id=p_event where t.id is null) or (select count(*)<>count(distinct v) from jsonb_array_elements_text(seeds) v) then raise exception 'invalid seed teams' using errcode='22023'; end if;
  if jsonb_array_length(seeds)>0 and (not complete or jsonb_array_length(seeds)<2) then raise exception 'complete reaction racing before seeding' using errcode='22023'; end if;
  if complete and (exists(select 1 from race_heats where event_id=p_event and phase='reaction' and (lane1_status='pending' or lane2_status='pending')) or exists(select 1 from teams t cross join (values ('A'),('B')) c(car) cross join (values (1),(2)) l(lane) where t.event_id=p_event and not exists(select 1 from race_heats r where r.event_id=p_event and r.phase='reaction' and ((l.lane=1 and r.lane1_team=t.id and r.lane1_car=c.car) or (l.lane=2 and r.lane2_team=t.id and r.lane2_car=c.car))))) then raise exception 'finish reaction races for every team first' using errcode='55000'; end if;
  if exists(select 1 from race_heats where event_id=p_event and bracket_round is not null) and (seeds is distinct from s.seeds or not complete) then raise exception 'bracket has started; seeds are locked' using errcode='55000'; end if;
  insert into racing_setup(event_id,seeds,points,reaction_complete) values(p_event,seeds,points,complete)
  on conflict(event_id) do update set seeds=excluded.seeds,points=excluded.points,reaction_complete=excluded.reaction_complete,revision=racing_setup.revision+1,updated_at=clock_timestamp();
  return racing_state(p_event);
end $$;

-- Wrap the existing atomic recorder; every caller retains its revision and correction checks.
alter function save_race(uuid,uuid,integer,jsonb) rename to save_race_original;
revoke execute on function save_race_original(uuid,uuid,integer,jsonb) from public,anon,authenticated;
create function save_race(p_event uuid,p_id uuid,p_revision integer,p_input jsonb) returns race_heats language plpgsql security definer set search_path = public, pg_temp as $$
declare result race_heats; old race_heats; br integer; bs integer; s racing_setup;
begin
  -- Serialize with setup, snapshots and other heat saves before reading state.
  perform 1 from events where id=p_event for update;
  if not (is_chair_or_organiser(p_event) or has_role(p_event,'race_official')) then raise exception 'race official required' using errcode='42501'; end if;
  select * into s from racing_setup where event_id=p_event;
  select * into old from race_heats where id=p_id and event_id=p_event;
  br:=(p_input#>>'{bracket,round}')::integer; bs:=(p_input#>>'{bracket,slot}')::integer;
  if old.id is not null and (old.bracket_round,old.bracket_slot) is distinct from (br,bs) then raise exception 'bracket identity is fixed' using errcode='55000'; end if;
  if s.reaction_complete and p_input->>'phase'='reaction' then raise exception 'reopen reaction racing setup before editing its heats' using errcode='55000'; end if;
  if br is not null and (s.event_id is null or jsonb_array_length(s.seeds)<2 or not s.reaction_complete) then raise exception 'approve seeds first' using errcode='55000'; end if;
  if br is not null and (not s.seeds @> jsonb_build_array(p_input#>>'{lane1,teamId}') or not s.seeds @> jsonb_build_array(p_input#>>'{lane2,teamId}')) then raise exception 'teams must be seeded' using errcode='22023'; end if;
  if br is not null and exists(select 1 from race_heats r where r.event_id=p_event and r.bracket_round=br and r.bracket_slot=bs and r.id<>p_id and r.heat_number>coalesce(old.heat_number,0) and (r.lane1_status='pending' or r.lane2_status='pending')) then raise exception 'open the existing pending attempt' using errcode='55000'; end if;
  result:=save_race_original(p_event,p_id,p_revision,p_input);
  if (result.bracket_round,result.bracket_slot) is distinct from (br,bs) then
    update race_heats set bracket_round=br,bracket_slot=bs where id=result.id returning * into result;
  end if;
  return result;
end $$;
-- Once seeded, preserve the bracket roster, even when a seed received a bye.
create function protect_seed_team() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists(select 1 from racing_setup where event_id=old.event_id and seeds @> jsonb_build_array(old.id::text)) then raise exception 'seeded teams cannot be deleted' using errcode='55000'; end if;
  return old;
end $$;
create trigger teams_seed_guard before delete on teams for each row execute function protect_seed_team();

-- Race/inspection edits must invalidate published rankings, including legacy snapshots without a version.
create function racing_release_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare s ranking_snapshots;
begin
  if new.results_released and not old.results_released and (exists(select 1 from racing_setup where event_id=new.id) or exists(select 1 from race_heats where event_id=new.id) or exists(select 1 from technical_inspections where event_id=new.id)) then
    select * into s from ranking_snapshots where event_id=new.id order by created_at desc,id desc limit 1;
    if s.inputs->>'racingVersion' is distinct from racing_version(new.id) then raise exception 'racing or inspections changed; publish the ranking again' using errcode='55000'; end if;
    if exists(select 1 from racing_setup where event_id=new.id) and (jsonb_typeof(s.inputs->'racingIssues') is distinct from 'array' or jsonb_array_length(s.inputs->'racingIssues')<>0) then raise exception 'finish racing setup and bracket before release' using errcode='55000'; end if;
  end if;
  return new;
end $$;
create trigger events_racing_release before update of results_released on events for each row execute function racing_release_guard();
revoke execute on function racing_version(uuid),racing_state(uuid),save_racing_setup(uuid,integer,jsonb),save_race(uuid,uuid,integer,jsonb),protect_seed_team(),racing_release_guard() from public,anon,authenticated;
grant execute on function racing_state(uuid),save_racing_setup(uuid,integer,jsonb),save_race(uuid,uuid,integer,jsonb) to authenticated;

-- Queue the entire four-run schedule in one transaction; retry cannot duplicate it.
create function queue_reaction_races(p_event uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare e events; ids uuid[]; n integer; i integer; car text;
begin
  select * into e from events where id=p_event for update;
  if not found or e.deleted_at is not null or not is_chair_or_organiser(p_event) then raise exception 'organiser or Chair required' using errcode='42501'; end if;
  if e.results_released or exists(select 1 from racing_setup where event_id=p_event and reaction_complete) or exists(select 1 from race_heats where event_id=p_event and phase='reaction') then raise exception 'reaction racing already queued or locked' using errcode='55000'; end if;
  select array_agg(id order by number,id) into ids from teams where event_id=p_event;
  n:=cardinality(ids);
  if n is null or n<2 then raise exception 'at least two teams required' using errcode='22023'; end if;
  for i in 1..n loop foreach car in array array['A','B'] loop
    perform save_race(p_event,gen_random_uuid(),0,jsonb_build_object('label','Reaction · '||i||car,'phase','reaction','lane1',jsonb_build_object('teamId',ids[i],'car',car,'status','pending','totalMs',null,'reactionMs',null),'lane2',jsonb_build_object('teamId',ids[(i%n)+1],'car',car,'status','pending','totalMs',null,'reactionMs',null),'note','','source','manual','sourceRunId',null));
  end loop; end loop;
end $$;
revoke execute on function queue_reaction_races(uuid) from public,anon,authenticated;
grant execute on function queue_reaction_races(uuid) to authenticated;

-- A completed qualification field cannot silently gain an unqualified new entrant.
create function racing_roster_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from events where id=new.event_id for update;
  if exists(select 1 from racing_setup where event_id=new.event_id and reaction_complete) then raise exception 'racing roster locked; reopen reaction racing first' using errcode='55000'; end if;
  return new;
end $$;
revoke execute on function racing_roster_guard() from public,anon,authenticated;
create trigger teams_racing_roster before insert on teams for each row execute function racing_roster_guard();
