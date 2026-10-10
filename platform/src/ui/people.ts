import type { Panel, Role } from '../api';
import { reportActionError } from './actions';
import type { Ctx } from './ctx';
import { isPlausibleEmail, notFound } from './common';
import { h } from './dom';
import { INVITABLE, PANEL_LABEL, ROLE_LABEL } from './labels';

const PANELS = Object.keys(PANEL_LABEL) as Panel[];
const isJudgeRole = (r: string) => r === 'judge' || r === 'lead_judge';

export async function peopleScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const [event, roles, session] = await Promise.all([ctx.api.getEvent(eventId), ctx.api.myRoles(eventId), ctx.api.getSession()]);
  if (!event) return notFound('That event was not found.', '#/', 'All events');
  if (!roles.some((r) => r.role === 'organiser' || r.role === 'chair')) {
    return notFound('Only the organiser or chair can manage people.', `#/event/${encodeURIComponent(eventId)}`, event.name);
  }
  const teams = await ctx.api.listTeams(eventId);
  const teamLabel = (id: string | null) => {
    const t = teams.find((x) => x.id === id);
    return t ? `Team ${t.number} · ${t.name}` : '';
  };

  let alive = true;
  ctx.onLeave(() => { alive = false; });

  const peopleHolder = h('div', { 'data-section': 'people' });
  const inviteHolder = h('div', { 'data-section': 'invitations' });
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const status = h('p', { class: 'notice', role: 'status', hidden: true });
  const fail = (e: unknown) => { if (alive) reportActionError(ctx, error, e, { duplicate: 'That person already has this role or invitation.' }); };

  // One write at a time: every Remove/Withdraw/Send control is disabled while one is in flight.
  let inFlight = false;
  const controls = () => [...peopleHolder.querySelectorAll('button'), ...inviteHolder.querySelectorAll('button'), ...form.querySelectorAll('button')];
  const run = async (action: () => Promise<void>): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    error.hidden = true;
    status.hidden = true;
    controls().forEach((b) => { b.disabled = true; });
    try {
      await action();
    } catch (e) {
      fail(e);
    } finally {
      inFlight = false;
      controls().forEach((b) => { b.disabled = false; });
    }
  };

  const describe = (x: { role: Role; panel: Panel | null; teamId: string | null }) =>
    [ROLE_LABEL[x.role], x.panel ? PANEL_LABEL[x.panel] : '', teamLabel(x.teamId)].filter(Boolean).join(' · ');

  const refresh = async () => {
    const [allRoles, invites] = await Promise.all([ctx.api.listRoles(eventId), ctx.api.listInvitations(eventId)]);
    if (!alive) return;
    peopleHolder.replaceChildren(
      h('h2', null, 'People'),
      h('ul', { class: 'list' }, allRoles.map((r) => {
        const who = r.email ?? 'Account without a visible email';
        const removable = r.role !== 'organiser' && r.userId !== session?.userId;
        return h('li', null,
          h('strong', null, who), h('span', { class: 'muted small' }, describe(r)),
          removable ? h('button', { class: 'btn btn--ghost btn--small', type: 'button', 'aria-label': `Remove ${who}`, onclick: () => void run(async () => { await ctx.api.removeRole(r.id); await refresh(); }) }, 'Remove') : null);
      })),
    );
    inviteHolder.replaceChildren(
      h('h2', null, 'Invitations waiting'),
      invites.length === 0 ? h('p', { class: 'muted' }, 'No pending invitations.')
        : h('ul', { class: 'list' }, invites.map((i) => h('li', null,
            h('strong', null, i.email), h('span', { class: 'muted small' }, describe(i)),
            h('button', { class: 'btn btn--ghost btn--small', type: 'button', 'aria-label': `Withdraw invitation for ${i.email}`, onclick: () => void run(async () => { await ctx.api.removeInvitation(i.id); await refresh(); }) }, 'Withdraw')))),
    );
  };

  const roleSelect = h('select', { name: 'role', required: true }, h('option', { value: '' }, 'Choose a role'), INVITABLE.map((r) => h('option', { value: r }, ROLE_LABEL[r])));
  const panelSelect = h('select', { name: 'panel', required: true }, h('option', { value: '' }, 'Choose a panel'), PANELS.map((p) => h('option', { value: p }, PANEL_LABEL[p])));
  const teamSelect = h('select', { name: 'team', required: true }, h('option', { value: '' }, 'Choose a team'), teams.map((t) => h('option', { value: t.id }, `Team ${t.number} · ${t.name}`)));
  const panelField = h('label', { class: 'field', 'data-field': 'panel', hidden: true }, h('span', { class: 'field__label' }, 'Panel'), panelSelect);
  const teamField = h('label', { class: 'field', 'data-field': 'team', hidden: true }, h('span', { class: 'field__label' }, 'Team'), teamSelect);
  const sync = () => {
    panelField.hidden = !isJudgeRole(roleSelect.value);
    teamField.hidden = roleSelect.value !== 'team_manager';
  };
  roleSelect.addEventListener('change', sync);
  sync();

  const emailInput = h('input', { name: 'email', type: 'email', required: true, autocomplete: 'off' });
  const form: HTMLFormElement = h('form', { class: 'form', novalidate: true },
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Email address'), emailInput),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Role'), roleSelect),
    panelField, teamField,
    h('button', { class: 'btn btn--primary', type: 'submit' }, 'Send invitation'),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void run(async () => {
      const role = roleSelect.value as Role;
      const problem = !isPlausibleEmail(emailInput.value) ? 'Enter a valid email address, for example name@school.org.'
        : !role ? 'Choose a role.'
        : isJudgeRole(role) && !panelSelect.value ? 'Choose a panel for this judge.'
        : role === 'team_manager' && teams.length === 0 ? 'Add a team first, then invite its manager.'
        : role === 'team_manager' && !teamSelect.value ? 'Choose a team for this team manager.'
        : null;
      if (problem) {
        error.textContent = problem;
        error.hidden = false;
        return;
      }
      await ctx.api.invite(eventId, {
        email: emailInput.value,
        role,
        panel: isJudgeRole(role) ? (panelSelect.value as Panel) : undefined,
        teamId: role === 'team_manager' ? teamSelect.value : undefined,
      });
      status.textContent = `Invitation recorded for ${emailInput.value.trim().toLowerCase()}.`;
      status.hidden = false;
      emailInput.value = '';
      await refresh();
    });
  });

  await refresh();

  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' }, h('a', { class: 'back', href: `#/event/${encodeURIComponent(eventId)}` }, event.name), h('h1', null, 'People'),
      h('p', { class: 'lead' }, 'Invited people sign in with the email address you enter here and get their role automatically. Each invitation can be used once.')),
    error, status,
    h('section', { class: 'section' }, h('h2', null, 'Invite someone'), form),
    h('section', { class: 'section' }, peopleHolder),
    h('section', { class: 'section' }, inviteHolder),
  );
}
