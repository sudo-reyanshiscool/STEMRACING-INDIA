-- Event names can end in a season as well as a single year: "STEM Racing India Mumbai Regionals 1 2026-27".
-- season holds what the name shows (2027 or 2026-27); event_year stays the starting year. Regional numbers count per
-- city and season, so 2026-27 and 2027 keep separate counts.
alter table events add column season text check (season is null or season ~ '^[0-9]{4}(-[0-9]{2})?$');
update events set season=event_year::text where event_year is not null;
grant select(season) on events to anon,authenticated;

create or replace function event_naming_guard() returns trigger language plpgsql as $$
begin
 if current_user in ('authenticated','anon') and (tg_op='INSERT' and (new.city is not null or new.event_year is not null or new.season is not null or new.regional_number is not null or not new.custom_name)
  or tg_op='UPDATE' and (new.city is distinct from old.city or new.event_year is distinct from old.event_year or new.season is distinct from old.season or new.regional_number is distinct from old.regional_number or new.custom_name is distinct from old.custom_name))
 then raise exception 'change event names through rename_event' using errcode='42501'; end if;
 return new;
end $$;

-- Accepts 2027, 2026-27 or 2026-2027 (en and em dashes too) and returns 2027 or 2026-27. A season covers consecutive years.
create function checked_event_season(p_season text) returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare s text:=translate(btrim(coalesce(p_season,'')),'–—','--'); a integer; b text;
begin
 if s ~ '^[0-9]{4}$' and s::integer between 2000 and 2100 then return s; end if;
 if s ~ '^[0-9]{4}-([0-9]{2}|[0-9]{4})$' then
  a:=left(s,4)::integer; b:=split_part(s,'-',2);
  if a between 2000 and 2099 and ((length(b)=2 and b::integer=(a+1)%100) or (length(b)=4 and b::integer=a+1)) then return a||'-'||lpad(((a+1)%100)::text,2,'0'); end if;
 end if;
 raise exception 'enter a year such as 2027, or a season such as 2026-27' using errcode='22023';
end $$;

create function event_display_name(p_level text,p_city text,p_number integer,p_season text) returns text
language sql immutable set search_path = public, pg_temp as $$
 select 'STEM Racing India '||regexp_replace(btrim(p_city),'\s+',' ','g')||case when p_level='regional' then ' Regionals '||p_number else ' Nationals' end||' '||p_season
$$;

create function next_regional_number(p_city text,p_season text,p_except uuid default null) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
 select coalesce(max(regional_number),0)+1 from events
 where competition_level='regional' and deleted_at is null and season=p_season and id is distinct from p_except
   and lower(regexp_replace(btrim(city),'\s+',' ','g'))=lower(regexp_replace(btrim(p_city),'\s+',' ','g'))
$$;

-- Each item: {level, city, season (or the older numeric year), startsOn?, logos?}.
create or replace function create_named_events(p_events jsonb,p_ruleset jsonb) returns setof events
language plpgsql security definer set search_path = public, pg_temp as $$
declare x jsonb; e events; lvl text; c text; s text; n integer; d date;
begin
 if auth.uid() is null then raise exception 'sign in required' using errcode='28000'; end if;
 if not can_create_event() then raise exception 'only organisers can create events' using errcode='42501'; end if;
 if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events) not between 1 and 30 then raise exception 'create between 1 and 30 events at a time' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtext('stem_racing_regional_numbers'));
 for x in select * from jsonb_array_elements(p_events) loop
  lvl:=x->>'level';
  if lvl is null or lvl not in ('regional','national') then raise exception 'choose Regionals or Nationals' using errcode='22023'; end if;
  c:=checked_event_city(x->>'city');
  s:=checked_event_season(coalesce(x->>'season',x->>'year'));
  d:=nullif(x->>'startsOn','')::date;
  n:=case when lvl='regional' then next_regional_number(c,s) end;
  e:=create_branded_event(event_display_name(lvl,c,n,s),d,p_ruleset,lvl,case when lvl='national' then x->'logos' end);
  update events set city=c,season=s,event_year=left(s,4)::integer,regional_number=n,custom_name=false where id=e.id returning * into e;
  return next e;
 end loop;
end $$;

-- Rebuilds the name from city, number and season, or stores a custom name. A null number keeps the current one, or
-- picks the next free number when the city or season changes. The level is fixed at creation.
create function rename_event(p_event uuid,p_city text,p_season text,p_number integer default null,p_custom_name text default null) returns events
language plpgsql security definer set search_path = public, pg_temp as $$
declare e events; c text; s text; n integer; nm text;
begin
 if auth.uid() is null then raise exception 'sign in required' using errcode='28000'; end if;
 select * into e from events where id=p_event for update;
 if not found or not event_active(p_event) or not (has_role(p_event,'organiser') or has_role(p_event,'chair')) then raise exception 'only organisers and Chairs can rename events' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtext('stem_racing_regional_numbers'));
 nm:=regexp_replace(btrim(coalesce(p_custom_name,'')),'\s+',' ','g');
 if nm<>'' then
  if char_length(nm)>120 then raise exception 'event names are up to 120 characters' using errcode='22023'; end if;
  c:=case when nullif(btrim(coalesce(p_city,'')),'') is not null then checked_event_city(p_city) end;
  s:=case when nullif(btrim(coalesce(p_season,'')),'') is not null then checked_event_season(p_season) end;
  update events set name=nm,custom_name=true,city=c,season=s,event_year=left(s,4)::integer,
   regional_number=case when e.competition_level='regional' and c is not null and s is not null then coalesce(p_number,e.regional_number) end
   where id=p_event returning * into e;
 else
  if e.competition_level is null then raise exception 'set a custom name: this event has no competition level' using errcode='22023'; end if;
  c:=checked_event_city(p_city); s:=checked_event_season(p_season);
  if e.competition_level='regional' then
   if p_number is not null and p_number not between 1 and 99 then raise exception 'regional numbers run from 1 to 99' using errcode='22023'; end if;
   n:=coalesce(p_number,case when e.regional_number is not null and e.season=s and lower(e.city)=lower(c) then e.regional_number end,next_regional_number(c,s,p_event));
  end if;
  update events set name=event_display_name(e.competition_level,c,n,s),custom_name=false,city=c,season=s,event_year=left(s,4)::integer,regional_number=n where id=p_event returning * into e;
 end if;
 perform audit_write(p_event,'rename','events',p_event::text,jsonb_build_object('name',e.name));
 return e;
end $$;

-- The 0055 signature stays callable, so an app published before this migration keeps working until it reloads.
create or replace function rename_event(p_event uuid,p_city text,p_year integer,p_number integer default null,p_custom_name text default null) returns events
language sql security definer set search_path = public, pg_temp as $$
 select * from rename_event(p_event,p_city,p_year::text,p_number,p_custom_name)
$$;

drop function next_regional_number(text,integer,uuid);
drop function event_display_name(text,text,integer,integer);
drop function checked_event_year(integer);
revoke execute on function checked_event_season(text),event_display_name(text,text,integer,text),next_regional_number(text,text,uuid),rename_event(uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function rename_event(uuid,text,text,integer,text) to authenticated;
