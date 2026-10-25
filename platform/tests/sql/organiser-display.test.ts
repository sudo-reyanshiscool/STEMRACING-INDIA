import {beforeAll,afterAll,it,expect} from 'vitest';
import {as,makeDb,seedWorld,ids,type World} from './harness';
let w:World;beforeAll(async()=>{w=await seedWorld(await makeDb());});afterAll(async()=>w.db.close());
it('redacts a named organiser address at the API boundary while retaining private delivery data',async()=>{
 await w.db.query("insert into platform_organisers(user_id,email,scope,granted_by,display_name,hide_email) values($1,'nelson-private@x.test','platform',$2,'Nelson',true)",[ids.outsider,ids.admin]);
 const result=await as(w.db,'outsider',q=>q('select platform_access() as access'));
 expect(result.rows[0].access.viewerId).toBe(ids.outsider);expect(result.rows[0].access.ownerId).toBe(ids.admin);
 const nelson=result.rows[0].access.organisers.find((p:any)=>p.name==='Nelson');
 expect(nelson).toMatchObject({userId:ids.outsider,email:null,emailHidden:true,contactRestricted:true,scope:'platform'});
 expect(JSON.stringify(result.rows)).not.toContain('nelson-private@x.test');
 const admin=await as(w.db,'admin',q=>q('select platform_access() as access'));
 expect(admin.rows[0].access.organisers.find((p:any)=>p.name==='Nelson')).toMatchObject({email:'nelson-private@x.test',emailHidden:false});
 // A second Platform Organiser models Shubham's effective all-event permissions.
 await w.db.query("insert into platform_organisers(user_id,email,scope,granted_by) values($1,'shubham-test@x.test','platform',$2) on conflict(user_id) do update set scope='platform'",[ids.invitee,ids.admin]);
 const other=await as(w.db,'invitee',q=>q('select platform_access() as access'));
 expect(JSON.stringify(other.rows)).not.toContain('nelson-private@x.test');
 await expect(as(w.db,'admin',q=>q('select email from platform_organisers'))).rejects.toThrow();
 await w.db.query("insert into event_roles(event_id,user_id,role,email) values($1,$2,'organiser','nelson-private@x.test')",[w.eventId,ids.outsider]);
 const people=await as(w.db,'chair',q=>q('select * from list_event_people($1)',[w.eventId]));
 expect(people.rows.find((p:any)=>p.user_id===ids.outsider)).toMatchObject({email:null,display_name:'Nelson'});
 await expect(as(w.db,'chair',q=>q('select email from event_roles where user_id=$1',[ids.outsider]))).rejects.toThrow();
 await as(w.db,'organiser',q=>q("insert into invitations(event_id,email,role,display_name) values($1,'nelson-private@x.test','organiser','Nelson Vale')",[w.eventId]));
 const invitations=await as(w.db,'chair',q=>q('select email,display_name from list_event_invitations($1)',[w.eventId]));
 expect(invitations.rows).toEqual([{email:'',display_name:'Nelson'}]);
 const adminInvites=await as(w.db,'admin',q=>q('select email from list_event_invitations($1)',[w.eventId]));
 expect(adminInvites.rows).toEqual([{email:'nelson-private@x.test'}]);
 for(const who of ['outsider','invitee'] as const) {
  const view=await as(w.db,who,q=>q('select row_to_json(p) as person from list_event_people($1) p',[w.eventId]));
  const invites=await as(w.db,who,q=>q('select row_to_json(i) as invitation from list_event_invitations($1) i',[w.eventId]));
  expect(JSON.stringify([view.rows,invites.rows])).not.toContain('nelson-private@x.test');
 }
 await w.db.query("insert into audit_log(event_id,action,entity,detail) values($1,'invite','invitations',$2)",[w.eventId,{email:'nelson-private@x.test'}]);
 await w.db.query("insert into broadcast_emails(event_id,sender_email,audience_type,subject,body) values($1,'nelson-private@x.test','all_judges','Hello','Notice')",[w.eventId]);
 for(const who of ['outsider','invitee'] as const) {
  const audits=await as(w.db,who,q=>q('select detail from audit_log where event_id=$1',[w.eventId]));
  const broadcasts=await as(w.db,who,q=>q('select sender_email from broadcast_emails where event_id=$1',[w.eventId]));
  expect(JSON.stringify([audits.rows,broadcasts.rows])).not.toContain('nelson-private@x.test');
 }
 const ownerBroadcasts=await as(w.db,'admin',q=>q('select sender_email from broadcast_emails where event_id=$1',[w.eventId]));
 expect(ownerBroadcasts.rows).toEqual([{sender_email:'nelson-private@x.test'}]);
 await expect(as(w.db,'chair',q=>q('select email from invitations where event_id=$1',[w.eventId]))).rejects.toThrow();
 expect((await as(w.db,'outsider',q=>q('select platform_manager() as allowed'))).rows[0].allowed).toBe(true);
});
it('hides the entire organiser identity from everyone except the permanent administrator without revoking access',async()=>{
 await w.db.query('update platform_organisers set hide_identity=true where user_id=$1',[ids.outsider]);
 for(const who of ['outsider','invitee','organiser','chair'] as const){
  const access=await as(w.db,who,q=>q('select platform_access() as access'));
  const people=await as(w.db,who,q=>q('select * from list_event_people($1)',[w.eventId]));
  const invites=await as(w.db,who,q=>q('select * from list_event_invitations($1)',[w.eventId]));
  const roles=await as(w.db,who,q=>q('select display_name,user_id from event_roles where event_id=$1',[w.eventId]));
  const pending=await as(w.db,who,q=>q('select display_name from invitations where event_id=$1',[w.eventId]));
  const audits=await as(w.db,who,q=>q('select actor,entity_id,detail from audit_log where event_id=$1',[w.eventId]));
  const output=JSON.stringify([access.rows,people.rows,invites.rows,roles.rows,pending.rows,audits.rows]);
  expect(output).not.toContain('Nelson');expect(output).not.toContain('nelson-private@x.test');
  // viewerId may be the hidden organiser himself, so inspect directory entries separately.
  expect(people.rows.some((r:any)=>r.user_id===ids.outsider)).toBe(false);
 }
 const owner=await as(w.db,'admin',q=>q('select platform_access() as access'));
 expect(owner.rows[0].access.organisers.find((p:any)=>p.userId===ids.outsider)).toMatchObject({name:'Nelson',identityRestricted:true});
 expect((await as(w.db,'admin',q=>q('select * from list_event_invitations($1)',[w.eventId]))).rows).toHaveLength(1);
 expect((await as(w.db,'outsider',q=>q('select platform_manager() as allowed'))).rows[0].allowed).toBe(true);
});
