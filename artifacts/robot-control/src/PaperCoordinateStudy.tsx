import { paperRetryInputs, paperRetryFields } from "./paperRetry";
import {
  paperBoundary,
  supervisedPaperBlockers,
  type PaperRunBlocker,
} from "./paperExecutionGuards";
import { recordLearningAction } from "./learningSync";
import {
  useSquareAttemptHistory,
  SquareAttemptHistory,
  SquareAttemptReview,
} from "./squareAttemptHistory";
import { paperRevisionJourney } from "./revisionJourney";
import {
  PAPER_TASK_VERSION,
  isMergedPaper,
  isPaperDT,
  givenPaperFrame,
  PAPER_ROTATION_SETTING,
  paperConceptValid,
} from "./paperMergedLesson";
import { omitsOrigin } from "./originMissing";
import {
  paperTaskTargets,
  isPaperRectangle,
  paperFeedbackKey,
  paperRectangleVisual,
  paperTransformEstimate,
} from "./paperRectangleTask";
import {
  paperAnalysisReady,
  paperFeedbackContext,
  preparePaperInkReadings,
} from "./paperAiAnalysis";
import { paperInkComparisons } from "./paperAiAnalysis";
import {
  publishSquareVisual,
  clearSquareVisual,
} from "./squareVisualizationStore";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useId,
  useLayoutEffect,
} from "react";
import type { LessonPose } from "./curriculum";
import { PaperCoordinateStudyView } from "./PaperCoordinateStudyView";
import { paperStageNavigationRequirement } from "./paperCoordinateViewModel";
import type {
  PaperCoordinateStudyViewState,
  PaperLessonStage,
} from "./paperCoordinateViewModel";
import {
  PAPER_ANGLE_TOLERANCE_DEG,
  PAPER_BASELINE_LENGTH_TOLERANCE_DEFAULT_MM,
  PAPER_BASELINE_LENGTH_TOLERANCE_MAX_MM,
  PAPER_GRID_SIZE_CM,
  PAPER_MEASURE_TOLERANCE_MM,
  PAPER_SAMPLE_MAX_AGE_MS,
  archiveCompletedPaperRunForLiftEdit,
  paperLiftHeightDraftState,
  parsePaperLiftHeightDraft,
  recoverInterruptedPaperRuns,
  PAPER_TARGETS,
  classifyPaperVerificationPoints,
  paperVerificationPointsMatch,
  comparePaperPredictionToFrame,
  diagnosePaperRun,
  frameInversePoint,
  frameTransformPoint,
  mapPaperCoordinatesToRobotTargets,
  getPaperFrameAngleDegrees,
  makePaperPlanHash,
  studentTransformPoint,
  validatePaperFrame,
  validatePaperRunForDiagnosis,
  paperRevalidationAssessment,
  paperBaselineLengthMetrics,
} from "./paperCoordinateStudy";
import type {
  PaperCoordinateLevel,
  PaperRectangleLevel,
  PaperDiagnosis,
  PaperEvidenceSource,
  PaperFrame,
  PaperGridPoint,
  PaperPointName,
  PaperPoseObservation,
  PaperPredictionPoint,
  PaperReferenceSample,
  PaperRunSnapshot,
  PaperStudentTransform,
  PaperTargetSet,
  PaperTrialRecord,
  PaperInkReadingDraft,
  PaperVerificationCriteria,
  PaperTrialDrafts,
  PaperBaselineLengthTolerance,
} from "./paperCoordinateStudy";
import type { PaperCoordinateStudyViewActions } from "./paperCoordinateViewModel";
import { LearningAiFeedback, useLearningAi } from "./LearningAiFeedback";
import { privateText, type FeedbackContext } from "./learningAiContext";
import { usePractice } from "./PracticeProvider";
import {
  readEvidence,
  writeEvidence,
  downloadEvidence,
} from "./learningEvidenceStorage";
import {
  measurementFresh,
  installationKey,
  setupProblem,
  targetProblem,
  workspaceFindings,
} from "./practiceSession";
import type { PracticeOperation, RobotMeasurement } from "./practiceSession";

const STORAGE_KEY = "physical-ai-paper-coordinate-v1";
const EMPTY_TRANSFORM: PaperStudentTransform = {
  originX: "",
  originY: "",
  axisDirection: "",
  millimetersPerCentimeter: "",
  rotationDegrees: "",
  explanation: "",
};
const EMPTY_POSE = { x: "", y: "", z: "", r: "" };
const emptyManualInputs = () => ({
  O: { ...EMPTY_POSE },
  X: { ...EMPTY_POSE },
  Y: { ...EMPTY_POSE },
});
const manualInputsFromSamples = (samples: readonly PaperReferenceSample[]) => {
  const inputs = emptyManualInputs();
  for (const sample of samples) {
    inputs[sample.point] = {
      x: String(sample.pose.x),
      y: String(sample.pose.y),
      z: String(sample.pose.z),
      r: String(sample.pose.r),
    };
  }
  return inputs;
};
const baselineLengthToleranceFor = (
  record: PaperTrialRecord | null | undefined,
) =>
  record?.baselineLengthTolerance?.toleranceMm ??
  PAPER_BASELINE_LENGTH_TOLERANCE_DEFAULT_MM;
const paperPlanHashFor = (
  frameId: string,
  targetSet: PaperTargetSet,
  transform: PaperStudentTransform | undefined,
  predictions: PaperPredictionPoint[],
  liftHeight: number | null,
  _baselineLengthToleranceMm: number,
  taskVersion = PAPER_TASK_VERSION,
) =>
  `${makePaperPlanHash(frameId, targetSet, transform ?? null, predictions)}${taskVersion === "v4-paper-merged" ? `|baseline-length:${_baselineLengthToleranceMm}` : ""}|lift:${liftHeight ?? "unset"}`;
const isRecord = (value: unknown): value is PaperTrialRecord =>
  !!value &&
  typeof value === "object" &&
  (value as PaperTrialRecord).task === "paper-coordinate" &&
  (value as PaperTrialRecord).version === 1 &&
  typeof (value as PaperTrialRecord).id === "string";
const timeIso = () => new Date().toISOString();
const poseDistance = (a: LessonPose, b: LessonPose) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const freshRecords = () =>
  recoverInterruptedPaperRuns(readEvidence(STORAGE_KEY, isRecord));

export type PaperCoordinateStudyProps = {
  onBack: () => void;
  initialLevel?: PaperRectangleLevel;
  supportMode?: "guided" | "challenge";
  onRunningChange?: (running: boolean) => void;
  hardwareConnected: boolean;
  currentPose: LessonPose;
  canReach: (pose: LessonPose) => boolean;
  runDigitalTwin: (commands: LessonPose[]) => Promise<void>;
};

export function PaperCoordinateStudy({
  onBack,
  hardwareConnected,
  currentPose,
  canReach,
  runDigitalTwin,
  initialLevel,
  onRunningChange,
  supportMode = "guided",
}: PaperCoordinateStudyProps) {
  const visualOwner = useId();
  const initialRecord = useRef(
    freshRecords()
      .filter((r) => !initialLevel || r.level === initialLevel)
      .at(-1),
  );
  const practice = usePractice();
  const practiceRef = useRef(practice);
  practiceRef.current = practice;
  const [records, setRecords] = useState<PaperTrialRecord[]>(freshRecords);
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const [activeId, setActiveId] = useState<string | null>(
    () => initialRecord.current?.id ?? null,
  );
  const [stage, setStage] = useState<PaperLessonStage>(
    () => (initialRecord.current?.stage as PaperLessonStage) ?? 1,
  );
  const [level, setLevel] = useState<PaperCoordinateLevel>(
    () => initialRecord.current?.level ?? initialLevel ?? "basic",
  );
  const [rotationAllowed] = useState(
    () => localStorage.getItem(PAPER_ROTATION_SETTING) !== "false",
  );
  const blankTransform = (l: PaperCoordinateLevel) => ({
    ...EMPTY_TRANSFORM,
    ...(isMergedPaper(l) && (!rotationAllowed || isPaperDT(l))
      ? { axisDirection: "x+" as const, rotationDegrees: "0" }
      : {}),
  });
  const [transformDraft, setTransformDraft] = useState<PaperStudentTransform>(
    () => initialRecord.current?.transform ?? blankTransform(level),
  );
  const [manualInputs, setManualInputs] = useState(() =>
    manualInputsFromSamples(
      initialRecord.current?.referenceSamples ??
        initialRecord.current?.frame?.samples ??
        [],
    ),
  );
  const [predictionDraft, setPredictionDraft] = useState<
    PaperPredictionPoint[]
  >([]);
  const [paperCoordinateDrafts, setPaperCoordinateDrafts] = useState<
    Array<{ point: string; xCm: string; yCm: string }>
  >(() => paperTaskTargets(
    initialRecord.current?.level ?? initialLevel ?? "basic",
    initialRecord.current?.targetSet ?? "initial",
    initialRecord.current?.taskVersion,
  ).map((point) => ({
    point: point.name,
    xCm: String(point.xCm),
    yCm: String(point.yCm),
  })));
  const [inkDraft, setInkDraft] = useState<PaperInkReadingDraft[]>([]);
  const [hypothesisDraft, setHypothesisDraft] = useState("");
  const [revisionDraft, setRevisionDraft] = useState("");
  const [verificationReasonDraft, setVerificationReasonDraft] = useState("");
  const [followupObservationDraft, setFollowupObservationDraft] = useState("");
  const [modelDecision, setModelDecision] = useState<"revise" | "retain">(
    "revise",
  );
  const [modelDecisionReasonDraft, setModelDecisionReasonDraft] = useState("");
  const [liftDraft, setLiftDraft] = useState(() =>
    initialRecord.current?.liftHeight
      ? String(initialRecord.current.liftHeight.z)
      : "",
  );
  const [liftRecordFeedback, setLiftRecordFeedback] = useState("");
  const [baselineLengthToleranceDraft, setBaselineLengthToleranceDraft] =
    useState(String(baselineLengthToleranceFor(initialRecord.current)));
  const [saveState, setSaveState] =
    useState<PaperCoordinateStudyViewState["saveState"]>("ready");
  const [saveMessage, setSaveMessage] = useState("");
  const [referenceError, setReferenceError] = useState("");
  const [transformFeedback, setTransformFeedback] = useState("");
  const [predictionFeedback, setPredictionFeedback] = useState("");
  const [pageError, setPageError] = useState("");
  const [running, setRunning] = useState(false);
  const [tcpJogStatus, setTcpJogStatus] =
    useState<PaperCoordinateStudyViewState["tcpJog"]["status"]>("idle");
  const [tcpJogMessage, setTcpJogMessage] = useState("");
  const tcpJogInFlightRef = useRef(false);
  // Per-lesson opt-in. Never restored from a student's saved attempt.
  const [allowMismatchedHardware, setAllowMismatchedHardware] = useState(false);
  const activeRunRef = useRef(false);
  const [focusRetryId, setFocusRetryId] = useState<string | null>(null);
  const [resetRetryId, setResetRetryId] = useState<string | null>(null);
  const [diagnosisOverride, setDiagnosisOverride] =
    useState<PaperDiagnosis | null>(null);

  const active = records.find((record) => record.id === activeId) ?? null;
  const attemptSupport = active?.support ?? supportMode;
  const currentTargetSet: PaperTargetSet = active?.targetSet ?? "initial";
  const taskPoints = paperTaskTargets(level, currentTargetSet, active?.taskVersion);
  const targetPoints = active?.predictions?.length
    ? active.predictions.map(({ name, xCm, yCm }) => ({ name, xCm, yCm }))
    : taskPoints;
  const autoMappedPaperLesson =
    isMergedPaper(level) &&
    (active?.taskVersion ?? PAPER_TASK_VERSION) === PAPER_TASK_VERSION;
  const frame = active?.frame ?? null;
  const retryParent = records.find((r) => r.id === active?.parentAttemptId);
  const retryInputs =
    resetRetryId !== active?.id
      ? paperRetryInputs(retryParent, level, frame, targetPoints)
      : null;
  const samples = active?.referenceSamples ?? frame?.samples ?? [];
  const currentMeasurement = practice.snap.measurement;
  const measurementAvailable =
    practice.snap.connection === "connected" &&
    measurementFresh(currentMeasurement) &&
    !currentMeasurement?.moving &&
    !currentMeasurement?.error;
  const currentPoseRead = measurementAvailable
    ? currentMeasurement!.pose
    : null;
  const currentSource = measurementAvailable
    ? currentMeasurement!.source
    : null;
  const currentSequence = measurementAvailable ? currentMeasurement!.seq : null;
  const currentMeasuredAt = measurementAvailable
    ? currentMeasurement!.measuredAt
    : null;
  const currentSystem = measurementAvailable
    ? `User ${currentMeasurement!.user} / Tool ${currentMeasurement!.tool}`
    : "";
  const currentUser = measurementAvailable
    ? currentMeasurement!.user
    : practice.setupDraft.user;
  const currentTool = measurementAvailable
    ? currentMeasurement!.tool
    : practice.setupDraft.tool;
  const coordinatesVerified =
    !!practice.setupDraft.verified.coordinates &&
    !!practice.snap.setup?.verified.coordinates &&
    (!measurementAvailable ||
      (currentMeasurement!.user === practice.snap.setup!.user &&
        currentMeasurement!.tool === practice.snap.setup!.tool));
  const selectedTransform = transformDraft;
  const draftTargets = useMemo(
    () =>
      targetPoints.map((point) => {
        const existing =
          predictionDraft.find((item) => item.name === point.name) ??
          active?.predictions?.find((item) => item.name === point.name);
        return (
          existing ?? {
            ...point,
            robotX: "",
            robotY: "",
            robotZ: "",
            robotR: "",
          }
        );
      }),
    [targetPoints, predictionDraft, active?.predictions],
  );
  const predictionsComplete = autoMappedPaperLesson
    ? paperCoordinateDrafts.length === targetPoints.length &&
      paperCoordinateDrafts.every((point, index) => {
        const x = Number(point.xCm);
        const y = Number(point.yCm);
        const mapped = frame && Number.isFinite(x) && Number.isFinite(y)
          ? frameTransformPoint(frame, { xCm: x, yCm: y })
          : null;
        return point.point === targetPoints[index]?.name &&
          point.xCm.trim() !== "" &&
          point.yCm.trim() !== "" &&
          Number.isFinite(x) &&
          Number.isFinite(y) &&
          x >= 0 && x <= PAPER_GRID_SIZE_CM &&
          y >= 0 && y <= PAPER_GRID_SIZE_CM &&
          !!mapped &&
          [mapped.x, mapped.y, mapped.z, mapped.r].every(Number.isFinite);
      }) &&
      new Set(paperCoordinateDrafts.map((point) => `${point.xCm},${point.yCm}`)).size ===
        paperCoordinateDrafts.length
    : draftTargets.length === targetPoints.length &&
      draftTargets.every((point) =>
        [point.robotX, point.robotY].every(
          (value) => value.trim() !== "" && Number.isFinite(Number(value)),
        ),
      );
  const persistedPredictions = active?.predictions ?? [];
  const selectedPlanHash = active?.planHash ?? "";
  const surfaceZ = frame
    ? Math.max(...frame.samples.map((sample) => sample.pose.z))
    : null;
  const originPose =
    frame?.samples.find((sample) => sample.point === "O")?.pose ?? null;
  const liftRecord = active?.liftHeight;
  const liftDraftState = paperLiftHeightDraftState(liftDraft, liftRecord);
  // Only the exact value already saved in the active trial may feed planning.
  // Raw/incomplete/unsaved text remains visible but cannot authorize a run.
  const liftHeight = liftDraftState.value;
  const baselineLengthToleranceMm = baselineLengthToleranceFor(active);
  const transformComplete =
    !!frame &&
    !!selectedTransform.axisDirection &&
    [
      selectedTransform.originX,
      selectedTransform.originY,
      selectedTransform.millimetersPerCentimeter,
      selectedTransform.rotationDegrees,
    ].every((value) => value.trim() !== "" && Number.isFinite(Number(value))) &&
    Number(selectedTransform.millimetersPerCentimeter) > 0 &&
    !!selectedTransform.explanation.trim();
  const planHash =
    frame &&
    persistedPredictions.length === targetPoints.length
      ? paperPlanHashFor(
          frame.id,
          currentTargetSet,
          active?.transform,
          persistedPredictions,
          liftHeight,
          baselineLengthToleranceMm,
          active?.taskVersion,
        )
      : "";
  const savedCoordinatesMatchDraft =
    autoMappedPaperLesson &&
    paperCoordinateDrafts.length === persistedPredictions.length &&
    paperCoordinateDrafts.every((point, index) =>
      point.point === persistedPredictions[index]?.name &&
      point.xCm === String(persistedPredictions[index]?.xCm) &&
      point.yCm === String(persistedPredictions[index]?.yCm),
    );
  const samePlan =
    !!planHash &&
    planHash === selectedPlanHash &&
    (autoMappedPaperLesson
      ? (!active?.transform ||
        JSON.stringify(transformDraft) === JSON.stringify(active.transform)) &&
        savedCoordinatesMatchDraft
      : !!active?.transform &&
        JSON.stringify(transformDraft) === JSON.stringify(active.transform) &&
        JSON.stringify(draftTargets) === JSON.stringify(persistedPredictions));
  const planTransformReady = autoMappedPaperLesson || !!active?.transform;
  const run = active?.run ?? null;
  const dtReadyForPhysical =
    !!active?.dtRunPlanHash && active.dtRunPlanHash === planHash;
  const mismatchedPrediction =
    !!frame &&
    persistedPredictions.length === targetPoints.length &&
    comparePaperPredictionToFrame(frame, persistedPredictions).some(
      (e) => e.distance > 0.1,
    );
  const supervisedMismatch =
    level === "advanced-paper-hardware" &&
    allowMismatchedHardware &&
    mismatchedPrediction;

  const lastSaveSucceededRef = useRef(true);
  const pendingInkDraftRef = useRef<{
    recordId: string;
    snapshot: string;
  } | null>(null);
  const saveAll = useCallback(
    (
      nextRecords: PaperTrialRecord[],
      message = "학습 근거를 브라우저에 저장했습니다.",
    ) => {
      setSaveState("saving");
      const ok = writeEvidence(STORAGE_KEY, nextRecords);
      const pendingInkDraft = pendingInkDraftRef.current;
      const pendingInkDraftSaved =
        !!pendingInkDraft &&
        nextRecords.some(
          (record) =>
            record.id === pendingInkDraft.recordId &&
            JSON.stringify(record.drafts?.inkReadings ?? null) ===
              pendingInkDraft.snapshot,
        );
      if (ok) {
        recordsRef.current = nextRecords;
        setRecords(nextRecords);
        if (pendingInkDraftSaved) pendingInkDraftRef.current = null;
      }
      const fullySaved = ok && (!pendingInkDraft || pendingInkDraftSaved);
      lastSaveSucceededRef.current = fullySaved;
      setSaveState(fullySaved ? "saved" : "failed");
      setSaveMessage(
        fullySaved
          ? message
          : ok
            ? "현재 잉크 입력이 아직 저장되지 않았습니다. 입력을 유지하고 다시 시도하세요."
            : "브라우저 저장에 실패했습니다. 화면을 닫기 전에 기록을 내보내세요.",
      );
      return fullySaved;
    },
    [],
  );
  const upsert = useCallback(
    (record: PaperTrialRecord, message?: string) => {
      const updated = { ...record, updatedAt: timeIso() };
      const current = recordsRef.current;
      const index = current.findIndex((item) => item.id === updated.id);
      const next =
        index < 0
          ? [...current, updated]
          : current.map((item) => (item.id === updated.id ? updated : item));
      const saved = saveAll(next, message);
      if (saved) setActiveId(updated.id);
      return updated;
    },
    [saveAll],
  );
  const persistPendingInkDraft = (
    record: PaperTrialRecord,
    readings: PaperInkReadingDraft[],
    message = "현재 화면의 잉크 입력을 먼저 저장했습니다.",
  ) => {
    const pending = pendingInkDraftRef.current;
    if (!pending) return true;
    if (pending.recordId !== record.id) return false;

    const latest =
      recordsRef.current.find((item) => item.id === record.id) ?? record;
    pendingInkDraftRef.current = {
      recordId: record.id,
      snapshot: JSON.stringify(readings),
    };
    upsert(
      {
        ...latest,
        drafts: { ...latest.drafts, inkReadings: readings },
      },
      message,
    );
    return (
      lastSaveSucceededRef.current &&
      pendingInkDraftRef.current?.recordId !== record.id
    );
  };
  const createTrial = useCallback(
    (options: {
      targetSet: PaperTargetSet;
      level: PaperCoordinateLevel;
      parentAttemptId: string | null;
      frame?: PaperFrame;
      referenceSamples?: PaperReferenceSample[];
      transform?: PaperStudentTransform;
      liftHeight?: PaperTrialRecord["liftHeight"];
    }) => {
      if (isPaperDT(options.level) && !options.frame) {
        options = {
          ...options,
          frame: givenPaperFrame(!!options.parentAttemptId),
        };
        const o = options.frame!.samples[0];
        options.referenceSamples = options.frame!.samples;
        options.liftHeight = {
          z: 80,
          source: "teacher",
          seq: null,
          capturedAt: Date.now(),
          ageMsAtCapture: null,
          user: 0,
          tool: 0,
          coordinateSystem: o.coordinateSystem,
        };
      }
      const previousAttempts = recordsRef.current.filter(
        (record) =>
          record.task === "paper-coordinate" && record.level === options.level,
      ).length;
      const created: PaperTrialRecord = {
        id: crypto.randomUUID(),
        task: "paper-coordinate",
        version: 1,
        uiVersion: "diag-visual-v2",
        taskVersion: PAPER_TASK_VERSION,
        support: supportMode,
        attempt: previousAttempts + 1,
        parentAttemptId: options.parentAttemptId,
        targetSet: options.targetSet,
        level: options.level,
        status: options.frame ? "model" : "references",
        stage: isPaperDT(options.level) ? 1 : options.frame ? 2 : 1,
        dataSource: options.frame?.source ?? "teacher",
        createdAt: timeIso(),
        updatedAt: timeIso(),
        baselineLengthTolerance: {
          toleranceMm: PAPER_BASELINE_LENGTH_TOLERANCE_DEFAULT_MM,
          appliedAt: Date.now(),
          scope: "xy-baseline-length-only",
        },
        ...(options.frame ? { frame: options.frame } : {}),
        ...(options.referenceSamples
          ? { referenceSamples: options.referenceSamples }
          : {}),
        ...(options.transform ? { transform: options.transform } : {}),
        ...(options.liftHeight ? { liftHeight: options.liftHeight } : {}),
      };
      upsert(created, "새 시도가 이전 기록과 연결되어 저장되었습니다.");
      if (!lastSaveSucceededRef.current) {
        setPageError(
          "새 시도를 저장하지 못했습니다. 이전 시도와 입력은 유지했습니다. 저장 상태를 확인하고 다시 시도하세요.",
        );
        return created;
      }
      setStage(
        (isPaperDT(options.level)
          ? 1
          : options.frame
            ? 2
            : 1) as PaperLessonStage,
      );
      setLevel(options.level);
      setTransformDraft(options.transform ?? blankTransform(options.level));
      setPredictionDraft(
        paperTaskTargets(options.level, options.targetSet).map((point) => ({
          ...point,
          robotX: "",
          robotY: "",
          robotZ: "",
          robotR: "",
        })),
      );
      setInkDraft(
        paperTaskTargets(options.level, options.targetSet).map((point) => ({
          point: point.name,
          xCm: "",
          yCm: "",
          status: "not-measured" as const,
          reason: "",
        })),
      );
      setDiagnosisOverride(null);
      setVerificationReasonDraft("");
      setFollowupObservationDraft("");
      setModelDecision("revise");
      setModelDecisionReasonDraft("");
      setPageError("");
      setTransformFeedback("");
      setPredictionFeedback("");
      setReferenceError("");
      return created;
    },
    [upsert, supportMode, rotationAllowed],
  );

  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current && !activeId && isMergedPaper(level)) {
      initialized.current = true;
      createTrial({ targetSet: "initial", level, parentAttemptId: null });
    }
  }, [activeId, level, createTrial]);

  useEffect(() => {
    if (!active) return;
    setStage((active.stage as PaperLessonStage) ?? (active.frame ? 2 : 1));
    setLevel(active.level);
    setTransformDraft(
      active.drafts?.transform ??
        active.transform ??
        blankTransform(active.level),
    );
    setPredictionDraft(
      active.drafts?.predictions ??
        active.predictions ??
        paperTaskTargets(active.level, active.targetSet, active.taskVersion).map((point) => ({
          ...point,
          robotX: "",
          robotY: "",
          robotZ: "",
          robotR: "",
        })),
    );
    setPaperCoordinateDrafts(
      active.drafts?.paperCoordinates ??
        active.predictions?.map((point) => ({
          point: point.name,
          xCm: String(point.xCm),
          yCm: String(point.yCm),
        })) ??
        paperTaskTargets(active.level, active.targetSet, active.taskVersion).map(
          (point) => ({
            point: point.name,
            xCm: String(point.xCm),
            yCm: String(point.yCm),
          }),
        ),
    );
    setInkDraft(
      active.drafts?.inkReadings ??
        active.inkReadings?.map((reading) => ({
          point: reading.point,
          xCm: reading.rawX,
          yCm: reading.rawY,
          status: reading.status,
          reason: reading.reason,
        })) ??
        paperTaskTargets(active.level, active.targetSet, active.taskVersion).map((point) => ({
          point: point.name,
          xCm: "",
          yCm: "",
          status: "not-measured" as const,
          reason: "",
        })),
    );
    setHypothesisDraft(
      active.drafts?.studentHypothesis ?? active.studentHypothesis ?? "",
    );
    setRevisionDraft(
      active.drafts?.revisionReason ?? active.revisionReason ?? "",
    );
    setVerificationReasonDraft(
      active.drafts?.verificationReason ??
        active.verificationCriteria?.rationale ??
        "",
    );
    setFollowupObservationDraft(
      active.drafts?.followupObservation ??
        active.followupObservation?.text ??
        "",
    );
    setModelDecision(
      active.drafts?.modelDecision ?? active.modelDecision ?? "revise",
    );
    setModelDecisionReasonDraft(
      active.drafts?.modelDecisionReason ?? active.modelDecisionReason ?? "",
    );
    setLiftDraft(active.liftHeight ? String(active.liftHeight.z) : "");
    setManualInputs(
      manualInputsFromSamples(
        active.referenceSamples ?? active.frame?.samples ?? [],
      ),
    );
    setBaselineLengthToleranceDraft(String(baselineLengthToleranceFor(active)));
    setLiftRecordFeedback("");
  }, [active?.id]);

  useEffect(() => {
    activeRunRef.current = running;
    onRunningChange?.(running);
  }, [running, onRunningChange]);
  useEffect(
    () => () => {
      const currentPractice = practiceRef.current;
      currentPractice.cancelConfirmation();
      if (activeRunRef.current && currentPractice.snap.source)
        currentPractice.session.stop();
    },
    [],
  );

  const currentTransform = (
    field: keyof PaperStudentTransform,
    value: string,
  ) => {
    if (running) return;
    setTransformDraft((previous) => ({ ...previous, [field]: value }));
    setTransformFeedback("");
    setDiagnosisOverride(null);
  };

  const saveReference = (sample: PaperReferenceSample) => {
    let current =
      active ??
      createTrial({
        targetSet: currentTargetSet,
        level,
        parentAttemptId: null,
      });
    if (current.run) {
      setPageError(
        "새 기준점은 기존 실행 기록을 덮어쓰지 않습니다. 수정 이유를 저장한 뒤 새 시도를 시작하세요.",
      );
      return;
    }
    const nextSamples = [...(current.referenceSamples ?? []), sample];
    const uniqueSamples = [
      ...nextSamples.filter((item) => item.point !== sample.point),
      sample,
    ].sort(
      (a, b) =>
        ["O", "X", "Y"].indexOf(a.point) - ["O", "X", "Y"].indexOf(b.point),
    );
    const baselineLengthToleranceMm = baselineLengthToleranceFor(current);
    const validation =
      uniqueSamples.length === 3
        ? validatePaperFrame(
            uniqueSamples,
            Date.now(),
            baselineLengthToleranceMm,
          )
        : null;
    const tilted =
      validation?.ok &&
      isMergedPaper(level) &&
      current.taskVersion !== PAPER_TASK_VERSION &&
      !rotationAllowed &&
      Math.abs(getPaperFrameAngleDegrees(validation.frame)) > 2;
    const validFrame = validation?.ok && !tilted ? validation.frame : undefined;
    setReferenceError(
      tilted
        ? "기본 과제는 종이 x축과 로봇 X+축을 나란히 정렬하세요. 회전은 교사 설정에서 별도로 허용할 수 있습니다."
        : validation && !validation.ok
          ? validation.reason
          : "",
    );
    const updated = upsert({
      ...current,
      referenceSamples: uniqueSamples,
      baselineLengthTolerance: current.baselineLengthTolerance ?? {
        toleranceMm: PAPER_BASELINE_LENGTH_TOLERANCE_DEFAULT_MM,
        appliedAt: Date.now(),
        scope: "xy-baseline-length-only",
      },
      ...(validFrame ? { frame: validFrame } : { frame: undefined }),
      dataSource: uniqueSamples[0]?.source ?? "teacher",
      status: validFrame ? "model" : "references",
      stage: validFrame ? 2 : 1,
      transform: undefined,
      predictions: undefined,
      planHash: undefined,
      run: undefined,
      diagnosis: undefined,
      dtRunPlanHash: undefined,
    });
    setManualInputs(manualInputsFromSamples(uniqueSamples));
    setStage((validFrame ? 2 : 1) as PaperLessonStage);
    if (validFrame) {
      setTransformDraft(blankTransform(level));
      setPredictionDraft(
        paperTaskTargets(updated.level, updated.targetSet).map((point) => ({
          ...point,
          robotX: "",
          robotY: "",
          robotZ: "",
          robotR: "",
        })),
      );
      setTransformFeedback(
        "기준점이 규칙 검사를 통과했습니다. 정답 변환식이나 로봇 목표 좌표는 채우지 않았습니다.",
      );
    }
  };

  const saveCurrentPlan = (
    advance: boolean,
  ): {
    message: string;
    target?: "references" | "transform" | "predictions" | "run";
  } | null => {
    if (running)
      return { message: "실행 중에는 계획을 바꿀 수 없습니다.", target: "run" };
    if (!active?.frame) {
      setPageError("교사용 수업 준비에서 O/X/Y 기준점을 먼저 확인·저장하세요.");
      return {
        message: "교사용 수업 준비에서 기준점 O/X/Y를 확인해야 합니다.",
        target: "references",
      };
    }
    if (active.taskVersion !== PAPER_TASK_VERSION) {
      const message =
        "이전 20×20 cm 과제 기록은 보존되어 읽기 전용입니다. ‘새 시도’에서 10×10 cm 종이 계획을 시작하세요.";
      setPageError(message);
      return { message, target: "run" };
    }
    const autoMap = isMergedPaper(active.level);
    const values = transformDraft;
    if (!autoMap && !transformComplete) {
      setPageError("원점·축 방향·단위 배율·회전과 선택 이유를 확인하세요.");
      return {
        message: "원점, 축 방향, 단위 배율, 회전과 선택 이유를 입력하세요.",
        target: "transform",
      };
    }
    if (!autoMap && !paperConceptValid(active.pathConcept)) {
      setPageError("직선 경로 명령과 닫힌 경로의 ΔX·ΔY 합을 확인하세요.");
      return {
        message: "직선 경로 명령과 닫힌 경로의 ΔX·ΔY 합을 확인하세요.",
        target: "predictions",
      };
    }
    let valuesForPlan: PaperPredictionPoint[];
    if (autoMap) {
      const mapped = mapPaperCoordinatesToRobotTargets(
        active.frame,
        paperCoordinateDrafts,
      );
      if (
        !mapped ||
        mapped.length !== targetPoints.length ||
        mapped.some((point, index) => point.name !== targetPoints[index]?.name)
      ) {
        const message =
          "P1~P4 종이 좌표를 각각 0~10 cm로 입력하고 같은 위치가 없는지 확인하세요.";
        setPageError(message);
        return { message, target: "predictions" };
      }
      valuesForPlan = mapped;
    } else {
      valuesForPlan = draftTargets.map((point) => ({
        ...point,
        robotZ: "",
        robotR: "",
      }));
      if (
        valuesForPlan.length !== targetPoints.length ||
        valuesForPlan.some(
          (point) =>
            ![point.robotX, point.robotY].every(
              (value) => value.trim() && Number.isFinite(Number(value)),
            ),
        )
      ) {
        setPageError("모든 목표점의 X·Y 예측을 입력하세요.");
        return {
          message:
            "모든 목표점의 X·Y 예측을 입력하세요. 학생 답은 자동으로 채우지 않습니다.",
          target: "predictions",
        };
      }
    }
    if (active.run) {
      setPageError(
        "이전 실행은 보존됩니다. 새 수정을 하려면 현재 시도에서 수정 이유를 저장해 다음 시도를 만드세요.",
      );
      return {
        message: "기존 실행을 덮어쓰지 않습니다. 이 시도는 읽기 전용입니다.",
        target: "run",
      };
    }
    const savedTransform = transformComplete ? values : undefined;
    const hash = paperPlanHashFor(
      active.frame.id,
      active.targetSet,
      savedTransform,
      valuesForPlan,
      liftHeight,
      baselineLengthToleranceFor(active),
      active.taskVersion,
    );
    const modelComparison = comparePaperPredictionToFrame(
      active.frame,
      valuesForPlan,
    );
    let retryCriteria: PaperVerificationCriteria | undefined;
    if (!advance && active.targetSet === "revalidation") {
      const parent = recordsRef.current.find(
        (record) => record.id === active.parentAttemptId,
      );
      const prior = parent?.verificationCriteria;
      if (
        prior &&
        prior.frameId === active.frame.id &&
        prior.rationale.trim()
      ) {
        retryCriteria = {
          ...prior,
          recordId: active.id,
          inheritedFromAttemptId: parent!.id,
          frameId: active.frame.id,
          planHash: hash,
          targetSet: active.targetSet,
          modelConstructionPoints: ["O", "X", "Y"],
          ...classifyPaperVerificationPoints(valuesForPlan),
          confirmedAt: Date.now(),
        };
      }
    }
    upsert(
      {
        ...active,
        transform: savedTransform,
        predictions: valuesForPlan,
        planHash: hash,
        predictionModelComparison: modelComparison,
        status: "prediction",
        stage: advance ? 4 : 7,
        run: undefined,
        diagnosis: undefined,
        verificationCriteria: retryCriteria,
        dtRunPlanHash: undefined,
        drafts: {
          ...active.drafts,
          transform: undefined,
          predictions: undefined,
          paperCoordinates: undefined,
        },
      },
      autoMap
        ? "O/X/Y 실측 기준으로 P1~P4 좌표와 로봇 목표를 저장했습니다."
        : "관계와 좌표 예측을 한 번에 저장했습니다.",
    );
    if (!lastSaveSucceededRef.current) {
      const message =
        "예측 저장에 실패해 다음 화면으로 이동하지 않았습니다. 입력은 유지했습니다. 저장 상태를 확인하고 다시 시도하세요.";
      setPageError(message);
      return { message, target: "predictions" };
    }
    if (savedTransform) setTransformDraft(savedTransform);
    setPredictionDraft(valuesForPlan);
    setPaperCoordinateDrafts(
      valuesForPlan.map((point) => ({
        point: point.name,
        xCm: String(point.xCm),
        yCm: String(point.yCm),
      })),
    );
    setPageError("");
    setTransformFeedback(
      autoMap
        ? "저장됨 · O/X/Y 제어기 위치로 종이 좌표를 로봇 목표로 변환했습니다."
        : "저장됨 · 이 예측이 이번 실행의 기준입니다.",
    );
    setPredictionFeedback("저장됨 · 실행 전 예측을 고정했습니다.");
    if (advance) setStage(4);
    return null;
  };

  const diagnoseCompletedRecord = (
    record: PaperTrialRecord,
    priorRecords: PaperTrialRecord[],
  ) => {
    const run = record.run,
      frame = record.frame,
      planHash = record.planHash;
    if (!run || run.status !== "completed" || !frame || !planHash)
      return { record, diagnosis: record.diagnosis ?? null, message: "" };
    const invalid = validatePaperRunForDiagnosis(
      run,
      frame,
      planHash,
      targetPoints,
    );
    if (invalid) {
      const diagnosis: PaperDiagnosis = {
        method: "rule-based",
        source: run.source,
        status: "invalidated",
        candidate: invalid,
        evidence: [],
        predictionEvidence: [],
        firstMismatch: null,
        question: "어떤 새 관측이 있어야 이 결과를 비교할 수 있을까요?",
        why: "현재 기준점과 저장된 예측에 연결된 관측만 사용합니다.",
        tutorSource: "default question",
      };
      return {
        record: {
          ...record,
          diagnosis,
          status: "incomplete" as const,
          stage:
            isMergedPaper(record.level) && record.targetSet === "revalidation"
              ? (7 as const)
              : (6 as const),
        },
        diagnosis,
        message: invalid,
      };
    }
    const toleranceMm =
      run.verificationCriteria?.positionToleranceMm ??
      record.diagnosisToleranceMm ??
      practice.setupDraft.positionTolerance;
    const initial = diagnosePaperRun(run, frame, planHash, {
      transform: record.transform,
      toleranceMm,
      targets: targetPoints,
      detectOriginMissing: isMergedPaper(record.level),
      support: attemptSupport,
    });
    const repeated = priorRecords.filter(
      (item) =>
        item.id !== record.id &&
        (!isPaperRectangle(record.level) ||
          (item.level === record.level &&
            item.taskVersion === record.taskVersion)) &&
        item.diagnosis?.pattern === initial.pattern,
    ).length;
    const diagnosis = diagnosePaperRun(run, frame, planHash, {
      transform: record.transform,
      toleranceMm,
      repeated,
      targets: targetPoints,
      detectOriginMissing: isMergedPaper(record.level),
      support: attemptSupport,
    });
    let diagnosed: PaperTrialRecord = {
      ...record,
      diagnosis,
      status: "diagnosed",
      stage:
        isMergedPaper(record.level) && record.targetSet === "revalidation"
          ? 7
          : 6,
      diagnosisToleranceMm: toleranceMm,
    };
    const parent = priorRecords.find(
      (item) => item.id === record.parentAttemptId,
    );
    const inkRows = paperInkComparisons(diagnosed, targetPoints);
    const inkWithinTolerance =
      inkRows.length === targetPoints.length &&
      inkRows.every(
        (row) =>
          row.inkReading?.status === "measured" &&
          row.inkReading.recordId === record.id &&
          row.inkReading.runId === run.id &&
          row.targetVsInkMm?.distance !== null &&
          row.targetVsInkMm?.distance !== undefined &&
          row.targetVsInkMm.distance <=
            (run.verificationCriteria?.positionToleranceMm ?? 0),
      );
    const independentRevalidation =
      !!parent &&
      (record.targetSet === "revalidation" ||
        (!isPaperRectangle(record.level) &&
          record.frame?.id !== parent.frame?.id));
    const assessment = independentRevalidation
      ? paperRevalidationAssessment(
          diagnosed,
          parent,
          targetPoints,
          inkWithinTolerance,
        )
      : null;
    if (assessment)
      diagnosed = {
        ...diagnosed,
        status:
          assessment.result === "physical-verified"
            ? "revalidated"
            : "diagnosed",
        revalidation: assessment,
      };
    return {
      record: diagnosed,
      diagnosis,
      message: assessment?.scope ?? "실행 자료 비교를 저장했습니다.",
    };
  };

  const prepareAiAnalysis = () => {
    let record = active?.id
      ? recordsRef.current.find((item) => item.id === active.id)
      : undefined;
    if (
      !record ||
      !record.run ||
      !paperAnalysisReady(
        record,
        record.planHash ?? "",
        record.diagnosis ?? null,
        targetPoints,
      )
    ) {
      const message =
        "현재 시도의 완료된 DT 실행·저장된 비교 근거를 확인하지 못했습니다. 분석 요청은 보내지 않았습니다.";
      setPageError(message);
      return { ok: false as const, message };
    }
    const analysisRunId = record.run.id;
    if (pendingInkDraftRef.current) {
      if (!persistPendingInkDraft(record, inkDraft)) {
        const message =
          "잉크 입력 자동 저장에 실패해 분석을 보내지 않았습니다. 화면의 최신 입력을 유지했습니다. 저장 공간을 확인한 뒤 다시 누르세요.";
        setPageError(message);
        return { ok: false as const, message, target: "ink" as const };
      }
      record =
        recordsRef.current.find((item) => item.id === record!.id) ?? record;
    }
    const prepared = preparePaperInkReadings(
      record,
      inkDraft,
      targetPoints,
      isMergedPaper(level) ? 20 : 10,
      Date.now(),
    );
    if (!prepared.ok) {
      setPageError(prepared.message);
      return {
        ok: false as const,
        message: prepared.message,
        target: "ink" as const,
      };
    }
    if (prepared.changed) {
      upsert(
        {
          ...record,
          inkReadings: prepared.readings.length ? prepared.readings : undefined,
          drafts: { ...record.drafts, inkReadings: undefined },
        },
        "잉크 입력을 현재 실행·점·기준에 연결해 저장했습니다.",
      );
      if (!lastSaveSucceededRef.current) {
        pendingInkDraftRef.current = {
          recordId: record.id,
          snapshot: JSON.stringify(inkDraft),
        };
        const message =
          "잉크 관측 저장에 실패해 AI 분석을 보내지 않았습니다. 입력은 유지했습니다. 저장 공간을 확인하고 다시 시도하세요.";
        setPageError(message);
        return { ok: false as const, message, target: "ink" as const };
      }
    }
    const saved = recordsRef.current.find((item) => item.id === record.id);
    if (
      !saved ||
      saved.run?.id !== analysisRunId ||
      saved.run.status !== "completed"
    ) {
      const message =
        "저장본에서 현재 실행을 다시 확인하지 못해 분석 요청을 보내지 않았습니다.";
      setPageError(message);
      return { ok: false as const, message, target: "ink" as const };
    }
    setPageError("");
    return {
      ok: true as const,
      context: paperFeedbackContext(saved, recordsRef.current, targetPoints),
    };
  };

  async function runPreparationTcpJog(axis: "x" | "y" | "z", deltaMm: number) {
    const fail = (message: string) => {
      setTcpJogStatus("failed");
      setTcpJogMessage(message);
    };
    if (tcpJogInFlightRef.current || practice.hasPendingOperation()) {
      fail(
        "다른 장비 확인 또는 실행이 진행 중입니다. 완료되거나 취소된 뒤 다시 시도하세요.",
      );
      return;
    }
    if (level !== "advanced-paper-hardware") {
      fail("TCP 준비 이동은 종이 좌표 심화2에서만 사용할 수 있습니다.");
      return;
    }
    if (hardwareConnected) {
      fail(
        "기존 연결 경로가 사용 중입니다. 연결·User/Tool 설정의 같은 MG400 세션을 사용하세요.",
      );
      return;
    }
    if (running) {
      fail("도형 실행 중에는 TCP 준비 이동을 시작할 수 없습니다.");
      return;
    }
    if (
      !Number.isFinite(deltaMm) ||
      Math.abs(deltaMm) < 0.01 ||
      Math.abs(deltaMm) > 5
    ) {
      fail("미세 이동은 한 번에 0.01~5 mm 범위에서만 요청할 수 있습니다.");
      return;
    }
    const live = practice.session.getSnapshot();
    const ready = practice.session.readiness(true);
    if (ready) {
      fail(ready);
      return;
    }
    if (
      !live.setup ||
      !live.measurement ||
      !measurementFresh(live.measurement)
    ) {
      fail("현재 연결의 최신 TCP 보고와 적용된 준비 설정이 필요합니다.");
      return;
    }
    if (live.measurement.moving || live.busy) {
      fail(
        "현재 장비가 움직이거나 다른 명령을 처리 중입니다. 정지 확인 후 다시 시도하세요.",
      );
      return;
    }
    let bridgeMatches = false;
    try {
      bridgeMatches =
        new URL(practice.bridgeUrl).href === practice.session.getBridgeUrl();
    } catch {
      bridgeMatches = false;
    }
    if (
      !bridgeMatches ||
      installationKey(practice.setupDraft) !== installationKey(live.setup) ||
      setupProblem({ ...practice.setupDraft, speed: live.setup.speed })
    ) {
      fail(
        "연결 대상 또는 설치 설정이 변경되었습니다. 설정을 다시 확인·적용하세요.",
      );
      return;
    }
    const target = {
      x: axis === "x" ? deltaMm : 0,
      y: axis === "y" ? deltaMm : 0,
      z: axis === "z" ? deltaMm : 0,
      r: 0,
    };
    const proposed = {
      ...live.measurement.pose,
      x: live.measurement.pose.x + target.x,
      y: live.measurement.pose.y + target.y,
      z: live.measurement.pose.z + target.z,
    };
    const boundsError = targetProblem(
      proposed,
      live.setup,
      "2-4 TCP 준비 미세 이동",
    );
    if (boundsError) {
      fail(boundsError);
      return;
    }

    tcpJogInFlightRef.current = true;
    setTcpJogStatus("confirming");
    setTcpJogMessage(
      "사용자 확인을 기다립니다. 확인 전에는 이동 명령을 보내지 않습니다.",
    );
    try {
      const result = await practice.runOps(
        [
          {
            kind: "move",
            motion: "MoveL",
            target,
            relative: true,
          },
        ],
        `2-4 TCP 준비 미세 이동 · ${axis.toUpperCase()} ${deltaMm > 0 ? "+" : ""}${deltaMm} mm`,
        undefined,
        () => {
          setTcpJogStatus("moving");
          setTcpJogMessage(
            "확인된 속도로 한 번의 상대 MoveL을 처리하고 새 TCP 보고를 기다립니다.",
          );
        },
      );
      const measured = result?.at(-1);
      if (!measured) {
        setTcpJogStatus("cancelled");
        setTcpJogMessage("확인이 취소되어 이동 명령을 보내지 않았습니다.");
        return;
      }
      setTcpJogStatus("completed");
      setTcpJogMessage(
        `${measured.source === "mock" ? "모의 응답 · 실측 아님" : "실제 제어기 새 보고"} · seq ${measured.seq} · TCP (${measured.pose.x.toFixed(2)}, ${measured.pose.y.toFixed(2)}, ${measured.pose.z.toFixed(2)}, ${measured.pose.r.toFixed(2)})`,
      );
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    } finally {
      tcpJogInFlightRef.current = false;
    }
  }

  const actions: PaperCoordinateStudyViewActions = {
    onBack,
    onAllowMismatchedHardware: (value) => {
      if (!running && level === "advanced-paper-hardware")
        setAllowMismatchedHardware(value);
    },
    onOpenConnection: () => practice.setPanelOpen(true),
    onFocusReferencePreparation: () => {
      setStage(1);
      window.setTimeout(() => {
        const element = document.getElementById(
          "paper-coordinate-reference-preparation",
        );
        if (element instanceof HTMLDetailsElement) element.open = true;
        element?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    },
    onFocusTcpJog: () => {
      setStage(1);
      window.setTimeout(() => {
        document
          .getElementById("paper-coordinate-tcp-jog")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 0);
    },
    onFocusRevision: () => {
      setStage(7);
      window.setTimeout(() => {
        document
          .getElementById("paper-coordinate-stage-7")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    },
    onPersistDrafts: (drafts) => {
      if (!active || active.run?.status === "running") return;
      upsert(
        { ...active, drafts: { ...active.drafts, ...drafts } },
        "작성 중인 입력을 자동 저장했습니다.",
      );
    },
    onRetrySave: () => {
      const current = active?.id
        ? recordsRef.current.find((item) => item.id === active.id)
        : undefined;
      if (
        current &&
        pendingInkDraftRef.current &&
        !persistPendingInkDraft(current, inkDraft)
      ) {
        setPageError(
          "잉크 입력 저장에 실패했습니다. 현재 화면의 입력은 유지되어 있으며 다시 시도하세요.",
        );
        return;
      }
      saveAll(recordsRef.current, "저장됨 · 현재 학습 입력을 보존했습니다.");
      if (lastSaveSucceededRef.current) setPageError("");
    },
    onSavePlanAndContinue: () => saveCurrentPlan(true),
    onSaveRetryPlan: () => saveCurrentPlan(false),
    onContinueToRevision: (hypothesis, diagnosis, inkRows) => {
      let current = active?.id
        ? recordsRef.current.find((item) => item.id === active.id)
        : undefined;
      if (!current?.run || current.run.status !== "completed") {
        setPageError("먼저 현재 예측의 DT 또는 허용된 실행을 완료하세요.");
        return { message: "완료된 실행 결과가 필요합니다.", target: "run" };
      }
      const currentAttemptId = current.id;
      const currentRunId = current.run.id;
      const currentDiagnosis = diagnosis ?? current.diagnosis ?? null;
      if (!currentDiagnosis || currentDiagnosis.status !== "complete") {
        setPageError("현재 실행의 비교 자료가 아직 완성되지 않았습니다.");
        return {
          message: "현재 실행의 비교 자료를 먼저 확인하세요.",
          target: "run",
        };
      }
      const shown = (current.aiAnalyses ?? []).some(
        (item) =>
          item.recordId === currentAttemptId &&
          item.runId === currentRunId &&
          item.planHash === current.run!.planHash &&
          item.source === current.run!.source &&
          !!item.displayedAt,
      );
      if (!shown) {
        setPageError(
          "현재 실행 자료에 대한 분석 응답을 먼저 화면에 표시하세요.",
        );
        return {
          message:
            "화면 2에서 ‘실행자료 분석’을 직접 요청하고 응답을 확인해야 합니다.",
          target: "analysis",
        };
      }
      if (!hypothesis.trim()) {
        setPageError("관측 근거를 보고 학생의 설명 후보를 적어 주세요.");
        return {
          message:
            "학생의 원인 후보를 적어야 다음 화면으로 이동할 수 있습니다.",
          target: "hypothesis",
        };
      }
      if (
        pendingInkDraftRef.current &&
        !persistPendingInkDraft(current, inkRows)
      ) {
        const message =
          "잉크 입력 자동 저장에 실패해 단계 이동을 막았습니다. 화면의 최신 입력을 유지했습니다. 저장 공간을 확인한 뒤 다시 누르세요.";
        setPageError(message);
        return { message, target: "ink" };
      }
      const persistedCurrent =
        recordsRef.current.find((item) => item.id === currentAttemptId) ??
        current;
      const prepared = preparePaperInkReadings(
        persistedCurrent,
        inkRows,
        targetPoints,
        isMergedPaper(level) ? 20 : 10,
        Date.now(),
      );
      if (!prepared.ok) {
        setPageError(prepared.message);
        return { message: prepared.message, target: "ink" };
      }
      upsert(
        {
          ...persistedCurrent,
          diagnosis: currentDiagnosis,
          studentHypothesis: hypothesis.trim(),
          status: "reasoned",
          stage: 7,
          inkReadings: prepared.readings.length ? prepared.readings : undefined,
          drafts: {
            ...persistedCurrent.drafts,
            studentHypothesis: undefined,
            inkReadings: undefined,
          },
        },
        "비교 근거와 학생 가설을 저장했습니다. 입력한 잉크 자료는 현재 실행·점·출처에 연결했습니다.",
      );
      if (!lastSaveSucceededRef.current) {
        pendingInkDraftRef.current = {
          recordId: currentAttemptId,
          snapshot: JSON.stringify(inkRows),
        };
        const message =
          "비교 근거 저장에 실패해 다음 화면으로 이동하지 않았습니다. 입력은 유지했습니다. 저장 상태를 확인하고 다시 시도하세요.";
        setPageError(message);
        return { message, target: "ink" };
      }
      setHypothesisDraft(hypothesis.trim());
      setPageError("");
      setStage(7);
      return null;
    },
    onFinalizeRevalidation: (decision, reason) => {
      let latest = active?.id
        ? recordsRef.current.find((item) => item.id === active.id)
        : undefined;
      if (
        !latest ||
        latest.targetSet !== "revalidation" ||
        latest.run?.status !== "completed" ||
        !latest.run.verificationCriteria
      ) {
        setPageError("완료된 새 실행과 그 실행 전에 저장한 기준이 필요합니다.");
        return {
          message:
            "실행 완료와 실행 전 기준이 확인되지 않아 최종 판정을 저장하지 않았습니다.",
        };
      }
      if (latest.diagnosis?.status !== "complete") {
        const message =
          "현재 실행에 연결된 유효한 비교 해석 자료가 없어 최종 판정을 저장하지 않았습니다.";
        setPageError(message);
        return { message };
      }
      const latestAttemptId = latest.id;
      const latestRunId = latest.run.id;
      if (!reason.trim()) {
        const message = "최종 판단 근거를 입력해야 저장할 수 있습니다.";
        setPageError(message);
        return { message };
      }
      if (
        pendingInkDraftRef.current &&
        !persistPendingInkDraft(latest, inkDraft)
      ) {
        const message =
          "잉크 입력 자동 저장에 실패해 최종 판정을 막았습니다. 화면의 최신 입력을 유지했습니다. 저장 공간을 확인한 뒤 다시 누르세요.";
        setPageError(message);
        return { message };
      }
      const persistedLatest =
        recordsRef.current.find((item) => item.id === latestAttemptId) ??
        latest;
      const prepared = preparePaperInkReadings(
        persistedLatest,
        inkDraft,
        targetPoints,
        isMergedPaper(level) ? 20 : 10,
        Date.now(),
      );
      if (!prepared.ok) {
        setPageError(prepared.message);
        return { message: prepared.message };
      }
      if (prepared.changed) {
        upsert(
          {
            ...persistedLatest,
            inkReadings: prepared.readings.length
              ? prepared.readings
              : undefined,
            drafts: { ...persistedLatest.drafts, inkReadings: undefined },
          },
          "재검증 잉크 입력을 현재 실행에 먼저 저장했습니다.",
        );
        if (!lastSaveSucceededRef.current) {
          pendingInkDraftRef.current = {
            recordId: latestAttemptId,
            snapshot: JSON.stringify(inkDraft),
          };
          const message =
            "잉크 관측 저장에 실패해 최종 판정을 기록하지 않았습니다. 입력은 유지했습니다. 저장 상태를 확인하고 다시 시도하세요.";
          setPageError(message);
          return { message };
        }
      }
      const saved = recordsRef.current.find(
        (record) => record.id === latestAttemptId,
      );
      if (
        !saved ||
        saved.run?.id !== latestRunId ||
        saved.run.status !== "completed"
      ) {
        const message =
          "현재 실행의 저장본을 확인하지 못해 최종 판정을 기록하지 않았습니다.";
        setPageError(message);
        return { message };
      }
      const parent = recordsRef.current.find(
        (record) => record.id === saved.parentAttemptId,
      );
      const rows = paperInkComparisons(saved, targetPoints);
      const inkWithin =
        rows.length === targetPoints.length &&
        rows.every(
          (row) =>
            row.inkReading?.status === "measured" &&
            row.inkReading.recordId === saved.id &&
            row.inkReading.runId === saved.run!.id &&
            row.targetVsInkMm?.distance != null &&
            row.targetVsInkMm.distance <=
              saved.run!.verificationCriteria!.positionToleranceMm,
        );
      const assessment = paperRevalidationAssessment(
        saved,
        parent,
        targetPoints,
        inkWithin,
      );
      if (!assessment) {
        setPageError(
          "독립 검증점과 이전 시도 연결을 확인할 수 없습니다. 이 결과를 완료로 표시하지 않았습니다.",
        );
        return {
          message:
            "시도 연결 또는 독립 검증 조건이 부족해 판정을 저장하지 않았습니다.",
        };
      }
      upsert(
        {
          ...saved,
          modelDecision: decision,
          modelDecisionReason: reason.trim(),
          revalidation: assessment,
          status:
            assessment.result === "physical-verified"
              ? "revalidated"
              : "diagnosed",
          drafts: {
            ...saved.drafts,
            modelDecision: undefined,
            modelDecisionReason: undefined,
          },
        },
        assessment.result === "physical-verified"
          ? "독립 실장비 재검증 판정을 저장했습니다."
          : "판정을 저장했습니다. DT·모의 자료는 실물 검증 완료가 아닙니다.",
      );
      if (!lastSaveSucceededRef.current) {
        const message =
          "최종 판정 저장에 실패했습니다. 입력과 미완료 상태를 유지했습니다. 저장 상태를 확인하고 다시 시도하세요.";
        setPageError(message);
        return { message };
      }
      setPageError("");
      return null;
    },
    onResetRetry: () => {
      if (!active || !isMergedPaper(level) || active.run || running) return;
      setResetRetryId(active.id);
      upsert({
        ...active,
        transform: undefined,
        predictions: undefined,
        pathConcept: undefined,
        planHash: undefined,
        dtRunPlanHash: undefined,
        diagnosis: undefined,
        status: "model",
        stage: 2,
      });
      setTransformDraft(blankTransform(level));
      setPredictionDraft(
        targetPoints.map((p) => ({
          ...p,
          robotX: "",
          robotY: "",
          robotZ: "",
          robotR: "",
        })),
      );
      setStage(2);
      setPageError(
        "이번 시도의 입력만 비웠습니다. 이전 시도의 예측과 실행 기록은 보존됩니다.",
      );
    },
    onPathConceptChange: (field, value) => {
      if (active && !active.run)
        upsert({
          ...active,
          pathConcept: {
            motion: "",
            closeX: "",
            closeY: "",
            ...active.pathConcept,
            [field]: value,
          },
        });
    },
    onExport: () =>
      downloadEvidence("paper-coordinate-evidence.json", {
        version: 2,
        scope:
          "실행별 TCP 보고 좌표·학생 잉크 측정·사전 기준을 분리한 학습 기록",
        records,
      }),
    onStageChange: (nextStage) => {
      if (running) {
        const message =
          "실행이 끝나거나 중단될 때까지 단계 이동이 잠겨 있습니다.";
        setPageError(message);
        return { message, target: "run" };
      }
      let currentActive = active?.id
        ? (recordsRef.current.find((item) => item.id === active.id) ?? active)
        : active;
      if (pendingInkDraftRef.current) {
        if (
          !currentActive ||
          pendingInkDraftRef.current.recordId !== currentActive.id ||
          !persistPendingInkDraft(currentActive, inkDraft)
        ) {
          const message =
            "잉크 입력 자동 저장에 실패해 단계 이동을 막았습니다. 현재 입력을 유지했습니다. 저장 공간을 확인한 뒤 다시 시도하세요.";
          setPageError(message);
          return { message, target: "ink" };
        }
        currentActive =
          recordsRef.current.find((item) => item.id === currentActive!.id) ??
          currentActive;
      }
      const movingBackward =
        !!currentActive && nextStage < (currentActive.stage ?? 1);
      const stageNavigationBlocker = movingBackward
        ? null
        : paperStageNavigationRequirement(
            nextStage,
            (diagnosisOverride ?? currentActive?.diagnosis)?.status ===
              "complete",
            !!currentActive?.studentHypothesis?.trim(),
          );
      const required = movingBackward
        ? ""
        : nextStage >= 2 && !currentActive?.frame
          ? "O/X/Y 기준점을 먼저 저장하세요."
          : nextStage >= 3 && !currentActive?.transform
            ? "변환 관계를 먼저 저장하세요."
            : nextStage >= 4 && !currentActive?.predictions?.length
              ? "좌표 예측을 먼저 저장하세요."
              : nextStage >= 5 && currentActive?.run?.status !== "completed"
                ? "현재 예측의 실행을 먼저 완료하세요."
                : nextStage >= 6 &&
                    (!currentActive?.run?.verificationCriteria ||
                      currentActive.run.verificationCriteria.recordId !==
                        currentActive.id ||
                      currentActive.run.verificationCriteria.frameId !==
                        currentActive.frame?.id ||
                      currentActive.run.verificationCriteria.planHash !==
                        currentActive.run.planHash)
                  ? "실행 전 확인한 기준이 없는 실행은 검증 완료로 판정할 수 없습니다."
                  : (stageNavigationBlocker?.message ?? "");
      if (required) {
        setPageError(required);
        const target =
          nextStage >= 2 && !currentActive?.frame
            ? "references"
            : nextStage >= 3 && !currentActive?.transform
              ? "transform"
              : nextStage >= 4 && !currentActive?.predictions?.length
                ? "predictions"
                : nextStage >= 5 && currentActive?.run?.status !== "completed"
                  ? "run"
                  : (stageNavigationBlocker?.target ?? "criteria");
        return { message: required, target };
      }
      setPageError("");
      setStage(nextStage);
      if (currentActive) upsert({ ...currentActive, stage: nextStage });
      if (
        nextStage === 6 &&
        currentActive?.run &&
        currentActive.frame &&
        currentActive.planHash
      ) {
        const analyzed = diagnoseCompletedRecord(
          currentActive,
          recordsRef.current,
        );
        setDiagnosisOverride(analyzed.diagnosis);
        upsert(analyzed.record, analyzed.message);
      }
      return {
        message: `${nextStage}단계로 이동했습니다.`,
      };
    },
    onLevelChange: (nextLevel) => {
      if (running || initialLevel) return;
      if (active?.run) {
        setPageError(
          "실행이 있는 시도는 그대로 보존합니다. 수준 변경은 다음 시도에서 선택하세요.",
        );
        return;
      }
      setLevel(nextLevel);
      if (active) upsert({ ...active, level: nextLevel });
    },
    onRecordCurrentReference: (point) => {
      if (running) return;
      const live = practice.session.getSnapshot();
      const latest = live.measurement;
      if (practice.hasPendingOperation() || live.busy || latest?.moving) {
        setReferenceError(
          "장비 조작 중에는 기준점을 기록할 수 없습니다. 정지와 최신 위치 보고를 확인하세요.",
        );
        return;
      }
      if (
        live.connection !== "connected" ||
        !latest ||
        !latest.pose ||
        !measurementFresh(latest)
      ) {
        setReferenceError(
          "현재 연결의 최신 TCP 보고가 없습니다. 아래 TCP 미세 이동으로 맞춘 뒤, 새 위치 보고를 기다리세요.",
        );
        return;
      }
      if (!coordinatesVerified) {
        setReferenceError(
          "좌표계·공구 준비 확인이 끝나지 않았습니다. 기존 연결·준비 확인을 먼저 완료하세요.",
        );
        return;
      }
      if (!live.connectionToken || latest.source !== live.source) {
        setReferenceError(
          "현재 연결 세션의 출처가 확인되지 않아 O/X/Y를 기록하지 않았습니다. 연결을 다시 확인하세요.",
        );
        return;
      }
      const sample: PaperReferenceSample = {
        point,
        pose: { ...latest.pose },
        source: latest.source,
        connectionToken: live.connectionToken,
        seq: latest.seq,
        capturedAt: latest.receivedAt,
        ageMsAtCapture: Math.max(
          0,
          Date.now() - latest.receivedAt + latest.ageMs,
        ),
        user: latest.user,
        tool: latest.tool,
        coordinateSystem: `User ${latest.user} / Tool ${latest.tool}`,
        verifiedCoordinates: coordinatesVerified,
      };
      saveReference(sample);
    },
    onManualReferenceChange: (point, field, value) =>
      setManualInputs((previous) => ({
        ...previous,
        [point]: { ...previous[point], [field]: value },
      })),
    onSaveManualReference: (point) => {
      if (running) return;
      const values = manualInputs[point];
      const pose = {
        x: Number(values.x),
        y: Number(values.y),
        z: Number(values.z),
        r: Number(values.r),
      };
      if (
        !Object.values(values).every((v) => v.trim()) ||
        !Object.values(pose).every(Number.isFinite)
      ) {
        setReferenceError(`${point} 좌표를 모두 입력하세요.`);
        return;
      }
      const sample: PaperReferenceSample = {
        point,
        pose,
        source: "teacher",
        seq: null,
        capturedAt: Date.now(),
        ageMsAtCapture: null,
        user: currentUser,
        tool: currentTool,
        coordinateSystem: `교사 입력 · User ${currentUser} / Tool ${currentTool}`,
        verifiedCoordinates: coordinatesVerified,
      };
      saveReference(sample);
      setReferenceError(
        "교사 입력 좌표입니다. 실측이 아니며 실장비 실행 기준점으로 사용할 수 없습니다.",
      );
    },
    onTransformChange: (field, value) => {
      if (running || active?.run) return;
      const next = { ...transformDraft, [field]: value };
      setTransformDraft(next);
      setTransformFeedback("");
      setDiagnosisOverride(null);
      if (active)
        upsert({ ...active, drafts: { ...active.drafts, transform: next } });
    },
    onSaveTransform: () => {
      if (running)
        return {
          message: "실행 중에는 관계를 바꿀 수 없습니다.",
          target: "transform",
        };
      const values = transformDraft;
      if (
        !frame ||
        !values.axisDirection ||
        !values.explanation.trim() ||
        ![
          values.originX,
          values.originY,
          values.millimetersPerCentimeter,
          values.rotationDegrees,
        ].every((value) => value.trim() && Number.isFinite(Number(value))) ||
        Number(values.millimetersPerCentimeter) <= 0
      ) {
        setTransformFeedback(
          "원점·축·단위 배율·회전과 선택 이유를 입력하세요.",
        );
        return {
          message:
            "원점 X/Y, 축 방향, mm/cm 배율, 회전각과 짧은 선택 이유를 입력하세요.",
          target: "transform",
        };
      }
      if (active?.run) {
        setTransformFeedback(
          "이전 실행은 덮어쓰지 않습니다. 7단계에서 이유를 저장하고 새 시도를 만든 뒤 수정하세요.",
        );
        return {
          message:
            "기존 실행은 바뀌지 않았습니다. 새 시도를 만든 뒤 관계를 수정하세요.",
          target: "transform",
        };
      }
      const testPoints: PaperGridPoint[] = [
        { name: "O", xCm: 0, yCm: 0 },
        { name: "X", xCm: 10, yCm: 0 },
        { name: "Y", xCm: 0, yCm: 10 },
      ];
      const predicted = testPoints.map((point) =>
        studentTransformPoint(values, point),
      );
      const framePoints = testPoints.map((point) =>
        frameTransformPoint(frame, point),
      );
      const errors = predicted.map((pose, index) =>
        pose
          ? Math.hypot(
              pose.x - framePoints[index].x,
              pose.y - framePoints[index].y,
            )
          : Infinity,
      );
      const message = errors.every(
        (error) => error <= PAPER_MEASURE_TOLERANCE_MM,
      )
        ? "규칙 비교에서 입력한 관계가 기준점 좌표와 예비 허용범위 안에 있습니다. 이것은 변환식 설명에 대한 확정 판정이 아닙니다."
        : "입력한 관계와 기준점 좌표 사이에 차이가 있습니다. 원인을 확정하지 않고, 이 관계를 사용한 예측을 직접 작성할 수 있습니다.";
      const updated = upsert({
        ...(active ??
          createTrial({
            targetSet: currentTargetSet,
            level,
            parentAttemptId: null,
            frame,
            referenceSamples: samples,
          })),
        frame,
        referenceSamples: samples,
        transform: values,
        status: "model",
        stage: 2,
        predictions: undefined,
        planHash: undefined,
        run: undefined,
        diagnosis: undefined,
        dtRunPlanHash: undefined,
        predictionModelComparison: errors.map((distance, index) => ({
          point: testPoints[index].name,
          dx: predicted[index]?.x! - framePoints[index].x,
          dy: predicted[index]?.y! - framePoints[index].y,
          distance,
        })),
      });
      if (!lastSaveSucceededRef.current) {
        const message =
          "관계 저장에 실패했습니다. 입력은 유지했습니다. 저장 상태를 확인한 뒤 다시 시도하세요.";
        setTransformFeedback(message);
        return { message, target: "transform" };
      }
      setStage(2);
      if (!retryInputs)
        setPredictionDraft(
          paperTaskTargets(updated.level, updated.targetSet).map((point) => ({
            ...point,
            robotX: "",
            robotY: "",
            robotZ: "",
            robotR: "",
          })),
        );
      setTransformFeedback(message);
      return {
        message:
          "좌표 관계를 저장했습니다. 다음은 목표점 좌표를 한 점씩 예측하세요.",
        target: "predictions",
      };
    },
    onPredictionChange: (point, field, value) => {
      if (running) return;
      setPredictionFeedback("");
      const current = draftTargets.map((item) =>
        item.name === point ? { ...item, [field]: value } : item,
      );
      setPredictionDraft(current);
      if (active && !active.run)
        upsert({
          ...active,
          drafts: { ...active.drafts, predictions: current },
        });
    },
    onPaperCoordinateChange: (point, field, value) => {
      if (running) return;
      setPredictionFeedback("");
      const current = paperCoordinateDrafts.map((item) =>
        item.point === point ? { ...item, [field]: value } : item,
      );
      setPaperCoordinateDrafts(current);
      if (active && !active.run)
        upsert({
          ...active,
          drafts: { ...active.drafts, paperCoordinates: current },
        });
    },
    onSavePrediction: () => {
      if (running) return;
      if (!active?.frame || !active.transform || !predictionsComplete) {
        setPredictionFeedback(
          "먼저 학생의 변환 관계를 저장하고 모든 목표의 X·Y 좌표를 직접 입력하세요.",
        );
        return;
      }
      if (active.run) {
        setPredictionFeedback(
          "이전 실행은 보존됩니다. 원인 가설과 수정 이유를 저장한 뒤 새 시도로 다시 예측하세요.",
        );
        return;
      }
      const values = draftTargets.map((point) => ({
        ...point,
        robotZ: "",
        robotR: "",
      }));
      const hash = paperPlanHashFor(
        active.frame.id,
        active.targetSet,
        active.transform,
        values,
        liftHeight,
        baselineLengthToleranceFor(active),
        active.taskVersion,
      );
      const modelComparison = comparePaperPredictionToFrame(
        active.frame,
        values,
      );
      upsert(
        {
          ...active,
          predictions: values,
          planHash: hash,
          predictionModelComparison: modelComparison,
          status: "prediction",
          stage: 3,
          run: undefined,
          diagnosis: undefined,
          verificationCriteria: undefined,
          dtRunPlanHash:
            active.dtRunPlanHash === hash ? active.dtRunPlanHash : undefined,
        },
        "예측과 실행 전 스냅샷을 저장했습니다.",
      );
      setStage(3);
      const firstMismatch = modelComparison.find(
        (item) => item.distance > PAPER_MEASURE_TOLERANCE_MM,
      );
      setPredictionFeedback(
        firstMismatch
          ? "예측을 저장했습니다. 일부 점에서 학생 입력과 기준점 기반 관계가 다릅니다. 원인을 미리 판단하지 않고 실행·관측 후 비교합니다."
          : "예측을 저장했습니다. 이 저장본이 실행 계획의 기준이며 이후 입력이 바뀌면 새 시도로 다시 확인합니다.",
      );
    },
    onVerificationReasonChange: (value) => {
      setVerificationReasonDraft(value);
      if (active && !active.run)
        upsert({
          ...active,
          drafts: { ...active.drafts, verificationReason: value },
        });
    },
    onSaveVerificationCriteria: () => {
      if (running) return;
      if (
        !active?.frame ||
        !active.planHash ||
        !samePlan ||
        !predictionsComplete
      ) {
        setPageError(
          "검증 기준은 저장된 기준점·모델·예측 뒤에 확인할 수 있습니다.",
        );
        return;
      }
      if (active.run?.status === "running") {
        setPageError("실행이 시작된 뒤에는 기준을 바꿀 수 없습니다.");
        return;
      }
      const position = practice.setupDraft.positionTolerance;
      const rotation = practice.setupDraft.rotationTolerance;
      if (
        !Number.isFinite(position) ||
        position <= 0 ||
        !Number.isFinite(rotation) ||
        rotation <= 0 ||
        !verificationReasonDraft.trim()
      ) {
        setPageError("실행 전 위치·방향 허용오차와 그 근거를 확인해 주세요.");
        return;
      }
      const criteria: PaperVerificationCriteria = {
        recordId: active.id,
        frameId: active.frame.id,
        planHash: active.planHash,
        targetSet: active.targetSet,
        modelConstructionPoints: ["O", "X", "Y"],
        ...classifyPaperVerificationPoints(targetPoints),
        positionToleranceMm: position,
        rotationToleranceDeg: rotation,
        rationale: verificationReasonDraft.trim(),
        confirmedAt: Date.now(),
      };
      upsert(
        { ...active, verificationCriteria: criteria },
        "실행 전 검증점과 허용오차를 이 시도에 고정했습니다.",
      );
      if (!lastSaveSucceededRef.current) {
        setPageError(
          "실행 전 기준 저장에 실패했습니다. DT·실장비 실행을 시작하지 않았습니다. 저장 상태를 확인하고 다시 시도하세요.",
        );
        return;
      }
      setPageError("");
    },
    onRunDT: () => void executeRun("dt"),
    onRunPhysical: () => void executeRun("connected"),
    onPreparationTcpJog: (axis, deltaMm) =>
      void runPreparationTcpJog(axis, deltaMm),
    onStopPreparationMovement: () => {
      const wasMoving =
        practice.snap.busy ||
        !!practice.snap.measurement?.moving ||
        tcpJogStatus === "moving";
      practice.cancelConfirmation();
      practice.session.stop();
      setTcpJogStatus(wasMoving ? "failed" : "cancelled");
      setTcpJogMessage(
        wasMoving
          ? "화면 중단 요청을 보냈습니다. 물리 비상정지가 아니며, 새 위치 보고로 정지 여부를 확인하세요."
          : "확인 대기를 취소했습니다. 이동 명령은 보내지 않았습니다.",
      );
    },
    onRecordCurrentLiftHeight: () => {
      if (running || active?.run?.status === "running") {
        setLiftRecordFeedback(
          "실행 중에는 들기 높이를 기록할 수 없습니다. 실행이 끝난 뒤 다시 시도하세요.",
        );
        return;
      }
      const live = practice.session.getSnapshot();
      const latest = live.measurement;
      if (practice.hasPendingOperation() || live.busy || latest?.moving) {
        setLiftRecordFeedback(
          "장비 조작 중에는 기록할 수 없습니다. 정지 상태와 새 위치 보고를 확인하세요.",
        );
        return;
      }
      if (
        live.connection !== "connected" ||
        !latest ||
        !measurementFresh(latest) ||
        !coordinatesVerified
      ) {
        setLiftRecordFeedback(
          "연결된 최신 위치 보고와 확인된 User/Tool 좌표계가 필요합니다. 연결·준비 화면에서 새 보고를 확인하세요.",
        );
        return;
      }
      if (latest.source === "hardware" && frame?.source !== "hardware") {
        setLiftRecordFeedback(
          "실장비 높이는 실장비 기준점이 있는 프레임에만 연결할 수 있습니다.",
        );
        return;
      }
      if (!live.connectionToken || latest.source !== live.source) {
        setLiftRecordFeedback(
          "현재 연결 세션의 출처가 확인되지 않아 기록하지 않았습니다. 연결·준비 화면에서 연결을 다시 확인하세요.",
        );
        return;
      }
      if (surfaceZ === null || latest.pose.z <= surfaceZ) {
        setLiftRecordFeedback(
          "현재 보고 Z가 종이 표면보다 높지 않습니다. 교사가 웹 TCP 미세 이동으로 위치를 맞추고 새 보고를 확인하세요.",
        );
        return;
      }
      if (!active) {
        setLiftRecordFeedback(
          "O/X/Y 기준점 기록이 필요합니다. 기준점 기록으로 이동하세요.",
        );
        return;
      }
      const liftBase = archiveCompletedPaperRunForLiftEdit(active);
      const priorRunArchived = liftBase !== active;
      const lift = {
        z: latest.pose.z,
        source: latest.source,
        connectionToken: live.connectionToken,
        seq: latest.seq,
        capturedAt: latest.receivedAt,
        ageMsAtCapture: Math.max(
          0,
          Date.now() - latest.receivedAt + latest.ageMs,
        ),
        user: latest.user,
        tool: latest.tool,
        coordinateSystem: `User ${latest.user} / Tool ${latest.tool}`,
      };
      upsert({
        ...liftBase,
        liftHeight: lift,
        planHash:
          (active.transform || active.taskVersion === PAPER_TASK_VERSION) &&
          active.predictions
            ? paperPlanHashFor(
                active.frame!.id,
                active.targetSet,
                active.transform,
                active.predictions,
                lift.z,
                baselineLengthToleranceFor(active),
                active.taskVersion,
              )
            : undefined,
        dtRunPlanHash: undefined,
        verificationCriteria: undefined,
        diagnosis: undefined,
      });
      if (!lastSaveSucceededRef.current) {
        setLiftRecordFeedback(
          "저장에 실패했습니다. 현재 보고 좌표는 기록되지 않았습니다. 저장 상태를 확인하고 다시 시도하세요.",
        );
        return;
      }
      setLiftDraft(String(lift.z));
      const source =
        lift.source === "hardware"
          ? "실장비 제어기 보고"
          : lift.source === "mock"
            ? "모의 응답 · 실측 아님"
            : "교사 입력 · 측정값 아님";
      setLiftRecordFeedback(
        `현재 보고 Z ${lift.z.toFixed(2)} mm를 들기 높이로 기록했습니다 · ${source} · ${timeIso()} · seq ${lift.seq ?? "—"} · User ${lift.user} / Tool ${lift.tool}. 이 기록 버튼은 로봇을 이동시키지 않습니다.${priorRunArchived ? " 이전 실행은 이력에 보존했고 새 DT 확인이 필요합니다." : ""}`,
      );
      setPageError("");
    },
    onLiftHeightChange: (value) => {
      if (running || active?.run?.status === "running") {
        setLiftRecordFeedback(
          "경로 실행 중에는 현재 경로의 높이를 바꿀 수 없습니다. 실행 종료 후 입력하면 다음 확인에 적용됩니다.",
        );
        return;
      }
      setLiftDraft(value);
      setLiftRecordFeedback("");
      if (!active) {
        setLiftRecordFeedback(
          "입력은 화면에 유지됩니다. 저장하려면 먼저 O/X/Y 기준점으로 시도를 만드세요.",
        );
        return;
      }
      if (!value.trim()) {
        if (!active.liftHeight && !active.run) {
          setLiftRecordFeedback(
            "펜 들기 Z가 비어 있습니다. 유효한 절대 Z값을 입력하거나 현재 보고 Z를 기록하세요.",
          );
          return;
        }
        const liftBase = archiveCompletedPaperRunForLiftEdit(active);
        upsert({
          ...liftBase,
          liftHeight: undefined,
          planHash: undefined,
          dtRunPlanHash: undefined,
          verificationCriteria: undefined,
          diagnosis: undefined,
        });
        setLiftRecordFeedback(
          lastSaveSucceededRef.current
            ? "펜 들기 Z 입력을 비웠습니다. 높이 준비가 해제되어 새 값을 입력하거나 현재 보고 Z를 다시 기록해야 합니다."
            : "높이 설정을 비우지 못했습니다. 화면 입력은 유지되며 저장 복구 후 다시 입력하세요.",
        );
        return;
      }
      const number = parsePaperLiftHeightDraft(value);
      if (number === null) {
        setLiftRecordFeedback(
          "입력 중입니다. 부호·소수 입력을 계속할 수 있습니다. 완성된 숫자가 저장되기 전에는 경로 계산과 실행에 사용하지 않습니다.",
        );
        return;
      }
      const unchangedTeacherValue =
        active.liftHeight?.source === "teacher" &&
        active.liftHeight.z === number &&
        active.liftHeight.user === currentUser &&
        active.liftHeight.tool === currentTool;
      if (unchangedTeacherValue) {
        setLiftRecordFeedback(
          surfaceZ !== null && number <= surfaceZ
            ? `교사 입력 Z ${number} mm는 저장되어 있지만 종이 표면 Z ${surfaceZ.toFixed(2)} mm보다 높지 않아 경로 실행에는 사용할 수 없습니다.`
            : "현재 입력값은 교사 입력으로 저장되어 있습니다. 장비 측정값은 아닙니다.",
        );
        return;
      }
      const liftBase = archiveCompletedPaperRunForLiftEdit(active);
      const priorRunArchived = liftBase !== active;
      const lift = {
        z: number,
        source: "teacher" as const,
        seq: null,
        capturedAt: Date.now(),
        ageMsAtCapture: null,
        user: currentUser,
        tool: currentTool,
        coordinateSystem: `교사 입력 · User ${currentUser} / Tool ${currentTool}`,
      };
      upsert({
        ...liftBase,
        liftHeight: lift,
        planHash:
          (active.transform || active.taskVersion === PAPER_TASK_VERSION) &&
          active.predictions
            ? paperPlanHashFor(
                active.frame!.id,
                active.targetSet,
                active.transform,
                active.predictions,
                number,
                baselineLengthToleranceFor(active),
                active.taskVersion,
              )
            : undefined,
        dtRunPlanHash: undefined,
        verificationCriteria: undefined,
        diagnosis: undefined,
      });
      if (!lastSaveSucceededRef.current) {
        setLiftRecordFeedback(
          "저장 실패: 입력은 화면에 유지하지만 이 값은 계산·실행에 사용하지 않습니다. 저장 상태를 복구한 뒤 다시 입력하세요.",
        );
        return;
      }
      setLiftRecordFeedback(
        surfaceZ !== null && number <= surfaceZ
          ? `교사 입력 Z ${number} mm를 저장했습니다. 측정값이 아니며 종이 표면 Z ${surfaceZ.toFixed(2)} mm보다 높지 않아 실행 준비에는 사용할 수 없습니다.${priorRunArchived ? " 이전 실행은 이력에 보존했고 새 DT 확인이 필요합니다." : ""}`
          : `교사 입력 Z ${number} mm를 저장했습니다 · 측정값 아님 · 현재 연결의 실측 높이 확인을 대신하지 않습니다.${priorRunArchived ? " 이전 실행은 이력에 보존했고 새 DT 확인이 필요합니다." : ""}`,
      );
    },
    onBaselineLengthToleranceDraftChange: setBaselineLengthToleranceDraft,
    onApplyBaselineLengthTolerance: () => {
      if (running || active?.run?.status === "running") {
        setReferenceError(
          "실행 중에는 기준을 바꿀 수 없습니다. 실행 종료 후 적용하세요.",
        );
        return;
      }
      const toleranceMm = Number(baselineLengthToleranceDraft);
      if (
        !Number.isFinite(toleranceMm) ||
        toleranceMm <= 0 ||
        toleranceMm > PAPER_BASELINE_LENGTH_TOLERANCE_MAX_MM
      ) {
        setReferenceError(
          "기준선 길이 허용오차는 0보다 크고 100 mm 이하여야 합니다.",
        );
        return;
      }
      const current =
        active ??
        createTrial({
          targetSet: currentTargetSet,
          level,
          parentAttemptId: null,
        });
      const samples = current.referenceSamples ?? current.frame?.samples ?? [];
      const validation =
        samples.length === 3
          ? validatePaperFrame(samples, Date.now(), toleranceMm)
          : null;
      const tilted =
        validation?.ok &&
        isMergedPaper(current.level) &&
        !rotationAllowed &&
        Math.abs(getPaperFrameAngleDegrees(validation.frame)) >
          PAPER_ANGLE_TOLERANCE_DEG;
      const nextFrame =
        validation?.ok && !tilted ? validation.frame : undefined;
      const previousTolerance = baselineLengthToleranceFor(current);
      const changed = previousTolerance !== toleranceMm;
      const runHistory =
        changed && current.run
          ? [
              ...(current.runHistory ?? []).filter(
                (run) => run.id !== current.run!.id,
              ),
              current.run,
            ]
          : current.runHistory;
      const result = upsert(
        {
          ...current,
          baselineLengthTolerance: {
            toleranceMm,
            appliedAt: Date.now(),
            scope: "xy-baseline-length-only",
          },
          referenceSamples: samples,
          ...(nextFrame ? { frame: nextFrame } : { frame: undefined }),
          ...(changed
            ? {
                run: undefined,
                runHistory,
                planHash: undefined,
                dtRunPlanHash: undefined,
                diagnosis: undefined,
                verificationCriteria: undefined,
                status: nextFrame ? "model" : "references",
                stage: nextFrame ? (current.stage ?? 2) : 1,
              }
            : {}),
        },
        `기준선 길이 허용오차 ±${toleranceMm} mm를 이 시도에 적용했습니다.`,
      );
      if (!lastSaveSucceededRef.current) {
        setReferenceError(
          "허용오차 저장에 실패했습니다. 기존 기준·실행 기록은 유지되며, 저장 상태를 확인한 뒤 다시 시도하세요.",
        );
        return;
      }
      const errorMessage = tilted
        ? "기본 과제의 회전 기준이 맞지 않습니다. 기준선 허용오차는 길이 검사에만 적용되며 회전 기준은 그대로입니다."
        : validation && !validation.ok
          ? validation.reason
          : samples.length < 3
            ? `허용오차를 적용했습니다. 기준점 ${samples.length}/3개만 있어 가능한 기준선부터 표시합니다.`
            : `O/X/Y 기준점을 ±${toleranceMm} mm 길이 기준으로 재평가했습니다. Z 높이차 ±${PAPER_MEASURE_TOLERANCE_MM} mm와 각도 ±${PAPER_ANGLE_TOLERANCE_DEG}° 기준은 변경하지 않았습니다.`;
      setReferenceError(
        changed && current.run
          ? `${errorMessage} 이전 실행을 이력으로 보존했고 현재 계획의 DT 확인이 다시 필요합니다.`
          : errorMessage,
      );
      if (changed && current.run) setStage(1);
      setBaselineLengthToleranceDraft(String(toleranceMm));
      void result;
    },
    onToleranceChange: (field, value) => {
      if (active?.run?.status === "running") {
        setPageError("실행 중에는 허용오차를 바꿀 수 없습니다.");
        return;
      }
      const number = Number(value);
      if (!Number.isFinite(number) || number <= 0 || number > 5) {
        setPageError("허용오차는 0 초과 5 이하로 설정하세요.");
        return;
      }
      practice.setSetupDraft({ ...practice.setupDraft, [field]: number });
      if (active && !active.run)
        upsert({ ...active, verificationCriteria: undefined });
      setPageError(
        "허용오차를 바꿨습니다. 기존 장비 준비 확인은 무효화되었습니다. 실장비 전에는 연결·준비 절차를 다시 완료하세요.",
      );
    },
    onInkReadingChange: (point, field, value) => {
      const rows = inkDraft.length
        ? inkDraft
        : targetPoints.map((target) => ({
            point: target.name,
            xCm: "",
            yCm: "",
            status: "not-measured" as const,
            reason: "",
          }));
      const next = rows.map((row) =>
        row.point === point ? { ...row, [field]: value } : row,
      );
      setInkDraft(next);
      if (active) {
        pendingInkDraftRef.current = {
          recordId: active.id,
          snapshot: JSON.stringify(next),
        };
        upsert({ ...active, drafts: { ...active.drafts, inkReadings: next } });
        if (!lastSaveSucceededRef.current) {
          setPageError(
            "잉크 입력 자동 저장에 실패했습니다. 화면의 최신 값을 유지했습니다. 저장이 복구되기 전에는 분석·단계 이동·최종 판정을 진행할 수 없습니다.",
          );
        } else {
          setPageError((previous) =>
            previous.startsWith("잉크 입력 자동 저장에 실패") ? "" : previous,
          );
        }
      }
    },
    onSaveInkReadings: () => {
      if (running) return;
      let latest = active?.id
        ? recordsRef.current.find((item) => item.id === active.id)
        : undefined;
      if (
        !latest?.run ||
        latest.run.status !== "completed" ||
        !latest.frame ||
        !latest.run.verificationCriteria
      ) {
        setPageError(
          "완료된 현재 실행과 사전 검증 기준이 있어야 잉크 관측을 연결할 수 있습니다.",
        );
        return;
      }
      if (
        pendingInkDraftRef.current &&
        !persistPendingInkDraft(latest, inkDraft)
      ) {
        setPageError(
          "잉크 입력 저장에 실패했습니다. 화면의 최신 값을 유지했습니다. 저장 상태를 확인하고 다시 시도하세요.",
        );
        return;
      }
      latest =
        recordsRef.current.find((item) => item.id === latest!.id) ?? latest;
      const prepared = preparePaperInkReadings(
        latest,
        inkDraft,
        targetPoints,
        isMergedPaper(level) ? 20 : 10,
        Date.now(),
      );
      if (!prepared.ok) {
        setPageError(prepared.message);
        return;
      }
      const status =
        latest.diagnosis?.status === "complete"
          ? ("diagnosed" as const)
          : latest.run?.status === "completed" &&
              latest.run.observations.length === targetPoints.length
            ? ("observed" as const)
            : ("incomplete" as const);
      upsert(
        {
          ...latest,
          inkReadings: prepared.readings.length ? prepared.readings : undefined,
          drafts: { ...latest.drafts, inkReadings: undefined },
          status,
          stage: 5,
        },
        "학생이 눈금에서 읽은 잉크 좌표를 제어기 관측과 분리해 저장했습니다.",
      );
      if (!lastSaveSucceededRef.current) {
        pendingInkDraftRef.current = {
          recordId: latest.id,
          snapshot: JSON.stringify(inkDraft),
        };
        setPageError(
          "잉크 관측 저장에 실패했습니다. 입력은 유지했으며 이 자료는 분석·판정에 사용되지 않았습니다.",
        );
        return;
      }
      setPageError("");
    },
    onFollowupObservationChange: (value) => {
      setFollowupObservationDraft(value);
      if (active)
        upsert({
          ...active,
          drafts: { ...active.drafts, followupObservation: value },
        });
    },
    onModelDecisionChange: (value) => {
      setModelDecision(value);
      if (active)
        upsert({
          ...active,
          drafts: { ...active.drafts, modelDecision: value },
        });
    },
    onModelDecisionReasonChange: (value) => {
      setModelDecisionReasonDraft(value);
      if (active)
        upsert({
          ...active,
          drafts: { ...active.drafts, modelDecisionReason: value },
        });
    },
    onSaveFollowupObservation: (value) => {
      if (!active?.run || active.run.status !== "completed" || !value.trim()) {
        setPageError(
          "현재 완료된 실행에서 확인한 추가 관측과 근거를 적어 주세요.",
        );
        return;
      }
      const shown = (active.aiAnalyses ?? []).some(
        (item) =>
          item.recordId === active.id &&
          item.runId === active.run!.id &&
          item.planHash === active.run!.planHash &&
          item.source === active.run!.source &&
          !!item.displayedAt,
      );
      if (!shown) {
        setPageError("먼저 같은 실행의 분석 질문을 화면에 표시해야 합니다.");
        return;
      }
      upsert(
        {
          ...active,
          followupObservation: {
            recordId: active.id,
            runId: active.run.id,
            source: "student-report",
            text: value.trim(),
            recordedAt: Date.now(),
          },
        },
        "추가 관측과 근거를 현재 실행에 연결해 저장했습니다.",
      );
    },
    onAiAnalysisDisplayed: (analysis) => {
      const latest = active?.id
        ? recordsRef.current.find((item) => item.id === active.id)
        : undefined;
      const latestRun = latest?.run;
      if (
        !latest ||
        !latestRun ||
        !samePlan ||
        latestRun.status !== "completed" ||
        analysis.recordId !== latest.id ||
        analysis.runId !== latestRun.id ||
        analysis.planHash !== latestRun.planHash ||
        analysis.source !== latestRun.source
      )
        return;
      const currentAnalyses = latest.aiAnalyses ?? [];
      if (currentAnalyses.some((item) => item.id === analysis.id)) return;
      upsert(
        { ...latest, aiAnalyses: [...currentAnalyses, analysis] },
        "화면에 실제 표시된 분석과 같은 시도의 실행 근거를 연결해 저장했습니다.",
      );
    },
    onSaveHypothesis: (value) => {
      if (!active) {
        setPageError("현재 시도를 저장한 뒤 원인 가설을 작성하세요.");
        return;
      }
      if (!value.trim()) {
        setPageError("관측 차이에 대한 학생의 가설을 한 문장 이상 적으세요.");
        return;
      }
      const updated = upsert({
        ...active,
        studentHypothesis: value.trim(),
        status:
          active.revalidation?.result === "physical-verified"
            ? "revalidated"
            : "reasoned",
        stage: 6,
      });
      if (!lastSaveSucceededRef.current) {
        setPageError(
          "가설 저장에 실패했습니다. 입력은 유지했으며 다음 화면으로 이동하지 않았습니다.",
        );
        return;
      }
      setHypothesisDraft(value.trim());
      setStage(6);
      if (updated.diagnosis?.status !== "complete")
        setPageError(
          "진단 자료가 완성되지 않았습니다. 가설은 저장했지만 재검증 완료로 표시하지 않습니다.",
        );
    },
    onRevise: (input) => {
      const reason = input.reason;
      if (
        !active?.frame ||
        !active.run ||
        active.run.status !== "completed" ||
        !active.studentHypothesis?.trim()
      ) {
        setPageError(
          "같은 시도의 새 실행 결과와 원인 가설을 저장한 뒤 수정할 수 있습니다.",
        );
        return {
          message: "완료된 실행과 학생 가설이 필요합니다.",
          target: "hypothesis",
        };
      }
      const shown = (active.aiAnalyses ?? []).some(
        (item) =>
          item.recordId === active.id &&
          item.runId === active.run!.id &&
          item.planHash === active.run!.planHash &&
          item.source === active.run!.source &&
          !!item.displayedAt,
      );
      if (!shown) {
        setPageError(
          "같은 실행의 AI 질문이 화면에 표시된 뒤 모델을 판단할 수 있습니다.",
        );
        return {
          message: "같은 실행의 분석 응답을 먼저 확인하세요.",
          target: "analysis",
        };
      }
      if (
        !reason.trim() ||
        !input.decisionReason.trim() ||
        !input.followupObservation.trim()
      ) {
        setPageError(
          "추가 관측, 모델 유지·수정 판단 근거, 재실행 이유를 현재 시도에 저장하세요.",
        );
        return {
          message: "추가 관측, 모델 판단 근거와 수정 이유를 모두 입력하세요.",
          target: "hypothesis",
        };
      }
      const parent = upsert(
        {
          ...active,
          followupObservation: {
            recordId: active.id,
            runId: active.run.id,
            source: "student-report",
            text: input.followupObservation.trim(),
            recordedAt: Date.now(),
          },
          revisionReason: reason.trim(),
          modelDecision: input.decision,
          modelDecisionReason: input.decisionReason.trim(),
          status: input.decision === "retain" ? "reasoned" : "revised",
          stage: 7,
          revalidationTarget: "revalidation",
          drafts: {
            ...active.drafts,
            followupObservation: undefined,
            revisionReason: undefined,
            modelDecision: undefined,
            modelDecisionReason: undefined,
          },
        },
        "수정 이유와 이전 시도의 연결을 저장했습니다.",
      );
      if (!lastSaveSucceededRef.current) {
        const message =
          "수정 근거 저장에 실패해 새 시도를 만들지 않았습니다. 입력은 유지했습니다. 저장 상태를 확인하고 다시 시도하세요.";
        setPageError(message);
        return { message, target: "hypothesis" };
      }
      const carried = paperRetryInputs(
        parent,
        parent.level,
        parent.frame,
        paperTaskTargets(parent.level, "revalidation"),
      );
      const child = createTrial({
        targetSet: "revalidation",
        level: parent.level,
        parentAttemptId: parent.id,
        frame: parent.frame,
        referenceSamples: parent.referenceSamples,
        transform: carried?.transform ?? parent.transform ?? transformDraft,
        liftHeight: parent.liftHeight,
      });
      if (!lastSaveSucceededRef.current) {
        const message =
          "새 시도 저장에 실패했습니다. 이전 시도는 보존되었고 재실행은 시작하지 않았습니다.";
        setPageError(message);
        return { message, target: "run" };
      }
      // Keep the revalidation in the third student screen. It has a new attempt
      // identity, no copied run/criteria, and requires a new plan and pre-run
      // criteria before the explicit DT/hardware action can be enabled.
      const retryTargets = paperTaskTargets(parent.level, "revalidation");
      const nextStage: PaperLessonStage = 7;
      const retryPredictions =
        carried?.predictions ??
        retryTargets.map((point) => ({
          ...point,
          robotX: "",
          robotY: "",
          robotZ: "",
          robotR: "",
        }));
      upsert({
        ...child,
        ...(carried ?? {}),
        stage: nextStage,
        planHash: undefined,
        run: undefined,
        verificationCriteria: undefined,
        dtRunPlanHash: undefined,
        diagnosis: undefined,
        pathConcept: parent.pathConcept,
        drafts: {
          transform: carried?.transform ?? parent.transform ?? transformDraft,
          predictions: retryPredictions,
        },
      });
      if (!lastSaveSucceededRef.current) {
        const message =
          "새 시도의 예측 초안 저장에 실패해 재실행을 준비하지 않았습니다.";
        setPageError(message);
        return { message, target: "run" };
      }
      if (carried) setFocusRetryId(child.id);
      setRevisionDraft(reason.trim());
      setTransformDraft(
        carried?.transform ?? parent.transform ?? transformDraft,
      );
      setPredictionDraft(retryPredictions);
      setInkDraft(
        retryTargets.map((point) => ({
          point: point.name,
          xCm: "",
          yCm: "",
          status: "not-measured" as const,
          reason: "",
        })),
      );
      setStage(nextStage);
      setPageError(
        `새 시도 ${child.attempt}가 이전 시도 ${parent.attempt}와 연결됐습니다. 화면 3에서 새 예측·사전 기준을 확인한 뒤 원하는 실행 버튼을 누르세요.`,
      );
      return null;
    },
    onChooseNewTarget: () => {
      if (active?.targetSet === "revalidation") {
        setStage(3);
        return;
      }
      if (
        !active?.revisionReason?.trim() ||
        !active.studentHypothesis?.trim() ||
        !active.modelDecisionReason?.trim() ||
        !active.followupObservation?.text.trim()
      ) {
        setPageError("먼저 추가 관측, 모델 판단 근거, 수정 이유를 저장하세요.");
        return;
      }
      const child = createTrial({
        targetSet: "revalidation",
        level: active.level,
        parentAttemptId: active.id,
        frame: active.frame,
        referenceSamples: active.referenceSamples,
        transform: transformDraft,
        liftHeight: active.liftHeight,
      });
      setStage(3);
      setPageError(`새 목표점를 위한 시도 ${child.attempt}가 연결됐습니다.`);
    },
    onMovePaper: (reason) => {
      if (
        !active?.studentHypothesis?.trim() ||
        !reason.trim() ||
        !active.followupObservation?.text.trim() ||
        !active.modelDecisionReason?.trim()
      ) {
        setPageError(
          "원인 가설·추가 관측·모델 판단·수정 이유를 저장해 주세요.",
        );
        return;
      }
      const parent = upsert({
        ...active,
        revisionReason: reason.trim(),
        modelDecision: "revise",
        status: active.run ? "revised" : active.status,
        revalidationTarget: "revalidation",
        stage: 7,
      });
      createTrial({
        targetSet: "revalidation",
        level: parent.level,
        parentAttemptId: parent.id,
      });
      setManualInputs(emptyManualInputs());
      setPageError(
        "종이 위치가 바뀐 새 시도입니다. 기존 기준점·승인·관측은 재사용하지 않습니다.",
      );
    },
  };

  async function executeRun(kind: "dt" | "connected") {
    if (running) return;
    if (practice.hasPendingOperation() || practice.snap.busy) {
      setPageError(
        "TCP 준비 이동 또는 다른 장비 명령의 확인·실행 중에는 종이 경로를 시작할 수 없습니다.",
      );
      return;
    }
    if (!lastSaveSucceededRef.current) {
      setPageError(
        "저장되지 않은 입력이 있어 실행하지 않았습니다. 입력을 유지했습니다. 저장을 다시 시도하세요.",
      );
      return;
    }
    if (active?.run?.status === "running") {
      setPageError(
        "이 시도의 실행 상태가 아직 종료되지 않았습니다. 완료 또는 중단 상태를 확인한 뒤 새 시도를 시작하세요.",
      );
      return;
    }
    if (isMergedPaper(level)) {
      const blockers = kind === "dt" ? dtBlockers : physicalBlockers;
      if (blockers.length) {
        setPageError(blockers.map((b) => b.message).join(" · "));
        return;
      }
    }
    if (kind === "connected" && isPaperDT(level)) {
      setPageError("심화 1은 DT 전용입니다.");
      return;
    }
    if (isMergedPaper(level) && !paperConceptValid(active?.pathConcept)) {
      setPageError("직선 이동 명령과 닫힌 경로의 ΔX·ΔY 합을 먼저 확인하세요.");
      return;
    }
    if (
      kind === "connected" &&
      isMergedPaper(level) &&
      attemptSupport === "guided" &&
      !supervisedMismatch &&
      active?.frame &&
      comparePaperPredictionToFrame(active.frame, persistedPredictions).some(
        (e) => e.distance > 0.1,
      )
    ) {
      setPageError(
        "기초 지원에서는 예측을 목표 좌표와 일치시킨 뒤 실장비에서 확인하세요.",
      );
      return;
    }
    if (active?.run?.source !== "dt" && active?.run) {
      setPageError(
        "연결된 실행 기록은 보존합니다. 수정 이유를 적고 새 시도에서 다시 실행하세요.",
      );
      return;
    }
    if (
      !active?.frame ||
      !planTransformReady ||
      !samePlan ||
      persistedPredictions.length !== targetPoints.length
    ) {
      setPageError(
        "현재 기준점과 종이 좌표 계획이 같은 저장본인지 확인하세요. 바뀐 계획은 다시 저장해야 합니다.",
      );
      return;
    }
    const runStage: PaperLessonStage =
      isMergedPaper(level) && active.targetSet === "revalidation" ? 7 : 4;
    if (
      liftHeight === null ||
      !Number.isFinite(liftHeight) ||
      surfaceZ === null ||
      liftHeight <= surfaceZ
    ) {
      setPageError(
        "기록한 종이 표면보다 높은 펜 들기 Z를 정하세요. 실장비 높이는 제조사 프로그램에서 사람이 확인한 위치만 기록하세요.",
      );
      return;
    }
    const O = active.frame.samples.find((sample) => sample.point === "O")!;
    const points = persistedPredictions.map((prediction) => {
      const mapped = frameTransformPoint(active.frame!, prediction);
      return {
        point: prediction.name,
        pose: {
          x: Number(prediction.robotX),
          y: Number(prediction.robotY),
          z: Number(prediction.robotZ || mapped.z),
          r: O.pose.r,
        } satisfies LessonPose,
      };
    });
    if (
      points.some((item) => !Object.values(item.pose).every(Number.isFinite))
    ) {
      setPageError("저장된 예측 좌표가 유효하지 않습니다.");
      return;
    }
    const now = Date.now();
    const simStart = { ...currentPose };
    const liveMeasurement = practice.snap.measurement;
    const liveSource = practice.snap.source;
    const source: PaperEvidenceSource =
      kind === "dt" ? "dt" : (liveSource ?? "hardware");
    const startPose = kind === "dt" ? simStart : liveMeasurement?.pose;
    if (!startPose) {
      setPageError("실행 전 위치를 확인할 측정값이 없습니다.");
      return;
    }
    const safeZ = Math.max(startPose.z, liftHeight);
    const raisedOnly = new Set<string>();
    if (kind === "connected" && supervisedMismatch) {
      const blocked = supervisedPaperBlockers(
        allowMismatchedHardware,
        true,
        dtReadyForPhysical,
        active.frame,
        points,
      );
      if (blocked.length) {
        setPageError(blocked.map((b) => b.message).join(" · "));
        return;
      }
      for (const point of points)
        if (paperBoundary(active.frame, point.pose).outside) {
          raisedOnly.add(point.point);
          point.pose = { ...point.pose, z: safeZ };
        }
    }
    const operations: PracticeOperation[] = [];
    const commands: LessonPose[] = [
      { x: startPose.x, y: startPose.y, z: safeZ, r: O.pose.r },
    ];
    operations.push({ kind: "move", motion: "MoveL", target: commands[0] });
    const captureIndices = new Map<number, string>();
    for (const point of points) {
      const elevated = {
        x: point.pose.x,
        y: point.pose.y,
        z: safeZ,
        r: O.pose.r,
      };
      const touch = { ...point.pose };
      const up = { ...elevated };
      operations.push({ kind: "move", motion: "MoveL", target: elevated });
      commands.push(elevated);
      operations.push({ kind: "move", motion: "MoveL", target: touch });
      captureIndices.set(operations.length - 1, point.point);
      commands.push(touch);
      operations.push({ kind: "move", motion: "MoveL", target: up });
      commands.push(up);
    }
    const returnAtLift = { x: O.pose.x, y: O.pose.y, z: safeZ, r: O.pose.r };
    operations.push({ kind: "move", motion: "MoveL", target: returnAtLift });
    commands.push(returnAtLift);
    if (operations.length > 30) {
      setPageError("실행 계획의 명령 수가 허용 범위를 넘었습니다.");
      return;
    }
    const invalidKinematics = commands.find((command) => !canReach(command));
    if (invalidKinematics) {
      setPageError(
        "현재 기구학 모델에서 도달 불가인 지점이 있어 실행을 시작하지 않았습니다.",
      );
      return;
    }
    const priorRuns = [
      ...(active.runHistory ?? []),
      ...(active.run ? [active.run] : []),
    ];

    if (kind === "dt") {
      if (hardwareConnected) {
        setPageError(
          "다른 실장비 연결이 있어 DT 이동을 중지했습니다. 우선 연결 상태를 정리하세요.",
        );
        return;
      }
      const criteria = active.verificationCriteria;
      if (
        !criteria ||
        criteria.recordId !== active.id ||
        criteria.frameId !== active.frame.id ||
        criteria.planHash !== planHash ||
        criteria.targetSet !== active.targetSet ||
        criteria.confirmedAt > now ||
        !criteria.rationale.trim() ||
        !paperVerificationPointsMatch(criteria, targetPoints)
      ) {
        setPageError(
          "이 시도의 독립 검증점과 허용오차를 실행 전에 확인·저장해야 합니다.",
        );
        setStage(runStage);
        return;
      }
      const runningRecord: PaperRunSnapshot = {
        id: crypto.randomUUID(),
        planHash,
        frameId: active.frame.id,
        targetSet: active.targetSet,
        source: "dt",
        status: "running",
        startedAt: now,
        startSequence: null,
        commands: points.map((item) => ({
          point: item.point,
          pose: item.pose,
        })),
        observations: [],
        verificationCriteria: criteria,
      };
      upsert({
        ...active,
        runHistory: priorRuns,
        inkReadings: undefined,
        run: runningRecord,
        status: "running",
        stage: runStage,
        diagnosis: undefined,
        dataSource: "dt",
      });
      if (!lastSaveSucceededRef.current) {
        setPageError(
          "실행 기록을 저장하지 못해 DT 명령을 시작하지 않았습니다. 입력과 기존 기록은 유지했습니다.",
        );
        return;
      }
      setRunning(true);
      setPageError("");
      setStage(runStage);
      try {
        await runDigitalTwin(commands);
        const completedAt = Date.now();
        const observations: PaperPoseObservation[] = points.map((item) => ({
          point: item.point,
          source: "dt",
          seq: null,
          measuredAt: completedAt,
          ageMs: null,
          pose: { ...item.pose },
          command: { ...item.pose },
          kind: "dt",
        }));
        const completedRun = {
          ...runningRecord,
          status: "completed" as const,
          endedAt: completedAt,
          observations,
        };
        const completedRecord: PaperTrialRecord = {
          ...active,
          runHistory: priorRuns,
          inkReadings: undefined,
          run: completedRun,
          status: "observed",
          stage: runStage,
          dtRunPlanHash: planHash,
          diagnosis: undefined,
          dataSource: "dt",
        };
        const analyzed = diagnoseCompletedRecord(
          completedRecord,
          recordsRef.current,
        );
        upsert(analyzed.record, `${analyzed.message} DT 자료 · 실측 아님.`);
        if (!lastSaveSucceededRef.current) {
          setPageError(
            "DT 동작은 끝났지만 완료 기록 저장에 실패했습니다. 저장되지 않은 결과를 완료로 표시하지 않았습니다.",
          );
          return;
        }
        setDiagnosisOverride(analyzed.diagnosis);
        setStage((analyzed.record.stage ?? runStage) as PaperLessonStage);
        setPageError(
          analyzed.diagnosis?.status === "invalidated"
            ? `DT 이동은 완료됐지만 현재 계획과 연결해 비교할 수 없습니다. ${analyzed.diagnosis.candidate}`
            : "DT 완료 · 실측 아님. 비교 근거를 같은 화면에 저장했습니다.",
        );
      } catch (error) {
        const failedRun = {
          ...runningRecord,
          status: "failed" as const,
          endedAt: Date.now(),
          error: error instanceof Error ? error.message : "DT 실행 실패",
        };
        upsert({
          ...active,
          runHistory: priorRuns,
          inkReadings: undefined,
          run: failedRun,
          status: "incomplete",
          stage: runStage,
        });
        setPageError(
          lastSaveSucceededRef.current
            ? (failedRun.error ?? "DT 실행을 완료하지 못했습니다.")
            : "DT 실패 기록 저장에 실패했습니다. 완료로 표시하지 않았습니다. 현재 저장 상태를 확인하세요.",
        );
      } finally {
        setRunning(false);
      }
      return;
    }

    const setup = practice.snap.setup;
    const readiness = practice.session.readiness(true);
    if (hardwareConnected) {
      setPageError(
        "기존 연결이 활성화되어 있습니다. 새 PC 브리지 경로와 혼합하지 마세요.",
      );
      return;
    }
    if (
      !practice.hardware ||
      !setup ||
      !liveMeasurement ||
      !measurementFresh(liveMeasurement) ||
      !["hardware", "mock"].includes(liveSource ?? "")
    ) {
      setPageError(
        "실제 로봇 모드에서 새 브리지에 연결하고 최신 TCP 보고 좌표를 확인하세요. 오프라인 연습은 모의/DT를 사용하세요.",
      );
      return;
    }
    if (
      liveSource === "hardware" &&
      (active.frame.source !== "hardware" ||
        active.liftHeight?.source !== "hardware")
    ) {
      setPageError(
        "실장비 실행에는 같은 좌표계의 실장비 기준점과 제조사 프로그램에서 기록한 들기 높이가 필요합니다.",
      );
      return;
    }
    if (liveSource === "mock" && active.frame.source !== "mock") {
      setPageError(
        "모의 실행에서도 기준점·높이 출처를 섞지 마세요. 모의 기준점으로 새 시도를 시작하세요.",
      );
      return;
    }
    const lift = active.liftHeight;
    if (
      !lift ||
      lift.source !== liveSource ||
      lift.user !== setup.user ||
      lift.tool !== setup.tool ||
      lift.coordinateSystem !== `User ${setup.user} / Tool ${setup.tool}` ||
      lift.ageMsAtCapture === null ||
      lift.ageMsAtCapture > PAPER_SAMPLE_MAX_AGE_MS ||
      !active.frame.samples.every(
        (sample) => sample.user === setup.user && sample.tool === setup.tool,
      )
    ) {
      setPageError(
        "기준점·들기 높이·실행 좌표계와 User/Tool이 모두 일치해야 합니다.",
      );
      return;
    }
    if (readiness) {
      setPageError(`실행 전 준비 조건을 통과하지 못했습니다: ${readiness}`);
      return;
    }
    if (
      Math.hypot(
        liveMeasurement.pose.x - O.pose.x,
        liveMeasurement.pose.y - O.pose.y,
      ) > setup.positionTolerance ||
      Math.abs(liveMeasurement.pose.z - O.pose.z) > setup.positionTolerance
    ) {
      setPageError(
        "사람이 제조사 프로그램에서 펜을 O에 맞추고 종이 표면 높이로 둔 뒤, 새 현재 위치를 확인하세요. 이 앱은 그 위치로 이동시키지 않습니다.",
      );
      return;
    }
    const outside = commands
      .flatMap((command, index) =>
        workspaceFindings(command, setup, `종이 좌표 실행 ${index + 1}`),
      )
      .filter((finding) => finding.kind === "outside");
    if (outside.length) {
      setPageError(
        outside
          .map(
            (finding) =>
              `${finding.axis.toUpperCase()}=${finding.value} 범위 [${finding.min}, ${finding.max}] 밖`,
          )
          .join(" · "),
      );
      return;
    }
    const planeMismatch = persistedPredictions.some((prediction) => {
      const point = points.find((item) => item.point === prediction.name)!;
      return (
        !raisedOnly.has(prediction.name) &&
        Math.abs(point.pose.z - surfaceZ) > setup.positionTolerance
      );
    });
    if (planeMismatch) {
      setPageError(
        "종이 표면 높이 차이가 허용 범위를 넘습니다. 기준점을 다시 측정하세요.",
      );
      return;
    }
    if (!dtReadyForPhysical) {
      setPageError(
        "현재 계획과 같은 DT 실행을 먼저 완료해야 사람의 최종 실행 확인을 요청할 수 있습니다.",
      );
      return;
    }

    const runId = crypto.randomUUID();
    if (supervisedMismatch && active.run?.source === "dt")
      recordLearningAction(
        "paper-supervised-execution",
        "dt-prerequisite",
        {
          paperRecordId: active.id,
          runId,
          planHash,
          dtRun: active.run,
        },
        "dt",
      );
    const startSequence = liveMeasurement.seq;
    const criteria = active.verificationCriteria;
    if (
      !criteria ||
      criteria.recordId !== active.id ||
      criteria.frameId !== active.frame.id ||
      criteria.planHash !== planHash ||
      criteria.targetSet !== active.targetSet ||
      criteria.confirmedAt > Date.now() ||
      !criteria.rationale.trim() ||
      !paperVerificationPointsMatch(criteria, targetPoints)
    ) {
      setPageError(
        "이 시도의 독립 검증점과 허용오차를 실행 전에 확인·저장해야 합니다.",
      );
      setStage(runStage);
      return;
    }
    const runningRecord: PaperRunSnapshot = {
      id: runId,
      planHash,
      frameId: active.frame.id,
      targetSet: active.targetSet,
      source: liveSource!,
      status: "running",
      startedAt: Date.now(),
      startSequence,
      commands: points.map((item) => ({ point: item.point, pose: item.pose })),
      observations: [],
      verificationCriteria: criteria,
    };
    upsert({
      ...active,
      runHistory: [
        ...(active.runHistory ?? []),
        ...(active.run ? [active.run] : []),
      ],
      inkReadings: undefined,
      run: runningRecord,
      status: "running",
      stage: runStage,
      diagnosis: undefined,
      dataSource: liveSource!,
    });
    if (!lastSaveSucceededRef.current) {
      setPageError(
        "실행 기록을 저장하지 못해 실행 명령을 시작하지 않았습니다. 실제 로봇 명령은 전송하지 않았습니다.",
      );
      return;
    }
    setRunning(true);
    setPageError("");
    const observed: PaperPoseObservation[] = [];
    try {
      const label =
        liveSource === "mock"
          ? "모눈종이 좌표 변환 · 모의 브리지 시험 (실제 로봇은 움직이지 않음)"
          : "모눈종이 좌표 변환 · 저장된 학생 예측 실행 (제어기 TCP 보고 좌표만 측정)";
      const warning = supervisedMismatch
        ? "\n예측이 목표와 다릅니다. 로봇이 종이 목표와 다른 곳으로 이동합니다. 비상정지를 확인하고 실행하세요." +
          (raisedOnly.size
            ? `\n${[...raisedOnly].join(", ")}: 종이 밖에서는 펜을 내리지 않고 들기 높이에서만 확인합니다.`
            : "")
        : "";
      const results = await practice.runOps(
        operations,
        label + warning,
        (measurement, index, operation) => {
          const pointName = captureIndices.get(index);
          if (!pointName || operation.kind !== "move") return;
          observed.push({
            point: pointName,
            source: measurement.source,
            seq: measurement.seq,
            measuredAt: measurement.measuredAt,
            ageMs: measurement.ageMs,
            pose: { ...measurement.pose },
            command: { ...operation.target },
            kind:
              measurement.source === "hardware"
                ? "controller-tcp"
                : "mock-bridge",
          });
        },
        supervisedMismatch
          ? () => {
              // Existing confirmation/connection recheck completes before onStart.
              // Use the existing action-event payload, leaving trial/CSV schemas intact.
              const latest = practiceRef.current.session.getSnapshot(),
                saved = recordsRef.current.find((r) => r.id === active.id);
              if (
                !latest.measurement ||
                !measurementFresh(latest.measurement) ||
                latest.measurement.moving ||
                latest.source !== liveSource ||
                !saved ||
                saved.planHash !== planHash ||
                saved.dtRunPlanHash !== planHash ||
                saved.frame?.id !== active.frame!.id ||
                poseDistance(latest.measurement.pose, O.pose) >
                  setup.positionTolerance ||
                Math.abs(latest.measurement.pose.r - O.pose.r) >
                  setup.rotationTolerance
              )
                throw new Error(
                  "교사 확인 중 시작 위치 또는 예측 조건이 바뀌었습니다. O 위치와 같은 DT 계획을 다시 확인하세요.",
                );
              recordLearningAction(
                "paper-supervised-execution",
                "teacher-confirmed",
                {
                  paperRecordId: active.id,
                  runId,
                  planHash,
                  dtRunId: active.run?.id,
                  hardwareRunOfMismatchedPrediction: liveSource === "hardware",
                  teacherConfirmedAt: new Date().toISOString(),
                  raisedOnlyPoints: [...raisedOnly],
                },
                liveSource!,
              );
            }
          : undefined,
      );
      if (!results) {
        const cancelled = {
          ...runningRecord,
          status: "cancelled" as const,
          endedAt: Date.now(),
          observations: [],
        };
        upsert(
          {
            ...active,
            runHistory: priorRuns,
            inkReadings: undefined,
            run: cancelled,
            status: "incomplete",
            stage: runStage,
          },
          "사람이 최종 실행 확인을 취소했습니다. 이동 명령은 전송되지 않았습니다.",
        );
        setPageError(
          lastSaveSucceededRef.current
            ? "최종 확인이 취소됐습니다. 실행 측정은 0건입니다."
            : "취소 기록 저장에 실패했습니다. 완료로 표시하지 않았습니다.",
        );
      } else {
        const endedAt = Date.now();
        const completed = {
          ...runningRecord,
          status: "completed" as const,
          endedAt,
          observations: observed,
        };
        const check = validatePaperRunForDiagnosis(
          completed,
          active.frame,
          planHash,
          targetPoints,
        );
        const complete = !check && observed.length === points.length;
        const baseRecord: PaperTrialRecord = {
          ...active,
          runHistory: priorRuns,
          inkReadings: undefined,
          run: complete
            ? completed
            : {
                ...completed,
                status: "partial",
                error: check ?? "새 TCP 보고 좌표 꼭짓점 누락",
              },
          status: complete ? "observed" : "incomplete",
          stage: runStage,
          ...(liveSource === "hardware" && complete
            ? { dataSource: "hardware" as const }
            : { dataSource: "mock" as const }),
        };
        if (complete) {
          const analyzed = diagnoseCompletedRecord(
            baseRecord,
            recordsRef.current,
          );
          upsert(
            analyzed.record,
            `${analyzed.message} ${liveSource === "hardware" ? "제어기 TCP 보고 좌표" : "모의 브리지 자료"}를 같은 실행에 연결했습니다.`,
          );
          if (lastSaveSucceededRef.current) {
            setDiagnosisOverride(analyzed.diagnosis);
            setStage((analyzed.record.stage ?? runStage) as PaperLessonStage);
          }
        } else
          upsert(
            baseRecord,
            "실행은 완료로 인정되지 않았습니다. 새 측정 근거가 부족합니다.",
          );
        setPageError(
          !lastSaveSucceededRef.current
            ? "실행 결과 저장에 실패해 이를 완료 자료로 표시하지 않았습니다. 저장 상태를 확인하세요."
            : complete
              ? liveSource === "mock"
                ? "모의 브리지 회신을 저장했습니다. 실측이 아니며 실제 로봇 증거로 사용할 수 없습니다."
                : "제어기 TCP 보고 좌표 응답을 저장했습니다. 잉크 접촉 측정은 아닙니다."
              : `실행 결과가 불완전합니다. ${check ?? "모든 목표점의 새 응답이 모두 필요합니다."}`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "실행을 완료하지 못했습니다.";
      const endedAt = Date.now();
      let observations = [...observed];
      const failedRun = {
        ...runningRecord,
        status: observations.length
          ? ("partial" as const)
          : ("failed" as const),
        endedAt,
        observations,
        error: message,
      };
      upsert(
        {
          ...active,
          runHistory: priorRuns,
          inkReadings: undefined,
          run: failedRun,
          status: "incomplete",
          stage: runStage,
        },
        "실행 실패 또는 부분 결과를 완료로 승격하지 않고 기록했습니다.",
      );
      setPageError(
        lastSaveSucceededRef.current
          ? message
          : "실패 상태 저장에 실패했습니다. 결과를 완료로 표시하지 않았습니다.",
      );
    } finally {
      setRunning(false);
    }
  }

  const legacyPhysicalReason = (() => {
    if (isPaperDT(level)) return "심화 1은 DT 전용입니다.";
    if (isMergedPaper(level) && !paperConceptValid(active?.pathConcept))
      return "직선 이동과 닫힘 개념을 먼저 확인하세요.";
    if (
      isMergedPaper(level) &&
      attemptSupport === "guided" &&
      frame &&
      comparePaperPredictionToFrame(frame, persistedPredictions).some(
        (e) => e.distance > 0.1,
      )
    )
      return "기초 지원에서는 목표와 일치하는 예측으로 실장비를 확인합니다.";
    if (hardwareConnected)
      return "기존 연결이 활성화되어 있습니다. 다른 물리 연결을 혼합하지 마세요.";
    if (!practice.hardware)
      return "실장비 또는 모의 브리지 연결을 선택하고 기존 승인·준비 절차를 완료하세요.";
    if (practice.snap.connection !== "connected" || !practice.snap.source)
      return "로봇 옆 PC 브리지 연결이 필요합니다.";
    if (practice.snap.source === "hardware" && frame?.source !== "hardware")
      return "실제 TCP 보고 좌표 기준점 O/X/Y가 필요합니다.";
    if (
      !frame ||
      !planTransformReady ||
      !samePlan ||
      persistedPredictions.length !== targetPoints.length
    )
      return "같은 기준점·예측으로 DT를 먼저 완료하세요.";
    if (!dtReadyForPhysical) return "현재 저장된 계획의 DT 완주가 필요합니다.";
    if (
      !liftRecord ||
      liftRecord.source !== practice.snap.source ||
      liftHeight === null ||
      surfaceZ === null ||
      liftHeight <= surfaceZ
    )
      return "측정된 종이 높이와 같은 출처의 펜 들기 높이가 필요합니다.";
    if (!practice.snap.setup || practice.session.readiness(true))
      return (
        practice.session.readiness(true) ?? "연결·준비·서보 확인을 완료하세요."
      );
    if (
      !frame.samples.every(
        (sample) =>
          sample.user === practice.snap.setup!.user &&
          sample.tool === practice.snap.setup!.tool,
      ) ||
      liftRecord.user !== practice.snap.setup.user ||
      liftRecord.tool !== practice.snap.setup.tool
    )
      return "기준점·높이·실행의 User/Tool 설정이 다릅니다.";
    if (
      !currentPoseRead ||
      !originPose ||
      poseDistance(currentPoseRead, originPose) >
        practice.snap.setup.positionTolerance
    )
      return "사람이 제조사 프로그램에서 O에 펜 끝을 맞춘 뒤, 현재 위치를 다시 확인하세요.";
    if (
      persistedPredictions.some(
        (prediction) =>
          ![prediction.robotX, prediction.robotY].every((value) =>
            Number.isFinite(Number(value)),
          ),
      )
    )
      return "모든 목표점의 저장된 예측 좌표가 필요합니다.";
    const commands = persistedPredictions.map((prediction) => ({
      x: Number(prediction.robotX),
      y: Number(prediction.robotY),
      z: Number(
        prediction.robotZ ||
          frameTransformPoint(frame!, prediction).z,
      ),
      r: originPose!.r,
    }));
    const unsafe = commands.find(
      (command) =>
        targetProblem(command, practice.snap.setup!) || !canReach(command),
    );
    if (unsafe)
      return (
        targetProblem(unsafe, practice.snap.setup!) ??
        "기구학 검사에서 도달 불가입니다."
      );
    return "";
  })();

  const previewPoints = persistedPredictions.map((p) => ({
    point: p.name,
    pose: {
      x: Number(p.robotX),
      y: Number(p.robotY),
      z: Number(
        p.robotZ || (frame ? frameTransformPoint(frame, p).z : surfaceZ ?? 0),
      ),
      r: originPose?.r ?? 0,
    },
  }));
  const previewZ = Math.max(
    currentPoseRead?.z ?? currentPose.z,
    liftHeight ?? 0,
  );
  const previewCommands = previewPoints.flatMap((p) => [
    { ...p.pose, z: previewZ },
    p.pose,
  ]);
  if (originPose) previewCommands.push({ ...originPose, z: previewZ });
  const commonBlockers: PaperRunBlocker[] = [];
  if (running)
    commonBlockers.push({
      message: "실행이 끝날 때까지 기다려 주세요.",
      target: "dt",
    });
  if (run && run.source !== "dt")
    commonBlockers.push({
      message:
        "연결된 실행 기록은 보존됩니다. 수정 이유를 적고 새 시도를 시작하세요.",
      target: "prediction",
    });
  if (!paperConceptValid(active?.pathConcept))
    commonBlockers.push({
      message: "직선 이동 명령과 닫힌 경로의 ΔX·ΔY 합을 확인하세요.",
      target: "prediction",
    });
  if (
    !frame ||
    !planTransformReady ||
    !samePlan ||
    persistedPredictions.length !== targetPoints.length
  )
    commonBlockers.push({
      message: "현재 기준점·변환식·예측을 같은 저장본으로 저장하세요.",
      target: "prediction",
    });
  if (liftHeight === null || !Number.isFinite(liftHeight))
    commonBlockers.push({
      message: "펜 들기 높이(Z)를 먼저 입력하세요.",
      target: "height",
    });
  else if (surfaceZ === null || liftHeight <= surfaceZ)
    commonBlockers.push({
      message: "펜 들기 Z는 기록한 종이 표면보다 높아야 합니다.",
      target: "height",
    });
  if (
    previewCommands.some(
      (p) => !Object.values(p).every(Number.isFinite) || !canReach(p),
    )
  )
    commonBlockers.push({
      message: "예측점 또는 펜을 든 이동 지점이 기구학 작업 범위 밖입니다.",
      target: "prediction",
    });
  const criteriaMatches =
    !!active?.verificationCriteria &&
    !!active.frame &&
    !!active.planHash &&
    active.verificationCriteria.recordId === active.id &&
    active.verificationCriteria.frameId === active.frame.id &&
    active.verificationCriteria.planHash === active.planHash &&
    active.verificationCriteria.targetSet === active.targetSet &&
    !!active.verificationCriteria.rationale.trim() &&
    paperVerificationPointsMatch(active.verificationCriteria, targetPoints);
  const dtBlockers = [...commonBlockers];
  if (!criteriaMatches)
    dtBlockers.push({
      message:
        "이번 실행의 독립 검증점과 위치·방향 허용오차를 실행 전에 확인·저장하세요.",
      target: "criteria",
    });
  if (hardwareConnected)
    dtBlockers.push({
      message: "다른 실장비 연결이 활성화되어 DT 실행이 잠겼습니다.",
      target: "connection",
    });
  const physicalBlockers = [...commonBlockers];
  if (!criteriaMatches)
    physicalBlockers.push({
      message:
        "이번 실장비 실행의 독립 검증점과 위치·방향 허용오차를 먼저 확인·저장하세요.",
      target: "criteria",
    });
  if (isPaperDT(level))
    physicalBlockers.push({
      message: "심화 1은 DT 전용입니다.",
      target: "connection",
    });
  if (level === "advanced-paper-hardware")
    physicalBlockers.push(
      ...supervisedPaperBlockers(
        allowMismatchedHardware,
        mismatchedPrediction,
        dtReadyForPhysical,
        frame,
        previewPoints,
      ),
    );
  if (!dtReadyForPhysical && !physicalBlockers.some((b) => b.target === "dt"))
    physicalBlockers.push({
      message: "같은 예측을 DT에서 먼저 끝까지 실행하세요.",
      target: "dt",
    });
  if (
    hardwareConnected ||
    !practice.hardware ||
    practice.snap.connection !== "connected" ||
    !practice.snap.source
  )
    physicalBlockers.push({
      message:
        "실장비가 연결되지 않았거나 다른 연결이 사용 중입니다. 기존 연결·준비 절차를 완료하세요.",
      target: "connection",
    });
  else {
    const setup = practice.snap.setup,
      source = practice.snap.source,
      connectionToken = practice.snap.connectionToken;
    if (
      frame?.source !== source ||
      !connectionToken ||
      frame.samples.some(
        (sample) =>
          sample.source !== source ||
          sample.connectionToken !== connectionToken ||
          (setup && (sample.user !== setup.user || sample.tool !== setup.tool)),
      )
    )
      physicalBlockers.push({
        message:
          "현재 TCP 연결·User/Tool에서 O/X/Y를 모두 다시 기록하세요. 이전 연결·교사 입력은 실장비 기준점으로 사용할 수 없습니다.",
        target: "references",
      });
    if (
      !liftRecord ||
      liftRecord.source !== source ||
      !connectionToken ||
      liftRecord.connectionToken !== connectionToken ||
      liftRecord.ageMsAtCapture === null ||
      liftRecord.ageMsAtCapture > PAPER_SAMPLE_MAX_AGE_MS
    )
      physicalBlockers.push({
        message:
          "현재 TCP 연결에서 새 제어기 보고를 확인한 펜 들기 높이를 기록하세요.",
        target: "height",
      });
    const ready = practice.session.readiness(true);
    if (!setup || ready)
      physicalBlockers.push({
        message: ready ?? "연결·준비·서보 확인을 완료하세요.",
        target: "connection",
      });
    if (setup) {
      if (
        !frame?.samples.every(
          (s) => s.user === setup.user && s.tool === setup.tool,
        ) ||
        !liftRecord ||
        liftRecord.user !== setup.user ||
        liftRecord.tool !== setup.tool ||
        liftRecord.coordinateSystem !==
          `User ${setup.user} / Tool ${setup.tool}`
      )
        physicalBlockers.push({
          message: "기준점·높이·실행의 User/Tool 설정이 모두 같아야 합니다.",
          target: "connection",
        });
      if (
        !currentPoseRead ||
        !originPose ||
        poseDistance(currentPoseRead, { ...originPose, z: surfaceZ! }) >
          setup.positionTolerance
      )
        physicalBlockers.push({
          message:
            "이 화면의 TCP 미세 이동으로 펜 끝을 O의 종이 표면에 맞춘 뒤 새 현재 위치를 확인하세요.",
          target: "connection",
        });
      if (previewCommands.some((p) => targetProblem(p, setup)))
        physicalBlockers.push({
          message:
            "예측점 또는 펜을 든 이동이 설정한 작업 범위를 벗어났습니다.",
          target: "prediction",
        });
    }
  }
  const physicalReason = isMergedPaper(level)
    ? physicalBlockers.map((b) => b.message).join(" · ")
    : legacyPhysicalReason;

  const liveSession = practice.snap;
  const liveMeasurement = liveSession.measurement;
  const tcpJogAgeMs = liveMeasurement
    ? Math.max(0, Date.now() - liveMeasurement.measuredAt)
    : null;
  const baselineLengthMetrics = paperBaselineLengthMetrics(
    samples,
    baselineLengthToleranceMm,
  );
  const liftCapture = (() => {
    const result = (
      message: string,
      nextAction: "connection" | "references" | "tcp-jog" | "revision" | "none",
      nextLabel: string,
      canRecord = false,
    ) => ({ canRecord, message, nextAction, nextLabel });
    if (running || liveSession.busy || practice.operationPending)
      return result(
        "장비 또는 학습 실행이 진행 중이어서 지금 기록할 수 없습니다.",
        "connection",
        "연결·준비 상태 확인",
      );
    if (active?.run)
      return result(
        "이 시도에는 이미 실행 기록이 있습니다. 이전 기록은 보존됩니다.",
        "revision",
        "수정 이유 작성 후 새 시도",
      );
    if (
      liveSession.connection !== "connected" ||
      !liveSession.source ||
      !liveSession.connectionToken
    )
      return result(
        "현재 연결에서 받은 위치 보고가 없습니다.",
        "connection",
        "연결·준비 열기",
      );
    if (!liveMeasurement)
      return result(
        "현재 연결의 TCP 위치 보고가 아직 없습니다. 이 버튼은 위치를 읽거나 로봇을 움직이지 않습니다.",
        "connection",
        "연결 화면에서 현재 위치 보고 확인",
      );
    if (liveMeasurement.error)
      return result(
        "장비 보고에 오류 상태가 있습니다. 연결·준비 화면에서 오류를 확인하고 정지 상태를 만든 뒤 새 위치를 읽으세요.",
        "connection",
        "연결·준비 열기",
      );
    if (liveMeasurement.moving)
      return result(
        "장비가 움직이는 중이므로 위치를 기록할 수 없습니다. 이동 종료 후 새 보고를 확인하세요.",
        "connection",
        "연결·준비 열기",
      );
    if (!measurementFresh(liveMeasurement))
      return result(
        `현재 위치 보고가 오래되었습니다${tcpJogAgeMs === null ? "" : ` (${Math.round(tcpJogAgeMs / 1000)}초)`}. 새 위치 보고가 필요합니다.`,
        "connection",
        "연결 화면에서 현재 위치 보고 확인",
      );
    if (
      !liveSession.setup ||
      !liveSession.setup.verified.coordinates ||
      !coordinatesVerified
    )
      return result(
        "현재 연결의 User/Tool 및 좌표계를 확인하지 않았습니다.",
        "connection",
        "연결·준비 열기",
      );
    if (!active)
      return result(
        "기록할 현재 시도가 없습니다. 기존 시도를 선택하거나 새 시도를 시작하세요.",
        "revision",
        "새 시도 준비",
      );
    if (
      !frame ||
      frame.samples.length !== 3 ||
      frame.source !== liveSession.source ||
      frame.samples.some(
        (sample) =>
          sample.source !== liveSession.source ||
          sample.connectionToken !== liveSession.connectionToken ||
          sample.user !== liveSession.setup!.user ||
          sample.tool !== liveSession.setup!.tool,
      )
    )
      return result(
        "현재 연결·User/Tool에서 기록한 O/X/Y 실장비 기준점이 없습니다. 교사 입력이나 이전 연결 기록은 실측 기준점으로 사용할 수 없습니다.",
        "references",
        "O/X/Y 기준점 기록으로 이동",
      );
    const surface = surfaceZ;
    if (surface === null)
      return result(
        "O/X/Y에서 종이 표면 Z를 계산할 수 없습니다. 기준점 기록을 확인하세요.",
        "references",
        "기준점 기록 확인",
      );
    if (liveMeasurement.pose.z <= surface)
      return result(
        `현재 보고 Z ${liveMeasurement.pose.z.toFixed(2)} mm는 종이 표면 Z ${surface.toFixed(2)} mm보다 높지 않습니다. 교사가 위치를 맞추고 새 보고를 확인하세요.`,
        "tcp-jog",
        "웹 TCP 미세 이동으로 위치 맞추기",
      );
    if (
      liveMeasurement.user !== liveSession.setup.user ||
      liveMeasurement.tool !== liveSession.setup.tool
    )
      return result(
        `현재 보고 User ${liveMeasurement.user}/Tool ${liveMeasurement.tool}가 적용 설정 User ${liveSession.setup.user}/Tool ${liveSession.setup.tool}과 다릅니다.`,
        "connection",
        "연결·준비 열기",
      );
    return result(
      `기록 가능 · 현재 보고 Z ${liveMeasurement.pose.z.toFixed(2)} mm · ${liveMeasurement.source === "hardware" ? "실장비 제어기 보고" : "모의 응답 · 실측 아님"} · seq ${liveMeasurement.seq} · User ${liveMeasurement.user} / Tool ${liveMeasurement.tool}. 기록 버튼은 로봇을 이동시키지 않습니다.`,
      "references",
      "기준점·실행 전 조건 확인",
      true,
    );
  })();
  const tcpJogBusy =
    running ||
    practice.operationPending ||
    liveSession.busy ||
    !!liveMeasurement?.moving;
  let tcpJogBlocker = "";
  if (level !== "advanced-paper-hardware") {
    tcpJogBlocker = "TCP 준비 이동은 2-4 심화2에서만 사용할 수 있습니다.";
  } else if (hardwareConnected) {
    tcpJogBlocker =
      "기존 장비 연결 작업이 끝난 뒤 이 수업의 연결을 확인하세요.";
  } else if (tcpJogBusy) {
    tcpJogBlocker = "다른 확인·이동 또는 도형 실행이 끝난 뒤 다시 시도하세요.";
  } else {
    tcpJogBlocker = practice.session.readiness(true) ?? "";
    if (!tcpJogBlocker && !liveMeasurement)
      tcpJogBlocker = "같은 연결에서 새 TCP 위치를 먼저 읽으세요.";
    if (!tcpJogBlocker && liveMeasurement && !measurementFresh(liveMeasurement))
      tcpJogBlocker = "TCP 보고가 오래되었습니다. 현재 위치를 새로 읽으세요.";
    if (!tcpJogBlocker && liveMeasurement?.moving)
      tcpJogBlocker = "장비가 움직이는 중입니다. 정지 후 위치를 확인하세요.";
  }
  const activeConnectionToken = liveSession.connectionToken;
  const referenceConnectionCurrent =
    !!frame &&
    !!activeConnectionToken &&
    frame.source === liveSession.source &&
    frame.samples.length === 3 &&
    frame.samples.every(
      (sample) =>
        sample.connectionToken === activeConnectionToken &&
        sample.source === liveSession.source,
    );
  const liftConnectionCurrent =
    !!liftRecord &&
    !!activeConnectionToken &&
    liftRecord.connectionToken === activeConnectionToken &&
    liftRecord.source === liveSession.source;
  const teacherPreparationBlockers = physicalBlockers
    .filter((blocker) =>
      ["connection", "references", "height"].includes(blocker.target),
    )
    .map((blocker) => blocker.message);

  const state: PaperCoordinateStudyViewState = {
    dtBlockers: isMergedPaper(level) ? dtBlockers : undefined,
    physicalBlockers: isMergedPaper(level) ? physicalBlockers : undefined,
    allowMismatchedHardware,
    retry:
      active && retryInputs && retryParent
        ? {
            id: active.id,
            attempt: retryParent.attempt,
            baseline: retryInputs,
            fields: paperRetryFields(retryParent),
            focusRequested: focusRetryId === active.id,
            editable: !active.run,
          }
        : undefined,
    parentAttempt: active?.parentAttemptId
      ? (records.find((record) => record.id === active.parentAttemptId) ?? null)
      : null,
    activeAttempt: active ?? null,
    baselineLengthToleranceMm,
    baselineLengthToleranceAppliedAt:
      active?.baselineLengthTolerance?.appliedAt ?? null,
    baselineLengthToleranceDraft,
    baselineLengthMetrics,
    liftCapture,
    liftRecordFeedback,
    rotationAllowed: rotationAllowed && !isPaperDT(level),
    pathConcept: active?.pathConcept,
    records,
    recordId: active?.id ?? null,
    attempt: active?.attempt ?? null,
    analysisReady: false,
    revalidationScope: active?.revalidation?.scope ?? null,
    revalidationResult: active?.revalidation?.result,
    verificationCriteria: active?.verificationCriteria,
    verificationCriteriaMatches: criteriaMatches,
    verificationCriteriaPlanReady:
      !!active?.planHash && samePlan && predictionsComplete,
    stageNavigationBlocker: paperStageNavigationRequirement(
      7,
      (diagnosisOverride ?? active?.diagnosis)?.status === "complete",
      !!active?.studentHypothesis?.trim(),
    ),
    planHash,
    preparationSummary: [
      frame
        ? `O/X/Y ${frame.coordinateSystem} · User ${frame.user} / Tool ${frame.tool} · ${frame.source === "hardware" ? "실장비" : frame.source === "dt" ? "DT" : frame.source === "mock" ? "모의" : "교사 입력"}${referenceConnectionCurrent ? " · 현재 연결 유효" : " · 현재 연결에서 재기록 필요"}`
        : "O/X/Y 기준점 준비 필요",
      liftRecord
        ? `펜 높이 ${Number(liftRecord.z).toFixed(1)} mm · ${liftRecord.source === "hardware" ? "실장비" : liftRecord.source === "mock" ? "모의" : "교사 입력"}${liftConnectionCurrent ? " · 현재 연결 유효" : " · 현재 연결에서 재기록 필요"}`
        : "펜 들기 높이 준비 필요",
      `허용오차 위치 ±${practice.setupDraft.positionTolerance} mm · 방향 ±${practice.setupDraft.rotationTolerance}°`,
      criteriaMatches
        ? "이번 시도 기준 저장됨"
        : "이번 시도 실행 전 기준 저장 필요",
    ],
    teacherPreparationReady: teacherPreparationBlockers.length === 0,
    teacherPreparationBlockers,
    tcpJog: {
      mode: liveSession.mode,
      connection: liveSession.connection,
      source: liveSession.source,
      pose: liveMeasurement?.pose ?? null,
      seq: liveMeasurement?.seq ?? null,
      measuredAt: liveMeasurement?.measuredAt ?? null,
      ageMs: tcpJogAgeMs,
      fresh:
        !!liveMeasurement &&
        measurementFresh(liveMeasurement) &&
        !liveMeasurement.moving,
      user: liveMeasurement?.user ?? null,
      tool: liveMeasurement?.tool ?? null,
      appliedUser: liveSession.setup?.user ?? null,
      appliedTool: liveSession.setup?.tool ?? null,
      appliedSpeed: liveSession.setup?.speed ?? null,
      busy: tcpJogBusy,
      pending: practice.operationPending,
      stopAvailable:
        practice.operationPending ||
        liveSession.busy ||
        !!liveMeasurement?.moving,
      canMove: !tcpJogBlocker,
      blocker: tcpJogBlocker,
      status: tcpJogStatus,
      message: tcpJogMessage,
    },
    referenceConnectionCurrent,
    liftConnectionCurrent,
    verificationReasonDraft,
    followupObservationDraft,
    modelDecision,
    modelDecisionReasonDraft,
    stage,
    level,
    targetSet: currentTargetSet,
    frame,
    samples,
    currentPose: currentPoseRead,
    currentSource,
    currentSequence,
    currentMeasuredAt,
    displayPose: currentPoseRead ?? currentPose,
    displaySource: currentSource ?? "dt",
    manualInputs,
    coordinateSystem: frame?.coordinateSystem ?? currentSystem,
    user: frame?.user ?? currentUser,
    tool: frame?.tool ?? currentTool,
    coordinatesVerified,
    referenceError,
    transform: selectedTransform,
    transformFeedback,
    targetPoints,
    predictions: draftTargets,
    paperCoordinates: paperCoordinateDrafts,
    predictionsReady: predictionsComplete,
    predictionFeedback:
      predictionsComplete &&
      frame &&
      isMergedPaper(level) &&
      omitsOrigin(
        draftTargets.map((p) => ({ x: Number(p.robotX), y: Number(p.robotY) })),
        targetPoints.map((t) => frameTransformPoint(frame, t)),
        frame.samples[0].pose,
      )
        ? "예측 검토: 기준점 O를 더하지 않은 패턴입니다. 실행 관측에 따른 판정은 아니며, 도달 불가인 좌표는 실행하지 않습니다."
        : predictionFeedback,
    run,
    runAvailable:
      (!isMergedPaper(level) || paperConceptValid(active?.pathConcept)) &&
      (!run || run.source === "dt") &&
      criteriaMatches &&
      !!frame &&
      planTransformReady &&
      samePlan &&
      persistedPredictions.length === targetPoints.length &&
      liftHeight !== null &&
      persistedPredictions.every((item) =>
        [item.robotX, item.robotY].every((v) => Number.isFinite(Number(v))),
      ) &&
      persistedPredictions.every((item) =>
        canReach({
          x: Number(item.robotX),
          y: Number(item.robotY),
          z: Number(
            item.robotZ ||
              (frame ? frameTransformPoint(frame, item).z : surfaceZ ?? 0),
          ),
          r: frame.samples.find((sample) => sample.point === "O")?.pose.r ?? 0,
        }),
      ),
    physicalAvailable: !physicalReason,
    physicalUnavailableReason: physicalReason,
    liftHeightInput: liftDraft,
    liftHeightInputSaved: liftDraftState.saved,
    liftHeight,
    liftHeightSource: liftDraftState.source,
    liftHeightSequence: liftDraftState.sequence,
    paperSurfaceZ: surfaceZ,
    positionTolerance: practice.setupDraft.positionTolerance,
    rotationTolerance: practice.setupDraft.rotationTolerance,
    convertedReadings:
      run?.observations.map((observation) => {
        const mapped = frameInversePoint(frame!, observation.pose);
        return {
          point: observation.point,
          source: observation.source,
          seq: observation.seq,
          measuredAt: observation.measuredAt,
          xCm: mapped?.xCm ?? null,
          yCm: mapped?.yCm ?? null,
        };
      }) ?? [],
    inkReadings: inkDraft,
    diagnosis: diagnosisOverride ?? active?.diagnosis ?? null,
    studentHypothesis: hypothesisDraft,
    revisionReason: revisionDraft,
    saveState,
    saveMessage,
    running,
    error: pageError,
  };
  if (isMergedPaper(level)) state.runAvailable = dtBlockers.length === 0;

  const shownDiagnosis =
    samePlan && frame && run?.status === "completed"
      ? (state.diagnosis ??
        diagnosePaperRun(run, frame, planHash, {
          transform: active?.transform,
          targets: targetPoints,
          toleranceMm:
            active?.diagnosisToleranceMm ??
            practice.setupDraft.positionTolerance,
          detectOriginMissing: isMergedPaper(level),
          support: attemptSupport,
        }))
      : null;
  if (isMergedPaper(level)) state.diagnosis = shownDiagnosis;
  const analysisReady =
    paperAnalysisReady(active, planHash, shownDiagnosis, targetPoints) &&
    samePlan;
  state.recordId = active?.id ?? null;
  state.attempt = active?.attempt ?? null;
  state.analysisReady = analysisReady;
  const savedForFeedback =
    active && shownDiagnosis
      ? { ...active, diagnosis: shownDiagnosis }
      : active;
  let context: FeedbackContext = active
    ? paperFeedbackContext(savedForFeedback!, records, targetPoints)
    : {
        task: "paper-coordinate",
        condition: JSON.stringify({
          targets: targetPoints,
          units: "종이 cm / 로봇 mm",
          source: "아직 현재 시도 자료 없음",
        }),
        answers: JSON.stringify({
          transform: transformDraft,
          predictions: draftTargets,
          paperCoordinates: paperCoordinateDrafts,
        }),
        reason: privateText(
          hypothesisDraft || transformDraft.explanation,
        ).slice(0, 1500),
        initialPrediction: "{}",
        history: "[]",
        judgment: JSON.stringify({ status: "자료 부족" }),
        execution: "[]",
        support: attemptSupport,
        attempts: 0,
      };
  if (active && !analysisReady) {
    context = {
      ...context,
      answers: JSON.stringify({
        saved: {
          transform: active.transform,
          predictions: active.predictions,
          paperCoordinates: active.predictions?.map((point) => ({
            point: point.name,
            xCm: point.xCm,
            yCm: point.yCm,
          })),
        },
        currentDraft: {
          transform: transformDraft,
          predictions: draftTargets,
          paperCoordinates: paperCoordinateDrafts,
        },
      }),
      reason: privateText(hypothesisDraft || transformDraft.explanation).slice(
        0,
        1500,
      ),
    };
  }
  const priorSameType = records.filter(
    (r) =>
      r.id !== active?.id &&
      r.level === level &&
      r.diagnosis?.pattern === shownDiagnosis?.pattern,
  ).length;
  const comparison =
    isPaperRectangle(level) &&
    shownDiagnosis &&
    frame &&
    run &&
    !running &&
    (stage === 4 || stage === 5 || stage === 6 || stage === 7)
      ? paperRectangleVisual(
          frame,
          targetPoints,
          run,
          shownDiagnosis,
          stage,
          paperFeedbackKey(context),
          priorSameType,
          attemptSupport,
          isMergedPaper(level),
        )
      : null;
  state.comparison = comparison;
  state.transformEstimate =
    comparison && frame && run
      ? paperTransformEstimate(frame, targetPoints, run)
      : null;
  state.priorSameType = priorSameType;
  const attemptHistory = useSquareAttemptHistory(
    visualOwner,
    isPaperDT(level) ? 4 : 5,
    comparison && active?.taskVersion === PAPER_TASK_VERSION && run
      ? {
          id: active.id + ":" + run.id,
          recordId: active.id,
          runId: run.id,
          parentAttemptId: active.parentAttemptId ?? undefined,
          taskVersion: active.taskVersion,
          taskIndex: isPaperDT(level) ? 4 : 5,
          supportMode: attemptSupport,
          predictions: {
            transform: active.transform,
            points: active.predictions,
            pathConcept: active.pathConcept,
          },
          predictionReason: active.transform?.explanation ?? "",
          observed: run.observations,
          studentCause: active.studentHypothesis ?? "",
          revisionReason: active.revisionReason ?? "",
          aiAnalyses: active.aiAnalyses ?? [],
          createdAt: new Date(run.endedAt ?? run.startedAt).toISOString(),
          visual: comparison,
        }
      : null,
    running,
  );
  state.gptQuestion = attemptHistory.gptQuestion;
  state.revisionJourney = paperRevisionJourney(
    active,
    records,
    attemptHistory.items,
    draftTargets,
    selectedTransform,
    stage,
  );
  const published = attemptHistory.reviewed
    ? {
        ...attemptHistory.reviewed.visual,
        stage: 6,
        review: attemptHistory.meta,
      }
    : comparison
      ? { ...comparison, review: attemptHistory.meta }
      : null;
  const comparisonKey = JSON.stringify(published);
  useLayoutEffect(() => {
    publishSquareVisual(visualOwner, published);
  }, [visualOwner, comparisonKey]);
  useLayoutEffect(() => () => clearSquareVisual(visualOwner), [visualOwner]);
  const ai = useLearningAi(context);
  if (attemptHistory.reviewed)
    return (
      <>
        <SquareAttemptHistory history={attemptHistory} locked={running} />
        <SquareAttemptReview attempt={attemptHistory.reviewed} />
      </>
    );
  return (
    <>
      <PaperCoordinateStudyView
        state={state}
        actions={actions}
        ai={ai}
        prepareAiAnalysis={prepareAiAnalysis}
      />
      <SquareAttemptHistory history={attemptHistory} locked={running} />
      <LearningAiFeedback ai={ai} />
    </>
  );
}
