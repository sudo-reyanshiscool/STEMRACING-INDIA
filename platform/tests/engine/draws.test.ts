import {describe,expect,it} from 'vitest';
import type {DrawLotsState,TeamRow} from '../../src/api';
import {drawJudgeLots,drawTeamNumbers} from '../../src/draws/random';
const teams=(n:number):TeamRow[]=>Array.from({length:n},(_,i)=>({id:`t${i}`,eventId:'e',name:i===2?'SUPERCHARGED':`Team ${i}`,number:String(i+1),school:''}));
const state=(n=5,j=3):DrawLotsState=>({version:'x',teams:teams(n),roles:Array.from({length:j},(_,i)=>({id:`r${i}`,eventId:'e',userId:`j${i}`,role:'judge',panel:'verbal',teamId:null,email:`judge${i}@x.test`})),conflicts:[],exemptions:[],released:false,numberingLocked:false,lockedPanels:[]});
const pick=(n:number)=>n-1;
describe('random setup draws',()=>{
 it('includes SUPERCHARGED in the full random draw when the showcase disables the reservation',()=>{
  const result=drawTeamNumbers(teams(3),()=>0,{reserveSupercharged:false});
  expect(result.find(a=>a.teamId==='t2')!.number).not.toBe('001');
  expect(result.map(a=>a.number)).toEqual(['001','002','003']);
 });
 it('reserves 001 for SUPERCHARGED and generates distinct contiguous numbers for all teams',()=>{
  for(const n of [3,50,1000]){const t=teams(n),result=drawTeamNumbers(t);
   expect(result.find(a=>a.teamId==='t2')!.number).toBe('001');
   expect(new Set(result.map(a=>a.teamId)).size).toBe(n);expect(new Set(result.map(a=>a.number)).size).toBe(n);
   expect(result.map(a=>a.number)).toEqual(Array.from({length:n},(_,i)=>String(i+1).padStart(3,'0')));
   expect(t[0].number).toBe('1');
  }
 });
 it('assigns every team once with group sizes differing by at most one',()=>{
  const s=state(50,7),result=drawJudgeLots(s,'verbal',s.roles.map(r=>r.userId));
  expect(new Set(result.flatMap(r=>r.teamIds)).size).toBe(50);
  expect(result.map(r=>r.teamIds.length).sort()).toEqual([7,7,7,7,7,7,8]);
 });
 it('finds balanced assignments around conflicts/exemptions and detects genuinely impossible draws',()=>{
  const s=state(4,2);s.conflicts=[{eventId:'e',judgeId:'j0',teamId:'t0'},{eventId:'e',judgeId:'j1',teamId:'t1'}];s.exemptions=[{eventId:'e',judgeId:'j0',teamId:'t2',reason:'Conflict'}];
  const result=drawJudgeLots(s,'verbal',['j0','j1'],pick);
  expect(result.find(r=>r.judgeId==='j0')!.teamIds.sort()).toEqual(['t1','t3']);
  s.conflicts.push({eventId:'e',judgeId:'j0',teamId:'t3'});
  expect(()=>drawJudgeLots(s,'verbal',['j0','j1'],pick)).toThrow('balanced draw is not possible');
 });
 it('agrees with exhaustive feasibility checks for constrained small draws',()=>{
  let seed=31;const rnd=(max:number)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return Math.floor(seed/0x100000000*max);};
  for(let attempt=0;attempt<200;attempt++){
   const s=state(5,3),judges=s.roles.map(r=>r.userId);
   for(const t of s.teams)for(const j of judges)if(rnd(4)===0)s.conflicts.push({eventId:'e',judgeId:j,teamId:t.id});
   const permitted=(t:string,j:string)=>!s.conflicts.some(c=>c.judgeId===j&&c.teamId===t);
   const feasible=(index:number,counts:number[]):boolean=>index===5?Math.max(...counts)-Math.min(...counts)<=1:judges.some((j,k)=>permitted(s.teams[index].id,j)&&counts[k]<2&&feasible(index+1,counts.map((v,l)=>v+(l===k?1:0))));
   const possible=feasible(0,[0,0,0]);
   if(!possible){expect(()=>drawJudgeLots(s,'verbal',judges,rnd)).toThrow();continue;}
   const result=drawJudgeLots(s,'verbal',judges,rnd);expect(result.map(r=>r.teamIds.length).sort()).toEqual([1,2,2]);
   for(const a of result)expect(a.teamIds.every(t=>permitted(t,a.judgeId))).toBe(true);
  }
 });
});
