import {createClient} from 'npm:@supabase/supabase-js@2.117.3';
import nodemailer from 'npm:nodemailer@6.9.16';
import {submissionHandler} from '../_shared/submission-handler.ts';
const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const options={auth:{persistSession:false,autoRefreshToken:false},db:{schema:'stem_racing'}};
const caller=(token:string)=>createClient(url,anon,{...options,global:{headers:{Authorization:`Bearer ${token}`}}});
const admin=createClient(url,service,options);
const host=Deno.env.get('SMTP_HOST'),user=Deno.env.get('SMTP_USER'),pass=Deno.env.get('SMTP_PASS'),from=Deno.env.get('SMTP_FROM');
const port=Number(Deno.env.get('SMTP_PORT')||587);
const transport=host?nodemailer.createTransport(host.includes('gmail')?{service:'gmail',auth:{user,pass}}:{host,port,secure:port===465,auth:{user,pass}}):null;
Deno.serve(submissionHandler({
 async authenticate(token){const {data,error}=await caller(token).auth.getUser(token);return !error&&!!data.user;},
 configured(){return !!(transport&&user&&pass&&from);},
 async reserve(token,eventId,teamId,kind,revision){const {data,error}=await caller(token).rpc('reserve_submission_email',{p_event:eventId,p_team:teamId,p_kind:kind,p_revision:revision});if(error)throw error;if(data.status!=='reserved')return data;const payload=await admin.rpc('submission_email_payload',{p_job:data.jobId,p_attempt:data.attempt});if(payload.error||!payload.data)throw Error('Receipt unavailable');return {...data,...payload.data};},
 async complete(id,attempt,status){const {data,error}=await admin.rpc('complete_submission_email',{p_job:id,p_attempt:attempt,p_status:status});if(error||data!==true)throw Error('Delivery reservation unavailable');},
 async send(email,subject,html){
  try{
   const result=await transport!.sendMail({from,to:email,subject,html});
   return result.rejected?.length?'failed':'sent';
  }catch(e){return Number((e as {responseCode?:number}).responseCode)>=400?'failed':'uncertain';}
 }
}));
