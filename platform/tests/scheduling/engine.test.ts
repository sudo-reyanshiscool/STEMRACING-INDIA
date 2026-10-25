import {it,expect} from 'vitest';
import {allocateStreams,streamName,emptySchedule,validateSchedule,scheduleTimeIso,localScheduleTime} from '../../src/scheduling';
it.each([0,4,10,25,53,100,120])('allocates %i teams evenly in streams of up to ten, with exact coverage',n=>{
 const ids=Array.from({length:n},(_,i)=>`team-${i}`),draw=allocateStreams(ids);expect(draw.streams).toHaveLength(Math.ceil(n/10));expect(new Set(draw.allocations.map(a=>a.teamId))).toEqual(new Set(ids));const sizes=draw.streams.map(s=>draw.allocations.filter(a=>a.streamId===s.id).length);expect(sizes.every(n=>n<=10)).toBe(true);if(sizes.length)expect(Math.max(...sizes)-Math.min(...sizes)).toBeLessThanOrEqual(1);
});
it('continues stream labels after Z and makes independent random previews',()=>{expect(streamName(25)).toBe('Stream Z');expect(streamName(26)).toBe('Stream AA');expect(streamName(27)).toBe('Stream AB');const ids=Array.from({length:53},(_,i)=>String(i));expect(allocateStreams(ids).allocations).not.toEqual(allocateStreams(ids).allocations);});
it('roundtrips event timezones, including non-hour offsets, without using the computer timezone',()=>{expect(scheduleTimeIso('2027-06-01T10:37','Asia/Kolkata')).toBe('2027-06-01T05:07:00.000Z');expect(localScheduleTime('2027-06-01T05:07:00Z','Asia/Kolkata')).toBe('2027-06-01T10:37');expect(()=>scheduleTimeIso('2027-03-14T02:30','America/New_York')).toThrow();});
it('generates exact repeated racing slots while skipping category/all judging exemptions only for judging',async()=>{
 const {generateTeamSlots}=await import('../../src/scheduling');const teams=[{id:'a',number:'001',name:'One'},{id:'b',number:'002',name:'Two'},{id:'c',number:'003',name:'Three'}];const doc={...emptySchedule(),...allocateStreams(teams.map(t=>t.id)),exemptions:[{teamId:'a',panel:'all' as const,reason:'Excluded'},{teamId:'b',panel:'enterprise' as const,reason:'Category'}]};
 const options={kind:'judging' as const,panel:'enterprise' as const,start:'2027-06-01T04:30:00Z',duration:10,gap:27,rounds:2,streamId:null,resourceId:null,location:'Track'};
 expect(generateTeamSlots(doc,teams,options)).toHaveLength(2);const racing=generateTeamSlots(doc,teams,{...options,kind:'racing',panel:null});expect(racing).toHaveLength(6);expect(racing[1].start).toBe('2027-06-01T05:07:00.000Z');expect(new Set(racing.map(a=>a.teamIds[0]))).toEqual(new Set(['a','b','c']));
});
