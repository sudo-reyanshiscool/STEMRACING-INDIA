import { describe, expect, it, vi } from 'vitest';
import { invitationHandler, INVITE_REDIRECT, type DeliveryDeps } from '../../supabase/functions/_shared/invitation-handler';
const id='8a800000-0000-4000-8000-000000000001';
const make=()=>({authenticate:vi.fn(async()=>true),reserve:vi.fn(async()=>({status:'reserved',email:'verified@x.test',attempt:'ticket'})),send:vi.fn(async()=>({ok:true})),complete:vi.fn(async()=>{})});
const req=(body:unknown={invitationId:id},token=true,origin='https://stemracingindia-events.vercel.app')=>new Request('https://example.test/send-invitation',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(token?{Authorization:'Bearer caller-token'}:{})},body:JSON.stringify(body)});
describe('invitation mail handler',()=>{
 it('uses the authorised database recipient and fixed callback, ignoring browser email and role',async()=>{
  const deps=make();const response=await invitationHandler(deps)(req({invitationId:id,email:'attacker@x.test',role:'organiser'}));
  expect(response.status).toBe(200);expect(await response.json()).toEqual({status:'sent'});
  expect(deps.reserve).toHaveBeenCalledWith('caller-token',id);
  expect(deps.send).toHaveBeenCalledWith('verified@x.test',INVITE_REDIRECT);
  expect(deps.complete).toHaveBeenCalledWith(id,'ticket','sent',null);
 });
 it('does not reserve or send for missing or invalid sessions',async()=>{
  const deps=make();const run=invitationHandler(deps);
  expect((await run(req(undefined,false))).status).toBe(401);
  deps.authenticate.mockResolvedValue(false);
  expect((await run(req())).status).toBe(401);expect(deps.reserve).not.toHaveBeenCalled();expect(deps.send).not.toHaveBeenCalled();
 });
 it('does not send when database permission checks refuse the reservation',async()=>{
  const deps=make();deps.reserve.mockRejectedValue(new Error('private SQL details'));
  const response=await invitationHandler(deps)(req());expect(response.status).toBe(403);expect(await response.text()).not.toContain('SQL');expect(deps.send).not.toHaveBeenCalled();
 });
 it('rejects invalid IDs and foreign origins before accessing the database',async()=>{
  const deps=make();const run=invitationHandler(deps);
  expect((await run(req({invitationId:'anything'}))).status).toBe(400);
  expect((await run(req(undefined,true,'https://foreign.test'))).status).toBe(403);expect(deps.reserve).not.toHaveBeenCalled();
 });
 it('returns cooldown without making a second email request',async()=>{
  const deps:DeliveryDeps={...make(),reserve:async()=>({status:'cooldown',retryAfter:45})};
  const response=await invitationHandler(deps)(req());expect(response.status).toBe(429);expect(await response.json()).toEqual({code:'cooldown',retryAfter:45});expect(deps.send).not.toHaveBeenCalled();
 });
 it.each([false,true])('records provider failure and distinguishes sending limits: %s',async(rateLimited)=>{
  const deps:DeliveryDeps={...make(),send:vi.fn(async()=>({ok:false,rateLimited}))};
  const response=await invitationHandler(deps)(req());expect(response.status).toBe(rateLimited?429:502);
  expect(deps.complete).toHaveBeenCalledWith(id,'ticket','failed',rateLimited?'rate_limit':'provider');
 });
 it('does not claim success if delivery cannot be recorded',async()=>{
  const deps=make();deps.complete.mockRejectedValue(new Error('connection lost'));
  expect((await invitationHandler(deps)(req())).status).toBe(503);
 });
 it('supports browser preflight without performing authentication or sending',async()=>{
  const deps=make();const response=await invitationHandler(deps)(new Request('https://example.test',{method:'OPTIONS',headers:{Origin:'https://stemracingindia-events.vercel.app'}}));
  expect(response.status).toBe(204);expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://stemracingindia-events.vercel.app');expect(deps.send).not.toHaveBeenCalled();
 });
});
