alter table racing_setup add column scoring jsonb;
-- Keep established defaults and all stage/roster/revision locks when an older client saves.
alter function save_racing_setup(uuid,integer,jsonb) rename to save_racing_setup_stages;
revoke execute on function save_racing_setup_stages(uuid,integer,jsonb) from public,anon,authenticated;
alter function racing_state(uuid) rename to racing_state_stages;
revoke execute on function racing_state_stages(uuid) from public,anon,authenticated;
create function racing_state(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare result jsonb; s jsonb;
begin
 result:=racing_state_stages(p_event);
 select scoring into s from racing_setup where event_id=p_event;
 return case when s is null then result else result||jsonb_build_object('scoring',s) end;
end $$;
create function save_racing_setup(p_event uuid,p_revision integer,p_input jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s jsonb:=p_input->'scoring'; k text; v numeric;
begin
 perform 1 from events where id=p_event for update;
 if not is_chair_or_organiser(p_event) then raise exception 'event staff required' using errcode='42501'; end if;
 if p_input ? 'scoring' then
  if jsonb_typeof(s) is distinct from 'object' or jsonb_typeof(s->'podium') is distinct from 'array' or jsonb_array_length(s->'podium')<>3 then raise exception 'invalid reaction scoring' using errcode='22023'; end if;
  foreach k in array ARRAY['minimum','referenceMultiplier','falseStartPenalty','dnfPenalty','fastestCarBonus'] loop
   if jsonb_typeof(s->k) is distinct from 'number' then raise exception 'reaction scoring values required' using errcode='22023'; end if;
   v:=(s->>k)::numeric;
   if (k='referenceMultiplier' and (v<=1 or v>10)) or (k<>'referenceMultiplier' and (v<0 or v>case when k='fastestCarBonus' then 10 else 105 end or v<>round(v,1))) then raise exception 'invalid reaction scoring value' using errcode='22023'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(s->'podium') p where jsonb_typeof(p)<>'number' or (p#>>'{}')::numeric not between 0 and 105 or (p#>>'{}')::numeric<>round((p#>>'{}')::numeric,1))
  or (s#>>'{podium,0}')::numeric<(s#>>'{podium,1}')::numeric or (s#>>'{podium,1}')::numeric<(s#>>'{podium,2}')::numeric or (s->>'minimum')::numeric>(s#>>'{podium,2}')::numeric then raise exception 'invalid podium scoring' using errcode='22023'; end if;
 end if;
 perform save_racing_setup_stages(p_event,p_revision,p_input);
 if p_input ? 'scoring' then update racing_setup set scoring=s where event_id=p_event; end if;
 return racing_state(p_event);
end $$;
revoke execute on function racing_state(uuid),save_racing_setup(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function racing_state(uuid),save_racing_setup(uuid,integer,jsonb) to authenticated;
