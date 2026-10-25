import {describe,it,expect} from 'vitest';
import {judgeOnly,judgePageAllowed} from '../../src/ui/judge-access';
import type {RoleRow} from '../../src/api';
const role=(role:RoleRow['role']):RoleRow=>({id:role,eventId:'e',userId:'judge',role,panel:null,teamId:null,email:null});
describe('judge workspace',()=>{
 it('permits only the three sections and their scorecard/inspection detail pages',()=>{
  const roles=[role('judge')];expect(judgeOnly(roles)).toBe(true);
  for(const page of ['event','score','scorecard','inspection','scores'] as const)expect(judgePageAllowed(roles,page)).toBe(true);
  for(const page of ['teams','people','draw','communications','racing','moderate','rankings','team-files','team-feedback','results'] as const)expect(judgePageAllowed(roles,page)).toBe(false);
 });
 it('preserves separately assigned operational and leadership responsibilities',()=>{
  for(const name of ['organiser','chair','lead_judge','race_official','scrutineer'] as const)expect(judgeOnly([role('judge'),role(name)])).toBe(false);
 });
});
