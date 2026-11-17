-- The permanent owner is private unconditionally. Until now that depended on the owner's organiser row
-- carrying hide_identity; with the row absent or the flag cleared, the owner's address and id were listed again.
-- Every predicate below now names the owner directly, and the row itself can no longer be made visible.
create or replace function organiser_identity_visible(p_user uuid,p_email text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
 select is_platform_owner() or (not exists(select 1 from platform_owner o where o.user_id=p_user or lower(o.email)=lower(p_email))
 and not exists(select 1 from platform_organisers p where p.hide_identity and (p.user_id=p_user or lower(p.email)=lower(p_email)))
 and not exists(select 1 from organiser_invitations i where i.hide_identity and (lower(i.email)=lower(p_email) or exists(select 1 from auth.users u where u.id=p_user and lower(u.email)=lower(i.email)))))
$$;

create function keep_owner_private() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if exists(select 1 from platform_owner where user_id=new.user_id) then new.hide_identity:=true; new.hide_email:=true; end if;
 return new;
end $$;
revoke execute on function keep_owner_private() from public,anon,authenticated;
create trigger owner_always_private before insert or update on platform_organisers for each row execute function keep_owner_private();
update platform_organisers set hide_identity=true,hide_email=true where user_id in (select user_id from platform_owner);

create or replace function platform_access_private_directory() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare result jsonb; owner_id uuid; owner_email text;
begin
 result:=platform_access_contacts(); select user_id,lower(email) into owner_id,owner_email from platform_owner;
 if platform_spectator() then result:=result||jsonb_build_object('organisers',(select coalesce(jsonb_agg(x),'[]') from (
  select p.user_id as "userId",case when p.hide_email then null else p.email end as email,p.scope,false as permanent,p.display_name as name,p.hide_email as "emailHidden" from platform_organisers p where not p.hide_identity) x)); end if;
 return result||jsonb_build_object('viewerId',auth.uid(),'ownerId',owner_id,'organisers',
 (select coalesce(jsonb_agg(person||jsonb_build_object('contactRestricted',coalesce(p.hide_email,false),'identityRestricted',coalesce(p.hide_identity,false))),'[]'::jsonb)
 from jsonb_array_elements(result->'organisers') person left join platform_organisers p on p.user_id::text=person->>'userId'
 where auth.uid()=owner_id or (not coalesce(p.hide_identity,false) and person->>'userId' is distinct from owner_id::text)),
 'invitations',(select coalesce(jsonb_agg(inv||jsonb_build_object('name',i.display_name,'identityRestricted',i.hide_identity)),'[]'::jsonb)
 from jsonb_array_elements(result->'invitations') inv join organiser_invitations i on i.id::text=inv->>'id'
 where auth.uid()=owner_id or (not i.hide_identity and i.scope<>'spectator' and lower(inv->>'email') is distinct from owner_email
  and not exists(select 1 from platform_organisers p where p.hide_identity and p.email=inv->>'email'))));
end $$;

create or replace function platform_access_display_titles() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
 result:=platform_access_private_directory();
 result:=result||jsonb_build_object('displayTitle',(select display_title from platform_organisers where user_id=auth.uid()),'organisers',
 (select coalesce(jsonb_agg(person||jsonb_build_object('displayTitle',p.display_title)),'[]'::jsonb)
 from jsonb_array_elements(result->'organisers') person left join platform_organisers p on p.user_id::text=person->>'userId'));
 if not is_platform_owner() then result:=(result-'ownerId')||jsonb_build_object('ownerEmail',''); end if;
 return result;
end $$;

create or replace function can_read_contact_audit(p_id bigint) returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a audit_log;
begin
 select * into a from audit_log where id=p_id;
 if a.id is null or not (is_chair_or_organiser(a.event_id) or (a.event_id is null and platform_manager()) or (platform_spectator() and (a.event_id is null or event_active(a.event_id)))) then return false; end if;
 return is_platform_owner() or (not exists(
  select 1 from platform_owner o where a.actor=o.user_id or a.entity_id=o.user_id::text or position(o.user_id::text in coalesce(a.detail::text,''))>0 or position(lower(o.email) in lower(coalesce(a.detail::text,'')))>0)
 and not exists(
  select 1 from platform_organisers p where (p.hide_email and position(lower(p.email) in lower(coalesce(a.detail::text,'')))>0) or (p.hide_identity and (a.actor=p.user_id or a.entity_id=p.user_id::text or position(p.user_id::text in coalesce(a.detail::text,''))>0 or position(lower(p.display_name) in lower(coalesce(a.detail::text,'')))>0))));
end $$;

create or replace function can_read_contact_broadcast(p_id uuid) returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare b broadcast_emails;
begin
 select * into b from broadcast_emails where id=p_id;
 -- INSERT RETURNING evaluates visibility before this stable lookup sees the new tuple.
 -- The existing insert policy still requires event staff; callers already supplied that content.
 if b.id is null then return true; end if;
 if not (is_chair_or_organiser(b.event_id) or (platform_spectator() and event_active(b.event_id))) then return false; end if;
 return is_platform_owner() or (not exists(
  select 1 from platform_owner o where b.sender_id=o.user_id or position(lower(o.email) in lower(to_jsonb(b)::text))>0)
 and not exists(
  select 1 from platform_organisers p where (p.hide_email and position(lower(p.email) in lower(to_jsonb(b)::text))>0) or (p.hide_identity and (b.sender_id=p.user_id or position(lower(p.display_name) in lower(to_jsonb(b)::text))>0))));
end $$;
