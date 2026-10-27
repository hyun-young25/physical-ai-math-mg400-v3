import { POSE_AXES, parseLessonNumber, poseDifference, translatePose, type LessonPose } from "./curriculum";

export type CoordinateVector = Pick<LessonPose, "x" | "y" | "z">;
export type CoordinateMode = "absolute" | "relative";
export type CoordinateField = "delta" | CoordinateMode;
export type CoordinateDraft = Record<CoordinateField, Record<keyof CoordinateVector, string>>;
export type CoordinateTask = {
  id: string; title: string; kind: "delta" | "endpoint" | "literal" | "transfer";
  support: "guided" | "practice" | "independent";
  a: LessonPose; b: LessonPose; changedStart?: LessonPose;
};
const p = (x: number, y: number, z = 0): LessonPose => ({ x, y, z, r: 0 });
export const COORDINATE_TASKS: readonly CoordinateTask[] = [
  { id: "delta-intro", title: "도착 위치를 변화량으로 바꾸기", kind: "delta", support: "guided", a: p(250,50), b: p(300,-50) },
  { id: "endpoint", title: "변화량으로 도착 위치 구하기", kind: "endpoint", support: "practice", a: p(300,-50), b: p(260,30,20) },
  { id: "same-numbers", title: "같은 숫자를 두 방식에 넣으면?", kind: "literal", support: "practice", a: p(200,0), b: p(240,20) },
  { id: "changed-start", title: "출발점만 바꾸면 어떻게 될까?", kind: "transfer", support: "practice", a: p(250,50), b: p(300,-50), changedStart: p(230,80) },
  { id: "independent", title: "새 출발점에서 두 명령을 스스로 비교하기", kind: "transfer", support: "independent", a: p(280,-40,10), b: p(240,20,30), changedStart: p(300,-20) },
];
export const COORDINATE_MODES: readonly CoordinateMode[] = ["absolute", "relative"];
export const MODE_LABEL: Record<CoordinateMode, string> = { absolute: "절대 이동", relative: "상대 이동" };
export const FIELD_LABEL: Record<CoordinateField, string> = { delta: "변화량 Δ", absolute: "절대 명령 도착점", relative: "상대 명령 도착점" };
export const blankCoordinateDraft = (): CoordinateDraft => ({ delta: {x:"",y:"",z:""}, absolute: {x:"",y:"",z:""}, relative: {x:"",y:"",z:""} });
export const coordinateFields = (task: CoordinateTask): CoordinateField[] => task.kind === "delta" ? ["delta"] : task.kind === "endpoint" ? ["absolute"] : ["absolute", "relative"];
export function readCoordinateVector(raw: Record<keyof CoordinateVector, string>): CoordinateVector | null {
  const values = POSE_AXES.map(a => parseLessonNumber(raw[a]));
  return values.some(n => n === null) ? null : { x: values[0]!, y: values[1]!, z: values[2]! };
}
export const coordinateStart = (task: CoordinateTask) => task.changedStart ?? task.a;
/** Only given quantities belong in the pre-prediction card. */
export function coordinateProblemContext(task: CoordinateTask) {
  if (task.kind === "endpoint") return {
    label: "주어진 변화량 Δ", value: poseDifference(task.a, task.b),
    relation: "도착점 B = 출발점 A + 변화량 Δ",
    instruction: "아래에서 도착점 B를 직접 구한 뒤, 절대·상대 명령의 결과를 비교하세요.",
  };
  if (task.kind === "literal") return {
    label: "두 명령에 똑같이 넣을 숫자", value: task.b,
    relation: "절대: 입력값은 위치 · 상대: 입력값은 변화량",
    instruction: "같은 숫자를 두 방식으로 해석할 때 도착점이 같은지 먼저 예측하세요.",
  };
  if (task.changedStart) return {
    label: "원래 명령의 기준 도착점 B", value: task.b,
    relation: "절대 명령 B 유지 · 상대 명령 Δ 유지",
    instruction: "원래 A→B의 두 명령을 새 출발점 C에서 실행합니다. 두 도착점을 각각 예측하세요.",
  };
  return { label: "주어진 도착점 B", value: task.b,
    relation: "변화량 Δ = 도착점 B − 출발점 A",
    instruction: "아래에서 같은 이동을 만드는 변화량을 구하고, 두 명령의 도착점을 비교하세요." };
}
export const coordinateRule = (task: CoordinateTask) => task.support === "guided" ? "subtract" : task.id === "changed-start" ? "absolute-fixed" : null;
export function coordinateExpected(task: CoordinateTask): Record<CoordinateField, CoordinateVector> {
  const delta = task.kind === "literal" ? task.b : poseDifference(task.a, task.b);
  return { delta, absolute: task.b, relative: translatePose(coordinateStart(task), delta) };
}
export function coordinateCommands(task: CoordinateTask, draft: CoordinateDraft) {
  if (coordinateFields(task).some(field => !readCoordinateVector(draft[field]))) return null;
  const absolute = task.kind === "endpoint" ? { ...readCoordinateVector(draft.absolute)!, r:0 } : { ...task.b };
  const delta = task.kind === "delta" ? readCoordinateVector(draft.delta)! : task.kind === "literal" ? task.b : poseDifference(task.a, task.b);
  return { absolute, relative: translatePose(coordinateStart(task), delta) };
}
/** Arguments are not endpoints: relative arguments are displacements in the robot base axes. */
export function coordinateArguments(task: CoordinateTask, draft: CoordinateDraft): Record<CoordinateMode, CoordinateVector | null> {
  return {
    absolute: task.kind === "endpoint" ? readCoordinateVector(draft.absolute) : task.b,
    relative: task.kind === "delta" ? readCoordinateVector(draft.delta) : task.kind === "literal" ? task.b : poseDifference(task.a,task.b),
  };
}
export type CoordinateResult = { from: LessonPose; to: LessonPose };
export type CoordinateJudgmentReview = {
  of: string; submittedAt: string; comparison: string; rule: string; explanation: string;
};
export type CoordinateAttempt = {
  id: string; taskId: string; source: "dt"; submittedAt: string; draft: CoordinateDraft;
  comparison: "same" | "different"; rule: string; explanation: string; hints: number;
  results: Partial<Record<CoordinateMode, CoordinateResult>>; completed: boolean;
  supportIds?: string[];
  judgmentReviews?: CoordinateJudgmentReview[];
  solutionViews?: string[];
  supportMode?: "guided" | "challenge";
};
export function makeCoordinateAttempt(task: CoordinateTask, draft: CoordinateDraft, input: {
  comparison: string; rule: string; explanation: string; hints: number; supportIds?: string[]; supportMode?: "guided" | "challenge";
}): CoordinateAttempt | null {
  if (!coordinateCommands(task,draft) || !["same","different"].includes(input.comparison)
    || (coordinateRule(task) && !input.rule) || (task.support === "independent" && !input.explanation.trim())) return null;
  return { id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`, taskId:task.id, source:"dt", submittedAt:new Date().toISOString(),
    draft:structuredClone(draft), comparison:input.comparison as CoordinateAttempt["comparison"], rule:input.rule,
    explanation:input.explanation.trim(), hints:input.hints, results:{}, completed:false, supportIds:[...(input.supportIds??[])], supportMode:input.supportMode??"guided" };
}
const near = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) <= 0.01;
const samePose = (a: LessonPose, b: LessonPose) => [...POSE_AXES, "r" as const].every(axis => near(a[axis],b[axis]));

function fieldFeedback(task: CoordinateTask, field: CoordinateField, axis: keyof CoordinateVector, value: number | null): string {
  const axisName = axis.toUpperCase(), expected = coordinateExpected(task);
  if (value === null) return "값을 입력하세요. 빈칸은 0으로 처리하지 않습니다.";
  if (field === "delta" && near(value,task.b[axis])) return `도착 위치를 그대로 썼습니다. Δ${axisName}는 출발 위치에서 얼마나 변했는지 나타냅니다.`;
  if (field === "delta" && near(value,-expected.delta[axis])) return `빼는 순서가 반대입니다. 도착 위치에서 출발 위치를 빼서 부호를 확인하세요.`;
  if (task.kind === "endpoint" && near(value,expected.delta[axis])) return `변화량만 썼습니다. 출발점의 ${axisName}에 변화량을 더해 도착 위치를 구하세요.`;
  if (task.kind === "transfer" && field === "absolute" && near(value,expected.relative[axis])) return "절대 명령에도 새 출발점을 더했습니다. 이 명령이 지정한 원점 기준 도착 위치를 확인하세요.";
  if (task.kind === "transfer" && field === "relative" && near(value,task.b[axis])) return "처음 출발점의 도착 위치를 썼습니다. 같은 변화량을 새 출발점에 적용하세요.";
  if (task.kind === "literal" && field === "relative" && near(value,task.b[axis])) return "같은 숫자도 상대 이동에서는 위치가 아니라 변화량입니다. 실행 출발점에 더해야 합니다.";
  return field === "delta" ? `Δ${axisName} = B의 ${axisName} − A의 ${axisName} 순서와 계산을 확인하세요.`
    : field === "relative" || task.kind === "endpoint" ? `${axisName}의 출발 위치와 변화량을 더했는지 확인하세요.` : "절대 명령에 지정된 도착 좌표를 확인하세요.";
}
export function analyzeCoordinateAttempt(task: CoordinateTask, attempt: CoordinateAttempt) {
  const expected = coordinateExpected(task), commands = coordinateCommands(task,attempt.draft);
  const fields = coordinateFields(task).flatMap(field => POSE_AXES.map(axis => {
    const value = parseLessonNumber(attempt.draft[field][axis]), correct = value !== null && near(value,expected[field][axis]);
    return { field, axis, value, expected:expected[field][axis], correct, feedback:correct ? "일치" : fieldFeedback(task,field,axis,value) };
  }));
  const observed = attempt.source === "dt" && attempt.taskId === task.id && commands !== null && COORDINATE_MODES.every(mode => {
    const result = attempt.results[mode];
    return result && samePose(result.from,coordinateStart(task)) && samePose(result.to,commands[mode]);
  });
  const actualSame = commands !== null && samePose(commands.absolute,commands.relative);
  const comparisonCorrect = attempt.comparison === (actualSame ? "same" : "different");
  const ruleCorrect = !coordinateRule(task) || attempt.rule === coordinateRule(task);
  const numericCorrect = fields.every(field => field.correct);
  const review = attempt.judgmentReviews?.at(-1);
  const reviewCorrect = !!review && review.of === attempt.id && !!review.submittedAt
    && (!comparisonCorrect || !ruleCorrect)
    && review.comparison === (actualSame ? "same" : "different")
    && (!coordinateRule(task) || review.rule === coordinateRule(task))
    && (task.support !== "independent" || !!review.explanation.trim());
  return { fields, observed, actualSame, comparisonCorrect, ruleCorrect, numericCorrect,
    canComplete:observed && numericCorrect && ((comparisonCorrect && ruleCorrect) || reviewCorrect)
      && (task.support !== "independent" || (attempt.explanation.trim().length > 0 && attempt.hints === 0)) };
}
/** Keep the original prediction and both completed moves; only review the judgment. */
export function canReviewCoordinateJudgment(task: CoordinateTask, attempt: CoordinateAttempt): boolean {
  const a = analyzeCoordinateAttempt(task, attempt);
  return !attempt.completed && a.observed && a.numericCorrect && (!a.comparisonCorrect || !a.ruleCorrect)
    && (task.support !== "independent" || (!!attempt.explanation.trim() && attempt.hints === 0));
}
export function reviewCoordinateJudgment(task: CoordinateTask, attempt: CoordinateAttempt,
  input: Pick<CoordinateJudgmentReview, "comparison" | "rule" | "explanation">): CoordinateAttempt | null {
  if (!canReviewCoordinateJudgment(task, attempt) || !["same", "different"].includes(input.comparison)
    || (coordinateRule(task) && !input.rule) || (task.support === "independent" && !input.explanation.trim())) return null;
  const reviewed: CoordinateAttempt = { ...structuredClone(attempt), judgmentReviews: [
    ...structuredClone(attempt.judgmentReviews ?? []),
    { ...input, explanation: input.explanation.trim(), of: attempt.id, submittedAt: new Date().toISOString() },
  ] };
  return completeCoordinateAttempt(task, reviewed) ?? reviewed;
}
export function completeCoordinateAttempt(task: CoordinateTask, attempt: CoordinateAttempt): CoordinateAttempt | null {
  return analyzeCoordinateAttempt(task,attempt).canComplete ? { ...structuredClone(attempt), completed:true } : null;
}

export type CoordinateVisualPoint = { id: string; label: string; pose: LessonPose; from?: LessonPose; color: string; kind: "given" | "prediction" };
export type CoordinateTrail = CoordinateResult & { id: string; label: string; color: string };
export type CoordinateWorkpiece = {
  id: string; label: string; top: CoordinateVector; pick: CoordinateVector;
  place: CoordinateVector; attached: boolean; completed?: boolean;
};
export type CoordinateObstacle = {
  id: string; label: string; center: { x: number; y: number };
  width: number; depth: number; baseZ: number; height: number;
};
export type CoordinateVisual = { scenePoint?: (pose:LessonPose) => [number,number,number] | null; key: string; from: LessonPose; fromLabel: "A" | "C"; points: CoordinateVisualPoint[]; results: CoordinateAttempt["results"]; trails?: CoordinateTrail[]; showPaths?: boolean; workpiece?: { top:CoordinateVector; attached:boolean; pick:CoordinateVector; place:CoordinateVector; showPlace?:boolean }; workpieces?: CoordinateWorkpiece[]; obstacles?: CoordinateObstacle[] };
/** Unknown solutions never become preview points. Only given locations and complete student inputs do. */
export function coordinatePreview(task: CoordinateTask, draft: CoordinateDraft, submitted = false): CoordinateVisualPoint[] {
  if (task.support === "independent" && !submitted) return [];
  const points: CoordinateVisualPoint[] = [], from = coordinateStart(task);
  if (task.kind === "delta") {
    points.push({id:"given-b",label:"B · 주어진 도착점",pose:task.b,color:"#64748b",kind:"given"});
    const delta = readCoordinateVector(draft.delta);
    if (delta) points.push({id:"relative",label:"내 Δ로 만든 도착점",pose:translatePose(from,delta),color:"#9333ea",kind:"prediction"});
  } else {
    for (const mode of coordinateFields(task) as CoordinateMode[]) {
      const value = readCoordinateVector(draft[mode]);
      if (value) points.push({id:mode,label:`내 예상 · ${MODE_LABEL[mode]}`,pose:{...value,r:0},color:mode === "absolute" ? "#4f46e5" : "#9333ea",kind:"prediction"});
    }
  }
  return points;
}
export function coordinateWorldOffset(value: CoordinateVector): [number,number,number] { return [value.x,value.z,-value.y]; }

/** Keep the displayed coordinate origin, but project comparison markers through
 * the same CAD joint chain as the TCP. Commands and recorded coordinates stay unchanged. */
export function coordinateSceneOffset(visual: CoordinateVisual, value: CoordinateVector): [number,number,number] | null {
  if (!visual.scenePoint) return coordinateWorldOffset(value);
  const origin = visual.scenePoint(visual.from), point = visual.scenePoint({...value,r:0});
  if (!origin || !point) return null;
  const start = coordinateWorldOffset(visual.from);
  return point.map((component,index) => start[index] + component - origin[index]) as [number,number,number];
}
