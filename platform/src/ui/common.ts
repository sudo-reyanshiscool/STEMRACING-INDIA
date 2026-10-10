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
 * Validation refusals ('invalid', 'duplicate') carry a specific, human-written message from the API (for example
 * "Event name is required"), so it is shown. Every other code uses the fixed text so raw backend wording never leaks.
 */
export function errorText(e: unknown): string {
  if (!(e instanceof ApiError)) return CODE_TEXT.unknown;
  if ((e.code === 'invalid' || e.code === 'duplicate') && e.message.trim()) return e.message;
  return codeText(e.code);
}

export function notFound(message: string, backHref = '#/', backLabel = 'Back'): HTMLElement {
  return h('div', { class: 'stack' }, h('p', null, message), h('a', { class: 'back', href: backHref }, backLabel));
}

/** Status is always a word, never colour alone. */
export const tag = (label: string, tone: 'pass' | 'fail' | 'risk' | 'todo' | 'class' = 'todo') =>
  h('span', { class: `tag tag--${tone}` }, label);
