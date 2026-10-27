import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import {as,makeDb,seedWorld,ids,type World,type Who} from './harness';
import {buildBrandingArchive,buildTeamBrandingPdf,type TeamBrandingProfile,type BrandingAssetFile} from '../../src/api/team-branding';
import {readFileSync} from 'node:fs';
import {BRANDING_RESOURCES} from '../../src/api/branding-resources';
import {unzipSync,strFromU8} from 'fflate';
let w:World;
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const resources=async()=>BRANDING_RESOURCES.map(r=>({path:r.path,mime:r.mime,bytes:new Uint8Array(readFileSync(new URL('../../public'+r.url,import.meta.url)))}));
const pdfBytes=new TextEncoder().encode('%PDF-1.4\nPDF renderer contract fixture');
const renderPdf=async()=>pdfBytes;
const colours={primary:'#E6007E',secondary:'#312783',accent:'#FCBC00'};
beforeAll(async()=>{w=await seedWorld(await makeDb());});beforeEach(async()=>{w=await seedWorld(w.db);});afterAll(async()=>w.db.close());
const profile=async(who:Who|null='mgr1',team=w.team1):Promise<TeamBrandingProfile>=>(await as(w.db,who,q=>q('select team_branding_profile($1,$2) p',[w.eventId,team]))).rows[0].p;
const file=async(key:string,version:string,who:Who|null='mgr1'):Promise<BrandingAssetFile>=>(await as(w.db,who,q=>q('select download_team_brand_asset($1,$2,$3,$4) f',[w.eventId,w.team1,key,version]))).rows[0].f;
const upload=()=>as(w.db,'mgr1',q=>q('select upload_compulsory_asset($1,$2,$3,$4::jsonb,0)',[w.eventId,w.team1,'team_logo',JSON.stringify({name:'logo.png',mime:'image/png',base64:png})]));
const details=(key:string,value:unknown)=>as(w.db,'mgr1',q=>q('select save_team_media_details($1,$2,$3,$4::jsonb)',[w.eventId,w.team1,key,JSON.stringify(value)]));
it('creates empty profiles automatically and updates from canonical assets and identity without regeneration',async()=>{
 const first=await profile();expect(first).toMatchObject({schemaVersion:1,assets:[],members:[],completedCount:0,totalCount:8});expect(first.missing).toHaveLength(8);
 await upload();await details('team_colours',colours);await details('member_portraits',[{id:'m1',name:'../Sample member',role:'Engineer',fileName:'portrait.png',photoMime:'image/png',photoBase64:png}]);
 const p=await profile();expect(p).toMatchObject({colours,completedCount:3,members:[{name:'../Sample member',role:'Engineer',assetKey:'portrait:m1'}]});expect(p.version).not.toBe(first.version);expect(p.assets).toHaveLength(2);
 expect(JSON.stringify(p)).not.toContain('photoBase64');expect(JSON.stringify(p)).not.toContain(png);expect(JSON.stringify(p)).not.toContain('@');
 const pack=unzipSync(await buildBrandingArchive({teamBrandingProfile:()=>profile(),downloadTeamBrandAsset:(_e,_t,k,v)=>file(k,v)},p,undefined,resources,renderPdf));
 expect(Object.keys(pack)).toEqual([...BRANDING_RESOURCES.map(r=>r.path),'identity/team-logo.png','members/01-Sample-member.png','profile.pdf','profile.json','colours.css','README.txt']);expect(Buffer.from(pack['identity/team-logo.png']).toString('base64')).toBe(png);expect(pack['profile.pdf']).toEqual(pdfBytes);expect(pack).not.toHaveProperty('profile.html');expect(pack['brand/track-shape-pink.svg']).toEqual((await resources())[1].bytes);expect(strFromU8(pack['colours.css'])).toContain(colours.primary);expect(JSON.parse(strFromU8(pack['profile.json'])).assets[0].path).toBe('identity/team-logo.png');
 await w.db.query('update teams set name=$1 where id=$2',['New identity',w.team1]);expect((await profile()).version).not.toBe(p.version);
 await expect(file('team_logo',p.version)).rejects.toMatchObject({code:'40001'});
});
it('authorises staff and own team, denies other teams, judges, outsiders and anonymous profiles AND bytes',async()=>{
 await upload();const p=await profile();expect((await profile('organiser')).version).toBe(p.version);expect((await profile('chair')).version).toBe(p.version);
 for(const who of ['mgr2','judgeV','leadV','outsider',null] as const){await expect(profile(who)).rejects.toMatchObject({code:'42501'});await expect(file('team_logo',p.version,who)).rejects.toMatchObject({code:'42501'});}
 const other=await seedWorld(w.db);await expect(profile('mgr1',other.team1)).rejects.toMatchObject({code:'42501'});
});
it('allows the read-only platform spectator and downloads after results release',async()=>{
 await upload();await w.db.query("insert into platform_organisers(user_id,email,scope,granted_by) values($1,'outsider@x.test','spectator',$2)",[ids.outsider,ids.admin]);
 try{const p=await profile('outsider');expect((await file('team_logo',p.version,'outsider')).base64).toBe(png);await w.db.query('update events set results_released=true where id=$1',[w.eventId]);expect((await profile()).version).toBe(p.version);}finally{await w.db.query('delete from platform_organisers where user_id=$1',[ids.outsider]);}
});
it('includes original photos immediately, approved cutouts only after approval, and never pending cutouts',async()=>{
 await as(w.db,'organiser',q=>q('select upload_team_photo($1,$2,0,$3::jsonb)',[w.eventId,w.team1,JSON.stringify({name:'team.png',mime:'image/png',base64:png,mediaConsent:true})]));
 const first=await profile();expect(first.assets.map(a=>a.key)).toEqual(['official_photo_original']);expect((await file('official_photo_original',first.version)).base64).toBe(png);
 await w.db.query("update team_photos set approved_content=decode($2,'base64'),approved_size=$3,approved_at=now(),approval_status='pending' where team_id=$1",[w.team1,png,Buffer.from(png,'base64').length]);expect((await profile()).assets).toHaveLength(1);
 await w.db.query("update team_photos set approval_status='approved',version=version+1 where team_id=$1",[w.team1]);const approved=await profile();expect(approved.assets.map(a=>a.key)).toContain('official_photo_approved');expect((await file('official_photo_approved',approved.version)).base64).toBe(png);
 await expect(file('unavailable',approved.version)).rejects.toMatchObject({code:'22023'});
});
it('refuses an archive if sources change while it is being assembled',async()=>{
 await upload();const p=await profile();let reads=0;
 await expect(buildBrandingArchive({downloadTeamBrandAsset:(_e,_t,k,v)=>file(k,v),teamBrandingProfile:async()=>{reads++;await details('team_colours',colours);return profile();}},p,undefined,resources,renderPdf)).rejects.toThrow(/changed/);expect(reads).toBe(1);
});

it('offers a direct PDF from current images and preserves the same authorised source checks',async()=>{
 await upload();const p=await profile();let rendered=false;
 const pdf=await buildTeamBrandingPdf({teamBrandingProfile:()=>profile(),downloadTeamBrandAsset:(_e,_t,k,v)=>file(k,v)},p,undefined,resources,async(_p,source)=>{rendered=true;expect(source.files.map(f=>f.path)).toEqual(['identity/team-logo.png']);expect(source.resources).toHaveLength(5);return pdfBytes;});
 expect(rendered).toBe(true);expect(pdf).toEqual(pdfBytes);
});
it('refuses a PDF when team assets change during rendering',async()=>{
 await upload();const p=await profile();
 await expect(buildTeamBrandingPdf({teamBrandingProfile:()=>profile(),downloadTeamBrandAsset:(_e,_t,k,v)=>file(k,v)},p,undefined,resources,async()=>{await details('team_colours',colours);return pdfBytes;})).rejects.toThrow(/changed/);
});
