import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {as,denied,makeDb,seedWorld,type Who,type World} from './harness';
import {INDIA_2026} from '../../src/rulesets';
let db:PGlite,w:World;
beforeEach(async()=>{db=await makeDb();w=await seedWorld(db);});
afterEach(async()=>{await db.close();});
const image={name:'logo.png',mime:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='};
const logos={monoBlack:{...image,name:'mono-black.png'},monoWhite:{...image,name:'mono-white.png'},light:image,dark:{...image,name:'dark.png'}};
const createMany=async(items:unknown[],who:Who='organiser')=>(await as(db,who,q=>q('select * from create_named_events($1::jsonb,$2)',[JSON.stringify(items),INDIA_2026]))).rows;
const rename=async(id:string,city:string|null,season:string|number|null,num:number|null=null,custom:string|null=null,who:Who='organiser')=>(await as(db,who,q=>q('select * from rename_event($1,$2,$3::text,$4,$5)',[id,city,season===null?null:String(season),num,custom]))).rows[0];
const regional=(city:string,season:string='2027')=>({level:'regional',city,season});

describe('automatic event names',()=>{
 it('numbers regionals separately for each city and year, in creation order',async()=>{
  const rows=await createMany([regional('Delhi'),regional('Mumbai'),regional('Delhi'),regional(' delhi '),regional('Delhi','2028')]);
  expect(rows.map(r=>r.name)).toEqual([
   'STEM Racing India Delhi Regionals 1 2027','STEM Racing India Mumbai Regionals 1 2027','STEM Racing India Delhi Regionals 2 2027',
   'STEM Racing India delhi Regionals 3 2027','STEM Racing India Delhi Regionals 1 2028']);
  expect(rows.map(r=>[r.city,r.season,r.event_year,r.regional_number,r.custom_name,r.competition_level])).toContainEqual(['Mumbai','2027',2027,1,false,'regional']);
  const later=await createMany([regional('Delhi')]);
  expect(later[0].name).toBe('STEM Racing India Delhi Regionals 4 2027');
 });
 it('names nationals without a number and keeps their logos',async()=>{
  const [n]=await createMany([{level:'national',city:'New Delhi',season:'2027',startsOn:'2027-03-01',logos}]);
  expect(n).toMatchObject({name:'STEM Racing India New Delhi Nationals 2027',regional_number:null});
  expect(new Date(n.starts_on).toISOString().slice(0,10)).toBe('2027-03-01');
  expect((await as(db,'organiser',q=>q('select event_branding($1) as b',[n.id]))).rows[0].b.logos.light.name).toBe('logo.png');
 });
 it('creates the whole batch or nothing',async()=>{
  const before=(await db.query('select count(*)::int as n from events')).rows[0] as {n:number};
  await expect(createMany([regional('Pune'),{level:'national',city:'Pune',season:'2027'}])).rejects.toThrow();
  await expect(createMany([regional('Pune'),regional('')])).rejects.toThrow(/city/);
  await expect(createMany([{level:'regional',city:'Pune',season:'1999'}])).rejects.toThrow(/year/);
  await expect(createMany([])).rejects.toThrow(/between 1 and 30/);
  expect((await db.query('select count(*)::int as n from events')).rows[0]).toEqual(before);
 });
 it('lets only event creators batch-create events',async()=>{
  await expect(createMany([regional('Pune')],'judgeV')).rejects.toThrow(/only organisers/);
  await expect(createMany([regional('Pune')],'outsider')).rejects.toThrow(/only organisers/);
 });
 it('skips numbers held by deleted events',async()=>{
  const [a,b]=await createMany([regional('Chennai'),regional('Chennai')]);
  await as(db,'organiser',q=>q('select delete_event($1,$2)',[b.id,b.name]));
  expect((await createMany([regional('Chennai')]))[0].regional_number).toBe(2);
  expect(a.regional_number).toBe(1);
 });
});

describe('seasons',()=>{
 it('accepts a season with a hyphen and counts it separately from single years',async()=>{
  const rows=await createMany([regional('Mumbai','2026-27'),regional('Mumbai','2026–2027'),regional('Mumbai','2027'),{level:'national',city:'Delhi',season:'2026-27',logos}]);
  expect(rows.map(r=>r.name)).toEqual(['STEM Racing India Mumbai Regionals 1 2026-27','STEM Racing India Mumbai Regionals 2 2026-27','STEM Racing India Mumbai Regionals 1 2027','STEM Racing India Delhi Nationals 2026-27']);
  expect(rows.map(r=>[r.season,r.event_year])).toEqual([['2026-27',2026],['2026-27',2026],['2027',2027],['2026-27',2026]]);
 });
 it('rejects seasons that are not consecutive years',async()=>{
  for(const bad of ['2026-28','2026-2028','26-27','2026/27','2026-'])await expect(createMany([regional('Pune',bad)])).rejects.toThrow(/season such as 2026-27/);
 });
 it('still accepts the numeric year sent by the previous app version',async()=>{
  const [e]=await createMany([{level:'regional',city:'Pune',year:2027}]);
  expect(e).toMatchObject({name:'STEM Racing India Pune Regionals 1 2027',season:'2027'});
  expect((await as(db,'organiser',q=>q('select * from rename_event(p_event=>$1,p_city=>$2,p_year=>$3)',[e.id,'Pune',2028]))).rows[0].name).toBe('STEM Racing India Pune Regionals 1 2028');
 });
 it('moves an event into a season by renaming',async()=>{
  const [a]=await createMany([regional('Delhi','2026-27')]);const [b]=await createMany([regional('Delhi','2027')]);
  expect((await rename(b.id,'Delhi','2026-2027')).name).toBe('STEM Racing India Delhi Regionals 2 2026-27');
  expect(a.regional_number).toBe(1);
 });
});

describe('renaming events',()=>{
 it('rebuilds the name from city, year and number, keeping the number unless the city or year changes',async()=>{
  const [d1,d2,m1]=await createMany([regional('Delhi'),regional('Delhi'),regional('Mumbai')]);
  expect((await rename(d2.id,'Delhi','2027')).name).toBe('STEM Racing India Delhi Regionals 2 2027');
  expect((await rename(d2.id,'Mumbai','2027')).name).toBe('STEM Racing India Mumbai Regionals 2 2027');
  expect((await rename(m1.id,'Mumbai','2027',5)).name).toBe('STEM Racing India Mumbai Regionals 5 2027');
  expect((await rename(d1.id,'Delhi','2028')).regional_number).toBe(1);
  await expect(rename(d1.id,'Delhi','2028',100)).rejects.toThrow(/1 to 99/);
 });
 it('stores a custom name and can return to the automatic one',async()=>{
  const [e]=await createMany([regional('Pune')]);
  const custom=await rename(e.id,'Pune','2027',null,'  Pune   showcase day ');
  expect(custom).toMatchObject({name:'Pune showcase day',custom_name:true,city:'Pune',regional_number:1});
  expect((await rename(e.id,'Pune','2027')).name).toBe('STEM Racing India Pune Regionals 1 2027');
 });
 it('lets older events without a level change only to a custom name',async()=>{
  expect((await rename(w.eventId,null,null,null,'Renamed test event')).name).toBe('Renamed test event');
  await expect(rename(w.eventId,'Delhi','2027')).rejects.toThrow(/custom name/);
 });
 it('allows organisers and Chairs, and refuses everyone else',async()=>{
  const [e]=await createMany([regional('Pune')]);
  await as(db,'organiser',q=>q("insert into event_roles(event_id,user_id,role) select $1,user_id,'chair' from event_roles where event_id=$2 and role='chair'",[e.id,w.eventId]));
  expect((await rename(e.id,'Pune','2027',3,null,'chair')).regional_number).toBe(3);
  await expect(rename(e.id,'Pune','2027',null,null,'judgeV')).rejects.toThrow(/only organisers and Chairs/);
  await expect(rename(e.id,'Pune','2027',null,null,'outsider')).rejects.toThrow(/only organisers and Chairs/);
 });
 it('keeps the naming parts out of reach of direct table writes',async()=>{
  await denied(as(db,'organiser',q=>q("update events set city='Elsewhere' where id=$1",[w.eventId])));
  await denied(as(db,'organiser',q=>q("update events set regional_number=9 where id=$1",[w.eventId])));
 });
});
