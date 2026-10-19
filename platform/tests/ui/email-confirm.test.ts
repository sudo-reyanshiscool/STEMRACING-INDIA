// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ApiError, MemoryApi } from '../../src/api';
import { emailConfirmScreen } from '../../src/ui/email-confirm';
import { readEmailCallback, clearEmailCallback } from '../../src/ui/email-callback';
import { makeCtx, text } from './helpers';
const wait=()=>new Promise(r=>setTimeout(r,0));
const token='a'.repeat(64);
describe('email confirmation',()=>{
 it('does not consume the email token until the user confirms, then signs in once',async()=>{
  const api=new MemoryApi();let finish!:()=>void;const pending=new Promise<void>(r=>{finish=r});
  api.verifyEmailLink=vi.fn(()=>pending);const {ctx}=makeCtx(api);const done=vi.fn();
  const el=emailConfirmScreen(ctx,token,done,vi.fn());expect(api.verifyEmailLink).not.toHaveBeenCalled();expect(text(el)).not.toContain(token);
  const button=el.querySelector('button')!;button.click();button.click();await wait();expect(api.verifyEmailLink).toHaveBeenCalledTimes(1);expect(done).not.toHaveBeenCalled();
  finish();await wait();expect(done).toHaveBeenCalledTimes(1);
 });
 it('shows an expired-link explanation rather than silently returning to the sign-in form',async()=>{
  const api=new MemoryApi();api.verifyEmailLink=async()=>{throw new ApiError('invalid-auth','private auth response');};const {ctx}=makeCtx(api);
  const el=emailConfirmScreen(ctx,token,vi.fn(),vi.fn());el.querySelector('button')!.click();await wait();
  expect(text(el.querySelector('[role=alert]')!)).toContain('expired or was already used');expect(text(el)).not.toContain('private auth response');expect(el.querySelector('button')!.disabled).toBe(false);
 });
 it('offers an email-code route without verifying or sending anything',()=>{
  const api=new MemoryApi();api.verifyEmailLink=vi.fn();const {ctx}=makeCtx(api);const cancel=vi.fn();
  const el=emailConfirmScreen(ctx,token,vi.fn(),cancel);el.querySelectorAll('button')[1].click();expect(cancel).toHaveBeenCalledOnce();expect(api.verifyEmailLink).not.toHaveBeenCalled();
 });
});
describe('email callback parsing',()=>{
 it('accepts email confirmation tokens but rejects malformed tokens and other auth purposes',()=>{
  expect(readEmailCallback(`#token_hash=${token}&type=email`)).toEqual({kind:'confirm',tokenHash:token});
  for(const hash of ['#token_hash=&type=email',`#token_hash=${token}&type=recovery`,'#token_hash=<script>&type=email'])expect(readEmailCallback(hash)).toEqual({kind:'invalid'});
 });
 it('detects server errors without exposing raw descriptions or storing old bearer tokens',()=>{
  expect(readEmailCallback('#error=access_denied&error_code=otp_expired&error_description=private')).toEqual({kind:'invalid'});
  expect(readEmailCallback('#access_token=secret&refresh_token=other-secret')).toEqual({kind:'legacy'});
  expect(readEmailCallback('#/event/id/racing')).toBeNull();
 });
 it('scrubs the authentication fragment from browser history without changing unrelated URL options',()=>{
  history.replaceState(null,'','/?invite=1#token_hash='+token+'&type=email');clearEmailCallback();
  expect(location.hash).toBe('#/');expect(location.search).toBe('?invite=1');expect(location.href).not.toContain(token);
  history.replaceState(null,'','/');
 });
});
