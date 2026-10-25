export interface SubmissionReceipt {eventName:string;eventId:string;teamNumber:string;teamName:string;kind:string;filename:string;revision:number;uploadedAt:string;submittedAt:string;deadline:string|null;points:number}
type Reserved={status:'reserved';jobId:string;attempt:string;email:string;receipt:SubmissionReceipt}|{status:'already_sent'|'busy'};
export interface SubmissionEmailDeps {authenticate(token:string):Promise<boolean>;configured():boolean;reserve(token:string,event:string,team:string,kind:string,revision:number):Promise<Reserved>;complete(id:string,attempt:string,status:'sent'|'failed'|'uncertain'):Promise<void>;send(email:string,subject:string,html:string):Promise<'sent'|'failed'|'uncertain'>}
const origins=new Set(['https://stemracingindia-events.vercel.app','http://localhost:5174','http://127.0.0.1:5174','http://localhost:5173','http://127.0.0.1:5173']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const date=(s:string)=>new Date(s).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})+' IST';
const labels:Record<string,string>={design_portfolio:'Design & Engineering portfolio',enterprise_portfolio:'Enterprise portfolio',project_portfolio:'Project Management portfolio'};
export function submissionHandler(deps:SubmissionEmailDeps) {return async(request:Request):Promise<Response>=>{
 const origin=request.headers.get('origin');const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store',Vary:'Origin'};
 if(origin&&origins.has(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'});
 const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!origins.has(origin))return reply(403,{code:'forbidden'});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});if(request.method!=='POST')return reply(405,{code:'method_not_allowed'});
 const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];if(!token||!await deps.authenticate(token))return reply(401,{code:'unauthenticated'});
 let body:{eventId:string;teamId:string;kind:string;revision:number};
 try {const raw=await request.text();if(raw.length>1024)throw Error();body=JSON.parse(raw);if(!uuid.test(body.eventId)||!uuid.test(body.teamId)||!Object.hasOwn(labels,body.kind)||!Number.isInteger(body.revision)||body.revision<1||Object.keys(body).some(k=>!['eventId','teamId','kind','revision'].includes(k)))throw Error();}catch{return reply(400,{code:'invalid'});}
 if(!deps.configured())return reply(503,{code:'email_configuration'});
 let job:Reserved;try{job=await deps.reserve(token,body.eventId,body.teamId,body.kind,body.revision);}catch(e){return reply((e as {code?:string}).code==='42501'?403:409,{code:'unavailable'});}
 if(job.status==='already_sent')return reply(200,{status:'already_sent'});if(job.status==='busy')return reply(409,{code:'delivery_in_progress'});
 const j=job as Extract<Reserved,{status:'reserved'}>,r=j.receipt;
 const html=`<!doctype html><html><body style="background:#f5f1f7;font-family:Arial,sans-serif;color:#180d22"><div style="max-width:620px;margin:24px auto;background:white;padding:28px;border-radius:14px"><h2>STEM RACING INDIA</h2><h1 style="color:#960f77">Portfolio submitted successfully</h1><p>${escape(r.eventName)} · Team ${escape(r.teamNumber)} — ${escape(r.teamName)}</p><p><strong>${escape(labels[r.kind]??r.kind)}</strong><br>${escape(r.filename)} · version ${r.revision}</p><p>Upload received: ${date(r.uploadedAt)}<br>First submission: ${date(r.submittedAt)}<br>Deadline: ${r.deadline?date(r.deadline):'Not set'}<br>Late penalty: ${r.points} points</p><p>Your portfolio is saved. Replacement uploads keep your first submission receipt time.</p><p><a href="https://stemracingindia-events.vercel.app/#/event/${encodeURIComponent(r.eventId)}/submissions">View submissions</a></p></div></body></html>`;
 let outcome:'sent'|'failed'|'uncertain';try{outcome=await deps.send(j.email,`${r.eventName} - Team ${r.teamNumber} portfolio received`,html);}catch{outcome='uncertain';}
 try{await deps.complete(j.jobId,j.attempt,outcome);}catch{return reply(502,{code:'delivery_unconfirmed'});}
 return outcome==='sent'?reply(200,{status:'sent'}):reply(502,{code:outcome==='failed'?'delivery_failed':'delivery_unconfirmed'});
};}
