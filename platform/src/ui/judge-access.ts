import type { RoleRow } from '../api';
import type { Route } from './router';
/** Separate operational/lead roles retain their explicitly assigned workspace. */
export function judgeOnly(roles: RoleRow[]): boolean {
  return roles.length>0 && roles.every(r=>r.role==='judge');
}
export function judgePageAllowed(roles: RoleRow[], page: Route['name']): boolean {
  return !judgeOnly(roles) || ['event','score','scorecard','inspection','scores'].includes(page);
}
