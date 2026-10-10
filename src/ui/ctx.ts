import type { Store } from '../store';

export interface Ctx {
  store: Store;
  main: HTMLElement;
  /** Re-render the current route, for example after a form submit. */
  rerender: () => void;
}
