-- Every team supplies its school's logo and confirms its school's name with its other media.
-- The name is teams.school itself, so results, reports and graphics keep reading one value.
alter table team_media_files drop constraint team_media_files_kind_check;
alter table team_media_files add constraint team_media_files_kind_check
 check(kind in ('car_render_fl','car_render_fr','car_model_3d','model_materials','school_logo'));

create or replace function get_compulsory_assets(p_event uuid,p_team uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare result jsonb;f team_media_files;d team_media_details;
begin
 perform media_access(p_event,p_team,false);
 select * into d from team_media_details where event_id=p_event and team_id=p_team;
 result:=jsonb_build_object('revision',coalesce(d.revision,0),'teamColours',d.colours,'memberPortraits',coalesce(d.members,'[]'),
  'schoolName',(select nullif(btrim(school),'') from teams where id=p_team and event_id=p_event));
 for f in select * from team_media_files where event_id=p_event and team_id=p_team loop
  result:=result||jsonb_build_object(case f.kind when 'car_render_fl' then 'carRenderFL' when 'car_render_fr' then 'carRenderFR' when 'car_model_3d' then 'carModel3D' when 'school_logo' then 'schoolLogo' else 'modelMaterials' end,
   jsonb_build_object('name',f.name,'mime',f.mime,'size',octet_length(f.content),'width',f.width,'height',f.height,'revision',f.revision,'updatedAt',f.updated_at));
 end loop;
 result:=result||jsonb_build_object('teamLogo',(select jsonb_build_object('name',name,'mime',mime,'size',octet_length(content),'revision',revision,'updatedAt',updated_at) from team_files where event_id=p_event and team_id=p_team and kind='logo'));
 return result;
end $$;

create or replace function save_team_media_details(p_event uuid,p_team uuid,p_key text,p_value jsonb,p_revision integer default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v jsonb;p jsonb;b bytea;dims integer[];cur integer;school_name text;
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
 elsif p_key='school_name' then
  if p_value is null or jsonb_typeof(p_value)<>'object' or jsonb_typeof(p_value->'name') is distinct from 'string' then raise exception 'a school name is required' using errcode='22023';end if;
  school_name:=btrim(p_value->>'name');
  if char_length(school_name) not between 1 and 120 or school_name ~ '[[:cntrl:]]' then raise exception 'enter a school name of up to 120 characters' using errcode='22023';end if;
  update teams set school=school_name where id=p_team and event_id=p_event;
 else raise exception 'invalid media details category' using errcode='22023';end if;
 -- Every save, the school name included, advances the one revision that guards concurrent edits.
 insert into team_media_details(event_id,team_id,colours,members,revision) values(p_event,p_team,case when p_key='team_colours' then v end,case when p_key='member_portraits' then v else '[]' end,coalesce(cur,0)+1)
 on conflict(event_id,team_id) do update set colours=case when p_key='team_colours' then v else team_media_details.colours end,members=case when p_key='member_portraits' then v else team_media_details.members end,revision=team_media_details.revision+1;
end $$;

create or replace function upload_compulsory_asset(p_event uuid,p_team uuid,p_kind text,p_input jsonb,p_revision integer default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare n text:=btrim(p_input->>'name');m text:=p_input->>'mime';b bytea;dims integer[];cur integer;txt text;w bigint;h bigint;
begin
 perform 1 from events where id=p_event for update;perform media_access(p_event,p_team,true);
 if p_kind='team_logo' then
  select revision into cur from team_files where event_id=p_event and team_id=p_team and kind='logo';
  perform upload_team_file(p_event,p_team,coalesce(p_revision,cur,0),p_input||'{"kind":"logo"}'::jsonb);return;
 end if;
 if p_kind is null or p_kind not in ('car_render_fl','car_render_fr','car_model_3d','model_materials','school_logo') or n is null or length(n) not between 1 and 180 or n ~ '[[:cntrl:]/\\]' then raise exception 'invalid media file details' using errcode='22023';end if;
 b:=media_bytes(p_input->>'base64',case when p_kind='school_logo' then 2097152 when p_kind in ('car_render_fl','car_render_fr') then 26214400 else 52428800 end);
 if p_kind='school_logo' then
  -- The same rules as the team logo: a real PNG, or static self-contained SVG artwork.
  if m='image/png' and n ~* '\.png$' and substring(b from 1 for 8)=decode('89504e470d0a1a0a','hex') and octet_length(b)>=33 and substring(b from 13 for 4)=convert_to('IHDR','UTF8') then
   w:=get_byte(b,16)*16777216::bigint+get_byte(b,17)*65536+get_byte(b,18)*256+get_byte(b,19);
   h:=get_byte(b,20)*16777216::bigint+get_byte(b,21)*65536+get_byte(b,22)*256+get_byte(b,23);
   if w not between 1 and 12000 or h not between 1 and 12000 then raise exception 'invalid PNG dimensions' using errcode='22023';end if;
   dims:=array[w::integer,h::integer];
  elsif m='image/svg+xml' and n ~* '\.svg$' then
   txt:=convert_from(b,'UTF8');
   if exists(select 1 from regexp_matches(txt,'<[[:space:]]*/?[[:space:]]*([[:alpha:]_][[:alnum:]_.:-]*)','g') t where lower(t[1]) not in ('svg','g','path','defs','lineargradient','radialgradient','stop','clippath','mask','pattern','rect','circle','ellipse','line','polyline','polygon','title','desc')) then raise exception 'unsupported SVG elements' using errcode='22023';end if;
   if txt !~* '<svg[[:space:]>]' or txt !~* '</svg[[:space:]]*>' or txt ~* '<[[:space:]]*(script|foreignObject|iframe|object|embed|image|use|style|animate|set)\y|\yon[a-z]+[[:space:]]*=|\y(href|src)[[:space:]]*=|url[[:space:]]*\(|<!|<\?|&(#|[a-z])' then raise exception 'use self-contained static SVG artwork or PNG' using errcode='22023';end if;
  else raise exception 'use PNG or SVG' using errcode='22023';end if;
 elsif p_kind in ('car_render_fl','car_render_fr') then
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

create or replace function delete_compulsory_asset(p_event uuid,p_team uuid,p_kind text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 perform 1 from events where id=p_event for update;perform media_access(p_event,p_team,true);
 if p_kind='team_logo' then delete from team_files where event_id=p_event and team_id=p_team and kind='logo';
 elsif p_kind='official_photo' then perform delete_team_photo(p_event,p_team);
 elsif p_kind in ('car_render_fl','car_render_fr','car_model_3d','model_materials','school_logo') then delete from team_media_files where event_id=p_event and team_id=p_team and kind=p_kind;
 elsif p_kind in ('team_colours','member_portraits') then update team_media_details set colours=case when p_kind='team_colours' then null else colours end,members=case when p_kind='member_portraits' then '[]'::jsonb else members end,revision=revision+1 where event_id=p_event and team_id=p_team;
 elsif p_kind='school_name' then
  update teams set school='' where id=p_team and event_id=p_event;
  update team_media_details set revision=revision+1 where event_id=p_event and team_id=p_team;
 else raise exception 'invalid media category' using errcode='22023';end if;
end $$;

create or replace function team_branding_profile(p_event uuid,p_team uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s jsonb; a jsonb:='[]'; members jsonb:='[]'; missing jsonb:='[]'; f jsonb; m jsonb;k text;field text;label text;p team_photos;r jsonb;
begin
 perform media_access(p_event,p_team,false);
 s:=get_compulsory_assets(p_event,p_team);
 for k,field,label in select * from (values
 ('team_logo','teamLogo','Team logo'),('car_render_fl','carRenderFL','Car render · front-left'),
 ('car_render_fr','carRenderFR','Car render · front-right'),('car_model_3d','carModel3D','3D car model'),('model_materials','modelMaterials','Materials and textures')) v(k,f,l) loop
  f:=s->field;
  if f is not null and f<>'null'::jsonb then a:=a||jsonb_build_array(f||jsonb_build_object('key',k,'label',label,'width',f->'width','height',f->'height'));
  else missing:=missing||jsonb_build_array(k);end if;
 end loop;
 select * into p from team_photos where event_id=p_event and team_id=p_team;
 if p.original_content is not null then
  a:=a||jsonb_build_array(jsonb_build_object('key','official_photo_original','label','Official team photograph · original','name',p.original_name,'mime',p.original_mime,'size',octet_length(p.original_content),'revision',p.revision,'updatedAt',p.uploaded_at,'width',p.original_width,'height',p.original_height));
 else missing:=missing||'"official_photo"'::jsonb;end if;
 if p.approval_status='approved' and p.approved_content is not null then
  a:=a||jsonb_build_array(jsonb_build_object('key','official_photo_approved','label','Team cutout · approved for broadcast','name','team-approved.png','mime','image/png','size',octet_length(p.approved_content),'revision',p.revision,'updatedAt',p.approved_at,'width',p.approved_width,'height',p.approved_height));
 end if;
 if s->'teamColours' is null or s->'teamColours'='null'::jsonb then missing:=missing||'"team_colours"'::jsonb;end if;
 for m in select value from jsonb_array_elements(s->'memberPortraits') loop
  k:='portrait:'||(m->>'id');
  members:=members||jsonb_build_array(jsonb_build_object('id',m->>'id','name',m->>'name','role',m->>'role','assetKey',k));
  a:=a||jsonb_build_array(jsonb_build_object('key',k,'label','Portrait · '||(m->>'name'),'name',m->>'fileName','mime',m->>'photoMime','size',octet_length(decode(m->>'photoBase64','base64')),'revision',s->'revision','updatedAt',m->>'updatedAt','width',null,'height',null));
 end loop;
 if jsonb_array_length(members)=0 then missing:=missing||'"member_portraits"'::jsonb;end if;
 f:=s->'schoolLogo';
 if f is not null and f<>'null'::jsonb then a:=a||jsonb_build_array(f||jsonb_build_object('key','school_logo','label','School logo','width',f->'width','height',f->'height'));
 else missing:=missing||'"school_logo"'::jsonb;end if;
 if coalesce(s->>'schoolName','')='' then missing:=missing||'"school_name"'::jsonb;end if;
 select jsonb_build_object('schemaVersion',1,'eventId',e.id,'eventName',e.name,'competitionLevel',e.competition_level,
 'team',jsonb_build_object('id',t.id,'eventId',t.event_id,'number',t.number,'name',t.name,'school',coalesce(t.school,'')),
 'colours',s->'teamColours','members',members,'assets',a,'missing',missing,'completedCount',10-jsonb_array_length(missing),'totalCount',10)
 into r from events e join teams t on t.event_id=e.id where e.id=p_event and t.id=p_team;
 return r||jsonb_build_object('version',md5(r::text||coalesce(p.version::text,'')||coalesce((s->>'revision'),'')));
end $$;

-- Replacing a function drops its per-function settings; restore the bounded timeouts for large file requests.
alter function team_branding_profile(uuid,uuid) set statement_timeout = '30s';
alter function upload_compulsory_asset(uuid,uuid,text,jsonb,integer) set statement_timeout = '30s';
alter function save_team_media_details(uuid,uuid,text,jsonb,integer) set statement_timeout = '30s';
