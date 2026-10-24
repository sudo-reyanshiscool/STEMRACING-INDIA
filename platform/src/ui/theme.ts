import { h } from './dom';

export type Theme = 'light' | 'dark';
export const THEME_KEY = 'stem-racing-india-theme';

export function preferredTheme(): Theme {
  try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#05000B' : '#F2F0EB');
}

function themeIcon(theme: Theme): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [key, value] of Object.entries({ width: '24', height: '24', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(key, value);
  const shape = (tag: string, attrs: Record<string, string>) => {
    const child = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) child.setAttribute(key, value);
    svg.append(child);
  };
  // Show the destination theme, as in Magic UI's icon-only toggle.
  if (theme === 'light') shape('path', { d: 'M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z' });
  else {
    shape('circle', { cx: '12', cy: '12', r: '4' });
    shape('path', { d: 'M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42' });
  }
  return svg;
}

/**
 * Native DOM adaptation of Magic UI's AnimatedThemeToggler (MIT).
 * https://github.com/magicuidesign/magicui/blob/main/apps/www/registry/magicui/animated-theme-toggler.tsx
 * License: /licenses/magic-ui.txt. Keeps our existing device preference and light default.
 */
export function themeSwitcher(): HTMLButtonElement {
  let theme = preferredTheme();
  let transitioning = false;
  const button = h('button', { type: 'button', class: 'theme-switch', role: 'switch', 'aria-label': 'Dark mode' });
  const update = () => {
    applyTheme(theme);
    button.setAttribute('aria-checked', String(theme === 'dark'));
    button.title = `Switch to ${theme === 'light' ? 'dark' : 'light'} mode`;
    button.replaceChildren(themeIcon(theme), h('span', { class: 'sr-only' }, 'Toggle theme'));
  };
  button.addEventListener('click', (event) => {
    if (transitioning) return;
    let applied = false;
    const change = () => {
      if (applied) return;
      applied = true;
      theme = theme === 'light' ? 'dark' : 'light';
      try { localStorage.setItem(THEME_KEY, theme); } catch { /* Still works when storage is unavailable. */ }
      update();
    };
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (typeof document.startViewTransition !== 'function' || reducedMotion || event.detail === 0) {
      change();
      return;
    }

    const root = document.documentElement;
    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const width = window.innerWidth, height = window.innerHeight;
    const radius = Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
    // Percentages also align correctly on displays with fractional scaling.
    const origin = `${x / width * 100}% ${y / height * 100}%`;
    const start = `circle(0% at ${origin})`;
    const end = `circle(${radius / (Math.hypot(width, height) / Math.SQRT2) * 100}% at ${origin})`;
    let animation: Animation | undefined;
    transitioning = true;
    root.dataset.magicuiThemeVt = 'active';
    root.style.setProperty('--theme-reveal-start', start);
    const cleanup = () => {
      transitioning = false;
      delete root.dataset.magicuiThemeVt;
      root.style.removeProperty('--theme-reveal-start');
      animation?.cancel();
    };
    try {
      const transition = document.startViewTransition(change);
      void transition.finished.finally(cleanup).catch(() => {});
      void transition.ready.then(() => {
        animation = root.animate({ clipPath: [start, end] }, {
          duration: 400, easing: 'ease-in-out', fill: 'forwards', pseudoElement: '::view-transition-new(root)',
        });
      }).catch(() => {
        transition.skipTransition();
        change();
        cleanup();
      });
    } catch {
      change();
      cleanup();
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_KEY || event.key === null) { theme = preferredTheme(); update(); }
  });
  update();
  return button;
}
