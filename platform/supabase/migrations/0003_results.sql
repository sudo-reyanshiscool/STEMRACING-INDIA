-- Results: Chair overrides, protest penalties, immutable ranking snapshots, public read access.

create table score_overrides (
  event_id uuid not null references events on delete cascade,
  team_id uuid not null,
  area_id text not null,
  value numeric(5, 1) not null check (value >= 0),
  reason text not null check (char_length(btrim(reason)) >= 3),
  set_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (event_id, team_id, area_id),
  -- The team must belong to the event the override is filed under.
  constraint overrides_team_event foreign key (team_id, event_id) references teams (id, event_id) on delete cascade
);

-- Overrides and penalties are frozen while results are released, like scorecards: the Chair withdraws the release first.
create function overrides_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare a jsonb;
begin
  if tg_op = 'DELETE' then
    if event_released(old.event_id) then
      raise exception 'results are released; withdraw the release before changing overrides' using errcode = '55000';
    end if;
    return old;
  end if;
  if event_released(new.event_id) or (tg_op = 'UPDATE' and event_released(old.event_id)) then
    raise exception 'results are released; withdraw the release before changing overrides' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' and (new.event_id, new.team_id, new.area_id) is distinct from (old.event_id, old.team_id, old.area_id) then
    raise exception 'override identity cannot change' using errcode = '55000';
  end if;
  a := area_def(new.event_id, new.area_id);
  if a is null or a ->> 'kind' <> 'scorecard' then
    raise exception 'overrides apply to scorecard areas only' using errcode = '22023';
  end if;
  if new.value > (a ->> 'max')::numeric then
    raise exception 'override % exceeds the area maximum %', new.value, a ->> 'max' using errcode = '23514';
  end if;
  new.set_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
create trigger overrides_guard before insert or update or delete on score_overrides for each row execute function overrides_guard();
create trigger overrides_audit after insert or update or delete on score_overrides for each row execute function audit_row();

create table penalties (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events on delete cascade,
  team_id uuid not null,
  points numeric(5, 1) not null check (points > 0 and points <= 100),
  reason text not null check (char_length(btrim(reason)) >= 3),
  decided_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint penalties_team_event foreign key (team_id, event_id) references teams (id, event_id) on delete cascade
);

create function penalties_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'a penalty is not edited; remove it and record it again' using errcode = '55000';
  end if;
  if event_released(case when tg_op = 'DELETE' then old.event_id else new.event_id end) then
    raise exception 'results are released; withdraw the release before changing penalties' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.decided_by := auth.uid();
  new.created_at := now();
  return new;
end $$;
create trigger penalties_guard before insert or update or delete on penalties for each row execute function penalties_guard();
create trigger penalties_audit after insert or delete on penalties for each row execute function audit_row();

create table ranking_snapshots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events on delete cascade,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  ruleset_id text not null,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  inputs jsonb not null check (jsonb_typeof(inputs) = 'object'),
  rows jsonb not null check (jsonb_typeof(rows) = 'array'),
  released boolean not null default true
);

create function snapshots_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.ruleset_id is distinct from (select ruleset ->> 'id' from events where id = new.event_id) then
    raise exception 'snapshot ruleset does not match the ruleset pinned to the event' using errcode = '22023';
  end if;
  new.created_by := auth.uid();
  new.created_at := now();
  return new;
end $$;
create trigger snapshots_guard before insert on ranking_snapshots for each row execute function snapshots_guard();

-- A snapshot is the published record of a ranking: nobody edits or removes it, whatever their privileges.
create function snapshots_immutable() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'ranking snapshots are immutable' using errcode = '55000';
end $$;
create trigger snapshots_immutable before update or delete on ranking_snapshots for each row execute function snapshots_immutable();
create trigger snapshots_immutable_truncate before truncate on ranking_snapshots for each statement execute function snapshots_immutable();
create trigger snapshots_audit after insert on ranking_snapshots for each row execute function audit_row();

-- Privileges. Start from nothing, then grant only what the policies below use.
-- Table-level extras (TRUNCATE skips row-level security and triggers) and sequence writes (setval could poison
-- audit_log ids) are not something the API roles ever need, on any table.
revoke truncate, references, trigger on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

revoke all on score_overrides, penalties, ranking_snapshots from public, anon, authenticated;
grant select, insert, delete on score_overrides to authenticated;
grant update (value, reason) on score_overrides to authenticated;
grant select, insert, delete on penalties to authenticated;
grant select, insert on ranking_snapshots to authenticated;
-- The public reads released events, teams and ranking snapshots, and nothing else.
revoke all on all tables in schema public from anon;
grant select on events, teams, ranking_snapshots to anon;

revoke execute on function overrides_guard(), penalties_guard(), snapshots_guard(), snapshots_immutable() from public, anon, authenticated;

alter table score_overrides enable row level security;
alter table penalties enable row level security;
alter table ranking_snapshots enable row level security;

create policy overrides_select on score_overrides for select to authenticated using (is_chair_or_organiser(event_id));
create policy overrides_insert on score_overrides for insert to authenticated with check (has_role(event_id, 'chair'));
create policy overrides_update on score_overrides for update to authenticated using (has_role(event_id, 'chair')) with check (has_role(event_id, 'chair'));
create policy overrides_delete on score_overrides for delete to authenticated using (has_role(event_id, 'chair'));

create policy penalties_select on penalties for select to authenticated
  using (is_chair_or_organiser(event_id) or (event_released(event_id) and manages_team(event_id, team_id)));
create policy penalties_insert on penalties for insert to authenticated with check (has_role(event_id, 'chair'));
create policy penalties_delete on penalties for delete to authenticated using (has_role(event_id, 'chair'));

create policy snapshots_select on ranking_snapshots for select to anon, authenticated
  using (is_chair_or_organiser(event_id) or (released and event_released(event_id)));
create policy snapshots_insert on ranking_snapshots for insert to authenticated
  with check (has_role(event_id, 'chair') and created_by = auth.uid());
