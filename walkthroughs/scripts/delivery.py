import json, html
from pathlib import Path
P=Path(__file__).resolve().parents[1]
O=P.parent/'output/walkthroughs'
videos=json.loads((P/'src/content.json').read_text())
def stamp(s):return f'{s//60:02d}:{s%60:02d}'
def srt_time(s):return f'{s//3600:02d}:{s//60%60:02d}:{s%60:02d},000'
for v in videos:
 at=0;chapters=[];subtitles=[]
 for i,s in enumerate(v['scenes']):
  title=s['title'].replace('\n',' ')
  chapters.append(f'{stamp(at)}  {title}')
  lines=[title,*s['lines']]
  subtitles.append(f'{i+1}\n{srt_time(at)} --> {srt_time(at+s["seconds"])}\n'+ '\n'.join(lines)+'\n')
  at+=s['seconds']
 (O/f'STEM-Racing-{v["id"]}-Guide.srt').write_text('\n'.join(subtitles))
 (O/f'{v["id"].lower()}-chapters.txt').write_text('\n'.join(chapters)+'\n')
 cards=''
 for v in videos:
  title=v['id'];lower=title.lower()
  cards+=f'''<article><span class="eyebrow">GUIDE {v['number']} / {html.escape(v['audience'])}</span><h2>{title}</h2><p>{stamp(v['duration'])} · 1080p · Captions only</p><video controls preload="metadata" poster="{lower}-cover.png"><source src="STEM-Racing-{title}-Guide.mp4" type="video/mp4"></video><p><a href="STEM-Racing-{title}-Guide.mp4" download>Download MP4</a> <a href="{lower}-chapters.txt">Chapters</a></p></article>'''
 (O/'index.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>STEM Racing India — Platform Guides</title><style>*{box-sizing:border-box}body{margin:0;background:#0c0812;color:#fff;font:17px/1.6 system-ui}main{max-width:1200px;margin:auto;padding:60px 24px}h1{font-size:clamp(36px,6vw,68px);line-height:1.1;margin:12px 0 22px;letter-spacing:-2px}h2{font-size:34px;margin:8px 0}.eyebrow{font-size:12px;letter-spacing:3px;color:#ee67ae}p{color:#c1b5ce}article{padding:30px;border:1px solid #44324e;border-radius:16px;margin:36px 0;background:#14101c}video{display:block;width:100%;aspect-ratio:16/9;border-radius:10px;background:#000}a{color:#ff9dcf;margin-right:25px}footer{padding:20px 0;color:#a89bb5}</style><main><span class="eyebrow">STEM RACING INDIA / EVENTS PLATFORM</span><h1>Know your workspace.<br>Be ready for race day.</h1><p>Three captioned guides for teams, judges and event organisers. Platform screens use sample accounts and competition data.</p>'''+cards+'''<footer>Created 26 October 2026 · Silent videos with on-screen instructions · Sample schedules and scores are illustrative.</footer></main></html>''')
(O/'README.md').write_text('''# STEM Racing India platform walkthroughs

Captioned, silent, 1920 × 1080 MP4 videos at 24 frames per second.

- Teams: 2:16 — Team Garage, portfolio uploads and receipts, penalties, eight media deliverables, photo consent, published schedule, concerns and results.
- Judges: 2:17 — explicit assignments, conflicts, rubrics, feedback/private notes, review and submission, draft status, Lead Judge reopening and released results.
- Organisers: 3:51 — roles, invitations, judge team scopes, deadlines, media, event setup, random streams, master timeline, appointment generator, draft/publish, racing, moderation, communications and ranking release.

Open index.html for the three-video library. Each video also has a chapter list and SRT text companion. Instructions are burned into the picture so they remain visible without subtitles enabled.

All captured accounts and event records are synthetic. No real invitations, emails, judging changes, schedules or results were published while creating these guides.

The organiser sample account also holds Chair permissions. Chair-only actions are identified in the guide. Hidden-account management is explained without exposing any real account identity.

Editable source: ../../walkthroughs/.
''')
