import type {DrawLotsState,JudgeLotAssignment,Panel,TeamNumberAssignment,TeamRow} from '../api';

export class DrawError extends Error {}
type Index=(limit:number)=>number;
const randomIndex:Index=limit=>{
 const ceiling=Math.floor(0x100000000/limit)*limit,buf=new Uint32Array(1);
 do{crypto.getRandomValues(buf);}while(buf[0]>=ceiling);
 return buf[0]%limit;
};
function shuffle<T>(items:readonly T[],pick:Index):T[]{
 const result=[...items];for(let i=result.length-1;i>0;i--){const j=pick(i+1);[result[i],result[j]]=[result[j],result[i]];}return result;
}
export function drawTeamNumbers(teams:TeamRow[],pick:Index=randomIndex):TeamNumberAssignment[]{
 if(!teams.length||teams.length>1000)throw new DrawError('A draw needs between 1 and 1,000 teams.');
 const pinned=teams.filter(t=>t.name.trim().toUpperCase()==='SUPERCHARGED');
 if(pinned.length>1)throw new DrawError('More than one team is named SUPERCHARGED. Give each team a distinct name before drawing numbers.');
 const order=[...pinned,...shuffle(teams.filter(t=>!pinned.includes(t)),pick)];
 return order.map((t,i)=>({teamId:t.id,number:String(i+1).padStart(3,'0')}));
}

/** Balanced matching, including reassignment paths when conflicts make a greedy draw fail. */
export function drawJudgeLots(state:DrawLotsState,panel:Panel,judgeIds:string[],pick:Index=randomIndex):JudgeLotAssignment[]{
 if(!state.teams.length||state.teams.length>1000)throw new DrawError('A draw needs between 1 and 1,000 teams.');
 const judges=[...new Set(judgeIds)];
 if(!judges.length)throw new DrawError('Select at least one judge for this panel.');
 if(judges.length>state.teams.length)throw new DrawError('Select no more judges than teams so every judge receives a team.');
 if(judges.some(id=>!state.roles.some(r=>r.userId===id&&r.role==='judge'&&r.panel===panel)))throw new DrawError('Select judges already assigned to this panel.');
 const eligible=new Map(state.teams.map(t=>[t.id,shuffle(judges.filter(id=>!state.conflicts.some(c=>c.judgeId===id&&c.teamId===t.id)&&!state.exemptions.some(c=>c.judgeId===id&&c.teamId===t.id)),pick)]));
 const blocked=state.teams.find(t=>!eligible.get(t.id)!.length);
 if(blocked)throw new DrawError(`Team ${blocked.number} has no eligible judge in this selection. Choose different judges or review its conflicts and exemptions.`);
 const buckets=new Map(judges.map(id=>[id,[] as string[]])),owner=new Map<string,string>();
 const floor=Math.floor(state.teams.length/judges.length),ceiling=Math.ceil(state.teams.length/judges.length);
 const move=(team:string,judge:string)=>{const previous=owner.get(team);if(previous){const b=buckets.get(previous)!;b.splice(b.indexOf(team),1);}buckets.get(judge)!.push(team);owner.set(team,judge);};
 const place=(team:string,seen:Set<string>):boolean=>{
  const choices=[...eligible.get(team)!].sort((a,b)=>buckets.get(a)!.length-buckets.get(b)!.length);
  for(const judge of choices){
   if(seen.has(judge))continue;seen.add(judge);
   if(buckets.get(judge)!.length<ceiling){move(team,judge);return true;}
   for(const occupied of shuffle(buckets.get(judge)!,pick))if(place(occupied,seen)){move(team,judge);return true;}
  }return false;
 };
 const teams=shuffle(state.teams,pick).sort((a,b)=>eligible.get(a.id)!.length-eligible.get(b.id)!.length);
 const impossible=()=>new DrawError('A balanced draw is not possible with these judges, conflicts and exemptions. Select different judges or assign teams manually.');
 for(const team of teams)if(!place(team.id,new Set()))throw impossible();
 const fill=(judge:string,seen:Set<string>):boolean=>{
  seen.add(judge);
  for(const team of shuffle(state.teams,pick)){
   const previous=owner.get(team.id)!;
   if(seen.has(previous)||!eligible.get(team.id)!.includes(judge))continue;
   move(team.id,judge);
   if(buckets.get(previous)!.length>=floor||fill(previous,new Set(seen)))return true;
   move(team.id,previous);
  }return false;
 };
 for(const judge of shuffle(judges,pick))while(buckets.get(judge)!.length<floor)if(!fill(judge,new Set()))throw impossible();
 return judges.map(judgeId=>({judgeId,teamIds:buckets.get(judgeId)!}));
}
