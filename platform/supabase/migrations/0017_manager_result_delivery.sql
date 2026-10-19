-- Manager contact details are private event-management records, never public team columns.
create table team_contacts (
 team_id uuid primary key, event_id uuid not null,
 manager_email text not null check(char_length(manager_email)<=254 and manager_email=lower(btrim(manager_email)) and manager_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
 foreign key(team_id,event_id) references teams(id,event_id) on delete cascade
);
create table event_awards (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references events(id) on delete cascade,
 title text not null check(char_length(btrim(title)) between 1 and 120), team_id uuid not null,
 foreign key(team_id,event_id) references teams(id,event_id) on delete cascade
);
create unique index event_awards_title on event_awards(event_id,lower(btrim(title)));
create table result_mail_settings (
 event_id uuid primary key references events(id) on delete cascade,
 awards_confirmed boolean not null default false, awards_version uuid not null default gen_random_uuid(),
 confirmed_by uuid references auth.users(id),confirmed_at timestamptz
);
create table result_email_deliveries (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references events(id),team_id uuid not null,
 snapshot_id uuid not null references ranking_snapshots(id),awards_version uuid not null,
 email text not null, status text not null check(status in ('sending','sent','failed','uncertain')),
 attempt uuid not null default gen_random_uuid(),attempt_at timestamptz not null default clock_timestamp(),sent_at timestamptz,
 failure text check(failure in ('provider','configuration','generation','unconfirmed')),
 foreign key(team_id,event_id) references teams(id,event_id) on delete cascade,
 unique(snapshot_id,awards_version,team_id,email)
);
revoke all on team_contacts,event_awards,result_mail_settings,result_email_deliveries from public,anon,authenticated;
alter table team_contacts enable row level security;
alter table event_awards enable row level security;
alter table result_mail_settings enable row level security;
alter table result_email_deliveries enable row level security;
grant select on team_contacts,event_awards,result_mail_settings,result_email_deliveries to authenticated;
create policy contacts_staff on team_contacts for select to authenticated using(is_chair_or_organiser(event_id));
create policy awards_staff on event_awards for select to authenticated using(is_chair_or_organiser(event_id));
create policy mail_settings_staff on result_mail_settings for select to authenticated using(is_chair_or_organiser(event_id));
create policy deliveries_staff on result_email_deliveries for select to authenticated using(is_chair_or_organiser(event_id));
create trigger contacts_audit after insert or update or delete on team_contacts for each row execute function audit_row();
create trigger awards_audit after insert or update or delete on event_awards for each row execute function audit_row();

create function set_team_contact(p_event uuid,p_team uuid,p_email text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare email_address text:=lower(btrim(coalesce(p_email,'')));
begin
 perform 1 from events where id=p_event for update;
 if not is_chair_or_organiser(p_event) or not exists(select 1 from teams where id=p_team and event_id=p_event) then raise exception 'only event staff can set a team manager contact' using errcode='42501'; end if;
 if exists(select 1 from result_email_deliveries where event_id=p_event and status='sending' and attempt_at>clock_timestamp()-interval '15 minutes') then raise exception 'wait for the current results email batch to finish' using errcode='55000'; end if;
 delete from invitations where event_id=p_event and team_id=p_team and role='team_manager' and email<>(email_address) and email=(select manager_email from team_contacts where team_id=p_team);
 if email_address='' then delete from team_contacts where team_id=p_team; return; end if;
 insert into team_contacts(team_id,event_id,manager_email) values(p_team,p_event,email_address)
 on conflict(team_id) do update set manager_email=excluded.manager_email;
 -- Access remains email-verified. Importing stores a pending role without sending sign-in email.
 if not exists(select 1 from event_roles where event_id=p_event and team_id=p_team and role='team_manager' and lower(email)=email_address) then
  insert into invitations(event_id,email,role,team_id) values(p_event,email_address,'team_manager',p_team) on conflict do nothing;
 end if;
end $$;

create or replace function import_teams(p_event uuid,p_teams jsonb) returns setof teams
language plpgsql security definer set search_path = public, pg_temp as $$
declare item jsonb; result teams;
begin
 perform 1 from events where id=p_event for update;
 if not is_chair_or_organiser(p_event) then raise exception 'only event staff can import teams' using errcode='42501'; end if;
 if p_teams is null or jsonb_typeof(p_teams)<>'array' or jsonb_array_length(p_teams) not between 1 and 1000 then raise exception 'import between 1 and 1000 teams' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_teams) loop
  if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'number') is distinct from 'string' or jsonb_typeof(item->'name') is distinct from 'string'
  or ((item?'school') and jsonb_typeof(item->'school') is distinct from 'string') or ((item?'managerEmail') and jsonb_typeof(item->'managerEmail') is distinct from 'string') then raise exception 'invalid team row' using errcode='22023'; end if;
  if char_length(btrim(item->>'number')) not between 1 and 12 or char_length(btrim(item->>'name')) not between 1 and 80 or char_length(btrim(coalesce(item->>'school','')))>120 then raise exception 'invalid team number, name or school' using errcode='22023'; end if;
  insert into teams(event_id,number,name,school) values(p_event,btrim(item->>'number'),btrim(item->>'name'),btrim(coalesce(item->>'school',''))) returning * into result;
  if btrim(coalesce(item->>'managerEmail',''))<>'' then perform set_team_contact(p_event,result.id,item->>'managerEmail'); end if;
  return next result;
 end loop;
end $$;

create function save_event_award(p_event uuid,p_title text,p_team uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 perform 1 from events where id=p_event for update;
 if not is_chair_or_organiser(p_event) then raise exception 'only the Organiser or Chair can select awards' using errcode='42501'; end if;
 if exists(select 1 from result_email_deliveries where event_id=p_event and status='sending' and attempt_at>clock_timestamp()-interval '15 minutes') then raise exception 'wait for results email delivery to finish' using errcode='55000'; end if;
 insert into event_awards(event_id,title,team_id) values(p_event,btrim(p_title),p_team)
 on conflict(event_id,lower(btrim(title))) do update set team_id=excluded.team_id;
 insert into result_mail_settings(event_id) values(p_event) on conflict(event_id) do update set awards_confirmed=false,confirmed_by=null,confirmed_at=null;
end $$;
create function remove_event_award(p_award uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare ev uuid;
begin
 select event_id into ev from event_awards where id=p_award;
 perform 1 from events where id=ev for update;
 if not is_chair_or_organiser(ev) then raise exception 'only the Organiser or Chair can select awards' using errcode='42501'; end if;
 if exists(select 1 from result_email_deliveries where event_id=ev and status='sending' and attempt_at>clock_timestamp()-interval '15 minutes') then raise exception 'wait for results email delivery to finish' using errcode='55000'; end if;
 delete from event_awards where id=p_award;
 update result_mail_settings set awards_confirmed=false,confirmed_by=null,confirmed_at=null where event_id=ev;
end $$;
create function confirm_event_awards(p_event uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 perform 1 from events where id=p_event for update;
 if not is_chair_or_organiser(p_event) then raise exception 'only the Organiser or Chair can confirm awards' using errcode='42501'; end if;
 insert into result_mail_settings(event_id,awards_confirmed,confirmed_by,confirmed_at) values(p_event,true,auth.uid(),clock_timestamp())
 on conflict(event_id) do update set awards_confirmed=true,awards_version=case when result_mail_settings.awards_confirmed then result_mail_settings.awards_version else gen_random_uuid() end,confirmed_by=auth.uid(),confirmed_at=clock_timestamp();
 perform audit_write(p_event,'confirm_awards','events',p_event::text,null);
end $$;

create function result_mail_state(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s result_mail_settings; snap uuid;
begin
 if not is_chair_or_organiser(p_event) then raise exception 'only event staff can manage results email' using errcode='42501'; end if;
 select * into s from result_mail_settings where event_id=p_event;
 select id into snap from ranking_snapshots where event_id=p_event and released order by created_at desc,id desc limit 1;
 return jsonb_build_object('confirmed',coalesce(s.awards_confirmed,false),'version',s.awards_version,'snapshotId',snap,
 'awards',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'teamId',a.team_id) order by a.title),'[]') from event_awards a where event_id=p_event),
 'deliveries',(select coalesce(jsonb_agg(jsonb_build_object('teamId',d.team_id,'email',d.email,'status',case when d.status='sending' and d.attempt_at<clock_timestamp()-interval '15 minutes' then 'uncertain' else d.status end,'sentAt',d.sent_at)),'[]') from result_email_deliveries d where event_id=p_event and snapshot_id=snap and awards_version=s.awards_version));
end $$;

-- The only payload used by PDF generation. Private reviews/criterion notes are deliberately absent.
create function team_results_packet(p_event uuid,p_team uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s ranking_snapshots; t teams; winner jsonb;
begin
 if not is_chair_or_organiser(p_event) then raise exception 'only event staff can preview results PDFs' using errcode='42501'; end if;
 select * into t from teams where id=p_team and event_id=p_event;
 if not found then raise exception 'team not found' using errcode='22023'; end if;
 select * into s from ranking_snapshots where event_id=p_event and released order by created_at desc,id desc limit 1;
 if not found or not exists(select 1 from jsonb_array_elements(s.rows) r where r->>'teamId'=p_team::text) then raise exception 'publish a ranking containing this team before generating results PDFs' using errcode='55000'; end if;
 return jsonb_build_object('released',event_released(p_event),'awardsConfirmed',coalesce((select awards_confirmed from result_mail_settings where event_id=p_event),false),'eventName',(select name from events where id=p_event),'eventId',p_event,'snapshotId',s.id,'createdAt',s.created_at,'ruleset',(select ruleset from events where id=p_event),
 'team',jsonb_build_object('id',t.id,'number',t.number,'name',t.name,'school',t.school),
 'standings',(select coalesce(jsonb_agg(jsonb_build_object('rank',r->'rank','teamId',r->'teamId','number',r->'number','name',r->'name','total',r->'total') order by ord),'[]') from jsonb_array_elements(s.rows) with ordinality x(r,ord)),
 'teamResult',(select r from jsonb_array_elements(s.rows) r where r->>'teamId'=p_team::text),
 'awards',(select coalesce(jsonb_agg(jsonb_build_object('title',a.title,'teamNumber',tt.number,'teamName',tt.name) order by a.title),'[]') from event_awards a join teams tt on tt.id=a.team_id where a.event_id=p_event),
 'cards',(select coalesce(jsonb_agg(jsonb_build_object('areaId',c.area_id,'scores',(select coalesce(jsonb_object_agg(ss.criterion_id,ss.score),'{}') from scorecard_scores ss where ss.scorecard_id=c.id),
 'feedback',jsonb_build_object('overall',f.overall,'strengths',f.strengths,'improvements',f.improvements)) order by c.area_id,c.id),'[]') from scorecards c left join scorecard_feedback f on f.scorecard_id=c.id where c.event_id=p_event and c.team_id=p_team and c.status='submitted'),
 'penalties',(select coalesce(jsonb_agg(jsonb_build_object('points',p.points,'reason',p.reason)),'[]') from penalties p where p.event_id=p_event and p.team_id=p_team),
 'inspections',(select coalesce(jsonb_agg(jsonb_build_object('car',i.car,'measurements',i.measurements) order by i.car),'[]') from technical_inspections i where i.event_id=p_event and i.team_id=p_team and i.status='submitted'));
end $$;

create function reserve_team_results_email(p_event uuid,p_team uuid,p_snapshot uuid,p_awards_version uuid,p_email text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare contact team_contacts; settings result_mail_settings; snap uuid; job result_email_deliveries; ticket uuid:=gen_random_uuid();
begin
 perform 1 from events where id=p_event for update;
 if not is_chair_or_organiser(p_event) then raise exception 'only event staff can email results' using errcode='42501'; end if;
 if not event_released(p_event) then raise exception 'release final results before emailing managers' using errcode='55000'; end if;
 select * into settings from result_mail_settings where event_id=p_event;
 if not coalesce(settings.awards_confirmed,false) then raise exception 'the Organiser or Chair must confirm awards first' using errcode='55000'; end if;
 select * into contact from team_contacts where team_id=p_team and event_id=p_event;
 if not found then raise exception 'add this team manager email first' using errcode='22023'; end if;
 select id into snap from ranking_snapshots where event_id=p_event and released order by created_at desc,id desc limit 1;
 if snap is null then raise exception 'publish the final ranking first' using errcode='55000'; end if;
 if p_snapshot is distinct from snap or p_awards_version is distinct from settings.awards_version or lower(btrim(p_email)) is distinct from contact.manager_email then raise exception 'results, awards or recipient changed; review the email batch again' using errcode='55000'; end if;
 select * into job from result_email_deliveries where snapshot_id=snap and awards_version=settings.awards_version and team_id=p_team and email=contact.manager_email for update;
 if found then
  if job.status='sent' then return jsonb_build_object('status','already_sent'); end if;
  if job.status='uncertain' or (job.status='sending' and job.attempt_at<clock_timestamp()-interval '15 minutes') then raise exception 'previous delivery is unconfirmed; check the recipient inbox before resending' using errcode='55000'; end if;
  if job.status='sending' then return jsonb_build_object('status','busy'); end if;
  update result_email_deliveries set status='sending',attempt=ticket,attempt_at=clock_timestamp(),failure=null where id=job.id returning * into job;
 else
  insert into result_email_deliveries(event_id,team_id,snapshot_id,awards_version,email,status,attempt) values(p_event,p_team,snap,settings.awards_version,contact.manager_email,'sending',ticket) returning * into job;
 end if;
 return jsonb_build_object('status','reserved','jobId',job.id,'attempt',ticket,'email',contact.manager_email,'packet',team_results_packet(p_event,p_team));
end $$;
create function complete_team_results_email(p_job uuid,p_attempt uuid,p_status text,p_failure text default null) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
 if p_status is null or p_status not in ('sent','failed','uncertain') or (p_status='sent' and p_failure is not null) or (p_status<>'sent' and (p_failure is null or p_failure not in ('provider','configuration','generation','unconfirmed'))) then raise exception 'invalid results delivery outcome' using errcode='22023'; end if;
 update result_email_deliveries set status=p_status,sent_at=case when p_status='sent' then clock_timestamp() else sent_at end,failure=p_failure where id=p_job and attempt=p_attempt and status='sending';
 get diagnostics n=row_count;return n=1;
end $$;
revoke execute on function set_team_contact(uuid,uuid,text),save_event_award(uuid,text,uuid),remove_event_award(uuid),confirm_event_awards(uuid),result_mail_state(uuid),team_results_packet(uuid,uuid),reserve_team_results_email(uuid,uuid,uuid,uuid,text),complete_team_results_email(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function set_team_contact(uuid,uuid,text),save_event_award(uuid,text,uuid),remove_event_award(uuid),confirm_event_awards(uuid),result_mail_state(uuid),team_results_packet(uuid,uuid),reserve_team_results_email(uuid,uuid,uuid,uuid,text) to authenticated;
grant execute on function complete_team_results_email(uuid,uuid,text,text) to service_role;

create function acknowledge_result_email_retry(p_event uuid,p_team uuid,p_snapshot uuid,p_awards_version uuid,p_email text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 perform 1 from events where id=p_event for update;
 if not is_chair_or_organiser(p_event) then raise exception 'only event staff can acknowledge a delivery retry' using errcode='42501'; end if;
 update result_email_deliveries set status='failed',failure='unconfirmed' where event_id=p_event and team_id=p_team and snapshot_id=p_snapshot and awards_version=p_awards_version and email=p_email and (status='uncertain' or (status='sending' and attempt_at<clock_timestamp()-interval '15 minutes'));
 if not found then raise exception 'no unconfirmed delivery is available for retry' using errcode='55000'; end if;
 perform audit_write(p_event,'acknowledge_email_retry','teams',p_team::text,jsonb_build_object('recipient',p_email));
end $$;
revoke execute on function acknowledge_result_email_retry(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function acknowledge_result_email_retry(uuid,uuid,uuid,uuid,text) to authenticated;
