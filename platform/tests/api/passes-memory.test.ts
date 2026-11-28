import { describe, expect, it } from 'vitest';
import { ApiError, cardFor, parsePassLink, passLinkUrl } from '../../src/api';
import { MemoryApi } from '../../src/api/memory';
import { codeAt, importSecret, parsePassCode, passCode, macFor } from '../../src/pass/code';

const ORG = 'org@x.test', MGR = 'mgr@x.test', JUDGE = 'judge@x.test';
const JPEG = btoa('\xff\xd8\xff\xe0' + 'x'.repeat(40));
const member = (id: string, name: string, pic = id) => ({ id, name, role: 'Design Engineer', fileName: `${id}.jpg`, photoMime: 'image/jpeg', photoBase64: btoa(`pic-${pic}`) });

async function world() {
  const api = new MemoryApi();
  api.setCreatorAllowlist([ORG]);
  await api.signIn(ORG);
  const ev = await api.createEvent({ name: 'Regional', startsOn: '2026-12-12' });
  const t1 = await api.createTeam(ev.id, { number: '1', name: 'One', school: 'First School' });
  const t2 = await api.createTeam(ev.id, { number: '2', name: 'Two' });
  await api.invite(ev.id, { email: MGR, role: 'team_manager', teamId: t1.id });
  await api.invite(ev.id, { email: JUDGE, name: 'Judge', role: 'judge', panel: 'verbal' });
  for (const e of [MGR, JUDGE]) { await api.signIn(e); await api.claimInvitations(); }
  const setMembers = (list: unknown[]) => (api as any).compulsoryAssets.set(`${ev.id}:${t1.id}`, { memberPortraits: list });
  setMembers([member('m1', 'Asha Rao'), member('m2', 'Dev Shah')]);
  await api.signIn(MGR);
  return { api, ev, t1, t2, setMembers };
}
const refused = async (p: Promise<unknown>) => { try { await p; } catch (e) { if (e instanceof ApiError) return e.code; throw e; } return 'ok'; };

describe('in-memory passes follow the database rules', () => {
  it('lists a pass for the manager and each member, to the team and staff only', async () => {
    const { api, ev, t1, t2 } = await world();
    const mine = await api.teamPasses(ev.id, t1.id);
    expect(mine.passes.map((p) => [p.kind, p.name, p.status, p.mine])).toEqual([['manager', '', 'new', true], ['student', 'Asha Rao', 'new', false], ['student', 'Dev Shah', 'new', false]]);
    expect(cardFor(mine, mine.passes[1])).toMatchObject({ passId: mine.passes[1].id, name: 'Asha Rao', team: { number: '1', name: 'One', school: 'First School' }, event: { name: 'Regional' }, stream: null });
    expect(await refused(api.teamPasses(ev.id, t2.id))).toBe('forbidden');
    await api.signIn(JUDGE);
    expect(await refused(api.teamPasses(ev.id, t1.id))).toBe('forbidden');
    await api.signIn(ORG);
    expect((await api.teamPasses(ev.id, t1.id)).passes.map((p) => p.id)).toEqual(mine.passes.map((p) => p.id));
  });

  it('claims once, checks genuine, and stops the old phone after a new link', async () => {
    const { api, ev, t1 } = await world();
    const asha = (await api.teamPasses(ev.id, t1.id)).passes[1];
    const token = await api.passLink(asha.id);
    expect(parsePassLink(new URL(passLinkUrl('https://events.example/', asha.id, token)).hash)).toEqual({ passId: asha.id, token });
    expect(await refused(api.claimPass(asha.id, 'wrong'))).toBe('forbidden');
    const phone = await api.claimPass(asha.id, token);
    expect(await refused(api.claimPass(asha.id, token))).toBe('forbidden');
    const key = await importSecret(phone.secret), code = await codeAt(key, asha.id, Date.now());
    expect(await refused(api.checkPass(ev.id, code))).toBe('forbidden');   // a manager cannot run the door
    await api.signIn(ORG);
    expect(await api.checkPass(ev.id, code, { device: 'a' })).toMatchObject({ result: 'genuine', presenter: false, firstSeenToday: null, holder: { name: 'Asha Rao', kind: 'student', team: { number: '1' } } });
    expect((await api.checkPass(ev.id, code, { device: 'a' })).result).toBe('genuine');
    expect((await api.checkPass(ev.id, code, { device: 'b' })).result).toBe('replay');
    const step = parsePassCode(code)!.step;
    expect((await api.checkPass(ev.id, passCode(asha.id, step - 9, await macFor(key, asha.id, step - 9)))).result).toBe('expired');
    expect((await api.checkPass(ev.id, passCode(asha.id, step, '0'.repeat(16)))).result).toBe('invalid');
    expect((await api.checkPass(ev.id, 'hello')).result).toBe('unknown');
    expect((await api.passArrivals(ev.id))).toMatchObject({ total: 3, arrived: [{ passId: asha.id, name: 'Asha Rao' }] });
    expect((await api.doorList(ev.id)).passes.find((p) => p.id === asha.id)).toMatchObject({ holder: phone.secret, presenter: null });
    expect(await api.passCard(asha.id, step, await macFor(key, asha.id, step))).toMatchObject({ passId: asha.id });
    await api.signIn(MGR);
    await api.passLink(asha.id);
    await api.signIn(ORG);
    expect((await api.checkPass(ev.id, await codeAt(key, asha.id, Date.now()))).result).toBe('invalid');
  });

  it('keeps a pass through a correction and lets the manager show it', async () => {
    const { api, ev, t1, setMembers } = await world();
    const asha = (await api.teamPasses(ev.id, t1.id)).passes[1];
    setMembers([member('m9', 'Asha Rao-Iyer', 'm1'), member('m2', 'Dev Shah')]);
    expect((await api.teamPasses(ev.id, t1.id)).passes[1]).toMatchObject({ id: asha.id, name: 'Asha Rao-Iyer' });
    await api.setPassPortrait(asha.id, JPEG);
    expect(await refused(api.setPassPortrait(asha.id, btoa('not a jpeg')))).toBe('invalid');
    expect((await api.teamPasses(ev.id, t1.id)).passes[1]).toMatchObject({ portrait: JPEG, portraitStale: false });
    const own = (await api.teamPasses(ev.id, t1.id)).passes[0];
    await api.setManagerPassName(own.id, '  Meera   Nair ');
    expect(await refused(api.setManagerPassName(asha.id, 'x'))).toBe('invalid');
    const shown = await importSecret(await api.presentPass(asha.id)), mineKey = await importSecret(await api.presentPass(own.id));
    await api.signIn(ORG);
    expect(await api.checkPass(ev.id, await codeAt(shown, asha.id, Date.now()))).toMatchObject({ result: 'genuine', presenter: true });
    expect(await api.checkPass(ev.id, await codeAt(mineKey, own.id, Date.now()))).toMatchObject({ result: 'genuine', presenter: false, holder: { name: 'Meera Nair', role: 'Team Manager' } });
    expect(await api.passPulseKey(ev.id)).toMatch(/^[0-9a-f]{64}$/);
    await api.signIn(MGR);
    expect(await refused(api.passPulseKey(ev.id))).toBe('forbidden');
    await api.signIn(JUDGE);
    expect(await api.passPulseKey(ev.id)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('follows the team: a corrected member keeps the pass, a removed manager loses theirs', async () => {
    const { api, ev, t1, setMembers } = await world();
    const passes = (await api.teamPasses(ev.id, t1.id)).passes, own = passes[0], asha = passes[1];
    const phone = await importSecret((await api.claimPass(asha.id, await api.passLink(asha.id))).secret);
    const mine = await importSecret(await api.presentPass(own.id));
    // Removed, the page opened, then added again under a new id: still the same pass on the same phone.
    setMembers([member('m2', 'Dev Shah')]);
    expect((await api.teamPasses(ev.id, t1.id)).passes.map((p) => p.name)).toEqual(['', 'Dev Shah']);
    setMembers([member('m2', 'Dev Shah'), member('m9', 'Asha Rao', 'retaken')]);
    await api.signIn(ORG);
    expect(await api.checkPass(ev.id, await codeAt(phone, asha.id, Date.now()))).toMatchObject({ result: 'genuine', holder: { name: 'Asha Rao' } });
    expect((await api.checkPass(ev.id, await codeAt(mine, own.id, Date.now()))).result).toBe('genuine');
    const role = (await api.listRoles(ev.id)).find((r) => r.role === 'team_manager')!;
    await api.removeRole(role.id);
    expect((await api.checkPass(ev.id, await codeAt(mine, own.id, Date.now()), { device: 'b' })).result).toBe('invalid');
    expect((await api.doorList(ev.id)).passes.some((p) => p.id === own.id)).toBe(false);
  });

  it('shares one presenter secret, and lets a manager send their own pass to their phone', async () => {
    const { api, ev, t1 } = await world();
    const passes = (await api.teamPasses(ev.id, t1.id)).passes, own = passes[0], asha = passes[1];
    const first = await api.presentPass(asha.id);
    expect(await api.presentPass(asha.id)).toBe(first);
    await api.signIn(ORG);
    expect(await api.presentPass(asha.id)).toBe(first);
    await api.signIn(MGR);
    await api.resetPass(asha.id);
    expect(await api.presentPass(asha.id)).not.toBe(first);
    const token = await api.passLink(own.id);
    expect((await api.teamPasses(ev.id, t1.id)).passes[0]).toMatchObject({ kind: 'manager', status: 'sent' });
    const got = await api.claimPass(own.id, token);
    expect(got.card).toMatchObject({ kind: 'manager', role: 'Team Manager' });
    expect((await api.teamPasses(ev.id, t1.id)).passes[0]).toMatchObject({ status: 'claimed' });
  });
});
