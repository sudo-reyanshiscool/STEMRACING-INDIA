import type { Ctx } from './ctx';
import { actionErrorText } from './actions';
import { h } from './dom';
import { MAX_CSV_BYTES, parseTeamCsv, type TeamCsvPreview } from '../import/teamsCsv';

export function teamImport(ctx: Ctx, eventId: string, onImported: () => Promise<void>): HTMLElement {
  let alive = true, token = 0, importing = false;
  let csv = '', parsed: TeamCsvPreview | null = null;
  ctx.onLeave(() => { alive = false; token++; });
  const file = h('input', { type: 'file', accept: '.csv,text/csv', 'aria-label': 'Teams CSV file' });
  const preview = h('div', { class: 'stack', hidden: true });
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const status = h('p', { class: 'small', role: 'status', hidden: true });
  const confirm = h('button', { class: 'btn btn--primary', type: 'button', disabled: true }, 'Import teams');
  const cancel = h('button', { class: 'btn btn--ghost', type: 'button' }, 'Clear file');
  const reset = () => { token++; file.value = ''; csv = ''; parsed = null; preview.hidden = true; preview.replaceChildren(); confirm.disabled = true; confirm.textContent = 'Import teams'; error.hidden = true; status.hidden = true; };
  const show = (data: TeamCsvPreview) => {
    parsed = data; preview.hidden = false; confirm.disabled = data.errors.length > 0 || !data.teams.length || importing;
    preview.replaceChildren(h('div', { class: 'stack' },
      data.errors.length ? h('div', { class: 'alert stack', role: 'alert' },
        h('strong', null, 'Nothing has been imported. Fix these rows and choose the corrected file.'),
        h('ul', null, data.errors.slice(0, 50).map((e) => h('li', null, `${e.row ? `Row ${e.row}: ` : ''}${e.message}`))),
        data.errors.length > 50 ? h('p', null, `${data.errors.length - 50} more problems in this file.`) : null) : null,
      h('p', null, `${data.teams.length} team${data.teams.length === 1 ? '' : 's'} ${data.errors.length ? 'valid so far' : 'ready to import'}.`),
      data.teams.some(t=>!t.managerEmail)?h('p',{class:'notice'},'Teams without a manager email can be imported. Add their email in Teams before sending final results.'):null,
      data.ignoredColumns.length ? h('p', { class: 'small muted' }, `Other columns will be ignored: ${data.ignoredColumns.join(', ')}.`) : null,
      data.teams.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('caption', null, `Preview${data.teams.length > 20 ? ' — first 20 teams' : ''}`),
        h('thead', null, h('tr', null, ['Number', 'Team name', 'School or club', 'Manager email'].map((label) => h('th', { scope: 'col' }, label)))),
        h('tbody', null, data.teams.slice(0, 20).map((team) => h('tr', null, h('td', null, team.number), h('td', null, team.name), h('td', null, team.school),h('td',null,team.managerEmail??'Not provided')))))) : null,
    ));
    confirm.textContent = `Import ${data.teams.length} team${data.teams.length === 1 ? '' : 's'}`;
  };
  file.addEventListener('change', async () => {
    if (importing) return;
    const mine = ++token;
    csv = ''; parsed = null; confirm.disabled = true; preview.hidden = true; error.hidden = true; status.hidden = true;
    const selected = file.files?.[0];
    if (!selected) return;
    if (selected.size > MAX_CSV_BYTES) { error.textContent = 'Choose a CSV file smaller than 1 MB.'; error.hidden = false; return; }
    status.textContent = 'Reading CSV…'; status.hidden = false;
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not read file')); reader.readAsText(selected, 'UTF-8');
      });
      const existing = await ctx.api.listTeams(eventId);
      if (!alive || mine !== token) return;
      csv = text; show(parseTeamCsv(csv, existing)); status.hidden = true;
    } catch (e) {
      if (!alive || mine !== token) return;
      status.hidden = true; error.textContent = 'Could not read or check this file. Choose a UTF-8 CSV and try again.'; error.hidden = false;
    }
  });
  cancel.addEventListener('click', () => { if (!importing) reset(); });
  confirm.addEventListener('click', async () => {
    if (importing || !parsed || parsed.errors.length || !parsed.teams.length) return;
    importing = true; confirm.disabled = true; cancel.disabled = true; file.disabled = true; error.hidden = true; status.hidden = true;
    let saved = false;
    try {
      // Re-check numbers against the latest list in case another person added a team after the preview.
      const current = parseTeamCsv(csv, await ctx.api.listTeams(eventId));
      if (!alive) return;
      show(current); if (current.errors.length) return;
      const imported = await ctx.api.importTeams(eventId, current.teams);
      saved = true;
      if (!alive) return;
      reset(); status.textContent = `Imported ${imported.length} team${imported.length === 1 ? '' : 's'}.`; status.hidden = false;
      await onImported();
    } catch (e) {
      if (!alive) return;
      error.textContent = saved ? 'The teams were imported, but the list could not be refreshed. Reload the page to see them.' : actionErrorText(e, {
        duplicate: 'A team number was added while you were importing. Nothing was imported. Choose the CSV again to check the latest team list.',
        invalid: 'The file could not be imported. Check the team numbers, names and school lengths. Nothing was imported.',
        network: 'Could not reach the server. Check the team list before retrying; the request may already have completed.',
        'not-found': 'This event is no longer available. Go back to Events.',
      }); error.hidden = false;
    } finally {
      importing = false;
      if (alive) { file.disabled = false; cancel.disabled = false; confirm.disabled = saved || !parsed || parsed.errors.length > 0 || !parsed.teams.length; }
    }
  });
  return h('section', { class: 'section stack', 'aria-label': 'Import teams from CSV' },
    h('h2', null, 'Import teams from CSV'),
    h('p', null, 'Choose a UTF-8 CSV with number, name and manager_email columns, plus an optional school column. A manager email is required for every row when that column is included. Team numbers stay as text, including leading zeros. Up to 1000 teams and 1 MB per file.'),
    h('a', { href: '/templates/teams.csv', download: 'teams-template.csv' }, 'Download CSV template'),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Choose CSV file'), file),
    status, error, preview, h('div', { class: 'actions' }, confirm, cancel));
}
