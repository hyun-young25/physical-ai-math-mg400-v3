import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePractice } from "./PracticeProvider";
import { measurementFresh, targetProblem,workspaceFindings,describeWorkspaceFinding } from "./practiceSession";
import type { LessonPose } from "./curriculum";
import "./taskStartPoint.css";

export type TaskStartSpec = Partial<LessonPose>;
const axes = ["x", "y", "z", "r"] as const;
// DT display joints are rounded before FK; this is numerical display tolerance,
// never a change to the operator's hardware workspace or arrival tolerances.
const DT_TOLERANCE = 0.1;
const format = (p: LessonPose) => axes.map(k => `${k.toUpperCase()}=${Number(p[k].toFixed(2))}`).join(" / ");
const rotationError = (a: number, b: number) => Math.abs(((a - b + 540) % 360 + 360) % 360 - 180);
export function atTaskStart(current: LessonPose, target: LessonPose, positionTolerance: number, rotationTolerance: number) {
  return Math.hypot(current.x - target.x, current.y - target.y, current.z - target.z) <= positionTolerance
    && rotationError(current.r, target.r) <= rotationTolerance;
}

/** Standalone positioning only. Never invokes a lesson's run, grading or reset callback. */
export function TaskStartPoint({ taskKey, start, coords, onVirtualMove, disabled = false,
  legacyConnected = false, hardwareBlock }: {
  taskKey: string; start: TaskStartSpec | null; coords: LessonPose;
  onVirtualMove: (target: LessonPose) => void; disabled?: boolean;
  legacyConnected?: boolean; hardwareBlock?: string;
}) {
  const practice = usePractice();
  const { session, snap, hardware } = practice;
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [, refresh] = useState(0);
  useEffect(() => {
    if (!hardware) return;
    const timer = setInterval(() => refresh(n => n + 1), 400);
    return () => clearInterval(timer);
  }, [hardware]);
  const epoch = useRef(0), locked = useRef(false), executing = useRef(false);
  const latest = useRef(practice); latest.current = practice;
  const identity = `${taskKey}:${JSON.stringify(start)}:${hardware}`;
  const identityRef = useRef(identity); identityRef.current = identity;
  useLayoutEffect(() => {
    ++epoch.current; locked.current = false; setPending(false); setMessage("");
    return () => {
      ++epoch.current;
      if (locked.current) latest.current.cancelConfirmation();
      if (executing.current) latest.current.session.stop();
      executing.current = false; locked.current = false;
    };
  }, [identity]);
  if (!start || !Object.keys(start).length) return null;
  const current = hardware ? snap.measurement?.pose : coords;
  const target = current ? { ...current, ...start } : null;
  const invalid = !target || !axes.every(k => Number.isFinite(target[k]));
  const readiness = hardware ? hardwareBlock || session.readiness() : legacyConnected ? "기존 실장비 연결 중에는 DT 시작점 이동을 사용할 수 없습니다." : null;
  const bounds = hardware && target && snap.setup ? targetProblem(target, snap.setup,"과제 시작점 목표") : null;
  const rangeNotes=hardware&&snap.setup?[
    ...(current?workspaceFindings(current,snap.setup,"현재 실측 TCP"):[]),
    ...(target?workspaceFindings(target,snap.setup,"과제 시작점 목표"):[]),
  ].map(describeWorkspaceFinding):[];
  const block = snap.uncertainMotion
    ? `${readiness || "실제 정지 여부가 확인되지 않았습니다."} 안내·연결에서 현장 정지를 확인하고 준비 설정을 다시 적용한 뒤 재시도하세요.`
    : readiness || (invalid ? "시작 좌표와 현재 TCP 위치를 확인할 수 없습니다." : bounds);
  const fresh = !hardware || measurementFresh(snap.measurement, Date.now());
  const arrived = !block && fresh && !snap.measurement?.moving && current && target
    && atTaskStart(current, target, hardware ? snap.setup!.positionTolerance : DT_TOLERANCE, hardware ? snap.setup!.rotationTolerance : DT_TOLERANCE);
  const move = async () => {
    if (locked.current || disabled || snap.busy || snap.measurement?.moving) return;
    const generation = epoch.current, selected = identityRef.current;
    locked.current = true; setPending(true); setMessage("");
    try {
      if (block) throw new Error(block);
      if (!current || !target) throw new Error("현재 위치가 없습니다.");
      if (arrived) { setMessage("이미 시작점에 있습니다. 이동 명령을 보내지 않았습니다."); return; }
      const destination = { ...target }, before = { ...current };
      if (hardware) {
        const results = await practice.runOps([{ kind: "move", motion: "MoveJ", target: destination }],
          "과제 시작점으로 이동 — 시작 위치 준비만 수행", undefined, () => {
            if (generation !== epoch.current || selected !== identityRef.current)
              throw new Error("과제가 바뀌어 시작점 이동을 취소했습니다.");
            const now = session.getSnapshot(), problem = session.readiness();
            if (problem) throw new Error(problem);
            const badTarget = targetProblem(destination, now.setup!);
            if (badTarget) throw new Error(badTarget);
            if (!atTaskStart(now.measurement!.pose, before, now.setup!.positionTolerance, now.setup!.rotationTolerance))
              throw new Error("확인 중 현재 위치가 달라졌습니다. 시작점 이동을 다시 요청하세요.");
            executing.current = true;
          });
        if (generation !== epoch.current) return;
        if (!results) { setMessage("시작점 이동을 취소했습니다. 다시 요청할 수 있습니다."); return; }
        // Session.execute requires a fresh sequence and a measured endpoint within tolerance.
        const now = session.getSnapshot(), m = now.measurement;
        if (!now.setup || !measurementFresh(m, Date.now()) || m!.moving
          || !atTaskStart(m!.pose, destination, now.setup.positionTolerance, now.setup.rotationTolerance))
          throw new Error("최신 측정으로 시작점 도착을 확인하지 못했습니다.");
        setMessage(`${now.source === "mock" ? "모의 통신" : "최신 실측"}으로 시작점 도착을 확인했습니다.`);
      } else {
        if (session.getSnapshot().mode !== "virtual") throw new Error("실습 모드가 바뀌었습니다.");
        onVirtualMove(destination);
        setMessage("DT 시작 위치로 이동했습니다. 과제 실행·채점은 하지 않았습니다.");
      }
    } catch (error) {
      if (generation === epoch.current) setMessage(error instanceof Error ? error.message : "시작점 이동 실패");
    } finally {
      if (generation === epoch.current) {
        executing.current = false; locked.current = false; setPending(false);
      }
    }
  };
  return <section className="task-start-point" aria-label="과제 시작 위치" data-testid="task-start-point">
    <strong>과제 시작 위치</strong>
    <p data-testid="text-task-start-target">{target ? format(target) : axes.filter(k => start[k] !== undefined).map(k => `${k.toUpperCase()}=${start[k]}`).join(" / ")}
      <span> · MoveJ{Object.keys(start).length < 4 ? " · 지정하지 않은 축·방향은 현재값 유지" : ""}</span></p>
    <p data-testid="text-task-start-current">{hardware ? snap.source === "mock" ? "현재 모의 TCP" : "현재 실측 TCP" : "현재 DT TCP"}: {current ? format(current) : "미연결 · 확인 불가"}</p>
    {rangeNotes.length>0&&<div role="note" data-testid="task-start-range-notes">{rangeNotes.map((line,i)=><p key={i}>{line}</p>)}
      <p>경계는 자동 완화하지 않습니다. 이동 경로의 충돌·바닥·공구·배선 여유를 현장에서 확인해야 합니다.</p></div>}
    <button type="button" data-testid="button-task-start" onClick={move}
      disabled={pending || disabled || snap.busy || !!snap.measurement?.moving}>
      {pending ? "시작점 이동 확인·진행 중…" : "과제 시작점으로 이동"}
    </button>
    <p role="status" aria-live="polite" data-testid="text-task-start-status">
      {arrived ? `시작점 도착${hardware ? snap.source === "mock" ? " · 모의 통신, 실측 아님" : " · 최신 실측" : " · DT (수치 허용 0.1 mm / 0.1°)"}` : "시작점 미확인"}
      {block && <span> · 현재 차단 사유: {block}</span>}
      {message && <span> · 최근 요청: {message}</span>}
    </p>
  </section>;
}

export function moveVirtualTaskStart(props: {
  model: { ik: (x: number, y: number, z: number, r: number, hint: number) => unknown };
  joints: { j3: number }; onMoveTo: (x: number, y: number, z: number, r: number) => void; onMoveEnd: () => void;
}, target: LessonPose) {
  if (!props.model.ik(target.x, target.y, target.z, target.r, props.joints.j3))
    throw new Error("선택한 시작점은 현재 DT 모델에서 도달할 수 없습니다. 좌표를 임의로 바꾸지 않았습니다.");
  props.onMoveTo(target.x, target.y, target.z, target.r);
  props.onMoveEnd();
}
