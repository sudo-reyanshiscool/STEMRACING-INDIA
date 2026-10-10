import type { Api, ScoreQueue } from '../api';

export interface Ctx {
  api: Api;
  queue: ScoreQueue;
  main: HTMLElement;
  demo: boolean;
  /** Re-render the current route. */
  rerender(): void;
  /** Register cleanup to run when the current screen is replaced. */
  onLeave(fn: () => void): void;
}
