import type {jsPDF} from 'jspdf';
export interface ReportBranding {level:'regional'|'national'|null;logos:{light:{base64:string;mime:string;width?:number;height?:number};dark:{base64:string;mime:string;width?:number;height?:number}}|null}
/** Returns false only when the established regional/legacy lockup should be used. */
export function drawNationalLogo(doc:jsPDF,x:number,y:number,w:number,h:number,dark=false,branding?:ReportBranding):boolean {
 if(branding?.level!=='national')return false;
 const logo=branding.logos?.[dark?'dark':'light'];
 if(logo){const data=`data:image/png;base64,${logo.base64}`;const size=doc.getImageProperties(data);const scale=Math.min(w/size.width,h/size.height),width=size.width*scale,height=size.height*scale;doc.addImage(data,'PNG',x+(w-width)/2,y+(h-height)/2,width,height,undefined,'FAST');}
 else{doc.setFont('helvetica','bold');doc.setTextColor(dark?255:0);doc.setFontSize(10);doc.text('NATIONAL FINALS',x+w/2,y+h/2,{align:'center'});}
 return true;
}
