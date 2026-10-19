import type { EventRow } from '../api';
import { reportActionError } from './actions';
import type { Ctx } from './ctx';
import { h } from './dom';

export function deleteEventControl(ctx: Ctx, event: EventRow): HTMLElement {
  let alive = true, busy = false;
  ctx.onLeave(() => { alive = false; });
  const open = h('button', { class: 'btn btn--ghost', type: 'button', 'aria-expanded': 'false' }, 'Delete event');
  const hintId = `delete-event-confirmation-${event.id}`;
  const name = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Event name to confirm deletion', 'aria-describedby': hintId });
  const confirm = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Confirm delete event');
  const cancel = h('button', { class: 'btn btn--ghost', type: 'button' }, 'Cancel');
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const normalise = (value: string) => value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  const matches = () => normalise(name.value) === normalise(event.name);
  const form = h('form', { class: 'stack', hidden: true, novalidate: true },
    h('p', null, 'The event, teams, scorecards and public results will be hidden. Judging records are kept. An organiser can restore the event from Deleted events.'),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, `Type “${event.name}” to confirm`), name),
    h('p', { id: hintId, class: 'small muted' }, 'Match the event name, including capital letters. Extra spaces are ignored.'),
    error, h('div', { class: 'actions' }, confirm, cancel));
  open.addEventListener('click', () => { form.hidden = false; open.hidden = true; open.setAttribute('aria-expanded', 'true'); name.focus(); });
  const check = () => { if (matches()) { error.hidden = true; name.removeAttribute('aria-invalid'); } };
  name.addEventListener('input', check);
  name.addEventListener('change', check);
  cancel.addEventListener('click', () => { if (busy) return; form.hidden = true; open.hidden = false; open.setAttribute('aria-expanded', 'false'); name.value = ''; name.removeAttribute('aria-invalid'); error.hidden = true; open.focus(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); if (busy) return;
    if (!matches()) {
      error.textContent = `Type “${event.name}” above to confirm deletion.`;
      error.hidden = false; name.setAttribute('aria-invalid', 'true'); name.focus();
      return;
    }
    name.removeAttribute('aria-invalid');
    busy = true; confirm.disabled = true; cancel.disabled = true; name.disabled = true; error.hidden = true;
    // The server still receives and verifies the exact stored name, including a concurrent rename check.
    try { await ctx.api.deleteEvent(event.id, event.name); if (alive) { location.hash = '#/'; ctx.rerender(); } }
    catch (e) { if (alive) reportActionError(ctx, error, e, { invalid: 'The event name no longer matches. Reload this event and try again.', forbidden: 'Only an organiser of this event can delete it.' }); }
    finally { busy = false; if (alive) { confirm.disabled = false; cancel.disabled = false; name.disabled = false; } }
  });
  return h('section', { class: 'section event-management', 'aria-label': 'Manage event' }, h('h2', null, 'Manage event'), open, form);
}
