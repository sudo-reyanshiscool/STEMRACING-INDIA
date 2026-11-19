/* The big screen on another device: a second laptop, or a browser source in streaming software.
   screen.html loads this when its address carries the event's screen key. While no control page in this browser is
   feeding the screen, what is showing is read from the events platform about once a second. Team pictures are fetched
   once each and kept in this browser, so the screen comes straight back after a reload. Nothing is sent from here. */
(function(){
const S=window.SRI_SCREEN; if(!S)return;
let cfg=null, after=0, raw=null, fails=0, picVer=0, painting=0, running=0, queue=[];
const pics=new Map(), asked=new Set();   // picture reference -> its address in this browser ('' when there is no such picture)
const rpc=(name,args)=>fetch(cfg.url+'/rest/v1/rpc/'+name,{method:'POST',cache:'no-store',
    headers:{'Content-Type':'application/json','Content-Profile':cfg.schema,apikey:cfg.anonKey,Authorization:'Bearer '+cfg.anonKey},body:JSON.stringify(args)})
  .then(r=>r.json().then(j=>{if(!r.ok){const e=new Error((j&&j.message)||r.statusText); e.code=j&&j.code; throw e;} return j;}));

// the state as published, with each picture reference swapped for the picture once it is here
function paint(){if(!raw||S.local())return;
  const st=JSON.parse(JSON.stringify(raw,(k,v)=>typeof v==='string'&&v.startsWith('sri-pic:')?(pics.get(v)||undefined):v));
  st.tv=(raw.tv|0)*100000+picVer;   // the screens redraw their team pictures when this changes
  S.show(st);}

async function picture(ref){const part=ref.split(':'), name=location.origin+'/sri-pic/'+S.event+'/'+part.slice(1).join('/');
  let store=null, hit=null; try{store=await caches.open('sri-screen-pictures'); hit=await store.match(name);}catch(e){}
  if(hit)return URL.createObjectURL(await hit.blob());
  const f=await rpc('show_screen_picture',{p_event:S.event,p_key:S.key,p_team:part[1],p_asset:part[2]});
  let blob; try{blob=await (await fetch('data:'+f.mime+';base64,'+f.base64)).blob();}
  catch(e){blob=new Blob([Uint8Array.from(atob(f.base64),c=>c.charCodeAt(0))],{type:f.mime});}
  try{store&&await store.put(name,new Response(blob,{headers:{'Content-Type':f.mime}}));}catch(e){}
  return URL.createObjectURL(blob);}
async function work(){running++;
  for(let ref;(ref=queue.shift());){let url='';
    try{url=await picture(ref);}catch(e){if(!e.code)asked.delete(ref);}   // no connection: asked for again with the next change. Refused: the team has no such picture.
    pics.set(ref,url); if(url){picVer++; clearTimeout(painting); painting=setTimeout(paint,150);}}
  running--;}
function want(){const fresh=[...new Set(JSON.stringify(raw).match(/sri-pic:[\w:-]+/g)||[])].filter(r=>!asked.has(r)); fresh.forEach(r=>asked.add(r));
  // the pictures of the teams on screen now are fetched first
  const hot=new Set([raw.race&&raw.race.t1,raw.race&&raw.race.t2].concat(Object.values((raw.awards||{}).winners||{}))), first=JSON.stringify((raw.teams||[]).filter(t=>hot.has(t.id)));
  queue=queue.concat(fresh).sort((a,b)=>first.includes(b)-first.includes(a)); while(running<3&&running<queue.length)work();}

async function poll(){let wait=1000;
  if(!S.local())try{const got=await rpc('show_screen_state',{p_event:S.event,p_key:S.key,p_after:after}); fails=0;
    if(got){after=got.n; raw=got.state; want(); paint();}}
  catch(e){
    if(e.code==='42501'){const hint=document.getElementById('hint'); hint.textContent='This screen link is not valid. Copy it again from the Graphics tab of the event.'; hint.classList.remove('gone'); return;}
    wait=Math.min(5000,1000*++fails);}   // the last screen stays up while the connection is away
  setTimeout(poll,wait);}

// where the events platform keeps its records; the file is written when the platform is built
fetch('platform.json',{cache:'no-store'}).then(r=>r.json()).then(c=>{if(!c||!c.url||!c.anonKey)return; cfg=c; setTimeout(poll,1200);}).catch(()=>{});
})();
