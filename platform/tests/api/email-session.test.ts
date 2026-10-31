// @vitest-environment jsdom
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it } from 'vitest';
import { createApiFromClient } from '../../src/api/supabase';

// Real auth SDK and storage, synthetic transport: no real account, mail or credentials are used.
const user = { id:'00000000-0000-4000-8000-000000000001', email:'school@example.test', aud:'authenticated', role:'authenticated', app_metadata:{provider:'email',providers:['email']}, user_metadata:{}, created_at:'2026-01-01T00:00:00Z', email_confirmed_at:'2026-01-01T00:00:00Z' };
const jwt = () => {
  const encode=(x:unknown)=>btoa(JSON.stringify(x)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
  return `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:user.id,email:user.email,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)})}.synthetic-signature`;
};
const clients:SupabaseClient<any, any, any>[]=[];
afterEach(async()=>{ for(const c of clients.splice(0))await c.auth.stopAutoRefresh();localStorage.clear();history.replaceState(null,'','/'); });
const make = (storageKey:string, storage:Storage=localStorage) => {
  const requests:{path:string;body:Record<string,unknown>|null}[]=[];
  const fetcher:typeof fetch=async(input,init)=>{
    const url=new URL(String(input));const body=init?.body?JSON.parse(String(init.body)):null;requests.push({path:url.pathname,body});
    if(url.pathname.endsWith('/verify')||(url.pathname.endsWith('/token')&&url.searchParams.get('grant_type')==='password'))return new Response(JSON.stringify({access_token:jwt(),refresh_token:'synthetic-refresh-token',expires_in:3600,token_type:'bearer',user}),{status:200,headers:{'Content-Type':'application/json'}});
    if(url.pathname.endsWith('/user'))return new Response(JSON.stringify(user),{status:200,headers:{'Content-Type':'application/json'}});
    throw new Error(`Unexpected fixture request: ${url.pathname}`);
  };
  const client=createClient('https://auth-fixture.example.test','synthetic-public-key',{auth:{persistSession:true,autoRefreshToken:false,detectSessionInUrl:true,flowType:'implicit',storage,storageKey},global:{fetch:fetcher}});
  clients.push(client);return {client,api:createApiFromClient(client),requests};
};
describe('email sign-in session lifecycle',()=>{
 it('persists verified code sessions and restores them on a fresh app load',async()=>{
  const first=make('code-session');expect(await first.api.getSession()).toBeNull();await first.api.verifyEmailCode(user.email,'12345678');
  expect(await first.api.getSession()).toEqual({userId:user.id,email:user.email});
  const saved=localStorage.getItem('code-session');expect(saved).not.toBeNull();
  // A separate browser-load storage key avoids two simultaneous SDK clients sharing a broadcast channel.
  localStorage.setItem('restored-session',saved!);const fresh=make('restored-session');
  expect(await fresh.api.getSession()).toEqual({userId:user.id,email:user.email});expect(fresh.requests).toHaveLength(0);
 });
 it('creates a persistent session directly in the browser that confirms the email link',async()=>{
  const {api,requests}=make('link-session');expect(await api.getSession()).toBeNull();expect(requests).toHaveLength(0);
  await api.verifyEmailLink('a'.repeat(64));expect(requests[0]).toMatchObject({path:'/auth/v1/verify',body:{token_hash:'a'.repeat(64),type:'email'}});
  expect(await api.getSession()).toEqual({userId:user.id,email:user.email});expect(localStorage.getItem('link-session')).not.toBeNull();
 });
 it('continues to accept older implicit email links before cleaning their fragment',async()=>{
  history.replaceState(null,'','/#access_token='+jwt()+'&refresh_token=synthetic-refresh-token&expires_in=3600&token_type=bearer&type=magiclink');
  const {api}=make('legacy-session');expect(await api.getSession()).toEqual({userId:user.id,email:user.email});expect(location.hash).toBe('');
 });
});

it('uses password authentication and persists the session without requesting an email',async()=>{
 const {api,requests}=make('password-session');
 await api.signInWithPassword(' School@Example.test ','synthetic-only-password');
 expect(await api.getSession()).toEqual({userId:user.id,email:user.email});
 expect(requests).toHaveLength(1);
 expect(requests[0]).toMatchObject({path:'/auth/v1/token',body:{email:'school@example.test',password:'synthetic-only-password'}});
 expect(localStorage.getItem('password-session')).not.toBeNull();
});
it('refuses email delivery to reserved non-deliverable addresses without making any request',async()=>{
 const {api,requests}=make('invalid-email-delivery');
 await expect(api.signIn('private@accounts.invalid')).rejects.toThrow();
 expect(requests).toHaveLength(0);
});
