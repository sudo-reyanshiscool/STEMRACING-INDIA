// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eventNav } from '../../src/ui/event-nav';
import { passesScreen } from '../../src/ui/passes';
import { parseHash, routeHref } from '../../src/ui/router';
import { makeCtx, text } from './helpers';
import { JPEG, PASS_EMAILS, passWorld, settle, useNodeCrypto } from './pass-helpers';

beforeAll(useNodeCrypto);
const leavers: Array<() => void> = [];
async function open(w: Awaited<ReturnType<typeof passWorld>>, deps: Parameters<typeof passesScreen>[2] = {}) {
  const { ctx, leaves } = makeCtx(w.api);
  const root = await passesScreen(ctx, w.ev.id, { origin: 'https://events.example.test', shader: false, confirm: () => true, makePortrait: async () => null, ...deps });
  document.body.append(root); leavers.push(...leaves);
  await settle();
  return root;
}
const names = (root: Element) => [...root.querySelectorAll('.passes-row .pass-card__name')].map(text);
const button = (root: Element, label: string) => [...root.querySelectorAll('button')].find((b) => text(b).trim() === label) as HTMLButtonElement;
const pick = async (root: Element, name: string) => { ([...root.querySelectorAll('.passes-row__item')].find((i) => text(i).includes(name)) as HTMLElement).click(); await settle(); };
afterEach(() => { leavers.splice(0).forEach((f) => f()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('the Paddock Passes page', () => {
  it('shows a manager their own team as cards, their own pass first, with no team to choose', async () => {
    const w = await passWorld();
    const root = await open(w);
    expect(text(root.querySelector('h1')!)).toBe('Paddock Passes');
    expect(names(root)).toEqual(['Team Manager', 'Asha Rao', 'Dev Shah']);
    expect(root.querySelector('select')).toBeNull();
    expect(text(root.querySelector('.passes-row .pass-card__number')!)).toBe('1');
  });

  it('makes a link to send to a student’s phone, with a code to scan', async () => {
    const w = await passWorld();
    const root = await open(w);
    await pick(root, 'Asha Rao');
    expect(text(root.querySelector('.passes-panel')!)).toContain('Not sent yet');
    button(root, 'Send to phone').click(); await settle();
    const link = (root.querySelector('.passes-send input') as HTMLInputElement).value;
    expect(link).toMatch(/^https:\/\/events\.example\.test\/pass\/#[0-9a-f-]{36}\.[0-9a-f]{64}$/);
    expect(root.querySelector('.passes-send canvas')).not.toBeNull();
    expect(text(root.querySelector('.passes-panel')!)).toContain('Link sent');
    const [id, token] = link.split('#')[1].split('.');
    expect((await w.api.claimPass(id, token)).card.name).toBe('Asha Rao');   // the link really opens the pass
  });

  it('asks before replacing a pass that is already on a phone', async () => {
    const w = await passWorld();
    const phone = await w.onPhone('Asha Rao');
    const confirm = vi.fn(() => false);
    const root = await open(w, { confirm });
    await pick(root, 'Asha Rao');
    expect(text(root.querySelector('.passes-panel')!)).toContain('On a phone since');
    button(root, 'Send to phone').click(); await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.passes-send')).toBeNull();
    await w.api.signIn(PASS_EMAILS.org);
    expect((await w.api.checkPass(w.ev.id, await phone.code())).result).toBe('genuine');   // the phone still works
  });

  it('resets a pass after asking, so the old phone stops working', async () => {
    const w = await passWorld();
    const phone = await w.onPhone('Dev Shah');
    const confirm = vi.fn(() => true);
    const root = await open(w, { confirm });
    await pick(root, 'Dev Shah');
    button(root, 'Reset pass').click(); await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(text(root.querySelector('.passes-panel')!)).toContain('Not sent yet');
    await w.api.signIn(PASS_EMAILS.org);
    expect((await w.api.checkPass(w.ev.id, await phone.code())).result).toBe('invalid');
  });

  it('shows a student’s pass full screen from the manager’s phone, with a working entry code', async () => {
    const w = await passWorld();
    const root = await open(w);
    await pick(root, 'Asha Rao');
    button(root, 'Show this pass').click(); await settle();
    const show = document.querySelector('.passes-show')!;
    expect(show.getAttribute('role')).toBe('dialog');
    expect(text(show.querySelector('.pass-card__name')!)).toBe('Asha Rao');
    (show.querySelector('.pass-card') as HTMLElement).click(); await settle();
    const code = (show.querySelector('.pass-card__qr-tile canvas') as HTMLCanvasElement).dataset.code!;
    await w.api.signIn(PASS_EMAILS.org);
    expect(await w.api.checkPass(w.ev.id, code)).toMatchObject({ result: 'genuine', presenter: true });
    button(show, 'Close').click();
    expect(document.querySelector('.passes-show')).toBeNull();
  });

  it('lets the manager put their name on their own pass', async () => {
    const w = await passWorld();
    const root = await open(w);
    const input = root.querySelector('.passes-panel input[type="text"]') as HTMLInputElement;
    input.value = '  Meera   Iyer ';
    button(root, 'Save name').click(); await settle();
    expect(names(root)[0]).toBe('Meera Iyer');
    expect(button(root, 'Show my pass')).toBeTruthy();
    expect(button(root, 'Send to phone')).toBeUndefined();
  });

  it('lets a manager send their own pass to their phone, where it works without signal', async () => {
    const w = await passWorld();
    const root = await open(w);
    expect(text(root.querySelector('.passes-panel')!)).toContain('Send it to your phone');
    button(root, 'Send to my phone').click(); await settle();
    const link = (root.querySelector('.passes-send input') as HTMLInputElement).value;
    expect(text(root.querySelector('.passes-send')!)).toContain('Point your phone camera at this code');
    expect(text(root.querySelector('.passes-panel')!)).toContain('Link sent');
    const [id, token] = link.split('#')[1].split('.');
    expect((await w.api.claimPass(id, token)).card).toMatchObject({ kind: 'manager', role: 'Team Manager' });
    // An organiser at the help desk can do the same for a manager; another person's pass says whose it is.
    await w.api.signIn(PASS_EMAILS.org);
    const desk = await open(w);
    expect(text(desk.querySelector('.passes-panel')!)).toContain('On a phone since');
    expect(button(desk, 'Send to their phone')).toBeTruthy();
  });

  it('keeps a shown pass in step with the server clock, not this phone’s', async () => {
    const w = await passWorld();
    vi.spyOn(w.api, 'passClock').mockImplementation(async () => Date.now() + 90_000);
    const root = await open(w);
    await pick(root, 'Asha Rao');
    button(root, 'Show this pass').click(); await settle();
    const show = document.querySelector('.passes-show')!;
    (show.querySelector('.pass-card') as HTMLElement).click(); await settle();
    const code = (show.querySelector('.pass-card__qr-tile canvas') as HTMLCanvasElement).dataset.code!;
    expect(Number(code.split('.')[2])).toBe(Math.floor((Date.now() + 90_000) / 30_000));
    button(show, 'Close').click();
  });

  it('makes the small portrait for each card from the submitted one', async () => {
    const w = await passWorld();
    const makePortrait = vi.fn(async () => JPEG);
    const root = await open(w, { makePortrait });
    await settle(12);
    expect(makePortrait).toHaveBeenCalledTimes(2);
    expect(root.querySelectorAll('.passes-row .pass-card__photo img')).toHaveLength(2);
    expect((await w.api.teamPasses(w.ev.id, w.t1.id)).passes.filter((p) => p.portraitStale)).toHaveLength(0);
  });

  it('gives organisers and the Chair a team to choose, as a help desk', async () => {
    const w = await passWorld();
    await w.api.signIn(PASS_EMAILS.org);
    const root = await open(w);
    const select = root.querySelector('select') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['1 · Velocity', '2 · Apex']);
    expect(names(root)).toEqual(['Team Manager', 'Asha Rao', 'Dev Shah']);
    select.value = w.t2.id; select.dispatchEvent(new Event('change')); await settle();
    expect(names(root)).toEqual([]);
    expect(text(root)).toContain('No passes for this team yet');
  });

  it('is not there for judges', async () => {
    const w = await passWorld();
    await w.api.signIn(PASS_EMAILS.judge);
    expect(text(await open(w))).toContain('Paddock Passes are available to your team and event organisers');
  });
});

describe('finding the pass pages', () => {
  const labels = (nav: Element) => [...nav.querySelectorAll('a')].map(text);
  it('lists them in the event menu for the people who can use them', async () => {
    const w = await passWorld();
    const event = (await w.api.getEvent(w.ev.id))!;
    await w.api.signIn(PASS_EMAILS.mgr);
    const manager = labels(eventNav(event, await w.api.myRoles(w.ev.id), 'event'));
    expect(manager).toContain('Paddock Passes');
    expect(manager).not.toContain('Door check');
    await w.api.signIn(PASS_EMAILS.chair);
    expect(labels(eventNav(event, await w.api.myRoles(w.ev.id), 'event'))).toEqual(expect.arrayContaining(['Paddock Passes', 'Door check']));
    await w.api.signIn(PASS_EMAILS.judge);
    const judge = labels(eventNav(event, await w.api.myRoles(w.ev.id), 'event'));
    expect(judge).not.toContain('Paddock Passes');
    expect(judge).not.toContain('Door check');
  });
  it('has an address for each', () => {
    expect(routeHref({ name: 'passes', eventId: 'e1' })).toBe('#/event/e1/passes');
    expect(parseHash('#/event/e1/door')).toEqual({ name: 'door', eventId: 'e1' });
  });
});
