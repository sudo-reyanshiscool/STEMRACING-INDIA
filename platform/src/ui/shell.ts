import {eventLogoSource,PLATFORM_LOGO,type EventBranding} from '../api';
import type { EventRow, Session } from '../api';
import { h } from './dom';
import { themeSwitcher } from './theme';
import { lookSwitcher, type Look } from './look';

export interface Shell {
  main: HTMLElement;
  /** Where the score-sync status lives (see syncbar.ts). Always visible, above the page content. */
  syncBar: HTMLElement;
  showcaseBar: HTMLElement;
  setLoading(loading: boolean): void;
  /** The event's navigation lives in the frame, beside the page. `focus` folds it away on screens that need the width. */
  setNav(nav: { event: EventRow; nav: HTMLElement; focus?: boolean } | null): void;
  setBranding(branding:EventBranding|null):void;
  setUser(session: Session | null, onSignOut: () => void, showcase?: boolean): void;
}

/** If a full-colour logo cannot be shown, fall back once to the monochrome mark for the same surface. */
const monoFallback=(mono:string)=>(e:Event)=>{const img=e.currentTarget as HTMLImageElement;if(!img.src.endsWith(mono))img.src=mono;};

/** 2026-10-24 becomes 24 Oct 2026. Anything else is shown as it was written. */
export function eventDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}

export function mountShell(root: HTMLElement, look: Look = 'new'): Shell {
  const classic = look === 'classic';
  const main = h('main', { id: 'main', tabindex: '-1' });
  const who = h('div', { class: 'who' });
  const syncBar = h('div', { class: 'sync-bar' });
  const showcaseBar = h('aside', { class: 'showcase-bar', hidden: true, 'aria-label': 'Showcase mode' });
  const loading = h('div', { class: 'navigation-progress', role: 'status', hidden: true }, h('span', { class: 'sr-only' }, 'Loading page…'));
  const rail = h('aside', { class: 'event-rail', hidden: true });
  // The page column clips the full-width mastheads, so they stop at the rail instead of running under it.
  const workspace = h('div', { class: 'workspace' }, rail, h('div', { class: 'page' }, main));
  root.replaceChildren(
    h('a', { class: 'skip', href: '#/', onclick: (e: Event) => { e.preventDefault(); main.focus(); } }, 'Skip to content'),
    h('header', { class: 'site-header' },
      h('div', { class: 'site-header__in' },
        h('a', { class: 'brand-home', href: '#/', 'aria-label': 'STEM Racing India event platform home' },
          h('img', { class: 'brand-logo--light', src: PLATFORM_LOGO.light.colour, alt: 'STEM Racing India', width: 1400, height: 573, onerror: monoFallback(PLATFORM_LOGO.light.mono) }),
          h('img', { class: 'brand-logo--dark', src: PLATFORM_LOGO.dark.colour, alt: 'STEM Racing India', width: 1400, height: 573, onerror: monoFallback(PLATFORM_LOGO.dark.mono) })),
        // The classic look keeps the save status in its own bar under the header, and the page without a side menu.
        classic ? null : syncBar,
        h('div', { class: 'header-tools' }, lookSwitcher(look), themeSwitcher(), who),
      ),
    ),
    loading,
    showcaseBar,
    ...(classic ? [syncBar, main] : [workspace]),
  );
  return {
    main,
    setBranding(branding){
      const home=root.querySelector<HTMLElement>('.brand-home')!;
      const light=home.querySelector<HTMLImageElement>('.brand-logo--light')!,dark=home.querySelector<HTMLImageElement>('.brand-logo--dark')!;
      light.src=eventLogoSource(branding,false)??PLATFORM_LOGO.light.colour;dark.src=eventLogoSource(branding,true)??PLATFORM_LOGO.dark.colour;
      light.alt=dark.alt=branding?.level?`STEM Racing India · ${branding.level==='national'?'National':'Regional'} finals`:'STEM Racing India';
    },
    syncBar,
    showcaseBar,
    setNav(next) {
      if (classic) return;
      workspace.classList.toggle('workspace--event', !!next);
      workspace.classList.toggle('workspace--focus', !!next?.focus);
      rail.hidden = !next;
      if (!next) { rail.replaceChildren(); return; }
      const { event, nav } = next;
      const current = nav.querySelector('[aria-current="page"]')?.textContent ?? 'Menu';
      const toggle = h('button', { class: 'event-rail__toggle', type: 'button', 'aria-expanded': 'false' },
        h('span', { class: 'event-rail__toggle-label' }, current), h('span', { class: 'event-rail__toggle-hint' }, 'Menu'));
      toggle.addEventListener('click', () => {
        const open = rail.dataset.open !== 'true';
        rail.dataset.open = String(open);
        toggle.setAttribute('aria-expanded', String(open));
      });
      rail.dataset.open = 'false';
      rail.replaceChildren(
        h('a', { class: 'event-rail__event', href: `#/event/${encodeURIComponent(event.id)}` },
          h('span', { class: 'event-rail__name' }, event.name),
          event.startsOn ? h('span', { class: 'event-rail__date' }, eventDate(event.startsOn)) : null),
        toggle, nav);
    },
    setLoading(value) {
      loading.hidden = !value;
      main.setAttribute('aria-busy', String(value));
    },
    setUser(session, onSignOut, showcase = false) {
      who.replaceChildren(
        ...(session
          ? [
              h('span', { class: 'muted' }, showcase ? 'Showcase presenter' : session.email),
              ...(showcase ? [] : [h('a', { class: 'btn btn--ghost btn--small', href: '#/security' }, 'Security')]),
              h('button', { class: 'btn btn--ghost btn--small', type: 'button', onclick: onSignOut }, showcase ? 'Exit showcase' : 'Sign out'),
            ]
          : []),
      );
    },
  };
}
