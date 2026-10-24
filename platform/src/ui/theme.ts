import { h } from './dom';

export type Theme = 'light' | 'dark';
export const THEME_KEY = 'stem-racing-india-theme';

export function preferredTheme(): Theme {
  try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#05000B' : '#F6F5F8');
}

/** Device preference only: switching never changes the signed-in account or event. */
export function themeSwitcher(): HTMLButtonElement {
  let theme = preferredTheme();
  const icon = h('span', { class: 'theme-switch__icon', 'aria-hidden': 'true' });
  const label = h('span');
  const button = h('button', { type: 'button', class: 'theme-switch', role: 'switch', 'aria-label': 'Dark mode' }, icon, label);
  const update = () => {
    applyTheme(theme);
    button.setAttribute('aria-checked', String(theme === 'dark'));
    button.title = `Switch to ${theme === 'light' ? 'dark' : 'light'} mode`;
    icon.textContent = theme === 'dark' ? '☾' : '☀';
    label.textContent = theme === 'dark' ? 'Dark mode' : 'Light mode';
  };
  button.addEventListener('click', () => {
    theme = theme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* Still works when storage is unavailable. */ }
    update();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_KEY || event.key === null) { theme = preferredTheme(); update(); }
  });
  update();
  return button;
}
