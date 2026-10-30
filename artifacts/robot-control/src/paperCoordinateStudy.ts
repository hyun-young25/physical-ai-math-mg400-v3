import { PAPER_AXIS_SWAP_CANDIDATE } from "./paperDiagnosisLabel";
import { omitsOrigin } from "./originMissing";
import type { LessonPose } from "./curriculum";

export type PaperRectangleLevel = "advanced-paper-quarter" | "advanced-paper-rotated" | "advanced-paper-dt" | "advanced-paper-hardware";
export type PaperCoordinateLevel = "basic" | "quarter-turn" | "rotated" | PaperRectangleLevel;
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
  kind: "controller-tcp" | "mock-bridge" | "dt";
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
  pattern?: "match" | "tracking" | "origin-missing" | "translation" | "rotation" | "scale" | "mixed" | "calculation";
  taskEvidence?: Array<{ point: string; dx: number; dy: number; distance: number; xCm: number; yCm: number }>;
  toleranceMm?: number;
  supportLevel?: number;
};

export type PaperAiAnalysisRecord = {
  id: string;
  mode: "trial" | "gpt";
  provider: "rules" | "openai";
  status: string;
  failureReason?: string;
  question: string;
  text: string;
  requestedAt: string;
  displayedAt: string;
  recordId: string;
  runId: string;
  planHash: string;
  source: PaperEvidenceSource;
};

export type PaperTrialRecord = {
  id: string;
  task: "paper-coordinate";
  version: 1;
  uiVersion?: string;
  taskVersion?: string;
  support?: "guided" | "challenge";
  pathConcept?: {motion:string;closeX:string;closeY:string};
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
  aiAnalyses?: PaperAiAnalysisRecord[];
  studentHypothesis?: string;
  revisionReason?: string;
  revalidationTarget?: PaperTargetSet | null;
  invalidatedRunIds?: string[];
  liftHeight?: { z: number; source: PaperReferenceSource; seq: number | null; capturedAt: number; ageMsAtCapture: number | null; user: number; tool: number; coordinateSystem: string };
  predictionModelComparison?: Array<{ point: string; dx: number; dy: number; distance: number }>;
  revalidation?: { parentAttemptId: string; runId: string; source: PaperEvidenceSource; checkedAt: number; scope: string };
  diagnosisToleranceMm?: number;
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
  if (samples.some(sample => !finite(sample.capturedAt) || sample.capturedAt > now || now - sample.capturedAt > PAPER_FRAME_SPAN_MAX_MS))
    return { ok: false, reason: "기준점이 오래됐습니다. O/X/Y를 다시 기록하세요." };
  if (samples.some(sample => sample.source !== "teacher"
    && (sample.seq === null || !Number.isSafeInteger(sample.seq) || sample.ageMsAtCapture === null
      || !finite(sample.ageMsAtCapture) || sample.ageMsAtCapture < 0 || sample.ageMsAtCapture > PAPER_SAMPLE_MAX_AGE_MS || !sample.verifiedCoordinates)))
    return { ok: false, reason: "실장비·모의 기준점에는 최신 회신과 확인된 좌표계 설정이 필요합니다." };
  if (new Set(samples.map(sample => `${sample.coordinateSystem}|${sample.user}|${sample.tool}`)).size !== 1)
    return { ok: false, reason: "좌표계 또는 User/Tool 설정이 서로 다릅니다. 설정을 맞추고 다시 기록하세요." };
  if (samples.some(sample => !Number.isSafeInteger(sample.user) || !Number.isSafeInteger(sample.tool) || sample.user < 0 || sample.tool < 0 || !sample.coordinateSystem.trim()))
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
  if (ax * by - ay * bx <= 0) return { ok: false, reason: "종이 X/Y 기준점 순서가 뒤바뀌었습니다. 인쇄된 축을 확인하세요." };
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
  if (![transform.originX, transform.originY, transform.millimetersPerCentimeter, transform.rotationDegrees].every(v => v.trim())) return null;
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

export function validatePaperRunForDiagnosis(run: PaperRunSnapshot, frame: PaperFrame, currentPlanHash: string, targets = PAPER_TARGETS[run.targetSet]): string | null {
  if (run.status !== "completed" || !finite(run.endedAt) || !finite(run.startedAt) || run.endedAt! < run.startedAt)
    return "실행이 부분 완료 또는 중단되어 전체 비교를 완료할 수 없습니다.";
  if (run.frameId !== frame.id || run.planHash !== currentPlanHash)
    return "기준점 또는 예측이 바뀌었습니다. 이전 실행·측정은 재사용하지 않습니다.";
  if (run.source !== "dt" && (run.source !== frame.source || !["hardware", "mock"].includes(run.source)))
    return "기준점과 실행 관측은 같은 출처여야 합니다.";
  if (!targets || run.observations.length !== targets.length || run.commands.length !== targets.length)
    return "모든 목표점에 새 회신이 있어야 비교할 수 있습니다.";
  let previousSeq = run.startSequence ?? -1;
  for (let i = 0; i < run.observations.length; i++) {
    const o = run.observations[i], c = run.commands[i];
    if (![o.pose, o.command, c.pose].every(p => [p.x,p.y,p.z,p.r].every(finite))
      || !finite(o.measuredAt) || o.measuredAt < run.startedAt || o.measuredAt > run.endedAt!
      || o.source !== run.source || o.point !== targets[i].name || c.point !== o.point
      || ["x","y","z","r"].some(k => o.command[k as keyof LessonPose] !== c.pose[k as keyof LessonPose]))
      return "좌표·출처·시각·목표 순서가 현재 실행과 맞지 않습니다.";
    if (run.source !== "dt") {
      if (!Number.isSafeInteger(o.seq) || o.seq! <= previousSeq || !finite(o.ageMs)
        || o.ageMs! < 0 || o.ageMs! > PAPER_SAMPLE_MAX_AGE_MS
        || o.kind !== (run.source === "hardware" ? "controller-tcp" : "mock-bridge"))
        return "같은 실행 이후의 새 회신 일련번호와 유효한 수신 시각이 필요합니다.";
      previousSeq = o.seq!;
    } else if (o.kind !== "dt") return "DT 결과는 DT 자료로만 표시해야 합니다.";
  }
  return null;
}

/** Geometry is deterministic; these patterns are hypotheses, not cognitive diagnoses. */
export function diagnosePaperRun(run: PaperRunSnapshot, frame: PaperFrame, currentPlanHash: string,
  options: { toleranceMm?: number; transform?: PaperStudentTransform; repeated?: number; targets?: PaperGridPoint[]; detectOriginMissing?: boolean; support?: "guided"|"challenge" } = {}): PaperDiagnosis {
  const targets = options.targets ?? PAPER_TARGETS[run.targetSet];
  const invalid = validatePaperRunForDiagnosis(run, frame, currentPlanHash, targets);
  const source = run.source, tolerance = options.toleranceMm ?? PAPER_MEASURE_TOLERANCE_MM;
  if (invalid || !finite(tolerance) || tolerance <= 0) return {
    method: "rule-based", source, status: "incomplete", candidate: invalid ?? "허용오차가 유효하지 않습니다.",
    evidence: [], predictionEvidence: [], taskEvidence: [], firstMismatch: null,
    question: "어떤 새 관측이 있어야 이 결과를 비교할 수 있을까요?",
    why: "현재 계획과 같은 실행에서 받은 유효한 관측이 완성되지 않았기 때문입니다.", tutorSource: "default question",
  };
  const evidence = run.observations.map(o => ({point:o.point, dx:o.pose.x-o.command.x, dy:o.pose.y-o.command.y,
    distance:Math.hypot(o.pose.x-o.command.x,o.pose.y-o.command.y,o.pose.z-o.command.z)}));
  const taskEvidence = run.observations.map((o,i) => {
    const target = frameTransformPoint(frame, targets[i]), paper = frameInversePoint(frame,o.pose)!;
    const dx=o.pose.x-target.x,dy=o.pose.y-target.y;
    return {point:o.point,dx,dy,distance:Math.hypot(dx,dy),...paper};
  });
  const predictionEvidence = run.commands.map((c,i) => {
    const model = options.transform && studentTransformPoint(options.transform,targets[i]);
    const target = model ?? frameTransformPoint(frame,targets[i]);
    const dx=c.pose.x-target.x,dy=c.pose.y-target.y;
    return {point:c.point,dx,dy,distance:Math.hypot(dx,dy)};
  });
  const tracking = evidence.find(e => e.distance > tolerance);
  const mismatch = taskEvidence.find(e => e.distance > tolerance);
  let pattern: NonNullable<PaperDiagnosis["pattern"]> = tracking ? "tracking" : mismatch ? "mixed" : "match";
  let question = "새 종이 배치에서도 이 관계를 쓰려면 어떤 기준점을 먼저 확인해야 할까요?";
  let candidate = "모든 보고 위치가 종이 목표점과 예비 허용오차 안에서 일치합니다. 잉크 위치는 별도 확인입니다.";
  let numeric = `목표 대비 최대 차이 ${Math.max(...taskEvidence.map(e=>e.distance)).toFixed(2)} mm, 명령 대비 최대 차이 ${Math.max(...evidence.map(e=>e.distance)).toFixed(2)} mm`;
  if (tracking) {
    candidate = "명령과 보고 위치가 다릅니다. 먼저 실행·측정 조건을 확인합니다.";
    question = "학생의 식을 바꾸기 전에 명령 위치에 도착했는지, 좌표계와 펜 설정은 같은지 확인할까요?";
  } else if (mismatch && options.detectOriginMissing && omitsOrigin(run.commands.map(c=>c.pose), targets.map(t=>frameTransformPoint(frame,t)), frame.samples.find(s=>s.point==="O")!.pose)) {
    pattern="origin-missing"; candidate="제출한 네 예측에서 종이 기준점 O를 더하지 않은 패턴이 확인됐습니다. 생각의 원인은 학생 설명으로 확인합니다.";
    question="종이 좌표를 로봇 좌표로 옮길 때 기준점 O는 식의 어디에 들어가나요?";
  } else if (mismatch) {
    const mean = {x:taskEvidence.reduce((a,e)=>a+e.dx,0)/targets.length,y:taskEvidence.reduce((a,e)=>a+e.dy,0)/targets.length};
    const spread = Math.max(...taskEvidence.map(e=>Math.hypot(e.dx-mean.x,e.dy-mean.y)));
    const [a,b,c]=run.observations.map(o=>frameInversePoint(frame,o.pose)!);
    // The first three targets form a non-collinear triangle with a horizontal first edge.
    // The same classifier also accepts the rectangle's fourth point as evidence.
    const [ta,tb,tc]=targets;
    const ux=(b.xCm-a.xCm)/(tb.xCm-ta.xCm),uy=(b.yCm-a.yCm)/(tb.xCm-ta.xCm);
    const vx=(c.xCm-a.xCm-ux*(tc.xCm-ta.xCm))/(tc.yCm-ta.yCm);
    const vy=(c.yCm-a.yCm-uy*(tc.xCm-ta.xCm))/(tc.yCm-ta.yCm);
    const sx=Math.hypot(ux,uy),sy=Math.hypot(vx,vy),angle=Math.atan2(uy,ux)*180/Math.PI;
    numeric += `; 종이 축 대비 회전 ${angle.toFixed(1)}°, x/y 배율 ${sx.toFixed(3)}/${sy.toFixed(3)}`;
    // Advanced paper lessons: compare deltas in the measured paper basis. A
    // tilted edge or a single 20 mm offset is not an exchange of X and Y.
    const local = run.observations.map(o => frameInversePoint(frame, o.pose)!);
    const swappedEdge = options.detectOriginMissing && targets.slice(1).some((target, i) => {
      const dx = (target.xCm - targets[i].xCm) * 10, dy = (target.yCm - targets[i].yCm) * 10;
      const actualX = (local[i + 1].xCm - local[i].xCm) * 10, actualY = (local[i + 1].yCm - local[i].yCm) * 10;
      return Math.hypot(dx - dy, dy - dx) > tolerance
        && Math.hypot(actualX - dy, actualY - dx) <= tolerance;
    });
    if (swappedEdge) {
      pattern = "calculation";
      candidate = PAPER_AXIS_SWAP_CANDIDATE + "종이 축 기준 이동량의 ΔX와 ΔY가 서로 바뀐 구간이 확인됐습니다. 대입·계산 차이의 한 패턴이며 생각의 원인은 학생 설명으로 확인합니다.";
      question = "이 구간에서 종이 x와 y 중 어느 좌표가 변하나요? 내 식에 대입한 ΔX와 ΔY를 비교해 볼까요?";
    } else if (predictionEvidence.some(e=>e.distance>tolerance) && options.transform) {
      pattern="calculation"; candidate="저장한 변환식과 직접 계산한 명령 좌표도 다릅니다. 대입·계산 과정을 확인할 후보입니다.";
      question="내 변환식에 종이 좌표를 대입한 값과 저장한 예측은 같나요? 단위와 부호를 한 항씩 확인해 볼까요?";
    } else if (spread <= tolerance) {
      pattern="translation"; candidate="관측점이 비슷한 방향·크기로 이동했습니다. 원점 또는 공통 위치 편차를 확인할 후보입니다.";
      question="관측점의 차이 화살표가 비슷합니다. 내 식의 원점과 기록한 종이 원점을 비교하면 무엇이 다른가요?";
    } else if (Math.abs(sx-1)<0.04 && Math.abs(sy-1)<0.04 && Math.abs(ux*vx+uy*vy)<0.04 && Math.abs(angle)>2) {
      pattern="rotation"; candidate="점 사이 길이는 비슷하지만 축 방향이 돌아가 있습니다. 회전각·축 방향을 확인할 후보입니다.";
      question="점 사이 길이가 유지되는데 방향은 달라졌어요. O→X 기준선 방향을 내 식의 회전각과 비교해 볼까요?";
    } else if (Math.abs(angle)<=2 && (Math.abs(sx-1)>=0.04 || Math.abs(sy-1)>=0.04)) {
      pattern="scale"; candidate="축 방향보다 거리 배율에서 차이가 나타납니다. cm/mm 환산·축별 비율을 확인할 후보입니다.";
      question="종이의 1 cm를 내 식에서 몇 mm로 바꾸었나요? O→X 10 cm 기준선과 비교해 볼까요?";
    } else {
      candidate="이동·회전·배율이 섞이거나 한 점만 다른 패턴입니다. 이 관측만으로 원인을 확정할 수 없습니다.";
      question="각 점의 원점·단위·축 부호 중 어떤 조건을 하나씩 바꿔 확인하면 원인을 구분할 수 있을까요?";
    }
  }
  const supportLevel = tracking ? 1 : Math.min(3,1+Math.max(0,(options.repeated??0)-(options.support==="challenge"?1:0)));
  if (!tracking && mismatch && supportLevel===2) question += " 기준점→축 방향→단위 순서로 식의 각 항과 연결해 보세요.";
  if (!tracking && mismatch && supportLevel===3) question += " 예: 1 cm=10 mm입니다. 한 점을 함께 검산하고, 계속 어렵다면 교사와 확인하세요.";
  return {method:"rule-based",source,status:"complete",candidate,evidence,predictionEvidence,taskEvidence,
    pattern,firstMismatch:tracking?.point??mismatch?.point??null,question,
    why:`${numeric}. 허용오차 ${tolerance} mm(예비값). 이 수치 패턴에 맞춰 질문을 선택했습니다. 관측만으로 학습자의 사고 원인을 확정하지 않습니다.`,
    tutorSource:"default question",toleranceMm:tolerance,supportLevel};
}

export function paperRevalidationScope(record: PaperTrialRecord, parent?: PaperTrialRecord, targets?: PaperGridPoint[]): string | null {
  if (!parent?.run || !parent.studentHypothesis?.trim() || !parent.revisionReason?.trim()
    || record.parentAttemptId!==parent.id || !record.run || !record.frame || !record.planHash
    || record.run.id===parent.run.id || record.run.source!==parent.run.source
    || record.run.startedAt <= (parent.run.endedAt??Infinity)
    || (record.targetSet===parent.targetSet && record.frame.id===parent.frame?.id)
    || validatePaperRunForDiagnosis(record.run,record.frame,record.planHash,targets)
    || record.diagnosis?.pattern!=="match") return null;
  return record.run.source==="hardware" ? "제어기 보고 위치 기반 재검증 · 잉크 별도 확인"
    : record.run.source==="mock" ? "모의 브리지 재검증 완료 · 실측 아님" : "DT 재검증 완료 · 실측 아님";
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
