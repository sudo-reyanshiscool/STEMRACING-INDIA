-- Judge roles can cover an entire panel or a specific team within it.
alter table event_roles drop constraint roles_team;
alter table event_roles add constraint roles_team check (
  (role='team_manager' and team_id is not null) or role='judge'
  or (role not in ('judge','team_manager') and team_id is null)
);
alter table invitations drop constraint inv_team;
alter table invitations add constraint inv_team check (
  (role='team_manager' and team_id is not null) or role='judge'
  or (role not in ('judge','team_manager') and team_id is null)
);

create table judge_exemptions (
 event_id uuid not null references events on delete cascade,
 judge_id uuid not null references auth.users(id) on delete cascade,
 team_id uuid not null,
 reason text not null default '' check(char_length(reason)<=1000),
 primary key(event_id,judge_id,team_id),
 foreign key(team_id,event_id) references teams(id,event_id) on delete cascade
);
revoke all on judge_exemptions from public,anon,authenticated;
grant select on judge_exemptions to authenticated;
alter table judge_exemptions enable row level security;
create policy exemptions_read on judge_exemptions for select to authenticated using (
 event_active(event_id) and (judge_id=auth.uid() or is_chair_or_organiser(event_id))
);
create trigger exemptions_audit after insert or update or delete on judge_exemptions for each row execute function audit_row();

create function judge_can_score(ev uuid,p judging_panel,t uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
 select event_active(ev) and exists(select 1 from event_roles r where r.event_id=ev and r.user_id=auth.uid()
   and r.role='judge' and r.panel=p and (r.team_id is null or r.team_id=t))
   and not exists(select 1 from judge_exemptions x where x.event_id=ev and x.judge_id=auth.uid() and x.team_id=t)
$$;
create function specification_visible(ev uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
 select event_active(ev) and exists(select 1 from event_roles r where r.event_id=ev
   and r.user_id=auth.uid() and r.role<>'team_manager')
$$;

-- Replace one panel's scope atomically, retaining every other panel and non-judge role.
create function set_judge_assignment(p_event uuid,p_user uuid,p_panel judging_panel,p_teams uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare recipient text;
begin
 if auth.uid() is null then raise exception 'sign in first' using errcode='28000'; end if;
 perform 1 from events where id=p_event for update;
 if not is_chair_or_organiser(p_event) then raise exception 'only the Chair or Organiser can assign judges' using errcode='42501'; end if;
 if not exists(select 1 from event_roles where event_id=p_event and user_id=p_user) then
   raise exception 'invite this person to the event first' using errcode='22023'; end if;
 select lower(btrim(email)) into recipient from auth.users where id=p_user and email_confirmed_at is not null;
 if recipient is null then raise exception 'the person must verify their email first' using errcode='22023'; end if;
 if p_panel is null or not exists(select 1 from events e,jsonb_array_elements(e.ruleset->'areas') a
   where e.id=p_event and a->>'kind'='scorecard' and a->>'panel'=p_panel::text) then
   raise exception 'choose a judging panel in this event' using errcode='22023'; end if;
 if p_teams is not null and (cardinality(p_teams)=0 or cardinality(p_teams)>1000
   or exists(select 1 from unnest(p_teams) t where t is null or not exists(select 1 from teams where id=t and event_id=p_event))) then
   raise exception 'choose teams belonging to this event' using errcode='22023'; end if;
 if p_teams is not null and exists(select 1 from judge_conflicts where event_id=p_event and judge_id=p_user and team_id=any(p_teams)) then
   raise exception 'this judge has a declared conflict with a selected team' using errcode='22023'; end if;
 delete from event_roles where event_id=p_event and user_id=p_user and role='judge' and panel=p_panel
   and ((p_teams is null and team_id is not null) or (p_teams is not null and (team_id is null or not(team_id=any(p_teams)))));
 if p_teams is null then
   insert into event_roles(event_id,user_id,role,panel,email) values(p_event,p_user,'judge',p_panel,recipient) on conflict do nothing;
 else
   insert into event_roles(event_id,user_id,role,panel,team_id,email)
     select p_event,p_user,'judge',p_panel,t,recipient from (select distinct unnest(p_teams) as t) selected on conflict do nothing;
 end if;
end $$;
revoke execute on function judge_can_score(uuid,judging_panel,uuid),specification_visible(uuid),set_judge_assignment(uuid,uuid,judging_panel,uuid[]) from public,anon,authenticated;
grant execute on function judge_can_score(uuid,judging_panel,uuid),specification_visible(uuid),set_judge_assignment(uuid,uuid,judging_panel,uuid[]) to authenticated;

drop policy cards_select on scorecards;
create policy cards_select on scorecards for select to authenticated using (
 judge_id=auth.uid() or is_chair_or_organiser(event_id) or leads_panel(event_id,panel)
 or (status='submitted' and (
   (panel='scrutineering' and specification_visible(event_id))
   or (event_released(event_id) and manages_team(event_id,team_id))
 ))
);
drop policy cards_insert on scorecards;
create policy cards_insert on scorecards for insert to authenticated with check (
 judge_id=auth.uid() and status='draft' and judge_can_score(event_id,panel,team_id) and not is_conflicted(event_id,team_id)
);
drop policy cards_update on scorecards;
create policy cards_update on scorecards for update to authenticated
 using(judge_id=auth.uid() and status='draft')
 with check(judge_id=auth.uid() and judge_can_score(event_id,panel,team_id) and not is_conflicted(event_id,team_id));
drop policy cards_delete on scorecards;
create policy cards_delete on scorecards for delete to authenticated using (
 judge_id=auth.uid() and status='draft' and judge_can_score(event_id,panel,team_id) and not is_conflicted(event_id,team_id)
);
drop policy scores_insert on scorecard_scores;
create policy scores_insert on scorecard_scores for insert to authenticated with check (
 exists(select 1 from scorecards c where c.id=scorecard_id and c.judge_id=auth.uid() and c.status='draft'
   and judge_can_score(c.event_id,c.panel,c.team_id) and not is_conflicted(c.event_id,c.team_id))
);
drop policy scores_update on scorecard_scores;
create policy scores_update on scorecard_scores for update to authenticated
 using(exists(select 1 from scorecards c where c.id=scorecard_id and c.judge_id=auth.uid() and c.status='draft'))
 with check(exists(select 1 from scorecards c where c.id=scorecard_id and c.judge_id=auth.uid() and c.status='draft'
   and judge_can_score(c.event_id,c.panel,c.team_id) and not is_conflicted(c.event_id,c.team_id)));
drop policy scores_delete on scorecard_scores;
create policy scores_delete on scorecard_scores for delete to authenticated using (
 exists(select 1 from scorecards c where c.id=scorecard_id and c.judge_id=auth.uid() and c.status='draft'
   and judge_can_score(c.event_id,c.panel,c.team_id) and not is_conflicted(c.event_id,c.team_id))
);

create or replace function save_card_review(p_card uuid, p_review jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c scorecards; a jsonb; k text; v jsonb; awards text[];
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '28000'; end if;
  select * into c from scorecards where id = p_card for update;
  if not found or c.judge_id <> auth.uid() or not judge_can_score(c.event_id, c.panel, c.team_id) or is_conflicted(c.event_id, c.team_id) then
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

-- Exemptions are event-wide, across every panel. Submitted evidence must be reopened explicitly first.
create function set_judge_exemption(p_event uuid,p_user uuid,p_team uuid,p_exempt boolean,p_reason text default '') returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if auth.uid() is null then raise exception 'sign in first' using errcode='28000'; end if;
 perform 1 from events where id=p_event for update;
 if not is_chair_or_organiser(p_event) then raise exception 'only the Chair or Organiser can exempt judges' using errcode='42501'; end if;
 if p_exempt is null or char_length(coalesce(p_reason,''))>1000
   or not exists(select 1 from event_roles where event_id=p_event and user_id=p_user)
   or not exists(select 1 from teams where event_id=p_event and id=p_team) then
   raise exception 'choose an event member and team' using errcode='22023'; end if;
 if p_exempt then
   if exists(select 1 from scorecards where event_id=p_event and judge_id=p_user and team_id=p_team and status='submitted') then
     raise exception 'the Chair must reopen submitted scorecards for this team before exempting the judge' using errcode='55000'; end if;
   insert into judge_exemptions(event_id,judge_id,team_id,reason) values(p_event,p_user,p_team,btrim(coalesce(p_reason,'')))
     on conflict(event_id,judge_id,team_id) do update set reason=excluded.reason;
 else
   delete from judge_exemptions where event_id=p_event and judge_id=p_user and team_id=p_team;
 end if;
end $$;
revoke execute on function set_judge_exemption(uuid,uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function set_judge_exemption(uuid,uuid,uuid,boolean,text) to authenticated;
