-- Multiple organisers and restricted event creation.

-- Table for pre-approved creator emails (allowlist).
create table if not exists event_creators (
  email text primary key check (email = lower(btrim(email)) and position('@' in email) > 1),
  created_at timestamptz not null default now()
);
alter table event_creators enable row level security;
revoke truncate on event_creators from anon, authenticated;
grant select, insert, delete on event_creators to authenticated;

-- Organisers can read and manage event creators.
create policy event_creators_select on event_creators for select to authenticated using (true);
create policy event_creators_write on event_creators for all to authenticated
  using (exists (select 1 from event_roles where user_id = auth.uid() and role = 'organiser'))
  with check (exists (select 1 from event_roles where user_id = auth.uid() and role = 'organiser'));

-- Function to check if the caller can create events:
-- 1. If no events exist yet (bootstrap)
-- 2. If user is an active organiser of at least one event
-- 3. If user's confirmed email is in event_creators allowlist
create or replace function can_create_event() returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me text;
begin
  if auth.uid() is null then return false; end if;
  if not exists (select 1 from events) then return true; end if;
  if exists (
    select 1 from event_roles r
    join events e on e.id = r.event_id
    where r.user_id = auth.uid() and r.role = 'organiser' and e.deleted_at is null
  ) then
    return true;
  end if;
  select lower(btrim(email)) into me from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if me is not null and exists (select 1 from event_creators where email = me) then
    return true;
  end if;
  return false;
end $$;

-- Enforce can_create_event in create_event RPC
create or replace function create_event(p_name text, p_starts_on date, p_ruleset jsonb) returns events
language plpgsql security definer set search_path = public, pg_temp as $$
declare e events;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not can_create_event() then raise exception 'only organisers can create events' using errcode = '42501'; end if;
  insert into events (name, starts_on, ruleset, created_by) values (p_name, p_starts_on, p_ruleset, auth.uid()) returning * into e;
  insert into event_roles (event_id, user_id, role, email) values (e.id, auth.uid(), 'organiser', lower(btrim(auth.jwt() ->> 'email')));
  return e;
end $$;

-- Only an organiser can invite an organiser (Chairs cannot invite organisers)
create or replace function protect_invitation_role() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.role = 'organiser' then
    if not exists (
      select 1 from event_roles
      where event_id = new.event_id and user_id = auth.uid() and role = 'organiser'
    ) then
      raise exception 'only organisers can invite organisers' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists invitation_role_guard on invitations;
create trigger invitation_role_guard before insert or update on invitations
for each row execute function protect_invitation_role();

-- Only an organiser can remove an organiser, and the last organiser cannot be removed
create or replace function protect_organiser_removal() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.role = 'organiser' then
    if pg_trigger_depth() > 1 or not exists (select 1 from events where id = old.event_id) then
      return old;
    end if;
    if not exists (
      select 1 from event_roles
      where event_id = old.event_id and user_id = auth.uid() and role = 'organiser'
    ) then
      raise exception 'only organisers can remove organisers' using errcode = '42501';
    end if;
    if (select count(*) from event_roles where event_id = old.event_id and role = 'organiser' and id <> old.id) < 1 then
      raise exception 'an event must have at least one organiser' using errcode = '55000';
    end if;
  end if;
  return old;
end $$;

drop trigger if exists organiser_removal_guard on event_roles;
create trigger organiser_removal_guard before delete on event_roles
for each row execute function protect_organiser_removal();

-- Privileges
revoke execute on function can_create_event() from public, anon;
grant execute on function can_create_event() to authenticated;

revoke execute on function protect_invitation_role() from public, anon, authenticated;
revoke execute on function protect_organiser_removal() from public, anon, authenticated;
