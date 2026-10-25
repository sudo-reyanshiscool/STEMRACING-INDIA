import {describe,it,expect} from 'vitest';
import {blankLane,followupInput,rerunEligible,validateRace,type RaceHeat} from '../../src/racing';
import {carCheck,competitionScores,defaultRacingSetup,defaultReactionScoring,validateSetup} from '../../src/racing/competition';
import {INDIA_TECHNICAL,selectedRules,summarise,type Inspection} from '../../src/technical';
const race:RaceHeat={id:'heat',eventId:'e',number:1,revision:1,updatedAt:'2026-10-25',label:'Heat',phase:'reaction',lane1:{...blankLane('one'),car:'A'},lane2:{...blankLane('one'),car:'B'},note:'',source:'manual',sourceRunId:null};
describe('2027 racing behaviour',()=>{
 it('permits distinct cars from one team only in reaction racing',()=>{
  expect(validateRace(race)).toBeNull();expect(validateRace({...race,phase:'knockout'})).toContain('Same-team');
  expect(validateRace({...race,lane2:{...race.lane2,car:'A'}})).toContain('Same-team');
  const swap=followupInput(race,'swap');expect([swap.lane1.car,swap.lane2.car]).toEqual(['B','A']);expect(race.lane1.car).toBe('A');
 });
 it('allows DNS/false-start and tied replays but excludes DNF and pending heats',()=>{
  const result=(a:'dns'|'false_start'|'dnf',b:'dns'|'false_start'|'dnf')=>({...race,lane1:{...race.lane1,status:a},lane2:{...race.lane2,status:b}});
  expect(rerunEligible(result('dns','false_start'))).toBe(true);expect(rerunEligible(result('dns','dnf'))).toBe(false);expect(rerunEligible(race)).toBe(false);
 });
 it('excludes unselected failures from penalties and race readiness',()=>{
  const rule=INDIA_TECHNICAL.rules.find(r=>r.kind==='check')!;
  const inspection:Inspection={id:'i',eventId:'e',teamId:'one',car:'A',inspectorId:'u',status:'submitted',rulesetId:INDIA_TECHNICAL.id,selectedArticles:[rule.article],measurements:{[rule.article]:true,'T3.6':0},notes:{},startedAt:'',submittedAt:'',updatedAt:'',revision:1};
  const summary=summarise(selectedRules(INDIA_TECHNICAL.rules,inspection),inspection.measurements);
  expect(summary.complete).toBe(true);expect(summary.total).toBe(0);expect(summary.results).toHaveLength(1);expect(carCheck([inspection],'one','A').ready).toBe(true);
 });
 it('uses saved reaction and fastest-car settings and validates their limits',()=>{
  const scoring={...defaultReactionScoring(),podium:[100,90,80] as [number,number,number],minimum:4,fastestCarBonus:7};
  const setup={...defaultRacingSetup(),reactionComplete:true,scoring};
  const finished={...race,lane1:{...race.lane1,status:'finished' as const,totalMs:1000,reactionMs:200},lane2:{...race.lane2,status:'finished' as const,totalMs:1100,reactionMs:200}};
  expect(validateSetup(setup)).toBeNull();expect(competitionScores(['one'],[finished],[],setup).derived.one.reaction).toBe(100);
  expect(validateSetup({...setup,scoring:{...scoring,fastestCarBonus:11}})).toContain('Check reaction');
 });
});

describe('checklist selection contract',()=>{
 it('retains every rule when its article is selected and preserves full historical checklists',()=>{
  expect(selectedRules(INDIA_TECHNICAL.rules,{})).toBe(INDIA_TECHNICAL.rules);
  const articles=INDIA_TECHNICAL.rules.map(r=>r.article);
  expect(selectedRules(INDIA_TECHNICAL.rules,{selectedArticles:articles})).toEqual(INDIA_TECHNICAL.rules);
 });
});
