import {ApiError,EVENT_LOGO_SLOTS,COMPETITION_LEVEL_LABEL,validateEventLogos,type CompetitionLevel} from '../api';
import {readEventLogo} from './event-branding';
import {managerOnly} from './team-garage';
import { buttonBusy } from './button-busy';
import { organiserControls } from './organisers';
import type { Ctx } from './ctx';
import { reportActionError } from './actions';
import { h } from './dom';
import { routeHref } from './router';
import { canShowcase, showcaseHref, SHOWCASE_EVENT_ID } from '../api/showcase';

const today = () => new Date().toISOString().slice(0, 10);

export async function eventsScreen(ctx: Ctx): Promise<HTMLElement> {
  const [events, deleted, canCreate, access, viewer] = await Promise.all([ctx.api.listEvents(), ctx.api.listDeletedEvents(), ctx.api.canCreateEvent(), ctx.api.platformAccess(), ctx.api.getSession()]);
  const showcaseEvent = !ctx.demo ? events.find(e => e.id === SHOWCASE_EVENT_ID) : undefined;
  const showcaseAvailable = showcaseEvent ? canShowcase(showcaseEvent, await ctx.api.myRoles(showcaseEvent.id)) : false;
  const teamView=!canCreate&&!access.kind&&events.length>0&&(await Promise.all(events.map(e=>ctx.api.myRoles(e.id)))).some(managerOnly);
  let alive = true;
  ctx.onLeave(() => { alive = false; });
  const error = h('p', { class: 'alert', role: 'alert', hidden: true });
  const submitBtn = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Create event');
  const level=h('select',{name:'level','aria-label':'Competition level'},h('option',{value:'regional'},'Regional finals'),h('option',{value:'national'},'National finals'));
  const regionalPreview=h('div',{class:'event-logo-preview event-logo-preview--dark'},h('img',{src:'/brand/logo-regional-finals-white.png',alt:'Regional finals logo'}));
  const slots=EVENT_LOGO_SLOTS.map(slot=>({...slot,input:h('input',{type:'file',accept:'.png,image/png','aria-label':`Nationals ${slot.label} logo`}),preview:h('div',{class:`event-logo-preview ${slot.dark?'event-logo-preview--dark':''}`},h('span',{class:'muted'},`${slot.dark?'Dark':'Light'} background preview`))}));
  const nationals=h('fieldset',{class:'event-logo-set stack',hidden:true},h('legend',null,'This event’s nationals logos'),h('p',{class:'muted small'},'PNG files, up to 2 MB each. Upload all four versions: two monochrome and two full-colour. This set belongs to this event.'),h('div',{class:'event-logo-set__slots'},slots.map(slot=>h('label',{class:'field'},slot.label,slot.input,slot.preview))));
  level.onchange=()=>{nationals.hidden=level.value!=='national';regionalPreview.hidden=level.value!=='regional';};
  slots.forEach(slot=>{let request=0;slot.input.onchange=async()=>{const current=++request;const file=slot.input.files?.[0];slot.preview.replaceChildren();if(!file)return;try{const logo=await readEventLogo(file);validateEventLogos({light:logo,dark:logo,monoBlack:logo,monoWhite:logo});if(current===request)slot.preview.append(h('img',{src:`data:image/png;base64,${logo.base64}`,alt:`Nationals ${slot.label} logo preview`}));}catch(err){if(current===request)slot.preview.append(h('span',{class:'alert'},err instanceof Error?err.message:'Check the logo file.'));}};});
  const form = h('form', { class: 'form', novalidate: true },
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Event name'), h('input', { name: 'name', required: true, maxlength: 120, autocomplete: 'off' })),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Date'), h('input', { name: 'date', type: 'date', value: today() })),
    h('label',{class:'field'},h('span',{class:'field__label'},'Competition level'),level),
    regionalPreview,nationals,submitBtn,
  );
  let busy = false;
  const deletedSection = h('details', { class: 'section' }, h('summary', null, `Deleted events (${deleted.length})`));
  if (deleted.length) deletedSection.append(h('ul', { class: 'list' }, deleted.map((event) => {
    const restore = h('button', { class: 'btn btn--ghost btn--small', type: 'button', 'aria-label': `Restore ${event.name}` }, 'Restore event');
    const failure = h('p', { class: 'alert', role: 'alert', hidden: true });
    restore.addEventListener('click', async () => {
      if (restore.disabled) return;
      const finish = buttonBusy(restore, 'Restoring…'); failure.hidden = true;
      try { await ctx.api.restoreEvent(event.id); if (alive) ctx.rerender(); }
      catch (e) { if (alive) { reportActionError(ctx, failure, e); } }
      finally { finish(); }
    });
    return h('li', null, h('strong', null, event.name), h('span', { class: 'muted small' }, event.startsOn ?? ''), restore, failure);
  })));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    error.hidden = true;
    const f = new FormData(form);
    if (!String(f.get('name') ?? '').trim()) {
      error.textContent = 'Event name is required.';
      error.hidden = false;
      return;
    }
    busy = true;
    const finish = buttonBusy(submitBtn, 'Creating event…');
    try {
      const competitionLevel=level.value as CompetitionLevel;
      let logos;
      if(competitionLevel==='national'){const files=slots.map(s=>({key:s.key,file:s.input.files?.[0]}));if(files.some(s=>!s.file))throw new Error('Upload all four nationals logos: monochrome black, monochrome white, full colour with white text, and full colour with black text.');const uploads=await Promise.all(files.map(async s=>[s.key,await readEventLogo(s.file!)] as const));logos=validateEventLogos(Object.fromEntries(uploads) as unknown as import('../api').EventLogos);}
      const ev = await ctx.api.createEvent({ name: String(f.get('name')), startsOn: String(f.get('date') ?? '') || undefined,competitionLevel,logos });
      location.hash = routeHref({ name: 'event', eventId: ev.id });
    } catch (err) {
      if(err instanceof Error && !(err instanceof ApiError)){error.textContent=err.message;error.hidden=false;}else reportActionError(ctx, error, err);
    } finally {
      busy = false;
      finish();
    }
  });
  return h('div', { class: teamView?'garage garage-calendar stack stack--lg':'stack stack--lg' },
    h('div', { class: 'stack' }, h('p', { class: 'eyebrow' }, 'STEM Racing India · Nationals & Regionals'), h('h1', null, 'Events'),
      h('p', { class: 'lead' }, teamView?'Your competition journey starts here. Open an event to enter your team garage.':'Judging, racing and results for each event, in one place.'),
      access.kind ? h('p', {class:'tag tag--pass'},access.displayTitle ? `${access.displayTitle} · ${access.kind==='competition'?'assigned events':'all events'}` : access.kind==='admin'?(access.ownerId===viewer?.userId?'Platform Admin · permanent access to every event':'Platform Administrator · all events'):access.kind==='platform'?'Platform Organiser · all events':access.kind==='spectator'?'Platform Spectator · read-only':'Competition Organiser · assigned events') : null),
    h('section', { class: 'section' },
      events.length === 0
        ? h('p', { class: 'muted' }, canCreate ? 'No events yet. Create one, or ask an organiser to invite you.' : 'No events yet. Ask an organiser to invite you to an event.')
        : h('ul', { class: 'list event-list' }, events.map((e) =>
            h('li', null, h('a', { href: routeHref({ name: 'event', eventId: e.id }) }, h('strong', null, e.name)),
              h('span', { class: 'muted small' }, e.startsOn ?? ''), e.competitionLevel?h('span',{class:'tag'},COMPETITION_LEVEL_LABEL[e.competitionLevel]):null,e.resultsReleased ? h('span', { class: 'tag tag--pass' }, 'Results released') : null,
              showcaseAvailable && e.id === SHOWCASE_EVENT_ID ? h('a', { class: 'btn btn--ghost btn--small', href: showcaseHref(e.id) }, 'Open showcase') : null)))),
    canCreate ? h('section', { class: 'section' }, h('h2', null, 'New event'), error, form) : null,
    deleted.length ? deletedSection : null,
    (access.canManage||access.kind==='spectator') ? organiserControls(ctx,access,viewer?.userId) : null,
  );
}
