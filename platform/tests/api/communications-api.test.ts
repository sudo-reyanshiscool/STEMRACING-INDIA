import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryApi } from '../../src/api/memory';
import { INDIA_2026 } from '../../src/rulesets';
import type { NewBroadcastInput } from '../../src/api/types';

describe('Communications API (MemoryApi)', () => {
  let api: MemoryApi;
  let eventId: string;

  beforeEach(async () => {
    api = new MemoryApi();
    api.setCreatorAllowlist(['organiser@example.com']);
    await api.signIn('organiser@example.com');
    const ev = await api.createEvent({ name: 'National Finals 2026' });
    eventId = ev.id;
  });

  it('allows organiser to send and list broadcasts', async () => {
    const input: NewBroadcastInput = {
      audienceType: 'all_judges',
      subject: 'Morning Briefing',
      category: 'SCHEDULE',
      body: 'All judges please report to briefing room 2 at 8:30 AM.',
      buttonText: 'View Schedule',
      buttonUrl: 'https://stemracingindia-events.vercel.app/#/schedule',
    };

    const broadcast = await api.sendBroadcast(eventId, input);
    expect(broadcast.id).toBeDefined();
    expect(broadcast.subject).toBe('Morning Briefing');
    expect(broadcast.category).toBe('SCHEDULE');
    expect(broadcast.audienceType).toBe('all_judges');
    expect(broadcast.createdAt).toBeDefined();

    const list = await api.listBroadcasts(eventId);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(broadcast.id);
  });

  it('rejects broadcast with empty subject or body', async () => {
    await expect(
      api.sendBroadcast(eventId, {
        audienceType: 'all_judges',
        subject: '',
        body: 'Some body',
      })
    ).rejects.toThrow();

    await expect(
      api.sendBroadcast(eventId, {
        audienceType: 'all_judges',
        subject: 'Valid Subject',
        body: '',
      })
    ).rejects.toThrow();
  });

  it('resolves recipient count accurately for panel and email targets', async () => {
    // Add roles
    await api.invite(eventId, { email: 'judge1@test.com', name:'Test Judge',role: 'judge', panel: 'verbal' });
    await api.invite(eventId, { email: 'judge2@test.com', name:'Test Judge',role: 'judge', panel: 'verbal' });
    await api.invite(eventId, { email: 'judge3@test.com', name:'Test Judge',role: 'judge', panel: 'design_engineering' });

    // Broadcast to verbal panel
    const b1 = await api.sendBroadcast(eventId, {
      audienceType: 'panel',
      panel: 'verbal',
      subject: 'Verbal Panel Info',
      body: 'Info for verbal judges.',
    });
    expect(b1.recipientCount).toBe(2);

    // Broadcast to custom emails
    const b2 = await api.sendBroadcast(eventId, {
      audienceType: 'emails',
      customEmails: ['custom1@test.com', 'custom2@test.com', 'custom3@test.com', 'custom1@test.com'], // deduplicated
      subject: 'External Notice',
      body: 'Hello external recipients.',
    });
    expect(b2.recipientCount).toBe(3);
  });
});
