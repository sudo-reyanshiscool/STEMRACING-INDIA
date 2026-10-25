-- Spectators can read organiser data but gain no organiser/Chair write roles.
create policy spectator_cards_read on scorecards for select to authenticated using(platform_spectator() and event_active(event_id));
create policy spectator_private_reviews_read on scorecard_private_reviews for select to authenticated using(exists(select 1 from scorecards c where c.id=scorecard_id and platform_spectator() and event_active(c.event_id)));
create policy spectator_overrides_read on score_overrides for select to authenticated using(platform_spectator() and event_active(event_id));
create policy spectator_penalties_read on penalties for select to authenticated using(platform_spectator() and event_active(event_id));
create policy spectator_snapshots_read on ranking_snapshots for select to authenticated using(platform_spectator() and event_active(event_id));
create policy spectator_roles_read on event_roles for select to authenticated using(platform_spectator() and event_active(event_id));
create policy spectator_invitations_read on invitations for select to authenticated using(platform_spectator() and event_active(event_id));
create policy spectator_broadcasts_read on broadcast_emails for select to authenticated using(platform_spectator() and event_active(event_id));
create policy spectator_audit_read on audit_log for select to authenticated using(platform_spectator() and (event_id is null or event_active(event_id)));
create policy spectator_contacts_read on team_contacts for select to authenticated using(platform_spectator() and event_active(event_id));

create or replace function list_event_people(p_event uuid) returns setof event_roles
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r event_roles; profile platform_organisers;
begin
 if not event_active(p_event) then return; end if;
 for r in select * from event_roles where event_id=p_event and (user_id=auth.uid() or is_chair_or_organiser(p_event) or platform_spectator()) loop
  if not organiser_identity_visible(r.user_id,r.email) then continue; end if;
  select * into profile from platform_organisers where user_id=r.user_id;
  if profile.hide_identity and not exists(select 1 from platform_owner where user_id=auth.uid()) then continue; end if;
  if profile.hide_email and not exists(select 1 from platform_owner where user_id=auth.uid()) then r.email:=null; r.display_name:=profile.display_name; end if;
  return next r;
 end loop;
end $$;

create or replace function list_event_invitations(p_event uuid) returns setof invitations
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare i invitations; profile platform_organisers;
begin
 if not (is_chair_or_organiser(p_event) or platform_spectator()) then return; end if;
 for i in select * from invitations where event_id=p_event loop
  if not organiser_identity_visible(null,i.email) then continue; end if;
  select * into profile from platform_organisers where lower(email)=lower(i.email);
  if profile.hide_identity and not exists(select 1 from platform_owner where user_id=auth.uid()) then continue; end if;
  if profile.hide_email and not exists(select 1 from platform_owner where user_id=auth.uid()) then i.email:=''; i.display_name:=profile.display_name; end if;
  return next i;
 end loop;
end $$;

create or replace function list_team_concerns(p_event uuid)
returns table (id uuid, "eventId" uuid, "teamId" uuid, panel judging_panel, message text, status text, response text, "createdAt" timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
 if not exists(select 1 from events where events.id=p_event and deleted_at is null)
 or not (is_chair_or_organiser(p_event) or platform_spectator() or has_role(p_event,'team_manager')) then
  raise exception 'feedback unavailable' using errcode='42501';
 end if;
 return query select c.id,c.event_id,c.team_id,c.panel,c.message,c.status,c.response,c.created_at
 from team_concerns c where c.event_id=p_event and (is_chair_or_organiser(p_event) or platform_spectator() or exists(
 select 1 from event_roles r where r.event_id=p_event and r.user_id=auth.uid() and r.role='team_manager' and r.team_id=c.team_id));
end $$;

create or replace function snapshot_inputs(p_snapshot uuid) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s ranking_snapshots;
begin
  select * into s from ranking_snapshots where id = p_snapshot;
  if not found or not (is_chair_or_organiser(s.event_id) or (platform_spectator() and event_active(s.event_id))) then
    raise exception 'snapshot inputs are restricted to the Chair and Organiser' using errcode = '42501';
  end if;
  return s.inputs;
end $$;

create or replace function draw_lots_state(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s jsonb;
begin
 if not (is_chair_or_organiser(p_event) or (platform_spectator() and event_active(p_event))) then raise exception 'only event staff can draw lots' using errcode='42501'; end if;
 s:=jsonb_build_object(
  'teams',(select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]') from teams t where event_id=p_event),
  'roles',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from list_event_people(p_event) r),
  'conflicts',(select coalesce(jsonb_agg(to_jsonb(c) order by judge_id,team_id),'[]') from judge_conflicts c where event_id=p_event and organiser_identity_visible(c.judge_id,null)),
  'exemptions',(select coalesce(jsonb_agg(to_jsonb(x) order by judge_id,team_id),'[]') from judge_exemptions x where event_id=p_event and organiser_identity_visible(x.judge_id,null)),
  'released',event_released(p_event),
  'numberingLocked',event_released(p_event)
   or exists(select 1 from scorecards where event_id=p_event)
   or exists(select 1 from technical_inspections where event_id=p_event)
   or exists(select 1 from race_heats where event_id=p_event)
   or exists(select 1 from ranking_snapshots where event_id=p_event),
  'lockedPanels',(select coalesce(jsonb_agg(p order by p),'[]') from (select panel::text p from scorecards where event_id=p_event union select 'scrutineering' from technical_inspections where event_id=p_event) panels)
 );
 return s||jsonb_build_object('version',md5(s::text));
end $$;

create or replace function result_mail_state(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s result_mail_settings; snap uuid;
begin
 if not (is_chair_or_organiser(p_event) or (platform_spectator() and event_active(p_event))) then raise exception 'only event staff can manage results email' using errcode='42501'; end if;
 select * into s from result_mail_settings where event_id=p_event;
 select id into snap from ranking_snapshots where event_id=p_event and released order by created_at desc,id desc limit 1;
 return jsonb_build_object('confirmed',coalesce(s.awards_confirmed,false),'version',s.awards_version,'snapshotId',snap,
 'awards',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'teamId',a.team_id) order by a.title),'[]') from event_awards a where event_id=p_event),
 'deliveries',(select coalesce(jsonb_agg(jsonb_build_object('teamId',d.team_id,'email',d.email,'status',case when d.status='sending' and d.attempt_at<clock_timestamp()-interval '15 minutes' then 'uncertain' else d.status end,'sentAt',d.sent_at)),'[]') from result_email_deliveries d where event_id=p_event and snapshot_id=snap and awards_version=s.awards_version));
end $$;

create or replace function team_results_packet(p_event uuid,p_team uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s ranking_snapshots; t teams; winner jsonb;
begin
 if not (is_chair_or_organiser(p_event) or (platform_spectator() and event_active(p_event))) then raise exception 'only event staff can preview results PDFs' using errcode='42501'; end if;
 select * into t from teams where id=p_team and event_id=p_event;
 if not found then raise exception 'team not found' using errcode='22023'; end if;
 select * into s from ranking_snapshots where event_id=p_event and released order by created_at desc,id desc limit 1;
 if not found or not exists(select 1 from jsonb_array_elements(s.rows) r where r->>'teamId'=p_team::text) then raise exception 'publish a ranking containing this team before generating results PDFs' using errcode='55000'; end if;
 return jsonb_build_object('released',event_released(p_event),'awardsConfirmed',coalesce((select awards_confirmed from result_mail_settings where event_id=p_event),false),'eventName',(select name from events where id=p_event),'eventId',p_event,'snapshotId',s.id,'createdAt',s.created_at,'ruleset',(select ruleset from events where id=p_event),
 'team',jsonb_build_object('id',t.id,'number',t.number,'name',t.name,'school',t.school),
 'standings',(select coalesce(jsonb_agg(jsonb_build_object('rank',r->'rank','teamId',r->'teamId','number',r->'number','name',r->'name','school',(select tt.school from teams tt where tt.id=(r->>'teamId')::uuid and tt.event_id=p_event),'total',r->'total') order by ord),'[]') from jsonb_array_elements(s.rows) with ordinality x(r,ord)),
 'teamResult',(select r from jsonb_array_elements(s.rows) r where r->>'teamId'=p_team::text),
 'awards',(select coalesce(jsonb_agg(jsonb_build_object('title',a.title,'teamNumber',tt.number,'teamName',tt.name,'teamSchool',tt.school) order by a.title),'[]') from event_awards a join teams tt on tt.id=a.team_id where a.event_id=p_event),
 'cards',(select coalesce(jsonb_agg(jsonb_build_object('areaId',c.area_id,'scores',(select coalesce(jsonb_object_agg(ss.criterion_id,ss.score),'{}') from scorecard_scores ss where ss.scorecard_id=c.id),
 'feedback',jsonb_build_object('overall',f.overall,'strengths',f.strengths,'improvements',f.improvements)) order by c.area_id,c.id),'[]') from scorecards c left join scorecard_feedback f on f.scorecard_id=c.id where c.event_id=p_event and c.team_id=p_team and c.status='submitted'),
 'penalties',(select coalesce(jsonb_agg(jsonb_build_object('points',p.points,'reason',p.reason)),'[]') from penalties p where p.event_id=p_event and p.team_id=p_team),
 'benchmarks',(select coalesce(jsonb_object_agg(key,jsonb_build_object('low',lo,'median',med,'high',hi)),'{}') from (
  select key,min(value::numeric) lo,percentile_cont(0.5) within group(order by value::numeric) med,max(value::numeric) hi from (
   select e.key,e.value from jsonb_array_elements(s.rows) r cross join lateral jsonb_each(r->'areas') e where jsonb_typeof(e.value)='number'
   union all select '__total',r->'total' from jsonb_array_elements(s.rows) r where jsonb_typeof(r->'total')='number'
  ) values_by_area group by key) aggregates),
 'races',(select coalesce(jsonb_agg(jsonb_build_object('number',h.heat_number,'label',h.label,'phase',h.phase,'lane',v.lane,'car',v.car,'status',v.status,'totalMs',v.total_ms,'reactionMs',v.reaction_ms) order by h.heat_number,v.lane),'[]') from race_heats h cross join lateral (values (1,h.lane1_team,h.lane1_car,h.lane1_status,h.lane1_total_ms,h.lane1_reaction_ms),(2,h.lane2_team,h.lane2_car,h.lane2_status,h.lane2_total_ms,h.lane2_reaction_ms)) v(lane,team_id,car,status,total_ms,reaction_ms) where h.event_id=p_event and v.team_id=p_team and v.status<>'pending'),
 'inspections',(select coalesce(jsonb_agg(jsonb_build_object('car',i.car,'rulesetId',i.ruleset_id,'selectedArticles',i.selected_articles,'measurements',i.measurements) order by i.car),'[]') from technical_inspections i where i.event_id=p_event and i.team_id=p_team and i.status='submitted'));
end $$;

create or replace function can_read_contact_audit(p_id bigint) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a audit_log;
begin
 select * into a from audit_log where id=p_id;
 if a.id is null or not (is_chair_or_organiser(a.event_id) or (a.event_id is null and platform_manager()) or (platform_spectator() and (a.event_id is null or event_active(a.event_id)))) then return false; end if;
 return exists(select 1 from platform_owner where user_id=auth.uid()) or not exists(
  select 1 from platform_organisers p where (p.hide_email and position(lower(p.email) in lower(coalesce(a.detail::text,'')))>0) or (p.hide_identity and (a.actor=p.user_id or a.entity_id=p.user_id::text or position(p.user_id::text in coalesce(a.detail::text,''))>0 or position(lower(p.display_name) in lower(coalesce(a.detail::text,'')))>0)));
end $$;

create or replace function can_read_contact_broadcast(p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare b broadcast_emails;
begin
 select * into b from broadcast_emails where id=p_id;
 -- INSERT RETURNING evaluates visibility before this stable lookup sees the new tuple.
 -- The existing insert policy still requires event staff; callers already supplied that content.
 if b.id is null then return true; end if;
 if not (is_chair_or_organiser(b.event_id) or (platform_spectator() and event_active(b.event_id))) then return false; end if;
 return exists(select 1 from platform_owner where user_id=auth.uid()) or not exists(
  select 1 from platform_organisers p where (p.hide_email and position(lower(p.email) in lower(to_jsonb(b)::text))>0) or (p.hide_identity and (b.sender_id=p.user_id or position(lower(p.display_name) in lower(to_jsonb(b)::text))>0)));
end $$;

create or replace function reads_team_file(p_event uuid,p_team uuid,p_kind text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
 select event_active(p_event) and (is_chair_or_organiser(p_event) or platform_spectator() or manages_team(p_event,p_team) or
 (not is_conflicted(p_event,p_team) and not exists(select 1 from judge_exemptions where event_id=p_event and team_id=p_team and judge_id=auth.uid()) and case when p_kind='logo' then is_member(p_event) and sees_all_teams(p_event)
 else judge_can_score(p_event,case p_kind when 'design_portfolio' then 'design_engineering'::judging_panel when 'enterprise_portfolio' then 'enterprise'::judging_panel else 'project_management'::judging_panel end,p_team)
 or leads_panel(p_event,case p_kind when 'design_portfolio' then 'design_engineering'::judging_panel when 'enterprise_portfolio' then 'enterprise'::judging_panel else 'project_management'::judging_panel end) end))
$$;

create or replace function platform_access() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare result jsonb; owner_id uuid;
begin
 result:=platform_access_contacts(); select user_id into owner_id from platform_owner;
 if platform_spectator() then result:=result||jsonb_build_object('organisers',(select coalesce(jsonb_agg(x),'[]') from (
  select o.user_id as "userId",o.email,'admin'::text as scope,true as permanent,''::text as name,false as "emailHidden" from platform_owner o
  union all select p.user_id,case when p.hide_email then null else p.email end,p.scope,false,p.display_name,p.hide_email from platform_organisers p where not p.hide_identity) x)); end if;
 return result||jsonb_build_object('viewerId',auth.uid(),'ownerId',owner_id,'organisers',
 (select coalesce(jsonb_agg(person||jsonb_build_object('contactRestricted',coalesce(p.hide_email,false),'identityRestricted',coalesce(p.hide_identity,false))),'[]'::jsonb)
 from jsonb_array_elements(result->'organisers') person left join platform_organisers p on p.user_id::text=person->>'userId' where not coalesce(p.hide_identity,false) or auth.uid()=owner_id),
 'invitations',(select coalesce(jsonb_agg(inv||jsonb_build_object('name',i.display_name,'identityRestricted',i.hide_identity)),'[]'::jsonb)
 from jsonb_array_elements(result->'invitations') inv join organiser_invitations i on i.id::text=inv->>'id'
 where (auth.uid()=owner_id or (not i.hide_identity and i.scope<>'spectator')) and (auth.uid()=owner_id or not exists(select 1 from platform_organisers p where p.hide_identity and p.email=inv->>'email'))));
end $$;

create policy spectator_conflicts_read on judge_conflicts for select to authenticated using(platform_spectator() and event_active(event_id) and organiser_identity_visible(judge_id,null));
create policy spectator_exemptions_read on judge_exemptions for select to authenticated using(platform_spectator() and event_active(event_id) and organiser_identity_visible(judge_id,null));
-- Read-only is enforced on writes too, including SECURITY DEFINER RPCs and old event assignments.
create function spectator_write_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if platform_spectator() then raise exception 'Platform Spectators have read-only access' using errcode='42501'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke execute on function spectator_write_guard() from public,anon,authenticated;
do $guards$
declare t record;
begin
 for t in select tablename from pg_tables where schemaname=current_schema() and tablename not in ('audit_log','organiser_invitations','schema_migrations') loop
  execute format('create trigger spectator_read_only before insert or update or delete on %I for each row execute function spectator_write_guard()',t.tablename);
 end loop;
end $guards$;

create policy spectator_inspections_read on technical_inspections for select to authenticated using(platform_spectator() and event_active(event_id));
