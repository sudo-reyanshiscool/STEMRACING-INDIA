interface TeamResult {rank:number;teamId:string;number:string;name:string;total:number;penalties:number;subtotal:number;areas:Record<string,number|null>}
export interface ReportArea {id:string;name:string;max:number;categoryId?:string;panel?:string|null;criteria:Array<{id:string;name:string;max:number;bands?:Array<{min:number;max:number;description?:string}>}>}
export interface Benchmark {low:number;median:number;high:number}
export interface ReportRace {number:number;label:string;phase:string;lane:number;car:string;status:string;totalMs:number|null;reactionMs:number|null}
export interface ResultsPacket {
 released?:boolean;awardsConfirmed?:boolean;eventName:string;eventId:string;snapshotId:string;createdAt:string;ruleset:{id:string;categories?:Array<{id:string;name:string}>;areas:ReportArea[]};
 team:{id:string;number:string;name:string;school:string};teamResult:TeamResult;
 standings:Array<{rank:number;teamId:string;number:string;name:string;total:number}>;
 awards:Array<{title:string;teamNumber:string;teamName:string}>;
 cards:Array<{areaId:string;scores:Record<string,number>;feedback:{overall:string|null;strengths:string|null;improvements:string|null}}>;
 penalties:Array<{points:number;reason:string}>;
 inspections:Array<{car:string;rulesetId?:string;measurements:Record<string,number|boolean|Record<string,number|boolean>>}>;
 benchmarks?:Record<string,Benchmark>;races?:ReportRace[];
}
