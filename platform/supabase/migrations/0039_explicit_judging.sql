-- Event staff may contribute their own scorecards without a separate judge invitation.
-- Existing card ownership, conflict, exemption and release locks continue to apply.
create or replace function judge_can_score(ev uuid,p judging_panel,t uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
 select event_active(ev) and (
  is_chair_or_organiser(ev)
  or exists(select 1 from event_roles r where r.event_id=ev and r.user_id=auth.uid()
   and r.role='judge' and r.panel=p and r.team_id=t)
 ) and not exists(select 1 from judge_exemptions x where x.event_id=ev and x.judge_id=auth.uid() and x.team_id=t)
$$;

create or replace function set_judge_assignment(p_event uuid,p_user uuid,p_panel judging_panel,p_teams uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare recipient text; recipient_name text;
begin
 if auth.uid() is null then raise exception 'sign in first' using errcode='28000'; end if;
 perform 1 from events where id=p_event for update;
 if not is_chair_or_organiser(p_event) then raise exception 'only the Chair or Organiser can assign judges' using errcode='42501'; end if;
 if not exists(select 1 from event_roles where event_id=p_event and user_id=p_user) then
   raise exception 'invite this person to the event first' using errcode='22023'; end if;
 select lower(btrim(email)) into recipient from auth.users where id=p_user and email_confirmed_at is not null;
 select display_name into recipient_name from event_roles where event_id=p_event and user_id=p_user order by (display_name<>'') desc,id limit 1;
 if recipient is null then raise exception 'the person must verify their email first' using errcode='22023'; end if;
 if p_panel is null or not exists(select 1 from events e,jsonb_array_elements(e.ruleset->'areas') a
   where e.id=p_event and a->>'kind'='scorecard' and a->>'panel'=p_panel::text) then
   raise exception 'choose a judging panel in this event' using errcode='22023'; end if;
 if p_teams is null then select array_agg(id order by id) into p_teams from teams where event_id=p_event; if p_teams is null then raise exception 'add teams before assigning judges' using errcode='22023'; end if; end if;
 if p_teams is not null and (cardinality(p_teams)=0 or cardinality(p_teams)>1000
   or exists(select 1 from unnest(p_teams) t where t is null or not exists(select 1 from teams where id=t and event_id=p_event))) then
   raise exception 'choose teams belonging to this event' using errcode='22023'; end if;
 if p_teams is not null and exists(select 1 from judge_conflicts where event_id=p_event and judge_id=p_user and team_id=any(p_teams)) then
   raise exception 'this judge has a declared conflict with a selected team' using errcode='22023'; end if;
 delete from event_roles where event_id=p_event and user_id=p_user and role='judge' and panel=p_panel
   and (team_id is null or not(team_id=any(p_teams)));
 insert into event_roles(event_id,user_id,role,panel,team_id,email,display_name)
   select p_event,p_user,'judge',p_panel,t,recipient,recipient_name from (select distinct unnest(p_teams) as t) selected on conflict do nothing;
end $$;
create or replace function reopen_scorecard(p_card uuid, p_reason text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare c scorecards;
begin
  select * into c from scorecards where id = p_card for update;
  if not found then raise exception 'scorecard not found' using errcode = 'P0002'; end if;
  if platform_spectator() or not (has_role(c.event_id, 'chair') or leads_panel(c.event_id,c.panel)) then raise exception 'only the Chair or panel Lead Judge can reopen a scorecard' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'a reason is required to reopen a scorecard' using errcode = '22023'; end if;
  if event_released(c.event_id) then raise exception 'results are released; withdraw the release before reopening' using errcode = '55000'; end if;
  if c.status <> 'submitted' then raise exception 'scorecard is not submitted' using errcode = '55000'; end if;
  perform set_config('app.reopen', p_card::text, true);
  update scorecards set status = 'draft' where id = p_card and status = 'submitted';
  perform set_config('app.reopen', '', true);
  perform audit_write(c.event_id, 'reopen', 'scorecards', p_card::text, jsonb_build_object('reason', p_reason, 'judge', c.judge_id));
end $$;
-- Technical inspection writes follow the same explicit scope for judges, including edits after reassignment.
create function assigned_inspector(ev uuid,t uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
 select event_active(ev) and not platform_spectator() and (is_chair_or_organiser(ev) or exists(select 1 from event_roles r where r.event_id=ev and r.user_id=auth.uid() and r.role='scrutineer' and (r.team_id is null or r.team_id=t)) or (judge_can_score(ev,'scrutineering',t) and not is_conflicted(ev,t)))
$$;
create function inspection_assignment_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if tg_op='UPDATE' and (new.event_id is distinct from old.event_id or new.team_id is distinct from old.team_id or new.car is distinct from old.car or new.inspector_id is distinct from old.inspector_id) then raise exception 'an inspection cannot be moved to another team or inspector' using errcode='42501'; end if;
 if auth.uid() is not null and not assigned_inspector(new.event_id,new.team_id) then raise exception 'this team is not assigned to you for scrutineering' using errcode='42501'; end if;
 return new;
end $$;
create trigger inspection_assignment before insert or update on technical_inspections for each row execute function inspection_assignment_guard();
revoke execute on function assigned_inspector(uuid,uuid),inspection_assignment_guard() from public,anon,authenticated;
