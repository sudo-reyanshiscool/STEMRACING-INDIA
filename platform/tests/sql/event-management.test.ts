import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { blankReview } from '../../src/api';
import { as, denied, makeDb, seedWorld, type World } from './harness';
let db:PGlite, w:World;
beforeAll(async()=>{db=await makeDb();});beforeEach(async()=>{w=await seedWorld(db);});afterAll(async()=>{await db.close();});
const deletion=(name='Test event',who:'organiser'|'chair'|'judgeV'|null='organiser')=>as(db,who,q=>q('select delete_event($1,$2)',[w.eventId,name]));
const restore=()=>as(db,'organiser',q=>q('select restore_event($1)',[w.eventId]));
const batch=(teams:unknown,who:'organiser'|'chair'|'judgeV'|null='organiser')=>as(db,who,q=>q('select * from import_teams($1,$2::jsonb)',[w.eventId,JSON.stringify(teams)]));

describe('restorable event deletion',()=>{
  it('requires the organiser and the exact current name and does not expose direct deletion fields',async()=>{
    for(const who of ['chair','judgeV',null] as const)await expect(deletion('Test event',who)).rejects.toBeDefined();
    await expect(deletion('Wrong')).rejects.toBeDefined();
    await denied(as(db,'organiser',q=>q('update events set deleted_at=now() where id=$1',[w.eventId])));
    expect((await as(db,'organiser',q=>q('select id from events where id=$1',[w.eventId]))).rows).toHaveLength(1);
  });
  it('hides all event data and writes, preserves records and audit, and restores released results',async()=>{
    const c=(await as(db,'judgeV',q=>q("insert into scorecards(event_id,team_id,area_id) values($1,$2,'verbal-technique') returning id",[w.eventId,w.team1]))).rows[0].id;
    await as(db,'judgeV',q=>q('select save_card_review($1,$2::jsonb)',[c,JSON.stringify({...blankReview(),overall:'Good',internalNotes:'Preserve notes'})]));
    await as(db,'judgeV',q=>q("insert into scorecard_scores(scorecard_id,criterion_id,score) values($1,'engagement-presentation-dynamics',14),($1,'team-contribution',12)",[c]));
    await as(db,'judgeV',q=>q("update scorecards set status='submitted' where id=$1",[c]));
    const ruleset=(await db.query<{ruleset:{id:string}}>('select ruleset from events where id=$1',[w.eventId])).rows[0].ruleset as {id:string};
    await as(db,'chair',q=>q("insert into ranking_snapshots(event_id,ruleset_id,input_hash,inputs,rows) values($1,$2,$3,'{}','[]')",[w.eventId,ruleset.id,'a'.repeat(64)]));
    await db.query('update events set results_released=true where id=$1',[w.eventId]);
    expect((await as(db,null,q=>q('select id from events where id=$1',[w.eventId]))).rows).toHaveLength(1);
    await deletion();
    for(const who of ['organiser','chair','judgeV','leadV','mgr1',null] as const) {
      expect((await as(db,who,q=>q('select id from events where id=$1',[w.eventId]))).rows).toEqual([]);
      expect((await as(db,who,q=>q('select id from teams where event_id=$1',[w.eventId]))).rows).toEqual([]);
      if (who === null) await expect(as(db,who,q=>q('select id from ranking_snapshots where event_id=$1',[w.eventId]))).rejects.toThrow(/permission denied/);
      else expect((await as(db,who,q=>q('select id from ranking_snapshots where event_id=$1',[w.eventId]))).rows).toEqual([]);
    }
    for(const who of ['organiser','chair','judgeV','leadV','mgr1'] as const) {
      for(const table of ['event_roles','scorecards','judge_conflicts','invitations']) expect((await as(db,who,q=>q(`select * from ${table} where event_id=$1`,[w.eventId]))).rows).toEqual([]);
      for(const table of ['scorecard_scores','scorecard_feedback','scorecard_private_reviews']) expect((await as(db,who,q=>q(`select * from ${table} where scorecard_id=$1`,[c]))).rows).toEqual([]);
    }
    await denied(as(db,'judgeV',q=>q("update scorecard_scores set score=2 where scorecard_id=$1 returning criterion_id",[c])));
    await expect(batch([{number:'3',name:'Blocked'}])).rejects.toBeDefined();
    await expect(as(db,'chair',q=>q('select withdraw_results($1)',[w.eventId]))).rejects.toBeDefined();
    expect((await db.query('select score from scorecard_scores where scorecard_id=$1',[c])).rows).toHaveLength(2);
    expect((await db.query("select action from audit_log where event_id=$1 and action='delete'",[w.eventId])).rows).toHaveLength(1);
    await expect(db.query('delete from events where id=$1',[w.eventId])).rejects.toBeDefined();
    await restore();
    expect((await as(db,null,q=>q('select id from events where id=$1',[w.eventId]))).rows).toHaveLength(1);
    expect((await as(db,'judgeV',q=>q('select internal_notes from scorecard_private_reviews where scorecard_id=$1',[c]))).rows[0].internal_notes).toBe('Preserve notes');
    expect((await as(db,'organiser',q=>q("select action from audit_log where event_id=$1 and action in ('delete','restore') order by id",[w.eventId]))).rows.map(r=>r.action)).toEqual(['delete','restore']);
  });
  it('lists deleted events only to their organisers and only organisers can restore',async()=>{
    await deletion();
    expect((await as(db,'organiser',q=>q('select id from list_deleted_events() where id=$1',[w.eventId]))).rows).toHaveLength(1);
    for(const who of ['chair','judgeV','mgr1','outsider'] as const) {
      expect((await as(db,who,q=>q('select id from list_deleted_events() where id=$1',[w.eventId]))).rows).toEqual([]);
      await expect(as(db,who,q=>q('select restore_event($1)',[w.eventId]))).rejects.toBeDefined();
    }
    await expect(as(db,null,q=>q('select * from list_deleted_events()'))).rejects.toBeDefined();
    await restore();expect((await as(db,'organiser',q=>q('select id from list_deleted_events() where id=$1',[w.eventId]))).rows).toEqual([]);
  });
  it('defers invitations until a deleted event is restored',async()=>{
    await as(db,'organiser',q=>q("insert into invitations(event_id,email,role,panel,display_name) values($1,'new.judge@x.test','judge','verbal','Test Judge')",[w.eventId]));
    await deletion();expect((await as(db,'invitee',q=>q('select claim_invitations() as n'))).rows[0].n).toBe(0);
    await restore();expect((await as(db,'invitee',q=>q('select claim_invitations() as n'))).rows[0].n).toBeGreaterThanOrEqual(1);
  });
});

describe('atomic team imports',()=>{
  it('allows the organiser and Chair, trims values and preserves leading zeros',async()=>{
    const r=await batch([{number:' 001 ',name:' Team A ',school:' School, Delhi '},{number:'B1',name:'Team B'}]);
    expect(r.rows.map(t=>[t.number,t.name,t.school])).toEqual([['001','Team A','School, Delhi'],['B1','Team B','']]);
    expect((await batch([{number:'C1',name:'Team C'}],'chair')).rows).toHaveLength(1);
    for(const who of ['judgeV',null] as const)await expect(batch([{number:'X1',name:'No'}],who)).rejects.toBeDefined();
  });
  it('rolls back the whole batch on existing numbers, duplicate input numbers or invalid rows',async()=>{
    for(const rows of [[{number:'9',name:'Nine'},{number:' 1 ',name:'Existing'}],[{number:'9',name:'Nine'},{number:' 9 ',name:'Again'}],
      [{number:'9',name:'Nine'},{number:'10',name:''}],[{number:'9',name:'Nine'},{number:10,name:'Wrong type'}],
      [{number:'9',name:'Nine'},{number:'10',name:'Ten',school:'x'.repeat(121)}],null,{},[],Array.from({length:1001},(_,i)=>({number:String(i),name:'Name'}))]) {
      await expect(batch(rows)).rejects.toBeDefined();
      expect((await db.query("select id from teams where event_id=$1 and number='9'",[w.eventId])).rows).toEqual([]);
    }
  });
});
