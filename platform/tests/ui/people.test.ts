// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ApiError, type Api } from '../../src/api';
import { peopleScreen } from '../../src/ui/people';
import { EMAILS, makeCtx, text, world } from './helpers';

const wait = () => new Promise((r) => setTimeout(r, 0));
const pick = (el: HTMLElement, name: string, value: string) => {
  const s = el.querySelector(`[name=${name}]`) as HTMLSelectElement | HTMLInputElement;
  s.value = value;
  s.dispatchEvent(new Event('change', { bubbles: true }));
};
const submit = (el: HTMLElement) => el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
const failing = (api: Api, method: string, code: ConstructorParameters<typeof ApiError>[0]): Api =>
  new Proxy(api, { get: (t, k) => (k === method ? async () => { throw new ApiError(code, 'raw backend wording'); } : (t as never)[k]) });

describe('peopleScreen', () => {
  it('lists the roles with email, role and panel or team', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await peopleScreen(ctx, ev.id);
    const t = text(el);
    expect(t).toContain('judge@x.test');
    expect(t).toContain('Judge');
    expect(t).toContain('Verbal Presentation');
    expect(t).toContain('Team 1');
  });

  it('shows the panel choice only for judge roles and the team choice only for team managers', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await peopleScreen(ctx, ev.id);
    const panel = el.querySelector('[data-field=panel]') as HTMLElement;
    const team = el.querySelector('[data-field=team]') as HTMLElement;
    pick(el, 'role', 'chair');
    expect([panel.hidden, team.hidden]).toEqual([true, true]);
    pick(el, 'role', 'judge');
    expect([panel.hidden, team.hidden]).toEqual([false, true]);
    pick(el, 'role', 'team_manager');
    expect([panel.hidden, team.hidden]).toEqual([true, false]);
  });

  it('invites someone, shows the pending invitation, and lets it be withdrawn', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await peopleScreen(ctx, ev.id);
    pick(el, 'role', 'judge');
    pick(el, 'panel', 'enterprise');
    pick(el, 'name', 'Avery Rao');
    (el.querySelector('input[name=email]') as HTMLInputElement).value = 'New@X.test';
    submit(el);
    await wait();
    expect(text(el)).toContain('new@x.test');
    expect(text(el.querySelector('[data-section=invitations]')!)).toContain('Enterprise');
    (el.querySelector('[data-section=invitations] button[aria-label^="Withdraw invitation"]') as HTMLButtonElement).click();
    await wait();
    expect(el.querySelector('[data-section=invitations] li')).toBeNull();
  });

  it('explains invalid or duplicate invitations', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await peopleScreen(ctx, ev.id);
    (el.querySelector('input[name=email]') as HTMLInputElement).value = 'nope';
    submit(el);
    await wait();
    expect(text(el.querySelector('[role=alert]')!)).toContain('valid email');
  });

  it('is not available to a judge', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.judge);
    const { ctx } = makeCtx(api);
    expect(text(await peopleScreen(ctx, ev.id))).toContain('Only the organiser or chair');
  });

  it('explains a duplicate invitation', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await peopleScreen(ctx, ev.id);
    pick(el, 'role', 'chair');
    for (let i = 0; i < 2; i++) {
      (el.querySelector('input[name=email]') as HTMLInputElement).value = 'dup@x.test';
      submit(el);
      await wait();
    }
    expect(el.querySelector('[role=alert]')!.hasAttribute('hidden')).toBe(false);
    expect(el.querySelectorAll('[data-section=invitations] li')).toHaveLength(1);
  });

  it('removes a role, but offers no Remove for the organiser or for yourself', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.chair);
    const { ctx } = makeCtx(api);
    const el = await peopleScreen(ctx, ev.id);
    const rows = [...el.querySelectorAll('[data-section=people] li')];
    const byEmail = (e: string) => rows.find((r) => text(r).includes(e))!;
    expect(byEmail('org@x.test').querySelector('button')).toBeNull();
    expect(byEmail('chair@x.test').querySelector('button')).toBeNull();
    (byEmail('judge@x.test').querySelector('button') as HTMLButtonElement).click();
    await wait();
    expect(text(el.querySelector('[data-section=people]')!)).not.toContain('judge@x.test');
  });

  it('names Remove and Withdraw buttons after the person', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    await api.invite(ev.id, { email: 'p@x.test', role: 'chair' });
    const { ctx } = makeCtx(api);
    const el = await peopleScreen(ctx, ev.id);
    expect(el.querySelector('[data-section=people] button')!.getAttribute('aria-label')).toBe('Remove chair@x.test');
    expect(el.querySelector('[data-section=invitations] button[aria-label^="Withdraw invitation"]')!.getAttribute('aria-label')).toBe('Withdraw invitation for p@x.test');
  });

  it('shows the forbidden and locked outcomes of an invitation in plain words', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    for (const [code, expected] of [['forbidden', 'permission'], ['locked', 'Withdraw the release']] as const) {
      const { ctx } = makeCtx(failing(api, 'invite', code));
      const el = await peopleScreen(ctx, ev.id);
      pick(el, 'role', 'chair');
      (el.querySelector('input[name=email]') as HTMLInputElement).value = 'a@x.test';
      submit(el);
      await wait();
      const alert = text(el.querySelector('[role=alert]')!);
      expect(alert).toContain(expected);
      expect(alert).not.toContain('raw backend');
    }
  });

  it('shows a failed Remove and keeps the list', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(failing(api, 'removeRole', 'forbidden'));
    const el = await peopleScreen(ctx, ev.id);
    const before = el.querySelectorAll('[data-section=people] li').length;
    (el.querySelector('[data-section=people] button') as HTMLButtonElement).click();
    await wait();
    expect(text(el.querySelector('[role=alert]')!)).toContain('permission');
    expect(el.querySelectorAll('[data-section=people] li')).toHaveLength(before);
  });

  it('returns to sign-in when the session lapses during an action', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(failing(api, 'invite', 'unauthenticated'));
    const el = await peopleScreen(ctx, ev.id);
    pick(el, 'role', 'chair');
    (el.querySelector('input[name=email]') as HTMLInputElement).value = 'a@x.test';
    submit(el);
    await wait();
    expect(ctx.rerender).toHaveBeenCalled();
  });

  it('asks for a team first when inviting a team manager to an event with no teams', async () => {
    const { api } = await world();
    await api.signIn(EMAILS.org);
    const ev = await api.createEvent({ name: 'Empty' });
    const { ctx } = makeCtx(api);
    const el = await peopleScreen(ctx, ev.id);
    pick(el, 'role', 'team_manager');
    (el.querySelector('input[name=email]') as HTMLInputElement).value = 'a@x.test';
    submit(el);
    await wait();
    expect(text(el.querySelector('[role=alert]')!)).toContain('Add a team');
  });

  it('does not default to a role: a blank "Choose a role" is selected and must be changed', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    let invites = 0;
    const spy = new Proxy(api, { get: (t, k) => (k === 'invite' ? async () => { invites++; } : (t as never)[k]) }) as Api;
    const { ctx } = makeCtx(spy);
    const el = await peopleScreen(ctx, ev.id);
    const role = el.querySelector('[name=role]') as HTMLSelectElement;
    expect(role.value).toBe('');
    expect(text(role.options[0])).toBe('Choose a role');
    expect(role.required).toBe(true);
    (el.querySelector('input[name=email]') as HTMLInputElement).value = 'a@x.test';
    submit(el);
    await wait();
    expect(text(el.querySelector('[role=alert]')!)).toContain('Choose a role');
    expect(invites).toBe(0);
  });

  it('requires a panel for judge roles and a team for team managers', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await peopleScreen(ctx, ev.id);
    (el.querySelector('input[name=email]') as HTMLInputElement).value = 'a@x.test';
    pick(el, 'role', 'judge');
    expect((el.querySelector('[name=panel]') as HTMLSelectElement).value).toBe('');
    submit(el);
    await wait();
    expect(text(el.querySelector('[role=alert]')!)).toContain('Choose a panel');
    pick(el, 'role', 'team_manager');
    expect((el.querySelector('[name=team]') as HTMLSelectElement).value).toBe('');
    submit(el);
    await wait();
    expect(text(el.querySelector('[role=alert]')!)).toContain('Choose a team');
    expect((el.querySelector('input[name=email]') as HTMLInputElement).value).toBe('a@x.test');
  });

  it('checks the email address before calling the API', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    let invites = 0;
    const spy = new Proxy(api, { get: (t, k) => (k === 'invite' ? async () => { invites++; } : (t as never)[k]) }) as Api;
    const { ctx } = makeCtx(spy);
    const el = await peopleScreen(ctx, ev.id);
    pick(el, 'role', 'chair');
    for (const bad of ['', 'a b@x.test', 'a@@x.test', 'a@', '@x.test']) {
      (el.querySelector('input[name=email]') as HTMLInputElement).value = bad;
      submit(el);
      await wait();
      expect(text(el.querySelector('[role=alert]')!), bad).toContain('valid email');
    }
    expect(invites).toBe(0);
  });

  it('never shows a raw backend duplicate or invalid message', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const raw = 'duplicate key value violates unique constraint "invitations_unique"';
    const stub = new Proxy(api, { get: (t, k) => (k === 'invite' ? async () => { throw new ApiError('duplicate', raw); } : (t as never)[k]) }) as Api;
    const { ctx } = makeCtx(stub);
    const el = await peopleScreen(ctx, ev.id);
    pick(el, 'role', 'chair');
    (el.querySelector('input[name=email]') as HTMLInputElement).value = 'a@x.test';
    submit(el);
    await wait();
    expect(text(el.querySelector('[role=alert]')!)).toBe('That person already has this role or invitation.');
    expect(text(el)).not.toContain('violates');
  });

  it('recovers after a validation failure: controls enabled, corrected invitation sent once', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    let calls = 0;
    const real = api.invite.bind(api);
    const spy = new Proxy(api, { get: (t, k) => (k === 'invite' ? async (...a: Parameters<Api['invite']>) => { calls++; return real(...a); } : (t as never)[k]) }) as Api;
    const { ctx } = makeCtx(spy);
    const el = await peopleScreen(ctx, ev.id);
    pick(el, 'role', 'chair');
    const email = el.querySelector('input[name=email]') as HTMLInputElement;
    email.value = 'typo';
    submit(el);
    await wait();
    expect((el.querySelector('form button[type=submit]') as HTMLButtonElement).disabled).toBe(false);
    expect(calls).toBe(0);
    email.value = 'fixed@x.test';
    submit(el);
    await wait();
    expect(calls).toBe(1);
    expect(text(el.querySelector('[data-section=invitations]')!)).toContain('fixed@x.test');
  });

  it('keeps email text as text', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await peopleScreen(ctx, ev.id);
    expect(el.querySelector('img')).toBeNull();
  });
});

describe('invitation email feedback',()=>{
  it('keeps a saved invitation visible after mail fails and lets the organiser resend it',async()=>{
    const {api,ev}=await world();await api.signIn(EMAILS.org);
    let calls=0;
    const wrapped=new Proxy(api,{get:(t,k)=>k==='invite'?async(...args:Parameters<Api['invite']>)=>{calls++;await api.invite(...args);throw new ApiError('email-delivery','private provider detail');}:(t as never)[k]});
    const {ctx}=makeCtx(wrapped);const el=await peopleScreen(ctx,ev.id);
    pick(el,'role','chair');(el.querySelector('[name=email]') as HTMLInputElement).value='retry@x.test';submit(el);await wait();
    expect(text(el.querySelector('[role=alert]')!)).toContain('invitation is saved');expect(text(el)).not.toContain('private provider detail');
    expect(el.querySelectorAll('[data-section=invitations] li')).toHaveLength(1);
    (el.querySelector('[aria-label="Resend invitation for retry@x.test"]') as HTMLButtonElement).click();await wait();
    expect(text(el.querySelector('[role=status]')!)).toContain('sent to retry@x.test');expect(calls).toBe(1);
  });
  it('displays invitation email status', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    await api.invite(ev.id, { email: 'invitee@x.test', role: 'chair' });
    const { ctx } = makeCtx(api);
    const el = await peopleScreen(ctx, ev.id);
    expect(text(el)).toContain('Email sent');
  });
});

describe('multiple organisers', () => {
  it('allows organisers to invite another organiser, while hiding the option from chairs', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.chair);
    const { ctx: chairCtx } = makeCtx(api);
    const chairEl = await peopleScreen(chairCtx, ev.id);
    const chairRoleOptions = [...chairEl.querySelectorAll('select[name=role] option')].map((o) => (o as HTMLOptionElement).value);
    expect(chairRoleOptions).not.toContain('organiser');

    await api.signIn(EMAILS.org);
    const { ctx: orgCtx } = makeCtx(api);
    const orgEl = await peopleScreen(orgCtx, ev.id);
    const orgRoleOptions = [...orgEl.querySelectorAll('select[name=role] option')].map((o) => (o as HTMLOptionElement).value);
    expect(orgRoleOptions).toContain('organiser');

    pick(orgEl, 'role', 'organiser');
    (orgEl.querySelector('input[name=email]') as HTMLInputElement).value = 'org2@x.test';
    submit(orgEl);
    await wait();
    expect(text(orgEl.querySelector('[data-section=invitations]')!)).toContain('org2@x.test');
  });

  it('allows removing another organiser when more than one exists, but prevents removing the last organiser or oneself', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    await api.invite(ev.id, { email: 'org2@x.test', role: 'organiser' });
    await api.signIn('org2@x.test');
    await api.claimInvitations();

    // org2 is signed in: can remove org@x.test, but cannot remove themselves
    const { ctx: org2Ctx } = makeCtx(api);
    const el2 = await peopleScreen(org2Ctx, ev.id);
    const rows = [...el2.querySelectorAll('[data-section=people] li')];
    const byEmail = (e: string) => rows.find((r) => text(r).includes(e))!;
    expect(byEmail('org2@x.test').querySelector('button')).toBeNull();
    const removeOrg1Btn = byEmail(EMAILS.org).querySelector('button');
    expect(removeOrg1Btn).not.toBeNull();
    removeOrg1Btn!.click();
    await wait();
    expect(text(el2.querySelector('[data-section=people]')!)).not.toContain(EMAILS.org);

    // Now org2 is the only remaining organiser; cannot be removed
    const rowsRemaining = [...el2.querySelectorAll('[data-section=people] li')];
    expect(rowsRemaining.find((r) => text(r).includes('org2@x.test'))!.querySelector('button')).toBeNull();
  });

  it('warns if trying to invite someone who is already an organiser', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const { ctx } = makeCtx(api);
    const el = await peopleScreen(ctx, ev.id);
    pick(el, 'role', 'organiser');
    (el.querySelector('input[name=email]') as HTMLInputElement).value = EMAILS.org;
    submit(el);
    await wait();
    expect(text(el.querySelector('[role=status]')!)).toContain('already an organiser');
  });
});

describe('judge invitation names',()=>{
 it('requires a name for judges and leads, retains it through acceptance, and shows names alongside email',async()=>{
  const {api,ev}=await world();await api.signIn(EMAILS.org);
  const el=await peopleScreen(makeCtx(api).ctx,ev.id);
  pick(el,'role','judge');pick(el,'panel','verbal');pick(el,'email','named@x.test');
  submit(el);await wait();
  expect(text(el)).toContain('Enter the judge’s full name');
  expect((el.querySelector('[name=name]') as HTMLInputElement).required).toBe(true);
  expect(await api.listInvitations(ev.id)).toHaveLength(0);
  pick(el,'name','  Asha Patel  ');submit(el);await wait();
  expect((await api.listInvitations(ev.id))[0].name).toBe('Asha Patel');
  expect(text(el.querySelector('[data-section=invitations]')!)).toContain('Asha Patel');
  await api.signIn('named@x.test');await api.claimInvitations();
  expect((await api.myRoles(ev.id))[0].name).toBe('Asha Patel');
  await api.signIn(EMAILS.org);
  const updated=await peopleScreen(makeCtx(api).ctx,ev.id);
  expect(text(updated.querySelector('[data-section=people]')!)).toContain('Asha Patel');
  expect(text(updated.querySelector('[name=assignment-person]')!)).toContain('Asha Patel');
 });
 it('keeps optional names optional for other staff and renders judge names as text',async()=>{
  const {api,ev}=await world();await api.signIn(EMAILS.org);
  const el=await peopleScreen(makeCtx(api).ctx,ev.id);pick(el,'role','chair');
  expect((el.querySelector('[name=name]') as HTMLInputElement).required).toBe(false);
  await api.invite(ev.id,{email:'safe@x.test',name:'<img src=x onerror=alert(1)>',role:'judge',panel:'verbal'});
  const updated=await peopleScreen(makeCtx(api).ctx,ev.id);
  expect(updated.querySelector('img')).toBeNull();expect(text(updated)).toContain('<img src=x onerror=alert(1)>');
 });
});
