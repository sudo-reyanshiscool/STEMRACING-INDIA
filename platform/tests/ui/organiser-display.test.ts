// @vitest-environment jsdom
import {it,expect} from 'vitest';
import {MemoryApi} from '../../src/api';
import {organiserControls} from '../../src/ui/organisers';
import {makeCtx} from './helpers';
it('shows the organiser name when their email is hidden',()=>{
 const el=organiserControls(makeCtx(new MemoryApi()).ctx,{kind:'admin',ownerEmail:'owner@x.test',canManage:true,invitations:[],organisers:[{userId:'nelson',name:'Nelson',email:null,emailHidden:true,scope:'platform',permanent:false}]});
 expect(el.textContent).toContain('Nelson');expect(el.textContent).toContain('Email hidden');expect(el.textContent).toContain('Platform Organiser');
});
it('never renders a restricted address for a platform organiser even if it is present in a stale response',()=>{
 const el=organiserControls(makeCtx(new MemoryApi()).ctx,{kind:'platform',viewerId:'other',ownerId:'admin',ownerEmail:'owner@x.test',canManage:true,invitations:[],organisers:[{userId:'nelson',name:'Nelson',email:'nelson-private@x.test',contactRestricted:true,emailHidden:false,scope:'platform',permanent:false}]},'other');
 expect(el.textContent).toContain('Email hidden');expect(el.textContent).not.toContain('nelson-private@x.test');
});
it('allows the administrator only when response and current viewer identities both match the owner',()=>{
 const access={kind:'admin' as const,viewerId:'admin',ownerId:'admin',ownerEmail:'owner@x.test',canManage:true,invitations:[],organisers:[{userId:'nelson',name:'Nelson',email:'nelson-private@x.test',contactRestricted:true,emailHidden:false,scope:'platform' as const,permanent:false}]};
 expect(organiserControls(makeCtx(new MemoryApi()).ctx,access,'admin').textContent).toContain('nelson-private@x.test');
 expect(organiserControls(makeCtx(new MemoryApi()).ctx,access,'other').textContent).not.toContain('nelson-private@x.test');
});
it('omits a private organiser entirely for a non-administrator, including from stale administrator data',()=>{
 const access={kind:'admin' as const,viewerId:'admin',ownerId:'admin',ownerEmail:'owner@x.test',canManage:true,invitations:[],organisers:[{userId:'nelson',name:'Nelson',email:'nelson-private@x.test',identityRestricted:true,scope:'platform' as const,permanent:false}]};
 const hidden=organiserControls(makeCtx(new MemoryApi()).ctx,access,'other');
 expect(hidden.textContent).not.toContain('Nelson');expect(hidden.textContent).not.toContain('nelson-private@x.test');expect(hidden.textContent).not.toContain('Revoke organiser access');
 expect(organiserControls(makeCtx(new MemoryApi()).ctx,access,'admin').textContent).toContain('Nelson');
});
