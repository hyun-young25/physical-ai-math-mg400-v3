import type { SquareVisual } from "./squareComparisonVisual";
import type { paperTransformEstimate } from "./paperRectangleTask";
import type { PaperTrialRecord, PaperReferenceSource, PaperDiagnosis, PaperEvidenceSource, PaperFrame, PaperGridPoint, PaperPointName, PaperPredictionPoint, PaperReferenceSample, PaperRunSnapshot, PaperStudentTransform, PaperTargetSet, PaperCoordinateLevel, PaperAiAnalysisRecord, PaperInkReadingDraft, PaperVerificationCriteria } from "./paperCoordinateStudy";
import type { LearningAiController } from "./LearningAiFeedback";

export type PaperLessonStage = 1 | 2 | 3 | 4 | 5 | 6 | 7;
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
  if (!diagnosisComplete) return {
    target: "diagnosis",
    message: "6단계 비교 자료가 아직 완성되지 않았습니다. 실행 결과와 연결된 비교 자료를 먼저 확인하세요.",
  };
  if (!hypothesisSaved) return {
    target: "hypothesis",
    message: "7단계로 가기 전에 6단계에서 관측 자료에 대한 원인 가설을 입력하고 ‘생각 저장’을 눌러야 합니다.",
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
  return !!criteria && !!recordId && !!frameId && !!planHash && matches
    && criteria.recordId === recordId
    && criteria.frameId === frameId
    && criteria.planHash === planHash;
}

export type PaperCoordinateStudyViewState = {
  dtBlockers?: import("./paperExecutionGuards").PaperRunBlocker[];
  physicalBlockers?: import("./paperExecutionGuards").PaperRunBlocker[];
  allowMismatchedHardware?: boolean;
  retry?: {id:string;attempt:number;baseline:NonNullable<ReturnType<typeof import("./paperRetry").paperRetryInputs>>;fields:string[];focusRequested:boolean;editable:boolean};
  revisionJourney?: import("./revisionJourney").RevisionJourneyData | null;
  rotationAllowed?:boolean;
  pathConcept?:{motion:string;closeX:string;closeY:string};
  gptQuestion?:string;
  comparison?:SquareVisual|null;
  transformEstimate?:ReturnType<typeof paperTransformEstimate>;
  priorSameType?:number;
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
  manualInputs: Record<PaperPointName, { x: string; y: string; z: string; r: string }>;
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
  convertedReadings: Array<{ point: string; source: PaperEvidenceSource; seq: number | null; measuredAt: number; xCm: number | null; yCm: number | null }>;
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
  running: boolean;
  error: string;
};

export type PaperCoordinateStudyViewActions = {
  onAllowMismatchedHardware?: (value:boolean) => void;
  onOpenConnection?: () => void;
  onResetRetry?: () => void;
  onPathConceptChange:(field:"motion"|"closeX"|"closeY",value:string)=>void;
  onBack: () => void;
  onExport: () => void;
  onStageChange: (stage: PaperLessonStage) => void;
  onLevelChange: (level: PaperCoordinateLevel) => void;
  onRecordCurrentReference: (point: PaperPointName) => void;
  onManualReferenceChange: (point: PaperPointName, field: "x" | "y" | "z" | "r", value: string) => void;
  onSaveManualReference: (point: PaperPointName) => void;
  onTransformChange: (field: keyof PaperStudentTransform, value: string) => void;
  onSaveTransform: () => void;
  onPredictionChange: (point: string, field: "robotX" | "robotY", value: string) => void;
  onSavePrediction: () => void;
  onRunDT: () => void;
  onRunPhysical: () => void;
  onRecordCurrentLiftHeight: () => void;
  onLiftHeightChange: (value: string) => void;
  onToleranceChange: (field: "positionTolerance" | "rotationTolerance", value: string) => void;
  onVerificationReasonChange: (value: string) => void;
  onSaveVerificationCriteria: () => void;
  onInkReadingChange: (point: string, field: "xCm" | "yCm" | "status" | "reason", value: string) => void;
  onSaveInkReadings: () => void;
  onSaveHypothesis: (value: string) => void;
  onFollowupObservationChange: (value: string) => void;
  onModelDecisionChange: (value: "revise" | "retain") => void;
  onModelDecisionReasonChange: (value: string) => void;
  onSaveFollowupObservation: (value: string) => void;
  onAiAnalysisDisplayed: (analysis: PaperAiAnalysisRecord) => void;
  onRevise: (input: { reason: string; decision: "revise" | "retain"; decisionReason: string; followupObservation: string }) => void;
  onChooseNewTarget: () => void;
  onMovePaper: (reason:string) => void;
};

export type PaperCoordinateStudyViewProps = {
  state: PaperCoordinateStudyViewState;
  actions: PaperCoordinateStudyViewActions;
  ai: LearningAiController;
};
