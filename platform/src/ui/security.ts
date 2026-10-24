import { buttonBusy } from './button-busy';
import type { Ctx } from './ctx';
import { errorText } from './common';
import { h } from './dom';

export async function securityScreen(ctx: Ctx): Promise<HTMLElement> {
  const container = h('div', { class: 'stack stack--lg security-screen' });
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const notice = h('p', { class: 'notice', role: 'status', hidden: true });

  let alive = true;
  ctx.onLeave(() => { alive = false; });

  const mfa = await ctx.api.getMfaStatus();

  const header = h('div', { class: 'stack' },
    h('p', { class: 'eyebrow' }, 'STEM Racing India · Account Security'),
    h('h1', null, 'Two-factor authentication (2FA)'),
    h('p', { class: 'lead' }, 'Protect your account using an authenticator app (such as Google Authenticator, Microsoft Authenticator, 1Password, or Apple Passwords).'),
  );

  const statusSection = h('section', { class: 'section stack' });

  if (mfa.enabled) {
    statusSection.append(
      h('div', { class: 'stack' },
        h('div', { class: 'row__head' },
          h('h2', null, 'Status:'),
          h('span', { class: 'tag tag--pass' }, '2FA Enabled'),
        ),
        h('p', { class: 'muted' }, 'Your account is protected. You will be prompted for an authenticator code when signing in.'),
      ),
      h('ul', { class: 'list' }, mfa.factors.filter((f) => f.status === 'verified').map((factor) => {
        const item = h('li', { class: 'stack' },
          h('div', { class: 'row__head' },
            h('strong', null, factor.friendlyName || 'Authenticator App (TOTP)'),
            factor.createdAt ? h('span', { class: 'muted small' }, `Added ${new Date(factor.createdAt).toLocaleDateString()}`) : null,
          ),
        );

        const removeBtn = h('button', { class: 'btn btn--ghost btn--small', type: 'button' }, 'Remove authenticator app');
        const confirmBtn = h('button', { class: 'btn btn--primary btn--small', type: 'button', hidden: true }, 'Confirm removal');
        const cancelBtn = h('button', { class: 'btn btn--ghost btn--small', type: 'button', hidden: true }, 'Cancel');
        const confirmMsg = h('p', { class: 'muted small', hidden: true }, 'Are you sure? Removing this will disable two-factor authentication for your account.');

        removeBtn.addEventListener('click', () => {
          removeBtn.hidden = true;
          confirmBtn.hidden = false;
          cancelBtn.hidden = false;
          confirmMsg.hidden = false;
        });

        cancelBtn.addEventListener('click', () => {
          removeBtn.hidden = false;
          confirmBtn.hidden = true;
          cancelBtn.hidden = true;
          confirmMsg.hidden = true;
        });

        confirmBtn.addEventListener('click', async () => {
          confirmBtn.disabled = true;
          const finish = buttonBusy(confirmBtn, 'Removing…');
          error.hidden = true;
          try {
            await ctx.api.unenrollTotp(factor.id);
            if (alive) ctx.rerender();
          } catch (err) {
            confirmBtn.disabled = false;
            error.textContent = errorText(err);
            error.hidden = false;
          } finally {
            finish();
          }
        });

        item.append(h('div', { class: 'actions' }, removeBtn, confirmBtn, cancelBtn), confirmMsg);
        return item;
      })),
    );
  } else {
    const setupCard = h('div', { class: 'card stack', hidden: true });
    const setupBtn = h('button', { class: 'btn btn--primary', type: 'button' }, 'Set up authenticator app');

    setupBtn.addEventListener('click', async () => {
      setupBtn.disabled = true;
      const finishSetupBusy = buttonBusy(setupBtn, 'Generating setup…');
      error.hidden = true;
      try {
        const enroll = await ctx.api.enrollTotp('Authenticator App');
        setupBtn.hidden = true;
        renderSetupCard(setupCard, enroll);
        setupCard.hidden = false;
      } catch (err) {
        setupBtn.disabled = false;
        error.textContent = errorText(err);
        error.hidden = false;
      } finally {
        finishSetupBusy();
      }
    });

    statusSection.append(
      h('div', { class: 'stack' },
        h('div', { class: 'row__head' },
          h('h2', null, 'Status:'),
          h('span', { class: 'tag tag--todo' }, 'Not Enabled'),
        ),
        h('p', { class: 'muted' }, 'Add an extra layer of security so that only someone with your phone or authenticator app can access your account.'),
      ),
      setupBtn,
      setupCard,
    );
  }

  function renderSetupCard(card: HTMLElement, enroll: { id: string; totp: { qrCode: string; secret: string; uri: string } }) {
    const setupError = h('p', { class: 'alert', role: 'alert', hidden: true });
    const verifyCode = h('input', {
      type: 'text',
      name: 'verifyCode',
      required: true,
      autocomplete: 'one-time-code',
      inputmode: 'numeric',
      maxlength: 6,
      placeholder: '123456',
    });
    const activateBtn = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Verify and activate');
    const cancelSetupBtn = h('button', { class: 'btn btn--ghost', type: 'button' }, 'Cancel setup');

    const copyBtn = h('button', { class: 'btn btn--ghost btn--small', type: 'button' }, 'Copy key');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(enroll.totp.secret);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy key'; }, 2000);
      } catch {
        copyBtn.textContent = 'Copy failed';
      }
    });

    const qrSrc = enroll.totp.qrCode.startsWith('data:')
      ? enroll.totp.qrCode
      : `data:image/svg+xml;utf-8,${encodeURIComponent(enroll.totp.qrCode)}`;

    const form = h('form', { class: 'stack', novalidate: true },
      h('label', { class: 'field' },
        h('span', { class: 'field__label' }, 'Enter 6-digit code from app'),
        verifyCode,
      ),
      h('div', { class: 'actions' }, activateBtn, cancelSetupBtn),
    );

    let busy = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      setupError.hidden = true;
      const token = verifyCode.value.replace(/\s/g, '');
      if (!/^\d{6}$/.test(token)) {
        setupError.textContent = 'Enter the 6-digit code shown in your authenticator app.';
        setupError.hidden = false;
        verifyCode.focus();
        return;
      }

      busy = true;
      const finish = buttonBusy(activateBtn, 'Verifying…');
      try {
        await ctx.api.verifyTotp(enroll.id, token);
        if (alive) ctx.rerender();
      } catch (err) {
        setupError.textContent = (err && typeof err === 'object' && 'code' in err && err.code === 'invalid-auth')
          ? 'Invalid authenticator code. Check your authenticator app and try again.'
          : errorText(err);
        setupError.hidden = false;
        verifyCode.select();
      } finally {
        busy = false;
        finish();
      }
    });

    cancelSetupBtn.addEventListener('click', async () => {
      try {
        await ctx.api.unenrollTotp(enroll.id);
      } catch { /* clean-up fallback */ }
      if (alive) ctx.rerender();
    });

    card.replaceChildren(
      h('h3', null, 'Set up your authenticator app'),
      h('ol', { class: 'stack mfa-steps' },
        h('li', null,
          h('strong', null, '1. Scan this QR code'),
          h('p', { class: 'muted small' }, 'Use Google Authenticator, Microsoft Authenticator, 1Password, Apple Passwords, or any standard TOTP app.'),
          h('div', { class: 'mfa-qr' },
            h('img', { src: qrSrc, alt: 'Authenticator QR code', width: 200, height: 200 }),
          ),
        ),
        h('li', null,
          h('strong', null, 'Or enter secret key manually:'),
          h('div', { class: 'mfa-secret-box' },
            h('code', { class: 'mfa-secret' }, enroll.totp.secret),
            copyBtn,
          ),
        ),
        h('li', null,
          h('strong', null, '2. Enter the 6-digit verification code:'),
          form,
        ),
      ),
      setupError,
    );
  }

  container.append(
    h('a', { class: 'back', href: '#/' }, '← Back to events'),
    header,
    notice,
    error,
    statusSection,
  );

  return container;
}
