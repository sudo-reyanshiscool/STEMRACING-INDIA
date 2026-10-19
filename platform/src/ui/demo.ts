import type { MemoryApi, Panel } from '../api';
import { INDIA_2026 } from '../rulesets';

export const DEMO_PERSONAS = [
  { email: 'organiser@demo.test', label: 'Organiser' },
  { email: 'chair@demo.test', label: 'Chair of Judges' },
  { email: 'judge-verbal@demo.test', label: 'Judge: Verbal Presentation' },
  { email: 'judge-design@demo.test', label: 'Judge: Design & Engineering' },
  { email: 'judge-scrutineering-1@demo.test', label: 'Judge: Specification & Scrutineering' },
  { email: 'judge-pm-1@demo.test', label: 'Judge: Project Management' },
  { email: 'judge-enterprise-1@demo.test', label: 'Judge: Enterprise' },
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
  await api.invite(ev.id, { email: 'judge-scrutineering-1@demo.test', role: 'judge', panel: 'scrutineering' });
  await api.invite(ev.id, { email: 'judge-pm-1@demo.test', role: 'judge', panel: 'project_management' });
  await api.invite(ev.id, { email: 'judge-enterprise-1@demo.test', role: 'judge', panel: 'enterprise' });
  await api.invite(ev.id, { email: 'team1@demo.test', role: 'team_manager', teamId: teams[0].id });
  for (const p of DEMO_PERSONAS.slice(1)) {
    await api.signIn(p.email);
    await api.claimInvitations();
  }
  await api.signIn('organiser@demo.test');
  await seedLargeDemo(api);
  return ev.id;
}

/** Twelve teams, as at a real final. Names and schools are invented. */
export const DEMO_TEAMS: ReadonlyArray<{ name: string; school: string }> = [
  { name: 'Kolkata Comets', school: 'Eastern Heights School, Kolkata' },
  { name: 'Hyderabad Hawks', school: 'Deccan Valley International School, Hyderabad' },
  { name: 'Pune Pistons', school: 'Sahyadri Public School, Pune' },
  { name: 'Chennai Cyclones', school: 'Marina Bay Matriculation School, Chennai' },
  { name: 'Jaipur Jets', school: 'Aravali Academy, Jaipur' },
  { name: 'Bengaluru Bolts', school: 'Cubbon Road International School, Bengaluru' },
  { name: 'Delhi Dynamos', school: 'Yamuna Vihar Public School, Delhi' },
  { name: 'Mumbai Meteors', school: 'Western Coast High School, Mumbai' },
  { name: 'Ahmedabad Aces', school: 'Sabarmati Riverfront School, Ahmedabad' },
  { name: 'Lucknow Lightning', school: 'Gomti Nagar Public School, Lucknow' },
  { name: 'Kochi Kestrels', school: 'Backwater International School, Kochi' },
  { name: 'Guwahati Gliders', school: 'Brahmaputra Valley School, Guwahati' },
];

/** The judges of the larger event: two per panel. The first of the verbal and design pairs are the demo personas. */
export const DEMO_PANEL_JUDGES: Record<Panel, readonly [string, string]> = {
  scrutineering: ['judge-scrutineering-1@demo.test', 'judge-scrutineering-2@demo.test'],
  design_engineering: ['judge-design@demo.test', 'judge-design-2@demo.test'],
  project_management: ['judge-pm-1@demo.test', 'judge-pm-2@demo.test'],
  enterprise: ['judge-enterprise-1@demo.test', 'judge-enterprise-2@demo.test'],
  verbal: ['judge-verbal@demo.test', 'judge-verbal-2@demo.test'],
};

/** A small deterministic generator (mulberry32): the same demo opens every time, so screenshots and tests are stable. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A second, larger event: 12 teams, two judges on every panel, every scorecard submitted with seeded scores, so the
 * Chair's Moderation and Rankings screens open on a realistic field. Results are not published or released:
 * the Chair does that. Leaves the session signed in as the organiser.
 */
export async function seedLargeDemo(api: MemoryApi): Promise<string> {
  await api.signIn('organiser@demo.test');
  const ev = await api.createEvent({ name: 'National Finals rehearsal (demo data)', startsOn: new Date().toISOString().slice(0, 10) });
  const teams = [];
  for (const [i, t] of DEMO_TEAMS.entries()) teams.push(await api.createTeam(ev.id, { number: String(i + 1), name: t.name, school: t.school }));
  await api.invite(ev.id, { email: 'chair@demo.test', role: 'chair' });
  await api.invite(ev.id, { email: 'team1@demo.test', role: 'team_manager', teamId: teams[0].id });
  const panels = Object.keys(DEMO_PANEL_JUDGES) as Panel[];
  for (const panel of panels) {
    for (const email of DEMO_PANEL_JUDGES[panel]) await api.invite(ev.id, { email, role: 'judge', panel });
  }
  const everyone = ['chair@demo.test', 'team1@demo.test', ...panels.flatMap((p) => DEMO_PANEL_JUDGES[p])];
  for (const email of everyone) {
    await api.signIn(email);
    await api.claimInvitations();
  }

  const rand = seededRandom(20261010);
  // A strength per team, then noise per judge and criterion: a spread of totals with a few close finishes.
  const strength = teams.map(() => 0.45 + rand() * 0.5);
  for (const panel of panels) {
    const areas = INDIA_2026.areas.filter((a) => a.kind === 'scorecard' && a.panel === panel);
    for (const email of DEMO_PANEL_JUDGES[panel]) {
      await api.signIn(email);
      for (const [ti, team] of teams.entries()) {
        for (const area of areas) {
          const card = await api.openCard(ev.id, team.id, area.id);
          for (const c of area.criteria) {
            const x = Math.min(1, Math.max(0, strength[ti] + (rand() - 0.5) * 0.24));
            await api.saveScore(card.id, c.id, Math.round(c.max * x));
          }
          await api.submitCard(card.id);
        }
      }
    }
  }
  await api.signIn('organiser@demo.test');
  return ev.id;
}
