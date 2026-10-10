import { beforeAll, describe, expect, it } from 'vitest';
import { as, denied, ids, makeDb, seedWorld, type Who, type World } from './harness';

let w: World;
beforeAll(async () => {
  w = await seedWorld(await makeDb());
});

const makeCard = (who: Who, team: string, area: string) =>
  as(w.db, who, async (q) => (await q('insert into scorecards(event_id, team_id, area_id) values ($1, $2, $3) returning id', [w.eventId, team, area])).rows[0].id as string);
const fill = async (who: Who, card: string) => {
  for (const [c, v] of [['engagement-presentation-dynamics', 14], ['team-contribution', 12]] as const) {
    await as(w.db, who, (q) => q('insert into scorecard_scores(scorecard_id, criterion_id, score) values ($1, $2, $3)', [card, c, v]));
  }
};
const submit = (who: Who, card: string) => as(w.db, who, (q) => q(`update scorecards set status = 'submitted' where id = $1`, [card]));
const declare = (who: Who, team: string) => as(w.db, who, (q) => q('insert into judge_conflicts(event_id, team_id) values ($1, $2)', [w.eventId, team]));
const setReleasedRaw = (v: boolean) => w.db.query('update events set results_released = $2 where id = $1', [w.eventId, v]);

describe('I2: a conflict cannot be declared after the judge submitted for that team', () => {
  it('refuses with a locked error once a card for the team is submitted, and still allows other teams', async () => {
    const card = await makeCard('judgeV', w.team1, 'verbal-technique');
    await fill('judgeV', card);
    await declare('judgeV', w.team1); // a draft card does not stop it (the policies then block further scoring)
    await as(w.db, 'chair', (q) => q('delete from judge_conflicts where event_id = $1 and team_id = $2', [w.eventId, w.team1]));
    await submit('judgeV', card);
    await expect(declare('judgeV', w.team1)).rejects.toMatchObject({ code: '55000' });
    await expect(declare('judgeV', w.team1)).rejects.toThrow(/submitted/);
    await declare('judgeV', w.team2);
  });

  it('keeps other judges and the impersonation attempt on the ordinary access rules', async () => {
    // judgeD has not submitted for team1, so the rule does not apply to them.
    await declare('judgeD', w.team1);
    // Naming someone else as the judge is still plain permission denied, never the locked error.
    await denied(as(w.db, 'judgeD', (q) => q('insert into judge_conflicts(event_id, team_id, judge_id) values ($1, $2, $3)', [w.eventId, w.team1, ids.judgeV])));
    await expect(as(w.db, 'judgeD', (q) => q('insert into judge_conflicts(event_id, team_id, judge_id) values ($1, $2, $3)', [w.eventId, w.team1, ids.judgeV])))
      .rejects.not.toMatchObject({ code: '55000' });
  });

  it('refuses declaring while results are released', async () => {
    await setReleasedRaw(true);
    try {
      await expect(declare('leadV', w.team2)).rejects.toMatchObject({ code: '55000' });
    } finally {
      await setReleasedRaw(false);
    }
  });

  it('lets the Chair and Organiser read every declared conflict, and a judge only their own', async () => {
    const seen = (who: Who) => as(w.db, who, async (q) => (await q('select judge_id from judge_conflicts where event_id = $1', [w.eventId])).rows.map((r: { judge_id: string }) => r.judge_id).sort());
    expect((await seen('chair')).length).toBeGreaterThanOrEqual(2);
    expect(await seen('organiser')).toEqual(await seen('chair'));
    expect(await seen('judgeD')).toEqual([ids.judgeD]);
    expect(await seen('mgr1')).toEqual([]);
  });
});

describe('I3: removing an override', () => {
  const put = () => as(w.db, 'chair', (q) => q(`insert into score_overrides(event_id, team_id, area_id, value, reason) values ($1, $2, 'pit-display', 30, 'Cross-moderated') on conflict (event_id, team_id, area_id) do update set value = 30`, [w.eventId, w.team1]));
  const count = async () => (await w.db.query<{ n: number }>('select count(*)::int as n from score_overrides where team_id = $1', [w.team1])).rows[0].n;

  it('lets only the Chair delete one, audits it, and freezes it while released', async () => {
    await put();
    for (const who of ['organiser', 'judgeV', 'leadV', 'mgr1', 'outsider', null] as const) {
      await denied(as(w.db, who, (q) => q('delete from score_overrides where team_id = $1', [w.team1])));
    }
    expect(await count()).toBe(1);
    await setReleasedRaw(true);
    try {
      await expect(as(w.db, 'chair', (q) => q('delete from score_overrides where team_id = $1', [w.team1]))).rejects.toThrow(/released/);
    } finally {
      await setReleasedRaw(false);
    }
    await as(w.db, 'chair', (q) => q('delete from score_overrides where team_id = $1', [w.team1]));
    expect(await count()).toBe(0);
    const audit = await w.db.query(`select action from audit_log where entity = 'score_overrides' and action = 'delete'`);
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });
});
