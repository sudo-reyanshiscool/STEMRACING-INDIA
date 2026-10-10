-- Final review fixes. Applied after 0001 to 0003, which stay untouched.
-- Rules as before: every function is SECURITY DEFINER with a pinned search_path, and executable only by whom it names.

-- A conflict of interest must be declared before judging, not after: once a judge has submitted a card for a team,
-- the card already counts, so declaring afterwards would only hide the problem from the Chair. Declaring is refused
-- (locked) then, and while results are released.
create function conflicts_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Only the judge's own declaration is judged here; anyone naming someone else falls through to the policies (denied).
  if new.judge_id is not distinct from auth.uid() then
    if event_released(new.event_id) then
      raise exception 'results are released; a conflict can no longer be declared' using errcode = '55000';
    end if;
    if exists (select 1 from scorecards where event_id = new.event_id and team_id = new.team_id and judge_id = new.judge_id and status = 'submitted') then
      raise exception 'you have already submitted a scorecard for this team; ask the Chair' using errcode = '55000';
    end if;
  end if;
  return new;
end $$;
create trigger conflicts_guard before insert on judge_conflicts for each row execute function conflicts_guard();
revoke execute on function conflicts_guard() from public, anon, authenticated;
