import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {INDIA_TECHNICAL} from '../../src/technical';
import {randomUUID} from 'node:crypto';
import {as,makeDb,seedWorld,type World} from './harness';
let w:World;
beforeAll(async()=>{w=await seedWorld(await makeDb());});
afterAll(async()=>w.db.close());
const pdf={kind:'design_portfolio',name:'design.pdf',mime:'application/pdf',base64:btoa('%PDF-1.7\nSynthetic test portfolio\n%%EOF')};
const files=(who:'mgr1'|'mgr2'|'chair'|'judgeD'|'judgeV')=>as(w.db,who,q=>q('select * from list_team_files($1)',[w.eventId]));
const upload=(who:'mgr1'|'mgr2'|'chair',revision=0,input=pdf)=>as(w.db,who,q=>q('select upload_team_file($1,$2,$3,$4)',[w.eventId,w.team1,revision,JSON.stringify(input)]));
describe('2027 team registration files',()=>{
 it('uploads privately, enforces assignment scope, supports replacement and refuses malformed files',async()=>{
  await upload('mgr1');expect((await files('mgr1')).rows).toHaveLength(1);
  expect((await files('mgr2')).rows).toHaveLength(0);expect((await files('judgeV')).rows).toHaveLength(0);
  expect((await files('judgeD')).rows).toHaveLength(1);
  const id=(await files('chair')).rows[0].id;
  const read=(who:'mgr1'|'mgr2')=>as(w.db,who,q=>q('select download_team_file($1,$2) as f',[w.eventId,id]));
  expect((await read('mgr1')).rows[0].f.base64).toBe(pdf.base64);
  await expect(read('mgr2')).rejects.toThrow();await expect(upload('mgr2')).rejects.toThrow();
  await expect(upload('mgr1',0)).rejects.toMatchObject({code:'40001'});
  await upload('mgr1',1,{...pdf,name:'updated.pdf'});expect((await files('mgr1')).rows[0].revision).toBe(2);
  await expect(upload('mgr1',2,{...pdf,base64:btoa('not a PDF')})).rejects.toThrow();
  await expect(upload('mgr1',2,{...pdf,name:'../../escape.pdf'})).rejects.toThrow();
  await as(w.db,'judgeD',q=>q('insert into judge_conflicts(event_id,judge_id,team_id) values($1,auth.uid(),$2)',[w.eventId,w.team1]));
  expect((await files('judgeD')).rows).toHaveLength(0);
  await expect(as(w.db,'chair',q=>q('select content from team_files'))).rejects.toThrow();
 });
 it('accepts static SVG and refuses active artwork and oversized payloads',async()=>{
  const svg={kind:'logo',name:'logo.svg',mime:'image/svg+xml',base64:btoa('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>')};
  await upload('mgr1',0,svg);
  await expect(upload('mgr1',1,{...svg,base64:btoa('<svg><script>alert(1)</script></svg>')})).rejects.toThrow();
  await expect(upload('mgr1',1,{...svg,base64:btoa('<svg><use href="https://example.com/x"/></svg>')})).rejects.toThrow();
  await expect(upload('mgr1',1,{...svg,base64:'A'.repeat(2800000)})).rejects.toThrow();
 });
});
describe('selected scrutineering scope',()=>{
 it('pins scope on the server and refuses late or per-car scope changes',async()=>{
  await as(w.db,'chair',q=>q("select save_inspection_scope($1,0,ARRAY['T3.6'])",[w.eventId]));
  await expect(as(w.db,'mgr1',q=>q("select save_inspection_scope($1,1,ARRAY['T3.6'])",[w.eventId]))).rejects.toThrow();
  const result=await as(w.db,'chair',q=>q("insert into technical_inspections(event_id,team_id,car,ruleset_id,selected_articles) values($1,$2,'A','india-nationals-2026-technical',ARRAY['forged']) returning id,selected_articles",[w.eventId,w.team1]));
  expect(result.rows[0].selected_articles).toEqual(['T3.6']);
  await expect(as(w.db,'chair',q=>q("update technical_inspections set selected_articles=null where id=$1",[result.rows[0].id]))).rejects.toThrow();
  await expect(as(w.db,'chair',q=>q('select save_inspection_scope($1,1,null)',[w.eventId]))).rejects.toThrow();
  await as(w.db,'chair',q=>q('select submit_inspection($1)',[result.rows[0].id]));
 });
});
describe('race followups',()=>{
 it('supports different same-team cars and preserves a source heat on lane swap and eligible rerun',async()=>{
  const lane=(car:string,status='pending')=>({teamId:w.team1,car,status,totalMs:null,reactionMs:null});
  const input={label:'Same-team heat',phase:'reaction',lane1:lane('A','dns'),lane2:lane('B','false_start'),note:'',source:'manual',sourceRunId:null};
  const id=randomUUID();await as(w.db,'chair',q=>q('select save_race($1,$2,0,$3)',[w.eventId,id,JSON.stringify(input)]));
  const follow=(mode:string,revision=1)=>as(w.db,'chair',q=>q('select * from queue_race_followup($1,$2,$3,$4)',[w.eventId,id,revision,mode]));
  const swap=(await follow('swap')).rows[0];expect([swap.lane1_car,swap.lane2_car]).toEqual(['B','A']);expect(swap.parent_heat).toBe(id);
  const rerun=(await follow('rerun')).rows[0];expect(rerun.lane1_status).toBe('pending');expect(rerun.parent_heat).toBe(id);
  await expect(follow('rerun')).rejects.toThrow();await expect(follow('swap',99)).rejects.toMatchObject({code:'40001'});
  const source=(await w.db.query<{lane1_status:string;revision:number}>('select * from race_heats where id=$1',[id])).rows[0];expect(source.lane1_status).toBe('dns');expect(source.revision).toBe(1);
  const dnfId=randomUUID();await as(w.db,'chair',q=>q('select save_race($1,$2,0,$3)',[w.eventId,dnfId,JSON.stringify({...input,lane1:lane('A','dnf')})]));
  await expect(as(w.db,'chair',q=>q("select queue_race_followup($1,$2,1,'rerun')",[w.eventId,dnfId]))).rejects.toThrow();
  await expect(as(w.db,'mgr1',q=>q("select queue_race_followup($1,$2,1,'swap')",[w.eventId,id]))).rejects.toThrow();
 });
});

describe('event-specific reaction scoring',()=>{
 it('persists validated values and keeps them when an older client updates stage points',async()=>{
  const scoring={podium:[100,90,80],minimum:4,referenceMultiplier:1.3,falseStartPenalty:2,dnfPenalty:1,fastestCarBonus:7};
  const input={seeds:[],reactionComplete:false,points:[10,20,30,40,50,60,100,5],scoring};
  const save=(revision:number,value:unknown)=>as(w.db,'chair',q=>q('select save_racing_setup($1,$2,$3) as s',[w.eventId,revision,JSON.stringify(value)]));
  expect((await save(0,input)).rows[0].s.scoring).toEqual(scoring);
  const {scoring:ignored,...legacy}=input;expect((await save(1,legacy)).rows[0].s.scoring).toEqual(scoring);
  await expect(save(2,{...input,scoring:{...scoring,fastestCarBonus:11}})).rejects.toThrow();
  await expect(as(w.db,'mgr1',q=>q('select save_racing_setup($1,2,$2)',[w.eventId,JSON.stringify(input)]))).rejects.toThrow();
 });
});

describe('lane-swapped automatic schedule',()=>{
 it.each([1,2,3,4,5])('schedules %s teams in adjacent swapped pairs with four runs per team',async(n)=>{
  const sample=await seedWorld(w.db);
  if(n===1)await w.db.query('delete from teams where id=$1',[sample.team2]);
  for(let i=2;i<n;i++)await w.db.query('insert into teams(id,event_id,number,name) values($1,$2,$3,$4)',[randomUUID(),sample.eventId,String(i+1),`Team ${i+1}`]);
  await as(w.db,'chair',q=>q('select queue_reaction_races($1)',[sample.eventId]));
  const races=(await w.db.query<any>('select * from race_heats where event_id=$1 order by heat_number',[sample.eventId])).rows;
  expect(races).toHaveLength(n*2);
  for(let i=0;i<races.length;i+=2){
   const a=races[i],b=races[i+1];expect([a.lane1_team,a.lane1_car,a.lane2_team,a.lane2_car]).toEqual([b.lane2_team,b.lane2_car,b.lane1_team,b.lane1_car]);
  }
  const counts=new Map<string,number>();
  for(const r of races)for(const lane of [1,2]){const k=`${r[`lane${lane}_team`]}:${r[`lane${lane}_car`]}:${lane}`;counts.set(k,(counts.get(k)??0)+1);}
  expect(counts.size).toBe(n*4);expect([...counts.values()].every(v=>v===1)).toBe(true);
 });
});

it('accepts the full list of 73 selectable inspection regulations',async()=>{
 const sample=await seedWorld(w.db);const articles=INDIA_TECHNICAL.rules.map(r=>r.article);
 const result=await as(w.db,'chair',q=>q('select save_inspection_scope($1,0,$2) as s',[sample.eventId,articles]));
 expect(result.rows[0].s.articles).toEqual(articles);
});
