import { errorText } from './common';
import type { Ctx } from './ctx';
import { h } from './dom';

/** Visiting a mail link never consumes it. Only this explicit action verifies the email token. */
export function emailConfirmScreen(ctx: Ctx, tokenHash: string, finished: () => void, cancel: () => void): HTMLElement {
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const button = h('button', { class: 'btn btn--primary', type: 'button' }, 'Confirm and sign in');
  let busy = false;
  let alive = true;
  ctx.onLeave(() => { alive = false; });
  button.addEventListener('click', async () => {
    if (busy) return;
    busy = true; button.disabled = true; error.hidden = true;
    try {
      await ctx.flush();
      await ctx.api.verifyEmailLink(tokenHash);
      finished();
    } catch (e) {
      if (alive) { error.textContent = errorText(e); error.hidden = false; }
    } finally {
      busy = false; if (alive) button.disabled = false;
    }
  });
  const alternative = h('button', { class: 'btn btn--ghost', type: 'button', onclick: cancel }, 'Use an email code instead');
  return h('div', { class: 'stack stack--lg' },
    h('h1', null, 'Finish signing in'),
    h('p', { class: 'lead' }, 'Confirm to sign in with the account this email was sent to. Your assigned events will open next.'),
    error, button, alternative,
    h('p', { class: 'muted small' }, 'If this link has expired, request a new email or enter the code from your latest email.'),
  );
}
