-- Team deletion is explicit and atomic. Existing submitted-card guards remain in force on cascades.
create function delete_team(p_event uuid, p_team uuid, p_confirmation text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t teams; e events;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '28000'; end if;
  select * into e from events where id = p_event for update;
  if not found or not is_chair_or_organiser(p_event) then
    raise exception 'only the Chair or Organiser can delete teams' using errcode = '42501';
  end if;
  if e.results_released then raise exception 'withdraw the release before deleting teams' using errcode = '55000'; end if;
  select * into t from teams where id = p_team and event_id = p_event for update;
  if not found then raise exception 'team not found' using errcode = 'P0002'; end if;
  if p_confirmation is distinct from t.number then raise exception 'team number does not match' using errcode = '22023'; end if;
  delete from teams where id = t.id;
  perform audit_write(p_event, 'delete', 'teams', t.id::text, jsonb_build_object('old', to_jsonb(t)));
end $$;
revoke execute on function delete_team(uuid, uuid, text) from public, anon, authenticated;
grant execute on function delete_team(uuid, uuid, text) to authenticated;
-- Require confirmation through the RPC rather than allowing clients to bypass it with a direct delete.
revoke delete on teams from anon, authenticated;
