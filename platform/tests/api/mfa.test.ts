import { describe, expect, it } from 'vitest';
import { ApiError, MemoryApi } from '../../src/api';
import { mapAuthError } from '../../src/api/mappers';

describe('MFA Authenticator App API', () => {
  it('manages TOTP factor lifecycle: enroll, verify, check status, and unenroll', async () => {
    const api = new MemoryApi();
    expect(await api.getMfaStatus()).toEqual({
      enabled: false,
      factors: [],
      currentLevel: null,
      nextLevel: null,
    });

    await api.signIn('user@test.org');
    let status = await api.getMfaStatus();
    expect(status.enabled).toBe(false);
    expect(status.currentLevel).toBe('aal1');
    expect(status.nextLevel).toBe('aal1');

    const enroll = await api.enrollTotp('Work Authenticator');
    expect(enroll.factorType).toBe('totp');
    expect(enroll.id).toBeTruthy();
    expect(enroll.totp.secret).toBe('JBSWY3DPEHPK3PXP');
    expect(enroll.totp.qrCode).toContain('<svg');
    expect(enroll.totp.uri).toContain('otpauth://totp/');

    // Before verifying, factor is unverified and 2FA is not enabled
    status = await api.getMfaStatus();
    expect(status.enabled).toBe(false);
    expect(status.factors[0].status).toBe('unverified');

    // Reject bad code format
    await expect(api.verifyTotp(enroll.id, '123')).rejects.toThrow('Enter a 6-digit verification code');
    // Reject wrong code
    await expect(api.verifyTotp(enroll.id, '000000')).rejects.toThrow('Invalid authenticator code');

    // Verify valid 6-digit code
    await api.verifyTotp(enroll.id, '123456');

    status = await api.getMfaStatus();
    expect(status.enabled).toBe(true);
    expect(status.factors[0].status).toBe('verified');
    expect(status.currentLevel).toBe('aal2');
    expect(status.nextLevel).toBe('aal2');

    // Re-signing in prompts for AAL2 (MFA challenge required)
    await api.signIn('user@test.org');
    status = await api.getMfaStatus();
    expect(status.currentLevel).toBe('aal1');
    expect(status.nextLevel).toBe('aal2');

    // Completing MFA challenge elevates back to AAL2
    await api.verifyTotp(enroll.id, '654321');
    status = await api.getMfaStatus();
    expect(status.currentLevel).toBe('aal2');

    // Unenroll factor
    await api.unenrollTotp(enroll.id);
    status = await api.getMfaStatus();
    expect(status.enabled).toBe(false);
    expect(status.factors).toEqual([]);
    expect(status.currentLevel).toBe('aal1');
    expect(status.nextLevel).toBe('aal1');
  });

  it('maps Supabase MFA error codes to descriptive messages', () => {
    expect(mapAuthError({ message: 'Invalid token', code: 'mfa_verification_failed' }).code).toBe('invalid-auth');
    expect(mapAuthError({ message: 'Invalid token', code: 'invalid_grant' }).code).toBe('invalid-auth');
    expect(mapAuthError({ message: 'Expired challenge', code: 'mfa_challenge_expired' }).code).toBe('invalid-auth');
  });
});
