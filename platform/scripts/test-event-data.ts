import {createHash} from 'node:crypto';
import {rank,canonicalJson} from '../src/engine';
import {INDIA_2026} from '../src/rulesets';
import {INDIA_TECHNICAL,SPAN_LINES,type Measurements,type Rule,summarise,specificationsScore} from '../src/technical';

const uid=(seed:string)=>{
 const h=createHash('sha256').update(seed).digest('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
};
const midpoint=(min?:number,max?:number)=> Math.round((min!==undefined && max!==undefined?(min+max)/2:min!==undefined?min+2:Math.max(0,(max??0)/2))*100)/100;
const passing=(rule:Rule):Measurements[string]=>{
 switch(rule.kind){
 case 'range':return midpoint(rule.min,rule.max);
 case 'check':return true;
 case 'perItemRange':return Object.fromEntries(rule.items.map(i=>[i.id,midpoint(i.min,i.max)]));
 case 'perItemCheck':return Object.fromEntries(rule.items.map(i=>[i.id,true]));
 case 'span':return Object.fromEntries(SPAN_LINES.map(line=>[line,rule.min+3]));
 }
};

/** Synthetic examples only; no real addresses, messages, passwords, or track data. */
export function buildTestEventData(eventId:string) {
 const id=(part:string)=>uid(`stem-test-data-v1:${eventId}:${part}`);
 const panels=['scrutineering','design_engineering','project_management','enterprise','verbal'] as const;
 const judges=panels.map((panel,i)=>({id:id(`judge:${panel}`),email:`demo-${eventId.slice(0,8)}-${panel}@example.invalid`,name:`Demo Judge ${['Avery Rao','Maya Sen','Kabir Shah','Noor Mehta','Rohan Das'][i]}`,panel}));
 const adjectives=['Apex','Crimson','Solar','Velocity','Quantum','Thunder','Neon','Titan','Falcon','Aurora'];
 const nouns=['Falcons','Vortex','Dynamics','Motorsport','Racing'];
 const teams=Array.from({length:50},(_,i)=>({id:id(`team:${i+1}`),number:`D${String(i+1).padStart(3,'0')}`,name:`Demo ${adjectives[i%10]} ${nouns[Math.floor(i/10)]}`,school:`Demo Academy ${String(i%10+1).padStart(2,'0')}`}));
 const cards=teams.flatMap((team,i)=>INDIA_2026.areas.filter(a=>a.kind==='scorecard').map((area,k)=>({
  id:id(`card:${team.id}:${area.id}`),teamId:team.id,areaId:area.id,panel:area.panel!,judgeId:judges.find(j=>j.panel===area.panel)!.id,
  submitted:!(i>=45 && (i+k)%3===0),
  scores:Object.fromEntries(area.criteria.map((c,n)=>[c.id,Math.max(0,Math.min(c.max,Math.round(c.max*(0.40+((i*17+k*11+n*7)%56)/100))))])),
  overall:`DEMO feedback: ${team.name} demonstrated ${['clear preparation','strong teamwork','thoughtful testing','effective communication','a promising design process'][i%5]}.`,
  strengths:['Clear roles and well organised evidence.','Strong technical reasoning and iteration.','Consistent visual identity and confident answers.'][i%3],
  improvements:['Quantify the impact of each design change.','Connect the project evidence to measurable outcomes.','Practise concise answers and balanced team participation.'][i%3],
  nominations:i%9===0?['innovative-thinking']:i%11===0?['sustainability']:[],
 })));
 const inspections=teams.flatMap((team,i)=>(['A','B'] as const).map(car=>{
  const measurements:Measurements=Object.fromEntries(INDIA_TECHNICAL.rules.map(r=>[r.article,passing(r)]));
  // Include dimensional breaches and incomplete inspections for practice.
  if(i%8===0 && car==='B')measurements['T3.4']=86;
  if(i%13===0 && car==='A')measurements['T3.6']=49.5;
  const submitted=i<47;
  if(!submitted)delete measurements['T3.7'];
  return {id:id(`inspection:${team.id}:${car}`),teamId:team.id,car,inspectorId:judges[0].id,rulesetId:INDIA_TECHNICAL.id,measurements,submitted};
 }));
 const penalties=teams.filter((_,i)=>i%4===0).map((team,i)=>({id:id(`penalty:${team.id}`),teamId:team.id,points:[5,10,15][i%3],reason:`DEMO: ${['sample procedural penalty','sample unsuccessful appeal','sample late submission'][i%3]}`}));
 const overrides=teams.filter((_,i)=>i%10===3).map((team,i)=>({teamId:team.id,areaId:'pit-display',value:36+i*4,reason:'DEMO: sample moderation adjustment after panel review.'}));
 const races=Array.from({length:75},(_,i)=>{
  const round=Math.floor(i/25),pair=i%25;
  const lane=(offset:number)=>{
   const team=teams[(pair*2+offset+round*3)%50];
   const status=i>=70?'pending':(i+offset)%23===0?'false_start':(i+offset)%19===0?'dnf':(i+offset)%31===0?'dns':'finished';
   return {teamId:team.id,car:round%2?'B':'A',status,totalMs:status==='finished'?1150+(i*37+offset*71)%650:null,reactionMs:status==='finished'?110+(i*13+offset*29)%210:null};
  };
  return {id:id(`race:${i+1}`),label:`Demo ${round===2?'knockout':'reaction'} heat ${i+1}`,phase:round===2?'knockout':'reaction',lane1:lane(0),lane2:lane(1),note:'DEMO: synthetic timing results; no track connection used.',source:'manual',sourceRunId:null};
 });
 const derived:Record<string,Record<string,number>>={};
 for(const team of teams){
  const [a,b]=inspections.filter(i=>i.teamId===team.id);
  if(a.submitted&&b.submitted)derived[team.id]={specifications:specificationsScore(summarise(INDIA_TECHNICAL.rules,a.measurements),summarise(INDIA_TECHNICAL.rules,b.measurements))};
 }
 const textOrder=(a:string,b:string)=>a<b?-1:a>b?1:0;
 const inputs={teams:teams.map(({id,number,name})=>({id,number,name})),cards:cards.filter(c=>c.submitted).map(({teamId,areaId,judgeId,scores})=>({teamId,areaId,judgeId,scores})).sort((a,b)=>textOrder(a.teamId,b.teamId)||textOrder(a.areaId,b.areaId)||textOrder(a.judgeId,b.judgeId)),
  penalties:penalties.map(({teamId,points})=>({teamId,points})).sort((a,b)=>textOrder(a.teamId,b.teamId)||a.points-b.points),overrides:overrides.map(({teamId,areaId,value})=>({teamId,areaId,value})).sort((a,b)=>textOrder(a.teamId,b.teamId)||textOrder(a.areaId,b.areaId)),derived};
 const ranking=rank({ruleset:INDIA_2026,...inputs});
 const inputHash=createHash('sha256').update(canonicalJson({rulesetId:INDIA_2026.id,inputs,rows:ranking.rows})).digest('hex');
 const snapshot={id:id('snapshot'),inputs,rows:ranking.rows,inputHash};
 return {version:1,eventId,rulesetId:INDIA_2026.id,judges,teams,cards,inspections,penalties,overrides,races,snapshot};
}

/** Explicitly target one empty test event, preserve all other data, and roll back on any failure. */
export function renderTestEventSql(eventId:string,expectedName:string,schema='stem_racing'):string {
 if(!/^[0-9a-f-]{36}$/i.test(eventId) || !/^(stem_racing|public)$/.test(schema))throw Error('Choose an explicit event UUID and application schema');
 if(!/^test event$/i.test(expectedName))throw Error('Sample data can only target the named Test Event');
 const payload=JSON.stringify(buildTestEventData(eventId));
 return `begin;
set local search_path=${schema},pg_temp;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select user_id::text from platform_owner))::text,true);
do $seed$
declare data jsonb:=$fixture$${payload}$fixture$::jsonb; e events; j jsonb; t jsonb; c jsonb; item jsonb; score record; team_count int;
begin
 select * into e from events where id=(data->>'eventId')::uuid for update;
 if not found or e.name<>${"'"+expectedName.replaceAll("'","''")+"'"} or e.deleted_at is not null or e.results_released or e.ruleset->>'id'<>data->>'rulesetId' then
  raise exception 'the active, unreleased Test Event with the expected ruleset is required';
 end if;
 if exists(select 1 from teams where event_id=e.id) then raise exception 'Test Event already contains teams; sample import cancelled without changing records'; end if;
 for j in select value from jsonb_array_elements(data->'judges') loop
  insert into auth.users(id,email,email_confirmed_at) values((j->>'id')::uuid,j->>'email',now());
  insert into event_roles(event_id,user_id,email,display_name,role,panel) values(e.id,(j->>'id')::uuid,j->>'email',j->>'name','judge',(j->>'panel')::judging_panel);
 end loop;
 for t in select value from jsonb_array_elements(data->'teams') loop
  insert into teams(id,event_id,number,name,school) values((t->>'id')::uuid,e.id,t->>'number',t->>'name',t->>'school');
 end loop;
 for c in select value from jsonb_array_elements(data->'cards') loop
  insert into scorecards(id,event_id,team_id,area_id,panel,judge_id) values((c->>'id')::uuid,e.id,(c->>'teamId')::uuid,c->>'areaId',(c->>'panel')::judging_panel,(c->>'judgeId')::uuid);
  for score in select key,value from jsonb_each_text(c->'scores') loop
   insert into scorecard_scores(scorecard_id,criterion_id,score,comment) values((c->>'id')::uuid,score.key,score.value::int,'DEMO: sample criterion observation.');
  end loop;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',c->>'judgeId')::text,true);
  perform save_card_review((c->>'id')::uuid,jsonb_build_object('overall',c->>'overall','strengths',c->>'strengths','improvements',c->>'improvements','internalNotes','DEMO: private judging note for practice.','criterionNotes','{}'::jsonb,'nominations',c->'nominations'));
  if (c->>'submitted')::boolean then update scorecards set status='submitted' where id=(c->>'id')::uuid; end if;
 end loop;
 for item in select value from jsonb_array_elements(data->'inspections') loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',item->>'inspectorId')::text,true);
  insert into technical_inspections(id,event_id,team_id,car,inspector_id,ruleset_id,measurements,notes) values((item->>'id')::uuid,e.id,(item->>'teamId')::uuid,item->>'car',(item->>'inspectorId')::uuid,item->>'rulesetId',item->'measurements','{"demo":"Synthetic measurements for practice."}'::jsonb);
  if (item->>'submitted')::boolean then perform submit_inspection((item->>'id')::uuid); end if;
 end loop;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select user_id::text from platform_owner))::text,true);
 for item in select value from jsonb_array_elements(data->'penalties') loop
  insert into penalties(id,event_id,team_id,points,reason) values((item->>'id')::uuid,e.id,(item->>'teamId')::uuid,(item->>'points')::numeric,item->>'reason');
 end loop;
 for item in select value from jsonb_array_elements(data->'overrides') loop
  insert into score_overrides(event_id,team_id,area_id,value,reason) values(e.id,(item->>'teamId')::uuid,item->>'areaId',(item->>'value')::numeric,item->>'reason');
 end loop;
 for item in select value from jsonb_array_elements(data->'races') loop
  perform save_race(e.id,(item->>'id')::uuid,0,item);
 end loop;
 insert into ranking_snapshots(id,event_id,ruleset_id,input_hash,inputs,rows,released) values((data#>>'{snapshot,id}')::uuid,e.id,data->>'rulesetId',data#>>'{snapshot,inputHash}',data#>'{snapshot,inputs}',data#>'{snapshot,rows}',true);
 perform audit_write(e.id,'demo_seed','events',e.id::text,jsonb_build_object('teams',50,'synthetic',true));
 select count(*) into team_count from teams where event_id=e.id;
 if team_count<>50 then raise exception 'expected exactly 50 sample teams'; end if;
end $seed$;
commit;
select 'sample data loaded' as outcome;
`;
}
