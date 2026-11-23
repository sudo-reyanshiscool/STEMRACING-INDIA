-- Event names follow one pattern: "STEM Racing India <City> Regionals <n> <Year>" or "STEM Racing India <City> Nationals <Year>".
-- Each city keeps its own regional count per year. Existing events keep their stored names (custom_name = true) until renamed.
alter table events
  add column city text check (city is null or char_length(btrim(city)) between 1 and 60),
  add column event_year integer check (event_year is null or event_year between 2000 and 2100),
  add column regional_number integer check (regional_number is null or regional_number between 1 and 99),
  add column custom_name boolean not null default true;
grant select(city,event_year,regional_number,custom_name) on events to anon,authenticated;

-- Naming parts change only through create_named_events and rename_event, which keep the name and its parts in step.
create function event_naming_guard() returns trigger language plpgsql as $$
begin
 if current_user in ('authenticated','anon') and (tg_op='INSERT' and (new.city is not null or new.event_year is not null or new.regional_number is not null or not new.custom_name)
  or tg_op='UPDATE' and (new.city is distinct from old.city or new.event_year is distinct from old.event_year or new.regional_number is distinct from old.regional_number or new.custom_name is distinct from old.custom_name))
 then raise exception 'change event names through rename_event' using errcode='42501'; end if;
 return new;
end $$;
create trigger event_naming_guard before insert or update on events for each row execute function event_naming_guard();

create function event_display_name(p_level text,p_city text,p_number integer,p_year integer) returns text
language sql immutable set search_path = public, pg_temp as $$
 select 'STEM Racing India '||regexp_replace(btrim(p_city),'\s+',' ','g')||case when p_level='regional' then ' Regionals '||p_number else ' Nationals' end||' '||p_year
$$;

-- Callers hold the numbering lock, so two organisers creating Delhi regionals at once never receive the same number.
create function next_regional_number(p_city text,p_year integer,p_except uuid default null) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
 select coalesce(max(regional_number),0)+1 from events
 where competition_level='regional' and deleted_at is null and event_year=p_year and id is distinct from p_except
   and lower(regexp_replace(btrim(city),'\s+',' ','g'))=lower(regexp_replace(btrim(p_city),'\s+',' ','g'))
$$;

create function checked_event_city(p_city text) returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare c text:=regexp_replace(btrim(coalesce(p_city,'')),'\s+',' ','g');
begin
 if char_length(c) not between 1 and 60 then raise exception 'enter the city (up to 60 characters)' using errcode='22023'; end if;
 return c;
end $$;

create function checked_event_year(p_year integer) returns integer language plpgsql immutable set search_path = public, pg_temp as $$
begin
 if p_year is null or p_year not between 2000 and 2100 then raise exception 'enter a year between 2000 and 2100' using errcode='22023'; end if;
 return p_year;
end $$;

-- Creates one or more events together, all or nothing. Each item: {level, city, year, startsOn?, logos?}.
create function create_named_events(p_events jsonb,p_ruleset jsonb) returns setof events
language plpgsql security definer set search_path = public, pg_temp as $$
declare x jsonb; e events; lvl text; c text; y integer; n integer; d date;
begin
 if auth.uid() is null then raise exception 'sign in required' using errcode='28000'; end if;
 if not can_create_event() then raise exception 'only organisers can create events' using errcode='42501'; end if;
 if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events) not between 1 and 30 then raise exception 'create between 1 and 30 events at a time' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtext('stem_racing_regional_numbers'));
 for x in select * from jsonb_array_elements(p_events) loop
  lvl:=x->>'level';
  if lvl is null or lvl not in ('regional','national') then raise exception 'choose Regionals or Nationals' using errcode='22023'; end if;
  c:=checked_event_city(x->>'city');
  if jsonb_typeof(x->'year') is distinct from 'number' then raise exception 'enter a year between 2000 and 2100' using errcode='22023'; end if;
  y:=checked_event_year((x->>'year')::numeric::integer);
  d:=nullif(x->>'startsOn','')::date;
  n:=case when lvl='regional' then next_regional_number(c,y) end;
  e:=create_branded_event(event_display_name(lvl,c,n,y),d,p_ruleset,lvl,case when lvl='national' then x->'logos' end);
  update events set city=c,event_year=y,regional_number=n,custom_name=false where id=e.id returning * into e;
  return next e;
 end loop;
end $$;

-- Rebuilds the name from its parts, or stores a custom name. A null number keeps the current one, or picks the
-- next free number when the city or year changes. The level is fixed at creation because nationals carry logos.
create function rename_event(p_event uuid,p_city text,p_year integer,p_number integer default null,p_custom_name text default null) returns events
language plpgsql security definer set search_path = public, pg_temp as $$
declare e events; c text; y integer; n integer; nm text;
begin
 if auth.uid() is null then raise exception 'sign in required' using errcode='28000'; end if;
 select * into e from events where id=p_event for update;
 if not found or not event_active(p_event) or not (has_role(p_event,'organiser') or has_role(p_event,'chair')) then raise exception 'only organisers and Chairs can rename events' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtext('stem_racing_regional_numbers'));
 nm:=regexp_replace(btrim(coalesce(p_custom_name,'')),'\s+',' ','g');
 if nm<>'' then
  if char_length(nm)>120 then raise exception 'event names are up to 120 characters' using errcode='22023'; end if;
  c:=case when nullif(btrim(coalesce(p_city,'')),'') is not null then checked_event_city(p_city) end;
  y:=case when p_year is not null then checked_event_year(p_year) end;
  update events set name=nm,custom_name=true,city=c,event_year=y,regional_number=case when e.competition_level='regional' and c is not null and y is not null then coalesce(p_number,e.regional_number) end
   where id=p_event returning * into e;
 else
  if e.competition_level is null then raise exception 'set a custom name: this event has no competition level' using errcode='22023'; end if;
  c:=checked_event_city(p_city); y:=checked_event_year(p_year);
  if e.competition_level='regional' then
   if p_number is not null and p_number not between 1 and 99 then raise exception 'regional numbers run from 1 to 99' using errcode='22023'; end if;
   n:=coalesce(p_number,case when e.regional_number is not null and e.event_year=y and lower(e.city)=lower(c) then e.regional_number end,next_regional_number(c,y,p_event));
  end if;
  update events set name=event_display_name(e.competition_level,c,n,y),custom_name=false,city=c,event_year=y,regional_number=n where id=p_event returning * into e;
 end if;
 perform audit_write(p_event,'rename','events',p_event::text,jsonb_build_object('name',e.name));
 return e;
end $$;

revoke execute on function event_naming_guard(),event_display_name(text,text,integer,integer),next_regional_number(text,integer,uuid),checked_event_city(text),checked_event_year(integer),create_named_events(jsonb,jsonb),rename_event(uuid,text,integer,integer,text) from public,anon,authenticated;
grant execute on function create_named_events(jsonb,jsonb),rename_event(uuid,text,integer,integer,text) to authenticated;
