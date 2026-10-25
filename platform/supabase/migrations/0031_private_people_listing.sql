-- Read contact addresses only through a listing that honours organiser privacy settings.
create function list_event_people(p_event uuid) returns setof event_roles
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r event_roles; profile platform_organisers;
begin
 if not event_active(p_event) then return; end if;
 for r in select * from event_roles where event_id=p_event and (user_id=auth.uid() or is_chair_or_organiser(p_event)) loop
  select * into profile from platform_organisers where user_id=r.user_id;
  if profile.hide_email then r.email:=null; r.display_name:=profile.display_name; end if;
  return next r;
 end loop;
end $$;
revoke select on event_roles from authenticated;
grant select(id,event_id,user_id,role,panel,team_id,display_name) on event_roles to authenticated;
revoke execute on function list_event_people(uuid) from public,anon,authenticated;
grant execute on function list_event_people(uuid) to authenticated;
create function list_event_invitations(p_event uuid) returns setof invitations
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare i invitations; profile platform_organisers;
begin
 if not is_chair_or_organiser(p_event) then return; end if;
 for i in select * from invitations where event_id=p_event loop
  select * into profile from platform_organisers where lower(email)=lower(i.email);
  if profile.hide_email then i.email:=''; i.display_name:=profile.display_name; end if;
  return next i;
 end loop;
end $$;
revoke select on invitations from authenticated;
grant select(id,event_id,role,panel,team_id,display_name,email_status,email_sent_at,email_attempt_at,email_attempt,email_failure) on invitations to authenticated;
revoke execute on function list_event_invitations(uuid) from public,anon,authenticated;
grant execute on function list_event_invitations(uuid) to authenticated;
