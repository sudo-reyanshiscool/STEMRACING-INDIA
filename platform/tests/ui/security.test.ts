// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { MemoryApi } from '../../src/api';
import { securityScreen } from '../../src/ui/security';
import { makeCtx, text } from './helpers';

describe('securityScreen', () => {
  it('renders disabled state and allows setting up an authenticator app', async () => {
    const api = new MemoryApi();
    await api.signIn('user@test.org');
    const { ctx } = makeCtx(api);

    const el = await securityScreen(ctx);
    expect(text(el)).toContain('Not Enabled');
    expect(text(el)).toContain('Two-factor authentication');

    const setupBtn = el.querySelector<HTMLButtonElement>('.section > button')!;
    expect(setupBtn).toBeTruthy();
    expect(text(setupBtn)).toContain('Set up authenticator app');

    setupBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(text(el)).toContain('Set up your authenticator app');
    expect(text(el)).toContain('JBSWY3DPEHPK3PXP');
    expect(el.querySelector('.mfa-qr img')).toBeTruthy();

    const codeInput = el.querySelector<HTMLInputElement>('input[name=verifyCode]')!;
    const form = codeInput.closest('form')!;

    // Submit valid code
    codeInput.value = '123456';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.rerender).toHaveBeenCalled();

    const status = await api.getMfaStatus();
    expect(status.enabled).toBe(true);
  });

  it('renders active 2FA state and allows removing authenticator app', async () => {
    const api = new MemoryApi();
    await api.signIn('user@test.org');
    const enroll = await api.enrollTotp('My Phone');
    await api.verifyTotp(enroll.id, '123456');

    const { ctx } = makeCtx(api);
    const el = await securityScreen(ctx);

    expect(text(el)).toContain('2FA Enabled');
    expect(text(el)).toContain('My Phone');

    const removeBtn = el.querySelector<HTMLButtonElement>('.actions > button')!;
    expect(text(removeBtn)).toContain('Remove authenticator app');

    removeBtn.click();
    const confirmBtn = el.querySelectorAll<HTMLButtonElement>('.actions > button')[1];
    expect(confirmBtn.hidden).toBe(false);
    expect(text(confirmBtn)).toContain('Confirm removal');

    confirmBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(ctx.rerender).toHaveBeenCalled();
    const status = await api.getMfaStatus();
    expect(status.enabled).toBe(false);
  });

  it('validates 6-digit code during setup and reports error', async () => {
    const api = new MemoryApi();
    await api.signIn('user@test.org');
    const { ctx } = makeCtx(api);

    const el = await securityScreen(ctx);
    const setupBtn = el.querySelector<HTMLButtonElement>('.section > button')!;
    setupBtn.click();
    await new Promise((r) => setTimeout(r, 0));

    const codeInput = el.querySelector<HTMLInputElement>('input[name=verifyCode]')!;
    const form = codeInput.closest('form')!;

    // Invalid format (less than 6 digits)
    codeInput.value = '12';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));

    const alert = el.querySelector<HTMLElement>('.card [role=alert]')!;
    expect(alert.hidden).toBe(false);
    expect(text(alert)).toContain('6-digit code');

    // Wrong code
    codeInput.value = '000000';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(alert.hidden).toBe(false);
    expect(text(alert)).toContain('Invalid authenticator code');
  });
});
