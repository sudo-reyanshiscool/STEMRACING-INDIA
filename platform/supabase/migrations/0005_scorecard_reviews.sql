-- Team feedback and private judging notes use separate tables: RLS must enforce the distinction.
create table scorecard_feedback (
  scorecard_id uuid primary key references scorecards on delete cascade,
  overall text not null default '' check (char_length(overall) <= 4000),
  strengths text not null default '' check (char_length(strengths) <= 4000),
  improvements text not null default '' check (char_length(improvements) <= 4000)
);
create table scorecard_private_reviews (
  scorecard_id uuid primary key references scorecards on delete cascade,
  criterion_notes jsonb not null default '{}' check (jsonb_typeof(criterion_notes) = 'object'),
  internal_notes text not null default '' check (char_length(internal_notes) <= 4000),
  nominations text[] not null default '{}'
);
revoke all on scorecard_feedback, scorecard_private_reviews from public, anon, authenticated;
grant select on scorecard_feedback, scorecard_private_reviews to authenticated;
alter table scorecard_feedback enable row level security;
alter table scorecard_private_reviews enable row level security;
create policy feedback_read on scorecard_feedback for select to authenticated
  using (exists (select 1 from scorecards c where c.id = scorecard_id));
-- Organisers, team managers and unrelated judges do not receive private notes, even after release.
create policy private_review_read on scorecard_private_reviews for select to authenticated
  using (exists (select 1 from scorecards c where c.id = scorecard_id and
    (c.judge_id = auth.uid() or has_role(c.event_id, 'chair') or leads_panel(c.event_id, c.panel))));

-- Both halves of a review are saved atomically. Clients have no direct table write privileges.
create function save_card_review(p_card uuid, p_review jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c scorecards; a jsonb; k text; v jsonb; awards text[];
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '28000'; end if;
  select * into c from scorecards where id = p_card for update;
  if not found or c.judge_id <> auth.uid() or not judges_panel(c.event_id, c.panel) or is_conflicted(c.event_id, c.team_id) then
    raise exception 'you cannot edit this scorecard' using errcode = '42501';
  end if;
  if c.status <> 'draft' or event_released_locked(c.event_id) then
    raise exception 'scorecard is locked' using errcode = '55000';
  end if;
  if p_review is null or jsonb_typeof(p_review) <> 'object' then
    raise exception 'invalid review' using errcode = '22023';
  end if;
  foreach k in array array['overall', 'strengths', 'improvements', 'internalNotes'] loop
    if jsonb_typeof(p_review -> k) is distinct from 'string' or char_length(p_review ->> k) > 4000 then
      raise exception 'invalid feedback text' using errcode = '22023';
    end if;
  end loop;
  if jsonb_typeof(p_review -> 'criterionNotes') is distinct from 'object' or jsonb_typeof(p_review -> 'nominations') is distinct from 'array' then
    raise exception 'invalid notes or nominations' using errcode = '22023';
  end if;
  a := area_def(c.event_id, c.area_id);
  for k, v in select key, value from jsonb_each(p_review -> 'criterionNotes') loop
    if jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 1000
      or not exists (select 1 from jsonb_array_elements(a -> 'criteria') t where t ->> 'id' = k) then
      raise exception 'invalid criterion note' using errcode = '22023';
    end if;
  end loop;
  if jsonb_array_length(p_review -> 'nominations') > 6 or exists (
    select 1 from jsonb_array_elements(p_review -> 'nominations') t where jsonb_typeof(t) <> 'string'
  ) then raise exception 'invalid nominations' using errcode = '22023'; end if;
  select coalesce(array_agg(x), '{}') into awards from jsonb_array_elements_text(p_review -> 'nominations') x;
  if not (awards <@ array['verbal-presentation', 'team-identity', 'sustainability', 'innovative-thinking', 'women-in-motorsport', 'chair-recognition'])
    or cardinality(awards) <> (select count(distinct x) from unnest(awards) x) then
    raise exception 'unknown or repeated award' using errcode = '22023';
  end if;
  insert into scorecard_feedback values (p_card, p_review ->> 'overall', p_review ->> 'strengths', p_review ->> 'improvements')
    on conflict (scorecard_id) do update set overall = excluded.overall, strengths = excluded.strengths, improvements = excluded.improvements;
  insert into scorecard_private_reviews values (p_card, p_review -> 'criterionNotes', p_review ->> 'internalNotes', awards)
    on conflict (scorecard_id) do update set criterion_notes = excluded.criterion_notes, internal_notes = excluded.internal_notes, nominations = excluded.nominations;
end $$;
revoke execute on function save_card_review(uuid, jsonb) from public, anon, authenticated;
grant execute on function save_card_review(uuid, jsonb) to authenticated;
