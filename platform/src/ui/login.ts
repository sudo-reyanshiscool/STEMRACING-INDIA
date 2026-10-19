import type { Ctx } from './ctx';
import { codeText, errorText, isPlausibleEmail } from './common';
import { h } from './dom';

export function loginScreen(ctx: Ctx, options: { authError?: string; showCode?: boolean } = {}): HTMLElement {
  const notice = h('p', { class: 'notice', role: 'status', hidden: true });
  const error = h('p', { class: 'alert', role: 'alert', hidden: !options.authError }, options.authError ?? '');
  const email = h('input', { type: 'email', name: 'email', required: true, autocomplete: 'email', inputmode: 'email' });
  const submitBtn = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Send sign-in email');
  const code = h('input', { type: 'text', name: 'code', required: true, autocomplete: 'one-time-code', inputmode: 'numeric', maxlength: 12 });
  const verifyBtn = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Verify code and sign in');
  const codeForm = h('form', { class: 'stack', novalidate: true, 'aria-label': 'Verify email code' },
    h('p', { class: 'muted small' }, 'Use the email address above and the code from your latest email.'),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Verification code'), code), verifyBtn,
  );
  const codeSection = h('details', { class: 'section' }, h('summary', null, 'Have a sign-in code?'), codeForm);
  codeSection.open = options.showCode ?? !!options.authError;
  let busy = false;
  const setBusy = (value: boolean) => { busy = value; submitBtn.disabled = value; verifyBtn.disabled = value; };
  const validEmail = () => {
    if (isPlausibleEmail(email.value)) return true;
    error.textContent = 'Enter a valid email address, for example name@school.org.'; error.hidden = false; return false;
  };
  const form = h('form', { class: 'stack', novalidate: true },
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Email address'), email), submitBtn,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    error.hidden = true; notice.hidden = true;
    if (!validEmail()) return;
    const address = email.value.trim().toLowerCase();
    setBusy(true);
    try {
      await ctx.api.signIn(address);
      if (await ctx.api.getSession()) ctx.rerender();
      else {
        notice.textContent = `We sent a sign-in email to ${address}. Open its link and confirm, or enter the code below. Use the newest email; older links may no longer work.`;
        notice.hidden = false; codeSection.open = true;
      }
    } catch (err) { error.textContent = errorText(err); error.hidden = false; }
    finally { setBusy(false); }
  });
  codeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    error.hidden = true; notice.hidden = true;
    if (!validEmail()) return;
    const token = code.value.replace(/\s/g, '');
    if (!/^\d{6,10}$/.test(token)) {
      error.textContent = 'Enter the verification code from your latest email (6–10 digits).'; error.hidden = false; return;
    }
    setBusy(true);
    try {
      await ctx.flush();
      await ctx.api.verifyEmailCode(email.value.trim().toLowerCase(), token);
      code.value = '';
      ctx.rerender();
    } catch (err) { error.textContent = errorText(err); error.hidden = false; }
    finally { setBusy(false); }
  });
  const waiting = ctx.queue.status().pending;
  return h('div', { class: 'stack stack--lg' },
    h('h1', null, 'Sign in'),
    h('p', { class: 'lead' }, 'Use the email address your event organiser invited.'),
    waiting > 0
      ? h('p', { class: 'notice' }, `${codeText('unauthenticated')}. ${waiting} score${waiting === 1 ? ' is' : 's are'} waiting on this device and will be sent once you are signed in.`)
      : null,
    notice, error, form, ctx.demo ? null : codeSection,
    h('p', { class: 'muted small' }, 'Results that have been released can be viewed without signing in.'),
  );
}
