import {it,expect} from 'vitest';
import {allocateStreams,emptySchedule,planWindowSlots,validateSchedule,scheduleTimeIso,localScheduleTime,type ScheduleDoc,type WindowSlotOptions} from '../../src/scheduling';
const tz='Asia/Kolkata',at=(t:string)=>scheduleTimeIso(`2027-06-01T${t}`,tz),local=(iso:string)=>localScheduleTime(iso,tz).slice(11);
const makeTeams=(n:number)=>Array.from({length:n},(_,i)=>({id:`team-${i+1}`,number:String(i+1),name:`Team ${i+1}`}));
const makeDoc=(teams:{id:string}[]):ScheduleDoc=>({...emptySchedule(),days:[{date:'2027-06-01',opens:'08:00',closes:'18:00'}],...allocateStreams(teams.map(t=>t.id))});
const verbal=(patch:Partial<WindowSlotOptions>={}):WindowSlotOptions=>({kind:'judging',title:'Verbal Presentation',panel:'verbal',start:at('12:00'),end:at('15:00'),duration:20,gap:0,lanes:'stream',streamId:null,location:'',replace:true,...patch});
const overlapErrors=(doc:ScheduleDoc,teams:{id:string;name:string}[])=>validateSchedule(doc,teams).filter(i=>i.code==='overlap');

it('gives every team one exact slot, with streams running side by side inside the window',()=>{
 const teams=makeTeams(25),doc=makeDoc(teams),plan=planWindowSlots(doc,teams,verbal());
 expect(plan.leftover).toEqual([]);expect(plan.slotTimes).toBe(9);expect(plan.lanes).toHaveLength(3);expect(plan.capacity).toBe(27);
 expect(plan.slots).toHaveLength(25);expect(new Set(plan.slots.map(s=>s.teamIds[0]))).toEqual(new Set(teams.map(t=>t.id)));
 for(const s of plan.slots){expect(local(s.start)>='12:00').toBe(true);expect(local(s.end!)<='15:00').toBe(true);expect(Date.parse(s.end!)-Date.parse(s.start)).toBe(20*60000);expect(s.streamId).toBe(doc.allocations.find(a=>a.teamId===s.teamIds[0])!.streamId);}
 // One team per stream per slot time, and the first slot runs in every stream at once.
 for(const stream of doc.streams){const starts=plan.slots.filter(s=>s.streamId===stream.id).map(s=>s.start);expect(new Set(starts).size).toBe(starts.length);}
 expect(plan.slots.filter(s=>local(s.start)==='12:00')).toHaveLength(3);
 // Number order is kept: the earliest teams in each stream get the earliest slots.
 for(const stream of doc.streams){const own=plan.slots.filter(s=>s.streamId===stream.id).map(s=>Number(s.teamIds[0].slice(5)));expect(own).toEqual([...own].sort((a,b)=>a-b));}
 expect(plan.slots[0].title).toMatch(/^Verbal Presentation — Team \d+$/);
 doc.activities.push(...plan.slots);expect(validateSchedule(doc,teams).filter(i=>i.severity==='error')).toEqual([]);
});

it('reports exactly how many fit, who is left over and when the window would need to end',()=>{
 const teams=makeTeams(25),doc=makeDoc(teams),plan=planWindowSlots(doc,teams,verbal({end:at('13:00')}));
 expect(plan.slotTimes).toBe(3);expect(plan.slots).toHaveLength(9);expect(plan.leftover).toHaveLength(16);expect(plan.leftover.map(x=>x.teamId)).not.toContain('team-1');expect(plan.leftover.every(x=>x.reason==='full')).toBe(true);
 expect(local(plan.neededEnd!)).toBe('15:00');expect(new Set([...plan.slots.map(s=>s.teamIds[0]),...plan.leftover.map(x=>x.teamId)]).size).toBe(25);
 expect(planWindowSlots(doc,teams,verbal({end:at('13:00'),gap:5})).slotTimes).toBe(2);
});

it('never books a team in two places at once across judging areas and racing',()=>{
 const teams=makeTeams(30),doc=makeDoc(teams);
 for(const area of [verbal({end:at('15:20')}),verbal({title:'Design & Engineering',panel:'design_engineering',end:at('15:20')})]){const p=planWindowSlots(doc,teams,area);expect(p.leftover).toEqual([]);doc.activities.push(...p.slots);}
 const racing=planWindowSlots(doc,teams,{...verbal(),kind:'racing',title:'Racing',panel:null,duration:6,lanes:'single'});
 expect(racing.leftover).toEqual([]);doc.activities.push(...racing.slots);
 expect(new Set(racing.slots.map(s=>s.start)).size).toBe(30);
 expect(overlapErrors(doc,teams)).toEqual([]);expect(doc.activities).toHaveLength(90);
});

it('skips a team that is busy for the whole window and says why',()=>{
 const teams=makeTeams(4),doc=makeDoc(teams);
 doc.activities.push({id:'busy',title:'Media interview',kind:'activity',scope:'teams',streamId:null,teamIds:['team-1'],panel:null,start:at('11:00'),end:at('16:00'),point:false,resourceIds:[],location:''});
 const plan=planWindowSlots(doc,teams,verbal());expect(plan.leftover).toEqual([{teamId:'team-1',reason:'busy'}]);expect(plan.neededEnd).toBeNull();
 // Information-only judging blocks never block a team.
 doc.activities=[{id:'info',title:'Judging briefing',kind:'judging',scope:'all',streamId:null,teamIds:[],panel:'verbal',start:at('11:00'),end:at('16:00'),point:false,resourceIds:[],location:''}];
 expect(planWindowSlots(doc,teams,verbal()).leftover).toEqual([]);
});

it('replaces an area’s earlier slots on regeneration but leaves other areas and racing rounds alone',()=>{
 const teams=makeTeams(12),doc=makeDoc(teams);
 const first=planWindowSlots(doc,teams,verbal());doc.activities.push(...first.slots);
 const enterprise=planWindowSlots(doc,teams,verbal({title:'Enterprise',panel:'enterprise',start:at('15:00'),end:at('17:00')}));doc.activities.push(...enterprise.slots);
 const again=planWindowSlots(doc,teams,verbal({duration:15}));expect(again.replaced).toHaveLength(12);expect(again.replaced.every(a=>a.panel==='verbal')).toBe(true);expect(again.leftover).toEqual([]);
 expect(planWindowSlots(doc,teams,verbal({duration:15,replace:false})).replaced).toEqual([]);
});

it('skips exempt teams for judging but keeps them for racing, and limits to one stream when asked',()=>{
 const teams=makeTeams(15),doc=makeDoc(teams);doc.exemptions=[{teamId:'team-1',panel:'verbal',reason:'Rule exemption'}];
 expect(planWindowSlots(doc,teams,verbal()).slots.some(s=>s.teamIds[0]==='team-1')).toBe(false);
 expect(planWindowSlots(doc,teams,{...verbal(),kind:'racing',title:'Racing',panel:null}).slots.some(s=>s.teamIds[0]==='team-1')).toBe(true);
 const one=planWindowSlots(doc,teams,{...verbal(),kind:'racing',title:'Racing',panel:null,streamId:doc.streams[1].id});
 expect(one.lanes).toHaveLength(1);expect(one.slots.every(s=>s.streamId===doc.streams[1].id)).toBe(true);
});

it('labels locations per stream so parallel panels are not reported as sharing a room, and flags windows outside hours',()=>{
 const teams=makeTeams(20),doc=makeDoc(teams),plan=planWindowSlots(doc,teams,verbal({location:'Hall 2'}));
 expect(new Set(plan.slots.map(s=>s.location))).toEqual(new Set(['Hall 2 · Stream A','Hall 2 · Stream B']));
 doc.activities.push(...plan.slots);expect(validateSchedule(doc,teams).filter(i=>i.code==='resource_overlap')).toEqual([]);
 expect(plan.outsideHours).toBe(false);expect(planWindowSlots(doc,teams,verbal({start:at('17:00'),end:at('19:00')})).outsideHours).toBe(true);
});

it('rejects windows that end before they start, missing categories and unallocated events',()=>{
 const teams=makeTeams(3),doc=makeDoc(teams);
 expect(()=>planWindowSlots(doc,teams,verbal({end:at('11:00')}))).toThrow(/end after/);
 expect(()=>planWindowSlots(doc,teams,verbal({panel:null}))).toThrow(/category/);
 expect(()=>planWindowSlots(doc,teams,verbal({title:' '}))).toThrow(/name/);
 expect(()=>planWindowSlots({...doc,allocations:[]},teams,verbal())).toThrow(/stream allocation first/);
});

it('rearranges teams so a team with only one free time still gets it',()=>{
 const teams=makeTeams(2),doc=makeDoc(teams);
 // Team 2 is busy from 12:20, so it must take 12:00 even though Team 1 comes first in the order.
 doc.activities.push({id:'race',title:'Race',kind:'racing',scope:'teams',streamId:doc.allocations[1].streamId,teamIds:['team-2'],panel:null,start:at('12:20'),end:at('13:00'),point:false,resourceIds:[],location:''});
 const plan=planWindowSlots(doc,teams,verbal({end:at('12:40'),lanes:'single'}));
 expect(plan.leftover).toEqual([]);expect(local(plan.slots.find(s=>s.teamIds[0]==='team-2')!.start)).toBe('12:00');expect(local(plan.slots.find(s=>s.teamIds[0]==='team-1')!.start)).toBe('12:20');
});
