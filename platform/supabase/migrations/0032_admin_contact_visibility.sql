-- Only the permanent administrator may see a hidden organiser contact.
create or replace function platform_access() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare owner_id uuid; owner_email text; kind text;
begin
 select user_id,email into owner_id,owner_email from platform_owner;
 if auth.uid()=owner_id then kind:='admin'; else select scope into kind from platform_organisers where user_id=auth.uid(); end if;
 return jsonb_build_object('kind',kind,'ownerEmail',owner_email,'canManage',platform_manager(),
 'organisers',case when platform_manager() then (select coalesce(jsonb_agg(r),'[]') from (
 select owner_id as "userId",owner_email as email,'admin' as scope,true as permanent,''::text as name,false as "emailHidden"
 union all select user_id,case when hide_email and auth.uid()<>owner_id then null else email end,scope,false,display_name,(hide_email and auth.uid()<>owner_id) from platform_organisers where user_id<>owner_id) r) else '[]'::jsonb end,
 'invitations',case when platform_manager() then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email,'scope',scope,'emailStatus',email_status)),'[]') from organiser_invitations) else '[]'::jsonb end);
end $$;
revoke execute on function platform_access() from public,anon,authenticated;
grant execute on function platform_access() to authenticated;

-- Read contact addresses only through a listing that honours organiser privacy settings.
create or replace function list_event_people(p_event uuid) returns setof event_roles
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r event_roles; profile platform_organisers;
begin
 if not event_active(p_event) then return; end if;
 for r in select * from event_roles where event_id=p_event and (user_id=auth.uid() or is_chair_or_organiser(p_event)) loop
  select * into profile from platform_organisers where user_id=r.user_id;
  if profile.hide_email and not exists(select 1 from platform_owner where user_id=auth.uid()) then r.email:=null; r.display_name:=profile.display_name; end if;
  return next r;
 end loop;
end $$;
revoke select on event_roles from authenticated;
grant select(id,event_id,user_id,role,panel,team_id,display_name) on event_roles to authenticated;
revoke execute on function list_event_people(uuid) from public,anon,authenticated;
grant execute on function list_event_people(uuid) to authenticated;
create or replace function list_event_invitations(p_event uuid) returns setof invitations
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare i invitations; profile platform_organisers;
begin
 if not is_chair_or_organiser(p_event) then return; end if;
 for i in select * from invitations where event_id=p_event loop
  select * into profile from platform_organisers where lower(email)=lower(i.email);
  if profile.hide_email and not exists(select 1 from platform_owner where user_id=auth.uid()) then i.email:=''; i.display_name:=profile.display_name; end if;
  return next i;
 end loop;
end $$;
revoke select on invitations from authenticated;
grant select(id,event_id,role,panel,team_id,display_name,email_status,email_sent_at,email_attempt_at,email_attempt,email_failure) on invitations to authenticated;
revoke execute on function list_event_invitations(uuid) from public,anon,authenticated;
grant execute on function list_event_invitations(uuid) to authenticated;

-- Historical audit and broadcast records must not provide a back door to private contacts.
create function can_read_contact_audit(p_id bigint) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a audit_log;
begin
 select * into a from audit_log where id=p_id;
 if a.id is null or not (is_chair_or_organiser(a.event_id) or (a.event_id is null and platform_manager())) then return false; end if;
 return exists(select 1 from platform_owner where user_id=auth.uid()) or not exists(
  select 1 from platform_organisers p where p.hide_email and position(lower(p.email) in lower(coalesce(a.detail::text,'')))>0);
end $$;
create policy private_contact_audit on audit_log as restrictive for select to authenticated using(can_read_contact_audit(id));
create function can_read_contact_broadcast(p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare b broadcast_emails;
begin
 select * into b from broadcast_emails where id=p_id;
 -- INSERT RETURNING evaluates visibility before this stable lookup sees the new tuple.
 -- The existing insert policy still requires event staff; callers already supplied that content.
 if b.id is null then return true; end if;
 if not is_chair_or_organiser(b.event_id) then return false; end if;
 return exists(select 1 from platform_owner where user_id=auth.uid()) or not exists(
  select 1 from platform_organisers p where p.hide_email and position(lower(p.email) in lower(to_jsonb(b)::text))>0);
end $$;
create policy private_contact_broadcast on broadcast_emails as restrictive for select to authenticated using(can_read_contact_broadcast(id));
revoke execute on function can_read_contact_audit(bigint),can_read_contact_broadcast(uuid) from public,anon,authenticated;
grant execute on function can_read_contact_audit(bigint),can_read_contact_broadcast(uuid) to authenticated;
