-- Small registration assets remain private in application-owned storage. No public object URLs.
create table team_files (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references events(id) on delete cascade,
 team_id uuid not null, kind text not null check(kind in ('logo','design_portfolio','enterprise_portfolio','project_portfolio')),
 name text not null, mime text not null, content bytea not null, revision integer not null, updated_at timestamptz not null default clock_timestamp(),
 foreign key(team_id,event_id) references teams(id,event_id) on delete cascade, unique(event_id,team_id,kind),
 check(octet_length(content) between 1 and 12582912)
);
alter table team_files enable row level security;
revoke all on team_files from public,anon,authenticated;

create function reads_team_file(p_event uuid,p_team uuid,p_kind text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
 select event_active(p_event) and (is_chair_or_organiser(p_event) or manages_team(p_event,p_team) or
 (not is_conflicted(p_event,p_team) and not exists(select 1 from judge_exemptions where event_id=p_event and team_id=p_team and judge_id=auth.uid()) and case when p_kind='logo' then is_member(p_event) and sees_all_teams(p_event)
 else judge_can_score(p_event,case p_kind when 'design_portfolio' then 'design_engineering'::judging_panel when 'enterprise_portfolio' then 'enterprise'::judging_panel else 'project_management'::judging_panel end,p_team)
 or leads_panel(p_event,case p_kind when 'design_portfolio' then 'design_engineering'::judging_panel when 'enterprise_portfolio' then 'enterprise'::judging_panel else 'project_management'::judging_panel end) end))
$$;
create function list_team_files(p_event uuid)
returns table(id uuid,"eventId" uuid,"teamId" uuid,kind text,name text,mime text,size integer,revision integer,"updatedAt" timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
 if not is_member(p_event) then raise exception 'event member required' using errcode='42501'; end if;
 return query select f.id,f.event_id,f.team_id,f.kind,f.name,f.mime,octet_length(f.content),f.revision,f.updated_at from team_files f
 where f.event_id=p_event and reads_team_file(f.event_id,f.team_id,f.kind);
end $$;
create function upload_team_file(p_event uuid,p_team uuid,p_revision integer,p_input jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare k text:=p_input->>'kind'; n text:=btrim(p_input->>'name'); m text:=p_input->>'mime'; b text:=p_input->>'base64'; bytes bytea; svg text; lim integer;
begin
 perform 1 from events where id=p_event for update;
 if not event_active(p_event) or not (is_chair_or_organiser(p_event) or manages_team(p_event,p_team)) then raise exception 'only your team or event staff may upload' using errcode='42501'; end if;
 if event_released(p_event) then raise exception 'results released' using errcode='55000'; end if;
 if not exists(select 1 from teams where id=p_team and event_id=p_event) or k is null or k not in ('logo','design_portfolio','enterprise_portfolio','project_portfolio') or n is null or length(n) not between 1 and 180 or n ~ '[[:cntrl:]/\\]' then raise exception 'invalid file details' using errcode='22023'; end if;
 lim:=case when k='logo' then 2097152 else 12582912 end;
 if b is null or length(b)=0 or length(b)>((lim+2)/3)*4 or length(b)%4<>0 or b !~ '^[A-Za-z0-9+/]*={0,2}$' then raise exception 'invalid file size or encoding' using errcode='22023'; end if;
 bytes:=decode(b,'base64');
 if octet_length(bytes)>lim then raise exception 'file too large' using errcode='22023'; end if;
 if k='logo' then
  if m='image/png' and n ~* '\.png$' and substring(bytes from 1 for 8)=decode('89504e470d0a1a0a','hex') and octet_length(bytes)>=33 and substring(bytes from 13 for 4)=convert_to('IHDR','UTF8') then
   if get_byte(bytes,16)*16777216::bigint+get_byte(bytes,17)*65536+get_byte(bytes,18)*256+get_byte(bytes,19) not between 1 and 12000
   or get_byte(bytes,20)*16777216::bigint+get_byte(bytes,21)*65536+get_byte(bytes,22)*256+get_byte(bytes,23) not between 1 and 12000 then raise exception 'invalid PNG dimensions' using errcode='22023'; end if;
  elsif m='image/svg+xml' and n ~* '\.svg$' then
   svg:=convert_from(bytes,'UTF8');
   if exists(select 1 from regexp_matches(svg,'<[[:space:]]*/?[[:space:]]*([[:alpha:]_][[:alnum:]_.:-]*)','g') t where lower(t[1]) not in ('svg','g','path','defs','lineargradient','radialgradient','stop','clippath','mask','pattern','rect','circle','ellipse','line','polyline','polygon','title','desc')) then raise exception 'unsupported SVG elements' using errcode='22023'; end if;
   if svg !~* '<svg[[:space:]>]' or svg !~* '</svg[[:space:]]*>' or svg ~* '<[[:space:]]*(script|foreignObject|iframe|object|embed|image|use|style|animate|set)\y|\yon[a-z]+[[:space:]]*=|\y(href|src)[[:space:]]*=|url[[:space:]]*\(|<!|<\?|&(#|[a-z])' then raise exception 'use self-contained static SVG artwork or PNG' using errcode='22023'; end if;
  else raise exception 'use PNG or SVG' using errcode='22023'; end if;
 elsif m is distinct from 'application/pdf' or n !~* '\.pdf$' or substring(bytes from 1 for 5)<>convert_to('%PDF-','UTF8') or position(convert_to('%%EOF','UTF8') in substring(bytes from greatest(1,octet_length(bytes)-2047)))=0 then
  raise exception 'use a complete PDF portfolio' using errcode='22023';
 end if;
 if p_revision is distinct from coalesce((select revision from team_files where event_id=p_event and team_id=p_team and kind=k),0) then raise exception 'file changed' using errcode='40001'; end if;
 insert into team_files(event_id,team_id,kind,name,mime,content,revision) values(p_event,p_team,k,n,m,bytes,p_revision+1)
 on conflict(event_id,team_id,kind) do update set name=excluded.name,mime=excluded.mime,content=excluded.content,revision=excluded.revision,updated_at=clock_timestamp();
end $$;
create function download_team_file(p_event uuid,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare f team_files;
begin
 select * into f from team_files where id=p_id and event_id=p_event;
 if f.id is null or not reads_team_file(f.event_id,f.team_id,f.kind) then raise exception 'file unavailable' using errcode='42501'; end if;
 return jsonb_build_object('id',f.id,'eventId',f.event_id,'teamId',f.team_id,'kind',f.kind,'name',f.name,'mime',f.mime,'size',octet_length(f.content),'revision',f.revision,'updatedAt',f.updated_at,'base64',replace(encode(f.content,'base64'),E'\n',''));
end $$;
revoke execute on function reads_team_file(uuid,uuid,text),list_team_files(uuid),upload_team_file(uuid,uuid,integer,jsonb),download_team_file(uuid,uuid) from public,anon,authenticated;
grant execute on function list_team_files(uuid),upload_team_file(uuid,uuid,integer,jsonb),download_team_file(uuid,uuid) to authenticated;
