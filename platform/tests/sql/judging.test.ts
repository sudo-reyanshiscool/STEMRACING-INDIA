import { beforeAll, describe, expect, it } from 'vitest';
import { as, denied, ids, makeDb, seedWorld, type Who, type World } from './harness';

let w: World;
let n = 0;
beforeAll(async () => {
  w = await seedWorld(await makeDb());
});

const newTeam = async () =>
  (await w.db.query<{ id: string }>('insert into teams(event_id, number, name) values ($1, $2, $3) returning id', [w.eventId, `X${++n}`, `Team X${n}`])).rows[0].id;
const makeCard = (who: Who, team: string, area: string) =>
  as(w.db, who, async (q) =>
    (await q('insert into scorecards(event_id, team_id, area_id) values ($1, $2, $3) returning id, panel, status, judge_id', [w.eventId, team, area])).rows[0]);
const setScore = (who: Who, card: string, crit: string, v: number | string) =>
  as(w.db, who, (q) =>
    q('insert into scorecard_scores(scorecard_id, criterion_id, score) values ($1, $2, $3) on conflict (scorecard_id, criterion_id) do update set score = excluded.score', [card, crit, v]));
const fill = async (who: Who, card: string) => {
  await setScore(who, card, 'engagement-presentation-dynamics', 14);
  await setScore(who, card, 'team-contribution', 12);
};
const submit = (who: Who, card: string) => as(w.db, who, (q) => q(`update scorecards set status = 'submitted' where id = $1 returning id`, [card]));
const statusOf = async (card: string) => (await w.db.query<{ status: string; reopened_count: number }>('select status, reopened_count from scorecards where id = $1', [card])).rows[0];

describe('creating a scorecard', () => {
  it('fills in the panel and judge, and starts as a draft', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    expect(c).toMatchObject({ panel: 'verbal', status: 'draft', judge_id: ids.judgeV });
  });

  it('refuses another panel, unknown areas, derived areas and impersonation', async () => {
    const t = await newTeam();
    await denied(as(w.db, 'judgeV', (q) => q(`insert into scorecards(event_id, team_id, area_id) values ($1, $2, 'de-portfolio')`, [w.eventId, t])));
    await expect(makeCard('judgeV', t, 'nope')).rejects.toThrow(/unknown scorecard area/);
    await expect(makeCard('judgeV', t, 'knockout')).rejects.toThrow(/unknown scorecard area/);
    await denied(as(w.db, 'judgeV', (q) => q(`insert into scorecards(event_id, team_id, area_id, judge_id) values ($1, $2, 'verbal-technique', $3)`, [w.eventId, t, ids.judgeD])));
    await denied(as(w.db, 'mgr1', (q) => q(`insert into scorecards(event_id, team_id, area_id) values ($1, $2, 'verbal-technique')`, [w.eventId, t])));
    await denied(as(w.db, 'outsider', (q) => q(`insert into scorecards(event_id, team_id, area_id) values ($1, $2, 'verbal-technique')`, [w.eventId, t])));
    await denied(as(w.db, null, (q) => q(`insert into scorecards(event_id, team_id, area_id) values ($1, $2, 'verbal-technique')`, [w.eventId, t])));
  });

  it('refuses a team from another event', async () => {
    const other = (await w.db.query<{ id: string }>(`insert into events(name, ruleset, created_by) select 'Other', ruleset, created_by from events where id = $1 returning id`, [w.eventId])).rows[0].id;
    const foreign = (await w.db.query<{ id: string }>(`insert into teams(event_id, number, name) values ($1, 'F1', 'Foreign') returning id`, [other])).rows[0].id;
    await expect(makeCard('judgeV', foreign, 'verbal-technique')).rejects.toThrow();
  });

  it('allows one card per judge, team and area', async () => {
    const t = await newTeam();
    await makeCard('judgeV', t, 'verbal-composition');
    await expect(makeCard('judgeV', t, 'verbal-composition')).rejects.toThrow();
  });
});

describe('conflicts of interest', () => {
  it('blocks scoring a team the judge declared a conflict with, until the Chair clears it', async () => {
    const t = await newTeam();
    await as(w.db, 'judgeV', (q) => q('insert into judge_conflicts(event_id, team_id) values ($1, $2)', [w.eventId, t]));
    await denied(as(w.db, 'judgeV', (q) => q(`insert into scorecards(event_id, team_id, area_id) values ($1, $2, 'verbal-subject')`, [w.eventId, t])));
    await expect(makeCard('judgeD', t, 'de-portfolio')).resolves.toMatchObject({ status: 'draft' });
    await denied(as(w.db, 'judgeV', (q) => q('delete from judge_conflicts where team_id = $1', [t])));
    await as(w.db, 'chair', (q) => q('delete from judge_conflicts where team_id = $1', [t]));
    await expect(makeCard('judgeV', t, 'verbal-subject')).resolves.toMatchObject({ status: 'draft' });
  });

  it('blocks submitting a card once a conflict is declared against its team', async () => {
    const t = await newTeam();
    const c = await makeCard('judgeV', t, 'verbal-technique');
    await fill('judgeV', c.id);
    await as(w.db, 'judgeV', (q) => q('insert into judge_conflicts(event_id, team_id) values ($1, $2)', [w.eventId, t]));
    await denied(submit('judgeV', c.id));
    expect((await statusOf(c.id)).status).toBe('draft');
  });

  it('lets a judge declare conflicts for themselves only', async () => {
    const t = await newTeam();
    await denied(as(w.db, 'judgeV', (q) => q('insert into judge_conflicts(event_id, judge_id, team_id) values ($1, $2, $3)', [w.eventId, ids.judgeD, t])));
    await denied(as(w.db, 'outsider', (q) => q('insert into judge_conflicts(event_id, team_id) values ($1, $2)', [w.eventId, t])));
  });
});

describe('scores', () => {
  it('accepts 0 and the maximum, and updates an existing score', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    await setScore('judgeV', c.id, 'team-contribution', 0);
    await setScore('judgeV', c.id, 'team-contribution', 20);
    await setScore('judgeV', c.id, 'team-contribution', 11);
    const rows = (await w.db.query('select score from scorecard_scores where scorecard_id = $1', [c.id])).rows;
    expect(rows).toEqual([{ score: 11 }]);
  });

  it('rejects out-of-range, unknown-criterion and non-integer scores', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    await expect(setScore('judgeV', c.id, 'team-contribution', 21)).rejects.toThrow(/outside 0\.\.20/);
    await expect(setScore('judgeV', c.id, 'team-contribution', -1)).rejects.toThrow();
    await expect(setScore('judgeV', c.id, 'not-a-criterion', 5)).rejects.toThrow(/unknown criterion/);
    await expect(setScore('judgeV', c.id, 'team-contribution', '4.5')).rejects.toThrow();
  });

  it('uses the criterion own maximum for 15 and 10 point criteria', async () => {
    const t = await newTeam();
    await as(w.db, 'organiser', (q) =>
      q(`insert into event_roles(event_id, user_id, role, panel) values ($1, $2, 'judge', 'project_management')`, [w.eventId, ids.invitee]));
    const card = await makeCard('invitee', t, 'pm-initiating');
    await setScore('invitee', card.id, 'project-schedule', 15);
    await expect(setScore('invitee', card.id, 'project-schedule', 16)).rejects.toThrow(/outside 0\.\.15/);
  });
});

describe('submitting and locking', () => {
  it('refuses to submit until every criterion has a score', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    await setScore('judgeV', c.id, 'team-contribution', 12);
    await expect(submit('judgeV', c.id)).rejects.toThrow(/no score/);
    expect((await statusOf(c.id)).status).toBe('draft');
  });

  it('submits a complete card, stamps the time and audits the change', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    await fill('judgeV', c.id);
    expect((await submit('judgeV', c.id)).rows).toHaveLength(1);
    const row = (await w.db.query<{ status: string; submitted_at: string | null }>('select status, submitted_at from scorecards where id = $1', [c.id])).rows[0];
    expect(row.status).toBe('submitted');
    expect(row.submitted_at).not.toBeNull();
    const audit = await as(w.db, 'chair', async (q) => (await q(`select action from audit_log where entity = 'scorecards' and entity_id = $1`, [c.id])).rows);
    expect(audit).toContainEqual({ action: 'update' });
  });

  it('locks a submitted card against edits, deletion, new scores and a second submit', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    await fill('judgeV', c.id);
    await submit('judgeV', c.id);
    await denied(setScore('judgeV', c.id, 'team-contribution', 3));
    await denied(as(w.db, 'judgeV', (q) => q('delete from scorecard_scores where scorecard_id = $1', [c.id])));
    await denied(as(w.db, 'judgeV', (q) => q('delete from scorecards where id = $1', [c.id])));
    await denied(as(w.db, 'judgeV', (q) => q(`update scorecards set status = 'draft' where id = $1`, [c.id])));
    await denied(submit('judgeV', c.id));
    const scores = (await w.db.query('select criterion_id, score from scorecard_scores where scorecard_id = $1 order by criterion_id', [c.id])).rows;
    expect(scores).toEqual([{ criterion_id: 'engagement-presentation-dynamics', score: 14 }, { criterion_id: 'team-contribution', score: 12 }]);
  });

  it('lets a judge delete their own draft card', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    const r = await as(w.db, 'judgeV', (q) => q('delete from scorecards where id = $1 returning id', [c.id]));
    expect(r.rows).toHaveLength(1);
  });

  it('does not let a judge move a card to another team or judge', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    await expect(as(w.db, 'judgeV', (q) => q('update scorecards set team_id = $2 where id = $1', [c.id, w.team1]))).rejects.toThrow(/identity/);
  });
});

describe('reopening', () => {
  it('lets only the Chair reopen, with a reason, and records it', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    await fill('judgeV', c.id);
    await submit('judgeV', c.id);
    for (const who of ['judgeV', 'organiser', 'leadV'] as const) {
      await expect(as(w.db, who, (q) => q('select reopen_scorecard($1, $2)', [c.id, 'please']))).rejects.toThrow(/Chair/);
    }
    await expect(as(w.db, 'chair', (q) => q('select reopen_scorecard($1, $2)', [c.id, ' ']))).rejects.toThrow(/reason/);
    await as(w.db, 'chair', (q) => q('select reopen_scorecard($1, $2)', [c.id, 'Judge asked to correct a typo']));
    expect(await statusOf(c.id)).toEqual({ status: 'draft', reopened_count: 1 });
    const audit = await as(w.db, 'chair', async (q) => (await q(`select detail from audit_log where action = 'reopen' and entity_id = $1`, [c.id])).rows);
    expect(audit[0].detail.reason).toBe('Judge asked to correct a typo');
    await setScore('judgeV', c.id, 'team-contribution', 15);
    await submit('judgeV', c.id);
    expect((await statusOf(c.id)).status).toBe('submitted');
  });

  it('cannot be forced by a direct status update, even by the Chair', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    await fill('judgeV', c.id);
    await submit('judgeV', c.id);
    await denied(as(w.db, 'chair', (q) => q(`update scorecards set status = 'draft' where id = $1`, [c.id])));
    expect((await statusOf(c.id)).status).toBe('submitted');
  });
});

describe('who can read a scorecard', () => {
  it('shows a judge only their own cards, a lead judge their panel, and the Chair everything', async () => {
    const t = await newTeam();
    const mine = await makeCard('judgeV', t, 'verbal-technique');
    const design = await makeCard('judgeD', t, 'de-portfolio');
    const ids2 = (rows: { id: string }[]) => rows.map((r) => r.id);
    const sees = (who: Who | null) => as(w.db, who, async (q) => ids2((await q('select id from scorecards where team_id = $1', [t]).catch(() => ({ rows: [] }))).rows));
    expect(await sees('judgeV')).toEqual([mine.id]);
    expect(await sees('judgeD')).toEqual([design.id]);
    expect(await sees('leadV')).toEqual([mine.id]);
    expect((await sees('chair')).sort()).toEqual([mine.id, design.id].sort());
    expect((await sees('organiser')).sort()).toEqual([mine.id, design.id].sort());
    expect(await sees('outsider')).toEqual([]);
    expect(await sees('mgr1')).toEqual([]);
    expect(await sees(null)).toEqual([]);
  });

  it('lets a team manager read only their own team cards and scores, and only after release (submitted cards only)', async () => {
    const c = await makeCard('judgeV', w.team1, 'verbal-subject');
    const other = await makeCard('judgeV', w.team2, 'verbal-subject');
    await setScore('judgeV', c.id, 'innovation', 9);
    const crits = (await w.db.query<{ id: string }>(
      `select x ->> 'id' as id from events e, jsonb_array_elements(e.ruleset -> 'areas') a, jsonb_array_elements(a -> 'criteria') x
       where e.id = $1 and a ->> 'id' = 'verbal-subject'`, [w.eventId])).rows;
    for (const cr of crits) await setScore('judgeV', c.id, cr.id, 10);
    await setScore('judgeV', other.id, 'innovation', 8);
    await submit('judgeV', c.id);
    const read = () => as(w.db, 'mgr1', async (q) => ({
      cards: (await q('select id from scorecards where id = any($1)', [[c.id, other.id]])).rows,
      scores: (await q('select scorecard_id from scorecard_scores where scorecard_id = any($1)', [[c.id, other.id]])).rows,
    }));
    expect(await read()).toEqual({ cards: [], scores: [] });
    await w.db.query('update events set results_released = true where id = $1', [w.eventId]);
    try {
      const after = await read();
      expect(after.cards).toEqual([{ id: c.id }]);
      expect(after.scores).toEqual(crits.map(() => ({ scorecard_id: c.id })));
    } finally {
      await w.db.query('update events set results_released = false where id = $1', [w.eventId]);
    }
    expect(await read()).toEqual({ cards: [], scores: [] });
  });

  it('keeps one judge from reading or editing another judge scores', async () => {
    const t = await newTeam();
    const c = await makeCard('judgeV', t, 'verbal-technique');
    await setScore('judgeV', c.id, 'team-contribution', 10);
    const seen = await as(w.db, 'judgeD', async (q) => (await q('select score from scorecard_scores where scorecard_id = $1', [c.id])).rows);
    expect(seen).toEqual([]);
    await denied(setScore('judgeD', c.id, 'team-contribution', 1));
  });
});

describe('hardening', () => {
  it('keeps child rows on the same event through composite foreign keys', async () => {
    const other = (await w.db.query<{ id: string }>(`insert into events(name, ruleset, created_by) select 'Other2', ruleset, created_by from events where id = $1 returning id`, [w.eventId])).rows[0].id;
    // A card or conflict that pairs this event with a team of another event is refused even for the table owner.
    await expect(w.db.query(
      `insert into scorecards(event_id, team_id, area_id, panel, judge_id) values ($1, $2, 'verbal-technique', 'verbal', $3)`,
      [other, w.team1, ids.judgeV])).rejects.toThrow();
    await expect(w.db.query('insert into judge_conflicts(event_id, judge_id, team_id) values ($1, $2, $3)', [other, ids.judgeV, w.team1])).rejects.toThrow();
  });

  it('does not let a judge forge the reopen counter or submission time on a draft', async () => {
    const t = await newTeam();
    const forged = await as(w.db, 'judgeV', async (q) =>
      (await q(`insert into scorecards(event_id, team_id, area_id, reopened_count, submitted_at) values ($1, $2, 'verbal-technique', 7, now()) returning reopened_count, submitted_at`, [w.eventId, t])).rows[0]);
    expect(forged).toEqual({ reopened_count: 0, submitted_at: null });
    const c = await makeCard('judgeV', await newTeam(), 'verbal-subject');
    await as(w.db, 'judgeV', (q) => q('update scorecards set reopened_count = 9, submitted_at = now() where id = $1', [c.id]));
    expect(await statusOf(c.id)).toEqual({ status: 'draft', reopened_count: 0 });
    const at = (await w.db.query<{ submitted_at: string | null }>('select submitted_at from scorecards where id = $1', [c.id])).rows[0];
    expect(at.submitted_at).toBeNull();
  });

  it('refuses to move a score to another card (column privilege; the trigger is the backstop)', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    const d = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    await setScore('judgeV', c.id, 'team-contribution', 5);
    await expect(as(w.db, 'judgeV', (q) => q('update scorecard_scores set scorecard_id = $2 where scorecard_id = $1', [c.id, d.id]))).rejects.toThrow(/permission denied/);
  });

  it('stops scoring a draft once a conflict has been declared against its team', async () => {
    const t = await newTeam();
    const c = await makeCard('judgeV', t, 'verbal-technique');
    await as(w.db, 'judgeV', (q) => q('insert into judge_conflicts(event_id, team_id) values ($1, $2)', [w.eventId, t]));
    await denied(setScore('judgeV', c.id, 'team-contribution', 5));
  });

  it('refuses to reopen a card that is not submitted', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    await expect(as(w.db, 'chair', (q) => q('select reopen_scorecard($1, $2)', [c.id, 'not needed']))).rejects.toThrow(/not submitted/);
    expect((await statusOf(c.id)).reopened_count).toBe(0);
  });

  it('refuses to delete a submitted card even without row-level security', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    await fill('judgeV', c.id);
    await submit('judgeV', c.id);
    await expect(w.db.query('delete from scorecards where id = $1', [c.id])).rejects.toThrow(/submitted/);
  });

  it('does not expose internals, nor audit writes, to the API roles', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    for (const who of [null, 'judgeV'] as const) {
      await expect(as(w.db, who, (q) => q(`select area_def($1, 'verbal-technique')`, [w.eventId]))).rejects.toThrow(/permission denied/);
      await expect(as(w.db, who, (q) => q(`select audit_write($1, 'x', 'scorecards', $2, null)`, [w.eventId, c.id]))).rejects.toThrow(/permission denied/);
    }
    await expect(as(w.db, null, (q) => q('select reopen_scorecard($1, $2)', [c.id, 'anon attempt']))).rejects.toThrow(/permission denied/);
    const funcs = await w.db.query<{ proname: string; anon: boolean; auth: boolean; pub: boolean }>(
      `select p.proname,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub
       from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('area_def','is_conflicted','judges_panel_any','leads_panel_any','scorecards_fill','scorecards_guard','scorecards_delete_guard','scores_guard','scores_delete_guard','reopen_scorecard')`);
    expect(funcs.rows).toHaveLength(10);
    for (const f of funcs.rows) expect(f.pub, f.proname).toBe(false);
    const open = funcs.rows.filter((f) => f.anon || f.auth).map((f) => f.proname).sort();
    expect(open).toEqual(['is_conflicted', 'judges_panel_any', 'leads_panel_any', 'reopen_scorecard']);
    expect(funcs.rows.filter((f) => f.anon).map((f) => f.proname)).toEqual([]);
  });

  it('pins search_path on every new security definer function', async () => {
    const r = await w.db.query<{ proname: string; cfg: string[] | null }>(
      `select proname, proconfig as cfg from pg_proc where pronamespace = 'public'::regnamespace and prosecdef
         and proname in ('area_def','is_conflicted','judges_panel_any','leads_panel_any','scorecards_fill','scorecards_guard','scorecards_delete_guard','scores_guard','scores_delete_guard','reopen_scorecard')`);
    expect(r.rows).toHaveLength(10);
    for (const f of r.rows) expect(f.cfg, f.proname).toContain('search_path=public, pg_temp');
  });

  it('withholds truncate and unneeded writes from the API roles', async () => {
    const priv = async (role: string, table: string, p: string) =>
      (await w.db.query<{ ok: boolean }>('select has_table_privilege($1, $2, $3) as ok', [role, table, p])).rows[0].ok;
    for (const t of ['judge_conflicts', 'scorecards', 'scorecard_scores']) {
      for (const role of ['anon', 'authenticated']) {
        expect(await priv(role, t, 'truncate'), `${role} truncate ${t}`).toBe(false);
        expect(await priv(role, t, 'references'), `${role} references ${t}`).toBe(false);
        expect(await priv(role, t, 'trigger'), `${role} trigger ${t}`).toBe(false);
      }
      for (const p of ['select', 'insert', 'update', 'delete']) expect(await priv('anon', t, p), `anon ${p} ${t}`).toBe(false);
    }
    expect(await priv('authenticated', 'judge_conflicts', 'update')).toBe(false);
    await expect(as(w.db, 'chair', (q) => q('truncate scorecards'))).rejects.toThrow(/permission denied/);
  });
});


const setRelease = (v: boolean) => w.db.query('update events set results_released = $2 where id = $1', [w.eventId, v]);

describe('released results (review fixes)', () => {
  it('never shows a team manager a draft card or its scores, even after release', async () => {
    const draft = await makeCard('judgeV', w.team1, 'verbal-composition');
    await setScore('judgeV', draft.id, 'content-quality', 7);
    await setRelease(true);
    try {
      const seen = await as(w.db, 'mgr1', async (q) => ({
        cards: (await q('select id, judge_id from scorecards where id = $1', [draft.id])).rows,
        scores: (await q('select score from scorecard_scores where scorecard_id = $1', [draft.id])).rows,
        all: (await q(`select judge_id from scorecards where team_id = $1 and status = 'draft'`, [w.team1])).rows,
      }));
      expect(seen).toEqual({ cards: [], scores: [], all: [] });
    } finally {
      await setRelease(false);
    }
  });

  it('freezes judging on release: no new card, score change, submit or delete by a judge', async () => {
    const t = await newTeam();
    const draft = await makeCard('judgeV', t, 'verbal-technique');
    await setScore('judgeV', draft.id, 'team-contribution', 5);
    await fill('judgeV', draft.id);
    const submitted = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    await fill('judgeV', submitted.id);
    await submit('judgeV', submitted.id);
    await setRelease(true);
    try {
      await expect(makeCard('judgeV', await newTeam(), 'verbal-composition')).rejects.toThrow(/released/);
      await expect(setScore('judgeV', draft.id, 'team-contribution', 6)).rejects.toThrow(/released/);
      await expect(submit('judgeV', draft.id)).rejects.toThrow(/released/);
      await expect(as(w.db, 'judgeV', (q) => q('delete from scorecard_scores where scorecard_id = $1', [draft.id]))).rejects.toThrow(/released/);
      await expect(as(w.db, 'judgeV', (q) => q('delete from scorecards where id = $1', [draft.id]))).rejects.toThrow(/released/);
      expect((await statusOf(draft.id)).status).toBe('draft');
      await expect(as(w.db, 'chair', (q) => q('select reopen_scorecard($1, $2)', [submitted.id, 'too late']))).rejects.toThrow(/released/);
      expect((await statusOf(submitted.id)).status).toBe('submitted');
    } finally {
      await setRelease(false);
    }
    // Once the Chair withdraws the release, judging and reopening work again.
    await as(w.db, 'chair', (q) => q('select reopen_scorecard($1, $2)', [submitted.id, 'release withdrawn']));
    expect((await statusOf(submitted.id)).status).toBe('draft');
    await setScore('judgeV', draft.id, 'team-contribution', 6);
  });

  it('refuses deleting a score of a submitted card from the trigger itself (no row-level security)', async () => {
    const c = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    await fill('judgeV', c.id);
    await submit('judgeV', c.id);
    await expect(w.db.query('delete from scorecard_scores where scorecard_id = $1', [c.id])).rejects.toThrow(/submitted/);
    await expect(w.db.query(`update scorecard_scores set score = 1 where scorecard_id = $1`, [c.id])).rejects.toThrow(/submitted/);
    expect((await w.db.query('select 1 from scorecard_scores where scorecard_id = $1', [c.id])).rows).toHaveLength(2);
    // A draft card's score deletes fine, and deleting a draft card still cascades to its scores.
    const d = await makeCard('judgeV', await newTeam(), 'verbal-technique');
    await setScore('judgeV', d.id, 'team-contribution', 3);
    await w.db.query(`delete from scorecard_scores where scorecard_id = $1`, [d.id]);
    await setScore('judgeV', d.id, 'team-contribution', 3);
    await w.db.query(`delete from scorecards where id = $1`, [d.id]);
    expect((await w.db.query('select 1 from scorecard_scores where scorecard_id = $1', [d.id])).rows).toHaveLength(0);
  });
});
