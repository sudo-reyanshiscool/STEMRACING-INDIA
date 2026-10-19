export interface TeamContact {teamId:string;managerEmail:string}
export interface EventAward {id:string;title:string;teamId:string}
export interface ResultMailState {
 confirmed:boolean;version:string|null;snapshotId:string|null;awards:EventAward[];
 deliveries:Array<{teamId:string;email:string;status:'sending'|'sent'|'failed'|'uncertain';sentAt:string|null}>;
}
export type {ResultsPacket} from '../../supabase/functions/_shared/results-packet.ts';

export interface ResultMailSelection {snapshotId:string;awardsVersion:string;email:string}
