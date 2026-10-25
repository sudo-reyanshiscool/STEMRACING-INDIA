-- Team-reported procedural feedback is independent of judges' scorecard feedback.
create table team_concerns (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references events(id),
 team_id uuid not null references teams(id),
 submitted_by uuid not null references auth.users(id),
 panel judging_panel not null,
 message text not null check (length(btrim(message)) between 1 and 4000),
 status text not null default 'open' check (status in ('open','resolved')),
 response text not null default '' check (length(response)<=4000),
 created_at timestamptz not null default now(),
 resolved_by uuid references auth.users(id),
 resolved_at timestamptz,
 check ((status='open' and response='' and resolved_at is null and resolved_by is null)
   or (status='resolved' and length(btrim(response))>0 and resolved_at is not null and resolved_by is not null))
);
create index team_concerns_event on team_concerns(event_id,created_at);
alter table team_concerns enable row level security;
revoke all on team_concerns from public,anon,authenticated;

create function list_team_concerns(p_event uuid)
returns table (id uuid, "eventId" uuid, "teamId" uuid, panel judging_panel, message text, status text, response text, "createdAt" timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
 if not exists(select 1 from events where events.id=p_event and deleted_at is null)
 or not (is_chair_or_organiser(p_event) or has_role(p_event,'team_manager')) then
  raise exception 'feedback unavailable' using errcode='42501';
 end if;
 return query select c.id,c.event_id,c.team_id,c.panel,c.message,c.status,c.response,c.created_at
 from team_concerns c where c.event_id=p_event and (is_chair_or_organiser(p_event) or exists(
 select 1 from event_roles r where r.event_id=p_event and r.user_id=auth.uid() and r.role='team_manager' and r.team_id=c.team_id));
end $$;

create function submit_team_concern(p_event uuid,p_team uuid,p_panel judging_panel,p_message text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if not exists(select 1 from events where id=p_event and deleted_at is null)
 or not exists(select 1 from event_roles where event_id=p_event and user_id=auth.uid() and role='team_manager' and team_id=p_team) then
  raise exception 'only your team may submit feedback' using errcode='42501';
 end if;
 if not exists(select 1 from teams where id=p_team and event_id=p_event) or p_message is null or length(btrim(p_message)) not between 1 and 4000 or p_panel is null then
  raise exception 'invalid feedback' using errcode='22023';
 end if;
 insert into team_concerns(event_id,team_id,submitted_by,panel,message) values(p_event,p_team,auth.uid(),p_panel,btrim(p_message));
end $$;

create function resolve_team_concern(p_event uuid,p_id uuid,p_response text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
 if not is_chair_or_organiser(p_event) then raise exception 'only organisers and Chair may resolve feedback' using errcode='42501'; end if;
 if p_response is null or length(btrim(p_response)) not between 1 and 4000 then raise exception 'response required' using errcode='22023'; end if;
 update team_concerns set status='resolved',response=btrim(p_response),resolved_by=auth.uid(),resolved_at=now()
 where id=p_id and event_id=p_event and status='open';
 if not found then raise exception 'feedback unavailable or already resolved' using errcode='55000'; end if;
end $$;
revoke execute on function list_team_concerns(uuid),submit_team_concern(uuid,uuid,judging_panel,text),resolve_team_concern(uuid,uuid,text) from public,anon,authenticated;
grant execute on function list_team_concerns(uuid),submit_team_concern(uuid,uuid,judging_panel,text),resolve_team_concern(uuid,uuid,text) to authenticated;
