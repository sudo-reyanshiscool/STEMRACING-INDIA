// @vitest-environment jsdom
import {it,expect} from 'vitest';
import {MemoryApi} from '../../src/api';
import {organiserControls} from '../../src/ui/organisers';
import {makeCtx} from './helpers';
it('shows the organiser name when their email is hidden',()=>{
 const el=organiserControls(makeCtx(new MemoryApi()).ctx,{kind:'admin',ownerEmail:'owner@x.test',canManage:true,invitations:[],organisers:[{userId:'nelson',name:'Nelson',email:null,emailHidden:true,scope:'platform',permanent:false}]});
 expect(el.textContent).toContain('Nelson');expect(el.textContent).toContain('Email hidden');expect(el.textContent).toContain('Platform Organiser');
});
