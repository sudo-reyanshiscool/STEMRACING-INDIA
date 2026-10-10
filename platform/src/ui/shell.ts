import type { Session } from '../api';
import { h } from './dom';

export interface Shell {
  main: HTMLElement;
  demoBar: HTMLElement;
  /** Where the score-sync status lives (see syncbar.ts). Always visible, above the page content. */
  syncBar: HTMLElement;
  setUser(session: Session | null, onSignOut: () => void): void;
}

export function mountShell(root: HTMLElement): Shell {
  const main = h('main', { id: 'main', tabindex: '-1' });
  const who = h('div', { class: 'who' });
  const demoBar = h('div', { class: 'demo-bar', hidden: true });
  const syncBar = h('div', { class: 'sync-bar' });
  root.replaceChildren(
    h('a', { class: 'skip', href: '#/', onclick: (e: Event) => { e.preventDefault(); main.focus(); } }, 'Skip to content'),
    demoBar,
    h('header', { class: 'site-header' },
      h('div', { class: 'site-header__in' },
        h('a', { href: '#/', 'aria-label': 'STEM Racing India event platform home' },
          h('img', { src: '/brand/logo-full-colour-white.png', alt: 'STEM Racing', height: 44 })),
        who,
      ),
    ),
    syncBar,
    main,
  );
  return {
    main,
    demoBar,
    syncBar,
    setUser(session, onSignOut) {
      who.replaceChildren(
        ...(session
          ? [h('span', { class: 'muted' }, session.email), h('button', { class: 'btn btn--ghost btn--small', type: 'button', onclick: onSignOut }, 'Sign out')]
          : []),
      );
    },
  };
}
