// Checks event-data.js against the platform's sample export:  node tools/check-event-data.cjs
const fs=require('fs'),path=require('path'),assert=require('assert');
require('../event-data.js'); const E=globalThis.SRIEvent;
const dir=path.join(__dirname,'../../../../output/heats-export-sample/');
const full=JSON.parse(fs.readFileSync(dir+'STEM-Racing_Test-Event_Heats.json')), gfx=JSON.parse(fs.readFileSync(dir+'STEM-Racing_Test-Event_Heats-Graphics.json'));
const a=E.heats(full), b=E.heats(gfx);
assert.equal(a.races.length,gfx.matchups.length); assert.equal(b.races.length,gfx.matchups.length);
a.races.forEach((r,k)=>{const m=gfx.matchups[k]; assert.equal(r.a,m.teamA.number); assert.equal(r.b,m.teamB?m.teamB.number:''); assert.deepEqual(r.codes,m.heats); assert.equal(r.phase,m.phase);});
assert.deepEqual(a.teams,b.teams); console.log('sample:',a.name,a.teams.length,'teams,',a.races.length,'races, reaction done:',a.races.filter(r=>r.phase==='reaction'&&r.done).length);
// a made-up four-team knockout: semi-finals raced, final drawn but not raced
const T=n=>({id:'team-00'+n,number:'00'+n,name:'T'+n,school:'S'+n});
const H=(number,round,match,x,y,tx,ty,followup)=>({id:'h'+number,number,code:'KR-H0'+match,label:'',phase:'knockout',round,match,followup:followup||null,followupOf:null,
  lanes:[{lane:1,team:T(x),car:'A',status:tx==null?'pending':'finished',totalMs:tx},{lane:2,team:T(y),car:'A',status:ty==null?'pending':'finished',totalMs:ty}],
  winnerTeamId:tx==null||ty==null?null:tx<ty?'team-00'+x:'team-00'+y,note:''});
const ko=E.heats({kind:'heats',event:{name:'KO'},heats:[H(1,5,1,1,2,1100,1200),H(2,5,1,2,1,1150,1210,'swap'),H(3,5,2,3,4,1300,1250),H(4,6,1,2,4,null,null)]});
const [s1,s2,f]=ko.races; assert.equal(ko.races.length,3);
assert.deepEqual([s1.winner,s1.sure],['002',true]);   // 002 is in the final, so it went through even though the first heat went to 001
assert.deepEqual([s2.winner,s2.sure],['004',true]); assert.deepEqual([f.winner,f.done],['',false]);
assert.equal(E.nextRound(5),'the Final'); assert.equal(E.nextRound(6),''); assert.equal(E.roundName(4),'Quarter-finals');
const ko2=E.heats({kind:'heats',event:{name:'KO'},heats:[H(1,6,1,2,4,1200,1100)]}); assert.deepEqual([ko2.races[0].winner,ko2.races[0].sure],['004',false]);
// results
const awards=[{id:'fastest-car',name:'Fastest Car Award'},{id:'research',name:'Research & Development Award'},{id:'knockout',name:'Knockout Champions',nominees:false}];
const r=E.results({awards:{'fastest-car':{winner:'001',nominees:['team-002','T3','1']},'Research and Development':{winner:'t2',nominees:['003']},'Knockout Champions':'004','Nope':{winner:'001'}}},awards,ko.teams);
assert.deepEqual(r.winners,{'fastest-car':'001',research:'002',knockout:'004'}); assert.deepEqual(r.nominees['fastest-car'],['002','003','001']); assert.deepEqual(r.nominees.research,['003']);
// the platform's own downloads
const AW=[{id:'verbal',name:'Verbal Presentation Award'},{id:'fastest-car',name:'Fastest Car Award'},{id:'third',name:'Third Place',place:3,nominees:false},{id:'second',name:'Second Place',place:2,nominees:false},{id:'champions',name:'Regional Champions',place:1,nominees:false}];
const ref=n=>({id:'uuid-'+n,number:'00'+n,name:'T'+n,school:null});
const nm=E.results({kind:'nominations',awards:[{id:'verbal-presentation',name:'Verbal Presentation Award',nominees:[{team:ref(3),nominations:4},{team:ref(1),nominations:2},{team:ref(2),nominations:1},{team:ref(4),nominations:1}]},{id:'women-in-motorsport',name:'FIA Women in Motorsport Award',nominees:[{team:ref(1),nominations:1}]},{id:'team-identity',name:'Team Identity Award',nominees:[]}]},AW,ko.teams);
assert.deepEqual(nm.nominees,{verbal:['003','001','002']}); assert.deepEqual(nm.problems.map(p=>p.what).sort(),['award','nominee-tie']);
const aw=E.results({kind:'awards',confirmed:false,awards:[{id:'x1',title:'Fastest Car',team:ref(2)},{id:'x2',title:'Verbal Presentation Award',team:ref(3)},{id:'x3',title:'Mystery',team:ref(1)}]},AW,ko.teams);
assert.deepEqual(aw.winners,{'fastest-car':'002',verbal:'003'}); assert.equal(aw.what,'award winners (not confirmed yet)');
const row=(rank,n,tied)=>({rank,tied:!!tied,team:ref(n),total:1});
const rs=E.results({kind:'results',released:true,standings:[row(2,4),row(1,1),row(3,2,true),row(3,3,true)]},AW,ko.teams);
assert.deepEqual(rs.winners,{second:'004',champions:'001'}); assert.deepEqual(rs.problems,[{award:'Third Place',what:'tie'}]);
// fastest cars and the champion from the heats file
const RH=(number,x,y,tx,ty)=>({id:'r'+number,number,code:'RR-H0'+number,label:'',phase:'reaction',round:null,match:null,followup:null,followupOf:null,lanes:[{lane:1,team:T(x),car:'A',status:'finished',totalMs:tx},{lane:2,team:T(y),car:'A',status:ty==null?'dnf':'finished',totalMs:ty}],winnerTeamId:null,note:''});
const fx=E.heats({kind:'heats',event:{name:'F'},heats:[RH(1,1,2,1200,1150),RH(2,3,4,1100,null),RH(3,2,1,1300,1120),H(9,6,1,2,4,1200,1100)]});
assert.deepEqual(fx.fastest,['003','001','002']); assert.equal(fx.champion,'004'); assert.equal(a.champion,'');
console.log('results problems:',JSON.stringify(r.problems)); console.log('all checks passed');
// car analysis, on a made-up full day of racing when one is to hand
require('../analysis.js'); const AN=globalThis.SRIAnalysis;
const empty=AN.build(a); assert.ok(empty.stories.length>=1);
const day=process.argv[2]; if(day){const an=AN.build(E.heats(JSON.parse(fs.readFileSync(day))));
  assert.equal(an.metric,'track'); assert.ok(an.ranked.length===51&&an.ranked[0].best<=an.ranked[1].best);
  an.ranked.forEach(t=>t.radar.forEach(([k,v])=>assert.ok(v==null||(v>=0&&v<=100),k)));
  console.log(an.stories.map(s=>s.id+':'+s.scene.kind).join(' ')); console.log('\n'+an.script+'\n');}
console.log('analysis checks passed');
const carsFile=process.argv[3]; if(day&&carsFile){const cs=E.cars(JSON.parse(fs.readFileSync(carsFile))); assert.ok(cs.count>0);
  const an=AN.build(E.heats(JSON.parse(fs.readFileSync(day))),cs); const w=an.stories.find(s=>s.id==='width'), e=an.stories.find(s=>s.id==='envelope'); assert.ok(w&&e&&w.scene.trend&&an.sized===51);
  console.log(w.script+'\n\n'+e.script+'\n');}
