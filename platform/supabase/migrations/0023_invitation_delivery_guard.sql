-- Delivery completion runs without a human session. Permit metadata-only updates;
-- changes to the invitation itself retain the organiser permission checks.
create or replace function protect_invitation_role() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if tg_op='UPDATE' then
  if (to_jsonb(new) - array['email_status','email_sent_at','email_attempt_at','email_attempt','email_failure'])
     is not distinct from
     (to_jsonb(old) - array['email_status','email_sent_at','email_attempt_at','email_attempt','email_failure']) then
   return new;
  end if;
 end if;
 if new.role='organiser' and not has_role(new.event_id,'organiser') then raise exception 'only organisers can invite organisers' using errcode='42501'; end if;
 if tg_op='UPDATE' and old.role='organiser' and not has_role(old.event_id,'organiser') then raise exception 'only organisers can change organiser invitations' using errcode='42501'; end if;
 return new;
end $$;
revoke execute on function protect_invitation_role() from public, anon, authenticated;
