import { POSE_AXES, parseLessonNumber, translatePose, type LessonPose } from "./curriculum";
import { axisLearningMode, observedAxisChanges, type Axis, type AxisTask, type AxisAttempt,
  type AxisCommand, type AxisErrorKind, type AxisRevision, type AxisRelationReview, type AxisTaskRecord, type AxisLessonVisual } from "./axisLesson";

export type AxisDelta = Record<Axis,number>;
export type AxisDeltaDraft = Record<Axis,string>;
export type AxisCondition = {
  id: string; goal: AxisTask; reference: AxisCommand & { distance:number }; prompt: string;
  relation: string; options: {value:string;label:string}[]; hint: string;
};
const option=(value:string,label:string)=>({value,label});
export function axisCondition(task:AxisTask):AxisCondition {
  const reference={axis:task.axis,sign:task.sign,distance:task.distance};
  const sameHalf=[option("position-half","도착 좌표 자체가 절반이 된다"),option("same-half","이동 방향은 같고, 이동 거리는 절반이다"),option("opposite-half","이동 방향은 반대이고, 이동 거리는 절반이다")];
  const data:Record<string,Omit<AxisCondition,"id"|"goal"> & {distance?:number}>={
    "x-plus":{reference,prompt:"+X 방향 50 mm 이동에서 거리만 절반으로 줄입니다. 같은 출발점에서 새 이동을 예측하세요.",distance:25,
      relation:"same-half",options:sameHalf,hint:"거리만 줄이면 이동 축과 +방향은 유지됩니다. 도착 위치 자체와 이동한 거리를 구분하세요. 한 축과 평행한 이동에서 다른 좌표의 변화량은 0입니다."},
    "y-minus":{reference:{...reference,distance:80},prompt:"−Y 방향 80 mm 이동에서 거리만 절반으로 줄입니다. 축과 방향은 그대로입니다.",
      relation:"same-half",options:sameHalf,hint:"음수 방향도 거리는 양의 크기로 비교합니다. 거리의 크기가 줄어든다고 증가 방향으로 바뀌지는 않습니다."},
    "z-plus":{reference:{...reference,distance:15},prompt:"+Z 방향 15 mm 이동에서 거리만 두 배로 늘립니다. 축과 방향은 그대로입니다.",
      relation:"same-double",options:[option("position-double","출발 좌표와 도착 좌표가 모두 두 배이다"),option("opposite-double","이동 방향은 반대이고, 이동 거리는 두 배이다"),option("same-double","이동 방향은 같고, 이동 거리는 두 배이다")],
      hint:"두 배가 되는 것은 출발 위치가 아니라 이동 거리입니다. 높이 변화와 나머지 좌표를 나누어 생각하세요."},
    "x-minus":{reference:{...reference,sign:1},prompt:"+X 방향 50 mm 이동에서 방향만 반대로 바꿉니다. 같은 출발점에서 거리는 유지합니다.",
      relation:"opposite-same",options:[option("opposite-same","이동 방향은 반대이고, 이동 거리는 같다"),option("axis-other","이동하는 축이 Y축으로 바뀐다"),option("same-same","이동 방향과 이동 거리가 모두 같다")],
      hint:"반대 방향은 다른 축이라는 뜻이 아닙니다. 같은 축에서 +방향과 −방향을 비교하세요."},
    "y-plus":{reference:{...reference,axis:"x"},prompt:"+X 방향 40 mm 이동에서 이동 축만 Y축으로 바꿉니다. +방향과 거리는 유지합니다.",
      relation:"axis-only",options:[option("both-axes","X와 Y가 모두 같은 양만큼 변한다"),option("axis-only","이동 축만 X에서 Y로 바뀌고, 이동 거리는 같다"),option("distance-double","이동 거리가 두 배가 된다")],
      hint:"기존 X 이동에 Y 이동을 더하는 조건인지, 이동 축을 Y로 바꾸는 조건인지 구분하세요."},
    "z-minus":{reference,prompt:"목표: X·Y는 유지하고 Z만 30 mm 감소시키세요. 이동 축·방향·거리를 직접 정하고, 내 명령의 결과를 예측하세요.",
      relation:"parallel",options:[option("one-joint","관절 하나만 회전시키면 X·Y 좌표는 유지된다"),option("camera","카메라 시점만 고정하면 X·Y 좌표는 유지된다"),option("parallel","Z축과 평행하게 이동하면 X·Y 좌표는 유지된다")],
      hint:"바꾸려는 좌표의 이름으로 축을 고르고, 증가·감소로 부호를 고르세요. 마지막으로 이동 거리의 크기를 확인하세요."},
    "independent-y-minus":{reference:{axis:"y",sign:1,distance:50},prompt:"같은 출발점에서 +Y 방향 50 mm 이동을 바꿉니다. 방향은 반대로, 거리는 절반으로 바꾸면 세 좌표는 얼마나 변할까요?",
      relation:"opposite-half",options:[option("same-half","이동 방향은 같고, 이동 거리는 절반이다"),option("opposite-half","이동 방향은 반대이고, 이동 거리는 절반이다"),option("opposite-double","이동 방향은 반대이고, 이동 거리는 두 배이다")],
      hint:""},
  };
  const chosen=data[task.id];
  if(!chosen)throw new Error(`Unknown axis task: ${task.id}`);
  return {id:`${task.id}:condition-v1`,...chosen,goal:{...task,distance:chosen.distance??task.distance}};
}
export const blankAxisDelta=():AxisDeltaDraft=>({x:"",y:"",z:""});
export function readAxisDelta(draft:AxisDeltaDraft):AxisDelta|null {
  const values=POSE_AXES.map(a=>parseLessonNumber(draft[a]));
  return values.some(v=>v===null)?null:{x:values[0]!,y:values[1]!,z:values[2]!};
}
export const axisNumericEndpoint=(from:LessonPose,delta:AxisDelta|null)=>delta?translatePose(from,delta):null;
export function axisExecutionCommand(condition:AxisCondition,command:AxisCommand|null) {
  const chosen=condition.goal.reverse?command:condition.goal;
  if(!chosen||!POSE_AXES.includes(chosen.axis)||![1,-1].includes(chosen.sign)
    || !Number.isFinite(chosen.distance)||chosen.distance!<=0)return null;
  return {axis:chosen.axis,sign:chosen.sign,distance:chosen.distance!};
}
export function makeAxisNumericAttempt(task:AxisTask,from:LessonPose,input:{
  draft:AxisDeltaDraft;relation:string;explanation:string;command:AxisCommand|null;view:string;hints:number;supportIds:string[];revision?:AxisRevision;
}):AxisAttempt|null {
  const condition=axisCondition(task),delta=readAxisDelta(input.draft),command=axisExecutionCommand(condition,input.command);
  if(!delta||!command||!condition.options.some(o=>o.value===input.relation)
    || (axisLearningMode(task)==="independent"&&!input.explanation.trim()))return null;
  const to=translatePose(from,{x:0,y:0,z:0,[command.axis]:command.sign*command.distance});
  const expected=axisNumericEndpoint(from,delta)!;
  return {id:globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random()}`,submittedAt:new Date().toISOString(),
    from:{...from},to,prediction:observedAxisChanges(from,expected),command:{...command},view:input.view,
    reasoning:input.explanation.trim(),supportIds:[...input.supportIds],numeric:{version:1,conditionId:condition.id,delta:{...delta},relation:input.relation,
      hints:input.hints,...(input.revision?{revision:structuredClone(input.revision)}:{})}};
}
const near=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<0.01;
export function diagnoseAxisNumeric(task:AxisTask,attempt:AxisAttempt):AxisErrorKind[] {
  if(!attempt.numeric)return [];
  const condition=axisCondition(task),errors=new Set<AxisErrorKind>();
  const observed={x:attempt.to.x-attempt.from.x,y:attempt.to.y-attempt.from.y,z:attempt.to.z-attempt.from.z};
  const compare=(actual:AxisDelta,claimed:AxisDelta)=>{
    for(const a of POSE_AXES){
      if((near(actual[a],0))!==(near(claimed[a],0)))errors.add("axis");
      else if(!near(actual[a],0)&&Math.sign(actual[a])!==Math.sign(claimed[a]))errors.add("sign");
      if(!near(actual[a],0)&&!near(claimed[a],0)&&!near(Math.abs(actual[a]),Math.abs(claimed[a])))errors.add("distance");
    }
  };
  compare(observed,attempt.numeric.delta);
  // A correctly predicted wrong reverse command still fails the target condition.
  const goal={x:0,y:0,z:0,[condition.goal.axis]:condition.goal.sign*condition.goal.distance};
  compare(goal,observed);
  if(attempt.numeric.relation!==condition.relation)errors.add("relation");
  return [...errors];
}
export const AXIS_ERROR_LABEL:Record<AxisErrorKind,string>={axis:"변하는 축·유지되는 좌표",sign:"증가·감소의 부호",distance:"이동 거리의 크기",relation:"이동 방향·거리·방법의 설명"};
export const AXIS_ERROR_FEEDBACK:Record<AxisErrorKind,string>={
  axis:"변화량이 0인 축과 0이 아닌 축을 비교하세요. 역방향 문제에서는 내가 고른 명령이 목표 축과 일치하는지도 확인하세요.",
  sign:"변하는 축이 같아도 +와 −가 다를 수 있습니다. 기준축의 +방향과 이동 방향을 비교하세요.",
  distance:"부호와 축이 맞아도 거리의 크기가 다를 수 있습니다. 절반·두 배 조건과 변화량의 절댓값을 비교하세요.",
  relation:"거리, 방향, 이동 축 중 바뀐 조건을 구분하세요. 도착 좌표 자체와 이동한 거리는 다릅니다.",
};
export function axisDiagnosisMatches(expected:AxisErrorKind[],selected:AxisErrorKind[]) {
  const unique=new Set(selected);return expected.length>0&&unique.size===expected.length&&expected.every(k=>unique.has(k));
}

/** Distinguish matching a prediction from satisfying the task and its explanation. */
export function axisComparisonStatus(task:AxisTask,attempt:AxisAttempt) {
  if (!attempt.numeric) return null;
  const condition=axisCondition(task), goal=condition.goal;
  return {
    prediction: POSE_AXES.every(a=>near(attempt.numeric!.delta[a],attempt.to[a]-attempt.from[a])),
    target: POSE_AXES.every(a=>near(attempt.to[a]-attempt.from[a],a===goal.axis?goal.sign*goal.distance:0)),
    relation: attempt.numeric.relation===condition.relation,
  };
}

export function axisConditionSummary(task:AxisTask):string {
  const summaries:Record<string,string>={
    "x-plus":"거리만 절반 · +X 방향 유지",
    "y-minus":"거리만 절반 · −Y 방향 유지",
    "z-plus":"거리만 두 배 · +Z 방향 유지",
    "x-minus":"방향만 반대 · X축과 거리 유지",
    "y-plus":"이동 축만 X → Y · +방향과 거리 유지",
    "z-minus":"Z만 30 mm 감소 · X·Y 유지",
    "independent-y-minus":"방향은 반대 · 거리는 절반 · Y축 유지",
  };
  return summaries[task.id]??axisCondition(task).prompt;
}
/** Before execution show the condition, never fill in the learner's numeric answer.
 * After execution compare the reference with observed movement, not P with D. */
export function axisRelationContext(task:AxisTask,attempt?:AxisAttempt) {
  const condition=axisCondition(task);
  const observed=attempt?.numeric?.conditionId===condition.id&&attempt.numeric.executedAt?attempt:null;
  const movement=(axis:Axis,sign:number,distance:number)=>`${sign>0?"+":"−"}${axis.toUpperCase()} 방향으로 ${Number(distance.toFixed(2))} mm`;
  const actual=observed?POSE_AXES.flatMap(axis=>{
    const delta=observed.to[axis]-observed.from[axis];
    return Math.abs(delta)<0.01?[]:[movement(axis,Math.sign(delta),Math.abs(delta))];
  }).join(" · ")||"이동 없음":null;
  if(task.reverse)return {
    question:"Z만 바꾸고 X·Y를 유지하려면, 어떤 방식으로 이동해야 하나요?",
    caption:"목표와 이번 이동",
    rows:[{label:"목표",value:"X·Y 유지 · Z만 30 mm 감소"},
      {label:observed?"이번 이동 (DT)":"내가 정할 이동",value:actual??"목표에 맞는 이동 축·방향·거리를 직접 선택"}],
    feedback:"X·Y를 그대로 두고 Z만 바꾸려면 어느 기준축과 평행하게 이동해야 하는지 다시 생각해 보세요.",
  };
  const quantities=task.id==="y-plus"?"축과 거리":"방향과 거리";
  const reference=movement(condition.reference.axis,condition.reference.sign,condition.reference.distance);
  return {
    question:`기존 이동과 비교하면, 이번 이동의 ${quantities}는 어떻게 ${observed?"달라졌나요":"달라지나요"}?`,
    caption:"같은 출발점에서의 이동 비교",
    rows:[{label:"기존 이동 (비교 기준)",value:reference},
      {label:observed?"이번 이동 (DT)":"이번 이동 조건",value:actual??axisConditionSummary(task)}],
    feedback:`${actual?`기존 ${reference}와 이번 ${actual}를`:"위의 기존 이동과 이번 이동 조건을"} 비교하세요. ${task.id==="y-plus"?"어느 축으로 이동하는지와 이동 거리가 같은지":"이동 방향이 같은지와 이동 거리가 몇 배인지"} 다시 확인하세요.`,
  };
}
/** Reuse completed execution evidence only when its sole error is the relation choice. */
export function canReviewAxisRelation(task:AxisTask,attempt:AxisAttempt):boolean {
  const comparison=axisComparisonStatus(task,attempt);
  return !!attempt.id&&!!attempt.numeric?.executedAt&&!!comparison?.prediction&&comparison.target&&!comparison.relation;
}
/** Original executions stay immutable. An optional relation review is separate evidence. */
export function completeAxisNumeric(task:AxisTask,history:AxisAttempt[],relationReview?:AxisRelationReview):AxisTaskRecord|null {
  const condition=axisCondition(task),attempts=history.filter(a=>a.numeric?.conditionId===condition.id),last=attempts.at(-1);
  if(!last||!last.numeric)return null;
  if(relationReview){
    if(!canReviewAxisRelation(task,last)||relationReview.of!==last.id||!relationReview.submittedAt
      ||relationReview.relation!==condition.relation
      ||(axisLearningMode(task)==="independent"&&!relationReview.explanation.trim()))return null;
  }else if(diagnoseAxisNumeric(task,last).length)return null;
  if(attempts.some((a,i)=>{
    if(!a.numeric?.executedAt||!a.id||!a.submittedAt||!POSE_AXES.every(k=>Number.isFinite(a.numeric!.delta[k])))return true;
    const command=axisExecutionCommand(condition,a.command??null);if(!command)return true;
    const end=translatePose(a.from,{x:0,y:0,z:0,[command.axis]:command.sign*command.distance});
    if(![...POSE_AXES,"r" as const].every(k=>near(a.to[k],end[k])))return true;
    if(axisLearningMode(task)==="independent"&&(!a.reasoning?.trim()||a.numeric.hints!==0))return true;
    const previous=attempts[i-1];if(!previous)return false;
    const issues=diagnoseAxisNumeric(task,previous);if(!issues.length)return false;
    const revision=a.numeric.revision;
    return !revision||revision.of!==previous.id||!axisDiagnosisMatches(issues,revision.kinds)
      || (axisLearningMode(task)==="independent"&&!revision.explanation.trim());
  }))return null;
  const firstMatch=diagnoseAxisNumeric(task,attempts[0]).length===0;
  return {taskId:task.id,source:"dt",mode:axisLearningMode(task),numericVersion:1,attempts:structuredClone(attempts),
    reasonAttempts:attempts.length+(relationReview?1:0),transferAttempts:0,transferView:task.view,transferPrediction:{...last.prediction},
    correctionPrediction:{...last.prediction},explanation:relationReview?.explanation||last.reasoning,explanationReview:"teacher",
    independentResult:firstMatch&&!relationReview?"first-match":"revised",
    ...(relationReview?{relationReview:structuredClone(relationReview)}:{})};
}

export const axisPointOffset=(from:LessonPose,to:LessonPose):[number,number,number]=>[to.x-from.x,to.z-from.z,-(to.y-from.y)];
export function axisComparisonPoints(visual:AxisLessonVisual) {
  const from=visual.from;
  if(!from)return [];
  const points:{id:string;label:string;color:string;position:[number,number,number]}[]=[{id:"a",label:"A 출발",color:"#475569",position:[0,0,0]}];
  // Independent predictions appear only after commitment. Never create a goal/answer point.
  if(visual.predictedEnd&&(!visual.independent||visual.started))points.push({id:"p",label:"P 내 예상",color:"#9333ea",position:axisPointOffset(from,visual.predictedEnd)});
  if(visual.result)points.push({id:"d",label:"D DT 결과",color:"#0f766e",position:axisPointOffset(from,visual.result.to)});
  return points;
}

/** Presentation only: preserve separate P/D evidence and merge coincident labels. */
export function axisDisplayPoints(visual:AxisLessonVisual) {
  let points=axisComparisonPoints(visual);
  if(visual.started&&!visual.result) return []; // Follow the moving TCP without label clutter.
  if(visual.result&&visual.predictedEnd&&POSE_AXES.every(a=>near(visual.predictedEnd![a],visual.result!.to[a]))) {
    points=points.filter(p=>p.id!=="p").map(p=>p.id==="d"?{...p,label:"P = D 예상·결과"}:p);
  }
  if(!visual.scenePoint||!visual.from) return points;
  const origin=visual.scenePoint(visual.from);
  if(!origin) return [];
  return points.flatMap(p=>{
    const pose=p.id==="a"?visual.from!:p.id==="p"?visual.predictedEnd!:visual.result!.to;
    const projected=visual.scenePoint!(pose);
    // An unreachable learner prediction remains in the table, never clamped to a fake point.
    return projected?[{...p,position:projected.map((v,i)=>v-origin[i]) as [number,number,number]}]:[];
  });
}
