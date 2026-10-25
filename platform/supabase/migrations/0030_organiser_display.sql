-- Keep sign-in/delivery addresses private when an organiser is listed by name.
alter table platform_organisers add column display_name text not null default '' check(length(display_name)<=100), add column hide_email boolean not null default false;
alter table platform_organisers add constraint organiser_hidden_name check(not hide_email or length(btrim(display_name))>0);
create or replace function platform_access() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare owner_id uuid; owner_email text; kind text;
begin
 select user_id,email into owner_id,owner_email from platform_owner;
 if auth.uid()=owner_id then kind:='admin'; else select scope into kind from platform_organisers where user_id=auth.uid(); end if;
 return jsonb_build_object('kind',kind,'ownerEmail',owner_email,'canManage',platform_manager(),
 'organisers',case when platform_manager() then (select coalesce(jsonb_agg(r),'[]') from (
 select owner_id as "userId",owner_email as email,'admin' as scope,true as permanent,''::text as name,false as "emailHidden"
 union all select user_id,case when hide_email then null else email end,scope,false,display_name,hide_email from platform_organisers where user_id<>owner_id) r) else '[]'::jsonb end,
 'invitations',case when platform_manager() then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email,'scope',scope,'emailStatus',email_status)),'[]') from organiser_invitations) else '[]'::jsonb end);
end $$;
revoke execute on function platform_access() from public,anon,authenticated;
grant execute on function platform_access() to authenticated;
