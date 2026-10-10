-- Final review fixes. Applied after 0001 to 0003, which stay untouched.
-- Rules as before: every function is SECURITY DEFINER with a pinned search_path, and executable only by whom it names.

-- A conflict of interest must be declared before judging, not after: once a judge has submitted a card for a team,
-- the card already counts, so declaring afterwards would only hide the problem from the Chair. Declaring is refused
-- (locked) then, and while results are released.
create function conflicts_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Only the judge's own declaration is judged here; anyone naming someone else falls through to the policies (denied).
  if new.judge_id is not distinct from auth.uid() then
    if event_released(new.event_id) then
      raise exception 'results are released; a conflict can no longer be declared' using errcode = '55000';
    end if;
    if exists (select 1 from scorecards where event_id = new.event_id and team_id = new.team_id and judge_id = new.judge_id and status = 'submitted') then
      raise exception 'you have already submitted a scorecard for this team; ask the Chair' using errcode = '55000';
    end if;
  end if;
  return new;
end $$;
create trigger conflicts_guard before insert on judge_conflicts for each row execute function conflicts_guard();
revoke execute on function conflicts_guard() from public, anon, authenticated;

-- Releasing is a server-side decision. The event row is locked (FOR UPDATE) while the Chair's release checks the
-- latest snapshot against everything counted; judge, override and penalty writes take the same row FOR SHARE, so a
-- write either lands before the release (and makes the snapshot out of date) or waits and is then refused as frozen.
-- event_released() stays stable for the policies; the guards use this volatile variant, which can lock.
create function event_released_locked(ev uuid) returns boolean language sql volatile security definer set search_path = public, pg_temp as
$$ select coalesce((select results_released from events where id = ev for share), false) $$;
revoke execute on function event_released_locked(uuid) from public, anon, authenticated;

-- The guards below are the 0002 and 0003 bodies unchanged except that they ask event_released_locked().
create or replace function scorecards_fill() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare a jsonb;
begin
  a := area_def(new.event_id, new.area_id);
  if a is null or a ->> 'kind' <> 'scorecard' then
    raise exception 'unknown scorecard area %', new.area_id using errcode = '22023';
  end if;
  if not exists (select 1 from teams where id = new.team_id and event_id = new.event_id) then
    raise exception 'team does not belong to this event' using errcode = '22023';
  end if;
  if event_released_locked(new.event_id) then
    raise exception 'results are released; judging is closed' using errcode = '55000';
  end if;
  new.panel := (a ->> 'panel')::judging_panel;
  new.judge_id := coalesce(new.judge_id, auth.uid());
  -- Lifecycle fields are never taken from the client.
  new.reopened_count := 0;
  new.submitted_at := null;
  return new;
end $$;

create or replace function scorecards_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare a jsonb; c record;
begin
  if event_released_locked(old.event_id) then
    raise exception 'results are released; judging is closed' using errcode = '55000';
  end if;
  if (new.id, new.event_id, new.team_id, new.area_id, new.judge_id, new.panel, new.created_at)
     is distinct from (old.id, old.event_id, old.team_id, old.area_id, old.judge_id, old.panel, old.created_at) then
    raise exception 'scorecard identity cannot change' using errcode = '55000';
  end if;
  -- Lifecycle fields change only through the transitions below.
  new.reopened_count := old.reopened_count;
  new.submitted_at := old.submitted_at;
  if old.status = 'draft' and new.status = 'submitted' then
    a := area_def(new.event_id, new.area_id);
    for c in select t.value from jsonb_array_elements(a -> 'criteria') as t loop
      if not exists (select 1 from scorecard_scores s where s.scorecard_id = new.id and s.criterion_id = c.value ->> 'id') then
        raise exception 'criterion % has no score', c.value ->> 'name' using errcode = '23514';
      end if;
    end loop;
    new.submitted_at := now();
  elsif old.status = 'submitted' and new.status = 'draft' then
    -- Only reopen_scorecard() sets this, for this one card, inside its own transaction.
    if coalesce(current_setting('app.reopen', true), '') <> new.id::text then
      raise exception 'only the Chair can reopen a submitted scorecard' using errcode = '55000';
    end if;
    new.reopened_count := old.reopened_count + 1;
    new.submitted_at := null;
  elsif old.status = 'submitted' then
    raise exception 'scorecard is submitted and locked' using errcode = '55000';
  end if;
  return new;
end $$;

create or replace function scorecards_delete_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status = 'submitted' then
    raise exception 'a submitted scorecard cannot be deleted; reopen it first' using errcode = '55000';
  end if;
  if event_released_locked(old.event_id) then
    raise exception 'results are released; judging is closed' using errcode = '55000';
  end if;
  return old;
end $$;

create or replace function scores_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare card record; a jsonb; crit jsonb;
begin
  if tg_op = 'UPDATE' and (new.scorecard_id, new.criterion_id) is distinct from (old.scorecard_id, old.criterion_id) then
    raise exception 'score identity cannot change' using errcode = '55000';
  end if;
  -- FOR SHARE conflicts with the FOR NO KEY UPDATE lock that UPDATE scorecards (the submit) takes on the card row
  -- before its guard runs. A score write and a submit therefore serialise: whichever commits second re-reads
  -- the other's result (READ COMMITTED), so a score cannot slip in after the completeness check.
  select * into card from scorecards where id = new.scorecard_id for share;
  if not found then raise exception 'scorecard not found' using errcode = '22023'; end if;
  if event_released_locked(card.event_id) then raise exception 'results are released; judging is closed' using errcode = '55000'; end if;
  if card.status <> 'draft' then raise exception 'scorecard is submitted and locked' using errcode = '55000'; end if;
  a := area_def(card.event_id, card.area_id);
  select t.value into crit from jsonb_array_elements(a -> 'criteria') as t where t.value ->> 'id' = new.criterion_id;
  if crit is null then raise exception 'unknown criterion %', new.criterion_id using errcode = '22023'; end if;
  if new.score < 0 or new.score > (crit ->> 'max')::int then
    raise exception 'score % is outside 0..%', new.score, crit ->> 'max' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function scores_delete_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare card record;
begin
  select * into card from scorecards where id = old.scorecard_id for share;
  if not found then return old; end if;
  if card.status <> 'draft' then raise exception 'scorecard is submitted and locked' using errcode = '55000'; end if;
  if event_released_locked(card.event_id) then raise exception 'results are released; judging is closed' using errcode = '55000'; end if;
  return old;
end $$;

create or replace function overrides_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare a jsonb;
begin
  if tg_op = 'DELETE' then
    if event_released_locked(old.event_id) then
      raise exception 'results are released; withdraw the release before changing overrides' using errcode = '55000';
    end if;
    return old;
  end if;
  if event_released_locked(new.event_id) or (tg_op = 'UPDATE' and event_released_locked(old.event_id)) then
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

create or replace function penalties_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'a penalty is not edited; remove it and record it again' using errcode = '55000';
  end if;
  if event_released_locked(case when tg_op = 'DELETE' then old.event_id else new.event_id end) then
    raise exception 'results are released; withdraw the release before changing penalties' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.decided_by := auth.uid();
  new.created_at := now();
  return new;
end $$;


-- No API role sets results_released directly any more: release_results() and withdraw_results() do, as the Chair.
revoke update on events from authenticated;
grant update (name, starts_on) on events to authenticated;

create function release_results(p_event uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
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
    union all select s.inputs -> 'penalties', (select count(*) from penalties where event_id = p_event)
    union all select s.inputs -> 'teams', (select count(*) from teams where event_id = p_event)
  loop
    if jsonb_typeof(arr) = 'array' and jsonb_array_length(arr) <> n then
      raise exception 'the published ranking is out of date; publish it again before releasing' using errcode = '55000';
    end if;
  end loop;

  update events set results_released = true where id = p_event;
end $$;
revoke execute on function release_results(uuid) from public, anon;
grant execute on function release_results(uuid) to authenticated;

create function withdraw_results(p_event uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not has_role(p_event, 'chair') then
    raise exception 'only the Chair can withdraw released results' using errcode = '42501';
  end if;
  perform 1 from events where id = p_event for update;
  update events set results_released = false where id = p_event and results_released;
end $$;
revoke execute on function withdraw_results(uuid) from public, anon;
grant execute on function withdraw_results(uuid) to authenticated;

-- A snapshot is the published record of a ranking, and only a released-capable one can exist: `released` stays as a
-- column for the read policy, but false is refused, so there is no way to publish something "hidden".
create or replace function snapshots_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.ruleset_id is distinct from (select ruleset ->> 'id' from events where id = new.event_id) then
    raise exception 'snapshot ruleset does not match the ruleset pinned to the event' using errcode = '22023';
  end if;
  if new.released is distinct from true then
    raise exception 'a ranking snapshot is always released-capable; released cannot be false' using errcode = '23514';
  end if;
  new.created_by := auth.uid();
  new.created_at := now();
  return new;
end $$;
