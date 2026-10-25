import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {makeDb,seedWorld,as,ids,type World} from './harness';
import {emptySchedule,allocateStreams,type ScheduleDoc,type Activity} from '../../src/scheduling';
let db:PGlite,w:World;
beforeAll(async()=>{db=await makeDb();});beforeEach(async()=>{w=await seedWorld(db);});afterAll(async()=>db.close());
const base=():ScheduleDoc=>({...emptySchedule(),days:[{date:'2027-06-01',opens:'08:00',closes:'18:00'}],...allocateStreams([w.team1,w.team2])});
const activity=(patch:Partial<Activity>={}):Activity=>({id:randomUUID(),title:'Opening Ceremony',kind:'ceremony',scope:'all',streamId:null,teamIds:[],panel:null,start:'2027-06-01T03:00:00Z',end:'2027-06-01T03:30:00Z',point:false,resourceIds:[],location:'',...patch});
const save=(d:ScheduleDoc,rev=0,who:'organiser'|'mgr1'|'judgeV'|'outsider'='organiser')=>as(db,who,q=>q('select save_schedule($1,$2,$3)',[w.eventId,rev,JSON.stringify(d)]));
const publish=(rev=1)=>as(db,'organiser',q=>q('select publish_schedule($1,$2)',[w.eventId,rev]));
const state=()=>as(db,'organiser',q=>q('select scheduling_state($1) as s',[w.eventId]));
const mine=(who:'mgr1'|'mgr2'='mgr1')=>as(db,who,q=>q('select my_schedule($1) as s',[w.eventId]));
it('persists 100 randomly allocated teams in ten streams, protects revisions, and never reshuffles on reads',async()=>{
 const ids=[w.team1,w.team2];for(let i=3;i<=100;i++)ids.push((await db.query<{id:string}>('insert into teams(event_id,number,name) values($1,$2,$3) returning id',[w.eventId,String(i),`Team ${i}`])).rows[0].id);
 const d={...base(),...allocateStreams(ids)};await save(d);const saved=(await state()).rows[0].s;expect(saved.draft.allocations).toEqual(d.allocations);expect(saved.draft.streams).toHaveLength(10);expect((await state()).rows[0].s.draft).toEqual(saved.draft);
 await expect(save(d)).rejects.toMatchObject({code:'40001'});await publish();expect((await mine()).rows[0].s.teams[0].stream).toMatch(/^Stream /);
});
it('rejects duplicate assignments and over-capacity transfers transactionally',async()=>{
 const d=base();await save(d);await expect(save({...d,allocations:[...d.allocations,d.allocations[0]]},1)).rejects.toMatchObject({code:'22023'});expect((await state()).rows[0].s.revision).toBe(1);
 for(let i=3;i<=11;i++){const t=(await db.query<{id:string}>('insert into teams(event_id,number,name) values($1,$2,$3) returning id',[w.eventId,String(i),`Team ${i}`])).rows[0].id;d.allocations.push({teamId:t,streamId:d.streams[0].id});}
 await expect(save(d,1)).rejects.toMatchObject({code:'22023'});
});
it('publishes shared ceremonies and exact multiple racing slots, while drafts and other team details stay private',async()=>{
 const d=base();d.activities=[activity(),activity({title:'Race 1',kind:'racing',scope:'teams',teamIds:[w.team1],start:'2027-06-01T04:30:00Z',end:null,point:true}),activity({title:'Race 2',kind:'racing',scope:'teams',teamIds:[w.team1],start:'2027-06-01T05:07:00Z',end:'2027-06-01T05:17:00Z'})];
 await save(d);expect((await mine()).rows[0].s.publishedAt).toBeNull();await publish();expect((await mine()).rows[0].s.teams[0].activities).toHaveLength(3);expect((await mine('mgr2')).rows[0].s.teams[0].activities).toHaveLength(1);
 d.activities[0].title='Draft ceremony edit';await save(d,2);expect(JSON.stringify((await mine()).rows)).not.toContain('Draft ceremony edit');expect((await state()).rows[0].s.history).toHaveLength(3);
 await expect(as(db,'mgr1',q=>q('select scheduling_state($1)',[w.eventId]))).rejects.toMatchObject({code:'42501'});
});
it('blocks judging/racing clashes, exempt appointments, hours violations and stale team-stream associations',async()=>{
 const d=base();const a=activity({title:'Engineering',kind:'judging',scope:'teams',teamIds:[w.team1],panel:'design_engineering'});d.activities=[a,activity({title:'Race',kind:'racing',scope:'teams',teamIds:[w.team1]})];d.exemptions=[{teamId:w.team1,panel:'design_engineering',reason:'Competition rule'}];
 await save(d);const issues=(await state()).rows[0].s.issues;expect(issues.map((i:any)=>i.code)).toEqual(expect.arrayContaining(['overlap','exempt']));await expect(publish()).rejects.toMatchObject({code:'55000'});
 d.activities=[{...a,start:'2027-06-02T03:00:00Z',end:'2027-06-02T03:30:00Z',streamId:'removed'}];await save(d,1);expect((await state()).rows[0].s.issues.map((i:any)=>i.code)).toEqual(expect.arrayContaining(['hours','stream_assignment']));
});
it('keeps exempt teams in streams and racing, and distinguishes informational stream judging blocks',async()=>{
 const d=base();d.exemptions=[{teamId:w.team1,panel:'all',reason:'Non-judged team'},{teamId:w.team2,panel:'enterprise',reason:'Category exemption'}];d.activities=[activity({kind:'judging',scope:'stream',streamId:d.streams[0].id,panel:'enterprise',title:'Enterprise block'}),activity({title:'Race',kind:'racing',scope:'teams',teamIds:[w.team1]})];
 await save(d);await publish();expect((await mine()).rows[0].s.teams[0].activities.map((a:any)=>a.title)).toEqual(['Race']);expect((await mine()).rows[0].s.teams[0].stream).toBeTruthy();expect((await mine('mgr2')).rows[0].s.teams[0].activities).toHaveLength(0);
});
it('flags shared track conflicts as warnings and newly registered teams as awaiting allocation without changing publication',async()=>{
 const d=base();const resource={id:randomUUID(),name:'Track 1',kind:'track' as const};d.resources=[resource];d.activities=[w.team1,w.team2].map(t=>activity({kind:'racing',scope:'teams',teamIds:[t],resourceIds:[resource.id]}));await save(d);expect((await state()).rows[0].s.issues.some((i:any)=>i.code==='resource_overlap'&&i.severity==='warning')).toBe(true);await publish();
 const before=(await mine()).rows[0].s;await db.query("insert into teams(event_id,number,name) values($1,'NEW','New team')",[w.eventId]);expect((await state()).rows[0].s.issues.some((i:any)=>i.code==='unallocated')).toBe(true);expect((await mine()).rows[0].s).toEqual(before);await expect(publish(2)).rejects.toMatchObject({code:'55000'});
});
it('denies unauthorised mutations, forged resources and direct access to private schedule documents',async()=>{
 for(const who of ['mgr1','judgeV','outsider'] as const)await expect(save(base(),0,who)).rejects.toMatchObject({code:'42501'});
 await expect(as(db,'mgr1',q=>q('select * from event_schedules'))).rejects.toMatchObject({code:'42501'});await expect(as(db,'mgr1',q=>q('select * from schedule_history'))).rejects.toMatchObject({code:'42501'});
 const d=base();d.activities=[activity({resourceIds:['forged']})];await expect(save(d)).rejects.toMatchObject({code:'22023'});
});
it('supports manual transfers and records who changed the draft without touching the official allocation',async()=>{
 const d=base();d.streams.push({id:randomUUID(),name:'Stream B'});await save(d);await publish();const official=(await mine()).rows[0].s.teams[0].stream;
 d.allocations=d.allocations.map(a=>a.teamId===w.team1?{...a,streamId:d.streams[1].id}:a);await save(d,2);expect((await mine()).rows[0].s.teams[0].stream).toBe(official);await publish(3);expect((await mine()).rows[0].s.teams[0].stream).toBe('Stream B');
 expect((await db.query<{changed_by:string}>('select changed_by from schedule_history where event_id=$1',[w.eventId])).rows.every(r=>r.changed_by===ids.organiser)).toBe(true);
 const another=(await db.query<{id:string}>("insert into events(name,ruleset,created_by) select 'Other region',ruleset,$2 from events where id=$1 returning id",[w.eventId,ids.admin])).rows[0].id;
 await expect(as(db,'organiser',q=>q('select save_schedule($1,0,$2)',[another,JSON.stringify(emptySchedule())]))).rejects.toMatchObject({code:'42501'});
});
it('keeps read-only platform spectators from saving or publishing a schedule',async()=>{
 await db.query("insert into platform_organisers(user_id,email,scope,granted_by) values($1,'outsider@x.test','spectator',$2) on conflict(user_id) do update set scope='spectator'",[ids.outsider,ids.admin]);
 expect((await as(db,'outsider',q=>q('select scheduling_state($1) as s',[w.eventId]))).rows[0].s.revision).toBe(0);
 await expect(save(base(),0,'outsider')).rejects.toMatchObject({code:'42501'});await expect(as(db,'outsider',q=>q('select publish_schedule($1,0)',[w.eventId]))).rejects.toMatchObject({code:'42501'});
});
