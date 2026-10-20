import type {ConflictRow,JudgeExemption,Panel,RoleRow,TeamRow} from './types';
export interface DrawLotsState {
 version:string;teams:TeamRow[];roles:RoleRow[];conflicts:ConflictRow[];exemptions:JudgeExemption[];
 released:boolean;numberingLocked:boolean;lockedPanels:Panel[];
}
export interface TeamNumberAssignment {teamId:string;number:string}
export interface JudgeLotAssignment {judgeId:string;teamIds:string[]}
