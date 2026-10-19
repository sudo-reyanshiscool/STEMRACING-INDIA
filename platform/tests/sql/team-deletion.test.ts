import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { blankReview } from '../../src/api';
import { as, denied, makeDb, seedWorld, type World, type Who } from './harness';
let db: PGlite, w: World;
beforeAll(async () => { db = await makeDb(); });
beforeEach(async () => { w = await seedWorld(db); });
afterAll(async () => { await db.close(); });
const remove = (who: Who | null = 'organiser', number = '1', event?: string) =>
  as(db, who, q => q('select delete_team($1,$2,$3)', [event ?? w.eventId, w.team1, number]));
const openCard = async () => (await as(db, 'judgeV', q => q("insert into scorecards(event_id,team_id,area_id) values($1,$2,'verbal-technique') returning id", [w.eventId, w.team1]))).rows[0].id;

describe('team deletion', () => {
  it('requires staff, exact confirmation and a matching event, and blocks direct deletes', async () => {
    for (const who of ['judgeV','leadV','mgr1','outsider',null] as const) await expect(remove(who)).rejects.toBeDefined();
    await expect(remove('organiser','wrong')).rejects.toBeDefined();
    const other = await seedWorld(db);
    await expect(remove('organiser','1',other.eventId)).rejects.toBeDefined();
    await denied(as(db,'organiser',q=>q('delete from teams where id=$1',[w.team1])));
    expect((await db.query('select id from teams where id=$1',[w.team1])).rows).toHaveLength(1);
    await remove('chair');
    expect((await db.query('select id from teams where id=$1',[w.team1])).rows).toEqual([]);
    expect((await db.query('select id from teams where id=$1',[w.team2])).rows).toHaveLength(1);
  });
  it('cascades drafts, scores, reviews, manager roles, invites, conflicts, overrides and penalties atomically', async () => {
    const c = await openCard();
    await as(db,'judgeV',q=>q("insert into scorecard_scores(scorecard_id,criterion_id,score) values($1,'team-contribution',14)",[c]));
    await as(db,'judgeV',q=>q('select save_card_review($1,$2::jsonb)',[c,JSON.stringify({...blankReview(),internalNotes:'Draft note'})]));
    await as(db,'judgeV',q=>q('insert into judge_conflicts(event_id,team_id) values($1,$2)',[w.eventId,w.team1]));
    await as(db,'organiser',q=>q("insert into invitations(event_id,email,role,team_id) values($1,'new@x.test','team_manager',$2)",[w.eventId,w.team1]));
    await as(db,'chair',q=>q("insert into score_overrides(event_id,team_id,area_id,value,reason) values($1,$2,'verbal-technique',20,'Reason')",[w.eventId,w.team1]));
    await as(db,'chair',q=>q("insert into penalties(event_id,team_id,points,reason) values($1,$2,2,'Reason')",[w.eventId,w.team1]));
    await remove();
    for (const table of ['event_roles','invitations','judge_conflicts','scorecards','score_overrides','penalties']) {
      expect((await db.query(`select * from ${table} where team_id=$1`,[w.team1])).rows,table).toEqual([]);
    }
    for (const table of ['scorecard_scores','scorecard_feedback','scorecard_private_reviews']) {
      expect((await db.query(`select * from ${table} where scorecard_id=$1`,[c])).rows,table).toEqual([]);
    }
    expect((await db.query("select detail->'old'->>'name' as name from audit_log where entity='teams' and entity_id=$1 and action='delete'",[w.team1])).rows).toEqual([{name:'Team One'}]);
    await as(db,'organiser',q=>q("insert into teams(event_id,number,name) values($1,'1','Replacement')",[w.eventId]));
  });
  it('keeps submitted evidence and every dependent record until the Chair reopens the card', async () => {
    const c=await openCard();
    await as(db,'judgeV',q=>q("insert into scorecard_scores(scorecard_id,criterion_id,score) values($1,'engagement-presentation-dynamics',14),($1,'team-contribution',14)",[c]));
    await as(db,'judgeV',q=>q("update scorecards set status='submitted' where id=$1",[c]));
    await expect(remove()).rejects.toMatchObject({code:'55000'});
    expect((await db.query('select id from event_roles where team_id=$1',[w.team1])).rows).toHaveLength(1);
    expect((await db.query('select score from scorecard_scores where scorecard_id=$1',[c])).rows).toHaveLength(2);
    await as(db,'chair',q=>q('select reopen_scorecard($1,$2)',[c,'Duplicate team']));
    await remove();expect((await db.query('select id from teams where id=$1',[w.team1])).rows).toEqual([]);
  });
  it('blocks released and deleted events even when the team has no cards', async () => {
    await db.query('update events set results_released=true where id=$1',[w.eventId]);
    await expect(remove()).rejects.toMatchObject({code:'55000'});
    await as(db,'organiser',q=>q("select delete_event($1,'Test event')",[w.eventId]));
    await expect(remove()).rejects.toMatchObject({code:'42501'});
    expect((await db.query('select id from teams where id=$1',[w.team1])).rows).toHaveLength(1);
  });
});
