import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { invitationHandler } from '../_shared/invitation-handler.ts';

const url=Deno.env.get('SUPABASE_URL')!;
const anon=Deno.env.get('SUPABASE_ANON_KEY')!;
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const options={auth:{persistSession:false,autoRefreshToken:false,flowType:'implicit' as const}};
const caller=(token:string)=>createClient(url,anon,{...options,global:{headers:{Authorization:`Bearer ${token}`}},db:{schema:'stem_racing'}});
const admin=createClient(url,service,{...options,db:{schema:'stem_racing'}});

Deno.serve(invitationHandler({
  async authenticate(token){const {data,error}=await caller(token).auth.getUser(token);return !error&&!!data.user;},
  async reserve(token,id){const {data,error}=await caller(token).rpc('reserve_invitation_email',{p_invitation:id});if(error)throw error;return data;},
  async send(email,redirect){
    // A fresh anonymous auth client cannot replace the sender's session or PKCE verifier.
    // OTP handles both existing accounts and first-time confirmation through the project's configured SMTP.
    const client=createClient(url,anon,options);
    const {error}=await client.auth.signInWithOtp({email,options:{emailRedirectTo:redirect,shouldCreateUser:true}});
    return {ok:!error,rateLimited:error?.status===429};
  },
  async complete(id,attempt,status,failure){const {data,error}=await admin.rpc('complete_invitation_email',{p_invitation:id,p_attempt:attempt,p_status:status,p_failure:failure});if(error)throw error;if(data!==true)throw new Error('Delivery reservation expired');},
}));
