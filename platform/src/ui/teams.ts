import { reportActionError } from './actions';
import type { Ctx } from './ctx';
import { notFound } from './common';
import { h } from './dom';
import { teamImport } from './team-import';

export async function teamsScreen(ctx: Ctx, eventId: string): Promise<HTMLElement> {
  const [event, roles] = await Promise.all([ctx.api.getEvent(eventId), ctx.api.myRoles(eventId)]);
  if (!event) return notFound('That event was not found.', '#/', 'All events');
  const canEdit = roles.some((r) => r.role === 'organiser' || r.role === 'chair');

  let alive = true;
  ctx.onLeave(() => { alive = false; });

  const listHolder = h('div');
  const showTeams = async () => {
    const teams = [...(await ctx.api.listTeams(eventId))].sort((a, b) => a.number.localeCompare(b.number, 'en', { numeric: true }));
    if (!alive) return;
    listHolder.replaceChildren(
      teams.length === 0
        ? h('p', { class: 'muted' }, 'No teams yet.')
        : h('ul', { class: 'list' }, teams.map((t) => h('li', null, h('strong', null, `Team ${t.number} · ${t.name}`), t.school ? h('span', { class: 'muted small' }, t.school) : null))),
    );
  };
  await showTeams();

  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const status = h('p', { class: 'notice', role: 'status', hidden: true });
  let form: HTMLFormElement | null = null;
  if (canEdit) {
    const submit = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Add team');
    const f = h('form', { class: 'form', novalidate: true },
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Team number'), h('input', { name: 'number', required: true, maxlength: 12, autocomplete: 'off' })),
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Team name'), h('input', { name: 'name', required: true, maxlength: 80, autocomplete: 'off' })),
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'School or club (optional)'), h('input', { name: 'school', maxlength: 120, autocomplete: 'off' })),
      submit,
    );
    form = f;
    let inFlight = false;
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (inFlight) return;
      error.hidden = true;
      status.hidden = true;
      const data = new FormData(f);
      const number = String(data.get('number') ?? '').trim();
      const name = String(data.get('name') ?? '').trim();
      const school = String(data.get('school') ?? '').trim();
      const problem = !number ? 'Enter a team number.'
        : number.length > 12 ? 'The team number must be 12 characters or fewer.'
        : !name ? 'Enter a team name.'
        : name.length > 80 ? 'The team name must be 80 characters or fewer.'
        : school.length > 120 ? 'The school or club must be 120 characters or fewer.'
        : null;
      if (problem) {
        error.textContent = problem;
        error.hidden = false;
        return;
      }
      inFlight = true;
      submit.disabled = true;
      try {
        const team = await ctx.api.createTeam(eventId, { number, name, school });
        f.reset();
        status.textContent = `Added Team ${team.number}.`;
        status.hidden = false;
        await showTeams();
      } catch (err) {
        if (alive) reportActionError(ctx, error, err, { duplicate: 'That team number is already used in this event' });
      } finally {
        inFlight = false;
        submit.disabled = false;
      }
    });
  }

  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' }, h('a', { class: 'back', href: `#/event/${encodeURIComponent(eventId)}` }, event.name), h('h1', null, 'Teams')),
    h('section', { class: 'section' }, listHolder),
    form ? h('section', { class: 'section' }, h('h2', null, 'Add a team'), error, status, form) : null,
    canEdit ? teamImport(ctx, eventId, showTeams) : null,
  );
}
