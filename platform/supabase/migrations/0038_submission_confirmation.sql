-- One server-selected receipt per successful portfolio revision; never accept a recipient from the browser.
create table submission_email_deliveries (
 id uuid primary key default gen_random_uuid(),file_id uuid not null references team_files(id) on delete cascade,
 event_id uuid not null references events(id) on delete cascade,team_id uuid not null,revision integer not null,
 email text,receipt jsonb not null,status text not null default 'pending' check(status in ('pending','sending','sent','failed','uncertain','unavailable')),
 attempt uuid,attempt_at timestamptz,sent_at timestamptz,unique(file_id,revision),
 foreign key(team_id,event_id) references teams(id,event_id) on delete cascade
);
alter table submission_email_deliveries enable row level security;
revoke all on submission_email_deliveries from public,anon,authenticated;
create function queue_submission_receipt() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare recipient text;details jsonb;
begin
 if new.kind='logo' then return new; end if;
 select manager_email into recipient from team_contacts where event_id=new.event_id and team_id=new.team_id;
 if recipient is null then select email into recipient from auth.users where id=auth.uid() and email_confirmed_at is not null; end if;
 select jsonb_build_object('eventName',e.name,'eventId',e.id,'teamNumber',t.number,'teamName',t.name,'kind',new.kind,'filename',new.name,'revision',new.revision,'uploadedAt',new.updated_at,'submittedAt',new.submitted_at,'deadline',r.deadline,'points',r.points)
 into details from events e join teams t on t.event_id=e.id cross join lateral portfolio_submission_rows(e.id) r where e.id=new.event_id and t.id=new.team_id and r.team_id=t.id and r.kind=new.kind;
 insert into submission_email_deliveries(file_id,event_id,team_id,revision,email,receipt,status) values(new.id,new.event_id,new.team_id,new.revision,recipient,details,case when recipient is null then 'unavailable' else 'pending' end);
 return new;
end $$;
create trigger submission_receipt after insert or update on team_files for each row execute function queue_submission_receipt();
create function reserve_submission_email(p_event uuid,p_team uuid,p_kind text,p_revision integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare job submission_email_deliveries; ticket uuid:=gen_random_uuid();
begin
 if not event_active(p_event) or platform_spectator() or not (is_chair_or_organiser(p_event) or manages_team(p_event,p_team)) then raise exception 'only your team or event staff may send a submission receipt' using errcode='42501'; end if;
 select d.* into job from submission_email_deliveries d join team_files f on f.id=d.file_id where d.event_id=p_event and d.team_id=p_team and f.kind=p_kind and d.revision=p_revision for update of d;
 if not found then raise exception 'successful portfolio upload required' using errcode='55000'; end if;
 if job.status='sent' then return jsonb_build_object('status','already_sent'); end if;
 if job.status in ('uncertain','unavailable') then raise exception 'delivery unavailable or unconfirmed; check the inbox' using errcode='55000'; end if;
 if job.status='sending' then return jsonb_build_object('status','busy'); end if;
 update submission_email_deliveries set status='sending',attempt=ticket,attempt_at=clock_timestamp() where id=job.id;
 return jsonb_build_object('status','reserved','jobId',job.id,'attempt',ticket);
end $$;
create function complete_submission_email(p_job uuid,p_attempt uuid,p_status text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
 if p_status is null or p_status not in ('sent','failed','uncertain') then raise exception 'invalid email outcome' using errcode='22023'; end if;
 update submission_email_deliveries set status=p_status,sent_at=case when p_status='sent' then clock_timestamp() else null end where id=p_job and attempt=p_attempt and status='sending';
 get diagnostics n=row_count;return n=1;
end $$;
alter function submission_state(uuid) rename to submission_state_without_email;
create function submission_state(p_event uuid) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare state jsonb;
begin
 state:=submission_state_without_email(p_event);
 return jsonb_set(state,'{rows}',(select coalesce(jsonb_agg(r||coalesce((select jsonb_build_object('confirmation',case when d.status='sending' and d.attempt_at<statement_timestamp()-interval '15 minutes' then 'uncertain' else d.status end,'revision',d.revision) from submission_email_deliveries d join team_files f on f.id=d.file_id where d.event_id=p_event and d.team_id=(r->>'teamId')::uuid and f.kind=r->>'kind' order by d.revision desc limit 1),'{}'::jsonb)),'[]') from jsonb_array_elements(state->'rows') r));
end $$;
revoke execute on function queue_submission_receipt(),reserve_submission_email(uuid,uuid,text,integer),complete_submission_email(uuid,uuid,text),submission_state_without_email(uuid),submission_state(uuid) from public,anon,authenticated;
grant execute on function reserve_submission_email(uuid,uuid,text,integer),submission_state(uuid) to authenticated;
grant execute on function complete_submission_email(uuid,uuid,text) to service_role;

-- Recipient details are available only to the delivery service, never to a caller's browser.
create function submission_email_payload(p_job uuid,p_attempt uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
 select jsonb_build_object('email',email,'receipt',receipt) from submission_email_deliveries where id=p_job and attempt=p_attempt and status='sending'
$$;
revoke execute on function submission_email_payload(uuid,uuid) from public,anon,authenticated;
grant execute on function submission_email_payload(uuid,uuid) to service_role;
