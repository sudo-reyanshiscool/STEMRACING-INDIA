import {beforeAll,afterAll,it,expect} from 'vitest';
import {as,makeDb,seedWorld,ids,type World} from './harness';
import type {PGlite} from '@electric-sql/pglite';
import {INDIA_2026} from '../../src/rulesets';
let db:PGlite,w:World;
const image={name:'logo.png',mime:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='};
const logos={light:image,dark:{...image,name:'dark.png'}};
beforeAll(async()=>{db=await makeDb();w=await seedWorld(db);});afterAll(async()=>db.close());
const create=async(level:string,logo:unknown=null,who:'organiser'|'mgr1'|'outsider'='organiser')=>(await as(db,who,q=>q('select (create_branded_event($1,$2,$3,$4,$5::jsonb)).*',['New finals','2027-01-01',INDIA_2026,level,logo===null?null:JSON.stringify(logo)]))).rows[0];
const brand=async(id:string,who:'organiser'|'outsider'|null='organiser')=>(await as(db,who,q=>q('select event_branding($1) as b',[id]))).rows[0].b;
it('creates regional events with supplied branding and persists the explicit level',async()=>{
 const e=await create('regional');expect(e.competition_level).toBe('regional');expect(await brand(e.id)).toEqual({level:'regional',logos:null});
 expect((await as(db,'organiser',q=>q('select competition_level from events where id=$1',[e.id]))).rows[0].competition_level).toBe('regional');
});
it('keeps each national event’s independently uploaded logo set and derives dimensions from bytes',async()=>{
 const a=await create('national',logos),b=await create('national',{...logos,light:{...image,name:'second-event.png'}});
 expect((await brand(a.id)).logos.light).toMatchObject({...image,width:1,height:1});expect((await brand(b.id)).logos.light.name).toBe('second-event.png');
 await expect(as(db,'organiser',q=>q('select * from event_logo_sets'))).rejects.toMatchObject({code:'42501'});
});
it('rejects missing/invalid national logos atomically without leaving events behind',async()=>{
 const before=(await db.query('select count(*) from events')).rows;
 for(const value of [null,{}, {light:image}, {...logos,dark:{...image,base64:btoa('bad file')}},{...logos,light:{...image,mime:'image/svg+xml'}},{...logos,light:{...image,name:'../logo.png'}}])await expect(create('national',value)).rejects.toMatchObject({code:'22023'});
 expect((await db.query('select count(*) from events')).rows).toEqual(before);
 await expect(create('other')).rejects.toMatchObject({code:'22023'});
 await expect(create('regional',logos)).rejects.toMatchObject({code:'22023'});
});
it('enforces creator permissions and unreleased event privacy; released branding can be public',async()=>{
 await expect(create('regional',null,'mgr1')).rejects.toMatchObject({code:'42501'});await expect(create('national',logos,'outsider')).rejects.toMatchObject({code:'42501'});
 const e=await create('national',logos);await expect(brand(e.id,'outsider')).rejects.toMatchObject({code:'42501'});await expect(brand(e.id,null)).rejects.toMatchObject({code:'42501'});
 await db.query('update events set results_released=true where id=$1',[e.id]);expect((await brand(e.id,null)).logos.dark.name).toBe('dark.png');
});
it('does not reclassify existing events or allow direct level changes to bypass creation validation',async()=>{
 expect(await brand(w.eventId)).toEqual({level:null,logos:null});
 await expect(as(db,'organiser',q=>q("update events set competition_level='national' where id=$1",[w.eventId]))).rejects.toMatchObject({code:'42501'});
});
