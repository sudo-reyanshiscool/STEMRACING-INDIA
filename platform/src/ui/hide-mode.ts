import type { Ctx } from './ctx';
import { buttonBusy } from './button-busy';
import { errorText } from './common';
import { h } from './dom';
import { SHOWCASE_EVENT_ID } from '../api/showcase';

/** While the owner's hide mode is on, the Test Event is the only event the owner's screens show. */
export function shownInHideMode(eventId: string): boolean {
  return eventId === SHOWCASE_EVENT_ID;
}

/** The hide mode switch on Account Security. Shown to the permanent owner only. */
export async function hideModeSection(ctx: Ctx): Promise<HTMLElement | null> {
  const [access, viewer] = await Promise.all([ctx.api.platformAccess(), ctx.api.getSession()]);
  if (!viewer || !access.ownerId || access.ownerId !== viewer.userId) return null;
  const on = await ctx.api.getOwnerHideMode();
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const button = h('button', { class: on ? 'btn btn--primary btn--small' : 'btn btn--ghost btn--small', type: 'button', 'aria-pressed': String(on) },
    on ? 'Turn hide mode off' : 'Turn hide mode on');
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    const finish = buttonBusy(button, 'Saving…'); error.hidden = true;
    try { await ctx.api.setOwnerHideMode(!on); ctx.rerender(); }
    catch (e) { error.textContent = errorText(e); error.hidden = false; }
    finally { finish(); }
  });
  return h('section', { class: 'section stack hide-mode' },
    h('div', { class: 'row__head' }, h('h2', null, 'Hide mode'), on ? h('span', { class: 'tag tag--pass' }, 'On') : h('span', { class: 'tag' }, 'Off')),
    h('p', { class: 'muted' }, 'While hide mode is on, this account shows only the Test Event. Other events, deleted events and the organiser tools are hidden until you turn it off here.'),
    h('div', { class: 'actions' }, button), error);
}
