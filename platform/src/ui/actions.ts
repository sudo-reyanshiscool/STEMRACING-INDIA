import { ApiError } from '../api';
import { errorText } from './common';
import type { Ctx } from './ctx';

/**
 * Text for a failed action on a screen that is not a scorecard. 'locked' here means the results are released and
 * the freeze is on, so it names the way out (the generic text talks about submitted scorecards).
 */
export function actionErrorText(e: unknown): string {
  if (e instanceof ApiError && e.code === 'locked') return 'Results are released, so this cannot be changed. Withdraw the release to change it.';
  return errorText(e);
}

/**
 * Shows a failed action in the screen's alert element. A lapsed session re-renders instead, which lands on sign-in;
 * nothing entered is lost because writes go through the queue and forms keep their values only until a re-render.
 */
export function reportActionError(ctx: Ctx, alert: HTMLElement, e: unknown): void {
  if (e instanceof ApiError && e.code === 'unauthenticated') {
    ctx.rerender();
    return;
  }
  alert.textContent = actionErrorText(e);
  alert.hidden = false;
}
