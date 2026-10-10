import { StoreError } from '../store';
import type { Ctx } from './ctx';
import { h } from './dom';
import { routeHref } from './router';

const today = (): string => new Date().toISOString().slice(0, 10);

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function homeScreen(ctx: Ctx): Promise<HTMLElement> {
  const events = await ctx.store.listEvents();
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const show = (msg: string) => { error.textContent = msg; error.hidden = false; };

  const form = h('form', { class: 'form', novalidate: true },
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Event name'), h('input', { name: 'name', required: true, maxlength: 120, autocomplete: 'off' })),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Date'), h('input', { name: 'date', type: 'date', value: today(), required: true })),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Venue (optional)'), h('input', { name: 'venue', maxlength: 120, autocomplete: 'off' })),
    h('button', { class: 'btn btn--primary', type: 'submit' }, 'Create event'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    try {
      const ev = await ctx.store.createEvent({ name: String(f.get('name')), date: String(f.get('date')), venue: String(f.get('venue')) });
      location.hash = routeHref({ name: 'event', eventId: ev.id });
    } catch (err) {
      show(err instanceof StoreError ? err.message : 'Could not save the event.');
    }
  });

  const exportBtn = h('button', { class: 'btn btn--ghost btn--small', type: 'button' }, 'Export backup');
  exportBtn.addEventListener('click', async () => {
    const backup = await ctx.store.exportAll();
    download(`stem-racing-scrutineering-backup-${today()}.json`, JSON.stringify(backup));
  });
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', 'aria-label': 'Import backup file' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const report = await ctx.store.importAll(JSON.parse(await file.text()));
      window.alert(`Imported ${report.added.teams} teams and ${report.added.inspections} inspections; updated ${report.updated}.`);
      ctx.rerender();
    } catch (err) {
      show(err instanceof StoreError ? err.message : 'That file could not be read as a backup.');
    }
  });

  return h('div', { class: 'stack stack--lg' },
    h('div', { class: 'stack' },
      h('p', { class: 'eyebrow' }, 'Season 9'),
      h('h1', null, 'Digital scrutineering'),
      h('p', { class: 'lead' }, 'Record measurements at the inspection bench. Penalties follow the Aramco STEM Racing World Finals 2026 Technical Regulations.'),
    ),
    error,
    h('section', { class: 'section' }, h('h2', null, 'Events'),
      events.length === 0
        ? h('p', { class: 'muted' }, 'No events yet. Create one to start inspecting cars.')
        : h('ul', { class: 'list' }, events.map((e) =>
            h('li', null, h('a', { href: routeHref({ name: 'event', eventId: e.id }) }, h('strong', null, e.name)),
              h('span', { class: 'muted small' }, [e.date, e.venue].filter(Boolean).join(' · '))))),
    ),
    h('section', { class: 'section' }, h('h2', null, 'New event'), form),
    h('section', { class: 'section' }, h('h2', null, 'Backup'),
      h('p', { class: 'muted' }, 'Records live on this device only. Export a backup to keep a copy or to merge another device\'s records.'),
      h('div', { class: 'actions' }, exportBtn, h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Import backup'), fileInput)),
    ),
  );
}
