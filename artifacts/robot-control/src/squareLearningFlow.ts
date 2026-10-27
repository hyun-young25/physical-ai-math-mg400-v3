import { shapeLessonAnswerMatches, shapeLessonFeedback, type LessonQuestion, type ShapeLesson } from "./shapeLearning";

/** Objective, square-only judgments. Never accept blanks through Number("") === 0. */
export function assessSquare(lesson:ShapeLesson, answers:Record<string,string>, questions:LessonQuestion[]=[
  ...lesson.concept,...lesson.relations,...lesson.calculation,...lesson.prediction,
]) {
  return questions.map(question => ({
    key:question.key, label:question.label, value:answers[question.key] ?? "",
    matched:shapeLessonAnswerMatches(question,answers[question.key]),
    feedback:!String(answers[question.key]??"").trim()
      ? "아직 값이 없어요. 문제에서 이 점의 기준 위치와 이동 방향을 찾고, 항목을 빠짐없이 입력해 주세요."
      : typeof question.answer==="number" && !Number.isFinite(Number(answers[question.key]))
        ? "유한한 숫자로 입력해 주세요. 단위는 입력칸 옆에 있으니 숫자만 적어 주세요."
        : shapeLessonFeedback(question,answers[question.key]??""),
  }));
}

/** Copy only entered XY values; Z, R, command types and approach stay in the existing plan. */
export function squareStudentSequence(lesson:ShapeLesson, answers:Record<string,string>) {
  if(!lesson.id.startsWith("square-"))return null;
  const sequence=lesson.sequence.map(step=>({...step,coords:step.coords?{...step.coords}:undefined,
    via:step.via?{...step.via}:undefined}));
  for(const row of lesson.pathPlan.rows) {
    const x=answers[row.xKey]?.trim(),y=answers[row.yKey]?.trim();
    if(!x||!y||!Number.isFinite(Number(x))||!Number.isFinite(Number(y)))return null;
    const step=sequence[row.sequenceIndex];
    if(!step?.coords||row.kind==="via")return null;
    step.coords={...step.coords,x:Number(x),y:Number(y)};
  }
  return sequence;
}

/** Tie DT evidence to this submission and exact execution program, not merely the lesson. */
export function squareExecutionKey(conditionKey:string, recordId:string|undefined, sequence:unknown) {
  return JSON.stringify([conditionKey,recordId??null,sequence]);
}

/** Math-plan tolerance only; never used to widen the physical workspace bounds. */
export function squarePlanMatchesTarget(lesson:ShapeLesson, sequence:ShapeLesson["sequence"]) {
  const target=lesson.targetSequence;
  if(!lesson.id.startsWith("square-")||!target||sequence.length!==target.length)return false;
  const samePoint=(a:typeof target[number]["coords"],b:typeof target[number]["coords"])=>{
    if(!a||!b)return !a&&!b;
    return (["x","y","z","r"] as const).every(axis=>Number.isFinite(a[axis])
      &&Math.abs(a[axis]-b[axis])<=0.1+1e-9);
  };
  return sequence.every((step,index)=>(index===0||step.type===target[index].type)
    &&samePoint(step.coords,target[index].coords)&&samePoint(step.via,target[index].via));
}

export function squareAnswersUnchanged(saved:Record<string,string>, draft:Record<string,string>, review:Record<string,string>) {
  return Object.keys(saved).every(key=>saved[key]===draft[key])
    && Object.entries(review).every(([key,value])=>saved[key]===value);
}

export type SquareActionStatus="current"|"complete"|"pending"|"not-needed";
export function squareActionProgress(input:{
  predictionSaved:boolean;revisionCycle:boolean;revisionAttempt:boolean;
  observationComplete:boolean;hasMismatch:boolean;causeSaved:boolean;observationSaved:boolean;
}):SquareActionStatus[] {
  const correctionInProgress=input.causeSaved
    ||input.revisionCycle&&(!input.predictionSaved||(input.revisionAttempt&&!input.observationComplete));
  const currentIndex=!input.predictionSaved?(correctionInProgress?3:0)
    :correctionInProgress?3
    :input.observationComplete&&input.hasMismatch&&!input.causeSaved?2
    :input.observationComplete&&!input.hasMismatch&&!input.observationSaved?1
    :!input.observationComplete?0:-1;
  return [
    currentIndex===0?"current":input.predictionSaved||input.revisionCycle?"complete":"pending",
    currentIndex===1?"current":input.observationComplete||correctionInProgress?"complete":"pending",
    currentIndex===2?"current":!input.hasMismatch&&input.observationComplete?"not-needed":input.causeSaved||correctionInProgress?"complete":"pending",
    currentIndex===3?"current":input.revisionCycle&&input.observationComplete&&!input.hasMismatch?"complete"
      :!input.hasMismatch&&input.observationComplete?"not-needed":"pending",
  ];
}

/** The existing tutor contract caps judgment at 2,000 characters. Keep valid JSON,
 * all-error count and the next actionable errors, rather than truncating JSON. */
export function squareTutorJudgment(rows:ReturnType<typeof assessSquare>) {
  const errors=rows.filter(row=>!row.matched);
  return {status:errors.length?"incorrect":"correct",errorCount:errors.length,
    fields:(errors.length?errors.slice(0,3):rows.map(row=>({...row,feedback:""})).slice(0,3))
      .map(row=>({...row,value:row.value.slice(0,60),feedback:row.feedback.slice(0,180)}))};
}
