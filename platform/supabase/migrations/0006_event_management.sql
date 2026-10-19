-- Deleted events are retained, including the audit log and submitted evidence, and can be restored by an organiser.
alter table events add column deleted_at timestamptz;
create function event_active(ev uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select exists (select 1 from events where id = ev and deleted_at is null) $$;
grant execute on function event_active(uuid) to anon, authenticated;

-- All event-scoped privileges stop while the event is deleted. Restore uses a separate, explicit organiser check.
create or replace function is_member(ev uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select event_active(ev) and exists (select 1 from event_roles where event_id = ev and user_id = auth.uid()) $$;
create or replace function has_role(ev uuid, r app_role) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select event_active(ev) and exists (select 1 from event_roles where event_id = ev and user_id = auth.uid() and role = r) $$;
create or replace function is_chair_or_organiser(ev uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select has_role(ev, 'chair') or has_role(ev, 'organiser') $$;
create or replace function judges_panel(ev uuid, p judging_panel) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select event_active(ev) and exists (select 1 from event_roles where event_id = ev and user_id = auth.uid() and role = 'judge' and panel = p) $$;
create or replace function leads_panel(ev uuid, p judging_panel) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select event_active(ev) and exists (select 1 from event_roles where event_id = ev and user_id = auth.uid() and role = 'lead_judge' and panel = p) $$;
create or replace function judges_panel_any(ev uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select event_active(ev) and exists (select 1 from event_roles where event_id = ev and user_id = auth.uid() and role = 'judge') $$;
create or replace function leads_panel_any(ev uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select event_active(ev) and exists (select 1 from event_roles where event_id = ev and user_id = auth.uid() and role = 'lead_judge') $$;
create or replace function manages_team(ev uuid, t uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select event_active(ev) and exists (select 1 from event_roles where event_id = ev and user_id = auth.uid() and role = 'team_manager' and team_id = t) $$;
create or replace function sees_all_teams(ev uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select event_active(ev) and exists (select 1 from event_roles where event_id = ev and user_id = auth.uid() and role <> 'team_manager') $$;
create or replace function event_released(ev uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select coalesce((select results_released from events where id = ev and deleted_at is null), false) $$;

create policy active_events on events as restrictive for all to anon, authenticated
  using (deleted_at is null) with check (deleted_at is null);
-- Restrictive policies also cover a judge's own cards and a person's own roles, independently of the role helpers.
do $$ declare t text; begin
  foreach t in array array['teams','event_roles','invitations','judge_conflicts','scorecards','score_overrides','penalties','ranking_snapshots'] loop
    execute format('create policy active_event_only on %I as restrictive for all to anon, authenticated using (event_active(event_id)) with check (event_active(event_id))', t);
  end loop;
  foreach t in array array['scorecard_scores','scorecard_feedback','scorecard_private_reviews'] loop
    execute format('create policy active_card_only on %I as restrictive for all to authenticated using (exists (select 1 from scorecards c where c.id = scorecard_id)) with check (exists (select 1 from scorecards c where c.id = scorecard_id))', t);
  end loop;
end $$;

create function delete_event(p_event uuid, p_confirmation text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare e events;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '28000'; end if;
  select * into e from events where id = p_event for update;
  if not found or not exists (select 1 from event_roles where event_id = p_event and user_id = auth.uid() and role = 'organiser') then
    raise exception 'only organisers can delete events' using errcode = '42501';
  end if;
  if p_confirmation is distinct from e.name then raise exception 'event name does not match' using errcode = '22023'; end if;
  if e.deleted_at is not null then return; end if;
  update events set deleted_at = now() where id = p_event;
  perform audit_write(p_event, 'delete', 'events', p_event::text, jsonb_build_object('name', e.name, 'restorable', true));
end $$;
create function restore_event(p_event uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare e events;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '28000'; end if;
  select * into e from events where id = p_event for update;
  if not found or not exists (select 1 from event_roles where event_id = p_event and user_id = auth.uid() and role = 'organiser') then
    raise exception 'only organisers can restore events' using errcode = '42501';
  end if;
  if e.deleted_at is null then return; end if;
  update events set deleted_at = null where id = p_event;
  perform audit_write(p_event, 'restore', 'events', p_event::text, jsonb_build_object('name', e.name));
end $$;
create function list_deleted_events() returns setof events language sql stable security definer set search_path = public, pg_temp as
$$ select e.* from events e where e.deleted_at is not null and exists
  (select 1 from event_roles r where r.event_id = e.id and r.user_id = auth.uid() and r.role = 'organiser') order by e.created_at desc, e.id $$;
grant execute on function delete_event(uuid,text), restore_event(uuid), list_deleted_events() to authenticated;

-- Deferred invitations remain available to be claimed if the event is restored.
create or replace function claim_invitations() returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int := 0; inv record; me text;
begin
  if auth.uid() is null then return 0; end if;
  select lower(btrim(email)) into me from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if me is null or me = '' then return 0; end if;
  for inv in select * from invitations where email = me and event_active(event_id) loop
    insert into event_roles(event_id,user_id,role,panel,team_id,email)
      values(inv.event_id,auth.uid(),inv.role,inv.panel,inv.team_id,me) on conflict do nothing;
    delete from invitations where id = inv.id;
    n := n + 1;
  end loop;
  return n;
end $$;

create function import_teams(p_event uuid, p_teams jsonb) returns setof teams language plpgsql security definer set search_path = public, pg_temp as $$
declare item jsonb; e events;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '28000'; end if;
  select * into e from events where id = p_event for update;
  if not found or not is_chair_or_organiser(p_event) then raise exception 'only the Chair or Organiser can import teams' using errcode = '42501'; end if;
  if p_teams is null or jsonb_typeof(p_teams) <> 'array' then raise exception 'teams must be an array' using errcode = '22023'; end if;
  if jsonb_array_length(p_teams) not between 1 and 1000 then raise exception 'import between 1 and 1000 teams' using errcode = '22023'; end if;
  for item in select value from jsonb_array_elements(p_teams) loop
    if jsonb_typeof(item) <> 'object' or jsonb_typeof(item->'number') is distinct from 'string' or jsonb_typeof(item->'name') is distinct from 'string'
      or ((item ? 'school') and jsonb_typeof(item->'school') is distinct from 'string') then
      raise exception 'invalid team row' using errcode = '22023';
    end if;
    if char_length(btrim(item->>'number')) not between 1 and 12 or char_length(btrim(item->>'name')) not between 1 and 80
      or char_length(btrim(coalesce(item->>'school',''))) > 120 then
      raise exception 'invalid team number, name or school' using errcode = '22023';
    end if;
  end loop;
  -- The unique event/number index checks duplicates in the file and concurrent writes. One failed row rolls back the batch.
  return query insert into teams(event_id,number,name,school)
    select p_event,btrim(t->>'number'),btrim(t->>'name'),btrim(coalesce(t->>'school','')) from jsonb_array_elements(p_teams) t returning teams.*;
end $$;
grant execute on function import_teams(uuid,jsonb) to authenticated;
