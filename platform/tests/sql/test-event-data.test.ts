import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {as,ids,makeDb,seedWorld,type World} from './harness';
import {buildTestEventData,renderTestEventSql} from '../../scripts/test-event-data';
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
   const expected={teams:50,scorecards:fixture.cards.length,technical_inspections:100,penalties:13,score_overrides:5,race_heats:75}[table];
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
