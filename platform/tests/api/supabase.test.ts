import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api';
import { createApiFromClient } from '../../src/api/supabase';

type Step = [string, ...unknown[]];
interface Call { kind: 'from' | 'rpc' | 'function' | 'auth'; name: string; args?: unknown; steps: Step[] }
interface Res { data?: unknown; error?: { message: string; code?: string } | null }

/** A scripted stand-in for supabase-js: records each query chain and answers it from `handler`. */
function fake(handler: (c: Call) => Res | Promise<Res>, user: { id: string; email: string } | null = { id: 'me', email: 'Me@X.test' }, getSession?: (n: number) => Promise<unknown>, pageSize?: number) {
  let sessionCalls = 0;
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
    functions: { invoke: async (name: string, args: unknown) => { const call: Call = {kind:'function',name,args,steps:[]}; calls.push(call); return handler(call); } },
    auth: {
      verifyOtp: async (args: unknown) => { const call: Call = {kind:'auth',name:'verifyOtp',args,steps:[]}; calls.push(call); return handler(call); },
      getSession: async () => (getSession ? getSession(++sessionCalls) : { data: { session: user ? { user } : null }, error: null }),
    },
  } as unknown as SupabaseClient;
  return { api: createApiFromClient(sb, pageSize === undefined ? undefined : { pageSize }), calls };
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
    expect(arg(calls[0], 'insert')).toEqual({ event_id: 'e', ruleset_id: 'r', input_hash: 'h', inputs: { cards: [] }, rows: [] });
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

  it('releases and withdraws through the server functions, never by updating the column', async () => {
    const rel = fake(() => ({ data: null }));
    await rel.api.setReleased('e', true);
    expect(rel.calls[0]).toMatchObject({ kind: 'rpc', name: 'release_results', args: { p_event: 'e' } });
    const wd = fake(() => ({ data: null }));
    await wd.api.setReleased('e', false);
    expect(wd.calls[0]).toMatchObject({ kind: 'rpc', name: 'withdraw_results', args: { p_event: 'e' } });
  });

  it('maps a refused release: not the Chair is forbidden, an out-of-date ranking is locked with fixed text', async () => {
    const no = fake(() => ({ error: { message: 'only the Chair can release results', code: '42501' } }));
    expect(await fail(no.api.setReleased('e', true))).toBe('forbidden');
    const old = fake(() => ({ error: { message: 'the published ranking is out of date; publish it again before releasing', code: '55000' } }));
    try { await old.api.setReleased('e', true); throw new Error('expected a refusal'); } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe('locked');
      expect((e as ApiError).message).toBe('The published ranking is out of date. Publish it again before releasing.');
    }
    const none = fake(() => ({ error: { message: 'publish a ranking before releasing it', code: '55000' } }));
    expect(await fail(none.api.setReleased('e', true))).toBe('locked');
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

describe('signed-out scoring', () => {
  it('reports a score write with no session as unauthenticated, not forbidden', async () => {
    const { api } = fake(() => ({ error: { message: 'new row violates row-level security policy', code: '42501' } }), null);
    expect(await fail(api.saveScore('c', 'k', 5))).toBe('unauthenticated');
  });
  it('reports an expired token as unauthenticated', async () => {
    const { api } = fake(() => ({ error: { message: 'JWT expired', code: 'PGRST301' } }));
    expect(await fail(api.saveScore('c', 'k', 5))).toBe('unauthenticated');
  });
  it('rethrows a failing session re-check (retryable) instead of the forbidden that would be dropped', async () => {
    const { api } = fake(
      () => ({ error: { message: 'new row violates row-level security policy', code: '42501' } }),
      null,
      async () => { throw new TypeError('Failed to fetch'); },
    );
    expect(await fail(api.saveScore('c', 'k', 5))).toBe('network');
  });

  it('still reports a refused write with a live session as forbidden', async () => {
    const { api } = fake(() => ({ error: { message: 'new row violates row-level security policy', code: '42501' } }));
    expect(await fail(api.saveScore('c', 'k', 5))).toBe('forbidden');
  });
});

describe('removePenalty', () => {
  it('deletes the penalty by id, and reports a missing row as forbidden and a freeze as locked', async () => {
    const ok = fake(() => ({ data: [{ id: 'p' }] }));
    await ok.api.removePenalty('p');
    expect(ok.calls[0].name).toBe('penalties');
    expect(has(ok.calls[0], 'delete')).toBe(true);
    expect(ok.calls[0].steps.find((s) => s[0] === 'eq')).toEqual(['eq', 'id', 'p']);
    expect(await fail(fake(() => ({ data: [] })).api.removePenalty('p'))).toBe('forbidden');
    expect(await fail(fake(() => ({ error: { message: 'results are released', code: '55000' } })).api.removePenalty('p'))).toBe('locked');
  });
});

describe('paging (PostgREST max_rows cuts a list off silently)', () => {
  const range = (c: Call) => c.steps.find((s) => s[0] === 'range') as [string, number, number] | undefined;
  /** Serves `rows` the way PostgREST does: whatever the requested range covers. */
  const serve = (rows: unknown[]) => (c: Call): Res => {
    const r = range(c);
    return { data: r ? rows.slice(r[1], r[2] + 1) : rows };
  };
  const team = (n: number) => ({ id: `t${n}`, event_id: 'e', number: String(n), name: `T${n}`, school: '' });
  const lists: Array<[string, (a: ReturnType<typeof fake>['api']) => Promise<unknown[]>, (n: number) => unknown]> = [
    ['listTeams', (a) => a.listTeams('e'), team],
    ['listCards', (a) => a.listCards('e'), (n) => ({ id: `c${n}`, event_id: 'e', team_id: 't', area_id: 'a', panel: 'verbal', judge_id: 'j', status: 'draft', reopened_count: 0, scorecard_scores: [] })],
    ['listOverrides', (a) => a.listOverrides('e'), (n) => ({ event_id: 'e', team_id: `t${n}`, area_id: 'pit-display', value: 1, reason: 'abc' })],
    ['listPenalties', (a) => a.listPenalties('e'), (n) => ({ id: `p${n}`, event_id: 'e', team_id: 't', points: 1, reason: 'abc' })],
    ['listRoles', (a) => a.listRoles('e'), (n) => ({ id: `r${n}`, event_id: 'e', user_id: `u${n}`, role: 'judge', panel: 'verbal', team_id: null, email: null })],
    ['listInvitations', (a) => a.listInvitations('e'), (n) => ({ id: `i${n}`, event_id: 'e', email: `a${n}@x.test`, role: 'judge', panel: 'verbal', team_id: null })],
    ['listEvents', (a) => a.listEvents(), (n) => ({ id: `e${n}`, name: 'E', starts_on: null, ruleset: {}, results_released: false })],
    ['listConflicts', (a) => a.listConflicts('e'), (n) => ({ event_id: 'e', judge_id: `j${n}`, team_id: 't' })],
    ['myConflicts', (a) => a.myConflicts('e'), (n) => ({ team_id: `t${n}` })],
  ];
  for (const [name, call, make] of lists) {
    it(`${name} reads every page, in a stable order, until a short page`, async () => {
      const rows = Array.from({ length: 7 }, (_, i) => make(i));
      const { api, calls } = fake(serve(rows), undefined, undefined, 3);
      const out = await call(api);
      expect(out).toHaveLength(7);
      expect(calls.map((c) => range(c)!.slice(1))).toEqual([[0, 2], [3, 5], [6, 8]]);
      for (const c of calls) expect(has(c, 'order'), 'ordered').toBe(true);
    });
  }

  it('stops after a full last page with one more (empty) request, and after a single short page with no more', async () => {
    const full = fake(serve(Array.from({ length: 6 }, (_, i) => team(i))), undefined, undefined, 3);
    expect(await full.api.listTeams('e')).toHaveLength(6);
    expect(full.calls).toHaveLength(3);
    const short = fake(serve([team(1)]), undefined, undefined, 3);
    expect(await short.api.listTeams('e')).toHaveLength(1);
    expect(short.calls).toHaveLength(1);
  });

  it('fails the whole list if any page fails', async () => {
    let n = 0;
    const { api } = fake(() => (++n === 2 ? { error: { message: 'boom', code: '57014' } } : { data: Array.from({ length: 3 }, (_, i) => team(i)) }), undefined, undefined, 3);
    expect(await fail(api.listTeams('e'))).toBe('unknown');
  });
});

describe('removeOverride', () => {
  it('deletes by the override key and reports nothing deleted as forbidden', async () => {
    const ok = fake(() => ({ data: [{ team_id: 't' }] }));
    await ok.api.removeOverride('e', 't', 'pit-display');
    expect(ok.calls[0].name).toBe('score_overrides');
    expect(has(ok.calls[0], 'delete')).toBe(true);
    expect(ok.calls[0].steps.filter((s) => s[0] === 'eq').map((s) => [s[1], s[2]])).toEqual([['event_id', 'e'], ['team_id', 't'], ['area_id', 'pit-display']]);
    const none = fake(() => ({ data: [] }));
    expect(await fail(none.api.removeOverride('e', 't', 'pit-display'))).toBe('forbidden');
    const locked = fake(() => ({ error: { message: 'results are released', code: '55000' } }));
    expect(await fail(locked.api.removeOverride('e', 't', 'pit-display'))).toBe('locked');
  });
});

describe('getEvent with ids that are not UUIDs', () => {
  const ID = '123e4567-e89b-42d3-a456-426614174000';
  it('answers null without a request for a link that is not a UUID', async () => {
    const { api, calls } = fake(() => ({ data: { id: 'x' } }));
    for (const bad of ['', 'event-1', 'nope', '123', "' or 1=1 --", ID + 'x', '../etc']) expect(await api.getEvent(bad), bad).toBeNull();
    expect(calls).toHaveLength(0);
  });
  it('still asks for a real UUID', async () => {
    const { api, calls } = fake(() => ({ data: { id: ID, name: 'N', starts_on: null, ruleset: { id: 'r' }, results_released: false } }));
    expect((await api.getEvent(ID.toUpperCase()))?.id).toBe(ID);
    expect(calls).toHaveLength(1);
  });
});

describe('feedback and private review adapter', () => {
  it('reads the two visibility domains separately and defaults private fields when RLS hides them', async () => {
    const {api,calls}=fake((c)=>({data:c.name==='scorecard_feedback'?{overall:'Good presentation',strengths:'Teamwork',improvements:''}:null}));
    expect(await api.getReview('c')).toEqual({overall:'Good presentation',strengths:'Teamwork',improvements:'',criterionNotes:{},internalNotes:'',nominations:[]});
    expect(calls.map((c)=>c.name).sort()).toEqual(['scorecard_feedback','scorecard_private_reviews']);
    expect(String(arg(calls.find((c)=>c.name==='scorecard_feedback')!,'select'))).not.toContain('internal');
  });
  it('saves both halves through one atomic RPC and maps refused writes',async()=>{
    const {api,calls}=fake(()=>({error:{code:'55000',message:'locked'}}));
    const review={overall:'Good',strengths:'',improvements:'',criterionNotes:{},internalNotes:'Private',nominations:['team-identity']};
    expect(await fail(api.saveReview('c',review))).toBe('locked');
    expect(calls).toEqual([{kind:'rpc',name:'save_card_review',args:{p_card:'c',p_review:review},steps:[]}]);
  });
  it('paginates feedback without mixing private fields into the returned team feedback',async()=>{
    const {api}=fake(()=>({data:[{scorecard_id:'c',overall:'Good',strengths:'',improvements:'',internal_notes:'MUST NOT RETURN'}]}));
    expect(await api.listFeedback('e')).toEqual([{cardId:'c',overall:'Good',strengths:'',improvements:''}]);
  });
});

describe('event lifecycle and CSV import RPCs',()=>{
  it('deletes a team through the confirmation RPC and maps locked responses',async()=>{
    const {api,calls}=fake(()=>({data:null}));await api.deleteTeam('e','t','001');
    expect(calls).toEqual([{kind:'rpc',name:'delete_team',args:{p_event:'e',p_team:'t',p_confirmation:'001'},steps:[]}]);
    expect(await fail(fake(()=>({error:{code:'55000',message:'submitted'}})).api.deleteTeam('e','t','001'))).toBe('locked');
  });
  it('passes event confirmation to deletion and uses the restore RPC',async()=>{
    const {api,calls}=fake(()=>({data:null}));
    await api.deleteEvent('e','National Finals');await api.restoreEvent('e');
    expect(calls.map(c=>[c.name,c.args])).toEqual([['delete_event',{p_event:'e',p_confirmation:'National Finals'}],['restore_event',{p_event:'e'}]]);
  });
  it('imports a batch in one request and maps the returned teams',async()=>{
    const {api,calls}=fake(()=>({data:[{id:'t',event_id:'e',number:'001',name:'One',school:'School'}]}));
    const batch=[{number:'001',name:'One',school:'School'}];
    expect(await api.importTeams('e',batch)).toEqual([{id:'t',eventId:'e',...batch[0]}]);
    expect(calls).toEqual([{kind:'rpc',name:'import_teams',args:{p_event:'e',p_teams:batch},steps:[]}]);
  });
  it('maps duplicate import errors and reads deleted events through the organiser-only RPC',async()=>{
    const error=fake(()=>({error:{code:'23505',message:'raw constraint'}}));
    expect(await fail(error.api.importTeams('e',[{number:'1',name:'One'}]))).toBe('duplicate');
    const {api,calls}=fake(()=>({data:[{id:'e',name:'Deleted',ruleset:{},results_released:false}]}));
    expect((await api.listDeletedEvents())[0].id).toBe('e');expect(calls[0].name).toBe('list_deleted_events');expect(has(calls[0],'range')).toBe(true);
  });
});

describe('sending invitation email',()=>{
  it('saves the pending invitation before asking the server to email its ID',async()=>{
    const {api,calls}=fake(c=>({data:c.kind==='function'?{status:'sent'}:{id:'pending-id'}}));
    await api.invite('event-id',{email:' NEW@X.test ',role:'chair'});
    expect(calls.map(c=>c.kind)).toEqual(['from','function']);
    expect(arg(calls[0],'insert')).toEqual({event_id:'event-id',email:'new@x.test',role:'chair',panel:null,team_id:null});
    expect(calls[1]).toMatchObject({name:'send-invitation',args:{body:{invitationId:'pending-id'}}});
  });
  it('never sends if saving the invitation was refused',async()=>{
    const {api,calls}=fake(()=>({error:{message:'permission denied',code:'42501'}}));
    expect(await fail(api.invite('e',{email:'a@x.test',role:'chair'}))).toBe('forbidden');
    expect(calls.some(c=>c.kind==='function')).toBe(false);
  });
  it('resends an existing invitation without creating another or changing auth state',async()=>{
    const {api,calls}=fake(()=>({data:{status:'sent'}}));await api.sendInvitation('existing');
    expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({kind:'function',args:{body:{invitationId:'existing'}}});
  });
  it.each([[401,'unauthenticated'],[403,'forbidden'],[429,'rate-limited'],[502,'email-delivery'],[503,'email-delivery']])('maps server status %s to a recoverable error',async(status,code)=>{
    const {api}=fake(()=>({error:{message:'raw provider detail',context:{status}}} as unknown as Res));
    expect(await fail(api.sendInvitation('existing'))).toBe(code);
  });
});

describe('email verification',()=>{
 it('verifies email codes and hashed links through Supabase Auth, never through app tables',async()=>{
  const {api,calls}=fake(()=>({data:{session:{user:{id:'u'}}}}));
  await api.verifyEmailCode(' Person@X.test ','1234 5678');await api.verifyEmailLink('a'.repeat(64));
  expect(calls.map(c=>c.kind)).toEqual(['auth','auth']);
  expect(calls[0].args).toEqual({email:'person@x.test',token:'12345678',type:'email'});
  expect(calls[1].args).toEqual({token_hash:'a'.repeat(64),type:'email'});
 });
 it('rejects expired verification and success responses that do not establish a session',async()=>{
  const expired=fake(()=>({error:{message:'expired',code:'otp_expired'}}));expect(await fail(expired.api.verifyEmailCode('person@x.test','12345678'))).toBe('invalid-auth');
  const empty=fake(()=>({data:{session:null}}));expect(await fail(empty.api.verifyEmailLink('a'.repeat(64)))).toBe('invalid-auth');
 });
});
