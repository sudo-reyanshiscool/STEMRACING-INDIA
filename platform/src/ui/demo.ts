import type { MemoryApi } from '../api';

export const DEMO_PERSONAS = [
  { email: 'organiser@demo.test', label: 'Organiser' },
  { email: 'chair@demo.test', label: 'Chair of Judges' },
  { email: 'judge-verbal@demo.test', label: 'Judge: Verbal Presentation' },
  { email: 'judge-design@demo.test', label: 'Judge: Design & Engineering' },
  { email: 'team1@demo.test', label: 'Team manager: Sample team 1' },
] as const;

/** Fills the in-memory backend with clearly labelled sample data. Leaves the session signed in as the organiser. */
export async function seedDemo(api: MemoryApi): Promise<string> {
  await api.signIn('organiser@demo.test');
  const ev = await api.createEvent({ name: 'Sample event (demo data)', startsOn: new Date().toISOString().slice(0, 10) });
  const teams = [];
  for (const n of [1, 2, 3]) teams.push(await api.createTeam(ev.id, { number: String(n), name: `Sample team ${n}`, school: 'Sample school' }));
  await api.invite(ev.id, { email: 'chair@demo.test', role: 'chair' });
  await api.invite(ev.id, { email: 'judge-verbal@demo.test', role: 'judge', panel: 'verbal' });
  await api.invite(ev.id, { email: 'judge-design@demo.test', role: 'judge', panel: 'design_engineering' });
  await api.invite(ev.id, { email: 'team1@demo.test', role: 'team_manager', teamId: teams[0].id });
  for (const p of DEMO_PERSONAS.slice(1)) {
    await api.signIn(p.email);
    await api.claimInvitations();
  }
  await api.signIn('organiser@demo.test');
  return ev.id;
}
