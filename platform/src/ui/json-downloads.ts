import type { EventRow } from '../api';
import { carsExport } from '../api/cars-export';
import { awardsExport, nominationsExport, resultsExport } from '../api/results-export';
import { heatMatchupsExport, heatsExport, jsonFileName } from '../racing/heats-export';
import { errorText } from './common';
import type { Ctx } from './ctx';
import { h } from './dom';

export function saveJson(data: unknown, name: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
  h('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Every event record as a JSON file, for graphics, ceremony decks and archives. Each button reads the data when it
 * is pressed, so the file always reflects what is saved at that moment.
 */
export function jsonDownloads(ctx: Ctx, event: EventRow): HTMLElement {
  const status = h('p', { class: 'notice', role: 'status', hidden: true });
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  let alive = true; ctx.onLeave(() => { alive = false; });
  const id = event.id;
  /** Returns the file and a one-line confirmation, or a plain reason there is nothing to download yet. */
  const builders: Array<{ label: string; file: string; title: string; build: () => Promise<{ data: unknown; note: string } | string> }> = [
    { label: 'Results', file: 'Results', title: 'The latest ranking snapshot: every team with its rank, total and area scores', build: async () => {
      const [snapshot, teams] = await Promise.all([ctx.api.latestSnapshot(id), ctx.api.listTeams(id)]);
      if (!snapshot) return 'There is no ranking snapshot yet. Take one on the Scores page first.';
      return { data: resultsExport({ event, released: event.resultsReleased, ruleset: event.ruleset, snapshot, teams }), note: `Results JSON downloaded: ${snapshot.rows.length} teams${event.resultsReleased ? '' : '. These results are not released yet'}.` };
    } },
    { label: 'Awards', file: 'Awards', title: 'The award winners entered below', build: async () => {
      const [mail, teams] = await Promise.all([ctx.api.resultMailState(id), ctx.api.listTeams(id)]);
      if (!mail.awards.length) return 'No award winners have been entered yet.';
      return { data: awardsExport({ event, awards: mail.awards, confirmed: mail.confirmed, teams }), note: `Awards JSON downloaded: ${mail.awards.length} award${mail.awards.length === 1 ? '' : 's'}${mail.confirmed ? '' : ', not yet confirmed'}.` };
    } },
    { label: 'Nominations', file: 'Nominations', title: 'Award nominations from submitted scorecards, counted per team', build: async () => {
      const [rows, teams] = await Promise.all([ctx.api.listNominations(id), ctx.api.listTeams(id)]);
      const data = nominationsExport({ event, rows, teams });
      if (!data.awards.some((a) => a.nominees.length)) return 'No award nominations on submitted cards yet.';
      return { data, note: 'Nominations JSON downloaded.' };
    } },
    { label: 'Heats', file: 'Heats', title: 'Every race heat with lanes, cars, statuses and times', build: async () => {
      const [races, teams] = await Promise.all([ctx.api.listRaces(id), ctx.api.listTeams(id)]);
      if (!races.length) return 'No race heats have been created yet.';
      return { data: heatsExport({ event, teams, races }), note: `Heats JSON downloaded: ${races.length} heats.` };
    } },
    { label: 'Heats for graphics', file: 'Heats-Graphics', title: 'One entry per pairing, team against team. Cars, lanes, lane swaps and reruns are merged.', build: async () => {
      const [races, teams] = await Promise.all([ctx.api.listRaces(id), ctx.api.listTeams(id)]);
      if (!races.length) return 'No race heats have been created yet.';
      const data = heatMatchupsExport({ event, teams, races });
      return { data, note: `Graphics JSON downloaded: ${data.matchups.length} pairings.` };
    } },
    { label: 'Cars', file: 'Cars', title: 'Each car\'s total width, total height, weight and wheelbase as measured at scrutineering, for analysis graphics', build: async () => {
      const [inspections, teams] = await Promise.all([ctx.api.listInspections(id), ctx.api.listTeams(id)]);
      const data = carsExport({ event, inspections, teams });
      if (!data.cars.some((c) => c.widthMm !== null || c.heightMm !== null)) return 'No car has a width or height reading yet.';
      return { data, note: `Cars JSON downloaded: ${data.cars.length} car${data.cars.length === 1 ? '' : 's'}.` };
    } },
  ];
  const buttons = builders.map((b) => {
    const button = h('button', { class: 'btn btn--ghost', type: 'button', title: b.title }, `${b.label} JSON`) as HTMLButtonElement;
    button.onclick = async () => {
      if (button.disabled) return;
      button.disabled = true; error.hidden = true; status.hidden = true;
      try {
        const built = await b.build();
        if (!alive) return;
        if (typeof built === 'string') status.textContent = built;
        else { saveJson(built.data, jsonFileName(event.name, b.file)); status.textContent = built.note; }
        status.hidden = false;
      } catch (e) {
        console.error(e);
        if (alive) { error.textContent = errorText(e); error.hidden = false; }
      } finally { button.disabled = false; }
    };
    return button;
  });
  return h('section', { class: 'section stack', 'aria-label': 'JSON downloads' },
    h('h2', null, 'Download event data (JSON)'),
    h('p', { class: 'muted' }, 'For graphics, ceremony slides and records. Each file is built from what is saved right now.'),
    h('div', { class: 'actions' }, buttons), status, error);
}
