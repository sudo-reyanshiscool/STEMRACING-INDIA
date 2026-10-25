-- Completion belongs to the signed-in person and this exact guide version, across events/devices.
create table submission_guide_progress (
 user_id uuid not null references auth.users(id) on delete cascade,
 version text not null check(version='submission-guide-2026-10-26-v1'),
 watched_seconds double precision not null default 0 check(watched_seconds between 0 and 784.04),
 last_seen_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,
 primary key(user_id,version)
);
alter table submission_guide_progress enable row level security;
revoke all on submission_guide_progress from public,anon,authenticated;
create function submission_guide_state(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare p submission_guide_progress;
begin
 if auth.uid() is null or not event_active(p_event) or platform_spectator() or not (is_chair_or_organiser(p_event) or exists(select 1 from event_roles where event_id=p_event and user_id=auth.uid() and role='team_manager')) then raise exception 'submission access required' using errcode='42501'; end if;
 select * into p from submission_guide_progress where user_id=auth.uid() and version='submission-guide-2026-10-26-v1';
 return jsonb_build_object('version','submission-guide-2026-10-26-v1','duration',784.04,'watchedSeconds',coalesce(p.watched_seconds,0),'complete',p.completed_at is not null,'required',not is_chair_or_organiser(p_event));
end $$;
create function record_submission_guide_progress(p_event uuid,p_position double precision) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare p submission_guide_progress; at_time timestamptz:=clock_timestamp(); elapsed double precision;
begin
 perform submission_guide_state(p_event); -- Same access check; no caller-selected user or duration.
 if p_position is null or not (p_position between 0 and 784.04) then raise exception 'invalid guide position' using errcode='22023'; end if;
 insert into submission_guide_progress(user_id,version) values(auth.uid(),'submission-guide-2026-10-26-v1') on conflict do nothing;
 select * into p from submission_guide_progress where user_id=auth.uid() and version='submission-guide-2026-10-26-v1' for update;
 if p.completed_at is not null then return submission_guide_state(p_event); end if;
 elapsed:=extract(epoch from (at_time-p.last_seen_at));
 -- Heartbeats cannot jump to the end, bank background time or accelerate beyond elapsed server time.
 if p_position>=p.watched_seconds and p_position-p.watched_seconds<=least(elapsed,15)+0.5 then
  update submission_guide_progress set watched_seconds=p_position,last_seen_at=greatest(at_time,p.last_seen_at+(p_position-p.watched_seconds)*interval '1 second'),
    completed_at=case when p_position>=784.039 then at_time else null end
   where user_id=auth.uid() and version=p.version;
 end if;
 return submission_guide_state(p_event);
end $$;
create function submission_guide_upload_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 -- Staff can support a team; team managers must finish before an upload can be accepted.
 if auth.uid() is not null and not is_chair_or_organiser(new.event_id) and not exists(
   select 1 from submission_guide_progress where user_id=auth.uid() and version='submission-guide-2026-10-26-v1' and completed_at is not null
 ) then raise exception 'watch the full submission guide before uploading' using errcode='55000'; end if;
 return new;
end $$;
create trigger submission_guide_required before insert or update on team_files for each row execute function submission_guide_upload_guard();
revoke execute on function submission_guide_state(uuid),record_submission_guide_progress(uuid,double precision),submission_guide_upload_guard() from public,anon,authenticated;
grant execute on function submission_guide_state(uuid),record_submission_guide_progress(uuid,double precision) to authenticated;
