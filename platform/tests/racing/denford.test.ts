import { describe,it,expect } from 'vitest';
import { parseDenford,parseSeconds,validateRace,blankLane,outcome } from '../../src/racing';
const payload=(over:Record<string,unknown>={})=>({raceid:'12',racestatus:'LANE 1 WINS!',player1TriggerTime:'210',player2TriggerTime:'240',player1RaceTime:'1100',player2RaceTime:'1200',player1CombinedTime:'1310',player2CombinedTime:'1440',...over});
describe('Denford StartGate protocol',()=>{
 it('reads actual integer millisecond measurements',()=>{expect(parseDenford(payload())?.lane1).toEqual({status:'finished',totalMs:1310,reactionMs:210});});
 it.each([[99997,'false_start'],[99998,'dns'],[99999,'dnf']])('decodes sentinel %s without treating it as a measurement',(v,status)=>{expect(parseDenford(payload({player1TriggerTime:String(v)}))?.lane1).toEqual({status,totalMs:null,reactionMs:null});});
 it('identifies reaction-only mode without manufacturing a finish time',()=>{expect(parseDenford(payload({player1RaceTime:'0',player1CombinedTime:'0'}))?.lane1).toEqual({status:'reaction_only',totalMs:null,reactionMs:210});});
 it.each([{raceid:'0'},{racestatus:'RACE ABORTED'},{racestatus:'LIGHTS OUT!'},{player1TriggerTime:''},{player1RaceTime:'no'},{player1CombinedTime:'1311'},{player1TriggerTime:[]},{raceid:'<script>'}])('ignores idle, partial, aborted or inconsistent readings %j',(over)=>{expect(parseDenford(payload(over))).toBeNull();});
 it('accepts automatic starts with zero reaction',()=>{expect(parseDenford(payload({player1TriggerTime:'0',player1CombinedTime:'1100'}))?.lane1.status).toBe('finished');});
 it('parses exact three-place decimals and rejects silently rounded values',()=>{expect(parseSeconds('1.001')).toBe(1001);expect(parseSeconds('0.010')).toBe(10);for(const s of ['1.0005','-1','1e3','','1,2'])expect(parseSeconds(s)).toBeNull();});
 it('requires complete consistent measurements for a finished lane',()=>{const race={label:'Heat 1',phase:'reaction' as const,lane1:{...blankLane('a'),status:'finished' as const,totalMs:1200,reactionMs:1200},lane2:blankLane('b'),note:'',source:'manual' as const,sourceRunId:null};expect(validateRace(race)).toContain('Lane 1');expect(outcome(race)).toBe('Awaiting both lanes');});
});
