-- Technical inspections: per-car dimensional measurements and compliance checks
-- Persists the offline checklist data in Supabase with shared access, audit history,
-- and protected submission flow.

create table technical_inspections (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  team_id uuid not null,
  car text not null check (car in ('A', 'B')),
  inspector_id uuid not null default auth.uid() references auth.users(id),
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted', 'reopened')),
  ruleset_id text not null,
  measurements jsonb not null default '{}',
  notes jsonb not null default '{}',
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  updated_at timestamptz not null default now(),
  revision int not null default 1,
  constraint technical_inspections_team_event foreign key (team_id, event_id) references teams (id, event_id) on delete cascade,
  unique (event_id, team_id, car)
);

create index technical_inspections_event on technical_inspections(event_id);
create index technical_inspections_team on technical_inspections(team_id);

alter table technical_inspections enable row level security;
revoke all on technical_inspections from public, anon, authenticated;
grant select, insert, update on technical_inspections to authenticated;

-- View: inspector, staff, or submitted (all judges/staff or released team manager)
create policy inspections_select on technical_inspections for select to authenticated using (
  inspector_id = auth.uid()
  or is_chair_or_organiser(event_id)
  or (status = 'submitted' and (
    specification_visible(event_id)
    or (event_released(event_id) and manages_team(event_id, team_id))
  ))
);

-- Insert: scrutineering judges, scrutineers, chair or organiser can create inspections
create policy "Scrutineering judges can create inspections"
  on technical_inspections for insert with check (
    inspector_id = auth.uid()
    and not event_released(event_id)
    and exists (
      select 1 from event_roles
      where event_roles.event_id = technical_inspections.event_id
        and event_roles.user_id = auth.uid()
        and ((event_roles.role = 'judge' and event_roles.panel = 'scrutineering')
             or event_roles.role in ('scrutineer', 'chair', 'organiser'))
        and (event_roles.team_id is null or event_roles.team_id = technical_inspections.team_id)
    )
  );

-- Update: own in-progress inspections, or Chair/Organiser for any
create policy "Inspector or Chair can update inspections"
  on technical_inspections for update using (
    not event_released(event_id)
    and (
      (inspector_id = auth.uid() and status in ('in_progress', 'reopened'))
      or exists (
        select 1 from event_roles
        where event_roles.event_id = technical_inspections.event_id
          and event_roles.user_id = auth.uid()
          and event_roles.role in ('chair', 'organiser')
      )
    )
  );

create trigger technical_inspections_audit after insert or update or delete on technical_inspections for each row execute function audit_row();

-- Audit history for corrections
create table inspection_history (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references technical_inspections(id) on delete cascade,
  changed_by uuid not null default auth.uid() references auth.users(id),
  changed_at timestamptz not null default now(),
  previous_measurements jsonb not null,
  previous_status text not null,
  reason text not null default '',
  revision int not null
);

create index inspection_history_inspection on inspection_history(inspection_id);

alter table inspection_history enable row level security;
revoke all on inspection_history from public, anon, authenticated;
grant select, insert on inspection_history to authenticated;

create policy "Event staff can view inspection history"
  on inspection_history for select using (
    exists (
      select 1 from technical_inspections ti
      join event_roles er on er.event_id = ti.event_id and er.user_id = auth.uid()
      where ti.id = inspection_history.inspection_id
    )
  );

create policy "Inspectors and Chair can create history"
  on inspection_history for insert with check (
    changed_by = auth.uid()
    and exists (
      select 1 from technical_inspections ti
      join event_roles er on er.event_id = ti.event_id and er.user_id = auth.uid()
      where ti.id = inspection_history.inspection_id
        and (er.role in ('chair', 'organiser')
             or (er.role in ('judge', 'scrutineer') and ti.inspector_id = auth.uid()))
    )
  );

-- Submit inspection: saves audit trail and sets status
create or replace function submit_inspection(p_inspection uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_insp record;
begin
  select * into v_insp from technical_inspections where id = p_inspection for update;
  if not found then raise exception 'Inspection not found' using errcode = 'P0002'; end if;
  if event_released_locked(v_insp.event_id) then
    raise exception 'results are released; inspections are closed' using errcode = '55000';
  end if;
  if v_insp.inspector_id <> auth.uid() then
    -- Allow Chair/Organiser
    if not exists (
      select 1 from event_roles
      where event_id = v_insp.event_id and user_id = auth.uid() and role in ('chair', 'organiser')
    ) then
      raise exception 'Not authorised' using errcode = '42501';
    end if;
  end if;
  if v_insp.status = 'submitted' then
    raise exception 'Already submitted' using errcode = '23505';
  end if;

  insert into inspection_history(inspection_id, changed_by, previous_measurements, previous_status, revision)
  values (p_inspection, auth.uid(), v_insp.measurements, v_insp.status, v_insp.revision);

  update technical_inspections
  set status = 'submitted', submitted_at = now(), updated_at = now(), revision = revision + 1
  where id = p_inspection;
end;
$$;

revoke execute on function submit_inspection(uuid) from public, anon, authenticated;
grant execute on function submit_inspection(uuid) to authenticated;

-- Reopen inspection: Chair only, with reason
create or replace function reopen_inspection(p_inspection uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_insp record;
begin
  select * into v_insp from technical_inspections where id = p_inspection for update;
  if not found then raise exception 'Inspection not found' using errcode = 'P0002'; end if;
  if event_released_locked(v_insp.event_id) then
    raise exception 'results are released; inspections are closed' using errcode = '55000';
  end if;
  if v_insp.status <> 'submitted' then
    raise exception 'Only submitted inspections can be reopened' using errcode = '23514';
  end if;
  if not exists (
    select 1 from event_roles
    where event_id = v_insp.event_id and user_id = auth.uid() and role in ('chair', 'organiser')
  ) then
    raise exception 'Only the Chair or Organiser can reopen' using errcode = '42501';
  end if;

  insert into inspection_history(inspection_id, changed_by, previous_measurements, previous_status, reason, revision)
  values (p_inspection, auth.uid(), v_insp.measurements, v_insp.status, p_reason, v_insp.revision);

  update technical_inspections
  set status = 'reopened', updated_at = now(), revision = revision + 1
  where id = p_inspection;
end;
$$;

revoke execute on function reopen_inspection(uuid, text) from public, anon, authenticated;
grant execute on function reopen_inspection(uuid, text) to authenticated;
