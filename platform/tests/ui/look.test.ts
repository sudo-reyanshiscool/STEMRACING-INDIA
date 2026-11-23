// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLookStyles, currentLook, lookSwitcher, NEW_LOOK_SINCE, offerClassicLook, saveLook, shouldOfferClassic } from '../../src/ui/look';
import { mountShell } from '../../src/ui/shell';
import { eventNav } from '../../src/ui/event-nav';
import { INDIA_2026 } from '../../src/rulesets';
import type { EventRow, RoleRow } from '../../src/api';

const before = new Date(Date.parse(NEW_LOOK_SINCE) - 86_400_000).toISOString();
const after = new Date(Date.parse(NEW_LOOK_SINCE) + 86_400_000).toISOString();
const returning = { userId: 'u1', email: 'judge@x.test', createdAt: before };
const reload = vi.fn();

beforeEach(() => {
  localStorage.clear(); document.body.replaceChildren();
  vi.stubGlobal('location', { ...window.location, reload });
});
afterEach(() => { vi.unstubAllGlobals(); reload.mockReset(); });

describe('choosing a look', () => {
  it('starts on the new look and remembers a switch to the classic one', () => {
    expect(currentLook()).toBe('new');
    saveLook('classic');
    expect(currentLook()).toBe('classic');
  });

  it('puts the chosen stylesheet on the page and marks the document', () => {
    applyLookStyles('classic');
    expect(document.documentElement.dataset.look).toBe('classic');
    expect(document.querySelectorAll('#look-styles')).toHaveLength(1);
    applyLookStyles('new');
    expect(document.documentElement.dataset.look).toBe('new');
    expect(document.querySelectorAll('#look-styles')).toHaveLength(1);
  });

  it('offers the other look from the header and reloads into it', () => {
    const button = lookSwitcher('new');
    expect(button.textContent).toBe('Classic view');
    button.click();
    expect(currentLook()).toBe('classic');
    expect(reload).toHaveBeenCalledOnce();
    expect(lookSwitcher('classic').textContent).toBe('New view');
  });
});

describe('asking returning users', () => {
  it('asks only accounts created before the refresh', () => {
    expect(shouldOfferClassic(returning)).toBe(true);
    expect(shouldOfferClassic({ ...returning, createdAt: after })).toBe(false);
    expect(shouldOfferClassic({ userId: 'u2', email: 'x@x.test' })).toBe(false);
    expect(shouldOfferClassic(null)).toBe(false);
  });

  it('asks once per account on this device, and keeping the new look changes nothing', () => {
    const dialog = offerClassicLook(returning, 'new')!;
    expect(dialog.textContent).toContain('The platform has a new look');
    expect(offerClassicLook(returning, 'new')).toBeNull(); // already on screen
    dialog.querySelector<HTMLButtonElement>('.btn--primary')!.click();
    expect(document.querySelector('.look-prompt')).toBeNull();
    expect(currentLook()).toBe('new');
    expect(reload).not.toHaveBeenCalled();
    expect(shouldOfferClassic(returning)).toBe(false);
    expect(shouldOfferClassic({ ...returning, userId: 'u3' })).toBe(true);
  });

  it('switches to the classic view from the prompt', () => {
    const dialog = offerClassicLook(returning, 'new')!;
    [...dialog.querySelectorAll('button')].find(b => b.textContent === 'Switch to the classic view')!.click();
    expect(currentLook()).toBe('classic');
    expect(reload).toHaveBeenCalledOnce();
    expect(shouldOfferClassic(returning)).toBe(false);
  });
});

describe('classic layout', () => {
  const event: EventRow = { id: 'e1', name: 'Mumbai Regionals 1 2027', startsOn: '2027-01-10', ruleset: INDIA_2026, resultsReleased: false };
  const organiser: RoleRow[] = [{ id: 'r1', eventId: 'e1', userId: 'u1', role: 'organiser', panel: null, teamId: null, email: null }];

  it('keeps the save bar under the header and no side menu', () => {
    const root = document.createElement('div');
    const shell = mountShell(root, 'classic');
    expect(root.querySelector('.workspace')).toBeNull();
    expect(root.querySelector('.site-header .sync-bar')).toBeNull();
    expect(root.querySelector('header + * + * + .sync-bar, .sync-bar + main')).not.toBeNull();
    shell.setNav({ event, nav: eventNav(event, organiser, 'event') });
    expect(root.querySelector('.event-rail')).toBeNull();
    expect(root.querySelector('.look-switch')?.textContent).toBe('New view');
  });

  it('shows the event tabs as one flat row in the original order', () => {
    const nav = eventNav(event, organiser, 'teams', { classic: true });
    expect(nav.querySelector('.event-nav__group')).toBeNull();
    expect([...nav.querySelectorAll('a')].map(a => a.textContent).slice(0, 4)).toEqual(['Event', 'Scheduling & Streams', 'Teams', 'Media Assets']);
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Teams');
  });

  it('keeps the new look grouped', () => {
    expect(eventNav(event, organiser, 'event').querySelector('.event-nav__group')).not.toBeNull();
  });
});
