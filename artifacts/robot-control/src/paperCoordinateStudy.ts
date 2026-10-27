import type { LessonPose } from "./curriculum";

export type PaperCoordinateLevel = "basic" | "quarter-turn" | "rotated";
export type PaperTargetSet = "initial" | "revalidation";
export type PaperPointName = "O" | "X" | "Y";
export type PaperReferenceSource = "hardware" | "mock" | "teacher";
export type PaperEvidenceSource = PaperReferenceSource | "dt";

export type PaperGridPoint = { name: string; xCm: number; yCm: number };
export type PaperReferenceSample = {
  point: PaperPointName;
  pose: LessonPose;
  source: PaperReferenceSource;
  seq: number | null;
  capturedAt: number;
  ageMsAtCapture: number | null;
  user: number;
  tool: number;
  coordinateSystem: string;
  verifiedCoordinates: boolean;
};

export type PaperFrame = {
  id: string;
  samples: PaperReferenceSample[];
  source: PaperEvidenceSource;
  coordinateSystem: string;
  user: number;
  tool: number;
  capturedAt: number;
};

export type PaperStudentTransform = {
  originX: string;
  originY: string;
  axisDirection: "" | "x+" | "y+" | "x-" | "y-";
  millimetersPerCentimeter: string;
  rotationDegrees: string;
  explanation: string;
};

export type PaperPredictionPoint = PaperGridPoint & {
  robotX: string;
  robotY: string;
  robotZ?: string;
  robotR?: string;
};

export type PaperPoseObservation = {
  point: string;
  source: PaperEvidenceSource;
  seq: number | null;
  measuredAt: number;
  ageMs: number | null;
  pose: LessonPose;
  command: LessonPose;
  kind: "controller-getpose" | "mock-bridge" | "dt";
};

export type PaperRunSnapshot = {
  id: string;
  planHash: string;
  frameId: string;
  targetSet: PaperTargetSet;
  source: PaperEvidenceSource;
  status: "running" | "completed" | "partial" | "failed" | "cancelled";
  startedAt: number;
  endedAt?: number;
  startSequence: number | null;
  commands: Array<{ point: string; pose: LessonPose }>;
  observations: PaperPoseObservation[];
  error?: string;
};

export type PaperDiagnosis = {
  method: "rule-based";
  source: PaperEvidenceSource;
  status: "complete" | "incomplete" | "invalidated";
  candidate: string;
  evidence: Array<{ point: string; dx: number; dy: number; distance: number }>;
  predictionEvidence: Array<{ point: string; dx: number; dy: number; distance: number }>;
  firstMismatch: string | null;
  question: string;
  why: string;
  tutorSource: "AI phrasing" | "default question";
};

export type PaperTrialRecord = {
  id: string;
  task: "paper-coordinate";
  version: 1;
  attempt: number;
  parentAttemptId: string | null;
  targetSet: PaperTargetSet;
  level: PaperCoordinateLevel;
  status: "references" | "model" | "prediction" | "running" | "observed" | "diagnosed" | "reasoned" | "revised" | "revalidated" | "incomplete";
  stage?: number;
  dataSource: PaperEvidenceSource;
  createdAt: string;
  updatedAt: string;
  referenceSamples?: PaperReferenceSample[];
  frame?: PaperFrame;
  transform?: PaperStudentTransform;
  predictions?: PaperPredictionPoint[];
  planHash?: string;
  run?: PaperRunSnapshot;
  dtRunPlanHash?: string;
  inkReadings?: Array<{ point: string; xCm: number | null; yCm: number | null; recordedAt: number }>;
  diagnosis?: PaperDiagnosis;
  studentHypothesis?: string;
  revisionReason?: string;
  revalidationTarget?: PaperTargetSet | null;
  invalidatedRunIds?: string[];
  liftHeight?: { z: number; source: PaperReferenceSource; seq: number | null; capturedAt: number; ageMsAtCapture: number | null; user: number; tool: number; coordinateSystem: string };
  predictionModelComparison?: Array<{ point: string; dx: number; dy: number; distance: number }>;
};

export const PAPER_GRID_SIZE_CM = 10;
export const PAPER_MEASURE_TOLERANCE_MM = 2;
export const PAPER_ANGLE_TOLERANCE_DEG = 2;
export const PAPER_SAMPLE_MAX_AGE_MS = 1_500;
export const PAPER_FRAME_SPAN_MAX_MS = 120_000;

export const PAPER_TARGETS: Record<PaperTargetSet, PaperGridPoint[]> = {
  initial: [
    { name: "A", xCm: 3, yCm: 2 },
    { name: "B", xCm: 9, yCm: 2 },
    { name: "C", xCm: 6, yCm: 7 },
  ],
  revalidation: [
    { name: "D", xCm: 2, yCm: 3 },
    { name: "E", xCm: 8, yCm: 3 },
    { name: "F", xCm: 5, yCm: 8 },
  ],
};

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const pointDistance = (a: LessonPose, b: LessonPose) => Math.hypot(a.x - b.x, a.y - b.y);
const normalizeAngle = (value: number) => ((value % 360) + 360) % 360;
const angleDifference = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

export function validatePaperFrame(samples: PaperReferenceSample[], now = Date.now()): { ok: true; frame: PaperFrame } | { ok: false; reason: string } {
  if (samples.length !== 3 || new Set(samples.map(sample => sample.point)).size !== 3
    || !(["O", "X", "Y"] as const).every(point => samples.some(sample => sample.point === point)))
    return { ok: false, reason: "O, X, Y 기준점을 각각 한 번씩 기록해야 합니다." };
  if (samples.some(sample => ![sample.pose.x, sample.pose.y, sample.pose.z, sample.pose.r].every(finite)))
    return { ok: false, reason: "기준점 좌표에 유효하지 않은 값이 있습니다." };
  const sources = new Set(samples.map(sample => sample.source));
  if (sources.size !== 1) return { ok: false, reason: "기준점 자료 출처가 섞였습니다. 세 점을 같은 출처로 다시 기록하세요." };
  if (samples.some(sample => sample.capturedAt > now || now - sample.capturedAt > PAPER_FRAME_SPAN_MAX_MS))
    return { ok: false, reason: "기준점이 오래됐습니다. O/X/Y를 다시 기록하세요." };
  if (samples.some(sample => sample.source !== "teacher"
    && (sample.seq === null || !Number.isSafeInteger(sample.seq) || sample.ageMsAtCapture === null
      || sample.ageMsAtCapture > PAPER_SAMPLE_MAX_AGE_MS || !sample.verifiedCoordinates)))
    return { ok: false, reason: "실장비·모의 기준점에는 최신 회신과 확인된 좌표계 설정이 필요합니다." };
  if (new Set(samples.map(sample => `${sample.coordinateSystem}|${sample.user}|${sample.tool}`)).size !== 1)
    return { ok: false, reason: "좌표계 또는 User/Tool 설정이 서로 다릅니다. 설정을 맞추고 다시 기록하세요." };
  if (samples.some(sample => sample.user < 0 || sample.tool < 0 || !sample.coordinateSystem.trim()))
    return { ok: false, reason: "좌표계, User, Tool 설정을 기록하세요." };
  const sequences = samples.map(sample => sample.seq).filter((seq): seq is number => seq !== null);
  if (new Set(sequences).size !== sequences.length)
    return { ok: false, reason: "기준점에 같은 측정 일련번호가 사용되었습니다. 새 회신으로 다시 기록하세요." };
  const sorted = [...samples].sort((a, b) => a.capturedAt - b.capturedAt);
  if (sorted.at(-1)!.capturedAt - sorted[0].capturedAt > PAPER_FRAME_SPAN_MAX_MS)
    return { ok: false, reason: "기준점 기록 시간이 너무 벌어졌습니다. O/X/Y를 다시 기록하세요." };
  const O = samples.find(sample => sample.point === "O")!;
  const X = samples.find(sample => sample.point === "X")!;
  const Y = samples.find(sample => sample.point === "Y")!;
  const ox = pointDistance(O.pose, X.pose);
  const oy = pointDistance(O.pose, Y.pose);
  if (ox < 1 || oy < 1 || Math.abs(ox - 100) > PAPER_MEASURE_TOLERANCE_MM
    || Math.abs(oy - 100) > PAPER_MEASURE_TOLERANCE_MM)
    return { ok: false, reason: "O–X와 O–Y는 각각 100 mm 기준선이어야 합니다. 길이 오차가 2 mm를 넘습니다." };
  const zSpread = Math.max(...samples.map(sample => sample.pose.z)) - Math.min(...samples.map(sample => sample.pose.z));
  if (zSpread > PAPER_MEASURE_TOLERANCE_MM)
    return { ok: false, reason: "기준점 높이가 서로 다릅니다. 종이 평면과 펜 끝 높이를 확인하세요." };
  const ax = X.pose.x - O.pose.x, ay = X.pose.y - O.pose.y;
  const bx = Y.pose.x - O.pose.x, by = Y.pose.y - O.pose.y;
  const lengths = Math.hypot(ax, ay) * Math.hypot(bx, by);
  const cos = lengths === 0 ? 1 : (ax * bx + ay * by) / lengths;
  const rightAngleError = Math.abs(Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI - 90);
  if (rightAngleError > PAPER_ANGLE_TOLERANCE_DEG)
    return { ok: false, reason: "O–X와 O–Y 기준선이 일직선에 가깝거나 직각에서 2° 넘게 벗어났습니다." };
  if (samples.some(sample => angleDifference(sample.pose.r, O.pose.r) > PAPER_ANGLE_TOLERANCE_DEG))
    return { ok: false, reason: "기준점의 공구 방향이 달라 같은 좌표계로 비교할 수 없습니다." };
  const source = samples[0].source;
  return {
    ok: true,
    frame: {
      id: `${source}-${sorted[0].capturedAt}-${sorted.at(-1)!.capturedAt}-${O.seq ?? "manual"}`,
      samples: [...samples],
      source,
      coordinateSystem: O.coordinateSystem,
      user: O.user,
      tool: O.tool,
      capturedAt: sorted.at(-1)!.capturedAt,
    },
  };
}

export function frameTransformPoint(frame: PaperFrame, point: Pick<PaperGridPoint, "xCm" | "yCm">): LessonPose {
  const O = frame.samples.find(sample => sample.point === "O")!.pose;
  const X = frame.samples.find(sample => sample.point === "X")!.pose;
  const Y = frame.samples.find(sample => sample.point === "Y")!.pose;
  return {
    x: O.x + (X.x - O.x) * point.xCm / PAPER_GRID_SIZE_CM + (Y.x - O.x) * point.yCm / PAPER_GRID_SIZE_CM,
    y: O.y + (X.y - O.y) * point.xCm / PAPER_GRID_SIZE_CM + (Y.y - O.y) * point.yCm / PAPER_GRID_SIZE_CM,
    z: (O.z + X.z + Y.z) / 3,
    r: O.r,
  };
}

export function studentTransformPoint(transform: PaperStudentTransform, point: Pick<PaperGridPoint, "xCm" | "yCm">): LessonPose | null {
  const originX = Number(transform.originX), originY = Number(transform.originY);
  const scale = Number(transform.millimetersPerCentimeter);
  const rotation = Number(transform.rotationDegrees);
  if (![originX, originY, scale, rotation].every(Number.isFinite) || scale <= 0 || !transform.axisDirection)
    return null;
  const quarterTurn = { "x+": 0, "y+": 90, "x-": 180, "y-": 270 }[transform.axisDirection];
  const radians = normalizeAngle(quarterTurn + rotation) * Math.PI / 180;
  const px = point.xCm * scale, py = point.yCm * scale;
  return {
    x: originX + px * Math.cos(radians) - py * Math.sin(radians),
    y: originY + px * Math.sin(radians) + py * Math.cos(radians),
    z: 0,
    r: 0,
  };
}

export function makePaperPlanHash(frameId: string, targetSet: PaperTargetSet, transform: PaperStudentTransform, predictions: PaperPredictionPoint[]): string {
  return JSON.stringify({ frameId, targetSet, transform, predictions: predictions.map(point => ({
    name: point.name, paperX: point.xCm, paperY: point.yCm,
    x: point.robotX, y: point.robotY, z: point.robotZ, r: point.robotR,
  })) });
}

export function validatePaperRunForDiagnosis(run: PaperRunSnapshot, frame: PaperFrame, currentPlanHash: string): string | null {
  if (run.status !== "completed" || run.endedAt === undefined)
    return "실행이 부분 완료 또는 중단되어 전체 비교를 완료할 수 없습니다.";
  if (run.frameId !== frame.id || run.planHash !== currentPlanHash)
    return "기준점 또는 예측이 바뀌었습니다. 이전 실행·측정은 재사용하지 않습니다.";
  if (run.source === "hardware" && frame.source !== "hardware")
    return "실장비 실행에는 세 기준점의 실장비 GetPose가 필요합니다.";
  const targets = PAPER_TARGETS[run.targetSet];
  if (run.observations.length !== targets.length || run.commands.length !== targets.length)
    return "세 목표점 모두 새 제어기 회신이 있어야 비교할 수 있습니다.";
  const ids = new Set<number>();
  for (let i = 0; i < run.observations.length; i++) {
    const observation = run.observations[i];
    if (observation.source !== run.source || observation.measuredAt < run.startedAt
      || observation.measuredAt > run.endedAt || observation.ageMs !== null
        && observation.ageMs > PAPER_SAMPLE_MAX_AGE_MS)
      return "실행 이전 값이나 다른 출처 자료가 섞였습니다.";
    if (observation.source === "hardware" && (observation.kind !== "controller-getpose" || observation.seq === null
      || observation.seq <= (run.startSequence ?? -1) || ids.has(observation.seq)))
      return "실장비 진단에는 같은 실행 이후의 서로 다른 GetPose 일련번호가 필요합니다.";
    if (observation.source === "mock" && (observation.kind !== "mock-bridge" || observation.seq === null))
      return "모의 자료는 모의 브리지 관측으로만 표시해야 합니다.";
    if (observation.source === "dt" && observation.kind !== "dt")
      return "DT 결과는 DT 자료로만 표시해야 합니다.";
    if (observation.point !== targets[i].name) return "목표 순서가 현재 실행 계획과 다릅니다.";
    ids.add(observation.seq ?? -1);
  }
  return null;
}

export function diagnosePaperRun(run: PaperRunSnapshot, frame: PaperFrame, currentPlanHash: string): PaperDiagnosis {
  const invalid = validatePaperRunForDiagnosis(run, frame, currentPlanHash);
  const source = run.source;
  if (invalid) return {
    method: "rule-based", source, status: "incomplete", candidate: invalid,
    evidence: [], predictionEvidence: [], firstMismatch: null,
    question: "어떤 새 관측이 있어야 이 결과를 비교할 수 있을까요?",
    why: "현재 계획과 같은 실행에서 받은 유효한 관측이 완성되지 않았기 때문입니다.",
    tutorSource: "default question",
  };
  const evidence = run.observations.map(observation => {
    const dx = observation.pose.x - observation.command.x;
    const dy = observation.pose.y - observation.command.y;
    return { point: observation.point, dx, dy, distance: Math.hypot(dx, dy) };
  });
  const first = evidence.find(item => item.distance > PAPER_MEASURE_TOLERANCE_MM);
  const residualSpread = evidence.length > 1
    ? Math.max(...evidence.map(item => item.distance)) - Math.min(...evidence.map(item => item.distance)) : 0;
  const candidate = first
    ? "명령 좌표와 제어기 보고 위치 사이에 차이가 있습니다. 실행·좌표계·측정 조건의 차이일 수 있으며 학생의 개념 오류로 단정하지 않습니다."
    : "제어기 보고 위치가 명령 좌표와 2 mm 예비 허용 범위 안에서 일치합니다. 이는 펜 접촉이나 잉크 위치의 확인이 아닙니다.";
  return {
    method: "rule-based", source, status: "complete", candidate, evidence,
    predictionEvidence: [],
    firstMismatch: first?.point ?? null,
    question: first
      ? "제어기 보고 위치와 명령 좌표의 차이를 보면, 먼저 어떤 조건을 확인하고 싶나요?"
      : "이번 일치만으로 실제 잉크 위치까지 확인됐다고 말할 수 있을까요?",
    why: first
      ? `규칙 판정은 명령 대비 보고 좌표의 차이가 ${first.distance.toFixed(1)} mm이며, 점들 사이의 차이 범위가 ${residualSpread.toFixed(1)} mm임을 확인했습니다. 원인은 후보로만 둡니다.`
      : "GetPose는 제어기가 보고한 TCP 좌표이며 펜 끝 접촉이나 종이에 남은 잉크를 측정하지 않습니다.",
    tutorSource: "default question",
  };
}

export function getPaperFrameAngleDegrees(frame: PaperFrame): number {
  const O = frame.samples.find(sample => sample.point === "O")!.pose;
  const X = frame.samples.find(sample => sample.point === "X")!.pose;
  return Math.atan2(X.y - O.y, X.x - O.x) * 180 / Math.PI;
}

export function frameInversePoint(frame: PaperFrame, pose: LessonPose): { xCm: number; yCm: number } | null {
  const O = frame.samples.find(sample => sample.point === "O")!.pose;
  const X = frame.samples.find(sample => sample.point === "X")!.pose;
  const Y = frame.samples.find(sample => sample.point === "Y")!.pose;
  const ax = (X.x - O.x) / PAPER_GRID_SIZE_CM, ay = (X.y - O.y) / PAPER_GRID_SIZE_CM;
  const bx = (Y.x - O.x) / PAPER_GRID_SIZE_CM, by = (Y.y - O.y) / PAPER_GRID_SIZE_CM;
  const determinant = ax * by - ay * bx;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-6) return null;
  const dx = pose.x - O.x, dy = pose.y - O.y;
  return { xCm: (dx * by - dy * bx) / determinant, yCm: (ax * dy - ay * dx) / determinant };
}

export function comparePaperPredictionToFrame(frame: PaperFrame, predictions: PaperPredictionPoint[]) {
  return predictions.map(prediction => {
    const predictedX = Number(prediction.robotX), predictedY = Number(prediction.robotY);
    const basis = frameTransformPoint(frame, prediction);
    const dx = predictedX - basis.x, dy = predictedY - basis.y;
    return { point: prediction.name, dx, dy, distance: Math.hypot(dx, dy) };
  });
}
