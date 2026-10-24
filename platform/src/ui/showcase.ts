import { exitShowcaseHref } from '../api/showcase';
import { h } from './dom';

export function mountShowcaseBar(root: HTMLElement): void {
  root.hidden = false;
  root.replaceChildren(h('div', { class: 'showcase-bar__in' },
    h('div', { class: 'showcase-bar__copy' },
      h('strong', null, 'TEST EVENT / SHOWCASE'),
      h('p', null, 'Try every tab. Changes are temporary and reset on reload. Emails are simulated.')),
    h('div', { class: 'actions' },
      h('button', { class: 'btn btn--ghost btn--small', type: 'button', onclick: () => location.reload() }, 'Reset showcase'),
      h('a', { class: 'btn btn--ghost btn--small', href: exitShowcaseHref(location.pathname) }, 'Back to saved event'))));
}
