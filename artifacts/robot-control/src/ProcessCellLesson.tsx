import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { recordLearningAction } from "./learningSync";
import type { MotionProps } from "./LessonPages";
import { parseLessonNumber, type LessonPose } from "./curriculum";
import { LEARNING_STAGES, learningRecordContext } from "./learningFramework";
import { downloadEvidence } from "./learningEvidenceStorage";
import { createProcessEvidenceStore } from "./processEvidence";
import { PROCESS_LEVELS, compileProcess, initialProcessFrame, processScenario, processTransport, processPackingPlan, localToWorld, worldToLocal } from "./processCell";
import { processStructure, processPlan, processEventLabel, processPreviewStops, processPreviewRoutes } from "./processLearning";
import type { CellCompilation, CellField, CellFrame, CellLevel, CellOutcome, CellRobotId, CellScenario, CellVisual } from "./processCellTypes";
import "./processCell.css";
import { LearningJudgmentFields, emptyJudgment, judgmentComplete, sameJudgment, reflectionRequired, type LearningJudgment, type LearningTaskKind } from "./LearningJudgment";

type ProcessMoment = { label: string; frame: CellFrame; robot?: CellRobotId; point?: LessonPose; goal?: LessonPose; pieceId?: string; traySlot?: number };
type ProcessRecord = ReturnType<typeof learningRecordContext> & {
  id: string; condition: CellScenario; answers: Record<string, number>; prediction: string;
  submittedAt: string; status: "submitted" | "running" | "completed" | "stopped" | "unavailable";
  previousId?: string; revision?: string; hints: string[]; playbackSpeed: number;
  startedAt?: string; endedAt?: string; stopReason?: string; outcome?: CellOutcome;
  plan?: { durationMs: number; frameCount: number };
  executed?: { throughIndex: number; simulationMs: number; wallMs: number; lastFrame: CellFrame; events: string[]; moments?: ProcessMoment[] };
  reflection?: string; reflectedAt?: string;
  structureChoice?: string; structuredAt?: string; planReviewedAt?: string;
  observation?: string; observedAt?: string; revisionPlan?: string;
  judgment?: LearningJudgment;
  taskKind?: LearningTaskKind; independentPrediction?: boolean;
  structureReview?: string;
  predictionPreview?: { firstViewedAt: string; lastViewedAt: string; furthestTimeMs: number; interactionCount: number };
};
const STORAGE_KEY = "physical-ai-process-evidence-v1";
const isRecord = (v: unknown): v is ProcessRecord => !!v && typeof v === "object" &&
  typeof (v as ProcessRecord).id === "string" && !!(v as ProcessRecord).condition && !!(v as ProcessRecord).answers;
const evidenceStore = createProcessEvidenceStore<ProcessRecord>({
  key: STORAGE_KEY, isRecord,
  isCheckpoint: value => isRecord(value) && ["running", "completed", "stopped", "unavailable"].includes(value.status),
  // A leftover checkpoint must never replace a completed or stopped attempt.
  recoverCheckpoint: (checkpoint, saved) => !saved || saved.status === "running" || saved.status === "submitted" ? checkpoint : null,
  normalizeRecord: record => record.status === "running"
    ? { ...record, status: "stopped", stopReason: "실행 중 화면이 닫혔습니다.", endedAt: new Date().toISOString() } : record,
});
const evidence = evidenceStore.records;
const unreadableBackup = evidenceStore.backups.history ?? null;
const unreadableCheckpoint = evidenceStore.backups.checkpoint ?? null;
const initialStorageFailure = evidenceStore.failed;
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const persist = (record: ProcessRecord) => evidenceStore.save(record, record.status !== "running" && record.status !== "submitted");
const fmt = (value: number) => Number(value.toFixed(2)).toString();
const formatAnswer = (value: number, field?: CellField): string => field?.sequence
  ? String(value).split("").map(step => field.sequence!.find(item => item.value === Number(step))?.label ?? "?").join(" → ")
  : field?.options?.find(option => option.value === value)?.label
  ?? `${fmt(value)}${field?.unit ? ` ${field.unit}` : ""}`;
const fieldsFor = (record: ProcessRecord) => record.condition.questions?.flatMap(question => question.fields) ?? [];
const frameEvents = (frame: CellFrame) => [...new Set(frame.events?.length ? frame.events : frame.event ? [frame.event] : [])];
const LEVEL_FOCUS: Record<CellLevel, string> = {
  1: "출발 위치와 이동량으로 도착 좌표 구하기",
  2: "벨트의 속도와 시간으로 집을 위치 예측하기",
  3: "로봇 B의 좌표로 바꾸고, 이어받을 조건 판단하기",
  4: "공급·인계를 연결해 네 칸의 위치와 순서 정하기",
};
const LEVEL_FLOW: Record<CellLevel, string[]> = {
  1: ["출발", "도착"], 2: ["벨트 공급", "집기", "배치"],
  3: ["A 공급", "인계", "B 배치"], 4: ["공급", "인계", "포장"],
};
const HANDOFF_STATE = { empty: "비어 있음", A: "A 사용 중", ready: "B가 이어받을 수 있음", B: "B 사용 중" };
const point = (pose: LessonPose) => `(${fmt(pose.x)}, ${fmt(pose.y)}, ${fmt(pose.z)})`;
const recordId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const didPass = (record: ProcessRecord | null) => record?.status === "completed" &&
  record.outcome?.finished === true && record.outcome.passed &&
  (!record.structureChoice || (record.structureReview ?? record.structureChoice) === processStructure(record.condition).expected) &&
  record.executed?.throughIndex === (record.plan?.frameCount ?? 0) - 1;
type View = "intro" | "structure" | "question" | "ready" | "running" | "observe" | "compare" | "revise";
const VIEW_STAGE: Record<View, number> = { intro: 1, structure: 2, question: 3, ready: 3, running: 4, observe: 5, compare: 6, revise: 7 };
type Playback = { token: number; record: ProcessRecord; compilation: CellCompilation; started: number | null; index: number; simulationMs: number; wallMs: number; checkpointMs: number; publishedMs: number; events: string[]; moments: ProcessMoment[] };
type PredictionPlayback = { compilation: CellCompilation; timeMs: number; index: number };
const UI_FRAME_INTERVAL_MS = 100;
const OBSERVATION_EVENTS = new Set(["A-grip", "B-grip", "placed", "place-miss", "grip-miss",
  "handoff-release", "A-cleared", "handoff-blocked", "handoff-path-blocked", "plan-blocked", "height-blocked",
  "A-lifted", "A-corner", "A-above", "approach-blocked"]);
const LEVEL_CONNECTION = {
  1: { before: "좌표와 이동량", now: "집기점에서 Z만 높인 뒤 이동하고, 목표 위에서 Z만 낮춥니다.", task: "계산: 목표·높이·접근점 / 선택: 운반 순서·수평 경로 / 확인: TCP와 블록의 접촉" },
  2: { before: "레벨 1의 상승·이송·수직 접근", now: "집기점이 벨트의 속도·시간에 따라 바뀝니다. 정지 후 집는 조건을 추가합니다.", task: "계산: 정지 위치·접근점 / 선택: 운반 순서·경로 / 확인: 정지 위치와 집기 위치" },
  3: { before: "상승한 높이에서 이송하고 수직으로 접근하기", now: "운반 높이 300 mm는 유지합니다. 같은 인계점을 B의 원점과 축 방향으로 다시 표현하세요.", task: "계산: B 기준 인계 좌표 / 판단: A가 놓고 물러난 뒤 B 진입 / 확인: 같은 점·다른 좌표" },
  4: { before: "벨트 정지 위치·좌표계 변환·인계 조건", now: "앞선 세 판단을 연결하고, B 기준에서 행·열 이동량으로 포장할 위치를 확장합니다.", task: "계산: 공급·인계·네 칸 / 판단: 기다림과 이어받기 / 확인: 각 블록의 도달 위치" },
};
const LEVEL_CONCEPT = {
  1: "출발 좌표 + 이동량 = 목표 좌표 · 들어 올린 높이에서 운반",
  2: "속도 × 시간 = 이동량 · 정지 위치와 집는 위치 연결",
  3: "같은 점을 서로 다른 원점·축 방향으로 표현 · 인계 조건",
  4: "첫 칸 + 열·행 이동량 = 각 칸의 좌표 · 공정 연결",
};
const SHORT_STAGES: { view: View; label: string }[] = [
  { view: "intro", label: "과제" }, { view: "structure", label: "관계" },
  { view: "question", label: "예측" }, { view: "running", label: "실행" },
  { view: "observe", label: "관찰" }, { view: "compare", label: "비교" }, { view: "revise", label: "정리" },
];
const changesActivity = (before: CellFrame, after: CellFrame) => before.phase !== after.phase || before.activeRobot !== after.activeRobot
  || before.processStatus?.feed !== after.processStatus?.feed || before.processStatus?.A !== after.processStatus?.A
  || before.processStatus?.B !== after.processStatus?.B || before.processStatus?.handoff !== after.processStatus?.handoff
  || before.processStatus?.completed !== after.processStatus?.completed || before.workpieces.length !== after.workpieces.length
  || after.workpieces.some((piece, index) => piece.owner !== before.workpieces[index]?.owner || piece.placed !== before.workpieces[index]?.placed);

import { TaskStartPoint } from "./TaskStartPoint";

export function ProcessCellLesson(props: MotionProps & { sceneReady: boolean; onVisualChange: (visual: CellVisual | null) => void }) {
  const latest = useRef(props); latest.current = props;
  const lessonScroll = useRef<HTMLElement | null>(null);
  const [level, setLevel] = useState<CellLevel>(1), [variant, setVariant] = useState(0);
  const scenario = useMemo(() => processScenario(level, variant), [level, variant]);
  const taskKind: LearningTaskKind = variant > 0 || level === 4 ? "transfer" : level === 2 ? "practice" : "representative";
  const detailedReflection = taskKind === "representative";
  const [frame, setFrame] = useState(() => initialProcessFrame(props.model, scenario));
  const liveFrameRef = useRef(frame);
  const [view, setView] = useState<View>("intro");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [prediction, setPrediction] = useState("");
  const [structureChoice, setStructureChoice] = useState("");
  const [structuredAt, setStructuredAt] = useState<string | undefined>();
  const [planReviewed, setPlanReviewed] = useState(false);
  const [observedText, setObservedText] = useState("");
  const [hintKeys, setHintKeys] = useState<string[]>([]);
  const [showCoordinates, setShowCoordinates] = useState(true);
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [cameraRequest, setCameraRequest] = useState<CellVisual["cameraRequest"]>();
  const requestCamera = useCallback((scope: "whole" | "work" | "packing" | "frames") =>
    setCameraRequest(previous => ({ scope, key: (previous?.key ?? 0) + 1 })), []);
  const [reviewIndex, setReviewIndex] = useState(-1);
  const [selectedRobot, setSelectedRobot] = useState<CellRobotId>("A");
  const [speed, setSpeed] = useState(1);
  const [record, setRecord] = useState<ProcessRecord | null>(null);
  const [reflection, setReflection] = useState(""), [revision, setRevision] = useState("");
  const [judgment, setJudgment] = useState<LearningJudgment>(emptyJudgment);
  const [revisionOf, setRevisionOf] = useState<string | undefined>();
  const [notice, setNotice] = useState("");
  const [storageFailed, setStorageFailed] = useState(initialStorageFailure);
  const [historyVersion, setHistoryVersion] = useState(0);
  const raf = useRef<number | null>(null), token = useRef(0), playback = useRef<Playback | null>(null);
  const predictionRaf = useRef<number | null>(null), predictionToken = useRef(0);
  const predictionPlayback = useRef<PredictionPlayback | null>(null);
  const [preview, setPreview] = useState<{ playing: boolean; timeMs: number } | null>(null);
  const currentRecord = useRef<ProcessRecord | null>(null);
  const mounted = useRef(true);
  const question = scenario.questions[questionIndex];
  const structure = processStructure(scenario);
  const running = view === "running", locked = running || props.hardwareConnected;
  const passed = didPass(record);
  const activeRecords = useMemo(() => evidence.filter(isRecord).filter(r =>
    r.condition.id === scenario.id), [scenario.id, historyVersion]);
  const previous = [...activeRecords].reverse().find(r => r.id !== record?.id && r.status !== "submitted");
  const save = useCallback((next: ProcessRecord) => {
    currentRecord.current = next;
    const ok = persist(next);
    if (mounted.current) { setRecord(next); setStorageFailed(!ok); setHistoryVersion(value => value + 1); }
  }, []);
  const publishFrame = useCallback((next: CellFrame) => { liveFrameRef.current = next; setFrame(next); }, []);
  const cancelPrediction = useCallback(() => {
    predictionToken.current += 1;
    if (predictionRaf.current !== null) cancelAnimationFrame(predictionRaf.current);
    predictionRaf.current = null;
    const active = predictionPlayback.current; predictionPlayback.current = null;
    if (mounted.current) {
      setPreview(null);
      if (active) publishFrame(active.compilation.frames[0]);
    }
  }, [publishFrame]);
  const halt = useCallback((reason: string, updateView = true) => {
    cancelPrediction();
    token.current += 1;
    if (raf.current !== null) { cancelAnimationFrame(raf.current); raf.current = null; }
    const active = playback.current; playback.current = null;
    if (!active || active.record.status !== "running") return;
    const stoppedFrame = active.compilation.frames[active.index];
    liveFrameRef.current = stoppedFrame;
    const stopped: ProcessRecord = { ...active.record, status: "stopped", outcome: undefined,
      endedAt: new Date().toISOString(), stopReason: reason,
      executed: { throughIndex: active.index, simulationMs: active.simulationMs, wallMs: active.wallMs,
        lastFrame: copy(active.compilation.frames[active.index]), events: [...active.events], moments: copy(active.moments) } };
    if (updateView) { setFrame(stoppedFrame); save(stopped); setView("observe"); }
    else { currentRecord.current = stopped; persist(stopped); }
  }, [save, cancelPrediction]);
  const fresh = useCallback(() => {
    halt("과제를 초기화했습니다.");
    publishFrame(initialProcessFrame(latest.current.model, scenario));
    setView("intro"); setQuestionIndex(0); setDraft({}); setPrediction(""); setHintKeys([]);
    setStructureChoice(""); setStructuredAt(undefined); setPlanReviewed(false); setObservedText("");
    setRecord(null); currentRecord.current = null; setReflection(""); setRevision(""); setRevisionOf(undefined);
    setJudgment(emptyJudgment());
    setNotice(""); setSelectedRobot("A"); setShowCoordinates(true); setSelectedPoint(null); setSelectedSlot(null); setCameraRequest(undefined); setReviewIndex(-1);
  }, [scenario, halt, publishFrame]);
  useLayoutEffect(() => { fresh(); }, [fresh, props.resetKey]);
  useLayoutEffect(() => { if (lessonScroll.current) lessonScroll.current.scrollTop = 0; }, [view, questionIndex]);
  useLayoutEffect(() => {
    if (props.hardwareConnected) halt("실장비 모드 또는 연결로 전환되어 가상 공정을 중지했습니다.");
  }, [props.hardwareConnected, halt]);
  useLayoutEffect(() => {
    if (!props.sceneReady) halt("3D 화면이 중단되어 공정을 멈췄습니다.");
  }, [props.sceneReady, halt]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; halt("다른 화면으로 이동했습니다.", false); latest.current.onVisualChange(null); };
  }, [halt]);
  const plannedPoints = useMemo(() => record ? processPlan(scenario, record.answers) : [], [scenario, record?.answers]);
  const packingPlan = useMemo(() => record ? processPackingPlan(scenario, record.answers) : [], [scenario, record?.answers]);
  const selectPackingSlot = useCallback((slot: number) => {
    if (running || !scenario.tray) return;
    cancelPrediction(); setSelectedSlot(slot); setSelectedRobot("B");
    setSelectedPoint(plannedPoints.findIndex(row => row.traySlot === slot));
    requestCamera("packing");
    const current = currentRecord.current;
    if (view === "ready" && current?.status === "submitted") {
      const now = new Date().toISOString(), exposure = current.predictionPreview;
      save({ ...current, predictionPreview: { firstViewedAt: exposure?.firstViewedAt ?? now, lastViewedAt: now,
        furthestTimeMs: exposure?.furthestTimeMs ?? 0, interactionCount: (exposure?.interactionCount ?? 0) + 1 } });
    }
    if ((view === "observe" || view === "compare") && record?.executed) {
      const index = record.executed.moments?.findIndex(moment => moment.traySlot === slot
        && moment.frame.events?.some(event => event === "placed" || event === "place-miss")) ?? -1;
      setReviewIndex(index);
      publishFrame(copy(index >= 0 ? record.executed.moments![index].frame : record.executed.lastFrame));
    }
  }, [running, scenario, cancelPrediction, plannedPoints, requestCamera, view, record?.executed, publishFrame, save]);
  const packingVisual = useMemo<CellVisual["packing"]>(() => scenario.tray ? {
    selectedSlot, onSelectSlot: selectPackingSlot,
    cells: scenario.tray.points.map((_, slot) => {
      const planned = packingPlan.find(item => item.slot === slot);
      const observed = record?.executed?.moments?.find(item => item.traySlot === slot
        && item.frame.events?.some(event => event === "placed" || event === "place-miss"));
      return { slot, order: planned?.order,
        command: planned && localToWorld(planned.command, scenario.robots[1]),
        observed: observed?.point };
    }),
  } : undefined, [scenario, selectedSlot, selectPackingSlot, packingPlan, record?.executed]);
  const predictionModel = useMemo(() => {
    if (!record) return { compilation: null, error: "" };
    try { return { compilation: compileProcess(props.model, scenario, record.answers), error: "" }; }
    catch (error) { return { compilation: null, error: error instanceof Error ? error.message : "입력값으로 움직임을 계산할 수 없습니다." }; }
  }, [props.model, scenario, record?.answers]);
  const previewStops = useMemo(() => predictionModel.compilation ? processPreviewStops(predictionModel.compilation) : [], [predictionModel]);
  const previewRoutes = useMemo(() => predictionModel.compilation ? processPreviewRoutes(scenario, predictionModel.compilation) : [], [scenario, predictionModel]);
  const predictedRoutes = (view === "ready" || running) && level >= 3 ? previewRoutes : undefined;
  const selectedPlanPoint = selectedPoint === null ? undefined : plannedPoints[selectedPoint];
  const transportPlan = useMemo(() => level <= 2 && record ? processTransport(scenario, record.answers) : null, [level, scenario, record?.answers]);
  const plannedPath = useMemo(() => {
    if ((view !== "ready" && !running) || level > 2 || !record) return undefined;
    const order = ["P1", ...String(record.answers.transferOrder).split("").flatMap(step =>
      step === "1" ? ["P2"] : step === "2" ? ["경유", "P3"] : step === "3" ? ["P4"] : [])];
    return order.flatMap(marker => {
      const row = plannedPoints.find(item => item.marker === marker);
      return row ? [{ label: marker, pose: localToWorld(row.pose, scenario.robots[0]) }] : [];
    });
  }, [view, running, level, plannedPoints, scenario, record?.answers]);
  const reviewMoment = reviewIndex >= 0 && (view === "observe" || view === "compare")
    ? record?.executed?.moments?.[reviewIndex] : undefined;
  const reviewing = !!reviewMoment;
  const focusPoint = useMemo(() => {
    if (reviewMoment) return reviewMoment.goal ?? reviewMoment.point;
    if (scenario.tray && selectedSlot !== null) return scenario.tray.points[selectedSlot];
    if (view === "question" || (level === 4 && view === "intro")) return question?.focusPoint;
    if (view === "ready" && selectedPlanPoint)
      return localToWorld(selectedPlanPoint.pose, scenario.robots.find(robot => robot.id === selectedPlanPoint.robot)!);
    return undefined;
  }, [view, question, selectedPlanPoint, scenario, reviewMoment, selectedSlot, level]);
  const focusLabel = reviewMoment ? reviewMoment.label
    : scenario.tray && selectedSlot !== null ? `칸 ${selectedSlot + 1} · 목표`
    : view === "question" || (level === 4 && view === "intro") ? question?.focusLabel ?? question?.title
    : view === "ready" && selectedPlanPoint ? `${selectedPlanPoint.marker ? selectedPlanPoint.marker + " · " : ""}${selectedPlanPoint.label}` : undefined;
  const hideTargetCoordinates = level >= 3 && (view === "intro" || view === "structure" || view === "question");
  const predictionPreview = useMemo(() => preview ? { playing: preview.playing,
    progress: Math.round(preview.timeMs / Math.max(1, predictionModel.compilation?.durationMs ?? 0) * 100) } : undefined,
  [preview, predictionModel]);
  useEffect(() => {
    latest.current.onVisualChange({ scenario, frame, liveFrameRef, showCoordinates, selectedRobot, focusPoint, focusLabel, plannedPath,
      predictedRoutes, predictionPreview, hideTargetCoordinates, reviewing, running, cameraRequest, packing: packingVisual });
  }, [scenario, frame, showCoordinates, selectedRobot, focusPoint, focusLabel, plannedPath, predictedRoutes, predictionPreview, hideTargetCoordinates, reviewing, running, cameraRequest, packingVisual]);

  const recordPreviewExposure = (timeMs: number, interaction = true) => {
    const current = currentRecord.current;
    if (!current || current.status !== "submitted") return;
    const at = new Date().toISOString(), previous = current.predictionPreview;
    save({ ...current, predictionPreview: {
      firstViewedAt: previous?.firstViewedAt ?? at, lastViewedAt: at,
      furthestTimeMs: Math.max(previous?.furthestTimeMs ?? 0, timeMs),
      interactionCount: (previous?.interactionCount ?? 0) + Number(interaction),
    } });
  };
  const seekPrediction = (timeMs: number, frameIndex?: number) => {
    const compilation = predictionModel.compilation;
    if (locked || !latest.current.sceneReady || view !== "ready" || !compilation?.frames.length) return;
    predictionToken.current += 1;
    if (predictionRaf.current !== null) cancelAnimationFrame(predictionRaf.current);
    predictionRaf.current = null;
    const at = Math.max(0, Math.min(compilation.durationMs, timeMs));
    recordPreviewExposure(at);
    let index = 0;
    while (index + 1 < compilation.frames.length && compilation.frames[index + 1].atMs <= at) index++;
    if (frameIndex !== undefined) index = frameIndex;
    predictionPlayback.current = { compilation, timeMs: at, index };
    setSelectedPoint(null); setSelectedSlot(null);
    publishFrame(compilation.frames[index]);
    if (compilation.frames[index].activeRobot) setSelectedRobot(compilation.frames[index].activeRobot!);
    setPreview({ playing: false, timeMs: at }); setNotice("");
  };
  const playPrediction = () => {
    const compilation = predictionModel.compilation;
    if (locked || !latest.current.sceneReady || view !== "ready" || !compilation?.frames.length) return;
    if (preview?.playing) { seekPrediction(predictionPlayback.current?.timeMs ?? 0); return; }
    const from = predictionPlayback.current?.compilation === compilation
      && predictionPlayback.current.timeMs < compilation.durationMs ? predictionPlayback.current.timeMs : 0;
    seekPrediction(from);
    if (level === 4) requestCamera("work");
    const run = predictionPlayback.current!;
    const currentToken = ++predictionToken.current;
    let started: number | null = null, published = 0;
    setPreview({ playing: true, timeMs: from });
    const tick = (now: number) => {
      if (!mounted.current || currentToken !== predictionToken.current || predictionPlayback.current !== run) return;
      if (latest.current.hardwareConnected || !latest.current.sceneReady) { cancelPrediction(); return; }
      if (started === null) started = now;
      run.timeMs = Math.min(compilation.durationMs, from + (now - started) * speed);
      while (run.index + 1 < compilation.frames.length && compilation.frames[run.index + 1].atMs <= run.timeMs) run.index++;
      const next = compilation.frames[run.index], before = liveFrameRef.current;
      liveFrameRef.current = next;
      const ended = run.timeMs >= compilation.durationMs;
      if (ended || changesActivity(before, next) || now - published >= UI_FRAME_INTERVAL_MS) {
        setFrame(next); published = now;
        if (next.activeRobot) setSelectedRobot(next.activeRobot);
        setPreview({ playing: !ended, timeMs: run.timeMs });
      }
      if (ended) { predictionRaf.current = null; recordPreviewExposure(run.timeMs, false); }
      else predictionRaf.current = requestAnimationFrame(tick);
    };
    predictionRaf.current = requestAnimationFrame(tick);
  };

  const goQuestion = (index: number) => {
    if (locked) return;
    cancelPrediction();
    setPlanReviewed(false); setSelectedPoint(null); setSelectedSlot(scenario.questions[index].id === "tray" ? 3 : null); setReviewIndex(-1);
    if (scenario.questions[index].id === "handoff") requestCamera("frames");
    else if (level === 4) requestCamera(scenario.questions[index].id === "tray" ? "packing" : "work");
    setQuestionIndex(index); setSelectedRobot(scenario.questions[index].focusRobot); setView("question"); setNotice("");
  };
  const submitStructure = () => {
    if (locked) return;
    if (!structure.options.some(option => option.value === structureChoice)) { setNotice("사용할 수학적 관계를 선택하세요."); return; }
    if (taskKind !== "transfer" && structureChoice !== structure.expected) { setNotice(structure.feedback); return; }
    setStructuredAt(new Date().toISOString()); goQuestion(level === 4 ? questionIndex : 0);
  };
  const submitQuestion = () => {
    if (locked || !structuredAt) return;
    const validValue = (field: CellField) => {
      const value = parseLessonNumber(draft[field.key] ?? "");
      if (field.sequence) {
        const steps = String(value ?? "").split("").map(Number);
        return steps.length === field.sequence.length && new Set(steps).size === steps.length
          && steps.every(step => field.sequence!.some(item => item.value === step));
      }
      return value !== null && (!field.options || field.options.some(option => option.value === value));
    };
    if (question.fields.some(field => !validValue(field))) {
      setNotice(question.fields.some(field => field.sequence) ? question.id === "tray" ? "좌표를 입력하고, 네 칸을 한 번씩 눌러 채울 순서를 완성하세요." : "숫자를 입력하고, 네 동작을 한 번씩 눌러 순서를 완성하세요."
        : question.fields.some(field => field.options) ? "아직 입력하거나 선택하지 않은 항목이 있습니다." : "빈칸에 예측한 수를 입력하세요."); return;
    }
    if (questionIndex < scenario.questions.length - 1) { goQuestion(questionIndex + 1); return; }
    if (!prediction.trim()) { setNotice("위치나 이동 순서를 그렇게 예상한 이유를 식 또는 한 문장으로 적어 주세요."); return; }
    const answers: Record<string, number> = {};
    for (const q of scenario.questions) for (const field of q.fields) {
      const value = parseLessonNumber(draft[field.key] ?? "");
      if (value === null || !validValue(field)) { goQuestion(scenario.questions.indexOf(q)); setNotice("이 질문의 값과 작업 조건을 먼저 확인하세요."); return; }
      answers[field.key] = value;
    }
    save({ ...learningRecordContext("dt"), id: recordId(), condition: copy(scenario), answers,
      taskKind, independentPrediction: taskKind === "transfer" && hintKeys.length === 0 && !activeRecords.some(item =>
        item.predictionPreview || item.status !== "submitted" || item.hints.length > 0),
      prediction: prediction.trim(), submittedAt: new Date().toISOString(), status: "submitted", hints: [...hintKeys],
      playbackSpeed: speed, previousId: record?.id ?? revisionOf ?? previous?.id, revision: revision.trim() || undefined,
      structureChoice, structuredAt });
    setPlanReviewed(false);
    setReflection(""); setObservedText(""); setJudgment(emptyJudgment());
    setSelectedPoint(0); setSelectedSlot(null); setSelectedRobot("A"); setView("ready"); setNotice("");
    if (level === 4) requestCamera("work");
  };
  const execute = () => {
    if (latest.current.hardwareConnected || !latest.current.sceneReady || !record || record.status !== "submitted" || !planReviewed) return;
    halt("새 실행을 시작했습니다.");
    const reviewedRecord = { ...record, planReviewedAt: new Date().toISOString() };
    let compilation: CellCompilation;
    try { compilation = compileProcess(latest.current.model, scenario, record.answers); }
    catch (error) {
      save({ ...reviewedRecord, status: "unavailable", endedAt: new Date().toISOString(), stopReason: error instanceof Error ? error.message : "공정을 계산할 수 없습니다." });
      setView("observe"); return;
    }
    if (!compilation.frames.length) {
      save({ ...reviewedRecord, status: "unavailable", stopReason: "실행할 경로를 만들지 못했습니다.", endedAt: new Date().toISOString() }); setView("observe"); return;
    }
    const startRecord: ProcessRecord = { ...reviewedRecord, status: "running", playbackSpeed: speed,
      startedAt: new Date().toISOString(), plan: { durationMs: compilation.durationMs, frameCount: compilation.frames.length },
      executed: { throughIndex: 0, simulationMs: 0, wallMs: 0, lastFrame: copy(compilation.frames[0]), events: frameEvents(compilation.frames[0]) } };
    save(startRecord); setReviewIndex(-1); setSelectedSlot(null);
    if (level === 4) requestCamera("work"); publishFrame(compilation.frames[0]); setView("running"); setNotice("");
    const run: Playback = { token: ++token.current, record: startRecord, compilation, started: null, index: 0, simulationMs: 0, wallMs: 0, checkpointMs: 0, publishedMs: 0, events: frameEvents(compilation.frames[0]), moments: [] };
    playback.current = run;
    const tick = (now: number) => {
      if (token.current !== run.token || playback.current !== run || !mounted.current) return;
      if (latest.current.hardwareConnected) { halt("실장비 모드 또는 연결로 전환되어 가상 공정을 중지했습니다."); return; }
      if (!latest.current.sceneReady) { halt("3D 화면이 중단되어 공정을 멈췄습니다."); return; }
      if (run.started === null) run.started = now;
      run.wallMs = Math.max(0, now - run.started);
      run.simulationMs = Math.min(compilation.durationMs, run.wallMs * speed);
      let next = run.index;
      while (next + 1 < compilation.frames.length && compilation.frames[next + 1].atMs <= run.simulationMs) next += 1;
      let hasEvent = false;
      for (let i = run.index + 1; i <= next; i++) {
        const events = frameEvents(compilation.frames[i]);
        if (events.length) { hasEvent = true; run.events.push(...events); }
        const observed = events.filter(event => OBSERVATION_EVENTS.has(event));
        if (observed.length) run.moments.push({
          label: `${level === 4 && compilation.frames[i].eventPieceId ? "블록 " + compilation.frames[i].eventPieceId!.replace("piece-", "") + " · " : ""}${observed.map(processEventLabel).join(" · ")}${compilation.frames[i].eventTraySlot !== undefined ? " → 칸 " + (compilation.frames[i].eventTraySlot! + 1) : ""}`, frame: copy(compilation.frames[i]),
          pieceId: compilation.frames[i].eventPieceId, traySlot: compilation.frames[i].eventTraySlot,
          robot: compilation.frames[i].eventRobot,
          point: compilation.frames[i].eventPoint && { ...compilation.frames[i].eventPoint! },
          goal: compilation.frames[i].eventGoal && { ...compilation.frames[i].eventGoal! },
        });
      }
      const nextFrame = compilation.frames[next];
      const previousFrame = liveFrameRef.current;
      // Three reads this stable ref each animation frame; the lesson text needs fewer updates.
      liveFrameRef.current = nextFrame;
      run.index = next;
      if (hasEvent || changesActivity(previousFrame, nextFrame) || run.wallMs - run.publishedMs >= UI_FRAME_INTERVAL_MS) {
        setFrame(nextFrame); run.publishedMs = run.wallMs;
        if (nextFrame.activeRobot) setSelectedRobot(nextFrame.activeRobot);
      }
      if (run.wallMs - run.checkpointMs >= 1000) {
        run.checkpointMs = run.wallMs;
        run.record = { ...run.record, executed: { throughIndex: run.index, simulationMs: run.simulationMs,
          wallMs: run.wallMs, lastFrame: copy(compilation.frames[run.index]), events: [...run.events], moments: copy(run.moments) } };
        currentRecord.current = run.record;
        if (!evidenceStore.checkpoint(run.record)) setStorageFailed(true);
      }
      if (run.simulationMs >= compilation.durationMs) {
        run.index = compilation.frames.length - 1;
        publishFrame(compilation.frames[run.index]); raf.current = null; playback.current = null;
        save({ ...startRecord, status: "completed", endedAt: new Date().toISOString(), outcome: copy(compilation.outcome),
          executed: { throughIndex: run.index, simulationMs: compilation.durationMs, wallMs: run.wallMs,
            lastFrame: copy(compilation.frames[run.index]), events: [...run.events], moments: copy(run.moments) } });
        setView("observe");
      } else raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  const retry = () => {
    if (locked || !record || !revision.trim()) return;
    halt("예측을 수정합니다.");
    save({ ...record, revisionPlan: revision.trim() });
    setRevisionOf(record.id); setRecord(null); currentRecord.current = null;
    setReflection(""); setObservedText(""); setJudgment(emptyJudgment()); publishFrame(initialProcessFrame(latest.current.model, scenario)); goQuestion(0);
  };
  const exportRecords = () => downloadEvidence("process-cell-learning.json", {
    ...learningRecordContext("dt"), exportedAt: new Date().toISOString(), records: evidence,
    ...(unreadableBackup !== null ? { originalUnreadableData: unreadableBackup } : {}),
    ...(unreadableCheckpoint !== null ? { originalUnreadableCheckpoint: unreadableCheckpoint } : {}),
  });
  const stage = VIEW_STAGE[view];
  const moments = record?.executed?.moments ?? [];
  const observedFrame = record?.executed?.lastFrame;
  const inspectedFrame = reviewing ? moments[reviewIndex]?.frame ?? observedFrame : observedFrame;
  const displayRobot = scenario.robots.find(robot => robot.id === selectedRobot)!;
  const previewMoment = (index: number) => {
    if (running || !record?.executed) return;
    const moment = index >= 0 ? moments[index] : null;
    if (index >= 0 && !moment) return;
    const placement = moment?.frame.events?.some(event => event === "placed" || event === "place-miss");
    setSelectedSlot(placement ? moment?.traySlot ?? null : null);
    if (level === 4) requestCamera(moment?.robot === "B" && moment?.frame.events?.some(event => event === "placed" || event === "place-miss") ? "packing" : "work");
    setReviewIndex(index); publishFrame(copy(moment?.frame ?? record.executed.lastFrame));
    const robot = moment?.robot ?? moment?.frame.activeRobot;
    if (robot) setSelectedRobot(robot);
  };
  const completedPieces = observedFrame?.workpieces.filter(piece => piece.placed).length ?? 0;
  const observedEvents = [...new Set(record?.executed?.events ?? [])];
  const needsReflection = reflectionRequired(taskKind, judgment) || !passed;
  const comparisonReady = (!needsReflection || !!reflection.trim()) && judgmentComplete(judgment, detailedReflection);
  const comparisonSaved = !!record?.reflectedAt && record.reflection === reflection.trim() && sameJudgment(record.judgment, judgment) && comparisonReady;
  const needsObservation = detailedReflection || !observedFrame;
  const observationSaved = !!record?.observedAt && record.observation === observedText.trim();
  const kinematicObservation = record?.outcome?.observations.filter(item => item.robot === selectedRobot).at(-1);
  const observationFK = kinematicObservation ? latest.current.model.fk(kinematicObservation.joints) : null;
  const progress = running && playback.current ? Math.round(playback.current.simulationMs / Math.max(1, playback.current.compilation.durationMs) * 100) : record?.status === "completed" ? 100 : 0;
  const previewStop = previewStops.reduce((last, stop, index) => stop.index <= (predictionPlayback.current?.index ?? 0) ? index : last, 0);
  const seekStop = (index: number) => {
    const stop = previewStops[index];
    if (stop) seekPrediction(stop.atMs, stop.index);
  };

  const canVisit = (next: View) => {
    if (running) return false;
    const editable = !record || record.status === "submitted";
    if (next === "intro") return true;
    if (next === "structure") return editable;
    if (next === "question") return editable && !!structuredAt;
    if (next === "observe") return !!record && ["completed", "stopped", "unavailable"].includes(record.status);
    if (next === "compare") return observationSaved;
    if (next === "revise") return comparisonSaved && observationSaved;
    return false;
  };
  const visitStage = (next: View) => {
    if (!canVisit(next)) return;
    cancelPrediction();
    if (next === "question") goQuestion(0);
    else {
      if (next === "intro") { setReviewIndex(-1); publishFrame(initialProcessFrame(latest.current.model, scenario)); }
      if (next === "observe" || next === "compare") previewMoment(-1);
      setView(next); setNotice("");
    }
  };

  const visitTopic = (index: number) => {
    if (locked) return;
    if (structuredAt && (!record || record.status === "submitted")) { goQuestion(index); return; }
    setQuestionIndex(index); setSelectedRobot(scenario.questions[index].focusRobot);
    setSelectedSlot(index === 2 ? 3 : null); requestCamera(index === 2 ? "packing" : "work");
    if (record?.executed && (view === "observe" || view === "compare")) {
      const event = index === 0 ? "A-grip" : index === 1 ? "handoff-release" : "placed";
      const moment = moments.findIndex(item => item.frame.events?.includes(event));
      if (moment >= 0) previewMoment(moment);
    }
  };
  const packingGrid = scenario.tray && <div className="process-packing-grid" role="group" aria-label="포장 칸 선택">
    <p>← 열 증가 (+X<sub>B</sub>) · 행 증가 (+Y<sub>B</sub>) ↓</p>
    <div>{[1, 0, 3, 2].map(slot => {
      const plan = view === "intro" || view === "structure" || view === "question" ? undefined : packingPlan.find(item => item.slot === slot);
      const piece = frame.workpieces.find(item => item.traySlot === slot);
      return <button key={slot} type="button" aria-label={`칸 ${slot + 1} 보기`} aria-pressed={selectedSlot === slot}
        disabled={running} onClick={() => selectPackingSlot(slot)}>
        <strong>칸 {slot + 1}</strong><span>행 {Math.floor(slot / 2)} · 열 {slot % 2}</span>
        {plan && <small>블록 {plan.order}{piece?.placed ? " · 배치 완료" : ""}</small>}
      </button>;
    })}</div>
    <small>칸을 누르면 왼쪽의 같은 칸을 확인합니다.</small>
  </div>;
  const selectedPacking = packingPlan.find(item => item.slot === selectedSlot);
  const selectedPlacement = record?.executed?.moments?.find(item => item.traySlot === selectedSlot
    && item.frame.events?.some(event => event === "placed" || event === "place-miss"));
  const packingSummary = selectedPacking && <div className="process-packing-summary" aria-label="선택한 포장 칸 비교">
    <strong>칸 {selectedPacking.slot + 1} · 블록 {selectedPacking.order} · B 기준 (mm)</strong>
    <span>내 명령 {point(selectedPacking.command)}</span>
    {(view === "observe" || view === "compare") && <>
      <span>과제 목표 {point(selectedPacking.goal)}</span>
      <span>{selectedPlacement?.point ? `도달 위치 ${point(worldToLocal(selectedPlacement.point, scenario.robots[1]))}` : "아직 이 칸에 도달한 장면이 없습니다."}</span>
    </>}
  </div>;

  const startRobot = scenario.robots.find(r=>r.id===selectedRobot) ?? scenario.robots[0];
  return <section ref={lessonScroll} className={`process-lesson${level === 4 ? " process-level-four" : ""}`} aria-label="픽앤플레이스 공정 실습" data-process-stage={stage}>
    <TaskStartPoint taskKey={`process:${level}:${variant}:${startRobot.id}:${props.resetKey}`}
      start={startRobot.start}
      coords={frame.robots[startRobot.id]!.pose} disabled={running}
      hardwareBlock="공정 DT의 로봇별 시작 좌표는 실제 MG400 좌표계와의 대응이 검증되지 않아 실장비 이동을 차단합니다."
      onVirtualMove={()=>{
        if(running)throw new Error("공정 실행 중에는 시작점을 바꿀 수 없습니다.");
        const initial=initialProcessFrame(props.model,scenario);
        publishFrame({...liveFrameRef.current,robots:{...liveFrameRef.current.robots,[startRobot.id]:initial.robots[startRobot.id]}});
      }}/>
    <nav className="process-levels" aria-label="픽앤플레이스 수업 경로">
      {PROCESS_LEVELS.map(item => <button key={item.level} type="button"
        aria-current={level === item.level ? "step" : undefined} disabled={running}
        onClick={() => { if (!running && level !== item.level) { setLevel(item.level); setVariant(0); } }}>
        <span>{item.level}</span>{item.title}
      </button>)}
    </nav>
    <header className="process-header">
      <div className="process-settings-row"><span>레벨 {level} · 조건 {scenario.variant + 1}</span>
        <details className="process-settings"><summary>설정 변경</summary>
          <label className="process-level-label">공정 선택<select aria-label="공정 레벨" value={level} disabled={running} onChange={event => { setLevel(Number(event.target.value) as CellLevel); setVariant(0); }}>
            {PROCESS_LEVELS.map(item => <option key={item.level} value={item.level}>레벨 {item.level} · {item.title}</option>)}
          </select></label>
          <div className="process-scene-tools"><label><input type="checkbox" checked={showCoordinates} onChange={event => setShowCoordinates(event.target.checked)}/> 좌표 보기</label>
            {scenario.robots.length > 1 && <div className="process-robot-select" aria-label="좌표 기준 로봇">{scenario.robots.map(robot => <button key={robot.id} aria-pressed={selectedRobot === robot.id} onClick={() => setSelectedRobot(robot.id)}>로봇 {robot.id}</button>)}</div>}
          </div>
        </details>
      </div>
      {level !== 4 && <p className="process-concept-label">이번 활동의 핵심</p>}<h1>{LEVEL_FOCUS[level]}</h1>
      {level !== 4 && <p className="process-concept process-goal">{taskKind === "transfer" ? "좌표의 기준과 작업 순서를 스스로 정하고 실행 결과로 확인" : LEVEL_CONCEPT[level]}</p>}
    </header>
    <p className="process-stage">현재 단계 {stage}/7 · <strong>{LEARNING_STAGES[stage - 1].label}</strong>{passed && <span className="process-complete">공정 성공</span>}</p>
    <nav className="process-stage-nav" aria-label="학습 단계">
      {SHORT_STAGES.map((item, index) => <button key={item.view} type="button"
        aria-current={stage === index + 1 ? "step" : undefined}
        disabled={!canVisit(item.view)} onClick={() => visitStage(item.view)}>
        <span>{index + 1}</span>{item.label}
      </button>)}
    </nav>
    {level === 4 && <nav className="process-topic-nav" aria-label="공급·인계·포장 선택">
      {LEVEL_FLOW[4].map((label, index) => <button key={label} type="button" disabled={locked}
        aria-pressed={questionIndex === index} onClick={() => visitTopic(index)}>{index + 1}. {label}</button>)}
    </nav>}
    {(view === "observe" || view === "compare") && scenario.tray && <>{packingGrid}{packingSummary}</>}
    {(view === "observe" || view === "compare") && moments.length > 0 && <aside className="process-replay" aria-label="실행 장면 다시 보기">
      <label>실행 장면 다시 보기<select aria-label="관찰할 순간" value={reviewIndex}
        onChange={event => previewMoment(Number(event.target.value))}>
        <option value={-1}>종료 상태</option>
        {moments.map((moment, index) => <option key={index} value={index}>{index + 1}. {moment.label} · {fmt(moment.frame.atMs / 1000)}초</option>)}
      </select></label>
      <div className="process-replay-buttons">
        <button disabled={reviewIndex <= 0} onClick={() => previewMoment(reviewIndex - 1)}>이전 순간</button>
        <button disabled={reviewIndex >= moments.length - 1} onClick={() => previewMoment(reviewIndex + 1)}>다음 순간</button>
        <button disabled={reviewIndex === -1} onClick={() => previewMoment(-1)}>종료 상태 보기</button>
      </div>
      <p>왼쪽 장면과 아래 좌표를 함께 보세요. 저장된 실행 장면을 확인합니다.</p>
    </aside>}
    {props.hardwareConnected && <p className="process-feedback process-failure" role="status">가상 공정은 가상 DT 모드에서 실장비 연결을 해제한 뒤 실행하세요.</p>}
    {!props.sceneReady && <p className="process-muted" role="status">3D 작업 공간을 준비하고 있습니다.</p>}
    {storageFailed && <div className="process-feedback process-failure" role="alert">학습 기록을 기기에 저장하지 못했습니다. 기록을 내려받아 보관하세요.<button onClick={exportRecords}>기록 내려받기</button></div>}
    {view === "intro" && level === 4 && <div className="process-task">
      <h2>블록 4개를 서로 다른 칸에 배치하세요.</h2>
      <p>A가 공급·인계하고 B가 포장합니다. 집기 위치, 인계 조건, 포장 좌표와 순서를 정하세요.</p>
      {packingGrid}
      <h3 className="process-subtitle">{question.title}</h3>
      <ul className="process-givens">{question.givens.map(given => <li key={given}>{given}</li>)}</ul>
      <button className="process-primary" disabled={locked} onClick={() => { setView("structure"); setNotice(""); }}>관계부터 생각하기</button>
    </div>}
    {view === "intro" && level !== 4 && <div className="process-task">
      <h2>어디에서 집고, 어디에 놓아야 할까요?</h2>
      <div className="process-connection"><strong>{LEVEL_CONNECTION[level].before}에서 이어가기</strong>
        <p>{taskKind === "transfer" ? "주어진 조건에서 사용할 수학적 관계를 먼저 선택하고 작업 좌표를 예상하세요." : LEVEL_CONNECTION[level].now}</p>
        <p>{taskKind === "transfer" ? "계산: 작업점 / 판단: 이동 순서 / 확인: 블록이 도착한 위치" : LEVEL_CONNECTION[level].task}</p></div>
      <p className="process-route" aria-label="공정 순서">{LEVEL_FLOW[level].map((step, index) => <span key={step}>{index > 0 && <i aria-hidden="true">→</i>}<span>{step}</span></span>)}</p>
      <p>{level === 1 ? "출발점과 이동량으로 도착점을 정하고, 블록 한 개를 목표에 놓으세요." : level === 2 ? "벨트가 멈출 위치를 먼저 구하고, 그 위치에서 블록을 집어 도착 작업대에 놓으세요." : level === 3 ? "같은 인계점을 A와 B의 좌표로 나타내고, B가 이어받을 조건을 정하세요." : "집을 위치, 두 로봇의 인계점, 포장할 네 칸을 모두 계획하세요."}</p>
      <p className="process-muted">{taskKind === "transfer" ? "새 조건에서는 관계와 좌표를 먼저 스스로 정하세요. 처음 예측을 저장한 뒤 미리보기와 실행 결과로 확인합니다. 필요한 힌트는 각 입력 옆에서 볼 수 있습니다." : "관계와 작업점을 예측한 뒤 실행합니다. 결과를 보고 판단을 유지할지 수정할지 정하세요."}</p>
      <button className="process-primary" disabled={locked} onClick={() => { setView("structure"); setNotice(""); }}>관계부터 생각하기</button>
    </div>}
    {view === "structure" && <div className="process-task">
      <h2>이 공정에는 어떤 관계가 필요한가요?</h2><p>{structure.prompt}</p>
      <fieldset className="process-options" disabled={locked}><legend className="process-visually-hidden">사용할 수학적 관계</legend>{structure.options.map(option => <label key={option.value}><input type="radio" name="process-structure" value={option.value} checked={structureChoice === option.value} onChange={event => { setStructureChoice(event.target.value); setNotice(""); }}/><span>{option.label}</span></label>)}</fieldset>
      {notice && <p className="process-feedback process-failure" role="alert">{notice}</p>}
      <div className="process-actions"><button disabled={locked} onClick={() => { setView("intro"); setNotice(""); }}>과제 다시 보기</button><button className="process-primary" disabled={locked} onClick={submitStructure}>관계 확인 · 좌표 예측</button></div>
    </div>}
    {view === "question" && question && <div className="process-task">
      {level !== 4 && <nav className="process-question-nav" aria-label="작업 계획 선택">
        {scenario.questions.map((item, index) => <button key={item.id} type="button"
          aria-current={index === questionIndex ? "step" : undefined} disabled={locked}
          onClick={() => goQuestion(index)}>{index + 1}. {item.title}</button>)}
      </nav>}
      <p className="process-question-count">작업 계획 {questionIndex + 1}/{scenario.questions.length}</p><h2>{question.title}</h2><p>{question.prompt}</p>
      <ul className="process-givens">{question.givens.map((given, index) => <li key={index}>{given}</li>)}</ul>
      {question.id === "tray" && packingGrid}
      <fieldset disabled={locked} className={`process-fields${question.id === "tray" ? " process-packing-fields" : ""}`}><legend className="process-visually-hidden">예측한 값과 작업 조건</legend>{question.fields.map(field => <div key={field.key} className={`process-field${field.sequence ? " process-field-sequence" : ""}`}>
        {field.sequence ? <fieldset className="process-sequence"><legend>{field.label}</legend>
          <p>{field.key === "packingOrder" ? "블록 1부터 놓을 칸을 차례로 누르세요. 선택한 순서로 로봇이 움직입니다." : "블록을 집은 다음, 실행할 동작을 순서대로 눌러 주세요."}</p>
          <div className="process-sequence-options">{field.sequence.map(item => <button key={item.value} type="button"
            disabled={locked || (draft[field.key] ?? "").includes(String(item.value))}
            onClick={() => { if (locked) return; setDraft(values => ({ ...values, [field.key]: (values[field.key] ?? "") + item.value })); setNotice(""); }}>{item.label}</button>)}</div>
          <ol aria-label={field.key === "packingOrder" ? "내가 정한 포장 순서" : "내가 정한 운반 순서"}>{(draft[field.key] ?? "").split("").filter(Boolean).map((value, index) => <li key={index}>
            {field.sequence!.find(item => String(item.value) === value)?.label}</li>)}</ol>
          <button type="button" disabled={locked || !draft[field.key]} onClick={() => setDraft(values => ({ ...values, [field.key]: (values[field.key] ?? "").slice(0, -1) }))}>마지막 동작 취소</button>
        </fieldset> : field.options ? <fieldset className="process-options"><legend>{field.label}</legend>{field.options.map(option => <label key={option.value}><input type="radio" name={`process-${field.key}`} value={option.value} checked={draft[field.key] === String(option.value)} onChange={event => { setDraft(values => ({ ...values, [field.key]: event.target.value })); setNotice(""); }}/><span>{option.label}</span></label>)}</fieldset>
          : <label htmlFor={`process-${field.key}`}>{field.label}<span className="process-number"><input id={`process-${field.key}`} type="number" step="any" inputMode="decimal" value={draft[field.key] ?? ""} onChange={event => { setDraft(values => ({ ...values, [field.key]: event.target.value })); setNotice(""); }}/><span>{field.unit}</span></span></label>}
        <details onToggle={event => { if (event.currentTarget.open) { setHintKeys(keys => keys.includes(field.key) ? keys : [...keys, field.key]); recordLearningAction("process-cell","hint-used",{condition:{id:scenario.id},hints:[field.key]},"dt"); } }}><summary>힌트</summary><p>{field.hint}</p></details>
      </div>)}</fieldset>
      {questionIndex === scenario.questions.length - 1 && <label className="process-text-label">어떻게 움직일 것으로 예상하나요?<textarea aria-label="예측 근거" rows={2} required disabled={locked} value={prediction} onChange={event => setPrediction(event.target.value)} placeholder="위치나 이동 순서를 그렇게 정한 이유를 식 또는 한 문장으로 적어 보세요."/></label>}
      {revisionOf && <p className="process-muted">이번 수정 이유: {revision}</p>}
      {notice && <p className="process-feedback process-failure" role="alert">{notice}</p>}
      <div className="process-actions">{questionIndex > 0 ? <button disabled={locked} onClick={() => goQuestion(questionIndex - 1)}>이전 질문</button> : <button disabled={locked} onClick={() => { setView("structure"); setNotice(""); }}>관계 다시 보기</button>}<button className="process-primary" disabled={locked} onClick={submitQuestion}>{questionIndex < scenario.questions.length - 1 ? "다음 작업점" : "예측 저장 · 전체 계획 보기"}</button></div>
    </div>}
    {view === "ready" && record && <div className="process-task">
      <h2>집기부터 놓기까지, 내 계획 확인</h2><p>내 예측으로 로봇이 어떻게 움직일지 왼쪽에서 미리 보고, 이동 순서와 위치를 확인하세요.</p>
      {scenario.tray && <>{packingGrid}{packingSummary}</>}
      <div className="process-prediction" role="group" aria-label="예측 움직임 미리보기">
        <div className="process-prediction-actions">
          <button className="process-primary" disabled={locked || !props.sceneReady || !predictionModel.compilation?.frames.length}
            onClick={playPrediction}>{preview?.playing ? "미리보기 일시정지" : preview && preview.timeMs < (predictionModel.compilation?.durationMs ?? 0) ? "미리보기 계속" : "내 예측 움직임 보기"}</button>
          <button disabled={!preview || locked} onClick={cancelPrediction}>시작 자세로</button>
        </div>
        <label className="process-prediction-step">구간별 확인<select aria-label="미리보기 구간" value={previewStop}
          disabled={locked || !props.sceneReady || !previewStops.length} onChange={event => seekStop(Number(event.target.value))}>
          {previewStops.map((stop, index) => <option key={stop.index} value={index}>{index + 1}. {stop.label}</option>)}
        </select></label>
        <div className="process-prediction-seek"><button disabled={locked || !props.sceneReady || previewStop <= 0} onClick={() => seekStop(previewStop - 1)}>이전 구간</button>
          <input type="range" aria-label="예측 미리보기 진행 위치" min={0} max={predictionModel.compilation?.durationMs ?? 0} step={1}
            value={preview?.timeMs ?? 0} disabled={locked || !props.sceneReady || !predictionModel.compilation?.durationMs}
            onChange={event => seekPrediction(Number(event.target.value))}/>
          <button disabled={locked || !props.sceneReady || previewStop >= previewStops.length - 1} onClick={() => seekStop(previewStop + 1)}>다음 구간</button></div>
        <p>{preview ? `${preview.playing ? "미리보기 중" : "멈춘 장면"} · ${frame.phase}` : "저장한 입력값으로 계산한 움직임입니다. 실행·관찰 기록은 ‘공정 실행’부터 남습니다."}</p>
        {predictionModel.error && <p className="process-preview-error" role="alert">{predictionModel.error}</p>}
        {preview && predictionModel.compilation && preview.timeMs >= predictionModel.compilation.durationMs
          && predictionModel.compilation.outcome.issues.length > 0 && <p className="process-preview-error" role="alert">이동 확인 · {predictionModel.compilation.outcome.issues.join(" ")}</p>}
      </div>
      <div className="process-transport-summary">
        <strong>운반 높이 Z {fmt(record.answers.travelZ ?? 300)} mm</strong>
        {transportPlan && <span>P2 → P3 수평 경로 길이 <strong>{fmt(transportPlan.length)} mm</strong> · {formatAnswer(record.answers.routeChoice, fieldsFor(record).find(field => field.key === "routeChoice"))}</span>}
        <span>{record.answers.transferOrder === undefined ? "집기 → 들어 올리기 → 이동 → 내리기 → 놓기" :
          formatAnswer(record.answers.transferOrder, fieldsFor(record).find(field => field.key === "transferOrder"))}</span>
        <small>{transportPlan ? "P1·P4는 블록 위 접촉점, P2·P3는 공중의 작업점입니다. 화살표를 따라 이동 방향을 확인하세요." : "보라색은 A, 청록색은 B의 계산된 경로입니다. 같은 인계점도 A·B 기준 좌표는 다릅니다."}</small>
      </div>
      <div className="process-table-wrap"><table className="process-plan"><caption>전체 작업점 · 각 로봇 기준 좌표 (X, Y, Z), mm</caption><thead><tr><th scope="col">작업점</th><th scope="col">기준</th><th scope="col">좌표</th></tr></thead><tbody>{plannedPoints.map((row, index) => <tr key={`${row.label}-${index}`} className={selectedPoint === index ? "is-selected" : undefined}><th scope="row">{row.marker && <span className="process-point-tag">{row.marker}</span>}<button type="button" aria-pressed={selectedPoint === index} onClick={() => { if (row.traySlot !== undefined) selectPackingSlot(row.traySlot); else { cancelPrediction(); setSelectedSlot(null); setSelectedPoint(index); setSelectedRobot(row.robot); if (level === 4) requestCamera("work"); } }}>{row.label}</button><small>{row.kind === "given" ? "주어진 값" : "내 계산"}</small></th><td>{row.robot}</td><td>{point(row.pose)}</td></tr>)}</tbody></table></div>
      {scenario.tray && <p className="process-muted">칸 4에는 직접 예측한 좌표를, 나머지 칸에는 행·열 이동량을 적용합니다. 블록 번호는 내가 정한 포장 순서입니다.</p>}
      {record.answers.handoffReady !== undefined && <p className="process-plan-condition"><strong>B의 진입 조건</strong> {formatAnswer(record.answers.handoffReady, fieldsFor(record).find(field => field.key === "handoffReady"))}</p>}
      <label className="process-review"><input type="checkbox" checked={planReviewed} onChange={event => setPlanReviewed(event.target.checked)}/> 작업점과 작업 순서를 모두 확인했습니다.</label>
      <label className="process-speed">재생 속도<select value={speed} onChange={event => setSpeed(Number(event.target.value))}><option value={1}>1배</option><option value={2}>2배</option></select></label>
      <div className="process-actions"><button className="process-primary" disabled={locked || !props.sceneReady || !planReviewed} onClick={execute}>공정 실행</button><button disabled={locked} onClick={() => goQuestion(0)}>예측 수정</button></div>
    </div>}
    {running && <div className="process-task process-live" aria-live="polite"><p className="process-question-count">공정 실행 중 · {progress}%{frame.processStatus && <span>완료 {frame.processStatus.completed}/{frame.processStatus.total}</span>}</p><h2>{frame.phase}</h2>
      {frame.processStatus ? <dl className="process-flow-status"><div><dt>공급</dt><dd>{frame.processStatus.feed}</dd></div><div><dt>로봇 A</dt><dd>{level === 4 && frame.processStatus.APiece && `블록 ${frame.processStatus.APiece} · `}{frame.processStatus.A}</dd></div>{frame.processStatus.B && <div><dt>로봇 B</dt><dd>{level === 4 && frame.processStatus.BPiece && `블록 ${frame.processStatus.BPiece} → 칸 ${(packingPlan[frame.processStatus.BPiece - 1]?.slot ?? 0) + 1} · `}{frame.processStatus.B}</dd></div>}</dl>
        : <p>{frame.activeRobot ? `로봇 ${frame.activeRobot}가 작업 중입니다.` : "컨베이어와 작업물의 움직임을 관찰하세요."}</p>}
      {scenario.handoff && frame.processStatus && <p className="process-handoff-status">인계대 · {HANDOFF_STATE[frame.processStatus.handoff]}</p>}
      <progress max={100} value={progress} aria-label="공정 실행 진행률"/><button onClick={() => halt("학습자가 실행을 중지했습니다.")}>실행 중지</button></div>}
    {view === "observe" && record && <div className="process-task">
      <h2>{record.status === "unavailable" ? "실행하지 못한 지점 확인" : "무슨 일이 일어났나요?"}</h2>
      {record.stopReason && <p className="process-feedback process-failure" role="status">{record.stopReason}</p>}
      {observedFrame ? <>
        <p className="process-observation-summary">{level === 4 && "전체 실행 결과 · "}목표에 놓인 블록 <strong>{completedPieces}/{observedFrame.processStatus?.total ?? 1}개</strong> · 관찰한 공정 시간 <strong>{fmt((record.executed?.simulationMs ?? 0) / 1000)}초</strong></p>
        <p>{reviewing ? "선택한 순간" : "마지막 상태"}: {(inspectedFrame ?? observedFrame).phase}</p>
        {level === 4 && reviewing && inspectedFrame && <p className="process-muted">이 장면 · {fmt(inspectedFrame.atMs / 1000)}초 · 배치된 블록 {inspectedFrame.workpieces.filter(piece => piece.placed).length}/{inspectedFrame.processStatus?.total ?? 4}개</p>}
        <div className="process-table-wrap"><table className="process-plan"><caption>{reviewing ? "선택한 순간의" : "종료 시점의"} 블록 위치 · 로봇 {selectedRobot} 기준 (X, Y, Z), mm</caption><thead><tr><th scope="col">블록</th><th scope="col">관찰 위치</th><th scope="col">상태</th></tr></thead><tbody>{(inspectedFrame ?? observedFrame).workpieces.map((piece, index) => <tr key={piece.id}><th scope="row">{index + 1}</th><td>{point(worldToLocal(piece.top, displayRobot))}</td><td>{piece.placed ? "목표에 놓임" : piece.owner ? `로봇 ${piece.owner}가 잡고 있음` : "잡지 않은 상태"}</td></tr>)}</tbody></table></div>
        {observedEvents.length > 0 && <details className="process-details"><summary>실제로 발생한 작업 확인</summary><ul className="process-events">{observedEvents.map(event => <li key={event}>{processEventLabel(event)}</li>)}</ul></details>}
        {record.outcome?.observations.length ? <details className="process-details"><summary>집기·놓기에서 관찰한 TCP 좌표</summary><ol className="process-observed-points">{record.outcome.observations.map((item, index) => <li key={index}>로봇 {item.robot} 기준 {point(item.observed)} mm</li>)}</ol></details> : null}
        <p className="process-muted">가상 공정을 실제로 재생한 구간의 관찰값입니다.{record.status === "stopped" ? " 중지한 뒤의 동작은 수행하지 않았습니다." : ""}</p>
      </> : <p className="process-muted">로봇 이동을 시작하지 못해 관찰 좌표가 없습니다. 위의 중단 원인을 기록하고 입력값을 검토하세요.</p>}
      {needsObservation ? <label className="process-text-label">실제로 일어난 일을 기록하세요<textarea rows={2} value={observedText} onChange={event => setObservedText(event.target.value)} placeholder={level === 1 ? "한 장면을 골라 좌표나 변화량으로 적으세요. 예: 집기→운반 ΔZ=__ mm."
        : level === 2 ? "벨트는 Y=__에서 멈췄고, 로봇은 Y=__에서 블록을 집었다."
        : level === 3 ? "같은 인계점을 A 기준(__, __), B 기준(__, __) mm로 나타내세요."
        : "목표에 놓인 블록은 __개였다. 다음 블록의 공급과 포장이 __ 순서로 이어졌다."}/></label>
        : <p className="process-muted">집기·놓기 장면과 좌표를 확인한 뒤 비교하세요. 화면에 있는 값을 다시 적지 않아도 됩니다.</p>}
      <div className="process-actions"><button className="process-primary" disabled={needsObservation && !observedText.trim()} onClick={() => { if (needsObservation && !observedText.trim()) return; const changed = record.observation !== observedText.trim(); save({ ...record, observation: observedText.trim(), observedAt: new Date().toISOString(), ...(changed ? { reflection: undefined, reflectedAt: undefined } : {}) }); if (changed) setReflection(""); setView("compare"); setNotice(""); }}>{needsObservation ? "관찰 저장 · 비교하기" : "관찰 확인 · 비교하기"}</button></div>
    </div>}
    {view === "compare" && record && <div className="process-task">
      <h2>내 예측과 실행 결과 비교하기</h2>
      {record.observation && <p className="process-observation-summary"><strong>내 관찰</strong> {record.observation}</p>}
      <div className={`process-feedback ${passed ? "process-success" : "process-failure"}`} role="status"><p>{passed ? "목표 위치에 모든 블록을 놓고 시작 자세로 돌아왔습니다." : record.status === "stopped" ? "실행이 중지되었습니다. 실제로 진행한 구간부터 검토하세요." : record.status === "unavailable" ? "공정을 시작하지 못했습니다. 입력값과 중단 원인을 검토하세요." : record.outcome && record.outcome.completedPieces === record.outcome.totalPieces ? "블록 배치는 완료했지만 과제의 수학 조건과 다른 입력이 있습니다. 아래 비교에서 확인하세요." : "목표를 모두 수행하지 못했습니다. 입력값과 작업 조건을 검토하세요."}</p></div>
      {record.outcome?.issues.length ? <ul className="process-issues">{record.outcome.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul> : null}
      {record.structureChoice !== structure.expected && <div className="process-feedback">
        <p><strong>처음 선택한 관계</strong> · {structure.options.find(option => option.value === record.structureChoice)?.label}</p>
        <p>{structure.feedback}</p>
        <label className="process-text-label">실행 결과를 보고 다시 정한 관계<select aria-label="실행 결과를 보고 다시 정한 관계" value={record.structureReview ?? ""} disabled={locked}
          onChange={event => save({ ...record, structureReview: event.target.value, reflectedAt: undefined })}>
          <option value="">선택하세요</option>{structure.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
        {record.structureReview === structure.expected && <p>관계를 다시 확인했습니다. 처음 선택은 보존되며 로봇을 재실행하지 않아도 됩니다.</p>}
      </div>}

      {!!record.outcome?.observations.length && <section className="process-coordinate-review" aria-label="목표와 실행 좌표 비교">
        <h3 className="process-subtitle">과제 목표 · 내 명령 · 도달 위치</h3>
        <p className="process-muted">명령대로 움직였는지와 과제 목표에 도착했는지를 구분해 보세요. 좌표는 각 행의 로봇 기준입니다.</p>
        <div className="process-table-wrap"><table className="process-plan">
          <caption>실제로 수행한 작업점 (X, Y, Z), mm</caption>
          <thead><tr><th scope="col">작업</th><th scope="col">과제 목표</th><th scope="col">내 명령</th><th scope="col">도달 위치</th></tr></thead>
          <tbody>{record.outcome.observations.map((item, index) => <tr key={index}>
            <th scope="row">{item.robot} · {level === 4 && item.pieceId && `블록 ${item.pieceId.replace("piece-", "")} · `}{item.label ?? "작업점"}{item.traySlot !== undefined && ` → 칸 ${item.traySlot + 1}`}</th>
            <td>{item.goal ? point(item.goal) : "—"}</td><td>{point(item.target)}</td><td>{point(item.observed)}</td>
          </tr>)}</tbody>
        </table></div>
      </section>}
      {record.outcome && <><h3 className="process-subtitle">입력값의 수학적 비교</h3><p className="process-muted">과제 조건으로 계산한 기준값과 비교합니다. 아래 판정은 각 동작이 실제로 수행되었다는 뜻은 아닙니다.</p><div className="process-checks">{record.outcome.checks.map(check => { const field = fieldsFor(record).find(item => item.key === check.key); return <div className={check.passed ? "is-correct" : "is-incorrect"} key={check.key}><strong>{check.passed ? "✓" : "!"} {check.label}</strong><span>내 예측 {formatAnswer(check.actual, field)} · {field?.accepted ? field.key === "packingOrder" ? "네 칸을 한 번씩 채우는 순서" : "선택 가능한 경로" : "수학적 기준 " + formatAnswer(check.expected, field)}</span></div>; })}</div></>}
      {!!record.outcome?.observations.length && <details className="process-details"><summary>좌표 → 역기구학 → 관절각 → 순기구학 확인</summary>
        <div className="process-table-wrap"><table className="process-plan"><caption>각 로봇 기준 좌표 (X, Y, Z), mm · 실제 도달한 작업점만 표시</caption><thead><tr><th scope="col">로봇</th><th scope="col">명령 좌표</th><th scope="col">관찰 좌표</th></tr></thead><tbody>{record.outcome.observations.map((item, index) => <tr key={index}><th scope="row">{item.robot}</th><td>{point(item.target)}</td><td>{point(item.observed)}</td></tr>)}</tbody></table></div>
        <p>명령한 좌표에 도달했어도 그 좌표가 블록 위치와 다르면 집기에 실패합니다.</p>
        {scenario.robots.length > 1 && <label className="process-speed">기구학 확인 로봇<select aria-label="기구학 확인 로봇" value={selectedRobot} onChange={event => setSelectedRobot(event.target.value as CellRobotId)}>{scenario.robots.map(robot => <option key={robot.id} value={robot.id}>로봇 {robot.id}</option>)}</select></label>}
        {kinematicObservation && observationFK && <dl>
          <div><dt>로봇 {selectedRobot} · 마지막 명령 좌표</dt><dd>{point(kinematicObservation.target)} mm</dd></div>
          <div><dt>역기구학으로 계산한 J1·J2·J3·J4</dt><dd>{Object.values(kinematicObservation.joints).map(fmt).join(" · ")}°</dd></div>
          <div><dt>순기구학으로 확인한 TCP</dt><dd>{point(observationFK)} mm</dd></div>
          <div><dt>명령 좌표 대비 관찰 오차</dt><dd>{fmt(kinematicObservation.error)} mm</dd></div>
        </dl>}
        <p className="process-muted">수업용 운동학 모델에서 계산한 가상 관찰값입니다.</p>
      </details>}
      {!record.outcome && <details className="process-details"><summary>이번에 입력한 값 확인</summary><dl>{fieldsFor(record).map(field => <div key={field.key}><dt>{field.label}</dt><dd>{formatAnswer(record.answers[field.key], field)}</dd></div>)}</dl></details>}
      <LearningJudgmentFields value={judgment} onChange={setJudgment} disabled={locked} idPrefix="process-judgment" fieldClassName="process-field" showBasis={detailedReflection}/>
      {needsReflection ? <label className="process-text-label">예측과 결과의 차이를 설명하세요<textarea rows={2} value={reflection} onChange={event => { setReflection(event.target.value); setNotice(""); }} placeholder={level === 1 ? "관찰한 높이와 위치를 보니 __ 순서가 필요했다. 그래서 처음 판단을 __한다."
        : level === 2 ? "속도 × 시간은 이동량이다. 여기에 __을 더한 정지 위치가 관찰값과 __했다."
        : level === 3 ? "같은 인계점의 A·B 좌표가 다른 이유는 __이다. B가 진입할 조건은 __이다."
        : "첫 칸 좌표에 열·행 이동량을 더하면 __이 된다. 실제 배치와 비교하면 __하다."}/></label>
        : <p className="process-muted">처음 쓴 예측 근거를 유지하면 다시 적지 않고 저장할 수 있습니다.</p>}
      {detailedReflection && <p className="process-muted">관찰한 값을 반복하지 말고, 참고한 정보가 판단에 어떻게 쓰였는지 한 줄로 연결하세요.</p>}
      <div className="process-actions"><button disabled={locked || !comparisonReady} onClick={() => { if (locked || !comparisonReady) return; save({ ...record, reflection: reflection.trim(), reflectedAt: new Date().toISOString(), judgment: { ...judgment } }); setNotice("비교·해석을 기록했습니다."); }}>비교·해석 저장</button><button className="process-primary" disabled={locked || !comparisonSaved} onClick={() => { if (!comparisonSaved) return; setRevision(""); setView("revise"); setNotice(""); }}>{passed && judgment.decision === "maintain" ? "판단 유지 · 다음 단계" : "수정 계획 세우기"}</button></div>
      {notice && <p className="process-feedback process-success" role="status">{notice}</p>}
      <button className="process-text-button" onClick={() => { setView("observe"); setNotice(""); }}>실행 관찰 다시 보기</button>
      {passed && comparisonSaved && level < 4 && <button className="process-primary process-next" disabled={locked} onClick={() => { setLevel((level + 1) as CellLevel); setVariant(0); }}>다음 공정으로</button>}
      {passed && comparisonSaved && level === 4 && <p className="process-completion-note">공정 계획과 비교를 완료했습니다. 값을 수정해 다시 확인하거나, 조건을 바꿔 도전할 수 있습니다.</p>}
    </div>}
    {view === "revise" && record && <div className="process-task">
      {passed && judgment.decision === "maintain" ? <>
        <h2>확인한 계획을 새 조건에 적용하기</h2>
        <p>처음 예측과 비교 후 판단을 저장했습니다. 같은 이유를 다시 쓰거나 재실행하지 않아도 됩니다.</p>
        <div className="process-actions"><button disabled={locked} onClick={() => setView("compare")}>비교 다시 보기</button>
          <button className="process-primary" disabled={locked} onClick={() => setVariant(value => value + 1)}>같은 공정 · 새 조건에 도전</button>
          {level < 4 && <button disabled={locked} onClick={() => { setLevel((level + 1) as CellLevel); setVariant(0); }}>다음 공정으로</button>}
        </div>
      </> : <>
      <h2>무엇을 바꾸고 다시 확인할까요?</h2>
      <p>{passed ? "다른 값을 넣으면 어느 작업에서 결과가 달라질지 예상하거나, 성공한 계획을 다시 확인하세요." : "관찰한 위치와 작업 순서를 근거로 고칠 좌표나 조건을 정하세요."}</p>
      <p className="process-observation-summary"><strong>내 비교·해석</strong> {record.reflection}</p>
      <label className="process-text-label">수정할 값·조건과 이유<textarea rows={2} disabled={locked} value={revision} onChange={event => setRevision(event.target.value)} placeholder="__을 __로 바꾸려 한다. __을 보니 __할 것으로 예상하기 때문이다."/></label>
      <div className="process-actions"><button disabled={locked} onClick={() => setView("compare")}>비교 다시 보기</button><button className="process-primary" disabled={locked || !revision.trim()} onClick={retry}>수정 이유 저장 · 예측 고치기</button></div>
      </>}
    </div>}
    <footer className="process-footer"><details className="process-details"><summary>과제 관리 · 학습 기록</summary><div className="process-actions"><button onClick={fresh}>과제 초기화</button><button disabled={running || props.hardwareConnected} onClick={() => setVariant(value => value + 1)}>조건 바꾸기</button></div>
      {previous && <details className="process-details"><summary>이전 시도 · {didPass(previous) ? "성공" : previous.status === "stopped" ? "중지" : "확인 필요"}</summary><p>{Object.entries(previous.answers).map(([key, value]) => { const field = fieldsFor(previous).find(item => item.key === key); return `${field?.label ?? key}: ${formatAnswer(value, field)}`; }).join(" / ")}</p>{previous.observation && <p>관찰: {previous.observation}</p>}{previous.reflection && <p>비교: {previous.reflection}</p>}{previous.outcome?.issues.map((issue, index) => <p key={index}>{issue}</p>)}</details>}
      <p className="process-muted">예측, 실행한 구간, 관찰, 비교와 수정 이유를 함께 보관합니다.</p><button onClick={exportRecords} disabled={!evidence.length && unreadableBackup === null && unreadableCheckpoint === null}>학습 기록 내려받기</button>
    </details></footer>
  </section>;
}
