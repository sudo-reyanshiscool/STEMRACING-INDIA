#!/usr/bin/env python3
"""Regenerate native PDF logo paths from public/brand/event-lockup.svg.
Requires fonttools[woff] and uharfbuzz; uses the named fonts already in public/fonts.
"""
from pathlib import Path
import xml.etree.ElementTree as ET
import io,json,math,base64
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.teePen import TeePen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path
from fontTools import subset
root=Path(__file__).resolve().parents[1]
source=root/'public/brand/event-lockup.svg'
svg=ET.parse(source).getroot();ns='{http://www.w3.org/2000/svg}'
ops=[];bounds=BoundsPen(None)
class PdfPen(BasePen):
 def _moveTo(self,p):ops.append({'op':'m','c':list(p)})
 def _lineTo(self,p):ops.append({'op':'l','c':list(p)})
 def _curveToOne(self,p1,p2,p3):ops.append({'op':'c','c':list(p1+p2+p3)})
 def _closePath(self):ops.append({'op':'h','c':[]})
 def _endPath(self):pass
pen=TeePen(PdfPen(None),bounds)
fonts={}
for cls,path,size in [('cls-2',root/'public/fonts/Magistral-BoldItalic.woff2',107.63),('cls-4',root/'public/fonts/Magistral-MediumItalic.woff2',43.3)]:
 f=TTFont(path);f.flavor=None;b=io.BytesIO();f.save(b);face=hb.Face(b.getvalue());hf=hb.Font(face);hf.scale=(face.upem,face.upem);fonts[cls]=(f,hf,size,face.upem)
def visit(node,skip=False):
 tag=node.tag.removeprefix(ns)
 if tag=='defs' or node.attrib.get('class') in ['cls-5','cls-7']:return
 if tag=='path':parse_path(node.attrib['d'],pen)
 elif tag=='polygon':
  coords=[float(v) for v in node.attrib['points'].replace(',',' ').split()];pairs=list(zip(coords[::2],coords[1::2]));pen.moveTo(pairs[0])
  for p in pairs[1:]:pen.lineTo(p)
  pen.closePath()
 elif tag=='rect':
  a=node.attrib;x=float(a['x']);y=float(a['y']);w=float(a['width']);h=float(a['height']);pen.moveTo((x,y));pen.lineTo((x+w,y));pen.lineTo((x+w,y+h));pen.lineTo((x,y+h));pen.closePath()
 elif tag=='text':
  f,hf,size,upem=fonts[node.attrib['class']];tx,ty=map(float,node.attrib['transform'].removeprefix('translate(').removesuffix(')').replace(',',' ').split());scale=size/upem
  for span in node:
   buf=hb.Buffer();buf.add_str(''.join(span.itertext()));buf.guess_segment_properties();hb.shape(hf,buf)
   xx=tx+float(span.attrib.get('x',0));yy=ty+float(span.attrib.get('y',0));glyphs=f.getGlyphSet()
   for info,pos in zip(buf.glyph_infos,buf.glyph_positions):
    glyphs[f.getGlyphName(info.codepoint)].draw(TransformPen(pen,(scale,0,0,-scale,xx+pos.x_offset*scale,yy-pos.y_offset*scale)))
    xx+=pos.x_advance*scale;yy-=pos.y_advance*scale
  return
 for child in node:visit(child)
visit(svg)
x0,y0,x1,y1=bounds.bounds;pad=2
for op in ops:op['c']=[round(v,4) for v in op['c']]
module="""import type {jsPDF} from 'jspdf';
// Native vector outlines of the supplied Regional Finals / INDIA lockup.
// The supplied SVG is preserved in public/brand/event-lockup.svg; live text is outlined with its named project fonts.
const bounds="""+json.dumps([x0-pad,y0-pad,x1+pad,y1+pad])+" as const;\nconst outlines="+json.dumps(ops,separators=(',',':'))+";\n"+"""
export function drawEventLockup(doc:jsPDF,x:number,y:number,width:number,height:number,white=false){
 const scale=Math.min(width/(bounds[2]-bounds[0]),height/(bounds[3]-bounds[1]));
 const dx=x+(width-(bounds[2]-bounds[0])*scale)/2,dy=y+(height-(bounds[3]-bounds[1])*scale)/2;
 const path=outlines.map(p=>({op:p.op,c:p.c.map((v,i)=>(i%2?dy:dx)+(v-bounds[i%2])*scale)}));
 doc.saveGraphicsState();doc.setFillColor(white?255:0,white?255:0,white?255:0);doc.path(path).fill();doc.restoreGraphicsState();
}
"""
(root/'supabase/functions/_shared/event-lockup.ts').write_text(module)
print('Native logo paths',len(ops),'bounds',[round(x,2) for x in bounds.bounds])
