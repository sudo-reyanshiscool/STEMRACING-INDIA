-- Setup draws are reviewed in the client and applied as one audited transaction.
create function draw_lots_state(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s jsonb;
begin
 if not is_chair_or_organiser(p_event) then raise exception 'only event staff can draw lots' using errcode='42501'; end if;
 s:=jsonb_build_object(
  'teams',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from teams t where event_id=p_event),
  'roles',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from event_roles r where event_id=p_event),
  'conflicts',(select coalesce(jsonb_agg(to_jsonb(c) order by judge_id,team_id),'[]') from judge_conflicts c where event_id=p_event),
  'exemptions',(select coalesce(jsonb_agg(to_jsonb(x) order by judge_id,team_id),'[]') from judge_exemptions x where event_id=p_event),
  'released',event_released(p_event),
  'numberingLocked',event_released(p_event)
   or exists(select 1 from scorecards where event_id=p_event)
   or exists(select 1 from technical_inspections where event_id=p_event)
   or exists(select 1 from race_heats where event_id=p_event)
   or exists(select 1 from ranking_snapshots where event_id=p_event),
  'lockedPanels',(select coalesce(jsonb_agg(p order by p),'[]') from (select panel::text p from scorecards where event_id=p_event union select 'scrutineering' from technical_inspections where event_id=p_event) panels)
 );
 return s||jsonb_build_object('version',md5(s::text));
end $$;

create function apply_team_number_draw(p_event uuid,p_version text,p_assignments jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s jsonb; item jsonb; n int; prefix text; i int:=0;
begin
 perform 1 from events where id=p_event for update;
 s:=draw_lots_state(p_event);
 if (s->>'numberingLocked')::boolean then raise exception 'team numbers can only be drawn before scoring or racing begins' using errcode='55000'; end if;
 if p_version is distinct from s->>'version' then raise exception 'draw data changed; preview again' using errcode='40001'; end if;
 n:=jsonb_array_length(s->'teams');
 if p_assignments is null or jsonb_typeof(p_assignments)<>'array' then raise exception 'invalid number draw' using errcode='22023'; end if;
 if n not between 1 and 1000 or jsonb_array_length(p_assignments)<>n
  or (select count(distinct x->>'teamId') from jsonb_array_elements(p_assignments) x)<>n
  or (select count(distinct x->>'number') from jsonb_array_elements(p_assignments) x)<>n then raise exception 'include each team and number once' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_assignments) loop
  if jsonb_typeof(item->'teamId') is distinct from 'string' or jsonb_typeof(item->'number') is distinct from 'string'
   or not exists(select 1 from teams where event_id=p_event and id=(item->>'teamId')::uuid)
   or not exists(select 1 from generate_series(1,n) x where item->>'number'=case when x<1000 then lpad(x::text,3,'0') else x::text end)
   or exists(select 1 from teams where event_id=p_event and id=(item->>'teamId')::uuid and upper(btrim(name))='SUPERCHARGED' and item->>'number'<>'001') then
   raise exception 'invalid team, number or SUPERCHARGED reservation' using errcode='22023';
  end if;
 end loop;
 -- Move through an unused namespace so permutations cannot collide with the immediate unique index.
 loop
  prefix:='~'||substr(replace(gen_random_uuid()::text,'-',''),1,6);
  exit when not exists(select 1 from teams where event_id=p_event and number like prefix||'%');
 end loop;
 for item in select value from jsonb_array_elements(p_assignments) loop
  i:=i+1;update teams set number=prefix||i::text where event_id=p_event and id=(item->>'teamId')::uuid;
 end loop;
 for item in select value from jsonb_array_elements(p_assignments) loop
  update teams set number=item->>'number' where event_id=p_event and id=(item->>'teamId')::uuid;
 end loop;
 perform audit_write(p_event,'number_draw','teams',p_event::text,jsonb_build_object('assignments',p_assignments));
end $$;

create function apply_judge_draw(p_event uuid,p_version text,p_panel judging_panel,p_assignments jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s jsonb; item jsonb; n int; recipient text; recipient_name text; who uuid; team_ids uuid[];
begin
 perform 1 from events where id=p_event for update;
 s:=draw_lots_state(p_event);
 if (s->>'released')::boolean or (s->'lockedPanels')?p_panel::text then raise exception 'draw this panel before judging starts' using errcode='55000'; end if;
 if p_version is distinct from s->>'version' then raise exception 'draw data changed; preview again' using errcode='40001'; end if;
 if p_panel is null or not exists(select 1 from events e,jsonb_array_elements(e.ruleset->'areas') a where e.id=p_event and a->>'kind'='scorecard' and a->>'panel'=p_panel::text) then raise exception 'choose a judging panel' using errcode='22023'; end if;
 if p_assignments is null or jsonb_typeof(p_assignments)<>'array' then raise exception 'invalid judge draw' using errcode='22023'; end if;
 n:=jsonb_array_length(s->'teams');
 if n not between 1 and 1000 or jsonb_array_length(p_assignments) not between 1 and n
  or (select count(distinct x->>'judgeId') from jsonb_array_elements(p_assignments) x)<>jsonb_array_length(p_assignments) then raise exception 'select distinct panel judges' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_assignments) loop
  if jsonb_typeof(item->'judgeId') is distinct from 'string' or jsonb_typeof(item->'teamIds') is distinct from 'array' then raise exception 'invalid judge draw row' using errcode='22023'; end if;
  who:=(item->>'judgeId')::uuid;
  if not exists(select 1 from event_roles r join auth.users u on u.id=r.user_id where r.event_id=p_event and r.user_id=who and r.role='judge' and r.panel=p_panel and u.email_confirmed_at is not null) then raise exception 'choose confirmed judges on this panel' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(item->'teamIds') t where jsonb_typeof(t)<>'string'
    or not exists(select 1 from teams where event_id=p_event and id=(t#>>'{}')::uuid)
    or exists(select 1 from judge_conflicts c where c.event_id=p_event and c.judge_id=who and c.team_id=(t#>>'{}')::uuid)
    or exists(select 1 from judge_exemptions x where x.event_id=p_event and x.judge_id=who and x.team_id=(t#>>'{}')::uuid)) then raise exception 'team is invalid, conflicted or exempt' using errcode='22023'; end if;
 end loop;
 if (select count(*) from jsonb_array_elements(p_assignments) a,jsonb_array_elements_text(a->'teamIds') t)<>n
  or (select count(distinct t) from jsonb_array_elements(p_assignments) a,jsonb_array_elements_text(a->'teamIds') t)<>n
  or (select max(jsonb_array_length(a->'teamIds'))-min(jsonb_array_length(a->'teamIds')) from jsonb_array_elements(p_assignments) a)>1 then raise exception 'assign every team once in balanced groups' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_assignments) loop
  who:=(item->>'judgeId')::uuid;
  select lower(btrim(u.email)),r.display_name into recipient,recipient_name from event_roles r join auth.users u on u.id=r.user_id
   where r.event_id=p_event and r.user_id=who and r.role='judge' and r.panel=p_panel order by (r.display_name<>'') desc,r.id limit 1;
  select coalesce(array_agg(t::uuid),'{}') into team_ids from jsonb_array_elements_text(item->'teamIds') t;
  delete from event_roles where event_id=p_event and user_id=who and role='judge' and panel=p_panel;
  insert into event_roles(event_id,user_id,role,panel,team_id,email,display_name)
   select p_event,who,'judge',p_panel,t,recipient,recipient_name from unnest(team_ids) t;
 end loop;
 perform audit_write(p_event,'judge_draw','event_roles',p_event::text,jsonb_build_object('panel',p_panel,'assignments',p_assignments));
end $$;

revoke execute on function draw_lots_state(uuid),apply_team_number_draw(uuid,text,jsonb),apply_judge_draw(uuid,text,judging_panel,jsonb) from public,anon,authenticated;
grant execute on function draw_lots_state(uuid),apply_team_number_draw(uuid,text,jsonb),apply_judge_draw(uuid,text,judging_panel,jsonb) to authenticated;
