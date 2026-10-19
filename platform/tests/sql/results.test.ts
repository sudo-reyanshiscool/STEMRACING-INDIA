import { beforeAll, describe, expect, it } from 'vitest';
import { INDIA_2026 } from '../../src/rulesets';
import { as, denied, ids, makeDb, seedWorld, type Who, type World } from './harness';

let w: World;
beforeAll(async () => {
  w = await seedWorld(await makeDb());
});

const HASH = 'a'.repeat(64);
const setOverride = (who: Who, team: string, area: string, value: number, reason = 'Cross-moderated by the Chair') =>
  as(w.db, who, (q) => q('insert into score_overrides(event_id, team_id, area_id, value, reason) values ($1, $2, $3, $4, $5) on conflict (event_id, team_id, area_id) do update set value = excluded.value, reason = excluded.reason returning value', [w.eventId, team, area, value, reason]));
const snapshot = (who: Who, released = true, hash = HASH) =>
  as(w.db, who, (q) => q('insert into ranking_snapshots(event_id, ruleset_id, input_hash, inputs, rows, released) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6) returning id', [w.eventId, 'india-national-finals-2026', hash, '{"cards":[]}', '[{"rank":1,"teamId":"t","total":1}]', released]));
// Releasing through release_results() needs a matching snapshot; these tests are about what release does, so set the flag as the superuser.
const release = (on: boolean) => w.db.query('update events set results_released = $2 where id = $1', [w.eventId, on]);

describe('score overrides', () => {
  it('lets the Chair set and change an override within the area maximum, with a reason', async () => {
    expect((await setOverride('chair', w.team1, 'de-portfolio', 150)).rows).toEqual([{ value: '150.0' }]);
    expect((await setOverride('chair', w.team1, 'de-portfolio', 151.5)).rows).toEqual([{ value: '151.5' }]);
    const rows = (await w.db.query('select set_by from score_overrides where team_id = $1', [w.team1])).rows;
    expect(rows).toHaveLength(1);
  });

  it('rejects values above the maximum, negatives, derived areas and thin reasons', async () => {
    await expect(setOverride('chair', w.team1, 'de-portfolio', 181)).rejects.toThrow(/exceeds/);
    await expect(setOverride('chair', w.team1, 'de-portfolio', -1)).rejects.toThrow();
    await expect(setOverride('chair', w.team1, 'knockout', 5)).rejects.toThrow(/scorecard areas only/);
    await expect(setOverride('chair', w.team1, 'pit-display', 10, 'x')).rejects.toThrow();
  });

  it('is refused for everyone but Chairs and Organisers, and read only by the Chair and Organiser', async () => {
    for (const who of ['judgeV', 'leadV', 'mgr1', 'outsider'] as const) {
      await denied(setOverride(who, w.team2, 'pit-display', 10));
    }
    await denied(as(w.db, null, (q) => q('insert into score_overrides(event_id, team_id, area_id, value, reason) values ($1, $2, $3, 10, $4)', [w.eventId, w.team2, 'pit-display', 'anonymous try'])));
    await setOverride('chair', w.team2, 'pit-display', 40);
    const read = (who: Who | null) => as(w.db, who, async (q) => (await q('select value from score_overrides').catch(() => ({ rows: [] }))).rows);
    expect((await read('organiser')).length).toBeGreaterThan(0);
    for (const who of ['judgeV', 'mgr1', 'outsider', null] as const) expect(await read(who), String(who)).toEqual([]);
  });

  it('audits changes', async () => {
    const rows = await as(w.db, 'chair', async (q) => (await q(`select action from audit_log where entity = 'score_overrides'`)).rows);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('penalties', () => {
  it('lets the Chair record and remove a penalty with a reason, and nobody else', async () => {
    const p = await as(w.db, 'chair', async (q) => (await q(`insert into penalties(event_id, team_id, points, reason) values ($1, $2, 15, 'Unsuccessful appeal') returning id, points`, [w.eventId, w.team1])).rows[0]);
    expect(p.points).toBe('15.0');
    await denied(as(w.db, 'judgeV', (q) => q(`insert into penalties(event_id, team_id, points, reason) values ($1, $2, 15, 'nope')`, [w.eventId, w.team1])));
    await denied(as(w.db, 'judgeV', (q) => q('delete from penalties where id = $1', [p.id])));
    await expect(as(w.db, 'chair', (q) => q(`insert into penalties(event_id, team_id, points, reason) values ($1, $2, 0, 'zero')`, [w.eventId, w.team1]))).rejects.toThrow();
    await expect(as(w.db, 'chair', (q) => q(`insert into penalties(event_id, team_id, points, reason) values ($1, $2, -5, 'negative')`, [w.eventId, w.team1]))).rejects.toThrow();
    await expect(as(w.db, 'chair', (q) => q(`insert into penalties(event_id, team_id, points, reason) values ($1, $2, 5, '')`, [w.eventId, w.team1]))).rejects.toThrow();
  });

  it('lets the Chair delete a penalty, audits the delete, and freezes it while results are released', async () => {
    const mk = () => as(w.db, 'chair', async (q) => (await q(`insert into penalties(event_id, team_id, points, reason) values ($1, $2, 5, 'Entered by mistake') returning id`, [w.eventId, w.team2])).rows[0].id as string);
    const id = await mk();
    await release(true);
    try {
      await expect(as(w.db, 'chair', (q) => q('delete from penalties where id = $1', [id]))).rejects.toThrow(/released/);
    } finally {
      await release(false);
    }
    const gone = await as(w.db, 'chair', async (q) => (await q('delete from penalties where id = $1 returning id', [id])).rows);
    expect(gone).toHaveLength(1);
    const audit = await as(w.db, 'chair', async (q) => (await q(`select action from audit_log where entity = 'penalties' and entity_id = $1`, [id])).rows.map((r: { action: string }) => r.action));
    expect(audit).toHaveLength(2);
    expect(audit.some((a: string) => /delete/i.test(a))).toBe(true);
  });

  it('shows a team manager only their own team penalties and only after release', async () => {
    const read = (who: Who) => as(w.db, who, async (q) => (await q('select team_id from penalties')).rows.map((r: { team_id: string }) => r.team_id));
    expect(await read('mgr1')).toEqual([]);
    await release(true);
    try {
      expect(await read('mgr1')).toEqual([w.team1]);
      expect(await read('mgr2')).toEqual([]);
    } finally {
      await release(false);
    }
    expect(await read('mgr1')).toEqual([]);
  });
});

describe('ranking snapshots', () => {
  it('can be inserted by Chairs and Organisers, with a well-formed hash', async () => {
    expect((await snapshot('chair')).rows).toHaveLength(1);
    expect((await snapshot('organiser')).rows).toHaveLength(1);
    await denied(snapshot('judgeV'));
    await denied(snapshot('mgr1'));
    await denied(as(w.db, null, (q) => q(`insert into ranking_snapshots(event_id, ruleset_id, input_hash, inputs, rows) values ($1, 'x', $2, '{}', '[]')`, [w.eventId, HASH])));
    await expect(snapshot('chair', true, 'not-a-hash')).rejects.toThrow();
  });

  it('is immutable: the Chair cannot change or delete one', async () => {
    const id = (await snapshot('chair')).rows[0].id;
    await denied(as(w.db, 'chair', (q) => q(`update ranking_snapshots set rows = '[]' where id = $1`, [id])));
    await denied(as(w.db, 'chair', (q) => q('delete from ranking_snapshots where id = $1', [id])));
    expect((await w.db.query<{ rows: unknown[] }>('select rows from ranking_snapshots where id = $1', [id])).rows[0].rows).toHaveLength(1);
  });

  it('keeps full snapshots private to event management before and after release', async () => {
    const shown = (await snapshot('chair', true)).rows[0].id;
    const publicIds = () => as(w.db, null, async (q) => (await q('select id from ranking_snapshots where event_id = $1', [w.eventId])).rows.map((r: { id: string }) => r.id));
    await expect(publicIds()).rejects.toThrow(/permission denied/);
    await release(true);
    try {
      await expect(publicIds()).rejects.toThrow(/permission denied/);
    } finally {
      await release(false);
    }
    await expect(publicIds()).rejects.toThrow(/permission denied/);
    const staff = await as(w.db, 'organiser', async (q) => (await q('select id from ranking_snapshots where event_id = $1', [w.eventId])).rows.map((r: { id: string }) => r.id));
    expect(staff).toContain(shown);
    const judge = await as(w.db, 'judgeV', async (q) => (await q('select id from ranking_snapshots')).rows);
    expect(judge).toEqual([]);
  });
});

describe('anonymous access', () => {
  it('cannot read scoring data, including released snapshots', async () => {
    for (const table of ['scorecards', 'scorecard_scores', 'score_overrides', 'penalties', 'event_roles', 'invitations', 'audit_log', 'judge_conflicts', 'ranking_snapshots']) {
      await expect(as(w.db, null, (q) => q(`select * from ${table}`)), table).rejects.toThrow(/permission denied/);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Hardening beyond the brief: freeze-on-release, pair integrity, immutability, privileges.
// ---------------------------------------------------------------------------------------------
const insertPenalty = (who: Who, team = w.team1, points = 5) =>
  as(w.db, who, (q) => q(`insert into penalties(event_id, team_id, points, reason) values ($1, $2, $3, 'Rule breach') returning id`, [w.eventId, team, points]));
const priv = async (role: string, table: string, p: string) =>
  (await w.db.query<{ ok: boolean }>('select has_table_privilege($1, $2, $3) as ok', [role, table, p])).rows[0].ok;
const NEW_TABLES = ['score_overrides', 'penalties', 'ranking_snapshots'];

describe('team and event stay consistent', () => {
  it('rejects an override or penalty whose team belongs to another event', async () => {
    const e2 = await as(w.db, 'invitee', async (q) =>
      (await q('select * from create_event($1, null, $2::jsonb)', ['Other event', JSON.stringify(INDIA_2026)])).rows[0]);
    const t2 = (await as(w.db, 'invitee', (q) => q(`insert into teams(event_id, number, name) values ($1, '9', 'Elsewhere') returning id`, [e2.id]))).rows[0].id;
    await expect(setOverride('chair', t2, 'pit-display', 10)).rejects.toThrow(/foreign key|violates/);
    await expect(insertPenalty('chair', t2)).rejects.toThrow(/foreign key|violates/);
    await expect(w.db.query(`insert into score_overrides(event_id, team_id, area_id, value, reason, set_by) values ($1, $2, 'pit-display', 1, 'abc', $3)`, [w.eventId, t2, ids.chair])).rejects.toThrow(/foreign key|violates/);
  });

  it('keeps an override identity fixed and the author unforgeable', async () => {
    await setOverride('chair', w.team1, 'pit-display', 20);
    await expect(as(w.db, 'chair', (q) => q(`update score_overrides set team_id = $1 where team_id = $2`, [w.team2, w.team1]))).rejects.toThrow(/permission denied/);
    await expect(as(w.db, 'chair', (q) => q(`update score_overrides set set_by = $1`, [ids.organiser]))).rejects.toThrow(/permission denied/);
    const forged = await as(w.db, 'chair', (q) =>
      q(`insert into score_overrides(event_id, team_id, area_id, value, reason, set_by) values ($1, $2, 'de-portfolio', 5, 'abc', $3) returning set_by`, [w.eventId, w.team2, ids.organiser]));
    expect(forged.rows[0].set_by).toBe(ids.chair);
    const pen = await as(w.db, 'chair', (q) =>
      q(`insert into penalties(event_id, team_id, points, reason, decided_by, created_at) values ($1, $2, 5, 'abc', $3, '2001-01-01') returning decided_by, created_at`, [w.eventId, w.team2, ids.organiser]));
    expect(pen.rows[0].decided_by).toBe(ids.chair);
    expect(new Date(pen.rows[0].created_at).getFullYear()).toBeGreaterThan(2020);
  });
});

describe('freeze on release', () => {
  it('refuses to change overrides and penalties while results are released, and allows it once withdrawn', async () => {
    const pid = (await insertPenalty('chair', w.team2, 7)).rows[0].id;
    await setOverride('chair', w.team1, 'pit-display', 21);
    await release(true);
    try {
      await expect(setOverride('chair', w.team1, 'pit-display', 30)).rejects.toThrow(/released/);
      await expect(setOverride('chair', w.team2, 'de-portfolio', 30)).rejects.toThrow(/released/);
      await expect(as(w.db, 'chair', (q) => q(`delete from score_overrides where team_id = $1`, [w.team1]))).rejects.toThrow(/released/);
      await expect(insertPenalty('chair', w.team1, 3)).rejects.toThrow(/released/);
      await expect(as(w.db, 'chair', (q) => q('delete from penalties where id = $1', [pid]))).rejects.toThrow(/released/);
      // Not even a privileged session can slip a change in around the policies.
      await expect(w.db.query(`update score_overrides set value = 1 where team_id = $1`, [w.team1])).rejects.toThrow(/released/);
      await expect(w.db.query('delete from penalties where id = $1', [pid])).rejects.toThrow(/released/);
    } finally {
      await release(false);
    }
    expect((await setOverride('chair', w.team1, 'pit-display', 22)).rows).toHaveLength(1);
    await as(w.db, 'chair', (q) => q('delete from penalties where id = $1', [pid]));
  });
});

describe('visibility before and after release', () => {
  it('never shows overrides or full snapshots to team members', async () => {
    await snapshot('chair', true);
    const ids_ = (who: Who | null) => as(w.db, who, async (q) => (await q('select id from ranking_snapshots')).rows.map((r: { id: string }) => r.id));
    const overrides = (who: Who) => as(w.db, who, async (q) => (await q('select 1 from score_overrides')).rows);
    for (const who of ['mgr1', 'mgr2', 'outsider', 'judgeV', 'leadV'] as const) expect(await ids_(who), who).toEqual([]);
    await release(true);
    try {
      for (const who of ['mgr1', 'outsider'] as const) expect(await ids_(who)).toEqual([]);
      await expect(ids_(null)).rejects.toThrow(/permission denied/);
      for (const who of ['mgr1', 'mgr2', 'judgeV', 'leadV'] as const) expect(await overrides(who), who).toEqual([]);
      const penalties = await as(w.db, 'mgr2', async (q) => (await q('select team_id from penalties')).rows);
      expect(penalties.every((p: { team_id: string }) => p.team_id === w.team2)).toBe(true);
    } finally {
      await release(false);
    }
  });
});

describe('snapshots are append-only for everybody', () => {
  it('refuses update, delete and truncate even from a privileged session', async () => {
    const id = (await snapshot('chair')).rows[0].id;
    await expect(w.db.query(`update ranking_snapshots set released = false where id = $1`, [id])).rejects.toThrow(/immutable/);
    await expect(w.db.query(`update ranking_snapshots set rows = '[]' where id = $1`, [id])).rejects.toThrow(/immutable/);
    await expect(w.db.query('delete from ranking_snapshots where id = $1', [id])).rejects.toThrow(/immutable/);
    await expect(w.db.query('truncate ranking_snapshots')).rejects.toThrow(/immutable/);
    await expect(w.db.query('truncate events cascade')).rejects.toThrow(/immutable/);
    await expect(as(w.db, 'chair', (q) => q('truncate ranking_snapshots'))).rejects.toThrow(/permission denied/);
  });

  it('fixes author and time on the server and checks shape and ruleset', async () => {
    const r = await as(w.db, 'chair', (q) =>
      q(`insert into ranking_snapshots(event_id, ruleset_id, input_hash, inputs, rows, created_by, created_at) values ($1, 'india-national-finals-2026', $2, '{}', '[]', $3, '2001-01-01') returning created_by, created_at`, [w.eventId, HASH, ids.organiser]));
    expect(r.rows[0].created_by).toBe(ids.chair);
    expect(new Date(r.rows[0].created_at).getFullYear()).toBeGreaterThan(2020);
    await expect(as(w.db, 'chair', (q) => q(`insert into ranking_snapshots(event_id, ruleset_id, input_hash, inputs, rows) values ($1, 'some-other-ruleset', $2, '{}', '[]')`, [w.eventId, HASH]))).rejects.toThrow(/ruleset/);
    await expect(as(w.db, 'chair', (q) => q(`insert into ranking_snapshots(event_id, ruleset_id, input_hash, inputs, rows) values ($1, 'india-national-finals-2026', $2, '{}', '{}')`, [w.eventId, HASH]))).rejects.toThrow();
    await expect(as(w.db, 'chair', (q) => q(`insert into ranking_snapshots(event_id, ruleset_id, input_hash, inputs, rows) values ($1, 'india-national-finals-2026', $2, '[]', '[]')`, [w.eventId, HASH]))).rejects.toThrow();
  });
});

describe('privileges of the new objects', () => {
  it('grants anon read on event metadata and teams only, and no table-level extras to anyone', async () => {
    const tables = (await w.db.query<{ t: string }>(`select tablename as t from pg_tables where schemaname = 'public'`)).rows.map((r) => r.t);
    expect(tables).toEqual(expect.arrayContaining(NEW_TABLES));
    for (const t of tables) {
      for (const p of ['insert', 'update', 'delete', 'truncate', 'references', 'trigger']) expect(await priv('anon', t, p), `anon ${p} ${t}`).toBe(false);
      // events is readable by column since 0004 (created_by is not public), so only teams has a table-level grant.
      expect(await priv('anon', t, 'select'), `anon select ${t}`).toBe(t === 'teams');
      for (const p of ['truncate', 'references', 'trigger']) expect(await priv('authenticated', t, p), `authenticated ${p} ${t}`).toBe(false);
    }
    for (const p of ['update', 'delete', 'truncate']) expect(await priv('authenticated', 'ranking_snapshots', p), p).toBe(false);
    const col = async (role: string, c: string) =>
      (await w.db.query<{ ok: boolean }>(`select has_column_privilege($1, 'ranking_snapshots', $2, 'select') as ok`, [role, c])).rows[0].ok;
    for (const role of ['anon', 'authenticated']) {
      expect(await col(role, 'rows'), `${role} rows`).toBe(role === 'authenticated');
      expect(await col(role, 'inputs'), `${role} inputs`).toBe(false);
    }
    expect(await priv('authenticated', 'penalties', 'update')).toBe(false);
  });

  it('keeps the API roles away from sequences, so the audit id cannot be poisoned', async () => {
    await expect(as(w.db, 'chair', (q) => q(`select setval('audit_log_id_seq', 1000000)`))).rejects.toThrow(/permission denied/);
    await expect(as(w.db, 'chair', (q) => q(`select nextval('audit_log_id_seq')`))).rejects.toThrow(/permission denied/);
  });

  it('does not expose the new trigger functions and pins search_path', async () => {
    const names = ['overrides_guard', 'penalties_guard', 'snapshots_guard', 'snapshots_immutable'];
    const r = await w.db.query<{ proname: string; anon: boolean; auth: boolean; pub: boolean; cfg: string[] | null; def: boolean }>(
      `select p.proname, p.prosecdef as def, p.proconfig as cfg,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [names]);
    expect(r.rows).toHaveLength(names.length);
    for (const f of r.rows) {
      expect([f.pub, f.anon, f.auth], f.proname).toEqual([false, false, false]);
      if (f.def) expect(f.cfg, f.proname).toContain('search_path=public, pg_temp');
    }
    // Across the whole schema: nothing is executable by PUBLIC or anon except policy helpers and the scoped, token-authenticated device ingest.
    const exposed = await w.db.query<{ proname: string }>(
      `select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace
         and (has_function_privilege('anon', p.oid, 'execute')
              or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
       order by 1`);
    expect(exposed.rows.map((x) => x.proname)).toEqual(
      ['event_active', 'event_released', 'has_role', 'ingest_denford', 'is_chair_or_organiser', 'is_member', 'judges_panel', 'leads_panel', 'manages_team', 'public_standings', 'sees_all_teams']);
  });
});

describe('snapshot inputs are not public', () => {
  const COLS = 'id, event_id, created_by, created_at, ruleset_id, input_hash, rows, released';
  it('denies snapshot inputs to every API role and limits full rows to event management', async () => {
    const id = (await snapshot('chair', true)).rows[0].id;
    await release(true);
    try {
      for (const who of [null, 'judgeV', 'mgr1', 'outsider', 'organiser', 'chair'] as const) {
        await expect(as(w.db, who, (q) => q('select inputs from ranking_snapshots where id = $1', [id])), String(who)).rejects.toThrow(/permission denied/);
        await expect(as(w.db, who, (q) => q('select * from ranking_snapshots')), `* ${who}`).rejects.toThrow(/permission denied/);
      }
      await expect(as(w.db, null, (q) => q(`select rows, input_hash from ranking_snapshots where id = $1`, [id]))).rejects.toThrow(/permission denied/);
      const cols = await as(w.db, 'mgr1', async (q) => (await q(`select ${COLS} from ranking_snapshots where id = $1`, [id])).rows);
      expect(cols).toHaveLength(0);
      const staff = await as(w.db, 'chair', q => q(`select ${COLS} from ranking_snapshots where id = $1`, [id]));
      expect(staff.rows).toHaveLength(1);
    } finally {
      await release(false);
    }
  });

  it('serves inputs only to the Chair and Organiser through snapshot_inputs()', async () => {
    const id = (await snapshot('chair', true)).rows[0].id;
    const get = (who: Who | null) => as(w.db, who, async (q) => (await q('select snapshot_inputs($1) as i', [id])).rows[0].i);
    expect(await get('chair')).toEqual({ cards: [] });
    expect(await get('organiser')).toEqual({ cards: [] });
    for (const who of ['judgeV', 'leadV', 'mgr1', 'outsider'] as const) await expect(get(who), who).rejects.toThrow(/restricted|permission/);
    await expect(get(null)).rejects.toThrow(/permission denied/);
    await release(true);
    try {
      await expect(get('mgr1')).rejects.toThrow(/restricted/);
    } finally {
      await release(false);
    }
    const f = await w.db.query<{ anon: boolean; pub: boolean; def: boolean; cfg: string[] }>(
      `select has_function_privilege('anon', p.oid, 'execute') as anon, prosecdef as def, proconfig as cfg,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub
       from pg_proc p where proname = 'snapshot_inputs'`);
    expect(f.rows[0]).toMatchObject({ anon: false, pub: false, def: true });
    expect(f.rows[0].cfg).toContain('search_path=public, pg_temp');
  });
});

describe('override NaN', () => {
  it('rejects NaN values', async () => {
    await expect(setOverride('chair', w.team1, 'pit-display', NaN)).rejects.toThrow();
    expect((await w.db.query(`select 1 from pg_constraint where conrelid = 'score_overrides'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%NaN%'`)).rows).toHaveLength(1);
    await expect(w.db.query(`insert into score_overrides(event_id, team_id, area_id, value, reason, set_by) values ($1, $2, 'pit-display', 'NaN', 'abc', $3)`, [w.eventId, w.team2, ids.chair])).rejects.toThrow(/check|NaN|violates/);
  });
});
