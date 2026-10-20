-- Event staff may contribute their own scorecards without a separate judge invitation.
-- Existing card ownership, conflict, exemption and release locks continue to apply.
create or replace function judge_can_score(ev uuid,p judging_panel,t uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
 select event_active(ev) and (
  is_chair_or_organiser(ev)
  or exists(select 1 from event_roles r where r.event_id=ev and r.user_id=auth.uid()
   and r.role='judge' and r.panel=p and (r.team_id is null or r.team_id=t))
 ) and not exists(select 1 from judge_exemptions x where x.event_id=ev and x.judge_id=auth.uid() and x.team_id=t)
$$;
drop policy conflicts_insert on judge_conflicts;
create policy conflicts_insert on judge_conflicts for insert to authenticated with check (
 judge_id=auth.uid() and event_active(event_id)
 and (is_chair_or_organiser(event_id) or judges_panel_any(event_id) or leads_panel_any(event_id))
);
revoke execute on function judge_can_score(uuid,judging_panel,uuid) from public,anon,authenticated;
grant execute on function judge_can_score(uuid,judging_panel,uuid) to authenticated;
