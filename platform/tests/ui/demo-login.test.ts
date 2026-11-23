// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { MemoryApi } from '../../src/api/memory';
import { loadDesignPreview, PREVIEW_EVENT_ID } from '../../src/api/design-preview';
import { loginScreen } from '../../src/ui/login';
import { makeCtx } from './helpers';

const demoLinks = (el: HTMLElement) => [...el.querySelectorAll('.demo-login a')].map((a) => a.getAttribute('href'));

describe('demo sign-in', () => {
  it('is not offered unless the app asks for it', () => {
    const el = loginScreen(makeCtx(new MemoryApi()).ctx);
    expect(el.querySelector('.demo-login')).toBeNull();
  });

  it('is offered beneath the real sign-in when the app allows it', () => {
    const el = loginScreen(makeCtx(new MemoryApi()).ctx, { demo: true });
    expect(el.querySelector('input[name=email]')).not.toBeNull();
    expect(demoLinks(el)).toEqual(['?preview=organiser#/', '?preview=judge#/', '?preview=team#/']);
  });

  it('replaces the email forms inside the demo, where there is no real account to sign in to', () => {
    const el = loginScreen(makeCtx(new MemoryApi()).ctx, { demo: true, demoOnly: true });
    expect(el.querySelector('input[name=email]')).toBeNull();
    expect(el.querySelector('input[name=password]')).toBeNull();
    expect(demoLinks(el)).toHaveLength(3);
  });

  it.each([
    ['organiser', ['organiser', 'chair']],
    ['judge', ['judge']],
    ['team', ['team_manager']],
  ])('signs %s in to the sample event with the matching role', async (persona, roles) => {
    const api = await loadDesignPreview(persona);
    expect(await api.getSession()).not.toBeNull();
    expect((await api.myRoles(PREVIEW_EVENT_ID)).map((r) => r.role)).toEqual(roles);
  });

  it('starts signed out when asked for the sign-in screen', async () => {
    expect(await (await loadDesignPreview('signed-out')).getSession()).toBeNull();
  });
});
