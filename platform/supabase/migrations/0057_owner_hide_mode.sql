-- Hide mode: a setting only the permanent owner has. While it is on, the owner's own screens show the Test Event and
-- nothing else. It changes what the owner sees, not what the owner may do, so it lives in its own table and is read
-- and written only through the two functions below.
create table owner_preferences (
  user_id uuid primary key,
  hide_mode boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table owner_preferences enable row level security;
revoke all on owner_preferences from public, anon, authenticated;

-- False for everyone except the owner with hide mode switched on.
create function owner_hide_mode() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
 select is_platform_owner() and coalesce((select hide_mode from owner_preferences where user_id=auth.uid()), false)
$$;

create function set_owner_hide_mode(p_on boolean) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if not is_platform_owner() then raise exception 'only the platform owner has hide mode' using errcode='42501'; end if;
 insert into owner_preferences(user_id, hide_mode, updated_at) values (auth.uid(), coalesce(p_on, false), now())
 on conflict (user_id) do update set hide_mode=excluded.hide_mode, updated_at=excluded.updated_at;
 return coalesce(p_on, false);
end $$;

revoke execute on function owner_hide_mode(), set_owner_hide_mode(boolean) from public, anon;
grant execute on function owner_hide_mode(), set_owner_hide_mode(boolean) to authenticated;

-- events.created_by names the account that made each event, which for the Test Event is the owner. The app never
-- reads it, so signed-in users can now read every column except that one. Row security and the functions that use
-- created_by run with their own rights and are unaffected.
do $$
declare cols text;
begin
 select string_agg(quote_ident(attname), ',' order by attnum) into cols
 from pg_attribute where attrelid='events'::regclass and attnum>0 and not attisdropped and attname<>'created_by';
 -- Signed-out visitors keep exactly the columns they could read before, minus created_by.
 if has_table_privilege('anon','events','select') then
  revoke select on events from anon;
  execute format('grant select (%s) on events to anon', cols);
 end if;
 revoke select (created_by) on events from anon;
 revoke select on events from authenticated;
 revoke select (created_by) on events from authenticated;
 execute format('grant select (%s) on events to authenticated', cols);
end $$;
