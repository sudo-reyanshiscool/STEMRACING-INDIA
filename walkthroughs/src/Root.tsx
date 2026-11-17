import React from 'react';
import {AbsoluteFill,Composition,Img,Sequence,interpolate,registerRoot,staticFile,useCurrentFrame} from 'remotion';
import content from './content.json';
const fps=24;
const font=`@font-face{font-family:Display;src:url('${staticFile('fonts/display.woff2')}')}@font-face{font-family:Body;src:url('${staticFile('fonts/body.woff2')}')}*{box-sizing:border-box}`;
const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'} as const;
function Diagram({s,accent}:{s:any;accent:string}){
 const f=useCurrentFrame();
 let cards=s.tag==='penalty'?[['01','5 points','for each started late hour'],['02','61 minutes late','2 started hours × 5 = 10 points'],['03','First successful upload','stops that portfolio’s clock']]:s.tag==='roles'?[['OPERATIONS','Organiser','Teams, people, schedules and event operations'],['ADJUDICATION','Chair of Judges','Moderation, final rankings and results release'],['OWNER ONLY','Platform access','Hidden accounts and read-only spectators']]:s.tag==='submit'?[['01','All changes saved','Check scores, notes and feedback'],['02','Check card','Review every mark and the total'],['03','Submit scorecard','Locks editing until an authorised reopen']]:[['01','Prepare','Check your access and event details'],['02','Complete','Follow the workflow for your role'],['03','Confirm','Review the saved or published status']];
 return <div style={{position:'absolute',left:980,top:220,width:810,display:'flex',flexDirection:'column',gap:25}}>{cards.map(([n,title,sub],i)=><div key={n} style={{padding:'28px 32px',border:'1px solid #40394d',borderLeft:`5px solid ${accent}`,borderRadius:12,background:'#171320',opacity:interpolate(f,[10+i*7,24+i*7],[0,1],clamp),transform:`translateX(${interpolate(f,[10+i*7,24+i*7],[35,0],clamp)}px)`}}><div style={{fontSize:20,letterSpacing:3,color:accent,marginBottom:13}}>{n}</div><div style={{fontFamily:'Display',fontSize:42,color:'white'}}>{title}</div><div style={{fontSize:25,color:'#d1cbd9',lineHeight:1.4,marginTop:12}}>{sub}</div></div>)}</div>
}
function Slide({s,v,index}:{s:any;v:any;index:number}){
 const f=useCurrentFrame(); const duration=s.seconds*fps;
 const enter=interpolate(f,[0,12],[0,1],clamp);const exit=interpolate(f,[duration-9,duration],[1,0],clamp);
 const intro=s.tag==='intro',outro=s.tag==='outro';
 return <AbsoluteFill style={{opacity:enter*exit,fontFamily:'Body,Arial',color:'#fff'}}>
 <div style={{position:'absolute',left:96,top:170,width:800,transform:`translateY(${(1-enter)*20}px)`}}>
 <div style={{fontSize:22,letterSpacing:4,color:v.accent,marginBottom:28}}>{intro?'PLATFORM WALKTHROUGH':outro?'YOUR FINISHING CHECKLIST':`${String(index).padStart(2,'0')} / ${v.audience}`}</div>
 <div style={{fontFamily:'Display',fontSize:intro?105:83,lineHeight:1.06,letterSpacing:-2,whiteSpace:'pre-line',marginBottom:44}}>{s.title}</div>
 <div style={{display:'flex',flexDirection:'column',gap:25,maxWidth:730}}>{s.lines.map((line:string,i:number)=><div key={line} style={{fontSize:intro?33:30,lineHeight:1.37,display:'flex',gap:20,opacity:interpolate(f,[10+i*5,20+i*5],[0,1],clamp)}}><div style={{width:7,height:7,flexShrink:0,marginTop:15,background:v.accent,borderRadius:4}}/><span>{line}</span></div>)}</div>
 </div>
 {intro||outro?<div style={{position:'absolute',left:1040,top:200,width:720,height:660}}>
 <div style={{fontFamily:'Display',fontSize:410,color:'#21192e',lineHeight:1,letterSpacing:-40,transform:`translateY(${interpolate(f,[0,duration],[12,-12],clamp)}px)`}}>{v.number}</div>
 <div style={{position:'absolute',top:145,left:40,width:630,padding:'45px 25px',borderTop:`4px solid ${v.accent}`,borderBottom:'1px solid #41364e',background:'#0d0913'}}><Img src={staticFile('brand/logo.png')} style={{width:570,objectFit:'contain'}}/><div style={{fontSize:26,letterSpacing:5,marginTop:34,color:v.accent}}>{v.audience}</div></div>
 
 </div>:s.image?<div style={{position:'absolute',left:970,top:154,width:855,height:760,borderRadius:16,boxShadow:'0 24px 70px #0008',border:'1px solid #504259',overflow:'hidden',background:'#f0f0e9',transform:`translateX(${(1-enter)*28}px)`}}>
 <div style={{height:44,background:'#211929',display:'flex',alignItems:'center',padding:'0 19px',gap:8}}>{[0,1,2].map(x=><span key={x} style={{width:8,height:8,borderRadius:5,background:x===0?v.accent:'#66556e'}}/>)}<span style={{marginLeft:14,color:'#ddd2e7',fontSize:15,letterSpacing:2}}>PLATFORM SCREEN / SAMPLE EVENT</span></div>
 <div style={{position:'relative',width:'100%',height:716,display:'flex',justifyContent:'center',alignItems:'center',overflow:'hidden'}}><Img src={staticFile(s.image)} style={{width:'100%',height:'100%',objectFit:'contain'}}/>
 {s.focus?<div style={{position:'absolute',left:`${s.focus[0]}%`,top:`${s.focus[1]}%`,width:`${s.focus[2]}%`,height:`${s.focus[3]}%`,border:`4px solid ${v.accent}`,boxShadow:`0 0 0 5px ${v.accent}25`,borderRadius:8,opacity:interpolate(f,[28,40, duration-15,duration-8],[0,1,1,0],clamp)}}/>:null}
 </div></div>:<Diagram s={s} accent={v.accent}/>}
 <div style={{position:'absolute',left:96,bottom:130,right:100,fontSize:24,color:'#c8c0d0',display:'flex',gap:18,alignItems:'center'}}><span style={{display:'inline-block',width:30,height:3,background:v.accent}}/>{s.cue||(intro?'A captioned guide using the current platform and sample data.':'Pause whenever you need to follow a step in your event.')}</div>
 </AbsoluteFill>
}
function Video({video}:{video:any}){
 const f=useCurrentFrame();let at=0;const scenes:Array<{s:any;i:number;start:number;end:number}>=video.scenes.map((s:any,i:number)=>{const start=at;at+=s.seconds*fps;return {s,i,start,end:at}});const active=scenes.find(x=>f>=x.start&&f<x.end)??scenes[scenes.length-1];
 return <AbsoluteFill style={{background:'#0c0812',overflow:'hidden'}}><style>{font}</style>
 <div style={{position:'absolute',right:-250,top:-450,width:1300,height:1300,border:'1px solid #2b2037',transform:'rotate(-28deg)'}}/>
 <div style={{position:'absolute',right:-180,top:-370,width:1300,height:1300,border:'1px solid #261d2f',transform:'rotate(-28deg)'}}/>
 <div style={{position:'absolute',top:0,left:0,right:0,height:7,background:video.accent}}/>
 <div style={{position:'absolute',left:96,top:53,fontFamily:'Body',fontSize:20,letterSpacing:4,color:'#a89cb5'}}>STEM RACING INDIA</div>
 <div style={{position:'absolute',right:96,top:53,fontFamily:'Body',fontSize:20,letterSpacing:3,color:'#a89cb5'}}>GUIDE {video.number} / {video.audience}</div>
 {scenes.map(({s,i,start})=><Sequence key={i} from={start} durationInFrames={s.seconds*fps} premountFor={24}><Slide s={s} v={video} index={i}/></Sequence>)}
 <div style={{position:'absolute',bottom:72,left:96,right:96,height:4,display:'flex',gap:6}}>{scenes.map(x=><div key={x.i} style={{flex:x.s.seconds,background:'#302638',overflow:'hidden'}}><div style={{height:'100%',width:`${f>=x.start?100:0}%`,background:video.accent}}/></div>)}</div>
 <div style={{position:'absolute',bottom:28,left:96,right:96,display:'flex',justifyContent:'space-between',fontFamily:'Body',fontSize:18,color:'#b1a5be',letterSpacing:2}}><span>CAPTIONS ONLY · SAMPLE DATA</span><span>{String(active.i+1).padStart(2,'0')} / {String(scenes.length).padStart(2,'0')}</span></div>
 </AbsoluteFill>
}
const Root=()=> <>{content.map(v=><Composition key={v.id} id={v.id} component={Video} width={1920} height={1080} fps={fps} durationInFrames={v.duration*fps} defaultProps={{video:v}}/>)}</>;
registerRoot(Root);
