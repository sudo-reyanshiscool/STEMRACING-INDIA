import {jsPDF} from 'jspdf';
import {autoTable,type CellInput,type UserOptions} from 'jspdf-autotable';
import type {Benchmark,ReportArea,ResultsPacket} from './results-packet.ts';
import {INDIA_TECHNICAL} from './technical/rules.ts';
import {selectedRules,summarise} from './technical/summarise.ts';
import {describeLimit} from './technical/describe.ts';
import {RESULTS_FONTS} from './results-fonts.ts';
import {RESULTS_BANNER,RESULTS_ACCENT} from './results-banner.ts';
import {drawEventLockup} from './event-lockup.ts';
import {prepareScorecardFonts,teamCardHeader,drawRubricGroup,drawFeedbackGroup,criterionAverage} from './scorecard-layout.ts';
export {criterionAverage} from './scorecard-layout.ts';

const ink:[number,number,number]=[18,13,24],blue:[number,number,number]=[0,169,224],pink:[number,number,number]=[211,0,116],green:[number,number,number]=[0,136,74];
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
 const doc=new jsPDF({unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true});
 prepareScorecardFonts(doc);
 doc.setProperties({title:`${p.eventName} - ${title}`,author:'STEM Racing India',subject:'Competition results and team feedback'});
 if(cover){
  doc.setFillColor(...ink);doc.rect(0,0,210,41,'F');
  for(let i=0;i<100;i++){doc.setFillColor(211,Math.round(i*.7),116-Math.round(i*.7));doc.rect(i*2.1,39,2.2,2,'F');}
  drawEventLockup(doc,60,5,90,31,true,p.branding);
  doc.setFont('ReportDisplay','normal');doc.setFontSize(19);doc.setTextColor(...ink);doc.text(title,13,52);
  const y=identity(doc,p,13,59,184);
  (doc as jsPDF & {reportStartY:number}).reportStartY=y+6;
 }else{
  drawEventLockup(doc,153,7.3,40,14,false,p.branding);
  doc.setTextColor(...ink);doc.setFont('CardBody','bold');doc.setFontSize(16);
  const lines=doc.splitTextToSize(text(title),139) as string[];doc.text(lines,13,16);
  const y=identity(doc,p,13,Math.max(29,16+lines.length*6),184);
  (doc as jsPDF & {reportStartY:number}).reportStartY=y+5;
 }
 return doc;
}
function identity(doc:jsPDF,p:ResultsPacket,x:number,y:number,width:number){
 doc.setTextColor(...ink);doc.setFont('CardBody','normal');doc.setFontSize(8);
 const content=[`Event: ${p.eventName}`,`Team number: ${p.team.number}     Team name: ${p.team.name}`,`School / club: ${p.team.school||'Not provided'}`];
 for(const line of content){const lines=doc.splitTextToSize(text(line),width) as string[];doc.text(lines,x,y);y+=lines.length*3.8;}
 if(preview(p)){doc.setFont('CardBody','bold');doc.setTextColor(...pink);doc.text('PREVIEW - results or awards have not been finalised.',x,y+1);y+=5;}
 return y;
}
function table(doc:jsPDF,y:number,head:CellInput[],body:CellInput[][],options:Partial<UserOptions>={}) {
 autoTable(doc,{startY:y,margin:{left:13,right:13,top:17,bottom:19},head:head.length?[head]:undefined,body,
  theme:'grid',styles:{font:'CardBody',fontSize:8,cellPadding:1.5,textColor:ink,lineColor:[120,120,125],lineWidth:.15,overflow:'linebreak'},
  headStyles:{fillColor:ink,textColor:[255,255,255],fontStyle:'bold'},rowPageBreak:'avoid',...options});
 return (doc as jsPDF & {lastAutoTable:{finalY:number}}).lastAutoTable.finalY+5;
}
const bandRow=(label:string,cols:number,color:typeof blue=blue):CellInput[]=>[{content:text(label),colSpan:cols,styles:{fillColor:color,textColor:color===grey?ink:[255,255,255],fontStyle:'bold',halign:'left'}}];
function heading(doc:jsPDF,y:number,title:string) {
 doc.setFont('ReportDisplay','normal');doc.setFontSize(12);doc.setTextColor(...ink);
 const lines=doc.splitTextToSize(text(title),184) as string[];
 if(y+lines.length*5>267){doc.addPage();y=22;}
 doc.text(lines,13,y);return y+lines.length*5+2;
}
function paragraphs(doc:jsPDF,y:number,label:string,value:string|null|undefined) {
 if(!value?.trim())return y;
 doc.setFont('CardBody','normal');doc.setFontSize(8.5);doc.setTextColor(...ink);
 const lines=doc.splitTextToSize(text(`${label}${label?': ':''}${value}`),181) as string[];
 for(const line of lines){if(y>271){doc.addPage();y=22;}doc.text(line,13,y);y+=4;}
 return y+3;
}
function footers(doc:jsPDF,p:ResultsPacket,kind:string,privateTeam=false){
 const total=doc.getNumberOfPages();
 for(let page=1;page<=total;page++){
  doc.setPage(page);doc.setDrawColor(175,175,180);doc.line(13,280,197,280);
  doc.setTextColor(90,85,95);doc.setFont('CardBody','normal');doc.setFontSize(7);
  doc.text(text(privateTeam?`Private team report - ${p.team.number} ${p.team.name}`:`STEM Racing India - ${kind}`),13,285);
  doc.text(`${page} / ${total}`,197,285,{align:'right'});
  doc.setFontSize(6);doc.text(`Snapshot ${text(p.createdAt.slice(0,16).replace('T',' '))} UTC${preview(p)?' - PREVIEW':''}`,13,289);
 }
}
export function buildStandingsPdf(p:ResultsPacket,logo?:string):jsPDF {
 const purple:[number,number,number]=[49,39,131],muted:[number,number,number]=[101,93,121],magenta:[number,number,number]=[179,0,125];
 const doc=new jsPDF({unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true});
 for(const f of RESULTS_FONTS){doc.addFileToVFS(f.filename,f.data);doc.addFont(f.filename,f.family,f.style);}
 doc.setProperties({title:`${p.eventName} - Final points and award winners`,author:'STEM Racing India',subject:'Published final standings and confirmed overall awards'});
 const rows=[...p.standings].sort((a,b)=>a.rank-b.rank||a.number.localeCompare(b.number,'en',{numeric:true}));
 const dateParts=p.createdAt.slice(0,10).split('-').map(Number);
 const date=`${dateParts[2]} ${['January','February','March','April','May','June','July','August','September','October','November','December'][dateParts[1]-1]} ${dateParts[0]}`;
 function chrome(){
  const pages=doc.getNumberOfPages();
  for(let page=1;page<=pages;page++){
   doc.setPage(page);doc.addImage(RESULTS_BANNER,'JPEG',0,0,210,30,undefined,'FAST');doc.addImage(RESULTS_ACCENT,'JPEG',0,30,210,1.3,undefined,'FAST');
   drawEventLockup(doc,70,3,70,24,true,p.branding);
   doc.addImage(RESULTS_ACCENT,'JPEG',14,283,182,.6,undefined,'FAST');
   doc.setFont('ReportBody','normal');doc.setFontSize(5.2);doc.setTextColor(...muted);
   const footer=doc.splitTextToSize(text(`${p.eventName} · Final points and award winners · ${date}${preview(p)?' · PREVIEW':''}`),160) as string[];
   doc.text(footer.slice(0,2),14,289);doc.text(`Page ${page} of ${pages}`,196,289,{align:'right'});
  }
 }
 doc.setTextColor(...magenta);doc.setFont('ReportDisplay','normal');doc.setFontSize(6.8);doc.text('RESULTS',14,41.3);
 if(preview(p)){doc.setFont('ReportBody','bold');doc.setFontSize(6.5);doc.text('PREVIEW',196,41.3,{align:'right'});}
 doc.setTextColor(...purple);doc.setFont('ReportDisplay','normal');doc.setFontSize(16.5);doc.text('Final Points and Award Winners',14,50.8);
 doc.setFont('ReportBody','normal');doc.setFontSize(6.4);doc.setTextColor(...muted);
 const meta=doc.splitTextToSize(text(`${p.eventName} · ${date} · Results snapshot ${p.snapshotId.slice(0,12)}`),182) as string[];
 doc.text(meta,14,56.7);let y=61.8+Math.max(0,meta.length-1)*3;
 // Podium entries use published positions. No winner or tie is inferred from team identity.
 const podium=rows.filter(r=>r.rank>=1&&r.rank<=3).slice(0,3);
 const colors:Array<[number,number,number]>=[[255,190,0],[0,163,224],[240,119,0]];
 if(podium.length){
  const gap=3.5,width=(182-gap*(podium.length-1))/podium.length;
  const cards=podium.map((r,i)=>{
   const x=14+i*(width+gap);doc.setFont('ReportDisplay','normal');doc.setFontSize(11.2);
   const name=doc.splitTextToSize(text(r.name),width-6) as string[];
   doc.setFont('ReportBody','normal');doc.setFontSize(6);
   const school=doc.splitTextToSize(text(r.school?.trim()||'School / club not provided'),width-6) as string[];
   return {r,x,name,school,height:25.2+name.length*4.5+school.length*3.4};
  });
  const height=Math.max(36.5,...cards.map(c=>c.height));
  for(const {r,x,name,school} of cards){
   doc.setFillColor(246,242,249);doc.rect(x,y,width,height,'F');doc.setFillColor(...colors[r.rank-1]);doc.rect(x,y,width,1.2,'F');
   doc.setTextColor(...magenta);doc.setFont('ReportDisplay','normal');doc.setFontSize(6.4);doc.text(r.rank===1?'EVENT CHAMPIONS':r.rank===2?'2ND PLACE':'3RD PLACE',x+3,y+7.1);
   doc.setTextColor(...purple);doc.setFontSize(11.2);doc.text(name,x+3,y+15);
   doc.setFont('ReportBody','normal');doc.setFontSize(6);doc.setTextColor(68,61,84);const detailsY=y+19.8+(name.length-1)*4.5;
   doc.text(text(`Team ${r.number}`),x+3,detailsY);doc.text(school,x+3,detailsY+3.4);
   doc.setTextColor(...ink);doc.setFont('ReportBody','bold');doc.setFontSize(7.5);doc.text(`${r.total.toFixed(1)} points`,x+3,y+height-7.4);
  }
  y+=height+12.2;
 }
 doc.setTextColor(...purple);doc.setFont('ReportDisplay','normal');doc.setFontSize(11.2);doc.text('Final points and positions',14,y);y+=3.6;
 autoTable(doc,{startY:y,margin:{left:14,right:14,top:37,bottom:17},head:[['Pos','No.','Team','School / club','Points']],
  body:rows.map(r=>[String(r.rank),text(r.number),text(r.name),text(r.school??''),r.total.toFixed(1)]),theme:'grid',rowPageBreak:'avoid',
  styles:{font:'ReportBody',fontStyle:'normal',fontSize:6.8,cellPadding:{top:1.8,right:2,bottom:1.8,left:2},lineColor:[205,198,221],lineWidth:.13,textColor:[28,23,39]},
  headStyles:{font:'ReportDisplay',fontStyle:'normal',fillColor:purple,textColor:[255,255,255],cellPadding:{top:2.6,right:2,bottom:2.6,left:2}},alternateRowStyles:{fillColor:[246,242,249]},
  columnStyles:{0:{cellWidth:20,halign:'right'},1:{cellWidth:16.4},2:{cellWidth:67.3},3:{cellWidth:54.5},4:{cellWidth:23.8,halign:'right'}},
  didParseCell(data){
   if(data.section==='head'&&(data.column.index===0||data.column.index===4))data.cell.styles.halign='right';
   if(data.section==='body'){
    data.cell.styles.font='ReportBody';data.cell.styles.fontStyle=data.column.index===3?'normal':'bold';
    if(data.column.index===1)data.cell.styles.textColor=magenta;
    if(data.column.index===3)data.cell.styles.textColor=[74,66,91];
    if(rows[data.row.index]?.rank<=3)data.cell.styles.fillColor=[255,246,217];
   }
  }
 });
 doc.addPage();y=43;doc.setTextColor(...purple);doc.setFont('ReportDisplay','normal');doc.setFontSize(11.2);doc.text('Award winners',14,y);y=48.3;
 if(p.awards.length){
  const winnerLines=p.awards.map(a=>{
   doc.setFont('ReportBody','bold');doc.setFontSize(7.1);const name=doc.splitTextToSize(text(a.teamName),98) as string[];
   doc.setFont('ReportBody','normal');doc.setFontSize(6);const detail=doc.splitTextToSize(text(`Team ${a.teamNumber}${a.teamSchool?.trim()?` · ${a.teamSchool}`:''}`),98) as string[];
   return {name,detail};
  });
  autoTable(doc,{startY:y,margin:{left:14,right:14,top:37,bottom:17},head:[['Award','Winner']],
   body:p.awards.map((a,i)=>[{content:text(a.title.toUpperCase()),styles:{minCellHeight:Math.max(12.9,5+winnerLines[i].name.length*3.6+winnerLines[i].detail.length*3)}},{content:'',styles:{minCellHeight:Math.max(12.9,5+winnerLines[i].name.length*3.6+winnerLines[i].detail.length*3)}}]),
   theme:'grid',rowPageBreak:'avoid',styles:{font:'ReportDisplay',fontStyle:'normal',fontSize:7.9,cellPadding:{top:3,right:2.25,bottom:3,left:2.25},lineColor:[220,215,231],lineWidth:.13,textColor:purple},
   headStyles:{font:'ReportDisplay',fontStyle:'normal',fontSize:6.8,fillColor:purple,textColor:[255,255,255],cellPadding:{top:2.6,right:2.25,bottom:2.6,left:2.25}},
   alternateRowStyles:{fillColor:[246,242,249]},columnStyles:{0:{cellWidth:76.5},1:{cellWidth:105.5}},
   didDrawCell(data){if(data.section!=='body'||data.column.index!==1)return;
    const {name,detail}=winnerLines[data.row.index];let yy=data.cell.y+4.8;
    doc.setTextColor(...ink);doc.setFont('ReportBody','bold');doc.setFontSize(7.1);doc.text(name,data.cell.x+2.25,yy);yy+=name.length*3.6;
    doc.setFont('ReportBody','normal');doc.setFontSize(6);doc.setTextColor(...muted);doc.text(detail,data.cell.x+2.25,yy);
   }
  });
 }else{doc.setFont('ReportBody','normal');doc.setFontSize(8);doc.setTextColor(...muted);doc.text('No overall awards were selected for this event.',14,y+5);}
 chrome();return doc;
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
 doc.addPage();let y=teamCardHeader(doc,p,'Specification Results')+5;
 y=paragraphs(doc,y,'Published specifications score',`${points(p.teamResult.areas.specifications)} / ${p.ruleset.areas.find(a=>a.id==='specifications')?.max??100}`);
 const cars=['A','B'].map(car=>{const i=p.inspections.find(i=>i.car===car);return {car,inspection:i,summary:i?.rulesetId===INDIA_TECHNICAL.id?summarise(selectedRules(INDIA_TECHNICAL.rules,i),i.measurements):null};});
 const body:CellInput[][]=[];
 for(const [cls,label] of [['GEN','General'],['SAF','Safety'],['PERF','Performance']]){
  body.push([label,...cars.map(c=>!c.inspection?'No submitted inspection.':!c.summary?'Evaluation unavailable for this technical ruleset.':c.summary.results.filter(r=>r.status==='fail'&&r.cls===cls).map(r=>text(`${r.article} - ${r.name}\n${r.detail.join('; ')}\nDeduction: ${r.penalty} pts`)).join('\n\n')||'No recorded infringements.')]);
 }
 body.push(['Total deductions',...cars.map(c=>c.summary?`${c.summary.total} pts`:'-')]);
 body.push(['Performance infringements',...cars.map(c=>c.summary?String(c.summary.perfFailures.length):'-')]);
 y=table(doc,y,['Regulation class','Car A','Car B'],body,{headStyles:{fillColor:blue,textColor:[255,255,255]},columnStyles:{0:{cellWidth:36},1:{cellWidth:74},2:{cellWidth:74}}});
 y=paragraphs(doc,y,'','Deductions use only the selected regulations recorded for each car; unselected regulations are not assessed. Performance counts show failed regulation checks, not a newly calculated racing penalty. The published score in the summary remains authoritative.');
 if(p.penalties.length){y=heading(doc,y,'Other recorded event penalties');table(doc,y,['Points','Reason'],p.penalties.map(x=>[points(x.points),text(x.reason)]),{columnStyles:{0:{cellWidth:24}}});}
}
interface Group {title:string;areas:ReportArea[]}
function groups(p:ResultsPacket):Group[]{
 const result:Group[]=[];
 for(const a of p.ruleset.areas.filter(a=>a.criteria.length)){
  const key=a.id==='pit-display'||a.id==='team-identity'?'Pit Display & Team Identity':p.ruleset.categories?.find(c=>c.id===a.categoryId)?.name??a.name;
  let g=result.find(g=>g.title===key);if(!g){g={title:key,areas:[]};result.push(g);}g.areas.push(a);
 }
 const pit=result.find(g=>g.title==='Pit Display & Team Identity');
 if(pit)pit.areas.sort((a,b)=>Number(b.id==='pit-display')-Number(a.id==='pit-display'));
 return result;
}
function scorecardPage(doc:jsPDF,p:ResultsPacket,g:Group){
 drawRubricGroup(doc,p,g);
 for(const a of g.areas.filter(a=>p.cards.filter(c=>c.areaId===a.id).length>1)){
  doc.addPage();const y=teamCardHeader(doc,p,`${g.title} Individual Scorecards`)+4;
  const cards=p.cards.filter(c=>c.areaId===a.id);
  table(doc,y,['Criterion',...cards.map((_,i)=>`Card ${i+1}`)], [...a.criteria.map(c=>[text(c.name),...cards.map(card=>`${points(card.scores[c.id])} / ${c.max}`)]),['Raw total',...cards.map(card=>`${points(Object.values(card.scores).reduce((s,v)=>s+v,0))} / ${a.max}`)]],{margin:{left:10,right:10,top:35,bottom:20}});
 }
}
function racePage(doc:jsPDF,p:ResultsPacket){
 doc.addPage();let y=teamCardHeader(doc,p,'Racing Summary')+3;
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
  doc.addPage();const y=teamCardHeader(doc,p,`Recorded Measurements - Car ${i.car}`)+3;
  const known=i.rulesetId===INDIA_TECHNICAL.id;
  if(i.selectedArticles) paragraphs(doc,y,'Inspection scope',`${i.selectedArticles.length} selected regulations. Unselected regulations are not assessed.`);
  table(doc,i.selectedArticles?y+12:y,['Regulation / check','Recorded value','Limits / check'],Object.entries(i.measurements).map(([article,v])=>{
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
export function buildTeamFeedbackPdf(p:ResultsPacket,_logo?:string):jsPDF{
 const doc=new jsPDF({unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true});prepareScorecardFonts(doc);
 doc.setProperties({title:`${p.eventName} - Team ${p.team.number} feedback`,author:'STEM Racing India',subject:'Private team feedback sheets'});
 const order=['Verbal Presentation','Enterprise','Pit Display & Team Identity','Design & Engineering','Project Management','Specification & Scrutineering'];
 const all=groups(p).sort((a,b)=>order.indexOf(a.title)-order.indexOf(b.title));
 for(const [index,g] of all.entries())drawFeedbackGroup(doc,p,g,index===0);
 footers(doc,p,'Feedback sheet',true);return doc;
}
export function teamResultPdfFiles(p:ResultsPacket,logo?:string){return [
 {filename:`Team-${safe(p.team.number)}-${safe(p.team.name)}-Results.pdf`,bytes:new Uint8Array(buildTeamScorecardsPdf(p,logo).output('arraybuffer'))},
 {filename:`Team-${safe(p.team.number)}-${safe(p.team.name)}-Feedback.pdf`,bytes:new Uint8Array(buildTeamFeedbackPdf(p,logo).output('arraybuffer'))},
];}
export function resultPdfFiles(p:ResultsPacket,logo?:string){return [
 {filename:`${safe(p.eventName)}-Final-Standings-and-Awards.pdf`,bytes:new Uint8Array(buildStandingsPdf(p,logo).output('arraybuffer'))},
 ...teamResultPdfFiles(p,logo),
];}
