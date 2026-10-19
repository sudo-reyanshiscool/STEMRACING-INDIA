import {createClient} from 'npm:@supabase/supabase-js@2.117.3';
import {Buffer} from 'node:buffer';
import nodemailer from 'npm:nodemailer@6.9.16';
import {resultsHandler} from '../_shared/results-handler.ts';
const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const options={auth:{persistSession:false,autoRefreshToken:false},db:{schema:'stem_racing'}};
const caller=(token:string)=>createClient(url,anon,{...options,global:{headers:{Authorization:`Bearer ${token}`}}});
const admin=createClient(url,service,options);
const host=Deno.env.get('SMTP_HOST'),user=Deno.env.get('SMTP_USER'),pass=Deno.env.get('SMTP_PASS'),from=Deno.env.get('SMTP_FROM');
const port=Number(Deno.env.get('SMTP_PORT')||587);
const transport=host?nodemailer.createTransport(host.includes('gmail')?{service:'gmail',auth:{user,pass}}:{host,port,secure:port===465,auth:{user,pass}}):null;
Deno.serve(resultsHandler({
 async authenticate(token){const {data,error}=await caller(token).auth.getUser(token);return !error&&!!data.user;},
 configured(){return !!(transport&&user&&pass&&from);},
 async reserve(token,eventId,teamId,selection){const {data,error}=await caller(token).rpc('reserve_team_results_email',{p_event:eventId,p_team:teamId,p_snapshot:selection.snapshotId,p_awards_version:selection.awardsVersion,p_email:selection.email});if(error)throw error;return data;},
 async complete(id,attempt,status,failure){const {data,error}=await admin.rpc('complete_team_results_email',{p_job:id,p_attempt:attempt,p_status:status,p_failure:failure});if(error||data!==true)throw Error('Delivery reservation unavailable');},
 async send(email,subject,html,files){
  try{
   const result=await transport!.sendMail({from,to:email,subject,html,attachments:files.map(f=>({filename:f.filename,content:Buffer.from(f.bytes),contentType:'application/pdf'}))});
   return result.rejected?.length?'failed':'sent';
  }catch(e){return Number((e as {responseCode?:number}).responseCode)>=400?'failed':'uncertain';}
 }
}));
