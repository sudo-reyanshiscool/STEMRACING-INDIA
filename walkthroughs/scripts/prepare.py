import json
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw
P=Path(__file__).resolve().parents[1]
V=json.loads((P/'src/content.json').read_text())
(P/'public/crops').mkdir(exist_ok=True)
thumbs=[]
for v in V:
 for i,s in enumerate(v['scenes']):
  if not s['screen']:continue
  im=Image.open(P/'public/screens'/f"{s['screen']}.png").convert('RGB')
  y=min(s['y'],max(0,im.height-s['h']))
  crop=im.crop((0,y,im.width,min(im.height,y+s['h'])))
  name=f"{v['id'].lower()}-{i:02d}.png"
  crop.save(P/'public/crops'/name)
  s['image']='crops/'+name;s['imageWidth']=crop.width;s['imageHeight']=crop.height
  th=Image.new('RGB',(280,340),'#ddd')
  small=ImageOps.contain(crop,(270,300));th.paste(small,((280-small.width)//2,30))
  ImageDraw.Draw(th).text((8,8),f"{v['id']} {i:02d} · y={y}",fill='black')
  thumbs.append(th)
 v['duration']=sum(s['seconds'] for s in v['scenes'])
(P/'src/content.json').write_text(json.dumps(V,indent=2))
for part in range((len(thumbs)+11)//12):
 chunk=thumbs[part*12:(part+1)*12];sheet=Image.new('RGB',(1120,340*((len(chunk)+3)//4)),'#bbb')
 for j,im in enumerate(chunk):sheet.paste(im,((j%4)*280,(j//4)*340))
 sheet.save(P/f'build-contact-{part}.jpg')
print([(v['id'],v['duration']) for v in V])
