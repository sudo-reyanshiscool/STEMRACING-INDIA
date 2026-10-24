// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, preferredTheme, THEME_KEY, themeSwitcher } from '../../src/ui/theme';
import { mountShell } from '../../src/ui/shell';
import { buttonBusy } from '../../src/ui/button-busy';
import { loginScreen } from '../../src/ui/login';
import { ApiError } from '../../src/api';
import { makeCtx, world } from './helpers';

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); });
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

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
    expect(document.querySelector('meta')?.content).toBe('#F6F5F8');
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
