// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/api';
import { scoringScreen } from '../../src/ui/scoring';
import { EMAILS, makeCtx, text, world } from './helpers';

const wait = () => new Promise((r) => setTimeout(r, 0));

describe('scoringScreen', () => {
  it('lists every team with the areas of the judge panel, linking to each scorecard', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.judge);
    const { ctx } = makeCtx(api);
    const el = await scoringScreen(ctx, ev.id);
    expect(text(el)).toContain('Verbal Presentation');
    const links = [...el.querySelectorAll('a.btn')].map((a) => a.getAttribute('href'));
    expect(links).toContain(`#/event/${ev.id}/score/${t1.id}/verbal-technique`);
    expect(links).toContain(`#/event/${ev.id}/score/${t1.id}/verbal-composition`);
    expect(links).toContain(`#/event/${ev.id}/score/${t1.id}/verbal-subject`);
    expect(links).toHaveLength(6);
    expect(text(el)).not.toContain('Design & Engineering');
  });

  it('shows the state of each card in words', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.judge);
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await api.saveScore(card.id, 'team-contribution', 12);
    const { ctx } = makeCtx(api);
    const el = await scoringScreen(ctx, ev.id);
    expect(text(el)).toContain('Draft');
    expect(text(el)).toContain('Not started');
  });

  it('shows submitted cards as Submitted', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.judge);
    const card = await api.openCard(ev.id, t1.id, 'verbal-technique');
    await api.saveScore(card.id, 'engagement-presentation-dynamics', 12);
    await api.saveScore(card.id, 'team-contribution', 12);
    await api.submitCard(card.id);
    const { ctx } = makeCtx(api);
    expect(text(await scoringScreen(ctx, ev.id))).toContain('Submitted');
  });

  it('lets a judge declare a conflict in two steps and then hides that team', async () => {
    const { api, ev, t2 } = await world();
    await api.signIn(EMAILS.judge);
    const { ctx } = makeCtx(api);
    const el = await scoringScreen(ctx, ev.id);
    const btn = () => [...el.querySelectorAll('button')].filter((b) => /conflict|Confirm/.test(b.textContent ?? ''));
    expect(btn()).toHaveLength(2);
    btn()[1].click();
    expect(text(btn()[1])).toContain('Confirm');
    expect(await api.myConflicts(ev.id)).toEqual([]);
    btn()[1].click();
    await wait();
    expect(await api.myConflicts(ev.id)).toEqual([t2.id]);
    expect(text(el)).toContain('You declared a conflict');
    expect([...el.querySelectorAll('a.btn')]).toHaveLength(3);
  });

  it('says before confirming that a declaration cannot be removed on this screen', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.judge);
    const { ctx } = makeCtx(api);
    const el = await scoringScreen(ctx, ev.id);
    expect(text(el)).toContain('cannot be removed on this screen');
  });

  it('keeps the team and shows a plain message when declaring fails, then allows a retry', async () => {
    const { api, ev, t2 } = await world();
    await api.signIn(EMAILS.judge);
    const { ctx } = makeCtx(api);
    vi.spyOn(api, 'declareConflict').mockRejectedValueOnce(new ApiError('network', 'raw: socket hang up'));
    const el = await scoringScreen(ctx, ev.id);
    const btn = () => [...el.querySelectorAll('button')].filter((b) => /conflict|Confirm/.test(b.textContent ?? ''));
    btn()[1].click();
    btn()[1].click();
    await wait();
    const alert = el.querySelector('[role=alert]:not([hidden])')!;
    expect(text(alert)).toContain('Could not reach the server');
    expect(text(el)).not.toContain('socket hang up');
    expect([...el.querySelectorAll('a.btn')]).toHaveLength(6);
    expect(btn()[1].disabled).toBe(false);
    btn()[1].click();
    btn()[1].click();
    await wait();
    expect(await api.myConflicts(ev.id)).toEqual([t2.id]);
  });

  it('says so when the person does not score any panel', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.lead);
    const { ctx } = makeCtx(api);
    expect(text(await scoringScreen(ctx, ev.id))).toContain('not a judge on any panel');
  });
});

it('detects a newly assigned panel on refresh and when returning to the page, without duplicate timers after leaving',async()=>{
 const {api,ev}=await world();await api.signIn(EMAILS.judge);const user=(await api.getSession())!.userId;
 const {ctx,leaves}=makeCtx(api);const el=await scoringScreen(ctx,ev.id);
 await api.signIn(EMAILS.org);await api.setJudgeAssignment(ev.id,user,'scrutineering',null);await api.signIn(EMAILS.judge);
 const refresh=[...el.querySelectorAll('button')].find(b=>text(b)==='Refresh assignments')!;
 refresh.click();await wait();expect(ctx.rerender).toHaveBeenCalledOnce();
 vi.mocked(ctx.rerender).mockClear();window.dispatchEvent(new Event('focus'));await wait();expect(ctx.rerender).toHaveBeenCalledOnce();
 leaves.forEach(f=>f());vi.mocked(ctx.rerender).mockClear();window.dispatchEvent(new Event('focus'));await wait();expect(ctx.rerender).not.toHaveBeenCalled();
});


it('shows both D&E and Scrutineering as panel choices and keeps each team list in the selected panel',async()=>{
 const {api,ev,t1,t2}=await world();await api.signIn(EMAILS.judge);const user=(await api.getSession())!.userId;
 await api.signIn(EMAILS.org);await api.setJudgeAssignment(ev.id,user,'design_engineering',[t1.id]);await api.setJudgeAssignment(ev.id,user,'scrutineering',[t2.id]);await api.signIn(EMAILS.judge);
 const {ctx,leaves}=makeCtx(api);const el=await scoringScreen(ctx,ev.id);
 const buttons=[...el.querySelectorAll<HTMLButtonElement>('[aria-label="Your judging panels"] button')];
 expect(buttons.map(text)).toEqual(['Verbal Presentation','Design & Engineering','Specification & Scrutineering']);
 expect(buttons.map(b=>b.getAttribute('aria-pressed'))).toEqual(['true','false','false']);
 const design=()=>el.querySelector<HTMLElement>('#judge-panel-design_engineering')!;
 const spec=()=>el.querySelector<HTMLElement>('#judge-panel-scrutineering')!;
 buttons[1].click();expect(design().hidden).toBe(false);expect(spec().hidden).toBe(true);
 buttons[2].click();expect(design().hidden).toBe(true);expect(spec().hidden).toBe(false);expect(buttons[2].getAttribute('aria-pressed')).toBe('true');
 expect(spec().querySelector(`a[href$="/${t2.id}/renders"]`)).not.toBeNull();expect(spec().querySelector(`a[href$="/${t1.id}/renders"]`)).toBeNull();
 leaves.forEach(f=>f());const again=await scoringScreen(makeCtx(api).ctx,ev.id);
 expect(again.querySelector<HTMLElement>('#judge-panel-scrutineering')!.hidden).toBe(false);
});
