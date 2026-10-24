-- Update reaction racing generation so Heat 1 and Heat 2 are identical pairings with opposite lanes,
-- Car A runs are followed by Car B runs, and numbering follows RR-H01, RR-H02, etc.
create or replace function queue_reaction_races(p_event uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e events;
  ids uuid[];
  n integer;
  i integer;
  heat_num integer := 1;
  car text;
  car1 text;
  car2 text;
begin
  select * into e from events where id=p_event for update;
  if not found or e.deleted_at is not null or not is_chair_or_organiser(p_event) then
    raise exception 'organiser or Chair required' using errcode='42501';
  end if;
  if e.results_released or exists(select 1 from racing_setup where event_id=p_event and reaction_complete) or exists(select 1 from race_heats where event_id=p_event and phase='reaction') then
    raise exception 'reaction racing already queued or locked' using errcode='55000';
  end if;
  select array_agg(id order by number,id) into ids from teams where event_id=p_event;
  n := cardinality(ids);
  if n is null or n < 2 then
    raise exception 'at least two teams required' using errcode='22023';
  end if;

  if (n % 2 = 0) then
    i := 1;
    while i < n loop
      foreach car in array array['A','B'] loop
        perform save_race(p_event, gen_random_uuid(), 0, jsonb_build_object(
          'label', 'RR-H' || lpad(heat_num::text, 2, '0'),
          'phase', 'reaction',
          'lane1', jsonb_build_object('teamId', ids[i], 'car', car, 'status', 'pending', 'totalMs', null, 'reactionMs', null),
          'lane2', jsonb_build_object('teamId', ids[i+1], 'car', car, 'status', 'pending', 'totalMs', null, 'reactionMs', null),
          'note', '', 'source', 'manual', 'sourceRunId', null
        ));
        heat_num := heat_num + 1;
        perform save_race(p_event, gen_random_uuid(), 0, jsonb_build_object(
          'label', 'RR-H' || lpad(heat_num::text, 2, '0'),
          'phase', 'reaction',
          'lane1', jsonb_build_object('teamId', ids[i+1], 'car', car, 'status', 'pending', 'totalMs', null, 'reactionMs', null),
          'lane2', jsonb_build_object('teamId', ids[i], 'car', car, 'status', 'pending', 'totalMs', null, 'reactionMs', null),
          'note', '', 'source', 'manual', 'sourceRunId', null
        ));
        heat_num := heat_num + 1;
      end loop;
      i := i + 2;
    end loop;
  else
    for i in 1..n loop
      car1 := case when i % 2 = 1 then 'A' else 'B' end;
      car2 := case when i = n then 'B' when i % 2 = 1 then 'A' else 'B' end;
      perform save_race(p_event, gen_random_uuid(), 0, jsonb_build_object(
        'label', 'RR-H' || lpad(heat_num::text, 2, '0'),
        'phase', 'reaction',
        'lane1', jsonb_build_object('teamId', ids[i], 'car', car1, 'status', 'pending', 'totalMs', null, 'reactionMs', null),
        'lane2', jsonb_build_object('teamId', ids[(i%n)+1], 'car', car2, 'status', 'pending', 'totalMs', null, 'reactionMs', null),
        'note', '', 'source', 'manual', 'sourceRunId', null
      ));
      heat_num := heat_num + 1;
      perform save_race(p_event, gen_random_uuid(), 0, jsonb_build_object(
        'label', 'RR-H' || lpad(heat_num::text, 2, '0'),
        'phase', 'reaction',
        'lane1', jsonb_build_object('teamId', ids[(i%n)+1], 'car', car2, 'status', 'pending', 'totalMs', null, 'reactionMs', null),
        'lane2', jsonb_build_object('teamId', ids[i], 'car', car1, 'status', 'pending', 'totalMs', null, 'reactionMs', null),
        'note', '', 'source', 'manual', 'sourceRunId', null
      ));
      heat_num := heat_num + 1;
    end loop;
  end if;
end $$;

revoke execute on function queue_reaction_races(uuid) from public, anon, authenticated;
grant execute on function queue_reaction_races(uuid) to authenticated;
