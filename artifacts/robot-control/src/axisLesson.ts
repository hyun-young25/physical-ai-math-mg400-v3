import { POSE_AXES, translatePose, type LessonPose } from "./curriculum";

export type Axis = typeof POSE_AXES[number];
export type AxisChange = -1 | 0 | 1;
export type AxisPrediction = Record<Axis, AxisChange | null>;
export type AxisView = "top" | "side" | "front";
export type AxisTask = { id: string; axis: Axis; sign: -1 | 1; distance: number; view: AxisView; transferView: AxisView; reverse?: boolean };
export const AXIS_TASKS: readonly AxisTask[] = [
  { id: "x-plus", axis: "x", sign: 1, distance: 50, view: "side", transferView: "top" },
  { id: "y-minus", axis: "y", sign: -1, distance: 40, view: "front", transferView: "top" },
  { id: "z-plus", axis: "z", sign: 1, distance: 30, view: "front", transferView: "side" },
  { id: "x-minus", axis: "x", sign: -1, distance: 50, view: "top", transferView: "side" },
  { id: "y-plus", axis: "y", sign: 1, distance: 40, view: "top", transferView: "front" },
  { id: "z-minus", axis: "z", sign: -1, distance: 30, view: "side", transferView: "front", reverse: true },
];
export const blankAxisPrediction = (): AxisPrediction => ({ x: null, y: null, z: null });
export const hasAxisPrediction = (p: AxisPrediction) => POSE_AXES.every(a => p[a] === -1 || p[a] === 0 || p[a] === 1);
export const axisChangeLabel = (value: AxisChange | null) => value === null ? "미응답" : value === 0 ? "유지" : value > 0 ? "증가" : "감소";
export function axisTarget(start: LessonPose, task: AxisTask): LessonPose {
  return translatePose(start, { x: 0, y: 0, z: 0, [task.axis]: task.sign * task.distance });
}
export function observedAxisChanges(from: LessonPose, to: LessonPose): Record<Axis, AxisChange> {
  const change = (axis: Axis): AxisChange => Math.abs(to[axis] - from[axis]) < 0.01 ? 0 : to[axis] > from[axis] ? 1 : -1;
  return { x: change("x"), y: change("y"), z: change("z") };
}
export function axisPredictionMatches(prediction: AxisPrediction, from: LessonPose, to: LessonPose) {
  const observed = observedAxisChanges(from, to);
  return hasAxisPrediction(prediction) && POSE_AXES.every(a => prediction[a] === observed[a]);
}
// Same display orientation as the existing coordinate guide; no robot transforms change.
export function axisWorldVector(axis: Axis, sign: number = 1): [number, number, number] {
  return axis === "x" ? [sign, 0, 0] : axis === "y" ? [0, 0, -sign] : [0, sign, 0];
}
export type AxisCommand = { axis: Axis; sign: -1 | 1; distance?: number };
export function axisCommandTarget(start: LessonPose, task: AxisTask, command: AxisCommand | null) {
  if (task.reverse && !command) return null;
  return axisTarget(start, task.reverse ? { ...task, ...command! } : task);
}
export type AxisErrorKind = "axis" | "sign" | "distance" | "relation";
export type AxisRevision = { of: string; kinds: AxisErrorKind[]; explanation: string };
// A relation review refers to an existing execution; it is not another robot move.
export type AxisRelationReview = { of: string; submittedAt: string; relation: string; explanation: string };
export type AxisNumericEvidence = {
  version: 1; conditionId: string; delta: Record<Axis, number>; relation: string; hints: number;
  executedAt?: string;
  revision?: AxisRevision;
};
export type AxisAttempt = { id?: string; submittedAt?: string; prediction: AxisPrediction; from: LessonPose; to: LessonPose; reasoning?: string; view?: string; command?: AxisCommand; supportIds?: string[]; numeric?: AxisNumericEvidence };
export type AxisTaskRecord = {
  taskId: string; source: "dt"; attempts: AxisAttempt[]; reasonAttempts: number; transferAttempts: number;
  transferPrediction: AxisPrediction; transferView: AxisView;
  mode?: AxisLearningMode; correctionPrediction?: AxisPrediction; explanation?: string;
  explanationReview?: "teacher"; independentResult?: "first-match" | "revised";
  numericVersion?: 1;
  relationReview?: AxisRelationReview;
};
export function completeAxisTask(task: AxisTask, evidence: {
  attempts: AxisAttempt[]; reason: string; reasonAttempts: number; transferAttempts: number;
  transferPrediction: AxisPrediction; transferReason: string; viewChanged: boolean; currentView: string;
}): AxisTaskRecord | null {
  const last = evidence.attempts.at(-1);
  if (!last || !evidence.viewChanged || evidence.currentView !== task.transferView || task.view === task.transferView
    || evidence.reason !== "parallel" || evidence.transferReason !== "base"
    || !axisPredictionMatches(evidence.transferPrediction, last.from, last.to)) return null;
  return {
    taskId: task.id, source: "dt", attempts: structuredClone(evidence.attempts),
    reasonAttempts: evidence.reasonAttempts, transferAttempts: evidence.transferAttempts,
    transferPrediction: { ...evidence.transferPrediction }, transferView: task.transferView,
  };
}
export type AxisLessonVisual = {
  key: string; task: AxisTask; started: boolean; prediction: AxisPrediction;
  result: { from: LessonPose; to: LessonPose } | null;
  independent?: boolean;
  command?: AxisCommand | null;
  from?: LessonPose;
  predictedEnd?: LessonPose | null;
  numeric?: boolean;
  // Ephemeral scene projection only; never stored in attempt/learning records.
  scenePoint?: (pose: LessonPose) => [number, number, number] | null;
};

export const AXIS_INDEPENDENT_TASK: AxisTask = {
  id: "independent-y-minus", axis: "y", sign: -1, distance: 25, view: "front", transferView: "top",
};
export const AXIS_LESSON_TASKS: readonly AxisTask[] = [...AXIS_TASKS, AXIS_INDEPENDENT_TASK];
export type AxisLearningMode = "guided" | "practice" | "independent";
export const axisLearningMode = (task: AxisTask): AxisLearningMode => task.id === AXIS_INDEPENDENT_TASK.id
  ? "independent" : task.id === AXIS_TASKS[0].id ? "guided" : "practice";

export type AxisDiagnosis = { kind: "unanswered" | "axis" | "sign" | "fixed" | "missing"; message: string };
/** Feedback describes the submitted discrepancy, not a claim about a learner's mental state. */
export function diagnoseAxisPrediction(prediction: AxisPrediction, from: LessonPose, to: LessonPose): AxisDiagnosis[] {
  const observed = observedAxisChanges(from, to);
  const unanswered = POSE_AXES.filter(a => prediction[a] === null);
  if (unanswered.length) return [{ kind: "unanswered", message: `${unanswered.map(a => a.toUpperCase()).join("·")}의 변화를 먼저 선택하세요. 빈 답은 ‘유지’와 다릅니다.` }];
  const changed = POSE_AXES.filter(a => observed[a] !== 0);
  const extra = POSE_AXES.filter(a => observed[a] === 0 && prediction[a] !== 0);
  const missing = changed.filter(a => prediction[a] === 0);
  const reversed = changed.filter(a => prediction[a] === -observed[a]);
  const names = (values: Axis[]) => values.map(a => a.toUpperCase()).join("·");
  const result: AxisDiagnosis[] = [];
  if (missing.length && extra.length) result.push({ kind: "axis", message: `변하는 축 확인: ${names(extra)}가 변한다고 예측했지만 DT에서는 ${names(missing)}가 변했습니다. 화면의 가로·세로 대신 로봇 기준축과 이동 방향을 비교하세요.` });
  else {
    if (missing.length) result.push({ kind: "missing", message: `이동한 축 확인: ${names(missing)}를 유지로 선택했지만 이동 전후 값이 달라졌습니다. 이동 방향과 평행한 기준축을 찾아보세요.` });
    if (extra.length) result.push({ kind: "fixed", message: `유지되는 좌표 확인: ${names(extra)}도 변한다고 예측했지만 DT 변화량은 0입니다. 한 기준축과 평행한 이동에서 나머지 좌표가 유지되는지 비교하세요.` });
  }
  if (reversed.length) result.push({ kind: "sign", message: `부호 확인: ${names(reversed)}가 변한다는 판단은 맞지만 증가·감소가 반대입니다. +축 화살표와 같은 방향인지, 반대 방향인지 비교하세요.` });
  return result;
}

export function axisReasonFeedback(reason: string): string {
  return reason === "one-joint"
    ? "관절의 회전과 TCP의 이동을 구분해 보세요. 여러 관절이 함께 움직여도 TCP는 한 기준축과 평행하게 이동할 수 있습니다."
    : "카메라는 보는 방향을 바꿉니다. 좌표 변화는 로봇 베이스의 기준축으로 판단합니다. 이동 전후 좌표를 다시 비교하세요.";
}

export function axisAttemptReachesGoal(task: AxisTask, last: AxisAttempt | undefined) {
  if (!last || !hasAxisPrediction(last.prediction)) return false;
  const target = axisTarget(last.from, task);
  return [...POSE_AXES, "r" as const].every(a => Number.isFinite(last.to[a]) && Number.isFinite(target[a]) && Math.abs(last.to[a] - target[a]) < 0.01);
}
const snapshotAttempts = (attempts: AxisAttempt[]) => attempts.map(a => ({ ...a,
  prediction: { ...a.prediction }, from: { ...a.from }, to: { ...a.to },
  ...(a.command ? { command: { ...a.command } } : {}), ...(a.supportIds ? { supportIds: [...a.supportIds] } : {}),
}));

export function completeAxisPractice(task: AxisTask, attempts: AxisAttempt[], correction: AxisPrediction): AxisTaskRecord | null {
  const last = attempts.at(-1);
  if (axisLearningMode(task) !== "practice" || !axisAttemptReachesGoal(task, last) || !last
    || !axisPredictionMatches(correction, last.from, last.to)) return null;
  return { taskId: task.id, source: "dt", mode: "practice", attempts: snapshotAttempts(attempts),
    reasonAttempts: 0, transferAttempts: 0, transferPrediction: { ...correction }, transferView: task.view,
    correctionPrediction: { ...correction } };
}

export function completeAxisIndependent(task: AxisTask, evidence: {
  attempts: AxisAttempt[]; correction: AxisPrediction; revisedReasoning: string;
}): AxisTaskRecord | null {
  const first = evidence.attempts[0], last = evidence.attempts.at(-1);
  if (axisLearningMode(task) !== "independent" || !first || !last
    || evidence.attempts.some(a => !axisAttemptReachesGoal(task, a) || a.view !== task.transferView || !a.reasoning?.trim())
    || !axisPredictionMatches(evidence.correction, last.from, last.to)) return null;
  const firstMatch = axisPredictionMatches(first.prediction, first.from, first.to);
  if (!firstMatch && !evidence.revisedReasoning.trim()) return null;
  return { taskId: task.id, source: "dt", mode: "independent", attempts: snapshotAttempts(evidence.attempts),
    reasonAttempts: 0, transferAttempts: 0, transferPrediction: { ...evidence.correction }, transferView: task.transferView,
    correctionPrediction: { ...evidence.correction }, explanation: firstMatch ? first.reasoning!.trim() : evidence.revisedReasoning.trim(),
    explanationReview: "teacher", independentResult: firstMatch ? "first-match" : "revised" };
}
