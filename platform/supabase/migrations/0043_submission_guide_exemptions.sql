-- Explicit video-only exemptions. They never grant event membership or upload permissions.
create table submission_guide_exemptions (
 email text primary key check(email=lower(btrim(email)) and length(email) between 3 and 254),
 created_at timestamptz not null default clock_timestamp()
);
alter table submission_guide_exemptions enable row level security;
revoke all on submission_guide_exemptions from public,anon,authenticated;
insert into submission_guide_exemptions(email) values('supercharged@british-school.org');
create function submission_guide_exempt() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
 select exists(select 1 from auth.users u join submission_guide_exemptions e on e.email=lower(btrim(u.email))
   where u.id=auth.uid() and u.email_confirmed_at is not null)
$$;
revoke execute on function submission_guide_exempt() from public,anon,authenticated;
create or replace function submission_guide_state(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p submission_guide_progress;
begin
 if auth.uid() is null or not event_active(p_event) or platform_spectator() or not (is_chair_or_organiser(p_event) or exists(select 1 from event_roles where event_id=p_event and user_id=auth.uid() and role='team_manager')) then raise exception 'submission access required' using errcode='42501'; end if;
 select * into p from submission_guide_progress where user_id=auth.uid() and version='submission-guide-2026-10-26-v1';
 return jsonb_build_object('version','submission-guide-2026-10-26-v1','duration',784.04,'watchedSeconds',coalesce(p.watched_seconds,0),'complete',p.completed_at is not null,'required',not (is_chair_or_organiser(p_event) or submission_guide_exempt()));
end $$;
create or replace function submission_guide_upload_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if auth.uid() is not null and not is_chair_or_organiser(new.event_id) and not submission_guide_exempt() and not exists(
   select 1 from submission_guide_progress where user_id=auth.uid() and version='submission-guide-2026-10-26-v1' and completed_at is not null
 ) then raise exception 'watch the full submission guide before uploading' using errcode='55000'; end if;
 return new;
end $$;
revoke execute on function submission_guide_state(uuid),submission_guide_upload_guard() from public,anon,authenticated;
grant execute on function submission_guide_state(uuid) to authenticated;
