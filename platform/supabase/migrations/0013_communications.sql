-- Broadcast emails table for audit tracking and access control
create table broadcast_emails (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  sender_email text,
  audience_type text not null check (audience_type in ('all_judges', 'panel', 'specific_judges', 'emails')),
  panel judging_panel,
  recipient_count integer not null default 0,
  subject text not null,
  category text,
  body text not null,
  button_text text,
  button_url text,
  created_at timestamptz not null default clock_timestamp()
);

alter table broadcast_emails enable row level security;

create policy broadcasts_select on broadcast_emails for select to authenticated
  using (is_chair_or_organiser(event_id));

create policy broadcasts_insert on broadcast_emails for insert to authenticated
  with check (is_chair_or_organiser(event_id));

create policy active_broadcasts on broadcast_emails as restrictive for all to authenticated
  using (event_active(event_id)) with check (event_active(event_id));

grant select, insert on broadcast_emails to authenticated;
grant all on broadcast_emails to service_role;
