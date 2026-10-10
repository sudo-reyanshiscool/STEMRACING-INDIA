// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ApiError, MemoryApi } from '../../src/api';
import { errorScreen } from '../../src/ui/errorscreen';
import { makeCtx, text } from './helpers';

describe('errorScreen', () => {
  it('shows plain text, never the raw error, and a Try again control', () => {
    const { ctx } = makeCtx(new MemoryApi());
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = errorScreen(ctx, new Error('TypeError: x is undefined'));
    expect(text(el)).not.toContain('TypeError');
    expect(text(el.querySelector('[role=alert]')!)).toContain('Something went wrong');
    [...el.querySelectorAll('button')].find((b) => text(b) === 'Try again')!.click();
    expect(ctx.rerender).toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('routes an unauthenticated failure to sign-in with the scores-are-safe text', () => {
    const { ctx } = makeCtx(new MemoryApi());
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = errorScreen(ctx, new ApiError('unauthenticated', 'jwt expired'));
    expect(el.querySelector('input[name=email]')).not.toBeNull();
    expect(text(el)).toContain('Sign in again — your scores are safe');
  });
});
