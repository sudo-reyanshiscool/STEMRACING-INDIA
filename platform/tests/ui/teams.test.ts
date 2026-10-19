// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Api } from '../../src/api';
import { teamsScreen } from '../../src/ui/teams';
import { EMAILS, makeCtx, text, world } from './helpers';

const wait = () => new Promise((r) => setTimeout(r, 0));
const submit = (el: HTMLElement) => el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
const add = async (el: HTMLElement, number: string, name: string, school = '') => {
  const form = el.querySelector('form')!;
  (form.querySelector('input[name=number]') as HTMLInputElement).value = number;
  (form.querySelector('input[name=name]') as HTMLInputElement).value = name;
  (form.querySelector('input[name=school]') as HTMLInputElement).value = school;
  submit(el);
  await wait();
};
const failing = (api: Api, code: ConstructorParameters<typeof ApiError>[0]): Api =>
  new Proxy(api, { get: (t, k) => (k === 'createTeam' ? async () => { throw new ApiError(code, 'raw backend wording'); } : (t as never)[k]) });

describe('teamsScreen', () => {
  it('lists teams in natural number order', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    await api.createTeam(ev.id, { number: '10', name: 'Ten' });
    const { ctx } = makeCtx(api);
    const el = await teamsScreen(ctx, ev.id);
    expect([...el.querySelectorAll('.list li strong')].map(text)).toEqual(['Team 1 · One', 'Team 2 · Two', 'Team 10 · Ten']);
  });

  it('adds a team and shows it, keeping hostile text as text', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await teamsScreen(ctx, ev.id);
    await add(el, '7', '<img src=x onerror=alert(1)> 🚗', "O'Brien");
    expect(el.querySelector('img')).toBeNull();
    expect(text(el)).toContain('Team 7 · <img src=x onerror=alert(1)> 🚗');
    expect(text(el)).toContain("O'Brien");
  });

  it('shows duplicate numbers as a readable message and keeps the list unchanged', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await teamsScreen(ctx, ev.id);
    await add(el, ' 1 ', 'Again');
    expect(text(el.querySelector('form')!.closest('section')!.querySelector('[role=alert]')!)).toContain('already used');
    expect(el.querySelectorAll('.list li')).toHaveLength(2);
  });

  it('treats a number differing only by case as a duplicate', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    await api.createTeam(ev.id, { number: 'A1', name: 'Alpha' });
    const { ctx } = makeCtx(api);
    const el = await teamsScreen(ctx, ev.id);
    await add(el, 'a1', 'Other');
    expect(text(el.querySelector('form')!.closest('section')!.querySelector('[role=alert]')!)).toContain('already used');
  });

  it('gives judges and team managers the list without the form', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.judge);
    const { ctx } = makeCtx(api);
    const el = await teamsScreen(ctx, ev.id);
    expect(el.querySelector('form')).toBeNull();
    expect(el.querySelectorAll('.list li')).toHaveLength(2);
    await api.signIn(EMAILS.mgr);
    expect((await teamsScreen(ctx, ev.id)).querySelectorAll('.list li')).toHaveLength(1);
  });

  it('never shows a raw backend duplicate message', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const stub = new Proxy(api, { get: (t, k) => (k === 'createTeam' ? async () => { throw new ApiError('duplicate', 'duplicate key value violates unique constraint "teams_event_number"'); } : (t as never)[k]) }) as Api;
    const { ctx } = makeCtx(stub);
    const el = await teamsScreen(ctx, ev.id);
    await add(el, '9', 'Nine');
    expect(text(el.querySelector('form')!.closest('section')!.querySelector('[role=alert]')!)).toBe('That team number is already used in this event');
    expect(text(el)).not.toContain('violates');
    expect((el.querySelector('input[name=name]') as HTMLInputElement).value).toBe('Nine');
  });

  it('never shows a raw backend invalid message', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const stub = new Proxy(api, { get: (t, k) => (k === 'createTeam' ? async () => { throw new ApiError('invalid', 'new row violates check constraint "teams_name_check"'); } : (t as never)[k]) }) as Api;
    const { ctx } = makeCtx(stub);
    const el = await teamsScreen(ctx, ev.id);
    await add(el, '9', 'Nine');
    expect(text(el)).not.toContain('constraint');
    expect(text(el.querySelector('form')!.closest('section')!.querySelector('[role=alert]')!)).toContain('not valid');
  });

  it('validates before calling the API and keeps what was typed', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    let calls = 0;
    const spy = new Proxy(api, { get: (t, k) => (k === 'createTeam' ? async () => { calls++; throw new Error('should not be called'); } : (t as never)[k]) }) as Api;
    const { ctx } = makeCtx(spy);
    const el = await teamsScreen(ctx, ev.id);
    await add(el, '   ', 'Name');
    expect(text(el.querySelector('form')!.closest('section')!.querySelector('[role=alert]')!)).toContain('team number');
    await add(el, '5', '   ');
    expect(text(el.querySelector('form')!.closest('section')!.querySelector('[role=alert]')!)).toContain('team name');
    await add(el, '5', 'Name', 'x'.repeat(121));
    expect(text(el.querySelector('form')!.closest('section')!.querySelector('[role=alert]')!)).toContain('120');
    expect((el.querySelector('input[name=name]') as HTMLInputElement).value).toBe('Name');
    expect(calls).toBe(0);
  });

  it('recovers after a validation failure: button enabled, corrected team is added once', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await teamsScreen(ctx, ev.id);
    const button = el.querySelector('form button[type=submit]') as HTMLButtonElement;
    await add(el, '', 'Name');
    expect(button.disabled).toBe(false);
    await add(el, '8', 'Name');
    expect(text(el)).toContain('Team 8 · Name');
    expect(el.querySelectorAll('.list li')).toHaveLength(3);
  });

  it('words the school-length message cleanly', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await teamsScreen(ctx, ev.id);
    await add(el, '8', 'Name', 'x'.repeat(121));
    expect(text(el.querySelector('form')!.closest('section')!.querySelector('[role=alert]')!)).toBe('The school or club must be 120 characters or fewer.');
  });

  it('names the form fields and clears the form after adding', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await teamsScreen(ctx, ev.id);
    const labels = [...el.querySelectorAll('form label')].map((l) => text(l));
    expect(labels).toEqual(['Team number', 'Team name', 'School or club (optional)']);
    await add(el, '5', 'Five');
    expect((el.querySelector('input[name=number]') as HTMLInputElement).value).toBe('');
  });

  it('says so when there are no teams', async () => {
    const { api } = await world();
    await api.signIn(EMAILS.org);
    const ev = await api.createEvent({ name: 'Empty' });
    const { ctx } = makeCtx(api);
    expect(text(await teamsScreen(ctx, ev.id))).toContain('No teams yet');
  });

  it('guards double submit: the button is disabled while the request is in flight', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    let release!: () => void;
    const slow = new Proxy(api, {
      get: (t, k) => k === 'createTeam'
        ? vi.fn(async (...a: Parameters<Api['createTeam']>) => { await new Promise<void>((r) => { release = r; }); return t.createTeam(...a); })
        : (t as never)[k],
    }) as Api;
    const { ctx } = makeCtx(slow);
    const el = await teamsScreen(ctx, ev.id);
    const button = el.querySelector('form button[type=submit]') as HTMLButtonElement;
    await add(el, '9', 'Nine');
    expect(button.disabled).toBe(true);
    submit(el); // a second submit while in flight must be ignored
    release();
    await wait();
    await wait();
    expect(button.disabled).toBe(false);
    expect(el.querySelectorAll('.list li')).toHaveLength(3);
    expect(text(el.querySelector('form')!.closest('section')!.querySelector('[role=alert]')!)).toBe('');
  });

  it('handles forbidden with fixed text, never the raw backend wording', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(failing(api, 'forbidden'));
    const el = await teamsScreen(ctx, ev.id);
    await add(el, '9', 'Nine');
    const alert = text(el.querySelector('form')!.closest('section')!.querySelector('[role=alert]')!);
    expect(alert).toContain('permission');
    expect(alert).not.toContain('raw backend');
  });

  it('tells the person to Withdraw the release when the API says locked', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(failing(api, 'locked'));
    const el = await teamsScreen(ctx, ev.id);
    await add(el, '9', 'Nine');
    expect(text(el.querySelector('form')!.closest('section')!.querySelector('[role=alert]')!)).toContain('Withdraw the release');
  });

  it('goes back to sign-in (rerender) when the session has lapsed', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(failing(api, 'unauthenticated'));
    const el = await teamsScreen(ctx, ev.id);
    await add(el, '9', 'Nine');
    expect(ctx.rerender).toHaveBeenCalled();
  });

  it('says the event was not found', async () => {
    const { api } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    expect(text(await teamsScreen(ctx, 'nope'))).toContain('not found');
  });
});
