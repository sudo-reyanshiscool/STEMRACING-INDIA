// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, blankReview } from '../../src/api';
import { INDIA_2026 } from '../../src/rulesets';
import { ReviewDraft } from '../../src/ui/review-draft';
import { tallyNominations } from '../../src/ui/nominations';
import { scorecardScreen } from '../../src/ui/scorecard';
import { EMAILS, makeCtx, reviewScorecard, text, world } from './helpers';

let cleanup: Array<() => void> = [];
beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup.forEach((f) => f()); cleanup = []; vi.restoreAllMocks(); });
const type = (el: HTMLTextAreaElement, value: string) => { el.value=value; el.dispatchEvent(new Event('input',{bubbles:true})); };
const button = (el: HTMLElement, name: string) => [...el.querySelectorAll('button')].find((b)=>b.textContent===name)!;
const note = (el: HTMLElement, name: string) => [...el.querySelectorAll('textarea')].find((t)=>t.getAttribute('aria-label')===name)!;
async function open() {
  const w = await world(); await w.api.signIn(EMAILS.judge);
  const c = makeCtx(w.api); cleanup.push(...c.leaves);
  const el = await scorecardScreen(c.ctx,w.ev.id,w.t1.id,'verbal-technique'); cleanup.push(...c.leaves);
  return {...w,...c,el};
}

describe('rubric scorecard workflow',()=>{
  it('scores by band buttons including zero, highlights one value and requires overall feedback before review',async()=>{
    const {el,queue,api,ev}=await open();
    const first=el.querySelectorAll<HTMLElement>('.score-criterion')[0];
    expect(first.querySelectorAll('.score-choice')).toHaveLength(21);
    expect(text(first)).toContain('Monotonous presentation');
    button(first,'0').click(); button(first,'20').click();
    button(el.querySelectorAll<HTMLElement>('.score-criterion')[1],'0').click();
    await queue.flush();
    expect((await api.listCards(ev.id))[0].scores).toEqual({'engagement-presentation-dynamics':20,'team-contribution':0});
    expect(first.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    expect(first.querySelector('[aria-pressed="true"]')?.textContent).toBe('20');
    expect(text(el)).toContain('20 / 40');
    expect(button(el,'Submit scorecard').hidden).toBe(true);
    button(el,'Check card').click();
    expect(text(el.querySelector('[role=alert]:not([hidden])')!)).toContain('Overall Comment');
    await reviewScorecard(el);
    expect(button(el,'Submit scorecard').hidden).toBe(false);
    button(first,'19').click();
    expect(button(el,'Submit scorecard').hidden).toBe(true);
  });
  it('saves notes without a score and keeps them separate from shared criterion comments',async()=>{
    const {el,api,ev}=await open();
    type(note(el,'Team Contribution private notes'),'Ask who handled testing.');
    type(note(el,'Internal Notes'),'Discuss with the panel lead.');
    type(note(el,'Key Strengths'),'Strong collaboration.');
    const award=el.querySelector<HTMLInputElement>('input[value="sustainability"]')!;award.checked=true;award.dispatchEvent(new Event('change',{bubbles:true}));
    button(el,'Save notes and feedback again').click();
    await vi.waitFor(async()=>expect((await api.getReview((await api.listCards(ev.id))[0].id)).internalNotes).toBe('Discuss with the panel lead.'));
    const card=(await api.listCards(ev.id))[0];
    expect(card.scores).toEqual({});expect(card.comments).toEqual({});
    expect(await api.getReview(card.id)).toMatchObject({criterionNotes:{'team-contribution':'Ask who handled testing.'},strengths:'Strong collaboration.',nominations:['sustainability']});
  });
  it('blocks submission on failed feedback saves and retains a local draft without exposing raw errors',async()=>{
    const {el,api}=await open();
    for(const c of el.querySelectorAll<HTMLElement>('.score-criterion'))button(c,'12').click();
    vi.spyOn(api,'saveReview').mockRejectedValue(new ApiError('network','raw.internal.host'));
    type(note(el,'Overall Comment'),'A useful presentation.');button(el,'Check card').click();
    await vi.waitFor(()=>expect(text(el)).toContain('Some scores, notes or feedback have not saved'));
    expect(button(el,'Submit scorecard').hidden).toBe(true);
    expect(text(el)).not.toContain('raw.internal.host');
    expect(Object.keys(localStorage).some((k)=>k.startsWith('stem-review:'))).toBe(true);
  });
});

describe('review draft reliability',()=>{
  async function draft() {
    const w=await world();await w.api.signIn(EMAILS.judge);
    const card=await w.api.openCard(w.ev.id,w.t1.id,'verbal-technique');
    const area=INDIA_2026.areas.find((a)=>a.id==='verbal-technique')!;
    const uid=(await w.api.getSession())!.userId;
    const create=()=>new ReviewDraft(w.api,uid,card.id,0,blankReview(),area,false,()=>{},true);
    const d=create();cleanup.push(()=>d.dispose());return {...w,card,d,create};
  }
  it('restores a pending draft after leaving and removes it after acknowledgement',async()=>{
    const {d,create,api,card}=await draft();
    d.edit((r)=>{r.overall='Draft from this device';r.criterionNotes['team-contribution']='Question';});d.dispose();
    const again=create();cleanup.push(()=>again.dispose());
    expect(again.pending).toBe(true);expect(again.value.overall).toBe('Draft from this device');
    await again.flush();expect((await api.getReview(card.id)).overall).toBe('Draft from this device');
    expect(localStorage.length).toBe(0);
  });
  it('serialises a slow save followed by a newer edit',async()=>{
    const {d,api,card}=await draft();
    let release!:()=>void;const save=api.saveReview.bind(api);let count=0;
    vi.spyOn(api,'saveReview').mockImplementation(async(c,r)=>{if(++count===1)await new Promise<void>((resolve)=>{release=resolve;});await save(c,r);});
    d.edit((r)=>{r.overall='Earlier';});const flight=d.flush();
    await vi.waitFor(()=>expect(release).toBeDefined());
    d.edit((r)=>{r.overall='Latest';});expect(d.flush()).toBe(flight);release();await flight;
    expect((await api.getReview(card.id)).overall).toBe('Latest');expect(d.pending).toBe(false);
  });
  it('keeps drafts separated by the judge and refuses sending after a session switch',async()=>{
    const {d,api,card}=await draft();d.edit((r)=>{r.internalNotes='Private';});
    await api.signIn(EMAILS.org);expect(await d.flush()).toBe(false);expect(d.pending).toBe(true);
    expect(d.error).toMatchObject({code:'unauthenticated'});
    expect((await api.getReview(card.id)).internalNotes).toBe('');
  });
});

it('deduplicates award nominations across sections while counting other judges and panels',()=>{
  const row={cardId:'c',teamId:'t',panel:'verbal',judgeId:'j',nominations:['team-identity']};
  const result=tallyNominations([row,{...row,cardId:'c2'},{...row,judgeId:'j2'},{...row,panel:'enterprise'}]);
  expect(result.find((r)=>r.award.id==='team-identity')!.teams).toEqual([{teamId:'t',votes:3,panels:2}]);
});

it('provides all four sourced descriptions for every criterion, with distinct portfolio presentation rubrics',()=>{
  const criteria=INDIA_2026.areas.flatMap((a)=>a.criteria);expect(criteria).toHaveLength(35);
  for(const c of criteria)expect(c.bands.every((b)=>!!b.description?.trim()),c.id).toBe(true);
  const design=INDIA_2026.areas.find((a)=>a.id==='de-portfolio')!.criteria.find((c)=>c.id==='document-presentation')!;
  const enterprise=INDIA_2026.areas.find((a)=>a.id==='enterprise-portfolio')!.criteria.find((c)=>c.id==='document-presentation')!;
  expect(design.bands[0].description).not.toBe(enterprise.bands[0].description);
});

it('shares only team feedback with the manager after release, keeping all private notes out of results',async()=>{
  const {api,ev,t1}=await world();await api.signIn(EMAILS.judge);
  const card=await api.openCard(ev.id,t1.id,'verbal-technique');
  await api.saveScore(card.id,'engagement-presentation-dynamics',14);await api.saveScore(card.id,'team-contribution',12);
  await api.saveReview(card.id,{...blankReview(),overall:'TEAM FEEDBACK',strengths:'TEAM STRENGTH',improvements:'TEAM IMPROVEMENT',
    internalNotes:'PRIVATE OVERALL',criterionNotes:{'team-contribution':'PRIVATE CRITERION'},nominations:['sustainability']});
  await api.submitCard(card.id);await api.signIn(EMAILS.mgr);
  expect(await api.listFeedback(ev.id)).toEqual([]);
  const {releaseResults}=await import('./helpers');await releaseResults(api,ev.id);
  const {resultsScreen}=await import('../../src/ui/results');const {ctx}=makeCtx(api);
  const el=await resultsScreen(ctx,ev.id);
  expect(text(el)).toContain('TEAM FEEDBACK');expect(text(el)).toContain('TEAM STRENGTH');expect(text(el)).toContain('TEAM IMPROVEMENT');
  expect(text(el)).not.toContain('PRIVATE OVERALL');expect(text(el)).not.toContain('PRIVATE CRITERION');
  expect((await api.getReview(card.id)).criterionNotes).toEqual({});expect(await api.listNominations(ev.id)).toEqual([]);
});
