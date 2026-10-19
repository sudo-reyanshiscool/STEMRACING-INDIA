-- Permanent owner identity is resolved once from the confirmed Auth account, never from a client claim.
create table platform_owner (
 singleton boolean primary key default true check(singleton),
 user_id uuid not null unique references auth.users(id) on delete restrict,
 email text not null
);
insert into platform_owner(user_id,email)
 select id,lower(btrim(email)) from auth.users
 where lower(btrim(email))='reyanshg11111@gmail.com' and email_confirmed_at is not null;
do $$ begin
 if not exists(select 1 from platform_owner) then raise exception 'confirmed platform owner account is required'; end if;
end $$;
create table platform_organisers (
 user_id uuid primary key references auth.users(id) on delete cascade,
 scope text not null check(scope in ('competition','platform')),
 email text not null,
 granted_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create table organiser_invitations (
 id uuid primary key default gen_random_uuid(),
 email text not null unique check(email=lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
 scope text not null check(scope in ('competition','platform')),
 created_by uuid not null references auth.users(id),
 email_status text not null default 'not_sent' check(email_status in ('not_sent','sending','sent','failed')),
 email_sent_at timestamptz, email_attempt_at timestamptz, email_attempt uuid,
 email_failure text check(email_failure in ('provider','rate_limit'))
);
revoke all on platform_owner,platform_organisers,organiser_invitations from public,anon,authenticated;
alter table platform_owner enable row level security;
alter table platform_organisers enable row level security;
alter table organiser_invitations enable row level security;

create function owner_immutable() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin raise exception 'the permanent platform administrator cannot be changed' using errcode='42501'; end $$;
create trigger owner_immutable before update or delete or truncate on platform_owner for each statement execute function owner_immutable();

create function platform_manager() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
 select exists(select 1 from platform_owner where user_id=auth.uid())
 or exists(select 1 from platform_organisers where user_id=auth.uid() and scope='platform')
$$;
create function event_organiser_access(ev uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
 select auth.uid() is not null and exists(select 1 from events where id=ev) and
 (platform_manager() or exists(select 1 from event_roles where event_id=ev and user_id=auth.uid() and role='organiser'))
$$;
create or replace function is_member(ev uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
 select event_active(ev) and (platform_manager() or exists(select 1 from event_roles where event_id=ev and user_id=auth.uid()))
$$;
create or replace function has_role(ev uuid,r app_role) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
 select event_active(ev) and ((r in ('organiser','chair') and event_organiser_access(ev))
 or exists(select 1 from event_roles where event_id=ev and user_id=auth.uid() and role=r))
$$;
create or replace function sees_all_teams(ev uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
 select event_active(ev) and (platform_manager() or exists(select 1 from event_roles where event_id=ev and user_id=auth.uid() and role<>'team_manager'))
$$;
create or replace function specification_visible(ev uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$ select sees_all_teams(ev) $$;
create or replace function can_create_event() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
 select exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
 and (platform_manager() or exists(select 1 from platform_organisers where user_id=auth.uid())
 or exists(select 1 from event_roles r join events e on e.id=r.event_id where user_id=auth.uid() and role='organiser' and e.deleted_at is null))
$$;
-- Retire the old email allowlist. Only explicit organiser invitations can grant event creation.
revoke all on event_creators from public,anon,authenticated;
create or replace function create_event(p_name text,p_starts_on date,p_ruleset jsonb) returns events
language plpgsql security definer set search_path = public, pg_temp as $$
declare e events; me text;
begin
 if auth.uid() is null then raise exception 'sign in required' using errcode='28000'; end if;
 if not can_create_event() then raise exception 'only organisers can create events' using errcode='42501'; end if;
 select lower(btrim(email)) into me from auth.users where id=auth.uid() and email_confirmed_at is not null;
 insert into events(name,starts_on,ruleset,created_by) values(p_name,p_starts_on,p_ruleset,auth.uid()) returning * into e;
 insert into event_roles(event_id,user_id,role,email) values(e.id,auth.uid(),'organiser',me);
 return e;
end $$;

-- Effective roles keep every interface consistent without copying global grants into every event.
create function effective_event_roles(p_event uuid) returns setof event_roles
language sql stable security definer set search_path = public, pg_temp as $$
 select r.* from event_roles r where r.event_id=p_event and r.user_id=auth.uid() and event_active(p_event)
 union all
 select md5(p_event::text||auth.uid()::text||v.role::text)::uuid,p_event,auth.uid(),v.role,null::judging_panel,null::uuid,u.email
 from (values('organiser'::app_role),('chair'::app_role)) v(role),auth.users u
 where u.id=auth.uid() and has_role(p_event,v.role)
 and not exists(select 1 from event_roles r where r.event_id=p_event and r.user_id=auth.uid() and r.role=v.role)
$$;

-- A Chair cannot promote themselves (including through direct table writes) or change/remove an organiser.
drop policy roles_insert on event_roles;
create policy roles_insert on event_roles for insert to authenticated with check(is_chair_or_organiser(event_id) and (role<>'organiser' or has_role(event_id,'organiser')));
drop policy roles_update on event_roles;
create policy roles_update on event_roles for update to authenticated
 using(is_chair_or_organiser(event_id) and (role<>'organiser' or has_role(event_id,'organiser')))
 with check(is_chair_or_organiser(event_id) and (role<>'organiser' or has_role(event_id,'organiser')));
create or replace function protect_invitation_role() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if new.role='organiser' and not has_role(new.event_id,'organiser') then raise exception 'only organisers can invite organisers' using errcode='42501'; end if;
 if tg_op='UPDATE' and old.role='organiser' and not has_role(old.event_id,'organiser') then raise exception 'only organisers can change organiser invitations' using errcode='42501'; end if;
 return new;
end $$;
create or replace function protect_organiser_removal() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if old.role='organiser' then
  if pg_trigger_depth()>1 or not exists(select 1 from events where id=old.event_id) then return old; end if;
  if exists(select 1 from platform_owner where user_id=old.user_id) then raise exception 'the permanent platform administrator cannot be removed' using errcode='42501'; end if;
  if not event_organiser_access(old.event_id) then raise exception 'only organisers can remove organisers' using errcode='42501'; end if;
  if not platform_manager() and not exists(select 1 from event_roles where event_id=old.event_id and role='organiser' and id<>old.id) then
   raise exception 'an event must have at least one organiser' using errcode='55000';
  end if;
 end if;
 return old;
end $$;
-- Protect the owner's physical organiser membership from demotion or reassignment as well.
create function protect_owner_role() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if old.role='organiser' and exists(select 1 from platform_owner where user_id=old.user_id)
 and (new.user_id,new.role,new.event_id) is distinct from (old.user_id,old.role,old.event_id) then
 raise exception 'the permanent platform administrator cannot be changed' using errcode='42501'; end if;
 return new;
end $$;
create trigger owner_role_guard before update on event_roles for each row execute function protect_owner_role();

create function platform_access() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare owner_id uuid; owner_email text; kind text;
begin
 select user_id,email into owner_id,owner_email from platform_owner;
 if auth.uid()=owner_id then kind:='admin'; else select scope into kind from platform_organisers where user_id=auth.uid(); end if;
 return jsonb_build_object('kind',kind,'ownerEmail',owner_email,'canManage',platform_manager(),
 'organisers',case when platform_manager() then (select coalesce(jsonb_agg(r),'[]') from (
 select owner_id as "userId",owner_email as email,'admin' as scope,true as permanent
 union all select user_id,email,scope,false from platform_organisers where user_id<>owner_id) r) else '[]'::jsonb end,
 'invitations',case when platform_manager() then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email,'scope',scope,'emailStatus',email_status)),'[]') from organiser_invitations) else '[]'::jsonb end);
end $$;
create function invite_organiser(p_email text,p_scope text) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare target text:=lower(btrim(p_email)); invitation_id uuid;
begin
 if not platform_manager() then raise exception 'only platform organisers can grant organiser access' using errcode='42501'; end if;
 if p_scope is null or p_scope not in ('competition','platform') then raise exception 'choose an organiser scope' using errcode='22023'; end if;
 if exists(select 1 from platform_owner where email=target) then raise exception 'the permanent platform administrator cannot be changed' using errcode='42501'; end if;
 if exists(select 1 from platform_organisers where email=target) then raise exception 'remove the existing organiser grant before changing its scope' using errcode='23505'; end if;
 insert into organiser_invitations(email,scope,created_by) values(target,p_scope,auth.uid()) returning id into invitation_id;
 perform audit_write(null,'invite','platform_organisers',invitation_id::text,jsonb_build_object('email',target,'scope',p_scope));
 return invitation_id;
end $$;
create function remove_organiser(p_user uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if not platform_manager() then raise exception 'only platform organisers can revoke organiser access' using errcode='42501'; end if;
 if exists(select 1 from platform_owner where user_id=p_user) then raise exception 'the permanent platform administrator cannot be removed' using errcode='42501'; end if;
 delete from platform_organisers where user_id=p_user;
 perform audit_write(null,'revoke','platform_organisers',p_user::text,null);
end $$;
create function withdraw_organiser_invitation(p_invitation uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if not platform_manager() then raise exception 'only platform organisers can withdraw organiser invitations' using errcode='42501'; end if;
 delete from organiser_invitations where id=p_invitation;
 perform audit_write(null,'withdraw','organiser_invitations',p_invitation::text,null);
end $$;
create policy platform_audit_select on audit_log for select to authenticated using(event_id is null and platform_manager());

-- Existing invitation delivery remains authoritative, including cooldowns and attempt matching.
alter function reserve_invitation_email(uuid) rename to reserve_event_invitation_email;
create function reserve_invitation_email(p_invitation uuid) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare i organiser_invitations; ticket uuid;
begin
 select * into i from organiser_invitations where id=p_invitation for update;
 if not found then return reserve_event_invitation_email(p_invitation); end if;
 if not platform_manager() then raise exception 'invitation not available' using errcode='42501'; end if;
 if i.email_attempt_at>clock_timestamp()-interval '60 seconds' then return jsonb_build_object('status','cooldown','retryAfter',60); end if;
 ticket:=gen_random_uuid();
 update organiser_invitations set email_status='sending',email_attempt=ticket,email_attempt_at=clock_timestamp(),email_failure=null where id=i.id;
 return jsonb_build_object('status','reserved','email',i.email,'attempt',ticket);
end $$;
alter function complete_invitation_email(uuid,uuid,text,text) rename to complete_event_invitation_email;
create function complete_invitation_email(p_invitation uuid,p_attempt uuid,p_status text,p_failure text default null) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare changed integer;
begin
 if p_status is null or p_status not in ('sent','failed') or (p_status='failed' and (p_failure is null or p_failure not in ('provider','rate_limit'))) or (p_status='sent' and p_failure is not null) then raise exception 'invalid delivery outcome' using errcode='22023'; end if;
 update organiser_invitations set email_status=p_status,email_sent_at=case when p_status='sent' then clock_timestamp() else email_sent_at end,email_failure=p_failure
 where id=p_invitation and email_attempt=p_attempt and email_status='sending';
 get diagnostics changed=row_count;
 if changed=1 then return true; end if;
 return complete_event_invitation_email(p_invitation,p_attempt,p_status,p_failure);
end $$;
alter function claim_invitations() rename to claim_event_invitations;
create function claim_invitations() returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare me text; inv record; n int:=0;
begin
 select lower(btrim(email)) into me from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if me is null then return 0; end if;
 for inv in select * from organiser_invitations where email=me for update loop
  if not exists(select 1 from platform_owner where user_id=auth.uid()) then
   insert into platform_organisers(user_id,email,scope,granted_by) values(auth.uid(),me,inv.scope,inv.created_by)
   on conflict(user_id) do update set scope=case when platform_organisers.scope='platform' then 'platform' else excluded.scope end,email=excluded.email;
   perform audit_write(null,'claim','platform_organisers',auth.uid()::text,jsonb_build_object('scope',inv.scope));
  end if;
  delete from organiser_invitations where id=inv.id; n:=n+1;
 end loop;
 return n+claim_event_invitations();
end $$;

-- Deleted events remain recoverable by the permanent admin and Platform Organisers.
create or replace function delete_event(p_event uuid, p_confirmation text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare e events;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '28000'; end if;
  select * into e from events where id = p_event for update;
  if not found or not event_organiser_access(p_event) then
    raise exception 'only organisers can delete events' using errcode = '42501';
  end if;
  if p_confirmation is distinct from e.name then raise exception 'event name does not match' using errcode = '22023'; end if;
  if e.deleted_at is not null then return; end if;
  update events set deleted_at = now() where id = p_event;
  perform audit_write(p_event, 'delete', 'events', p_event::text, jsonb_build_object('name', e.name, 'restorable', true));
end $$;
create or replace function restore_event(p_event uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare e events;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '28000'; end if;
  select * into e from events where id = p_event for update;
  if not found or not event_organiser_access(p_event) then
    raise exception 'only organisers can restore events' using errcode = '42501';
  end if;
  if e.deleted_at is null then return; end if;
  update events set deleted_at = null where id = p_event;
  perform audit_write(p_event, 'restore', 'events', p_event::text, jsonb_build_object('name', e.name));
end $$;
create or replace function list_deleted_events() returns setof events language sql stable security definer set search_path = public, pg_temp as
$$ select e.* from events e where e.deleted_at is not null and event_organiser_access(e.id) order by e.created_at desc, e.id $$;
grant execute on function delete_event(uuid,text), restore_event(uuid), list_deleted_events() to authenticated;


revoke execute on function owner_immutable(),platform_manager(),event_organiser_access(uuid),protect_owner_role(),platform_access(),effective_event_roles(uuid),invite_organiser(text,text),remove_organiser(uuid),withdraw_organiser_invitation(uuid),reserve_event_invitation_email(uuid),complete_event_invitation_email(uuid,uuid,text,text),claim_event_invitations(),reserve_invitation_email(uuid),complete_invitation_email(uuid,uuid,text,text),claim_invitations() from public,anon,authenticated;
-- Policies invoke this helper as the caller; other helpers remain private.
grant execute on function platform_manager() to authenticated;
grant execute on function platform_access(),effective_event_roles(uuid),invite_organiser(text,text),remove_organiser(uuid),withdraw_organiser_invitation(uuid),reserve_invitation_email(uuid),claim_invitations() to authenticated;
grant execute on function complete_invitation_email(uuid,uuid,text,text) to service_role;
