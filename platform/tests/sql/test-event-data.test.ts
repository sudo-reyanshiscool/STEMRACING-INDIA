import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {as,ids,makeDb,seedWorld,type World} from './harness';
import {buildTestEventData,renderTestEventSql,renderTestEventPreferenceSql} from '../../scripts/test-event-data';
import {INDIA_2026} from '../../src/rulesets';
import {rank} from '../../src/engine';
import {INDIA_TECHNICAL,summarise,specificationsScore} from '../../src/technical';
import {validateRace} from '../../src/racing';
let db:PGlite,other:World,eventId:string;
beforeAll(async()=>{
 db=await makeDb();other=await seedWorld(db);
 eventId=(await db.query<{id:string}>("insert into events(name,ruleset,created_by) values('Test Event',$1,$2) returning id",[INDIA_2026,ids.admin])).rows[0].id;
 await db.exec(renderTestEventSql(eventId,'Test Event','public'));
});
afterAll(async()=>{await db.close();});
describe('sample data for one explicitly selected test event',()=>{
 it('loads exactly 50 teams and varied valid cards, measurements, penalties, overrides and races',async()=>{
  const fixture=buildTestEventData(eventId);
  for(const table of ['teams','scorecards','technical_inspections','penalties','score_overrides','race_heats']){
   const expected={teams:50,scorecards:fixture.cards.length,technical_inspections:100,penalties:13,score_overrides:fixture.overrides.length,race_heats:75}[table];
   expect((await db.query<{n:number}>(`select count(*)::int as n from ${table} where event_id=$1`,[eventId])).rows[0].n).toBe(expected);
  }
  expect(fixture.cards.some(c=>!c.submitted)).toBe(true);expect(fixture.cards.some(c=>c.submitted)).toBe(true);
  const statuses=new Set(fixture.races.flatMap(r=>[r.lane1.status,r.lane2.status]));
  expect([...statuses].sort()).toEqual(['dnf','dns','false_start','finished','pending']);
  for(const race of fixture.races) expect(validateRace(race as Parameters<typeof validateRace>[0])).toBeNull();
  const draft=fixture.cards.find(c=>!c.submitted)!;
  const saved=(await db.query<{overall:string}>('select overall from scorecard_feedback where scorecard_id=$1',[draft.id])).rows[0];
  expect(saved.overall).toContain('DEMO');
 });
 it('keeps other events unchanged, results unreleased, and ordinary judges’ cards private',async()=>{
  expect((await db.query('select id from teams where event_id=$1',[other.eventId])).rows).toHaveLength(2);
  expect((await db.query('select id from ranking_snapshots where event_id=$1',[eventId])).rows).toHaveLength(1);
  expect((await db.query<{results_released:boolean}>('select results_released from events where id=$1',[eventId])).rows[0].results_released).toBe(false);
  const roles=(await as(db,'admin',q=>q('select display_name from event_roles where event_id=$1',[eventId]))).rows;
  expect(roles.every(r=>r.display_name.startsWith('Demo Judge'))).toBe(true);
  expect((await as(db,'judgeV',q=>q('select id from scorecards where event_id=$1',[eventId]))).rows).toHaveLength(0);
 });
 it('produces valid provisional rankings and actual specification penalties from dimensions',()=>{
  const f=buildTestEventData(eventId),derived:Record<string,Record<string,number>>={};
  for(const team of f.teams){
   const [a,b]=f.inspections.filter(i=>i.teamId===team.id);
   if(a.submitted&&b.submitted)derived[team.id]={specifications:specificationsScore(summarise(INDIA_TECHNICAL.rules,a.measurements),summarise(INDIA_TECHNICAL.rules,b.measurements))};
  }
  const r=rank({ruleset:INDIA_2026,teams:f.teams,cards:f.cards.filter(c=>c.submitted),penalties:f.penalties,overrides:f.overrides,derived});
  expect(r.rows).toHaveLength(50);expect(r.rows.some(r=>r.penalties>0)).toBe(true);
  expect(r.rows.some(r=>(r.areas.specifications??100)<100)).toBe(true);
 });
 it('refuses repeat imports and non-test names without modifying evidence',async()=>{
  expect(()=>renderTestEventSql(other.eventId,'Nationals')).toThrow(/Test Event/);
  await expect(db.exec(renderTestEventSql(eventId,'Test Event','public'))).rejects.toThrow(/already contains teams/);
  await db.exec('rollback');
  expect((await db.query('select id from teams where event_id=$1',[eventId])).rows).toHaveLength(50);
 });
});


it('generates SUPERCHARGED as 001 with the highest sample score and no ties',()=>{
 for(const ev of [eventId,randomUUID()]) {
  const f=buildTestEventData(ev);
  expect(f.teams[0]).toMatchObject({number:'001',name:'SUPERCHARGED'});
  expect(f.snapshot.rows[0]).toMatchObject({number:'001',name:'SUPERCHARGED',rank:1,tied:false});
  expect(new Set(f.snapshot.rows.map(r=>r.total)).size).toBe(50);
  expect(f.snapshot.rows.every(r=>!r.tied)).toBe(true);
 }
});

it('updates only seeded Test Event data, audits corrected cards, and retains the old snapshot',async()=>{
 const demoDb=await makeDb();
 try {
  const ev=(await demoDb.query<{id:string}>("insert into events(name,ruleset,created_by) values('Test Event',$1,$2) returning id",[INDIA_2026,ids.admin])).rows[0].id;
  const f=buildTestEventData(ev);
  const oldSnapshot=randomUUID();
  await demoDb.exec(renderTestEventSql(ev,'Test Event','public').replaceAll(f.snapshot.id,oldSnapshot));
  await demoDb.query("update teams set name='Demo Apex Falcons',number='D001' where id=$1",[f.teams[0].id]);
  await demoDb.exec(renderTestEventPreferenceSql(ev,'public'));
  const row=(await demoDb.query<{rows:Array<{name:string;number:string;total:number}>}>('select rows from ranking_snapshots where id=$1',[f.snapshot.id])).rows[0].rows;
  expect(row[0]).toMatchObject({name:'SUPERCHARGED',number:'001'});
  expect(new Set(row.map(r=>r.total)).size).toBe(50);
  expect((await demoDb.query('select id from ranking_snapshots where event_id=$1',[ev])).rows).toHaveLength(2);
  expect((await demoDb.query<{n:number}>("select count(*)::int as n from scorecards where event_id=$1 and reopened_count>0",[ev])).rows[0].n).toBe(14);
  expect((await demoDb.query<{results_released:boolean}>('select results_released from events where id=$1',[ev])).rows[0].results_released).toBe(false);
 } finally {await demoDb.close();}
});
