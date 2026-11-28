import { ApiError, cardFor, passLinkUrl, type TeamPass, type TeamPasses } from '../api';
import { createPassCard, type PassCard } from '../pass/card/card';
import { drawLinkQr } from '../pass/card/qr';
import { codeAt, importSecret } from '../pass/code';
import { makePortrait } from '../pass/portrait';
import { errorText, notFound } from './common';
import type { Ctx } from './ctx';
import { h } from './dom';
import { routeHref } from './router';
import { spectatorOnly } from './spectator';

export interface PassesDeps {
  /** Where the student's link points. The site's own address unless a test says otherwise. */
  origin?: string;
  confirm?: (question: string) => boolean;
  shader?: boolean;
  makePortrait?: (source: string | Blob, mime?: string) => Promise<string | null>;
}

/**
 * Paddock Passes: a team's digital ID cards. The team manager sends each student their pass, or shows it for them
 * from this phone. Organisers and the Chair can do the same for any team, as a help desk on the day.
 */
export async function passesScreen(ctx: Ctx, eventId: string, deps: PassesDeps = {}): Promise<HTMLElement> {
  const [event, roles, teams] = await Promise.all([ctx.api.getEvent(eventId), ctx.api.myRoles(eventId), ctx.api.listTeams(eventId)]);
  const staff = roles.some((r) => r.role === 'organiser' || r.role === 'chair');
  const available = teams.filter((t) => staff || roles.some((r) => r.role === 'team_manager' && r.teamId === t.id));
  if (!event || spectatorOnly(roles) || !available.length) return notFound('Paddock Passes are available to your team and event organisers.', routeHref({ name: 'event', eventId }), 'Back to event');

  const ask = deps.confirm ?? ((q: string) => window.confirm(q)), make = deps.makePortrait ?? makePortrait;
  const origin = deps.origin ?? location.origin;
  let alive = true, request = 0, data: TeamPasses | null = null, offset = 0, selected: string | null = null;
  let link: { passId: string; url: string } | null = null, busy = false, closeShow: (() => void) | null = null;
  /** The card the row is being scrolled to by the page itself, and when to stop waiting for it. */
  let heading: { id: string; until: number } | null = null;
  const cards = new Map<string, PassCard>(), presenting = new Map<string, CryptoKey>(), remade = new Set<string>();
  const clock = () => Date.now() + offset;
  const dropCards = () => { cards.forEach((c) => c.destroy()); cards.clear(); };
  ctx.onLeave(() => { alive = false; request++; closeShow?.(); dropCards(); });

  const select = available.length > 1 ? h('select', { 'aria-label': 'Team' }, available.map((t) => h('option', { value: t.id }, `${t.number} · ${t.name}`))) : null;
  const teamId = () => select?.value ?? available[0].id;
  const status = h('p', { class: 'passes-status', role: 'status', 'aria-live': 'polite' });
  const row = h('div', { class: 'passes-row', role: 'list', 'aria-label': 'Passes' }), panel = h('section', { class: 'passes-panel card stack' });
  const root = h('div', { class: 'stack stack--lg passes-page' },
    h('header', { class: 'stack' }, h('p', { class: 'eyebrow' }, 'RACE DAY / PADDOCK PASSES'), h('h1', null, 'Paddock Passes'),
      h('p', { class: 'lead' }, 'Digital ID cards for the team. Send each student their pass, or show it for them from this phone. Staff check passes at the entrance and around the venue.')),
    select ? h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Team'), select) : null,
    status, row, panel);

  const when = (iso: string | null, withDay = false) => {
    if (!iso || !data) return '';
    try { return new Intl.DateTimeFormat('en-GB', { timeZone: data.timezone, hour: '2-digit', minute: '2-digit', hour12: false, ...(withDay ? { day: 'numeric', month: 'short' } : {}) }).format(new Date(iso)); }
    catch { return ''; }
  };
  const act = async (label: string, work: () => Promise<void>) => {
    if (busy) return;
    busy = true; status.textContent = label; paintPanel();
    try { await work(); if (alive && status.textContent === label) status.textContent = ''; }
    catch (e) { if (alive) status.textContent = errorText(e); }
    finally { busy = false; if (alive) paintPanel(); }
  };

  function choose(id: string, scroll = true): void {
    if (selected !== id) link = null;
    selected = id;
    for (const [passId, card] of cards) card.setActive(passId === id && !closeShow);
    for (const item of row.children) {
      const on = (item as HTMLElement).dataset.pass === id;
      item.setAttribute('aria-current', on ? 'true' : 'false');
      if (on && scroll) { heading = { id, until: Date.now() + 2500 }; (item as HTMLElement).scrollIntoView?.({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }
    }
    paintPanel();
  }

  function paintRow(): void {
    if (!data) return;
    const keep = new Set(data.passes.map((p) => p.id));
    for (const [id, card] of cards) if (!keep.has(id)) { card.destroy(); cards.delete(id); }
    row.replaceChildren(...data.passes.map((p) => {
      const details = cardFor(data!, p);
      let card = cards.get(p.id);
      if (card) card.update(details);
      else { card = createPassCard(details, { tapToFlip: false, active: false, shader: deps.shader, now: clock }); cards.set(p.id, card); }
      card.el.removeAttribute('tabindex');
      return h('div', { class: 'passes-row__item', role: 'listitem', tabindex: '0', 'data-pass': p.id, 'aria-label': `${p.name || 'Team manager'}, ${p.role}`,
        onclick: () => choose(p.id), onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(p.id); } } }, card.el);
    }));
    row.hidden = data.passes.length === 0;
  }

  function statusLine(p: TeamPass): string {
    if (p.kind === 'manager') return p.mine ? 'Your own pass. It opens on this phone when you press Show my pass.' : 'The team manager shows this pass from their own phone.';
    if (p.status === 'claimed') return `On a phone since ${when(p.claimedAt, true)}.`;
    if (p.status === 'sent') return `Link sent at ${when(p.linkSentAt)}. Waiting to be opened.`;
    return 'Not sent yet.';
  }

  function paintPanel(): void {
    if (!data) { panel.hidden = true; return; }
    const pass = data.passes.find((p) => p.id === selected);
    panel.hidden = false;
    if (!pass) {
      panel.replaceChildren(h('h2', null, 'No passes for this team yet'),
        h('p', null, 'Passes are made for the people in the team’s member list. Add each member’s name, role and portrait under Submissions and their pass appears here.'),
        h('div', { class: 'actions' }, h('a', { class: 'btn btn--secondary', href: routeHref({ name: 'submissions', eventId }) }, 'Open Submissions')));
      return;
    }
    const button = (label: string, style: string, run: () => void) => h('button', { type: 'button', class: `btn ${style}`, disabled: busy, onclick: run }, label);
    const parts: Array<Node | null> = [h('h2', null, pass.name || 'Team manager'), h('p', { class: 'muted' }, `${pass.role} · ${statusLine(pass)}`)];
    if (pass.kind === 'student') {
      parts.push(h('div', { class: 'actions' }, button('Send to phone', 'btn--primary', () => void send(pass)), button('Show this pass', 'btn--secondary', () => void show(pass)),
        pass.status !== 'new' ? button('Reset pass', 'btn--ghost', () => void reset(pass)) : null));
      if (link?.passId === pass.id) parts.push(sendPanel(pass, link.url));
    } else {
      if (pass.mine || staff) {
        const name = h('input', { type: 'text', maxlength: '100', autocomplete: 'name', value: pass.name });
        const file = h('input', { type: 'file', accept: 'image/*', capture: 'user', hidden: true, onchange: () => { const f = file.files?.[0]; file.value = ''; if (f) void photo(pass, f); } });
        parts.push(h('form', { class: 'passes-name', onsubmit: (e: Event) => { e.preventDefault(); void rename(pass, name.value); } },
          h('label', { class: 'field' }, h('span', { class: 'field__label' }, pass.mine ? 'Your name, as it should appear on the pass' : 'The manager’s name on the pass'), name),
          h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'btn btn--secondary', disabled: busy }, 'Save name'),
            button(pass.portrait ? 'Change photo' : 'Add a photo', 'btn--ghost', () => file.click()), file)));
      }
      parts.push(h('div', { class: 'actions' }, button(pass.mine ? 'Show my pass' : 'Show this pass', 'btn--primary', () => void show(pass))));
    }
    panel.replaceChildren(...parts.filter((n): n is Node => !!n));
  }

  function sendPanel(pass: TeamPass, url: string): HTMLElement {
    const canvas = h('canvas', { width: '330', height: '330', 'aria-label': `Code to scan with ${pass.name}’s phone` });
    drawLinkQr(canvas, url);
    const field = h('input', { type: 'text', readonly: true, value: url, 'aria-label': 'Pass link', onfocus: () => field.select() });
    const copy = h('button', { type: 'button', class: 'btn btn--secondary', onclick: async () => {
      try { await navigator.clipboard.writeText(url); status.textContent = 'Link copied.'; } catch { field.focus(); field.select(); status.textContent = 'Select the link and copy it.'; }
    } }, 'Copy link');
    const share = typeof navigator.share === 'function' ? h('button', { type: 'button', class: 'btn btn--secondary', onclick: () => void navigator.share({ title: 'Paddock Pass', text: `${pass.name}’s Paddock Pass for ${event!.name}`, url }).catch(() => undefined) }, 'Share') : null;
    return h('div', { class: 'passes-send' },
      h('div', { class: 'passes-send__qr' }, canvas),
      h('div', { class: 'stack' },
        h('p', null, h('strong', null, `Point ${pass.name}’s phone camera at this code`), ', or send them the link.'),
        field, h('div', { class: 'actions' }, copy, share),
        h('p', { class: 'muted small' }, 'The link works once, on one phone. Sending again cancels this one. Keep it between you and the student.')));
  }

  const send = (pass: TeamPass) => act('Making a link…', async () => {
    if (pass.status === 'claimed' && !ask(`${pass.name}’s pass is already on a phone. A new link takes it off that phone. Make a new link?`)) return;
    const token = await ctx.api.passLink(pass.id);
    link = { passId: pass.id, url: passLinkUrl(origin, pass.id, token) };
    await load(false);
  });
  const reset = (pass: TeamPass) => act('Resetting the pass…', async () => {
    if (!ask(`Reset ${pass.name}’s pass? It stops working on the phone that has it, and any link you sent is cancelled.`)) return;
    await ctx.api.resetPass(pass.id);
    presenting.delete(pass.id); link = null;
    await load(false);
  });
  const rename = (pass: TeamPass, name: string) => act('Saving the name…', async () => { await ctx.api.setManagerPassName(pass.id, name); await load(false); });
  const photo = (pass: TeamPass, file: Blob) => act('Preparing the photo…', async () => {
    const jpeg = await make(file);
    if (!jpeg) { status.textContent = 'That picture could not be used. Try another one.'; return; }
    await ctx.api.setPassPortrait(pass.id, jpeg);
    await load(false);
  });

  /** The pass full screen, with its entry code, for someone who has no phone of their own (or the manager's own pass). */
  const show = (pass: TeamPass) => act('Opening the pass…', async () => {
    let key = presenting.get(pass.id);
    if (!key) { key = await importSecret(await ctx.api.presentPass(pass.id)); presenting.set(pass.id, key); }
    if (!alive || !data) return;
    const signer = key, opener = document.activeElement as HTMLElement | null;
    const card = createPassCard(cardFor(data, pass), { shader: deps.shader, now: clock, code: () => codeAt(signer, pass.id, clock()) });
    const close = h('button', { type: 'button', class: 'passes-show__close' }, 'Close');
    const overlay = h('div', { class: 'passes-show', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${pass.name || 'Team manager'}’s pass` },
      close, h('div', { class: 'passes-show__stage' }, card.el),
      h('p', { class: 'passes-show__hint' }, pass.kind === 'student' ? 'Tap the card for the entry code. The door will see it was shown by the team manager.' : 'Tap the card for your entry code.'));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') shut(); };
    function shut(): void {
      document.removeEventListener('keydown', onKey); card.destroy(); overlay.remove(); closeShow = null;
      if (alive && selected) cards.get(selected)?.setActive(true);
      opener?.focus?.();
    }
    close.onclick = shut; closeShow = shut;
    cards.forEach((c) => c.setActive(false));   // one live card at a time
    document.addEventListener('keydown', onKey);
    document.body.append(overlay); close.focus();
  });

  /** A card carries a small copy of the member's submitted portrait. It is made here, on the device, when missing or out of date. */
  async function remakePortraits(current: number): Promise<void> {
    if (!data) return;
    const stale = data.passes.filter((p) => p.kind === 'student' && p.portraitStale && p.memberId && !remade.has(`${p.id}:${p.memberId}`));
    if (!stale.length) return;
    const assets = await ctx.api.getCompulsoryAssets(eventId, data.team.id).catch(() => null);
    let changed = false;
    for (const pass of stale) {
      if (!alive || current !== request) return;
      remade.add(`${pass.id}:${pass.memberId}`);
      const member = assets?.memberPortraits?.find((m) => m.id === pass.memberId);
      if (!member?.photoBase64) continue;
      const jpeg = await make(member.photoBase64, member.photoMime ?? 'image/jpeg');
      if (!jpeg) continue;
      try { await ctx.api.setPassPortrait(pass.id, jpeg); changed = true; } catch { /* the card simply keeps its placeholder */ }
    }
    if (changed && alive && current === request) await load(false);
  }

  async function load(fresh: boolean): Promise<void> {
    const current = ++request;
    if (fresh) { dropCards(); row.replaceChildren(); panel.hidden = true; data = null; selected = null; link = null; presenting.clear(); status.textContent = 'Loading passes…'; }
    try {
      const got = await ctx.api.teamPasses(eventId, teamId());
      if (!alive || current !== request) return;
      data = got; offset = Math.round(Number(got.now) - Date.now());
      if (fresh) status.textContent = '';
      paintRow();
      choose(got.passes.find((p) => p.id === selected)?.id ?? got.passes[0]?.id ?? '', fresh);
      void remakePortraits(current);
    } catch (e) {
      if (!alive || current !== request) return;
      status.textContent = e instanceof ApiError && e.code === 'forbidden' ? 'Passes are for the team and event organisers.' : errorText(e);
    }
  }

  // Swiping the row brings a card to the middle; that card becomes the one in use.
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  row.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const box = row.getBoundingClientRect(), middle = box.left + box.width / 2;
      let best: HTMLElement | null = null, distance = Infinity;
      for (const item of row.children) { const r = item.getBoundingClientRect(), d = Math.abs(r.left + r.width / 2 - middle); if (d < distance) { distance = d; best = item as HTMLElement; } }
      // While the page is bringing a chosen card to the middle, the cards it passes on the way are not choices.
      if (heading) { if (best?.dataset.pass !== heading.id && Date.now() < heading.until) return; heading = null; }
      if (best?.dataset.pass && best.dataset.pass !== selected) choose(best.dataset.pass, false);
    }, 140);
  }, { passive: true });
  if (select) select.onchange = () => void load(true);
  await load(true);
  return root;
}
