import { ApiError, type Panel, type Role, type RoleRow } from '../api';
import { reportActionError } from './actions';
import type { Ctx } from './ctx';
import { isPlausibleEmail, notFound } from './common';
import { h } from './dom';
import { judgeExemptionEditor } from './judge-exemptions';
import { judgeAssignmentEditor } from './judge-assignments';
import { INVITABLE, PANEL_LABEL, ROLE_LABEL } from './labels';

const PANELS = Object.keys(PANEL_LABEL) as Panel[];
const isJudgeRole = (r: string) => r === 'judge' || r === 'lead_judge';

export async function peopleScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const [event, roles, session] = await Promise.all([ctx.api.getEvent(eventId), ctx.api.myRoles(eventId), ctx.api.getSession()]);
  if (!event) return notFound('That event was not found.', '#/', 'All events');
  if (!roles.some((r) => r.role === 'organiser' || r.role === 'chair')) {
    return notFound('Only the organiser or chair can manage people.', `#/event/${encodeURIComponent(eventId)}`, event.name);
  }
  const isOrganiser = roles.some((r) => r.role === 'organiser');
  const teams = await ctx.api.listTeams(eventId);
  const teamLabel = (id: string | null) => {
    const t = teams.find((x) => x.id === id);
    return t ? `Team ${t.number} · ${t.name}` : '';
  };

  let members: RoleRow[] = [];
  let alive = true;
  ctx.onLeave(() => { alive = false; });

  const peopleHolder = h('div', { 'data-section': 'people' });
  const assignmentHolder = h('div', { class: 'stack stack--lg', 'data-section': 'assignments' });
  const inviteHolder = h('div', { 'data-section': 'invitations' });
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const status = h('p', { class: 'notice', role: 'status', hidden: true });
  const fail = (e: unknown) => {
    if (alive) {
      reportActionError(ctx, error, e, {
        duplicate: 'That person already has this role or invitation.',
        locked: e instanceof ApiError && /at least one organiser/i.test(e.message) ? 'An event must have at least one organiser.' : undefined,
      });
    }
  };

  // One write at a time: every Remove/Withdraw/Send control is disabled while one is in flight.
  let inFlight = false;
  const controls = () => [...peopleHolder.querySelectorAll('button'), ...inviteHolder.querySelectorAll('button'), ...assignmentHolder.querySelectorAll('button'), ...form.querySelectorAll('button')];
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
    [ROLE_LABEL[x.role], x.panel ? PANEL_LABEL[x.panel] : '', teamLabel(x.teamId) || (x.role === 'judge' ? 'All teams' : '')].filter(Boolean).join(' · ');

  const refresh = async () => {
    const [allRoles, invites, exemptions] = await Promise.all([ctx.api.listRoles(eventId), ctx.api.listInvitations(eventId), ctx.api.listJudgeExemptions(eventId)]);
    if (!alive) return;
    members = allRoles;
    syncSubmit();
    peopleHolder.replaceChildren(
      h('h2', null, 'People'),
      h('ul', { class: 'list' }, allRoles.map((r) => {
        const who = r.email ?? 'Account without a visible email';
        const isSelf = r.userId === session?.userId;
        const orgCount = allRoles.filter((x) => x.role === 'organiser').length;
        const removable = !isSelf && (
          r.role === 'organiser' ? (isOrganiser && orgCount > 1) : true
        );
        return h('li', null,
          h('strong', null, who), h('span', { class: 'muted small' }, describe(r)),
          removable ? h('button', { class: 'btn btn--ghost btn--small', type: 'button', 'aria-label': r.role === 'judge' ? `Remove ${describe(r)} assignment for ${who}` : `Remove ${who}`, onclick: () => void run(async () => { await ctx.api.removeRole(r.id); await refresh(); }) }, r.role === 'judge' ? 'Remove assignment' : 'Remove') : null);
      })),
    );
    inviteHolder.replaceChildren(
      h('h2', null, 'Invitations waiting'),
      invites.length === 0 ? h('p', { class: 'muted' }, 'No pending invitations.')
        : h('ul', { class: 'list' }, invites.map((i) => h('li', null,
            h('strong', null, i.email), h('span', { class: 'muted small' }, describe(i)),
            h('span', { class: `small ${i.emailStatus === 'failed' ? 'invite-email-failed' : 'muted'}` }, i.emailStatus === 'sent' ? `Email sent${i.emailSentAt ? ` · ${new Date(i.emailSentAt).toLocaleString()}` : ''}` : i.emailStatus === 'sending' ? 'Email delivery pending — check before resending' : i.emailStatus === 'failed' ? i.emailFailure === 'rate_limit' ? 'Email not sent — provider sending limit reached' : 'Email not sent — resend to try again' : 'Email not sent'),
            h('div', { class: 'actions' },
              h('button', { class: 'btn btn--ghost btn--small', type: 'button', 'aria-label': `Resend invitation for ${i.email}`, onclick: () => void run(async () => {
                try { await ctx.api.sendInvitation(i.id); status.textContent = `Invitation email sent to ${i.email}.`; status.hidden = false; }
                finally { await refresh(); }
              }) }, 'Resend invitation'),
              h('button', { class: 'btn btn--ghost btn--small', type: 'button', 'aria-label': `Withdraw invitation for ${i.email}`, onclick: () => void run(async () => { await ctx.api.removeInvitation(i.id); await refresh(); }) }, 'Withdraw'))))),
    );
    assignmentHolder.replaceChildren(judgeAssignmentEditor(ctx,eventId,allRoles,teams,run,async()=>{await refresh();status.textContent='Judge assignment saved. Their other panels are unchanged.';status.hidden=false;}),judgeExemptionEditor(allRoles,teams,exemptions,(user,team,exempt,reason)=>void run(async()=>{
      try { await ctx.api.setJudgeExemption(eventId,user,team,exempt,reason); } catch(e) {
        if(e instanceof ApiError && e.code==='locked'){error.textContent='The Chair must reopen this judge’s submitted scorecards for the team before adding an exemption.';error.hidden=false;return;}throw e;
      }
      await refresh();status.textContent=exempt?'Judge exempted from this team across all panels.':'Exemption removed.';status.hidden=false;
    })));
    if (inFlight) controls().forEach(b => { b.disabled = true; });
  };

  const invitableRoles = isOrganiser ? INVITABLE : INVITABLE.filter((r) => r !== 'organiser');
  const roleSelect = h('select', { name: 'role', required: true }, h('option', { value: '' }, 'Choose a role'), invitableRoles.map((r) => h('option', { value: r }, ROLE_LABEL[r])));
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
  const inviteButton = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Send invitation');
  const existingPerson = () => members.find(r => r.email?.trim().toLowerCase() === emailInput.value.trim().toLowerCase());
  const syncSubmit = () => { inviteButton.textContent = roleSelect.value === 'judge' && existingPerson() ? 'Add judging assignment' : 'Send invitation'; };
  emailInput.addEventListener('input', syncSubmit);
  roleSelect.addEventListener('change', syncSubmit);
  const form: HTMLFormElement = h('form', { class: 'form', novalidate: true },
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Email address'), emailInput),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Role'), roleSelect),
    panelField, teamField,
    inviteButton,
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
      const existing = existingPerson();
      if (role === 'organiser' && existing) {
        if (members.some(r => r.userId === existing.userId && r.role === 'organiser')) {
          status.textContent = `${emailInput.value.trim().toLowerCase()} is already an organiser of this event.`;
          status.hidden = false;
          return;
        }
      }
      if (role === 'judge' && existing) {
        const panel = panelSelect.value as Panel;
        const alreadyAssigned = members.some(r => r.userId === existing.userId && r.role === 'judge' && r.panel === panel);
        if (alreadyAssigned) {
          status.textContent = `This person already judges ${PANEL_LABEL[panel]}. Use Judge assignments to change their team scope.`;
          status.hidden = false;
          return;
        }
        await ctx.api.setJudgeAssignment(eventId, existing.userId, panel, null);
        const email = emailInput.value.trim().toLowerCase();
        emailInput.value = '';
        await refresh();
        status.textContent = `${PANEL_LABEL[panel]} added for ${email}. Their existing panels remain active. No new invitation is needed.`;
        status.hidden = false;
        return;
      }
      try { await ctx.api.invite(eventId, {
        email: emailInput.value,
        role,
        panel: isJudgeRole(role) ? (panelSelect.value as Panel) : undefined,
        teamId: role === 'team_manager' ? teamSelect.value : undefined,
      }); } catch (e) {
        if (e instanceof ApiError && (e.code === 'email-delivery' || e.code === 'rate-limited')) {
          emailInput.value = ''; await refresh();
        }
        throw e;
      }
      status.textContent = `Invitation email sent to ${emailInput.value.trim().toLowerCase()}.`;
      status.hidden = false;
      emailInput.value = '';
      await refresh();
    });
  });

  await refresh();

  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' }, h('a', { class: 'back', href: `#/event/${encodeURIComponent(eventId)}` }, event.name), h('h1', null, 'People'),
      h('p', { class: 'lead' }, 'We email invited people a secure sign-in link. They receive their assigned role after verifying the same email address. Each invitation can be used once.')),
    error, status,
    h('section', { class: 'section' }, h('h2', null, 'Invite someone or add an assignment'),
      h('p', { class: 'muted' }, 'For someone already in this event, entering their email and choosing another Judge panel adds it immediately alongside their existing panels.'),
      h('p', { class: 'small muted' }, 'For Specification scorecards, choose Judge → Specification & Scrutineering. The separate Scrutineer role is inspection staff access.'), form),
    h('section', { class: 'section' }, assignmentHolder),
    h('section', { class: 'section' }, peopleHolder),
    h('section', { class: 'section' }, inviteHolder),
  );
}
