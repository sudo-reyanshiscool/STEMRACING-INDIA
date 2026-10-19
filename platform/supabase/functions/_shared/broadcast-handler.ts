import { renderBroadcastHtml } from './broadcast-template.ts';

export interface BroadcastDeps {
  authenticate(token: string): Promise<{ userId: string; email: string } | null>;
  isChairOrOrganiser(token: string, eventId: string): Promise<boolean>;
  getRecipients(token: string, eventId: string, input: any): Promise<string[]>;
  recordBroadcast(token: string, eventId: string, sender: { userId: string; email: string }, input: any, recipientCount: number): Promise<any>;
  sendMail(recipients: string[], subject: string, html: string): Promise<{ ok: boolean; error?: string; failed?: string[] }>;
}

const origins = new Set([
  'https://stemracingindia-events.vercel.app',
  'http://127.0.0.1:5174',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
]);

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function broadcastHandler(deps: BroadcastDeps) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
    };
    if (origin && origins.has(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    }

    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers });

    if (origin && !origins.has(origin)) return reply(403, { code: 'forbidden' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(405, { code: 'method_not_allowed' });

    const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return reply(401, { code: 'unauthenticated' });

    let body: any;
    try {
      const raw = await request.text();
      if (raw.length > 65536) return reply(400, { code: 'invalid', message: 'Payload too large' });
      body = JSON.parse(raw);
    } catch {
      return reply(400, { code: 'invalid', message: 'Malformed JSON' });
    }

    const eventId = body?.eventId;
    if (typeof eventId !== 'string' || !uuid.test(eventId)) {
      return reply(400, { code: 'invalid', message: 'Invalid eventId' });
    }

    const subject = (body?.subject ?? '').trim();
    const content = (body?.body ?? '').trim();
    if (!subject || !content) {
      return reply(400, { code: 'invalid', message: 'Subject and body are required' });
    }

    const sender = await deps.authenticate(token);
    if (!sender) return reply(401, { code: 'unauthenticated' });

    const allowed = await deps.isChairOrOrganiser(token, eventId);
    if (!allowed) return reply(403, { code: 'forbidden', message: 'Chair or Organiser access required' });

    const recipients = await deps.getRecipients(token, eventId, body);
    const uniqueRecipients = Array.from(new Set(recipients.map((e) => e.trim().toLowerCase()).filter(Boolean)));

    const html = renderBroadcastHtml({
      subject,
      category: body.category,
      body: content,
      buttonText: body.buttonText,
      buttonUrl: body.buttonUrl,
    });

    const sendRes = await deps.sendMail(uniqueRecipients, subject, html);
    if (!sendRes.ok) {
      return reply(502, {
        code: 'delivery_failed',
        message: sendRes.error || 'Failed to dispatch emails via SMTP. Ensure SMTP credentials are set in Supabase Secrets.',
      });
    }

    const record = await deps.recordBroadcast(token, eventId, sender, body, uniqueRecipients.length);
    return reply(200, record);
  };
}
