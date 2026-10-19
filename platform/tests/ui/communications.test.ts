// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { communicationsScreen } from '../../src/ui/communications';
import { EMAILS, makeCtx, text, world } from './helpers';

const wait = () => new Promise((r) => setTimeout(r, 0));

describe('communicationsScreen', () => {
  it('renders audience options, composer inputs, and preview card', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await communicationsScreen(ctx, ev.id);

    // Form elements
    expect(el.querySelector('select[name=audienceType]')).not.toBeNull();
    expect(el.querySelector('input[name=subject]')).not.toBeNull();
    expect(el.querySelector('textarea[name=body]')).not.toBeNull();
    expect(el.querySelector('button[type=submit]')).not.toBeNull();

    // Live preview elements
    const preview = el.querySelector('[data-role=email-preview]');
    expect(preview).not.toBeNull();
  });

  it('updates the live preview as the user types subject and body', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await communicationsScreen(ctx, ev.id);

    const subjectInput = el.querySelector('input[name=subject]') as HTMLInputElement;
    const bodyInput = el.querySelector('textarea[name=body]') as HTMLTextAreaElement;

    subjectInput.value = 'Pit Lane Opening Time';
    subjectInput.dispatchEvent(new Event('input', { bubbles: true }));

    bodyInput.value = 'Please arrive by 8:00 AM sharp.';
    bodyInput.dispatchEvent(new Event('input', { bubbles: true }));

    const preview = el.querySelector('[data-role=email-preview]')!;
    expect(preview.textContent).toContain('Pit Lane Opening Time');
    expect(preview.textContent).toContain('Please arrive by 8:00 AM sharp.');
  });

  it('sends an email broadcast and lists it in broadcast history', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await communicationsScreen(ctx, ev.id);

    const subjectInput = el.querySelector('input[name=subject]') as HTMLInputElement;
    const bodyInput = el.querySelector('textarea[name=body]') as HTMLTextAreaElement;

    subjectInput.value = 'National Finals Briefing';
    bodyInput.value = 'Welcome everyone to the competition.';

    const form = el.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await wait();

    const history = el.querySelector('[data-role=broadcast-history]')!;
    expect(history.textContent).toContain('National Finals Briefing');
  });
});
