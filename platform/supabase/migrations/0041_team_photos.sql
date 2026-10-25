-- Official Team Photograph and AI Background Removal Pipeline
-- Stores original, processed (transparent cutout), and approved team photographs.
-- Strict access control: original photos (which may contain minors) are private; only approved cutouts appear in broadcast graphics.

create table team_photos (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  team_id uuid not null,
  revision integer not null default 1,
  version integer not null default 1,
  original_name text not null check(char_length(btrim(original_name)) between 1 and 180 and original_name !~ '[[:cntrl:]/\\]'),
  original_mime text not null check(original_mime in ('image/jpeg','image/jpg','image/png')),
  original_size integer not null check(original_size between 1 and 26214400),
  original_width integer check(original_width is null or original_width between 1 and 16000),
  original_height integer check(original_height is null or original_height between 1 and 16000),
  original_path text not null,
  original_content bytea not null,
  processed_path text,
  processed_content bytea,
  processed_size integer check(processed_size is null or processed_size between 1 and 26214400),
  processed_width integer check(processed_width is null or processed_width between 1 and 16000),
  processed_height integer check(processed_height is null or processed_height between 1 and 16000),
  approved_path text,
  approved_content bytea,
  approved_size integer check(approved_size is null or approved_size between 1 and 26214400),
  approved_width integer check(approved_width is null or approved_width between 1 and 16000),
  approved_height integer check(approved_height is null or approved_height between 1 and 16000),
  processing_status text not null default 'pending' check(processing_status in ('pending','processing','completed','failed')),
  approval_status text not null default 'pending' check(approval_status in ('pending','approved','rejected')),
  processing_error text,
  retry_count integer not null default 0,
  media_consent boolean not null default true check(media_consent = true),
  uploaded_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  correction_notes text,
  foreign key(team_id, event_id) references teams(id, event_id) on delete cascade,
  unique(event_id, team_id)
);

create table team_photo_history (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  team_id uuid not null,
  version integer not null,
  approved_path text not null,
  approved_content bytea not null,
  approved_size integer not null check(approved_size between 1 and 26214400),
  approved_width integer,
  approved_height integer,
  approved_at timestamptz not null default clock_timestamp(),
  approved_by uuid references auth.users(id) on delete set null,
  correction_notes text,
  foreign key(team_id, event_id) references teams(id, event_id) on delete cascade
);

create table photo_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  team_id uuid not null,
  photo_id uuid not null references team_photos(id) on delete cascade,
  version integer not null,
  status text not null default 'pending' check(status in ('pending','processing','completed','failed')),
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  scheduled_at timestamptz not null default clock_timestamp(),
  locked_at timestamptz,
  locked_by text,
  completed_at timestamptz,
  error text,
  created_at timestamptz not null default clock_timestamp(),
  foreign key(team_id, event_id) references teams(id, event_id) on delete cascade
);

alter table team_photos enable row level security;
alter table team_photo_history enable row level security;
alter table photo_processing_jobs enable row level security;

revoke all on team_photos from public, anon, authenticated;
revoke all on team_photo_history from public, anon, authenticated;
revoke all on photo_processing_jobs from public, anon, authenticated;

create trigger spectator_read_only before insert or update or delete on team_photos for each row execute function spectator_write_guard();
create trigger spectator_read_only before insert or update or delete on team_photo_history for each row execute function spectator_write_guard();
create trigger spectator_read_only before insert or update or delete on photo_processing_jobs for each row execute function spectator_write_guard();

-- Helper to check whether user can read photo metadata
create function reads_team_photo(p_event uuid, p_team uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select event_active(p_event) and (
    is_chair_or_organiser(p_event) or
    platform_spectator() or
    manages_team(p_event, p_team) or
    is_member(p_event)
  );
$$;

-- List team photos metadata for an event
create function list_team_photos(p_event uuid)
returns table(
  id uuid,
  "eventId" uuid,
  "teamId" uuid,
  revision integer,
  version integer,
  "originalName" text,
  "originalMime" text,
  "originalSize" integer,
  "originalWidth" integer,
  "originalHeight" integer,
  "originalPath" text,
  "processedPath" text,
  "processedSize" integer,
  "processedWidth" integer,
  "processedHeight" integer,
  "approvedPath" text,
  "approvedSize" integer,
  "approvedWidth" integer,
  "approvedHeight" integer,
  "processingStatus" text,
  "approvalStatus" text,
  "processingError" text,
  "retryCount" integer,
  "mediaConsent" boolean,
  "uploadedAt" timestamptz,
  "processedAt" timestamptz,
  "approvedAt" timestamptz,
  "approvedBy" uuid,
  "correctionNotes" text,
  "hasOriginal" boolean,
  "hasProcessed" boolean,
  "hasApproved" boolean
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not event_active(p_event) then raise exception 'event inactive' using errcode='42501'; end if;
  if not (is_chair_or_organiser(p_event) or platform_spectator() or exists(select 1 from event_roles where event_id=p_event and user_id=auth.uid() and role='team_manager')) then
    raise exception 'media assets unavailable' using errcode='42501';
  end if;

  return query
  select
    p.id, p.event_id, p.team_id, p.revision, p.version,
    p.original_name, p.original_mime, p.original_size, p.original_width, p.original_height,
    p.original_path, p.processed_path, p.processed_size, p.processed_width, p.processed_height,
    p.approved_path, p.approved_size, p.approved_width, p.approved_height,
    p.processing_status, p.approval_status, p.processing_error, p.retry_count,
    p.media_consent, p.uploaded_at, p.processed_at, p.approved_at, p.approved_by, p.correction_notes,
    p.original_content is not null as "hasOriginal",
    p.processed_content is not null as "hasProcessed",
    p.approved_content is not null as "hasApproved"
  from team_photos p
  where p.event_id = p_event
    and (is_chair_or_organiser(p_event) or platform_spectator() or manages_team(p_event, p.team_id));
end $$;

-- Download photograph bytes (original, processed, or approved)
create function download_team_photo(p_event uuid, p_team uuid, p_which text)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  p team_photos;
  cnt bytea;
  mime text;
  name text;
  size integer;
  w integer;
  h integer;
begin
  if not event_active(p_event) then raise exception 'event inactive' using errcode='42501'; end if;
  select * into p from team_photos where event_id = p_event and team_id = p_team;
  if p.id is null then raise exception 'photo not found' using errcode='42501'; end if;

  if p_which = 'original' then
    if not (is_chair_or_organiser(p_event) or manages_team(p_event, p_team)) then
      raise exception 'only event staff or your team may access the original photograph' using errcode='42501';
    end if;
    cnt := p.original_content;
    mime := p.original_mime;
    name := p.original_name;
    size := p.original_size;
    w := p.original_width;
    h := p.original_height;
  elsif p_which = 'processed' then
    if not (is_chair_or_organiser(p_event) or platform_spectator() or manages_team(p_event, p_team)) then
      raise exception 'access denied' using errcode='42501';
    end if;
    if p.processed_content is null then raise exception 'processed cutout not ready' using errcode='42501'; end if;
    cnt := p.processed_content;
    mime := 'image/png';
    name := replace(p.original_name, substring(p.original_name from '\.[^.]+$'), '') || '-cutout.png';
    size := p.processed_size;
    w := p.processed_width;
    h := p.processed_height;
  elsif p_which = 'approved' then
    if not (is_chair_or_organiser(p_event) or platform_spectator() or manages_team(p_event, p_team) or is_member(p_event) or event_released(p_event)) then
      raise exception 'access denied' using errcode='42501';
    end if;
    if p.approved_content is null or p.approval_status <> 'approved' then
      raise exception 'approved photo unavailable' using errcode='42501';
    end if;
    cnt := p.approved_content;
    mime := 'image/png';
    name := replace(p.original_name, substring(p.original_name from '\.[^.]+$'), '') || '-approved.png';
    size := p.approved_size;
    w := p.approved_width;
    h := p.approved_height;
  else
    raise exception 'invalid photo target' using errcode='22023';
  end if;

  return jsonb_build_object(
    'teamId', p_team,
    'which', p_which,
    'mime', mime,
    'name', name,
    'size', coalesce(size, octet_length(cnt)),
    'width', w,
    'height', h,
    'base64', replace(encode(cnt, 'base64'), E'\n', '')
  );
end $$;

-- Upload or replace team photograph
create function upload_team_photo(p_event uuid, p_team uuid, p_revision integer, p_input jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n text := btrim(p_input->>'name');
  m text := lower(btrim(p_input->>'mime'));
  b text := p_input->>'base64';
  consent boolean := (p_input->>'mediaConsent')::boolean;
  w integer := (p_input->>'width')::integer;
  h integer := (p_input->>'height')::integer;
  lim integer := 26214400; -- 25 MB
  bytes bytea;
  cur_rev integer;
  cur_ver integer;
  orig_path text;
  photo_id uuid;
  t_row teams;
begin
  perform 1 from events where id = p_event for update;
  if not event_active(p_event) or not (is_chair_or_organiser(p_event) or manages_team(p_event, p_team)) or platform_spectator() then
    raise exception 'only your team or event staff may upload team photographs' using errcode='42501';
  end if;
  if event_released(p_event) then raise exception 'results released' using errcode='55000'; end if;

  select * into t_row from teams where id = p_team and event_id = p_event;
  if t_row.id is null then raise exception 'team not found' using errcode='22023'; end if;

  if consent is not true then
    raise exception 'media consent acknowledgement is required for team photographs' using errcode='22023';
  end if;

  if n is null or length(n) not between 1 and 180 or n ~ '[[:cntrl:]/\\]' then
    raise exception 'invalid photograph file name' using errcode='22023';
  end if;

  if m is null or m not in ('image/jpeg','image/jpg','image/png') then
    raise exception 'photograph must be JPG or PNG' using errcode='22023';
  end if;

  if b is null or length(b) = 0 or length(b) > ((lim + 2)/3)*4 or length(b)%4 <> 0 or b !~ '^[A-Za-z0-9+/]*={0,2}$' then
    raise exception 'invalid file encoding or size' using errcode='22023';
  end if;

  bytes := decode(b, 'base64');
  if octet_length(bytes) > lim then raise exception 'photograph exceeds 25 MB limit' using errcode='22023'; end if;

  -- Validate magic header bytes
  if m = 'image/png' then
    if substring(bytes from 1 for 8) <> decode('89504e470d0a1a0a','hex') then
      raise exception 'invalid PNG format' using errcode='22023';
    end if;
    if w is null or h is null or w <= 0 or h <= 0 then
      w := get_byte(bytes,16)*16777216::bigint+get_byte(bytes,17)*65536+get_byte(bytes,18)*256+get_byte(bytes,19);
      h := get_byte(bytes,20)*16777216::bigint+get_byte(bytes,21)*65536+get_byte(bytes,22)*256+get_byte(bytes,23);
    end if;
  elsif m in ('image/jpeg','image/jpg') then
    if substring(bytes from 1 for 3) <> decode('ffd8ff','hex') then
      raise exception 'invalid JPEG format' using errcode='22023';
    end if;
  end if;

  select revision, version into cur_rev, cur_ver from team_photos where event_id = p_event and team_id = p_team;
  if p_revision is not null and p_revision is distinct from coalesce(cur_rev, 0) then
    raise exception 'photograph was modified; reload' using errcode='40001';
  end if;

  cur_rev := coalesce(cur_rev, 0) + 1;
  cur_ver := coalesce(cur_ver, 0) + 1;
  orig_path := 'team-photos/' || p_event || '/' || p_team || '/v' || cur_ver || '/original.' || case when m='image/png' then 'png' else 'jpg' end;

  insert into team_photos(
    event_id, team_id, revision, version,
    original_name, original_mime, original_size, original_width, original_height,
    original_path, original_content,
    processed_path, processed_content, processed_size, processed_width, processed_height,
    approved_path, approved_content, approved_size, approved_width, approved_height,
    processing_status, approval_status, processing_error, retry_count,
    media_consent, uploaded_at
  ) values (
    p_event, p_team, cur_rev, cur_ver,
    n, m, octet_length(bytes), w, h,
    orig_path, bytes,
    null, null, null, null, null,
    null, null, null, null, null,
    'pending', 'pending', null, 0,
    true, clock_timestamp()
  )
  on conflict(event_id, team_id) do update set
    revision = cur_rev,
    version = cur_ver,
    original_name = excluded.original_name,
    original_mime = excluded.original_mime,
    original_size = excluded.original_size,
    original_width = excluded.original_width,
    original_height = excluded.original_height,
    original_path = excluded.original_path,
    original_content = excluded.original_content,
    processed_path = null,
    processed_content = null,
    processed_size = null,
    processed_width = null,
    processed_height = null,
    approved_path = null,
    approved_content = null,
    approved_size = null,
    approved_width = null,
    approved_height = null,
    processing_status = 'pending',
    approval_status = 'pending',
    processing_error = null,
    retry_count = 0,
    media_consent = true,
    uploaded_at = clock_timestamp()
  returning id into photo_id;

  -- Automatically queue for background removal
  insert into photo_processing_jobs(
    event_id, team_id, photo_id, version, status, scheduled_at
  ) values (
    p_event, p_team, photo_id, cur_ver, 'pending', clock_timestamp()
  );

  return jsonb_build_object(
    'photoId', photo_id,
    'eventId', p_event,
    'teamId', p_team,
    'revision', cur_rev,
    'version', cur_ver,
    'status', 'pending'
  );
end $$;

-- Queue photo processing job (for retry or manual trigger)
create function queue_photo_processing(p_event uuid, p_team uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p team_photos;
  j_id uuid;
begin
  if not event_active(p_event) or not is_chair_or_organiser(p_event) or platform_spectator() then
    raise exception 'only event staff may queue background removal' using errcode='42501';
  end if;
  select * into p from team_photos where event_id = p_event and team_id = p_team for update;
  if p.id is null then raise exception 'photo not found' using errcode='22023'; end if;

  update team_photos set
    processing_status = 'pending',
    processing_error = null,
    retry_count = p.retry_count + 1
  where id = p.id;

  insert into photo_processing_jobs(
    event_id, team_id, photo_id, version, status, scheduled_at
  ) values (
    p_event, p_team, p.id, p.version, 'pending', clock_timestamp()
  ) returning id into j_id;

  return jsonb_build_object('jobId', j_id, 'status', 'pending');
end $$;

-- Queue bulk photo processing for all pending/failed or selected teams
create function queue_bulk_photo_processing(p_event uuid, p_team_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  queued_count integer := 0;
  tid uuid;
begin
  if not event_active(p_event) or not is_chair_or_organiser(p_event) or platform_spectator() then
    raise exception 'only event staff may queue background removal' using errcode='42501';
  end if;

  for tid in
    select p.team_id from team_photos p
    where p.event_id = p_event
      and (p_team_ids is null or cardinality(p_team_ids) = 0 or p.team_id = any(p_team_ids))
      and (p_team_ids is not null and cardinality(p_team_ids) > 0 or p.processing_status in ('pending', 'failed'))
  loop
    perform queue_photo_processing(p_event, tid);
    queued_count := queued_count + 1;
  end loop;

  return jsonb_build_object('queued', queued_count);
end $$;

-- Complete photo processing job (called by Python worker or direct processing)
create function complete_photo_processing(p_job_id uuid, p_status text, p_cutout_base64 text, p_error text)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j photo_processing_jobs;
  bytes bytea;
  p_path text;
  w integer;
  h integer;
begin
  select * into j from photo_processing_jobs where id = p_job_id for update;
  if j.id is null then return false; end if;

  if p_status = 'completed' then
    if p_cutout_base64 is null or length(p_cutout_base64) = 0 then
      raise exception 'cutout base64 required for completed job' using errcode='22023';
    end if;
    bytes := decode(p_cutout_base64, 'base64');
    if substring(bytes from 1 for 8) <> decode('89504e470d0a1a0a','hex') then
      raise exception 'processed cutout must be a PNG' using errcode='22023';
    end if;

    w := get_byte(bytes,16)*16777216::bigint+get_byte(bytes,17)*65536+get_byte(bytes,18)*256+get_byte(bytes,19);
    h := get_byte(bytes,20)*16777216::bigint+get_byte(bytes,21)*65536+get_byte(bytes,22)*256+get_byte(bytes,23);
    p_path := 'team-photos/' || j.event_id || '/' || j.team_id || '/v' || j.version || '/processed.png';

    update team_photos set
      processed_path = p_path,
      processed_content = bytes,
      processed_size = octet_length(bytes),
      processed_width = w,
      processed_height = h,
      processing_status = 'completed',
      processed_at = clock_timestamp(),
      processing_error = null
    where id = j.photo_id;

    update photo_processing_jobs set
      status = 'completed',
      completed_at = clock_timestamp(),
      error = null
    where id = j.id;

  elsif p_status = 'failed' then
    update team_photos set
      processing_status = 'failed',
      processing_error = coalesce(p_error, 'AI background removal failed')
    where id = j.photo_id;

    update photo_processing_jobs set
      status = 'failed',
      completed_at = clock_timestamp(),
      error = p_error,
      attempts = j.attempts + 1
    where id = j.id;
  else
    raise exception 'invalid completion status' using errcode='22023';
  end if;

  return true;
end $$;

-- Approve a processed team photo for live broadcast graphics
create function approve_team_photo(p_event uuid, p_team uuid, p_notes text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p team_photos;
  app_path text;
begin
  if not event_active(p_event) or not is_chair_or_organiser(p_event) or platform_spectator() then
    raise exception 'only event organisers may approve team photographs' using errcode='42501';
  end if;

  select * into p from team_photos where event_id = p_event and team_id = p_team for update;
  if p.id is null then raise exception 'photo not found' using errcode='22023'; end if;
  if p.processed_content is null and p.approved_content is null then
    raise exception 'cannot approve photograph before background removal is complete' using errcode='55000';
  end if;

  -- Archive currently approved version if exists
  if p.approved_content is not null then
    insert into team_photo_history(
      event_id, team_id, version, approved_path, approved_content,
      approved_size, approved_width, approved_height, approved_at, approved_by, correction_notes
    ) values (
      p.event_id, p.team_id, p.version, p.approved_path, p.approved_content,
      p.approved_size, p.approved_width, p.approved_height, coalesce(p.approved_at, clock_timestamp()),
      p.approved_by, p.correction_notes
    );
  end if;

  app_path := 'team-photos/' || p.event_id || '/' || p.team_id || '/v' || p.version || '/approved.png';

  update team_photos set
    approved_path = app_path,
    approved_content = coalesce(p.processed_content, p.approved_content),
    approved_size = coalesce(p.processed_size, p.approved_size),
    approved_width = coalesce(p.processed_width, p.approved_width),
    approved_height = coalesce(p.processed_height, p.approved_height),
    approval_status = 'approved',
    approved_at = clock_timestamp(),
    approved_by = auth.uid(),
    correction_notes = p_notes
  where id = p.id;

  return jsonb_build_object('teamId', p_team, 'approvalStatus', 'approved', 'approvedAt', clock_timestamp());
end $$;

-- Reject processed team photo
create function reject_team_photo(p_event uuid, p_team uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p team_photos;
begin
  if not event_active(p_event) or not is_chair_or_organiser(p_event) or platform_spectator() then
    raise exception 'only event organisers may reject team photographs' using errcode='42501';
  end if;

  select * into p from team_photos where event_id = p_event and team_id = p_team for update;
  if p.id is null then raise exception 'photo not found' using errcode='22023'; end if;

  update team_photos set
    approval_status = 'rejected',
    correction_notes = p_reason
  where id = p.id;

  return jsonb_build_object('teamId', p_team, 'approvalStatus', 'rejected');
end $$;

-- Upload manually corrected transparent PNG
create function upload_corrected_team_photo(p_event uuid, p_team uuid, p_input jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p team_photos;
  b text := p_input->>'base64';
  notes text := p_input->>'notes';
  bytes bytea;
  app_path text;
  w integer;
  h integer;
begin
  if not event_active(p_event) or not is_chair_or_organiser(p_event) or platform_spectator() then
    raise exception 'only event organisers may upload manual corrections' using errcode='42501';
  end if;

  select * into p from team_photos where event_id = p_event and team_id = p_team for update;
  if p.id is null then raise exception 'photo not found' using errcode='22023'; end if;

  if b is null or length(b) = 0 then raise exception 'transparent PNG required' using errcode='22023'; end if;
  bytes := decode(b, 'base64');
  if substring(bytes from 1 for 8) <> decode('89504e470d0a1a0a','hex') then
    raise exception 'manual correction must be a transparent PNG' using errcode='22023';
  end if;

  w := get_byte(bytes,16)*16777216::bigint+get_byte(bytes,17)*65536+get_byte(bytes,18)*256+get_byte(bytes,19);
  h := get_byte(bytes,20)*16777216::bigint+get_byte(bytes,21)*65536+get_byte(bytes,22)*256+get_byte(bytes,23);

  -- Archive old approved version if exists
  if p.approved_content is not null then
    insert into team_photo_history(
      event_id, team_id, version, approved_path, approved_content,
      approved_size, approved_width, approved_height, approved_at, approved_by, correction_notes
    ) values (
      p.event_id, p.team_id, p.version, p.approved_path, p.approved_content,
      p.approved_size, p.approved_width, p.approved_height, coalesce(p.approved_at, clock_timestamp()),
      p.approved_by, p.correction_notes
    );
  end if;

  app_path := 'team-photos/' || p.event_id || '/' || p.team_id || '/v' || p.version || '/manual-approved.png';

  update team_photos set
    approved_path = app_path,
    approved_content = bytes,
    approved_size = octet_length(bytes),
    approved_width = w,
    approved_height = h,
    approval_status = 'approved',
    approved_at = clock_timestamp(),
    approved_by = auth.uid(),
    correction_notes = coalesce(notes, 'Manually corrected cutout')
  where id = p.id;

  return jsonb_build_object('teamId', p_team, 'approvalStatus', 'approved', 'isManual', true);
end $$;

-- Restore an earlier approved version from history
create function restore_team_photo_version(p_event uuid, p_team uuid, p_history_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p team_photos;
  h_row team_photo_history;
begin
  if not event_active(p_event) or not is_chair_or_organiser(p_event) or platform_spectator() then
    raise exception 'only event organisers may restore photo versions' using errcode='42501';
  end if;

  select * into p from team_photos where event_id = p_event and team_id = p_team for update;
  if p.id is null then raise exception 'photo not found' using errcode='22023'; end if;

  select * into h_row from team_photo_history where id = p_history_id and event_id = p_event and team_id = p_team;
  if h_row.id is null then raise exception 'historical version not found' using errcode='22023'; end if;

  -- Archive current approved before restoring
  if p.approved_content is not null then
    insert into team_photo_history(
      event_id, team_id, version, approved_path, approved_content,
      approved_size, approved_width, approved_height, approved_at, approved_by, correction_notes
    ) values (
      p.event_id, p.team_id, p.version, p.approved_path, p.approved_content,
      p.approved_size, p.approved_width, p.approved_height, coalesce(p.approved_at, clock_timestamp()),
      p.approved_by, p.correction_notes
    );
  end if;

  update team_photos set
    approved_path = h_row.approved_path,
    approved_content = h_row.approved_content,
    approved_size = h_row.approved_size,
    approved_width = h_row.approved_width,
    approved_height = h_row.approved_height,
    approval_status = 'approved',
    approved_at = clock_timestamp(),
    approved_by = auth.uid(),
    correction_notes = 'Restored from version ' || h_row.version || ' (' || coalesce(h_row.correction_notes, 'previous approved') || ')'
  where id = p.id;

  return jsonb_build_object('teamId', p_team, 'restoredVersion', h_row.version, 'approvalStatus', 'approved');
end $$;

-- List history for an individual team's photo
create function list_team_photo_history(p_event uuid, p_team uuid)
returns table(
  id uuid,
  "eventId" uuid,
  "teamId" uuid,
  version integer,
  "approvedPath" text,
  "approvedSize" integer,
  "approvedWidth" integer,
  "approvedHeight" integer,
  "approvedAt" timestamptz,
  "approvedBy" uuid,
  "correctionNotes" text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not event_active(p_event) or not (is_chair_or_organiser(p_event) or platform_spectator()) then
    raise exception 'only event staff may view version history' using errcode='42501';
  end if;

  return query
  select
    h.id, h.event_id, h.team_id, h.version,
    h.approved_path, h.approved_size, h.approved_width, h.approved_height,
    h.approved_at, h.approved_by, h.correction_notes
  from team_photo_history h
  where h.event_id = p_event and h.team_id = p_team
  order by h.approved_at desc;
end $$;

-- Delete team photo (organisers or team manager)
create function delete_team_photo(p_event uuid, p_team uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not event_active(p_event) or not (is_chair_or_organiser(p_event) or manages_team(p_event, p_team)) or platform_spectator() then
    raise exception 'only your team or event staff may delete team photographs' using errcode='42501';
  end if;
  if event_released(p_event) then raise exception 'results released' using errcode='55000'; end if;

  delete from team_photos where event_id = p_event and team_id = p_team;
  delete from team_photo_history where event_id = p_event and team_id = p_team;
  delete from photo_processing_jobs where event_id = p_event and team_id = p_team;
end $$;

-- Broadcast retrieval: retrieves approved transparent cutout for a team.
-- If not approved, returns null for photoBase64 and includes logoBase64 if present.
create function get_broadcast_team_photo(p_event uuid, p_team uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  t teams;
  p team_photos;
  logo team_files;
  photo_b64 text := null;
  logo_b64 text := null;
  logo_mime text := null;
begin
  select * into t from teams where id = p_team and event_id = p_event;
  if t.id is null then raise exception 'team not found' using errcode='22023'; end if;

  select * into p from team_photos where event_id = p_event and team_id = p_team;
  if p.id is not null and p.approval_status = 'approved' and p.approved_content is not null then
    photo_b64 := replace(encode(p.approved_content, 'base64'), E'\n', '');
  end if;

  select * into logo from team_files where event_id = p_event and team_id = p_team and kind = 'logo';
  if logo.id is not null and logo.content is not null then
    logo_b64 := replace(encode(logo.content, 'base64'), E'\n', '');
    logo_mime := logo.mime;
  end if;

  return jsonb_build_object(
    'teamId', t.id,
    'teamNumber', t.number,
    'teamName', t.name,
    'school', t.school,
    'isApprovedPhoto', photo_b64 is not null,
    'photoBase64', photo_b64,
    'photoWidth', p.approved_width,
    'photoHeight', p.approved_height,
    'logoBase64', logo_b64,
    'logoMime', logo_mime
  );
end $$;

revoke execute on function
  reads_team_photo(uuid, uuid),
  list_team_photos(uuid),
  download_team_photo(uuid, uuid, text),
  upload_team_photo(uuid, uuid, integer, jsonb),
  queue_photo_processing(uuid, uuid),
  queue_bulk_photo_processing(uuid, uuid[]),
  complete_photo_processing(uuid, text, text, text),
  approve_team_photo(uuid, uuid, text),
  reject_team_photo(uuid, uuid, text),
  upload_corrected_team_photo(uuid, uuid, jsonb),
  restore_team_photo_version(uuid, uuid, uuid),
  list_team_photo_history(uuid, uuid),
  delete_team_photo(uuid, uuid),
  get_broadcast_team_photo(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  list_team_photos(uuid),
  download_team_photo(uuid, uuid, text),
  upload_team_photo(uuid, uuid, integer, jsonb),
  queue_photo_processing(uuid, uuid),
  queue_bulk_photo_processing(uuid, uuid[]),
  complete_photo_processing(uuid, text, text, text),
  approve_team_photo(uuid, uuid, text),
  reject_team_photo(uuid, uuid, text),
  upload_corrected_team_photo(uuid, uuid, jsonb),
  restore_team_photo_version(uuid, uuid, uuid),
  list_team_photo_history(uuid, uuid),
  delete_team_photo(uuid, uuid),
  get_broadcast_team_photo(uuid, uuid)
to authenticated;
