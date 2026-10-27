import { parseLessonNumber, type LessonPose } from "./curriculum";
import type { CoordinateMode } from "./coordinateLearning";

export const LIFT_START = {x:300,y:-50,z:20};
export const LIFT_GOAL = {...LIFT_START,z:60};
// The final transfer task changes the starting height so students must re-derive ΔZ.
export const TRANSFER_START = {...LIFT_START,z:30};
export const TRANSFER_GOAL = {...TRANSFER_START,z:60};
export type LiftResult = {
  id:string; mode:CoordinateMode; startedAt:string; finishedAt?:string;
  from:LessonPose; target:LessonPose; observed?:LessonPose;
  status:"running"|"completed"|"stopped"|"rejected"; message?:string;
};
export type LiftTrial = {
  id:string; submittedAt:string; commands:{absolute:string;relative:string};
  revisionReason:string; results:LiftResult[];
};
export type TransferLearningRecord = {
  id:string; pairId:string; source:"dt"; explanationReview:"teacher";
  explanations:{submittedAt:string;text:string}[]; trials:LiftTrial[]; completedAt?:string;
};
const close=(a:number,b:number)=>Number.isFinite(a)&&Math.abs(a-b)<=0.1;
export function liftTarget(from:LessonPose,mode:CoordinateMode,raw:string):LessonPose|null {
  const n=parseLessonNumber(raw);
  return n===null?null:{...from,z:mode==="absolute"?n:from.z+n};
}
export function liftTrialResult(trial:LiftTrial,start:Pick<LessonPose,"x"|"y"|"z">=LIFT_START,goal:Pick<LessonPose,"x"|"y"|"z">=LIFT_GOAL) {
  const last=(mode:CoordinateMode)=>trial.results.filter(r=>r.mode===mode).at(-1);
  const absolute=last("absolute"),relative=last("relative");
  const done=(r:LiftResult|undefined)=>r?.status==="completed"&&!!r.observed;
  const valid=(r:LiftResult|undefined,mode:CoordinateMode)=>{
    if(!done(r)||!r)return false;
    const commanded=liftTarget(r.from,mode,trial.commands[mode]);
    return !!commanded&&["x","y","z"].every(k=>{
      const a=k as "x"|"y"|"z";
      return close(r.from[a],start[a])&&close(r.observed![a],goal[a])&&close(r.target[a],commanded[a])&&close(r.target[a],goal[a]);
    })&&close(r.observed!.r,r.from.r)&&close(r.target.r,r.from.r);
  };
  const observed=!!done(absolute)&&!!done(relative);
  return {absolute,relative,observed,correct:observed&&valid(absolute,"absolute")&&valid(relative,"relative")};
}
export function transferLearningComplete(record:TransferLearningRecord|undefined,start:Pick<LessonPose,"x"|"y"|"z">=LIFT_START,goal:Pick<LessonPose,"x"|"y"|"z">=LIFT_GOAL) {
  return !!record&&record.source==="dt"&&record.explanations.some(e=>e.text.trim())
    &&!!record.trials.length&&liftTrialResult(record.trials.at(-1)!,start,goal).correct;
}
export function liftFeedback(trial:LiftTrial,start:Pick<LessonPose,"x"|"y"|"z">=LIFT_START,goal:Pick<LessonPose,"x"|"y"|"z">=LIFT_GOAL):string[] {
  const analysis=liftTrialResult(trial,start,goal);
  if(!analysis.observed)return [];
  return (["absolute","relative"] as const).flatMap(mode=>{
    const r=analysis[mode]!,z=r.observed!.z,gap=z-goal.z;
    if(Math.abs(gap)<=0.1)return [];
    const relation=mode==="absolute"
      ?`절대 명령 Z=${trial.commands[mode]}는 도착 높이를 직접 정합니다.`
      :`상대 명령은 출발 Z=${r.from.z.toFixed(2)}에 ΔZ=${trial.commands[mode]}를 더합니다.`;
    return [`${relation} DT 도착 Z=${z.toFixed(2)}는 목표 ${goal.z.toFixed(2)}보다 ${Math.abs(gap).toFixed(2)} mm ${gap>0?"높습니다":"낮습니다"}. ${mode==="absolute"?"목표 위치와 상승량을 구분해 절대 Z를 다시 정하세요.":"목표 높이 − 출발 높이로 필요한 상승량을 다시 구하세요."}`];
  });
}
