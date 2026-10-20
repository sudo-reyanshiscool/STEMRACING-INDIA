import {describe,expect,it} from 'vitest';
import {criterionAverage} from '../../supabase/functions/_shared/results-pdf';
import type {ResultsPacket,ReportArea} from '../../supabase/functions/_shared/results-packet';
const area:ReportArea={id:'verbal',name:'Verbal',max:20,criteria:[{id:'delivery',name:'Delivery',max:20}]};
const packet=(scores:Array<Record<string,number>>)=>({cards:scores.map(s=>({areaId:'verbal',scores:s,feedback:{overall:null,strengths:null,improvements:null}})),teamResult:{areas:{verbal:20}}}) as unknown as ResultsPacket;
describe('reported rubric marks',()=>{
 it('averages submitted criterion marks without replacing them with the published overridden area total',()=>{
  expect(criterionAverage(packet([{delivery:10},{delivery:11},{delivery:11}]),area,'delivery')).toBe(10.7);
 });
 it('preserves zero marks and distinguishes missing marks',()=>{
  expect(criterionAverage(packet([{delivery:0}]),area,'delivery')).toBe(0);
  expect(criterionAverage(packet([{}]),area,'delivery')).toBeNull();
 });
});
