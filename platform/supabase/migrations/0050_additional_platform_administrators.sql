-- Additional administrators have administrative controls without inheriting the
-- permanent owner's exception for reading private identities.
create table platform_administrators (
 user_id uuid primary key references platform_organisers(user_id) on delete cascade
);
alter table platform_administrators enable row level security;
revoke all on platform_administrators from public,anon,authenticated;
alter table platform_organisers add column public_alias text check(public_alias is null or (length(public_alias) between 1 and 100 and public_alias !~ '[[:cntrl:]]'));
create function platform_administrator() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
 select is_platform_owner() or exists(select 1 from platform_administrators where user_id=auth.uid())
$$;
revoke execute on function platform_administrator() from public,anon,authenticated;
grant execute on function platform_administrator() to authenticated;
-- Update only mutation authorization. Privacy predicates continue to use the
-- immutable owner identity, never the administrator display title or this grant.
do $upgrade$
declare n text; f record; definition text;
begin
 foreach n in array array['invite_platform_member','set_organiser_visibility','remove_organiser','withdraw_organiser_invitation','reserve_invitation_email'] loop
  for f in select p.oid from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname=current_schema() and p.proname=n loop
   definition:=replace(pg_get_functiondef(f.oid),'not is_platform_owner()','not platform_administrator()');
   if n in ('withdraw_organiser_invitation','reserve_invitation_email') then
    definition:=replace(definition,'begin',E'begin\n if not is_platform_owner() and exists(select 1 from organiser_invitations where id=p_invitation and hide_identity) then raise exception ''private invitations are managed by their owner'' using errcode=''42501'';end if;');
   end if;
   execute definition;
  end loop;
 end loop;
end $upgrade$;
-- Ordinary organisers must not revoke an additional administrator.
alter function remove_organiser(uuid) rename to remove_organiser_member;
revoke execute on function remove_organiser_member(uuid) from public,anon,authenticated;
create function remove_organiser(p_user uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if not is_platform_owner() and exists(select 1 from platform_organisers where user_id=p_user and hide_identity) then raise exception 'private accounts are managed by their owner' using errcode='42501';end if;
 if exists(select 1 from platform_administrators where user_id=p_user) and not platform_administrator() then raise exception 'only administrators can change this grant' using errcode='42501';end if;
 perform remove_organiser_member(p_user);
end $$;
revoke execute on function remove_organiser(uuid) from public,anon,authenticated;
grant execute on function remove_organiser(uuid) to authenticated;
alter function platform_access() rename to platform_access_display_titles;
revoke execute on function platform_access_display_titles() from public,anon,authenticated;
create function platform_access() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
 result:=platform_access_display_titles();
 if exists(select 1 from platform_administrators where user_id=auth.uid()) then result:=result||jsonb_build_object('kind','admin');end if;
 return result||jsonb_build_object('canAdminister',platform_administrator(),'organisers',
 (select coalesce(jsonb_agg(person||case when a.user_id is not null then jsonb_build_object('scope','admin') else '{}'::jsonb end||
 case when p.public_alias is not null then jsonb_build_object('name',p.public_alias,'email',p.public_alias,'emailHidden',false,'contactRestricted',false) else '{}'::jsonb end),'[]'::jsonb)
 from jsonb_array_elements(result->'organisers') person left join platform_organisers p on p.user_id::text=person->>'userId' left join platform_administrators a on a.user_id=p.user_id));
end $$;
revoke execute on function platform_access() from public,anon,authenticated;
grant execute on function platform_access() to authenticated;

-- A new administrator cannot unhide protected accounts or use mutation endpoints
-- to infer/revoke those grants. Keep the original privacy boundary intact.
alter function set_organiser_visibility(uuid,text,boolean) rename to set_organiser_visibility_member;
revoke execute on function set_organiser_visibility_member(uuid,text,boolean) from public,anon,authenticated;
create function set_organiser_visibility(p_user uuid,p_name text,p_hidden boolean) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if not is_platform_owner() and exists(select 1 from platform_organisers where user_id=p_user and hide_identity) then raise exception 'private accounts are managed by their owner' using errcode='42501';end if;
 perform set_organiser_visibility_member(p_user,p_name,p_hidden);
end $$;
revoke execute on function set_organiser_visibility(uuid,text,boolean) from public,anon,authenticated;
grant execute on function set_organiser_visibility(uuid,text,boolean) to authenticated;
