-- The owner may create hidden organisers and grant a separate read-only platform scope.
alter table platform_organisers drop constraint platform_organisers_scope_check;
alter table platform_organisers add constraint platform_organisers_scope_check check(scope in ('competition','platform','spectator'));
alter table organiser_invitations drop constraint organiser_invitations_scope_check;
alter table organiser_invitations add constraint organiser_invitations_scope_check check(scope in ('competition','platform','spectator'));
alter table organiser_invitations add column display_name text not null default '' check(length(display_name)<=100), add column hide_identity boolean not null default false;
alter table organiser_invitations add constraint hidden_invitation_name check(not hide_identity or length(btrim(display_name))>0);
create function is_platform_owner() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
 select exists(select 1 from platform_owner where user_id=auth.uid())
$$;
create function platform_spectator() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
 select exists(select 1 from platform_organisers where user_id=auth.uid() and scope='spectator')
$$;
create function invite_platform_member(p_email text,p_scope text,p_name text default '',p_hidden boolean default false) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare target text:=lower(btrim(p_email)); n text:=btrim(coalesce(p_name,'')); result uuid;
begin
 if not platform_manager() then raise exception 'only platform organisers can manage organiser access' using errcode='42501'; end if;
 if (p_hidden or p_scope='spectator') and not is_platform_owner() then raise exception 'only the Platform Admin can grant this access' using errcode='42501'; end if;
 if p_scope is null or p_scope not in ('competition','platform','spectator') or p_hidden is null or length(n)>100 or (p_hidden and n='') then raise exception 'invalid platform member details' using errcode='22023'; end if;
 if exists(select 1 from platform_owner where email=target) then raise exception 'permanent administrator cannot be changed' using errcode='42501'; end if;
 if exists(select 1 from platform_organisers where email=target) then raise exception 'organiser already assigned' using errcode='23505'; end if;
 insert into organiser_invitations(email,scope,created_by,display_name,hide_identity) values(target,p_scope,auth.uid(),n,p_hidden) returning id into result;
 perform audit_write(null,'invite','platform_organisers',result::text,jsonb_build_object('scope',p_scope,'hidden',p_hidden));
 return result;
end $$;
create or replace function invite_organiser(p_email text,p_scope text) returns uuid
language sql security definer set search_path = public, pg_temp as $$ select invite_platform_member(p_email,p_scope,'',false) $$;
create function set_organiser_visibility(p_user uuid,p_name text,p_hidden boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if not is_platform_owner() then raise exception 'only the Platform Admin can change visibility' using errcode='42501'; end if;
 if p_hidden is null or p_name is null or length(btrim(p_name))>100 or (p_hidden and btrim(p_name)='') then raise exception 'enter a valid display name' using errcode='22023'; end if;
 if exists(select 1 from platform_owner where user_id=p_user) then raise exception 'permanent administrator cannot be changed' using errcode='42501'; end if;
 update platform_organisers set display_name=btrim(p_name),hide_identity=p_hidden,hide_email=p_hidden where user_id=p_user;
 if not found then raise exception 'organiser not found' using errcode='22023'; end if;
end $$;
create or replace function claim_invitations() returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare me text; inv record; n int:=0;
begin
 select lower(btrim(email)) into me from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if me is null then return 0; end if;
 for inv in select * from organiser_invitations where email=me for update loop
  if not exists(select 1 from platform_owner where user_id=auth.uid()) then
   insert into platform_organisers(user_id,email,scope,granted_by,display_name,hide_identity,hide_email)
   values(auth.uid(),me,inv.scope,inv.created_by,inv.display_name,inv.hide_identity,inv.hide_identity)
   on conflict(user_id) do update set scope=case when platform_organisers.scope='platform' then 'platform' else excluded.scope end,email=excluded.email,
   display_name=case when excluded.display_name<>'' then excluded.display_name else platform_organisers.display_name end,
   hide_identity=platform_organisers.hide_identity or excluded.hide_identity,hide_email=platform_organisers.hide_email or excluded.hide_email;
   perform audit_write(null,'claim','platform_organisers',auth.uid()::text,jsonb_build_object('scope',inv.scope));
  end if;
  delete from organiser_invitations where id=inv.id; n:=n+1;
 end loop;
 return n+case when platform_spectator() then 0 else claim_event_invitations() end;
end $$;
create or replace function can_create_event() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
 select not platform_spectator() and exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
 and (platform_manager() or exists(select 1 from platform_organisers where user_id=auth.uid() and scope='competition')
 or exists(select 1 from event_roles r join events e on e.id=r.event_id where user_id=auth.uid() and role='organiser' and e.deleted_at is null))
$$;
create or replace function is_member(ev uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
 select event_active(ev) and (platform_manager() or platform_spectator() or exists(select 1 from event_roles where event_id=ev and user_id=auth.uid()))
$$;
create or replace function sees_all_teams(ev uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
 select event_active(ev) and (platform_manager() or platform_spectator() or exists(select 1 from event_roles where event_id=ev and user_id=auth.uid() and role<>'team_manager'))
$$;
-- Keep pending hidden identities out of directory responses before their first verified sign-in too.
create or replace function organiser_identity_visible(p_user uuid,p_email text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
 select is_platform_owner() or (not exists(select 1 from platform_organisers p where p.hide_identity and (p.user_id=p_user or lower(p.email)=lower(p_email)))
 and not exists(select 1 from organiser_invitations i where i.hide_identity and (lower(i.email)=lower(p_email) or exists(select 1 from auth.users u where u.id=p_user and lower(u.email)=lower(i.email)))))
$$;
-- Administrative mutation endpoints must not let ordinary organisers act on hidden/spectator grants.
create or replace function remove_organiser(p_user uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if not platform_manager() then raise exception 'only platform organisers can manage organiser access' using errcode='42501'; end if;
 if exists(select 1 from platform_owner where user_id=p_user) then raise exception 'permanent administrator cannot be removed' using errcode='42501'; end if;
 if not is_platform_owner() and exists(select 1 from platform_organisers where user_id=p_user and (hide_identity or scope='spectator')) then raise exception 'only the Platform Admin can change this grant' using errcode='42501'; end if;
 delete from platform_organisers where user_id=p_user;
end $$;
create or replace function withdraw_organiser_invitation(p_invitation uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if not platform_manager() then raise exception 'only platform organisers can manage organiser access' using errcode='42501'; end if;
 if not is_platform_owner() and exists(select 1 from organiser_invitations where id=p_invitation and (hide_identity or scope='spectator')) then raise exception 'only the Platform Admin can change this invitation' using errcode='42501'; end if;
 delete from organiser_invitations where id=p_invitation;
end $$;
-- Existing invitation SMTP workflow remains server-owned, including hidden invitation recipients.
alter function reserve_invitation_email(uuid) rename to reserve_invitation_email_members;
revoke execute on function reserve_invitation_email_members(uuid) from public,anon,authenticated;
create function reserve_invitation_email(p_invitation uuid) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if not is_platform_owner() and exists(select 1 from organiser_invitations where id=p_invitation and (hide_identity or scope='spectator')) then raise exception 'only the Platform Admin can send this invitation' using errcode='42501'; end if;
 return reserve_invitation_email_members(p_invitation);
end $$;
create or replace function platform_access() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare result jsonb; owner_id uuid;
begin
 result:=platform_access_contacts(); select user_id into owner_id from platform_owner;
 return result||jsonb_build_object('viewerId',auth.uid(),'ownerId',owner_id,'organisers',
 (select coalesce(jsonb_agg(person||jsonb_build_object('contactRestricted',coalesce(p.hide_email,false),'identityRestricted',coalesce(p.hide_identity,false))),'[]'::jsonb)
 from jsonb_array_elements(result->'organisers') person left join platform_organisers p on p.user_id::text=person->>'userId' where not coalesce(p.hide_identity,false) or auth.uid()=owner_id),
 'invitations',(select coalesce(jsonb_agg(inv||jsonb_build_object('name',i.display_name,'identityRestricted',i.hide_identity)),'[]'::jsonb)
 from jsonb_array_elements(result->'invitations') inv join organiser_invitations i on i.id::text=inv->>'id'
 where (auth.uid()=owner_id or (not i.hide_identity and i.scope<>'spectator')) and (auth.uid()=owner_id or not exists(select 1 from platform_organisers p where p.hide_identity and p.email=inv->>'email'))));
end $$;
revoke execute on function is_platform_owner(),platform_spectator(),invite_platform_member(text,text,text,boolean),set_organiser_visibility(uuid,text,boolean),reserve_invitation_email(uuid) from public,anon,authenticated;
grant execute on function is_platform_owner(),platform_spectator(),invite_platform_member(text,text,text,boolean),set_organiser_visibility(uuid,text,boolean),reserve_invitation_email(uuid) to authenticated;
