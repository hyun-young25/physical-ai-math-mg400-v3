import type { ShapeLesson } from "./shapeLearning";

/**
 * Rule-based diagnosis of prediction–execution mismatches for the square lessons.
 *
 * The robot executes the learner's own XY plan (DT, and on hardware only after a
 * correct plan). This module compares the shape that was actually executed with
 * the task condition, classifies the first point of divergence into a fixed error
 * type, and decides the feedback level from the learner's own history. It is
 * deterministic: an LLM may phrase the result, but never decides it.
 */
export type SquareMismatchType =
  | "match"
  | "displacement-as-position"
  | "axis-swap"
  | "direction"
  | "closure"
  | "arithmetic"
  | "model-real"
  | "unreachable";
export type FeedbackLevel = "task" | "process" | "worked" | "self-regulation";
export type XY = { x:number; y:number };
export type SquareExecutionSource = "dt" | "hardware" | "mock" | "prediction";
export type SquareObservedVertex = XY & { z?:number; r?:number; label:string };
export type SquareMeasurement = { label?:string; target:XY & {z?:number}; actual:XY & {z?:number}; distanceError?:number };
export type SquareEdgeEvidence = {
  edge:string; condition:{axis:"X"|"Y"; delta:number}; executed:{dx:number; dy:number};
};
export type SquareDiagnosis = {
  type:SquareMismatchType;
  /** 1-based edge index (P1→P2 = 1) where the executed shape first departs from the condition. */
  edgeIndex?:number;
  edge?:string;
  /** Neutral, answer-free label for learners. */
  label:string;
  evidence:{
    source:SquareExecutionSource;
    condition:{width:number; height:number; xDir:1|-1; yDir:1|-1; start:XY};
    executed?:{width:number; height:number; closesAtStart:boolean; vertices:SquareObservedVertex[]};
    edges?:SquareEdgeEvidence[];
    measured?:{meanError:number; maxError:number; meanOffset:XY; count:number; reference?:"target"|"student-plan"};
    rejected?:XY;
  };
};
export type SquareFeedbackPlan = {
  level:FeedbackLevel; levelLabel:string; question:string; relationHint?:string; example?:string; teacherFlag:boolean;
};

const TOL = 0.1 + 1e-6;
/** Same order as the hardware path tolerance messages; only used to flag model–real gaps. */
export const MODEL_REAL_THRESHOLD_MM = 1;
const near = (a:number, b:number, tol=TOL) => Math.abs(a-b) <= tol;
const nearXY = (a:XY, b:XY, tol=TOL) => near(a.x,b.x,tol) && near(a.y,b.y,tol);
const fmt = (n:number) => String(Math.round(n*100)/100);
const signWord = (n:number) => n >= 0 ? "커지는" : "작아지는";
const signed = (n:number, axis:string) => `${n>=0?"+":"−"}${axis}`;

export function squareCondition(lesson:ShapeLesson) {
  const target = (lesson.targetSequence ?? lesson.sequence).filter(step => step.coords).map(step => step.coords!);
  if (!lesson.id.startsWith("square-") || target.length < 5) return null;
  const [a,b,c] = target;
  const dx = b.x - a.x, dy = c.y - b.y;
  return {
    start:{x:a.x,y:a.y}, target:target.slice(0,5).map(p => ({x:p.x,y:p.y})),
    width:Math.abs(dx), height:Math.abs(dy), xDir:(dx>=0?1:-1) as 1|-1, yDir:(dy>=0?1:-1) as 1|-1,
    edges:[{axis:"X" as const,delta:dx},{axis:"Y" as const,delta:dy},{axis:"X" as const,delta:-dx},{axis:"Y" as const,delta:-dy}],
  };
}

/** The learner's planned vertices, in execution order: P1 (given), P2, P3, P4, closing P1. */
export function squarePlannedVertices(lesson:ShapeLesson, answers:Record<string,string>):(XY & {label:string})[] | null {
  const start = lesson.pathPlan.start;
  const rows = [...lesson.pathPlan.rows].filter(row => row.kind !== "via").sort((a,b) => a.sequenceIndex-b.sequenceIndex);
  const points:(XY & {label:string})[] = [{x:start.x,y:start.y,label:"P1"}];
  for (const row of rows) {
    const x = answers[row.xKey]?.trim(), y = answers[row.yKey]?.trim();
    if (!x || !y || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return null;
    points.push({x:Number(x),y:Number(y),label:row.label});
  }
  return points.length === 5 ? points : null;
}

const EDGE_LABELS = ["P1 → P2","P2 → P3","P3 → P4","P4 → P1"];

/**
 * Diagnose one completed execution.
 * - `answers`: the prediction the robot actually executed (never a later draft).
 * - `measurements`: physical hardware results (target vs actual), only for model–real gaps.
 * - `rejected`: a point the DT could not reach (no IK solution).
 */
export function diagnoseSquare(lesson:ShapeLesson, answers:Record<string,string>,
  options:{measurements?:SquareMeasurement[]; rejected?:XY|null; observedVertices?:SquareObservedVertex[];
    source?:SquareExecutionSource}={}):SquareDiagnosis | null {
  const condition = squareCondition(lesson);
  if (!condition) return null;
  const source=options.source??"prediction";
  const base = {source,condition:{width:condition.width,height:condition.height,xDir:condition.xDir,yDir:condition.yDir,start:condition.start}};
  if (options.rejected) return {type:"unreachable",label:"로봇이 갈 수 없는 점이 있어요",evidence:{...base,rejected:{x:options.rejected.x,y:options.rejected.y}}};
  const planned = squarePlannedVertices(lesson, answers);
  if (!planned) return null;
  const observed=options.observedVertices;
  if(options.source&&(!observed||observed.length!==5||observed.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||!p.label)))return null;
  const vertices=observed??planned;
  const edges:SquareEdgeEvidence[] = vertices.slice(1).map((p,i) => ({
    edge:EDGE_LABELS[i], condition:condition.edges[i], executed:{dx:p.x-vertices[i].x, dy:p.y-vertices[i].y},
  }));
  const executed = {
    width:Math.abs(edges[0].executed.dx) > Math.abs(edges[0].executed.dy) ? Math.abs(edges[0].executed.dx) : Math.abs(edges[1].executed.dx),
    height:Math.abs(edges[1].executed.dy) > Math.abs(edges[1].executed.dx) ? Math.abs(edges[1].executed.dy) : Math.abs(edges[0].executed.dy),
    closesAtStart:nearXY(vertices[4],vertices[0]), vertices,
  };
  const evidence = {...base, executed, edges};

  const planCorrect=planned.every((p,i) => nearXY(p, condition.target[i]));
  if(source==="hardware"&&observed) {
    const errors=observed.map((p,i)=>Math.hypot(p.x-planned[i].x,p.y-planned[i].y));
    const meanOffset={x:observed.reduce((sum,p,i)=>sum+p.x-planned[i].x,0)/observed.length,
      y:observed.reduce((sum,p,i)=>sum+p.y-planned[i].y,0)/observed.length};
    const measured={meanError:errors.reduce((sum,n)=>sum+n,0)/errors.length,maxError:Math.max(...errors),
      meanOffset,count:observed.length,reference:"student-plan" as const};
    if(measured.maxError>MODEL_REAL_THRESHOLD_MM)
      return {type:"model-real",label:"GetPose 실측 경로가 학생이 제출한 실행 좌표와 달라요. 학생의 계산 오류로 단정할 수 없습니다.",
        evidence:{...evidence,measured}};
  }
  if (planCorrect) {
    if(source==="hardware"&&observed) {
      const errors=observed.map((p,i)=>Math.hypot(p.x-condition.target[i].x,p.y-condition.target[i].y));
      const meanOffset={x:observed.reduce((sum,p,i)=>sum+p.x-condition.target[i].x,0)/observed.length,
        y:observed.reduce((sum,p,i)=>sum+p.y-condition.target[i].y,0)/observed.length};
      const measured={meanError:errors.reduce((sum,n)=>sum+n,0)/errors.length,maxError:Math.max(...errors),
        meanOffset,count:observed.length,reference:"target" as const};
      if(measured.maxError>MODEL_REAL_THRESHOLD_MM)
        return {type:"model-real",label:"GetPose 실측 경로가 계산한 목표와 달라요. 학생의 계산 오류로 단정할 수 없습니다.",
          evidence:{...evidence,measured}};
      return {type:"match",label:"예측과 GetPose 좌표가 허용 오차 안에서 일치해요",evidence:{...evidence,measured}};
    }
    const m = (options.measurements ?? []).filter(item => Number.isFinite(item.actual?.x) && Number.isFinite(item.target?.x));
    if (m.length) {
      const errors = m.map(item => Math.hypot(item.actual.x-item.target.x, item.actual.y-item.target.y, (item.actual.z??0)-(item.target.z??0)));
      const meanOffset = {x:m.reduce((s,item)=>s+item.actual.x-item.target.x,0)/m.length, y:m.reduce((s,item)=>s+item.actual.y-item.target.y,0)/m.length};
      const measured = {meanError:errors.reduce((s,e)=>s+e,0)/errors.length, maxError:Math.max(...errors), meanOffset, count:m.length};
      if (measured.maxError > MODEL_REAL_THRESHOLD_MM)
        return {type:"model-real",label:"계산·가상 결과와 실제 로봇 결과를 비교해 보세요",evidence:{...evidence,measured}};
      return {type:"match",label:"예측과 실행 결과가 일치해요",evidence:{...evidence,measured}};
    }
    return {type:"match",label:"예측과 실행 결과가 일치해요",evidence};
  }

  // A vertex that equals an edge displacement (or the displacement from P1) was entered as a position.
  for (let k = 1; k <= 3; k++) {
    const want = condition.target[k], prevWant = condition.target[k-1];
    if (nearXY(planned[k], want)) continue;
    const candidates = [
      {x:want.x-prevWant.x, y:want.y-prevWant.y},
      {x:want.x-condition.start.x, y:want.y-condition.start.y},
      {x:Math.abs(want.x-prevWant.x), y:Math.abs(want.y-prevWant.y)},
    ];
    if (candidates.some(c => nearXY(planned[k], c)))
      return {type:"displacement-as-position",edgeIndex:k,edge:EDGE_LABELS[k-1],label:"점의 위치(좌표)와 이동량을 구분해 보세요",evidence};
    break;
  }

  const first = edges.findIndex(e => {
    const want = e.condition.axis === "X" ? {x:e.condition.delta,y:0} : {x:0,y:e.condition.delta};
    return !nearXY({x:e.executed.dx,y:e.executed.dy}, want);
  });
  if (first < 0) return {type:"arithmetic",label:"좌표 계산 과정을 확인해 보세요",evidence};
  const e = edges[first], edgeIndex = first + 1, edge = EDGE_LABELS[first];
  const along = e.condition.axis === "X" ? e.executed.dx : e.executed.dy;
  const across = e.condition.axis === "X" ? e.executed.dy : e.executed.dx;
  const other = e.condition.axis === "X" ? condition.height : condition.width;
  if (!near(across,0) || near(along,0) || (near(Math.abs(along),other) && !near(other,Math.abs(e.condition.delta))))
    return {type:"axis-swap",edgeIndex,edge,label:"각 변이 움직인 축과 길이를 확인해 보세요",evidence};
  if (near(Math.abs(along),Math.abs(e.condition.delta)) && Math.sign(along) !== Math.sign(e.condition.delta))
    return {type:edgeIndex === 4 ? "closure" : "direction",edgeIndex,edge,
      label:edgeIndex === 4 ? "마지막 변이 시작점으로 돌아왔는지 확인해 보세요" : "각 변이 움직인 방향(+/−)을 확인해 보세요",evidence};
  if (edgeIndex === 4) return {type:"closure",edgeIndex,edge,label:"마지막 변이 시작점으로 돌아왔는지 확인해 보세요",evidence};
  return {type:"arithmetic",edgeIndex,edge,label:"변의 길이를 계산한 과정을 확인해 보세요",evidence};
}

export const LEVEL_LABELS:Record<FeedbackLevel,string> = {
  task:"1단계 · 무엇이 다른지 관찰", process:"2단계 · 관계 짚어보기",
  worked:"3단계 · 예시와 선생님 도움", "self-regulation":"정리 · 다음 과제 점검",
};

/**
 * Feedback level from the learner's own history for the same lesson and error type.
 * Challenge mode keeps the observation question one step longer (fading).
 */
export function squareFeedbackLevel(priorSameType:number, supportMode:"guided"|"challenge"):FeedbackLevel {
  const n = supportMode === "challenge" ? priorSameType - 1 : priorSameType;
  return n <= 0 ? "task" : n === 1 ? "process" : "worked";
}

export function squareFeedbackPlan(d:SquareDiagnosis, priorSameType:number, supportMode:"guided"|"challenge", resolvedPrior?:SquareMismatchType):SquareFeedbackPlan | null {
  if (d.type === "match") {
    if (!resolvedPrior || resolvedPrior === "match") return null;
    return {level:"self-regulation",levelLabel:LEVEL_LABELS["self-regulation"],teacherFlag:false,
      question:`이번에는 예측과 실행 결과가 일치했어요. 앞에서 ‘${squareMismatchName(resolvedPrior)}’ 때문에 달랐던 부분을, 다음 과제에서는 실행 전에 어떻게 미리 점검할 수 있을까요?`};
  }
  const level = squareFeedbackLevel(priorSameType, supportMode);
  const c = d.evidence.condition, ex = d.evidence.executed, edge = d.edge ?? "";
  const e = d.edgeIndex ? d.evidence.edges?.[d.edgeIndex-1] : undefined;
  const v = d.edgeIndex && ex ? ex.vertices[d.edgeIndex] : undefined;
  let question = "", relationHint:string|undefined, example:string|undefined;
  switch (d.type) {
    case "axis-swap":
      question = ex
        ? `로봇이 그린 도형은 X 방향 ${fmt(ex.width)} mm, Y 방향 ${fmt(ex.height)} mm예요. 과제의 가로(X 방향)·세로(Y 방향) 조건과 비교하면 무엇이 다른가요?`
        : `로봇이 그린 변의 방향과 길이를 실행 결과 좌표로 읽어 보세요. 과제 조건과 무엇이 다른가요?`;
      relationHint = `가로는 X가 변하는 변, 세로는 Y가 변하는 변이에요. ${edge}에서는 어느 축이 변하고 어느 축이 그대로여야 하나요?`;
      example = "예: P1(0, 0)에서 가로 50 mm(+X), 세로 30 mm(−Y)인 직사각형이면 P2 = (50, 0), P3 = (50, −30)이에요. X가 변할 때 Y는 그대로예요.";
      break;
    case "direction":
      question = e
        ? `${edge}에서 로봇은 ${e.condition.axis}가 ${signWord(e.condition.axis==="X"?e.executed.dx:e.executed.dy)} 쪽으로 움직였어요. 과제가 요구한 방향과 같은가요?`
        : "각 변에서 로봇이 움직인 방향을 과제 조건과 비교해 보세요.";
      relationHint = e ? `방향이 ${signed(e.condition.delta,e.condition.axis)}이면 ${e.condition.axis} 이동량의 부호도 ${e.condition.delta>=0?"+":"−"}예요. 직전 점의 ${e.condition.axis}에 부호 있는 이동량을 더해 보세요.` : undefined;
      example = "예: P1(0, 0)에서 −Y 방향으로 30 mm 이동하면 Y = 0 + (−30) = −30이에요. 길이는 양수지만 이동량은 음수일 수 있어요.";
      break;
    case "displacement-as-position":
      question = v
        ? `로봇이 ${v.label}로 간 위치는 (${fmt(v.x)}, ${fmt(v.y)})였어요. 이 값은 ‘도착할 위치’인가요, ‘이동한 양’인가요?`
        : "입력한 값이 도착할 위치인지 이동한 양인지 구분해 보세요.";
      relationHint = "꼭짓점 좌표 = 직전 꼭짓점 좌표 + 이동량이에요. 이동량만 입력하면 로봇은 원점(0, 0) 근처의 다른 위치로 가요.";
      example = "예: P1(200, 0)에서 +X로 50 mm 이동한 P2는 (50, 0)이 아니라 (200 + 50, 0) = (250, 0)이에요.";
      break;
    case "closure":
      question = ex
        ? `마지막 점은 (${fmt(ex.vertices[4].x)}, ${fmt(ex.vertices[4].y)})에서 끝났고, 시작점 P1은 (${fmt(c.start.x)}, ${fmt(c.start.y)})예요. 도형이 시작점에서 닫혔나요?`
        : "마지막 점이 시작점 P1과 같은지 확인해 보세요.";
      relationHint = "닫힌 도형은 네 변의 ΔX를 모두 더해도 0, ΔY를 모두 더해도 0이에요. 마지막 변이 되돌려야 할 이동량은 얼마인가요?";
      example = "예: +X 50 → −Y 30 → −X 50 다음 마지막 변은 +Y 30이어야 시작점으로 돌아와요.";
      break;
    case "arithmetic":
      question = e
        ? `${edge}에서 로봇이 그린 변의 길이는 ${fmt(Math.hypot(e.executed.dx,e.executed.dy))} mm예요. 과제 조건의 길이와 같은가요?`
        : "로봇이 그린 변의 길이를 실행 결과 좌표로 계산해 과제 조건과 비교해 보세요.";
      relationHint = "직전 점의 좌표에 이 변의 부호 있는 이동량을 더해 다시 계산해 보세요. 변하지 않는 축의 값은 그대로 두세요.";
      example = "예: P2(250, 0)에서 −Y로 30 mm 이동하면 P3 = (250, 0 − 30) = (250, −30)이에요.";
      break;
    case "model-real": {
      const m = d.evidence.measured;
      question = m
        ? `계산한 좌표와 가상(DT) 경로는 일치했는데, 실제 로봇은 꼭짓점에서 평균 ${fmt(m.meanError)} mm(최대 ${fmt(m.maxError)} mm) 어긋났어요. 어긋난 방향이 모든 꼭짓점에서 비슷한가요?`
        : "계산·가상 결과와 실제 로봇 결과를 같은 좌표계에서 비교해 보세요.";
      relationHint = "우리 계산은 도구 끝점(TCP)과 기준 좌표계가 실제 로봇과 같다고 가정해요. 모든 점이 같은 방향으로 어긋난다면 이 가정 중 무엇이 다를 수 있을까요?";
      example = "예: 모든 점이 +X로 약 2 mm씩 어긋났다면 계산 실수보다 도구 길이나 기준점 설정의 차이를 먼저 의심할 수 있어요. (측정으로 확인한 원인은 아니에요.)";
      break;
    }
    case "unreachable":
      question = d.evidence.rejected
        ? `(${fmt(d.evidence.rejected.x)}, ${fmt(d.evidence.rejected.y)})는 로봇 팔이 닿을 수 없는 위치였어요. 이 점은 시작점 P1에서 얼마나 떨어져 있나요? 과제의 가로·세로 길이와 비교해 보세요.`
        : "입력한 점 중 로봇 팔이 닿을 수 없는 위치가 있어요. 각 점이 시작점에서 얼마나 떨어져 있는지 계산해 보세요.";
      relationHint = "직사각형의 모든 꼭짓점은 시작점에서 가로·세로 길이만큼만 떨어져 있어요. 그보다 훨씬 멀리 간 점이 있다면 위치와 이동량을 섞어 쓰지 않았는지 확인하세요.";
      break;
  }
  return {
    level, levelLabel:LEVEL_LABELS[level], question,
    relationHint:level === "task" ? undefined : relationHint,
    example:level === "worked" ? example : undefined,
    teacherFlag:level === "worked",
  };
}

export function squareMismatchName(type:SquareMismatchType) {
  return ({
    match:"일치", "displacement-as-position":"위치와 이동량 혼동", "axis-swap":"축·길이 뒤바뀜", direction:"방향(부호) 오류",
    closure:"닫힘 오류", arithmetic:"계산 오류", "model-real":"모형–실물 차이", unreachable:"도달 불가 위치",
  } as Record<SquareMismatchType,string>)[type];
}

/** Count earlier executions of the same lesson that had the same diagnosis (re-derived, not trusted from storage). */
export function priorSquareDiagnoses<R extends {id:string; condition:unknown; prediction:Record<string,string>; runs:{action:string;status:string;detail?:unknown}[]}>(
  history:R[], lesson:ShapeLesson, excludeId?:string) {
  const types:SquareMismatchType[] = [];
  for (const record of history) {
    if (record.id === excludeId || (record.condition as {id?:string}|null)?.id !== lesson.id) continue;
    const mission = record.runs.filter(run => run.action === "mission").at(-1);
    if (!mission || (mission.status !== "completed" && mission.status !== "unavailable")) continue;
    const missionDetail=mission.detail as {rejectedTarget?:XY;observedVertices?:SquareObservedVertex[];planKey?:string}|undefined;
    const physical=record.runs.filter(run=>run.action==="square-measurement"&&run.status==="completed").at(-1);
    const physicalDetail=physical?.detail as {source?:SquareExecutionSource;observedVertices?:SquareObservedVertex[];planKey?:string}|undefined;
    const usePhysical=!!physicalDetail&&physicalDetail.planKey===missionDetail?.planKey
      &&(physicalDetail.source==="hardware"||physicalDetail.source==="mock");
    const d=diagnoseSquare(lesson,record.prediction,{rejected:mission.status==="unavailable"?missionDetail?.rejectedTarget??null:null,
      observedVertices:usePhysical?physicalDetail?.observedVertices:missionDetail?.observedVertices,
      source:usePhysical?physicalDetail?.source:"dt"});
    if (d) types.push(d.type);
  }
  return types;
}
