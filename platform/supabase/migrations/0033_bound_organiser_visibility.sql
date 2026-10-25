-- Bind the organiser response to its authenticated viewer and retain the privacy flag for UI checks.
alter function platform_access() rename to platform_access_contacts;
revoke execute on function platform_access_contacts() from public,anon,authenticated;
create function platform_access() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare result jsonb; owner_id uuid;
begin
 result:=platform_access_contacts();
 select user_id into owner_id from platform_owner;
 return result||jsonb_build_object('viewerId',auth.uid(),'ownerId',owner_id,'organisers',
 (select coalesce(jsonb_agg(person||jsonb_build_object('contactRestricted',coalesce(p.hide_email,false))),'[]'::jsonb)
 from jsonb_array_elements(result->'organisers') person left join platform_organisers p on p.user_id::text=person->>'userId'));
end $$;
revoke execute on function platform_access() from public,anon,authenticated;
grant execute on function platform_access() to authenticated;
