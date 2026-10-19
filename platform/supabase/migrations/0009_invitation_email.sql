-- Delivery metadata is server-written. Creating access and sending mail are separate recoverable steps.
alter table invitations
  add column email_status text not null default 'not_sent' check (email_status in ('not_sent','sending','sent','failed')),
  add column email_sent_at timestamptz,
  add column email_attempt_at timestamptz,
  add column email_attempt uuid,
  add column email_failure text check (email_failure in ('provider','rate_limit'));
revoke insert,update on invitations from anon,authenticated;
grant insert(event_id,email,role,panel,team_id) on invitations to authenticated;
grant update(event_id,email,role,panel,team_id) on invitations to authenticated;

create function reserve_invitation_email(p_invitation uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare i invitations; ticket uuid; retry integer;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode='28000'; end if;
  select * into i from invitations where id=p_invitation for update;
  if not found or not event_active(i.event_id) or not is_chair_or_organiser(i.event_id) then raise exception 'invitation not available' using errcode='42501'; end if;
  if i.email_attempt_at is not null and i.email_attempt_at>clock_timestamp()-interval '60 seconds' then
    retry:=greatest(1,ceil(extract(epoch from (i.email_attempt_at+interval '60 seconds'-clock_timestamp())))::integer);
    return jsonb_build_object('status','cooldown','retryAfter',retry);
  end if;
  ticket:=gen_random_uuid();
  update invitations set email_status='sending',email_attempt=ticket,email_attempt_at=clock_timestamp(),email_failure=null where id=i.id;
  return jsonb_build_object('status','reserved','email',i.email,'attempt',ticket);
end $$;

create function complete_invitation_email(p_invitation uuid,p_attempt uuid,p_status text,p_failure text default null) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare changed integer;
begin
  if p_status is null or p_status not in ('sent','failed') or (p_status='failed' and (p_failure is null or p_failure not in ('provider','rate_limit'))) or (p_status='sent' and p_failure is not null) then raise exception 'invalid delivery outcome' using errcode='22023'; end if;
  update invitations set email_status=p_status,email_sent_at=case when p_status='sent' then clock_timestamp() else email_sent_at end,email_failure=p_failure
    where id=p_invitation and email_attempt=p_attempt and email_status='sending';
  get diagnostics changed=row_count;
  return changed=1;
end $$;
revoke execute on function reserve_invitation_email(uuid),complete_invitation_email(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function reserve_invitation_email(uuid) to authenticated;
grant execute on function complete_invitation_email(uuid,uuid,text,text) to service_role;
-- current_schema() follows the isolated installer; no other application's grants change.
do $$ begin execute format('grant usage on schema %I to service_role',current_schema()); end $$;
