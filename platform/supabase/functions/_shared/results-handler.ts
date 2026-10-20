import type {ResultsPacket} from './results-packet.ts';
import {resultPdfFiles} from './results-pdf.ts';
import {RESULTS_LOGO} from './results-logo.ts';
type Reserved={status:'reserved';jobId:string;attempt:string;email:string;packet:ResultsPacket}|{status:'already_sent'|'busy'};
export interface ResultsDeps {
 authenticate(token:string):Promise<boolean>;
 configured():boolean;
 reserve(token:string,eventId:string,teamId:string,selection:{snapshotId:string;awardsVersion:string;email:string}):Promise<Reserved>;
 complete(id:string,attempt:string,status:'sent'|'failed'|'uncertain',failure:string|null):Promise<void>;
 send(email:string,subject:string,html:string,files:Array<{filename:string;bytes:Uint8Array}>):Promise<'sent'|'failed'|'uncertain'>;
}
const origins=new Set(['https://stemracingindia-events.vercel.app','http://localhost:5174','http://127.0.0.1:5174','http://localhost:5173','http://127.0.0.1:5173']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function resultsHandler(deps:ResultsDeps) {
 return async(request:Request):Promise<Response>=>{
  const origin=request.headers.get('origin');const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store',Vary:'Origin'};
  if(origin&&origins.has(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'});
  const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
  if(origin&&!origins.has(origin))return reply(403,{code:'forbidden'});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply(405,{code:'method_not_allowed'});
  const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];if(!token)return reply(401,{code:'unauthenticated'});
  let body:{eventId:string;teamId:string;snapshotId:string;awardsVersion:string;email:string};
  try{const raw=await request.text();if(raw.length>2048)throw Error();body=JSON.parse(raw);if(!uuid.test(body.eventId)||!uuid.test(body.teamId)||!uuid.test(body.snapshotId)||!uuid.test(body.awardsVersion)||typeof body.email!=='string'||body.email.length>254||Object.keys(body).some(k=>!['eventId','teamId','snapshotId','awardsVersion','email'].includes(k)))throw Error();}catch{return reply(400,{code:'invalid'});}
  if(!await deps.authenticate(token))return reply(401,{code:'unauthenticated'});
  if(!deps.configured())return reply(503,{code:'email_configuration'});
  let job:Reserved;
  try{job=await deps.reserve(token,body.eventId,body.teamId,{snapshotId:body.snapshotId,awardsVersion:body.awardsVersion,email:body.email});}catch(e){const code=(e as {code?:string}).code;return reply(code==='42501'?403:409,{code:code==='42501'?'forbidden':'not_ready'});}
  if(job.status==='already_sent')return reply(200,{status:'already_sent'});
  if(job.status==='busy')return reply(409,{code:'delivery_in_progress'});
  const reserved=job as Extract<Reserved,{status:'reserved'}>;
  let files:ReturnType<typeof resultPdfFiles>;
  try{files=resultPdfFiles(reserved.packet,RESULTS_LOGO);}catch{
   try{await deps.complete(reserved.jobId,reserved.attempt,'failed','generation');}catch{ /* An expired reservation remains unconfirmed; never blindly resend. */ }
   return reply(500,{code:'pdf_generation'});
  }
  const packet=reserved.packet;
  const html=`<!doctype html><html><body style="margin:0;background:#f5f1f7;font-family:Arial,sans-serif;color:#180d22"><div style="max-width:620px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden"><div style="padding:24px;background:#140c1e;color:#fff;font-weight:bold">STEM RACING INDIA</div><div style="padding:28px"><h1 style="font-size:25px;color:#960f77">Your final results</h1><p>${escape(packet.eventName)}</p><p>Team ${escape(packet.team.number)} - ${escape(packet.team.name)}</p><p>Your attachments contain the final standings and confirmed awards, plus your team's detailed results and separate feedback sheets.</p><p><a style="color:#b60068" href="https://stemracingindia-events.vercel.app/#/event/${packet.eventId}/results">View results on the events platform</a></p></div></div></body></html>`;
  let outcome:'sent'|'failed'|'uncertain';
  try{outcome=await deps.send(reserved.email,`${packet.eventName} - Team ${packet.team.number} final results`,html,files);}catch{outcome='uncertain';}
  try{await deps.complete(reserved.jobId,reserved.attempt,outcome,outcome==='sent'?null:outcome==='failed'?'provider':'unconfirmed');}catch{return reply(502,{code:'delivery_unconfirmed'});}
  return outcome==='sent'?reply(200,{status:'sent'}):reply(502,{code:outcome==='uncertain'?'delivery_unconfirmed':'delivery_failed'});
 };
}
