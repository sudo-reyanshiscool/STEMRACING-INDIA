import type { TeamRow } from '../api';
import { reportActionError } from './actions';
import type { Ctx } from './ctx';
import { h } from './dom';

export function deleteTeamControl(ctx: Ctx, team: TeamRow, refresh: () => Promise<void>): HTMLElement {
  let alive = true, busy = false;
  ctx.onLeave(() => { alive = false; });
  const label = `Team ${team.number} · ${team.name}`;
  const open = h('button', { class: 'btn btn--ghost btn--small', type: 'button', 'aria-label': `Delete ${label}`, 'aria-expanded': 'false' }, 'Delete team');
  const number = h('input', { type: 'text', autocomplete: 'off', 'aria-label': `Team number to confirm deleting ${label}` });
  const confirm = h('button', { class: 'btn btn--primary', type: 'button', disabled: true }, 'Confirm delete team');
  const cancel = h('button', { class: 'btn btn--ghost', type: 'button' }, 'Cancel');
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const panel = h('div', { class: 'stack', hidden: true },
    h('p', null, `Permanently delete ${label}? Draft scorecards, feedback, manager access, invitations, conflicts, overrides and penalties for this team will also be removed. This cannot be undone. Submitted scorecards must first be reopened by the Chair. Released results must be withdrawn first.`),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, `Type team number “${team.number}” to confirm`), number),
    error, h('div', { class: 'actions' }, confirm, cancel));
  open.addEventListener('click', () => { panel.hidden = false; open.hidden = true; open.setAttribute('aria-expanded', 'true'); number.focus(); });
  number.addEventListener('input', () => { confirm.disabled = busy || number.value !== team.number; });
  number.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirm.click(); } });
  cancel.addEventListener('click', () => {
    if (busy) return;
    panel.hidden = true; open.hidden = false; open.setAttribute('aria-expanded', 'false');
    number.value = ''; confirm.disabled = true; error.hidden = true; open.focus();
  });
  confirm.addEventListener('click', async () => {
    if (busy || number.value !== team.number) return;
    busy = true; confirm.disabled = true; cancel.disabled = true; number.disabled = true; error.hidden = true;
    try {
      await ctx.api.deleteTeam(team.eventId, team.id, number.value);
    } catch (e) {
      if (alive) {
        reportActionError(ctx, error, e, {
          locked: 'This team cannot be deleted while results are released or it has submitted scorecards. Ask the Chair to withdraw the release and reopen its submitted scorecards first.',
          invalid: 'The team number no longer matches. Reload the teams and try again.',
          forbidden: 'Only the Chair or Organiser can delete teams.',
          network: 'Could not reach the server. The deletion may have completed. Reload the team list before trying again.',
        });
        confirm.disabled = number.value !== team.number; cancel.disabled = false; number.disabled = false;
      }
      busy = false; return;
    }
    if (!alive) return;
    // A successful delete must not become a retryable deletion if refreshing the list fails.
    panel.replaceChildren(h('p', { class: 'notice', role: 'status' }, `Deleted ${label}.`));
    try { await refresh(); }
    catch { if (alive) panel.append(h('p', { role: 'alert', class: 'alert' }, 'The team was deleted. Reload to refresh the team list.')); }
  });
  return h('div', { class: 'stack' }, h('div', { class: 'actions' }, open), panel);
}
