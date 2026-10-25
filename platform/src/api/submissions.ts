import {ApiError} from './types';
import type {TeamFileKind} from './team-files';
export type PortfolioKind=Exclude<TeamFileKind,'logo'>;
export const PORTFOLIOS:PortfolioKind[]=['design_portfolio','enterprise_portfolio','project_portfolio'];
export interface SubmissionRule {kind:PortfolioKind;deadline:string|null;pointsPerHour:number}
export interface SubmissionRow {teamId:string;kind:PortfolioKind;submittedAt:string|null;deadline:string|null;points:number;status:'not_open'|'pending'|'overdue'|'on_time'|'late'}
export interface SubmissionState {revision:number;rules:SubmissionRule[];rows:SubmissionRow[]}
export function validateSubmissionRules(rules:SubmissionRule[]) {
 if(rules.length!==3||new Set(rules.map(r=>r.kind)).size!==3||rules.some(r=>!PORTFOLIOS.includes(r.kind)||!Number.isFinite(r.pointsPerHour)||r.pointsPerHour<0||r.pointsPerHour>1000||Math.round(r.pointsPerHour*10)!==r.pointsPerHour*10||(r.deadline!==null&&!Number.isFinite(Date.parse(r.deadline)))))throw new ApiError('invalid','Set a valid deadline and hourly penalty for each portfolio.');
}
export function submissionRow(teamId:string,rule:SubmissionRule,submittedAt:string|null,now=Date.now()):SubmissionRow {
 const late=rule.deadline?Math.max(0,(submittedAt?Date.parse(submittedAt):now)-Date.parse(rule.deadline)):0;
 return {teamId,kind:rule.kind,submittedAt,deadline:rule.deadline,points:Math.round(Math.ceil(late/3600000)*rule.pointsPerHour*10)/10,status:!rule.deadline?'not_open':submittedAt?(late?'late':'on_time'):(late?'overdue':'pending')};
}
