// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, preferredTheme, THEME_KEY, themeSwitcher } from '../../src/ui/theme';
import { mountShell } from '../../src/ui/shell';
import { buttonBusy } from '../../src/ui/button-busy';
import { loginScreen } from '../../src/ui/login';
import { ApiError } from '../../src/api';
import { makeCtx, world } from './helpers';

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); });
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();
  Reflect.deleteProperty(document, 'startViewTransition');
  Reflect.deleteProperty(document.documentElement, 'animate');
  delete document.documentElement.dataset.magicuiThemeVt;
  document.documentElement.style.removeProperty('--theme-reveal-start');
});

describe('device theme preference', () => {
  it('defaults to light, ignores invalid stored values, and restores an explicit dark choice', () => {
    expect(preferredTheme()).toBe('light');
    localStorage.setItem(THEME_KEY, 'unknown');
    expect(preferredTheme()).toBe('light');
    localStorage.setItem(THEME_KEY, 'dark');
    const button = themeSwitcher();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(button.getAttribute('aria-checked')).toBe('true');
    button.click();
    expect(localStorage.getItem(THEME_KEY)).toBe('light');
    expect(button.getAttribute('aria-checked')).toBe('false');
    expect(preferredTheme()).toBe('light');
  });

  it('uses an icon-only accessible control with the destination theme icon', () => {
    const button = themeSwitcher();
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button.getAttribute('aria-label')).toBe('Dark mode');
    expect(button.title).toBe('Switch to dark mode');
    button.click();
    expect(button.querySelector('circle')).not.toBeNull();
    expect(button.title).toBe('Switch to light mode');
  });

  it('uses an instant switch for reduced motion even when view transitions are supported', () => {
    const start = vi.fn();
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const button = themeSwitcher();
    button.dispatchEvent(new MouseEvent('click', { detail: 1 }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(start).not.toHaveBeenCalled();
  });

  it('guards rapid clicks during the reveal, then accepts the next toggle', async () => {
    let finish!: () => void;
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ cancel }));
    Object.defineProperty(document.documentElement, 'animate', { configurable: true, value: animate });
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: (change: () => void) => {
      change();
      return { ready: Promise.resolve(), finished: new Promise<void>(resolve => { finish = resolve; }) };
    } });
    const button = themeSwitcher();
    button.dispatchEvent(new MouseEvent('click', { detail: 1 }));
    button.dispatchEvent(new MouseEvent('click', { detail: 1 }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    await vi.waitFor(() => expect(animate).toHaveBeenCalledOnce());
    finish();
    await vi.waitFor(() => expect(document.documentElement.dataset.magicuiThemeVt).toBeUndefined());
    expect(cancel).toHaveBeenCalledOnce();
    button.click(); // keyboard/programmatic activation stays immediate
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('still switches and removes the transition lock if the browser rejects a snapshot', async () => {
    const skip = vi.fn();
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: () => ({
      ready: Promise.reject(new Error('Snapshot skipped')),
      finished: Promise.resolve(), skipTransition: skip,
    }) });
    const button = themeSwitcher();
    button.dispatchEvent(new MouseEvent('click', { detail: 1 }));
    await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(document.documentElement.dataset.magicuiThemeVt).toBeUndefined();
    expect(skip).toHaveBeenCalledOnce();
    button.click();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('remains usable when device storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const button = themeSwitcher();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(() => button.click()).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
    button.click();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('updates the browser colour and follows a change from another tab', () => {
    document.head.innerHTML = '<meta name="theme-color" content="">';
    const button = themeSwitcher();
    localStorage.setItem(THEME_KEY, 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY, newValue: 'dark' }));
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('meta')?.content).toBe('#05000B');
    applyTheme('light');
    expect(document.querySelector('meta')?.content).toBe('#F2F0EB');
  });

  it('keeps the switch present through sign in, sign out and loading states', () => {
    const root = document.createElement('div');
    const shell = mountShell(root);
    const button = root.querySelector<HTMLButtonElement>('[role=switch]')!;
    button.click();
    shell.setUser({ userId: 'person', email: 'judge@school.test' }, () => {});
    shell.setLoading(true);
    expect(shell.main.getAttribute('aria-busy')).toBe('true');
    expect(root.querySelector<HTMLElement>('.navigation-progress')?.hidden).toBe(false);
    shell.setUser(null, () => {});
    shell.setLoading(false);
    expect(root.querySelector('[role=switch]')).toBe(button);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(shell.main.getAttribute('aria-busy')).toBe('false');
  });
});

describe('button progress', () => {
  it('restores the original children, handlers and enabled state', () => {
    const button = document.createElement('button');
    const label = document.createElement('span'); label.textContent = 'Save';
    button.append(label);
    const finish = buttonBusy(button);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent).toBe('Saving…');
    finish();
    expect(button.firstChild).toBe(label);
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute('aria-busy')).toBe(false);
  });

  it('prevents duplicate sign-in requests and recovers after failure', async () => {
    const { api } = await world();
    await api.signOut();
    let reject!: (error: Error) => void;
    api.signIn = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const { ctx } = makeCtx(api);
    const el = loginScreen(ctx);
    const form = el.querySelector('form')!;
    const button = form.querySelector('button')!;
    el.querySelector<HTMLInputElement>('[name=email]')!.value = 'judge@school.test';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(api.signIn).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe('Sending email…');
    expect(button.disabled).toBe(true);
    reject(new ApiError('network', 'offline'));
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(button.textContent).toBe('Send sign-in email');
    expect(el.querySelector<HTMLElement>('[role=alert]')!.hidden).toBe(false);
  });
});
