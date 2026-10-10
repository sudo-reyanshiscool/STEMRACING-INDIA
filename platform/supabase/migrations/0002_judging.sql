-- Judging: conflicts of interest, scorecards, scores, locking and reopening.

create type card_status as enum ('draft', 'submitted');

create function judges_panel_any(ev uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select exists (select 1 from event_roles where event_id = ev and user_id = auth.uid() and role = 'judge') $$;
create function leads_panel_any(ev uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select exists (select 1 from event_roles where event_id = ev and user_id = auth.uid() and role = 'lead_judge') $$;

create table judge_conflicts (
  event_id uuid not null references events on delete cascade,
  judge_id uuid not null default auth.uid(),
  team_id uuid not null,
  declared_at timestamptz not null default now(),
  primary key (event_id, judge_id, team_id),
  constraint conflicts_team_event foreign key (team_id, event_id) references teams (id, event_id) on delete cascade
);

create table scorecards (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events on delete cascade,
  team_id uuid not null,
  area_id text not null,
  panel judging_panel not null,
  judge_id uuid not null default auth.uid(),
  status card_status not null default 'draft',
  reopened_count int not null default 0,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, team_id, area_id, judge_id),
  constraint cards_team_event foreign key (team_id, event_id) references teams (id, event_id) on delete cascade
);

create table scorecard_scores (
  scorecard_id uuid not null references scorecards on delete cascade,
  criterion_id text not null,
  score int not null check (score >= 0),
  comment text not null default '' check (char_length(comment) <= 1000),
  updated_at timestamptz not null default now(),
  primary key (scorecard_id, criterion_id)
);

-- The area definition (with its criteria) from the event's pinned ruleset, or null.
create function area_def(ev uuid, area text) returns jsonb language sql stable security definer set search_path = public, pg_temp as
$$ select a from events e, jsonb_array_elements(e.ruleset -> 'areas') as a where e.id = ev and a ->> 'id' = area limit 1 $$;

create function is_conflicted(ev uuid, t uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select exists (select 1 from judge_conflicts where event_id = ev and judge_id = auth.uid() and team_id = t) $$;

create function scorecards_fill() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare a jsonb;
begin
  a := area_def(new.event_id, new.area_id);
  if a is null or a ->> 'kind' <> 'scorecard' then
    raise exception 'unknown scorecard area %', new.area_id using errcode = '22023';
  end if;
  if not exists (select 1 from teams where id = new.team_id and event_id = new.event_id) then
    raise exception 'team does not belong to this event' using errcode = '22023';
  end if;
  new.panel := (a ->> 'panel')::judging_panel;
  new.judge_id := coalesce(new.judge_id, auth.uid());
  -- Lifecycle fields are never taken from the client.
  new.reopened_count := 0;
  new.submitted_at := null;
  return new;
end $$;
create trigger scorecards_fill before insert on scorecards for each row execute function scorecards_fill();

create function scorecards_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare a jsonb; c record;
begin
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
create trigger scorecards_guard before update on scorecards for each row execute function scorecards_guard();

-- Submitted cards are evidence: they cannot be deleted by anyone, nor by a cascade from a team.
create function scorecards_delete_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status = 'submitted' then
    raise exception 'a submitted scorecard cannot be deleted; reopen it first' using errcode = '55000';
  end if;
  return old;
end $$;
create trigger scorecards_delete_guard before delete on scorecards for each row execute function scorecards_delete_guard();

create function scores_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare card record; a jsonb; crit jsonb;
begin
  if tg_op = 'UPDATE' and (new.scorecard_id, new.criterion_id) is distinct from (old.scorecard_id, old.criterion_id) then
    raise exception 'score identity cannot change' using errcode = '55000';
  end if;
  select * into card from scorecards where id = new.scorecard_id;
  if not found then raise exception 'scorecard not found' using errcode = '22023'; end if;
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
create trigger scores_guard before insert or update on scorecard_scores for each row execute function scores_guard();

create function reopen_scorecard(p_card uuid, p_reason text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c scorecards;
begin
  select * into c from scorecards where id = p_card;
  if not found then raise exception 'scorecard not found' using errcode = 'P0002'; end if;
  if not has_role(c.event_id, 'chair') then raise exception 'only the Chair can reopen a scorecard' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required to reopen a scorecard' using errcode = '22023'; end if;
  if c.status <> 'submitted' then raise exception 'scorecard is not submitted' using errcode = '55000'; end if;
  perform set_config('app.reopen', p_card::text, true);
  update scorecards set status = 'draft' where id = p_card and status = 'submitted';
  perform set_config('app.reopen', '', true);
  perform audit_write(c.event_id, 'reopen', 'scorecards', p_card::text, jsonb_build_object('reason', p_reason, 'judge', c.judge_id));
end $$;

create trigger scorecards_audit after update of status on scorecards for each row
  when (old.status is distinct from new.status) execute function audit_row();
create trigger conflicts_audit after insert or delete on judge_conflicts for each row execute function audit_row();

-- Privileges. Start from nothing, then grant only what the policies below use.
revoke all on judge_conflicts, scorecards, scorecard_scores from public, anon, authenticated;
grant select, insert, delete on judge_conflicts to authenticated;
grant select, insert, update, delete on scorecards to authenticated;
grant select, insert, delete on scorecard_scores to authenticated;
grant update (score, comment) on scorecard_scores to authenticated;

-- Internals and trigger functions are not callable by clients. Audit rows are written only through audit_write().
revoke execute on function area_def(uuid, text), scorecards_fill(), scorecards_guard(), scorecards_delete_guard(), scores_guard()
  from public, anon, authenticated;
-- Policy helpers run as the signed-in user; the policies below are all `to authenticated`.
revoke execute on function judges_panel_any(uuid), leads_panel_any(uuid), is_conflicted(uuid, uuid) from public, anon;
grant execute on function judges_panel_any(uuid), leads_panel_any(uuid), is_conflicted(uuid, uuid) to authenticated;
-- RPC: signed-in users only.
revoke execute on function reopen_scorecard(uuid, text) from public, anon;
grant execute on function reopen_scorecard(uuid, text) to authenticated;

alter table judge_conflicts enable row level security;
alter table scorecards enable row level security;
alter table scorecard_scores enable row level security;

create policy conflicts_select on judge_conflicts for select to authenticated using (judge_id = auth.uid() or is_chair_or_organiser(event_id));
create policy conflicts_insert on judge_conflicts for insert to authenticated
  with check (judge_id = auth.uid() and (judges_panel_any(event_id) or leads_panel_any(event_id)));
create policy conflicts_delete on judge_conflicts for delete to authenticated using (is_chair_or_organiser(event_id));

create policy cards_select on scorecards for select to authenticated using (
  judge_id = auth.uid()
  or is_chair_or_organiser(event_id)
  or leads_panel(event_id, panel)
  or (event_released(event_id) and manages_team(event_id, team_id))
);
create policy cards_insert on scorecards for insert to authenticated
  with check (judge_id = auth.uid() and status = 'draft' and judges_panel(event_id, panel) and not is_conflicted(event_id, team_id));
create policy cards_update on scorecards for update to authenticated
  using (judge_id = auth.uid() and status = 'draft')
  with check (judge_id = auth.uid() and judges_panel(event_id, panel) and not is_conflicted(event_id, team_id));
create policy cards_delete on scorecards for delete to authenticated using (judge_id = auth.uid() and status = 'draft');

create policy scores_select on scorecard_scores for select to authenticated
  using (exists (select 1 from scorecards c where c.id = scorecard_id));
create policy scores_insert on scorecard_scores for insert to authenticated
  with check (exists (select 1 from scorecards c where c.id = scorecard_id and c.judge_id = auth.uid() and c.status = 'draft'
    and not is_conflicted(c.event_id, c.team_id)));
create policy scores_update on scorecard_scores for update to authenticated
  using (exists (select 1 from scorecards c where c.id = scorecard_id and c.judge_id = auth.uid() and c.status = 'draft'))
  with check (exists (select 1 from scorecards c where c.id = scorecard_id and c.judge_id = auth.uid() and c.status = 'draft'
    and not is_conflicted(c.event_id, c.team_id)));
create policy scores_delete on scorecard_scores for delete to authenticated
  using (exists (select 1 from scorecards c where c.id = scorecard_id and c.judge_id = auth.uid() and c.status = 'draft'));
