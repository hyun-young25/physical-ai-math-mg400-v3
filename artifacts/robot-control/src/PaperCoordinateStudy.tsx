import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LessonPose } from "./curriculum";
import { PaperCoordinateStudyView } from "./PaperCoordinateStudyView";
import type { PaperCoordinateStudyViewState, PaperLessonStage } from "./paperCoordinateViewModel";
import {
  PAPER_ANGLE_TOLERANCE_DEG, PAPER_GRID_SIZE_CM, PAPER_MEASURE_TOLERANCE_MM, PAPER_SAMPLE_MAX_AGE_MS,
  PAPER_TARGETS, comparePaperPredictionToFrame, diagnosePaperRun, frameInversePoint, frameTransformPoint,
  makePaperPlanHash, studentTransformPoint, validatePaperFrame, validatePaperRunForDiagnosis, paperRevalidationScope,
} from "./paperCoordinateStudy";
import type {
  PaperCoordinateLevel, PaperDiagnosis, PaperEvidenceSource, PaperFrame, PaperGridPoint, PaperPointName,
  PaperPoseObservation, PaperPredictionPoint, PaperReferenceSample, PaperRunSnapshot, PaperStudentTransform,
  PaperTargetSet, PaperTrialRecord,
} from "./paperCoordinateStudy";
import type { PaperCoordinateStudyViewActions } from "./paperCoordinateViewModel";
import { LearningAiFeedback, useLearningAi } from "./LearningAiFeedback";
import { privateText, type FeedbackContext } from "./learningAiContext";
import { usePractice } from "./PracticeProvider";
import { readEvidence, writeEvidence, downloadEvidence } from "./learningEvidenceStorage";
import { measurementFresh, targetProblem, workspaceFindings } from "./practiceSession";
import type { PracticeOperation, RobotMeasurement } from "./practiceSession";

const STORAGE_KEY = "physical-ai-paper-coordinate-v1";
const EMPTY_TRANSFORM: PaperStudentTransform = {
  originX: "", originY: "", axisDirection: "", millimetersPerCentimeter: "", rotationDegrees: "", explanation: "",
};
const EMPTY_POSE = { x: "", y: "", z: "", r: "" };
const emptyManualInputs = () => ({ O: { ...EMPTY_POSE }, X: { ...EMPTY_POSE }, Y: { ...EMPTY_POSE } });
const isRecord = (value: unknown): value is PaperTrialRecord => !!value && typeof value === "object"
  && (value as PaperTrialRecord).task === "paper-coordinate" && (value as PaperTrialRecord).version === 1
  && typeof (value as PaperTrialRecord).id === "string";
const timeIso = () => new Date().toISOString();
const poseDistance = (a: LessonPose, b: LessonPose) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const freshRecords = () => readEvidence(STORAGE_KEY, isRecord).map(record => {
  if (record.run?.status !== "running") return record;
  const run = { ...record.run, status: "partial" as const, endedAt: Date.now(), error: "새로고침으로 실행이 끝났습니다. 완료로 처리하지 않습니다." };
  return { ...record, run, status: "incomplete" as const, updatedAt: timeIso() };
});

export type PaperCoordinateStudyProps = {
  onBack: () => void;
  hardwareConnected: boolean;
  currentPose: LessonPose;
  canReach: (pose: LessonPose) => boolean;
  runDigitalTwin: (commands: LessonPose[]) => Promise<void>;
};

export function PaperCoordinateStudy({ onBack, hardwareConnected, currentPose, canReach, runDigitalTwin }: PaperCoordinateStudyProps) {
  const practice = usePractice();
  const practiceRef = useRef(practice);
  practiceRef.current = practice;
  const [records, setRecords] = useState<PaperTrialRecord[]>(freshRecords);
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const [activeId, setActiveId] = useState<string | null>(() => freshRecords().at(-1)?.id ?? null);
  const [stage, setStage] = useState<PaperLessonStage>(() => (freshRecords().at(-1)?.stage as PaperLessonStage) ?? 1);
  const [level, setLevel] = useState<PaperCoordinateLevel>(() => freshRecords().at(-1)?.level ?? "basic");
  const [transformDraft, setTransformDraft] = useState<PaperStudentTransform>(() => freshRecords().at(-1)?.transform ?? { ...EMPTY_TRANSFORM });
  const [manualInputs, setManualInputs] = useState(emptyManualInputs);
  const [predictionDraft, setPredictionDraft] = useState<PaperPredictionPoint[]>([]);
  const [inkDraft, setInkDraft] = useState<Array<{ point: string; xCm: number | null; yCm: number | null }>>([]);
  const [hypothesisDraft, setHypothesisDraft] = useState("");
  const [revisionDraft, setRevisionDraft] = useState("");
  const [liftDraft, setLiftDraft] = useState("");
  const [saveState, setSaveState] = useState<PaperCoordinateStudyViewState["saveState"]>("ready");
  const [saveMessage, setSaveMessage] = useState("");
  const [referenceError, setReferenceError] = useState("");
  const [transformFeedback, setTransformFeedback] = useState("");
  const [predictionFeedback, setPredictionFeedback] = useState("");
  const [pageError, setPageError] = useState("");
  const [running, setRunning] = useState(false);
  const activeRunRef = useRef(false);
  const [diagnosisOverride, setDiagnosisOverride] = useState<PaperDiagnosis | null>(null);

  const active = records.find(record => record.id === activeId) ?? records.at(-1) ?? null;
  const currentTargetSet: PaperTargetSet = active?.targetSet ?? "initial";
  const targetPoints = PAPER_TARGETS[currentTargetSet];
  const frame = active?.frame ?? null;
  const samples = active?.referenceSamples ?? frame?.samples ?? [];
  const currentMeasurement = practice.snap.measurement;
  const measurementAvailable = practice.snap.connection === "connected" && measurementFresh(currentMeasurement)
    && !currentMeasurement?.moving && !currentMeasurement?.error;
  const currentPoseRead = measurementAvailable ? currentMeasurement!.pose : null;
  const currentSource = measurementAvailable ? currentMeasurement!.source : null;
  const currentSequence = measurementAvailable ? currentMeasurement!.seq : null;
  const currentMeasuredAt = measurementAvailable ? currentMeasurement!.measuredAt : null;
  const currentSystem = measurementAvailable ? `User ${currentMeasurement!.user} / Tool ${currentMeasurement!.tool}` : "";
  const currentUser = measurementAvailable ? currentMeasurement!.user : practice.setupDraft.user;
  const currentTool = measurementAvailable ? currentMeasurement!.tool : practice.setupDraft.tool;
  const coordinatesVerified = !!practice.setupDraft.verified.coordinates
    && !!practice.snap.setup?.verified.coordinates
    && (!measurementAvailable || (currentMeasurement!.user === practice.snap.setup!.user && currentMeasurement!.tool === practice.snap.setup!.tool));
  const selectedTransform = transformDraft;
  const draftTargets = useMemo(() => targetPoints.map(point => {
    const existing = predictionDraft.find(item => item.name === point.name)
      ?? active?.predictions?.find(item => item.name === point.name);
    return existing ?? { ...point, robotX: "", robotY: "", robotZ: "", robotR: "" };
  }), [targetPoints, predictionDraft, active?.predictions]);
  const predictionsComplete = draftTargets.length === 3
    && draftTargets.every(point => [point.robotX, point.robotY].every(value => value.trim() !== "" && Number.isFinite(Number(value))));
  const persistedPredictions = active?.predictions ?? [];
  const selectedPlanHash = active?.planHash ?? "";
  const surfaceZ = frame ? frame.samples.reduce((sum, sample) => sum + sample.pose.z, 0) / frame.samples.length : null;
  const originPose = frame?.samples.find(sample => sample.point === "O")?.pose ?? null;
  const liftRecord = active?.liftHeight;
  const liftHeight = liftRecord?.z ?? (Number.isFinite(Number(liftDraft)) && liftDraft.trim() ? Number(liftDraft) : null);
  const transformComplete = !!frame && !!selectedTransform.axisDirection
    && [selectedTransform.originX, selectedTransform.originY, selectedTransform.millimetersPerCentimeter, selectedTransform.rotationDegrees]
      .every(value => value.trim() !== "" && Number.isFinite(Number(value)))
    && Number(selectedTransform.millimetersPerCentimeter) > 0 && !!selectedTransform.explanation.trim();
  const planHash = frame && active?.transform && persistedPredictions.length === 3
    ? `${makePaperPlanHash(frame.id, currentTargetSet, active.transform, persistedPredictions)}|lift:${liftHeight ?? "unset"}` : "";
  const samePlan = !!planHash && planHash === selectedPlanHash
    && JSON.stringify(transformDraft) === JSON.stringify(active?.transform)
    && JSON.stringify(draftTargets) === JSON.stringify(persistedPredictions);
  const run = active?.run ?? null;
  const dtReadyForPhysical = !!active?.dtRunPlanHash && active.dtRunPlanHash === planHash;

  const saveAll = useCallback((nextRecords: PaperTrialRecord[], message = "학습 근거를 브라우저에 저장했습니다.") => {
    recordsRef.current = nextRecords;
    setRecords(nextRecords);
    setSaveState("saving");
    const ok = writeEvidence(STORAGE_KEY, nextRecords);
    setSaveState(ok ? "saved" : "failed");
    setSaveMessage(ok ? message : "브라우저 저장에 실패했습니다. 화면을 닫기 전에 기록을 내보내세요.");
  }, []);
  const upsert = useCallback((record: PaperTrialRecord, message?: string) => {
    const updated = { ...record, updatedAt: timeIso() };
    const current = recordsRef.current;
    const index = current.findIndex(item => item.id === updated.id);
    const next = index < 0 ? [...current, updated] : current.map(item => item.id === updated.id ? updated : item);
    setActiveId(updated.id);
    saveAll(next, message);
    return updated;
  }, [saveAll]);
  const createTrial = useCallback((options: {
    targetSet: PaperTargetSet; level: PaperCoordinateLevel; parentAttemptId: string | null;
    frame?: PaperFrame; referenceSamples?: PaperReferenceSample[]; transform?: PaperStudentTransform; liftHeight?: PaperTrialRecord["liftHeight"];
  }) => {
    const previousAttempts = recordsRef.current.filter(record => record.task === "paper-coordinate").length;
    const created: PaperTrialRecord = {
      id: crypto.randomUUID(), task: "paper-coordinate", version: 1, attempt: previousAttempts + 1,
      parentAttemptId: options.parentAttemptId, targetSet: options.targetSet, level: options.level,
      status: options.frame ? "model" : "references", stage: options.frame ? 2 : 1,
      dataSource: options.frame?.source ?? "teacher", createdAt: timeIso(), updatedAt: timeIso(),
      ...(options.frame ? { frame: options.frame } : {}),
      ...(options.referenceSamples ? { referenceSamples: options.referenceSamples } : {}),
      ...(options.transform ? { transform: options.transform } : {}),
      ...(options.liftHeight ? {liftHeight:options.liftHeight}:{}),
    };
    upsert(created, "새 시도가 이전 기록과 연결되어 저장되었습니다.");
    setStage((options.frame ? 2 : 1) as PaperLessonStage);
    setLevel(options.level);
    setTransformDraft(options.transform ?? { ...EMPTY_TRANSFORM });
    setPredictionDraft(PAPER_TARGETS[options.targetSet].map(point => ({ ...point, robotX: "", robotY: "", robotZ: "", robotR: "" })));
    setInkDraft(PAPER_TARGETS[options.targetSet].map(point => ({ point: point.name, xCm: null, yCm: null })));
    setDiagnosisOverride(null);
    setPageError("");
    setTransformFeedback("");
    setPredictionFeedback("");
    setReferenceError("");
    return created;
  }, [upsert]);

  useEffect(() => {
    if (!active) return;
    setStage((active.stage as PaperLessonStage) ?? (active.frame ? 2 : 1));
    setLevel(active.level);
    setTransformDraft(active.transform ?? { ...EMPTY_TRANSFORM });
    setPredictionDraft(active.predictions ?? PAPER_TARGETS[active.targetSet].map(point => ({ ...point, robotX: "", robotY: "", robotZ: "", robotR: "" })));
    setInkDraft(active.inkReadings?.map(reading => ({ point: reading.point, xCm: reading.xCm, yCm: reading.yCm }))
      ?? PAPER_TARGETS[active.targetSet].map(point => ({ point: point.name, xCm: null, yCm: null })));
    setHypothesisDraft(active.studentHypothesis ?? "");
    setRevisionDraft(active.revisionReason ?? "");
    setLiftDraft(active.liftHeight ? String(active.liftHeight.z) : "");
  }, [active?.id]);

  useEffect(() => {
    activeRunRef.current = running;
  }, [running]);
  useEffect(() => () => {
    const currentPractice = practiceRef.current;
    currentPractice.cancelConfirmation();
    if (activeRunRef.current && currentPractice.snap.source) currentPractice.session.stop();
  }, []);

  const currentTransform = (field: keyof PaperStudentTransform, value: string) => {
    if (running) return;
    setTransformDraft(previous => ({ ...previous, [field]: value }));
    setTransformFeedback("");
    setDiagnosisOverride(null);
  };

  const saveReference = (sample: PaperReferenceSample) => {
    let current = active ?? createTrial({ targetSet: currentTargetSet, level, parentAttemptId: null });
    if (current.run) {
      setPageError("새 기준점은 기존 실행 기록을 덮어쓰지 않습니다. 수정 이유를 저장한 뒤 새 시도를 시작하세요.");
      return;
    }
    const nextSamples = [...(current.referenceSamples ?? []), sample];
    const uniqueSamples = [...nextSamples.filter(item => item.point !== sample.point), sample]
      .sort((a, b) => ["O", "X", "Y"].indexOf(a.point) - ["O", "X", "Y"].indexOf(b.point));
    const validation = uniqueSamples.length === 3 ? validatePaperFrame(uniqueSamples) : null;
    const validFrame = validation?.ok ? validation.frame : undefined;
    setReferenceError(validation && !validation.ok ? validation.reason : "");
    const updated = upsert({
      ...current, referenceSamples: uniqueSamples, ...(validFrame ? { frame: validFrame } : { frame: undefined }),
      dataSource: uniqueSamples[0]?.source ?? "teacher", status: validFrame ? "model" : "references",
      stage: validFrame ? 2 : 1, transform: undefined, predictions: undefined, planHash: undefined,
      run: undefined, diagnosis: undefined, dtRunPlanHash: undefined,
    });
    setStage((validFrame ? 2 : 1) as PaperLessonStage);
    if (validFrame) {
      setTransformDraft({ ...EMPTY_TRANSFORM });
      setPredictionDraft(PAPER_TARGETS[updated.targetSet].map(point => ({ ...point, robotX: "", robotY: "", robotZ: "", robotR: "" })));
      setTransformFeedback("기준점이 규칙 검사를 통과했습니다. 정답 변환식이나 로봇 목표 좌표는 채우지 않았습니다.");
    }
  };

  const actions: PaperCoordinateStudyViewActions = {
    onBack,
    onExport: () => downloadEvidence("paper-coordinate-evidence.json", {version:1,scope:"TCP 보고 좌표와 잉크 읽기를 구분한 학습 기록",records}),
    onStageChange: nextStage => {
      if (running) return;
      const required = nextStage >= 2 && !active?.frame ? "O/X/Y 기준점을 먼저 저장하세요."
        : nextStage >= 3 && !active?.transform ? "변환 관계를 먼저 저장하세요."
        : nextStage >= 4 && !active?.predictions?.length ? "좌표 예측을 먼저 저장하세요."
        : nextStage >= 5 && active?.run?.status !== "completed" ? "현재 예측의 실행을 먼저 완료하세요."
        : nextStage >= 7 && (!active?.studentHypothesis?.trim() || active.diagnosis?.status!=="complete") ? "관측을 비교하고 원인 가설을 먼저 저장하세요." : "";
      if (required) { setPageError(required); return; }
      setPageError("");
      setStage(nextStage);
      if (active) upsert({ ...active, stage: nextStage });
      if (nextStage === 6 && active?.run && active.frame && active.planHash) {
        const invalid = validatePaperRunForDiagnosis(active.run, active.frame, active.planHash);
        if (invalid) {
          const invalidDiagnosis: PaperDiagnosis = {
            method: "rule-based", source: active.run.source, status: "invalidated",
            candidate: invalid, evidence: [], predictionEvidence: [], firstMismatch: null,
            question: "어떤 새 관측이 있어야 이 결과를 비교할 수 있을까요?",
            why: "이 단계는 현재 기준점과 저장된 예측에 연결된 관측만 사용합니다.",
            tutorSource: "default question",
          };
          setDiagnosisOverride(invalidDiagnosis);
        } else {
          const initial = diagnosePaperRun(active.run,active.frame,active.planHash,{transform:active.transform,toleranceMm:practice.setupDraft.positionTolerance});
          const repeated = records.filter(r=>r.id!==active.id && r.diagnosis?.pattern===initial.pattern).length;
          const enriched = diagnosePaperRun(active.run,active.frame,active.planHash,{transform:active.transform,toleranceMm:practice.setupDraft.positionTolerance,repeated});
          let diagnosed: PaperTrialRecord = {...active,diagnosis:enriched,status:"diagnosed",stage:6,diagnosisToleranceMm:practice.setupDraft.positionTolerance};
          const parent = records.find(r=>r.id===active.parentAttemptId);
          const scope = paperRevalidationScope(diagnosed,parent);
          if (scope) diagnosed={...diagnosed,status:"revalidated",revalidation:{parentAttemptId:parent!.id,runId:active.run.id,source:active.run.source,checkedAt:Date.now(),scope}};
          setDiagnosisOverride(enriched);
          upsert(diagnosed,scope??"진단 근거와 실제 제공 질문을 저장했습니다.");
        }
      }
    },
    onLevelChange: nextLevel => {
      if (running) return;
      if (active?.run) { setPageError("실행이 있는 시도는 그대로 보존합니다. 수준 변경은 다음 시도에서 선택하세요."); return; }
      setLevel(nextLevel);
      if (active) upsert({ ...active, level: nextLevel });
    },
    onRecordCurrentReference: point => {
      if (running) return;
      if (!measurementAvailable || !currentMeasurement || !currentMeasurement.pose) {
        setReferenceError("현재 연결의 최신 측정값이 없습니다. 제조사 프로그램에서 기준점에 맞춘 뒤, 연결 상태와 새 TCP 보고 좌표를 확인하세요.");
        return;
      }
      if (!coordinatesVerified) {
        setReferenceError("좌표계·공구 준비 확인이 끝나지 않았습니다. 기존 연결·준비 확인을 먼저 완료하세요.");
        return;
      }
      const sample: PaperReferenceSample = {
        point, pose: { ...currentMeasurement.pose }, source: currentMeasurement.source,
        seq: currentMeasurement.seq, capturedAt: currentMeasurement.receivedAt,
        ageMsAtCapture: currentMeasurement.ageMs, user: currentMeasurement.user, tool: currentMeasurement.tool,
        coordinateSystem: `User ${currentMeasurement.user} / Tool ${currentMeasurement.tool}`,
        verifiedCoordinates: coordinatesVerified,
      };
      saveReference(sample);
    },
    onManualReferenceChange: (point, field, value) => setManualInputs(previous => ({
      ...previous, [point]: { ...previous[point], [field]: value },
    })),
    onSaveManualReference: point => {
      if (running) return;
      const values = manualInputs[point];
      const pose = { x: Number(values.x), y: Number(values.y), z: Number(values.z), r: Number(values.r) };
      if (!Object.values(values).every(v=>v.trim()) || !Object.values(pose).every(Number.isFinite)) { setReferenceError(`${point} 좌표를 모두 입력하세요.`); return; }
      const sample: PaperReferenceSample = {
        point, pose, source: "teacher", seq: null, capturedAt: Date.now(), ageMsAtCapture: null,
        user: currentUser, tool: currentTool, coordinateSystem: `교사 입력 · User ${currentUser} / Tool ${currentTool}`,
        verifiedCoordinates: coordinatesVerified,
      };
      saveReference(sample);
      setReferenceError("교사 입력 좌표입니다. 실측이 아니며 실장비 실행 기준점으로 사용할 수 없습니다.");
    },
    onTransformChange: currentTransform,
    onSaveTransform: () => {
      if (running) return;
      const values = transformDraft;
      if (!frame || !values.axisDirection || !values.explanation.trim()
        || ![values.originX, values.originY, values.millimetersPerCentimeter, values.rotationDegrees].every(value => value.trim() && Number.isFinite(Number(value)))
        || Number(values.millimetersPerCentimeter) <= 0) {
        setTransformFeedback("원점·축·단위 배율·회전과 선택 이유를 입력하세요.");
        return;
      }
      if (active?.run) {
        setTransformFeedback("이전 실행은 덮어쓰지 않습니다. 7단계에서 이유를 저장하고 새 시도를 만든 뒤 수정하세요.");
        return;
      }
      const testPoints: PaperGridPoint[] = [{ name: "O", xCm: 0, yCm: 0 }, { name: "X", xCm: 10, yCm: 0 }, { name: "Y", xCm: 0, yCm: 10 }];
      const predicted = testPoints.map(point => studentTransformPoint(values, point));
      const framePoints = testPoints.map(point => frameTransformPoint(frame, point));
      const errors = predicted.map((pose, index) => pose ? Math.hypot(pose.x - framePoints[index].x, pose.y - framePoints[index].y) : Infinity);
      const message = errors.every(error => error <= PAPER_MEASURE_TOLERANCE_MM)
        ? "규칙 비교에서 입력한 관계가 기준점 좌표와 예비 허용범위 안에 있습니다. 이것은 변환식 설명에 대한 확정 판정이 아닙니다."
        : "입력한 관계와 기준점 좌표 사이에 차이가 있습니다. 원인을 확정하지 않고, 이 관계를 사용한 예측을 직접 작성할 수 있습니다.";
      const updated = upsert({
        ...(active ?? createTrial({ targetSet: currentTargetSet, level, parentAttemptId: null, frame, referenceSamples: samples })),
        frame, referenceSamples: samples, transform: values, status: "model", stage: 2,
        predictions: undefined, planHash: undefined, run: undefined, diagnosis: undefined, dtRunPlanHash: undefined,
        predictionModelComparison: errors.map((distance, index) => ({ point: testPoints[index].name, dx: predicted[index]?.x! - framePoints[index].x, dy: predicted[index]?.y! - framePoints[index].y, distance })),
      });
      setStage(2);
      setPredictionDraft(PAPER_TARGETS[updated.targetSet].map(point => ({ ...point, robotX: "", robotY: "", robotZ: "", robotR: "" })));
      setTransformFeedback(message);
    },
    onPredictionChange: (point, field, value) => {
      if (running) return;
      setPredictionFeedback("");
      setPredictionDraft(previous => {
        const current = previous.length ? previous : targetPoints.map(target => ({ ...target, robotX: "", robotY: "", robotZ: "", robotR: "" }));
        return current.map(item => item.name === point ? { ...item, [field]: value } : item);
      });
    },
    onSavePrediction: () => {
      if (running) return;
      if (!active?.frame || !active.transform || !predictionsComplete) {
        setPredictionFeedback("먼저 학생의 변환 관계를 저장하고 세 목표의 X·Y 좌표를 직접 입력하세요.");
        return;
      }
      if (active.run) {
        setPredictionFeedback("이전 실행은 보존됩니다. 원인 가설과 수정 이유를 저장한 뒤 새 시도로 다시 예측하세요.");
        return;
      }
      const values = draftTargets.map(point => ({ ...point, robotZ: "", robotR: "" }));
      const hash = `${makePaperPlanHash(active.frame.id, active.targetSet, active.transform, values)}|lift:${liftHeight ?? "unset"}`;
      const modelComparison = comparePaperPredictionToFrame(active.frame, values);
      upsert({
        ...active, predictions: values, planHash: hash, predictionModelComparison: modelComparison,
        status: "prediction", stage: 3, run: undefined, diagnosis: undefined,
        dtRunPlanHash: active.dtRunPlanHash === hash ? active.dtRunPlanHash : undefined,
      }, "예측과 실행 전 스냅샷을 저장했습니다.");
      setStage(3);
      const firstMismatch = modelComparison.find(item => item.distance > PAPER_MEASURE_TOLERANCE_MM);
      setPredictionFeedback(firstMismatch
        ? "예측을 저장했습니다. 일부 점에서 학생 입력과 기준점 기반 관계가 다릅니다. 원인을 미리 판단하지 않고 실행·관측 후 비교합니다."
        : "예측을 저장했습니다. 이 저장본이 실행 계획의 기준이며 이후 입력이 바뀌면 새 시도로 다시 확인합니다.");
    },
    onRunDT: () => void executeRun("dt"),
    onRunPhysical: () => void executeRun("connected"),
    onRecordCurrentLiftHeight: () => {
      if (running) return;
      if (active?.run) { setPageError("이전 실행은 보존합니다. 수정 이유를 저장하고 새 시도에서 높이를 다시 기록하세요."); return; }
      if (!measurementAvailable || !currentMeasurement || !coordinatesVerified) {
        setPageError("최신 위치와 확인된 좌표계 설정이 필요합니다. 제조사 프로그램에서 펜을 들어 올린 뒤 현재 TCP 보고 좌표를 기록하세요.");
        return;
      }
      if (currentMeasurement.source === "hardware" && frame?.source !== "hardware") {
        setPageError("실장비 높이는 실장비 기준점이 있는 프레임에만 연결할 수 있습니다.");
        return;
      }
      if (surfaceZ === null || currentMeasurement.pose.z <= surfaceZ) {
        setPageError("펜 들기 높이는 기록한 종이 표면보다 높아야 합니다. 위치 이동은 제조사 프로그램에서 직접 하세요.");
        return;
      }
      if (!active) { setPageError("먼저 O/X/Y 기준점을 저장하세요."); return; }
      const lift = {
        z: currentMeasurement.pose.z, source: currentMeasurement.source, seq: currentMeasurement.seq,
        capturedAt: currentMeasurement.receivedAt, ageMsAtCapture: currentMeasurement.ageMs,
        user: currentMeasurement.user, tool: currentMeasurement.tool, coordinateSystem: currentSystem,
      };
      upsert({ ...active, liftHeight: lift, planHash: active.transform && active.predictions ? `${makePaperPlanHash(active.frame!.id,active.targetSet,active.transform,active.predictions)}|lift:${lift.z}` : undefined, dtRunPlanHash: undefined, run: undefined, diagnosis: undefined });
      setLiftDraft(String(lift.z));
      setPageError("현재 위치의 Z를 기록했습니다. 이 값은 제조사 프로그램에서 읽은 제어기 보고 위치이며, 펜의 물리적 상태는 교사가 확인해야 합니다.");
    },
    onLiftHeightChange: value => {
      if (running) return;
      if (active?.run) { setPageError("이전 실행은 보존합니다. 수정 이유를 저장하고 새 시도에서 높이를 조정하세요."); return; }
      setLiftDraft(value);
      const number = Number(value);
      if (active && !value.trim()) upsert({...active,liftHeight:undefined,planHash:undefined,dtRunPlanHash:undefined});
      if (active && value.trim() && Number.isFinite(number)) {
        upsert({
          ...active,
          liftHeight: {
            z: number, source: "teacher", seq: null, capturedAt: Date.now(), ageMsAtCapture: null,
            user: currentUser, tool: currentTool, coordinateSystem: `교사 입력 · User ${currentUser} / Tool ${currentTool}`,
          },
          planHash: active.transform && active.predictions ? `${makePaperPlanHash(active.frame!.id,active.targetSet,active.transform,active.predictions)}|lift:${number}` : undefined, dtRunPlanHash: undefined, run: undefined, diagnosis: undefined,
        });
      }
    },
    onToleranceChange: (field, value) => {
      const number = Number(value);
      if (!Number.isFinite(number) || number <= 0 || number > 5) { setPageError("허용오차는 0 초과 5 이하로 설정하세요."); return; }
      practice.setSetupDraft({ ...practice.setupDraft, [field]: number });
      setPageError("허용오차를 바꿨습니다. 기존 장비 준비 확인은 무효화되었습니다. 실장비 전에는 연결·준비 절차를 다시 완료하세요.");
    },
    onInkReadingChange: (point, axis, value) => {
      const number = value.trim() ? Number(value) : null;
      setInkDraft(previous => {
        const rows = previous.length ? previous : targetPoints.map(target => ({ point: target.name, xCm: null, yCm: null }));
        return rows.map(row => row.point === point ? { ...row, [axis]: number !== null && Number.isFinite(number) ? number : null } : row);
      });
    },
    onSaveInkReadings: () => {
      if (running) return;
      if (!active) { setPageError("실행한 시도를 먼저 저장하세요."); return; }
      const readings = inkDraft.filter(row => row.xCm !== null && row.yCm !== null)
        .map(row => ({ ...row, recordedAt: Date.now() }));
      const status = active.diagnosis?.status === "complete" ? "diagnosed" as const
        : active.run?.status === "completed" && active.run.observations.length === targetPoints.length
          ? "observed" as const : "incomplete" as const;
      upsert({ ...active, inkReadings: readings, status, stage: 5 }, "학생이 눈금에서 읽은 잉크 좌표를 제어기 관측과 분리해 저장했습니다.");
      setPageError(readings.length < targetPoints.length ? "일부 잉크 좌표가 비어 있습니다. 비어 있는 점은 확인하지 않은 상태로 기록했습니다." : "");
    },
    onSaveHypothesis: value => {
      if (!active) { setPageError("현재 시도를 저장한 뒤 원인 가설을 작성하세요."); return; }
      if (!value.trim()) { setPageError("관측 차이에 대한 학생의 가설을 한 문장 이상 적으세요."); return; }
      const updated = upsert({ ...active, studentHypothesis: value.trim(), status: active.revalidation ? "revalidated" : "reasoned", stage: 6 });
      setHypothesisDraft(value.trim());
      setStage(6);
      if (updated.diagnosis?.status !== "complete") setPageError("진단 자료가 완성되지 않았습니다. 가설은 저장했지만 재검증 완료로 표시하지 않습니다.");
    },
    onRevise: reason => {
      if (!active?.frame || !active.run || active.run.status !== "completed" || !active.studentHypothesis?.trim()) {
        setPageError("같은 시도의 새 실행 결과와 원인 가설을 저장한 뒤 수정할 수 있습니다.");
        return;
      }
      if (!reason.trim()) { setPageError("수정 이유를 적어야 새 시도를 시작할 수 있습니다."); return; }
      const parent = upsert({
        ...active, revisionReason: reason.trim(), status: "revised", stage: 7, revalidationTarget: "revalidation",
      }, "수정 이유와 이전 시도의 연결을 저장했습니다.");
      const child = createTrial({
        targetSet: "revalidation", level: parent.level, parentAttemptId: parent.id,
        frame: parent.frame, referenceSamples: parent.referenceSamples, transform: transformDraft, liftHeight: parent.liftHeight,
      });
      setRevisionDraft(reason.trim());
      setTransformDraft(transformDraft);
      setStage(2);
      setPageError(`새 시도 ${child.attempt}가 이전 시도 ${parent.attempt}와 연결됐습니다. 새 목표점 D/E/F를 예측하세요.`);
    },
    onChooseNewTarget: () => {
      if (active?.targetSet === "revalidation") { setStage(3); return; }
      if (!active?.revisionReason?.trim() || !active.studentHypothesis?.trim()) {
        setPageError("먼저 원인 가설과 수정 이유를 저장하세요.");
        return;
      }
      const child = createTrial({
        targetSet: "revalidation", level: active.level, parentAttemptId: active.id,
        frame: active.frame, referenceSamples: active.referenceSamples, transform: transformDraft, liftHeight: active.liftHeight,
      });
      setStage(3);
      setPageError(`새 목표점 D/E/F를 위한 시도 ${child.attempt}가 연결됐습니다.`);
    },
    onMovePaper: () => {
      if (!active?.studentHypothesis?.trim() || !revisionDraft.trim()) { setPageError("원인 가설과 수정 이유를 적어 주세요."); return; }
      const parent = upsert({ ...active, revisionReason:revisionDraft.trim(), status: active.run ? "revised" : active.status, revalidationTarget: "revalidation", stage: 7 });
      createTrial({ targetSet: "revalidation", level: parent.level, parentAttemptId: parent.id });
      setManualInputs(emptyManualInputs());
      setPageError("종이 위치가 바뀐 새 시도입니다. 기존 기준점·승인·관측은 재사용하지 않습니다.");
    },
  };

  async function executeRun(kind: "dt" | "connected") {
    if (running) return;
    if (active?.run?.source !== "dt" && active?.run) {
      setPageError("연결된 실행 기록은 보존합니다. 수정 이유를 적고 새 시도에서 다시 실행하세요."); return;
    }
    if (!active?.frame || !active.transform || !samePlan || persistedPredictions.length !== 3) {
      setPageError("현재 기준점·변환식·예측이 같은 저장본인지 확인하세요. 바뀐 계획에는 새 예측이 필요합니다.");
      return;
    }
    if (liftHeight === null || !Number.isFinite(liftHeight) || surfaceZ === null || liftHeight <= surfaceZ) {
      setPageError("기록한 종이 표면보다 높은 펜 들기 Z를 정하세요. 실장비 높이는 제조사 프로그램에서 사람이 확인한 위치만 기록하세요.");
      return;
    }
    const O = active.frame.samples.find(sample => sample.point === "O")!;
    const points = persistedPredictions.map(prediction => ({
      point: prediction.name,
      pose: {
        x: Number(prediction.robotX), y: Number(prediction.robotY),
        z: surfaceZ, r: O.pose.r,
      } satisfies LessonPose,
    }));
    if (points.some(item => !Object.values(item.pose).every(Number.isFinite))) {
      setPageError("저장된 예측 좌표가 유효하지 않습니다.");
      return;
    }
    const now = Date.now();
    const simStart = { ...currentPose };
    const liveMeasurement = practice.snap.measurement;
    const liveSource = practice.snap.source;
    const source: PaperEvidenceSource = kind === "dt" ? "dt" : liveSource ?? "hardware";
    const startPose = kind === "dt" ? simStart : liveMeasurement?.pose;
    if (!startPose) { setPageError("실행 전 위치를 확인할 측정값이 없습니다."); return; }
    const safeZ = Math.max(startPose.z, liftHeight);
    const operations: PracticeOperation[] = [];
    const commands: LessonPose[] = [
      { x: startPose.x, y: startPose.y, z: safeZ, r: O.pose.r },
    ];
    operations.push({ kind: "move", motion: "MoveL", target: commands[0] });
    const captureIndices = new Map<number, string>();
    for (const point of points) {
      const elevated = { x: point.pose.x, y: point.pose.y, z: safeZ, r: O.pose.r };
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
    if (operations.length > 30) { setPageError("실행 계획의 명령 수가 허용 범위를 넘었습니다."); return; }
    const invalidKinematics = commands.find(command => !canReach(command));
    if (invalidKinematics) { setPageError("현재 기구학 모델에서 도달 불가인 지점이 있어 실행을 시작하지 않았습니다."); return; }

    if (kind === "dt") {
      if (hardwareConnected) { setPageError("다른 실장비 연결이 있어 DT 이동을 중지했습니다. 우선 연결 상태를 정리하세요."); return; }
      const runningRecord: PaperRunSnapshot = {
        id: crypto.randomUUID(), planHash, frameId: active.frame.id, targetSet: active.targetSet,
        source: "dt", status: "running", startedAt: now, startSequence: null,
        commands: points.map(item => ({ point: item.point, pose: item.pose })), observations: [],
      };
      upsert({ ...active, run: runningRecord, status: "running", stage: 4, diagnosis: undefined, dataSource: "dt" });
      setRunning(true); setPageError(""); setStage(4);
      try {
        await runDigitalTwin(commands);
        const completedAt = Date.now();
        const observations: PaperPoseObservation[] = points.map(item => ({
          point: item.point, source: "dt", seq: null, measuredAt: completedAt, ageMs: null,
          pose: { ...item.pose }, command: { ...item.pose }, kind: "dt",
        }));
        const completedRun = { ...runningRecord, status: "completed" as const, endedAt: completedAt, observations };
        upsert({
          ...active, run: completedRun, status: "observed", stage: 4,
          dtRunPlanHash: planHash, diagnosis: undefined, dataSource: "dt",
        }, "DT 경로 완료를 저장했습니다. 이 자료는 실측이 아닙니다.");
        setPageError("DT 완료 · 실측 아님. 화면의 가상 경로가 종료됐습니다. 실장비 검증으로 표시하지 않습니다.");
      } catch (error) {
        const failedRun = { ...runningRecord, status: "failed" as const, endedAt: Date.now(), error: error instanceof Error ? error.message : "DT 실행 실패" };
        upsert({ ...active, run: failedRun, status: "incomplete", stage: 4 });
        setPageError(failedRun.error ?? "DT 실행을 완료하지 못했습니다.");
      } finally { setRunning(false); }
      return;
    }

    const setup = practice.snap.setup;
    const readiness = practice.session.readiness(true);
    if (hardwareConnected) { setPageError("기존 연결이 활성화되어 있습니다. 새 PC 브리지 경로와 혼합하지 마세요."); return; }
    if (!practice.hardware || !setup || !liveMeasurement || !measurementFresh(liveMeasurement)
      || !["hardware", "mock"].includes(liveSource ?? "")) {
      setPageError("실제 로봇 모드에서 새 브리지에 연결하고 최신 TCP 보고 좌표를 확인하세요. 오프라인 연습은 모의/DT를 사용하세요.");
      return;
    }
    if (liveSource === "hardware" && (active.frame.source !== "hardware" || active.liftHeight?.source !== "hardware")) {
      setPageError("실장비 실행에는 같은 좌표계의 실장비 기준점과 제조사 프로그램에서 기록한 들기 높이가 필요합니다.");
      return;
    }
    if (liveSource === "mock" && active.frame.source !== "mock") {
      setPageError("모의 실행에서도 기준점·높이 출처를 섞지 마세요. 모의 기준점으로 새 시도를 시작하세요.");
      return;
    }
    const lift = active.liftHeight;
    if (!lift || lift.source !== liveSource || lift.user !== setup.user || lift.tool !== setup.tool
      || lift.coordinateSystem !== `User ${setup.user} / Tool ${setup.tool}`
      || lift.ageMsAtCapture === null || lift.ageMsAtCapture > PAPER_SAMPLE_MAX_AGE_MS
      || !active.frame.samples.every(sample => sample.user === setup.user && sample.tool === setup.tool))
      { setPageError("기준점·들기 높이·실행 좌표계와 User/Tool이 모두 일치해야 합니다."); return; }
    if (readiness) { setPageError(`실행 전 준비 조건을 통과하지 못했습니다: ${readiness}`); return; }
    if (Math.hypot(liveMeasurement.pose.x - O.pose.x, liveMeasurement.pose.y - O.pose.y) > setup.positionTolerance
      || Math.abs(liveMeasurement.pose.z - surfaceZ) > setup.positionTolerance
      || Math.abs(liveMeasurement.pose.r - O.pose.r) > setup.rotationTolerance) {
      setPageError("사람이 제조사 프로그램에서 펜을 O에 맞추고 종이 표면 높이로 둔 뒤, 새 현재 위치를 확인하세요. 이 앱은 그 위치로 이동시키지 않습니다.");
      return;
    }
    const outside = commands.flatMap((command, index) => workspaceFindings(command, setup, `종이 좌표 실행 ${index + 1}`))
      .filter(finding => finding.kind === "outside");
    if (outside.length) { setPageError(outside.map(finding => `${finding.axis.toUpperCase()}=${finding.value} 범위 [${finding.min}, ${finding.max}] 밖`).join(" · ")); return; }
    const planeMismatch = persistedPredictions.some(prediction => {
      const point = points.find(item => item.point === prediction.name)!;
      return Math.abs(point.pose.z - surfaceZ) > setup.positionTolerance;
    });
    if (planeMismatch) { setPageError("종이 표면 높이 차이가 허용 범위를 넘습니다. 기준점을 다시 측정하세요."); return; }
    if (!dtReadyForPhysical) { setPageError("현재 계획과 같은 DT 실행을 먼저 완료해야 사람의 최종 실행 확인을 요청할 수 있습니다."); return; }

    const runId = crypto.randomUUID();
    const startSequence = liveMeasurement.seq;
    const runningRecord: PaperRunSnapshot = {
      id: runId, planHash, frameId: active.frame.id, targetSet: active.targetSet, source: liveSource!,
      status: "running", startedAt: Date.now(), startSequence,
      commands: points.map(item => ({ point: item.point, pose: item.pose })), observations: [],
    };
    upsert({ ...active, run: runningRecord, status: "running", stage: 4, diagnosis: undefined, dataSource: liveSource! });
    setRunning(true); setPageError("");
    const observed: PaperPoseObservation[] = [];
    try {
      const results = await practice.runOps(operations, liveSource === "mock"
        ? "모눈종이 좌표 변환 · 모의 브리지 시험 (실제 로봇은 움직이지 않음)"
        : "모눈종이 좌표 변환 · 저장된 학생 예측 실행 (제어기 TCP 보고 좌표만 측정)", (measurement, index, operation) => {
        const pointName = captureIndices.get(index);
        if (!pointName || operation.kind !== "move") return;
        observed.push({
          point: pointName, source: measurement.source, seq: measurement.seq,
          measuredAt: measurement.measuredAt, ageMs: measurement.ageMs,
          pose: { ...measurement.pose }, command: { ...operation.target },
          kind: measurement.source === "hardware" ? "controller-tcp" : "mock-bridge",
        });
      }, undefined);
      if (!results) {
        const cancelled = { ...runningRecord, status: "cancelled" as const, endedAt: Date.now(), observations: [] };
        upsert({ ...active, run: cancelled, status: "incomplete", stage: 4 }, "사람이 최종 실행 확인을 취소했습니다. 이동 명령은 전송되지 않았습니다.");
        setPageError("최종 확인이 취소됐습니다. 실행 측정은 0건입니다.");
      } else {
        const endedAt = Date.now();
        const completed = { ...runningRecord, status: "completed" as const, endedAt, observations: observed };
        const check = validatePaperRunForDiagnosis(completed, active.frame, planHash);
        const complete = !check && observed.length === points.length;
        upsert({
          ...active, run: complete ? completed : { ...completed, status: "partial" as const, error: check ?? "새 TCP 보고 좌표 꼭짓점 누락" },
          status: complete ? "observed" : "incomplete", stage: 4,
          ...(liveSource === "hardware" && complete ? { dataSource: "hardware" as const } : { dataSource: "mock" as const }),
        }, complete ? "같은 계획의 세 새 TCP 보고 좌표 응답을 기록했습니다." : "실행은 완료로 인정되지 않았습니다. 새 측정 근거가 부족합니다.");
        setPageError(complete
          ? liveSource === "mock" ? "모의 브리지 회신을 저장했습니다. 실측이 아니며 실제 로봇 증거로 사용할 수 없습니다." : "제어기 TCP 보고 좌표 응답을 저장했습니다. 잉크 접촉 측정은 아닙니다."
          : `실행 결과가 불완전합니다. ${check ?? "세 점의 새 응답이 모두 필요합니다."}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "실행을 완료하지 못했습니다.";
      const endedAt = Date.now();
      let observations = [...observed];
      const failedRun = { ...runningRecord, status: observations.length ? "partial" as const : "failed" as const, endedAt, observations, error: message };
      upsert({ ...active, run: failedRun, status: "incomplete", stage: 4 }, "실행 실패 또는 부분 결과를 완료로 승격하지 않고 기록했습니다.");
      setPageError(message);
    } finally { setRunning(false); }
  }

  const physicalReason = (() => {
    if (hardwareConnected) return "기존 연결이 활성화되어 있습니다. 다른 물리 연결을 혼합하지 마세요.";
    if (!practice.hardware) return "실장비 또는 모의 브리지 연결을 선택하고 기존 승인·준비 절차를 완료하세요.";
    if (practice.snap.connection !== "connected" || !practice.snap.source) return "로봇 옆 PC 브리지 연결이 필요합니다.";
    if (practice.snap.source === "hardware" && frame?.source !== "hardware") return "실제 TCP 보고 좌표 기준점 O/X/Y가 필요합니다.";
    if (!frame || !active?.transform || !samePlan || persistedPredictions.length !== 3) return "같은 기준점·예측으로 DT를 먼저 완료하세요.";
    if (!dtReadyForPhysical) return "현재 저장된 계획의 DT 완주가 필요합니다.";
    if (!liftRecord || liftRecord.source !== practice.snap.source || liftHeight === null || surfaceZ === null || liftHeight <= surfaceZ) return "측정된 종이 높이와 같은 출처의 펜 들기 높이가 필요합니다.";
    if (!practice.snap.setup || practice.session.readiness(true)) return practice.session.readiness(true) ?? "연결·준비·서보 확인을 완료하세요.";
    if (!frame.samples.every(sample => sample.user === practice.snap.setup!.user && sample.tool === practice.snap.setup!.tool)
      || liftRecord.user !== practice.snap.setup.user || liftRecord.tool !== practice.snap.setup.tool) return "기준점·높이·실행의 User/Tool 설정이 다릅니다.";
    if (!currentPoseRead || !originPose
      || poseDistance(currentPoseRead, { ...originPose, z: surfaceZ! }) > practice.snap.setup.positionTolerance) return "사람이 제조사 프로그램에서 O에 펜 끝을 맞춘 뒤, 현재 위치를 다시 확인하세요.";
    if (persistedPredictions.some(prediction => ![prediction.robotX, prediction.robotY].every(value => Number.isFinite(Number(value))))) return "세 점의 저장된 예측 좌표가 필요합니다.";
    const commands = persistedPredictions.map(prediction => ({ x: Number(prediction.robotX), y: Number(prediction.robotY), z: surfaceZ!, r: originPose!.r }));
    const unsafe = commands.find(command => targetProblem(command, practice.snap.setup!) || !canReach(command));
    if (unsafe) return targetProblem(unsafe, practice.snap.setup!) ?? "기구학 검사에서 도달 불가입니다.";
    return "";
  })();

  const state: PaperCoordinateStudyViewState = {
    records, revalidationScope:active?.revalidation?.scope??null,
    stage, level, targetSet: currentTargetSet, frame, samples, currentPose: currentPoseRead,
    currentSource, currentSequence, currentMeasuredAt,
    manualInputs,
    coordinateSystem: frame?.coordinateSystem ?? currentSystem,
    user: frame?.user ?? currentUser, tool: frame?.tool ?? currentTool,
    coordinatesVerified,
    referenceError,
    transform: selectedTransform, transformFeedback,
    targetPoints, predictions: draftTargets, predictionsReady: predictionsComplete,
    predictionFeedback,
    run,
    runAvailable: (!run || run.source === "dt") && !!frame && !!active?.transform && samePlan && persistedPredictions.length === 3
      && liftHeight !== null && persistedPredictions.every(item => [item.robotX, item.robotY].every(v => Number.isFinite(Number(v))))
      && persistedPredictions.every(item => canReach({
        x: Number(item.robotX), y: Number(item.robotY), z: surfaceZ ?? 0,
        r: frame.samples.find(sample => sample.point === "O")?.pose.r ?? 0,
      })),
    physicalAvailable: !physicalReason,
    physicalUnavailableReason: physicalReason,
    liftHeight,
    liftHeightSource: liftRecord?.source ?? null,
    liftHeightSequence: liftRecord?.seq ?? null,
    paperSurfaceZ: surfaceZ,
    positionTolerance: practice.setupDraft.positionTolerance,
    rotationTolerance: practice.setupDraft.rotationTolerance,
    convertedReadings: run?.observations.map(observation => {
      const mapped = frameInversePoint(frame!, observation.pose);
      return { point: observation.point, source: observation.source, seq: observation.seq, measuredAt: observation.measuredAt,
        xCm: mapped?.xCm ?? null, yCm: mapped?.yCm ?? null };
    }) ?? [],
    inkReadings: inkDraft,
    diagnosis: diagnosisOverride ?? active?.diagnosis ?? null,
    studentHypothesis: hypothesisDraft,
    revisionReason: revisionDraft,
    saveState, saveMessage, running, error: pageError,
  };

  const context: FeedbackContext = {
    task:"paper-coordinate",condition:JSON.stringify({targets:targetPoints,units:"종이 cm / 로봇 mm",scope:"출처별 보고 위치와 잉크 읽기를 구분. 규칙 기반 진단은 원인 후보이며 AI는 설명 지원만 함"}),
    answers:JSON.stringify({transform:transformDraft,predictions:draftTargets}),reason:privateText(hypothesisDraft||transformDraft.explanation).slice(0,1500),
    initialPrediction:JSON.stringify({transform:active?.transform,predictions:persistedPredictions}),
    history:JSON.stringify(records.slice(-3).map(r=>({pattern:r.diagnosis?.pattern,hypothesis:privateText(r.studentHypothesis??""),revision:privateText(r.revisionReason??"")}))),
    judgment:JSON.stringify({status:state.diagnosis?.pattern==="match"?"correct":state.diagnosis?"incorrect":"판정 전",candidate:state.diagnosis?.candidate,question:state.diagnosis?.question,why:state.diagnosis?.why}).slice(0,2000),
    execution:JSON.stringify(run?[{source:run.source,status:run.status,observations:run.observations,taskEvidence:state.diagnosis?.taskEvidence,inkReadings:active?.inkReadings??[]}]:[]),
    support:"challenge",attempts:Math.min(records.length,1000),
  };
  const ai=useLearningAi(context);
  return <><LearningAiFeedback ai={ai}/><PaperCoordinateStudyView state={state} actions={actions}/></>;
}
