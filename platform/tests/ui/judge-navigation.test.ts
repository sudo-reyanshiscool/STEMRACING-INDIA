// @vitest-environment jsdom
import {it,expect} from 'vitest';
import {eventNav} from '../../src/ui/event-nav';
import {EMAILS,world} from './helpers';
it('matches the requested four-tab judge navigation before and after results release',async()=>{
 const {api,ev}=await world();await api.signIn(EMAILS.judge);const roles=await api.myRoles(ev.id);
 for(const released of [false,true]){
  const nav=eventNav({...ev,resultsReleased:released},roles,'scores');
  expect([...nav.querySelectorAll('a')].map(a=>a.textContent)).toEqual(['Event','My scorecards','Scores','Results']);
 }
});

it('keeps Moderation as the fourth tab for Lead Judges',async()=>{const {api,ev}=await world();await api.signIn(EMAILS.lead);const nav=eventNav(ev,await api.myRoles(ev.id),'moderate');expect([...nav.querySelectorAll('a')].map(a=>a.textContent)).toEqual(['Event','My scorecards','Scores','Moderation','Results']);});
