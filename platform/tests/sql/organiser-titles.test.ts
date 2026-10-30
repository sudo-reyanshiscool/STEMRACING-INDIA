import {beforeAll,afterAll,it,expect} from 'vitest';
import {as,makeDb,seedWorld,ids,type World} from './harness';
let w:World;beforeAll(async()=>{w=await seedWorld(await makeDb());});afterAll(async()=>w.db.close());
it('keeps the administrator title separate from scope and owner-only permissions',async()=>{
 await w.db.query("update platform_organisers set display_title='Platform Administrator' where user_id=$1",[ids.invitee]);
 const access=(await as(w.db,'invitee',q=>q('select platform_access() as a'))).rows[0].a;
 expect(access.kind).toBe('competition');expect(access.displayTitle).toBe('Platform Administrator');expect(access.canManage).toBe(false);
 expect((await as(w.db,'invitee',q=>q('select is_platform_owner() as owner,platform_manager() as manager'))).rows[0]).toEqual({owner:false,manager:false});
 await expect(as(w.db,'invitee',q=>q("update platform_organisers set display_title='Platform Administrator'"))).rejects.toThrow();
});
it('hides the owner from other organisers, spectators, event people, invitations and audit while retaining ownership',async()=>{
 await w.db.query("insert into platform_organisers(user_id,email,scope,granted_by,display_name,hide_identity,hide_email) values($1,'reyanshg11111@gmail.com','platform',$1,'Reyansh',true,true)",[ids.admin]);
 await w.db.query("insert into platform_organisers(user_id,email,scope,granted_by) values($1,'outsider@x.test','spectator',$2)",[ids.outsider,ids.admin]);
 await w.db.query("insert into event_roles(event_id,user_id,role,email,display_name) values($1,$2,'organiser','reyanshg11111@gmail.com','Reyansh')",[w.eventId,ids.admin]);
 await as(w.db,'admin',q=>q("insert into invitations(event_id,email,role,display_name) values($1,'reyanshg11111@gmail.com','organiser','Reyansh')",[w.eventId]));
 await w.db.query("insert into audit_log(event_id,actor,action,entity,detail) values($1,$2,'invite','invitations',$3)",[w.eventId,ids.admin,{email:'reyanshg11111@gmail.com'}]);
 for(const who of ['invitee','outsider','organiser','chair','mgr1'] as const){
  const access=(await as(w.db,who,q=>q('select platform_access() as a'))).rows[0].a;
  expect(access.ownerEmail).toBe('');expect(access.ownerId).toBeUndefined();
  const people=await as(w.db,who,q=>q('select * from list_event_people($1)',[w.eventId]));
  const invitations=await as(w.db,who,q=>q('select * from list_event_invitations($1)',[w.eventId]));
  const audit=await as(w.db,who,q=>q('select * from audit_log where actor=$1',[ids.admin]));
  const visible=JSON.stringify([access,people.rows,invitations.rows,audit.rows]);
  expect(visible).not.toContain(ids.admin);expect(visible).not.toContain('reyanshg11111@gmail.com');expect(visible).not.toContain('Reyansh');
 }
 const own=(await as(w.db,'admin',q=>q('select platform_access() as a,is_platform_owner() as owner,platform_manager() as manager'))).rows[0];
 expect(own).toMatchObject({owner:true,manager:true,a:{kind:'admin',ownerId:ids.admin}});
});
it('grants real admin controls separately from titles and keeps private identities owner-only',async()=>{
 const x=await seedWorld(await makeDb());
 try{
  await x.db.query("update platform_organisers set scope='platform',display_title='Platform Administrator' where user_id=$1",[ids.invitee]);
  await x.db.query('insert into platform_administrators(user_id) values($1)',[ids.invitee]);
  await x.db.query("insert into platform_organisers(user_id,email,scope,granted_by,display_name,hide_email,public_alias,display_title) values($1,'obscure@accounts.invalid','platform',$2,'stemracingindiaevents.test@stemracingindiasupport.com',true,'stemracingindiaevents.test@stemracingindiasupport.com','Platform Administrator')",[ids.outsider,ids.admin]);
  await x.db.query("insert into platform_organisers(user_id,email,scope,granted_by,display_name,hide_identity,hide_email) values($1,'reyanshg11111@gmail.com','platform',$1,'Reyansh',true,true)",[ids.admin]);
  const a=(await as(x.db,'invitee',q=>q('select platform_access() as a,is_platform_owner() as owner,platform_administrator() as admin'))).rows[0];
  expect(a).toMatchObject({owner:false,admin:true,a:{kind:'admin',canAdminister:true,ownerEmail:''}});
  expect(JSON.stringify(a)).not.toContain(ids.admin);expect(JSON.stringify(a)).not.toContain('obscure@accounts.invalid');
  expect(a.a.organisers.find((p:any)=>p.userId===ids.outsider).email).toBe('stemracingindiaevents.test@stemracingindiasupport.com');
  await as(x.db,'invitee',q=>q("select invite_platform_member('spectator-new@x.test','spectator','New viewer',false)"));
  await expect(as(x.db,'invitee',q=>q("select set_organiser_visibility($1,'Owner',false)",[ids.admin]))).rejects.toThrow();
  await expect(as(x.db,'outsider',q=>q('select remove_organiser($1)',[ids.invitee]))).rejects.toThrow();
  await expect(as(x.db,'outsider',q=>q('insert into platform_administrators(user_id) values($1)',[ids.outsider]))).rejects.toThrow();
  expect((await as(x.db,'outsider',q=>q('select platform_access() as a'))).rows[0].a).toMatchObject({kind:'platform',canAdminister:false,displayTitle:'Platform Administrator'});
 }finally{await x.db.close();}
});
