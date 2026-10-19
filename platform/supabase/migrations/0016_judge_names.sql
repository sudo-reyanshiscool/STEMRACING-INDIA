-- Names are invitation data, copied to event membership only after the email is verified.
alter table invitations add column display_name text not null default '' check(char_length(display_name)<=100 and display_name=btrim(display_name));
alter table event_roles add column display_name text not null default '' check(char_length(display_name)<=100 and display_name=btrim(display_name));
grant insert(display_name),update(display_name) on invitations to authenticated;
create function require_judge_name() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
 new.display_name:=btrim(new.display_name);
 if new.role in ('judge','lead_judge') and new.display_name='' then
  raise exception 'a judge name is required' using errcode='22023';
 end if;
 return new;
end $$;
-- Existing pending invites remain usable; delivery metadata updates do not run this guard.
create trigger invitation_name_guard before insert or update of role,display_name on invitations for each row execute function require_judge_name();

create or replace function claim_event_invitations() returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int:=0; inv record; me text;
begin
 select lower(btrim(email)) into me from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if me is null or me='' then return 0; end if;
 for inv in select * from invitations where email=me and event_active(event_id) for update loop
  insert into event_roles(event_id,user_id,role,panel,team_id,email,display_name)
   values(inv.event_id,auth.uid(),inv.role,inv.panel,inv.team_id,me,inv.display_name)
   on conflict(event_id,user_id,role,panel,team_id) do update
    set display_name=case when excluded.display_name<>'' then excluded.display_name else event_roles.display_name end;
  if inv.display_name<>'' then update event_roles set display_name=inv.display_name where event_id=inv.event_id and user_id=auth.uid(); end if;
  delete from invitations where id=inv.id; n:=n+1;
 end loop;
 return n;
end $$;
create function set_judge_name(p_event uuid,p_user uuid,p_name text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if not is_chair_or_organiser(p_event) then raise exception 'only the Chair or Organiser can name judges' using errcode='42501'; end if;
 if p_name is null or char_length(btrim(p_name)) not between 1 and 100 then raise exception 'enter a judge name between 1 and 100 characters' using errcode='22023'; end if;
 update event_roles set display_name=btrim(p_name) where event_id=p_event and user_id=p_user;
 if not found then raise exception 'invite this person to the event first' using errcode='22023'; end if;
 perform audit_write(p_event,'name','event_roles',p_user::text,jsonb_build_object('name',btrim(p_name)));
end $$;
create or replace function set_judge_assignment(p_event uuid,p_user uuid,p_panel judging_panel,p_teams uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare recipient text; recipient_name text;
begin
 if auth.uid() is null then raise exception 'sign in first' using errcode='28000'; end if;
 perform 1 from events where id=p_event for update;
 if not is_chair_or_organiser(p_event) then raise exception 'only the Chair or Organiser can assign judges' using errcode='42501'; end if;
 if not exists(select 1 from event_roles where event_id=p_event and user_id=p_user) then
   raise exception 'invite this person to the event first' using errcode='22023'; end if;
 select lower(btrim(email)) into recipient from auth.users where id=p_user and email_confirmed_at is not null;
 select display_name into recipient_name from event_roles where event_id=p_event and user_id=p_user order by (display_name<>'') desc,id limit 1;
 if recipient is null then raise exception 'the person must verify their email first' using errcode='22023'; end if;
 if p_panel is null or not exists(select 1 from events e,jsonb_array_elements(e.ruleset->'areas') a
   where e.id=p_event and a->>'kind'='scorecard' and a->>'panel'=p_panel::text) then
   raise exception 'choose a judging panel in this event' using errcode='22023'; end if;
 if p_teams is not null and (cardinality(p_teams)=0 or cardinality(p_teams)>1000
   or exists(select 1 from unnest(p_teams) t where t is null or not exists(select 1 from teams where id=t and event_id=p_event))) then
   raise exception 'choose teams belonging to this event' using errcode='22023'; end if;
 if p_teams is not null and exists(select 1 from judge_conflicts where event_id=p_event and judge_id=p_user and team_id=any(p_teams)) then
   raise exception 'this judge has a declared conflict with a selected team' using errcode='22023'; end if;
 delete from event_roles where event_id=p_event and user_id=p_user and role='judge' and panel=p_panel
   and ((p_teams is null and team_id is not null) or (p_teams is not null and (team_id is null or not(team_id=any(p_teams)))));
 if p_teams is null then
   insert into event_roles(event_id,user_id,role,panel,email,display_name) values(p_event,p_user,'judge',p_panel,recipient,recipient_name) on conflict do nothing;
 else
   insert into event_roles(event_id,user_id,role,panel,team_id,email,display_name)
     select p_event,p_user,'judge',p_panel,t,recipient,recipient_name from (select distinct unnest(p_teams) as t) selected on conflict do nothing;
 end if;
end $$;
create or replace function effective_event_roles(p_event uuid) returns setof event_roles
language sql stable security definer set search_path = public, pg_temp as $$
 select r.* from event_roles r where r.event_id=p_event and r.user_id=auth.uid() and event_active(p_event)
 union all
 select md5(p_event::text||auth.uid()::text||v.role::text)::uuid,p_event,auth.uid(),v.role,null::judging_panel,null::uuid,u.email,''::text
 from (values('organiser'::app_role),('chair'::app_role)) v(role),auth.users u
 where u.id=auth.uid() and has_role(p_event,v.role)
 and not exists(select 1 from event_roles r where r.event_id=p_event and r.user_id=auth.uid() and r.role=v.role)
$$;

revoke execute on function require_judge_name(),set_judge_name(uuid,uuid,text) from public,anon,authenticated;
grant execute on function set_judge_name(uuid,uuid,text) to authenticated;
