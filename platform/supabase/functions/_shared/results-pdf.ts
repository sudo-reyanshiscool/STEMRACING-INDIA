import {jsPDF} from 'jspdf';
import {autoTable,type CellInput,type UserOptions} from 'jspdf-autotable';
import type {Benchmark,ReportArea,ResultsPacket} from './results-packet.ts';
import {INDIA_TECHNICAL} from './technical/rules.ts';
import {summarise} from './technical/summarise.ts';
import {describeLimit} from './technical/describe.ts';

const ink:[number,number,number]=[18,13,24],blue:[number,number,number]=[0,160,212],pink:[number,number,number]=[211,0,116],green:[number,number,number]=[0,136,74];
const grey:[number,number,number]=[222,228,235];
const bandNames=['Low','Medium low','Medium high','High'];
const bandColors:Array<[number,number,number]>=[[255,226,124],[255,195,141],[255,166,163],[248,126,145]];
const text=(value:unknown)=>String(value??'').normalize('NFKC').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\u2026/g,'...').replace(/[\u2010-\u2015]/g,'-').replace(/[^\x20-\x7e\n\r\xA0-\xFF]/g,'?');
const safe=(value:string)=>value.replace(/[^A-Za-z0-9_-]+/g,'-').slice(0,65)||'results';
const points=(value:unknown)=>typeof value==='number'?value.toFixed(1).replace(/\.0$/,''):String(value??'-');
const round=(n:number)=>Math.round((n+Number.EPSILON)*10+1e-9)/10;
const start=(doc:jsPDF)=>(doc as jsPDF & {reportStartY:number}).reportStartY;
const preview=(p:ResultsPacket)=>!p.released||!p.awardsConfirmed;

function document(title:string,p:ResultsPacket,logo?:string,cover=false) {
 const doc=new jsPDF({unit:'mm',format:'a4',compress:true});
 doc.setProperties({title:`${p.eventName} - ${title}`,author:'STEM Racing India',subject:'Competition results and team feedback'});
 if(cover){
  doc.setFillColor(...ink);doc.rect(0,0,210,41,'F');
  for(let i=0;i<100;i++){doc.setFillColor(211,Math.round(i*.7),116-Math.round(i*.7));doc.rect(i*2.1,39,2.2,2,'F');}
  if(logo)doc.addImage(logo,'PNG',78,5,55,25,undefined,'FAST');
  doc.setFont('helvetica','bold');doc.setFontSize(19);doc.setTextColor(...ink);doc.text(title,13,52);
  let y=59;
  if(title==='Final standings & awards'){y=paragraphs(doc,y,'Event',p.eventName);if(preview(p)){doc.setTextColor(...pink);doc.text('PREVIEW - results or awards have not been finalised.',13,y);y+=5;}}
  else y=identity(doc,p,13,59,184);
  (doc as jsPDF & {reportStartY:number}).reportStartY=y+6;
 }else{
  if(logo){doc.setFillColor(...ink);doc.rect(158,7,39,20,'F');doc.addImage(logo,'PNG',160,9,35,16,undefined,'FAST');}
  doc.setTextColor(...ink);doc.setFont('helvetica','bold');doc.setFontSize(16);
  const lines=doc.splitTextToSize(text(title),139) as string[];doc.text(lines,13,16);
  const y=identity(doc,p,13,Math.max(29,16+lines.length*6),184);
  (doc as jsPDF & {reportStartY:number}).reportStartY=y+5;
 }
 return doc;
}
function identity(doc:jsPDF,p:ResultsPacket,x:number,y:number,width:number){
 doc.setTextColor(...ink);doc.setFont('helvetica','normal');doc.setFontSize(8);
 const content=[`Event: ${p.eventName}`,`Team number: ${p.team.number}     Team name: ${p.team.name}`,`School / club: ${p.team.school||'Not provided'}`];
 for(const line of content){const lines=doc.splitTextToSize(text(line),width) as string[];doc.text(lines,x,y);y+=lines.length*3.8;}
 if(preview(p)){doc.setFont('helvetica','bold');doc.setTextColor(...pink);doc.text('PREVIEW - results or awards have not been finalised.',x,y+1);y+=5;}
 return y;
}
function table(doc:jsPDF,y:number,head:CellInput[],body:CellInput[][],options:Partial<UserOptions>={}) {
 autoTable(doc,{startY:y,margin:{left:13,right:13,top:17,bottom:19},head:head.length?[head]:undefined,body,
  theme:'grid',styles:{font:'helvetica',fontSize:8,cellPadding:1.5,textColor:ink,lineColor:[120,120,125],lineWidth:.15,overflow:'linebreak'},
  headStyles:{fillColor:ink,textColor:[255,255,255],fontStyle:'bold'},rowPageBreak:'avoid',...options});
 return (doc as jsPDF & {lastAutoTable:{finalY:number}}).lastAutoTable.finalY+5;
}
const bandRow=(label:string,cols:number,color:typeof blue=blue):CellInput[]=>[{content:text(label),colSpan:cols,styles:{fillColor:color,textColor:color===grey?ink:[255,255,255],fontStyle:'bold',halign:'left'}}];
function heading(doc:jsPDF,y:number,title:string) {
 doc.setFont('helvetica','bold');doc.setFontSize(12);doc.setTextColor(...ink);
 const lines=doc.splitTextToSize(text(title),184) as string[];
 if(y+lines.length*5>267){doc.addPage();y=22;}
 doc.text(lines,13,y);return y+lines.length*5+2;
}
function paragraphs(doc:jsPDF,y:number,label:string,value:string|null|undefined) {
 if(!value?.trim())return y;
 doc.setFont('helvetica','normal');doc.setFontSize(8.5);doc.setTextColor(...ink);
 const lines=doc.splitTextToSize(text(`${label}${label?': ':''}${value}`),181) as string[];
 for(const line of lines){if(y>271){doc.addPage();y=22;}doc.text(line,13,y);y+=4;}
 return y+3;
}
function footers(doc:jsPDF,p:ResultsPacket,kind:string,privateTeam=false){
 const total=doc.getNumberOfPages();
 for(let page=1;page<=total;page++){
  doc.setPage(page);doc.setDrawColor(175,175,180);doc.line(13,280,197,280);
  doc.setTextColor(90,85,95);doc.setFont('helvetica','normal');doc.setFontSize(7);
  doc.text(text(privateTeam?`Private team report - ${p.team.number} ${p.team.name}`:`STEM Racing India - ${kind}`),13,285);
  doc.text(`${page} / ${total}`,197,285,{align:'right'});
  doc.setFontSize(6);doc.text(`Snapshot ${text(p.createdAt.slice(0,16).replace('T',' '))} UTC${preview(p)?' - PREVIEW':''}`,13,289);
  if(page>1){doc.setFontSize(7);doc.setTextColor(...pink);doc.text(text(`${p.eventName} | ${privateTeam?`Team ${p.team.number} | `:''}${kind}`),13,10);}
 }
}
export function buildStandingsPdf(p:ResultsPacket,logo?:string):jsPDF {
 const doc=document('Final standings & awards',p,logo,true);
 let y=table(doc,start(doc),['Rank','Team','Total points'],p.standings.map(r=>[String(r.rank),text(`${r.number} - ${r.name}`),points(r.total)]),{columnStyles:{0:{cellWidth:18},2:{cellWidth:30,halign:'right'}}});
 y=heading(doc,y,'Confirmed overall awards');
 if(p.awards.length)table(doc,y,['Award','Winning team'],p.awards.map(a=>[text(a.title),text(`${a.teamNumber} - ${a.teamName}`)]));
 else paragraphs(doc,y+3,'Awards','No overall awards were selected for this event.');
 footers(doc,p,'Final standings & awards');return doc;
}
function comparison(b?:Benchmark):string[]{return b?[points(b.low),points(b.median),points(b.high)]:['-','-','-'];}
function summary(doc:jsPDF,p:ResultsPacket){
 let y=paragraphs(doc,start(doc),'','Congratulations on competing. This report provides your published points, final position, specification checks, judging scorecards and recorded race results.');
 y=paragraphs(doc,y,'','Low, median and high compare published scores across the event. Rubric marks show the mean of submitted scorecards; published area totals may include authorised score overrides.');
 const body:CellInput[][]=[];
 const categories=p.ruleset.categories??[{id:'all',name:'Judging categories'}];
 for(const category of categories){
  const areas=p.ruleset.areas.filter(a=>!a.categoryId||a.categoryId===category.id);if(!areas.length)continue;
  body.push(bandRow(category.name,5));
  for(const a of areas)body.push([text(a.name),...comparison(p.benchmarks?.[a.id]),{content:`${points(p.teamResult.areas[a.id])} / ${a.max}`,styles:{fontStyle:'bold',textColor:green,halign:'right'}}]);
 }
 body.push([{content:'Event penalties',colSpan:4},points(p.teamResult.penalties)]);
 body.push([{content:'Grand total',styles:{fontStyle:'bold'}},...comparison(p.benchmarks?.__total),{content:`${points(p.teamResult.total)} / ${p.ruleset.areas.reduce((s,a)=>s+a.max,0)}`,styles:{fontStyle:'bold',textColor:green,halign:'right'}}]);
 body.push([{content:'Final position',colSpan:4,styles:{fontStyle:'bold'}},{content:`${p.teamResult.rank} of ${p.standings.length} teams`,styles:{fontStyle:'bold',textColor:green,halign:'right'}}]);
 table(doc,y,['Judging category','Low','Median','High','Your score'],body,{styles:{fontSize:7.3,cellPadding:1.1,lineColor:[140,140,145],lineWidth:.15},columnStyles:{0:{cellWidth:94},1:{cellWidth:18,halign:'center'},2:{cellWidth:18,halign:'center'},3:{cellWidth:18,halign:'center'},4:{cellWidth:36,halign:'right'}}});
}
function specPages(doc:jsPDF,p:ResultsPacket){
 doc.addPage();let y=heading(doc,23,'Specification results');
 y=paragraphs(doc,y,'Published specifications score',`${points(p.teamResult.areas.specifications)} / ${p.ruleset.areas.find(a=>a.id==='specifications')?.max??100}`);
 const cars=['A','B'].map(car=>{const i=p.inspections.find(i=>i.car===car);return {car,inspection:i,summary:i?.rulesetId===INDIA_TECHNICAL.id?summarise(INDIA_TECHNICAL.rules,i.measurements):null};});
 const body:CellInput[][]=[];
 for(const [cls,label] of [['GEN','General'],['SAF','Safety'],['PERF','Performance']]){
  body.push([label,...cars.map(c=>!c.inspection?'No submitted inspection.':!c.summary?'Evaluation unavailable for this technical ruleset.':c.summary.results.filter(r=>r.status==='fail'&&r.cls===cls).map(r=>text(`${r.article} - ${r.name}\n${r.detail.join('; ')}\nDeduction: ${r.penalty} pts`)).join('\n\n')||'No recorded infringements.')]);
 }
 body.push(['Total deductions',...cars.map(c=>c.summary?`${c.summary.total} pts`:'-')]);
 body.push(['Performance infringements',...cars.map(c=>c.summary?String(c.summary.perfFailures.length):'-')]);
 y=table(doc,y,['Regulation class','Car A','Car B'],body,{headStyles:{fillColor:blue,textColor:[255,255,255]},columnStyles:{0:{cellWidth:36},1:{cellWidth:74},2:{cellWidth:74}}});
 y=paragraphs(doc,y,'','Deductions use the technical ruleset recorded for each car. Performance counts show failed regulation checks, not a newly calculated racing penalty. The published score in the summary remains authoritative.');
 if(p.penalties.length){y=heading(doc,y,'Other recorded event penalties');table(doc,y,['Points','Reason'],p.penalties.map(x=>[points(x.points),text(x.reason)]),{columnStyles:{0:{cellWidth:24}}});}
}
interface Group {title:string;areas:ReportArea[]}
function groups(p:ResultsPacket):Group[]{
 const result:Group[]=[];
 for(const a of p.ruleset.areas.filter(a=>a.criteria.length)){
  const key=a.id==='pit-display'||a.id==='team-identity'?'Pit Display & Team Identity':p.ruleset.categories?.find(c=>c.id===a.categoryId)?.name??a.name;
  let g=result.find(g=>g.title===key);if(!g){g={title:key,areas:[]};result.push(g);}g.areas.push(a);
 }
 return result;
}
export function criterionAverage(p:ResultsPacket,area:ReportArea,criterionId:string):number|null{
 const values=p.cards.filter(c=>c.areaId===area.id).map(c=>c.scores[criterionId]).filter((v):v is number=>typeof v==='number');
 return values.length?round(values.reduce((s,v)=>s+v,0)/values.length):null;
}
function scorecardPage(doc:jsPDF,p:ResultsPacket,g:Group){
 doc.addPage();let y=heading(doc,23,`${g.title} scorecard`);
 const body:CellInput[][]=[];
 for(const a of g.areas){
  body.push(bandRow(a.name,6));
  for(const c of a.criteria){
   const avg=criterionAverage(p,a,c.id);
   const ranges=c.bands?.length===4?c.bands:[{min:0,max:Math.floor(c.max*.25)},{min:Math.floor(c.max*.25)+1,max:Math.floor(c.max*.5)},{min:Math.floor(c.max*.5)+1,max:Math.floor(c.max*.75)},{min:Math.floor(c.max*.75)+1,max:c.max}];
   body.push([{content:text(c.name),styles:{fontStyle:'bold'}},...ranges.map((b,i)=>({content:text(`${b.description??'Rubric guidance not recorded.'}\n\n${bandNames[i]}: ${b.min}-${b.max}`),styles:{fillColor:avg!==null&&avg<=b.max&&(i===0||avg>ranges[i-1].max)?[231,246,236] as [number,number,number]:[255,255,255] as [number,number,number]}})),{content:`${points(avg)}\n/ ${c.max}`,styles:{textColor:green,fontStyle:'bold',halign:'center'}}]);
  }
  body.push([{content:`${a.name} - published total`,colSpan:5,styles:{fontStyle:'bold',halign:'right'}},{content:`${points(p.teamResult.areas[a.id])} / ${a.max}`,styles:{fontStyle:'bold',textColor:green,halign:'center'}}]);
 }
 y=table(doc,y,['Criterion',...bandNames,'Score'],body,{styles:{font:'helvetica',fontSize:6,cellPadding:1.05,lineColor:[110,110,115],lineWidth:.15,overflow:'linebreak'},headStyles:{fontSize:6.8,fillColor:ink,textColor:[255,255,255]},columnStyles:{0:{cellWidth:29},1:{cellWidth:35},2:{cellWidth:35},3:{cellWidth:35},4:{cellWidth:35},5:{cellWidth:15}}});
 const multi=g.areas.filter(a=>p.cards.filter(c=>c.areaId===a.id).length>1);
 for(const a of multi){
  y=heading(doc,y,`${a.name} - individual submitted scorecards`);
  const cards=p.cards.filter(c=>c.areaId===a.id);
  y=table(doc,y,['Criterion',...cards.map((_,i)=>`Card ${i+1}`)], [...a.criteria.map(c=>[text(c.name),...cards.map(card=>`${points(card.scores[c.id])} / ${c.max}`)]),['Raw total',...cards.map(card=>`${points(Object.values(card.scores).reduce((s,v)=>s+v,0))} / ${a.max}`)]]);
 }
}
function racePage(doc:jsPDF,p:ResultsPacket){
 doc.addPage();let y=heading(doc,23,'Racing summary');
 const races=p.races??[];
 if(!races.length){paragraphs(doc,y,'','No completed or attempted race runs were recorded for this team.');return;}
 const sec=(n:number|null)=>n===null?'-':(n/1000).toFixed(3);
 y=table(doc,y,['Heat / phase','Car','Lane','Reaction (s)','Track (s)','Total (s)','Status'],races.map(r=>[text(`${r.number} - ${r.label}\n${r.phase}`),r.car,String(r.lane),sec(r.reactionMs),sec(r.totalMs!==null&&r.reactionMs!==null?r.totalMs-r.reactionMs:null),sec(r.totalMs),text(r.status.replace(/_/g,' '))]),{headStyles:{fillColor:blue,textColor:[255,255,255]},styles:{fontSize:7.5,cellPadding:1.8,lineColor:[150,150,150],lineWidth:.15},columnStyles:{0:{cellWidth:52}}});
 const finished=races.filter(r=>r.status==='finished'&&r.totalMs!==null&&r.reactionMs!==null);
 y=heading(doc,y,'Recorded timing highlights');
 y=paragraphs(doc,y,'Best total time',finished.length?`${sec(Math.min(...finished.map(r=>r.totalMs!)))} seconds`:'No finished run');
 y=paragraphs(doc,y,'Best track time',finished.length?`${sec(Math.min(...finished.map(r=>r.totalMs!-r.reactionMs!)))} seconds`:'No finished run');
 y=paragraphs(doc,y,'False starts',String(races.filter(r=>r.status==='false_start').length));
 for(const a of p.ruleset.areas.filter(a=>a.categoryId==='racing'))y=paragraphs(doc,y,a.name,`${points(p.teamResult.areas[a.id])} / ${a.max} published points`);
 paragraphs(doc,y,'','Track time = total time minus reaction time. Race points are taken from the published ranking; timing highlights do not recalculate awards or knockout positions.');
}
function measurements(doc:jsPDF,p:ResultsPacket){
 for(const i of p.inspections){
  doc.addPage();const y=heading(doc,23,`Recorded measurements - Car ${i.car}`);
  const known=i.rulesetId===INDIA_TECHNICAL.id;
  table(doc,y,['Regulation / check','Recorded value','Limits / check'],Object.entries(i.measurements).map(([article,v])=>{
   const rule=known?INDIA_TECHNICAL.rules.find(r=>r.article===article):undefined;
   const format=(v:unknown):string=>v==null?'Not recorded':typeof v==='boolean'?(v?'Pass':'Fail'):typeof v==='number'?String(v):Object.entries(v as object).map(([k,n])=>`${k}: ${format(n)}`).join('; ');
   return [text(`${article}${rule?` - ${rule.name}`:''}`),text(format(v)),rule?text(describeLimit(rule)):'Ruleset guidance unavailable'];
  }),{headStyles:{fillColor:blue,textColor:[255,255,255]},styles:{fontSize:7.2,cellPadding:1.5,lineColor:[145,145,150],lineWidth:.15},columnStyles:{0:{cellWidth:69},1:{cellWidth:61},2:{cellWidth:54}}});
 }
}
export function buildTeamScorecardsPdf(p:ResultsPacket,logo?:string):jsPDF {
 const doc=document('Team results',p,logo,true);summary(doc,p);specPages(doc,p);
 for(const g of groups(p))scorecardPage(doc,p,g);
 racePage(doc,p);measurements(doc,p);footers(doc,p,'Team results',true);return doc;
}
export function buildTeamFeedbackPdf(p:ResultsPacket,logo?:string):jsPDF{
 const all=groups(p),doc=document(`${all[0]?.title??'Team'} feedback sheet`,p,logo);
 for(const [index,g] of all.entries()){
  let y=start(doc);
  if(index){doc.addPage();y=heading(doc,23,`${g.title} feedback sheet`);y=identity(doc,p,13,y+1,184)+5;}
  const body:CellInput[][]=[];
  for(const a of g.areas){
   body.push(bandRow(a.name,6,grey));
   for(const c of a.criteria){
    const avg=criterionAverage(p,a,c.id),bands=c.bands??[];
    const selected=avg===null?-1:bands.findIndex(b=>avg<=b.max);
    body.push([{content:text(c.name),styles:{fontStyle:'bold'}},...bandNames.map((label,i)=>({content:`${label}${i===selected?'\n*':''}`,styles:{fillColor:bandColors[i],fontStyle:i===selected?'bold' as const:'normal' as const,halign:'center' as const}})),text(selected<0?'No submitted criterion score.':`${points(avg)} / ${c.max}\n${bands[selected].description??'No rubric guidance recorded.'}`)]);
   }
  }
  y=table(doc,y,['Criterion',...bandNames,'Rating guidance from rubric'],body,{styles:{fontSize:6.9,cellPadding:1.4,lineColor:[90,90,95],lineWidth:.15,minCellHeight:10},headStyles:{fillColor:ink,textColor:[255,255,255],fontSize:7},columnStyles:{0:{cellWidth:34},1:{cellWidth:14},2:{cellWidth:14},3:{cellWidth:14},4:{cellWidth:14},5:{cellWidth:94}}});
  y=heading(doc,y,'Shared judge feedback');
  const comments=new Map<string,string[]>();
  for(const a of g.areas)for(const [i,c] of p.cards.filter(c=>c.areaId===a.id).entries()){
   if(![c.feedback.overall,c.feedback.strengths,c.feedback.improvements].some(s=>s?.trim()))continue;
   const comment=[c.feedback.overall?.trim(),c.feedback.strengths?.trim()?`Strengths: ${c.feedback.strengths}`:'',c.feedback.improvements?.trim()?`Areas for improvement: ${c.feedback.improvements}`:''].filter(Boolean).join('\n');
   const label=`${a.name}${p.cards.filter(c=>c.areaId===a.id).length>1?` - card ${i+1}`:''}`;
   comments.set(comment,[...(comments.get(comment)??[]),label]);
  }
  for(const [comment,labels] of comments)y=table(doc,y,[],[[{content:text(labels.join('\n')),styles:{fontStyle:'bold'}},text(comment)]],{styles:{fontSize:7.2,cellPadding:1.5,lineColor:[130,130,135],lineWidth:.15},columnStyles:{0:{cellWidth:44},1:{cellWidth:140}}})-2;
  if(!comments.size)y=paragraphs(doc,y,'','No shared judge comments were recorded for this panel.');
  paragraphs(doc,y,'','* Selected rating is based on the mean submitted mark. Guidance is from the published rubric; shared judge comments appear above.');
 }
 footers(doc,p,'Feedback sheet',true);return doc;
}
export function resultPdfFiles(p:ResultsPacket,logo?:string){return [
 {filename:`${safe(p.eventName)}-Final-Standings-and-Awards.pdf`,bytes:new Uint8Array(buildStandingsPdf(p,logo).output('arraybuffer'))},
 {filename:`Team-${safe(p.team.number)}-${safe(p.team.name)}-Results.pdf`,bytes:new Uint8Array(buildTeamScorecardsPdf(p,logo).output('arraybuffer'))},
 {filename:`Team-${safe(p.team.number)}-${safe(p.team.name)}-Feedback.pdf`,bytes:new Uint8Array(buildTeamFeedbackPdf(p,logo).output('arraybuffer'))},
];}
