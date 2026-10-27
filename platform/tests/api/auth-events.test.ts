import {it,expect,vi,afterEach} from 'vitest';
import {createApiFromClient} from '../../src/api/supabase';
const session=(id='owner',aal='aal2',nonce='first',email='owner@example.test')=>({user:{id,email},access_token:`e30.${btoa(JSON.stringify({aal,nonce}))}.signature`});
afterEach(()=>vi.useRealTimers());
function setup(){let emit:(event:string,session:any)=>void=()=>{};const unsubscribe=vi.fn();const api=createApiFromClient({auth:{onAuthStateChange:(cb:any)=>{emit=cb;return {data:{subscription:{unsubscribe}}};}}} as any);const changed=vi.fn();const stop=api.onAuthChange(changed);return {emit,changed,stop,unsubscribe};}
it('keeps the current screen and selected file when focus or token refresh repeats the same account',()=>{
 vi.useFakeTimers();const w=setup();w.emit('INITIAL_SESSION',session());vi.runAllTimers();expect(w.changed).toHaveBeenCalledTimes(1);
 w.emit('SIGNED_IN',session());w.emit('TOKEN_REFRESHED',session('owner','aal2','new-token'));w.emit('SIGNED_IN',session());vi.runAllTimers();expect(w.changed).toHaveBeenCalledTimes(1);
});
it('still refreshes immediately on account, email and MFA assurance changes or sign-out',()=>{
 vi.useFakeTimers();const w=setup();
 w.emit('INITIAL_SESSION',session('owner','aal1'));w.emit('MFA_CHALLENGE_VERIFIED',session());w.emit('USER_UPDATED',session('owner','aal2','n','updated@example.test'));w.emit('SIGNED_OUT',null);w.emit('SIGNED_IN',session('manager'));
 vi.runAllTimers();expect(w.changed).toHaveBeenCalledTimes(5);expect(w.changed.mock.calls[3][0]).toBeNull();expect(w.changed.mock.calls[4][0].userId).toBe('manager');
});
it('does not deliver a queued auth event after its subscriber has left',()=>{
 vi.useFakeTimers();const w=setup();w.emit('INITIAL_SESSION',session());w.stop();vi.runAllTimers();expect(w.changed).not.toHaveBeenCalled();expect(w.unsubscribe).toHaveBeenCalledOnce();
});
