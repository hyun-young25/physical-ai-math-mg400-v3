import { FK_REFERENCE, horizontalReach } from "./fkLearning";
import { FK_EXERCISES, IK_EXERCISES, KINEMATICS_TOLERANCE, fkObservation, ikObservation, kinematicsFrames, kinematicsCanAdvance, KINEMATICS_JOINT_LABELS, type KinematicsVisual } from "./kinematicsLearning";
import "./kinematicsLearning.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  POSE_AXES, JOINT_AXES, parseLessonNumber, poseDifference, translatePose, sampleLessonMotion,
  type LessonPose, type LessonJoints, type LessonModel, type LessonFrame,
  type CoordinateTopic, type KinematicsTopic,
} from "./curriculum";
import "./curriculum.css";
import { TaskStartPoint, moveVirtualTaskStart } from "./TaskStartPoint";
import { MathInquiryPanel, useMathInquiry, maximumLineDeviation } from "./MathInquiry";
import { LessonConceptHeader } from "./LessonConceptHeader";
import { usePractice } from "./PracticeProvider";
import { MeasuredCard } from "./PracticeControls";
import type { PracticeOperation, RobotMeasurement } from "./practiceSession";
import { MOTION_COLORS, visibleMotionPaths, type MotionComparisonVisual, type MotionPaths, type MotionTrace } from "./motionComparison";

export function LessonPanel({ title, children }: {
  title: string; children: ReactNode;
}) {
  return <section className="curriculum-panel" aria-label={title}>
    <h1 className="curriculum-title">{title}</h1>
    <div className="curriculum-body">{children}</div>
  </section>;
}

export type MotionProps = {
  coords: LessonPose; joints: LessonJoints; model: LessonModel;
  hardwareConnected: boolean; resetKey: number;
  onMoveTo: (x: number, y: number, z: number, r: number) => void;
  onMoveJoints: (joints: LessonJoints) => void;
  onMoveEnd: () => void; onResetPose: () => void;
};

// Cancel on navigation, global HOME, or hardware connection. No delayed frame can
// overwrite the restored HOME pose, and these lessons never call a bridge method.
export function useLessonMotion(props: MotionProps) {
  const latest = useRef(props);
  latest.current = props;
  const frame = useRef<number | null>(null);
  const [running, setRunning] = useState(false);
  const practice = usePractice();
  const prRef = useRef(practice); prRef.current = practice;
  const unlock = useRef<null | (() => void)>(null);
  const hw = useRef(false);
  const [measured, setMeasured] = useState<RobotMeasurement[]>([]);
  const [hwError, setHwError] = useState("");
  const cancel = useCallback((commit = true) => {
    // Every virtual playback holds the mode lock until it ends, is cancelled, or unmounts.
    unlock.current?.(); unlock.current = null;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
      if (commit) latest.current.onMoveEnd();
    }
  }, []);
  useLayoutEffect(() => {
    cancel(false);
    setRunning(false);
  }, [props.resetKey, cancel]);
  useLayoutEffect(() => {
    cancel();
    setRunning(false);
  }, [props.hardwareConnected, cancel]);
  useEffect(() => () => { cancel(); prRef.current.cancelConfirmation(); if (hw.current) prRef.current.session.stop(); }, [cancel]);
  const stop = () => { cancel(); if (hw.current) prRef.current.session.stop(); setRunning(false); };
  // Hardware branch: only protocol-v2 session operations. Results are measured
  // values from the session, never sampled FK or virtual completion.
  const runHardware = async (ops: PracticeOperation[], label: string) => {
    cancel(false); setRunning(true); hw.current = true; setHwError(""); setMeasured([]);
    try {
      const done = await prRef.current.runOps(ops, label, m => setMeasured(list => [...list, m]));
      if (!done) setHwError("실제 실행이 확인되지 않아 시작하지 않았습니다.");
      return done;
    } catch (e) { setHwError(e instanceof Error ? e.message : "실제 실행 오류"); return null; }
    finally { hw.current = false; setRunning(false); }
  };
  const play = (frames: LessonFrame[], mode: "MoveJ" | "MoveL", done?: () => void, progress?: (index: number) => void, durationMs = 1800) => {
    if (latest.current.hardwareConnected || prRef.current.hardware || !frames.length) return;
    cancel();
    setRunning(true);
    unlock.current = prRef.current.lockVirtual();
    let start: number | null = null;
    const tick = (now: number) => {
      if (latest.current.hardwareConnected) { stop(); return; }
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / durationMs);
      const index = Math.min(frames.length - 1, Math.floor(t * (frames.length - 1)));
      const next = frames[index];
      if (mode === "MoveJ") latest.current.onMoveJoints(next.joints);
      else latest.current.onMoveTo(next.pose.x, next.pose.y, next.pose.z, next.pose.r);
      progress?.(index);
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else {
        frame.current = null;
        unlock.current?.(); unlock.current = null;
        latest.current.onMoveEnd();
        setRunning(false);
        done?.();
      }
    };
    frame.current = requestAnimationFrame(tick);
  };
  return { running, play, stop, runHardware, hardware: practice.hardware, measured, hwError,
    // HOME only resets the virtual view; it never sends a physical home command.
    reset: () => { cancel(false); setRunning(false); latest.current.onResetPose(); } };
}

const fmt = (n: number) => Number(n.toFixed(2)).toString();
const pointText = (p: LessonPose) => `(${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)})`;
type PoseDraft = { x: string; y: string; z: string };
const toDraft = (p: Pick<LessonPose, "x" | "y" | "z">): PoseDraft => ({ x: String(p.x), y: String(p.y), z: String(p.z) });
function readPose(draft: PoseDraft, r = 0): LessonPose | null {
  const x = parseLessonNumber(draft.x), y = parseLessonNumber(draft.y), z = parseLessonNumber(draft.z);
  return x === null || y === null || z === null ? null : { x, y, z, r };
}
function PoseInputs({ label, value, onChange, disabled }: {
  label: string; value: PoseDraft; onChange: (draft: PoseDraft) => void; disabled?: boolean;
}) {
  return <fieldset className="lesson-coordinates" disabled={disabled}>
    <legend>{label} <small>(mm)</small></legend>
    {POSE_AXES.map(axis => <label key={axis}>{axis.toUpperCase()}
      <input type="number" step="any" value={value[axis]} aria-label={`${label} ${axis.toUpperCase()}`}
        onChange={event => onChange({ ...value, [axis]: event.target.value })}/></label>)}
  </fieldset>;
}
function DtNotice({ connected }: { connected: boolean }) {
  return <p className="lesson-notice">{connected
    ? "실장비 연결 중에는 이 개념 실습의 DT 실행을 잠급니다. 연결을 해제한 뒤 실행하세요."
    : "DT 개념 실습 · 실장비 명령을 보내지 않습니다. 계산 궤적은 실측값이 아닙니다."}</p>;
}
function LessonFooter({ motion, connected }: { motion: ReturnType<typeof useLessonMotion>; connected: boolean }) {
  return <div className="lesson-actions">
    {motion.running && <button onClick={motion.stop}>DT 정지</button>}
    <button disabled={connected} onClick={motion.reset}>↺ DT 원위치</button>
  </div>;
}

export function CoordinateLesson(props: MotionProps & {
  topic: Exclude<CoordinateTopic, "axes" | "shapes">;
  onNext: () => void;
  onVisualChange?: (visual: MotionComparisonVisual | null) => void;
}) {
  const { topic } = props;
  const motion = useLessonMotion(props);
  const [startDraft, setStartDraft] = useState<PoseDraft>({ x: "250", y: "50", z: "0" });
  const [endDraft, setEndDraft] = useState<PoseDraft>({ x: "300", y: "-50", z: "0" });
  const [deltaDraft, setDeltaDraft] = useState<PoseDraft>({ x: "50", y: "-100", z: "0" });
  const [coordinateMode, setCoordinateMode] = useState<"absolute" | "relative">("absolute");

  const [feedback, setFeedback] = useState<string | null>(null);
  const [relation, setRelation] = useState<{ from: LessonPose; to: LessonPose } | null>(null);
  const [paths, setPaths] = useState<MotionPaths>({});
  const [trace, setTrace] = useState<MotionTrace | null>(null);
  const [endpoints, setEndpoints] = useState<{ from: LessonPose; to: LessonPose } | null>(null);
  const displayedPaths = useMemo(() => visibleMotionPaths(paths, trace), [paths, trace]);
  const visual = useMemo<MotionComparisonVisual | null>(() => topic === "motion" && endpoints &&
    (displayedPaths.MoveJ || displayedPaths.MoveL)
      ? { ...endpoints, paths: displayedPaths, runningMode: trace?.mode ?? null } : null,
    [topic, endpoints, displayedPaths, trace]);
  useLayoutEffect(() => { props.onVisualChange?.(visual); }, [props.onVisualChange, visual]);
  useEffect(() => () => props.onVisualChange?.(null), [props.onVisualChange]);
  useEffect(() => { if (!motion.running) setTrace(null); }, [motion.running]);
  const [observed, setObserved] = useState(false);
  const [conditionRound,setConditionRound]=useState(0);
  const workRequirement=conditionRound%2===0?"straight-path":"endpoint-only";
  const inquiry=useMathInquiry("motion",{start:startDraft,end:endDraft,conditionRound,workRequirement},[
    {key:"end",label:"두 방식의 도착점",options:[{value:"same",label:"같다"},{value:"different",label:"다르다"}]},
    {key:"path",label:"이번 두 TCP 경로",options:[{value:"same",label:"겹친다"},{value:"different",label:"중간 경로가 다르다"}]},
    {key:"method",label:"작업 조건에 대한 판단",options:[{value:"MoveL",label:"직선 경로가 필요하므로 MoveL"},{value:"either",label:"끝점 조건만 있으므로 두 방식 모두 가능"},{value:"MoveJ",label:"직선 경로가 필요하므로 MoveJ"}]},
  ],["MoveJ","MoveL"],props.resetKey,props.hardwareConnected);
  const resetResults = () => {
    setFeedback(null); setRelation(null); setPaths({}); setTrace(null); setEndpoints(null); setObserved(false);
  };
  useEffect(() => { resetResults(); }, [props.resetKey]);
  const execute = (mode: "MoveJ" | "MoveL") => {
    if(props.hardwareConnected||(topic==="motion"&&!inquiry.ready))return;
    const from: LessonPose | null = readPose(startDraft);
    let to: LessonPose | null = null;
    if (from) {
      const delta = readPose(deltaDraft);
      to = topic === "coordinates" && coordinateMode === "relative"
        ? delta && translatePose(from, delta) : readPose(endDraft);
    }
    if (!from || !to) { setFeedback("X, Y, Z를 빠짐없이 유한한 숫자로 입력하세요."); return; }
    if (motion.hardware) {
      setRelation({ from, to }); setObserved(false); setFeedback(null);
      void motion.runHardware([{ kind: "move", motion: "MoveJ", target: from }, { kind: "move", motion: mode, target: to }],
        `${topic === "motion" ? "2-3" : "2-2"} ${mode} A→B 실측`);
      return;
    }
    const frames = sampleLessonMotion(props.model, from, to, mode, props.joints.j3);
    if (!frames) { setFeedback("입력한 점 또는 중간 경로에 이 DT 모델의 해가 없습니다. 좌표를 조정하세요."); return; }
    setRelation({ from, to });
    setFeedback(null); setObserved(false);
    const actual = frames.map(f => props.model.fk(f.joints));
    const retained = { ...paths };
    delete retained[mode];
    if(topic==="motion") {
      inquiry.begin(mode);
      setPaths(retained);
      setEndpoints({ from: actual[0], to: actual.at(-1)! });
      setTrace({ mode, points: [] });
    }
    motion.play(frames, mode, () => {
      setObserved(true);
      if (topic === "motion") {
        const next={...retained,[mode]:actual};setPaths(next);setTrace(null);
        const j=next.MoveJ,l=next.MoveL;
        const gap=j&&l?Math.max(...j.map((p,i)=>Math.hypot(p.x-l[i].x,p.y-l[i].y,p.z-l[i].z))):null;
        const deviation=j&&l?maximumLineDeviation(j,l[0],l.at(-1)!):null;
        const endGap=j&&l?Math.hypot(j.at(-1)!.x-l.at(-1)!.x,j.at(-1)!.y-l.at(-1)!.y,j.at(-1)!.z-l.at(-1)!.z):null;
        inquiry.finish(`${mode} 실행 완료.${deviation===null?"":` MoveJ의 TCP 경로가 직선 A–B에서 벗어난 최대 거리 ${fmt(deviation)} mm. 0.15 mm 이내는 DT 반올림 범위로 봅니다.`}`,
          deviation===null?{}:{end:endGap!<=0.1?"same":"different",path:deviation<=0.15?"same":"different",method:workRequirement==="straight-path"?"MoveL":"either"},
          {from,to,frames:actual,maximumSeparation:gap,maximumLineDeviation:deviation,endpointSeparation:endGap});
      }
    }, topic === "motion" ? index => setTrace({ mode, points: actual.slice(0, index + 1) }) : undefined);
  };
  const controlsLocked = motion.running;
  const bothPaths = !!paths.MoveJ && !!paths.MoveL;
  const stageIndex = motion.running ? 1 : topic === "motion"
    ? (bothPaths ? 2 : observed ? 1 : 0)
    : (observed ? 2 : 0);
  const startPoint = readPose(startDraft);
  const endPoint = topic === "coordinates"
    ? (coordinateMode === "absolute" ? readPose(endDraft) : readPose(deltaDraft))
    : readPose(endDraft);
  return <div className="lesson-scroll math-start-lesson legacy-coordinate-lesson">
    <TaskStartPoint taskKey={`coordinate-legacy:${topic}:${props.resetKey}`} start={startPoint} coords={props.coords}
      disabled={motion.running} legacyConnected={props.hardwareConnected} onVirtualMove={p=>moveVirtualTaskStart(props,p)}/>
    <div className="axis-status">
      <strong>{topic === "coordinates" ? "2-2 · 절대·상대좌표" : "2-3 · MoveJ·MoveL 경로"}</strong>
      <span>{stageIndex === 0 ? "표현·예측" : stageIndex === 1 ? "실행·측정" : "비교·수정"}</span>
    </div>
    <div className="math-cycle-rail" aria-label="피지컬 AI 학습 순환">
      <div className="math-cycle-current">
        <b>{stageIndex === 0 ? "3/7" : stageIndex === 1 ? "4/7" : "6/7"}</b>
        {stageIndex === 0 ? "표현·예측" : stageIndex === 1 ? "실행·측정" : "비교·해석"}
      </div>
    </div>
    <div className="math-stage-rail coordinate-stage-rail" aria-label="현재 활동 단계">
      <span aria-current={stageIndex === 0 ? "step" : undefined}>1. 표현·예측</span>
      <span aria-current={stageIndex === 1 ? "step" : undefined}>2. 실행·측정</span>
      <span aria-current={stageIndex === 2 ? "step" : undefined}>3. 비교·수정</span>
    </div>
    <LessonConceptHeader
      section={topic === "coordinates" ? "2-2" : "2-3"}
      label="개념 학습"
      title={topic === "coordinates" ? "절대좌표와 상대좌표" : "MoveJ와 MoveL 경로"}
      duration="수업 1회 20~30분"
      definition={topic === "coordinates"
        ? "절대좌표는 도착 위치를, 상대좌표는 출발점에서의 변화량을 지정합니다. 같은 이동을 두 표현으로 바꾸고 DT로 확인합니다."
        : "같은 출발점과 도착점이라도 관절각 보간과 TCP 직선 보간은 중간 경로가 달라질 수 있습니다. 작업 조건에 맞는 방식을 판단합니다."}
      columns={[]}
      showColumns={false}
    />
    <section className="coordinate-concept-bridge" aria-label="핵심 관계를 이번 이동에 연결하기">
      <strong>핵심 관계를 이번 이동에 연결하기</strong>
      <div className="coordinate-concept-bridge__points">
        <div><small>공통 출발점 A</small><b>{startPoint ? pointText(startPoint) : "입력 대기"} mm</b></div>
        <span aria-hidden="true">→</span>
        <div><small>{topic === "coordinates" ? (coordinateMode === "absolute" ? "도착점 B" : "변화량 Δ") : "공통 도착점 B"}</small><b>{endPoint ? pointText(endPoint) : "입력 대기"} mm</b></div>
      </div>
      <div className="coordinate-concept-bridge__formula">
        {topic === "coordinates" ? "B = A + Δ  ·  Δ = B − A" : "MoveJ = 관절각 보간  ·  MoveL = TCP 직선 보간"}
      </div>
      <p>{topic === "coordinates"
        ? "절대좌표는 목표 위치, 상대좌표는 현재 위치에서 더할 변화량입니다. 두 숫자가 달라도 같은 이동을 표현할 수 있습니다."
        : "끝점 조건과 중간 경로 조건을 구분하세요. 직선 경로가 필요한 작업이면 TCP의 경로를 직접 만드는 방식이 중요합니다."}</p>
    </section>
    <DtNotice connected={props.hardwareConnected}/>
    {motion.hardware && <p className="lesson-notice" data-testid="text-hardware-lesson-notice">실제 로봇 모드 · 실행 버튼은 확인 창을 거쳐 A로 이동한 뒤 B로 {topic === "motion" ? "선택한 방식으로" : "MoveL로"} 이동하고 실측 TCP만 보여 줍니다. 자동 성공 판정은 없습니다.</p>}
    {topic === "coordinates" ? <>
      <p>절대좌표는 도착 위치, 상대좌표는 출발점에서의 변화량입니다. 같은 이동을 두 방식으로 표현해 보세요.</p>
      <div className="lesson-formula">도착점 B = 출발점 A + 변화량 Δ<br/>Δ = B − A</div>
      <PoseInputs label="출발점 A" value={startDraft} disabled={controlsLocked} onChange={v => { setStartDraft(v); resetResults(); }}/>
      <div className="lesson-toggle">
        <button aria-pressed={coordinateMode === "absolute"} disabled={controlsLocked} onClick={() => { setCoordinateMode("absolute"); resetResults(); }}>절대좌표</button>
        <button aria-pressed={coordinateMode === "relative"} disabled={controlsLocked} onClick={() => { setCoordinateMode("relative"); resetResults(); }}>상대좌표</button>
      </div>
      {coordinateMode === "absolute"
        ? <PoseInputs label="도착점 B" value={endDraft} disabled={controlsLocked} onChange={v => { setEndDraft(v); resetResults(); }}/>
        : <PoseInputs label="변화량 Δ" value={deltaDraft} disabled={controlsLocked} onChange={v => { setDeltaDraft(v); resetResults(); }}/>} 
      <p className="lesson-note">실행하면 DT를 A에 배치한 뒤 B까지 MoveL로 이동합니다. R은 0°로 고정합니다.</p>
    </> : <>
      <p>같은 A와 B라도 중간 경로가 같을까요? 먼저 예측한 뒤 두 이동 방식을 실행해 비교하세요.</p>
      <p className="lesson-formula">작업 조건: {workRequirement==="straight-path"?"A부터 B까지 직선으로 접착제를 바르려 합니다. TCP의 중간 경로가 직선이어야 합니다.":"A에서 B로 위치를 옮기려 합니다. 이번에는 도착점만 같으면 되고, 중간 경로의 모양에는 조건이 없습니다."}</p>
      <PoseInputs label="공통 출발점 A" value={startDraft} disabled={controlsLocked} onChange={v => { setStartDraft(v); resetResults(); }}/>
      <PoseInputs label="공통 도착점 B" value={endDraft} disabled={controlsLocked} onChange={v => { setEndDraft(v); resetResults(); }}/>
      <MathInquiryPanel inquiry={inquiry} part="before" locked={controlsLocked}
        prompt="같은 A→B의 끝점과 중간 경로를 각각 예측하세요. 작업 조건에 맞는 이동도 고르고, 보간 대상과 연결해 근거를 적으세요."/>
      <p className="lesson-note">각 실행은 DT를 같은 A에 배치한 뒤 B로 이동합니다. R=0°, 비교 시간은 동일합니다.</p>
    </>}
    <div className="lesson-actions">
      {topic === "motion" && <button className="lesson-primary" disabled={controlsLocked || props.hardwareConnected || !inquiry.ready}
        onClick={() => execute("MoveJ")}>A→B MoveJ 실행</button>}
      <button className="lesson-primary" disabled={controlsLocked || props.hardwareConnected || (topic !== "coordinates" && !inquiry.ready)}
        onClick={() => execute("MoveL")}>{topic === "motion" ? "A→B MoveL 실행" : "예측 확인 · DT 실행"}</button>
    </div>
    {feedback && <p className="lesson-feedback" role="status">{feedback}</p>}
    {motion.hwError && <p className="lesson-feedback" role="alert">{motion.hwError}</p>}
    <MeasuredCard title={`${topic === "motion" ? "A→B" : "A→B"} 실측 TCP (1: A 도착, 2: B 도착)`} measurements={motion.measured}/>
    {relation && observed && topic !== "motion" && <div className="lesson-card" aria-live="polite">
      <strong>실행한 좌표의 관계</strong>
      <table><thead><tr><th>축</th><th>A</th><th>Δ</th><th>B = A + Δ</th></tr></thead><tbody>
        {POSE_AXES.map(a => <tr key={a}><th>{a.toUpperCase()}</th><td>{fmt(relation.from[a])}</td>
          <td>{fmt(poseDifference(relation.from, relation.to)[a])}</td><td>{fmt(relation.to[a])}</td></tr>)}
      </tbody></table><small>단위 mm · 입력 명령 기준, DT 표시값은 반올림될 수 있습니다.</small>
      {topic === "coordinates" && <button onClick={() => {
        setEndDraft(toDraft(relation.to)); setDeltaDraft(toDraft(poseDifference(relation.from, relation.to)));
        setCoordinateMode(coordinateMode === "absolute" ? "relative" : "absolute");
      }}>같은 이동을 {coordinateMode === "absolute" ? "상대좌표" : "절대좌표"}로 표현</button>}
    </div>}
    {visual && <div className="lesson-card">
      {topic === "motion" && bothPaths && <div className="motion-condition-comparison" aria-label="작업 조건과 내 판단 비교">
        <strong>{workRequirement === "straight-path" ? "이번 조건 · 중간 경로도 직선" : "이번 조건 · 도착점만 지정"}</strong>
        <p>내 판단: {inquiry.record?.prediction.method === "either" ? "두 방식 모두 가능" : inquiry.record?.prediction.method ?? "미입력"}</p>
        <p>{workRequirement === "straight-path" ? "MoveL은 TCP의 직선 경로를 계획합니다. 끝점 일치와 중간 경로의 직선 여부를 따로 비교하세요."
          : "이번 조건에는 MoveJ와 MoveL을 모두 사용할 수 있습니다. MoveL만 필요한 조건인지, 끝점만 같은 조건인지 구분하세요."}</p>
      </div>}
      <MotionPlot visual={visual}/>
      <p className="lesson-note">왼쪽 바닥과 같은 XY 투영 · DT 계산 궤적. 높이(Z)는 로봇 움직임에서 확인하세요. 정지한 실행의 미완료 선은 지웁니다.</p>
      {motion.running ? <p>{trace?.mode} 실행 중 · 움직임에 따라 양쪽 경로가 함께 그려집니다.</p> :
      bothPaths?<p>MoveJ는 관절각을, MoveL은 TCP 위치를 보간합니다. 이 차이로 관찰한 경로를 설명해 보세요. 특정 배치에서는 두 경로가 같을 수도 있습니다.</p>
        :<p>나머지 이동 방식도 실행하면 두 경로를 겹쳐 볼 수 있습니다.</p>}
    </div>}
    {topic==="motion"&&<MathInquiryPanel inquiry={inquiry} part="after" locked={controlsLocked}
      reflectionPrompt="관찰한 경로를 근거로, 이 작업에서 선택한 이동이 적절한 이유를 설명하세요. 끝점 조건과 중간 경로 조건을 구분하고 보간 대상을 연결하세요."
      onNewCondition={()=>{setConditionRound(n=>n+1);setEndDraft({x:"300",y:conditionRound%2?"-50":"80",z:conditionRound%2?"0":"40"});resetResults();}}/>}
    <LessonFooter motion={{...motion,stop:()=>{motion.stop();inquiry.interrupt();}}} connected={props.hardwareConnected}/>
    <button className="lesson-next" disabled={motion.running} onClick={props.onNext}>다음: {topic === "coordinates" ? "MoveJ·MoveL 비교" : "도형 경로 만들기"} →</button>
  </div>;
}

function MotionPlot({ visual }: { visual: MotionComparisonVisual }) {
  const { paths, from: a, to: b } = visual;
  const points = [a, b, ...(paths.MoveJ ?? []), ...(paths.MoveL ?? [])];
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  const scale = Math.min(300 / Math.max(1, maxX-minX), 160 / Math.max(1, maxY-minY));
  const project = (p: LessonPose) => [200 + (p.x-(minX+maxX)/2)*scale, 115 - (p.y-(minY+maxY)/2)*scale];
  const endpoints = Math.hypot(a.x - b.x, a.y - b.y) < 0.1
    ? [{ point: a, label: "A·B" }] : [{ point: a, label: "A" }, { point: b, label: "B" }];
  return <>
    <div className="lesson-legend"><span style={{ color: MOTION_COLORS.MoveJ }}>━ MoveJ</span><span style={{ color: MOTION_COLORS.MoveL }}>┄ MoveL</span></div>
    <svg viewBox="0 0 400 240" className="lesson-plot" role="img" aria-label="MoveJ와 MoveL의 DT TCP 궤적 비교">
      <path d="M 22 215 H 380 M 22 215 V 15" fill="none" stroke="#94a3b8"/><text x="380" y="234">+X</text><text x="3" y="13">+Y</text>
      {(["MoveJ", "MoveL"] as const).map(mode => paths[mode] && <polyline key={mode}
        points={paths[mode]!.map(p => project(p).join(",")).join(" ")} fill="none" stroke={MOTION_COLORS[mode]}
        strokeWidth="3" strokeDasharray={mode === "MoveL" ? "6 4" : undefined}/>)}
      {endpoints.map(({ point: p, label }) => <g key={label}><circle cx={project(p)[0]} cy={project(p)[1]} r="5" fill="#334155"/>
        <text x={project(p)[0]+10} y={project(p)[1]-10}>{label}</text></g>)}
    </svg>
  </>;
}

function useFKExerciseInquiry(index: number, resetKey: number, connected: boolean) {
  const task = FK_EXERCISES[index];
  return useMathInquiry("fk", {
    exercise: index + 1, repairing: false, resetKey, connected,
    taskKind: index === 0 ? "practice" : index === 1 ? "representative" : "transfer",
    input: task.input, reference: task.reference,
  }, task.fields, ["kinematics"], resetKey, connected);
}

function useIKExerciseInquiry(index: number, repairing: boolean, input: PoseDraft, resetKey: number, connected: boolean) {
  return useMathInquiry("ik", {
    exercise: index + 1, repairing, resetKey, connected, input, reference: FK_REFERENCE,
    taskKind: index === 0 ? "practice" : index === 1 ? "representative" : "transfer",
  }, IK_EXERCISES[index].fields, ["kinematics"], resetKey, connected);
}

export function KinematicsLesson(props: MotionProps & {
  topic: KinematicsTopic; onNext: () => void; onVisualChange?: (visual: KinematicsVisual | null) => void;
}) {
  const motion = useLessonMotion(props);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [repairingThird, setRepairingThird] = useState(false);
  const [thirdTargetDraft, setThirdTargetDraft] = useState<PoseDraft>(() => toDraft(IK_EXERCISES[2].target));
  const repairing = props.topic === "ik" && exerciseIndex === 2 && repairingThird;
  const targetDraft = exerciseIndex === 2 ? thirdTargetDraft : toDraft(IK_EXERCISES[exerciseIndex].target);
  const [selectedJoint, setSelectedJoint] = useState<keyof LessonJoints | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calculation, setCalculation] = useState<{
    recordId: string; joints: LessonJoints | null; pose: LessonPose | null;
    target?: LessonPose; residual?: number | null; expected: Record<string, number | string>;
  } | null>(null);
  const fkTask = FK_EXERCISES[exerciseIndex];
  const ikTask = IK_EXERCISES[exerciseIndex];
  const task = props.topic === "fk" ? fkTask : ikTask;
  const reference = props.topic === "fk" ? fkTask.reference : FK_REFERENCE;
  // Keep each task's drafts and evidence mounted while learners move between tasks.
  const fkInquiries = [
    useFKExerciseInquiry(0, props.resetKey, props.hardwareConnected),
    useFKExerciseInquiry(1, props.resetKey, props.hardwareConnected),
    useFKExerciseInquiry(2, props.resetKey, props.hardwareConnected),
  ];
  const ikInquiries = [
    useIKExerciseInquiry(0, false, toDraft(IK_EXERCISES[0].target), props.resetKey, props.hardwareConnected),
    useIKExerciseInquiry(1, false, toDraft(IK_EXERCISES[1].target), props.resetKey, props.hardwareConnected),
    useIKExerciseInquiry(2, repairingThird, thirdTargetDraft, props.resetKey, props.hardwareConnected),
  ];
  const inquiries = props.topic === "fk" ? fkInquiries : ikInquiries;
  const inquiry = inquiries[exerciseIndex];
  const taskCalculations = useRef<Record<number, typeof calculation>>({});
  // A revised prediction has a new record ID; an old calculation cannot be applied.
  const result = calculation?.recordId === inquiry.record?.id ? calculation : null;
  const clear = () => { setCalculation(null); setError(null); };
  const latest = useRef(props); latest.current = props;
  const resetReference = (newAttempt = false) => {
    if (latest.current.hardwareConnected || motion.hardware) return;
    motion.stop(); inquiry.interrupt();
    if (newAttempt) { inquiry.revise(); clear(); }
    latest.current.onMoveJoints(reference);
    latest.current.onMoveEnd();
  };
  // A new problem starts at its stated reference. Global HOME is deliberately not
  // a dependency: it must remain HOME until the learner explicitly resumes.
  useLayoutEffect(() => {
    if (latest.current.hardwareConnected || motion.hardware) return;
    latest.current.onMoveJoints(reference);
    latest.current.onMoveEnd();
  }, [props.topic, exerciseIndex]);
  useEffect(() => { clear(); taskCalculations.current = {}; }, [props.resetKey, props.hardwareConnected]);

  const openExercise = (index: number) => {
    if (index === exerciseIndex || !inquiries[index]
      || motion.running || props.hardwareConnected) return;
    taskCalculations.current[exerciseIndex] = calculation;
    setCalculation(taskCalculations.current[index] ?? null);
    setError(null);
    setSelectedJoint(null);
    setExerciseIndex(index);
  };

  const calculate = () => {
    if (!inquiry.ready || !inquiry.record || motion.running || props.hardwareConnected) return;
    clear();
    if (props.topic === "fk") {
      setCalculation({ recordId: inquiry.record.id, joints: fkTask.input,
        pose: props.model.fk(fkTask.input), expected: fkObservation(props.model, fkTask.input, reference) });
      return;
    }
    const target = readPose(targetDraft);
    if (!target) { setError("목표 X, Y, Z를 모두 유한한 숫자로 입력하세요."); return; }
    const checked = ikObservation(props.model, target, reference.j3);
    setCalculation({ recordId: inquiry.record.id, ...checked, target });
    if (!checked.joints) {
      inquiry.begin("kinematics");
      inquiry.finish("이 모델에는 해당 목표의 해가 없습니다. DT는 움직이지 않았으며, 복원 좌표와 오차도 생성하지 않았습니다.",
        checked.expected, { target, joints: null, exercise: exerciseIndex + 1, repairing }, "unavailable");
    }
  };
  const apply = () => {
    if (!result?.joints || !result.pose || !inquiry.ready || motion.running || props.hardwareConnected) return;
    if (motion.hardware) {
      if (props.topic === "ik" && result.target) void motion.runHardware([{ kind: "move", motion: "MoveJ", target: result.target }], "3-2 IK 목표를 실제 로봇 MoveJ로 이동");
      else setError("관절각 직접 명령은 실제 로봇에서 지원하지 않습니다. DT에서 관찰하세요.");
      return;
    }
    const frames = kinematicsFrames(props.model, reference, result.joints);
    // Replay every observation from the named reference, including after HOME.
    props.onMoveJoints(reference); props.onMoveEnd();
    inquiry.begin("kinematics");
    motion.play(frames, "MoveJ", () => {
      const observed = props.model.fk(frames.at(-1)!.joints);
      inquiry.finish("기준 자세에서 계산한 자세까지 DT 관찰을 완료했습니다. 아래 좌표는 모델 계산 결과입니다.", result.expected,
        { exercise: exerciseIndex + 1, repairing, reference, target: result.target,
          appliedJoints: result.joints, observed, residual: result.residual });
    });
  };
  const advance = () => {
    if (!inquiry.reviewed || motion.running || props.hardwareConnected) return;
    if (props.topic === "ik" && exerciseIndex === 2 && !repairing) {
      inquiry.feedbackEvent("transfer"); setRepairingThird(true); clear(); resetReference(); return;
    }
    if (!kinematicsCanAdvance(inquiry.reviewed, props.topic, exerciseIndex, repairing, !!result?.joints && inquiry.observed)) return;
    inquiry.feedbackEvent("transfer");
    openExercise(exerciseIndex + 1);
  };
  const taskComplete = inquiries.map((item, index) => {
    const saved = index === exerciseIndex ? calculation : taskCalculations.current[index];
    const reachable = saved?.recordId === item.record?.id && !!saved?.joints && item.observed;
    return kinematicsCanAdvance(item.reviewed, props.topic, index, index === 2 && repairingThird, reachable);
  });
  const finalReady = taskComplete.every(Boolean);
  const showAdvance = !finalReady && (exerciseIndex < 2 || (props.topic === "ik" && !repairing));
  const cycleStep = motion.running ? 4 : inquiry.reviewed ? 7 : inquiry.observed ? 6 : result ? 5 : 3;
  const cycleLabel = ({ 3: "표현·예측", 4: "실행·측정", 5: "지각·표상", 6: "비교·해석", 7: "수정·재실행" } as Record<number, string>)[cycleStep];
  const referencePose = props.model.fk(reference);
  const atReference = JOINT_AXES.every(key => Math.abs(props.joints[key] - reference[key]) <= 0.1);
  const previousIK = props.topic === "ik" && exerciseIndex === 1 ? ikObservation(props.model, IK_EXERCISES[0].target) : null;
  const progressTasks = props.topic === "fk" ? FK_EXERCISES : IK_EXERCISES;
  const focusJoint: keyof LessonJoints = selectedJoint ?? (props.topic === "fk"
    ? (["j2", "j3", "j1"] as const)[exerciseIndex] : exerciseIndex === 0 ? "j1" : "j3");
  const focusInput = props.topic === "fk" ? fkTask.input[focusJoint] : undefined;
  useEffect(() => {
    props.onVisualChange?.({ joint: focusJoint, reference: reference[focusJoint], input: focusInput });
    return () => props.onVisualChange?.(null);
  }, [props.onVisualChange, focusJoint, reference, focusInput]);
  const reflectionPrompt = repairing
    ? "바꾼 목표의 거리 d와 최대 도달 거리를 비교하세요. 수정 후 IK 해와 FK 검산 결과가 어떻게 달라졌나요?"
    : task.reflection;
  return <div className="lesson-scroll math-start-lesson kinematics-learning">
    <TaskStartPoint taskKey={`${props.topic}:${exerciseIndex}:${props.resetKey}`} start={props.model.fk(reference)} coords={props.coords}
      disabled={motion.running} legacyConnected={props.hardwareConnected} onVirtualMove={p=>moveVirtualTaskStart(props,p)}/>
    <div className="axis-status">
      <strong>{props.topic === "fk" ? "3-1 · 순기구학" : "3-2 · 역기구학"}</strong>
      <span>과제 {exerciseIndex + 1}/3{repairing ? " · 목표 수정" : ""}</span>
    </div>
    {motion.hardware && <p className="lesson-notice">실제 로봇 모드 · IK 목표는 확인 후 좌표 MoveJ로 보내며, 아래 값은 실측입니다. 계산값 관찰과 성공 판정은 DT 기록입니다.</p>}
    {motion.hwError && <p className="lesson-feedback" role="alert">{motion.hwError}</p>}
    <MeasuredCard title="IK 목표 이동의 실측 TCP" measurements={motion.measured}/>
    <div className="math-cycle-rail" aria-label="피지컬 AI 학습 순환">
      <div className="math-cycle-current"><b>{cycleStep}/7</b>{cycleLabel}</div>
    </div>
    <nav className="math-course-strip math-course-strip--compact"
      aria-label={`${props.topic === "fk" ? "순기구학" : "역기구학"} 수업 경로. 각 과제를 클릭해 바로 학습할 수 있습니다.`}>
      <div className="math-course-strip__top">
        <strong>수업 경로</strong>
        <span>과제 {exerciseIndex + 1} · {task.title}</span>
      </div>
      <div className="math-course-summary">
        {progressTasks.map((item, index) => <button key={item.title} type="button"
          className={index === exerciseIndex ? "is-current" : taskComplete[index] ? "is-done" : ""}
          aria-current={index === exerciseIndex ? "step" : undefined}
          aria-label={`과제 ${index + 1} ${item.title}${taskComplete[index] ? " · 완료" : ""} · 이동`}
          title={`${item.title} · 클릭하여 해당 과제로 이동`}
          disabled={motion.running || props.hardwareConnected}
          onClick={() => openExercise(index)}>
          <b>{taskComplete[index] ? "✓" : index + 1}</b>{item.title}
        </button>)}
      </div>
    </nav>
    <section className="lesson-card kinematics-problem" aria-label="이번 운동학 과제">
      <h3>과제 {exerciseIndex + 1}. {task.title}{repairing ? " · 목표 수정" : ""}</h3>
      <p>{repairing ? "앞서 도달하지 못한 목표를 직접 바꾸세요. 바꾼 목표의 예측·계산·DT 관찰까지 완료해야 단원이 끝납니다." : task.goal}</p>
      <p className="kinematics-direction"><strong>핵심 개념 · </strong>{props.topic === "fk"
        ? "관절각 → TCP 좌표. 각도에서 위치를 예측하고 DT에서 확인합니다."
        : "목표 TCP 좌표 → 관절각. 구한 각도를 FK에 넣어 목표와 비교합니다."}</p>
    </section>
    {props.topic === "fk" ? <section className="lesson-card kinematics-reference">
      <h3>기준 자세와 새 각도</h3>
      <table><thead><tr><th>모델 각도</th><th>기준 자세</th><th>새 각도</th></tr></thead><tbody>
        {JOINT_AXES.map((key, index) => <tr key={key} className={reference[key] !== fkTask.input[key] ? "kinematics-changed" : ""}>
          <th><button type="button" className="kinematics-joint-select" aria-pressed={focusJoint === key}
            onClick={() => setSelectedJoint(key)}>{KINEMATICS_JOINT_LABELS[key]}</button></th><td>{reference[key]}°</td><td>{fkTask.input[key]}°{reference[key] !== fkTask.input[key] && " ← 변경"}</td>
        </tr>)}
      </tbody></table>
      <p>기준 TCP {pointText(referencePose)} mm · R={fmt(referencePose.r)}°</p>
      <p>기준 수평 성분 합 ρ={fmt(horizontalReach(reference))} mm</p>
      <p className="lesson-note">각도 이름을 누르면 왼쪽 로봇에서 해당 관절을 확인할 수 있습니다.</p>
      <p className="lesson-note">{atReference ? "DT가 위 기준 자세를 보여줍니다." : "DT의 현재 자세가 기준과 다릅니다. ‘DT 관찰’을 실행하면 위 기준 자세부터 시작합니다."}</p>
    </section> : <section className="lesson-card kinematics-target">
      <h3>{repairing ? "새 목표를 직접 설정하세요" : "이번 목표 TCP"}</h3>
      <PoseInputs label="목표 TCP" value={targetDraft} disabled={motion.running || props.hardwareConnected || !repairing}
        onChange={value => { setThirdTargetDraft(value); clear(); }}/>
      <p className="lesson-note">R=0°. 같은 목표에 다른 가지가 있을 수 있어, 이번 과제는 상대 팔꿈치각 θ₃≤0인 해로 비교합니다.</p>
      {previousIK?.joints && <p>이전 목표 (300, 50, 0)의 계산값: θ₁={fmt(previousIK.joints.j1)}°, θ₃={fmt(previousIK.joints.j3)}°</p>}
      {repairing && <p className="lesson-note">좌표를 바꾸면 이전 예측과 계산은 적용되지 않습니다. 새 조건에서 다시 예측하세요.</p>}
    </section>}
    <div className="lesson-note kinematics-notation" role="group" aria-label="기초수학과 관절 기호 연결">
      <span>기초수학 → 여기 · 눌러서 관절 확인</span>
      {([{key:"j1",label:"베이스 φ → θ₁"},{key:"j2",label:"어깨 θ₁ → θ₂"},
        {key:"j3",label:"상대 팔꿈치 θ₂ → θ₃"}] as const).map(joint =>
        <button type="button" key={joint.key} aria-pressed={focusJoint === joint.key}
          onClick={() => setSelectedJoint(joint.key)}>{joint.label}</button>)}
    </div>
    <DtNotice connected={props.hardwareConnected}/>
    <details className="lesson-context kinematics-formula">
      <summary>계산식·모델 상수 보기</summary>
      <div className="lesson-formula">
        L₁=L₂=175 mm · offsetₓ=162.124 mm · offset𝓏=−41.202 mm<br/>
        ρ=L₁cosθ₂+L₂cos(θ₂+θ₃)<br/>
        X=ρcosθ₁+offsetₓ,　Y=ρsinθ₁<br/>
        Z=L₁sinθ₂+L₂sin(θ₂+θ₃)+offset𝓏,　R=θ₄
        {props.topic === "ik" && <><br/>d²=(X−offsetₓ)²+Y²+(Z−offset𝓏)²<br/>
          θ₁=atan2(Y, X−offsetₓ)<br/>
          cosθ₃=(d²−L₁²−L₂²)/(2L₁L₂)<br/>
          이 과제의 가지: θ₃=−acos(cosθ₃)<br/>
          도달 조건: |L₁−L₂| ≤ d ≤ L₁+L₂ (0 ≤ d ≤ 350 mm)</>}
      </div>
      <p className="lesson-note">삼각함수 계산기는 도(°) 모드로 사용하세요. θ₃은 상대 팔꿈치각입니다. 위 식과 각도는 화면의 단순화한 2링크 계산 모델이며, 실장비의 관절각·제한과 구분합니다.</p>
    </details>
    <p className="lesson-note">수치 답은 {KINEMATICS_TOLERANCE} mm 또는 {KINEMATICS_TOLERANCE}° 이내 차이를 허용합니다. 소수 첫째 자리까지 계산해도 됩니다.</p>
    <MathInquiryPanel inquiry={inquiry} part="before" locked={motion.running || props.hardwareConnected}
      prompt={repairing ? "수정한 목표의 거리 d와 도달 가능 여부를 먼저 예측하세요. 해가 있다고 판단한 근거를 남긴 뒤 계산하세요." : task.prompt}/>
    <button className="lesson-primary" disabled={motion.running || props.hardwareConnected || !inquiry.ready || inquiry.observed} onClick={calculate}>
      {props.topic === "fk" ? "2. FK 좌표 계산" : "2. IK 계산·FK 검산"}
    </button>
    {error && <p className="lesson-feedback" role="status">{error}</p>}
    {result && <section className="lesson-card kinematics-result" aria-live="polite">
      <h3>{result.joints ? "계산 결과 → DT에서 확인하세요" : "계산 결과: 이 목표의 해가 없습니다"}</h3>
      {result.joints && result.pose ? <>
        <p>TCP {pointText(result.pose)} mm · R={fmt(result.pose.r)}°</p>
        <p>{JOINT_AXES.map((key, index) => `θ${index + 1}=${fmt(result.joints![key])}°`).join(" · ")}</p>
        {result.target && <p>FK 좌표−목표 좌표: ΔX={fmt(result.pose.x - result.target.x)}, ΔY={fmt(result.pose.y - result.target.y)}, ΔZ={fmt(result.pose.z - result.target.z)} mm<br/>
          위치 오차 크기={fmt(result.residual ?? 0)} mm (기준 {KINEMATICS_TOLERANCE} mm)</p>}
        <button className="lesson-primary" disabled={motion.running || props.hardwareConnected || !inquiry.ready || inquiry.observed} onClick={apply}>
          {inquiry.observed ? "✓ DT 관찰 완료" : motion.running ? "DT 관찰 중…" : "3. 기준 자세에서 DT 관찰"}
        </button>
      </> : <>
        <p>모델 원점에서 목표까지 {fmt(Number(result.expected.distance))} mm · 최대 거리 350 mm</p>
        <p>DT를 억지로 목표에 배치하지 않습니다. 아래에서 예측을 비교하고, 목표를 바꿀 방법을 설명하세요.</p>
      </>}
      <p className="lesson-note">IK→FK 검산은 같은 계산 모델 안에서의 확인입니다. 실측 오차·충돌·실장비 관절 제한을 검증한 결과가 아닙니다.</p>
    </section>}
    <MathInquiryPanel inquiry={inquiry} part="after" locked={motion.running || props.hardwareConnected}
      reflectionPrompt={reflectionPrompt} onNewCondition={showAdvance ? advance : undefined}
      nextLabel={props.topic === "ik" && exerciseIndex === 2 ? "목표를 직접 수정해 다시 확인" : `다음 과제 ${exerciseIndex + 2}/3: ${progressTasks[Math.min(2, exerciseIndex + 1)].title}`}/>
    {props.topic === "ik" && repairing && inquiry.reviewed && !result?.joints && <p className="lesson-feedback" role="status">아직 도달할 수 없는 목표입니다. 목표 좌표를 수정하고, 가능한 해를 DT에서 확인하세요.</p>}
    <div className="lesson-actions">
      {motion.running && <button onClick={() => { motion.stop(); inquiry.interrupt(); }}>DT 정지</button>}
      <button disabled={props.hardwareConnected || motion.running} onClick={() => resetReference(true)}>↺ 과제 기준 자세로 돌아가 다시 예측</button>
    </div>
    <p className="lesson-note">위 수업 경로에서 원하는 과제를 선택할 수 있습니다. 세 과제의 예측·관찰·수치 확인·설명 저장을 마치면 다음 단원으로 이어집니다.</p>
    <button className="lesson-next" disabled={motion.running || props.hardwareConnected || !finalReady} onClick={props.onNext}>
      {finalReady ? "✓ 세 과제 완료 · " : "세 과제 완료 후 · "}다음: {props.topic === "fk" ? "역기구학(IK)" : "운동학 종합과제: 픽앤플레이스"} →
    </button>
  </div>;
}
