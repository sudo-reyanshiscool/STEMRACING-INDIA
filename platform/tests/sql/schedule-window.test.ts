import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {makeDb,seedWorld,as,type World} from './harness';
import {emptySchedule,allocateStreams,planWindowSlots,scheduleTimeIso,type ScheduleDoc} from '../../src/scheduling';
let db:PGlite,w:World;
beforeAll(async()=>{db=await makeDb();});beforeEach(async()=>{w=await seedWorld(db);});afterAll(async()=>db.close());
const at=(t:string)=>scheduleTimeIso(`2027-06-01T${t}`,'Asia/Kolkata');
const save=(d:ScheduleDoc,rev:number)=>as(db,'organiser',q=>q('select save_schedule($1,$2,$3)',[w.eventId,rev,JSON.stringify(d)]));
const issues=async()=>(await as(db,'organiser',q=>q('select scheduling_state($1) as s',[w.eventId]))).rows[0].s.issues as Array<{code:string;severity:string}>;
it('accepts bounds-generated parallel judging and racing slots for 25 teams, and publishes each team its own slots',async()=>{
 const teams=(await db.query<{id:string;number:string;name:string}>('select id,number,name from teams where event_id=$1',[w.eventId])).rows;
 for(let i=3;i<=25;i++)teams.push((await db.query<{id:string;number:string;name:string}>('insert into teams(event_id,number,name) values($1,$2,$3) returning id,number,name',[w.eventId,`W${i}`,`Window team ${i}`])).rows[0]);
 const doc:ScheduleDoc={...emptySchedule(),days:[{date:'2027-06-01',opens:'08:00',closes:'18:00'}],...allocateStreams(teams.map(t=>t.id))};
 const base={gap:0,lanes:'stream' as const,streamId:null,location:'Hall 2',replace:true,start:at('12:00'),end:at('15:00'),duration:20};
 for(const area of [{kind:'judging' as const,title:'Verbal Presentation',panel:'verbal' as const,location:'Hall 2'},{kind:'judging' as const,title:'Enterprise',panel:'enterprise' as const,location:'Hall 3'},{kind:'racing' as const,title:'Racing',panel:null,lanes:'single' as const,duration:5,location:'Track'}]){
  const plan=planWindowSlots(doc,teams,{...base,...area});expect(plan.leftover).toEqual([]);doc.activities.push(...plan.slots);
 }
 expect(doc.activities).toHaveLength(75);
 await save(doc,0);const found=await issues();expect(found.filter(i=>i.severity==='error')).toEqual([]);expect(found.filter(i=>i.code==='resource_overlap')).toEqual([]);
 await as(db,'organiser',q=>q('select publish_schedule($1,1)',[w.eventId]));
 const mine=(await as(db,'mgr1',q=>q('select my_schedule($1) as s',[w.eventId]))).rows[0].s.teams[0].activities as Array<{title:string}>;
 expect(mine.map(a=>a.title.split(' — ')[0]).sort()).toEqual(['Enterprise','Racing','Verbal Presentation']);
});
it('rejects a hand-edited generated slot that double-books a team, so publication stays blocked',async()=>{
 const teams=(await db.query<{id:string;number:string;name:string}>('select id,number,name from teams where event_id=$1',[w.eventId])).rows;
 const doc:ScheduleDoc={...emptySchedule(),days:[{date:'2027-06-01',opens:'08:00',closes:'18:00'}],...allocateStreams(teams.map(t=>t.id))};
 const base={gap:0,lanes:'stream' as const,streamId:null,location:'',replace:true,start:at('12:00'),end:at('15:00'),duration:20};
 doc.activities.push(...planWindowSlots(doc,teams,{...base,kind:'judging',title:'Verbal Presentation',panel:'verbal'}).slots);
 const racing=planWindowSlots(doc,teams,{...base,kind:'racing',title:'Racing',panel:null});const clash=doc.activities.find(a=>a.teamIds[0]===racing.slots[0].teamIds[0])!;
 doc.activities.push({...racing.slots[0],start:clash.start,end:clash.end});
 await save(doc,0);expect((await issues()).some(i=>i.code==='overlap')).toBe(true);
 await expect(as(db,'organiser',q=>q('select publish_schedule($1,1)',[w.eventId]))).rejects.toMatchObject({code:'55000'});
});
