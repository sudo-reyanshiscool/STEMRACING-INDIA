import { ApiError, type ApiErrorCode } from '../api';
import { h } from './dom';

/** Plain-language text for every error code. The Record type makes a new code a compile error until it is covered. */
const CODE_TEXT: Record<ApiErrorCode, string> = {
  unauthenticated: 'Sign in again — your scores are safe',
  forbidden: 'You do not have permission to do that.',
  locked: 'This has been submitted and is locked. Ask the Chair of Judges to reopen it.',
  invalid: 'Some of the information is not valid. Check it and try again.',
  duplicate: 'That already exists.',
  'not-found': 'We could not find that. It may have been removed.',
  network: 'Could not reach the server. Check your connection and try again.',
  unknown: 'Something went wrong. Try again.',
};

export const codeText = (code: ApiErrorCode): string => CODE_TEXT[code] ?? CODE_TEXT.unknown;

/**
 * Always fixed, plain-language text. The ApiError message is for logs only: on a real backend it can be a raw
 * database message (constraint names, SQL), so it is never shown. Screens that know what a code means for their
 * form pass their own wording (see actions.ts) and validate before calling the API.
 */
export function errorText(e: unknown): string {
  if (!(e instanceof ApiError)) return CODE_TEXT.unknown;
  return codeText(e.code);
}

/** Syntactically plausible: exactly one @, something on both sides, no spaces. The server still verifies. */
export const isPlausibleEmail = (v: string): boolean => /^[^\s@]+@[^\s@]+$/.test(v.trim());

export function notFound(message: string, backHref = '#/', backLabel = 'Back'): HTMLElement {
  return h('div', { class: 'stack' }, h('p', null, message), h('a', { class: 'back', href: backHref }, backLabel));
}

/** Status is always a word, never colour alone. */
export const tag = (label: string, tone: 'pass' | 'fail' | 'risk' | 'todo' | 'class' = 'todo') =>
  h('span', { class: `tag tag--${tone}` }, label);
