import type { Session } from '../api';
import { h } from './dom';
import { themeSwitcher } from './theme';

export interface Shell {
  main: HTMLElement;
  /** Where the score-sync status lives (see syncbar.ts). Always visible, above the page content. */
  syncBar: HTMLElement;
  setLoading(loading: boolean): void;
  setUser(session: Session | null, onSignOut: () => void): void;
}

export function mountShell(root: HTMLElement): Shell {
  const main = h('main', { id: 'main', tabindex: '-1' });
  const who = h('div', { class: 'who' });
  const syncBar = h('div', { class: 'sync-bar' });
  const loading = h('div', { class: 'navigation-progress', role: 'status', hidden: true }, h('span', { class: 'sr-only' }, 'Loading page…'));
  root.replaceChildren(
    h('a', { class: 'skip', href: '#/', onclick: (e: Event) => { e.preventDefault(); main.focus(); } }, 'Skip to content'),
    h('header', { class: 'site-header' },
      h('div', { class: 'site-header__in' },
        h('a', { class: 'brand-home', href: '#/', 'aria-label': 'STEM Racing India event platform home' },
          h('img', { class: 'brand-logo--light', src: '/brand/logo-india-mono-black.png', alt: 'STEM Racing India', width: 1200, height: 492 }),
          h('img', { class: 'brand-logo--dark', src: '/brand/logo-india-mono-white.png', alt: 'STEM Racing India', width: 1200, height: 492 })),
        h('div', { class: 'header-tools' }, themeSwitcher(), who),
      ),
    ),
    loading,
    syncBar,
    main,
  );
  return {
    main,
    syncBar,
    setLoading(value) {
      loading.hidden = !value;
      main.setAttribute('aria-busy', String(value));
    },
    setUser(session, onSignOut) {
      who.replaceChildren(
        ...(session
          ? [
              h('span', { class: 'muted' }, session.email),
              h('a', { class: 'btn btn--ghost btn--small', href: '#/security' }, 'Security'),
              h('button', { class: 'btn btn--ghost btn--small', type: 'button', onclick: onSignOut }, 'Sign out'),
            ]
          : []),
      );
    },
  };
}
