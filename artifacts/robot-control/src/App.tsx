import { foundationMotion, foundationStartProblem, type FoundationMove } from "./foundationMotion";
import { usePaperScene } from "./paperSceneStore";
import { ProcessCellLesson } from "./ProcessCellLesson";
import { ProcessCellScene } from "./ProcessCellScene";
import type { CellVisual } from "./processCellTypes";
import { PROCESS_MODEL } from "./processKinematics";
import type { KinematicsVisual } from "./kinematicsLearning";
import type { MotionComparisonVisual } from "./motionComparison";
import type { ApplicationRecord } from "./coordinateApplication";
import type { TransferLearningRecord } from "./transferLearning";
import { useState, useCallback, useRef, useEffect, useLayoutEffect, useId } from "react";
import { RobotScene, CoordAxisOverlay, type LearningVisualState, type ViewPreset } from "./Robot3D";
import { HardwareSpeedControl } from "./HardwareSpeedControl";
import { BasicMath } from "./BasicMath";
import { RobotArm } from "./RobotArm";
import type { ShapePoseSnapshot } from "./shapeRun";
import { SHAPE_MODEL } from "./shapeKinematics";
import { CHAPTERS, COORDINATE_TOPICS, KINEMATICS_TOPICS, type Chapter, type CoordinateTopic, type KinematicsTopic } from "./curriculum";
import { LessonPanel, CoordinateLesson, KinematicsLesson } from "./LessonPages";
import { AxisLesson } from "./AxisLesson";
import type { AxisLessonVisual, AxisTaskRecord, AxisAttempt } from "./axisLesson";
import type { SupportRecord } from "./learningSupport";
import { AbsoluteRelativeLesson } from "./AbsoluteRelativeLesson";
import type { CoordinateAttempt, CoordinateVisual } from "./coordinateLearning";
import type { StrategyAttempt } from "./coordinateStrategies";
import { RobotBridge, type BridgeEvent, type BridgeState } from "./bridge";
import { PracticeProvider, usePractice, useVirtualLock } from "./PracticeProvider";
import { PracticeDock, sourceLabel } from "./PracticeControls";
import "./workspaceLayout.css";
import { measurementFresh } from "./practiceSession";
import { hardwareToSceneJoints, hardwareStep } from "./hardwareControls";
import { armJointJogDelta, JOG_INTERVAL_MS, rotationJogDelta } from "./jointJog";
import { createCoordinateEvidenceStore } from "./coordinateEvidence";
import { downloadEvidence } from "./learningEvidenceStorage";

type Mode = "Jog" | "Step";
type HardwareMotionMode = "MoveJ" | "MoveL";
type RobotPose = { x: number; y: number; z: number; r: number };
type HardwareMotionWaiter = {
  target: RobotPose;
  started: boolean;
  stableSamples: number;
  resolve: (pose: RobotPose) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};
type NavItem = Chapter;
type MathFocus = {
  active: true;
  startZ?: number;
  targetZ?: number;
  phase: "concept" | "predict" | "review";
  taskIndex: number;
  title: string;
  guideTitle?: string;
  guideBody?: string;
  weekLabel?: string;
};

const CORE_MATH_HINTS = [
  { title: "장면 관찰 · 시작", body: "로봇의 TCP와 Z축 방향을 먼저 찾아보세요." },
  { title: "장면 관찰 · 목표 방향", body: "TCP가 현재 높이에서 목표 높이로 올라가는 방향을 Z축에서 확인하세요." },
  { title: "장면 관찰 · 변화 축", body: "X·Y 방향은 유지되고 Z 방향만 변하는 상황인지 축과 로봇을 비교하세요." },
  { title: "장면 관찰 · 이동 경로", body: "수직으로 올린다면 TCP의 이동 경로가 Z축 방향의 직선이 되는지 생각해 보세요." },
  { title: "장면 관찰 · 예측 비교", body: "입력한 변화량과 목표 높이의 관계가 장면에서 본 이동과 맞는지 대조하세요." },
] as const;

const NAV_ITEMS = CHAPTERS;

// The header is intentionally outside the workspace. The menu drawer starts
// below it and owns the whole remaining viewport, including the bottom jog
// controls, so opening the menu never clips at the scene/control boundary.
const APP_HEADER_HEIGHT = 46;

const MODE_TIPS: Record<Mode, string> = { Jog: "연속 이동", Step: "한 칸씩 이동" };

function ModeToggle({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const [tip, setTip] = useState<Mode | null>(null);
  return (
    <div className="flex border border-[#111] rounded w-48 relative">
      {(["Jog", "Step"] as Mode[]).map((m, i) => (
        <div key={m} className="relative flex-1">
          <button
            onClick={() => setMode(m)}
            onMouseEnter={() => setTip(m)}
            onMouseLeave={() => setTip(null)}
            className={`w-full py-1 text-sm font-semibold transition-colors
              ${i === 0 ? "rounded-l" : "rounded-r border-l border-[#111]"}
              ${mode === m ? "bg-[#111] text-white" : "bg-white text-[#111] hover:bg-[#f0f0f0]"}`}>
            {m}
          </button>
          {tip === m && (
            <div style={{
              position: "absolute",
              bottom: "calc(100% + 6px)",
              left: "50%",
              transform: "translateX(-50%)",
              background: "#222",
              color: "#fff",
              fontSize: 12,
              fontWeight: 600,
              padding: "3px 10px",
              borderRadius: 6,
              whiteSpace: "nowrap",
              pointerEvents: "none",
              zIndex: 9999,
            }}>
              {MODE_TIPS[m]}
              <span style={{
                position: "absolute",
                top: "100%",
                left: "50%",
                transform: "translateX(-50%)",
                borderWidth: 5,
                borderStyle: "solid",
                borderColor: "#222 transparent transparent transparent",
              }}/>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function DashboardPanel({
  open,
  onClose,
  activeNav,
  onNavSelect,
  coordinateTopic,
  kinematicsTopic,
  onCoordinateSelect,
  onKinematicsSelect,
  onGoHome,
}: {
  open: boolean;
  onClose: () => void;
  activeNav: NavItem | null;
  onNavSelect: (item: NavItem) => void;
  coordinateTopic: CoordinateTopic;
  kinematicsTopic: KinematicsTopic;
  onCoordinateSelect: (topic: CoordinateTopic) => void;
  onKinematicsSelect: (topic: KinematicsTopic) => void;
  onGoHome: () => void;
}) {
  function topicList<T extends string>(
    topics: readonly { id:T; label:string }[],
    chapter: NavItem,
    chapterNumber: number,
    selected: T,
    onSelect: (topic:T) => void,
  ) {
    return <ul style={{ listStyle:"none", margin:0, padding:"2px 12px 12px 27px" }}>
      {topics.map((topic, index) => {
        const current = activeNav === chapter && selected === topic.id;
        return <li key={topic.id}>
          <button type="button" onClick={() => onSelect(topic.id)}
            aria-current={current ? "page" : undefined}
            style={{ display:"flex", gap:8, width:"100%", minWidth:0, padding:"9px 10px",
              textAlign:"left", border:"none", borderLeft:current ? "3px solid #a5b4fc" : "3px solid #3f3f46",
              background:current ? "#312e81" : "transparent", color:current ? "#fff" : "#cbd5e1",
              fontSize:13, fontWeight:current ? 750 : 500, lineHeight:1.5, cursor:"pointer" }}>
            <span style={{ flexShrink:0, color:current ? "#c7d2fe" : "#94a3b8" }}>{chapterNumber}-{index+1}</span>
            <span style={{ minWidth:0, overflowWrap:"anywhere" }}>{topic.label}</span>
          </button>
        </li>;
      })}
    </ul>;
  }

  return (
    <>
      {open && (
        <div
          className="fixed z-20"
          onMouseDown={onClose}
          style={{ top: APP_HEADER_HEIGHT, right: 0, bottom: 0, left: 0, background: "rgba(0,0,0,0.18)" }}
        />
      )}
      <div
        className="fixed left-0 z-30 flex flex-col"
        style={{
          top: APP_HEADER_HEIGHT, bottom: 0, height: "auto",
          width: 260, maxWidth: "85vw",
          background: "#1a1a1a",
          transform: open ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.25s cubic-bezier(.4,0,.2,1)",
          boxShadow: open ? "4px 0 24px rgba(0,0,0,0.35)" : "none",
        }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2e2e2e] shrink-0">
          <span className="text-white text-sm font-bold tracking-wide">학습 목차</span>
          <button
            onClick={onClose}
            className="text-[#888] hover:text-white transition-colors text-lg leading-none"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
        <nav className="flex flex-col py-2 flex-1 min-h-0 overflow-y-auto" aria-label="학습 목차">
          {/* Home / 제어 패널 */}
          <button
            onClick={onGoHome}
            className={`text-left px-5 py-3 text-sm font-medium transition-colors ${
              activeNav === null
                ? "bg-[#2e2e2e] text-white"
                : "text-[#aaa] hover:bg-[#242424] hover:text-white"
            }`}
          >
            <span className="text-[#ddd]">홈</span>
          </button>

          {/* divider */}
          <div className="mx-4 my-1 border-t border-[#2a2a2a]" />

          {NAV_ITEMS.map((item, i) => (
            <div key={item} className="shrink-0">
            <button
              onClick={() => onNavSelect(item)}
              aria-current={activeNav === item ? "page" : undefined}
              className={`text-left px-5 py-3 text-sm font-medium transition-colors w-full ${
                activeNav === item
                  ? "bg-[#2e2e2e] text-white"
                  : "text-[#aaa] hover:bg-[#242424] hover:text-white"
              }`}
            >
              <span className="mr-1 text-[#ddd] font-mono font-bold">{i + 1}.</span>
              <span className="text-[#ddd] leading-7">
                {item.includes(": ") ? (
                  <>{item.split(": ")[0]}:<br/><span style={{paddingLeft:20}}>{item.split(": ").slice(1).join(": ")}</span></>
                ) : item}
              </span>
            </button>
            {item === "좌표와 로봇 이동" && topicList(COORDINATE_TOPICS, item, i+1, coordinateTopic, onCoordinateSelect)}
            {item === "로봇 운동학" && topicList(KINEMATICS_TOPICS, item, i+1, kinematicsTopic, onKinematicsSelect)}
            </div>
          ))}
        </nav>
      </div>
    </>
  );
}

type ConnectStatus = "idle" | "connecting" | "connected" | "failed";

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const PORT_RE = /^\d{1,5}$/;

function validateInputs(ip: string, port: string): string {
  if (!ip.trim() || !port.trim()) return "IP 주소와 포트를 입력해 주세요.";
  if (!IP_RE.test(ip.trim())) return "올바른 IP 주소 형식이 아닙니다. (예: 192.168.1.6)";
  const portNum = Number(port.trim());
  if (!PORT_RE.test(port.trim()) || portNum < 1 || portNum > 65535)
    return "포트는 1–65535 범위의 숫자여야 합니다.";
  return "";
}

function ConnectDialog({
  open,
  onClose,
  onConnected,
  onDisconnect,
  onStatusChange,
  currentIp,
  currentPort,
  connectFn,
}: {
  open: boolean;
  onClose: () => void;
  onConnected: (ip: string, port: string) => void;
  onDisconnect: () => void;
  onStatusChange: (s: ConnectStatus) => void;
  currentIp?: string;
  currentPort?: string;
  connectFn: (ip: string, port: number) => Promise<void>;
}) {
  const [ip, setIp] = useState(currentIp ?? "127.0.0.1");
  const [port, setPort] = useState(currentPort ?? "8765");
  const [status, setStatus] = useState<ConnectStatus>("idle");
  const [errMsg, setErrMsg] = useState("");
  const idBase = useId();

  const isConnected = status === "connected";
  const isBusy = status === "connecting";

  const updateStatus = (s: ConnectStatus) => { setStatus(s); onStatusChange(s); };

  useEffect(() => {
    if (open) {
      // Reset local dialog state but do NOT call onStatusChange("idle") —
      // that would extinguish the button LED that was already lit.
      setStatus("idle");
      setErrMsg("");
      setIp(currentIp ?? "192.168.1.6");
      setPort(currentPort ?? "29999");
    }
  }, [open]);

  if (!open) return null;

  const handleConnect = async () => {
    const err = validateInputs(ip, port);
    if (err) { setErrMsg(err); return; }
    updateStatus("connecting");
    setErrMsg("");
    try {
      await connectFn(ip.trim(), Number(port.trim()));
      updateStatus("connected");
      onConnected(ip.trim(), port.trim());
    } catch (e) {
      const msg = e instanceof Error ? e.message : "연결 실패";
      setErrMsg(msg);
      updateStatus("failed");
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isBusy && !isConnected) handleConnect();
    if (e.key === "Escape") onClose();
  };

  const statusColor = status === "connected"
    ? "#7ee8a2"
    : status === "failed"
    ? "#ff6b6b"
    : "#7ee8a2";

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.50)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !isBusy) onClose(); }}
    >
      <div
        className="rounded-xl flex flex-col overflow-hidden"
        style={{
          width: 344,
          background: "#1c1c1e",
          boxShadow: "0 12px 48px rgba(0,0,0,0.60)",
          border: "1px solid rgba(255,255,255,0.10)",
        }}
        onKeyDown={handleKey}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2c2c2e]">
          <div className="flex items-center gap-2">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{
                background:
                  status === "connected" ? "#34c759"
                  : status === "failed" ? "#ff3b30"
                  : status === "connecting" ? "#ffd60a"
                  : "#555",
                boxShadow:
                  status === "connected" ? "0 0 6px #34c75988"
                  : status === "failed" ? "0 0 6px #ff3b3088"
                  : "none",
              }}
            />
            <span className="text-white font-semibold text-sm tracking-wide">실장비 연결</span>
          </div>
          <button
            onClick={onClose}
            disabled={isBusy}
            className="text-[#555] hover:text-white text-lg leading-none transition-colors"
            aria-label="닫기"
          >✕</button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 px-5 py-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idBase}-ip`} className="text-[#888] text-xs font-medium uppercase tracking-wider">IP 주소</label>
            <input
              id={`${idBase}-ip`}
              type="text"
              value={ip}
              onChange={e => { setIp(e.target.value); setErrMsg(""); }}
              placeholder="192.168.1.6"
              disabled={isBusy || isConnected}
              className="rounded-lg px-3 py-2.5 text-sm text-white font-mono outline-none transition-colors"
              style={{
                background: "#2c2c2e",
                border: errMsg && errMsg.includes("IP") ? "1px solid #ff453a" : "1px solid #3a3a3c",
                caretColor: "#7ee8a2",
                opacity: isBusy || isConnected ? 0.55 : 1,
              }}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idBase}-port`} className="text-[#888] text-xs font-medium uppercase tracking-wider">포트</label>
            <input
              id={`${idBase}-port`}
              type="text"
              value={port}
              onChange={e => { setPort(e.target.value); setErrMsg(""); }}
              placeholder="29999"
              disabled={isBusy || isConnected}
              className="rounded-lg px-3 py-2.5 text-sm text-white font-mono outline-none transition-colors"
              style={{
                background: "#2c2c2e",
                border: errMsg && errMsg.includes("포트") ? "1px solid #ff453a" : "1px solid #3a3a3c",
                caretColor: "#7ee8a2",
                opacity: isBusy || isConnected ? 0.55 : 1,
              }}
            />
          </div>

          {/* Status row */}
          {status === "connecting" && (
            <div className="flex items-center gap-2 text-xs" style={{ color: statusColor }}>
              <span className="inline-block w-3 h-3 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: `${statusColor} ${statusColor} transparent` }} />
              <span>{ip}:{port} 에 연결 중…</span>
            </div>
          )}
          {status === "connected" && (
            <div className="flex items-center gap-2 text-xs" style={{ color: statusColor }}>
              <span>✓</span>
              <span>{ip}:{port} 연결됨</span>
            </div>
          )}
          {status === "failed" && (
            <div className="flex items-center gap-2 text-xs text-[#ff6b6b]">
              <span>✕</span>
              <span>연결 실패 — 장치에 도달할 수 없습니다.</span>
            </div>
          )}
          {errMsg && status === "idle" && (
            <div className="text-xs text-[#ff6b6b]">{errMsg}</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 pb-5">
          {isConnected ? (
            <>
              <button
                onClick={() => { onDisconnect(); onClose(); }}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors"
                style={{ background: "#3a1a1a", color: "#ff6b6b", border: "1px solid #5a2222" }}
              >
                연결 해제
              </button>
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white"
                style={{ background: "#2a7a4a", border: "none" }}
              >
                확인
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={isBusy}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: "#2c2c2e",
                  color: isBusy ? "#555" : "#aaa",
                  border: "1px solid #3a3a3c",
                  cursor: isBusy ? "not-allowed" : "pointer",
                }}
              >
                취소
              </button>
              <button
                onClick={handleConnect}
                disabled={isBusy}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors"
                style={{
                  background: status === "failed" ? "#4a2020" : "#235c35",
                  color: isBusy ? "#888" : "#fff",
                  opacity: isBusy ? 0.7 : 1,
                  border: "none",
                  cursor: isBusy ? "not-allowed" : "pointer",
                }}
              >
                {isBusy ? "연결 중…" : status === "failed" ? "재시도" : "연결"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const STEP_VALUES = [0.5, 1, 5, 10];

interface Joints { j1: number; j2: number; j3: number; j4: number; }

function _UNUSED_RobotVisualization({ joints }: { joints: Joints }) {
  const L_BASE_H = 113, L1 = 175, L2 = 175, L_WRIST = 56;
  const { j1, j2, j3, j4 } = joints;

  // SVG canvas
  const W = 420, H = 240;
  const bx = W / 2 - 10;  // base center X
  const by = H - 40;       // base center Y (floor level)

  // ─── Forward Kinematics (side-view 2D) ───────────────────────
  // J2 pivot sits on top of the base column
  const j2px = bx;
  const j2py = by - L_BASE_H;

  // upper arm: J2 angle measured from vertical, positive = tilt forward (+X)
  const j2r = (j2 * Math.PI) / 180;
  const j3px = j2px + L1 * Math.sin(j2r);
  const j3py = j2py - L1 * Math.cos(j2r);

  // forearm: J3 angle cumulative (relative to upper arm direction)
  const forer = j2r + (j3 * Math.PI) / 180;
  const j4px = j3px + L2 * Math.sin(forer);
  const j4py = j3py - L2 * Math.cos(forer);

  // wrist / tool: J4 rotation
  const toolr = forer + (j4 * Math.PI) / 180;
  const tipx = j4px + L_WRIST * Math.sin(toolr);
  const tipy = j4py - L_WRIST * Math.cos(toolr);

  // ─── J1 base rotation: foreshorten X around base center ──────
  // cos(j1) squishes arm left-right to simulate rotation in top-down plane
  const j1r = (j1 * Math.PI) / 180;
  const cx1 = Math.cos(j1r);  // X scale factor (side projection of J1)

  function applyJ1(x: number, y: number): [number, number] {
    const dx = x - bx;
    return [bx + dx * cx1, y];
  }

  const [j2x, j2y] = applyJ1(j2px, j2py);
  const [j3x, j3y] = applyJ1(j3px, j3py);
  const [j4x, j4y] = applyJ1(j4px, j4py);
  const [tx, ty]   = applyJ1(tipx,  tipy);

  // arm width (tapers toward tip)
  const AW = 10, AW2 = 8, AW3 = 6;

  // perpendicular unit vector for arm tube
  function perpPts(ax: number, ay: number, bx2: number, by2: number, w: number) {
    const dx = bx2 - ax, dy = by2 - ay;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = (-dy / len) * w, ny = (dx / len) * w;
    return `${ax + nx},${ay + ny} ${bx2 + nx},${by2 + ny} ${bx2 - nx},${by2 - ny} ${ax - nx},${ay - ny}`;
  }

  // tool rectangle (aligned with toolr direction)
  const toolW = 14, toolH = 22;
  const tc = Math.cos(toolr + Math.PI / 2);
  const ts = Math.sin(toolr + Math.PI / 2);
  const toolPts = [
    [tx + tc * toolW / 2 - ts * toolH / 2, ty + ts * toolW / 2 + tc * toolH / 2],
    [tx - tc * toolW / 2 - ts * toolH / 2, ty - ts * toolW / 2 + tc * toolH / 2],
    [tx - tc * toolW / 2 + ts * toolH / 2, ty - ts * toolW / 2 - tc * toolH / 2],
    [tx + tc * toolW / 2 + ts * toolH / 2, ty + ts * toolW / 2 - tc * toolH / 2],
  ].map(p => p.join(",")).join(" ");

  // ─── Axis arrows at base ──────────────────────────────────────
  const axLen = 22;
  // X-axis: goes in direction of J1 rotation (cos j1 in horizontal)
  const axX = [bx + axLen * cx1, by];
  // Y-axis: depth (perpendicular, shrink to show depth)
  const axY = [bx - axLen * Math.sin(j1r) * 0.45, by - 10];
  // Z-axis: always up
  const axZ = [bx, by - axLen];

  return (
    <div
      className="relative w-full overflow-hidden border border-[#d4d4d4]"
      style={{ height: 240, background: "linear-gradient(180deg,#eaeaea 0%,#dedede 55%,#d4d4d4 100%)" }}
    >
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* Base — silver-aluminum */}
          <linearGradient id="gBase" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d0d4d8" />
            <stop offset="100%" stopColor="#a8acb0" />
          </linearGradient>
          <linearGradient id="gBaseSide" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#b0b4b8" />
            <stop offset="100%" stopColor="#909498" />
          </linearGradient>
          {/* Arm panels — pure white (like real robot) */}
          <linearGradient id="gArm" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f8f8f8" />
            <stop offset="50%" stopColor="#f0f0f0" />
            <stop offset="100%" stopColor="#e4e4e4" />
          </linearGradient>
          {/* Tool — silver-gray instead of blue */}
          <linearGradient id="gTool" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c4c8cc" />
            <stop offset="100%" stopColor="#909498" />
          </linearGradient>
          {/* Joints — deep charcoal-black */}
          <radialGradient id="gJoint" cx="38%" cy="32%" r="60%">
            <stop offset="0%" stopColor="#3a3a3a" />
            <stop offset="100%" stopColor="#111111" />
          </radialGradient>
          <filter id="armShadow">
            <feDropShadow dx="2" dy="3" stdDeviation="3" floodColor="#00000040" />
          </filter>
          <filter id="softShadow">
            <feDropShadow dx="1" dy="2" stdDeviation="2" floodColor="#00000028" />
          </filter>
        </defs>

        {/* ── Perspective grid ─────────────────────────────── */}
        {[0,1,2,3,4,5,6,7,8].map(i => {
          const y = 155 + i * 11;
          return <line key={`gh${i}`} x1={0} y1={y} x2={W} y2={y} stroke="#c4c4c4" strokeWidth="0.4" />;
        })}
        {[-7,-6,-5,-4,-3,-2,-1,0,1,2,3,4,5,6,7,8].map(i => {
          const bx2 = W / 2 + i * 26;
          return <line key={`gv${i}`} x1={W/2} y1={108} x2={bx2} y2={H} stroke="#c4c4c4" strokeWidth="0.4" />;
        })}

        {/* ── Floor shadow ─────────────────────────────────── */}
        <ellipse cx={bx} cy={by + 4} rx={44 * Math.abs(cx1) + 8} ry={9} fill="#00000018" />

        {/* ── BASE BOX ─────────────────────────────────────── */}
        {/* Side face — darker aluminum shadow side */}
        <polygon
          points={`${bx+38*cx1},${by-52} ${bx+52*cx1},${by-58} ${bx+52*cx1},${by} ${bx+38*cx1},${by}`}
          fill="url(#gBaseSide)" stroke="#909498" strokeWidth="0.5"
        />
        {/* Front face — lighter aluminum */}
        <polygon
          points={`${bx-38*cx1},${by-52} ${bx+38*cx1},${by-52} ${bx+38*cx1},${by} ${bx-38*cx1},${by}`}
          fill="url(#gBase)" stroke="#a8acb0" strokeWidth="0.5"
        />
        {/* Top face — brightest aluminum highlight */}
        <polygon
          points={`${bx-38*cx1},${by-52} ${bx+38*cx1},${by-52} ${bx+52*cx1},${by-58} ${bx-26*cx1},${by-58}`}
          fill="#d8dcdf" stroke="#b8bcc0" strokeWidth="0.5"
        />
        {/* Vent lines on front face */}
        {[0,1,2].map(i => (
          <line key={i}
            x1={bx - 30 * cx1} y1={by - 38 + i * 8}
            x2={bx + 30 * cx1} y2={by - 38 + i * 8}
            stroke="#9ea2a6" strokeWidth="0.5"
          />
        ))}
        {/* Logo circle */}
        <ellipse cx={bx} cy={by - 18} rx={6 * cx1 + 1} ry={6} fill="none" stroke="#909498" strokeWidth="0.8" />
        <ellipse cx={bx} cy={by - 18} rx={3 * cx1 + 0.5} ry={3} fill="#a8acb0" />

        {/* ── J1 ROTATION PLATE — charcoal black ───────────── */}
        <ellipse cx={bx} cy={by - 57} rx={26 * Math.abs(cx1) + 4} ry={8} fill="#1a1a1a" stroke="#080808" strokeWidth="0.7" />
        <ellipse cx={bx} cy={by - 58} rx={21 * Math.abs(cx1) + 3} ry={6.5} fill="#222222" />
        <ellipse cx={bx} cy={by - 58.5} rx={14 * Math.abs(cx1) + 2} ry={4.5} fill="#161616" />
        {/* Bolt holes on J1 plate */}
        {[0,60,120,180,240,300].map(a => {
          const ar = a * Math.PI / 180;
          return (
            <ellipse key={a}
              cx={bx + Math.cos(ar) * 19 * cx1}
              cy={by - 58 + Math.sin(ar) * 6.5}
              rx={1.5 * Math.abs(cx1) + 0.3} ry={1.5}
              fill="#0a0a0a"
            />
          );
        })}

        {/* ── ARM SEGMENTS — white panels with dark outline ─── */}
        <g filter="url(#armShadow)">
          {/* ── Upper arm (J2 → J3) ── */}
          <polygon points={perpPts(j2x, j2y, j3x, j3y, AW)} fill="url(#gArm)" stroke="#c0c0c0" strokeWidth="0.7" />
          {/* center ridge — subtle darker stripe for depth */}
          <polygon points={perpPts(j2x, j2y, j3x, j3y, AW * 0.18)} fill="#d0d0d0" opacity="0.7" />

          {/* ── Forearm (J3 → J4) ── */}
          <polygon points={perpPts(j3x, j3y, j4x, j4y, AW2)} fill="url(#gArm)" stroke="#c0c0c0" strokeWidth="0.7" />
          <polygon points={perpPts(j3x, j3y, j4x, j4y, AW2 * 0.18)} fill="#d0d0d0" opacity="0.7" />

          {/* ── Wrist (J4 → tip) ── */}
          <polygon points={perpPts(j4x, j4y, tx, ty, AW3)} fill="url(#gArm)" stroke="#c0c0c0" strokeWidth="0.5" />
        </g>

        {/* ── JOINT CIRCLES — deep black charcoal ─────────── */}
        {/* J2 joint (large bearing) */}
        <circle cx={j2x} cy={j2y} r={12} fill="url(#gJoint)" stroke="#080808" strokeWidth="0.8" />
        <circle cx={j2x} cy={j2y} r={8.5} fill="#1e1e1e" />
        <circle cx={j2x} cy={j2y} r={5.5} fill="#141414" />
        {[0,45,90,135,180,225,270,315].map(a => {
          const ar = a * Math.PI / 180;
          return <circle key={a} cx={j2x + Math.cos(ar)*10} cy={j2y + Math.sin(ar)*10} r={1.5} fill="#0a0a0a" />;
        })}

        {/* J3 joint (medium bearing) */}
        <circle cx={j3x} cy={j3y} r={9} fill="url(#gJoint)" stroke="#080808" strokeWidth="0.7" />
        <circle cx={j3x} cy={j3y} r={6.5} fill="#1e1e1e" />
        <circle cx={j3x} cy={j3y} r={3.5} fill="#141414" />

        {/* J4 wrist joint (small) */}
        <circle cx={j4x} cy={j4y} r={6.5} fill="url(#gJoint)" stroke="#080808" strokeWidth="0.6" />
        <circle cx={j4x} cy={j4y} r={4} fill="#1a1a1a" />

        {/* ── TOOL / END EFFECTOR — silver-gray housing ─────── */}
        <polygon points={toolPts} fill="url(#gTool)" stroke="#888c90" strokeWidth="0.7" filter="url(#softShadow)" />
        {/* center cap */}
        <circle cx={tx} cy={ty} r={5.5} fill="#909498" stroke="#70747a" strokeWidth="0.6" />
        <circle cx={tx} cy={ty} r={3.5} fill="#70747a" />
        <circle cx={tx} cy={ty} r={2} fill="#585c60" />
        <circle cx={tx - 1.2} cy={ty - 1.2} r={0.9} fill="#d0d4d8" opacity="0.80" />
        {/* Z-axis tool indicator — neutral gray dashed */}
        <line
          x1={j4x} y1={j4y}
          x2={j4x + (tx - j4x) * 0.6 - Math.cos(toolr) * 14}
          y2={j4y + (ty - j4y) * 0.6 - Math.sin(toolr) * 14}
          stroke="#888888" strokeWidth="1.2" strokeDasharray="2 2"
        />

        {/* ── BASE COORDINATE AXES ──────────────────────────── */}
        {/* X */}
        <line x1={bx} y1={by} x2={axX[0]} y2={axX[1]} stroke="#ef5350" strokeWidth="2" strokeLinecap="round" />
        <polygon
          points={`${axX[0]},${axX[1]-4} ${axX[0]+7},${axX[1]} ${axX[0]},${axX[1]+4}`}
          fill="#ef5350"
        />
        <text x={axX[0] + 9} y={axX[1] + 4} fontSize="13" fontWeight="bold" fill="#ef5350">X</text>

        {/* Y (depth) */}
        <line x1={bx} y1={by} x2={axY[0]} y2={axY[1]} stroke="#66bb6a" strokeWidth="2" strokeLinecap="round" />
        <polygon
          points={`${axY[0]-3},${axY[1]-1} ${axY[0]+3},${axY[1]-1} ${axY[0]},${axY[1]-7}`}
          fill="#66bb6a"
        />
        <text x={axY[0] - 6} y={axY[1] - 8} fontSize="13" fontWeight="bold" fill="#66bb6a">Y</text>

        {/* Z */}
        <line x1={bx} y1={by} x2={axZ[0]} y2={axZ[1]} stroke="#42a5f5" strokeWidth="2" strokeLinecap="round" />
        <polygon
          points={`${axZ[0]-4},${axZ[1]+4} ${axZ[0]+4},${axZ[1]+4} ${axZ[0]},${axZ[1]-2}`}
          fill="#42a5f5"
        />
        <text x={axZ[0] + 6} y={axZ[1]} fontSize="13" fontWeight="bold" fill="#42a5f5">Z</text>

        {/* origin dot */}
        <circle cx={bx} cy={by} r={2.5} fill="#fff" stroke="#888" strokeWidth="0.5" />

        {/* ── J angle labels (debug/info overlay) ─────────────── */}
        <text x={j2x + 14} y={j2y + 4} fontSize="12" fontWeight="700" fill="#1a4070">J2:{j2.toFixed(1)}°</text>
        <text x={j3x + 10} y={j3y + 4} fontSize="12" fontWeight="700" fill="#1a4070">J3:{j3.toFixed(1)}°</text>
        <text x={j4x + 8}  y={j4y - 6} fontSize="12" fontWeight="700" fill="#1a4070">J4:{j4.toFixed(1)}°</text>
      </svg>
    </div>
  );
}

type JogBtn = { label: string; onPress: () => void; onRelease: () => void };

/* ── PieSection: one interactive wedge of a circle ───────────── */
function PieSection({
  cx, cy, outerR, innerR, startAngle, endAngle, label, active, highlight,
  onMouseDown, onMouseUp, onMouseLeave, onTouchStart, onTouchEnd, onTouchCancel,
}: {
  cx: number; cy: number; outerR: number; innerR: number;
  startAngle: number; endAngle: number; label: string; active: boolean;
  highlight?: string;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseUp: () => void; onMouseLeave: () => void;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: () => void; onTouchCancel: () => void;
}) {
  const s = (startAngle * Math.PI) / 180;
  const e = (endAngle * Math.PI) / 180;
  const x1 = cx + outerR * Math.cos(s), y1 = cy + outerR * Math.sin(s);
  const x2 = cx + outerR * Math.cos(e), y2 = cy + outerR * Math.sin(e);
  const xi1 = cx + innerR * Math.cos(s), yi1 = cy + innerR * Math.sin(s);
  const xi2 = cx + innerR * Math.cos(e), yi2 = cy + innerR * Math.sin(e);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  const d = `M ${xi1} ${yi1} L ${x1} ${y1} A ${outerR} ${outerR} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${innerR} ${innerR} 0 ${large} 0 ${xi1} ${yi1} Z`;

  const mid = ((startAngle + endAngle) / 2) * (Math.PI / 180);
  const labelR = (outerR + innerR) / 2;
  const lx = cx + labelR * Math.cos(mid);
  const ly = cy + labelR * Math.sin(mid);

  return (
    <g
      onMouseDown={onMouseDown} onMouseUp={onMouseUp} onMouseLeave={onMouseLeave}
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onTouchCancel={onTouchCancel}
      style={{ cursor: "pointer", touchAction: "none" }}
    >
      <path
        d={d}
        fill={active ? (highlight ?? "#d8d8d8") : (highlight ? highlight + "33" : "#f4f4f4")}
        stroke={highlight ? highlight + "88" : "#e0e0e0"}
        strokeWidth="1.5"
        style={{ transition: "fill 0.08s" }}
      />
      <text
        x={lx} y={ly}
        textAnchor="middle" dominantBaseline="middle"
        fontSize="14" fontWeight="700"
        fill={active ? "#111111" : (highlight ? highlight : "#444444")}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {label}
      </text>
    </g>
  );
}

/* ── CrossPad: N/S/W/E pie-slice buttons ──────────────────────── */
function CrossPad({
  top, bottom, left, right, size = 144, topColor, bottomColor, leftColor, rightColor,
}: {
  top: JogBtn; bottom: JogBtn; left: JogBtn; right: JogBtn; size?: number;
  topColor?: string; bottomColor?: string; leftColor?: string; rightColor?: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const cx = size / 2, cy = size / 2;
  const outerR = size / 2 - 3;
  const innerR = outerR * 0.2;

  const press = (id: string, btn: JogBtn, e?: React.MouseEvent | React.TouchEvent) => {
    e?.preventDefault();
    setActive(id);
    btn.onPress();
  };
  const release = (btn: JogBtn) => { setActive(null); btn.onRelease(); };

  const wedges = [
    { id: "top",    btn: top,    start: 225, end: 315, color: topColor },
    { id: "right",  btn: right,  start: 315, end: 405, color: rightColor },
    { id: "bottom", btn: bottom, start: 45,  end: 135, color: bottomColor },
    { id: "left",   btn: left,   start: 135, end: 225, color: leftColor },
  ];

  return (
    <svg width={size} height={size} style={{ display: "block", touchAction: "none", filter: "drop-shadow(0 2px 6px #00000018)" }}>
      <circle cx={cx} cy={cy} r={outerR + 1} fill="#f0f0f0" />
      {wedges.map(({ id, btn, start, end, color }) => (
        <PieSection
          key={id}
          cx={cx} cy={cy} outerR={outerR} innerR={innerR}
          startAngle={start} endAngle={end}
          label={btn.label}
          active={active === id}
          highlight={color}
          onMouseDown={(e) => press(id, btn, e)}
          onMouseUp={() => release(btn)}
          onMouseLeave={() => release(btn)}
          onTouchStart={(e) => press(id, btn, e)}
          onTouchEnd={() => release(btn)}
          onTouchCancel={() => release(btn)}
        />
      ))}
      <circle cx={cx} cy={cy} r={innerR} fill="#e0e0e0" stroke="#cccccc" strokeWidth="1" />
      <circle cx={cx} cy={cy} r={innerR * 0.45} fill="#bbbbbb" />
    </svg>
  );
}

/* ── QuadPad: NW/NE/SW/SE pie-quadrant buttons ────────────────── */
function QuadPad({
  topLeft, topRight, bottomLeft, bottomRight, size = 144,
}: {
  topLeft: JogBtn; topRight: JogBtn; bottomLeft: JogBtn; bottomRight: JogBtn; size?: number;
}) {
  const [active, setActive] = useState<string | null>(null);
  const cx = size / 2, cy = size / 2;
  const outerR = size / 2 - 3;
  const innerR = outerR * 0.2;

  const press = (id: string, btn: JogBtn, e?: React.MouseEvent | React.TouchEvent) => {
    e?.preventDefault();
    setActive(id);
    btn.onPress();
  };
  const release = (btn: JogBtn) => { setActive(null); btn.onRelease(); };

  const wedges = [
    { id: "tl", btn: topLeft,     start: 180, end: 270 },
    { id: "tr", btn: topRight,    start: 270, end: 360 },
    { id: "bl", btn: bottomLeft,  start: 90,  end: 180 },
    { id: "br", btn: bottomRight, start: 0,   end: 90  },
  ];

  return (
    <svg width={size} height={size} style={{ display: "block", touchAction: "none", filter: "drop-shadow(0 2px 6px #00000018)" }}>
      <circle cx={cx} cy={cy} r={outerR + 1} fill="#f0f0f0" />
      {wedges.map(({ id, btn, start, end }) => (
        <PieSection
          key={id}
          cx={cx} cy={cy} outerR={outerR} innerR={innerR}
          startAngle={start} endAngle={end}
          label={btn.label}
          active={active === id}
          onMouseDown={(e) => press(id, btn, e)}
          onMouseUp={() => release(btn)}
          onMouseLeave={() => release(btn)}
          onTouchStart={(e) => press(id, btn, e)}
          onTouchEnd={() => release(btn)}
          onTouchCancel={() => release(btn)}
        />
      ))}
      <circle cx={cx} cy={cy} r={innerR} fill="#e0e0e0" stroke="#cccccc" strokeWidth="1" />
      <circle cx={cx} cy={cy} r={innerR * 0.45} fill="#bbbbbb" />
    </svg>
  );
}

function CoordRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="w-5 text-sm font-bold text-[#111]">{label}</span>
      <span className="w-20 text-sm text-[#000] font-mono font-semibold">{value}</span>
    </div>
  );
}

const ARM_L1 = 175, ARM_L2 = 175;

/* ── Coordinate display offset ──────────────────────────────────────────────
 * The home pose (j2=69.02°, j3=-113.32°) physically gives reach≈187.9mm, h≈41.2mm.
 * We define that pose as the display origin (350, 0, 0).
 * display = physical + COORD_O*  |  physical = display - COORD_O*
 * ──────────────────────────────────────────────────────────────────────── */
const COORD_OX =  162.124;   // 350 - 187.876
const COORD_OZ =  -41.202;   //   0 -  41.202  (home = previous display z=33, physical z=41.202mm)

const JOINT_LIMITS: Record<"j1"|"j2"|"j3"|"j4", [number, number]> = {
  j1: [-160, 160],
  j2: [-25,   85],
  j3: [-25,  105],
  j4: [-180, 180],
};
const clampJoint = (joint: "j1"|"j2"|"j3"|"j4", v: number) =>
  Math.max(JOINT_LIMITS[joint][0], Math.min(JOINT_LIMITS[joint][1], v));

function fkMG400(j1d: number, j2d: number, j3d: number) {
  const D = Math.PI / 180;
  const reach = ARM_L1 * Math.cos(j2d * D) + ARM_L2 * Math.cos((j2d + j3d) * D);
  const h     = ARM_L1 * Math.sin(j2d * D) + ARM_L2 * Math.sin((j2d + j3d) * D);
  return {
    x: parseFloat((reach * Math.cos(j1d * D)).toFixed(1)),
    y: parseFloat((reach * Math.sin(j1d * D)).toFixed(1)),
    z: parseFloat((h).toFixed(1)),
  };
}

/* hintJ3: current j3 value — IK picks the elbow config that keeps j3 sign the same */
function ikMG400(x: number, y: number, z: number, hintJ3 = -1) {
  const RD  = 180 / Math.PI;
  const j1  = Math.atan2(y, x) * RD;
  const r   = Math.sqrt(x * x + y * y);
  const h   = z;
  const d2  = r * r + h * h;
  const rawC3 = (d2 - ARM_L1 ** 2 - ARM_L2 ** 2) / (2 * ARM_L1 * ARM_L2);
  // Clamping an unreachable target made invalid coordinates look executable.
  // Reject it first; only absorb tiny floating-point error at the boundary.
  if (!Number.isFinite(rawC3) || rawC3 < -1 - 1e-9 || rawC3 > 1 + 1e-9) return null;
  const c3  = Math.max(-1, Math.min(1, rawC3));
  const mag = Math.sqrt(1 - c3 * c3);
  /* keep the elbow configuration consistent with hintJ3 sign */
  const s3  = hintJ3 >= 0 ? mag : -mag;
  const j3  = Math.atan2(s3, c3) * RD;
  const k1  = ARM_L1 + ARM_L2 * c3;
  const k2  = ARM_L2 * s3;
  const j2  = (Math.atan2(h, r) - Math.atan2(k2, k1)) * RD;
  return {
    j1: parseFloat(j1.toFixed(2)),
    j2: parseFloat(j2.toFixed(2)),
    j3: parseFloat(j3.toFixed(2)),
  };
}

/* ── EditableReadout ────────────────────────────────────────────────────── */
function EditableReadout({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: number) => boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const onCommitRef = useRef(onCommit);
  useEffect(() => { onCommitRef.current = onCommit; }, [onCommit]);

  function startEdit() {
    const raw = parseFloat(value.replace(/^\+/, ""));
    setDraft(isNaN(raw) ? "" : String(raw));
    setEditing(true);
    setError(false);
  }

  function commit() {
    const v = parseFloat(draft);
    if (isNaN(v)) { setError(true); return; }
    const ok = onCommitRef.current(v);
    if (!ok) { setError(true); setTimeout(() => setError(false), 600); return; }
    setEditing(false);
    setError(false);
  }

  function cancel() { setEditing(false); setError(false); }

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={draft}
        onChange={e => { setDraft(e.target.value); setError(false); }}
        onKeyDown={e => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") cancel();
        }}
        onBlur={commit}
        style={{
          width: 74, fontSize: 14, fontWeight: 650,
          border: `1.5px solid ${error ? "#ef4444" : "#3b82f6"}`,
          borderRadius: 4, padding: "0 4px", outline: "none",
          background: error ? "#fff5f5" : "#eff6ff",
          color: error ? "#ef4444" : "#1d4ed8",
          fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif",
          fontVariantNumeric: "tabular-nums", textAlign: "right",
        }}
      />
    );
  }

  return (
    <span
      className="num-mono"
      onClick={startEdit}
      title="클릭하여 값 직접 입력 (Enter 확정 / Esc 취소)"
      style={{
        fontSize: 14, fontWeight: 650, color: "#000",
        cursor: "text",
        borderBottom: "1px dashed #ccc",
        paddingBottom: 1,
      }}
    >
      {value}
    </span>
  );
}

export default function App() {
  return <PracticeProvider><AppInner/></PracticeProvider>;
}

function AppInner() {
  const practice = usePractice();
  const [practicePanelHost, setPracticePanelHost] = useState<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<Mode>("Jog");
  const [stepIndex, setStepIndex] = useState(1);
  const [coords, setCoords] = useState({ x: 350.0, y: 0.0, z: 0.0, r: 0.0 });
  const [joints, setJoints] = useState({ j1: 0.0, j2: 69.02, j3: -113.32, j4: 0.0 });
  const [displayJoints, setDisplayJoints] = useState({ j1: 0.0, j2: 41.29, j3: 34.27, j4: 0.0 });
  const [speed, setSpeed] = useState(50);
  const [isJogging, setIsJogging] = useState(false);
  const isJoggingRef = useRef(false);
  const [pressTimer, setPressTimer] = useState<ReturnType<typeof setInterval> | null>(null);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [activeNav, setActiveNav] = useState<NavItem | null>(null);
  const [mathFocus, setMathFocus] = useState<MathFocus | null>(null);
  const [mathCoach, setMathCoach] = useState<{ tone: "success" | "guide"; title: string; body: string; next: string } | null>(null);
  const [mathHintStep, setMathHintStep] = useState(0);
  const [suctionZoomOpen, setSuctionZoomOpen] = useState(false);
  useEffect(() => {
    if (activeNav !== "용어·기호와 기초수학") {
      setMathHintStep(0);
      setMathFocus(null);
      setMathCoach(null);
    }
  }, [activeNav]);
  const closeSuctionZoom = useCallback(() => setSuctionZoomOpen(false), []);
  useEffect(() => { if (activeNav !== null) setSuctionZoomOpen(false); }, [activeNav]);
  const [coordinateTopic, setCoordinateTopic] = useState<CoordinateTopic>("axes");
  const [kinematicsVisual, setKinematicsVisual] = useState<KinematicsVisual | null>(null);
  const [kinematicsTopic, setKinematicsTopic] = useState<KinematicsTopic>("fk");
  const [axisLessonVisual, setAxisLessonVisual] = useState<AxisLessonVisual | null>(null);
  const [coordinateEvidence] = useState(createCoordinateEvidenceStore);
  const [coordinateStorageFailed, setCoordinateStorageFailed] = useState(coordinateEvidence.failed);
  const [axisLessonRecords, setAxisLessonRecords] = useState<AxisTaskRecord[]>(coordinateEvidence.initial.axisRecords);
  const [axisAttemptHistory,setAxisAttemptHistory]=useState<Record<string,AxisAttempt[]>>(coordinateEvidence.initial.axisAttempts);
  const [learningSupportRecords,setLearningSupportRecords]=useState<SupportRecord[]>(coordinateEvidence.initial.supportRecords);
  const saveLearningSupport=(record:SupportRecord)=>setLearningSupportRecords(previous=>{
    const index=previous.findIndex(r=>r.id===record.id);
    return index<0?[...previous,record]:previous.map((r,i)=>i===index?record:r);
  });
  const isAxesLesson = activeNav === "좌표와 로봇 이동" && coordinateTopic === "axes";
  const isCoordinateLesson = activeNav === "좌표와 로봇 이동" && coordinateTopic === "coordinates";
  const isMotionLesson = activeNav === "좌표와 로봇 이동" && coordinateTopic === "motion";
  const [motionVisual, setMotionVisual] = useState<MotionComparisonVisual | null>(null);
  const [coordinateVisual, setCoordinateVisual] = useState<CoordinateVisual | null>(null);
  const [processVisual, setProcessVisual] = useState<CellVisual | null>(null);
  const [processSceneReady, setProcessSceneReady] = useState(false);
  const [coordinateAttempts, setCoordinateAttempts] = useState<CoordinateAttempt[]>(coordinateEvidence.initial.coordinateAttempts);
  const [coordinateApplicationRecords,setCoordinateApplicationRecords]=useState<ApplicationRecord[]>(coordinateEvidence.initial.applicationRecords);
  const [transferLearningRecords,setTransferLearningRecords]=useState<TransferLearningRecord[]>(coordinateEvidence.initial.transferRecords);
  const [coordinateStrategyAttempts, setCoordinateStrategyAttempts] = useState<StrategyAttempt[]>(coordinateEvidence.initial.strategyAttempts);
  useEffect(() => {
    const saved = coordinateEvidence.save({ id:"coordinate-lessons", version:1, savedAt:new Date().toISOString(),
      axisRecords:axisLessonRecords, axisAttempts:axisAttemptHistory, supportRecords:learningSupportRecords,
      coordinateAttempts, applicationRecords:coordinateApplicationRecords, transferRecords:transferLearningRecords,
      strategyAttempts:coordinateStrategyAttempts }, true);
    setCoordinateStorageFailed(!saved || coordinateEvidence.failed);
  }, [coordinateEvidence, axisLessonRecords, axisAttemptHistory, learningSupportRecords, coordinateAttempts,
    coordinateApplicationRecords, transferLearningRecords, coordinateStrategyAttempts]);
  const coordinateTopicIndex = COORDINATE_TOPICS.findIndex(topic => topic.id === coordinateTopic);
  const kinematicsTopicIndex = KINEMATICS_TOPICS.findIndex(topic => topic.id === kinematicsTopic);
  const isShapeLesson = activeNav === "좌표와 로봇 이동" && coordinateTopic === "shapes";
  const isKinematicsLesson = activeNav === "로봇 운동학";
  const paperScene=usePaperScene();
  const isPickLesson = activeNav === "운동학 종합과제: 픽앤플레이스";
  useVirtualLock(isPickLesson && !!(processVisual?.running || processVisual?.predictionPreview?.playing));
  const [viewPreset, setViewPreset] = useState<ViewPreset>("free");
  const [homeViewKey, setHomeViewKey] = useState(0);
  const [coordinateStudyViewKey, setCoordinateStudyViewKey] = useState(0);
  const [shapeStudyViewKey, setShapeStudyViewKey] = useState(0);
  const [kinematicsStudyViewKey, setKinematicsStudyViewKey] = useState(0);
  const restoreCoordinateStudyView = () => {
    setViewPreset("free"); setCoordinateStudyViewKey(key => key + 1);
  };
  const restoreShapeStudyView = () => {
    setViewPreset("free"); setShapeStudyViewKey(key => key + 1);
  };
  useEffect(() => {
    if (isAxesLesson || isCoordinateLesson) {
      setViewPreset("free"); setCoordinateStudyViewKey(key => key + 1);
    }
  }, [isAxesLesson, isCoordinateLesson]);
  useEffect(() => {
    if (isShapeLesson) {
      setViewPreset("free"); setShapeStudyViewKey(key => key + 1);
    }
  }, [isShapeLesson]);
  useEffect(() => {
    if (isKinematicsLesson) {
      setViewPreset("free"); setKinematicsStudyViewKey(key => key + 1);
    }
  }, [isKinematicsLesson]);

  const [jointGuideOpen, setJointGuideOpen] = useState(false);
  const [guideTab, setGuideTab] = useState<"j1"|"j2"|"j3"|"j4">("j1");
  const [coordGuideOpen, setCoordGuideOpen] = useState(false);
  const [coordTab, setCoordTab] = useState<"x"|"y"|"z"|"r">("x");
  const [homeIntroOpen, setHomeIntroOpen] = useState(() => {
    try { return localStorage.getItem("physical-ai-home-intro-seen-v1") !== "seen"; }
    catch { return true; }
  });
  const dismissHomeIntro = useCallback(() => {
    setHomeIntroOpen(false);
    try { localStorage.setItem("physical-ai-home-intro-seen-v1", "seen"); } catch { /* optional preference */ }
  }, []);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectedTo, setConnectedTo] = useState<{ ip: string; port: string } | null>(null);
  const [dialogStatus, setDialogStatus] = useState<ConnectStatus>("idle");

  const [robotEnabled, setRobotEnabled] = useState(false);
  const [robotHomed, setRobotHomed] = useState(false);
  const [enablingRobot, setEnablingRobot] = useState(false);
  const [robotMode, setRobotMode] = useState<number | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  /* ── WebSocket 브리지 ──────────────────────────────────────────── */
  const bridgeRef = useRef<RobotBridge | null>(null);
  const latestHardwarePoseRef = useRef<RobotPose | null>(null);
  const hardwareMotionWaiterRef = useRef<HardwareMotionWaiter | null>(null);

  const completeHardwareMotion = useCallback((pose: RobotPose) => {
    const waiter = hardwareMotionWaiterRef.current;
    if (!waiter) return;
    clearTimeout(waiter.timeout);
    hardwareMotionWaiterRef.current = null;
    waiter.resolve({ ...pose });
  }, []);

  const failHardwareMotion = useCallback((message: string) => {
    const waiter = hardwareMotionWaiterRef.current;
    if (!waiter) return;
    clearTimeout(waiter.timeout);
    hardwareMotionWaiterRef.current = null;
    waiter.reject(new Error(message));
  }, []);

  const handleBridgeEvent = useCallback((evt: BridgeEvent) => {
    if (evt.type === "state") {
      const s: BridgeState = evt.state;
      setRobotEnabled(s.enabled);
      setRobotHomed(s.homed);
      setRobotMode(s.estop || s.error ? 9 : s.moving ? 7 : s.enabled ? 5 : 4);
      if (s.error) setBridgeError(s.error);
      else if (!s.estop) setBridgeError(null);
      const waiter = hardwareMotionWaiterRef.current;
      if (waiter) {
        if (s.moving) waiter.started = true;
        else if (waiter.started && latestHardwarePoseRef.current) {
          completeHardwareMotion(latestHardwarePoseRef.current);
        }
      }
    } else if (evt.type === "telemetry") {
      /* 조그 중에는 텔레메트리 덮어쓰기 억제 */
      if (isJoggingRef.current) return;
      const { joints: j, pose } = evt;
      latestHardwarePoseRef.current = { ...pose };
      setDisplayJoints({ j1: j.j1, j2: j.j2, j3: j.j3, j4: j.j4 });
      setCoords({ x: pose.x, y: pose.y, z: pose.z, r: pose.r });
      /* 고정 offset으로 display joints → Three.js 내부 joints 변환
       * offset = joints - displayJoints 는 앱 전체에서 상수로 유지됨 (commitJoint/syncMoveEnd 모두 보장)
       * IK+힌트 방식은 좌표계 혼용으로 잘못된 해를 선택할 수 있어 폐기 */
      const j2Off = jointsRef.current.j2 - displayJointsRef.current.j2;
      const j3Off = jointsRef.current.j3 - displayJointsRef.current.j3;
      setJoints({ j1: j.j1, j2: j.j2 + j2Off, j3: j.j3 + j3Off, j4: j.j4 });

      const waiter = hardwareMotionWaiterRef.current;
      if (waiter) {
        const linearError = Math.hypot(
          pose.x - waiter.target.x,
          pose.y - waiter.target.y,
          pose.z - waiter.target.z,
        );
        const rotationError = Math.abs(pose.r - waiter.target.r);
        waiter.stableSamples = linearError <= 2.5 && rotationError <= 1
          ? waiter.stableSamples + 1
          : 0;
        if (waiter.stableSamples >= 3) completeHardwareMotion(pose);
      }
    } else if (evt.type === "error") {
      setBridgeError(`[${evt.code}] ${evt.message}`);
      failHardwareMotion(evt.message);
    } else if (evt.type === "pickResult" && !evt.ok) {
      setBridgeError(evt.message);
    }
  }, [completeHardwareMotion, failHardwareMotion]);

  /* bridge 인스턴스는 최초 1회 생성 */
  if (!bridgeRef.current) {
    bridgeRef.current = new RobotBridge(
      handleBridgeEvent,
      (status, reason) => {
        if (status === "disconnected" || status === "error") {
          setConnectedTo(null);
          setDialogStatus(status === "error" ? "failed" : "idle");
          setRobotEnabled(false);
          setRobotHomed(false);
          setRobotMode(null);
          failHardwareMotion(reason ?? "실장비 연결이 종료되었습니다.");
          if (reason) setBridgeError(reason);
        }
      },
    );
  }

  // The legacy direct bridge is retired: every actuating method is a no-op so
  // nothing can bypass PracticeSession (protocol v2, explicit confirmations).
  if (bridgeRef.current && !(bridgeRef.current as unknown as { __retired?: boolean }).__retired) {
    const legacy = bridgeRef.current as unknown as Record<string, unknown>;
    for (const name of ["enable", "disable", "home", "jog", "moveJoints", "moveCartesian", "suction", "pick", "estop", "reset", "connect"]) {
      legacy[name] = () => undefined;
    }
    legacy.__retired = true;
  }
  const bridgeConnect = useCallback(async (_ip: string, _port: number): Promise<void> => {
    throw new Error("이전 직접 연결은 사용하지 않습니다. 오른쪽 위 '안내·연결'에서 PC 브리지에 연결하세요.");
  }, []);

  const handleConnect = () => practice.setPanelOpen(true);
  const handleConnected = (ip: string, port: string) => setConnectedTo({ ip, port });
  const handleDisconnect = () => {
    bridgeRef.current?.close();
    setConnectedTo(null);
    setDialogStatus("idle");
    setRobotEnabled(false);
    setRobotHomed(false);
    setRobotMode(null);
    failHardwareMotion("실장비 연결이 종료되었습니다.");
    setBridgeError(null);
  };

  const handleReset = () => {
    setBridgeError(null);
    bridgeRef.current?.reset();
  };

  const handleEnableRobot = () => {
    if (!connectedTo || enablingRobot) return;
    setEnablingRobot(true);
    bridgeRef.current?.enable();
    /* state 이벤트로 enabled가 오면 setRobotEnabled(true) 됨 */
    setTimeout(() => setEnablingRobot(false), 1500);
  };

  const handleDisableRobot = () => {
    if (!connectedTo) return;
    bridgeRef.current?.disable();
  };

  const stepValue = STEP_VALUES[stepIndex];

  const isLive = !!connectedTo && robotEnabled;
  const isLiveRef = useRef(isLive);
  useEffect(() => { isLiveRef.current = isLive; });
  const jointsRef = useRef(joints);
  useEffect(() => { jointsRef.current = joints; }, [joints]);
  const liveJointsRef = useRef<{ j1:number; j2:number; j3:number; j4:number } | null>(null);
  const liveCoordsRef = useRef<{ x:number; y:number; z:number; r:number } | null>(null);
  const [traceKey, setTraceKey] = useState(0);
  const [missionResetKey, setMissionResetKey] = useState(0);
  const [learningVisual, setLearningVisual] = useState<LearningVisualState | null>(null);
  const [pickBlockState, setPickBlockState] = useState<{ gripActive: boolean; missionDone: boolean }>({ gripActive: false, missionDone: false });
  const coordsRef = useRef(coords);
  useEffect(() => { coordsRef.current = coords; }, [coords]);

  // External robot jogging updates numerical readouts, but never the 3D pose.
  // The twin accepts a measured pose only after a move initiated by this app.
  const completedContentMove = practice.journal[0];
  const lastContentMoveId = useRef<string | undefined>(undefined);
  const practiceReal = practice.hardware && practice.snap.connection === "connected";
  // Readout-only telemetry: do not feed scene state or virtual animation refs.
  const liveReadout = practiceReal && measurementFresh(practice.snap.measurement)
    ? practice.snap.measurement : null;
  const virtualView = useRef<null | { coords: typeof coords; joints: typeof joints; displayJoints: typeof displayJoints }>(null);
  const previousHardwareMode = useRef(false);
  useLayoutEffect(() => {
    if (practice.hardware && !previousHardwareMode.current) {
      lastContentMoveId.current = completedContentMove?.id;
      if (pressTimer) clearInterval(pressTimer);
      setPressTimer(null); isJoggingRef.current = false; setIsJogging(false);
      liveCoordsRef.current = null; liveJointsRef.current = null;
      virtualView.current = { coords: { ...coords }, joints: { ...joints }, displayJoints: { ...displayJoints } };
    } else if (!practice.hardware && previousHardwareMode.current && virtualView.current) {
      setCoords(virtualView.current.coords);
      setJoints(virtualView.current.joints);
      setDisplayJoints(virtualView.current.displayJoints);
      liveCoordsRef.current = null; liveJointsRef.current = null;
      virtualView.current = null;
    }
    previousHardwareMode.current = practice.hardware;
  }, [practice.hardware]);
  useEffect(() => {
    const entry = completedContentMove;
    if (!practiceReal || !entry || entry.id === lastContentMoveId.current) return;
    lastContentMoveId.current = entry.id;
    if (entry.operation.kind !== "move" && entry.operation.kind !== "jointStep") return;
    const m = entry.measurement;
    if (!measurementFresh(m)) return;
    setCoords({ x: m.pose.x, y: m.pose.y, z: m.pose.z, r: m.pose.r });
    setDisplayJoints({ ...m.joints });
    // Hardware angles use a different convention from the teaching model.
    // Never inherit a virtual HOME/calibration offset or stale animation pose.
    const sceneJoints = hardwareToSceneJoints(m.joints);
    liveJointsRef.current = null; liveCoordsRef.current = null;
    jointsRef.current = sceneJoints;
    coordsRef.current = { ...m.pose };
    setJoints(sceneJoints);
    setRobotMode(m.robotMode);
  }, [completedContentMove?.id, practiceReal]);

  /* 애니메이션 중 liveCoordsRef → coords 상태 실시간 반영 (20fps 폴링) */
  useEffect(() => {
    const id = setInterval(() => {
      const lc = liveCoordsRef.current;
      if (!lc) return;
      setCoords(prev => {
        if (prev.x === lc.x && prev.y === lc.y && prev.z === lc.z && prev.r === lc.r) return prev;
        return { x: lc.x, y: lc.y, z: lc.z, r: lc.r };
      });
    }, 50);
    return () => clearInterval(id);
  }, []);
  const [hwNotice, setHwNotice] = useState("");
  const prRef = useRef(practice); prRef.current = practice;
  useEffect(() => { if (!practice.hardware) setHwNotice(""); }, [practice.hardware]);
  // Topic changes inside a chapter also drop any pending confirmation and stop real runs.
  useEffect(() => () => {
    prRef.current.cancelConfirmation();
    if (prRef.current.hardware && prRef.current.session.getSnapshot().busy) prRef.current.session.stop();
  }, [coordinateTopic, kinematicsTopic]);
  const displayJointsRef = useRef(displayJoints);
  useEffect(() => { displayJointsRef.current = displayJoints; }, [displayJoints]);
  const speedRef = useRef(speed);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  const executeHardwareMove = useCallback((motion: HardwareMotionMode, target: RobotPose) => {
    return new Promise<RobotPose>((resolve, reject) => {
      // Retired: only PracticeSession (confirmed, protocol v2) may command hardware.
      const retired = true as boolean;
      if (retired) { reject(new Error("이전 실장비 이동 경로는 사용하지 않습니다. 안내·연결의 수동 조작 또는 각 학습의 확인 창을 사용하세요.")); return; }
      if (!isLiveRef.current || !bridgeRef.current?.isOpen) {
        reject(new Error("실장비가 연결·활성화되어 있지 않습니다."));
        return;
      }
      if (hardwareMotionWaiterRef.current) {
        reject(new Error("이전 실장비 동작이 아직 완료되지 않았습니다."));
        return;
      }

      const timeout = setTimeout(() => {
        if (!hardwareMotionWaiterRef.current) return;
        hardwareMotionWaiterRef.current = null;
        reject(new Error("목표점 도달 확인 시간이 초과되었습니다."));
      }, 30000);
      hardwareMotionWaiterRef.current = {
        target: { ...target }, started: false, stableSamples: 0,
        resolve, reject, timeout,
      };

      const commandSpeed = Math.max(5, Math.min(20, speedRef.current));
      if (motion === "MoveL") {
        bridgeRef.current!.moveCartesian(target, commandSpeed);
        return;
      }

      const currentInternal = jointsRef.current;
      const currentDisplay = displayJointsRef.current;
      const ik = ikMG400(
        target.x - COORD_OX,
        target.y,
        target.z - COORD_OZ,
        currentInternal.j3,
      );
      if (!ik) {
        failHardwareMotion("목표 좌표의 역기구학 해를 구할 수 없습니다.");
        return;
      }
      const j2Offset = currentInternal.j2 - currentDisplay.j2;
      const j3Offset = currentInternal.j3 - currentDisplay.j3;
      const physicalTarget = {
        j1: ik.j1,
        j2: ik.j2 - j2Offset,
        j3: ik.j3 - j3Offset,
        j4: target.r,
      };
      const valid = (Object.keys(JOINT_LIMITS) as Array<keyof typeof JOINT_LIMITS>)
        .every(joint => physicalTarget[joint] >= JOINT_LIMITS[joint][0]
          && physicalTarget[joint] <= JOINT_LIMITS[joint][1]);
      if (!valid) {
        failHardwareMotion("계산된 관절각이 안전 범위를 벗어났습니다.");
        return;
      }
      bridgeRef.current!.moveJoints(physicalTarget, commandSpeed);
    });
  }, [failHardwareMotion]);

  const stopHardwareMission = useCallback(() => {
    failHardwareMotion("사용자가 실장비 실행을 중지했습니다.");
    if (isLiveRef.current) bridgeRef.current?.estop();
  }, [failHardwareMotion]);

  const commitCoord = useCallback((key: "x"|"y"|"z"|"r") => (v: number): boolean => {
    if (prRef.current.hardware) {
      setHwNotice("TCP 버튼으로 한 칸 이동하거나 안내·연결에서 절대 좌표 이동을 실행하세요.");
      return false;
    }
    if (key === "r") {
      setJoints(p => ({ ...p, j4: v }));
      setDisplayJoints(p => ({ ...p, j4: v }));
      setCoords(p => ({ ...p, r: v }));
      return true;
    }
    const cur = coordsRef.current;
    const curJ = jointsRef.current;
    const newC = { ...cur, [key]: v };
    const ik = ikMG400(newC.x - COORD_OX, newC.y, newC.z - COORD_OZ, curJ.j3);
    if (!ik) return false;
    const dj1 = ik.j1 - curJ.j1, dj2 = ik.j2 - curJ.j2, dj3 = ik.j3 - curJ.j3;
    setJoints({ ...curJ, j1: ik.j1, j2: ik.j2, j3: ik.j3 });
    setDisplayJoints(pd => ({
      ...pd,
      j1: parseFloat((pd.j1 + dj1).toFixed(2)),
      j2: parseFloat((pd.j2 + dj2).toFixed(2)),
      j3: parseFloat((pd.j3 + dj3).toFixed(2)),
    }));
    setCoords(p => ({ ...p, [key]: v }));
    return true;
  }, []);

  const shapeKinematicsActive = isShapeLesson && !connectedTo;
  const moveTo = useCallback((x: number, y: number, z: number, r: number) => {
    const curJ = liveJointsRef.current ?? jointsRef.current;
    if (shapeKinematicsActive) {
      const ik = SHAPE_MODEL.ik(x, y, z, r, curJ.j3);
      if (!ik) return;
      liveJointsRef.current = ik;
      liveCoordsRef.current = SHAPE_MODEL.fk(ik);
      return;
    }
    const ik = ikMG400(x - COORD_OX, y, z - COORD_OZ, curJ.j3);
    if (!ik) return;
    liveJointsRef.current = { j1: ik.j1, j2: ik.j2, j3: ik.j3, j4: r };
    liveCoordsRef.current = { x, y, z, r };
  }, [shapeKinematicsActive]);

  const computeFK = useCallback((j: {j1:number;j2:number;j3:number;j4:number}) => {
    if (shapeKinematicsActive) return SHAPE_MODEL.fk(j);
    const fk = fkMG400(j.j1, j.j2, j.j3);
    return { x:fk.x+COORD_OX, y:fk.y, z:fk.z+COORD_OZ, r:j.j4 };
  }, [shapeKinematicsActive]);

  /* MoveJ 관절 공간 보간용 콜백들 */
  const getJoints = useCallback(() => liveJointsRef.current ?? jointsRef.current, []);

  const computeIK = useCallback((x: number, y: number, z: number, r: number, hintJ3: number) => {
    if (shapeKinematicsActive) return SHAPE_MODEL.ik(x, y, z, r, hintJ3);
    const ik = ikMG400(x - COORD_OX, y, z - COORD_OZ, hintJ3);
    if (!ik) return null;
    return { j1: ik.j1, j2: ik.j2, j3: ik.j3, j4: r };
  }, [shapeKinematicsActive]);

  const moveToJoints = useCallback((j: { j1:number; j2:number; j3:number; j4:number }) => {
    liveJointsRef.current = j;
    liveCoordsRef.current = computeFK(j);
  }, [computeFK]);

  const syncMoveEnd = useCallback(() => {
    const lj = liveJointsRef.current;
    liveJointsRef.current = null;
    if (!lj) return;
    const curJ = jointsRef.current;
    const dj1 = lj.j1 - curJ.j1, dj2 = lj.j2 - curJ.j2, dj3 = lj.j3 - curJ.j3;
    jointsRef.current = { ...lj };
    setJoints(lj);
    setDisplayJoints(pd => ({
      ...pd,
      j1: parseFloat((pd.j1 + dj1).toFixed(2)),
      j2: parseFloat((pd.j2 + dj2).toFixed(2)),
      j3: parseFloat((pd.j3 + dj3).toFixed(2)),
      j4: lj.j4,
    }));
    const pose = computeFK(lj);
    coordsRef.current = pose;
    setCoords(pose);
  }, [computeFK]);

  const finishLessonMove = useCallback(() => {
    syncMoveEnd();
    liveCoordsRef.current = null;
  }, [syncMoveEnd]);

  // Switching the learning coordinate model changes the readout, never the pose.
  // Hardware telemetry remains authoritative while a device is connected.
  const previousShapeModel = useRef(shapeKinematicsActive);
  useEffect(() => {
    if (previousShapeModel.current === shapeKinematicsActive) return;
    previousShapeModel.current = shapeKinematicsActive;
    if (connectedTo || prRef.current.hardware) return;
    const pose = computeFK(liveJointsRef.current ?? jointsRef.current);
    coordsRef.current = pose;
    liveCoordsRef.current = null;
    setCoords(pose);
  }, [shapeKinematicsActive, connectedTo, computeFK]);

  const captureShapePose = useCallback((): ShapePoseSnapshot => ({
    joints: { ...(liveJointsRef.current ?? jointsRef.current) },
    coords: { ...(liveCoordsRef.current ?? coordsRef.current) },
    displayJoints: { ...displayJointsRef.current },
  }), []);
  const restoreShapePose = useCallback((saved: ShapePoseSnapshot) => {
    if (connectedTo) return;
    liveJointsRef.current = null;
    liveCoordsRef.current = null;
    jointsRef.current = { ...saved.joints };
    coordsRef.current = { ...saved.coords };
    setJoints({ ...saved.joints });
    setCoords({ ...saved.coords });
    if (saved.displayJoints) {
      displayJointsRef.current = { ...saved.displayJoints };
      setDisplayJoints({ ...saved.displayJoints });
    }
  }, [connectedTo]);

  // A problem's stated starting height must match the DT on entry. Repeated
  // hint/phase changes must not reset a learner's ongoing exploration.
  const mathSetupTask = useRef<number | null>(null);
  const handleMathFocusChange = useCallback((focus: MathFocus | null) => {
    setMathFocus(focus);
    if (!focus) { mathSetupTask.current = null; return; }
    if (connectedTo || prRef.current.hardware || mathSetupTask.current === focus.taskIndex) return;
    if (focus.startZ === undefined) { mathSetupTask.current = focus.taskIndex; return; }
    const start = { ...coordsRef.current, z: focus.startZ };
    const ik = computeIK(start.x, start.y, start.z, start.r, jointsRef.current.j3)
      ?? computeIK(300, 0, start.z, start.r, jointsRef.current.j3);
    if (!ik) return;
    mathSetupTask.current = focus.taskIndex;
    moveToJoints(ik);
    finishLessonMove();
  }, [connectedTo, computeIK, moveToJoints, finishLessonMove]);

  const mathMoveGeneration = useRef(0);
  const cancelMathMove = useCallback(() => {
    mathMoveGeneration.current++;
    const pr = prRef.current;
    pr.cancelConfirmation();
    if (pr.hardware && pr.session.getSnapshot().busy) pr.session.stop();
  }, []);
  const handleMathCorrectMove = useCallback<FoundationMove>(async taskId => {
    const generation = ++mathMoveGeneration.current;
    const pr = prRef.current;
    const snap = pr.session.getSnapshot();
    const current = pr.hardware ? snap.measurement?.pose : coordsRef.current;
    const feedbackStartedAt = new Date().toISOString();
    if (pr.hardware) {
      const problem = pr.session.readiness();
      if (problem) throw new Error(problem);
    }
    if (!current) throw new Error("현재 TCP 위치를 확인할 수 없습니다.");
    const plan = foundationMotion(taskId, current);
    if (!plan) return null;
    if (pr.hardware) {
      const problem = foundationStartProblem(plan.start, current, snap.setup!.positionTolerance);
      if (problem) throw new Error(problem);
      const measurements = await pr.runOps([plan.operation], "기초수학 정답 확인 · 목표 위치 이동", undefined, () => {
        if (generation !== mathMoveGeneration.current) throw new Error("문항이 바뀌어 이동을 취소했습니다.");
        const latest = pr.session.getSnapshot();
        const startProblem = latest.measurement && foundationStartProblem(plan.start, latest.measurement.pose, latest.setup!.positionTolerance);
        if (startProblem) throw new Error(startProblem);
        // Absolute height moves preserve X/Y/R only if these did not change during confirmation.
        if (!plan.operation.relative && latest.measurement && ["x", "y", "z", "r"].some(axis =>
          Math.abs(latest.measurement!.pose[axis as keyof typeof current] - current[axis as keyof typeof current]) > 0.1))
          throw new Error("실행 확인 중 현재 위치가 바뀌었습니다. 정답 확인을 다시 눌러 목표를 갱신하세요.");
      });
      if (!measurements) return null;
      return { summary: snap.source === "mock" ? "정답입니다. 모의 통신으로 목표 위치 도달을 확인했습니다. 실측은 아닙니다."
        : "정답입니다. 실제 로봇의 목표 도달을 측정값으로 확인했습니다.", detail: {
          source: snap.source, measurements, before: snap.measurement,
          target: plan.operation.relative ? {
            x:current.x+plan.operation.target.x,y:current.y+plan.operation.target.y,
            z:current.z+plan.operation.target.z,r:current.r+plan.operation.target.r,
          } : plan.operation.target,
          coordinateSystem:{frame:"robot-user",user:snap.measurement?.user,tool:snap.measurement?.tool},
          units:{position:"mm",rotation:"degree"},startedAt:feedbackStartedAt,endedAt:new Date().toISOString(),
        } };
    }
    const start = { ...current, ...plan.start };
    const target = plan.operation.relative ? {
      x: start.x + plan.operation.target.x, y: start.y + plan.operation.target.y,
      z: start.z + plan.operation.target.z, r: start.r + plan.operation.target.r,
    } : plan.operation.target;
    // Validate the entire virtual straight-line path before changing the displayed pose.
    const frames = Array.from({ length: 61 }, (_, i) => {
      const t = i / 60;
      const pose = { x: start.x + (target.x - start.x) * t, y: start.y + (target.y - start.y) * t,
        z: start.z + (target.z - start.z) * t, r: start.r + (target.r - start.r) * t };
      const joint = computeIK(pose.x, pose.y, pose.z, pose.r, jointsRef.current.j3);
      if (!joint) throw new Error("목표까지의 직선 경로가 가상 로봇의 도달 범위를 벗어납니다.");
      return { pose, joint };
    });
    const unlock = pr.lockVirtual();
    try {
      const started = performance.now();
      await new Promise<void>((resolve, reject) => {
        const tick = () => {
          if (generation !== mathMoveGeneration.current) { reject(new Error("문항이 바뀌어 이동을 중단했습니다.")); return; }
          const index = Math.min(60, Math.floor((performance.now() - started) / 1200 * 60));
          moveToJoints(frames[index].joint);
          liveCoordsRef.current = frames[index].pose;
          if (index === 60) resolve(); else requestAnimationFrame(tick);
        };
        tick();
      });
      return { summary: "정답입니다. 가상 로봇이 목표 위치에 도달했습니다. 실제 장비를 함께 움직이려면 실제 로봇 모드에서 연결·준비 설정을 완료하세요.", detail: {
        source: "virtual", target, before:start, after:frames.at(-1)!.pose,
        coordinateSystem:"가상 학습 좌표계",units:{position:"mm",rotation:"degree"},
        startedAt:feedbackStartedAt,endedAt:new Date().toISOString(),measurement:false,
      } };
    } finally { finishLessonMove(); unlock(); }
  }, [computeIK, moveToJoints, finishLessonMove]);

  const commitJoint = useCallback((joint: "j1"|"j2"|"j3"|"j4") => (v: number): boolean => {
    if (prRef.current.hardware) return false;
    const [min, max] = JOINT_LIMITS[joint];
    // A directly entered value outside the supported range must be rejected.
    // Silently clamping the model while leaving the typed value on screen made
    // the readout and the 3D pose disagree, especially near linkage limits.
    if (!Number.isFinite(v) || v < min || v > max) return false;
    const cv = v;
    if (joint === "j4") {
      setJoints(p => ({ ...p, j4: cv }));
      setDisplayJoints(p => ({ ...p, j4: cv }));
      setCoords(p => ({ ...p, r: cv }));
      return true;
    }
    const curJ = jointsRef.current;
    const curDJ = displayJointsRef.current;
    const offset = curJ[joint] - curDJ[joint];
    const internalV = cv + offset;
    const newInternalJ = {
      j1: joint === "j1" ? internalV : curJ.j1,
      j2: joint === "j2" ? internalV : curJ.j2,
      j3: joint === "j3" ? internalV : curJ.j3,
    };
    const fk = fkMG400(newInternalJ.j1, newInternalJ.j2, newInternalJ.j3);
    if (isNaN(fk.x) || isNaN(fk.y) || isNaN(fk.z)) return false;
    setJoints(p => ({ ...p, ...newInternalJ }));
    setDisplayJoints(p => ({ ...p, [joint]: cv }));
    setCoords(p => ({ ...p, x: fk.x + COORD_OX, y: fk.y, z: fk.z + COORD_OZ }));
    return true;
  }, []);

  const jogInterval = useCallback(
    (axis: keyof typeof coords, dir: 1 | -1) => setInterval(() => {
      const s = speedRef.current / 100;
      if (axis === "r") {
        const delta = rotationJogDelta(speedRef.current, dir);
        if (isLiveRef.current) bridgeRef.current?.jog("j4", delta);
        setJoints(p => ({ ...p, j4: parseFloat((p.j4 + delta).toFixed(2)) }));
        setDisplayJoints(p => ({ ...p, j4: parseFloat((p.j4 + delta).toFixed(2)) }));
        setCoords(p => ({ ...p, r: parseFloat((p.r + delta).toFixed(2)) }));
        return;
      }
      if (isLiveRef.current) {
        /* Cartesian jog: 현재 좌표 + delta → moveCartesian */
        const cur = coordsRef.current;
        const tgt = { ...cur, [axis]: parseFloat((cur[axis] + dir * 1 * s).toFixed(2)) };
        bridgeRef.current?.moveCartesian(tgt, speedRef.current);
        setCoords(tgt);
      } else {
        const prevJ = jointsRef.current;
        const fk = fkMG400(prevJ.j1, prevJ.j2, prevJ.j3);
        const nf = { x: fk.x, y: fk.y, z: fk.z };
        (nf as Record<string, number>)[axis] += dir * 2 * s;
        const ik = ikMG400(nf.x, nf.y, nf.z, prevJ.j3);
        if (!ik) return;
        const dj1 = parseFloat((ik.j1 - prevJ.j1).toFixed(2));
        const dj2 = parseFloat((ik.j2 - prevJ.j2).toFixed(2));
        const dj3 = parseFloat((ik.j3 - prevJ.j3).toFixed(2));
        setJoints({ ...prevJ, j1: ik.j1, j2: ik.j2, j3: ik.j3 });
        setDisplayJoints(pd => ({
          ...pd,
          j1: parseFloat((pd.j1 + dj1).toFixed(2)),
          j2: parseFloat((pd.j2 + dj2).toFixed(2)),
          j3: parseFloat((pd.j3 + dj3).toFixed(2)),
        }));
        setCoords(pc => ({ ...pc, [axis]: parseFloat((pc[axis] + dir * 2 * s).toFixed(2)) }));
      }
    }, JOG_INTERVAL_MS),
    []
  );

  const jointInterval = useCallback(
    (joint: keyof typeof joints, dir: 1 | -1) => setInterval(() => {
      const k = joint as "j1"|"j2"|"j3"|"j4";
      // R and J4 describe the same physical wrist rotation. Keep those two
      // controls at one angular speed while preserving J1-J3's established rate.
      const raw = k === "j4"
        ? rotationJogDelta(speedRef.current, dir)
        : armJointJogDelta(speedRef.current, dir);
      const curDisplay = displayJointsRef.current[k];
      const newDisplay = parseFloat(clampJoint(k, curDisplay + raw).toFixed(2));
      const actualDelta = parseFloat((newDisplay - curDisplay).toFixed(2));
      if (actualDelta === 0) return;
      if (isLiveRef.current) bridgeRef.current?.jog(k, actualDelta);
      const curJ = jointsRef.current;
      const newInternalVal = parseFloat((curJ[k] + actualDelta).toFixed(2));
      const newJ = { ...curJ, [k]: newInternalVal };
      setJoints(newJ);
      setDisplayJoints(p => ({ ...p, [k]: newDisplay }));
      if (k === "j4") {
        setCoords(p => ({ ...p, r: newDisplay }));
      } else {
        const fk = fkMG400(newJ.j1, newJ.j2, newJ.j3);
        if (Number.isFinite(fk.x) && Number.isFinite(fk.y) && Number.isFinite(fk.z)) {
          setCoords(p => ({ ...p, x: fk.x + COORD_OX, y: fk.y, z: fk.z + COORD_OZ }));
        }
      }
    }, JOG_INTERVAL_MS),
    []
  );

  const hardwareStepPending = useRef(false);
  const startJog = (axis: keyof typeof coords, dir: 1 | -1) => {
    if (practice.hardware) {
      if (hardwareStepPending.current || practice.snap.busy) return;
      hardwareStepPending.current = true;
      setHwNotice("");
      void practice.runOps([hardwareStep(axis, dir, stepValue)],
        `TCP ${axis.toUpperCase()}${dir > 0 ? "+" : "−"} · ${stepValue}${axis === "r" ? "°" : " mm"} 한 칸 이동`)
        .catch(error => {
          setHwNotice(error instanceof Error ? error.message : String(error));
          practice.setPanelOpen(true);
        })
        .finally(() => { hardwareStepPending.current = false; });
      return;
    }
    dismissHomeIntro();
    if (pressTimer) clearInterval(pressTimer);
    if (mode === "Step") {
      if (isLive) {
        const tgt = { ...coordsRef.current, [axis]: parseFloat((coordsRef.current[axis] + dir * stepValue).toFixed(2)) };
        if (axis === "r") {
          bridgeRef.current?.jog("j4", dir * stepValue);
        } else {
          bridgeRef.current?.moveCartesian(tgt, speed);
        }
        setCoords(tgt);
        if (axis === "r") {
          setJoints(p => ({ ...p, j4: parseFloat((p.j4 + dir * stepValue).toFixed(2)) }));
          setDisplayJoints(p => ({ ...p, j4: parseFloat((p.j4 + dir * stepValue).toFixed(2)) }));
        }
      } else if (axis === "r") {
        const delta = dir * stepValue;
        setJoints(p => ({ ...p, j4: parseFloat((p.j4 + delta).toFixed(2)) }));
        setDisplayJoints(p => ({ ...p, j4: parseFloat((p.j4 + delta).toFixed(2)) }));
        setCoords(p => ({ ...p, r: parseFloat((p.r + delta).toFixed(2)) }));
      } else {
        const prevJ = jointsRef.current;
        const fk = fkMG400(prevJ.j1, prevJ.j2, prevJ.j3);
        const nf = { x: fk.x, y: fk.y, z: fk.z };
        (nf as Record<string, number>)[axis] += dir * stepValue;
        const ik = ikMG400(nf.x, nf.y, nf.z, prevJ.j3);
        if (!ik) return;
        const dj1 = parseFloat((ik.j1 - prevJ.j1).toFixed(2));
        const dj2 = parseFloat((ik.j2 - prevJ.j2).toFixed(2));
        const dj3 = parseFloat((ik.j3 - prevJ.j3).toFixed(2));
        setJoints({ ...prevJ, j1: ik.j1, j2: ik.j2, j3: ik.j3 });
        setDisplayJoints(pd => ({
          ...pd,
          j1: parseFloat((pd.j1 + dj1).toFixed(2)),
          j2: parseFloat((pd.j2 + dj2).toFixed(2)),
          j3: parseFloat((pd.j3 + dj3).toFixed(2)),
        }));
        setCoords(pc => ({ ...pc, [axis]: parseFloat((pc[axis] + dir * stepValue).toFixed(2)) }));
      }
      setPressTimer(null);
    } else {
      isJoggingRef.current = true;
      setIsJogging(true);
      setPressTimer(jogInterval(axis, dir));
    }
  };

  const startJoint = (joint: keyof typeof joints, dir: 1 | -1) => {
    if (practice.hardware) {
      if (hardwareStepPending.current || practice.snap.busy) return;
      hardwareStepPending.current = true;
      setHwNotice("");
      void practice.runOps([{ kind: "jointStep", joint, delta: dir * stepValue }],
        `${joint.toUpperCase()}${dir > 0 ? "+" : "−"} · ${stepValue}° 한 칸 이동`)
        .catch(error => {
          setHwNotice(error instanceof Error ? error.message : String(error));
          practice.setPanelOpen(true);
        })
        .finally(() => { hardwareStepPending.current = false; });
      return;
    }
    dismissHomeIntro();
    if (pressTimer) clearInterval(pressTimer);
    const k = joint as "j1"|"j2"|"j3"|"j4";
    if (mode === "Step") {
      const delta = dir * stepValue;
      const curDisplay = displayJointsRef.current[k];
      const newDisplay = parseFloat(clampJoint(k, curDisplay + delta).toFixed(2));
      const actualDelta = parseFloat((newDisplay - curDisplay).toFixed(2));
      if (actualDelta !== 0) {
        if (isLive) bridgeRef.current?.jog(k, actualDelta);
        const curJ = jointsRef.current;
        const newInternalVal = parseFloat((curJ[k] + actualDelta).toFixed(2));
        const newJ = { ...curJ, [k]: newInternalVal };
        setJoints(newJ);
        setDisplayJoints(p => ({ ...p, [k]: newDisplay }));
        if (k === "j4") {
          setCoords(p => ({ ...p, r: newDisplay }));
        } else {
          const fk = fkMG400(newJ.j1, newJ.j2, newJ.j3);
          if (Number.isFinite(fk.x) && Number.isFinite(fk.y) && Number.isFinite(fk.z)) {
            setCoords(p => ({ ...p, x: fk.x + COORD_OX, y: fk.y, z: fk.z + COORD_OZ }));
          }
        }
      }
      setPressTimer(null);
    } else {
      isJoggingRef.current = true;
      setIsJogging(true);
      setPressTimer(jointInterval(joint, dir));
    }
  };

  const stopJog = () => {
    if (pressTimer) { clearInterval(pressTimer); setPressTimer(null); }
    isJoggingRef.current = false;
    setIsJogging(false);
  };

  const handleInitialPose = () => {
    practice.cancelConfirmation();
    if (practice.hardware && practice.snap.busy) practice.session.stop();
    if (isShapeLesson) {
      setViewPreset("free"); setShapeStudyViewKey(key => key + 1);
    }
    // Stop any in-flight mission/jog before resetting the pose. Otherwise the
    // next animation frame writes its temporary coordinates back over HOME.
    stopJog();
    liveJointsRef.current = null;
    liveCoordsRef.current = null;
    setMissionResetKey(k => k + 1);
    setTraceKey(k => k + 1);
    setPickBlockState({ gripActive: false, missionDone: false });
    setBridgeError(null);

    // Restore the twin immediately as well as commanding the physical robot.
    // Keeping this outside the live-device branch prevents stale mission frames
    // or delayed telemetry from leaving the UI at the last executed waypoint.
    setCoords({ x:350.0, y:0.0, z:0.0, r:0.0 });
    setDisplayJoints({ j1:0.0, j2:41.29, j3:34.27, j4:0.0 });
    setJoints({ j1:0.0, j2:69.02, j3:-113.32, j4:0.0 });

    if (isLive) {
      // In physical-device mode telemetry owns the displayed pose; HOME makes
      // the actual MG400 return first and telemetry mirrors that motion here.
      failHardwareMotion("초기화 명령으로 진행 중인 동작을 취소했습니다.");
      latestHardwarePoseRef.current = null;
      setRobotHomed(false);
      bridgeRef.current?.home();
    }
  };

  /* pose/status 폴링 제거 — 브리지 telemetry/state 이벤트가 대신 처리 */

  const modeLed = (m: number | null): { color: string; glow: string; blink: boolean; label: string } => {
    if (m === 9)  return { color: "#ff3b30", glow: "0 0 6px 2px #ff3b3088", blink: false, label: "알람" };
    if (m === 5)  return { color: "#34c759", glow: "0 0 6px 2px #34c75988", blink: false, label: "활성화됨" };
    if (m === 7)  return { color: "#34c759", glow: "0 0 6px 2px #34c75988", blink: true,  label: "실행 중" };
    if (m === 11) return { color: "#34c759", glow: "0 0 6px 2px #34c75988", blink: true,  label: "Jog 중" };
    if (m === 4)  return { color: "#3b9eff", glow: "0 0 6px 2px #3b9eff88", blink: false, label: "비활성화" };
    if (m === 6)  return { color: "#3b9eff", glow: "0 0 6px 2px #3b9eff88", blink: true,  label: "핸드 티칭" };
    if (m === 1)  return { color: "#ffffff", glow: "0 0 6px 2px #ffffff66", blink: true,  label: "부팅 중" };
    return { color: "#555", glow: "none", blink: false, label: robotEnabled ? "활성화됨" : "활성화" };
  };

  const navigateChapter = (item: NavItem | null) => {
    if (item !== activeNav) {
      // Leaving a lesson during real execution requests a stop; no later callback continues it.
      practice.cancelConfirmation();
      if (practice.snap.busy && practice.hardware) practice.session.stop();
      mathSetupTask.current = null;
      stopJog();
      syncMoveEnd();
      liveCoordsRef.current = null;
      setTraceKey(k => k + 1);
      setLearningVisual(null);
      setCoordinateVisual(null);
      setProcessVisual(null);
      setProcessSceneReady(false);
      setMotionVisual(null);
      setPickBlockState({ gripActive:false, missionDone:false });
    }
    setActiveNav(item);
    if (item === null) {
      setViewPreset("free");
      setHomeViewKey(key => key + 1);
    }
    if (item !== "용어·기호와 기초수학") setMathFocus(null);
    setDashboardOpen(false);
    if (item !== "용어·기호와 기초수학") setShowAnnotations(false);
    if (item === "용어·기호와 기초수학") setViewPreset("free");
  };
  const changeCoordinateTopic = (topic: CoordinateTopic) => {
    if (topic === coordinateTopic) return;
    stopJog(); syncMoveEnd(); liveCoordsRef.current = null;
    setTraceKey(k => k + 1);
    setLearningVisual(null);
    setCoordinateTopic(topic);
  };
  const changeKinematicsTopic = (topic: KinematicsTopic) => {
    if (topic === kinematicsTopic) return;
    stopJog(); syncMoveEnd(); liveCoordsRef.current = null;
    setKinematicsTopic(topic);
  };
  const lessonProps = {
    coords, joints, model:{fk:computeFK, ik:computeIK},
    hardwareConnected:!!connectedTo, resetKey:missionResetKey,
    onMoveTo:moveTo, onMoveJoints:moveToJoints,
    onMoveEnd:finishLessonMove, onResetPose:handleInitialPose,
  };
  const missionPanelInner = (
        <RobotArm
          key={isPickLesson ? "pick" : "shapes"}
          activity={isPickLesson ? "pick" : "rect"}
          onNextKinematics={() => { setKinematicsTopic("fk"); navigateChapter("로봇 운동학"); }}
          embedded
          joints={joints}
          coords={coords}
          onJointStart={startJoint}
          onJogStop={stopJog}
          onMoveTo={moveTo}
          onMoveEnd={finishLessonMove}
          onCapturePose={captureShapePose}
          onRestorePose={restoreShapePose}
          onMissionStart={() => setTraceKey(k => k + 1)}
          onPickStateChange={setPickBlockState}
          onGetJoints={getJoints}
          onComputeIK={computeIK}
          onComputeFK={computeFK}
          onMoveJoints={moveToJoints}
          hardwareConnected={!!connectedTo}
          hardwareHomed={isLive && robotHomed}
          onHardwareMove={executeHardwareMove}
          onHardwareStop={stopHardwareMission}
          onResetPose={handleInitialPose}
          onLearningVisualChange={setLearningVisual}
          resetKey={missionResetKey}
        />

  );
  const missionPanel = missionPanelInner;
  const fmt = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2);
  const jb  = (label: string, fn: () => void): JogBtn => ({ label, onPress: fn, onRelease: stopJog });

  return (
    <div className="robot-app-shell h-screen flex flex-col bg-[#ebebeb] overflow-hidden">
      {/* ══ TOP HEADER BAR ══════════════════════════════════════════════ */}
      <div className="robot-app-header" style={{
        background:"#0B2D5C", height:46, display:"flex", alignItems:"center",
        justifyContent:"space-between", padding:"0 12px", flexShrink:0, zIndex:30, overflowX:"auto", gap:8,
      }}>
        {/* Left: title + controls */}
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span className="app-title" style={{
            color:"#fff", fontSize:19, fontWeight:700, letterSpacing:"-0.3px",
            fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
            whiteSpace:"nowrap", marginRight:2,
          }}>피지컬 AI기반 수학학습 콘텐츠</span>
          <button onClick={() => setDashboardOpen(open => !open)} style={{
            background:"rgba(255,255,255,0.08)", color:"#fff",
            border:"1px solid rgba(255,255,255,0.14)", borderRadius:5,
            padding:"4px 10px", fontSize:14, cursor:"pointer",
            display:"flex", alignItems:"center",
          }}>☰</button>
          <button onClick={handleInitialPose} style={{
            background:"#eab308", color:"#1a1000",
            border:"1px solid rgba(161,120,0,0.5)", borderRadius:5,
            padding:"4px 13px", fontSize:13, fontWeight:700, cursor:"pointer",
            fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
          }}>초기값</button>
          <PracticeDock panelContainer={practicePanelHost}/>
        </div>
        {/* Right: view preset buttons */}
        <div style={{ display:"flex", gap:6, flexShrink:0 }}>
          {(["top","side","front"] as const).map((p, i) => {
            const labels = ["탑뷰","사이드뷰","프론트뷰"];
            const active = viewPreset === p;
            return (
              <button key={p} onClick={() => setViewPreset(active ? "free" : p)} style={{
                background: active ? "rgba(0,180,220,0.90)" : "rgba(255,255,255,0.10)",
                color: active ? "#fff" : "#ccc",
                border: `1px solid ${active ? "#00bfdc" : "rgba(255,255,255,0.16)"}`,
                boxShadow: active ? "0 0 8px #00bfdc88" : "none",
                fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
                fontWeight:700, fontSize:13, letterSpacing:"0.2px",
                borderRadius:5, padding:"4px 13px", cursor:"pointer",
              }}>{labels[i]}</button>
            );
          })}
        </div>
      </div>

      {/* ── Main area: flex-col (normal) or flex-row (기초수학/로봇팔 side-by-side) ── */}
      <HardwareSpeedControl/>
      <div className={`workspace-layout ${practice.panelOpen ? "workspace-layout--settings" : ""}`}>
      <div className={`learning-workspace flex-1 min-h-0 flex ${activeNav ? "flex-row" : "flex-col"} ${activeNav ? "workspace-has-lesson" : ""} ${activeNav && activeNav !== "용어·기호와 기초수학" ? "curriculum-layout" : ""} ${isPickLesson ? "process-cell-layout" : ""}`}>

      {/* ── 3D Viewer ── */}
      <div className="min-h-0 min-w-0 relative curriculum-scene" style={{ flex: activeNav === "용어·기호와 기초수학" ? "0 0 60%" : "1 1 0%", height: "100%" }}>
        {isPickLesson ? <ProcessCellScene visual={processVisual} model={PROCESS_MODEL} onReadyChange={setProcessSceneReady} viewPreset={viewPreset} homeViewKey={homeViewKey} onViewFree={() => setViewPreset("free")}/> : <RobotScene suctionZoomOpen={activeNav === null && suctionZoomOpen} onSuctionZoomClose={closeSuctionZoom} joints={joints} liveJointsRef={liveJointsRef} liveCoordsRef={liveCoordsRef} coords={{ x: coords.x, y: coords.y, z: coords.z }} viewPreset={viewPreset} homeViewKey={homeViewKey} onViewFree={() => setViewPreset("free")} annotations={{ l1: showAnnotations && !isJogging && !mathFocus, l2: showAnnotations && !isJogging && !mathFocus, endEff: showAnnotations && !isJogging && !mathFocus, projection: (isJogging || showAnnotations) && !mathFocus }} highlightJoint={isKinematicsLesson ? kinematicsVisual?.joint : jointGuideOpen ? guideTab : null} highlightCoord={coordGuideOpen ? coordTab : null} axisLessonVisual={isAxesLesson ? axisLessonVisual : null} coordinateVisual={isCoordinateLesson ? coordinateVisual : null} motionVisual={isMotionLesson ? motionVisual : null} kinematicsVisual={isKinematicsLesson ? kinematicsVisual : null} kinematicsStudyViewKey={isKinematicsLesson ? kinematicsStudyViewKey : undefined} coordinateStudyViewKey={isAxesLesson || isCoordinateLesson ? coordinateStudyViewKey : undefined} shapeStudyViewKey={isShapeLesson ? shapeStudyViewKey : undefined} compactCoordinateHelp={isAxesLesson || isCoordinateLesson || coordGuideOpen} highlightLinks={activeNav === "용어·기호와 기초수학" && !mathFocus ? { l1: true, l2: true } : null} focusTcp={activeNav === "용어·기호와 기초수학" && mathFocus ? { startZ: mathFocus.startZ, targetZ: mathFocus.targetZ } : null} showFloorRect={isShapeLesson} traceKey={traceKey} learningVisual={isShapeLesson ? learningVisual : null} endEffector={isShapeLesson ? "pen" : "suction"} pickBlockState={undefined}/>}
        {activeNav === "용어·기호와 기초수학" && mathCoach && (
          <div role="status" aria-live="polite" style={{
            position:"absolute",
            top:16,
            right:"clamp(16px, 7%, 96px)",
            zIndex:35,
            width:"min(360px, calc(100% - 32px))",
            padding:"14px 16px 13px",
            border:`1px solid ${mathCoach.tone === "success" ? "#86efac" : "#bfdbfe"}`,
            borderLeft:`5px solid ${mathCoach.tone === "success" ? "#16a34a" : "#60a5fa"}`,
            borderRadius:12,
            background:mathCoach.tone === "success" ? "rgba(240,253,244,.96)" : "rgba(248,250,255,.97)",
            boxShadow:"0 10px 28px rgba(15,23,42,.18)",
            fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
            pointerEvents:"auto",
          }}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:8}}>
              <strong style={{fontSize:13,color:mathCoach.tone === "success" ? "#15803d" : "#3730a3"}}>수학 코치 · 즉시 피드백</strong>
              <button type="button" onClick={()=>setMathCoach(null)} aria-label="피드백 닫기"
                style={{border:0,background:"transparent",color:"#64748b",fontWeight:800,cursor:"pointer",padding:0}}>닫기</button>
            </div>
            <b style={{display:"block",fontSize:17,color:"#172554",marginBottom:6}}>{mathCoach.title}</b>
            <p style={{margin:"0 0 7px",fontSize:14,lineHeight:1.5,color:"#334155"}}>{mathCoach.body}</p>
            <small style={{display:"block",fontSize:12,lineHeight:1.4,color:"#64748b"}}>{mathCoach.next}</small>
          </div>
        )}
        {practice.hardware && <div className="pr-hud" role="status" data-testid="hud-source">
          {practice.snap.measurement && practice.snap.connection === "connected"
            ? <>{sourceLabel(practice.snap.measurement.source)} · 콘텐츠 → 실장비 제어 · 외부 조그 따라가기 꺼짐 · 화면 자세는 콘텐츠 이동 완료 시 갱신됩니다. 현재 실측은 안내·연결에서 확인하세요</>
            : <>측정 없음 · 이 화면의 로봇은 가상 DT 초기 자세(실측 아님)</>}
          {hwNotice && <div>{hwNotice}</div>}
        </div>}
        {(isAxesLesson || isCoordinateLesson || isShapeLesson) && !paperScene.data && <button type="button"
          onClick={isShapeLesson ? restoreShapeStudyView : restoreCoordinateStudyView}
          title={isShapeLesson ? "P1·P2와 전체 경로를 보는 시점으로 돌아가기 · 드래그로 자유 회전"
            : `${isAxesLesson ? "2-1" : "2-2"} 사선 상단 시점으로 돌아가기 · 드래그로 자유 회전`}
          style={{position:"absolute",top:12,right:12,zIndex:10,padding:"8px 12px",borderRadius:6,
            border:"1px solid #c7d2fe",background:"rgba(255,255,255,.94)",color:"#4338ca",fontWeight:800,cursor:"pointer"}}>
          ↺ {isShapeLesson ? "경로 시점" : "학습 시점"}
        </button>}
        {/* ── 관절 안내 / 좌표 안내 버튼 ── */}
        {activeNav === null && <div className="absolute left-3 z-20" style={{ top: "0.75rem" }}>
          <div style={{ display:"flex", gap:6 }}>
            <button
              type="button" aria-pressed={jointGuideOpen}
              onClick={() => { setJointGuideOpen(v => !v); setCoordGuideOpen(false); setHomeIntroOpen(false); }}
              style={{
                background: jointGuideOpen ? "rgba(30,30,30,0.92)" : "rgba(255,255,255,0.82)",
                color: jointGuideOpen ? "#fff" : "#222",
                border: `1px solid ${jointGuideOpen ? "#555" : "rgba(0,0,0,0.18)"}`,
                backdropFilter:"blur(8px)",
                borderRadius:6, padding:"6px 14px",
                fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
                fontWeight:700, fontSize:13, cursor:"pointer",
                boxShadow: jointGuideOpen ? "0 2px 12px rgba(0,0,0,0.28)" : "0 1px 4px rgba(0,0,0,0.12)",
              }}
            >관절 안내</button>
            <button
              type="button" aria-pressed={coordGuideOpen}
              onClick={() => { setCoordGuideOpen(v => !v); setJointGuideOpen(false); setHomeIntroOpen(false); }}
              style={{
                background: coordGuideOpen ? "rgba(30,30,30,0.92)" : "rgba(255,255,255,0.82)",
                color: coordGuideOpen ? "#fff" : "#222",
                border: `1px solid ${coordGuideOpen ? "#555" : "rgba(0,0,0,0.18)"}`,
                backdropFilter:"blur(8px)",
                borderRadius:6, padding:"6px 14px",
                fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
                fontWeight:700, fontSize:13, cursor:"pointer",
                boxShadow: coordGuideOpen ? "0 2px 12px rgba(0,0,0,0.28)" : "0 1px 4px rgba(0,0,0,0.12)",
              }}
            >좌표 안내</button>
            <button
              type="button" aria-pressed={homeIntroOpen}
              onClick={() => { setHomeIntroOpen(v => !v); setJointGuideOpen(false); setCoordGuideOpen(false); }}
              style={{
                background: homeIntroOpen ? "rgba(30,64,175,0.92)" : "rgba(255,255,255,0.82)",
                color: homeIntroOpen ? "#fff" : "#334155",
                border:`1px solid ${homeIntroOpen ? "#1e40af" : "rgba(0,0,0,0.18)"}`,
                backdropFilter:"blur(8px)", borderRadius:6, padding:"6px 10px",
                fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
                fontWeight:700, fontSize:12, cursor:"pointer",
                boxShadow:homeIntroOpen ? "0 2px 12px rgba(30,64,175,0.24)" : "0 1px 4px rgba(0,0,0,0.12)",
              }}
            >처음 사용 안내</button>
          </div>

          {homeIntroOpen && !jointGuideOpen && !coordGuideOpen && (
            <div aria-label="관절과 좌표 안내 시작" style={{
              marginTop:8, width:288, boxSizing:"border-box", padding:"12px 14px",
              background:"rgba(255,255,255,0.94)", backdropFilter:"blur(10px)",
              border:"1px solid rgba(30,64,175,0.18)", borderRadius:8,
              boxShadow:"0 5px 18px rgba(15,23,42,0.14)",
              fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
            }}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:8}}>
                <div style={{fontSize:13,fontWeight:850,color:"#0f172a"}}>관절과 좌표, 먼저 구분해 보세요</div>
                <button type="button" onClick={dismissHomeIntro} aria-label="처음 사용 안내 닫기"
                  style={{border:0,background:"transparent",color:"#64748b",fontSize:16,lineHeight:1,cursor:"pointer",padding:2}}>×</button>
              </div>
              <div style={{display:"grid",gap:6,fontSize:12,lineHeight:1.45,color:"#334155"}}>
                <div><b style={{color:"#7c3aed"}}>관절 J1–J4</b> · 각 관절의 각도를 바꿉니다.</div>
                <div><b style={{color:"#0369a1"}}>좌표 X·Y·Z·R</b> · TCP의 위치와 자세를 바꿉니다.</div>
              </div>
              <div style={{marginTop:9,paddingTop:8,borderTop:"1px solid #e2e8f0",fontSize:11,fontWeight:750,color:"#64748b"}}>
                ① 안내 선택　② 같은 색 ± 버튼으로 관찰　③ 안내를 닫고 직접 조작
              </div>
            </div>
          )}

          {/* ── 관절 안내 패널 ── */}
          {jointGuideOpen && (() => {
            const JOINT_INFO: Record<"j1"|"j2"|"j3"|"j4", { color: string; name: string; axis: string; range: string; desc: string; role: string }> = {
              j1: { color:"#f59e0b", name:"J1 — 베이스 회전", axis:"수직축 기준 회전", range:"−160° ~ +160°", desc:"로봇의 베이스가 수직축을 기준으로 좌우 회전합니다. 위에서 보면 로봇팔의 방향이 시계/반시계 방향으로 바뀌는 관절입니다.", role:"로봇팔 방향 결정" },
              j2: { color:"#3b82f6", name:"J2 — 어깨 관절", axis:"수평축 기준 회전", range:"−25° ~ +85°", desc:"로봇팔을 들어 올리거나 내리는 관절입니다. J2를 조절하면 팔 전체의 높이와 자세가 바뀝니다.", role:"팔 높이 조절" },
              j3: { color:"#22c55e", name:"J3 — 팔꿈치 관절", axis:"수평축 기준 회전", range:"−25° ~ +105°", desc:"사람의 팔꿈치처럼 앞쪽 팔(아래팔)이 접히고 펴지는 관절입니다. J3를 조절하면 공구 쪽 팔의 각도와 자세가 바뀝니다.", role:"전완 각도 조절" },
              j4: { color:"#ec4899", name:"J4 — 손목 회전", axis:"말단부 축 기준 회전", range:"−180° ~ +180°", desc:"J4는 엔드이펙터의 방향을 회전시키는 관절입니다. 흡착컵이나 그리퍼의 방향을 맞출 때 사용합니다.", role:"공구 방향 조절" },
            };
            const info = JOINT_INFO[guideTab];
            return (
              <div style={{
                marginTop:8, width:288,
                background:"rgba(18,18,20,0.96)", backdropFilter:"blur(12px)",
                border:"1px solid rgba(255,255,255,0.10)", borderRadius:6,
                boxShadow:"0 8px 32px rgba(0,0,0,0.45)",
                fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
                overflow:"hidden",
              }}>
                {/* 탭 버튼 */}
                <div style={{ display:"flex", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
                  {(["j1","j2","j3","j4"] as const).map(k => {
                    const c = JOINT_INFO[k].color;
                    const active = guideTab === k;
                    return (
                      <button key={k}
                        onClick={() => setGuideTab(k)}
                        style={{
                          flex:1, padding:"9px 0",
                          background: active ? "rgba(255,255,255,0.07)" : "transparent",
                          color: active ? c : "#666",
                          border:"none", cursor:"pointer",
                          fontWeight:800, fontSize:14,
                          borderBottom: active ? `2px solid ${c}` : "2px solid transparent",
                          transition:"all 0.15s",
                          letterSpacing:"0.5px",
                        }}>
                        {k.toUpperCase()}
                      </button>
                    );
                  })}
                </div>
                {/* 내용 */}
                <div style={{ padding:"18px 20px 20px" }}>
                  {/* 제목 */}
                  <div style={{ color: info.color, fontWeight:800, fontSize:17, marginBottom:10, letterSpacing:"-0.3px" }}>
                    {info.name}
                  </div>
                  {/* 속성 인덱스 */}
                  <ul style={{ margin:"0 0 14px 0", padding:0, listStyle:"none", display:"flex", flexDirection:"column", gap:5 }}>
                    {[info.axis, `범위 ${info.range}`, info.role].map((item, i) => (
                      <li key={i} style={{ display:"flex", alignItems:"center", gap:7 }}>
                        <span style={{ width:4, height:4, borderRadius:"50%", background: info.color, flexShrink:0, opacity:0.85 }}/>
                        <span style={{ color:"#aaa", fontSize:14, fontWeight:600 }}>{item}</span>
                      </li>
                    ))}
                  </ul>
                  {/* 설명 */}
                  <p style={{ color:"#e0e0e0", fontSize:14, fontWeight:500, lineHeight:1.6, margin:0 }}>
                    {info.desc}
                  </p>
                  <div style={{marginTop:13,paddingTop:10,borderTop:"1px solid rgba(255,255,255,0.10)",color:info.color,fontSize:12,fontWeight:750}}>
                    아래에서 같은 색 J± 버튼을 누르며 변화를 관찰하세요.
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── 좌표 안내 패널 ── */}
          {coordGuideOpen && (() => {
            const COORD_INFO: Record<"x"|"y"|"z"|"r", { color: string; name: string; direction: string; unit: string; desc: string; tip: string }> = {
              x: { color:"#0284c7", name:"X — 전후 이동", direction:"로봇 전방 기준 앞(+) / 뒤(−)", unit:"mm", desc:"X축은 로봇 베이스를 기준으로 전방/후방 방향입니다. X+를 누르면 TCP가 앞으로, X−를 누르면 뒤로 이동합니다.", tip:"작업 대상이 로봇 정면에 있을 때 주로 사용합니다." },
              y: { color:"#7c3aed", name:"Y — 좌우 이동", direction:"로봇 기준 왼쪽(+) / 오른쪽(−)", unit:"mm", desc:"Y축은 로봇 베이스를 기준으로 좌우 방향입니다. Y+를 누르면 TCP가 왼쪽으로, Y−를 누르면 오른쪽으로 이동합니다.", tip:"컨베이어 폭 방향 정렬 등에 활용합니다." },
              z: { color:"#059669", name:"Z — 상하 이동", direction:"위(+) / 아래(−)", unit:"mm", desc:"Z축은 수직 방향입니다. Z+를 누르면 TCP가 위로 올라가고, Z−를 누르면 아래로 내려갑니다.", tip:"부품을 집거나 내려놓을 때 높이 조절에 사용합니다." },
              r: { color:"#1e3a8a", name:"R — 자세 회전", direction:"반시계(+) / 시계(−)", unit:"°", desc:"R은 TCP의 자세(orientation) 회전입니다. J4와 연동되며 엔드이펙터가 현재 위치에서 회전합니다.", tip:"공구 방향을 맞출 때 미세 조정에 사용합니다." },
            };
            const info = COORD_INFO[coordTab];
            return (
              <div style={{
                marginTop:8, width:288,
                background:"rgba(18,18,20,0.96)", backdropFilter:"blur(12px)",
                border:"1px solid rgba(255,255,255,0.10)", borderRadius:6,
                boxShadow:"0 8px 32px rgba(0,0,0,0.45)",
                fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
                overflow:"hidden",
              }}>
                {/* 탭 버튼 */}
                <div style={{ display:"flex", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
                  {(["x","y","z","r"] as const).map(k => {
                    const c = COORD_INFO[k].color;
                    const active = coordTab === k;
                    return (
                      <button key={k}
                        onClick={() => setCoordTab(k)}
                        style={{
                          flex:1, padding:"9px 0",
                          background: active ? "rgba(255,255,255,0.07)" : "transparent",
                          color: active ? c : "#666",
                          border:"none", cursor:"pointer",
                          fontWeight:800, fontSize:14,
                          borderBottom: active ? `2px solid ${c}` : "2px solid transparent",
                          transition:"all 0.15s",
                          letterSpacing:"0.5px",
                        }}>
                        {k.toUpperCase()}
                      </button>
                    );
                  })}
                </div>
                {/* 내용 */}
                <div style={{ padding:"18px 20px 20px" }}>
                  <div style={{ color: info.color, fontWeight:800, fontSize:17, marginBottom:10, letterSpacing:"-0.3px" }}>
                    {info.name}
                  </div>
                  <ul style={{ margin:"0 0 14px 0", padding:0, listStyle:"none", display:"flex", flexDirection:"column", gap:5 }}>
                    {[info.direction, `단위: ${info.unit}`].map((item, i) => (
                      <li key={i} style={{ display:"flex", alignItems:"center", gap:7 }}>
                        <span style={{ width:4, height:4, borderRadius:"50%", background: info.color, flexShrink:0, opacity:0.85 }}/>
                        <span style={{ color:"#aaa", fontSize:14, fontWeight:600 }}>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <p style={{ color:"#e0e0e0", fontSize:14, fontWeight:500, lineHeight:1.6, margin:"0 0 10px 0" }}>
                    {info.desc}
                  </p>
                  <div style={{marginTop:13,paddingTop:10,borderTop:"1px solid rgba(255,255,255,0.10)",color:info.color,fontSize:12,fontWeight:750}}>
                    아래에서 같은 색 ± 버튼을 누르며 TCP 변화를 관찰하세요.
                  </div>
                </div>
              </div>
            );
          })()}
        </div>}

        {/* ── Bottom-right coord readout ── */}
        {!isPickLesson && <div className="absolute right-3 z-10 select-none" style={{ top:paperScene.data?52:undefined, bottom:paperScene.data?undefined:activeNav === "용어·기호와 기초수학" ? "calc(0.75rem + 34px + 10px)" : "0.75rem" }}>
          <div style={{
            background: "rgba(255,255,255,0.82)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(0,0,0,0.10)",
            borderRadius: 8,
            boxShadow: "0 1px 8px rgba(0,0,0,0.10)",
            padding: "10px 16px 10px 14px",
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            columnGap: 12,
            rowGap: 4,
          }}>
            {([ ["X","x"], ["Y","y"], ["Z","z"], ["R","r"] ] as [string, keyof typeof coords][]).map(([label, key]) => [
              <span key={label+"l"} style={{ color: "#111", fontWeight: 700, fontSize: 14, lineHeight: "1.6" }}>{label}</span>,
              <span key={label+"v"} className="num-mono" style={{ color: "#111", fontWeight: 650, fontSize: 14, lineHeight: "1.6", textAlign: "right" }}>
                {((paperScene.data?.displayPose??coords)[key] >= 0 ? "+" : "") + (paperScene.data?.displayPose??coords)[key].toFixed(2)}
              </span>
            ])}
            {paperScene.data&&<small style={{gridColumn:"1 / -1",color:"#475569"}}>{paperScene.data.displaySource==="hardware"?"실장비 · TCP 보고":paperScene.data.displaySource==="mock"?"모의 · 실측 아님":"DT · 실측 아님"}</small>}
          </div>
        </div>}
        {/* ── Bottom-right annotation toggle (용어·기호와 기초수학 페이지에서만 표시) ── */}
        {activeNav === "용어·기호와 기초수학" && <div className="absolute bottom-3 right-3 z-10">
          <button
            onClick={() => setShowAnnotations(v => !v)}
            className="px-3.5 py-1.5 rounded transition-all"
            style={{
              background: showAnnotations ? "rgba(0,212,255,0.82)" : "rgba(255,255,255,0.72)",
              color: showAnnotations ? "#fff" : "#555",
              border: `1px solid ${showAnnotations ? "#00d4ff" : "rgba(0,0,0,0.16)"}`,
              backdropFilter:"blur(6px)",
              boxShadow: showAnnotations ? "0 0 8px #00d4ff88" : "0 1px 4px rgba(0,0,0,0.10)",
              fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
              fontWeight:700, fontSize:13, letterSpacing:"0.3px",
            }}
          >on / off</button>
        </div>}

        {/* ── Alarm banner ── */}
        {robotMode === 9 && (
          <div
            className="absolute bottom-0 left-0 right-0 z-20 flex items-center gap-3 px-4 py-2"
            style={{ background: "rgba(120,10,10,0.93)", backdropFilter: "blur(4px)" }}
          >
            <span style={{ color: "#ff6b6b", fontWeight: 700, fontSize: 13 }}>⚠ 알람 발생</span>
            <span style={{ color: "#ffaaaa", fontSize: 12, flex: 1 }}>
              원인 제거 후 아래 버튼 또는 상단 버튼으로 알람을 해제하세요.
            </span>
            <button
              onClick={handleReset}
              className="px-3 py-1 rounded text-xs font-bold transition-colors"
              style={{ background: "#c0392b", color: "#fff", border: "1px solid #ff6b6b" }}
            >
              알람 해제 (ClearError)
            </button>
          </div>
        )}

        {bridgeError && robotMode !== 9 && (
          <div
            className="absolute bottom-0 left-0 right-0 z-20 flex items-center gap-3 px-4 py-2"
            style={{ background: "rgba(120,65,0,0.94)", backdropFilter: "blur(4px)" }}
          >
            <span style={{ color: "#ffd27a", fontWeight: 700, fontSize: 13 }}>⚠ 장비 명령 오류</span>
            <span style={{ color: "#fff1cf", fontSize: 12, flex: 1 }}>{bridgeError}</span>
            <button
              onClick={() => setBridgeError(null)}
              className="px-3 py-1 rounded text-xs font-bold"
              style={{ background: "rgba(255,255,255,0.14)", color: "#fff", border: "1px solid rgba(255,255,255,0.35)" }}
            >닫기</button>
          </div>
        )}

        {/* ── Dashboard side panel ── */}
        <DashboardPanel
          open={dashboardOpen}
          onClose={() => setDashboardOpen(false)}
          activeNav={activeNav}
          onNavSelect={navigateChapter}
          coordinateTopic={coordinateTopic}
          kinematicsTopic={kinematicsTopic}
          onCoordinateSelect={topic => {
            if (activeNav !== "좌표와 로봇 이동") navigateChapter("좌표와 로봇 이동");
            changeCoordinateTopic(topic);
            setDashboardOpen(false);
          }}
          onKinematicsSelect={topic => {
            if (activeNav !== "로봇 운동학") navigateChapter("로봇 운동학");
            changeKinematicsTopic(topic);
            setDashboardOpen(false);
          }}
          onGoHome={() => navigateChapter(null)}
        />

        {/* ── Connect dialog ── */}
        <ConnectDialog
          open={connectOpen}
          onClose={() => setConnectOpen(false)}
          onConnected={(ip, port) => { handleConnected(ip, port); setTimeout(() => setConnectOpen(false), 700); }}
          onDisconnect={handleDisconnect}
          onStatusChange={setDialogStatus}
          currentIp={connectedTo?.ip}
          currentPort={connectedTo?.port}
          connectFn={bridgeConnect}
        />
      </div>

      {/* ── Bottom panels ── */}
      {activeNav === "용어·기호와 기초수학" ? (
        <div className="foundation-panel" style={{ flex: "0 0 40%", minWidth: 0, height: "100%", overflow: "hidden" }}>
          <BasicMath
            coords={coords}
            joints={joints}
            onStartCoordinates={()=>{navigateChapter("좌표와 로봇 이동");changeCoordinateTopic("axes");}}
            onBack={() => navigateChapter(null)}
            onJogStart={startJog}
            onJogStop={stopJog}
            onJointStart={startJoint}
            onCoordSet={(axis, v) => commitCoord(axis)(v)}
            onMathFocusChange={handleMathFocusChange}
            onCorrectMove={handleMathCorrectMove}
            startPointMotion={lessonProps}
            onCancelMove={cancelMathMove}
            hardwareMode={practice.hardware}
            onMathCoachChange={setMathCoach}
            mathHintStep={mathHintStep}
            onMathHintStepChange={setMathHintStep}
          />
        </div>
      ) : activeNav === "좌표와 로봇 이동" ? (
        <LessonPanel title={`2-${coordinateTopicIndex + 1}. ${COORDINATE_TOPICS[coordinateTopicIndex].label}`}>
          {(isAxesLesson || isCoordinateLesson) && coordinateStorageFailed && <div className="coordinate-storage-alert" role="alert">
            <span>학습 기록 일부를 읽거나 저장하지 못했습니다. 현재 기록을 내려받아 보관하세요.</span>
            <button onClick={() => downloadEvidence("coordinate-learning-backup.json", { records:coordinateEvidence.records, unreadable:coordinateEvidence.backups })}>기록 내려받기</button>
          </div>}
          {isShapeLesson ? missionPanel : isAxesLesson ? <AxisLesson {...lessonProps}
            supportRecords={learningSupportRecords} onSupport={saveLearningSupport}
            attemptHistory={axisAttemptHistory} onAttempt={(taskId,attempt)=>setAxisAttemptHistory(previous=>({...previous,[taskId]:[...(previous[taskId]??[]),attempt]}))}
            view={viewPreset} onViewChange={setViewPreset} onVisualChange={setAxisLessonVisual}
            records={axisLessonRecords} onRecord={record => setAxisLessonRecords(previous => [...previous.filter(r => r.taskId !== record.taskId), record])}
            onNext={() => changeCoordinateTopic("coordinates")}/> : isCoordinateLesson ? <AbsoluteRelativeLesson {...lessonProps}
            supportRecords={learningSupportRecords} onSupport={saveLearningSupport}
            applicationRecords={coordinateApplicationRecords} onApplicationRecord={record=>setCoordinateApplicationRecords(previous=>{
              const index=previous.findIndex(r=>r.id===record.id);
              return index<0?[...previous,record]:previous.map((r,i)=>i===index?record:r);
            })}
            transferLearningRecords={transferLearningRecords} onTransferLearningRecord={record=>setTransferLearningRecords(previous=>{
              const index=previous.findIndex(r=>r.id===record.id);
              return index<0?[...previous,record]:previous.map((r,i)=>i===index?record:r);
            })}
            strategyAttempts={coordinateStrategyAttempts} onStrategyAttempt={attempt => setCoordinateStrategyAttempts(previous => {
              const index = previous.findIndex(a => a.id === attempt.id);
              return index < 0 ? [...previous,attempt] : previous.map((a,i) => i === index ? attempt : a);
            })}
            attempts={coordinateAttempts} onAttempt={attempt => setCoordinateAttempts(previous => {
              const index = previous.findIndex(a => a.id === attempt.id);
              return index < 0 ? [...previous,attempt] : previous.map((a,i) => i === index ? attempt : a);
            })}
            onVisualChange={setCoordinateVisual} onNext={() => changeCoordinateTopic("motion")}/> : <CoordinateLesson key={coordinateTopic}
            {...lessonProps} onVisualChange={setMotionVisual} topic={coordinateTopic as Exclude<CoordinateTopic, "axes" | "shapes">}
            onNext={() => {
              const index = COORDINATE_TOPICS.findIndex(topic => topic.id === coordinateTopic);
              changeCoordinateTopic(COORDINATE_TOPICS[Math.min(index+1, 3)].id);
            }}/>}
        </LessonPanel>
      ) : activeNav === "로봇 운동학" ? (
        <LessonPanel title={`3-${kinematicsTopicIndex + 1}. ${KINEMATICS_TOPICS[kinematicsTopicIndex].label}`}>
          <KinematicsLesson key={kinematicsTopic} {...lessonProps} topic={kinematicsTopic} onVisualChange={setKinematicsVisual}
            onNext={() => kinematicsTopic === "fk" ? setKinematicsTopic("ik") : navigateChapter("운동학 종합과제: 픽앤플레이스")}/>
        </LessonPanel>
      ) : isPickLesson ? (
        <LessonPanel title="4. 이송·인계·포장 공정"><ProcessCellLesson {...lessonProps} hardwareConnected={practice.hardware || !!connectedTo || dialogStatus === "connecting" || dialogStatus === "connected"} model={PROCESS_MODEL} sceneReady={processSceneReady} onVisualChange={setProcessVisual}/></LessonPanel>
      ) : (
      <div className="bg-white border-t border-[#d0d0d0] shrink-0">

        {/* Mode + Step Value row */}
        <div className="flex items-center gap-3 px-3 py-2 border-b border-[#e8e8e8]">
          <span className="text-sm font-semibold text-[#222] w-10 shrink-0">Mode</span>
          <ModeToggle mode={practice.hardware ? "Step" : mode} setMode={practice.hardware ? () => {} : setMode}/>
          {practice.hardware && <span className="text-xs">실장비: 확인 후 한 칸 이동</span>}
          <span className="text-sm text-[#555] shrink-0 ml-4 font-medium">Step Value</span>
          <div className="flex items-center gap-1">
            {STEP_VALUES.map((v, i) => (
              <button key={v} onClick={() => setStepIndex(i)}
                className={`px-2 py-0.5 rounded transition-colors ${stepIndex === i ? "text-[#111]" : "text-[#999] hover:text-[#111]"}`}
                style={{fontSize:14,fontWeight:stepIndex===i?700:400,fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif",fontVariantNumeric:"tabular-nums"}}>
                {v}
              </button>
            ))}
          </div>
          <span className="text-sm text-[#555] shrink-0 ml-4 font-medium">Speed</span>
          <div className="flex items-center gap-2">
            <input
              type="range"
              disabled={practice.hardware && (practice.snap.busy || !!practice.snap.measurement?.moving || practice.snap.uncertainMotion)}
              min={practice.hardware ? 1 : 10}
              max={practice.hardware ? 20 : 100}
              step={practice.hardware ? 1 : 5}
              value={practice.hardware ? (Number.isFinite(practice.setupDraft.speed)?practice.setupDraft.speed:(practice.snap.setup?.speed??5)) : speed}
              onChange={e => practice.hardware ? practice.setSetupDraft({...practice.setupDraft,speed:Number(e.target.value)}) : setSpeed(Number(e.target.value))}
              style={{
                width: 100,
                accentColor: "#222",
                cursor: "pointer",
              }}
            />
            <span className="num-mono" style={{fontSize:14,fontWeight:600,color:"#111",width:practice.hardware?230:32,textAlign:"right"}}>{practice.hardware ? `적용 ${practice.snap.setup?.speed??"미확인"}% / 예정 ${Number.isFinite(practice.setupDraft.speed)?practice.setupDraft.speed:"미입력"}% · 상단에서 적용` : `${speed}%`}</span>
          </div>
        </div>

        {practice.hardware && <div role="status" style={{padding:"8px 16px",background:"#eef5ff",color:"#0b2d5c",fontSize:13}}>
          <strong>{practice.snap.busy ? "실장비 명령 실행 중" : practice.session.readiness() || "조작 준비 완료 — TCP 또는 관절각 ± 버튼을 누르세요."}</strong>
          {hwNotice && <div role="alert">{hwNotice}</div>}
          <button type="button" onClick={() => practice.setPanelOpen(true)} style={{marginLeft:12,textDecoration:"underline"}}>연결·준비 설정 열기</button>
          <div>TCP: mm / R·관절: ° · 한 번 누르면 선택 간격만큼 이동 · 길게 눌러도 반복하지 않습니다.</div>
        </div>}
        {/* Main jog controls — LEFT (Cartesian) | DIVIDER | RIGHT (Joints) */}
        <div className="flex items-stretch">

          {/* ── LEFT: X/Y/Z/R ── */}
          <div className="flex-1 flex flex-row items-center px-3 py-1">
            <span style={{fontSize:15,fontWeight:700,color:"#222",fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif",letterSpacing:"0.2px",whiteSpace:"nowrap",flexShrink:0,paddingLeft:24,alignSelf:"flex-start",marginTop:8}}>TCP 좌표 제어</span>
          <div className="flex-1 flex items-center justify-center gap-10">
            {/* Coord readouts */}
            <div className="flex flex-col justify-center min-w-[56px] shrink-0" style={{marginTop:22,marginLeft:-18}}>
              {(["X","Y","Z","R"] as const).map((k,i) => (
                <div key={k} className="flex items-center gap-1.5 py-1.5">
                  <span className="text-sm font-bold text-[#111] w-4">{k}</span>
                  <EditableReadout
                    value={practice.hardware
                      ? (liveReadout ? fmt(liveReadout.pose[(["x","y","z","r"] as const)[i]]) : "—")
                      : fmt([coords.x,coords.y,coords.z,coords.r][i])}
                    onCommit={commitCoord((["x","y","z","r"] as const)[i])}
                  />
                </div>
              ))}
            </div>
            {/* X/Y pad */}
            {(() => {
              const cx = coordGuideOpen ? coordTab : null;
              return (
                <div className="flex flex-col items-center gap-0.5">
                  <span style={{fontSize:13,fontWeight:600,color:"#555",fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif"}}>X / Y</span>
                  <CrossPad size={148}
                    top={jb("X+", () => startJog("x",  1))}
                    bottom={jb("X-", () => startJog("x", -1))}
                    left={jb("Y+", () => startJog("y",  1))}
                    right={jb("Y-", () => startJog("y", -1))}
                    topColor={cx === "x" ? "#0284c7" : undefined}
                    bottomColor={cx === "x" ? "#0284c7" : undefined}
                    leftColor={cx === "y" ? "#7c3aed" : undefined}
                    rightColor={cx === "y" ? "#7c3aed" : undefined}
                  />
                </div>
              );
            })()}
            {/* Z/R pad */}
            {(() => {
              const cx = coordGuideOpen ? coordTab : null;
              return (
                <div className="flex flex-col items-center gap-0.5">
                  <span style={{fontSize:13,fontWeight:600,color:"#555",fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif"}}>Z / R</span>
                  <CrossPad size={148}
                    top={jb("Z+", () => startJog("z",  1))}
                    bottom={jb("Z-", () => startJog("z", -1))}
                    left={jb("R+", () => startJog("r",  1))}
                    right={jb("R-", () => startJog("r", -1))}
                    topColor={cx === "z" ? "#34d399" : undefined}
                    bottomColor={cx === "z" ? "#34d399" : undefined}
                    leftColor={cx === "r" ? "#1e3a8a" : undefined}
                    rightColor={cx === "r" ? "#1e3a8a" : undefined}
                  />
                </div>
              );
            })()}
          </div>
          </div>

          {/* ── Divider ── */}
          <div className="w-px bg-[#d0d0d0] self-stretch my-2 shrink-0" />

          {/* ── RIGHT: J1–J4 ── */}
          <div className="flex-1 flex flex-row items-center px-3 py-1">
            <span style={{fontSize:15,fontWeight:700,color:"#222",fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif",letterSpacing:"0.2px",whiteSpace:"nowrap",flexShrink:0,paddingLeft:24,alignSelf:"flex-start",marginTop:8}}>관절각 제어</span>
          <div className="flex-1 flex items-center justify-center gap-10">
            {/* Joint readouts */}
            <div className="flex flex-col justify-center min-w-[56px] shrink-0" style={{marginTop:22,marginLeft:-18}}>
              {(["J1","J2","J3","J4"] as const).map((k,i) => (
                <div key={k} className="flex items-center gap-1.5 py-1.5">
                  <span className="text-sm font-bold text-[#111] w-5">{k}</span>
                  <EditableReadout
                    value={practice.hardware
                      ? (liveReadout ? fmt(liveReadout.joints[(["j1","j2","j3","j4"] as const)[i]]) : "—")
                      : fmt([displayJoints.j1,displayJoints.j2,displayJoints.j3,displayJoints.j4][i])}
                    onCommit={commitJoint((["j1","j2","j3","j4"] as const)[i])}
                  />
                </div>
              ))}
            </div>
            {/* J1/J2 pad */}
            {(() => {
              const hl = jointGuideOpen ? guideTab : null;
              const j1c = hl === "j1" ? "#f59e0b" : undefined;
              const j2c = hl === "j2" ? "#3b82f6" : undefined;
              return (
                <div className="flex flex-col items-center gap-0.5">
                  <span style={{fontSize:13,fontWeight:600,color:"#555",fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif"}}>J1 / J2</span>
                  <CrossPad size={148}
                    top={jb("J1+", () => startJoint("j1",  1))}
                    bottom={jb("J1-", () => startJoint("j1", -1))}
                    left={jb("J2+", () => startJoint("j2",  1))}
                    right={jb("J2-", () => startJoint("j2", -1))}
                    topColor={j1c} bottomColor={j1c}
                    leftColor={j2c} rightColor={j2c}
                  />
                </div>
              );
            })()}
            {/* J3/J4 pad */}
            {(() => {
              const hl = jointGuideOpen ? guideTab : null;
              const j3c = hl === "j3" ? "#22c55e" : undefined;
              const j4c = hl === "j4" ? "#ec4899" : undefined;
              return (
                <div className="flex flex-col items-center gap-0.5">
                  <div style={{display:"flex",alignItems:"center",gap:6,height:18}}>
                    <span style={{fontSize:13,fontWeight:600,color:"#555"}}>J3 / J4</span>
                    <button type="button" aria-label="흡착기 확대보기" aria-expanded={suctionZoomOpen}
                      aria-controls={suctionZoomOpen ? "suction-zoom-panel" : undefined}
                      onClick={() => setSuctionZoomOpen(open => !open)}
                      style={{fontSize:11,fontWeight:700,lineHeight:"14px",border:"1px solid #b9c8d4",borderRadius:4,padding:"1px 5px",
                        background:suctionZoomOpen ? "#334155" : "#fff",color:suctionZoomOpen ? "#fff" : "#334155",cursor:"pointer"}}>
                      {suctionZoomOpen ? "확대 끄기" : "확대보기"}
                    </button>
                  </div>
                  <CrossPad size={148}
                    top={jb("J3+", () => startJoint("j3",  1))}
                    bottom={jb("J3-", () => startJoint("j3", -1))}
                    left={jb("J4+", () => startJoint("j4",  1))}
                    right={jb("J4-", () => startJoint("j4", -1))}
                    topColor={j3c} bottomColor={j3c}
                    leftColor={j4c} rightColor={j4c}
                  />
                </div>
              );
            })()}
          </div>
          </div>

        </div>
      </div>)}

      </div>{/* ── end main flex wrapper ── */}
      <div ref={setPracticePanelHost} className="practice-settings-host" hidden={!practice.panelOpen}/>
      </div>
    </div>
  );
}

