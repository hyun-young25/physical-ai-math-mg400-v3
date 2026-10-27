import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MotionProps } from "./LessonPages";
import { parseLessonNumber, type LessonPose } from "./curriculum";
import { learningRecordContext } from "./learningFramework";
import { downloadEvidence } from "./learningEvidenceStorage";
import { createProcessEvidenceStore } from "./processEvidence";
import { localToWorld, worldToLocal } from "./processCell";
import type { CellFrame, CellVisual } from "./processCellTypes";
import { DESIGN_ROLES, compileDesign, designScenario, emptyDesignPlan, initialDesignFrame, validateDesignPlan } from "./pickPlaceCore";
import type { DesignCommand, DesignLevel, DesignObservation, DesignRecord, DesignRelations, DesignResult, DesignRole } from "./pickPlaceDesignTypes";
import { usePractice } from "./PracticeProvider";
import { MOCK_LABEL } from "./PracticeControls";
import { rotationDistance, type PracticeOperation, type RobotMeasurement } from "./practiceSession";
import { ProcessCellLesson } from "./ProcessCellLesson";
import "./pickPlaceDesign.css";

type Props = MotionProps & { sceneReady: boolean; onVisualChange: (visual: CellVisual | null) => void };
type Stage = "task" | "relations" | "plan" | "execution" | "observation" | "compare" | "revision";
const STAGES: { id: Stage; label: string }[] = [
  { id: "task", label: "과제" }, { id: "relations", label: "관계" }, { id: "plan", label: "계획" },
  { id: "execution", label: "실행" }, { id: "observation", label: "관찰" }, { id: "compare", label: "비교" }, { id: "revision", label: "수정" },
];
export const PICK_PLACE_LAYOUT_CLASS = "pick-place-chapter-layout";
const STORAGE_KEY = "physical-ai-pickplace-design-v1";
const STATUSES = ["running", "completed", "stopped", "unavailable"];
const isRecord = (v: unknown): v is DesignRecord => {
  const r = v as DesignRecord;
  return !!r && typeof r === "object" && typeof r.id === "string" && typeof r.sessionId === "string" && ["dt", "hardware", "mock"].includes(r.source)
    && typeof r.scenarioId === "string" && [1, 2, 3].includes(r.level) && !!r.relations && typeof r.relations === "object"
    && Array.isArray(r.commands) && Array.isArray(r.frames) && Array.isArray(r.observations) && STATUSES.includes(r.status)
    && r.teacherReview?.status === "pending";
};
const store = createProcessEvidenceStore<DesignRecord>({
  key: STORAGE_KEY, isRecord, isCheckpoint: v => isRecord(v) && v.status === "running",
  recoverCheckpoint: (cp, saved) => !saved || saved.status === "running" ? cp : null,
  normalizeRecord: r => r.status === "running"
    ? { ...r, status: "stopped", result: undefined, failure: undefined, stopReason: "실행 중 화면이 닫혔습니다." } : r,
});
const evidence = store.records;
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const persist = (r: DesignRecord) => store.save(r, r.status !== "running");
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const fmt = (n: number) => Number(n.toFixed(2)).toString();
const pt = (p: Pick<LessonPose, "x" | "y" | "z">) => `(${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)})`;
const UI_MS = 100, SNAP_MS = 250;
const roleLabel = (role: DesignRole) => DESIGN_ROLES.find(r => r.role === role)?.label ?? role;
const STATE_LABEL = { free: "자유", held: "잡음", placed: "놓임", unknown: "확인 안 됨(물체 미검증)" } as const;
const COMMAND_STATUS = { completed: "동작 완료", interrupted: "중간 중단", rejected: "실행 거부" } as const;
// A role palette, not a supplied correct execution order.
const ROLE_PALETTE: DesignRole[] = ["transfer", "grip", "above", "retreat", "approach", "release", "lower", "lift", "contact"];

// Correct choices sit at differing positions so the order itself is not a clue.
const RELATION_CHOICES: { key: keyof Omit<DesignRelations, "travelZ">; title: string; options: [string, string][]; correct: string }[] = [
  { key: "coordinate", title: "좌표 관계", correct: "B=A+Δ", options: [["B=A+Δ", "도착 B = 시작 A + 이동량 Δ"], ["B=Δ", "도착 B = 이동량 Δ"]] },
  { key: "contact", title: "접촉 높이", correct: "TCP=top", options: [["TCP=base", "TCP Z = 블록 바닥 높이"], ["TCP=top", "TCP Z = 블록 윗면(접촉) 높이"]] },
  { key: "height", title: "운반 높이", correct: "travelZ>=min", options: [["travelZ>=min", "운반 Z ≥ 최소 높이"], ["travelZ<min", "운반 Z < 최소 높이"]] },
  { key: "vertical", title: "수직 이동", correct: "XY constant", options: [["XY changes", "내리고 올릴 때 X·Y 변화"], ["XY constant", "내리고 올릴 때 X·Y 일정"]] },
];
const blankRelations = (): DesignRelations => ({ coordinate: "", contact: "", height: "", vertical: "", travelZ: "" });
const num = (s: string) => parseLessonNumber(s);

/** Function-level guard: never trust that a disabled button stopped the call. */
function planProblem(commands: DesignCommand[], relations: DesignRelations): string | null {
  if (!commands.length) return "명령을 한 개 이상 추가하세요.";
  for (const c of RELATION_CHOICES) {
    if (!relations[c.key]) return `'${c.title}' 관계를 선택하세요.`;
    if (relations[c.key] !== c.correct) return `'${c.title}' 선택이 이 과제의 조건과 맞지 않습니다. 관찰한 물체와 로봇 동작을 다시 생각해 보세요.`;
  }
  if (num(relations.travelZ) === null) return "운반 Z를 숫자로 입력하세요.";
  for (const [i, c] of commands.entries()) {
    if (c.action === "move" && [c.x, c.y, c.z].some(v => num(v) === null)) return `${i + 1}번 명령의 좌표를 숫자로 입력하세요.`;
    if ([c.expectedX, c.expectedY, c.expectedZ].some(v => num(v) === null)) return `${i + 1}번 명령의 예측 끝점(X·Y·Z)을 입력하세요.`;
  }
  try { return validateDesignPlan(commands, relations); } catch (e) { return e instanceof Error ? e.message : "계획을 확인할 수 없습니다."; }
}
const didPass = (r: DesignRecord | null | undefined) => !!r && r.status === "completed" && r.result?.finished === true && r.result.passed === true;

type Playback = { token: number; record: DesignRecord; result: DesignResult; index: number; simMs: number; frames: CellFrame[]; lastSnap: number; published: number; wall: number; started: number | null; checkpoint: number };

export function PickPlaceChapter(props: Props) {
  const latest = useRef(props); latest.current = props;
  const [level, setLevel] = useState<DesignLevel>(1), [variant, setVariant] = useState(0);
  const scenario = useMemo(() => designScenario(level, variant), [level, variant]);
  const [supportChoice, setSupportChoice] = useState<DesignRecord["support"]>("guided");
  const support: DesignRecord["support"] = level < 3 && variant === 0 ? supportChoice : "challenge";
  const [stage, setStage] = useState<Stage>("task");
  const [commands, setCommands] = useState<DesignCommand[]>([]);
  const [relations, setRelations] = useState<DesignRelations>(blankRelations);
  const [reason, setReason] = useState("");
  const [frozen, setFrozen] = useState<{ commands: DesignCommand[]; relations: DesignRelations; reason: string } | null>(null);
  const [frame, setFrame] = useState<CellFrame>(() => initialDesignFrame(props.model, designScenario(1, 0)));
  const [framingPoints, setFramingPoints] = useState<LessonPose[]>([]);
  const liveFrameRef = useRef(frame);
  const [record, setRecord] = useState<DesignRecord | null>(null);
  const [progress, setProgress] = useState(0);
  const [inspect, setInspect] = useState(-1);
  const [obsText, setObsText] = useState(""), [refText, setRefText] = useState(""), [revText, setRevText] = useState("");
  const [revisionOf, setRevisionOf] = useState<string | undefined>();
  const [revisionReason, setRevisionReason] = useState<string | undefined>();
  const [notice, setNotice] = useState("");
  const [storageFailed, setStorageFailed] = useState(store.failed);
  const [version, setVersion] = useState(0);
  const [extOpen, setExtOpen] = useState(false);
  const raf = useRef<number | null>(null), token = useRef(0), playback = useRef<Playback | null>(null);
  const hwRun = useRef(false), mounted = useRef(true), scroller = useRef<HTMLElement | null>(null);
  const practice = usePractice();
  const lockRef = useRef<null | (() => void)>(null);
  const releaseLock = () => { lockRef.current?.(); lockRef.current = null; };
  const [hwBusy, setHwBusy] = useState(false);
  const [virtualRef, setVirtualRef] = useState<string | undefined>();
  const running = stage === "execution" && (!!playback.current || hwBusy);
  const locked = props.hardwareConnected;

  const sessionId = learningRecordContext("dt").sessionId;
  const mine = useMemo(() => evidence.filter(isRecord), [version, sessionId]);
  const levelPassed = (l: number) => mine.some(r => r.level === l && didPass(r) && !!r.observation?.trim() && !!r.reflection?.trim());
  const extensionUnlocked = mine.some(r => r.level === 3 && r.variant === 0 && didPass(r) && !!r.observation?.trim() && !!r.reflection?.trim());

  const save = useCallback((next: DesignRecord) => {
    const ok = persist(next);
    if (mounted.current) { setRecord(next); setStorageFailed(!ok); setVersion(v => v + 1); }
  }, []);
  const publish = useCallback((f: CellFrame) => { liveFrameRef.current = f; setFrame(f); }, []);

  const halt = useCallback((why: string, updateView = true) => {
    token.current += 1;
    releaseLock();
    if (raf.current !== null) { cancelAnimationFrame(raf.current); raf.current = null; }
    const a = playback.current; playback.current = null;
    if (!a || a.record.status !== "running") return;
    const playedObs = a.result.observations.filter(o => o.atMs <= a.simMs);
    const frames = a.frames.slice(); const last = a.result.frames[a.index];
    if (last && frames[frames.length - 1]?.atMs !== last.atMs) frames.push(last);
    // Only the actually played prefix is kept; no result or pass flag exists.
    const stopped: DesignRecord = { ...a.record, status: "stopped", result: undefined, failure: undefined, stopReason: why,
      frames: copy(frames), observations: copy(playedObs) };
    liveFrameRef.current = last ?? liveFrameRef.current;
    if (updateView) { setFrame(last); setProgress(0); save(stopped); setInspect(-1); setStage("observation"); setNotice(why); }
    else persist(stopped);
  }, [save]);

  const fresh = useCallback((keepPlan = false) => {
    if (hwRun.current) { practice.session.stop(); latest.current.onVisualChange(null); return; }
    halt("과제를 초기화했습니다.", false);
    const s = designScenario(level, variant);
    publish(initialDesignFrame(latest.current.model, s));
    setFramingPoints([]);
    setStage("task"); setFrozen(null); setRecord(null); setProgress(0); setInspect(-1); setExtOpen(false);
    setObsText(""); setRefText(""); setRevText(""); setNotice(""); setRevisionOf(undefined); setRevisionReason(undefined);
    if (!keepPlan) { setCommands(emptyDesignPlan(level)); setRelations(blankRelations()); setReason(""); }
  }, [level, variant, halt, publish]);
  useLayoutEffect(() => { fresh(); }, [fresh, props.resetKey]);
  useLayoutEffect(() => { if (scroller.current) scroller.current.scrollTop = 0; }, [stage]);
  useLayoutEffect(() => { if (props.hardwareConnected) halt("실장비가 연결되어 가상 실행을 중지했습니다."); }, [props.hardwareConnected, halt]);
  useLayoutEffect(() => { if (practice.hardware) setExtOpen(false); }, [practice.hardware]);
  useLayoutEffect(() => { if (!props.sceneReady) halt("3D 화면이 중단되어 실행을 멈췄습니다."); }, [props.sceneReady, halt]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; practice.cancelConfirmation(); if (hwRun.current) practice.session.stop(); halt("다른 화면으로 이동했습니다.", false); latest.current.onVisualChange(null); };
  }, [halt]);

  // Observed trajectory comes from frames that were actually played.
  const observedRoutes = useMemo(() => {
    if (!record || !["execution", "observation", "compare", "revision"].includes(stage)) return undefined;
    const robot = scenario.robots[0];
    const played = playback.current?.frames ?? record.frames;
    const pts = played.flatMap(f => f.robots[robot.id] ? [localToWorld(f.robots[robot.id]!.pose, robot)] : []);
    const segments = pts.slice(1).map((to, i) => ({ from: pts[i], to })).filter(s => Math.hypot(s.from.x - s.to.x, s.from.y - s.to.y, s.from.z - s.to.z) > 0.5);
    return segments.length ? [{ robot: robot.id, segments }] : undefined;
  }, [record, stage, scenario, frame]);
  const srcTag = record?.source === "mock" ? MOCK_LABEL : record?.source === "hardware" ? "실측" : "DT 계산";
  const reviewObs = inspect >= 0 ? record?.observations[inspect] : undefined;
  const post = stage === "observation" || stage === "compare" || stage === "revision";
  // The visual effect updates the parent. Keep the converted review point
  // stable on parent-only renders to avoid an effect -> parent render loop.
  const focusPoint = useMemo(() => reviewObs ? localToWorld(reviewObs.actual, scenario.robots[0]) : post
    ? frame.robots[scenario.robots[0].id]?.pose
    : stage === "execution" || stage === "plan" ? scenario.destination : scenario.source,
  [reviewObs, scenario, post, frame, stage]);
  useEffect(() => {
    if (extOpen) return;
    latest.current.onVisualChange({ scenario, frame, liveFrameRef, showCoordinates: true, selectedRobot: scenario.robots[0].id,
      focusPoint, focusLabel: reviewObs ? roleLabel(reviewObs.role) : post ? `관찰 TCP · ${srcTag}` : stage === "plan" || stage === "execution" ? "도착 위치" : "출발 위치",
      predictedRoutes: observedRoutes, framingPoints, hideTargetCoordinates: !post, reviewing: !!reviewObs, running });
  }, [scenario, frame, extOpen, focusPoint, reviewObs, observedRoutes, framingPoints, post, running, stage]);

  const startPlan = () => {
    if (record || running) return;
    setStage("plan");
  };
  const toExecution = () => {
    if (locked || running || record) return;
    const problem = planProblem(commands, relations);
    if (problem) { setNotice(problem); return; }
    if (!reason.trim()) { setNotice("예측 이유를 한 줄로 적으세요."); return; }
    setFrozen({ commands: copy(commands), relations: copy(relations), reason: reason.trim() });
    publish(initialDesignFrame(latest.current.model, scenario));
    setNotice(""); setStage("execution");
  };

  const execute = () => {
    if (latest.current.hardwareConnected || practice.hardware || !latest.current.sceneReady || !frozen || record || playback.current) return;
    if (planProblem(frozen.commands, frozen.relations)) return;
    let result: DesignResult | null = null;
    let calculationError: string | undefined;
    try { result = compileDesign(latest.current.model, scenario, copy(frozen.commands), copy(frozen.relations)); }
    catch (e) { calculationError = e instanceof Error ? e.message : "계산할 수 없습니다."; }
    const base: DesignRecord = { id: newId(), sessionId, source: "dt", at: new Date().toISOString(), scenarioId: scenario.id, level, variant,
      support, relations: copy(frozen.relations), commands: copy(frozen.commands), predictionReason: frozen.reason, status: "running",
      frames: [], observations: [], teacherReview: { status: "pending", note: "" }, revisionOf, revisionReason };
    if (!result || result.frames.length < 2) {
      const why = calculationError || result?.outcome.issues.join(" ") || "실행할 경로를 만들지 못했습니다.";
      save({ ...base, status: "unavailable", stopReason: why }); setStage("observation"); setNotice(why); return;
    }
    const start: DesignRecord = { ...base, frames: [copy(result.frames[0])] };
    setFramingPoints(result.frames.flatMap(f => f.robots.A ? [{ ...f.robots.A.pose }] : []));
    save(start); setInspect(-1); publish(result.frames[0]); setProgress(0); setNotice("");
    const run: Playback = { token: ++token.current, record: start, result, index: 0, simMs: 0, frames: [result.frames[0]], lastSnap: 0, published: 0, wall: 0, started: null, checkpoint: 0 };
    // RAF may skip an endpoint, especially on phones. Keep every *crossed*
    // command boundary so row inspection replays the exact observed TCP/state.
    const boundaries = result.observations.map(o => result.frames.findLast(f => f.atMs <= o.atMs)!);
    playback.current = run; releaseLock(); lockRef.current = practice.lockVirtual(); setStage("execution");
    const tick = (now: number) => {
      if (token.current !== run.token || playback.current !== run || !mounted.current) return;
      if (latest.current.hardwareConnected) { halt("실장비가 연결되어 가상 실행을 중지했습니다."); return; }
      if (!latest.current.sceneReady) { halt("3D 화면이 중단되어 실행을 멈췄습니다."); return; }
      if (run.started === null) run.started = now;
      run.wall = now - run.started;
      run.simMs = Math.min(result.durationMs, run.wall);
      let next = run.index;
      while (next + 1 < result.frames.length && result.frames[next + 1].atMs <= run.simMs) next++;
      const f = result.frames[next];
      const obsHit = result.observations.some(o => o.atMs > result.frames[run.index].atMs && o.atMs <= f.atMs);
      for (const boundary of boundaries) {
        if (boundary.atMs > result.frames[run.index].atMs && boundary.atMs <= f.atMs
          && boundary.atMs > run.frames[run.frames.length - 1].atMs) run.frames.push(boundary);
      }
      run.index = next; liveFrameRef.current = f;
      if ((obsHit || f.atMs - run.lastSnap >= SNAP_MS) && f.atMs > run.frames[run.frames.length - 1].atMs) {
        run.frames.push(f); run.lastSnap = f.atMs;
      }
      if (obsHit || run.wall - run.published >= UI_MS) {
        run.published = run.wall; setFrame(f); setProgress(Math.round(run.simMs / Math.max(1, result.durationMs) * 100));
      }
      if (run.wall - run.checkpoint >= 1000) {
        run.checkpoint = run.wall;
        run.record = { ...run.record, frames: copy(run.frames), observations: copy(result.observations.filter(o => o.atMs <= run.simMs)) };
        if (!store.checkpoint(run.record)) setStorageFailed(true);
      }
      if (run.simMs >= result.durationMs) {
        const last = result.frames[result.frames.length - 1];
        if (run.frames[run.frames.length - 1]?.atMs !== last.atMs) run.frames.push(last);
        publish(last); raf.current = null; playback.current = null; releaseLock(); setProgress(100);
        save({ ...start, status: "completed", frames: copy(run.frames), observations: copy(result.observations),
          result: copy(result.outcome), failure: result.failure });
        setStage("observation");
      } else raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  const stop = () => { if (playback.current) halt("학생이 실행을 중지했습니다."); else if (hwRun.current) practice.session.stop(); };

  // Real/mock execution: every record value comes from fresh session measurements.
  // The virtual compileDesign below is a PREDICTION-ONLY preflight; its frames/observations are never stored as hardware data.
  const executeHardware = async () => {
    if (!practice.hardware || !frozen || record || playback.current || hwRun.current) return;
    const bad = planProblem(frozen.commands, frozen.relations); if (bad) { setNotice(bad); return; }
    const snap = practice.session.getSnapshot();
    const m0 = snap.measurement;
    if (!m0 || !snap.setup) { setNotice("실제 로봇 연결과 준비 설정을 먼저 완료하세요."); return; }
    const sc = scenario.robots[0].start;
    if (frozen.commands.some(c => c.action === "move" && c.mode === "relative")
      && (Math.hypot(m0.pose.x - sc.x, m0.pose.y - sc.y, m0.pose.z - sc.z) > 5 || rotationDistance(m0.pose.r, sc.r) > 5)) {
      setNotice(`가상 선검사는 시작 TCP (${fmt(sc.x)}, ${fmt(sc.y)}, ${fmt(sc.z)}) 기준입니다. 실제 TCP를 먼저 시작 위치로 옮기세요. 실행 시 상대 이동은 매 단계 새로 측정한 위치에서 계산됩니다.`); return;
    }
    // Virtual preflight (prediction only, not a safety certification).
    let pre: DesignResult | null = null, preErr = "";
    try { pre = compileDesign(latest.current.model, scenario, copy(frozen.commands), copy(frozen.relations)); }
    catch (e) { preErr = e instanceof Error ? e.message : "계산할 수 없습니다."; }
    if (!pre || !pre.outcome.finished || pre.failure !== null || !pre.outcome.passed) {
      setNotice(`가상 선검사(예측 전용) 실패 — 실제 실행을 막았습니다: ${preErr || pre?.outcome.issues.join(" ") || pre?.failure || "충돌·높이·순서·집기·놓기 조건을 확인하세요."}`); return;
    }
    const ops: PracticeOperation[] = frozen.commands.map(c => c.action === "move"
      ? { kind: "move" as const, motion: c.motion, target: { x: num(c.x)!, y: num(c.y)!, z: num(c.z)!, r: num(c.r ?? "") ?? 0 }, relative: c.mode === "relative" }
      : { kind: "suction" as const, on: c.action === "grip" });
    let source: "hardware" | "mock" = m0.source;
    const t0 = m0.receivedAt;
    const mkFrame = (m: RobotMeasurement, phase: string): CellFrame => ({ atMs: Math.max(0, m.receivedAt - t0), robots: { A: { pose: { ...m.pose }, joints: { ...m.joints } } },
      workpieces: [], beltProgress: 0, phase, activeRobot: null, target: null });
    const frames: CellFrame[] = [mkFrame(m0, "실측 시작")], obs: DesignObservation[] = [];
    const rec = (status: DesignRecord["status"], why?: string): DesignRecord => ({ id: baseId, sessionId, source, at: baseAt, scenarioId: scenario.id, level, variant, support,
      relations: copy(frozen.relations), commands: copy(frozen.commands), predictionReason: frozen.reason, status, stopReason: why, frames: copy(frames), observations: copy(obs),
      teacherReview: { status: "pending", note: "" }, revisionOf, revisionReason, virtualReferenceId: virtualRef, physicalObjectVerified: false });
    const baseId = newId(), baseAt = new Date().toISOString();
    // Terminal save must happen even if the student already left this screen.
    let started = false;
    const finish = (status: DesignRecord["status"], why: string) => { save(rec(status, why)); if (mounted.current) { setInspect(-1); setStage("observation"); } };
    hwRun.current = true; setHwBusy(true); setNotice("");
    try {
      const out = await practice.runOps(ops, "4. 실행 · 같은 계획을 실제 로봇에서 실측 · 가상 선검사(예측 전용, 안전 인증 아님) 통과 / 실제 형상·공구·작업 범위는 직접 확인", (m, i, op) => {
        if (m.source === "mock") source = "mock";
        const c = frozen.commands[i];
        const expected = { x: num(c.expectedX)!, y: num(c.expectedY)!, z: num(c.expectedZ)!, r: num(c.expectedR ?? "") ?? 0 };
        // target = the operation the session resolved from this step's fresh measured pose.
        const target: LessonPose = op.kind === "move" ? { ...op.target } : { ...m.pose };
        obs.push({ commandId: c.id, role: c.role, action: c.action, atMs: Math.max(0, m.receivedAt - t0), goal: null, target, expected,
          actual: { ...m.pose }, state: "unknown", commandStatus: "completed",
          predictionError: Math.hypot(expected.x - m.pose.x, expected.y - m.pose.y, expected.z - m.pose.z),
          rotationError: rotationDistance(expected.r, m.pose.r), inputBits: m.inputBits, outputBits: m.outputBits, measuredAt: m.measuredAt });
        const f = mkFrame(m, `${roleLabel(c.role)} · ${m.source === "mock" ? "모의" : "실측"}`);
        frames.push(f); store.checkpoint(rec("running"));
        if (mounted.current) publish(f);
      }, () => { started = true; store.checkpoint(rec("running")); });
      if (!out) { if (mounted.current) setNotice("실행 확인이 취소되어 아무 명령도 보내지 않았습니다."); return; }
      finish("completed", "물체를 실제로 집거나 놓았는지는 측정되지 않았습니다. 눈으로 확인하고 관찰에 적으세요. 합격 판정은 하지 않습니다.");
    } catch (e) {
      // Only the measured prefix is kept; no success is claimed.
      if (started || frames.length > 1 || obs.length) finish("stopped", e instanceof Error ? e.message : "실제 실행이 중단되었습니다.");
      else if (mounted.current) setNotice(e instanceof Error ? e.message : "실제 실행을 시작하지 못했습니다.");
    } finally { hwRun.current = false; if (mounted.current) setHwBusy(false); }
  };
  const reuseInHardware = () => {
    if (!record || record.source !== "dt" || record.status === "running" || running) return;
    try { practice.session.setMode("hardware"); } catch (e) { setNotice(e instanceof Error ? e.message : "모드를 바꿀 수 없습니다."); return; }
    // The virtual record stays untouched and linked; nothing executes on switching.
    setCommands(copy(record.commands)); setRelations(copy(record.relations)); setReason(record.predictionReason);
    setFrozen({ commands: copy(record.commands), relations: copy(record.relations), reason: record.predictionReason });
    setVirtualRef(record.id); setRevisionOf(undefined); setRevisionReason(undefined);
    setRecord(null); setObsText(""); setRefText(""); setInspect(-1); setProgress(0); setFramingPoints([]);
    publish(initialDesignFrame(latest.current.model, scenario));
    setNotice("가상 계획을 불러왔습니다. 안내·연결에서 준비를 마친 뒤 '실제 로봇 실행'을 누르세요. 아직 아무것도 실행되지 않았습니다."); setStage("execution");
  };

  const inspectAt = (i: number) => {
    if (running || !record) return;
    setInspect(i);
    const o = record.observations[i];
    const frames = record.frames;
    const f = o ? [...frames].reverse().find(x => x.atMs <= o.atMs) ?? frames[0] : frames[frames.length - 1];
    if (f) publish(copy(f));
  };
  const saveObservation = () => {
    if (!record || running || record.status === "running" || !obsText.trim()) { setNotice("관찰한 내용을 적으세요."); return; }
    const changed = record.observation !== obsText.trim();
    save({ ...record, observation: obsText.trim(), ...(changed ? { reflection: undefined, teacherReview: { status: "pending", note: "" } as const } : {}) });
    if (changed) setRefText("");
    setNotice("");
  };
  const saveReflection = () => {
    if (!record || !record.observation || running || !refText.trim()) { setNotice("예측과 실제를 비교한 설명을 적으세요."); return; }
    save({ ...record, reflection: refText.trim(), teacherReview: { status: "pending", note: refText.trim() } }); setNotice("");
  };
  const reviseNow = () => {
    if (!record || running || locked || record.status === "running" || !record.reflection) return;
    if (!revText.trim()) { setNotice("어떤 관계 또는 명령을 바꿀지 수정 이유를 적으세요."); return; }
    const reasonText = revText.trim();
    save({ ...record, revisionReason: reasonText });
    // The original plan is the editable starting point of the new attempt.
    setCommands(copy(record.commands)); setRelations(copy(record.relations)); setReason("");
    setRevisionOf(record.id); setRevisionReason(reasonText);
    setRecord(null); setFrozen(null); setObsText(""); setRefText(""); setRevText(""); setInspect(-1); setProgress(0);
    publish(initialDesignFrame(latest.current.model, scenario)); setNotice(""); setStage("plan");
    setFramingPoints([]);
  };
  const advance = (nextLevel: DesignLevel, nextVariant: number) => {
    if (locked || running || !didPass(record) || !record?.observation || !record?.reflection) return;
    setLevel(nextLevel); setVariant(nextVariant);
  };
  const exportRecords = () => downloadEvidence("pickplace-design-learning.json", {
    ...learningRecordContext("dt"), exportedAt: new Date().toISOString(),
    records: evidence.filter(r => (r as DesignRecord).source === "dt"),
    hardwareRecords: evidence.filter(r => (r as DesignRecord).source !== "dt"),
    ...(store.backups.history !== undefined ? { originalUnreadableData: store.backups.history } : {}),
    ...(store.backups.checkpoint !== undefined ? { originalUnreadableCheckpoint: store.backups.checkpoint } : {}),
  });

  const terminal = !!record && record.status !== "running";
  const canVisit = (s: Stage) => {
    if (running) return false;
    switch (s) {
      case "task": return true;
      case "relations": case "plan": return !record;
      case "execution": return !!frozen && !record;
      case "observation": return terminal;
      case "compare": return terminal && !!record?.observation;
      case "revision": return terminal && !!record?.reflection;
    }
  };
  const visit = (s: Stage) => {
    if (!canVisit(s)) return;
    if (s === "execution") { toExecution(); return; }
    if (s === "plan" || s === "relations") setFrozen(null);
    setNotice(""); setStage(s);
  };

  // Plan editing (levels 1-2 keep the given structure; level 3 is fully self-built).
  const editable = !record && !running && stage === "plan";
  const patch = (id: string, change: Partial<DesignCommand>) => { if (editable) setCommands(cs => cs.map(c => c.id === id ? { ...c, ...change } : c)); };
  const free = level === 3;
  const addRole = (role: DesignRole) => {
    const def = DESIGN_ROLES.find(r => r.role === role);
    if (!editable || !free || !def) return;
    setCommands(cs => [...cs, { id: newId(), role, action: def.action as DesignCommand["action"], mode: "absolute", motion: "MoveJ",
      x: "", y: "", z: "", expectedX: "", expectedY: "", expectedZ: "" }]);
  };
  const moveCmd = (i: number, d: number) => {
    if (!editable || !free) return;
    setCommands(cs => { const j = i + d; if (j < 0 || j >= cs.length) return cs; const n = cs.slice(); [n[i], n[j]] = [n[j], n[i]]; return n; });
  };
  const removeCmd = (id: string) => { if (editable && free) setCommands(cs => cs.filter(c => c.id !== id)); };

  const src = worldToLocal(scenario.source, scenario.robots[0]), dst = worldToLocal(scenario.destination, scenario.robots[0]);
  const start = scenario.robots[0].start;
  const Givens = <div className="pp-card given"><div className="pp-kicker">주어진 과제 조건</div>
    <div className="pp-givens">
      <div>시작 TCP 위치 <b>{pt(start)}</b></div>
      <div>집는 R <b>{fmt(src.r)}°</b> · 놓는 R <b>{fmt(dst.r)}°</b> · 놓기 허용 ±{scenario.orientationTolerance}° · 집기 허용 ±{scenario.gripRotationTolerance}°</div>
      <div>집을 위치(출발) <b>{pt(src)}</b></div>
      <div>놓을 위치(도착) <b>{pt(dst)}</b></div>
      <div>운반 조건: 양쪽 접촉점 중 높은 Z보다 <b>{fmt(scenario.minimumTravelZ - Math.max(src.z, dst.z))} mm 이상</b> 높게</div>
      <div>후퇴 조건: 놓기 접촉점에서 <b>{scenario.retreatRise} mm 이상</b> 수직 상승</div>
      {support === "guided" && <div>최소 운반 Z <b>{fmt(scenario.minimumTravelZ)}</b> mm</div>}
    </div></div>;
  const progressRatio = progress / 100;

  return <section ref={scroller} className="pick-place-chapter" aria-label="픽앤플레이스 설계" data-stage={stage}>
    <nav className="pp-levels" aria-label="설계 수준">
      {([1, 2, 3] as DesignLevel[]).map(l => <button key={l} type="button" aria-current={level === l ? "step" : undefined}
        disabled={running || (l > 1 && !levelPassed(l - 1) && l !== level)} onClick={() => { if (!running && l !== level) { setLevel(l); setVariant(0); } }}>
        <b>레벨 {l}</b><br/>{l === 1 ? "기본 안내" : l === 2 ? "높이·접근 조정" : "직접 설계"}
      </button>)}
    </nav>
    <h1>한 개 블록 집어서 옮기기 · 레벨 {level}{variant > 0 ? ` · 바뀐 조건 ${variant}` : ""}</h1>
    <p className="pp-note">디지털 트윈 · {support === "guided" ? "힌트 있음" : "힌트 없음, 직접 판단"}</p>
    {level < 3 && variant === 0 && !record && !running && !frozen && <label className="pp-support">학습 지원
      <select aria-label="학습 지원" value={supportChoice} onChange={e => setSupportChoice(e.target.value as DesignRecord["support"])}>
        <option value="guided">지원 모드</option><option value="challenge">도전 모드</option>
      </select>
    </label>}
    <nav className="pp-stages" aria-label="학습 단계">
      {STAGES.map((s, i) => <button key={s.id} type="button" aria-current={stage === s.id ? "step" : undefined}
        disabled={!canVisit(s.id)} onClick={() => visit(s.id)}><span>{i + 1}</span>{s.label}</button>)}
    </nav>
    {locked && <div className="pp-card warn" role="alert">실장비 연결 중이거나 연결되어 가상 실행이 잠겼습니다.</div>}
    {storageFailed && <div className="pp-card warn" role="alert">학습 기록을 이 브라우저에 저장하지 못했습니다. 지금 내보내기로 보관하세요.
      <div className="pp-actions"><button className="pp-btn small" type="button" onClick={exportRecords}>기록 내보내기</button></div></div>}
    {notice && <p className="pp-error" role="status">{notice}</p>}

    {stage === "task" && <div>
      {Givens}
      <div className="pp-card"><h2>과제</h2>
        <p>MG400 한 대가 출발 위치의 블록을 집어 도착 위치에 놓는 동작열을 설계합니다.</p>
        <p className="pp-note">좌표는 고정 베이스 기준, 단위 mm입니다. 집기·놓기 Z는 물체 윗면의 TCP 접촉점이며 작업대 높이나 물체 중심과 다릅니다.</p>
        <details className="pp-note"><summary>3장 운동학에서 이어가기</summary>
          <p>좌표 → IK 관절각 → FK TCP의 관계를 적용합니다. 3장의 단순 2링크 모델과 달리 이 장은 표시된 MG400 조립체의 오프셋을 포함한 기하 모델입니다. 방향 R은 J1+J4로 계산하며, 이 과제에서는 R=0을 유지합니다. 실장비 관절 제한·충돌·안전성을 검증한 값은 아닙니다.</p>
        </details>
        {support === "guided" && <div className="pp-card hint">힌트: 도착 좌표 B = 시작 좌표 A + 이동량 Δ. 순서 단서: {DESIGN_ROLES.map(r => r.label).join(" → ")}.</div>}
        {level === 3 && <p>명령이 비어 있습니다. 필요한 역할을 직접 추가하고 순서를 정하세요.</p>}
      </div>
      <div className="pp-actions"><button className="pp-btn primary" type="button" onClick={() => setStage("relations")}>관계 정하기</button></div>
    </div>}

    {stage === "relations" && <div>
      {Givens}
      <div className="pp-card"><h2>사용할 관계</h2>
        {RELATION_CHOICES.map(c => <label className="pp-field" key={c.key}>{c.title}
          <select value={relations[c.key]} disabled={!!record} onChange={e => setRelations(r => ({ ...r, [c.key]: e.target.value }))}>
            <option value="">선택하세요</option>{c.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>)}
        <label className="pp-field">운반 Z (mm)
          <input inputMode="decimal" value={relations.travelZ} onChange={e => setRelations(r => ({ ...r, travelZ: e.target.value }))}/></label>
        {support === "guided" && <div className="pp-card hint">운반 Z는 최소 운반 Z {fmt(scenario.minimumTravelZ)} mm 이상이어야 합니다.</div>}
      </div>
      <div className="pp-actions"><button className="pp-btn primary" type="button" onClick={() => {
        const bad = RELATION_CHOICES.map(c => relations[c.key] !== c.correct ? c.title : "").find(Boolean);
        if (bad) { setNotice(!relations[RELATION_CHOICES.find(c => c.title === bad)!.key] ? `'${bad}' 관계를 선택하세요.` : `'${bad}' 선택이 과제 조건과 맞지 않습니다.`); return; }
        if (num(relations.travelZ) === null) { setNotice("운반 Z를 숫자로 입력하세요."); return; }
        startPlan(); setNotice("");
      }}>동작 계획으로</button></div>
    </div>}

    {stage === "plan" && <div>
      {Givens}
      <h2>동작 계획</h2>
      <p className="pp-note">각 이동마다 입력 방식·동작 종류·명령 좌표와, 실행 전에 예상하는 끝점을 적습니다. 잡기·놓기도 예상 위치를 적습니다.</p>
      {commands.length === 0 && <div className="pp-card"><b>비어 있는 계획</b><p>아래에서 역할을 추가해 동작열을 만드세요.</p></div>}
      {commands.map((c, i) => <div className="pp-cmd" key={c.id}>
        <header><b>{i + 1}. {roleLabel(c.role)}</b>
          {free && <><button className="pp-btn small" type="button" disabled={i === 0} onClick={() => moveCmd(i, -1)} aria-label="위로">위</button>
            <button className="pp-btn small" type="button" disabled={i === commands.length - 1} onClick={() => moveCmd(i, 1)} aria-label="아래로">아래</button>
            <button className="pp-btn small danger" type="button" onClick={() => removeCmd(c.id)}>삭제</button></>}
        </header>
        {c.action === "move" ? <>
          <div className="row">
            <select aria-label="입력 방식" value={c.mode} onChange={e => patch(c.id, { mode: e.target.value as DesignCommand["mode"] })}>
              <option value="absolute">절대 좌표</option><option value="relative">상대 이동량</option></select>
            <select aria-label="동작 종류" value={c.motion} onChange={e => patch(c.id, { motion: e.target.value as DesignCommand["motion"] })}>
              <option value="MoveJ">MoveJ (관절)</option><option value="MoveL">MoveL (직선)</option></select>
          </div>
          <div className="sub">{c.mode === "absolute" ? "명령 좌표" : "명령 이동량 Δ"}</div>
          <div className="pp-xyz">{(["x", "y", "z"] as const).map(k => <label key={k}>{k.toUpperCase()}
            <input inputMode="decimal" value={c[k]} onChange={e => patch(c.id, { [k]: e.target.value })}/></label>)}
            <label>R<input inputMode="decimal" placeholder="0" aria-label="명령 R" value={c.r ?? ""} onChange={e => patch(c.id, { r: e.target.value })}/></label></div>
        </> : <p className="pp-note">{c.action === "grip" ? "잡기" : "놓기"}: 위치 이동 없이 현재 위치에서 동작합니다.</p>}
        <div className="sub">예상 끝점 (실행 전 예측)</div>
        <div className="pp-xyz">{([["expectedX", "X"], ["expectedY", "Y"], ["expectedZ", "Z"]] as const).map(([k, l]) => <label key={k}>{l}
          <input inputMode="decimal" value={c[k]} onChange={e => patch(c.id, { [k]: e.target.value })}/></label>)}
          <label>R<input inputMode="decimal" placeholder="0" aria-label="예상 R" value={c.expectedR ?? ""} onChange={e => patch(c.id, { expectedR: e.target.value })}/></label></div>
        {support === "guided" && <p className="pp-note">역할: {roleLabel(c.role)}</p>}
      </div>)}
      {free && <div className="pp-card"><label className="pp-field">역할 추가
        <select aria-label="역할 추가" value="" onChange={e => { if (e.target.value) addRole(e.target.value as DesignRole); }}>
          <option value="">역할 선택</option>{ROLE_PALETTE.map(role => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></label></div>}
      <div className="pp-card"><label className="pp-field">예측 이유
        <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="이렇게 예측한 이유를 적으세요."/></label>
        {revisionReason && <p className="pp-note">이전 수정 이유: {revisionReason}</p>}</div>
      <div className="pp-actions"><button className="pp-btn primary" type="button" disabled={locked} onClick={toExecution}>실행 단계로</button></div>
    </div>}

    {stage === "execution" && <div>
      <div className="pp-card"><h2>실행</h2>
        <p>고정된 계획 {frozen?.commands.length ?? record?.commands.length ?? 0}개 명령 · 운반 Z {frozen?.relations.travelZ ?? record?.relations.travelZ} mm</p>
        <div className="pp-progress" role="progressbar" aria-valuenow={progress}><i style={{ width: "100%", transform: `scaleX(${progressRatio})` }}/></div>
        <p className="pp-note">{running ? "실제 계산 중입니다. 결과는 끝난 뒤 표시됩니다." : "실행 전에는 결과를 미리 보여주지 않습니다."}</p>
        <div className="pp-actions">
          <button className="pp-btn primary" type="button" disabled={locked || practice.hardware || !props.sceneReady || running || !frozen || !!record} onClick={execute}>가상 실행 시작</button>
          {practice.hardware && <button className="pp-btn primary" type="button" data-testid="button-run-hardware" disabled={running || !frozen || !!record || practice.snap.connection !== "connected" || !practice.snap.setup}
            onClick={() => { void executeHardware(); }}>실제 로봇 실행 (확인 창)</button>}
          <button className="pp-btn danger" type="button" disabled={!running} onClick={stop}>중지</button>
          <button className="pp-btn" type="button" disabled={running} onClick={() => { setFrozen(null); setStage("plan"); }}>계획으로 돌아가기</button>
        </div>
        {practice.hardware && <p className="pp-note">실제 로봇 모드: 같은 계획을 저속으로 실행하고 측정된 TCP만 기록합니다. 화면 중지는 물리 비상정지가 아닙니다. {virtualRef ? "가상 기록과 연결된 재사용 계획입니다." : ""}{practice.snap.source === "mock" ? ` ${MOCK_LABEL}.` : ""}</p>}
        {!props.sceneReady && <p className="pp-note">3D 화면을 준비하는 중입니다.</p>}
      </div>
    </div>}

    {post && record && <div>
      <div className={`pp-card ${record.status === "completed" && didPass(record) ? "ok" : record.status === "completed" ? "" : "warn"}`}>
        <span className="pp-badge">{record.source === "dt" ? "가상 계산 · 실측/안전성 검증 아님" : record.source === "mock" ? MOCK_LABEL : "실제 MG400 측정 · 물체 집기/놓기 미검증"}</span>
        {record.virtualReferenceId && <p className="pp-note">연결된 가상 기록: {record.virtualReferenceId.slice(0, 8)}</p>}
        <h2>{record.status === "stopped" ? "중지됨 — 판정 없음" : record.status === "unavailable" ? "실행하지 못함"
          : record.source === "mock" ? "모의 기록 완료 · 물체 상태는 확인 안 됨"
          : record.source === "hardware" ? "실측 기록 완료 · 물체 상태는 확인 안 됨" : didPass(record) ? "실행 완료 · 성공" : "실행 완료 · 목표 미달"}</h2>
        {record.source !== "dt" && record.status === "completed" && <p>{record.stopReason} 합격 판정은 하지 않습니다.</p>}
        {record.status === "stopped" && <p>{record.stopReason} 실제로 재생된 {record.observations.length}개 관찰만 남아 있습니다.</p>}
        {record.status === "unavailable" && <p>{record.stopReason}</p>}
        {record.status === "completed" && record.result && <>
          <p>완성 {record.result.completedPieces}/{record.result.totalPieces}</p>
          {record.result.issues.map((s, i) => <p key={i}>{s}</p>)}
        </>}
      </div>
      <h3>실행한 순서별 관찰 ({srcTag})</h3>
      {record.observations.length === 0 ? <p className="pp-note">재생된 관찰이 없습니다.</p> :
        <div className="pp-table-wrap"><table className="pp-table"><caption>각 단계의 TCP 좌표 (X, Y, Z), mm · 예상값은 실행 전 입력</caption><thead><tr><th>#</th><th>역할</th><th>명령 결과</th><th>과제 목표</th><th>명령 도착점</th><th>예상</th><th>관찰 TCP</th><th>물체 상태</th><th>예측 오차</th></tr></thead>
          <tbody>{record.observations.map((o: DesignObservation, i) => <tr key={o.commandId + i} className="pickable" aria-selected={inspect === i}
            onClick={() => inspectAt(i)}>
            <td>{i + 1}</td><td><button className="pp-btn small" onClick={() => inspectAt(i)}>{roleLabel(o.role)}</button></td><td>{COMMAND_STATUS[o.commandStatus ?? "completed"]}</td><td>{o.goal ? pt(o.goal) : "내가 정한 경유점"}</td><td>{pt(o.target)}</td><td>{pt(o.expected)}</td><td>{pt(o.actual)} R {fmt(o.actual.r)}</td>
            <td>{STATE_LABEL[o.state]}</td><td>{fmt(o.predictionError)} mm{o.rotationError !== undefined ? ` · R ${fmt(o.rotationError)}°` : ""}</td></tr>)}</tbody></table></div>}
      <div className="pp-actions"><button className="pp-btn small" type="button" onClick={() => inspectAt(-1)}>마지막 상태 보기</button>
        {record.source === "dt" && record.status !== "unavailable" && <button className="pp-btn small" type="button" data-testid="button-reuse-hardware" onClick={reuseInHardware}>이 가상 계획을 실제 로봇 실습에 재사용</button>}</div>
      {reviewObs?.goal && <p className="pp-note">선택한 단계의 목표 {pt(reviewObs.goal)}</p>}
      <p className="pp-note">장면의 선: 예측이 아닌 관찰 TCP 궤적 ({srcTag}). 예측 끝점은 위 표의 예상 열입니다.</p>
    </div>}

    {stage === "observation" && record && terminal && <div className="pp-card">
      <label className="pp-field">관찰한 점
        <textarea value={obsText} onChange={e => setObsText(e.target.value)} placeholder="장면과 표에서 본 것을 적으세요."/></label>
      <div className="pp-actions"><button className="pp-btn primary" type="button" onClick={saveObservation}>관찰 저장</button>
        <button className="pp-btn" type="button" disabled={!record.observation} onClick={() => setStage("compare")}>비교로</button></div>
    </div>}

    {stage === "compare" && record && <div className="pp-card">
      <h2>{record.source === "mock" ? "예측과 모의 수신값 비교" : "예측과 실제 비교"}</h2>
      <p className="pp-note">예측과 관찰 TCP의 거리 차이를 비교합니다. 수치 허용차는 0.2 mm이며 설명의 질을 자동 판정하지 않습니다.</p>
      {record.source !== "dt" && record.observations.map((o, i) => <p key={i}>{i + 1}. {roleLabel(o.role)}: 위치 차이 {fmt(o.predictionError)} mm · R 차이 {fmt(o.rotationError ?? 0)}° · 물체 상태 확인 안 됨</p>)}
      {record.result?.checks.map(c => <p key={c.key}>{c.label}: 거리 차이 {fmt(c.actual)} mm · {c.passed ? "일치" : "불일치"}</p>)}
      <label className="pp-field">설명 (교사가 확인합니다)
        <textarea value={refText} onChange={e => setRefText(e.target.value)} placeholder="예측과 실제가 같거나 다른 이유를 적으세요."/></label>
      <p className="pp-note">교사 검토: 대기 중</p>
      <div className="pp-actions"><button className="pp-btn primary" type="button" onClick={saveReflection}>설명 저장</button>
        <button className="pp-btn" type="button" disabled={!record.reflection} onClick={() => setStage("revision")}>수정으로</button></div>
      {didPass(record) && !!record.reflection && <div className="pp-actions">
        {level < 3 && <button className="pp-btn primary" type="button" onClick={() => advance((level + 1) as DesignLevel, 0)}>다음 레벨</button>}
        <button className="pp-btn" type="button" onClick={() => advance(level, variant + 1)}>바뀐 조건에 도전</button></div>}
    </div>}

    {stage === "revision" && record && <div className="pp-card">
      <h2>수정</h2>
      <p>기존 계획을 그대로 불러와 고칩니다. 새 시도로 기록됩니다.</p>
      <label className="pp-field">수정 이유
        <textarea value={revText} onChange={e => setRevText(e.target.value)} placeholder="무엇이 달랐고, 무엇을 어떻게 바꿀지 적으세요."/></label>
      <div className="pp-actions"><button className="pp-btn primary" type="button" disabled={locked} onClick={reviseNow}>수정해서 다시 시도</button></div>
    </div>}

    <div className="pp-actions">
      <button className="pp-btn small" type="button" onClick={() => fresh()}>과제 초기화</button>
      <button className="pp-btn small" type="button" onClick={exportRecords}>학습 기록 내보내기</button>
    </div>

    {extensionUnlocked && !running && practice.hardware && <p className="pp-note">확장 공정은 가상 DT 전용입니다. 실제 로봇 모드에서는 실행하지 않으며, 그 값은 실측이 아닙니다.</p>}
    {extensionUnlocked && !running && !practice.hardware && <details className="pp-ext" open={extOpen} onToggle={e => { if (!running) setExtOpen((e.currentTarget as HTMLDetailsElement).open); }}>
      <summary>확장 공정</summary>
      {extOpen && <div className="pp-ext-body"><ProcessCellLesson {...props}/></div>}
    </details>}
  </section>;
}
