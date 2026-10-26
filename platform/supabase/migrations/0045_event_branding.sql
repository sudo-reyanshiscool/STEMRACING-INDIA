-- Competition identity belongs to the event, not the selected scoring ruleset.
alter table events add column competition_level text check(competition_level in ('regional','national'));
grant select(competition_level) on events to anon,authenticated;
create table event_logo_sets (
 event_id uuid primary key references events(id) on delete cascade,
 logos jsonb not null check(jsonb_typeof(logos)='object' and octet_length(logos::text)<=5700000)
);
alter table event_logo_sets enable row level security;
revoke all on event_logo_sets from public,anon,authenticated;
create trigger spectator_read_only before insert or update or delete on event_logo_sets for each row execute function spectator_write_guard();
create function checked_event_logos(p_logos jsonb) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare result jsonb:='{}';k text;l jsonb;b bytea;d integer[];n text;
begin
 if p_logos is null or jsonb_typeof(p_logos)<>'object' then raise exception 'both nationals logos are required' using errcode='22023';end if;
 foreach k in array array['light','dark'] loop
  l:=p_logos->k;n:=btrim(l->>'name');
  if n is null or length(n) not between 1 and 180 or n ~ '[[:cntrl:]/\\]' or n !~* '\.png$' or l->>'mime' is distinct from 'image/png' then raise exception 'use a PNG logo for light and dark backgrounds' using errcode='22023';end if;
  b:=media_bytes(l->>'base64',2097152);d:=media_dimensions(b,'image/png');
  result:=result||jsonb_build_object(k,jsonb_build_object('name',n,'mime','image/png','base64',replace(encode(b,'base64'),E'\n',''),'width',d[1],'height',d[2]));
 end loop;
 return result;
end $$;
create function create_branded_event(p_name text,p_starts_on date,p_ruleset jsonb,p_level text,p_logos jsonb default null) returns events
language plpgsql security definer set search_path = public, pg_temp as $$
declare e events;logos jsonb;
begin
 if not can_create_event() then raise exception 'only organisers can create events' using errcode='42501';end if;
 if p_level is null or p_level not in ('regional','national') then raise exception 'choose the competition level' using errcode='22023';end if;
 if p_level='national' then logos:=checked_event_logos(p_logos);
 elsif p_logos is not null then raise exception 'regional events use the supplied regional logo' using errcode='22023';end if;
 e:=create_event(p_name,p_starts_on,p_ruleset);
 update events set competition_level=p_level where id=e.id returning * into e;
 if logos is not null then insert into event_logo_sets(event_id,logos) values(e.id,logos);end if;
 return e;
end $$;
create function event_branding(p_event uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
 if not event_active(p_event) or not (is_member(p_event) or event_released(p_event)) then raise exception 'event branding unavailable' using errcode='42501';end if;
 return (select jsonb_build_object('level',e.competition_level,'logos',l.logos) from events e left join event_logo_sets l on l.event_id=e.id where e.id=p_event);
end $$;
create function event_level_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
 if current_user in ('authenticated','anon') and ((tg_op='INSERT' and new.competition_level is not null) or (tg_op='UPDATE' and new.competition_level is distinct from old.competition_level)) then raise exception 'set competition level through event creation' using errcode='42501';end if;
 return new;
end $$;
create trigger event_level_guard before insert or update of competition_level on events for each row execute function event_level_guard();
revoke execute on function checked_event_logos(jsonb),event_level_guard(),create_branded_event(text,date,jsonb,text,jsonb),event_branding(uuid) from public,anon,authenticated;
grant execute on function create_branded_event(text,date,jsonb,text,jsonb) to authenticated;
grant execute on function event_branding(uuid) to anon,authenticated;

-- Preserve packet authorisation and scoring; attach this event’s logo set for PDF generation.
create or replace function team_results_packet(p_event uuid,p_team uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s ranking_snapshots; t teams; winner jsonb;
begin
 if not (is_chair_or_organiser(p_event) or (platform_spectator() and event_active(p_event))) then raise exception 'only event staff can preview results PDFs' using errcode='42501'; end if;
 select * into t from teams where id=p_team and event_id=p_event;
 if not found then raise exception 'team not found' using errcode='22023'; end if;
 select * into s from ranking_snapshots where event_id=p_event and released order by created_at desc,id desc limit 1;
 if not found or not exists(select 1 from jsonb_array_elements(s.rows) r where r->>'teamId'=p_team::text) then raise exception 'publish a ranking containing this team before generating results PDFs' using errcode='55000'; end if;
 return jsonb_build_object('branding',event_branding(p_event),'released',event_released(p_event),'awardsConfirmed',coalesce((select awards_confirmed from result_mail_settings where event_id=p_event),false),'eventName',(select name from events where id=p_event),'eventId',p_event,'snapshotId',s.id,'createdAt',s.created_at,'ruleset',(select ruleset from events where id=p_event),
 'team',jsonb_build_object('id',t.id,'number',t.number,'name',t.name,'school',t.school),
 'standings',(select coalesce(jsonb_agg(jsonb_build_object('rank',r->'rank','teamId',r->'teamId','number',r->'number','name',r->'name','school',(select tt.school from teams tt where tt.id=(r->>'teamId')::uuid and tt.event_id=p_event),'total',r->'total') order by ord),'[]') from jsonb_array_elements(s.rows) with ordinality x(r,ord)),
 'teamResult',(select r from jsonb_array_elements(s.rows) r where r->>'teamId'=p_team::text),
 'awards',(select coalesce(jsonb_agg(jsonb_build_object('title',a.title,'teamNumber',tt.number,'teamName',tt.name,'teamSchool',tt.school) order by a.title),'[]') from event_awards a join teams tt on tt.id=a.team_id where a.event_id=p_event),
 'cards',(select coalesce(jsonb_agg(jsonb_build_object('areaId',c.area_id,'scores',(select coalesce(jsonb_object_agg(ss.criterion_id,ss.score),'{}') from scorecard_scores ss where ss.scorecard_id=c.id),
 'feedback',jsonb_build_object('overall',f.overall,'strengths',f.strengths,'improvements',f.improvements)) order by c.area_id,c.id),'[]') from scorecards c left join scorecard_feedback f on f.scorecard_id=c.id where c.event_id=p_event and c.team_id=p_team and c.status='submitted'),
 'penalties',(select coalesce(jsonb_agg(jsonb_build_object('points',p.points,'reason',p.reason)),'[]') from all_event_penalties(p_event) p where p.team_id=p_team),
 'benchmarks',(select coalesce(jsonb_object_agg(key,jsonb_build_object('low',lo,'median',med,'high',hi)),'{}') from (
  select key,min(value::numeric) lo,percentile_cont(0.5) within group(order by value::numeric) med,max(value::numeric) hi from (
   select e.key,e.value from jsonb_array_elements(s.rows) r cross join lateral jsonb_each(r->'areas') e where jsonb_typeof(e.value)='number'
   union all select '__total',r->'total' from jsonb_array_elements(s.rows) r where jsonb_typeof(r->'total')='number'
  ) values_by_area group by key) aggregates),
 'races',(select coalesce(jsonb_agg(jsonb_build_object('number',h.heat_number,'label',h.label,'phase',h.phase,'lane',v.lane,'car',v.car,'status',v.status,'totalMs',v.total_ms,'reactionMs',v.reaction_ms) order by h.heat_number,v.lane),'[]') from race_heats h cross join lateral (values (1,h.lane1_team,h.lane1_car,h.lane1_status,h.lane1_total_ms,h.lane1_reaction_ms),(2,h.lane2_team,h.lane2_car,h.lane2_status,h.lane2_total_ms,h.lane2_reaction_ms)) v(lane,team_id,car,status,total_ms,reaction_ms) where h.event_id=p_event and v.team_id=p_team and v.status<>'pending'),
 'inspections',(select coalesce(jsonb_agg(jsonb_build_object('car',i.car,'rulesetId',i.ruleset_id,'selectedArticles',i.selected_articles,'measurements',i.measurements) order by i.car),'[]') from technical_inspections i where i.event_id=p_event and i.team_id=p_team and i.status='submitted'));
end $$;
