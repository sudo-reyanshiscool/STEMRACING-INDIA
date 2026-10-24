import { describe, expect, it } from 'vitest';
import { loadShowcase, SHOWCASE_EVENT_ID } from '../../src/api/showcase';
import { readOnlySource } from '../fixtures/showcase';

describe('Test Event showcase isolation', () => {
  it('retains the populated results and opens independent, prefilled scorecards', async () => {
    const {api: shared, calls, seed} = readOnlySource();
    const before = structuredClone(seed);
    const api = await loadShowcase(shared, SHOWCASE_EVENT_ID);
    const loadCalls = calls.length;
    const draw = await api.drawLotsState(SHOWCASE_EVENT_ID);
    expect(draw.numberingLocked).toBe(false);
    expect(draw.lockedPanels).toEqual([]);
    await api.applyTeamNumberDraw(SHOWCASE_EVENT_ID, draw.version, [{teamId: seed.teams[0].id, number: '001'}]);
    expect((await api.myRoles(SHOWCASE_EVENT_ID)).map(r => r.role)).toEqual(expect.arrayContaining(['organiser', 'chair']));
    expect((await api.latestSnapshot(SHOWCASE_EVENT_ID))?.rows).toEqual(seed.snapshot.rows);
    const original = seed.cards[0];
    const card = await api.openCard(SHOWCASE_EVENT_ID, original.teamId, original.areaId);
    expect(card.id).not.toBe(original.id);
    expect(card.status).toBe('draft');
    expect(card.scores).toEqual(original.scores);
    expect((await api.getReview(card.id)).overall).toBe(seed.feedback[0].overall);
    const criterion = Object.keys(card.scores)[0];
    await api.saveScore(card.id, criterion, 0);
    await api.submitCard(card.id);
    await api.addPenalty(SHOWCASE_EVENT_ID, original.teamId, 1, 'Showcase adjustment');
    await api.sendInvitation('pending-invite');
    await api.sendBroadcast(SHOWCASE_EVENT_ID, { audienceType: 'emails', customEmails: ['nobody@example.test'], subject: 'Demo', body: 'Simulated only.' });
    expect(calls).toHaveLength(loadCalls);
    expect(seed).toEqual(before);
    expect((await api.listCards(SHOWCASE_EVENT_ID)).find(c => c.id === original.id)).toEqual(original);
    const reset = await loadShowcase(shared, SHOWCASE_EVENT_ID);
    expect((await reset.getSession())?.userId).not.toBe((await api.getSession())?.userId);
    expect(await reset.listPenalties(SHOWCASE_EVENT_ID)).toEqual([]);
    expect(await reset.listBroadcasts(SHOWCASE_EVENT_ID)).toEqual([]);
    expect((await reset.listCards(SHOWCASE_EVENT_ID))).toHaveLength(1);
  });

  it('simulates releasing and emailing results without a shared write', async () => {
    const { api: shared, calls, seed } = readOnlySource();
    const api = await loadShowcase(shared, SHOWCASE_EVENT_ID);
    const loadCalls = calls.length;
    await api.setReleased(SHOWCASE_EVENT_ID, true);
    const packet = await api.previewResultsPacket(SHOWCASE_EVENT_ID, seed.teams[0].id);
    expect(packet.cards[0].feedback.overall).toBe(seed.feedback[0].overall);
    await expect(api.sendTeamResults(SHOWCASE_EVENT_ID, seed.teams[0].id, {
      snapshotId: seed.snapshot.id, awardsVersion: seed.mail.version!, email: seed.contacts[0].managerEmail,
    })).resolves.toBe('sent');
    expect(calls).toHaveLength(loadCalls);
    expect(seed.event.resultsReleased).toBe(false);
    expect(seed.mail.deliveries).toEqual([]);
  });

  it('refuses other events, missing sessions, insufficient roles and incomplete MFA', async () => {
    const {api, calls, reads, seed} = readOnlySource();
    await expect(loadShowcase(api, 'other-event')).rejects.toMatchObject({code: 'forbidden'});
    expect(calls).toEqual([]);
    reads.getSession = () => null;
    await expect(loadShowcase(api, SHOWCASE_EVENT_ID)).rejects.toMatchObject({code: 'unauthenticated'});
    reads.getSession = () => ({userId: 'owner', email: 'owner@example.test'});
    reads.getMfaStatus = () => ({ currentLevel: 'aal1', nextLevel: 'aal2' });
    await expect(loadShowcase(api, SHOWCASE_EVENT_ID)).rejects.toMatchObject({code: 'unauthenticated'});
    reads.getMfaStatus = () => ({ currentLevel: 'aal2', nextLevel: 'aal2' });
    reads.myRoles = () => [{...seed.roles[0], role: 'judge'}];
    await expect(loadShowcase(api, SHOWCASE_EVENT_ID)).rejects.toMatchObject({code: 'forbidden'});
    expect(calls).not.toContain('listCards');
  });

  it('fails closed when source data cannot be read or the account changes', async () => {
    const {api, reads} = readOnlySource();
    reads.listCards = () => {throw new Error('Offline');};
    await expect(loadShowcase(api, SHOWCASE_EVENT_ID)).rejects.toThrow('Offline');
    reads.listCards = () => [];
    let readsOfSession = 0;
    reads.getSession = () => ({userId: ++readsOfSession === 1 ? 'owner' : 'other', email: 'owner@example.test'});
    await expect(loadShowcase(api, SHOWCASE_EVENT_ID)).rejects.toMatchObject({code: 'unauthenticated'});
  });
});
