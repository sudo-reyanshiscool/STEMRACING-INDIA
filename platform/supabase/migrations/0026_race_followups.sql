-- Allow two different cars of one team in reaction heats, preserving distinct knockout teams.
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='race_heats'::regclass and contype='c' and pg_get_constraintdef(oid) like '%lane1_team <> lane2_team%' loop
  execute format('alter table race_heats drop constraint %I',c.conname);
 end loop;
end $$;
alter table race_heats add constraint race_distinct_cars check (lane1_team<>lane2_team or (phase='reaction' and lane1_car<>lane2_car));
alter table race_heats add column parent_heat uuid references race_heats(id), add column followup_kind text check(followup_kind in ('swap','rerun'));
create unique index race_followup_once on race_heats(parent_heat,followup_kind);

create function queue_race_followup(p_event uuid,p_id uuid,p_revision integer,p_mode text) returns race_heats
language plpgsql security definer set search_path = public, pg_temp as $$
declare r race_heats; result race_heats; a jsonb; b jsonb;
begin
 perform 1 from events where id=p_event for update;
 if not (is_chair_or_organiser(p_event) or has_role(p_event,'race_official')) then raise exception 'race official required' using errcode='42501'; end if;
 select * into r from race_heats where id=p_id and event_id=p_event;
 if r.id is null or r.revision is distinct from p_revision then raise exception 'reload source heat' using errcode='40001'; end if;
 if p_mode is null or p_mode not in ('swap','rerun') or (p_mode='swap' and r.bracket_round is not null) then raise exception 'invalid followup' using errcode='22023'; end if;
 if p_mode='rerun' and (r.lane1_status in ('pending','dnf') or r.lane2_status in ('pending','dnf') or not
 (r.lane1_status in ('dns','false_start') or r.lane2_status in ('dns','false_start') or
 (r.lane1_status='finished' and r.lane2_status='finished' and r.lane1_total_ms=r.lane2_total_ms))) then raise exception 'heat not eligible for rerun' using errcode='22023'; end if;
 a:=jsonb_build_object('teamId',r.lane1_team,'car',r.lane1_car,'status','pending','totalMs',null,'reactionMs',null);
 b:=jsonb_build_object('teamId',r.lane2_team,'car',r.lane2_car,'status','pending','totalMs',null,'reactionMs',null);
 result:=save_race(p_event,gen_random_uuid(),0,jsonb_build_object('label',case when p_mode='swap' then 'Lane swap' else 'Rerun' end || ' · Heat ' || r.heat_number,
 'phase',r.phase,'bracket',case when r.bracket_round is null then null else jsonb_build_object('round',r.bracket_round,'slot',r.bracket_slot) end,
 'lane1',case when p_mode='swap' then b else a end,'lane2',case when p_mode='swap' then a else b end,
 'note',p_mode || ' of heat ' || r.heat_number,'source','manual','sourceRunId',null));
 update race_heats set parent_heat=r.id,followup_kind=p_mode where id=result.id returning * into result;
 return result;
end $$;
revoke execute on function queue_race_followup(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function queue_race_followup(uuid,uuid,integer,text) to authenticated;
-- The ordinary save endpoint cannot bypass DNF/pending restrictions for a second bracket attempt.
alter function save_race(uuid,uuid,integer,jsonb) rename to save_race_competition;
revoke execute on function save_race_competition(uuid,uuid,integer,jsonb) from public,anon,authenticated;
create function save_race(p_event uuid,p_id uuid,p_revision integer,p_input jsonb) returns race_heats
language plpgsql security definer set search_path = public, pg_temp as $$
declare previous race_heats;
begin
 perform 1 from events where id=p_event for update;
 if not (is_chair_or_organiser(p_event) or has_role(p_event,'race_official')) then raise exception 'race official required' using errcode='42501'; end if;
 if p_input->'bracket' is not null and p_input->'bracket'<>'null'::jsonb and not exists(select 1 from race_heats where id=p_id) then
  select * into previous from race_heats where event_id=p_event and bracket_round=(p_input#>>'{bracket,round}')::integer and bracket_slot=(p_input#>>'{bracket,slot}')::integer order by heat_number desc limit 1;
  if previous.id is not null and (previous.lane1_status in ('pending','dnf') or previous.lane2_status in ('pending','dnf')) then raise exception 'pending or DNF match cannot queue ordinary rerun' using errcode='55000'; end if;
 end if;
 return save_race_competition(p_event,p_id,p_revision,p_input);
end $$;
revoke execute on function save_race(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function save_race(uuid,uuid,integer,jsonb) to authenticated;
-- Queue each return race immediately after its first race with both cars exchanged between lanes.
create or replace function queue_reaction_races(p_event uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare e events; ids uuid[]; n integer; i integer; j integer; car text; car2 text; a jsonb; b jsonb; heat integer:=0;
begin
 select * into e from events where id=p_event for update;
 if not found or e.deleted_at is not null or not is_chair_or_organiser(p_event) then raise exception 'organiser or Chair required' using errcode='42501'; end if;
 if e.results_released or exists(select 1 from racing_setup where event_id=p_event and reaction_complete) or exists(select 1 from race_heats where event_id=p_event and phase='reaction') then raise exception 'reaction racing already queued or locked' using errcode='55000'; end if;
 select array_agg(id order by number,id) into ids from teams where event_id=p_event;
 n:=coalesce(cardinality(ids),0);
 if n<1 then raise exception 'at least one team required' using errcode='22023'; end if;
 for i in 1..n loop
  if n%2=0 and i%2=0 then continue; end if;
  j:=case when n=1 then 1 when n%2=0 then i+1 else i%n+1 end;
  foreach car in array case when n%2=0 then ARRAY['A','B'] else ARRAY[case when i%2=1 then 'A' else 'B' end] end loop
   car2:=case when n%2=1 and i=n then 'B' else car end;
   a:=jsonb_build_object('teamId',ids[i],'car',car,'status','pending','totalMs',null,'reactionMs',null);
   b:=jsonb_build_object('teamId',ids[j],'car',car2,'status','pending','totalMs',null,'reactionMs',null);
   heat:=heat+1;
   perform save_race(p_event,gen_random_uuid(),0,jsonb_build_object('label','RR-H'||lpad(heat::text,2,'0'),'phase','reaction','lane1',a,'lane2',b,'note','','source','manual','sourceRunId',null));
   heat:=heat+1;
   perform save_race(p_event,gen_random_uuid(),0,jsonb_build_object('label','RR-H'||lpad(heat::text,2,'0'),'phase','reaction','lane1',b,'lane2',a,'note','','source','manual','sourceRunId',null));
  end loop;
 end loop;
end $$;
