-- The big screen on another device (a second laptop, a browser source in streaming software).
-- The Graphics tab publishes what is on screen; a browser holding the event's screen key reads it without signing in.
-- The key is the only thing that opens these reads: it is long, random, made here, and handed only to organisers and the Chair.
create table show_screens (
 event_id uuid primary key references events(id) on delete cascade,
 key text not null default replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),
 n bigint not null default 0,
 state jsonb,
 updated_at timestamptz not null default clock_timestamp()
);
alter table show_screens enable row level security;
revoke all on show_screens from public,anon,authenticated;

-- The key for this event's screen link, made on first use, and the number of the last state published (0: none yet).
create function show_screen_link(p_event uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s show_screens;
begin
 if not is_chair_or_organiser(p_event) then raise exception 'event staff required' using errcode='42501';end if;
 insert into show_screens(event_id) values(p_event) on conflict(event_id) do nothing;
 select * into s from show_screens where event_id=p_event;
 return jsonb_build_object('key',s.key,'n',s.n);
end $$;

-- Each state gets a number higher than the last, whatever the clock of the laptop sending it says,
-- so a following screen only ever has to ask for "anything after the one I have".
create function publish_show_screen(p_event uuid,p_n bigint,p_state jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if not is_chair_or_organiser(p_event) then raise exception 'event staff required' using errcode='42501';end if;
 if p_n is null or p_n<=0 or p_state is null or jsonb_typeof(p_state)<>'object' or length(p_state::text)>524288 then raise exception 'invalid screen state' using errcode='22023';end if;
 insert into show_screens(event_id,n,state) values(p_event,p_n,p_state)
 on conflict(event_id) do update set n=greatest(excluded.n,show_screens.n+1),state=excluded.state,updated_at=clock_timestamp();
end $$;

-- What is on screen, for a browser that holds the key. Null when nothing newer than p_after has been published.
create function show_screen_state(p_event uuid,p_key text,p_after bigint default 0) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s show_screens;
begin
 select * into s from show_screens where event_id=p_event and key=p_key;
 if s.event_id is null or not event_active(p_event) then raise exception 'screen link not valid' using errcode='42501';end if;
 if s.state is null or s.n<=coalesce(p_after,0) then return null;end if;
 return jsonb_build_object('n',s.n,'state',s.state);
end $$;

-- One team picture the graphics draw, for a browser that holds the key: the same four the Graphics tab hands over,
-- and the photograph only once it is approved for broadcast.
create function show_screen_picture(p_event uuid,p_key text,p_team uuid,p_asset text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare m text;b bytea;
begin
 if not exists(select 1 from show_screens where event_id=p_event and key=p_key) or not event_active(p_event) then raise exception 'screen link not valid' using errcode='42501';end if;
 if p_asset='team_logo' then select mime,content into m,b from team_files where event_id=p_event and team_id=p_team and kind='logo';
 elsif p_asset in ('school_logo','car_render_fl') then select mime,content into m,b from team_media_files where event_id=p_event and team_id=p_team and kind=p_asset;
 elsif p_asset='official_photo_approved' then select 'image/png',approved_content into m,b from team_photos where event_id=p_event and team_id=p_team and approval_status='approved';
 else raise exception 'picture unavailable' using errcode='22023';end if;
 if b is null or m is null or m not like 'image/%' then raise exception 'picture unavailable' using errcode='22023';end if;
 return jsonb_build_object('mime',m,'base64',replace(encode(b,'base64'),E'\n',''));
end $$;
alter function show_screen_picture(uuid,text,uuid,text) set statement_timeout = '45s';

revoke execute on function show_screen_link(uuid),publish_show_screen(uuid,bigint,jsonb),show_screen_state(uuid,text,bigint),show_screen_picture(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function show_screen_link(uuid),publish_show_screen(uuid,bigint,jsonb) to authenticated;
grant execute on function show_screen_state(uuid,text,bigint),show_screen_picture(uuid,text,uuid,text) to anon,authenticated;
