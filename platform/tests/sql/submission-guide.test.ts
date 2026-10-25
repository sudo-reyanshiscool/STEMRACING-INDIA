import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import {as,makeDb,seedWorld,ids,type World} from './harness';
import type {PGlite} from '@electric-sql/pglite';
let db:PGlite,w:World;
beforeAll(async()=>{db=await makeDb();});
beforeEach(async()=>{w=await seedWorld(db);await db.query('delete from submission_guide_progress');});
afterAll(async()=>db.close());
const state=async(who:'mgr1'|'mgr2'|'organiser'='mgr1')=>(await as(db,who,q=>q('select submission_guide_state($1) as s',[w.eventId]))).rows[0].s;
const tick=async(position:number)=>(await as(db,'mgr1',q=>q('select record_submission_guide_progress($1,$2) as s',[w.eventId,position]))).rows[0].s;
const advanceClock=()=>db.query("update submission_guide_progress set last_seen_at=clock_timestamp()-interval '10 seconds' where user_id=$1",[ids.mgr1]);
it('keeps progress private and checks event membership',async()=>{
 expect(await state()).toMatchObject({required:true,watchedSeconds:0,complete:false,duration:784.04});
 expect((await state('organiser')).required).toBe(false);
 await expect(as(db,'outsider',q=>q('select submission_guide_state($1)',[w.eventId]))).rejects.toMatchObject({code:'42501'});
 await expect(as(db,null,q=>q('select submission_guide_state($1)',[w.eventId]))).rejects.toMatchObject({code:'42501'});
 await expect(as(db,'mgr1',q=>q("insert into submission_guide_progress(user_id,version,watched_seconds,completed_at) values($1,'submission-guide-2026-10-26-v1',784.04,now())",[ids.mgr1]))).rejects.toMatchObject({code:'42501'});
});
it('rejects end jumps, accelerated credit and accumulated idle time',async()=>{
 expect((await tick(784.04)).complete).toBe(false);
 expect((await tick(0.5)).watchedSeconds).toBeLessThanOrEqual(0.5);
 for(let i=1;i<8;i++)await tick(i);
 expect((await state()).watchedSeconds).toBeLessThan(1);
 await db.query("update submission_guide_progress set last_seen_at=clock_timestamp()-interval '1 hour'");
 expect((await tick(784.04)).complete).toBe(false);
 await expect(tick(-1)).rejects.toMatchObject({code:'22023'});
 await expect(tick(785)).rejects.toMatchObject({code:'22023'});
});
it('blocks direct portfolio uploads until all timed segments complete, then preserves completion',async()=>{
 const input={kind:'design_portfolio',name:'portfolio.pdf',mime:'application/pdf',base64:btoa('%PDF-1.4\nportfolio\n%%EOF')};
 const upload=()=>as(db,'mgr1',q=>q('select upload_team_file($1,$2,0,$3)',[w.eventId,w.team1,JSON.stringify(input)]));
 await expect(upload()).rejects.toMatchObject({code:'55000'});
 await tick(0);
 for(let p=10;p<784.04;p+=10){await advanceClock();await tick(p);}
 expect((await state()).complete).toBe(false);
 await advanceClock();expect((await tick(784.04)).complete).toBe(true);
 expect((await state('mgr2')).complete).toBe(false);
 await upload();
 expect((await tick(0)).complete).toBe(true);
 expect((await state()).watchedSeconds).toBe(784.04);
});
