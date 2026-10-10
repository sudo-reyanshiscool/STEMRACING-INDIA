// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ApiError, type ApiErrorCode } from '../../src/api';
import { codeText, errorText, tag } from '../../src/ui/common';

const CODES: ApiErrorCode[] = ['unauthenticated', 'forbidden', 'locked', 'invalid', 'duplicate', 'not-found', 'network', 'unknown'];

describe('errorText', () => {
  it('has plain-language text for every error code', () => {
    for (const c of CODES) {
      const t = errorText(new ApiError(c, 'raw backend text: PGRST301'));
      expect(t.length, c).toBeGreaterThan(10);
      expect(t, c).not.toContain('PGRST');
      expect(t, c).not.toContain('raw backend');
      expect(codeText(c), c).toBeTruthy();
    }
  });
  it('tells a signed-out person their scores are safe', () => {
    expect(errorText(new ApiError('unauthenticated', 'JWT expired'))).toBe('Sign in again — your scores are safe');
  });
  it('never shows the backend message, even for validation and duplicate refusals', () => {
    const raw = 'duplicate key value violates unique constraint "teams_event_number"';
    for (const c of ['invalid', 'duplicate'] as const) {
      const t = errorText(new ApiError(c, raw));
      expect(t).toBe(codeText(c));
      expect(t).not.toContain('constraint');
    }
  });
  it('never leaks a raw error', () => {
    expect(errorText(new Error('TypeError: x is undefined'))).toBe('Something went wrong. Try again.');
    expect(errorText('boom')).toBe('Something went wrong. Try again.');
  });
});

describe('tag', () => {
  it('is a word with a tone class', () => {
    const el = tag('Submitted', 'pass');
    expect(el.textContent).toBe('Submitted');
    expect(el.className).toBe('tag tag--pass');
  });
});
