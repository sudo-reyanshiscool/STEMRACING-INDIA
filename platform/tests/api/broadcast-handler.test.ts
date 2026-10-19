import { describe, it, expect } from 'vitest';
import { broadcastHandler, type BroadcastDeps } from '../../supabase/functions/_shared/broadcast-handler';

describe('broadcastHandler', () => {
  const dummyDeps: BroadcastDeps = {
    async authenticate(token) {
      if (token === 'valid-token') return { userId: 'u1', email: 'org@x.test' };
      return null;
    },
    async isChairOrOrganiser(token, eventId) {
      return token === 'valid-token' && eventId === '00000000-0000-4000-8000-000000000001';
    },
    async getRecipients(token, eventId, input) {
      if (input.audienceType === 'emails') return input.customEmails ?? [];
      return ['judge1@x.test', 'judge2@x.test'];
    },
    async recordBroadcast(token, eventId, sender, input, recipientCount) {
      return {
        id: 'bcast-123',
        event_id: eventId,
        sender_id: sender.userId,
        sender_email: sender.email,
        audience_type: input.audienceType,
        recipient_count: recipientCount,
        subject: input.subject,
        body: input.body,
        created_at: new Date().toISOString(),
      };
    },
    async sendMail(recipients, subject, html) {
      return { ok: true };
    },
  };

  it('rejects unauthenticated requests with 401', async () => {
    const handler = broadcastHandler(dummyDeps);
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: '00000000-0000-4000-8000-000000000001',
        audienceType: 'all_judges',
        subject: 'Title',
        body: 'Body',
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(401);
  });

  it('rejects unauthorized users with 403', async () => {
    const handler = broadcastHandler(dummyDeps);
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({
        eventId: '00000000-0000-4000-8000-999999999999', // unauthorized event
        audienceType: 'all_judges',
        subject: 'Title',
        body: 'Body',
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(403);
  });

  it('rejects empty subject or body with 400', async () => {
    const handler = broadcastHandler(dummyDeps);
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({
        eventId: '00000000-0000-4000-8000-000000000001',
        audienceType: 'all_judges',
        subject: '',
        body: 'Body',
      }),
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
  });

  it('processes valid broadcast, renders branded HTML, and sends emails', async () => {
    let sentSubject = '';
    let sentRecipients: string[] = [];
    let sentHtml = '';

    const handler = broadcastHandler({
      ...dummyDeps,
      async sendMail(recipients, subject, html) {
        sentRecipients = recipients;
        sentSubject = subject;
        sentHtml = html;
        return { ok: true };
      },
    });

    const req = new Request('http://localhost', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-token',
      },
      body: JSON.stringify({
        eventId: '00000000-0000-4000-8000-000000000001',
        audienceType: 'emails',
        customEmails: ['team1@test.com', 'team2@test.com'],
        subject: 'Schedule Announcement',
        category: 'SCHEDULE',
        body: 'Bring your safety glasses.',
      }),
    });

    const res = await handler(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('bcast-123');
    expect(sentSubject).toBe('Schedule Announcement');
    expect(sentRecipients).toEqual(['team1@test.com', 'team2@test.com']);
    expect(sentHtml).toContain('STEM RACING INDIA');
    expect(sentHtml).toContain('Bring your safety glasses.');
  });
});
