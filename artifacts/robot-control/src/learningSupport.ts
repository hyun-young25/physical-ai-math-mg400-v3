import { POSE_AXES } from "./curriculum";
import { axisTarget, diagnoseAxisPrediction, type AxisAttempt, type AxisTask } from "./axisLesson";
import { diagnoseAxisNumeric } from "./axisReasoning";
import { analyzeCoordinateAttempt, coordinateExpected, type CoordinateAttempt, type CoordinateTask } from "./coordinateLearning";
import { analyzeStrategyAttempt, type CoordinateScenario, type StrategyAttempt } from "./coordinateStrategies";

export type LearningError = "axis" | "sign" | "distance" | "fixed" | "reference" | "accumulation" | "prediction" | "condition";
export type ErrorEvent = { id:string; errors:LearningError[] };
export type SupportResponse = { submittedAt:string; round:number; condition:string; answers:Record<string,string>; correct:boolean };
export type SupportRecord = {
  id:string; lesson:"2-1"|"2-2"; taskId:string; error:LearningError; triggerIds:string[]; openedAt:string;
  status:"practice"|"check"|"complete"; practice:SupportResponse[]; checks:SupportResponse[];
};
export type SupportProps = { supportRecords:SupportRecord[]; onSupport:(record:SupportRecord)=>void };
export const ERROR_LABEL:Record<LearningError,string> = {
  axis:"변하는 축 찾기", sign:"증가·감소와 부호", distance:"이동 거리의 크기", fixed:"유지되는 좌표", reference:"위치와 변화량의 기준",
  accumulation:"연속 이동의 출발점", prediction:"명령과 예상 도착점", condition:"상황에서 유지할 조건",
};
export function axisErrorEvent(task:AxisTask,attempt:AxisAttempt,index:number):ErrorEvent {
  if(attempt.numeric)return {id:attempt.id??`${task.id}-${index}`,errors:diagnoseAxisNumeric(task,attempt).map(k=>k==="relation"?"condition":k)};
  const issues=diagnoseAxisPrediction(attempt.prediction,attempt.from,attempt.to).map(d=>d.kind);
  const errors:LearningError[]=issues.flatMap(k=>k==="missing"?["axis"]:k==="unanswered"?[]:[k]);
  if(task.reverse){
    const target=axisTarget(attempt.from,task);
    if(POSE_AXES.some(a=>Math.abs(target[a]-attempt.to[a])>0.01)) errors.push(attempt.command?.axis!==task.axis?"axis":"sign");
  }
  return {id:attempt.id??`${task.id}-${index}`,errors:[...new Set(errors)]};
}
export function coordinateErrorEvent(task:CoordinateTask,attempt:CoordinateAttempt):ErrorEvent {
  const a=analyzeCoordinateAttempt(task,attempt), errors:LearningError[]=[];
  // Submitted inputs, not blank drafts or repeated rendering, are evidence.
  for(const f of a.fields.filter(f=>!f.correct && f.value!==null)) {
    const delta=coordinateExpected(task).delta[f.axis];
    errors.push(f.field==="delta"&&delta!==0&&Math.abs(f.value!+delta)<0.01?"sign":"reference");
  }
  if(!a.comparisonCorrect)errors.push("prediction");
  if(!a.ruleCorrect)errors.push("condition");
  return {id:attempt.id,errors:[...new Set(errors)]};
}
export function strategyErrorEvent(task:CoordinateScenario,attempt:StrategyAttempt):ErrorEvent {
  const a=analyzeStrategyAttempt(task,attempt),errors:LearningError[]=[];
  for(const [i,row] of a.rows.entries())if(!row.correct)errors.push(i>0&&!task.steps[i].start?"accumulation":"reference");
  if(!a.requirementsCorrect)errors.push("condition");
  if(!a.predictionsCorrect)errors.push("prediction");
  return {id:attempt.id,errors:[...new Set(errors)]};
}
/** Two distinct submitted trials, after the last support for that error. */
export function supportTrigger(events:ErrorEvent[],records:SupportRecord[]) {
  const unique=[...new Map(events.map(e=>[e.id,e])).values()];
  for(const error of Object.keys(ERROR_LABEL) as LearningError[]) {
    const consumed=new Set(records.filter(r=>r.error===error).flatMap(r=>r.triggerIds));
    const ids=unique.filter(e=>e.errors.includes(error)&&!consumed.has(e.id)).map(e=>e.id);
    if(ids.length>=2)return {error,ids};
  }
  return null;
}
export function openSupport(lesson:SupportRecord["lesson"],taskId:string,trigger:{error:LearningError;ids:string[]}):SupportRecord {
  return {id:globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random()}`,lesson,taskId,error:trigger.error,
    triggerIds:[...trigger.ids],openedAt:new Date().toISOString(),status:"practice",practice:[],checks:[]};
}
type SupportField = {key:string;label:string;options?:{value:string;label:string}[]};
export type SupportProblem = {prompt:string;explanation:string;fields:SupportField[];expected:Record<string,string>};
/** Fresh checks use different conditions; a failed check advances again without giving its answer. */
export function supportProblem(error:LearningError,stage:"practice"|"check",round=0,lesson:SupportRecord["lesson"]="2-1"):SupportProblem {
  const n=stage==="practice"?0:round+1;
  const axes=["X","Y","Z"],axis=axes[n%3],sign=n%2===0?-1:1,distance=15+5*n;
  const axisOptions=axes.map(value=>({value,label:`${value}축`}));
  const signs=[{value:"1",label:"+ 방향"},{value:"-1",label:"− 방향"}];
  if(error==="distance"||(lesson==="2-1"&&error==="condition")) {
    const factor=n%2===0?0.5:2,changed=distance*factor;
    return {
      prompt:`${sign===1?"+":"−"}${axis} 방향 ${distance} mm 이동에서 거리만 ${factor===0.5?"절반":"두 배"}으로 바꿉니다. 이동 축과 방향은 유지합니다.`,
      explanation:"바뀌는 것은 이동 거리의 크기입니다. 축과 부호는 유지하고, 나머지 두 좌표의 변화량은 0입니다. 도착 좌표 자체를 절반이나 두 배로 만들지 않습니다.",
      fields:[{key:"distance",label:"새 이동 거리의 크기 (mm)"},{key:"delta",label:`Δ${axis} (mm)`},{key:"fixed",label:"나머지 두 좌표 각각의 변화량 (mm)"}],
      expected:{distance:String(changed),delta:String(sign*changed),fixed:"0"},
    };
  }
  if(error==="axis"||(error==="sign"&&lesson==="2-1")||error==="fixed")return {
    prompt:`${axis} 좌표만 ${distance} mm ${sign===1?"증가":"감소"}시키려 합니다. 이동 축·방향과 나머지 두 좌표의 변화량을 정하세요.`,
    explanation:error==="axis"?"화면의 가로·세로 대신 바꾸려는 좌표의 이름을 찾으세요. 그 이름의 로봇 기준축을 따라 이동합니다. 증가면 +, 감소면 −이며 다른 좌표는 유지됩니다."
      :error==="sign"?"축을 골랐다면 +축 화살표와 이동 방향을 비교하세요. 같은 방향이면 좌표가 증가하고 반대면 감소합니다. 다른 좌표는 유지됩니다."
      :"한 축과 평행한 이동에서는 나머지 두 좌표가 함께 변하지 않습니다. 변화량 0은 위치가 0이라는 뜻이 아니라 이동 전후 값이 같다는 뜻입니다.",
    fields:[{key:"axis",label:"이동 축",options:axisOptions},{key:"sign",label:"이동 방향",options:signs},{key:"fixed",label:"나머지 두 좌표 각각의 변화량 (mm)"}],
    expected:{axis,sign:String(sign),fixed:"0"},
  };
  const start=210+17*n,argument=35+7*n;
  if(error==="sign")return {
    prompt:`X=${start} mm에서 X=${start-argument} mm로 이동하려 합니다. 상대 이동의 ΔX를 구하세요.`,
    explanation:"변화량은 도착 위치 − 출발 위치입니다. 도착 위치가 작아지면 변화량은 음수입니다.",
    fields:[{key:"delta",label:"상대 이동 ΔX (mm)"}],expected:{delta:String(-argument)},
  };
  if(error==="accumulation")return {
    prompt:`X=${start} mm에서 상대 이동 ΔX=+${argument} mm를 두 번 연속 실행합니다. Y·Z는 유지합니다.`,
    explanation:"상대 이동은 실행 직전 위치에 변화량을 더합니다. 두 번째 명령의 출발점은 첫 번째 명령의 도착점입니다.",
    fields:[{key:"start2",label:"두 번째 이동 출발 X (mm)"},{key:"end2",label:"두 번째 이동 도착 X (mm)"}],
    expected:{start2:String(start+argument),end2:String(start+2*argument)},
  };
  if(error==="condition")return {
    prompt:`출발 X가 ${start}에서 ${start+40} mm로 달라져도 같은 작업대 X=${start+80} mm로 이동해야 합니다.`,
    explanation:"고정 작업대로 갈 때 절대 명령의 목표 위치는 유지됩니다. 상대 명령은 새로운 출발점에서 목표까지의 차이를 다시 구합니다.",
    fields:[{key:"absolute",label:"새 출발점에서 절대 명령 X (mm)"},{key:"relative",label:"새 출발점에서 상대 명령 ΔX (mm)"}],
    expected:{absolute:String(start+80),relative:"40"},
  };
  return {
    prompt:`매번 같은 출발 X=${start} mm에서 시작합니다. 절대 명령 X=${argument}와 상대 명령 ΔX=${argument}를 각각 실행할 때 도착 X를 구하세요. Y·Z는 유지합니다.`,
    explanation:"절대 명령의 숫자는 원점 기준 도착 위치입니다. 상대 명령의 숫자는 출발 위치에 더할 변화량입니다. 명령값과 도착값을 구분하세요.",
    fields:[{key:"absolute",label:"절대 명령의 도착 X (mm)"},{key:"relative",label:"상대 명령의 도착 X (mm)"}],
    expected:{absolute:String(argument),relative:String(start+argument)},
  };
}
export function submitSupport(record:SupportRecord,answers:Record<string,string>):SupportRecord|null {
  if(record.status==="complete")return null;
  const round=record.status==="check"?record.checks.length:0;
  const problem=supportProblem(record.error,record.status,round,record.lesson);
  if(problem.fields.some(f=>!answers[f.key]?.trim()))return null;
  const correct=problem.fields.every(f=>f.options ? answers[f.key]===problem.expected[f.key]
    :Number.isFinite(Number(answers[f.key]))&&Math.abs(Number(answers[f.key])-Number(problem.expected[f.key]))<=0.01);
  const response={submittedAt:new Date().toISOString(),round,condition:problem.prompt,answers:{...answers},correct};
  return record.status==="practice"?{...structuredClone(record),practice:[...record.practice,response]}
    :{...structuredClone(record),checks:[...record.checks,response],status:correct?"complete":"check"};
}
export function startSupportCheck(record:SupportRecord):SupportRecord|null {
  return record.status==="practice"&&record.practice.at(-1)?.correct?{...structuredClone(record),status:"check"}:null;
}
