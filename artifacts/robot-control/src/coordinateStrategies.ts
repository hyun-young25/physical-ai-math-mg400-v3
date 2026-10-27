import { POSE_AXES, poseDifference, translatePose, type LessonPose } from "./curriculum";
import { readCoordinateVector, MODE_LABEL, type CoordinateMode, type CoordinateVector, type CoordinateVisual, type CoordinateResult } from "./coordinateLearning";

type RawVector = Record<keyof CoordinateVector,string>;
export type StrategyCommand = { mode: CoordinateMode | ""; argument: RawVector };
export type StrategyStep = { label: string; start?: LessonPose; goal: LessonPose; givenGoal?: boolean };
export type CoordinateScenario = {
  id: string; title: string; situation: string; requirement: "location" | "displacement" | "mixed";
  support: "practice" | "independent"; from: LessonPose; shift?: CoordinateVector; steps: StrategyStep[];
};
const p = (x: number,y: number,z=0): LessonPose => ({x,y,z,r:0});
export const COORDINATE_SCENARIOS: readonly CoordinateScenario[] = [
  {id:"station-choice",title:"출발점이 달라도 같은 작업대로",requirement:"location",support:"practice",
    situation:"고정 작업대 P=(300, −50, 0)로 이동합니다. A에서 시작하는 경우와 C에서 시작하는 경우의 명령을 각각 설계하세요. 두 경우는 별도 실행입니다.",
    from:p(250,50),steps:[
      {label:"A=(250, 50, 0) → 작업대 P",start:p(250,50),goal:p(300,-50),givenGoal:true},
      {label:"C=(230, 80, 0) → 같은 작업대 P",start:p(230,80),goal:p(300,-50),givenGoal:true},
    ]},
  {id:"spacing-choice",title:"같은 간격으로 연속 이동하기",requirement:"displacement",support:"practice",
    situation:"A=(220, −60, 0)에서 시작합니다. 로봇 기준 +X로 35 mm, +Y로 40 mm씩 두 번 연속 이동하세요. 두 번째 이동은 첫 번째 도착점에서 시작합니다.",
    from:p(220,-60),shift:{x:35,y:40,z:0},steps:[
      {label:"첫 번째 간격 이동",goal:p(255,-20)}, {label:"두 번째 간격 이동",goal:p(290,20)},
    ]},
  {id:"mixed-independent",title:"작업대 접근 후 간격 이동 설계",requirement:"mixed",support:"independent",
    situation:"A=(280, 30, 10)에서 작업대 P=(240, −40, 10)로 이동한 뒤, +X 40 mm, +Y 60 mm, +Z 10 mm씩 두 번 연속 이동하세요. 구간마다 절대·상대 방식을 자유롭게 선택하세요.",
    from:p(280,30,10),shift:{x:40,y:60,z:10},steps:[
      {label:"작업대 P로 접근",goal:p(240,-40,10),givenGoal:true},
      {label:"첫 번째 간격 이동",goal:p(280,20,20)}, {label:"두 번째 간격 이동",goal:p(320,80,30)},
    ]},
];
export const blankStrategyCommands = (task: CoordinateScenario): StrategyCommand[] => task.steps.map(()=>({mode:"",argument:{x:"",y:"",z:""}}));
export const changeStrategyMode = (command: StrategyCommand,mode: CoordinateMode): StrategyCommand =>
  command.mode === mode ? command : {mode,argument:{x:"",y:"",z:""}};
export type PlannedStrategyStep = { mode: CoordinateMode; argument: CoordinateVector; from: LessonPose; to: LessonPose };
/** An unfinished command cannot produce a target or a following start. No expected goal is substituted. */
export function strategyPreviewPlan(task: CoordinateScenario,commands: StrategyCommand[]): PlannedStrategyStep[] {
  const plan: PlannedStrategyStep[] = []; let from=task.from;
  for (let i=0;i<task.steps.length;i++) {
    const command=commands[i]; if (!command || !["absolute","relative"].includes(command.mode)) break;
    const argument=readCoordinateVector(command.argument); if (!argument) break;
    from=task.steps[i].start ?? from;
    const to=command.mode === "absolute" ? {...argument,r:0} : translatePose(from,argument);
    plan.push({mode:command.mode as CoordinateMode,argument,from:{...from},to}); from=to;
  }
  return plan;
}
export function strategyPlan(task: CoordinateScenario,commands: StrategyCommand[]): PlannedStrategyStep[] | null {
  const plan=strategyPreviewPlan(task,commands);
  return commands.length === task.steps.length && plan.length === task.steps.length ? plan : null;
}
export type StrategyAttempt = {
  id:string; taskId:string; source:"dt"; submittedAt:string; commands:StrategyCommand[];
  requirement:string; explanation:string; hints:number;
  results:CoordinateResult[]; completed:boolean; explanationReview:"teacher";
  predictions?: Record<keyof CoordinateVector,string>[]; supportIds?: string[];
  judgmentReviews?: { of:string; submittedAt:string; requirement:string; explanation:string }[];
  solutionViews?: string[];
};
export const blankStrategyPredictions = (task:CoordinateScenario) => task.steps.map(()=>({x:"",y:"",z:""}));
export function hasStrategyPredictions(task:CoordinateScenario,predictions:Record<keyof CoordinateVector,string>[]|undefined) {
  return !!predictions && predictions.length === task.steps.length && predictions.every(p=>!!readCoordinateVector(p));
}
export function strategyRevealed(task:CoordinateScenario, submitted:boolean) { return task.support !== "independent" || submitted; }
export function makeStrategyAttempt(task:CoordinateScenario,commands:StrategyCommand[],input:{requirement:string;explanation:string;hints:number;predictions?:Record<keyof CoordinateVector,string>[];supportIds?:string[]}):StrategyAttempt|null {
  if (!strategyPlan(task,commands) || !["location","displacement","mixed"].includes(input.requirement) || !input.explanation.trim()) return null;
  if (task.support === "independent" && !hasStrategyPredictions(task,input.predictions)) return null;
  return {id:globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random()}`,taskId:task.id,source:"dt",submittedAt:new Date().toISOString(),
    commands:structuredClone(commands),requirement:input.requirement,explanation:input.explanation.trim(),hints:input.hints,
    results:[],completed:false,explanationReview:"teacher", ...(input.predictions ? {predictions:structuredClone(input.predictions)} : {}), supportIds:[...(input.supportIds??[])]};
}
const same = (a: LessonPose,b: LessonPose) => [...POSE_AXES,"r" as const].every(axis=>Number.isFinite(a[axis])&&Number.isFinite(b[axis])&&Math.abs(a[axis]-b[axis])<=0.01);
export function analyzeStrategyAttempt(task:CoordinateScenario,attempt:StrategyAttempt) {
  const plan=strategyPlan(task,attempt.commands);
  const rows=(plan??[]).map((command,i)=>{
    const goal=task.steps[i].goal, correct=same(command.to,goal);
    const requiredArgument=command.mode === "absolute" ? goal : poseDifference(command.from,goal);
    const prediction=attempt.predictions?.[i] ? readCoordinateVector(attempt.predictions[i]) : null;
    const predictionCorrect=!!prediction && same({...prediction,r:0},command.to);
    return {...command,goal,correct,requiredArgument,prediction,predictionCorrect,feedback:correct ? "선택한 방식으로 목표에 도착했습니다."
      : command.mode === "relative" ? "상대 값은 도착 위치가 아닙니다. 이 구간이 실제로 시작하는 위치에서 목표까지의 차이를 확인하세요."
      : "절대 값은 이동량이 아닙니다. 원점 기준 목표 위치를 지정했는지 확인하세요."};
  });
  const observed=!!plan && attempt.source === "dt" && attempt.taskId === task.id && attempt.results.length === plan.length
    && plan.every((step,i)=>same(attempt.results[i].from,step.from)&&same(attempt.results[i].to,step.to));
  const requirementsCorrect=attempt.requirement === task.requirement;
  const numericCorrect=!!plan&&rows.every(row=>row.correct);
  const predictionsCorrect=task.support!=="independent" || (hasStrategyPredictions(task,attempt.predictions)&&rows.every(row=>row.predictionCorrect));
  const review=attempt.judgmentReviews?.at(-1);
  const reviewCorrect=!!review&&review.of===attempt.id&&!!review.submittedAt&&!requirementsCorrect
    &&review.requirement===task.requirement&&(task.support!=="independent"||!!review.explanation.trim());
  return {rows,observed,requirementsCorrect,numericCorrect,predictionsCorrect,canComplete:observed&&(requirementsCorrect||reviewCorrect)&&numericCorrect&&predictionsCorrect&&!!attempt.explanation.trim()
    && (task.support !== "independent" || attempt.hints === 0)};
}
export function canReviewStrategyJudgment(task:CoordinateScenario,attempt:StrategyAttempt):boolean {
  const a=analyzeStrategyAttempt(task,attempt);
  return !attempt.completed&&a.observed&&a.numericCorrect&&a.predictionsCorrect&&!a.requirementsCorrect
    &&!!attempt.explanation.trim()&&(task.support!=="independent"||attempt.hints===0);
}
export function reviewStrategyJudgment(task:CoordinateScenario,attempt:StrategyAttempt,
  input:{requirement:string;explanation:string}):StrategyAttempt|null {
  if(!canReviewStrategyJudgment(task,attempt)||!["location","displacement","mixed"].includes(input.requirement)
    ||(task.support==="independent"&&!input.explanation.trim()))return null;
  const reviewed:StrategyAttempt={...structuredClone(attempt),judgmentReviews:[...structuredClone(attempt.judgmentReviews??[]),
    {...input,explanation:input.explanation.trim(),of:attempt.id,submittedAt:new Date().toISOString()}]};
  return completeStrategyAttempt(task,reviewed)??reviewed;
}
export function completeStrategyAttempt(task:CoordinateScenario,attempt:StrategyAttempt):StrategyAttempt|null {
  return analyzeStrategyAttempt(task,attempt).canComplete ? {...structuredClone(attempt),completed:true} : null;
}
export function strategyVisual(task:CoordinateScenario,commands:StrategyCommand[],results:CoordinateResult[],key:string,submitted=false):CoordinateVisual {
  const plan=strategyRevealed(task,submitted)?strategyPreviewPlan(task,commands):[];
  return {key,from:task.from,fromLabel:"A",results:{},showPaths:strategyRevealed(task,submitted),points:[
    ...task.steps.filter(s=>s.givenGoal).map((s,i)=>({id:`goal-${i}`,label:"P · 주어진 작업대",pose:s.goal,from:s.start??task.from,color:"#64748b",kind:"given" as const})).slice(0,1),
    ...plan.map((s,i)=>({id:`input-${i}`,label:`${i+1} · 내 명령 도착점`,pose:s.to,from:s.from,color:"#9333ea",kind:"prediction" as const})),
  ],trails:results.map((r,i)=>({...r,id:`result-${i}`,label:`${i+1} DT · ${MODE_LABEL[plan[i]?.mode??"absolute"]}`,color:plan[i]?.mode==="relative"?"#0f766e":"#0284c7"}))};
}
