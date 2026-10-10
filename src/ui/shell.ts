import { h } from './dom';

export function mountShell(root: HTMLElement): { main: HTMLElement } {
  const main = h('main', { id: 'main', tabindex: '-1' });
  root.replaceChildren(
    h('a', { class: 'skip', href: '#/', onclick: (e: Event) => { e.preventDefault(); main.focus(); } }, 'Skip to content'),
    h('header', { class: 'site-header' },
      h('div', { class: 'site-header__in' },
        h('a', { href: '#/', 'aria-label': 'STEM Racing scrutineering home' },
          h('img', { src: '/brand/logo-full-colour-white.png', alt: 'STEM Racing', height: 44 })),
        h('p', { class: 'eyebrow' }, 'Digital scrutineering'),
      ),
    ),
    main,
  );
  return { main };
}
