// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { blankReview } from '../../src/api';
import { scoresScreen } from '../../src/ui/scores';
import { eventNav } from '../../src/ui/event-nav';
import { EMAILS, makeCtx, releaseResults, text, world } from './helpers';
const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach((f) => f()); vi.useRealTimers(); });
async function setup(email = EMAILS.org as string) {
  const w = await world(); await w.api.signIn(EMAILS.judge);
  const card = await w.api.openCard(w.ev.id,w.t1.id,'verbal-technique');
  await w.api.saveScore(card.id,'engagement-presentation-dynamics',16);
  await w.api.saveScore(card.id,'team-contribution',18);
  await w.api.saveReview(card.id,{...blankReview(),overall:'Clear explanation',internalNotes:'Private discussion'});
  await w.api.signIn(email); const {ctx,leaves}=makeCtx(w.api);const el=await scoresScreen(ctx,w.ev.id);
  cleanups.push(()=>leaves.forEach(f=>f())); return {...w,ctx,el,card};
}
describe('shared Scores interface',()=>{
  it('shows judges’ saved drafts and criterion breakdown to the organiser, without private notes',async()=>{
    const {el}=await setup();expect(text(el)).toContain('34 / 40');expect(text(el)).toContain('Draft · not counted');
    expect(text(el)).toContain('16 / 20');expect(text(el)).toContain('18 / 20');expect(text(el)).toContain('Clear explanation');
    expect(text(el)).not.toContain('Private discussion');expect(text(el)).not.toContain('Continue scoring');
  });
  it('uses the same submitted scores in the Chair and Judge interfaces, and lets only the owner continue scoring',async()=>{
    const {api,ev,el,card,ctx}=await setup(EMAILS.judge);expect(text(el)).toContain('Continue scoring');
    await api.submitCard(card.id);await api.signIn(EMAILS.chair);
    const chair=await scoresScreen(ctx,ev.id);expect(text(chair)).toContain('1 submitted · 0 draft');expect(text(chair)).toContain('34 / 40');
    expect(text(chair)).not.toContain('Continue scoring');
    await api.signIn(EMAILS.judge);expect(text(await scoresScreen(ctx,ev.id))).toContain('View submitted scorecard');
  });
  it('restricts a judge to their own cards and keeps team feedback hidden until release',async()=>{
    const {api,ev,ctx}=await setup(EMAILS.judge);
    await api.signIn(EMAILS.org);await api.invite(ev.id,{email:'other@x.test',role:'judge',panel:'verbal'});
    await api.signIn('other@x.test');await api.claimInvitations();expect(text(await scoresScreen(ctx,ev.id))).toContain('No saved scorecards');
    await api.signIn(EMAILS.mgr);expect(text(await scoresScreen(ctx,ev.id))).toContain('not available');
    await api.signIn(EMAILS.judge);const c=(await api.listCards(ev.id))[0];await api.submitCard(c.id);await releaseResults(api,ev.id);
    await api.signIn(EMAILS.mgr);expect(text(await scoresScreen(ctx,ev.id))).toContain('34 / 40');
  });
  it('refreshes another device’s saved score without losing the selected filters and stops when leaving',async()=>{
    vi.useFakeTimers();const {api,ev,t1,ctx,el,card}=await setup(EMAILS.judge);
    const filter=el.querySelector<HTMLSelectElement>('[aria-label="Filter scores by team"]')!;filter.value=t1.id;filter.dispatchEvent(new Event('change'));
    await api.saveScore(card.id,'team-contribution',20);
    await vi.advanceTimersByTimeAsync(10_000);expect(text(el)).toContain('36 / 40');expect(filter.value).toBe(t1.id);
    const spy=vi.spyOn(api,'listCards');cleanups.splice(0).forEach(f=>f());await vi.advanceTimersByTimeAsync(20_000);expect(spy).not.toHaveBeenCalled();
    expect(await api.getEvent(ev.id)).not.toBeNull();expect(ctx).toBeTruthy();
  });
  it('links the role interfaces to the same event and marks the active view',async()=>{
    const {api,ev}=await setup();const nav=eventNav(ev,await api.myRoles(ev.id),'scores');
    expect(nav.querySelector('[aria-current=page]')?.textContent).toBe('Scores');
    expect([...nav.querySelectorAll('a')].every(a=>a.getAttribute('href')?.startsWith(`#/event/${ev.id}`))).toBe(true);
    expect(text(nav)).not.toContain('Moderation');expect(text(nav)).toContain('Rankings');
  });
});
