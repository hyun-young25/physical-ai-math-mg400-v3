import { PAPER_AXIS_SWAP_CANDIDATE } from "./paperDiagnosisLabel";
import { omitsOrigin } from "./originMissing";
import type { LessonPose } from "./curriculum";

export type PaperRectangleLevel = "advanced-paper-quarter" | "advanced-paper-rotated" | "advanced-paper-dt" | "advanced-paper-hardware";
export type PaperCoordinateLevel = "basic" | "quarter-turn" | "rotated" | PaperRectangleLevel;
export type PaperTargetSet = "initial" | "revalidation";
export type PaperPointName = "O" | "X" | "Y";
export type PaperReferenceSource = "hardware" | "mock" | "teacher";
export type PaperEvidenceSource = PaperReferenceSource | "dt";
export type PaperInkEvidenceSource = "student-manual-ink" | "mock-simulation";
export const PAPER_TASK_VERSION = "v5-paper-10cm";
/** New research flow is versioned only for the MG400 slanted-paper level. */
export const PAPER_HARDWARE_V6_VERSION = "v6-paper-transform";

export type PaperV6StudentModel = {
  originXmm: number;
  originYmm: number;
  deltaXmm: number;
  deltaYmm: number;
  thetaDeg: number;
  thetaAssumption: "calculated" | "zero";
  savedAt: number;
};

export type PaperV6FormulaWork = {
  point: string;
  aCos: number;
  bSin: number;
  aSin: number;
  bCos: number;
  robotX: number;
  robotY: number;
};

export type PaperV6FollowupKind =
  | "remeasure-y"
  | "review-ox-direction"
  | "remeasure-ink"
  | "substitute-one-point"
  | "check-units";

export type PaperV6AttemptData = {
  model?: PaperV6StudentModel;
  initialModel?: PaperV6StudentModel;
  initialPrediction?: PaperPredictionPoint[];
  formulaWork?: PaperV6FormulaWork[];
  explanation?: string;
  supportMode: "guided" | "challenge";
  supportLevel?: 1 | 2 | 3;
  followupChecks?: PaperV6FollowupKind[];
  followupResult?: string;
  decision?: "revise" | "retain";
  decisionReason?: string;
  promptVersion?: string;
  aiProvider?: "rules" | "openai";
  aiModel?: string;
  verificationPoint?: { name: "V"; xCm: 5; yCm: 6 };
  finalQuestionAnswer?: "model-points" | "independent-point";
  assessment?: {
    runId: string;
    planHash: string;
    source: PaperEvidenceSource;
    status: "incomplete" | "simulation-only" | "within-tolerance" | "outside-tolerance";
    tcpErrorMm: number | null;
    inkErrorMm: number | null;
    judgedAt: number;
    toleranceMm: 2;
  };
};

export type PaperV6Draft = {
  supportMode?: "guided" | "challenge";
  originXmm?: string;
  originYmm?: string;
  deltaXmm?: string;
  deltaYmm?: string;
  thetaDeg?: string;
  thetaAssumption?: "calculated" | "zero";
  explanation?: string;
  formulaWork?: Record<
    string,
    Partial<Record<keyof Omit<PaperV6FormulaWork, "point">, string>>
  >;
  followupChecks?: PaperV6FollowupKind[];
  followupResult?: string;
  decision?: "revise" | "retain";
  decisionReason?: string;
  revisionReason?: string;
  finalQuestionAnswer?: "model-points" | "independent-point";
};

export type PaperGridPoint = { name: string; xCm: number; yCm: number };
export type PaperReferenceSample = {
  point: PaperPointName;
  pose: LessonPose;
  source: PaperReferenceSource;
  /** Opaque live-session identity; absent on legacy or teacher-entered samples. */
  connectionToken?: string;
  seq: number | null;
  capturedAt: number;
  ageMsAtCapture: number | null;
  user: number;
  tool: number;
  coordinateSystem: string;
  verifiedCoordinates: boolean;
};

export type PaperBaselineLengthTolerance = {
  toleranceMm: number;
  appliedAt: number;
  scope: "xy-baseline-length-only";
};

export type PaperBaselineLengthMetric = {
  baseline: "O–X" | "O–Y";
  measuredMm: number | null;
  targetMm: 100;
  signedDifferenceMm: number | null;
  absoluteErrorMm: number | null;
  toleranceMm: number;
  status: "incomplete" | "informational";
  missingPoint: PaperPointName | null;
  zDifferenceMm: number | null;
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

export type PaperTrialDrafts = {
  transform?: PaperStudentTransform;
  predictions?: PaperPredictionPoint[];
  paperCoordinates?: Array<{ point: string; xCm: string; yCm: string }>;
  studentHypothesis?: string;
  followupObservation?: string;
  modelDecision?: "revise" | "retain";
  modelDecisionReason?: string;
  revisionReason?: string;
  inkReadings?: PaperInkReadingDraft[];
  verificationReason?: string;
  liftGapMm?: string;
  /** Student-only v6 draft. Draft values never count as saved evidence. */
  v6?: PaperV6Draft;
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

export type PaperVerificationCriteria = {
  recordId: string;
  frameId: string;
  planHash: string;
  targetSet: PaperTargetSet;
  modelConstructionPoints: string[];
  currentVerificationPoints: string[];
  independentVerificationPoints: string[];
  constructionOverlaps: { targetPoint: string; constructionPoint: PaperPointName }[];
  positionToleranceMm: number;
  rotationToleranceDeg: number;
  rationale: string;
  confirmedAt: number;
  inheritedFromAttemptId?: string;
};

export type PaperInkReading = {
  recordId: string;
  runId: string;
  frameId: string;
  point: string;
  unit: "cm";
  source: PaperInkEvidenceSource;
  status: "measured" | "unreadable" | "outside-range" | "not-measured";
  xCm: number | null;
  yCm: number | null;
  rawX: string;
  rawY: string;
  reason: string;
  recordedAt: number;
};

export type PaperInkReadingDraft = Pick<PaperInkReading, "point" | "status" | "reason"> & {
  xCm: string;
  yCm: string;
  /** Synthetic ink values are accepted only for an explicitly marked mock run. */
  source?: PaperInkEvidenceSource;
};

const PAPER_V6_MOCK_THETA_RAD = (28.6 * Math.PI) / 180;

/** In-app practice data only; this is never sent to the hardware bridge. */
export const PAPER_V6_MOCK_ORIGIN = { x: 250, y: -60 } as const;

export function paperV6MockReferencePose(point: PaperPointName): LessonPose {
  // In front of the MG400, just under its ready pen position (350, 0) — where a sheet is taped in class.
  const origin = PAPER_V6_MOCK_ORIGIN;
  const length = 100;
  if (point === "O")
    return { x: origin.x, y: origin.y, z: 0, r: 0 };
  if (point === "X")
    return {
      x: origin.x + length * Math.cos(PAPER_V6_MOCK_THETA_RAD),
      y: origin.y + length * Math.sin(PAPER_V6_MOCK_THETA_RAD),
      z: 0,
      r: 0,
    };
  return {
    x: origin.x - length * Math.sin(PAPER_V6_MOCK_THETA_RAD),
    y: origin.y + length * Math.cos(PAPER_V6_MOCK_THETA_RAD),
    z: 0,
    r: 0,
  };
}

/** Simulation capture: pen tip must be this close (xy) to the sheet corner it is recorded as. */
export const PAPER_V6_MOCK_CAPTURE_TOLERANCE_MM = 2;
/** Simulation capture: pen counts as touching the sheet at or below this height. */
export const PAPER_V6_MOCK_TOUCH_MAX_Z_MM = 1;
/** Simulation floor: the sheet surface (z = 0); lower would push into the table. */
export const PAPER_V6_MOCK_MIN_Z_MM = 0;

/** Pen touches down only on the sheet (plus this margin); elsewhere it passes lifted. */
export const PAPER_V6_PEN_DOWN_MARGIN_MM = 5;
/** Mock ink imitates a real ruler reading: about ±0.5 mm, deterministic per point. */
export const PAPER_V6_MOCK_INK_NOISE_MM = 0.5;

export function paperPenDownAllowed(
  frame: PaperFrame,
  pose: Pick<LessonPose, "x" | "y">,
  sheetSizeCm = PAPER_GRID_SIZE_CM,
  marginMm = PAPER_V6_PEN_DOWN_MARGIN_MM,
) {
  const paper = frameInversePoint(frame, { x: pose.x, y: pose.y, z: 0, r: 0 });
  if (!paper || !Number.isFinite(paper.xCm) || !Number.isFinite(paper.yCm))
    return false;
  const margin = marginMm / 10;
  return (
    paper.xCm >= -margin &&
    paper.yCm >= -margin &&
    paper.xCm <= sheetSizeCm + margin &&
    paper.yCm <= sheetSizeCm + margin
  );
}

const mockNoiseCm = (point: string, axis: "x" | "y") => {
  let hash = axis === "x" ? 17 : 31;
  for (const char of point) hash = (hash * 33 + char.charCodeAt(0)) % 1009;
  return ((hash / 1009) * 2 - 1) * (PAPER_V6_MOCK_INK_NOISE_MM / 10);
};

/** Convert the in-app mock TCP path to explicitly synthetic paper-ink drafts. */
export function paperV6MockInkDrafts(
  frame: PaperFrame,
  points: Array<{ point: string; pose: LessonPose }>,
): PaperInkReadingDraft[] | null {
  const drafts = points.map(({ point, pose }) => {
    const paper = frameInversePoint(frame, pose);
    if (!paper || !Number.isFinite(paper.xCm) || !Number.isFinite(paper.yCm))
      return null;
    if (!paperPenDownAllowed(frame, pose))
      return {
        point,
        status: "outside-range" as const,
        xCm: "",
        yCm: "",
        reason: "내 식의 점이 종이 밖이라 펜을 들고 지나가 잉크가 남지 않았습니다.",
        source: "mock-simulation" as const,
      };
    const clamp = (value: number) =>
      Math.min(PAPER_GRID_SIZE_CM, Math.max(0, value));
    return {
      point,
      status: "measured" as const,
      xCm: clamp(paper.xCm + mockNoiseCm(point, "x")).toFixed(2),
      yCm: clamp(paper.yCm + mockNoiseCm(point, "y")).toFixed(2),
      reason: "",
      source: "mock-simulation" as const,
    };
  });
  return drafts.some((draft) => draft === null)
    ? null
    : (drafts as PaperInkReadingDraft[]);
}

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
  /** Immutable criteria confirmed by the learner before this run starts. */
  verificationCriteria?: PaperVerificationCriteria;
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
  estimatedRotationDifferenceDeg?: number | null;
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
  model?: string;
  promptVersion?: string;
  fallbackUsed?: boolean;
  fallbackReason?: string;
  /** Sanitized exact payload snapshot passed to the analysis controller. */
  evidenceSnapshot?: unknown;
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
  /** Applies only to the XY length check for O–X and O–Y. */
  baselineLengthTolerance?: PaperBaselineLengthTolerance;
  transform?: PaperStudentTransform;
  predictions?: PaperPredictionPoint[];
  planHash?: string;
  run?: PaperRunSnapshot;
  runHistory?: PaperRunSnapshot[];
  dtRunPlanHash?: string;
  inkReadings?: PaperInkReading[];
  diagnosis?: PaperDiagnosis;
  aiAnalyses?: PaperAiAnalysisRecord[];
  studentHypothesis?: string;
  followupObservation?: { recordId: string; runId: string; source: "student-report"; text: string; recordedAt: number };
  modelDecision?: "revise" | "retain";
  modelDecisionReason?: string;
  revisionReason?: string;
  revalidationTarget?: PaperTargetSet | null;
  invalidatedRunIds?: string[];
  liftHeight?: { z: number; source: PaperReferenceSource; connectionToken?: string; seq: number | null; capturedAt: number; ageMsAtCapture: number | null; user: number; tool: number; coordinateSystem: string };
  /** New paper lessons store a relative clearance, never an absolute TCP Z. */
  penLiftGapMm?: number;
  predictionModelComparison?: Array<{ point: string; dx: number; dy: number; distance: number }>;
  revalidation?: { parentAttemptId: string; runId: string; source: PaperEvidenceSource; checkedAt: number; scope: string;
    result: "physical-verified" | "simulation-only" | "incomplete"; tcpWithinTolerance?: boolean; inkWithinTolerance?: boolean };
  verificationCriteria?: PaperVerificationCriteria;
  diagnosisToleranceMm?: number;
  /** Present only on the v6 MG400 paper-transform attempt chain. */
  v6?: PaperV6AttemptData;
  /** Unsubmitted form contents are recoverable, but never count as completed evidence. */
  drafts?: PaperTrialDrafts;
};

export function isInProgressPaperHardwareV6Attempt(
  record: PaperTrialRecord,
): boolean {
  if (
    record.task !== "paper-coordinate" ||
    record.level !== "advanced-paper-hardware" ||
    record.taskVersion !== PAPER_HARDWARE_V6_VERSION ||
    record.status === "revalidated" ||
    record.status === "running" ||
    record.run?.status === "running"
  ) {
    return false;
  }
  const assessment = record.v6?.assessment?.status;
  if (assessment && assessment !== "incomplete") return false;
  if (
    record.run &&
    ["partial", "failed", "cancelled"].includes(record.run.status)
  ) {
    return false;
  }
  return true;
}

export function isPaperHardwareAttemptReadOnly(
  record: Pick<PaperTrialRecord, "level" | "taskVersion"> | null | undefined,
): boolean {
  return !!record &&
    record.level === "advanced-paper-hardware" &&
    record.taskVersion !== PAPER_HARDWARE_V6_VERSION;
}

/**
 * Retired paper attempts stay in storage for preservation, but are not part of
 * the current student history or task logic.
 */
export function isArchivedPaperAttempt(
  record: Pick<PaperTrialRecord, "task" | "level" | "taskVersion">,
): boolean {
  return (
    record.task === "paper-coordinate" &&
    record.taskVersion === "v4-paper-merged" &&
    (record.level === "advanced-paper-hardware" ||
      record.level === "advanced-paper-dt")
  );
}

export function visiblePaperAttempts(
  records: PaperTrialRecord[],
): PaperTrialRecord[] {
  return records.filter((record) => !isArchivedPaperAttempt(record));
}

/** Keep retired records byte-for-byte while persisting the current visible set. */
export function paperAttemptsForStorage(
  visibleRecords: PaperTrialRecord[],
  storedRecords: PaperTrialRecord[],
): PaperTrialRecord[] {
  const visibleById = new Map(
    visiblePaperAttempts(visibleRecords).map((record) => [record.id, record]),
  );
  const merged: PaperTrialRecord[] = [];
  for (const stored of storedRecords) {
    if (isArchivedPaperAttempt(stored)) {
      merged.push(stored);
      continue;
    }
    const current = visibleById.get(stored.id);
    if (current) {
      merged.push(current);
      visibleById.delete(stored.id);
    }
  }
  return [...merged, ...visibleById.values()];
}

/**
 * Opening the hardware paper lesson resumes only a nonterminal v6 attempt.
 * Older content versions remain in history; they are never promoted in place.
 */
export function initialPaperAttemptForLevel(
  records: PaperTrialRecord[],
  initialLevel?: PaperCoordinateLevel,
): PaperTrialRecord | undefined {
  if (initialLevel === "advanced-paper-hardware") {
    return [...records]
      .reverse()
      .find(isInProgressPaperHardwareV6Attempt);
  }
  if (!initialLevel) return records.at(-1);
  return records.filter((record) => record.level === initialLevel).at(-1);
}

export function paperLegacyRecordNotice(
  level: PaperCoordinateLevel,
  taskVersion?: string,
): string | null {
  if (
    level !== "advanced-paper-hardware" ||
    taskVersion === PAPER_HARDWARE_V6_VERSION
  ) {
    return null;
  }
  if (taskVersion === PAPER_TASK_VERSION) {
    return "이전 버전 v5(10×10 cm · O/X/Y 자동 변환 방식) 기록입니다. 원본은 보존되며 입력·저장·실행은 읽기 전용입니다.";
  }
  if (!taskVersion) {
    return "이전 버전 기록입니다. 원본은 읽기 전용으로 보존됩니다. 버전 정보가 없어 현재 과제와 같은 방식으로 해석하지 않습니다.";
  }
  return "이전 버전 기록입니다. 원본은 읽기 전용으로 보존됩니다. 현재 과제와 다른 방식으로 해석하지 않습니다.";
}

/**
 * Parse the text form of an absolute TCP Z value without rejecting transient
 * editing states such as "", "-", "." or "-.".
 */
export function parsePaperLiftHeightDraft(value: string): number | null {
  const trimmed = value.trim();
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function paperLiftHeightDraftState(
  input: string,
  saved: PaperTrialRecord["liftHeight"] | undefined,
) {
  const parsed = parsePaperLiftHeightDraft(input);
  const isSaved = parsed !== null && saved?.z === parsed;
  return {
    input,
    value: isSaved ? parsed : null,
    saved: isSaved,
    source: isSaved ? saved?.source ?? null : null,
    sequence: isSaved ? saved?.seq ?? null : null,
  };
}

/** Parse a relative pen clearance; transient editing strings remain invalid. */
export function parsePaperLiftGapDraft(value: string): number | null {
  const parsed = parsePaperLiftHeightDraft(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

export function paperLiftGapDraftState(input: string, saved: number | undefined) {
  const parsed = parsePaperLiftGapDraft(input);
  const isSaved = parsed !== null && saved === parsed;
  return {
    input,
    value: isSaved ? parsed : null,
    saved: isSaved,
  };
}

export type PaperPathMove = {
  kind: "move";
  motion: "MoveL";
  target: LessonPose;
};

/**
 * Build the exact ordered moves consumed by the paper lesson's runOps call.
 * Contact Z comes from the O/X/Y-mapped paper plane; clearance is relative to
 * its highest recorded point, and a higher measured start pose is preserved.
 */
export function buildPaperPathOperations(
  startPose: LessonPose,
  originPose: LessonPose,
  points: Array<{ point: string; pose: LessonPose }>,
  paperSurfaceZ: number,
  liftGapMm: number,
) {
  if (
    ![...Object.values(startPose), ...Object.values(originPose), paperSurfaceZ, liftGapMm]
      .every(Number.isFinite) ||
    liftGapMm <= 0 ||
    points.length === 0 ||
    points.some((point) => !Object.values(point.pose).every(Number.isFinite))
  ) {
    throw new Error("종이 기준과 펜 들기 간격으로 유효한 경로를 만들 수 없습니다.");
  }
  const safeZ = Math.max(startPose.z, paperSurfaceZ + liftGapMm);
  const operations: PaperPathMove[] = [
    {
      kind: "move",
      motion: "MoveL",
      target: { x: startPose.x, y: startPose.y, z: safeZ, r: originPose.r },
    },
  ];
  const capturePointByOperationIndex: Record<number, string> = {};
  for (const { point, pose } of points) {
    const raised = { x: pose.x, y: pose.y, z: safeZ, r: originPose.r };
    operations.push({ kind: "move", motion: "MoveL", target: raised });
    operations.push({
      kind: "move",
      motion: "MoveL",
      target: { ...pose, r: originPose.r },
    });
    capturePointByOperationIndex[operations.length - 1] = point;
    operations.push({ kind: "move", motion: "MoveL", target: raised });
  }
  operations.push({
    kind: "move",
    motion: "MoveL",
    target: { x: originPose.x, y: originPose.y, z: safeZ, r: originPose.r },
  });
  return { safeZ, operations, capturePointByOperationIndex };
}

/**
 * A completed/failed run is immutable evidence. When the lift setting changes,
 * move that snapshot to history and require a new plan/criteria/DT run.
 */
export function archiveCompletedPaperRunForLiftEdit(
  record: PaperTrialRecord,
): PaperTrialRecord {
  const previousRun = record.run;
  if (!previousRun || previousRun.status === "running") return record;
  return {
    ...record,
    runHistory: [...(record.runHistory ?? []), previousRun],
    run: undefined,
    status: record.frame ? "model" : "references",
    diagnosis: undefined,
    verificationCriteria: undefined,
    dtRunPlanHash: undefined,
  };
}

export function recoverInterruptedPaperRuns(records: PaperTrialRecord[], now = Date.now()): PaperTrialRecord[] {
  return records.map(record => {
    if (record.run?.status !== "running") return record;
    return {
      ...record,
      run: { ...record.run, status: "partial" as const, endedAt: now,
        error: "새로고침으로 실행이 끝났습니다. 완료로 처리하지 않습니다." },
      status: "incomplete" as const,
      updatedAt: new Date(now).toISOString(),
    };
  });
}

export const PAPER_GRID_SIZE_CM = 10;
export const PAPER_MEASURE_TOLERANCE_MM = 2;
export const PAPER_BASELINE_LENGTH_TOLERANCE_DEFAULT_MM = 2;
export const PAPER_BASELINE_LENGTH_TOLERANCE_MAX_MM = 100;
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

export function classifyPaperVerificationPoints(targets:PaperGridPoint[]) {
  const construction: {name:PaperPointName;xCm:number;yCm:number}[]=[
    {name:"O",xCm:0,yCm:0},
    {name:"X",xCm:PAPER_GRID_SIZE_CM,yCm:0},
    {name:"Y",xCm:0,yCm:PAPER_GRID_SIZE_CM},
  ];
  const constructionOverlaps=targets.flatMap(target=>{
    const match=construction.find(point=>Math.hypot(target.xCm-point.xCm,target.yCm-point.yCm)<=1e-6);
    return match?[{targetPoint:target.name,constructionPoint:match.name}]:[];
  });
  const overlapped=new Set(constructionOverlaps.map(row=>row.targetPoint));
  return {
    currentVerificationPoints:targets.map(point=>point.name),
    independentVerificationPoints:targets.filter(point=>!overlapped.has(point.name)).map(point=>point.name),
    constructionOverlaps,
  };
}

export function paperVerificationPointGuide(targets:PaperGridPoint[]) {
  const classification=classifyPaperVerificationPoints(targets);
  return {
    current:classification.currentVerificationPoints.join("·")||"없음",
    independent:classification.independentVerificationPoints.join("·")||"없음",
    excluded:classification.constructionOverlaps
      .map(item=>`${item.targetPoint}=${item.constructionPoint}`).join("·")||"없음",
  };
}

export function paperVerificationPointsMatch(criteria:PaperVerificationCriteria,targets:PaperGridPoint[]) {
  const expected=classifyPaperVerificationPoints(targets);
  return JSON.stringify(criteria.currentVerificationPoints)===JSON.stringify(expected.currentVerificationPoints)
    &&JSON.stringify(criteria.independentVerificationPoints)===JSON.stringify(expected.independentVerificationPoints)
    &&JSON.stringify(criteria.constructionOverlaps)===JSON.stringify(expected.constructionOverlaps);
}

export function paperVerificationPointsAreValid(criteria:PaperVerificationCriteria,targets:PaperGridPoint[],allowLegacy=false) {
  if(paperVerificationPointsMatch(criteria,targets))return true;
  // Old saved trials listed every point as independent. Accept their immutable
  // run for viewing, but always derive the effective classification from its
  // actual coordinates; new runs must save the corrected fields.
  return allowLegacy
    && criteria.currentVerificationPoints===undefined
    && criteria.constructionOverlaps===undefined
    && JSON.stringify(criteria.independentVerificationPoints)===JSON.stringify(targets.map(point=>point.name));
}

export function canonicalPaperVerificationCriteria(criteria:PaperVerificationCriteria,targets:PaperGridPoint[]):PaperVerificationCriteria {
  return {...criteria,modelConstructionPoints:["O","X","Y"],...classifyPaperVerificationPoints(targets)};
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const pointDistance = (a: LessonPose, b: LessonPose) => Math.hypot(a.x - b.x, a.y - b.y);
const normalizeAngle = (value: number) => ((value % 360) + 360) % 360;
const angleDifference = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

export function paperBaselineLengthMetrics(
  samples: readonly PaperReferenceSample[],
  toleranceMm = PAPER_BASELINE_LENGTH_TOLERANCE_DEFAULT_MM,
): PaperBaselineLengthMetric[] {
  const byPoint = new Map(samples.map((sample) => [sample.point, sample]));
  return (["O–X", "O–Y"] as const).map((baseline) => {
    const start = byPoint.get("O");
    const end = byPoint.get(baseline === "O–X" ? "X" : "Y");
    const missingPoint = !start
      ? "O"
      : !end
        ? baseline === "O–X"
          ? "X"
          : "Y"
        : null;
    if (!start || !end) {
      return {
        baseline,
        measuredMm: null,
        targetMm: 100,
        signedDifferenceMm: null,
        absoluteErrorMm: null,
        toleranceMm,
        status: "incomplete",
        missingPoint,
        zDifferenceMm: null,
      };
    }
    const measuredMm = pointDistance(start.pose, end.pose);
    const signedDifferenceMm = measuredMm - 100;
    const absoluteErrorMm = Math.abs(signedDifferenceMm);
    return {
      baseline,
      measuredMm,
      targetMm: 100,
      signedDifferenceMm,
      absoluteErrorMm,
      toleranceMm,
      status: "informational",
      missingPoint: null,
      zDifferenceMm: end.pose.z - start.pose.z,
    };
  });
}

export function validatePaperFrame(
  samples: PaperReferenceSample[],
  now = Date.now(),
  _baselineLengthToleranceMm = PAPER_BASELINE_LENGTH_TOLERANCE_DEFAULT_MM,
): { ok: true; frame: PaperFrame } | { ok: false; reason: string } {
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
  const ax = X.pose.x - O.pose.x, ay = X.pose.y - O.pose.y;
  const bx = Y.pose.x - O.pose.x, by = Y.pose.y - O.pose.y;
  if (ox < 1 || oy < 1)
    return { ok: false, reason: "O–X 또는 O–Y 기준점이 너무 가까워 종이 축을 계산할 수 없습니다. 종이의 서로 다른 끝점을 다시 기록하세요." };
  if (ax * by - ay * bx <= 0) return { ok: false, reason: "종이 X/Y 기준점 순서가 뒤바뀌었습니다. 인쇄된 축을 확인하세요." };
  const basisSine = Math.abs(ax * by - ay * bx) / (ox * oy);
  if (basisSine < 0.1)
    return { ok: false, reason: "O–X와 O–Y 기준선이 거의 일직선이라 종이 좌표를 안정적으로 계산할 수 없습니다. Y점을 종이의 세로 끝점 쪽에 다시 기록하세요." };
  // Unlock teaching can rotate the wrist. Paper axes come from XY positions,
  // not the recorded wrist angles; retain R as evidence and the O motion heading.
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
    z: O.z + (X.z - O.z) * point.xCm / PAPER_GRID_SIZE_CM + (Y.z - O.z) * point.yCm / PAPER_GRID_SIZE_CM,
    r: O.r,
  };
}

export type PaperCoordinateCmDraft = {
  point: string;
  xCm: string;
  yCm: string;
};

/** Convert student-entered 0–10 cm points using the measured O/X/Y basis. */
export function mapPaperCoordinatesToRobotTargets(
  frame: PaperFrame,
  coordinates: readonly PaperCoordinateCmDraft[],
): PaperPredictionPoint[] | null {
  const names = ["P1", "P2", "P3", "P4"];
  if (coordinates.length !== names.length) return null;
  const parsed = coordinates.map((point, index) => ({
    point: point.point,
    xCm: point.xCm.trim() ? Number(point.xCm) : NaN,
    yCm: point.yCm.trim() ? Number(point.yCm) : NaN,
    valid:
      point.point === names[index] &&
      point.xCm.trim() !== "" &&
      point.yCm.trim() !== "" &&
      Number.isFinite(Number(point.xCm)) &&
      Number.isFinite(Number(point.yCm)) &&
      Number(point.xCm) >= 0 &&
      Number(point.xCm) <= PAPER_GRID_SIZE_CM &&
      Number(point.yCm) >= 0 &&
      Number(point.yCm) <= PAPER_GRID_SIZE_CM,
  }));
  if (
    parsed.some((point) => !point.valid) ||
    new Set(parsed.map((point) => `${point.xCm},${point.yCm}`)).size !==
      parsed.length
  )
    return null;
  return parsed.map(({ point, xCm, yCm }) => {
    const pose = frameTransformPoint(frame, { xCm, yCm });
    return {
      name: point as PaperPointName,
      xCm,
      yCm,
      robotX: String(Number(pose.x.toFixed(4))),
      robotY: String(Number(pose.y.toFixed(4))),
      robotZ: String(Number(pose.z.toFixed(4))),
      robotR: String(Number(pose.r.toFixed(4))),
    };
  });
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

export function makePaperPlanHash(frameId: string, targetSet: PaperTargetSet, transform: PaperStudentTransform | null, predictions: PaperPredictionPoint[]): string {
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
  const criteria = run.verificationCriteria;
  if (criteria && (criteria.frameId !== run.frameId || criteria.planHash !== run.planHash
    || criteria.targetSet !== run.targetSet || criteria.confirmedAt > run.startedAt
    || !Number.isFinite(criteria.positionToleranceMm) || criteria.positionToleranceMm <= 0
    || !Number.isFinite(criteria.rotationToleranceDeg) || criteria.rotationToleranceDeg <= 0
    || !criteria.rationale.trim()
    || JSON.stringify(criteria.modelConstructionPoints)!==JSON.stringify(["O","X","Y"])
    || !paperVerificationPointsAreValid(criteria,targets,true)))
    return "실행 전에 확인한 독립 검증 기준과 현재 실행이 일치하지 않습니다.";
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
  return record.run.source==="hardware" ? "실장비 재검증 후보 · TCP와 잉크 기준 판정 대기"
    : record.run.source==="mock" ? "모의 재실행 자료 · 실측 재검증 아님" : "DT 재실행 자료 · 실측 재검증 아님";
}

export function paperRevalidationAssessment(
  record: PaperTrialRecord,
  parent: PaperTrialRecord | undefined,
  targets: PaperGridPoint[],
  inkWithinTolerance: boolean,
): NonNullable<PaperTrialRecord["revalidation"]> | null {
  const run = record.run;
  const criteria = run?.verificationCriteria;
  const scope = paperRevalidationScope(record, parent, targets);
  if (!scope || !run || !criteria || criteria.recordId !== record.id
    || criteria.frameId !== record.frame?.id || criteria.planHash !== run.planHash) return null;
  const tcpWithinTolerance = run.observations.every((observation, index) => {
    const target = frameTransformPoint(record.frame!, targets[index]);
    const distance = Math.hypot(observation.pose.x - target.x, observation.pose.y - target.y);
    // Hand-guided O/X/Y samples can carry different R values. R is kept in the
    // evidence record, but paper position verification is XY-only.
    return distance <= criteria.positionToleranceMm;
  });
  if (run.source !== "hardware") return {
    parentAttemptId: parent!.id, runId: run.id, source: run.source, checkedAt: Date.now(), scope,
    result: "simulation-only", tcpWithinTolerance, inkWithinTolerance,
  };
  if (!tcpWithinTolerance || !inkWithinTolerance) return {
    parentAttemptId: parent!.id, runId: run.id, source: run.source, checkedAt: Date.now(),
    scope: "실물 재검증 미완료 · TCP 또는 잉크 기준을 충족하지 않았습니다.",
    result: "incomplete", tcpWithinTolerance, inkWithinTolerance,
  };
  return {
    parentAttemptId: parent!.id, runId: run.id, source: run.source, checkedAt: Date.now(),
    scope: "실장비 TCP와 독립 잉크 측정이 사전 기준 안에 있습니다.",
    result: "physical-verified", tcpWithinTolerance, inkWithinTolerance,
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
