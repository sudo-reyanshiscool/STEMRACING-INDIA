import { beforeAll, describe, expect, it } from 'vitest';
import { as, makeDb, seedWorld, type World } from './harness';
let w: World;
beforeAll(async()=>{w=await seedWorld(await makeDb());});
const submit=(who:'mgr1'|'mgr2'|'judgeV'|null,team=w.team1,message='Presentation interrupted')=>as(w.db,who,q=>q("select submit_team_concern($1,$2,'verbal',$3)",[w.eventId,team,message]));
const list=(who:'mgr1'|'mgr2'|'judgeV'|'chair'|null)=>as(w.db,who,q=>q('select * from list_team_concerns($1)',[w.eventId]));
describe('team concerns',()=>{
 it('allows immediate submissions before release and isolates teams and judges',async()=>{
  await submit('mgr1');
  expect((await list('mgr1')).rows).toHaveLength(1);
  expect((await list('mgr2')).rows).toHaveLength(0);
  expect((await list('chair')).rows).toHaveLength(1);
  await expect(list('judgeV')).rejects.toThrow();
  await expect(list(null)).rejects.toThrow();
  await expect(submit('mgr2')).rejects.toThrow();
  await expect(submit('judgeV')).rejects.toThrow();
  await expect(submit(null)).rejects.toThrow();
  await expect(submit('mgr1',w.team1,'  ')).rejects.toThrow();
  await expect(submit('mgr1',w.team1,'x'.repeat(4001))).rejects.toThrow();
 });
 it('requires a staff response, preserves the original and prevents direct writes',async()=>{
  const id=(await list('chair')).rows[0].id;
  const resolve=(who:'mgr1'|'chair',response:string)=>as(w.db,who,q=>q('select resolve_team_concern($1,$2,$3)',[w.eventId,id,response]));
  await expect(resolve('mgr1','Forged response')).rejects.toThrow();
  await expect(resolve('chair',' ')).rejects.toThrow();
  await resolve('chair','Reviewed with the panel.');
  expect((await list('mgr1')).rows[0]).toMatchObject({status:'resolved',message:'Presentation interrupted',response:'Reviewed with the panel.'});
  await expect(resolve('chair','Replace')).rejects.toThrow();
  await expect(as(w.db,'chair',q=>q('delete from team_concerns'))).rejects.toThrow();
 });
 it('refuses feedback access after event deletion',async()=>{
  await as(w.db,'organiser',q=>q("select delete_event($1,'Test event')",[w.eventId]));
  await expect(submit('mgr1')).rejects.toThrow();
  await expect(list('mgr1')).rejects.toThrow();
 });
});
