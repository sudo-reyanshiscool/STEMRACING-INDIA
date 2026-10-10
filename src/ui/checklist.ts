import { summarise, type Measurements, type Value } from '../engine';
import { SECTIONS, WF26 } from '../rules';
import type { Inspection } from '../store';
import type { Ctx } from './ctx';
import { h } from './dom';
import { routeHref } from './router';
import { ruleRow } from './rows';

export async function checklistScreen(ctx: Ctx, carId: string): Promise<HTMLElement> {
  const car = await ctx.store.getCar(carId);
  const team = car ? await ctx.store.getTeam(car.teamId) : undefined;
  if (!car || !team) {
    return h('div', { class: 'stack' }, h('p', null, 'That car was not found on this device.'), h('a', { href: '#/' }, 'Back to events'));
  }

  const existing = await ctx.store.getInspection(carId);
  const insp: Inspection = existing ?? {
    carId, scrutineer: '', startedAt: Date.now(), updatedAt: Date.now(), measurements: {}, notes: {},
  };
  const measurements: Measurements = { ...insp.measurements };

  const saveError = h('p', { class: 'alert', role: 'alert', hidden: true }, 'Could not save to this device. Export a backup and check browser storage.');

  // Serialise writes so a fast typist never races an older save over a newer one.
  let queue: Promise<unknown> = Promise.resolve();
  const save = (): void => {
    const snapshot: Inspection = { ...insp, measurements: structuredClone(measurements) };
    queue = queue
      .then(() => ctx.store.saveInspection(snapshot))
      .then((saved) => { insp.updatedAt = saved.updatedAt; saveError.hidden = true; })
      .catch(() => { saveError.hidden = false; });
  };

  const total = h('span', { class: 'bar__total' }, '0');
  const meta = h('span', { class: 'bar__meta' });
  const bar = h('div', { class: 'bar', role: 'status', 'aria-label': 'Penalty total' },
    h('span', null, h('span', { class: 'eyebrow' }, 'Penalty points, this car'), h('br'), total),
    meta,
    h('a', { class: 'btn btn--primary btn--small', href: routeHref({ name: 'summary', carId }) }, 'See summary'),
  );

  const rows = new Map<string, ReturnType<typeof ruleRow>>();
  const refresh = (): void => {
    const s = summarise(WF26.rules, measurements);
    for (const r of s.results) rows.get(r.article)?.showResult(r);
    total.textContent = String(s.total);
    const items = [
      h('span', null, `${s.pending.length} to do`),
      h('span', null, `${s.perfFailures.length} performance`),
      h('span', null, `${s.safetyFailures.length} safety`),
    ];
    if (s.ineligibleFor.length) items.push(h('span', null, 'Not eligible for Fastest Car or Best Engineered Car'));
    meta.replaceChildren(...items);
  };

  const sections = SECTIONS.map((sec) => {
    const els = WF26.rules.filter((r) => r.section === sec.id).map((rule) => {
      const row = ruleRow(rule, measurements[rule.article], (v: Value) => {
        if (v === undefined) delete measurements[rule.article]; else measurements[rule.article] = v;
        refresh();
        save();
      });
      rows.set(rule.article, row);
      return row.el;
    });
    return h('section', { class: 'section' }, h('h2', null, sec.title), els);
  });

  const scrutineer = h('input', { value: insp.scrutineer, maxlength: 80, autocomplete: 'off', 'aria-label': 'Scrutineer name' });
  scrutineer.addEventListener('input', () => { insp.scrutineer = scrutineer.value.trim(); save(); });

  const screen = h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' },
      h('a', { class: 'back', href: routeHref({ name: 'event', eventId: team.eventId }) }, 'Back to teams'),
      h('p', { class: 'eyebrow' }, WF26.name),
      h('h1', null, `Team ${team.number} · Car ${car.label}`),
      h('p', { class: 'lead' }, team.name),
      h('label', { class: 'field', style: 'max-width: 320px' }, h('span', { class: 'field__label' }, 'Scrutineer'), scrutineer),
    ),
    saveError,
    bar,
    ...sections,
    h('div', { class: 'actions' }, h('a', { class: 'btn btn--primary', href: routeHref({ name: 'summary', carId }) }, 'See summary')),
  );
  refresh();
  return screen;
}
