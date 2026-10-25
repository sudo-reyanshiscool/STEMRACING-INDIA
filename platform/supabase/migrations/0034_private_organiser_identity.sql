-- A private organiser remains fully authorised but is absent from other people's directories.
alter table platform_organisers add column hide_identity boolean not null default false;
update platform_organisers set hide_identity=true where user_id='c153b6f9-2e5e-4d58-8f85-ab9108331f84';
create function organiser_identity_visible(p_user uuid,p_email text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
 select exists(select 1 from platform_owner where user_id=auth.uid()) or not exists(
 select 1 from platform_organisers p where p.hide_identity and (p.user_id=p_user or lower(p.email)=lower(p_email)))
$$;
create policy private_organiser_roles on event_roles as restrictive for select to authenticated using(organiser_identity_visible(user_id,null));
create policy private_organiser_invitations on invitations as restrictive for select to authenticated using(organiser_identity_visible(null,email));
revoke execute on function organiser_identity_visible(uuid,text) from public,anon,authenticated;
grant execute on function organiser_identity_visible(uuid,text) to authenticated;

create or replace function platform_access() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare result jsonb; owner_id uuid;
begin
 result:=platform_access_contacts();
 select user_id into owner_id from platform_owner;
 return result||jsonb_build_object('viewerId',auth.uid(),'ownerId',owner_id,'organisers',
 (select coalesce(jsonb_agg(person||jsonb_build_object('contactRestricted',coalesce(p.hide_email,false),'identityRestricted',coalesce(p.hide_identity,false))),'[]'::jsonb)
 from jsonb_array_elements(result->'organisers') person left join platform_organisers p on p.user_id::text=person->>'userId' where not coalesce(p.hide_identity,false) or auth.uid()=owner_id),'invitations',(select coalesce(jsonb_agg(inv),'[]'::jsonb) from jsonb_array_elements(result->'invitations') inv where auth.uid()=owner_id or not exists(select 1 from platform_organisers p where p.hide_identity and p.email=inv->>'email')));
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
  if profile.hide_identity and not exists(select 1 from platform_owner where user_id=auth.uid()) then continue; end if;
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
  if profile.hide_identity and not exists(select 1 from platform_owner where user_id=auth.uid()) then continue; end if;
  if profile.hide_email and not exists(select 1 from platform_owner where user_id=auth.uid()) then i.email:=''; i.display_name:=profile.display_name; end if;
  return next i;
 end loop;
end $$;
revoke select on invitations from authenticated;
grant select(id,event_id,role,panel,team_id,display_name,email_status,email_sent_at,email_attempt_at,email_attempt,email_failure) on invitations to authenticated;
revoke execute on function list_event_invitations(uuid) from public,anon,authenticated;
grant execute on function list_event_invitations(uuid) to authenticated;

create or replace function can_read_contact_audit(p_id bigint) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a audit_log;
begin
 select * into a from audit_log where id=p_id;
 if a.id is null or not (is_chair_or_organiser(a.event_id) or (a.event_id is null and platform_manager())) then return false; end if;
 return exists(select 1 from platform_owner where user_id=auth.uid()) or not exists(
  select 1 from platform_organisers p where (p.hide_email and position(lower(p.email) in lower(coalesce(a.detail::text,'')))>0) or (p.hide_identity and (a.actor=p.user_id or a.entity_id=p.user_id::text or position(p.user_id::text in coalesce(a.detail::text,''))>0 or position(lower(p.display_name) in lower(coalesce(a.detail::text,'')))>0)));
end $$;
create or replace function can_read_contact_broadcast(p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare b broadcast_emails;
begin
 select * into b from broadcast_emails where id=p_id;
 -- INSERT RETURNING evaluates visibility before this stable lookup sees the new tuple.
 -- The existing insert policy still requires event staff; callers already supplied that content.
 if b.id is null then return true; end if;
 if not is_chair_or_organiser(b.event_id) then return false; end if;
 return exists(select 1 from platform_owner where user_id=auth.uid()) or not exists(
  select 1 from platform_organisers p where (p.hide_email and position(lower(p.email) in lower(to_jsonb(b)::text))>0) or (p.hide_identity and (b.sender_id=p.user_id or position(lower(p.display_name) in lower(to_jsonb(b)::text))>0)));
end $$;
