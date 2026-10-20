import {describe,expect,it,vi} from 'vitest';
import {resultsHandler,type ResultsDeps} from '../../supabase/functions/_shared/results-handler';
import {INDIA_2026} from '../../src/rulesets';
import type {ResultsPacket} from '../../src/api/result-mail';
const eventId='10000000-0000-4000-8000-000000000001',teamId='10000000-0000-4000-8000-000000000002',snapshotId='10000000-0000-4000-8000-000000000003',version='10000000-0000-4000-8000-000000000004';
const packet:ResultsPacket={eventName:'Nationals <test>',eventId,snapshotId,createdAt:'2026-10-20T00:00:00Z',ruleset:INDIA_2026,
 team:{id:teamId,number:'001',name:'SUPERCHARGED',school:'School'},teamResult:{teamId,number:'001',name:'SUPERCHARGED',rank:1,total:26,subtotal:26,penalties:0,areas:{'verbal-technique':26}},
 standings:[{teamId,number:'001',name:'SUPERCHARGED',rank:1,total:26},{teamId:'other',number:'002',name:'Other team',rank:2,total:20}],awards:[{title:'Overall Champion',teamNumber:'001',teamName:'SUPERCHARGED'}],
 cards:[{areaId:'verbal-technique',scores:{'team-contribution':12,'engagement-presentation-dynamics':14},feedback:{overall:'Team feedback',strengths:'Strength',improvements:'Improve'}}],penalties:[],inspections:[]};
const body={eventId,teamId,snapshotId,awardsVersion:version,email:'manager@school.org'};
const request=(data:unknown=body,origin='https://stemracingindia-events.vercel.app')=>new Request('https://example.com/functions/v1/send-results',{method:'POST',headers:{origin,authorization:'Bearer user','content-type':'application/json'},body:JSON.stringify(data)});
function setup(){
 const deps:ResultsDeps={authenticate:vi.fn(async()=>true),configured:()=>true,reserve:vi.fn(async()=>({status:'reserved' as const,jobId:'job',attempt:'attempt',email:'manager@school.org',packet})),complete:vi.fn(async()=>{}),send:vi.fn(async()=> 'sent' as const)};
 return {deps,handler:resultsHandler(deps)};
}
describe('results email endpoint',()=>{
 it('uses the server-selected recipient and sends standings, results and feedback as three real PDF attachments',async()=>{
  const {deps,handler}=setup();const response=await handler(request());expect(response.status).toBe(200);
  expect(deps.reserve).toHaveBeenCalledWith('user',eventId,teamId,{snapshotId,awardsVersion:version,email:'manager@school.org'});
  expect(deps.send).toHaveBeenCalledOnce();const call=vi.mocked(deps.send).mock.calls[0];
  expect(call[0]).toBe('manager@school.org');expect(call[2]).toContain('&lt;test&gt;');
  expect(call[3]).toHaveLength(3);for(const f of call[3])expect(new TextDecoder().decode(f.bytes.slice(0,5))).toBe('%PDF-');
  expect(call[3][1].filename).toContain('Team-001-SUPERCHARGED');expect(deps.complete).toHaveBeenCalledWith('job','attempt','sent',null);
 });
 it('rejects client-supplied attachments, recipients and unknown origins before sending',async()=>{
  for(const [data,origin] of [[{...body,to:'attacker@example.com'},undefined],[{...body,attachments:['unsafe']},undefined],[body,'https://evil.example']] as const){
   const {deps,handler}=setup();expect((await handler(request(data,origin))).status).toBeGreaterThanOrEqual(400);expect(deps.send).not.toHaveBeenCalled();
  }
 });
 it('refuses unauthenticated callers, missing sender configuration and refused database reservations',async()=>{
  const a=setup();vi.mocked(a.deps.authenticate).mockResolvedValue(false);expect((await a.handler(request())).status).toBe(401);expect(a.deps.reserve).not.toHaveBeenCalled();
  const b=setup();b.deps.configured=()=>false;expect((await b.handler(request())).status).toBe(503);expect(b.deps.send).not.toHaveBeenCalled();
  const c=setup();vi.mocked(c.deps.reserve).mockRejectedValue({code:'42501'});expect((await c.handler(request())).status).toBe(403);expect(c.deps.send).not.toHaveBeenCalled();
 });
 it('skips already sent deliveries and blocks concurrent sends',async()=>{
  const a=setup();vi.mocked(a.deps.reserve).mockResolvedValue({status:'already_sent'});expect(await (await a.handler(request())).json()).toEqual({status:'already_sent'});expect(a.deps.send).not.toHaveBeenCalled();
  const b=setup();vi.mocked(b.deps.reserve).mockResolvedValue({status:'busy'});expect((await b.handler(request())).status).toBe(409);expect(b.deps.send).not.toHaveBeenCalled();
 });
 it('records unconfirmed transport outcomes without claiming success or retrying',async()=>{
  const {deps,handler}=setup();vi.mocked(deps.send).mockRejectedValue(Error('connection closed'));
  expect((await handler(request())).status).toBe(502);expect(deps.send).toHaveBeenCalledOnce();expect(deps.complete).toHaveBeenCalledWith('job','attempt','uncertain','unconfirmed');
 });
 it('does not claim success if the provider accepted email but delivery tracking failed',async()=>{
  const {deps,handler}=setup();vi.mocked(deps.complete).mockRejectedValue(Error('network'));
  expect(await (await handler(request())).json()).toEqual({code:'delivery_unconfirmed'});expect(deps.send).toHaveBeenCalledOnce();
 });
});
