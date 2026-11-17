import { describe, expect, it, vi } from 'vitest';
import { clearRequestCache, withRequestCache } from '../../src/api/cached';
import type { Api } from '../../src/api';

function fake() {
  let clock = 0, auth: (() => void) | null = null, roles = [{ role: 'judge' }];
  const calls: string[] = [];
  const gate: Array<() => void> = [];
  const source = {
    onAuthChange: (cb: () => void) => { auth = cb; return () => undefined; },
    getSession: vi.fn(async () => { calls.push('getSession'); return { userId: 'u', email: 'u@x.test' }; }),
    myRoles: vi.fn(async (eventId: string) => { calls.push(`myRoles:${eventId}`); return roles; }),
    getEvent: vi.fn(async (id: string) => { calls.push(`getEvent:${id}`); return { id, name: 'E' }; }),
    listTeams: vi.fn(async () => { calls.push('listTeams'); await new Promise<void>((r) => gate.push(r)); return [{ number: '2' }, { number: '1' }]; }),
    createTeam: vi.fn(async () => { calls.push('createTeam'); return { id: 't' }; }),
    claimInvitations: vi.fn(async () => 0),
    downloadTeamFile: vi.fn(async () => ({ base64: 'x' })),
    getRacingSetup: vi.fn(async () => { throw new Error('offline'); }),
  };
  const api = withRequestCache(source as unknown as Api, () => clock);
  return { api, source, calls, release: () => gate.splice(0).forEach((r) => r()), tick: (ms: number) => { clock += ms; },
    fireAuth: () => auth?.(), setRoles: (next: typeof roles) => { roles = next; } };
}

describe('withRequestCache', () => {
  it('reuses roles and the event across one navigation, then asks again after the time limit', async () => {
    const f = fake();
    await Promise.all([f.api.myRoles('e'), f.api.myRoles('e'), f.api.getEvent('e')]);
    await f.api.myRoles('e'); await f.api.getEvent('e');
    expect(f.calls).toEqual(['myRoles:e', 'getEvent:e']);
    await f.api.myRoles('other');
    expect(f.source.myRoles).toHaveBeenCalledTimes(2);
    f.tick(6_000); await f.api.getEvent('e'); await f.api.myRoles('e');
    expect(f.source.getEvent).toHaveBeenCalledTimes(2);
    expect(f.source.myRoles).toHaveBeenCalledTimes(2);
    f.tick(30_000); await f.api.myRoles('e');
    expect(f.source.myRoles).toHaveBeenCalledTimes(3);
  });

  it('shares an in-flight list but does not keep it afterwards', async () => {
    const f = fake();
    const a = f.api.listTeams('e'), b = f.api.listTeams('e');
    await Promise.resolve(); await Promise.resolve();
    f.release();
    const [first, second] = await Promise.all([a, b]);
    expect(f.source.listTeams).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    const again = f.api.listTeams('e'); await Promise.resolve(); await Promise.resolve(); f.release(); await again;
    expect(f.source.listTeams).toHaveBeenCalledTimes(2);
  });

  it('hands every caller its own copy', async () => {
    const f = fake();
    const first = await f.api.myRoles('e') as unknown as Array<{ role: string }>;
    first[0]!.role = 'changed'; first.push({ role: 'extra' });
    expect(await f.api.myRoles('e')).toEqual([{ role: 'judge' }]);
  });

  it('forgets everything after a write, a failure or an account change', async () => {
    const f = fake();
    await f.api.myRoles('e');
    await f.api.createTeam('e', { number: '3', name: 'Three' });
    await f.api.myRoles('e');
    expect(f.source.myRoles).toHaveBeenCalledTimes(2);
    await expect(f.api.getRacingSetup('e')).rejects.toThrow('offline');
    await f.api.myRoles('e');
    expect(f.source.myRoles).toHaveBeenCalledTimes(3);
    f.fireAuth();
    await f.api.myRoles('e');
    expect(f.source.myRoles).toHaveBeenCalledTimes(4);
  });

  it('does not keep an answer that was requested before a write finished', async () => {
    const f = fake();
    const stale = f.api.myRoles('e');
    f.setRoles([{ role: 'chair' }]);
    await f.api.createTeam('e', { number: '3', name: 'Three' });
    await stale;
    expect(await f.api.myRoles('e')).toEqual([{ role: 'chair' }]);
  });

  it('keeps roles when no invitation was claimed and refreshes them when one was', async () => {
    const f = fake();
    await f.api.myRoles('e'); await f.api.claimInvitations(); await f.api.myRoles('e');
    expect(f.source.myRoles).toHaveBeenCalledTimes(1);
    f.source.claimInvitations.mockResolvedValueOnce(1);
    await f.api.claimInvitations(); await f.api.myRoles('e');
    expect(f.source.myRoles).toHaveBeenCalledTimes(2);
  });

  it('asks the server again after an explicit refresh', async () => {
    const f = fake();
    await f.api.myRoles('e'); clearRequestCache(f.api); await f.api.myRoles('e');
    expect(f.source.myRoles).toHaveBeenCalledTimes(2);
    expect(() => clearRequestCache(f.source as unknown as Api)).not.toThrow();
  });

  it('passes the session and downloads straight through without clearing anything', async () => {
    const f = fake();
    await f.api.myRoles('e');
    await f.api.getSession(); await f.api.getSession(); await f.api.downloadTeamFile('e', 'f');
    expect(f.source.getSession).toHaveBeenCalledTimes(2);
    await f.api.myRoles('e');
    expect(f.source.myRoles).toHaveBeenCalledTimes(1);
    expect(f.api.myRoles).toBe(f.api.myRoles);
  });
});
