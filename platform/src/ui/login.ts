import type { Ctx } from './ctx';
import { codeText, errorText, isPlausibleEmail } from './common';
import { h } from './dom';

export function loginScreen(ctx: Ctx): HTMLElement {
  const notice = h('p', { class: 'notice', role: 'status', hidden: true });
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const email = h('input', { type: 'email', name: 'email', required: true, autocomplete: 'email', inputmode: 'email' });
  const submitBtn = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Send sign-in link');
  let busy = false;
  const form = h('form', { class: 'stack', novalidate: true },
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Email address'), email),
    submitBtn,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    error.hidden = true;
    notice.hidden = true;
    // Validate before going busy, so a typo never leaves the form disabled.
    if (!isPlausibleEmail(email.value)) {
      error.textContent = 'Enter a valid email address, for example name@school.org.';
      error.hidden = false;
      return;
    }
    busy = true;
    submitBtn.disabled = true;
    try {
      await ctx.api.signIn(email.value);
      if (await ctx.api.getSession()) {
        ctx.rerender();
      } else {
        notice.textContent = `We sent a sign-in link to ${email.value.trim()}. Open it on this device to continue.`;
        notice.hidden = false;
      }
    } catch (err) {
      error.textContent = errorText(err);
      error.hidden = false;
    } finally {
      busy = false;
      submitBtn.disabled = false;
    }
  });
  const waiting = ctx.queue.status().pending;
  return h('div', { class: 'stack stack--lg' },
    h('h1', null, 'Sign in'),
    h('p', { class: 'lead' }, 'Use the email address your event organiser invited.'),
    waiting > 0
      ? h('p', { class: 'notice' }, `${codeText('unauthenticated')}. ${waiting} score${waiting === 1 ? ' is' : 's are'} waiting on this device and will be sent once you are signed in.`)
      : null,
    notice, error, form,
    h('p', { class: 'muted small' }, 'Results that have been released can be viewed without signing in.'),
  );
}
