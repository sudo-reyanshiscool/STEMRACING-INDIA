import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import nodemailer from 'npm:nodemailer@6.9.16';
import { broadcastHandler } from '../_shared/broadcast-handler.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const schema = Deno.env.get('SUPABASE_DB_SCHEMA') || 'stem_racing';

const options = { auth: { persistSession: false, autoRefreshToken: false, flowType: 'implicit' as const }, db: { schema } };
const caller = (token: string) => createClient(url, anon, { ...options, global: { headers: { Authorization: `Bearer ${token}` } } });
const admin = createClient(url, service, options);

// SMTP configuration from Supabase environment secrets
const smtpHost = Deno.env.get('SMTP_HOST');
const smtpPort = parseInt(Deno.env.get('SMTP_PORT') || '587', 10);
const smtpUser = Deno.env.get('SMTP_USER');
const smtpPass = Deno.env.get('SMTP_PASS');
const smtpFrom = Deno.env.get('SMTP_FROM') || 'STEM Racing India <events@stemracingindia.com>';

Deno.serve(broadcastHandler({
  async authenticate(token) {
    const { data, error } = await caller(token).auth.getUser(token);
    if (error || !data.user) return null;
    return { userId: data.user.id, email: data.user.email ?? '' };
  },

  async isChairOrOrganiser(token, eventId) {
    const { data, error } = await caller(token).rpc('is_chair_or_organiser', { ev: eventId });
    return !error && data === true;
  },

  async getRecipients(token, eventId, input) {
    if (input.audienceType === 'emails') {
      return (input.customEmails ?? []).map((e: string) => e.trim()).filter(Boolean);
    }

    const c = caller(token);
    const emails: string[] = [];

    if (input.audienceType === 'all_judges') {
      const { data: roles } = await c.from('event_roles').select('email').eq('event_id', eventId).in('role', ['judge', 'lead_judge']);
      for (const r of roles ?? []) if (r.email) emails.push(r.email);
      const { data: invites } = await c.from('invitations').select('email').eq('event_id', eventId).in('role', ['judge', 'lead_judge']);
      for (const i of invites ?? []) if (i.email) emails.push(i.email);
    } else if (input.audienceType === 'panel') {
      const { data: roles } = await c.from('event_roles').select('email').eq('event_id', eventId).in('role', ['judge', 'lead_judge']).eq('panel', input.panel);
      for (const r of roles ?? []) if (r.email) emails.push(r.email);
      const { data: invites } = await c.from('invitations').select('email').eq('event_id', eventId).in('role', ['judge', 'lead_judge']).eq('panel', input.panel);
      for (const i of invites ?? []) if (i.email) emails.push(i.email);
    } else if (input.audienceType === 'specific_judges') {
      const judgeIds: string[] = input.judgeIds ?? [];
      if (judgeIds.length > 0) {
        const { data: roles } = await c.from('event_roles').select('email').eq('event_id', eventId).in('user_id', judgeIds);
        for (const r of roles ?? []) if (r.email) emails.push(r.email);
      }
    }

    return emails;
  },

  async recordBroadcast(token, eventId, sender, input, recipientCount) {
    const { data, error } = await caller(token).from('broadcast_emails').insert({
      event_id: eventId,
      sender_id: sender.userId,
      sender_email: sender.email,
      audience_type: input.audienceType,
      panel: input.panel ?? null,
      recipient_count: recipientCount,
      subject: input.subject,
      category: input.category ?? null,
      body: input.body,
      button_text: input.buttonText ?? null,
      button_url: input.buttonUrl ?? null,
    }).select().single();

    if (error) throw error;
    return data;
  },

  async sendMail(recipients, subject, html) {
    if (recipients.length === 0) return { ok: true };

    if (!smtpHost) {
      console.warn('No SMTP_HOST configured. Broadcast email logged but not sent over SMTP.');
      return { ok: true };
    }

    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
      });

      // Send to recipients (BCC to protect recipient privacy)
      await transporter.sendMail({
        from: smtpFrom,
        to: smtpFrom,
        bcc: recipients,
        subject,
        html,
      });

      return { ok: true };
    } catch (e) {
      console.error('SMTP sending error:', e);
      return { ok: false };
    }
  },
}));
