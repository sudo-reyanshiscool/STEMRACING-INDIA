-- Display titles never participate in authorization: scope and ownership remain
-- the only permission inputs. This lets an organiser carry an administrator title.
alter table platform_organisers add column display_title text check(display_title is null or display_title='Platform Administrator');
-- Keep the existing directory/privacy rules, then remove owner metadata too when
-- the owner's privacy profile is hidden. Only the owner retains that metadata.
alter function platform_access() rename to platform_access_private_directory;
revoke execute on function platform_access_private_directory() from public,anon,authenticated;
create function platform_access() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare result jsonb; private_owner boolean;
begin
 result:=platform_access_private_directory();
 select exists(select 1 from platform_owner o join platform_organisers p on p.user_id=o.user_id where p.hide_identity) into private_owner;
 result:=result||jsonb_build_object('displayTitle',(select display_title from platform_organisers where user_id=auth.uid()),'organisers',
 (select coalesce(jsonb_agg(person||jsonb_build_object('displayTitle',p.display_title)),'[]'::jsonb)
 from jsonb_array_elements(result->'organisers') person left join platform_organisers p on p.user_id::text=person->>'userId'));
 if private_owner and not is_platform_owner() then result:=(result-'ownerId')||jsonb_build_object('ownerEmail',''); end if;
 return result;
end $$;
revoke execute on function platform_access() from public,anon,authenticated;
grant execute on function platform_access() to authenticated;
