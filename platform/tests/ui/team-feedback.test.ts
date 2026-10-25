// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { teamFeedbackScreen } from '../../src/ui/team-feedback';
import { EMAILS, makeCtx, world } from './helpers';
describe('team feedback screen',()=>{
 it('submits as manager and resolves as organiser, with visible response',async()=>{
  const {api,ev,t1}=await world();
  const {ctx}=makeCtx(api);
  const screen=await teamFeedbackScreen(ctx,ev.id);document.body.replaceChildren(screen);
  expect([...screen.querySelectorAll('#concern-team option')].map(e=>(e as HTMLOptionElement).value)).toEqual([t1.id]);
  screen.querySelector<HTMLTextAreaElement>('textarea')!.value='Our presentation was interrupted.';
  screen.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
  await vi.waitFor(()=>expect(ctx.rerender).toHaveBeenCalled());
  await api.signIn(EMAILS.org);
  const staff=await teamFeedbackScreen(ctx,ev.id);document.body.replaceChildren(staff);
  expect(staff.textContent).toContain('Our presentation was interrupted.');
  staff.querySelector<HTMLTextAreaElement>('textarea')!.value='Reviewed with judges; team informed.';
  vi.mocked(ctx.rerender).mockClear();
  staff.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
  await vi.waitFor(()=>expect(ctx.rerender).toHaveBeenCalled());
  await api.signIn(EMAILS.mgr);
  const result=await teamFeedbackScreen(ctx,ev.id);
  expect(result.textContent).toContain('Reviewed with judges; team informed.');
  expect(result.textContent).toContain('Resolved');
 });
 it('does not expose submissions to judges',async()=>{
  const {api,ev}=await world();await api.signIn(EMAILS.judge);
  const screen=await teamFeedbackScreen(makeCtx(api).ctx,ev.id);
  expect(screen.querySelector('form')).toBeNull();
  expect(screen.textContent).toContain('available to team managers');
 });
});
