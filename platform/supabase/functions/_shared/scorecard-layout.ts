import {jsPDF} from 'jspdf';
import type {ReportArea,ResultsPacket} from './results-packet.ts';
import {RESULTS_FONTS} from './results-fonts.ts';
import {SCORECARD_FONTS} from './scorecard-assets.ts';
import {drawEventLockup} from './event-lockup.ts';

export interface ScorecardGroup {title:string;areas:ReportArea[]}
const mm=(pt:number)=>pt*25.4/72;
const clean=(s:unknown)=>String(s??'').normalize('NFKC').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[\u2010-\u2015]/g,'-').replace(/\u2026/g,'...').replace(/[^\x20-\x7e\n\r\xA0-\xFF]/g,'?');
const score=(n:number|null|undefined)=>n==null?'-':n.toFixed(1).replace(/\.0$/,'');
const cyan:[number,number,number]=[0,169,224],mark:[number,number,number]=[0,176,80];
const ratingLabels=['LOW','MEDIUM LOW','MEDIUM HIGH','HIGH'];
const ratingColors:Array<[number,number,number]>=[[255,222,102],[255,178,133],[255,133,139],[255,128,135]];
const preview=(p:ResultsPacket)=>!p.released||!p.awardsConfirmed;

export function prepareScorecardFonts(doc:jsPDF){
 const f=RESULTS_FONTS.find(f=>f.family==='ReportDisplay')!;
 doc.addFileToVFS(f.filename,f.data);doc.addFont(f.filename,f.family,f.style);
 for(const font of SCORECARD_FONTS){doc.addFileToVFS(font.filename,font.data);doc.addFont(font.filename,font.family,font.style);}
}
function wrapped(doc:jsPDF,value:string,width:number,font:string,size:number,style='normal'):string[]{
 doc.setFont(font,style);doc.setFontSize(size);return doc.splitTextToSize(clean(value),width) as string[];
}
function centerText(doc:jsPDF,lines:string[],x:number,y:number,width:number,height:number,size:number,font:string,style='normal',align:'left'|'center'|'right'='left'){
 doc.setFont(font,style);doc.setFontSize(size);const line=mm(size)*1.05;
 const yy=y+(height-lines.length*line)/2+mm(size)*.83;
 doc.text(lines,align==='left'?x:align==='center'?x+width/2:x+width,yy,{align,lineHeightFactor:1.05});
}
function box(doc:jsPDF,x:number,y:number,w:number,h:number,color?:[number,number,number]){
 doc.setDrawColor(0);doc.setLineWidth(.15);doc.setTextColor(0);
 if(color){doc.setFillColor(...color);doc.rect(x,y,w,h,'FD');}else doc.rect(x,y,w,h);
}
export function teamCardHeader(doc:jsPDF,p:ResultsPacket,title:string,kind:'scorecard'|'feedback'='scorecard'):number{
 const feedback=kind==='feedback',x=feedback?7:10,w=feedback?196:190,y=feedback?25.4:10;
 const left=feedback?68.5:93.2,labels=feedback?30:27.8,valueX=x+left+labels,valueW=w-left-labels-2;
 const titleFont=feedback?'CardBody':'ReportDisplay',titleStyle=feedback?'bold':'normal';
 let titleSize=feedback?16:15.8;
 let titleLines=wrapped(doc,title,left-3,titleFont,titleSize,titleStyle);
 while(titleLines.length>(feedback?1:2)&&titleSize>11){titleSize-=.4;titleLines=wrapped(doc,title,left-3,titleFont,titleSize,titleStyle);}
 if(feedback)titleLines.push('FEEDBACK SHEET');
 const valueFont=feedback?'CardBody':'ReportDisplay';
 const name=wrapped(doc,p.team.name,valueW,valueFont,feedback?11:11.2,feedback?'bold':'normal');
 const school=wrapped(doc,p.team.school||'Not provided',valueW,feedback?'CardBody':'ReportDisplay',feedback?9.5:9.2);
 const height=Math.max(feedback?17.4:19.2,3.2+5+name.length*4.1+school.length*3.4+(name.length>1||school.length>1?2:0),titleLines.length*mm(titleSize)*1.12+3);
 if(feedback)drawEventLockup(doc,153,7.3,40,14,false,p.branding);
 box(doc,x,y,w,height);doc.line(x+left,y,x+left,y+height);
 centerText(doc,titleLines,x+1.3,y,left-2.6,height,titleSize,titleFont,titleStyle);
 const labelFont=feedback?'CardBody':'ScoreLabel';
 const labelSize=feedback?10.4:10.5;doc.setFont(labelFont,'normal');doc.setFontSize(labelSize);
 let row=y+(feedback?5.8:5.8);
 doc.text('Team number:',x+left+1,row);
 doc.setFont(valueFont,feedback?'bold':'normal');doc.setFontSize(feedback?11:11.2);doc.setTextColor(feedback?255:49,feedback?0:39,feedback?0:131);doc.text(clean(p.team.number),valueX+1,row);
 row+=feedback?4.4:5.8;doc.setTextColor(0);doc.setFont(labelFont,'normal');doc.setFontSize(labelSize);doc.text('Team name:',x+left+1,row);
 doc.setTextColor(feedback?0:179,0,feedback?0:125);doc.setFont(valueFont,feedback?'bold':'normal');doc.setFontSize(feedback?11:11.2);doc.text(name,valueX+1,row,{lineHeightFactor:1.05});
 row+=name.length*4.1;doc.setTextColor(0);doc.setFont(labelFont,'normal');doc.setFontSize(labelSize);doc.text('School / club:',x+left+1,row);
 doc.setFont(feedback?'CardBody':'ReportDisplay','normal');doc.setFontSize(feedback?9.5:9.2);doc.setTextColor(feedback?0:211,0,feedback?0:116);doc.text(school,valueX+1,row,{lineHeightFactor:1.05});
 return y+height;
}
export function criterionAverage(p:ResultsPacket,area:ReportArea,criterionId:string):number|null{
 const values=p.cards.filter(c=>c.areaId===area.id).map(c=>c.scores[criterionId]).filter((v):v is number=>typeof v==='number');
 return values.length?Math.round((values.reduce((s,v)=>s+v,0)/values.length+Number.EPSILON)*10+1e-9)/10:null;
}
function bandsFor(c:ReportArea['criteria'][number]){
 return c.bands?.length===4?c.bands:[{min:0,max:Math.floor(c.max*.25)},{min:Math.floor(c.max*.25)+1,max:Math.floor(c.max*.5)},{min:Math.floor(c.max*.5)+1,max:Math.floor(c.max*.75)},{min:Math.floor(c.max*.75)+1,max:c.max}];
}
function groupTitle(g:ScorecardGroup){
 if(g.areas[0]?.panel==='scrutineering')return 'Scrutineering Judging Scorecard';
 if(g.title==='Pit Display & Team Identity')return 'Pit Display & Team Identity Scorecard';
 return `${g.title} Scorecard`;
}
function bar(doc:jsPDF,y:number,title:string,width=190,x=10,feedback=false){
 const font=feedback?'CardBody':'ReportDisplay',size=feedback?10.2:10.2;
 const lines=wrapped(doc,title,width-3,font,size,feedback?'bold':'normal');
 const h=Math.max(4.8,lines.length*mm(size)*1.05+1.4);box(doc,x,y,width,h,feedback?[214,221,229]:cyan);
 centerText(doc,lines,x+1,y,width-2,h,size,font,feedback?'bold':'normal','center');return y+h;
}
function totalRow(doc:jsPDF,y:number,label:string,value:number|null,max:number,final=false){
 const h=final?10:4.8,x=10,w=190,right=12.5;
 doc.setDrawColor(final?255:0,0,0);doc.setLineWidth(final?.22:.15);doc.rect(x,y,w,h);if(final)doc.line(x+w-right,y,x+w-right,y+h);
 const lines=wrapped(doc,label,w-right-3,'ReportDisplay',final?10.7:9.3);
 doc.setTextColor(final?255:0,0,0);centerText(doc,lines,x+1,y,w-right-2,h,final?10.7:9.3,'ReportDisplay','normal','right');
 doc.setTextColor(...mark);centerText(doc,[score(value)],x+w-right,y,right,h,final?11.5:9.8,'CardBody','bold','center');
 if(final){doc.setFont('CardBody','normal');doc.setFontSize(9);doc.setTextColor(255,0,0);doc.text(`/${max}`,x+w-right/2,y+h-1,{align:'center'});}
 return y+h;
}
export function drawRubricGroup(doc:jsPDF,p:ResultsPacket,g:ScorecardGroup):number{
 doc.addPage();let y=teamCardHeader(doc,p,groupTitle(g));
 const widths=[27.5,35.4,37.5,37.5,39.6,12.5];
 const compact=g.areas[0]?.panel==='scrutineering';
 const subtotals=g.areas.length>1&&!compact;
 const estimate=(size:number)=>g.areas.reduce((height,a,index)=>height+(!compact||index===0?5.2:0)+(subtotals?4.8:0)+a.criteria.reduce((sum,c)=>{
  const count=Math.max(...bandsFor(c).map((b,i)=>wrapped(doc,b.description||'Rubric guidance not recorded.',widths[i+1]-1.5,'CardBody',size).length));
  return sum+Math.max(count*mm(size)+1.3,10)+3.1+.8;
 },0),0)+11.2;
 let fontSize=6.8;while(fontSize>6.2&&estimate(fontSize)>277-y)fontSize-=.2;
 for(const [areaIndex,a] of g.areas.entries()){
  if(!compact||areaIndex===0)y=bar(doc,y,compact?'Scrutineering':a.name);
  for(const c of a.criteria){
   const bands=bandsFor(c),descriptions=bands.map((b,i)=>wrapped(doc,b.description||'Rubric guidance not recorded.',widths[i+1]-1.5,'CardBody',fontSize));
   const label=wrapped(doc,c.name,widths[0]-2,'ReportDisplay',8.2);
   const bodyH=Math.max(10,...descriptions.map(lines=>lines.length*mm(fontSize)+1.3),label.length*mm(8.2)*1.05+1.3);
   const rangeH=3.1,height=bodyH+rangeH;
   if(y+height+6>274){doc.addPage();y=teamCardHeader(doc,p,groupTitle(g));y=bar(doc,y,`${a.name} (continued)`);}
   let x=10;box(doc,x,y,widths[0],height);centerText(doc,label,x+1,y,widths[0]-2,height,8.2,'ReportDisplay');x+=widths[0];
   for(const [i,b] of bands.entries()){
    box(doc,x,y,widths[i+1],bodyH);doc.setTextColor(0);doc.setFont('CardBody','normal');doc.setFontSize(fontSize);
    doc.text(descriptions[i],x+.7,y+.6+mm(fontSize)*.8,{lineHeightFactor:1});
    box(doc,x,y+bodyH,widths[i+1],rangeH);centerText(doc,[Array.from({length:b.max-b.min+1},(_,n)=>String(b.min+n)).join('  ')],x+.5,y+bodyH,widths[i+1]-1,rangeH,8.2,'CardBody','normal','center');x+=widths[i+1];
   }
   box(doc,x,y,widths[5],height);doc.setTextColor(...mark);centerText(doc,[score(criterionAverage(p,a,c.id))],x,y,widths[5],height,12,'CardBody','bold','center');
   y+=height+.8;
  }
  if(subtotals){
   if(y+5>277){doc.addPage();y=teamCardHeader(doc,p,groupTitle(g));}
   y=totalRow(doc,y,`${a.name} Total =`,p.teamResult.areas[a.id]??null,a.max);
  }
 }
 if(y+11.2>278){doc.addPage();y=teamCardHeader(doc,p,groupTitle(g));}
 const values=g.areas.map(a=>p.teamResult.areas[a.id]);
 const total=values.some(v=>v==null)?null:Math.round(values.reduce<number>((n,v)=>n+(v??0),0)*10)/10;
 return totalRow(doc,y+1.2,`${g.title} Total =`,total,g.areas.reduce((n,a)=>n+a.max,0),true)+6;
}
function feedbackTitle(g:ScorecardGroup){return g.title==='Pit Display & Team Identity'?'Pit Display':g.title;}
interface FeedbackRow {area:ReportArea;criterion:ReportArea['criteria'][number];lines:string[];selected:number;height:number}
export function drawFeedbackGroup(doc:jsPDF,p:ResultsPacket,g:ScorecardGroup,first:boolean){
 if(!first)doc.addPage();let y=teamCardHeader(doc,p,feedbackTitle(g),'feedback');
 const x=7,width=196,labelW=32,stripW=6,guideX=x+labelW+4*stripW;
 const rows:FeedbackRow[]=g.areas.flatMap(area=>area.criteria.map(criterion=>{
  const avg=criterionAverage(p,area,criterion.id),bands=bandsFor(criterion),selected=avg===null?-1:bands.findIndex(b=>avg<=b.max);
  const value=selected<0?'No submitted criterion score.':bands[selected].description||'No rubric guidance recorded.';
  const lines=wrapped(doc,value,137,'CardBody',10);
  return {area,criterion,lines,selected,height:Math.max(20.3,lines.length*mm(10)*1.05+2.4)};
 }));
 let previous='';
 for(const row of rows){
  const section=previous!==row.area.id;
  if(y+row.height+(section?4.8:0)>258){doc.addPage();y=teamCardHeader(doc,p,feedbackTitle(g),'feedback');previous='';}
  if(previous!==row.area.id){y=bar(doc,y,row.area.name,width,x,true);previous=row.area.id;}
  box(doc,x,y,labelW,row.height);const label=wrapped(doc,row.criterion.name,labelW-2.4,'CardBody',9,'bold');
  centerText(doc,label,x+1.2,y,labelW-2.4,row.height,9,'CardBody','bold');
  for(let i=0;i<4;i++){
   const xx=x+labelW+i*stripW;box(doc,xx,y,stripW,row.height,ratingColors[i]);
   doc.setTextColor(0);doc.setFont('CardBody',row.selected===i?'bold':'normal');doc.setFontSize(5.5);
   const tw=doc.getTextWidth(ratingLabels[i]);doc.text(ratingLabels[i],xx+stripW/2+mm(5.5)/3,y+row.height/2+tw/2,{angle:90});
   if(i===row.selected){doc.setFontSize(6);doc.text('*',xx+stripW/2,y+2.3,{align:'center'});}
  }
  box(doc,guideX,y,140,row.height);doc.setTextColor(0);centerText(doc,row.lines,guideX+1.2,y,137.6,row.height,10,'CardBody');
  y+=row.height+1;
 }
 const chunks:Array<{value:string;font:'normal'|'bold';size:number}>=[];
 const seen=new Map<string,string[]>();
 for(const a of g.areas)for(const [i,c] of p.cards.filter(c=>c.areaId===a.id).entries()){
  const value=[c.feedback.overall?.trim(),c.feedback.strengths?.trim()?`Strengths: ${c.feedback.strengths}`:'',c.feedback.improvements?.trim()?`Areas for improvement: ${c.feedback.improvements}`:''].filter(Boolean).join('\n');
  if(value)seen.set(value,[...(seen.get(value)??[]),`${a.name}${p.cards.filter(c=>c.areaId===a.id).length>1?` - card ${i+1}`:''}`]);
 }
 chunks.push({value:'Notes (shared judge feedback):',font:'bold',size:10.5});
 for(const [value,labels] of seen){chunks.push({value:labels.join(' / '),font:'bold',size:9});chunks.push({value,font:'normal',size:10});}
 if(!seen.size)chunks.push({value:'No shared judge comments were recorded for this panel.',font:'normal',size:10});
 chunks.push({value:'* Rating bands and the text beside them show rubric guidance for the mean submitted mark. Notes contain recorded shared feedback.',font:'normal',size:7});
 if(y+16>278){doc.addPage();y=teamCardHeader(doc,p,feedbackTitle(g),'feedback');}
 let boxY=y,yy=y+4;
 for(const chunk of chunks){
  const lines=wrapped(doc,chunk.value,192,'CardBody',chunk.size,chunk.font),lineH=mm(chunk.size)*1.12;
  for(const line of lines){
   if(yy+lineH>276){box(doc,x,boxY,width,278-boxY);doc.addPage();boxY=teamCardHeader(doc,p,feedbackTitle(g),'feedback');doc.setFont('CardBody','bold');doc.setFontSize(10.5);doc.text('Notes (continued):',x+1.2,boxY+4);yy=boxY+8;}
   doc.setTextColor(0);doc.setFont('CardBody',chunk.font);doc.setFontSize(chunk.size);doc.text(line,x+1.2,yy);yy+=lineH;
  }
  yy+=1.4;
 }
 box(doc,x,boxY,width,278-boxY);
}
