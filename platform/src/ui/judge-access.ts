import type { RoleRow } from '../api';
import type { Route } from './router';
/** Accounts with only judging roles share a compact workspace; leads also have Moderation. */
export function judgeOnly(roles: RoleRow[]): boolean {
  return roles.length>0 && roles.every(r=>r.role==='judge'||r.role==='lead_judge');
}
export function judgePageAllowed(roles: RoleRow[], page: Route['name']): boolean {
  return !judgeOnly(roles) || ['event','score','scorecard','inspection','scores','results'].includes(page) || (page==='moderate'&&roles.some(r=>r.role==='lead_judge'));
}
