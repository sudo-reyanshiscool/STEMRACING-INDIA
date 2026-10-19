-- Published scoring data is private to event management and the relevant team managers.
revoke all on ranking_snapshots from anon;
-- Column grants can survive a table-level revoke, so remove the original explicit grant too.
revoke select(id,event_id,created_by,created_at,ruleset_id,input_hash,rows,released) on ranking_snapshots from anon;
drop policy snapshots_select on ranking_snapshots;
create policy snapshots_select on ranking_snapshots for select to authenticated using(is_chair_or_organiser(event_id));

-- Filter the JSON on the server. No full snapshot or input data is sent to a team manager's browser.
create function released_results(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s ranking_snapshots; visible_rows jsonb;
begin
 if auth.uid() is null or not event_released(p_event) then return null; end if;
 if not exists(select 1 from event_roles where event_id=p_event and user_id=auth.uid() and role='team_manager') then return null; end if;
 select * into s from ranking_snapshots where event_id=p_event and released order by created_at desc,id desc limit 1;
 if not found then return null; end if;
 select coalesce(jsonb_agg(r order by ord),'[]') into visible_rows from jsonb_array_elements(s.rows) with ordinality as item(r,ord)
   where exists(select 1 from event_roles er where er.event_id=p_event and er.user_id=auth.uid() and er.role='team_manager' and er.team_id::text=r->>'teamId');
 return jsonb_build_object('id',s.id,'event_id',s.event_id,'created_at',s.created_at,'ruleset_id',s.ruleset_id,'input_hash',s.input_hash,'rows',visible_rows,'released',true);
end $$;
revoke execute on function released_results(uuid) from public,anon,authenticated;
grant execute on function released_results(uuid) to authenticated;

-- Everyone can see final standings, but never category, area, penalty or scorecard breakdowns.
create function public_standings(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s ranking_snapshots; standings jsonb;
begin
 if not event_released(p_event) then return null; end if;
 select * into s from ranking_snapshots where event_id=p_event and released order by created_at desc,id desc limit 1;
 if not found then return null; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'rank',r->'rank','teamId',r->'teamId','number',r->'number','name',r->'name','total',r->'total','tied',r->'tied'
 ) order by ord),'[]') into standings from jsonb_array_elements(s.rows) with ordinality as item(r,ord);
 return jsonb_build_object('createdAt',s.created_at,'rows',standings);
end $$;
revoke execute on function public_standings(uuid) from public,anon,authenticated;
grant execute on function public_standings(uuid) to anon,authenticated;
