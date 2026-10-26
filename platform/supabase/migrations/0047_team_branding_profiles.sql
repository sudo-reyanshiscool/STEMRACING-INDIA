-- Branding profiles are derived from canonical private submissions, never duplicate uploads.
create function team_branding_profile(p_event uuid,p_team uuid) returns jsonb
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
 select jsonb_build_object('schemaVersion',1,'eventId',e.id,'eventName',e.name,'competitionLevel',e.competition_level,
 'team',jsonb_build_object('id',t.id,'eventId',t.event_id,'number',t.number,'name',t.name,'school',coalesce(t.school,'')),
 'colours',s->'teamColours','members',members,'assets',a,'missing',missing,'completedCount',8-jsonb_array_length(missing),'totalCount',8)
 into r from events e join teams t on t.event_id=e.id where e.id=p_event and t.id=p_team;
 return r||jsonb_build_object('version',md5(r::text||coalesce(p.version::text,'')||coalesce((s->>'revision'),'')));
end $$;
create function download_team_brand_asset(p_event uuid,p_team uuid,p_key text,p_version text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare profile jsonb;a jsonb;f jsonb;b text;
begin
 profile:=team_branding_profile(p_event,p_team);
 if p_version is distinct from profile->>'version' then raise exception 'Branding changed. Refresh the profile and try again.' using errcode='40001';end if;
 select value into a from jsonb_array_elements(profile->'assets') where value->>'key'=p_key;
 if a is null then raise exception 'branding asset unavailable' using errcode='22023';end if;
 if p_key like 'portrait:%' then
  select m->>'photoBase64' into b from team_media_details d cross join lateral jsonb_array_elements(d.members) m where d.event_id=p_event and d.team_id=p_team and 'portrait:'||(m->>'id')=p_key;
 elsif p_key in ('official_photo_original','official_photo_approved') then
  f:=download_team_photo(p_event,p_team,case p_key when 'official_photo_original' then 'original' else 'approved' end);b:=f->>'base64';
 else f:=download_compulsory_asset(p_event,p_team,p_key);b:=f->>'base64';end if;
 if b is null then raise exception 'branding asset unavailable' using errcode='22023';end if;
 return a||jsonb_build_object('base64',b);
end $$;
revoke execute on function team_branding_profile(uuid,uuid),download_team_brand_asset(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function team_branding_profile(uuid,uuid),download_team_brand_asset(uuid,uuid,text,text) to authenticated;
