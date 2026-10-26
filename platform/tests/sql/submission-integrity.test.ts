import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {as,makeDb,seedWorld,ids,type World,type Who} from './harness';
import type {PGlite} from '@electric-sql/pglite';
let db:PGlite,w:World;
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const render={name:'render.png',mime:'image/png',base64:readFileSync(new URL('../fixtures/car-render.png',import.meta.url)).toString('base64')};
const colours={primary:'#E6007E',secondary:'#312783',accent:'#FCBC00'};
const member={id:'m1',name:'Sample member',role:'Engineer',fileName:'portrait.png',photoMime:'image/png',photoBase64:png};
beforeAll(async()=>{db=await makeDb();});beforeEach(async()=>{w=await seedWorld(db);});afterAll(async()=>db.close());
const get=async(who:Who='mgr1',team=w.team1)=>(await as(db,who,q=>q('select get_compulsory_assets($1,$2) as s',[w.eventId,team]))).rows[0].s;
const save=(who:Who='mgr1',key='team_colours',value:unknown=colours,revision:number|null=null,team=w.team1)=>as(db,who,q=>q('select save_team_media_details($1,$2,$3,$4::jsonb,$5)',[w.eventId,team,key,JSON.stringify(value),revision]));
const upload=(who:Who='mgr1',key='car_render_fl',input=render,revision:number|null=0,team=w.team1)=>as(db,who,q=>q('select upload_compulsory_asset($1,$2,$3,$4::jsonb,$5)',[w.eventId,team,key,JSON.stringify(input),revision]));
it('persists real uploads and details for independent staff/manager reads, with downloadable bytes',async()=>{
 await upload();await save();await save('mgr1','member_portraits',[member],1);
 expect(await get('organiser')).toMatchObject({revision:2,carRenderFL:{name:'render.png',width:3840,height:2160,revision:1},teamColours:colours,memberPortraits:[member]});
 const f=(await as(db,'organiser',q=>q('select download_compulsory_asset($1,$2,$3) as f',[w.eventId,w.team1,'car_render_fl']))).rows[0].f;
 expect(f.base64).toBe(render.base64);expect(f.size).toBe(Buffer.from(render.base64,'base64').length);
 expect((await get()).carRenderFL.base64).toBeUndefined();
});
it('rejects other teams, cross-event references, judges, outsiders and anonymous access',async()=>{
 for(const who of ['mgr2','judgeV','outsider'] as const){await expect(get(who)).rejects.toMatchObject({code:'42501'});await expect(save(who)).rejects.toMatchObject({code:'42501'});await expect(upload(who)).rejects.toMatchObject({code:'42501'});await expect(as(db,who,q=>q('select delete_compulsory_asset($1,$2,$3)',[w.eventId,w.team1,'car_render_fl']))).rejects.toMatchObject({code:'42501'});}
 await expect(as(db,null,q=>q('select get_compulsory_assets($1,$2)',[w.eventId,w.team1]))).rejects.toMatchObject({code:'42501'});
 const other=await seedWorld(db);await expect(upload('organiser','car_render_fl',render,0,other.team1)).rejects.toMatchObject({code:'42501'});
 await expect(as(db,'mgr1',q=>q('select * from team_media_files'))).rejects.toMatchObject({code:'42501'});
});
it('keeps spectators read-only through RPCs and direct tables',async()=>{
 await db.query("insert into platform_organisers(user_id,email,scope,granted_by) values($1,'outsider@x.test','spectator',$2) on conflict(user_id) do update set scope='spectator'",[ids.outsider,ids.admin]);
 await upload();expect((await get('outsider')).carRenderFL.name).toBe('render.png');
 await expect(save('outsider')).rejects.toMatchObject({code:'42501'});await expect(upload('outsider')).rejects.toMatchObject({code:'42501'});
 await db.query('delete from platform_organisers where user_id=$1',[ids.outsider]);
});
it('requires actual photos, valid colours, safe filenames, complete images/models/archives, and supported categories',async()=>{
 for(const value of [null,{}, {...colours,accent:''},{...colours,primary:'url(x)'}])await expect(save('mgr1','team_colours',value)).rejects.toMatchObject({code:'22023'});
 for(const value of [[{id:'x',name:'A',role:'B'}],[member,member],[{...member,photoMime:'image/svg+xml'}],[{...member,photoBase64:btoa('not an image')}]])await expect(save('mgr1','member_portraits',value)).rejects.toMatchObject({code:'22023'});
 for(const [key,input] of [['car_render_fl',{...render,base64:png}],['car_render_fl',{...render,name:'../x.png'}],['car_render_fl',{...render,base64:'bad'}],['car_model_3d',{name:'x.obj',mime:'model/obj',base64:btoa('not a model')}],['model_materials',{name:'x.zip',mime:'application/zip',base64:btoa('PK-not-an-archive')}],['official_photo',render]] as const)await expect(upload('mgr1',key,input)).rejects.toMatchObject({code:'22023'});
 expect(await get()).not.toHaveProperty('carRenderFL');
});
it('detects stale file and detail replacements without overwriting the current version',async()=>{
 await upload();await expect(upload()).rejects.toMatchObject({code:'40001'});await upload('mgr1','car_render_fl',render,1);
 await save('mgr1','team_colours',colours,0);await expect(save('mgr1','member_portraits',[member],0)).rejects.toMatchObject({code:'40001'});
 expect(await get()).toMatchObject({revision:1,carRenderFL:{revision:2},memberPortraits:[]});
});
it('uses the canonical team logo and deleting it updates both lists',async()=>{
 const logo={name:'logo.svg',mime:'image/svg+xml',base64:btoa('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')};
 await upload('mgr1','team_logo',logo);expect((await get()).teamLogo.name).toBe('logo.svg');
 expect((await as(db,'mgr1',q=>q('select * from list_team_files($1)',[w.eventId]))).rows).toHaveLength(1);
 await as(db,'mgr1',q=>q('select delete_compulsory_asset($1,$2,$3)',[w.eventId,w.team1,'team_logo']));expect((await get()).teamLogo).toBeNull();
});
it('enforces guide completion on all upload paths, including direct official photo calls',async()=>{
 await db.query('delete from submission_guide_progress where user_id=$1',[ids.mgr1]);
 await expect(upload()).rejects.toMatchObject({code:'55000'});await expect(save()).rejects.toMatchObject({code:'55000'});
 await expect(as(db,'mgr1',q=>q('select upload_team_photo($1,$2,0,$3::jsonb)',[w.eventId,w.team1,JSON.stringify({name:'team.png',mime:'image/png',base64:png,mediaConsent:true})]))).rejects.toMatchObject({code:'55000'});
 await upload('organiser');
});
it('locks media writes on results release and keeps server records readable',async()=>{
 await upload();await db.query('update events set results_released=true where id=$1',[w.eventId]);
 await expect(upload('organiser','car_render_fl',render,1)).rejects.toMatchObject({code:'55000'});await expect(save()).rejects.toMatchObject({code:'55000'});
 await expect(as(db,'mgr1',q=>q('select delete_compulsory_asset($1,$2,$3)',[w.eventId,w.team1,'car_render_fl']))).rejects.toMatchObject({code:'55000'});
 expect((await get()).carRenderFL).toBeTruthy();
});
it('blocks unauthorised photo completion and stale jobs after replacement, using real dimensions',async()=>{
 const photo={name:'team.png',mime:'image/png',base64:png,mediaConsent:true,width:3840,height:2160};
 await as(db,'organiser',q=>q('select upload_team_photo($1,$2,0,$3::jsonb)',[w.eventId,w.team1,JSON.stringify(photo)]));
 const job=(await db.query<{id:string}>('select id from photo_processing_jobs where event_id=$1',[w.eventId])).rows[0].id;
 for(const who of ['mgr2','mgr1','outsider'] as const)await expect(as(db,who,q=>q('select complete_photo_processing($1,$2,$3,null)',[job,'completed',png]))).rejects.toMatchObject({code:'42501'});
 await as(db,'organiser',q=>q('select upload_team_photo($1,$2,1,$3::jsonb)',[w.eventId,w.team1,JSON.stringify(photo)]));
 expect((await as(db,'organiser',q=>q('select complete_photo_processing($1,$2,$3,null) as ok',[job,'completed',png]))).rows[0].ok).toBe(false);
 const current=(await db.query('select original_width,original_height,processing_status,processed_content from team_photos where event_id=$1',[w.eventId])).rows[0];expect(current).toMatchObject({original_width:1,original_height:1,processing_status:'pending',processed_content:null});
 await expect(as(db,'outsider',q=>q('select get_broadcast_team_photo($1,$2)',[w.eventId,w.team1]))).rejects.toMatchObject({code:'42501'});
});
