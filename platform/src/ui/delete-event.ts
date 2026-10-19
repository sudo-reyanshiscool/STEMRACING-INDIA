import type { EventRow } from '../api';
import { reportActionError } from './actions';
import type { Ctx } from './ctx';
import { h } from './dom';

export function deleteEventControl(ctx: Ctx, event: EventRow): HTMLElement {
  let alive = true, busy = false;
  ctx.onLeave(() => { alive = false; });
  const open = h('button', { class: 'btn btn--ghost', type: 'button', 'aria-expanded': 'false' }, 'Delete event');
  const name = h('input', { type: 'text', autocomplete: 'off', 'aria-label': 'Event name to confirm deletion' });
  const confirm = h('button', { class: 'btn btn--primary', type: 'submit', disabled: true }, 'Confirm delete event');
  const cancel = h('button', { class: 'btn btn--ghost', type: 'button' }, 'Cancel');
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const form = h('form', { class: 'stack', hidden: true, novalidate: true },
    h('p', null, 'The event, teams, scorecards and public results will be hidden. Judging records are kept. An organiser can restore the event from Deleted events.'),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, `Type “${event.name}” to confirm`), name),
    error, h('div', { class: 'actions' }, confirm, cancel));
  open.addEventListener('click', () => { form.hidden = false; open.hidden = true; open.setAttribute('aria-expanded', 'true'); name.focus(); });
  name.addEventListener('input', () => { confirm.disabled = busy || name.value !== event.name; });
  cancel.addEventListener('click', () => { if (busy) return; form.hidden = true; open.hidden = false; open.setAttribute('aria-expanded', 'false'); name.value = ''; confirm.disabled = true; error.hidden = true; open.focus(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); if (busy || name.value !== event.name) return;
    busy = true; confirm.disabled = true; cancel.disabled = true; name.disabled = true; error.hidden = true;
    try { await ctx.api.deleteEvent(event.id, name.value); if (alive) { location.hash = '#/'; ctx.rerender(); } }
    catch (e) { if (alive) reportActionError(ctx, error, e, { invalid: 'The event name no longer matches. Reload this event and try again.', forbidden: 'Only an organiser of this event can delete it.' }); }
    finally { busy = false; if (alive) { confirm.disabled = name.value !== event.name; cancel.disabled = false; name.disabled = false; } }
  });
  return h('section', { class: 'section event-management', 'aria-label': 'Manage event' }, h('h2', null, 'Manage event'), open, form);
}
