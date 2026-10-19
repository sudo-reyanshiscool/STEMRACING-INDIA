export const INVITE_REDIRECT = 'https://stemracingindia-events.vercel.app/?invite=1';
export interface DeliveryDeps {
  authenticate(token: string): Promise<boolean>;
  reserve(token: string, invitationId: string): Promise<{status:string;email?:string;attempt?:string;retryAfter?:number}>;
  send(email: string, redirect: string): Promise<{ok:boolean;rateLimited?:boolean}>;
  complete(invitationId: string, attempt: string, status: 'sent'|'failed', failure: 'provider'|'rate_limit'|null): Promise<void>;
}
const origins = new Set(['https://stemracingindia-events.vercel.app','http://127.0.0.1:5174','http://localhost:5174','http://127.0.0.1:5173','http://localhost:5173']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** No recipient or role from the browser is trusted. The database supplies the authorised pending invitation. */
export function invitationHandler(deps: DeliveryDeps) {
  return async (request: Request): Promise<Response> => {
    const origin=request.headers.get('origin');
    const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
    if(origin && origins.has(origin)){
      headers['Access-Control-Allow-Origin']=origin;
      headers['Access-Control-Allow-Headers']='authorization, apikey, content-type, x-client-info';
      headers['Access-Control-Allow-Methods']='POST, OPTIONS';
    }
    const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
    if(origin&&!origins.has(origin))return reply(403,{code:'forbidden'});
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(request.method!=='POST')return reply(405,{code:'method_not_allowed'});
    const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if(!token)return reply(401,{code:'unauthenticated'});
    let body:unknown;
    try{const raw=await request.text();if(raw.length>2048)return reply(400,{code:'invalid'});body=JSON.parse(raw);}catch{return reply(400,{code:'invalid'});}
    const id=(body as {invitationId?:unknown}|null)?.invitationId;
    if(typeof id!=='string'||!uuid.test(id))return reply(400,{code:'invalid'});
    try{if(!await deps.authenticate(token))return reply(401,{code:'unauthenticated'});}catch{return reply(401,{code:'unauthenticated'});}
    let job:Awaited<ReturnType<DeliveryDeps['reserve']>>;
    try{job=await deps.reserve(token,id);}catch{return reply(403,{code:'forbidden'});}
    if(job.status==='cooldown')return reply(429,{code:'cooldown',retryAfter:job.retryAfter??60});
    if(job.status!=='reserved'||!job.email||!job.attempt)return reply(500,{code:'delivery_failed'});
    let result:{ok:boolean;rateLimited?:boolean};
    try{result=await deps.send(job.email,INVITE_REDIRECT);}catch{result={ok:false};}
    try{await deps.complete(id,job.attempt,result.ok?'sent':'failed',result.ok?null:result.rateLimited?'rate_limit':'provider');}
    catch{return reply(503,{code:'delivery_unconfirmed'});}
    return result.ok?reply(200,{status:'sent'}):reply(result.rateLimited?429:502,{code:result.rateLimited?'provider_rate_limit':'delivery_failed'});
  };
}
