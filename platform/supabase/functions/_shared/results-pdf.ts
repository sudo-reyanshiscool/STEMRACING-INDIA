import {jsPDF} from 'jspdf';
import {autoTable} from 'jspdf-autotable';
import type {ResultsPacket} from './results-packet.ts';

const ink:[number,number,number]=[20,12,30],pink:[number,number,number]=[230,0,126];
const text=(value:unknown)=>String(value??'').normalize('NFKC').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\u2026/g,'...').replace(/[\u2010-\u2015]/g,'-').replace(/[^\x20-\x7e\n\r\xA0-\xFF]/g,'?');
const safe=(value:string)=>value.replace(/[^A-Za-z0-9_-]+/g,'-').slice(0,65)||'results';
const points=(value:unknown)=>typeof value==='number'?value.toFixed(1).replace(/\.0$/,''):String(value??'-');

function document(title:string,packet:ResultsPacket,logo?:string) {
 const doc=new jsPDF({unit:'mm',format:'a4',compress:true});
 doc.setProperties({title:`${packet.eventName} - ${title}`,author:'STEM Racing India',subject:'Released competition results'});
 doc.setFillColor(...ink);doc.rect(0,0,210,29,'F');
 if(logo)doc.addImage(logo,'PNG',13,5,40,18,undefined,'FAST');
 else {doc.setTextColor(255,255,255);doc.setFont('helvetica','bolditalic');doc.setFontSize(17);doc.text('STEM RACING INDIA',13,17);}
 doc.setTextColor(...ink);doc.setFont('helvetica','bold');doc.setFontSize(21);doc.text(title,13,43);
 doc.setFont('helvetica','normal');doc.setFontSize(10);
 const eventLines=doc.splitTextToSize(text(packet.eventName),184) as string[];
 doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(eventLines,13,51);
 const snapshotY=55+eventLines.length*4;
 doc.setFontSize(8);doc.setTextColor(95,85,105);doc.text(`Ranking snapshot: ${text(packet.createdAt.slice(0,16).replace('T',' '))} UTC`,13,snapshotY);
 const preview=!packet.released||!packet.awardsConfirmed;
 if(preview){doc.setTextColor(...pink);doc.setFontSize(8);doc.text('PREVIEW - results or awards have not been finalised for email.',13,snapshotY+6);}
 (doc as jsPDF & {reportStartY:number}).reportStartY=snapshotY+(preview?14:7);
 return doc;
}
function table(doc:jsPDF,y:number,head:string[],body:string[][],widths?:Record<number,number>) {
 autoTable(doc,{startY:y,margin:{left:13,right:13,top:17,bottom:18},head:[head],body,
  theme:'striped',styles:{font:'helvetica',fontSize:9,cellPadding:2.2,textColor:ink,overflow:'linebreak'},
  headStyles:{fillColor:pink,textColor:[255,255,255],fontStyle:'bold'},alternateRowStyles:{fillColor:[247,244,248]},
  columnStyles:widths?Object.fromEntries(Object.entries(widths).map(([k,v])=>[k,{cellWidth:v}])):undefined});
 return (doc as jsPDF & {lastAutoTable:{finalY:number}}).lastAutoTable.finalY+8;
}
function heading(doc:jsPDF,y:number,title:string) {
 doc.setTextColor(...ink);doc.setFont('helvetica','bold');doc.setFontSize(13);const lines=doc.splitTextToSize(text(title),184) as string[];
 if(y+lines.length*6>267){doc.addPage();y=22;}
 doc.text(lines,13,y);return y+lines.length*6+2;
}
function paragraphs(doc:jsPDF,y:number,label:string,value:string|null) {
 if(!value?.trim())return y;
 doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(...ink);
 const lines=doc.splitTextToSize(text(`${label}: ${value}`),180) as string[];
 for(const line of lines){if(y>272){doc.addPage();y=22;}doc.text(line,13,y);y+=4.3;}
 return y+3;
}
function footers(doc:jsPDF,privateTeam?:string) {
 const total=doc.getNumberOfPages();
 for(let page=1;page<=total;page++){
  doc.setPage(page);doc.setDrawColor(220,214,225);doc.line(13,281,197,281);
  doc.setTextColor(105,95,115);doc.setFont('helvetica','normal');doc.setFontSize(7.5);
  doc.text(privateTeam?text(`Private team scorecards - Team ${privateTeam}`):'STEM Racing India - Final standings and confirmed awards',13,287);
  doc.text(`${page} / ${total}`,197,287,{align:'right'});
 }
}
export function buildStandingsPdf(packet:ResultsPacket,logo?:string):jsPDF {
 const doc=document('Final standings & awards',packet,logo);
 let y=table(doc,(doc as jsPDF & {reportStartY:number}).reportStartY,['Rank','Team','Total points'],packet.standings.map(r=>[String(r.rank),text(`${r.number} - ${r.name}`),points(r.total)]),{0:18,2:30});
 y=heading(doc,y,'Confirmed overall awards');
 if(packet.awards.length)table(doc,y,['Award','Winning team'],packet.awards.map(a=>[text(a.title),text(`${a.teamNumber} - ${a.teamName}`)]));
 else paragraphs(doc,y+3,'Awards','No overall awards were selected for this event.');
 footers(doc);return doc;
}
const measurement=(v:unknown):string=>v==null?'Not recorded':typeof v==='boolean'?(v?'Pass':'Fail'):typeof v==='number'?String(v):Object.entries(v as Record<string,unknown>).map(([k,n])=>`${k}: ${typeof n==='boolean'?(n?'Pass':'Fail'):n}`).join('; ');
export function buildTeamScorecardsPdf(packet:ResultsPacket,logo?:string):jsPDF {
 const doc=document('Your team scorecards',packet,logo);
 let y=heading(doc,(doc as jsPDF & {reportStartY:number}).reportStartY+2,`Team ${packet.team.number} - ${packet.team.name}`);
 y=paragraphs(doc,y+3,'School / club',packet.team.school);
 y=table(doc,y,['Final rank','Final total','Penalties'],[[String(packet.teamResult.rank),points(packet.teamResult.total),points(packet.teamResult.penalties)]]);
 y=heading(doc,y,'Score summary');
 y=table(doc,y,['Area','Points'],packet.ruleset.areas.map(a=>[text(a.name),`${points(packet.teamResult.areas[a.id])} / ${a.max}`]));
 let firstCard=true;
 for(const [index,card] of packet.cards.entries()){
  const area=packet.ruleset.areas.find(a=>a.id===card.areaId);if(!area)continue;
  const estimate=45+(area.criteria.length+2)*8+[card.feedback.overall,card.feedback.strengths,card.feedback.improvements].reduce<number>((n,s)=>n+(s?.length??0)/85*4.3,0);
  if(firstCard||y+estimate>265){doc.addPage();y=23;firstCard=false;}else y+=7;
  y=heading(doc,y,area.name);
  y=paragraphs(doc,y+2,'Submitted scorecard',`${index+1} of ${packet.cards.length}`);
  y=table(doc,y,['Criterion','Score','Maximum'],[...area.criteria.map(c=>[text(c.name),points(card.scores[c.id]),String(c.max)]),['Scorecard total',points(Object.values(card.scores).reduce((a,b)=>a+b,0)),String(area.max)]],{1:23,2:23});
  y=paragraphs(doc,y,'Overall feedback',card.feedback.overall);
  y=paragraphs(doc,y,'Strengths',card.feedback.strengths);
  y=paragraphs(doc,y,'Areas for improvement',card.feedback.improvements);
 }
 if(packet.penalties.length){if(y>225){doc.addPage();y=23;}else y+=7;y=heading(doc,y,'Recorded penalties');y=table(doc,y,['Points','Reason'],packet.penalties.map(p=>[points(p.points),text(p.reason)]),{0:24});}
 for(const inspection of packet.inspections){
  doc.addPage();y=heading(doc,23,`Specification measurements - Car ${inspection.car}`);
  table(doc,y,['Regulation','Recorded measurement / check'],Object.entries(inspection.measurements).map(([article,value])=>[text(article),text(measurement(value))]),{0:32});
 }
 footers(doc,packet.team.number);return doc;
}
export function resultPdfFiles(packet:ResultsPacket,logo?:string) {
 return [
  {filename:`${safe(packet.eventName)}-Final-Standings-and-Awards.pdf`,bytes:new Uint8Array(buildStandingsPdf(packet,logo).output('arraybuffer'))},
  {filename:`Team-${safe(packet.team.number)}-${safe(packet.team.name)}-Scorecards.pdf`,bytes:new Uint8Array(buildTeamScorecardsPdf(packet,logo).output('arraybuffer'))},
 ];
}
