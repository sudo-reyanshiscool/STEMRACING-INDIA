import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import {as,makeDb,seedWorld,type World} from './harness';
import type {PGlite} from '@electric-sql/pglite';
let db:PGlite,w:World;
beforeAll(async()=>{db=await makeDb();});beforeEach(async()=>{w=await seedWorld(db);});afterAll(async()=>db.close());
const rules=(deadline:string|null)=>['design_portfolio','enterprise_portfolio','project_portfolio'].map(kind=>({kind,deadline:kind==='design_portfolio'?deadline:null,pointsPerHour:5}));
const save=(deadline:string|null,rev=0)=>as(db,'organiser',q=>q('select save_submission_rules($1,$2,$3)',[w.eventId,rev,JSON.stringify(rules(deadline))]));
const state=(who:'mgr1'|'organiser'|'mgr2'='mgr1')=>as(db,who,q=>q('select submission_state($1) as s',[w.eventId]));
const input={kind:'design_portfolio',name:'portfolio.pdf',mime:'application/pdf',base64:btoa('%PDF-1.4\nportfolio\n%%EOF')};
const upload=(rev=0,team=w.team1)=>as(db,'mgr1',q=>q('select upload_team_file($1,$2,$3,$4)',[w.eventId,team,rev,JSON.stringify(input)]));
it('defaults to five points per hour without activating deadlines, and keeps team status private',async()=>{
 const s=(await state()).rows[0].s;expect(s.rules).toHaveLength(3);expect(s.rules[0].pointsPerHour).toBe(5);expect(s.rows).toHaveLength(3);expect(s.rows.every((r:any)=>r.teamId===w.team1&&r.points===0)).toBe(true);
 await expect(as(db,'mgr1',q=>q('select save_submission_rules($1,0,$2)',[w.eventId,JSON.stringify(rules(null))]))).rejects.toMatchObject({code:'42501'});
 await expect(upload(0,w.team2)).rejects.toMatchObject({code:'42501'});
 await expect(as(db,'outsider',q=>q('select submission_state($1)',[w.eventId]))).rejects.toMatchObject({code:'42501'});
});
it('accrues missing penalties per started hour and adds them once to canonical ranking penalties',async()=>{
 await save(new Date(Date.now()-65*60000).toISOString());
 const row=(await state()).rows[0].s.rows.find((r:any)=>r.kind==='design_portfolio');expect(row).toMatchObject({status:'overdue',points:10,submittedAt:null});
 const p=(await as(db,'mgr1',q=>q('select * from list_event_penalties($1)',[w.eventId]))).rows;expect(p).toHaveLength(1);expect(Number(p[0].points)).toBe(10);expect(p[0].team_id).toBe(w.team1);
 await expect(save(null)).rejects.toMatchObject({code:'40001'});
 await save(new Date(Date.now()+3600000).toISOString(),1);expect((await state()).rows[0].s.rows.every((r:any)=>r.points===0)).toBe(true);
});
it('timestamps accepted uploads on the server and keeps the receipt on replacement',async()=>{
 await save(new Date(Date.now()-65*60000).toISOString());await upload();
 const first=(await state()).rows[0].s.rows.find((r:any)=>r.kind==='design_portfolio');expect(first).toMatchObject({status:'late',points:10});expect(first.submittedAt).toBeTruthy();
 await upload(1);expect((await state()).rows[0].s.rows.find((r:any)=>r.kind==='design_portfolio').submittedAt).toBe(first.submittedAt);
 await expect(upload()).rejects.toMatchObject({code:'40001'});
});
it('rejects a ranking that omits automatic penalties, rather than silently releasing wrong totals',async()=>{
 await save(new Date(Date.now()-65*60000).toISOString());
 const data={penalties:[]};await expect(db.query('select validate_submission_penalties($1,$2)',[w.eventId,JSON.stringify(data)])).rejects.toMatchObject({code:'55000'});
 const penalties=(await db.query('select team_id as "teamId",points::float8 as points from all_event_penalties($1)',[w.eventId])).rows;
 await db.query('select validate_submission_penalties($1,$2)',[w.eventId,JSON.stringify({penalties})]);
});
it('checks automatic penalties on actual publication and release, and freezes results after release',async()=>{
 await save(new Date(Date.now()-65*60000).toISOString());
 const publish=(inputs:unknown)=>as(db,'chair',q=>q("insert into ranking_snapshots(event_id,ruleset_id,input_hash,inputs,rows,released) select id,ruleset->>'id',repeat('a',64),$2,'[]',true from events where id=$1 returning id",[w.eventId,JSON.stringify(inputs)]));
 await expect(publish({penalties:[]})).rejects.toMatchObject({code:'55000'});
 const inputs=async()=>({penalties:(await db.query('select team_id as "teamId",points::float8 as points from all_event_penalties($1)',[w.eventId])).rows});
 await publish(await inputs());
 await save(new Date(Date.now()-125*60000).toISOString(),1);
 await expect(as(db,'chair',q=>q('select release_results($1)',[w.eventId]))).rejects.toMatchObject({code:'55000'});
 await publish(await inputs());await as(db,'chair',q=>q('select release_results($1)',[w.eventId]));
 expect((await state()).rows[0].s.rows.find((r:any)=>r.kind==='design_portfolio').points).toBe(15);
 await expect(save(null,2)).rejects.toMatchObject({code:'55000'});
 await expect(upload()).rejects.toMatchObject({code:'55000'});
});
