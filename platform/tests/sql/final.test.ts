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
    const audit = await w.db.query<{ action: string; actor: string }>(`select action from audit_log where entity = 'score_overrides' and action = 'delete'`);
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe('I4: releasing is checked on the server', () => {
  const HASH = 'c'.repeat(64);
  /** The inputs the client would publish: what is counted right now. */
  const currentInputs = async () => {
    const q = (sql: string) => w.db.query(sql, [w.eventId]).then((r) => r.rows);
    return {
      teams: await q('select id from teams where event_id = $1'),
      cards: await q(`select team_id, area_id, judge_id from scorecards where event_id = $1 and status = 'submitted'`),
      overrides: await q('select team_id, area_id, value from score_overrides where event_id = $1'),
      penalties: await q('select team_id, points from penalties where event_id = $1'),
    };
  };
  const publish = async (released = true) => {
    const inputs = await currentInputs();
    return as(w.db, 'chair', (q) => q('insert into ranking_snapshots(event_id, ruleset_id, input_hash, inputs, rows, released) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6) returning id',
      [w.eventId, 'india-national-finals-2026', HASH, JSON.stringify(inputs), '[]', released]));
  };
  const release = (who: Who | null) => as(w.db, who, (q) => q('select release_results($1)', [w.eventId]));
  const withdraw = (who: Who | null) => as(w.db, who, (q) => q('select withdraw_results($1)', [w.eventId]));
  const released = async () => (await w.db.query<{ r: boolean }>('select results_released as r from events where id = $1', [w.eventId])).rows[0].r;
  const reset = () => setReleasedRaw(false);

  it('denies setting results_released directly, for the Chair and Organiser too, but not renaming', async () => {
    for (const who of ['chair', 'organiser', 'judgeV', 'mgr1'] as const) {
      await expect(as(w.db, who, (q) => q('update events set results_released = true where id = $1', [w.eventId])), who).rejects.toThrow(/permission denied/);
    }
    await expect(as(w.db, 'chair', (q) => q('update events set results_released = false where id = $1', [w.eventId]))).rejects.toThrow(/permission denied/);
    await as(w.db, 'chair', (q) => q(`update events set name = 'Renamed event' where id = $1`, [w.eventId]));
    expect(await released()).toBe(false);
  });

  it('refuses to release without a published ranking', async () => {
    await expect(release('chair')).rejects.toMatchObject({ code: '55000' });
    await expect(release('chair')).rejects.toThrow(/publish/i);
    expect(await released()).toBe(false);
  });

  it('releases when the latest snapshot matches the current inputs, audits it, and withdraws on request', async () => {
    const card = await makeCard('judgeD', w.team2, 'de-portfolio');
    for (const c of ['design-concepts', '3d-modelling', 'computer-aided-analysis', 'cam-cnc', 'manufacturing-assembly', 'research-development', 'testing', 'design-process-evaluation', 'document-presentation']) {
      await as(w.db, 'judgeD', (q) => q('insert into scorecard_scores(scorecard_id, criterion_id, score) values ($1, $2, 15)', [card, c]));
    }
    await submit('judgeD', card);
    await publish();
    await release('chair');
    expect(await released()).toBe(true);
    const audit = await w.db.query<{ action: string; actor: string }>(`select action, actor from audit_log where entity = 'events' and entity_id = $1 order by id desc limit 1`, [w.eventId]);
    expect(audit.rows[0].actor).toBe(ids.chair);
    await release('chair'); // idempotent
    expect(await withdraw('chair')).toBeDefined();
    expect(await released()).toBe(false);
  });

  it('refuses non-Chairs and anonymous callers, for both functions', async () => {
    await publish();
    for (const who of ['organiser', 'judgeV', 'leadV', 'mgr1', 'outsider'] as const) {
      await expect(release(who), who).rejects.toThrow(/permission|only the Chair/i);
    }
    await expect(release(null)).rejects.toThrow(/permission denied/);
    await expect(withdraw(null)).rejects.toThrow(/permission denied/);
    await setReleasedRaw(true);
    try {
      for (const who of ['organiser', 'judgeV', 'mgr1'] as const) await expect(withdraw(who), who).rejects.toThrow(/permission|only the Chair/i);
      expect(await released()).toBe(true);
    } finally {
      await reset();
    }
  });

  it('refuses a release when anything changed after the snapshot: a new override, a submitted card, a removed penalty, a reopened card', async () => {
    await publish();
    await as(w.db, 'chair', (q) => q(`insert into score_overrides(event_id, team_id, area_id, value, reason) values ($1, $2, 'pit-display', 20, 'Cross-moderated')`, [w.eventId, w.team2]));
    await expect(release('chair')).rejects.toMatchObject({ code: '55000' });
    await expect(release('chair')).rejects.toThrow(/out of date/);
    await publish();
    await release('chair');
    await reset();

    const pid = (await as(w.db, 'chair', (q) => q(`insert into penalties(event_id, team_id, points, reason) values ($1, $2, 5, 'Unsuccessful appeal') returning id`, [w.eventId, w.team2]))).rows[0].id;
    await publish();
    await as(w.db, 'chair', (q) => q('delete from penalties where id = $1', [pid]));
    await expect(release('chair')).rejects.toThrow(/out of date/); // a deletion leaves no later timestamp: the counts catch it
    await publish();

    const card = await makeCard('judgeV', w.team1, 'verbal-composition');
    for (const c of ['content-quality', 'time-clarity-structure']) {
      await as(w.db, 'judgeV', (q) => q('insert into scorecard_scores(scorecard_id, criterion_id, score) values ($1, $2, 10)', [card, c]));
    }
    await submit('judgeV', card);
    await expect(release('chair')).rejects.toThrow(/out of date/);
    await publish();
    await as(w.db, 'chair', (q) => q('select reopen_scorecard($1, $2)', [card, 'Judge asked to fix a typo']));
    await expect(release('chair')).rejects.toThrow(/out of date/);
    await publish();
    await release('chair');
    await reset();
  });

  it('exposes the two functions to authenticated only, pinned to a search_path, and has the guards take the event lock', async () => {
    const f = await w.db.query<{ proname: string; anon: boolean; auth: boolean; pub: boolean; def: boolean; cfg: string[] }>(
      `select p.proname, prosecdef as def, proconfig as cfg,
              has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub
       from pg_proc p where p.proname in ('release_results', 'withdraw_results') order by 1`);
    expect(f.rows.map((r) => r.proname)).toEqual(['release_results', 'withdraw_results']);
    for (const r of f.rows) {
      expect({ anon: r.anon, auth: r.auth, pub: r.pub, def: r.def }, r.proname).toEqual({ anon: false, auth: true, pub: false, def: true });
      expect(r.cfg).toContain('search_path=public, pg_temp');
    }
    const guards = await w.db.query<{ proname: string; src: string }>(
      `select proname, prosrc as src from pg_proc where proname in ('scorecards_fill', 'scorecards_guard', 'scorecards_delete_guard', 'scores_guard', 'scores_delete_guard', 'overrides_guard', 'penalties_guard')`);
    expect(guards.rows).toHaveLength(7);
    for (const g of guards.rows) expect(g.src, g.proname).toContain('event_released_locked');
    const helper = await w.db.query<{ src: string; vol: string }>(`select prosrc as src, provolatile as vol from pg_proc where proname = 'event_released_locked'`);
    expect(helper.rows[0].src).toMatch(/for share/i);
    expect(helper.rows[0].vol).toBe('v');
  });
});
