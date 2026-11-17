// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { eventNav } from '../../src/ui/event-nav';
import { graphicsScreen } from '../../src/ui/graphics';
import { EMAILS, makeCtx, world } from './helpers';

const labels = (nav: HTMLElement) => [...nav.querySelectorAll('a')].map((a) => a.textContent);

describe('graphics tab', () => {
  it('is offered to organisers and the Chair only', async () => {
    const { api, ev } = await world();
    for (const [email, shown] of [[EMAILS.org, true], [EMAILS.chair, true], [EMAILS.judge, false], [EMAILS.mgr, false]] as const) {
      await api.signIn(email);
      const nav = eventNav((await api.getEvent(ev.id))!, await api.myRoles(ev.id), 'event');
      expect(labels(nav).includes('Graphics'), email).toBe(shown);
    }
  });

  it('opens the control page for an organiser and refuses a team manager', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const made = makeCtx(api);
    const screen = await graphicsScreen(made.ctx, ev.id);
    const frame = screen.querySelector('iframe')!;
    expect(frame.getAttribute('src')).toMatch(/graphics\/control\.html\?platform=1$/);
    expect(screen.querySelector('h1')!.textContent).toBe('Graphics');
    await api.signIn(EMAILS.mgr);
    const refused = await graphicsScreen(makeCtx(api).ctx, ev.id);
    expect(refused.querySelector('iframe')).toBeNull();
    expect(refused.textContent).toContain('organisers and the Chair');
  });
});
