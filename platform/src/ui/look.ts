import modernCss from '../styles/look-new.css?inline';
import classicCss from '../styles/classic/look-classic.css?inline';
import type { Session } from '../api';
import { h } from './dom';

/**
 * Two looks: the carbon-frame refresh ('new') and the look before it ('classic'). The choice belongs to the
 * device, like the light and dark theme. Switching reloads the page, because the two looks lay out the frame
 * and the event menu differently.
 */
export type Look = 'new' | 'classic';

const KEY = 'stem-racing-india-look';
const ASKED = 'stem-racing-india-look-asked:';
/** Accounts created before the refresh went live have used the classic look, so they are asked once. */
export const NEW_LOOK_SINCE = '2026-11-23T07:00:00Z';

export function currentLook(): Look {
  try { return localStorage.getItem(KEY) === 'classic' ? 'classic' : 'new'; } catch { return 'new'; }
}

export function saveLook(look: Look): void {
  try { localStorage.setItem(KEY, look); } catch { /* storage unavailable: the choice lasts for this page only */ }
}

/** Puts the chosen look's styles on the page. Called once, before the first screen renders. */
export function applyLookStyles(look: Look, doc: Document = document): void {
  doc.documentElement.dataset.look = look;
  let style = doc.getElementById('look-styles') as HTMLStyleElement | null;
  if (!style) { style = doc.createElement('style'); style.id = 'look-styles'; doc.head.prepend(style); }
  style.textContent = look === 'classic' ? classicCss : modernCss;
}

function switchTo(look: Look): void {
  saveLook(look);
  location.reload();
}

/** The header button that swaps between the two looks. */
export function lookSwitcher(look: Look = currentLook()): HTMLElement {
  const other: Look = look === 'classic' ? 'new' : 'classic';
  return h('button', {
    class: 'btn btn--ghost btn--small look-switch', type: 'button',
    title: other === 'classic' ? 'Switch to the classic view' : 'Switch to the new view',
    onclick: () => switchTo(other),
  }, other === 'classic' ? 'Classic view' : 'New view');
}

function asked(userId: string): boolean {
  try { return localStorage.getItem(ASKED + userId) === '1'; } catch { return true; }
}

function markAsked(userId: string): void {
  try { localStorage.setItem(ASKED + userId, '1'); } catch { /* without storage the prompt may show again next time */ }
}

/** True for an account that signed up before the refresh and has not been asked on this device yet. */
export function shouldOfferClassic(session: Session | null): boolean {
  if (!session?.createdAt) return false;
  const created = Date.parse(session.createdAt);
  return Number.isFinite(created) && created < Date.parse(NEW_LOOK_SINCE) && !asked(session.userId);
}

/** Asks a returning user, once per device, whether to keep the new look or go back to the classic one. */
export function offerClassicLook(session: Session, look: Look = currentLook(), doc: Document = document): HTMLDialogElement | null {
  if (!shouldOfferClassic(session) || doc.querySelector('.look-prompt')) return null;
  const dialog = h('dialog', { class: 'look-prompt', 'aria-labelledby': 'look-prompt-title' }) as HTMLDialogElement;
  const close = () => { markAsked(session.userId); if (typeof dialog.close === 'function') dialog.close(); dialog.remove(); };
  const choose = (next: Look) => () => { close(); if (next !== look) switchTo(next); };
  dialog.append(h('div', { class: 'look-prompt__in' },
    h('h2', { id: 'look-prompt-title' }, 'The platform has a new look'),
    h('p', null, 'Everything works as before. Event pages now have a menu down the side, and the top bar shows your save status.'),
    h('p', { class: 'muted small' }, 'Prefer the previous design? Switch to the classic view. You can change this at any time with the view button at the top of the page.'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn btn--primary', type: 'button', onclick: choose('new') }, look === 'new' ? 'Keep the new look' : 'Use the new look'),
      h('button', { class: 'btn btn--ghost', type: 'button', onclick: choose('classic') }, look === 'classic' ? 'Keep the classic view' : 'Switch to the classic view'))));
  // Escape counts as keeping the current look.
  dialog.addEventListener('cancel', () => markAsked(session.userId));
  doc.body.append(dialog);
  if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  return dialog;
}
