import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api';
import { createApiFromClient } from '../../src/api/supabase';

type Step = [string, ...unknown[]];
interface Call { kind: 'from' | 'rpc'; name: string; args?: unknown; steps: Step[] }
interface Res { data?: unknown; error?: { message: string; code?: string } | null }

/** A scripted stand-in for supabase-js: records each query chain and answers it from `handler`. */
function fake(handler: (c: Call) => Res | Promise<Res>, user: { id: string; email: string } | null = { id: 'me', email: 'Me@X.test' }) {
  const calls: Call[] = [];
  const chain = (call: Call) => {
    const p: unknown = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
            calls.push(call);
            Promise.resolve().then(() => handler(call)).then((r) => ({ data: r.data ?? null, error: r.error ?? null })).then(resolve, reject);
          };
        }
        return (...args: unknown[]) => { call.steps.push([String(prop), ...args]); return p; };
      },
    });
    return p;
  };
  const sb = {
    from: (name: string) => chain({ kind: 'from', name, steps: [] }),
    rpc: (name: string, args?: unknown) => chain({ kind: 'rpc', name, args, steps: [] }),
    auth: {
      getSession: async () => ({ data: { session: user ? { user } : null }, error: null }),
    },
  } as unknown as SupabaseClient;
  return { api: createApiFromClient(sb), calls };
}
const arg = (c: Call, method: string, i = 0) => c.steps.find((s) => s[0] === method)?.[i + 1];
const has = (c: Call, method: string) => c.steps.some((s) => s[0] === method);
const fail = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { if (e instanceof ApiError) return e.code; throw e; }
  return 'ok';
};

describe('ranking snapshots', () => {
  it('never selects * and never asks for inputs back', async () => {
    const { api, calls } = fake(() => ({ data: [] }));
    await api.latestSnapshot('e');
    const sel = String(arg(calls[0], 'select'));
    expect(sel).not.toContain('*');
    expect(sel.split(',')).not.toContain('inputs');
    expect(sel.split(',')).toEqual(expect.arrayContaining(['id', 'event_id', 'created_at', 'ruleset_id', 'input_hash', 'rows', 'released']));
  });

  it('inserts inputs but returns only the readable columns', async () => {
    const row = { id: 's', event_id: 'e', created_at: 't', ruleset_id: 'r', input_hash: 'h', rows: [], released: true };
    const { api, calls } = fake(() => ({ data: row }));
    const out = await api.publishSnapshot('e', { rulesetId: 'r', inputHash: 'h', inputs: { cards: [] }, rows: [] });
    expect(out).toEqual({ id: 's', eventId: 'e', createdAt: 't', rulesetId: 'r', inputHash: 'h', rows: [], released: true });
    expect(calls[0].name).toBe('ranking_snapshots');
    expect(arg(calls[0], 'insert')).toEqual({ event_id: 'e', ruleset_id: 'r', input_hash: 'h', inputs: { cards: [] }, rows: [], released: true });
    const sel = String(arg(calls[0], 'select'));
    expect(sel).not.toContain('*');
    expect(sel.split(',')).not.toContain('inputs');
  });

  it('reads inputs only through the snapshot_inputs function', async () => {
    const { api, calls } = fake(() => ({ data: { cards: [1] } }));
    expect(await api.getSnapshotInputs('s1')).toEqual({ cards: [1] });
    expect(calls[0]).toMatchObject({ kind: 'rpc', name: 'snapshot_inputs', args: { p_snapshot: 's1' } });
  });

  it('reports a refused inputs read as forbidden', async () => {
    const { api } = fake(() => ({ error: { message: 'snapshot inputs are restricted', code: '42501' } }));
    expect(await fail(api.getSnapshotInputs('s1'))).toBe('forbidden');
  });
});

describe('saveScore', () => {
  it('leaves the comment column out when no comment is passed', async () => {
    const { api, calls } = fake(() => ({ data: [{ criterion_id: 'c' }] }));
    await api.saveScore('card', 'c', 12);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('scorecard_scores');
    expect(arg(calls[0], 'update')).toEqual({ score: 12 });
  });

  it('sets the comment when a string is passed, including the empty string', async () => {
    const a = fake(() => ({ data: [{ criterion_id: 'c' }] }));
    await a.api.saveScore('card', 'c', 12, 'Clear roles');
    expect(arg(a.calls[0], 'update')).toEqual({ score: 12, comment: 'Clear roles' });
    const b = fake(() => ({ data: [{ criterion_id: 'c' }] }));
    await b.api.saveScore('card', 'c', 12, '');
    expect(arg(b.calls[0], 'update')).toEqual({ score: 12, comment: '' });
  });

  it('inserts a new score row when none exists, again omitting an unset comment', async () => {
    const { api, calls } = fake((c) => (has(c, 'update') ? { data: [] } : { data: null }));
    await api.saveScore('card', 'c', 9);
    expect(calls.map((c) => ['update', 'insert'].find((m) => has(c, m)))).toEqual(['update', 'insert']);
    expect(arg(calls[1], 'insert')).toEqual({ scorecard_id: 'card', criterion_id: 'c', score: 9 });
  });

  it('retries the update when a concurrent insert wins the race', async () => {
    let updates = 0;
    const { api, calls } = fake((c) => {
      if (has(c, 'update')) return { data: ++updates === 1 ? [] : [{ criterion_id: 'c' }] };
      return { error: { message: 'duplicate key', code: '23505' } };
    });
    await api.saveScore('card', 'c', 9, 'x');
    expect(calls).toHaveLength(3);
  });

  it('maps a locked card and an out-of-range score', async () => {
    const locked = fake(() => ({ error: { message: 'scorecard is submitted and locked', code: '55000' } }));
    expect(await fail(locked.api.saveScore('card', 'c', 1))).toBe('locked');
    const range = fake(() => ({ error: { message: 'score 99 is outside 0..15', code: '23514' } }));
    expect(await fail(range.api.saveScore('card', 'c', 99))).toBe('invalid');
  });
});

describe('overrides', () => {
  it('updates value and reason only, then inserts when the row is new', async () => {
    const { api, calls } = fake((c) => (has(c, 'update') ? { data: [] } : { data: null }));
    await api.setOverride('e', 't', 'a', 12.5, '  because ');
    expect(arg(calls[0], 'update')).toEqual({ value: 12.5, reason: 'because' });
    expect(arg(calls[1], 'insert')).toEqual({ event_id: 'e', team_id: 't', area_id: 'a', value: 12.5, reason: 'because' });
  });
});

describe('cards', () => {
  it('submitting a card nobody can update is locked for your own card, forbidden otherwise', async () => {
    const own = fake((c) => (has(c, 'update') ? { data: [] } : { data: { id: 'c', status: 'submitted', judge_id: 'me' } }));
    expect(await fail(own.api.submitCard('c'))).toBe('locked');
    const other = fake((c) => (has(c, 'update') ? { data: [] } : { data: { id: 'c', status: 'draft', judge_id: 'someone' } }));
    expect(await fail(other.api.submitCard('c'))).toBe('forbidden');
    const hidden = fake((c) => (has(c, 'update') ? { data: [] } : { data: null }));
    expect(await fail(hidden.api.submitCard('c'))).toBe('forbidden');
  });

  it('maps an incomplete card on submit to invalid and keeps the message', async () => {
    const { api } = fake(() => ({ error: { message: 'criterion Team Contribution has no score', code: '23514' } }));
    await expect(api.submitCard('c')).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('no score') });
  });

  it('lists cards with their nested scores', async () => {
    const { api, calls } = fake(() => ({
      data: [{ id: 'c', event_id: 'e', team_id: 't', area_id: 'a', panel: 'verbal', judge_id: 'me', status: 'draft', reopened_count: 0,
        scorecard_scores: [{ criterion_id: 'x', score: 3, comment: 'ok' }] }],
    }));
    const [card] = await api.listCards('e');
    expect(card.scores).toEqual({ x: 3 });
    expect(String(arg(calls[0], 'select'))).toContain('scorecard_scores(criterion_id,score,comment)');
  });

  it('reopens through the reopen_scorecard function', async () => {
    const { api, calls } = fake(() => ({ data: null }));
    await api.reopenCard('c', 'recheck');
    expect(calls[0]).toMatchObject({ kind: 'rpc', name: 'reopen_scorecard', args: { p_card: 'c', p_reason: 'recheck' } });
  });
});

describe('events and invitations', () => {
  const ev = { id: 'e', name: 'N', starts_on: null, ruleset: { id: 'r' }, results_released: false };
  it('creates an event through create_event and accepts an array result', async () => {
    const a = fake(() => ({ data: ev }));
    expect((await a.api.createEvent({ name: 'N' })).id).toBe('e');
    expect(a.calls[0]).toMatchObject({ kind: 'rpc', name: 'create_event' });
    expect(a.calls[0].args).toMatchObject({ p_name: 'N', p_starts_on: null });
    const b = fake(() => ({ data: [ev] }));
    expect((await b.api.createEvent({ name: 'N' })).id).toBe('e');
  });

  it('claims invitations through the rpc, and does not call it when signed out', async () => {
    const a = fake(() => ({ data: 2 }));
    expect(await a.api.claimInvitations()).toBe(2);
    expect(a.calls[0]).toMatchObject({ kind: 'rpc', name: 'claim_invitations' });
    const out = fake(() => ({ data: 5 }), null);
    expect(await out.api.claimInvitations()).toBe(0);
    expect(out.calls).toHaveLength(0);
  });

  it('answers signed-out reads of signed-in-only tables with nothing, without querying', async () => {
    const { api, calls } = fake(() => ({ data: [] }), null);
    expect(await api.myRoles('e')).toEqual([]);
    expect(await api.listRoles('e')).toEqual([]);
    expect(await api.listInvitations('e')).toEqual([]);
    expect(await api.listCards('e')).toEqual([]);
    expect(await api.listOverrides('e')).toEqual([]);
    expect(await api.listPenalties('e')).toEqual([]);
    expect(await api.myConflicts('e')).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('declaring a conflict twice is not an error', async () => {
    const { api } = fake(() => ({ error: { message: 'duplicate', code: '23505' } }));
    await expect(api.declareConflict('e', 't')).resolves.toBeUndefined();
  });

  it('releasing results with no row updated is forbidden', async () => {
    const { api } = fake(() => ({ data: [] }));
    expect(await fail(api.setReleased('e', true))).toBe('forbidden');
  });

  it('turns a thrown network failure into a network error', async () => {
    const { api } = fake(() => { throw new TypeError('Failed to fetch'); });
    expect(await fail(api.listEvents())).toBe('network');
  });

  it('reads teams in natural number order', async () => {
    const rows = ['10', '2', '1'].map((n) => ({ id: n, event_id: 'e', number: n, name: n, school: '' }));
    const { api } = fake(() => ({ data: rows }));
    expect((await api.listTeams('e')).map((t) => t.number)).toEqual(['1', '2', '10']);
  });
});
