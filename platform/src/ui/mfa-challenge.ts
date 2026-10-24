import { buttonBusy } from './button-busy';
import type { Ctx } from './ctx';
import { errorText } from './common';
import { h } from './dom';

export interface MfaChallengeOptions {
  factorId?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function mfaChallengeScreen(ctx: Ctx, options: MfaChallengeOptions = {}): HTMLElement {
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const code = h('input', {
    type: 'text',
    name: 'code',
    required: true,
    autocomplete: 'one-time-code',
    inputmode: 'numeric',
    maxlength: 6,
    placeholder: '123456',
    autofocus: true,
  });
  const submitBtn = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Verify code');
  const cancelBtn = h('button', { class: 'btn btn--ghost', type: 'button' }, 'Cancel and sign out');

  let busy = false;
  let finishBusy = () => {};
  const setBusy = (value: boolean) => {
    busy = value;
    if (value) finishBusy = buttonBusy(submitBtn, 'Verifying…');
    else finishBusy();
    submitBtn.disabled = value;
    cancelBtn.disabled = value;
  };

  const form = h('form', { class: 'stack', novalidate: true },
    h('label', { class: 'field' },
      h('span', { class: 'field__label' }, '6-digit authenticator code'),
      code,
    ),
    h('div', { class: 'actions' },
      submitBtn,
      cancelBtn,
    ),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    error.hidden = true;
    const token = code.value.replace(/\s/g, '');
    if (!/^\d{6}$/.test(token)) {
      error.textContent = 'Enter the 6-digit verification code from your authenticator app.';
      error.hidden = false;
      code.focus();
      return;
    }

    setBusy(true);
    try {
      await ctx.api.verifyTotp(options.factorId ?? '', token);
      if (options.onSuccess) options.onSuccess();
      else ctx.rerender();
    } catch (err) {
      error.textContent = (err && typeof err === 'object' && 'code' in err && err.code === 'invalid-auth')
        ? 'Invalid authenticator code. Check your authenticator app and try again.'
        : errorText(err);
      error.hidden = false;
      code.select();
    } finally {
      setBusy(false);
    }
  });

  cancelBtn.addEventListener('click', async () => {
    if (busy) return;
    if (options.onCancel) options.onCancel();
    else {
      await ctx.api.signOut();
      ctx.rerender();
    }
  });

  return h('div', { class: 'stack stack--lg mfa-challenge-screen' },
    h('p', { class: 'eyebrow' }, 'STEM Racing India · Two-Factor Authentication'),
    h('h1', null, 'Enter authenticator code'),
    h('p', { class: 'lead' }, 'Open your authenticator app (such as Google Authenticator, Microsoft Authenticator, 1Password, or Apple Passwords) and enter the 6-digit code for your account.'),
    error,
    form,
  );
}
