import { describe, expect, it } from 'vitest';
import { ApiError, MemoryApi } from '../../src/api';
import { releaseResults } from '../ui/helpers';

const ORG = 'org@x.test';
const CHAIR = 'chair@x.test';
const JUDGE = 'judge@x.test';
const MGR = 'mgr@x.test';
const HASH = 'b'.repeat(64);
const RULESET = 'india-national-finals-2026';

async function world() {
  const api = new MemoryApi();
    api.setCreatorAllowlist([ORG]);
  await api.signIn(ORG);
  const ev = await api.createEvent({ name: 'Nationals', startsOn: '2026-11-01' });
  const t1 = await api.createTeam(ev.id, { number: '1', name: 'One' });
  const t2 = await api.createTeam(ev.id, { number: '2', name: 'Two' });
  await api.invite(ev.id, { email: CHAIR, role: 'chair' });
  await api.invite(ev.id, { email: JUDGE, name: JUDGE, role: 'judge', panel: 'verbal' });
  await api.invite(ev.id, { email: MGR, role: 'team_manager', teamId: t1.id });
  for (const e of [CHAIR, JUDGE, MGR]) {
    await api.signIn(e);
    expect(await api.claimInvitations()).toBe(1);
  }
  return { api, ev, t1, t2 };
}
const code = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { if (e instanceof ApiError) return e.code; throw e; }
  return 'ok';
};
const fillTechnique = async (api: MemoryApi, cardId: string) => {
  await api.saveScore(cardId, 'engagement-presentation-dynamics', 14);
  await api.saveScore(cardId, 'team-contribution', 12, 'Clear roles');
};

describe('events, teams and roles', () => {
  it('makes the creator the organiser and pins the India ruleset', async () => {
    const { api, ev } = await world();
    await api.signIn(ORG);
    expect(ev.ruleset.id).toBe('india-national-finals-2026');
    expect((await api.myRoles(ev.id)).map((r) => r.role)).toEqual(['organiser', 'chair']);
    expect((await api.listEvents()).map((e) => e.id)).toEqual([ev.id]);
  });

  it('refuses duplicate team numbers (ignoring case and spaces), blank names and non-organisers', async () => {
    const { api, ev } = await world();
    await api.signIn(ORG);
    expect(await code(api.createTeam(ev.id, { number: ' 1 ', name: 'Again' }))).toBe('duplicate');
    expect(await code(api.createTeam(ev.id, { number: '9', name: '   ' }))).toBe('invalid');
    const hostile = await api.createTeam(ev.id, { number: '3', name: '<script>alert(1)</script>' });
    expect(hostile.name).toBe('<script>alert(1)</script>');
    await api.signIn(JUDGE);
    expect(await code(api.createTeam(ev.id, { number: '4', name: 'Nope' }))).toBe('forbidden');
  });

  it('validates invitations and lets only the organiser or chair invite', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(ORG);
    expect(await code(api.invite(ev.id, { email: 'a@x.test', role: 'judge' }))).toBe('invalid');
    expect(await code(api.invite(ev.id, { email: 'a@x.test', role: 'team_manager' }))).toBe('invalid');
    expect(await code(api.invite(ev.id, { email: 'not-an-email', role: 'chair' }))).toBe('invalid');
    await api.invite(ev.id, { email: 'A@X.test', role: 'team_manager', teamId: t1.id });
    expect(await code(api.invite(ev.id, { email: 'a@x.test', role: 'team_manager', teamId: t1.id }))).toBe('duplicate');
    await api.signIn(JUDGE);
    expect(await code(api.invite(ev.id, { email: 'b@x.test', role: 'chair' }))).toBe('forbidden');
  });

  it('shows a judge only their own role, and a team manager only their team', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(JUDGE);
    expect((await api.listRoles(ev.id)).map((r) => r.userId)).toEqual(['user:judge@x.test']);
    expect((await api.listInvitations(ev.id))).toEqual([]);
    await api.signIn(MGR);
    expect((await api.listTeams(ev.id)).map((t) => t.id)).toEqual([t1.id]);
  });
});

describe('scorecards', () => {
  it('lets a judge create one card per team and area, in their own panel only', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(JUDGE);
    const a = await api.openCard(ev.id, t1.id, 'verbal-technique');
    const b = await api.openCard(ev.id, t1.id, 'verbal-technique');
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({ panel: 'verbal', status: 'draft', scores: {} });
    expect(await code(api.openCard(ev.id, t1.id, 'de-portfolio'))).toBe('forbidden');
    expect(await code(api.openCard(ev.id, t1.id, 'knockout'))).toBe('invalid');
    await api.signIn(MGR);
    expect(await code(api.openCard(ev.id, t1.id, 'verbal-technique'))).toBe('forbidden');
  });

  it('blocks a conflicted team', async () => {
    const { api, ev, t2 } = await world();
    await api.signIn(JUDGE);
    await api.declareConflict(ev.id, t2.id);
    expect(await api.myConflicts(ev.id)).toEqual([t2.id]);
    expect(await code(api.openCard(ev.id, t2.id, 'verbal-technique'))).toBe('forbidden');
  });

  it('validates scores, refuses an incomplete submit, then locks the submitted card', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(JUDGE);
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    expect(await code(api.saveScore(card.id, 'team-contribution', 21))).toBe('invalid');
    expect(await code(api.saveScore(card.id, 'team-contribution', 4.5))).toBe('invalid');
    expect(await code(api.saveScore(card.id, 'nope', 4))).toBe('invalid');
    await api.saveScore(card.id, 'team-contribution', 12);
    expect(await code(api.submitCard(card.id))).toBe('invalid');
    await fillTechnique(api, card.id);
    await api.submitCard(card.id);
    expect(await code(api.saveScore(card.id, 'team-contribution', 3))).toBe('locked');
    expect(await code(api.submitCard(card.id))).toBe('locked');
    const [mine] = await api.listCards(ev.id);
    expect(mine).toMatchObject({ status: 'submitted', scores: { 'engagement-presentation-dynamics': 14, 'team-contribution': 12 }, comments: { 'team-contribution': 'Clear roles' } });
  });

  it('lets only the Chair reopen, with a reason', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(JUDGE);
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await fillTechnique(api, card.id);
    await api.submitCard(card.id);
    expect(await code(api.reopenCard(card.id, 'please'))).toBe('forbidden');
    await api.signIn(CHAIR);
    expect(await code(api.reopenCard(card.id, ' '))).toBe('invalid');
    await api.reopenCard(card.id, 'Typo in a score');
    await api.signIn(JUDGE);
    expect((await api.listCards(ev.id))[0]).toMatchObject({ status: 'draft', reopenedCount: 1 });
    await api.saveScore(card.id, 'team-contribution', 15);
  });

  it('shows cards only to their judge, the Chair, and (after release) the team manager', async () => {
    const { api, ev, t1, t2 } = await world();
    await api.signIn(JUDGE);
    await api.openCard(ev.id, t1.id, 'verbal-technique');
    await api.openCard(ev.id, t2.id, 'verbal-technique');
    await api.signIn(CHAIR);
    expect(await api.listCards(ev.id)).toHaveLength(2);
    await api.signIn(MGR);
    expect(await api.listCards(ev.id)).toEqual([]);
    await api.signIn(CHAIR);
    await releaseResults(api, ev.id);
    await api.signIn(MGR);
    expect(await api.listCards(ev.id)).toEqual([]); // drafts are never shown to a team manager
    await api.signOut();
    expect(await api.listCards(ev.id)).toEqual([]);
  });
});

describe('results', () => {
  it('limits overrides, penalties and snapshots to the Chair and validates them', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(JUDGE);
    expect(await code(api.setOverride(ev.id, t1.id, 'de-portfolio', 100, 'reason'))).toBe('forbidden');
    expect(await code(api.addPenalty(ev.id, t1.id, 15, 'reason'))).toBe('forbidden');
    await api.signIn(CHAIR);
    expect(await code(api.setOverride(ev.id, t1.id, 'de-portfolio', 181, 'reason'))).toBe('invalid');
    expect(await code(api.setOverride(ev.id, t1.id, 'knockout', 5, 'reason'))).toBe('invalid');
    expect(await code(api.setOverride(ev.id, t1.id, 'de-portfolio', 100, 'x'))).toBe('invalid');
    await api.setOverride(ev.id, t1.id, 'de-portfolio', 100, 'Moderated');
    await api.setOverride(ev.id, t1.id, 'de-portfolio', 110, 'Moderated again');
    expect(await api.listOverrides(ev.id)).toEqual([{ eventId: ev.id, teamId: t1.id, areaId: 'de-portfolio', value: 110, reason: 'Moderated again' }]);
    expect(await code(api.addPenalty(ev.id, t1.id, 0, 'zero'))).toBe('invalid');
    await api.addPenalty(ev.id, t1.id, 15, 'Unsuccessful appeal');
    expect((await api.listPenalties(ev.id)).map((p) => p.points)).toEqual([15]);
  });

  it('keeps full snapshots private even after release', async () => {
    const { api, ev } = await world();
    await api.signIn(CHAIR);
    expect(await code(api.publishSnapshot(ev.id, { rulesetId: RULESET, inputHash: 'bad', inputs: {}, rows: [] }))).toBe('invalid');
    const snap = await api.publishSnapshot(ev.id, { rulesetId: RULESET, inputHash: HASH, inputs: {}, rows: [] });
    expect((await api.latestSnapshot(ev.id))?.id).toBe(snap.id);
    await api.signIn(JUDGE);
    expect(await code(api.publishSnapshot(ev.id, { rulesetId: RULESET, inputHash: HASH, inputs: {}, rows: [] }))).toBe('forbidden');
    expect(await api.latestSnapshot(ev.id)).toBeNull();
    await api.signOut();
    expect(await api.latestSnapshot(ev.id)).toBeNull();
    await api.signIn(CHAIR);
    await api.setReleased(ev.id, true);
    await api.signOut();
    expect(await api.latestSnapshot(ev.id)).toBeNull();
    expect((await api.getEvent(ev.id))?.name).toBe('Nationals');
    await api.signIn(CHAIR);
    await api.setReleased(ev.id, false);
    await api.signOut();
    expect(await api.getEvent(ev.id)).toBeNull();
  });
});

const JUDGE2 = 'judge2@x.test';
const submitFor = async (api: MemoryApi, evId: string, teamId: string) => {
  await api.signIn(JUDGE);
  const card = await api.openCard(evId, teamId, 'verbal-technique');
  await fillTechnique(api, card.id);
  await api.submitCard(card.id);
  return card;
};

describe('invitations are claimed only by their own email, once', () => {
  it('does not give an invitation to someone else, and consumes it on claim', async () => {
    const { api, ev } = await world();
    await api.signIn(ORG);
    await api.invite(ev.id, { email: 'late@x.test', role: 'scrutineer' });
    await api.signIn('other@x.test');
    expect(await api.claimInvitations()).toBe(0);
    expect(await api.myRoles(ev.id)).toEqual([]);
    await api.signIn('late@x.test');
    expect(await api.claimInvitations()).toBe(1);
    expect((await api.myRoles(ev.id)).map((r) => r.role)).toEqual(['scrutineer']);
    expect(await api.claimInvitations()).toBe(0);
    await api.signOut();
    expect(await api.claimInvitations()).toBe(0);
  });

  it('refuses an invitation for a team that is not in the event', async () => {
    const { api, ev } = await world();
    await api.signIn(ORG);
    expect(await code(api.invite(ev.id, { email: 'z@x.test', role: 'team_manager', teamId: 'team-nope' }))).toBe('invalid');
    const other = await api.createEvent({ name: 'Other' });
    const foreign = await api.createTeam(other.id, { number: '1', name: 'Foreign' });
    expect(await code(api.invite(ev.id, { email: 'z@x.test', role: 'team_manager', teamId: foreign.id }))).toBe('invalid');
  });
});

describe('judging details', () => {
  it('gives each judge their own card for the same team and area', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(ORG);
    await api.invite(ev.id, { email: JUDGE2, name: JUDGE2, role: 'judge', panel: 'verbal' });
    await api.signIn(JUDGE);
    const a = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await api.signIn(JUDGE2);
    await api.claimInvitations();
    const b = await api.openCard(ev.id, t1.id, 'verbal-technique');
    expect(b.id).not.toBe(a.id);
    expect(await api.listCards(ev.id)).toHaveLength(1);
    expect(await code(api.saveScore(a.id, 'team-contribution', 5))).toBe('forbidden');
  });

  it('reports a score write with no session as unauthenticated, not forbidden', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(JUDGE);
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await api.signOut();
    expect(await code(api.saveScore(card.id, 'team-contribution', 5))).toBe('unauthenticated');
  });

  it('stops scoring and submitting on a conflicted team', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(JUDGE);
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await fillTechnique(api, card.id);
    await api.declareConflict(ev.id, t1.id);
    expect(await code(api.saveScore(card.id, 'team-contribution', 5))).toBe('forbidden');
    expect(await code(api.submitCard(card.id))).toBe('forbidden');
  });

  it('refuses a conflict once the judge submitted a card for the team, and while results are released', async () => {
    const { api, ev, t1, t2 } = await world();
    await api.signIn(JUDGE);
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await fillTechnique(api, card.id);
    await api.submitCard(card.id);
    expect(await code(api.declareConflict(ev.id, t1.id))).toBe('locked');
    await api.declareConflict(ev.id, t2.id); // another team is still open
    expect(await api.myConflicts(ev.id)).toEqual([t2.id]);
    await api.signIn(CHAIR);
    await releaseResults(api, ev.id);
    await api.signIn(JUDGE);
    const other = ev.id;
    expect(await code(api.declareConflict(other, t2.id))).toBe('locked');
  });

  it('lets the Chair and Organiser list every conflict, and a judge only their own', async () => {
    const { api, ev, t1, t2 } = await world();
    await api.signIn(JUDGE);
    await api.declareConflict(ev.id, t1.id);
    expect((await api.listConflicts(ev.id)).map((c) => c.teamId)).toEqual([t1.id]);
    await api.signIn(ORG);
    await api.invite(ev.id, { email: 'lead@x.test', name: 'Lead Judge', role: 'lead_judge', panel: 'verbal' });
    await api.signIn('lead@x.test');
    await api.claimInvitations();
    await api.declareConflict(ev.id, t2.id);
    expect((await api.listConflicts(ev.id)).map((c) => c.teamId)).toEqual([t2.id]);
    await api.signIn(CHAIR);
    expect((await api.listConflicts(ev.id)).map((c) => c.teamId).sort()).toEqual([t1.id, t2.id].sort());
    await api.signIn(ORG);
    expect(await api.listConflicts(ev.id)).toHaveLength(2);
    await api.signIn(MGR);
    expect(await api.listConflicts(ev.id)).toEqual([]);
    await api.signOut();
    expect(await api.listConflicts(ev.id)).toEqual([]);
  });

  it('lets Chairs and Organisers remove overrides and refuses judges', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(CHAIR);
    await api.setOverride(ev.id, t1.id, 'pit-display', 30, 'Cross-moderated');
    await api.signIn(JUDGE);
    expect(await code(api.removeOverride(ev.id, t1.id, 'pit-display'))).toBe('forbidden');
    await api.signIn(ORG);
    expect(await code(api.removeOverride(ev.id, t1.id, 'pit-display'))).toBe('ok');
    await api.setOverride(ev.id, t1.id, 'pit-display', 30, 'Cross-moderated');
    await api.signIn(CHAIR);
    await releaseResults(api, ev.id);
    expect(await code(api.removeOverride(ev.id, t1.id, 'pit-display'))).toBe('locked');
    await api.setReleased(ev.id, false);
    await api.removeOverride(ev.id, t1.id, 'pit-display');
    expect(await api.listOverrides(ev.id)).toEqual([]);
    expect(await code(api.removeOverride(ev.id, t1.id, 'pit-display'))).toBe('forbidden');
  });

  it('refuses a conflict for a team outside the event', async () => {
    const { api, ev } = await world();
    await api.signIn(JUDGE);
    expect(await code(api.declareConflict(ev.id, 'team-nope'))).toBe('not-found');
    await api.signIn(MGR);
    expect(await code(api.declareConflict(ev.id, 'team-nope'))).toBe('forbidden');
  });

  it('only reopens a submitted card', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(JUDGE);
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await api.signIn(CHAIR);
    expect(await code(api.reopenCard(card.id, 'Because'))).toBe('locked');
    expect(await code(api.reopenCard('card-nope', 'Because'))).toBe('not-found');
  });
});

describe('release freezes judging and results', () => {
  it('locks cards, scores, reopening, overrides and penalties until the release is withdrawn', async () => {
    const { api, ev, t1, t2 } = await world();
    await api.signIn(JUDGE);
    const draft = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await api.saveScore(draft.id, 'team-contribution', 12);
    const done = await submitFor(api, ev.id, t2.id);
    await api.signIn(CHAIR);
    await api.setOverride(ev.id, t1.id, 'de-portfolio', 100, 'Moderated');
    await releaseResults(api, ev.id);

    await api.signIn(JUDGE);
    expect(await code(api.saveScore(draft.id, 'team-contribution', 3))).toBe('locked');
    expect(await code(api.submitCard(draft.id))).toBe('locked');
    expect(await code(api.openCard(ev.id, t2.id, 'verbal-composition'))).toBe('locked');
    await api.signIn(CHAIR);
    expect(await code(api.reopenCard(done.id, 'Typo in a score'))).toBe('locked');
    expect(await code(api.setOverride(ev.id, t1.id, 'de-portfolio', 90, 'Changed'))).toBe('locked');
    expect(await code(api.addPenalty(ev.id, t1.id, 5, 'Late'))).toBe('locked');

    await api.setReleased(ev.id, false);
    await api.reopenCard(done.id, 'Typo in a score');
    await api.setOverride(ev.id, t1.id, 'de-portfolio', 90, 'Changed');
    await api.addPenalty(ev.id, t1.id, 5, 'Late');
    await api.signIn(JUDGE);
    await api.saveScore(draft.id, 'team-contribution', 3);
  });
});

describe('releasing needs a matching published ranking', () => {
  const publish = async (api: MemoryApi, evId: string) => api.publishSnapshot(evId, { rulesetId: RULESET, inputHash: HASH, inputs: { cards: [] }, rows: [] });

  it('requires a snapshot and Chair or Organiser access', async () => {
    const { api, ev } = await world();
    await api.signIn(CHAIR);
    expect(await code(api.setReleased(ev.id, true))).toBe('locked');
    await publish(api, ev.id);
    await api.signIn(ORG);
    expect(await code(api.setReleased(ev.id, true))).toBe('ok');
    await api.signIn(JUDGE);
    expect(await code(api.setReleased(ev.id, true))).toBe('forbidden');
    await api.signIn(CHAIR);
    await api.setReleased(ev.id, true);
    expect((await api.getEvent(ev.id))!.resultsReleased).toBe(true);
    await api.signIn(ORG);
    expect(await code(api.setReleased(ev.id, false))).toBe('ok');
  });

  it('goes out of date when a card is submitted, an override or penalty changes, or a card is reopened', async () => {
    const { api, ev, t1, t2 } = await world();
    await api.signIn(JUDGE);
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await fillTechnique(api, card.id);
    await api.submitCard(card.id);
    await api.signIn(CHAIR);
    await publish(api, ev.id);
    await api.setOverride(ev.id, t2.id, 'pit-display', 20, 'Cross-moderated');
    expect(await code(api.setReleased(ev.id, true))).toBe('locked');
    await publish(api, ev.id);
    await api.addPenalty(ev.id, t1.id, 5, 'Unsuccessful appeal');
    expect(await code(api.setReleased(ev.id, true))).toBe('locked');
    await publish(api, ev.id);
    await api.reopenCard(card.id, 'Judge asked to fix a typo');
    expect(await code(api.setReleased(ev.id, true))).toBe('locked');
    await publish(api, ev.id);
    await api.setReleased(ev.id, true);
    // Withdrawing and releasing the same ranking again is fine: nothing changed.
    await api.setReleased(ev.id, false);
    await api.setReleased(ev.id, true);
  });

  it('refuses to release a snapshot made before a removal as well', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(CHAIR);
    await api.addPenalty(ev.id, t1.id, 5, 'Unsuccessful appeal');
    await publish(api, ev.id);
    const [p] = await api.listPenalties(ev.id);
    await api.removePenalty(p.id);
    expect(await code(api.setReleased(ev.id, true))).toBe('locked');
  });
});

describe('visibility after release', () => {
  it('shows a team manager only the submitted cards of their own team', async () => {
    const { api, ev, t1, t2 } = await world();
    await api.signIn(JUDGE);
    await api.openCard(ev.id, t1.id, 'verbal-technique'); // stays a draft
    await submitFor(api, ev.id, t2.id);
    await api.signIn(CHAIR);
    await releaseResults(api, ev.id);
    await api.signIn(MGR);
    expect(await api.listCards(ev.id)).toEqual([]);
    await api.signIn(JUDGE);
    expect(await api.listCards(ev.id)).toHaveLength(2);
  });

  it('shows a team manager the penalties of their team only after release', async () => {
    const { api, ev, t1, t2 } = await world();
    await api.signIn(CHAIR);
    await api.addPenalty(ev.id, t1.id, 5, 'Late arrival');
    await api.addPenalty(ev.id, t2.id, 5, 'Late arrival');
    await api.signIn(MGR);
    expect(await api.listPenalties(ev.id)).toEqual([]);
    await api.signIn(CHAIR);
    await releaseResults(api, ev.id);
    await api.signIn(MGR);
    expect((await api.listPenalties(ev.id)).map((p) => p.teamId)).toEqual([t1.id]);
    expect(await api.listOverrides(ev.id)).toEqual([]);
  });
});

describe('overrides and penalties validation', () => {
  it('requires a one-decimal value within the area range and a team of the event', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(CHAIR);
    expect(await code(api.setOverride(ev.id, t1.id, 'de-portfolio', 100.25, 'Moderated'))).toBe('invalid');
    expect(await code(api.setOverride(ev.id, t1.id, 'de-portfolio', -1, 'Moderated'))).toBe('invalid');
    expect(await code(api.setOverride(ev.id, t1.id, 'de-portfolio', Number.NaN, 'Moderated'))).toBe('invalid');
    expect(await code(api.setOverride(ev.id, 'team-nope', 'de-portfolio', 100, 'Moderated'))).toBe('not-found');
    await api.setOverride(ev.id, t1.id, 'de-portfolio', 100.5, 'Moderated');
    expect((await api.listOverrides(ev.id))[0].value).toBe(100.5);
    expect(await code(api.addPenalty(ev.id, t1.id, 101, 'too many'))).toBe('invalid');
    expect(await code(api.addPenalty(ev.id, t1.id, 5.55, 'odd'))).toBe('invalid');
    expect(await code(api.addPenalty(ev.id, 'team-nope', 5, 'ok then'))).toBe('not-found');
  });

  it('lets Competition Organisers read and set overrides', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(CHAIR);
    await api.setOverride(ev.id, t1.id, 'de-portfolio', 100, 'Moderated');
    await api.signIn(ORG);
    expect(await api.listOverrides(ev.id)).toHaveLength(1);
    expect(await code(api.setOverride(ev.id, t1.id, 'de-portfolio', 90, 'Moderated'))).toBe('ok');
  });
});

describe('snapshots', () => {
  it('rejects a ruleset that is not the one pinned to the event, and non-object inputs', async () => {
    const { api, ev } = await world();
    await api.signIn(CHAIR);
    expect(await code(api.publishSnapshot(ev.id, { rulesetId: 'other', inputHash: HASH, inputs: {}, rows: [] }))).toBe('invalid');
    expect(await code(api.publishSnapshot(ev.id, { rulesetId: RULESET, inputHash: HASH, inputs: [] as unknown, rows: [] }))).toBe('invalid');
    expect(await code(api.publishSnapshot(ev.id, { rulesetId: RULESET, inputHash: HASH, inputs: {}, rows: {} as never }))).toBe('invalid');
    await api.signIn(ORG);
    expect(await code(api.publishSnapshot(ev.id, { rulesetId: RULESET, inputHash: HASH, inputs: {}, rows: [] }))).toBe('ok');
  });

  it('never exposes inputs on a snapshot, and gives them only to the Chair and Organiser', async () => {
    const { api, ev } = await world();
    await api.signIn(CHAIR);
    const secret = { cards: [{ judgeId: 'user:judge@x.test' }] };
    const snap = await api.publishSnapshot(ev.id, { rulesetId: RULESET, inputHash: HASH, inputs: secret, rows: [] });
    expect(Object.keys(snap).sort()).toEqual(['createdAt', 'eventId', 'id', 'inputHash', 'released', 'rows', 'rulesetId']);
    expect(Object.keys((await api.latestSnapshot(ev.id))!).sort()).toEqual(Object.keys(snap).sort());
    expect(await api.getSnapshotInputs(snap.id)).toEqual(secret);
    await api.signIn(ORG);
    expect(await api.getSnapshotInputs(snap.id)).toEqual(secret);
    await api.signIn(CHAIR);
    await releaseResults(api, ev.id);
    for (const who of [JUDGE, MGR]) {
      await api.signIn(who);
      if (who === MGR) expect(Object.keys((await api.releasedResults(ev.id))!)).not.toContain('inputs');
      else expect(await api.releasedResults(ev.id)).toBeNull();
      expect(await api.latestSnapshot(ev.id)).toBeNull();
      expect(await code(api.getSnapshotInputs(snap.id))).toBe('forbidden');
    }
    await api.signOut();
    expect(await code(api.getSnapshotInputs(snap.id))).toBe('forbidden');
    expect(await api.latestSnapshot(ev.id)).toBeNull();
  });

  it('does not let a later mutation of a returned snapshot change the stored one', async () => {
    const { api, ev } = await world();
    await api.signIn(CHAIR);
    const snap = await api.publishSnapshot(ev.id, { rulesetId: RULESET, inputHash: HASH, inputs: {}, rows: [] });
    snap.rows.push({} as never);
    expect((await api.latestSnapshot(ev.id))!.rows).toEqual([]);
  });
});

describe('events', () => {
  it('validates the start date and names', async () => {
    const { api } = await world();
    await api.signIn(ORG);
    expect(await code(api.createEvent({ name: 'X', startsOn: '2026-13-45' }))).toBe('invalid');
    expect(await code(api.createEvent({ name: '  ' }))).toBe('invalid');
    await api.signOut();
    expect(await code(api.createEvent({ name: 'X' }))).toBe('unauthenticated');
  });

  it('restricts event creation to organisers and allowlisted users', async () => {
    const { api } = await world();
    await api.signIn(JUDGE);
    expect(await api.canCreateEvent()).toBe(false);
    expect(await code(api.createEvent({ name: 'Blocked' }))).toBe('forbidden');

    await api.signIn(ORG);
    expect(await api.canCreateEvent()).toBe(true);
    const ev2 = await api.createEvent({ name: 'Allowed' });
    expect(ev2.name).toBe('Allowed');

    await api.signIn('preapproved@x.test');
    expect(await api.canCreateEvent()).toBe(false);
    api.setCreatorAllowlist(['preapproved@x.test']);
    expect(await api.canCreateEvent()).toBe(true);
    const ev3 = await api.createEvent({ name: 'From Allowlist' });
    expect(ev3.name).toBe('From Allowlist');
  });

  it('allows only organisers to invite organisers and prevents removing the last organiser', async () => {
    const { api, ev } = await world();
    await api.signIn(CHAIR);
    expect(await code(api.invite(ev.id, { email: 'neworg@x.test', role: 'organiser' }))).toBe('forbidden');

    await api.signIn(ORG);
    await api.invite(ev.id, { email: 'neworg@x.test', role: 'organiser' });
    await api.signIn('neworg@x.test');
    await api.claimInvitations();

    const roles = await api.listRoles(ev.id);
    const org1 = roles.find((r) => r.email === ORG && r.role === 'organiser')!;
    const org2 = roles.find((r) => r.email === 'neworg@x.test' && r.role === 'organiser')!;

    // Chair cannot remove an organiser
    await api.signIn(CHAIR);
    expect(await code(api.removeRole(org1.id))).toBe('forbidden');

    // Organiser 2 can remove organiser 1
    await api.signIn('neworg@x.test');
    await api.removeRole(org1.id);
    expect((await api.listRoles(ev.id)).some((r) => r.id === org1.id)).toBe(false);

    // Organiser 2 is now the sole organiser; cannot be removed
    expect(await code(api.removeRole(org2.id))).toBe('locked');
  });
});


describe('score comments', () => {
  it('keeps an existing comment on a score-only save, and clears it only when a string is passed', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(JUDGE);
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await api.saveScore(card.id, 'team-contribution', 12, 'Clear roles');
    await api.saveScore(card.id, 'team-contribution', 15);
    expect((await api.listCards(ev.id))[0]).toMatchObject({ scores: { 'team-contribution': 15 }, comments: { 'team-contribution': 'Clear roles' } });
    await api.saveScore(card.id, 'engagement-presentation-dynamics', 10);
    expect((await api.listCards(ev.id))[0].comments['engagement-presentation-dynamics'] ?? '').toBe('');
    await api.saveScore(card.id, 'team-contribution', 15, '');
    expect((await api.listCards(ev.id))[0].comments['team-contribution']).toBe('');
  });
});

describe('removePenalty', () => {
  it('requires Chair or Organiser access, removes the row, and freezes while released', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(CHAIR);
    await api.addPenalty(ev.id, t1.id, 15, 'Mistaken entry');
    const [p] = await api.listPenalties(ev.id);
    await api.signIn(JUDGE);
    expect(await code(api.removePenalty(p.id))).toBe('forbidden');
    await api.signIn(CHAIR);
    expect(await code(api.removePenalty('penalty-nope'))).toBe('forbidden');
    await releaseResults(api, ev.id);
    expect(await code(api.removePenalty(p.id))).toBe('locked');
    await api.setReleased(ev.id, false);
    await api.removePenalty(p.id);
    expect(await api.listPenalties(ev.id)).toEqual([]);
  });
});

describe('technical inspections', () => {
  it('saves, submits, and reopens technical inspections with audit history and permissions', async () => {
    const { api, ev, t1 } = await world();
    const SCRUT = 'scrut@x.test';
    await api.signIn(ORG);
    await api.invite(ev.id, { email: SCRUT, name: SCRUT, role: 'judge', panel: 'scrutineering' });
    await api.signIn(SCRUT);
    await api.claimInvitations();

    // Verbal judge cannot save inspection
    await api.signIn(JUDGE);
    expect(await code(api.saveInspection(ev.id, t1.id, 'A', { 'T3.6': 52.0 }))).toBe('forbidden');

    // Scrutineering judge can save inspection
    await api.signIn(SCRUT);
    const saved = await api.saveInspection(ev.id, t1.id, 'A', { 'T3.6': 52.0 }, { note: 'checked' });
    expect(saved.measurements).toEqual({ 'T3.6': 52.0 });
    expect(saved.status).toBe('in_progress');
    expect(saved.revision).toBe(1);

    // Update inspection
    const updated = await api.saveInspection(ev.id, t1.id, 'A', { 'T3.6': 53.0 });
    expect(updated.measurements).toEqual({ 'T3.6': 53.0 });
    expect(updated.revision).toBe(2);

    // Get inspection
    const fetched = await api.getInspection(ev.id, t1.id, 'A');
    expect(fetched?.measurements).toEqual({ 'T3.6': 53.0 });

    // Submit inspection
    await api.submitInspection(saved.id);
    expect(await code(api.submitInspection(saved.id))).toBe('duplicate');
    expect(await code(api.saveInspection(ev.id, t1.id, 'A', { 'T3.6': 54.0 }))).toBe('locked');

    // Only Chair can reopen
    await api.signIn(SCRUT);
    expect(await code(api.reopenInspection(saved.id, 'Correction required'))).toBe('forbidden');

    await api.signIn(CHAIR);
    expect(await code(api.reopenInspection(saved.id, '   '))).toBe('invalid');
    await api.reopenInspection(saved.id, 'Correction required by scrutineer');
    const reopened = await api.getInspection(ev.id, t1.id, 'A');
    expect(reopened?.status).toBe('reopened');

    // After reopen, scrutineer can edit again
    await api.signIn(SCRUT);
    await api.saveInspection(ev.id, t1.id, 'A', { 'T3.6': 52.5 });
    const finalInsp = await api.getInspection(ev.id, t1.id, 'A');
    expect(finalInsp?.measurements).toEqual({ 'T3.6': 52.5 });

    // While reopened (in progress), verbal judge and manager cannot see it
    await api.signIn(JUDGE);
    expect((await api.listInspections(ev.id)).length).toBe(0);
    await api.signIn(MGR);
    expect((await api.listInspections(ev.id)).length).toBe(0);

    // Re-submit inspection
    await api.signIn(SCRUT);
    await api.submitInspection(saved.id);

    // Submitted inspection is visible to verbal judge, but not yet to manager
    await api.signIn(JUDGE);
    expect((await api.listInspections(ev.id)).length).toBe(1);
    await api.signIn(MGR);
    expect((await api.listInspections(ev.id)).length).toBe(0);

    // After release, manager can see own team's submitted inspection
    await api.signIn(CHAIR);
    await api.publishSnapshot(ev.id, { rulesetId: RULESET, inputHash: HASH, inputs: { cards: [] }, rows: [] });
    await api.setReleased(ev.id, true);
    await api.signIn(MGR);
    expect((await api.listInspections(ev.id)).length).toBe(1);
  });
});

