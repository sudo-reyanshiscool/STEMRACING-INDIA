-- Race results are atomic two-lane records. Only named officials can write; revisions prevent lost updates.
create table race_heats (
  id uuid primary key,
  event_id uuid not null references events on delete cascade,
  heat_number integer not null,
  label text not null check (char_length(btrim(label)) between 1 and 100),
  phase text not null check (phase in ('reaction','knockout')),
  lane1_team uuid not null, lane2_team uuid not null,
  lane1_car text not null check (lane1_car in ('A','B')), lane2_car text not null check (lane2_car in ('A','B')),
  lane1_status text not null check (lane1_status in ('pending','finished','dnf','dns','false_start')),
  lane2_status text not null check (lane2_status in ('pending','finished','dnf','dns','false_start')),
  lane1_total_ms integer, lane1_reaction_ms integer, lane2_total_ms integer, lane2_reaction_ms integer,
  source text not null check (source in ('manual','denford')), source_run_id text,
  note text not null default '' check (char_length(note) <= 1000),
  revision integer not null default 1, updated_at timestamptz not null default now(),
  foreign key (lane1_team,event_id) references teams(id,event_id) on delete cascade,
  foreign key (lane2_team,event_id) references teams(id,event_id) on delete cascade,
  unique(event_id,heat_number), unique(event_id,source_run_id),
  check (lane1_team <> lane2_team),
  check ((source='manual' and source_run_id is null) or (source='denford' and source_run_id is not null and char_length(source_run_id) between 1 and 160)),
  check ((lane1_status='finished' and lane1_total_ms is not null and lane1_reaction_ms is not null and lane1_total_ms between 1 and 999999 and lane1_reaction_ms>=0 and lane1_reaction_ms<lane1_total_ms) or (lane1_status<>'finished' and lane1_total_ms is null and lane1_reaction_ms is null)),
  check ((lane2_status='finished' and lane2_total_ms is not null and lane2_reaction_ms is not null and lane2_total_ms between 1 and 999999 and lane2_reaction_ms>=0 and lane2_reaction_ms<lane2_total_ms) or (lane2_status<>'finished' and lane2_total_ms is null and lane2_reaction_ms is null))
);
alter table race_heats enable row level security;
revoke all on race_heats from public, anon, authenticated;
grant select on race_heats to authenticated;
create policy races_read on race_heats for select to authenticated using (is_member(event_id) and (sees_all_teams(event_id) or event_released(event_id)));
create trigger races_audit after insert or update or delete on race_heats for each row execute function audit_row();

create function save_race(p_event uuid, p_id uuid, p_revision integer, p_input jsonb) returns race_heats
language plpgsql security definer set search_path = public, pg_temp as $$
declare e events; previous race_heats; result race_heats;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode='28000'; end if;
  select * into e from events where id=p_event for update;
  if not found or e.deleted_at is not null or not (is_chair_or_organiser(p_event) or has_role(p_event,'race_official')) then raise exception 'race official required' using errcode='42501'; end if;
  if e.results_released then raise exception 'results released' using errcode='55000'; end if;
  select * into previous from race_heats where event_id=p_event and id=p_id for update;
  if p_revision is null or p_revision <> coalesce(previous.revision,0) then raise exception 'race changed on another device' using errcode='40001'; end if;
  if previous.id is not null and (previous.lane1_status<>'pending' or previous.lane2_status<>'pending') and char_length(btrim(coalesce(p_input->>'note',''))) < 5 then raise exception 'correction reason required' using errcode='22023'; end if;
  insert into race_heats(id,event_id,heat_number,label,phase,lane1_team,lane2_team,lane1_car,lane2_car,lane1_status,lane2_status,lane1_total_ms,lane1_reaction_ms,lane2_total_ms,lane2_reaction_ms,source,source_run_id,note,revision)
  values(p_id,p_event,coalesce(previous.heat_number,(select coalesce(max(heat_number),0)+1 from race_heats where event_id=p_event)),btrim(p_input->>'label'),p_input->>'phase',
    (p_input#>>'{lane1,teamId}')::uuid,(p_input#>>'{lane2,teamId}')::uuid,p_input#>>'{lane1,car}',p_input#>>'{lane2,car}',p_input#>>'{lane1,status}',p_input#>>'{lane2,status}',
    (p_input#>>'{lane1,totalMs}')::integer,(p_input#>>'{lane1,reactionMs}')::integer,(p_input#>>'{lane2,totalMs}')::integer,(p_input#>>'{lane2,reactionMs}')::integer,
    p_input->>'source',p_input->>'sourceRunId',btrim(coalesce(p_input->>'note','')),1)
  on conflict(id) do update set label=excluded.label,phase=excluded.phase,lane1_team=excluded.lane1_team,lane2_team=excluded.lane2_team,
    lane1_car=excluded.lane1_car,lane2_car=excluded.lane2_car,lane1_status=excluded.lane1_status,lane2_status=excluded.lane2_status,
    lane1_total_ms=excluded.lane1_total_ms,lane1_reaction_ms=excluded.lane1_reaction_ms,lane2_total_ms=excluded.lane2_total_ms,lane2_reaction_ms=excluded.lane2_reaction_ms,
    source=excluded.source,source_run_id=excluded.source_run_id,note=excluded.note,revision=race_heats.revision+1,updated_at=clock_timestamp()
    where race_heats.event_id=p_event
  returning * into result;
  if result.id is null then raise exception 'race not available' using errcode='42501'; end if;
  return result;
end $$;
revoke execute on function save_race(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function save_race(uuid,uuid,integer,jsonb) to authenticated;

-- Queued heats may cascade away with a removed team; recorded results must be preserved.
create function protect_racing_team() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists(select 1 from race_heats where (lane1_team=old.id or lane2_team=old.id) and (lane1_status<>'pending' or lane2_status<>'pending')) then
    raise exception 'recorded races prevent team deletion' using errcode='55000';
  end if;
  return old;
end $$;
revoke execute on function protect_racing_team() from public,anon,authenticated;
create trigger teams_racing_guard before delete on teams for each row execute function protect_racing_team();

-- A short-lived device token can only update the event's staging feed, never official results or other tables.
create table race_timing_feed (
  event_id uuid primary key references events on delete cascade,
  connection_id uuid not null default gen_random_uuid(), token_hash bytea not null,
  expires_at timestamptz not null, last_seen_at timestamptz, payload jsonb
);
alter table race_timing_feed enable row level security;
revoke all on race_timing_feed from public,anon,authenticated;

create function pair_race_timing(p_event uuid) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare e events; secret text; feed race_timing_feed;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode='28000'; end if;
  select * into e from events where id=p_event for update;
  if not found or e.deleted_at is not null or not (is_chair_or_organiser(p_event) or has_role(p_event,'race_official')) then raise exception 'race official required' using errcode='42501'; end if;
  if e.results_released then raise exception 'results released' using errcode='55000'; end if;
  secret := gen_random_uuid()::text || gen_random_uuid()::text;
  insert into race_timing_feed(event_id,token_hash,expires_at) values(p_event,sha256(convert_to(secret,'UTF8')),now()+interval '8 hours')
    on conflict(event_id) do update set connection_id=gen_random_uuid(),token_hash=excluded.token_hash,expires_at=excluded.expires_at,last_seen_at=null,payload=null returning * into feed;
  perform audit_write(p_event,'pair','race_timing_feed',feed.connection_id::text,jsonb_build_object('expires_at',feed.expires_at));
  return jsonb_build_object('token',secret,'connectionId',feed.connection_id,'expiresAt',feed.expires_at);
end $$;
create function race_timing_state(p_event uuid) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not is_member(p_event) or not sees_all_teams(p_event) then return null; end if;
  return (select jsonb_build_object('connectionId',connection_id,'expiresAt',expires_at,'lastSeenAt',last_seen_at,'payload',payload) from race_timing_feed where event_id=p_event);
end $$;
create function ingest_denford(p_token text,p_payload jsonb) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare ev uuid;
begin
  if p_token is null or char_length(p_token)<>72 then raise exception 'invalid device token' using errcode='42501'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>8192 or not(p_payload ? 'raceid') then raise exception 'invalid track data' using errcode='22023'; end if;
  update race_timing_feed f set payload=p_payload,last_seen_at=clock_timestamp()
    where token_hash=sha256(convert_to(p_token,'UTF8')) and expires_at>now()
      and exists(select 1 from events e where e.id=f.event_id and e.deleted_at is null and not e.results_released)
    returning event_id into ev;
  if ev is null then raise exception 'device pairing expired or unavailable' using errcode='42501'; end if;
  return true;
end $$;
revoke execute on function pair_race_timing(uuid),race_timing_state(uuid),ingest_denford(text,jsonb) from public,anon,authenticated;
grant execute on function pair_race_timing(uuid),race_timing_state(uuid) to authenticated;
grant execute on function ingest_denford(text,jsonb) to anon,authenticated;
