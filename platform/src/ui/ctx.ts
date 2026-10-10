import type { Api, ScoreQueue } from '../api';
import type { HostEvent } from './queuehost';

/**
 * What a screen may do with the score queue: look, never enqueue or flush directly (use ctx.enqueueScore, which always
 * flushes). The queue behind it belongs to whoever is signed in.
 */
export type QueueView = Pick<ScoreQueue, 'status' | 'rejected' | 'pending' | 'pendingFor'> & {
  subscribe(cb: (e: HostEvent) => void): () => void;
};

export interface Ctx {
  api: Api;
  queue: QueueView;
  /** Records a score: enqueue, then flush. Rejects with an 'unauthenticated' ApiError when nobody is signed in. */
  enqueueScore(i: { cardId: string; criterionId: string; score: number; comment?: string }): Promise<void>;
  main: HTMLElement;
  demo: boolean;
  /** Re-render the current route. */
  rerender(): void;
  /** Register cleanup to run when the current screen is replaced. */
  onLeave(fn: () => void): void;
}
