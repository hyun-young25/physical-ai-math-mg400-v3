import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLessonMotion, type MotionProps } from "./LessonPages";
import type { CoordinateVisual } from "./coordinateLearning";
import { learningRecordContext } from "./learningFramework";
import { readEvidence, writeEvidence, downloadEvidence } from "./learningEvidenceStorage";
import { POSE_AXES, parseLessonNumber } from "./curriculum";
import {
  PICK_LEVELS, DESIGN_CONCEPTS, blankDesignCommand, compileDesign, designId,
  designPoint, designSyntax, judgeDesign, designPlan, designTransfers,
  initialDesignWorkpieces, designImprovement, designLevelPassed,
  type DesignCommand, type DesignCondition, type DesignFrame,
  type DesignIssue, type DesignOutcome, type DesignConcept,
} from "./pickPlaceDesign";
import "./pickPlaceLevels.css";

type DesignRecord = ReturnType<typeof learningRecordContext> & {
  id: string;
  condition: DesignCondition;
  commands: DesignCommand[];
  prediction: string;
  reason: string;
  phase?: "baseline" | "plan";
  baselineId?: string;
  baselineLength?: number;
  submittedAt: string;
  previousId?: string;
  revision?: { concept: DesignConcept; text: string };
  status: "submitted" | "running" | "completed" | "stopped" | "unavailable";
  outcome?: DesignOutcome;
  issues?: DesignIssue[];
  predictionReviews?: { value: string; reason: string; at: string }[];
  hintKeys: DesignConcept[];
  reflection?: string;
  endedAt?: string;
  executed?: { step: number; pose: DesignFrame["pose"] }[];
};
// Keep existing evidence, including attempts from the previous single-task lesson.
const KEY = "physical-ai-design-evidence-v1";
let history = readEvidence<DesignRecord>(KEY, (v): v is DesignRecord =>
  !!v && typeof v === "object" && typeof (v as DesignRecord).id === "string" &&
  !!(v as DesignRecord).condition && Array.isArray((v as DesignRecord).commands));
history = history.map(r => r.status === "running" ? { ...r, status: "stopped" } : r);
const copy = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const sessionId = () => learningRecordContext("dt").sessionId;
const recordsFor = (id: string) => history.filter(r => r.condition.id === id);
const assessment = (r: DesignRecord, prediction = r.predictionReviews?.at(-1)?.value ?? r.prediction) =>
  r.outcome ? judgeDesign(r.outcome, prediction, r) : r.issues ?? [];
const validBaseline = (r: DesignRecord) => r.phase === "baseline" && r.status === "completed" &&
  !!r.outcome?.finished && Number.isFinite(r.outcome.pathLength) && r.outcome.pathLength > 0 && assessment(r).length === 0;
const commandText = (c: DesignCommand) => c.action === "move"
  ? `${c.mode === "relative" ? "상대" : "절대"} ${c.motion || "이동 방식 선택"} (${POSE_AXES.map(k => c.values[k] || "?").join(", ")})`
  : c.action === "grip" ? "흡착" : "해제";
function scaffold(condition: DesignCondition) {
  const result = designPlan(condition);
  // Route structure is given; students supply the heights in the carry segments.
  for (const [i, c] of result.entries())
    if (c.action === "move" && (result[i - 1]?.action === "grip" || result[i + 1]?.action === "move" && result[i + 2]?.action === "release"))
      c.values.z = "";
  return result;
}

export function PickPlaceDesignLesson(props: MotionProps & { onVisualChange: (v: CoordinateVisual | null) => void }) {
  const motion = useLessonMotion(props);
  const [index, setIndex] = useState(0), condition = PICK_LEVELS[index];
  const [commands, setCommands] = useState<DesignCommand[]>([]);
  const [guidedY, setGuidedY] = useState("");
  const [prediction, setPrediction] = useState(""), [reason, setReason] = useState("");
  const [record, setRecord] = useState<DesignRecord | null>(null), active = useRef<DesignRecord | null>(null);
  const [reflection, setReflection] = useState(""), [revisionText, setRevisionText] = useState("");
  const [revisionConcept, setRevisionConcept] = useState<DesignConcept | "">("");
  const [predictionReview, setPredictionReview] = useState(""), [predictionReviewReason, setPredictionReviewReason] = useState("");
  const [editing, setEditing] = useState(true), [notice, setNotice] = useState("");
  const [storageFailed, setStorageFailed] = useState(false);
  const [displayFrame, setDisplayFrame] = useState<DesignFrame | null>(null);
  const progress = useRef<DesignFrame[]>([]), latest = useRef(props);
  latest.current = props;
  const locked = motion.running || props.hardwareConnected;
  const baseline = recordsFor(condition.id).filter(validBaseline).at(-1);
  const previous = recordsFor(condition.id).filter(r => r.phase !== "baseline").at(-1);
  const currentIssues = record ? assessment(record) : [];
  const passed = !!record && designLevelPassed(record);
  const transfers = designTransfers(condition);
  const persist = (next: DesignRecord) => {
    const i = history.findIndex(r => r.id === next.id);
    if (i < 0) history.push(copy(next)); else history[i] = copy(next);
    return writeEvidence(KEY, history);
  };
  const save = (next: DesignRecord) => {
    active.current = next; setRecord(next); setStorageFailed(!persist(next));
  };
  const interrupt = () => {
    const r = active.current;
    if (r?.status !== "running") return r;
    const next: DesignRecord = { ...r, status: "stopped", endedAt: new Date().toISOString(),
      executed: progress.current.map(f => ({ step: f.step, pose: f.pose })) };
    active.current = next; persist(next); return next;
  };
  useEffect(() => () => { interrupt(); latest.current.onVisualChange(null); }, []);
  useLayoutEffect(() => {
    const stopped = interrupt(); if (stopped) setRecord(stopped);
    setDisplayFrame(null);
  }, [props.resetKey, props.hardwareConnected]);
  // Enter a task at its stated start pose. A global HOME remains authoritative.
  useEffect(() => {
    if (!latest.current.hardwareConnected) {
      const { start } = PICK_LEVELS[index];
      latest.current.onMoveTo(start.x, start.y, start.z, latest.current.coords.r);
      latest.current.onMoveEnd();
    }
  }, [index]);
  useEffect(() => {
    const workpieces = displayFrame?.workpieces ?? initialDesignWorkpieces(condition);
    props.onVisualChange({
      key: "design:" + condition.id, from: { ...condition.start, r: props.coords.r }, fromLabel: "A",
      points: [
        ...transfers.flatMap(t => [
          { id: `pick-${t.id}`, label: `${t.label} 시작`, pose: t.pick, color: "#0284c7", kind: "given" as const },
          { id: `place-${t.id}`, label: `${t.label} 목표`, pose: t.place, color: "#0f766e", kind: "given" as const },
        ]),
        ...(condition.obstacles ?? []).map(o => ({ id: o.id, label: o.label, pose: { ...o.center, z: o.baseZ + o.height, r: 0 }, color: "#475569", kind: "given" as const })),
      ],
      results: {}, showPaths: false, workpieces, obstacles: condition.obstacles,
    });
  }, [condition, displayFrame, props.onVisualChange]);
  const changeLevel = (next: number) => {
    if (locked || next === index) return;
    motion.stop(); interrupt();
    setIndex(next); active.current = null; setRecord(null); setDisplayFrame(null);
    setCommands(next === 0 || next === 3 ? [] : scaffold(PICK_LEVELS[next]));
    setGuidedY(""); setPrediction(""); setReason(""); setReflection("");
    setRevisionConcept(""); setRevisionText(""); setPredictionReview(""); setPredictionReviewReason("");
    setEditing(true); setNotice("");
  };
  const resetTask = () => {
    if (props.hardwareConnected) return;
    motion.stop(); const stopped = interrupt(); if (stopped) setRecord(stopped);
    setDisplayFrame(null); progress.current = [];
    props.onMoveTo(condition.start.x, condition.start.y, condition.start.z, props.coords.r); props.onMoveEnd();
    setNotice("블록과 로봇을 이 레벨의 시작 상태로 되돌렸습니다. 저장한 계획과 실행 기록은 유지됩니다.");
  };
  const update = (id: string, patch: Partial<DesignCommand>) => setCommands(v => v.map(c => c.id === id ? { ...c, ...patch } : c));
  const reorder = (i: number, direction: number) => setCommands(v => {
    const next = [...v], j = i + direction;
    if (j >= 0 && j < next.length) [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const loadBaseline = () => {
    if (locked) return;
    const plan = designPlan(condition, 110);
    setCommands(plan); setPrediction("110"); setReason("기준 경로의 운반 높이는 110 mm입니다. 실행한 TCP 이동 거리를 비교 기준으로 삼습니다.");
    save({ ...learningRecordContext("dt"), id: designId(), condition: copy(condition), commands: copy(plan),
      prediction: "110", reason: "기준 경로: 운반 높이 110 mm, 수직 하강과 해제 후 상승 포함.",
      phase: "baseline", submittedAt: new Date().toISOString(), status: "submitted", hintKeys: [] });
    setEditing(false); setDisplayFrame(null); setNotice("기준 경로를 불러왔습니다. DT에서 끝까지 실행하면 실제 이동 거리가 비교 기준으로 저장됩니다.");
  };
  const submit = () => {
    if (locked) return;
    const y = parseLessonNumber(guidedY);
    if (condition.level === 1 && y === null) { setNotice("놓을 위치의 Y 좌표를 입력하세요."); return; }
    const plan = condition.level === 1 ? designPlan(condition, condition.clearance, y!) : commands;
    const planReason = condition.level === 1 ? `블록을 Y=${guidedY} 위치에 놓습니다. 정해진 순서에서 높이 ${condition.clearance} mm를 유지합니다.` : reason;
    const error = designSyntax(plan, prediction, planReason, condition.maxCommands);
    if (error) { setNotice(error); return; }
    if (condition.level === 4 && !baseline) { setNotice("먼저 기준 경로를 끝까지 실행하세요."); return; }
    if (condition.level !== 1 && previous && assessment(previous).length && (!revisionConcept || !revisionText.trim())) {
      setNotice("어느 조건을 어떻게 고쳤는지 선택하고 수정 근거를 적으세요."); return;
    }
    setCommands(plan);
    save({ ...learningRecordContext("dt"), id: designId(), condition: copy(condition), commands: copy(plan),
      prediction, reason: planReason.trim(), phase: "plan", submittedAt: new Date().toISOString(), previousId: previous?.id,
      ...(baseline ? { baselineId: baseline.id, baselineLength: baseline.outcome!.pathLength } : {}),
      ...(revisionConcept ? { revision: { concept: revisionConcept, text: revisionText.trim() } } : {}),
      status: "submitted", hintKeys: [] });
    setEditing(false); setReflection(""); setDisplayFrame(null);
    setNotice("계획과 예측을 저장했습니다. DT에서 실행해야 레벨 조건을 확인할 수 있습니다.");
  };
  const run = () => {
    let r = active.current;
    if (locked || !r || editing) return;
    if (r.status !== "submitted") r = { ...r, id: designId(), previousId: r.id, submittedAt: new Date().toISOString(),
      status: "submitted", outcome: undefined, issues: undefined, predictionReviews: undefined, reflection: undefined, executed: undefined, endedAt: undefined };
    const compiled = compileDesign(props.model, condition, r.commands, props.coords.r, props.joints.j3);
    const runId = r.id; progress.current = []; setDisplayFrame(null);
    save({ ...r, status: "running", outcome: undefined, issues: undefined, reflection: undefined });
    const done = () => {
      const current = active.current;
      if (current?.id !== runId || current.status !== "running") return;
      const next: DesignRecord = { ...current, status: compiled.outcome.finished ? "completed" : "unavailable",
        outcome: compiled.outcome, issues: judgeDesign(compiled.outcome, current.prediction, current),
        endedAt: new Date().toISOString(), executed: progress.current.map(f => ({ step: f.step, pose: f.pose })) };
      save(next);
      setNotice(!compiled.outcome.finished ? "계산할 수 없는 구간에서 멈췄습니다. 실행되지 않은 뒷부분은 결과에 포함하지 않습니다."
        : next.phase === "baseline" ? "기준 경로의 이동 거리를 측정했습니다. 이제 높이와 경유점을 바꿔 더 짧은 경로를 설계하세요."
          : designLevelPassed(next) ? `레벨 ${condition.level}의 작업 조건을 모두 확인했습니다.` : "실행 결과에서 충족하지 못한 조건을 확인하고 수정하세요.");
    };
    if (!compiled.frames.length) { done(); return; }
    props.onMoveTo(condition.start.x, condition.start.y, condition.start.z, props.coords.r); props.onMoveEnd();
    motion.play(compiled.frames, "MoveJ", done, i => {
      if (progress.current.at(-1) !== compiled.frames[i]) progress.current.push(compiled.frames[i]);
      setDisplayFrame(compiled.frames[i]);
    }, Math.max(3500, r.commands.length * 650));
  };
  const editPlan = () => {
    if (record?.phase === "baseline") {
      setCommands(copy(record.commands)); setPrediction(record.prediction); setReason("");
    }
    setEditing(true); setNotice("원래 계획과 결과는 보존됩니다. 바꿀 명령과 근거를 입력하세요.");
  };
  const stage = editing ? "3/7 · 표현·예측" : motion.running ? "4/7 · 실행·측정" : record?.status === "submitted" ? "3/7 · 표현·예측" : "6/7 · 비교·해석";
  return <div className="lesson-scroll design-lesson pick-level-lesson math-start-lesson">
    <div className="pick-level-heading"><strong>4 · 픽앤플레이스</strong><span>현재 단계 {stage}</span></div>
    <nav className="pick-level-selector" aria-label="픽앤플레이스 난이도">
      {PICK_LEVELS.map((level, i) => <button key={level.id} disabled={locked} aria-current={i === index ? "step" : undefined} onClick={() => changeLevel(i)}>
        <b>레벨 {level.level}{recordsFor(level.id).some(designLevelPassed) ? " ✓" : ""}</b><span>{level.title}</span>
      </button>)}
    </nav>
    <p className="pick-level-note">레벨은 수행할 과제의 난이도입니다. 도움의 양을 조절하는 기초 지원·도전 모드와 구분됩니다.</p>
    <section className="pick-level-goal">
      <span className="pick-level-kicker">LEVEL {condition.level}</span><h2>{condition.title}</h2>
      <p>{condition.goal}</p>
      <div className="pick-level-targets">{transfers.map(t => <div key={t.id}><b>{t.label}{transfers.length > 1 ? ` · ${t.id === "A" ? "먼저" : "다음"}` : ""}</b><span>{designPoint(t.pick)} → {designPoint(t.place)}</span></div>)}</div>
      <p className="pick-level-condition">{condition.level === 1 ? "이동 순서는 준비되어 있습니다. 목표 Y 좌표와 운반 중 최고 높이를 입력하세요."
        : condition.level === 3 ? "A → B 순서 · 운반 높이 60 mm 이상 · 각 목표에서 수직 하강·해제·상승"
        : "장애물 윗면 40 mm + 블록 두께 20 mm → 운반 중 블록 윗면 60 mm 이상"}</p>
    </section>
    <div className="pick-level-stage" aria-label="활동 순서"><span aria-current={editing ? "step" : undefined}>1. 계획·예측</span><span aria-current={motion.running || record?.status === "submitted" ? "step" : undefined}>2. DT 실행</span><span aria-current={record?.outcome ? "step" : undefined}>3. 비교·수정</span></div>
    {props.hardwareConnected && <p role="status" className="lesson-feedback">장비 연결 중에는 이 DT 설계 실행을 잠급니다.</p>}
    {condition.level === 4 && <section className="lesson-card pick-baseline" aria-label="기준 경로 비교">
      <h3>{baseline ? "비교할 기준 경로" : "먼저 기준 경로를 실행하세요"}</h3>
      <p>{baseline ? `측정한 TCP 이동 거리 ${baseline.outcome!.pathLength.toFixed(1)} mm · 개선 목표 ${(baseline.outcome!.pathLength * .9).toFixed(1)} mm 이하`
        : "운반 높이 110 mm인 경로를 끝까지 실행해 기준 거리를 만듭니다. 계산만 하거나 중지한 시도는 기준으로 인정하지 않습니다."}</p>
      {!baseline && <button disabled={locked} onClick={loadBaseline}>기준 경로 불러오기</button>}
    </section>}
    {editing && (condition.level !== 4 || baseline) && <section className="lesson-card" aria-label="내 작업 계획">
      <h3>{condition.level === 1 ? "목표 좌표를 넣어 실행 준비" : "명령 순서와 운반 경로 설계"}</h3>
      {condition.level === 1 ? <>
        <ol className="pick-guided-sequence"><li>블록 윗면으로 내려가기</li><li>흡착하기</li><li>Z = 40 mm로 들어 올리기</li><li>목표 Y로 옮기기</li><li>Z = 0 mm로 수직 하강</li><li>해제하기</li><li>10 mm 올라오기</li></ol>
        <label>놓을 위치의 Y 좌표 (mm)<input type="number" aria-label="레벨1 목표 Y" disabled={locked} value={guidedY} onChange={e => setGuidedY(e.target.value)} placeholder="목표 좌표에서 Y를 찾아 입력" /></label>
      </> : <>
        <p className="lesson-note">이동 항목을 펼쳐 좌표와 방식을 고치세요. 빈칸은 직접 채우고, 필요하면 명령을 추가·삭제합니다.</p>
        <div className="lesson-actions"><button disabled={locked} onClick={() => { setCommands(scaffold(condition)); setNotice("순서 틀을 불러왔습니다. 빈 운반 높이를 채우고 각 도착 좌표를 확인하세요."); }}>순서 틀 불러오기</button><button disabled={locked} onClick={() => setCommands([])}>빈 계획에서 시작</button></div>
        {commands.map((c, i) => <details key={c.id} className="design-command pick-command" open={c.action === "move" && POSE_AXES.some(k => !c.values[k]) ? true : undefined}>
          <summary><b>{i + 1}</b> {commandText(c)}</summary>
          <fieldset disabled={locked}><legend className="pick-visually-hidden">{i + 1}단계 명령</legend>
            <div className="lesson-actions"><button aria-label={`${i + 1}단계 위로`} disabled={i === 0} onClick={() => reorder(i, -1)}>↑</button><button aria-label={`${i + 1}단계 아래로`} disabled={i === commands.length - 1} onClick={() => reorder(i, 1)}>↓</button><button onClick={() => setCommands(v => v.filter(x => x.id !== c.id))}>{i + 1}단계 삭제</button></div>
            {c.action === "move" ? <>
              <div className="lesson-actions"><label>좌표 기준<select aria-label={`${i + 1}단계 좌표 기준`} value={c.mode} onChange={e => update(c.id, { mode: e.target.value as DesignCommand["mode"], values: { x: "", y: "", z: "" } })}><option value="">선택</option><option value="absolute">절대 · 도착 위치</option><option value="relative">상대 · 변화량</option></select></label><label>이동 방식<select aria-label={`${i + 1}단계 이동 방식`} value={c.motion} onChange={e => update(c.id, { motion: e.target.value as DesignCommand["motion"] })}><option value="">선택</option><option value="MoveJ">MoveJ · 관절각 보간</option><option value="MoveL">MoveL · TCP 직선</option></select></label></div>
              <div className="lesson-coordinates">{POSE_AXES.map(k => <label key={k}>{c.mode === "relative" ? "Δ" : ""}{k.toUpperCase()} (mm)<input type="number" step="any" aria-label={`${i + 1}단계 ${k.toUpperCase()}`} value={c.values[k]} onChange={e => update(c.id, { values: { ...c.values, [k]: e.target.value } })} /></label>)}</div>
            </> : <p>{c.action === "grip" ? "현재 TCP 위치에서 다음 순서의 블록을 흡착합니다." : "현재 TCP 위치에서 잡은 블록을 놓습니다."}</p>}
          </fieldset>
        </details>)}
        <div className="lesson-actions">{(["move", "grip", "release"] as const).map(action => <button key={action} disabled={locked || commands.length >= (condition.maxCommands ?? 12)} onClick={() => setCommands(v => [...v, blankDesignCommand(action)])}>{action === "move" ? "이동 추가" : action === "grip" ? "흡착 추가" : "해제 추가"}</button>)}</div>
      </>}
      <label>운반 중 블록 윗면의 최고 높이는? (mm)<input type="number" step="any" aria-label="최고 높이 예측" disabled={locked} value={prediction} onChange={e => setPrediction(e.target.value)} /></label>
      {condition.level !== 1 && <label>{condition.level === 4 ? "어떤 구간을 줄이며, 안전 조건은 어떻게 유지하나요?" : "이 높이·좌표·순서를 선택한 이유는 무엇인가요?"}<textarea aria-label="작업 설계 근거" rows={2} disabled={locked} value={reason} onChange={e => setReason(e.target.value)} /></label>}
      {condition.level !== 1 && previous && assessment(previous).length > 0 && <div className="pick-revision"><label>이번에 고칠 조건<select aria-label="수정할 관계" disabled={locked} value={revisionConcept} onChange={e => setRevisionConcept(e.target.value as DesignConcept)}><option value="">선택</option>{Array.from(new Set(assessment(previous).map(i => i.concept))).map(k => <option key={k} value={k}>{DESIGN_CONCEPTS[k]}</option>)}</select></label><label>어느 명령을 어떻게 바꿨나요?<textarea aria-label="설계 수정 근거" rows={2} disabled={locked} value={revisionText} onChange={e => setRevisionText(e.target.value)} /></label></div>}
      <button className="lesson-primary" disabled={locked} onClick={submit}>계획·예측 저장</button>
    </section>}
    {!editing && record && <section className="lesson-card" aria-label="저장한 작업 계획"><h3>{record.phase === "baseline" ? "실행할 기준 경로" : "내가 저장한 계획"}</h3>
      <details><summary>명령 {record.commands.length}개 · 순서 확인</summary><ol>{record.commands.map(c => <li key={c.id}>{commandText(c)}</li>)}</ol></details>
      <p>최고 높이 예상 <b>{record.prediction} mm</b></p><p>{record.reason}</p>
      <div className="lesson-actions"><button className="lesson-primary" disabled={locked} onClick={run}>{record.phase === "baseline" ? "기준 경로 DT 실행" : "내 계획 DT 실행"}</button><button disabled={locked || record.phase === "baseline" && !baseline} onClick={editPlan}>{record.phase === "baseline" ? "경로 개선하기" : "계획 수정하기"}</button></div>
      <p className="lesson-note">매 실행은 이 레벨의 블록 배치와 시작 TCP에서 출발합니다.</p>
    </section>}
    {motion.running && <div className="pick-running"><p role="status">{(displayFrame?.step ?? 0) + 1}/{record?.commands.length}단계 실행 중</p><button onClick={() => { motion.stop(); const stopped = interrupt(); if (stopped) setRecord(stopped); setNotice("중지했습니다. 이 시도는 완료로 처리하지 않습니다."); }}>DT 정지</button></div>}
    {!editing && record?.outcome && <section className={`lesson-card pick-result ${passed ? "is-passed" : ""}`} aria-label="내 설계 실행 결과">
      <h3>{record.phase === "baseline" && validBaseline(record) ? "기준 거리 측정 완료" : passed ? `레벨 ${condition.level} 완료` : "다시 확인할 조건"}</h3>
      <div className="pick-metrics"><div><span>목표에 놓은 블록</span><b>{record.outcome.completedTransfers}/{transfers.length}개</b></div><div><span>TCP 이동 거리</span><b>{record.outcome.pathLength.toFixed(1)} mm</b></div><div><span>운반 중 최고 높이</span><b>{record.outcome.maxHeldZ?.toFixed(1) ?? "—"} mm</b></div></div>
      {record.baselineLength && <p className="pick-distance-compare">기준 {record.baselineLength.toFixed(1)} mm → 내 경로 {record.outcome.pathLength.toFixed(1)} mm · <b>{designImprovement(record.outcome.pathLength, record.baselineLength).toFixed(1)}% 단축</b></p>}
      {record.outcome.workpieces?.map(w => <p key={w.id}>{w.label}: {designPoint(w.top)} · {w.completed ? "목표 도착" : "목표 미도착"}</p>)}
      {currentIssues.map((issue, i) => <div className="lesson-feedback pick-issue" key={i}><strong>{DESIGN_CONCEPTS[issue.concept]}</strong><p>{issue.message}</p>{record.hintKeys.includes(issue.concept) ? <p>{issue.hint}</p> : <button onClick={() => save({ ...record, hintKeys: [...record.hintKeys, issue.concept] })}>힌트 · {DESIGN_CONCEPTS[issue.concept]}</button>}</div>)}
      {record.status === "completed" && currentIssues.length === 1 && currentIssues[0].concept === "prediction" && <div className="pick-revision"><p>작업 조건은 만족했습니다. 관찰한 높이와 처음 예측을 비교하세요.</p><label>관찰한 최고 높이<input aria-label="다시 판단한 최고 높이" type="number" value={predictionReview} onChange={e => setPredictionReview(e.target.value)} /></label><label>어떤 높이와 혼동했나요?<textarea aria-label="높이 판단 수정 근거" value={predictionReviewReason} onChange={e => setPredictionReviewReason(e.target.value)} /></label><button disabled={locked || !predictionReview.trim() || !predictionReviewReason.trim()} onClick={() => save({ ...record, predictionReviews: [...(record.predictionReviews ?? []), { value: predictionReview, reason: predictionReviewReason.trim(), at: new Date().toISOString() }] })}>높이 판단 확인</button></div>}
      {!!record.predictionReviews?.length && <p>처음 예측 {record.prediction} mm → 다시 판단 {record.predictionReviews.at(-1)!.value} mm · {record.predictionReviews.at(-1)!.reason}</p>}
      <details><summary>단계별 출발·입력·DT 결과 비교</summary><div className="pick-table-scroll"><table><thead><tr><th>단계</th><th>출발</th><th>내 입력</th><th>DT 결과</th></tr></thead><tbody>{record.outcome.observations.map(o => <tr key={o.step}><th>{o.step + 1}</th><td>{designPoint(o.from)}</td><td>{commandText(record.commands[o.step])}</td><td>{designPoint(o.observed)}</td></tr>)}</tbody></table></div></details>
      {passed && <><label>확인한 값으로 방법을 설명해 보세요.<textarea aria-label="설계 결과 설명" rows={2} value={reflection} onChange={e => setReflection(e.target.value)} /></label><div className="lesson-actions"><button disabled={!reflection.trim() || locked} onClick={() => save({ ...record, reflection: reflection.trim() })}>설계 설명 저장</button>{index < PICK_LEVELS.length - 1 && <button className="lesson-primary" disabled={locked} onClick={() => changeLevel(index + 1)}>레벨 {index + 2} 도전 →</button>}</div>{record.reflection && <p>설명 저장 완료: {record.reflection}</p>}{index === PICK_LEVELS.length - 1 && <p>안전 조건을 유지하며 더 짧은 경로를 확인했습니다. 높이와 이동 거리의 관계를 설명해 보세요.</p>}</>}
    </section>}
    {notice && <p role="status" className="lesson-feedback">{notice}</p>}
    <details className="lesson-card"><summary>레벨별 학습·수정 기록</summary>{PICK_LEVELS.map(c => {
      const records = recordsFor(c.id), completed = records.some(designLevelPassed);
      return <p key={c.id}>레벨 {c.level} · {c.title}: {completed ? "조건 확인 완료" : records.length ? "수행 중" : "수행 전"} · 계획 {records.filter(r => r.phase !== "baseline").length}개</p>;
    })}<p>계획, 실행·중지, 높이 예측, 수정 근거, 기준 경로와 개선 경로를 함께 보존합니다. 설명의 타당성은 교사가 검토합니다.</p><button disabled={!history.length} onClick={() => downloadEvidence("pick-place-design.json", { ...learningRecordContext("dt"), records: history })}>설계 학습 기록 내려받기</button></details>
    {storageFailed && <p role="alert">기록을 브라우저에 저장하지 못했습니다. 새로고침 전에 기록을 내려받으세요.</p>}
    <div className="lesson-actions"><button disabled={props.hardwareConnected} onClick={resetTask}>↺ 이 레벨 시작 상태</button><button disabled={props.hardwareConnected} onClick={() => { const stopped = interrupt(); if (stopped) setRecord(stopped); motion.reset(); }}>DT 홈 자세</button></div>
    <details className="pick-level-notes"><summary>공통 작업 조건과 측정 범위</summary><ul><li>블록을 옆으로 옮길 때 윗면 높이 {condition.clearance} mm 이상을 유지합니다.</li><li>각 목표 바로 위에서 수직 하강 MoveL → 해제 → 같은 X·Y에서 10 mm 이상 상승합니다.</li><li>거리는 시작 TCP부터 마지막 명령까지의 전체 DT 궤적 길이입니다. 흡착·해제 대기 시간은 거리에 포함되지 않습니다.</li><li>표시한 장애물과 TCP·운반 블록의 겹침을 계산합니다. 로봇 팔 전체의 물리 충돌이나 실장비 안전을 검증하는 기능은 아닙니다.</li></ul></details>
  </div>;
}
