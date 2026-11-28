import { webcrypto } from 'node:crypto';
import { MemoryApi } from '../../src/api/memory';
import { codeAt, importSecret } from '../../src/pass/code';

/** jsdom's own crypto has no signing, so the tests borrow Node's. */
export function useNodeCrypto(): void { Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }); }

export const PASS_EMAILS = { org: 'org@x.test', mgr: 'mgr@x.test', judge: 'judge@x.test', chair: 'chair@x.test' } as const;
export const JPEG = btoa('\xff\xd8\xff\xe0' + 'x'.repeat(40));
const member = (id: string, name: string, role = 'Design Engineer') => ({ id, name, role, fileName: `${id}.jpg`, photoMime: 'image/jpeg', photoBase64: btoa(`pic-${id}`) });

/** An event with two teams. Team 1 has a manager and two members. Leaves the manager signed in. */
export async function passWorld() {
  const api = new MemoryApi();
  api.setCreatorAllowlist([PASS_EMAILS.org]);
  await api.signIn(PASS_EMAILS.org);
  const ev = await api.createEvent({ name: 'North Regional', startsOn: '2026-12-12' });
  const t1 = await api.createTeam(ev.id, { number: '1', name: 'Velocity', school: 'Hill School' });
  const t2 = await api.createTeam(ev.id, { number: '2', name: 'Apex' });
  await api.invite(ev.id, { email: PASS_EMAILS.mgr, role: 'team_manager', teamId: t1.id });
  await api.invite(ev.id, { email: PASS_EMAILS.judge, name: 'Judge', role: 'judge', panel: 'verbal' });
  await api.invite(ev.id, { email: PASS_EMAILS.chair, role: 'chair' });
  for (const e of [PASS_EMAILS.mgr, PASS_EMAILS.judge, PASS_EMAILS.chair]) { await api.signIn(e); await api.claimInvitations(); }
  (api as unknown as { compulsoryAssets: Map<string, unknown> }).compulsoryAssets.set(`${ev.id}:${t1.id}`, { memberPortraits: [member('m1', 'Asha Rao'), member('m2', 'Dev Shah', 'Team Principal')] });
  await api.signIn(PASS_EMAILS.mgr);
  /** Puts a student's pass on a phone and returns a way to make that phone's code. */
  const onPhone = async (name = 'Asha Rao') => {
    const before = await api.getSession();
    await api.signIn(PASS_EMAILS.mgr);
    const pass = (await api.teamPasses(ev.id, t1.id)).passes.find((p) => p.name === name)!;
    const got = await api.claimPass(pass.id, await api.passLink(pass.id));
    if (before?.email) await api.signIn(before.email);
    const key = await importSecret(got.secret);
    return { id: pass.id, code: (at = Date.now()) => codeAt(key, pass.id, at) };
  };
  return { api, ev, t1, t2, onPhone };
}
export const settle = async (turns = 6) => { for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0)); };
