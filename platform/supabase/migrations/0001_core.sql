-- Core: events, teams, roles, invitations, audit log, helper functions, row-level security.

-- Functions are not callable by default: nothing is exposed unless it is granted explicitly below.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

create type app_role as enum ('organiser', 'chair', 'lead_judge', 'judge', 'scrutineer', 'race_official', 'team_manager');
create type judging_panel as enum ('scrutineering', 'design_engineering', 'project_management', 'enterprise', 'verbal');

create table events (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  starts_on date,
  ruleset jsonb not null check (coalesce(jsonb_typeof(ruleset -> 'areas'), '') = 'array'),
  results_released boolean not null default false,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events on delete cascade,
  number text not null check (char_length(btrim(number)) between 1 and 12),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  school text not null default '' check (char_length(school) <= 120),
  created_at timestamptz not null default now()
);
create unique index teams_event_number on teams (event_id, lower(btrim(number)));
-- Lets roles and invitations reference a team together with its event, so the two cannot disagree.
alter table teams add constraint teams_id_event unique (id, event_id);

create table event_roles (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role app_role not null,
  panel judging_panel,
  team_id uuid,
  email text,
  constraint roles_panel check ((role in ('judge', 'lead_judge')) = (panel is not null)),
  constraint roles_team check ((role = 'team_manager') = (team_id is not null)),
  constraint roles_team_event foreign key (team_id, event_id) references teams (id, event_id) on delete cascade
);
-- enum::text is only STABLE, so it cannot sit in an index expression; NULLS NOT DISTINCT (PG15+) gives the same rule.
create unique index event_roles_unique on event_roles (event_id, user_id, role, panel, team_id) nulls not distinct;

create table invitations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events on delete cascade,
  email text not null check (email = lower(btrim(email)) and position('@' in email) > 1),
  role app_role not null,
  panel judging_panel,
  team_id uuid,
  created_at timestamptz not null default now(),
  constraint inv_panel check ((role in ('judge', 'lead_judge')) = (panel is not null)),
  constraint inv_team check ((role = 'team_manager') = (team_id is not null)),
  constraint inv_team_event foreign key (team_id, event_id) references teams (id, event_id) on delete cascade
);
create unique index invitations_unique on invitations (event_id, email, role, panel, team_id) nulls not distinct;

create table audit_log (
  id bigserial primary key,
  event_id uuid references events on delete restrict,
  actor uuid,
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- Helpers. security definer so policies can ask about roles without recursing into event_roles' own policy.
create function is_member(ev uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select exists (select 1 from event_roles where event_id = ev and user_id = auth.uid()) $$;

create function has_role(ev uuid, r app_role) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select exists (select 1 from event_roles where event_id = ev and user_id = auth.uid() and role = r) $$;

create function is_chair_or_organiser(ev uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select exists (select 1 from event_roles where event_id = ev and user_id = auth.uid() and role in ('chair', 'organiser')) $$;

create function judges_panel(ev uuid, p judging_panel) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select exists (select 1 from event_roles where event_id = ev and user_id = auth.uid() and role = 'judge' and panel = p) $$;

create function leads_panel(ev uuid, p judging_panel) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select exists (select 1 from event_roles where event_id = ev and user_id = auth.uid() and role = 'lead_judge' and panel = p) $$;

create function manages_team(ev uuid, t uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select exists (select 1 from event_roles where event_id = ev and user_id = auth.uid() and role = 'team_manager' and team_id = t) $$;

create function sees_all_teams(ev uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select exists (select 1 from event_roles where event_id = ev and user_id = auth.uid() and role <> 'team_manager') $$;

create function event_released(ev uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as
$$ select coalesce((select results_released from events where id = ev), false) $$;

-- Audit.
create function audit_write(p_event uuid, p_action text, p_entity text, p_entity_id text, p_detail jsonb) returns void
language sql security definer set search_path = public, pg_temp as
$$ insert into audit_log (event_id, actor, action, entity, entity_id, detail) values (p_event, auth.uid(), p_action, p_entity, p_entity_id, p_detail) $$;

create function audit_row() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare r jsonb; ev uuid;
begin
  r := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  ev := case when tg_table_name = 'events' then (r ->> 'id')::uuid else (r ->> 'event_id')::uuid end;
  insert into audit_log (event_id, actor, action, entity, entity_id, detail)
  values (ev, auth.uid(), lower(tg_op), tg_table_name, coalesce(r ->> 'id', r ->> 'team_id'),
          jsonb_build_object('old', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
                             'new', case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end));
  return null;
end $$;

create trigger events_audit after update on events for each row
  when (old.results_released is distinct from new.results_released) execute function audit_row();
create trigger roles_audit after insert or delete on event_roles for each row execute function audit_row();

create function events_freeze() returns trigger language plpgsql as $$
begin
  if new.ruleset is distinct from old.ruleset then
    raise exception 'the pinned ruleset of an event cannot change' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger events_freeze before update on events for each row execute function events_freeze();

-- RPCs.
create function create_event(p_name text, p_starts_on date, p_ruleset jsonb) returns events
language plpgsql security definer set search_path = public, pg_temp as $$
declare e events;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '28000'; end if;
  insert into events (name, starts_on, ruleset, created_by) values (p_name, p_starts_on, p_ruleset, auth.uid()) returning * into e;
  insert into event_roles (event_id, user_id, role, email) values (e.id, auth.uid(), 'organiser', lower(btrim(auth.jwt() ->> 'email')));
  return e;
end $$;

create function claim_invitations() returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int := 0; inv record; me text;
begin
  if auth.uid() is null then return 0; end if;
  -- Only a confirmed address counts, and it is read from the account, not from the token.
  select lower(btrim(email)) into me from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if me is null or me = '' then return 0; end if;
  for inv in select * from invitations where email = me loop
    insert into event_roles (event_id, user_id, role, panel, team_id, email)
    values (inv.event_id, auth.uid(), inv.role, inv.panel, inv.team_id, me) on conflict do nothing;
    delete from invitations where id = inv.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Privileges. Audit rows are written only by the SECURITY DEFINER code above.
revoke truncate, insert, update, delete on audit_log from anon, authenticated;
revoke execute on function audit_write(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function audit_row() from public, anon, authenticated;
-- Policies call these as the signed-in (or anonymous) user, so both roles need to run them.
grant execute on function is_member(uuid), has_role(uuid, app_role), is_chair_or_organiser(uuid),
  judges_panel(uuid, judging_panel), leads_panel(uuid, judging_panel), manages_team(uuid, uuid),
  sees_all_teams(uuid), event_released(uuid) to anon, authenticated;
-- RPCs: signed-in users only.
revoke execute on function create_event(text, date, jsonb), claim_invitations() from public, anon;
grant execute on function create_event(text, date, jsonb), claim_invitations() to authenticated;

-- Row-level security.
alter table events enable row level security;
alter table teams enable row level security;
alter table event_roles enable row level security;
alter table invitations enable row level security;
alter table audit_log enable row level security;

create policy events_select on events for select to anon, authenticated using (results_released or is_member(id));
create policy events_update on events for update to authenticated using (is_chair_or_organiser(id)) with check (is_chair_or_organiser(id));

create policy teams_select on teams for select to anon, authenticated
  using (event_released(event_id) or sees_all_teams(event_id) or manages_team(event_id, id));
create policy teams_insert on teams for insert to authenticated with check (is_chair_or_organiser(event_id));
create policy teams_update on teams for update to authenticated using (is_chair_or_organiser(event_id)) with check (is_chair_or_organiser(event_id));
create policy teams_delete on teams for delete to authenticated using (is_chair_or_organiser(event_id));

create policy roles_select on event_roles for select to authenticated using (user_id = auth.uid() or is_chair_or_organiser(event_id));
create policy roles_insert on event_roles for insert to authenticated with check (is_chair_or_organiser(event_id));
create policy roles_update on event_roles for update to authenticated using (is_chair_or_organiser(event_id)) with check (is_chair_or_organiser(event_id));
create policy roles_delete on event_roles for delete to authenticated using (is_chair_or_organiser(event_id));

create policy inv_all on invitations for all to authenticated using (is_chair_or_organiser(event_id)) with check (is_chair_or_organiser(event_id));

create policy audit_select on audit_log for select to authenticated using (is_chair_or_organiser(event_id));
