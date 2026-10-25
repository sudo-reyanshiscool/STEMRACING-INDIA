create table event_inspection_scope (
 event_id uuid primary key references events(id) on delete cascade,
 revision integer not null,
 articles text[]
);
alter table event_inspection_scope enable row level security;
revoke all on event_inspection_scope from public,anon,authenticated;
alter table technical_inspections add column selected_articles text[];

create function inspection_scope(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
 if not is_member(p_event) then raise exception 'event member required' using errcode='42501'; end if;
 return jsonb_build_object('revision',coalesce((select revision from event_inspection_scope where event_id=p_event),0),
 'articles',(select to_jsonb(articles) from event_inspection_scope where event_id=p_event),
 'locked',exists(select 1 from technical_inspections where event_id=p_event));
end $$;
create function save_inspection_scope(p_event uuid,p_revision integer,p_articles text[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 perform 1 from events where id=p_event for update;
 if not is_chair_or_organiser(p_event) then raise exception 'event staff required' using errcode='42501'; end if;
 if event_released(p_event) or exists(select 1 from technical_inspections where event_id=p_event) then raise exception 'scope locked once inspections begin' using errcode='55000'; end if;
 if p_revision is distinct from coalesce((select revision from event_inspection_scope where event_id=p_event),0) then raise exception 'scope changed' using errcode='40001'; end if;
 if p_articles is not null and (cardinality(p_articles)=0 or cardinality(p_articles)<>(select count(distinct a) from unnest(p_articles) a) or not p_articles <@ ARRAY['T3.1.3','T3.1.4','T3.3','T3.9.2','T4.1','T4.6','T4.7','T4.8','T3.2','T2.7','T3.4','T3.5','T3.6','T3.7','T5.1','T5.2','T5.3','T5.4','T5.5','T5.6','T6.1','T6.2','T6.3','T7.1','T7.2','T7.3','T7.4','T7.5','T7.6','T7.7','T7.8','T7.9.1','T7.9.2','T7.9.3','T7.9.4','T7.10','T7.11','T7.12','T7.13','T8.2','T8.3','T8.4','T8.5.1','T8.5.2','T8.5.3','T8.6.1','T8.6.2','T8.6.3','T8.7','T8.8','T9.2','T9.3','T9.4.1','T9.4.2','T9.4.3','T9.5.1','T9.5.2','T9.5.3','T9.5.4','T9.6','T9.7','T4.2','T4.4.1','T4.4.2','T4.4.3','T4.4.4','T4.4.5','T4.4.6','T4.5','T4.3','T7.12.2','T8.1','T9.1']::text[]) then raise exception 'select valid regulations' using errcode='22023'; end if;
 insert into event_inspection_scope(event_id,revision,articles) values(p_event,p_revision+1,p_articles)
 on conflict(event_id) do update set revision=excluded.revision,articles=excluded.articles;
 return inspection_scope(p_event);
end $$;
-- Server pins the event scope; clients cannot expand or narrow an individual inspection.
create function pin_inspection_scope() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 perform 1 from events where id=new.event_id for update;
 if tg_op='INSERT' then
  select articles into new.selected_articles from event_inspection_scope where event_id=new.event_id;
 elsif new.selected_articles is distinct from old.selected_articles then
  raise exception 'inspection scope is pinned' using errcode='42501';
 end if;
 return new;
end $$;
create trigger inspections_pin_scope before insert or update on technical_inspections for each row execute function pin_inspection_scope();
revoke execute on function inspection_scope(uuid),save_inspection_scope(uuid,integer,text[]),pin_inspection_scope() from public,anon,authenticated;
grant execute on function inspection_scope(uuid),save_inspection_scope(uuid,integer,text[]) to authenticated;

-- Public school/club identities for the podium, standings and confirmed award winners.
create or replace function team_results_packet(p_event uuid,p_team uuid) returns jsonb
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

