interface TeamResult {rank:number;teamId:string;number:string;name:string;total:number;penalties:number;subtotal:number;areas:Record<string,number|null>}
export interface ResultsPacket {
 released?:boolean;awardsConfirmed?:boolean;eventName:string;eventId:string;snapshotId:string;createdAt:string;ruleset:{id:string;areas:Array<{id:string;name:string;max:number;criteria:Array<{id:string;name:string;max:number}>}>};
 team:{id:string;number:string;name:string;school:string};teamResult:TeamResult;
 standings:Array<{rank:number;teamId:string;number:string;name:string;total:number}>;
 awards:Array<{title:string;teamNumber:string;teamName:string}>;
 cards:Array<{areaId:string;scores:Record<string,number>;feedback:{overall:string|null;strengths:string|null;improvements:string|null}}>;
 penalties:Array<{points:number;reason:string}>;
 inspections:Array<{car:string;measurements:Record<string,number|boolean|Record<string,number|boolean>>}>;
}
