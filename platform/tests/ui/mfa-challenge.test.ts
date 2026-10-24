// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { MemoryApi } from '../../src/api';
import { mfaChallengeScreen } from '../../src/ui/mfa-challenge';
import { makeCtx, text } from './helpers';

describe('mfaChallengeScreen', () => {
  it('submits a valid 6-digit code and calls onSuccess', async () => {
    const api = new MemoryApi();
    await api.signIn('user@test.org');
    const enroll = await api.enrollTotp();
    await api.verifyTotp(enroll.id, '123456');

    // Simulate re-login where AAL2 is required
    await api.signIn('user@test.org');
    const { ctx } = makeCtx(api);

    const onSuccess = vi.fn();
    const el = mfaChallengeScreen(ctx, { factorId: enroll.id, onSuccess });

    const input = el.querySelector<HTMLInputElement>('input[name=code]')!;
    const form = el.querySelector('form')!;

    input.value = '123456';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    await new Promise((r) => setTimeout(r, 0));
    expect(onSuccess).toHaveBeenCalled();
    const status = await api.getMfaStatus();
    expect(status.currentLevel).toBe('aal2');
  });

  it('rejects input with less than 6 digits', async () => {
    const api = new MemoryApi();
    const { ctx } = makeCtx(api);
    const el = mfaChallengeScreen(ctx);

    const input = el.querySelector<HTMLInputElement>('input[name=code]')!;
    const form = el.querySelector('form')!;
    input.value = '123';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    await new Promise((r) => setTimeout(r, 0));
    const alert = el.querySelector<HTMLElement>('[role=alert]')!;
    expect(alert.hidden).toBe(false);
    expect(text(alert)).toContain('6-digit verification code');
  });

  it('shows error message when wrong code is entered', async () => {
    const api = new MemoryApi();
    await api.signIn('user@test.org');
    const enroll = await api.enrollTotp();
    await api.verifyTotp(enroll.id, '123456');

    await api.signIn('user@test.org');
    const { ctx } = makeCtx(api);

    const el = mfaChallengeScreen(ctx, { factorId: enroll.id });
    const input = el.querySelector<HTMLInputElement>('input[name=code]')!;
    const form = el.querySelector('form')!;

    // 000000 triggers invalid-auth in MemoryApi
    input.value = '000000';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    await new Promise((r) => setTimeout(r, 0));
    const alert = el.querySelector<HTMLElement>('[role=alert]')!;
    expect(alert.hidden).toBe(false);
    expect(text(alert)).toContain('Invalid authenticator code');
  });

  it('signs out or invokes onCancel when cancel is clicked', async () => {
    const api = new MemoryApi();
    await api.signIn('user@test.org');
    const { ctx } = makeCtx(api);

    const onCancel = vi.fn();
    const el = mfaChallengeScreen(ctx, { onCancel });

    const cancelBtn = el.querySelectorAll<HTMLButtonElement>('button')[1];
    cancelBtn.click();

    expect(onCancel).toHaveBeenCalled();
  });
});
