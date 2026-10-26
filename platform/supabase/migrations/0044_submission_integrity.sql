-- Replace browser-only media records with private, authorised server persistence.
create table team_media_files (
 event_id uuid not null, team_id uuid not null, kind text not null check(kind in ('car_render_fl','car_render_fr','car_model_3d','model_materials')),
 name text not null, mime text not null, content bytea not null, width integer, height integer,
 revision integer not null default 1, updated_at timestamptz not null default clock_timestamp(),
 primary key(event_id,team_id,kind), foreign key(team_id,event_id) references teams(id,event_id) on delete cascade,
 check(octet_length(content) between 1 and 52428800)
);
create table team_media_details (
 event_id uuid not null,team_id uuid not null,colours jsonb,members jsonb not null default '[]',revision integer not null default 1,
 primary key(event_id,team_id),foreign key(team_id,event_id) references teams(id,event_id) on delete cascade
);
alter table team_media_files enable row level security;
alter table team_media_details enable row level security;
revoke all on team_media_files,team_media_details from public,anon,authenticated;
create trigger spectator_read_only before insert or update or delete on team_media_files for each row execute function spectator_write_guard();
create trigger spectator_read_only before insert or update or delete on team_media_details for each row execute function spectator_write_guard();
create trigger submission_guide_required before insert or update on team_media_files for each row execute function submission_guide_upload_guard();
create trigger submission_guide_required before insert or update on team_media_details for each row execute function submission_guide_upload_guard();
create trigger submission_guide_required before insert or update of original_content on team_photos for each row execute function submission_guide_upload_guard();

create function media_access(p_event uuid,p_team uuid,p_write boolean default false) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
 if auth.uid() is null or not event_active(p_event) or not exists(select 1 from teams where id=p_team and event_id=p_event)
 or not (is_chair_or_organiser(p_event) or (not p_write and platform_spectator()) or manages_team(p_event,p_team))
 or (p_write and platform_spectator()) then raise exception 'only your team or event staff may access media' using errcode='42501'; end if;
 if p_write and event_released(p_event) then raise exception 'results released' using errcode='55000'; end if;
end $$;
create function media_bytes(p_base64 text,p_limit integer) returns bytea
language plpgsql immutable set search_path = public, pg_temp as $$
declare b bytea;
begin
 if p_base64 is null or length(p_base64)=0 or length(p_base64)>((p_limit+2)/3)*4 or length(p_base64)%4<>0 or p_base64 !~ '^[A-Za-z0-9+/]*={0,2}$' then raise exception 'invalid file encoding or size' using errcode='22023'; end if;
 b:=decode(p_base64,'base64');
 if octet_length(b) not between 1 and p_limit then raise exception 'file exceeds size limit' using errcode='22023'; end if;
 return b;
end $$;
create function media_dimensions(b bytea,m text) returns integer[]
language plpgsql immutable set search_path = public, pg_temp as $$
declare w bigint;h bigint;pos integer:=2;marker integer;n integer;
begin
 if m='image/png' and octet_length(b)>=45 and substring(b from 1 for 8)=decode('89504e470d0a1a0a','hex') and substring(b from 13 for 4)=convert_to('IHDR','UTF8') and position(convert_to('IEND','UTF8') in substring(b from greatest(1,octet_length(b)-11)))>0 then
  w:=get_byte(b,16)*16777216::bigint+get_byte(b,17)*65536+get_byte(b,18)*256+get_byte(b,19);
  h:=get_byte(b,20)*16777216::bigint+get_byte(b,21)*65536+get_byte(b,22)*256+get_byte(b,23);
 elsif m='image/jpeg' and octet_length(b)>=12 and substring(b from 1 for 3)=decode('ffd8ff','hex') and substring(b from octet_length(b)-1 for 2)=decode('ffd9','hex') then
  while pos+8<octet_length(b) loop
   exit when get_byte(b,pos)<>255;
   marker:=get_byte(b,pos+1);n:=get_byte(b,pos+2)*256+get_byte(b,pos+3);
   if marker in (192,193,194) and n>=7 then h:=get_byte(b,pos+5)*256+get_byte(b,pos+6);w:=get_byte(b,pos+7)*256+get_byte(b,pos+8);exit;end if;
   exit when n<2;pos:=pos+n+2;
  end loop;
 end if;
 if w is null or h is null or w not between 1 and 16000 or h not between 1 and 16000 then raise exception 'invalid or incomplete image' using errcode='22023';end if;
 return array[w::integer,h::integer];
end $$;
create function get_compulsory_assets(p_event uuid,p_team uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare result jsonb;f team_media_files;d team_media_details;
begin
 perform media_access(p_event,p_team,false);
 select * into d from team_media_details where event_id=p_event and team_id=p_team;
 result:=jsonb_build_object('revision',coalesce(d.revision,0),'teamColours',d.colours,'memberPortraits',coalesce(d.members,'[]'));
 for f in select * from team_media_files where event_id=p_event and team_id=p_team loop
  result:=result||jsonb_build_object(case f.kind when 'car_render_fl' then 'carRenderFL' when 'car_render_fr' then 'carRenderFR' when 'car_model_3d' then 'carModel3D' else 'modelMaterials' end,
   jsonb_build_object('name',f.name,'mime',f.mime,'size',octet_length(f.content),'width',f.width,'height',f.height,'revision',f.revision,'updatedAt',f.updated_at));
 end loop;
 result:=result||jsonb_build_object('teamLogo',(select jsonb_build_object('name',name,'mime',mime,'size',octet_length(content),'revision',revision,'updatedAt',updated_at) from team_files where event_id=p_event and team_id=p_team and kind='logo'));
 return result;
end $$;
create function save_team_media_details(p_event uuid,p_team uuid,p_key text,p_value jsonb,p_revision integer default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v jsonb;p jsonb;b bytea;dims integer[];cur integer;
begin
 perform 1 from events where id=p_event for update;perform media_access(p_event,p_team,true);
 select revision into cur from team_media_details where event_id=p_event and team_id=p_team;
 if p_revision is not null and p_revision<>coalesce(cur,0) then raise exception 'media changed; reload before saving' using errcode='40001';end if;
 if p_key='team_colours' then
  if p_value is null or jsonb_typeof(p_value)<>'object' or exists(select 1 from unnest(array['primary','secondary','accent']) k where coalesce(p_value->>k,'') !~ '^#[A-Fa-f0-9]{6}$') then raise exception 'all three HEX colours are required' using errcode='22023';end if;
  v:=jsonb_build_object('primary',upper(p_value->>'primary'),'secondary',upper(p_value->>'secondary'),'accent',upper(p_value->>'accent'));
 elsif p_key='member_portraits' then
  if p_value is null or jsonb_typeof(p_value)<>'array' or jsonb_array_length(p_value)>12 then raise exception 'provide up to 12 member portraits' using errcode='22023';end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(p_value) x)<>jsonb_array_length(p_value) then raise exception 'duplicate member ID' using errcode='22023';end if;
  v:='[]';
  for p in select value from jsonb_array_elements(p_value) loop
   if jsonb_typeof(p)<>'object' or coalesce(p->>'id','') !~ '^[A-Za-z0-9_-]{1,100}$' or length(btrim(coalesce(p->>'name',''))) not between 1 and 100 or length(btrim(coalesce(p->>'role',''))) not between 1 and 100
    or length(coalesce(p->>'fileName','')) not between 1 and 180 or (p->>'fileName') ~ '[[:cntrl:]/\\]' or coalesce(p->>'photoMime','') not in ('image/png','image/jpeg') then raise exception 'each member needs a name, role and JPG or PNG portrait' using errcode='22023';end if;
   b:=media_bytes(p->>'photoBase64',2097152);dims:=media_dimensions(b,p->>'photoMime');
   v:=v||jsonb_build_array(jsonb_build_object('id',p->>'id','name',btrim(p->>'name'),'role',btrim(p->>'role'),'fileName',p->>'fileName','photoMime',p->>'photoMime','photoBase64',replace(encode(b,'base64'),E'\n',''),'updatedAt',clock_timestamp()));
  end loop;
 else raise exception 'invalid media details category' using errcode='22023';end if;
 insert into team_media_details(event_id,team_id,colours,members,revision) values(p_event,p_team,case when p_key='team_colours' then v end,case when p_key='member_portraits' then v else '[]' end,coalesce(cur,0)+1)
 on conflict(event_id,team_id) do update set colours=case when p_key='team_colours' then v else team_media_details.colours end,members=case when p_key='member_portraits' then v else team_media_details.members end,revision=team_media_details.revision+1;
end $$;
create function upload_compulsory_asset(p_event uuid,p_team uuid,p_kind text,p_input jsonb,p_revision integer default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare n text:=btrim(p_input->>'name');m text:=p_input->>'mime';b bytea;dims integer[];cur integer;txt text;
begin
 perform 1 from events where id=p_event for update;perform media_access(p_event,p_team,true);
 if p_kind='team_logo' then
  select revision into cur from team_files where event_id=p_event and team_id=p_team and kind='logo';
  perform upload_team_file(p_event,p_team,coalesce(p_revision,cur,0),p_input||'{"kind":"logo"}'::jsonb);return;
 end if;
 if p_kind is null or p_kind not in ('car_render_fl','car_render_fr','car_model_3d','model_materials') or n is null or length(n) not between 1 and 180 or n ~ '[[:cntrl:]/\\]' then raise exception 'invalid media file details' using errcode='22023';end if;
 b:=media_bytes(p_input->>'base64',case when p_kind in ('car_render_fl','car_render_fr') then 26214400 else 52428800 end);
 if p_kind in ('car_render_fl','car_render_fr') then
  dims:=media_dimensions(b,m);
  if m is distinct from 'image/png' or n !~* '\.png$' or dims<>array[3840,2160] or get_byte(b,25) not in (4,6) then raise exception 'car renders require a 3840 x 2160 PNG with an alpha channel' using errcode='22023';end if;
 elsif p_kind='car_model_3d' then
  if m is distinct from 'model/obj' or n !~* '\.obj$' then raise exception 'use an OBJ car model' using errcode='22023';end if;
  txt:=convert_from(b,'UTF8');
  if txt !~ E'(^|\n)v[ \t]+[-+0-9.]' or txt !~ E'(^|\n)f[ \t]+[0-9]' then raise exception 'OBJ must contain vertices and faces' using errcode='22023';end if;
 else
  if m is distinct from 'application/zip' or n !~* '\.zip$' or substring(b from 1 for 4)<>decode('504b0304','hex') or position(decode('504b0506','hex') in substring(b from greatest(1,octet_length(b)-65557)))=0 then raise exception 'use a complete ZIP of materials and textures' using errcode='22023';end if;
 end if;
 select revision into cur from team_media_files where event_id=p_event and team_id=p_team and kind=p_kind;
 if p_revision is not null and p_revision<>coalesce(cur,0) then raise exception 'file changed; reload before saving' using errcode='40001';end if;
 insert into team_media_files(event_id,team_id,kind,name,mime,content,width,height,revision) values(p_event,p_team,p_kind,n,m,b,dims[1],dims[2],coalesce(cur,0)+1)
 on conflict(event_id,team_id,kind) do update set name=n,mime=m,content=b,width=dims[1],height=dims[2],revision=team_media_files.revision+1,updated_at=clock_timestamp();
end $$;
create function download_compulsory_asset(p_event uuid,p_team uuid,p_kind text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare f team_media_files;
begin
 perform media_access(p_event,p_team,false);
 if p_kind='team_logo' then return (select download_team_file(p_event,id) from team_files where event_id=p_event and team_id=p_team and kind='logo');end if;
 select * into f from team_media_files where event_id=p_event and team_id=p_team and kind=p_kind;
 if f.kind is null then raise exception 'media file unavailable' using errcode='22023';end if;
 return jsonb_build_object('name',f.name,'mime',f.mime,'size',octet_length(f.content),'width',f.width,'height',f.height,'revision',f.revision,'updatedAt',f.updated_at,'base64',replace(encode(f.content,'base64'),E'\n',''));
end $$;
create function delete_compulsory_asset(p_event uuid,p_team uuid,p_kind text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 perform 1 from events where id=p_event for update;perform media_access(p_event,p_team,true);
 if p_kind='team_logo' then delete from team_files where event_id=p_event and team_id=p_team and kind='logo';
 elsif p_kind='official_photo' then perform delete_team_photo(p_event,p_team);
 elsif p_kind in ('car_render_fl','car_render_fr','car_model_3d','model_materials') then delete from team_media_files where event_id=p_event and team_id=p_team and kind=p_kind;
 elsif p_kind in ('team_colours','member_portraits') then update team_media_details set colours=case when p_kind='team_colours' then null else colours end,members=case when p_kind='member_portraits' then '[]'::jsonb else members end,revision=revision+1 where event_id=p_event and team_id=p_team;
 else raise exception 'invalid media category' using errcode='22023';end if;
end $$;
-- The legacy photo processor RPC had neither membership checks nor version checks.
alter function complete_photo_processing(uuid,text,text,text) rename to complete_photo_processing_internal;
create function complete_photo_processing(p_job_id uuid,p_status text,p_cutout_base64 text,p_error text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare j photo_processing_jobs;p team_photos;
begin
 select * into j from photo_processing_jobs where id=p_job_id;
 if j.id is null then return false;end if;
 perform media_access(j.event_id,j.team_id,true);
 if not is_chair_or_organiser(j.event_id) then raise exception 'event staff required' using errcode='42501';end if;
 perform 1 from events where id=j.event_id for update;
 select * into j from photo_processing_jobs where id=p_job_id for update;
 select * into p from team_photos where id=j.photo_id for update;
 if p.id is null or p.version<>j.version or j.status not in ('pending','processing') then return false;end if;
 if p_status='completed' then perform media_dimensions(media_bytes(p_cutout_base64,26214400),'image/png');end if;
 return complete_photo_processing_internal(p_job_id,p_status,p_cutout_base64,left(p_error,1000));
end $$;
alter function get_broadcast_team_photo(uuid,uuid) rename to get_broadcast_team_photo_internal;
create function get_broadcast_team_photo(p_event uuid,p_team uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
 perform media_access(p_event,p_team,false);
 return get_broadcast_team_photo_internal(p_event,p_team);
end $$;
create or replace function reads_team_photo(p_event uuid,p_team uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
 select auth.uid() is not null and event_active(p_event) and (is_chair_or_organiser(p_event) or platform_spectator() or manages_team(p_event,p_team))
$$;
-- Derive uploaded dimensions from the file, never the caller's claimed dimensions.
create function photo_integrity_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare d integer[];
begin
 perform 1 from events where id=new.event_id for update;
 if event_released(new.event_id) then raise exception 'results released' using errcode='55000';end if;
 if tg_op='INSERT' or new.original_content is distinct from old.original_content then
  if new.original_mime='image/jpg' then new.original_mime:='image/jpeg';end if;
  d:=media_dimensions(new.original_content,new.original_mime);new.original_width:=d[1];new.original_height:=d[2];
 end if;
 if new.processed_content is not null and (tg_op='INSERT' or new.processed_content is distinct from old.processed_content) then d:=media_dimensions(new.processed_content,'image/png');new.processed_width:=d[1];new.processed_height:=d[2];end if;
 if new.approved_content is not null and (tg_op='INSERT' or new.approved_content is distinct from old.approved_content) then d:=media_dimensions(new.approved_content,'image/png');new.approved_width:=d[1];new.approved_height:=d[2];end if;
 return new;
end $$;
create trigger photo_integrity before insert or update on team_photos for each row execute function photo_integrity_guard();
revoke execute on function media_access(uuid,uuid,boolean),media_bytes(text,integer),media_dimensions(bytea,text),photo_integrity_guard(),complete_photo_processing_internal(uuid,text,text,text),get_broadcast_team_photo_internal(uuid,uuid) from public,anon,authenticated;
revoke execute on function get_compulsory_assets(uuid,uuid),save_team_media_details(uuid,uuid,text,jsonb,integer),upload_compulsory_asset(uuid,uuid,text,jsonb,integer),download_compulsory_asset(uuid,uuid,text),delete_compulsory_asset(uuid,uuid,text),complete_photo_processing(uuid,text,text,text),get_broadcast_team_photo(uuid,uuid) from public,anon,authenticated;
grant execute on function get_compulsory_assets(uuid,uuid),save_team_media_details(uuid,uuid,text,jsonb,integer),upload_compulsory_asset(uuid,uuid,text,jsonb,integer),download_compulsory_asset(uuid,uuid,text),delete_compulsory_asset(uuid,uuid,text),complete_photo_processing(uuid,text,text,text),get_broadcast_team_photo(uuid,uuid) to authenticated;
-- Bound corrected uploads before the legacy implementation decodes their bytes.
alter function upload_corrected_team_photo(uuid,uuid,jsonb) rename to upload_corrected_team_photo_internal;
create function upload_corrected_team_photo(p_event uuid,p_team uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b bytea;
begin
 perform 1 from events where id=p_event for update;perform media_access(p_event,p_team,true);
 if not is_chair_or_organiser(p_event) then raise exception 'event staff required' using errcode='42501';end if;
 b:=media_bytes(p_input->>'base64',26214400);perform media_dimensions(b,'image/png');
 if get_byte(b,25) not in (4,6) then raise exception 'corrected PNG requires an alpha channel' using errcode='22023';end if;
 return upload_corrected_team_photo_internal(p_event,p_team,p_input);
end $$;
revoke execute on function upload_corrected_team_photo_internal(uuid,uuid,jsonb),upload_corrected_team_photo(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function upload_corrected_team_photo(uuid,uuid,jsonb) to authenticated;
