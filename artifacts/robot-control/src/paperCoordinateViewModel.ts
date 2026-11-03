import type { SquareVisual } from "./squareComparisonVisual";
import type { paperTransformEstimate } from "./paperRectangleTask";
import type {
  PaperTrialRecord,
  PaperReferenceSource,
  PaperDiagnosis,
  PaperEvidenceSource,
  PaperFrame,
  PaperGridPoint,
  PaperPointName,
  PaperPredictionPoint,
  PaperReferenceSample,
  PaperRunSnapshot,
  PaperStudentTransform,
  PaperTargetSet,
  PaperCoordinateLevel,
  PaperAiAnalysisRecord,
  PaperInkReadingDraft,
  PaperVerificationCriteria,
  PaperBaselineLengthMetric,
  PaperTrialDrafts,
} from "./paperCoordinateStudy";
import type { LearningAiController } from "./LearningAiFeedback";
import type { FeedbackContext } from "./learningAiContext";

export type PaperLessonStage = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type PaperStudentScreen = 1 | 2 | 3;

/** The advanced paper lessons keep their established record stages internally,
 * while students see only prediction, execution/comparison, and revision. */
export function paperStudentScreenForStage(stage: number): PaperStudentScreen {
  return stage <= 3 ? 1 : stage <= 6 ? 2 : 3;
}
export function paperRetryInitialStep(
  status: PaperRunSnapshot["status"] | null,
  hasPlanHash: boolean,
): 1 | 3 | 4 {
  if (status === "completed") return 4;
  return hasPlanHash ? 3 : 1;
}

/** Execution controls stay visible on the retry screen, but only become usable
 * after the revised transform and predictions have been saved as a new plan. */
export function paperRetryExecutionReady(step: number): boolean {
  return step >= 3;
}

export function paperRetryRunJustCompleted(
  previous: PaperRunSnapshot["status"] | null,
  current: PaperRunSnapshot["status"] | null,
): boolean {
  return previous !== "completed" && current === "completed";
}

export function paperComparableRunPair(
  history: readonly PaperRunSnapshot[] | undefined,
  current: PaperRunSnapshot | null | undefined,
  planHash: string,
  frameId: string | null | undefined,
  targetSet: PaperTargetSet,
): {
  previous: PaperRunSnapshot | null;
  current: PaperRunSnapshot | null;
} {
  if (!planHash || !frameId) return { previous: null, current: null };
  const belongsToCurrentPlan = (run: PaperRunSnapshot) =>
    run.planHash === planHash &&
    run.frameId === frameId &&
    run.targetSet === targetSet;
  const previous =
    [...(history ?? [])].reverse().find(belongsToCurrentPlan) ?? null;
  return {
    previous,
    current: current && belongsToCurrentPlan(current) ? current : null,
  };
}

export function paperRetryComparisonReady(
  status: PaperDiagnosis["status"] | null | undefined,
): boolean {
  return status === "complete";
}
export type PaperStageNavigationBlocker = {
  target: "diagnosis" | "hypothesis";
  message: string;
};

export function paperStageNavigationRequirement(
  nextStage: number,
  diagnosisComplete: boolean,
  hypothesisSaved: boolean,
): PaperStageNavigationBlocker | null {
  if (nextStage < 7) return null;
  if (!diagnosisComplete)
    return {
      target: "diagnosis",
      message:
        "6단계 비교 자료가 아직 완성되지 않았습니다. 실행 결과와 연결된 비교 자료를 먼저 확인하세요.",
    };
  if (!hypothesisSaved)
    return {
      target: "hypothesis",
      message:
        "7단계로 가기 전에 6단계에서 관측 자료에 대한 원인 가설을 입력하고 ‘생각 저장’을 눌러야 합니다.",
    };
  return null;
}

export function paperVerificationCriteriaSavedForAttempt(
  criteria: PaperVerificationCriteria | undefined,
  recordId: string | null,
  frameId: string | undefined,
  planHash: string,
  matches: boolean,
): boolean {
  return (
    !!criteria &&
    !!recordId &&
    !!frameId &&
    !!planHash &&
    matches &&
    criteria.recordId === recordId &&
    criteria.frameId === frameId &&
    criteria.planHash === planHash
  );
}

export type PaperCoordinateStudyViewState = {
  dtBlockers?: import("./paperExecutionGuards").PaperRunBlocker[];
  physicalBlockers?: import("./paperExecutionGuards").PaperRunBlocker[];
  allowMismatchedHardware?: boolean;
  retry?: {
    id: string;
    attempt: number;
    baseline: NonNullable<
      ReturnType<typeof import("./paperRetry").paperRetryInputs>
    >;
    fields: string[];
    focusRequested: boolean;
    editable: boolean;
  };
  revisionJourney?: import("./revisionJourney").RevisionJourneyData | null;
  parentAttempt?: PaperTrialRecord | null;
  activeAttempt?: PaperTrialRecord | null;
  baselineLengthToleranceMm: number;
  baselineLengthToleranceAppliedAt: number | null;
  baselineLengthToleranceDraft: string;
  baselineLengthMetrics: PaperBaselineLengthMetric[];
  liftCapture: {
    canRecord: boolean;
    message: string;
    nextAction: "connection" | "references" | "tcp-jog" | "revision" | "none";
    nextLabel: string;
  };
  liftRecordFeedback: string;
  rotationAllowed?: boolean;
  pathConcept?: { motion: string; closeX: string; closeY: string };
  gptQuestion?: string;
  comparison?: SquareVisual | null;
  transformEstimate?: ReturnType<typeof paperTransformEstimate>;
  priorSameType?: number;
  records: PaperTrialRecord[];
  recordId: string | null;
  attempt: number | null;
  analysisReady: boolean;
  revalidationScope: string | null;
  revalidationResult?: "physical-verified" | "simulation-only" | "incomplete";
  stage: PaperLessonStage;
  level: PaperCoordinateLevel;
  targetSet: PaperTargetSet;
  frame: PaperFrame | null;
  samples: PaperReferenceSample[];
  currentPose: { x: number; y: number; z: number; r: number } | null;
  /** Readout only. Must never enable recording a measured reference. */
  displayPose?: { x: number; y: number; z: number; r: number };
  displaySource?: PaperEvidenceSource;
  currentSource: PaperEvidenceSource | null;
  currentSequence: number | null;
  currentMeasuredAt: number | null;
  manualInputs: Record<
    PaperPointName,
    { x: string; y: string; z: string; r: string }
  >;
  coordinateSystem: string;
  user: number;
  tool: number;
  coordinatesVerified: boolean;
  referenceError: string;
  transform: PaperStudentTransform;
  transformFeedback: string;
  targetPoints: PaperGridPoint[];
  predictions: PaperPredictionPoint[];
  predictionsReady: boolean;
  predictionFeedback: string;
  run: PaperRunSnapshot | null;
  runAvailable: boolean;
  physicalAvailable: boolean;
  physicalUnavailableReason: string;
  liftHeight: number | null;
  liftHeightSource: PaperReferenceSource | null;
  liftHeightSequence: number | null;
  paperSurfaceZ: number | null;
  positionTolerance: number;
  rotationTolerance: number;
  convertedReadings: Array<{
    point: string;
    source: PaperEvidenceSource;
    seq: number | null;
    measuredAt: number;
    xCm: number | null;
    yCm: number | null;
  }>;
  inkReadings: PaperInkReadingDraft[];
  verificationCriteria?: PaperVerificationCriteria;
  verificationCriteriaMatches: boolean;
  stageNavigationBlocker: PaperStageNavigationBlocker | null;
  planHash: string;
  verificationReasonDraft: string;
  diagnosis: PaperDiagnosis | null;
  studentHypothesis: string;
  followupObservationDraft: string;
  modelDecision: "revise" | "retain";
  modelDecisionReasonDraft: string;
  revisionReason: string;
  saveState: "ready" | "saving" | "saved" | "failed";
  saveMessage: string;
  preparationSummary: string[];
  teacherPreparationReady: boolean;
  teacherPreparationBlockers: string[];
  tcpJog: {
    mode: "virtual" | "hardware";
    connection: "disconnected" | "connecting" | "connected";
    source: "hardware" | "mock" | null;
    pose: { x: number; y: number; z: number; r: number } | null;
    seq: number | null;
    measuredAt: number | null;
    ageMs: number | null;
    fresh: boolean;
    user: number | null;
    tool: number | null;
    appliedUser: number | null;
    appliedTool: number | null;
    appliedSpeed: number | null;
    busy: boolean;
    pending: boolean;
    stopAvailable: boolean;
    canMove: boolean;
    blocker: string;
    status: "idle" | "confirming" | "moving" | "completed" | "cancelled" | "failed";
    message: string;
  };
  referenceConnectionCurrent: boolean;
  liftConnectionCurrent: boolean;
  running: boolean;
  error: string;
};

export type PaperCoordinateStudyViewActions = {
  onAllowMismatchedHardware?: (value: boolean) => void;
  onOpenConnection?: () => void;
  onPersistDrafts: (drafts: PaperTrialDrafts) => void;
  onRetrySave: () => void;
  onSavePlanAndContinue: () => {
    message: string;
    target?: "references" | "transform" | "predictions" | "run";
  } | null;
  onSaveRetryPlan: () => {
    message: string;
    target?: "references" | "transform" | "predictions" | "run";
  } | null;
  onContinueToRevision: (
    hypothesis: string,
    diagnosis: PaperDiagnosis | null,
    inkReadings: PaperInkReadingDraft[],
  ) => {
    message: string;
    target?: "run" | "analysis" | "hypothesis" | "ink";
  } | null;
  onFinalizeRevalidation: (
    decision: "revise" | "retain",
    reason: string,
  ) => { message: string } | null;
  onResetRetry?: () => void;
  onPathConceptChange: (
    field: "motion" | "closeX" | "closeY",
    value: string,
  ) => void;
  onBack: () => void;
  onExport: () => void;
  onStageChange: (
    stage: PaperLessonStage,
  ) => { message: string; target?: string } | null;
  onLevelChange: (level: PaperCoordinateLevel) => void;
  onRecordCurrentReference: (point: PaperPointName) => void;
  onPreparationTcpJog: (axis: "x" | "y" | "z", deltaMm: number) => void;
  onStopPreparationMovement: () => void;
  onManualReferenceChange: (
    point: PaperPointName,
    field: "x" | "y" | "z" | "r",
    value: string,
  ) => void;
  onSaveManualReference: (point: PaperPointName) => void;
  onTransformChange: (
    field: keyof PaperStudentTransform,
    value: string,
  ) => void;
  onSaveTransform: () => { message: string; target?: string } | null;
  onPredictionChange: (
    point: string,
    field: "robotX" | "robotY",
    value: string,
  ) => void;
  onSavePrediction: () => void;
  onRunDT: () => void;
  onRunPhysical: () => void;
  onRecordCurrentLiftHeight: () => void;
  onLiftHeightChange: (value: string) => void;
  onBaselineLengthToleranceDraftChange: (value: string) => void;
  onApplyBaselineLengthTolerance: () => void;
  onFocusReferencePreparation: () => void;
  onFocusExecutionCriteria: () => void;
  onFocusTcpJog: () => void;
  onFocusRevision: () => void;
  onToleranceChange: (
    field: "positionTolerance" | "rotationTolerance",
    value: string,
  ) => void;
  onVerificationReasonChange: (value: string) => void;
  onSaveVerificationCriteria: () => void;
  onInkReadingChange: (
    point: string,
    field: "xCm" | "yCm" | "status" | "reason",
    value: string,
  ) => void;
  onSaveInkReadings: () => void;
  onSaveHypothesis: (value: string) => void;
  onFollowupObservationChange: (value: string) => void;
  onModelDecisionChange: (value: "revise" | "retain") => void;
  onModelDecisionReasonChange: (value: string) => void;
  onSaveFollowupObservation: (value: string) => void;
  onAiAnalysisDisplayed: (analysis: PaperAiAnalysisRecord) => void;
  onRevise: (input: {
    reason: string;
    decision: "revise" | "retain";
    decisionReason: string;
    followupObservation: string;
  }) => { message: string; target?: "hypothesis" | "analysis" | "run" } | null;
  onChooseNewTarget: () => void;
  onMovePaper: (reason: string) => void;
};

export type PaperCoordinateStudyViewProps = {
  state: PaperCoordinateStudyViewState;
  actions: PaperCoordinateStudyViewActions;
  ai: LearningAiController;
  prepareAiAnalysis?: () =>
    | { ok: true; context: FeedbackContext }
    | { ok: false; message: string; target?: "ink" };
};
