import json, subprocess, time
from pathlib import Path
P=Path(__file__).resolve().parents[1]
O=P.parent/'output/walkthroughs'
V=json.loads((P/'src/content.json').read_text())
work=P/'build/clips';work.mkdir(parents=True,exist_ok=True)
for v in V:
 clips=[];metadata=[';FFMETADATA1',f'title=STEM Racing India — {v["id"]} Guide','comment=Captioned platform walkthrough. Synthetic sample data. Created 26 October 2026.'];at=0
 for i,s in enumerate(v['scenes']):
  src=O/'qa'/f'{v["id"].lower()}-{i:02d}.png'
  clip=work/f'{v["id"].lower()}-{i:02d}.mp4'
  duration=s['seconds']
  filters=f'loop=loop=-1:size=1:start=0,setpts=N/(24*TB),fade=t=in:st=0:d=0.25,fade=t=out:st={duration-0.25}:d=0.25'
  subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(src),'-vf',filters,'-r','24','-t',str(duration),'-an','-c:v','libx264','-preset','ultrafast','-crf','20','-pix_fmt','yuv420p',str(clip)],check=True)
  clips.append(clip)
  title=s['title'].replace('\n',' ')
  metadata+=['[CHAPTER]','TIMEBASE=1/1000',f'START={at*1000}',f'END={(at+duration)*1000}',f'title={title}'];at+=duration
  print(f'{v["id"]}: encoded chapter {i+1}/{len(v["scenes"])}',flush=True)
 manifest=work/f'{v["id"]}.txt';manifest.write_text(''.join("file '"+str(p).replace("'","'\\''")+"'\n" for p in clips))
 meta=work/f'{v["id"]}.ffmeta';meta.write_text('\n'.join(metadata)+'\n')
 dest=O/f'STEM-Racing-{v["id"]}-Guide.mp4'
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(manifest),'-i',str(meta),'-map_metadata','1','-map_chapters','1','-c','copy','-movflags','+faststart',str(dest)],check=True)
 print(f'{v["id"]}: FINISHED {dest.stat().st_size/1024/1024:.1f} MB',flush=True)
