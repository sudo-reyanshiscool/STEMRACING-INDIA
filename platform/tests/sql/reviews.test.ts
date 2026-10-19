import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blankReview } from '../../src/api/review';
import { as, denied, ids, makeDb, seedWorld, type World } from './harness';

let w: World;
let card: string;
const review = { ...blankReview(), overall: 'A clear presentation.', strengths: 'Teamwork', improvements: 'Explain testing.',
  criterionNotes: { 'team-contribution': 'Ask about the quieter member.' }, internalNotes: 'Private discussion.', nominations: ['team-identity'] };
beforeAll(async () => {
  w = await seedWorld(await makeDb());
  card = (await as(w.db, 'judgeV', (q) => q(`insert into scorecards(event_id,team_id,area_id) values ($1,$2,'verbal-technique') returning id`, [w.eventId,w.team1]))).rows[0].id;
});
afterAll(async () => { await w.db.close(); });
const save = (value: unknown = review, who: 'judgeV' | 'judgeD' | 'chair' | null = 'judgeV') => as(w.db, who,
  (q) => q('select save_card_review($1,$2::jsonb)', [card, JSON.stringify(value)]));

describe('scorecard feedback and private notes', () => {
  it('saves both halves together and keeps private notes off the team-readable table', async () => {
    await save();
    const f = await as(w.db, 'judgeV', (q) => q('select * from scorecard_feedback where scorecard_id=$1', [card]));
    expect(f.rows).toEqual([{ scorecard_id: card, overall: review.overall, strengths: review.strengths, improvements: review.improvements }]);
    expect((await as(w.db, 'judgeV', (q) => q('select internal_notes from scorecard_private_reviews'))).rows[0].internal_notes).toBe(review.internalNotes);
  });
  it('allows the owner, panel lead and Chair to read private notes; excludes unrelated judges and managers', async () => {
    for (const who of ['judgeV', 'leadV', 'chair', 'organiser'] as const) expect((await as(w.db, who, (q) => q('select * from scorecard_private_reviews'))).rows).toHaveLength(1);
    for (const who of ['judgeD', 'mgr1', 'mgr2', 'outsider'] as const) expect((await as(w.db, who, (q) => q('select * from scorecard_private_reviews'))).rows).toEqual([]);
    await denied(as(w.db, null, (q) => q('select * from scorecard_private_reviews')));
  });
  it('refuses direct writes, impersonation and signed-out RPC calls', async () => {
    await denied(as(w.db, 'judgeV', (q) => q("update scorecard_feedback set overall='bypass' where scorecard_id=$1", [card])));
    await denied(as(w.db, 'judgeV', (q) => q("delete from scorecard_private_reviews where scorecard_id=$1", [card])));
    for (const who of ['judgeD', 'chair', null] as const) await expect(save(review, who)).rejects.toBeDefined();
  });
  it('rejects malformed and excessive fields atomically', async () => {
    for (const value of [null, {}, {...review, overall:'x'.repeat(4001)}, {...review, criterionNotes:{'made-up':'note'}},
      {...review, criterionNotes:{'team-contribution':'x'.repeat(1001)}}, {...review,nominations:['unknown']}, {...review,nominations:['team-identity','team-identity']}, {...review,nominations:[null]}]) {
      await expect(save(value)).rejects.toBeDefined();
    }
    const r = await as(w.db, 'judgeV', (q) => q('select overall from scorecard_feedback where scorecard_id=$1',[card]));
    expect(r.rows[0].overall).toBe(review.overall);
  });
  it('locks reviews on submit and releases only team feedback to the correct manager', async () => {
    await as(w.db,'judgeV',(q)=>q(`insert into scorecard_scores(scorecard_id,criterion_id,score) values ($1,'engagement-presentation-dynamics',14),($1,'team-contribution',12)`,[card]));
    await as(w.db,'judgeV',(q)=>q("update scorecards set status='submitted' where id=$1",[card]));
    await expect(save()).rejects.toBeDefined();
    expect((await as(w.db,'mgr1',(q)=>q('select * from scorecard_feedback'))).rows).toEqual([]);
    // Superuser release isolates the read policies from ranking publication (covered by the existing release suite).
    await w.db.query('update events set results_released=true where id=$1',[w.eventId]);
    expect((await as(w.db,'mgr1',(q)=>q('select overall from scorecard_feedback'))).rows).toEqual([{overall:review.overall}]);
    expect((await as(w.db,'mgr2',(q)=>q('select * from scorecard_feedback'))).rows).toEqual([]);
    expect((await as(w.db,'mgr1',(q)=>q('select * from scorecard_private_reviews'))).rows).toEqual([]);
    await w.db.query('update events set results_released=false where id=$1',[w.eventId]);
    await as(w.db,'chair',(q)=>q('select reopen_scorecard($1,$2)',[card,'Revise feedback']));
    await save({...review,overall:'Revised after reopening.'});
    await w.db.query('update events set results_released=true where id=$1',[w.eventId]);
    await expect(save()).rejects.toBeDefined();
  });
});
