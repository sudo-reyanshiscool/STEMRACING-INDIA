import { rank } from '../../src/engine';
import { INDIA_2026 } from '../../src/rulesets';
import { defaultRacingSetup } from '../../src/racing/competition';
import { SHOWCASE_EVENT_ID } from '../../src/api/showcase';
import type { ShowcaseSeed } from '../../src/api/memory';
import type { Api } from '../../src/api';

export function showcaseSeed(): ShowcaseSeed {
  const eventId = SHOWCASE_EVENT_ID;
  const area = INDIA_2026.areas.find(a => a.kind === 'scorecard')!;
  const team = { id: 'team-one', eventId, number: '001', name: 'Showcase Team', school: 'Example School' };
  const card = { id: 'original-card', eventId, teamId: team.id, areaId: area.id, panel: area.panel!, judgeId: 'original-judge', status: 'submitted' as const,
    reopenedCount: 0, scores: Object.fromEntries(area.criteria.map(c => [c.id, c.max])), comments: {} };
  const ranking = rank({ ruleset: INDIA_2026, teams: [team], cards: [card], overrides: [], penalties: [] });
  return {
    event: { id: eventId, name: 'Test Event', startsOn: '2026-10-24', ruleset: INDIA_2026, resultsReleased: false },
    teams: [team], roles: [{ id: 'owner-role', eventId, userId: 'owner', role: 'organiser', panel: null, teamId: null, email: 'owner@example.test' }],
    invitations: [{ id: 'pending-invite', eventId, email: 'invitee@example.test', role: 'race_official', panel: null, teamId: null, emailStatus: 'not_sent' }],
    cards: [card], feedback: [{ cardId: card.id, overall: 'Prepared and clearly explained.', strengths: 'Complete evidence.', improvements: 'Keep refining.' }],
    nominations: [], conflicts: [], exemptions: [], overrides: [], penalties: [], inspections: [], races: [],
    racingSetup: defaultRacingSetup(), broadcasts: [], contacts: [{ teamId: team.id, managerEmail: 'shubham@stempify.com' }],
    mail: { confirmed: true, version: 'awards-v1', snapshotId: 'snapshot-one', awards: [{ id: 'award-one', title: 'Best Team', teamId: team.id }], deliveries: [] },
    snapshot: { id: 'snapshot-one', eventId, createdAt: '2026-10-24T00:00:00Z', rulesetId: INDIA_2026.id, inputHash: 'a'.repeat(64), rows: ranking.rows, released: true },
    snapshotInputs: { racingIssues: [] },
  };
}

/** Any business write to this fake shared backend fails the test immediately. */
export function readOnlySource(seed = showcaseSeed()) {
  const calls: string[] = [];
  const reads: Record<string, () => unknown> = {
    getSession: () => ({ userId: 'owner', email: 'owner@example.test' }),
    getMfaStatus: () => ({ enabled: false, factors: [], currentLevel: 'aal1', nextLevel: 'aal1' }),
    getEvent: () => seed.event, myRoles: () => seed.roles, listTeams: () => seed.teams, listRoles: () => seed.roles,
    listInvitations: () => seed.invitations, listCards: () => seed.cards, listFeedback: () => seed.feedback,
    listNominations: () => seed.nominations, listConflicts: () => seed.conflicts, listJudgeExemptions: () => seed.exemptions,
    listOverrides: () => seed.overrides, listPenalties: () => seed.penalties, listInspections: () => seed.inspections,
    listRaces: () => seed.races, getRacingSetup: () => seed.racingSetup, listBroadcasts: () => seed.broadcasts,
    listTeamContacts: () => seed.contacts, resultMailState: () => seed.mail, latestSnapshot: () => seed.snapshot,
    getSnapshotInputs: () => seed.snapshotInputs,
  };
  const api = new Proxy({} as Api, { get: (_, property) => async () => {
    const name = String(property); calls.push(name);
    if (!reads[name]) throw new Error(`Unexpected shared backend call: ${name}`);
    return structuredClone(reads[name]());
  } });
  return { api, calls, reads, seed };
}
