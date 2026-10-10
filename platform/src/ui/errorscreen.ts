import { ApiError } from '../api';
import { codeText, errorText } from './common';
import type { Ctx } from './ctx';
import { h } from './dom';
import { loginScreen } from './login';

/**
 * What the person sees when a screen could not be built or an action failed. The error is logged, never shown raw.
 * 'unauthenticated' goes to sign-in (their scores are safe); anything else gets plain text and a Try again control.
 */
export function errorScreen(ctx: Ctx, e: unknown): HTMLElement {
  console.error(e);
  if (e instanceof ApiError && e.code === 'unauthenticated') {
    return h('div', { class: 'stack stack--lg' },
      h('p', { class: 'notice', role: 'status' }, codeText('unauthenticated')),
      loginScreen(ctx));
  }
  return h('div', { class: 'stack' },
    h('h1', null, 'Something went wrong'),
    h('p', { class: 'alert', role: 'alert' }, errorText(e)),
    h('div', { class: 'inline-form' },
      h('button', { class: 'btn btn--primary', type: 'button', onclick: () => ctx.rerender() }, 'Try again'),
      h('a', { class: 'back', href: '#/' }, 'Back to events')));
}
