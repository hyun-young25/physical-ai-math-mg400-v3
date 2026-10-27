import { POSE_AXES, translatePose, type LessonPose } from "./curriculum";
import { readCoordinateVector, type CoordinateMode, type CoordinateVector } from "./coordinateLearning";

export type ApplicationTask = "position" | "transfer";
export type ApplicationStep = { label:string; target:CoordinateVector; action:"move"|"grip"|"release" };
export const APPLICATION_START = {x:250,y:50,z:60};
export const APPLICATION_PICK = {x:300,y:-50,z:20};
export const APPLICATION_PLACE = {x:300,y:50,z:0};
export const APPLICATION_STEPS:Record<ApplicationTask,ApplicationStep[]> = {
  position:[{label:"목표 좌표로 이동",target:{x:300,y:-50,z:30},action:"move"}],
  transfer:[
    {label:"물체 위로 접근",target:{...APPLICATION_PICK,z:60},action:"move"},
    {label:"물체 윗면까지 내려가기",target:APPLICATION_PICK,action:"move"},
    {label:"물체 흡착",target:APPLICATION_PICK,action:"grip"},
    {label:"물체를 40 mm 들어 올리기",target:{...APPLICATION_PICK,z:60},action:"move"},
    {label:"놓을 위치 위로 이동",target:{...APPLICATION_PLACE,z:60},action:"move"},
    {label:"작업면에 내려놓기",target:APPLICATION_PLACE,action:"move"},
    {label:"흡착 해제",target:APPLICATION_PLACE,action:"release"},
    {label:"흡착기를 60 mm 올리기",target:{...APPLICATION_PLACE,z:60},action:"move"},
  ],
};
export type ApplicationEntry = {
  id:string; step:number; submittedAt:string; action:ApplicationStep["action"];
  from:LessonPose; target:CoordinateVector; mode?:CoordinateMode; argument?:CoordinateVector; to?:LessonPose;
  status:"running"|"reached"|"missed"|"rejected"|"stopped"; message?:string;
};
export type ApplicationRecord = {
  id:string; task:ApplicationTask; source:"dt"; startedAt:string; from:LessonPose;
  entries:ApplicationEntry[]; completed:boolean; goal?:CoordinateVector;
  pairId?:string; requiredMode?:CoordinateMode;
};
export const applicationId=()=>globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random()}`;
export const applicationMatches=(a:CoordinateVector,b:CoordinateVector)=>POSE_AXES.every(k=>Number.isFinite(a[k])&&Number.isFinite(b[k])&&Math.abs(a[k]-b[k])<=0.1);
export function applicationTarget(from:LessonPose,mode:CoordinateMode,raw:Record<keyof CoordinateVector,string>):LessonPose|null {
  const value=readCoordinateVector(raw);
  if(!value||!["absolute","relative"].includes(mode))return null;
  return mode==="absolute"?{...value,r:from.r}:translatePose(from,value);
}
export function applicationPathError(task:ApplicationTask,from:LessonPose,to:LessonPose,attached:boolean):string|null {
  if(task!=="transfer")return null;
  if(Math.min(from.z,to.z)<-0.1)return "이 실습에서는 작업면 Z=0 아래로 이동할 수 없습니다.";
  const horizontal=Math.hypot(to.x-from.x,to.y-from.y)>0.1;
  if(attached&&horizontal&&Math.min(from.z,to.z)<59.9)return "물체를 먼저 Z=60 mm까지 들어 올린 뒤 수평으로 옮기세요.";
  return null;
}
export function applicationRepresentation(record:ApplicationRecord):string {
  const modes=new Set(record.entries.filter(e=>e.action==="move"&&["reached","missed","stopped"].includes(e.status)).map(e=>e.mode));
  return modes.size===0?"이동 전":modes.size>1?"절대·상대 혼합":modes.has("absolute")?"모두 절대":"모두 상대";
}

/** A free or partial run must never count as one of the two assigned methods. */
export function completedTransferRun(record:ApplicationRecord,mode:CoordinateMode):boolean {
  if(record.task!=="transfer"||record.source!=="dt"||!record.completed||!record.pairId||record.requiredMode!==mode
    ||!applicationMatches(record.from,APPLICATION_START))return false;
  if(record.entries.some(e=>e.action==="move"&&e.mode!==mode))return false;
  const reached=record.entries.filter(e=>e.status==="reached");
  return reached.length===APPLICATION_STEPS.transfer.length&&reached.every((entry,i)=>{
    const step=APPLICATION_STEPS.transfer[i];
    return entry.step===i&&entry.action===step.action&&applicationMatches(entry.target,step.target)
      &&applicationMatches(entry.action==="move"?entry.to??{x:NaN,y:NaN,z:NaN}:entry.from,step.target);
  });
}
export function transferPair(records:ApplicationRecord[],pairId:string) {
  const completed=(mode:CoordinateMode)=>records.filter(r=>r.pairId===pairId&&completedTransferRun(r,mode)).at(-1);
  const absolute=completed("absolute"),relative=completed("relative");
  const rows=absolute&&relative?APPLICATION_STEPS.transfer.map((step,i)=>({step,
    absolute:absolute.entries.find(e=>e.step===i&&e.status==="reached")!,
    relative:relative.entries.find(e=>e.step===i&&e.status==="reached")!,
  })):[];
  return {absolute,relative,rows,complete:!!absolute&&!!relative};
}
