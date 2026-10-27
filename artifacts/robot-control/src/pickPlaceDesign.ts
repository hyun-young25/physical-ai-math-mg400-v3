import {
  POSE_AXES,
  parseLessonNumber,
  sampleLessonMotion,
  type LessonPose,
  type LessonFrame,
  type LessonModel,
  type LessonJoints,
} from "./curriculum";

export type DesignCondition = {
  id: string;
  title: string;
  pick: LessonPose;
  place: LessonPose;
  clearance: number;
  start: LessonPose;
  level?: number;
  goal?: string;
  maxCommands?: number;
  transfers?: DesignTransfer[];
  obstacles?: DesignObstacle[];
};
export type DesignTransfer = { id: string; label: string; pick: LessonPose; place: LessonPose };
export type DesignObstacle = { id: string; label: string; center: { x: number; y: number }; width: number; depth: number; baseZ: number; height: number };
export type DesignWorkpiece = DesignTransfer & { top: LessonPose; attached: boolean; completed: boolean };

const pose = (x: number, y: number, z: number): LessonPose => ({
  x,
  y,
  z,
  r: 0,
});
export const DESIGN_CONDITIONS: DesignCondition[] = [
  {
    id: "design-first",
    title: "높이가 다른 받침대로 옮기기",
    pick: pose(300, -50, 0),
    place: pose(300, 50, 20),
    clearance: 60,
    start: pose(300, -50, 80),
  },
  {
    id: "design-transfer",
    title: "물체와 받침대의 위치·높이가 바뀌면?",
    pick: pose(280, -40, 20),
    place: pose(310, 50, 40),
    clearance: 80,
    start: pose(280, -40, 100),
  },
];
/** Task difficulty changes the problem; it is independent of the support mode. */
export const PICK_LEVELS: DesignCondition[] = [
  { id: "pick-level-1", level: 1, title: "블록 한 개 옮기기", goal: "정해진 순서를 따라 블록을 목표 위치에 놓습니다.", pick: pose(300, -50, 0), place: pose(300, 50, 0), clearance: 40, start: pose(300, -50, 80), maxCommands: 7 },
  { id: "pick-level-2", level: 2, title: "장애물 위로 안전하게", goal: "장애물과 블록의 크기를 고려해 운반 높이를 정합니다.", pick: pose(300, -50, 0), place: pose(300, 50, 20), clearance: 60, start: pose(300, -50, 80), maxCommands: 12,
    obstacles: [{ id: "barrier", label: "장애물 · 윗면 Z 40", center: { x: 300, y: 0 }, width: 65, depth: 22, baseZ: -12, height: 52 }] },
  { id: "pick-level-3", level: 3, title: "블록 두 개 순서대로", goal: "A를 먼저, B를 다음으로 서로 다른 목표에 놓습니다.", pick: pose(280, -55, 0), place: pose(280, 55, 0), clearance: 60, start: pose(280, -55, 80), maxCommands: 20,
    transfers: [
      { id: "A", label: "A", pick: pose(280, -55, 0), place: pose(280, 55, 0) },
      { id: "B", label: "B", pick: pose(325, -55, 0), place: pose(325, 55, 20) },
    ] },
  { id: "pick-level-4", level: 4, title: "같은 작업, 더 짧은 경로", goal: "기준 경로를 실행한 뒤, 안전 조건을 지키며 TCP 이동 거리를 10% 이상 줄입니다.", pick: pose(300, -50, 0), place: pose(300, 50, 20), clearance: 60, start: pose(300, -50, 80), maxCommands: 12,
    obstacles: [{ id: "barrier", label: "장애물 · 윗면 Z 40", center: { x: 300, y: 0 }, width: 65, depth: 22, baseZ: -12, height: 52 }] },
];
export const designTransfers = (condition: DesignCondition): DesignTransfer[] => condition.transfers ?? [{ id: "A", label: "블록", pick: condition.pick, place: condition.place }];
export const initialDesignWorkpieces = (condition: DesignCondition): DesignWorkpiece[] => designTransfers(condition).map(t => ({ ...t, top: { ...t.pick }, attached: false, completed: false }));
export const designDistance = (a: LessonPose, b: LessonPose) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export type DesignCommand = {
  id: string;
  action: "move" | "grip" | "release";
  mode: "" | "absolute" | "relative";
  motion: "" | "MoveJ" | "MoveL";
  values: { x: string; y: string; z: string };
};
export type DesignConcept =
  | "reference"
  | "height"
  | "path"
  | "sequence"
  | "prediction"
  | "reach"
  | "collision"
  | "efficiency";
export const DESIGN_CONCEPTS: Record<DesignConcept, string> = {
  reference: "위치·변화량의 기준",
  height: "운반 높이",
  path: "경로와 보간 선택",
  sequence: "흡착·이동·해제 순서",
  prediction: "예측과 결과",
  reach: "모델 도달 범위",
  collision: "장애물과 블록의 간격",
  efficiency: "경로 길이 비교",
};
export type DesignIssue = {
  concept: DesignConcept;
  step?: number;
  message: string;
  hint: string;
};
export type DesignObservation = {
  step: number;
  action: DesignCommand["action"];
  from: LessonPose;
  target?: LessonPose;
  observed: LessonPose;
  attached: boolean;
  object: LessonPose;
};
export type DesignFrame = LessonFrame & {
  step: number;
  attached: boolean;
  object: LessonPose;
  workpieces: DesignWorkpiece[];
};
export type DesignOutcome = {
  observations: DesignObservation[];
  issues: DesignIssue[];
  object: LessonPose;
  final: LessonPose;
  maxHeldZ: number | null;
  finished: boolean;
  pathLength: number;
  workpieces: DesignWorkpiece[];
  completedTransfers: number;
};
export const designId = () =>
  globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + "-" + Math.random();
export const blankDesignCommand = (
  action: DesignCommand["action"],
): DesignCommand => ({
  id: designId(),
  action,
  mode: "",
  motion: "",
  values: { x: "", y: "", z: "" },
});
export const designNear = (a: LessonPose, b: LessonPose) =>
  POSE_AXES.every((k) => Math.abs(a[k] - b[k]) <= 0.15);
export const designPoint = (p: Pick<LessonPose, "x" | "y" | "z">) =>
  "(" + POSE_AXES.map((k) => Number(p[k].toFixed(2))).join(", ") + ")";
export function designTarget(
  from: LessonPose,
  command: DesignCommand,
): LessonPose | null {
  const v = POSE_AXES.map((k) => parseLessonNumber(command.values[k]));
  if (v.some((n) => n === null) || !command.mode || !command.motion)
    return null;
  return {
    x: v[0]! + (command.mode === "relative" ? from.x : 0),
    y: v[1]! + (command.mode === "relative" ? from.y : 0),
    z: v[2]! + (command.mode === "relative" ? from.z : 0),
    r: from.r,
  };
}
export function designSyntax(
  commands: DesignCommand[],
  prediction: string,
  reason: string,
  maxCommands = 12,
): string | null {
  if (!commands.length) return "이동·흡착·해제 명령을 추가해 순서를 만드세요.";
  if (commands.length > maxCommands)
    return `이 과제에서는 ${maxCommands}개 이내의 명령으로 계획하세요.`;
  if (
    commands.some((c) => c.action === "move" && !designTarget(pose(0, 0, 0), c))
  )
    return "각 이동의 좌표 기준, 이동 방식과 세 좌표를 모두 입력하세요.";
  if (parseLessonNumber(prediction) === null || !reason.trim())
    return "운반 중 물체 윗면의 최고 높이 예측과 설계 근거를 적으세요.";
  return null;
}
/** Template moves are editable; the compiler never substitutes a corrected answer. */
export function designPlan(condition: DesignCondition, height = condition.clearance, destinationY?: number): DesignCommand[] {
  const move = (p: LessonPose): DesignCommand => ({ ...blankDesignCommand("move"), mode: "absolute", motion: "MoveL", values: { x: String(p.x), y: String(p.y), z: String(p.z) } });
  const commands: DesignCommand[] = [];
  for (const [i, t] of designTransfers(condition).entries()) {
    const target = destinationY === undefined ? t.place : { ...t.place, y: destinationY };
    if (i) commands.push(move({ ...t.pick, z: height }));
    commands.push(move(t.pick), blankDesignCommand("grip"), move({ ...t.pick, z: height }), move({ ...target, z: height }), move(target), blankDesignCommand("release"), move({ ...target, z: target.z + 10 }));
  }
  return commands;
}
/** Axis-aligned 24 × 24 × 20 mm block, whose coordinate is its top face. */
export function designHitsObstacle(top: LessonPose, obstacle: DesignObstacle, carrying: boolean) {
  const radius = carrying ? 12 : 2;
  const bottom = top.z - (carrying ? 20 : 0);
  return Math.abs(top.x - obstacle.center.x) < obstacle.width / 2 + radius - 0.15 &&
    Math.abs(top.y - obstacle.center.y) < obstacle.depth / 2 + radius - 0.15 &&
    bottom < obstacle.baseZ + obstacle.height - 0.15 && top.z > obstacle.baseZ + 0.15;
}
/** Compile the exact student plan and retain the valid prefix if motion is unavailable. */
export function compileDesign(model: LessonModel, condition: DesignCondition, commands: DesignCommand[], r: number, hint: number) {
  let current = { ...condition.start, r }, object = { ...condition.pick, r };
  let attachedIndex: number | null = null, maxHeldZ: number | null = null, pathLength = 0;
  let lastMove: DesignObservation | undefined, lastMotion: DesignCommand["motion"] = "";
  let pendingRetreat: { pose: LessonPose; cleared: boolean } | null = null;
  const workpieces = initialDesignWorkpieces(condition).map(w => ({ ...w, top: { ...w.top, r } }));
  const frames: DesignFrame[] = [], observations: DesignObservation[] = [], issues: DesignIssue[] = [];
  const add = (concept: DesignConcept, message: string, hintText: string, step?: number) => issues.push({ concept, message, hint: hintText, step });
  const snapshot = () => workpieces.map(w => ({ ...w, top: { ...w.top } }));
  const finish = (finished: boolean): DesignOutcome => ({ observations, issues, object: { ...object }, final: { ...current }, maxHeldZ, finished, pathLength, workpieces: snapshot(), completedTransfers: workpieces.filter(w => w.completed).length });
  const initial = model.ik(current.x, current.y, current.z, r, hint);
  if (!initial) {
    add("reach", "주어진 출발 위치를 모델에서 계산할 수 없습니다.", "초기값과 현재 모델 상태를 확인하세요.");
    return { frames, outcome: finish(false) };
  }
  let joints: LessonJoints = initial;
  const append = (p: LessonFrame, step: number) => frames.push({ ...p, pose: { ...p.pose }, step, attached: attachedIndex !== null, object: { ...object }, workpieces: snapshot() });
  for (let i = 0; i < commands.length; i++) {
    const command = commands[i], from = { ...current };
    if (command.action === "move") {
      const target = designTarget(from, command);
      const path = target ? sampleLessonMotion(model, from, target, command.motion as "MoveJ" | "MoveL", joints.j3) : null;
      if (!path) {
        add("reach", `${i + 1}단계의 입력 위치 또는 중간 경로를 이 모델에서 계산할 수 없습니다.`, "절대 명령은 도착 위치, 상대 명령은 현재 위치에서 더할 변화량입니다. 도달 범위를 확인하세요.", i);
        return { frames, outcome: finish(false) };
      }
      const actual = path.map(frame => ({ ...frame, pose: model.fk(frame.joints) }));
      const horizontal = Math.hypot(target!.x - from.x, target!.y - from.y) > 0.15;
      if (attachedIndex !== null && horizontal && Math.min(...actual.map(f => f.pose.z)) < condition.clearance - 0.15)
        add("height", `${i + 1}단계에서 물체를 옆으로 옮길 때 높이가 조건 ${condition.clearance} mm 아래로 내려갑니다.`, "먼저 충분히 들어 올린 뒤 운반하세요. MoveJ는 중간 높이도 달라질 수 있습니다.", i);
      if (pendingRetreat && !pendingRetreat.cleared) {
        if (actual.some(f => f.pose.z < from.z - 0.15))
          add("height", `${i + 1}단계: 해제한 블록에서 흡착기를 떼기 전에 아래로 이동했습니다.`, "해제 직후에는 아래로 내려가지 말고 같은 X·Y에서 10 mm 이상 수직 상승하세요.", i);
        const sameXY = actual.every(f => Math.hypot(f.pose.x - pendingRetreat!.pose.x, f.pose.y - pendingRetreat!.pose.y) <= 0.15);
        if (!sameXY) {
          add("height", `${i + 1}단계: 해제 후 먼저 같은 X·Y에서 10 mm 이상 올라오세요.`, "놓은 블록에서 흡착기를 수직으로 뗀 뒤 다음 위치로 이동합니다.", i);
          pendingRetreat = null;
        } else if (actual.at(-1)!.pose.z >= pendingRetreat.pose.z + 10 - 0.15) pendingRetreat.cleared = true;
      }
      for (const obstacle of condition.obstacles ?? [])
        if (actual.some(f => designHitsObstacle(f.pose, obstacle, attachedIndex !== null)))
          add("collision", `${i + 1}단계에서 ${attachedIndex !== null ? "운반 블록" : "TCP"}의 경로가 장애물과 겹칩니다.`, "블록 윗면 좌표에서 두께 20 mm를 빼면 아랫면 높이입니다. 장애물 윗면보다 높게 통과해야 합니다.", i);
      let last = from;
      for (const frame of actual) {
        pathLength += designDistance(last, frame.pose);
        last = frame.pose;
        if (attachedIndex !== null) {
          object = { ...frame.pose };
          workpieces[attachedIndex].top = { ...object };
          maxHeldZ = Math.max(maxHeldZ ?? frame.pose.z, frame.pose.z);
        }
        append(frame, i);
      }
      current = { ...actual.at(-1)!.pose }; joints = actual.at(-1)!.joints;
      const observation = { step: i, action: command.action, from, target: target!, observed: { ...current }, attached: attachedIndex !== null, object: { ...object } };
      observations.push(observation); lastMove = observation; lastMotion = command.motion;
    } else {
      if (command.action === "grip") {
        const targetIndex = workpieces.findIndex(w => !w.completed && designNear(current, w.top));
        const expectedIndex = workpieces.findIndex(w => !w.completed);
        if (attachedIndex !== null || targetIndex < 0)
          add("sequence", `${i + 1}단계: TCP ${designPoint(current)}에서 새 물체를 흡착할 수 없습니다.`, "아직 옮기지 않은 물체의 윗면에 먼저 도착하세요.", i);
        else if (targetIndex !== expectedIndex)
          add("sequence", `${i + 1}단계: ${workpieces[expectedIndex].label}를 먼저 옮겨야 합니다.`, "A를 지정 위치에 놓고 수직 상승한 뒤 B로 이동하세요.", i);
        else {
          attachedIndex = targetIndex; workpieces[targetIndex].attached = true;
          object = { ...current }; workpieces[targetIndex].top = { ...object };
          maxHeldZ = Math.max(maxHeldZ ?? current.z, current.z);
        }
      } else if (attachedIndex === null) {
        add("sequence", `${i + 1}단계: 잡고 있는 물체가 없어 해제할 수 없습니다.`, "물체 위치 도착 → 흡착 → 운반 → 해제 순서를 확인하세요.", i);
      } else {
        const held = workpieces[attachedIndex];
        if (!lastMove || lastMove.step !== i - 1 || lastMotion !== "MoveL" || Math.hypot(lastMove.from.x - current.x, lastMove.from.y - current.y) > 0.15 || lastMove.from.z <= current.z + 0.15)
          add("path", `${i + 1}단계: 내려놓기 직전 이동이 수직 하강 MoveL 조건을 만족하지 않습니다.`, "놓을 곳 바로 위에서 X·Y를 유지하며 Z만 줄이는 MoveL을 계획하세요.", i);
        object = { ...current }; held.top = { ...object }; held.attached = false;
        held.completed = designNear(object, held.place);
        if (!held.completed) add("reference", `${held.label} 도착 ${designPoint(object)}이 놓을 위치 ${designPoint(held.place)}와 다릅니다.`, "상대값은 목표 위치에서 해당 이동의 실제 출발 위치를 뺀 변화량입니다.", i);
        attachedIndex = null; pendingRetreat = { pose: { ...current }, cleared: false };
      }
      for (let n = 0; n < 24; n++) append({ joints: { ...joints }, pose: { ...current } }, i);
      observations.push({ step: i, action: command.action, from, observed: { ...current }, attached: attachedIndex !== null, object: { ...object } });
    }
  }
  if (workpieces.some(w => !w.completed) || attachedIndex !== null)
    add("sequence", `목표에 놓은 블록 ${workpieces.filter(w => w.completed).length}/${workpieces.length}개. 모든 블록의 운반을 마치지 못했습니다.`, "각 블록을 정해진 순서대로 지정 위치에 놓아야 합니다.");
  if (pendingRetreat && !pendingRetreat.cleared)
    add("height", "놓은 뒤 TCP를 물체 위로 10 mm 이상 올려야 합니다.", "해제 후 물체의 X·Y를 유지한 채 흡착기를 위로 이동시키세요.");
  return { frames, outcome: finish(true) };
}
export type DesignAssessmentContext = { condition: DesignCondition; phase?: "baseline" | "plan"; baselineLength?: number };
export function designImprovement(length: number, baselineLength: number) { return (baselineLength - length) / baselineLength * 100; }
export function judgeDesign(
  outcome: DesignOutcome,
  prediction: string,
  context?: DesignAssessmentContext,
): DesignIssue[] {
  const issues = [...outcome.issues],
    p = parseLessonNumber(prediction);
  if (
    outcome.finished &&
    outcome.maxHeldZ !== null &&
    (p === null || Math.abs(p - outcome.maxHeldZ) > 0.15)
  )
    issues.push({
      concept: "prediction",
      message:
        "운반 중 최고 높이: 내 예상 " +
        prediction +
        " mm, DT " +
        outcome.maxHeldZ.toFixed(2) +
        " mm.",
      hint: "최고 높이는 원점 기준 위치입니다. 들어 올린 변화량이나 해제 후 흡착기 높이와 구분하세요.",
    });
  if (context?.condition.level === 4 && context.phase !== "baseline") {
    if (!context.baselineLength || !Number.isFinite(context.baselineLength))
      issues.push({ concept: "efficiency", message: "먼저 기준 경로를 끝까지 실행해 이동 거리를 측정하세요.", hint: "기준 경로의 실제 DT 실행 기록과 수정 경로를 비교합니다." });
    else if (designImprovement(outcome.pathLength, context.baselineLength) < 10 - 1e-6)
      issues.push({ concept: "efficiency", message: `기준 ${context.baselineLength.toFixed(1)} mm → 현재 ${outcome.pathLength.toFixed(1)} mm. 10% 이상 줄여야 합니다.`, hint: "장애물과의 간격, 수직 하강, 해제 후 상승은 유지하면서 불필요한 높이나 경유점을 줄이세요." });
  }
  return issues;
}
/** Completion requires an executed, finished, successful plan (never a baseline or stopped run). */
export function designLevelPassed(record: { status: string; outcome?: DesignOutcome; prediction: string; condition: DesignCondition; phase?: "baseline" | "plan"; baselineLength?: number; predictionReviews?: { value: string }[] }) {
  return record.status === "completed" && record.phase !== "baseline" && !!record.outcome?.finished &&
    judgeDesign(record.outcome, record.predictionReviews?.at(-1)?.value ?? record.prediction, record).length === 0;
}

