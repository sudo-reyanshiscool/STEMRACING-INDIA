import { reportActionError } from './actions';
import type { Ctx } from './ctx';
import { notFound } from './common';
import { h } from './dom';

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
      inFlight = true;
      submit.disabled = true;
      error.hidden = true;
      status.hidden = true;
      const data = new FormData(f);
      try {
        const team = await ctx.api.createTeam(eventId, { number: String(data.get('number') ?? ''), name: String(data.get('name') ?? ''), school: String(data.get('school') ?? '') });
        f.reset();
        status.textContent = `Added Team ${team.number}.`;
        status.hidden = false;
        await showTeams();
      } catch (err) {
        if (alive) reportActionError(ctx, error, err);
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
  );
}
