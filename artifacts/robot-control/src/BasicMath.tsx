import type { FoundationMove } from "./foundationMotion";
import type { MotionProps } from "./LessonPages";
import { MathStartLesson } from "./MathStartLesson";
import { basicMathProjection } from "./basicMathProjection";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";

interface Coords { x: number; y: number; z: number; r: number; }
interface Joints { j1: number; j2: number; j3: number; j4: number; }

const ARM_L1 = 175, ARM_L2 = 175;
const COORD_OZ = -41.202;  // display z=0 offset (physical h at home)

/* ═══════════════════════════════════════════════════════════
   SVG용 색상 (어두운 배경 위)
   ═══════════════════════════════════════════════════════════ */
const C = {
  x:  "#ef4444",
  y:  "#22c55e",
  r:  "#a855f7",
  j1: "#f59e0b",
  j2: "#818cf8",
  j3: "#67e8f9",
  l1: "#818cf8",
  l2: "#67e8f9",
  bg: "#1e213a",
};

/* 수식 텍스트용 색상 (흰 배경 위 — 채도 높고 진하게) */
const T = {
  x:  "#dc2626",   // red-600
  y:  "#16a34a",   // green-600
  r:  "#9333ea",   // purple-600
  j1: "#d97706",   // amber-600
  j2: "#4f46e5",   // indigo-600
  j3: "#0891b2",   // cyan-600 (어두운 버전)
  l1: "#4f46e5",
  l2: "#0891b2",
  op: "#555",      // 연산자
  sub:"#444",      // 대입값
  dim:"#9ca3af",   // gray-400
};

/* ═══════════════════════════════════════════════════════════
   수식 렌더러
   ═══════════════════════════════════════════════════════════ */
function Eq({ parts }: { parts: { text: string; color?: string; bold?: boolean }[] }) {
  return (
    <span style={{ fontFamily: "'Pretendard', -apple-system, 'Apple SD Gothic Neo', sans-serif", fontSize: 16 }}>
      {parts.map((p, i) => (
        <span key={i} style={{ color: p.color ?? T.op, fontWeight: p.bold ? 700 : 400 }}>
          {p.text}
        </span>
      ))}
    </span>
  );
}

function EqRow({ indent = 0, children }: { indent?: number; children: React.ReactNode }) {
  return (
    <div style={{ paddingLeft: indent * 16, lineHeight: "1.3", display: "flex", alignItems: "baseline" }}>
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   ① CoordViz — 2D 부감도 (SVG 어두운 배경)
   ═══════════════════════════════════════════════════════════ */
function CoordViz({ x, y, z }: { x: number; y: number; z: number }) {
  const W = 392, H = 220;
  const cx = W / 2, cy = H / 2;
  const MAX = 420;
  const sc = (Math.min(W, H) / 2 - 20) / MAX;

  const px = Math.max(14, Math.min(W - 14, cx + x * sc));
  const py = Math.max(14, Math.min(H - 14, cy - y * sc));
  const xE = Math.max(14, Math.min(W - 14, cx + x * sc));
  const maxR = MAX * sc;
  const hasY = Math.abs(y) > 4;
  const dist = Math.sqrt(x * x + y * y);

  return (
    <svg width={W} height={H} style={{ borderRadius: 12, background: C.bg, display: "block" }}>
      {[-3,-2,-1,1,2,3].map(i => (
        <g key={i}>
          <line x1={0} y1={cy+i*26} x2={W} y2={cy+i*26} stroke="#2a2d4e" strokeWidth="1"/>
          <line x1={cx+i*26} y1={0} x2={cx+i*26} y2={H} stroke="#2a2d4e" strokeWidth="1"/>
        </g>
      ))}
      <circle cx={cx} cy={cy} r={maxR} fill="none" stroke="#333660" strokeWidth="1.5" strokeDasharray="5 4"/>
      <line x1={10} y1={cy} x2={W-10} y2={cy} stroke="#444870" strokeWidth="1.5"/>
      <line x1={cx} y1={10} x2={cx} y2={H-10} stroke="#444870" strokeWidth="1.5"/>
      <polygon points={`${W-10},${cy} ${W-18},${cy-5} ${W-18},${cy+5}`} fill={C.x} opacity="0.8"/>
      <polygon points={`${cx},10 ${cx-4},18 ${cx+4},18`} fill={C.y} opacity="0.8"/>
      <text x={W-22} y={cy-8} fontSize="13" fill={C.x} fontFamily="monospace" fontWeight="bold">X</text>
      <text x={cx+7} y={19} fontSize="13" fill={C.y} fontFamily="monospace" fontWeight="bold">Y</text>
      <line x1={cx} y1={cy} x2={px} y2={py} stroke={C.r} strokeWidth="2" strokeDasharray="7 4" opacity="0.7"/>
      <line x1={cx} y1={cy} x2={xE} y2={cy} stroke={C.x} strokeWidth="5" strokeLinecap="round" opacity="0.9"/>
      {hasY && <line x1={xE} y1={cy} x2={px} y2={py} stroke={C.y} strokeWidth="5" strokeLinecap="round" opacity="0.9"/>}
      <circle cx={px} cy={py} r={20} fill="#6366f1" opacity="0.06"/>
      <circle cx={px} cy={py} r={10} fill="#6366f1" opacity="0.15"/>
      <circle cx={px} cy={py} r={7}  fill="#818cf8" opacity="0.95"/>
      <circle cx={px} cy={py} r={3}  fill="white"/>
      <text x={(cx+xE)/2} y={cy+16} fontSize="11" fill={C.x} textAnchor="middle" fontFamily="monospace" fontWeight="bold">
        x={x.toFixed(0)}
      </text>
      {hasY && (
        <text x={px+(x>=0?9:-9)} y={(cy+py)/2+4} fontSize="11" fill={C.y}
          textAnchor={x>=0?"start":"end"} fontFamily="monospace" fontWeight="bold">
          y={y.toFixed(0)}
        </text>
      )}
      <text x={(cx+px)/2-8} y={(cy+py)/2-9} fontSize="10" fill={C.r} textAnchor="middle" fontFamily="monospace">
        r={dist.toFixed(0)}
      </text>
      <circle cx={cx} cy={cy} r={4} fill="#555"/>
      <rect x={W-68} y={6} width={62} height={20} rx={5} fill="#252840"/>
      <text x={W-37} y={20} fontSize="10" fill="#60a5fa" textAnchor="middle" fontFamily="monospace" fontWeight="bold">
        Z={z.toFixed(0)}
      </text>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════
   ② ArmSideView — 2D 측면도 (SVG 어두운 배경, exported for RobotArm)
   ═══════════════════════════════════════════════════════════ */
export function ArmSideView({ j2, j3 }: { j2: number; j3: number }) {
  const W = 392, H = 165;
  const ox = 38, oy = 126;
  const SC = 0.375;
  const l1p = ARM_L1 * SC, l2p = ARM_L2 * SC;
  const j2r = j2 * Math.PI / 180;
  const j3r = j3 * Math.PI / 180;

  const elbX = ox + l1p * Math.cos(j2r);
  const elbY = oy - l1p * Math.sin(j2r);
  const rawTcpX = elbX + l2p * Math.cos(j2r + j3r);
  const rawTcpY = elbY - l2p * Math.sin(j2r + j3r);
  const tcpX = Math.max(ox+4, Math.min(W-8, rawTcpX));
  const tcpY = Math.max(8, Math.min(H-8, rawTcpY));

  const reach  = ARM_L1 * Math.cos(j2r) + ARM_L2 * Math.cos(j2r + j3r);
  const height = ARM_L1 * Math.sin(j2r) + ARM_L2 * Math.sin(j2r + j3r);

  const aR1 = 26, aR2 = 18;
  const a1Ex = ox + aR1 * Math.cos(j2r), a1Ey = oy - aR1 * Math.sin(j2r);
  const a2Ex = elbX + aR2 * Math.cos(j2r+j3r), a2Ey = elbY - aR2 * Math.sin(j2r+j3r);

  return (
    <svg width={W} height={H} style={{ borderRadius: 12, background: C.bg, display: "block" }}>
      <line x1={ox-10} y1={oy} x2={W-8} y2={oy} stroke="#444870" strokeWidth="2"/>
      <line x1={ox} y1={oy+10} x2={ox} y2={8} stroke="#444870" strokeWidth="1.5"/>
      <polygon points={`${ox},8 ${ox-4},16 ${ox+4},16`} fill={C.y} opacity="0.7"/>
      <text x={ox+5} y={15} fontSize="9" fill={C.y} fontFamily="monospace">z↑</text>
      <line x1={ox} y1={oy} x2={tcpX} y2={oy} stroke={C.x} strokeWidth="1.5" strokeDasharray="5 3" opacity="0.6"/>
      {height > 8 && (
        <line x1={tcpX} y1={oy} x2={tcpX} y2={Math.min(oy, tcpY)} stroke={C.y} strokeWidth="1.5" strokeDasharray="5 3" opacity="0.6"/>
      )}
      {j2 > 1 && (
        <path d={`M ${ox+aR1} ${oy} A ${aR1} ${aR1} 0 ${j2>180?1:0} 0 ${a1Ex.toFixed(1)} ${a1Ey.toFixed(1)}`}
          fill="none" stroke={C.j2} strokeWidth="2.5" opacity="0.9"/>
      )}
      {Math.abs(j3) > 1 && (
        <path d={`M ${(elbX + aR2*Math.cos(j2r)).toFixed(1)} ${(elbY - aR2*Math.sin(j2r)).toFixed(1)} A ${aR2} ${aR2} 0 ${Math.abs(j3)>180?1:0} ${j3<0?1:0} ${a2Ex.toFixed(1)} ${a2Ey.toFixed(1)}`}
          fill="none" stroke={C.j3} strokeWidth="2" opacity="0.8"/>
      )}
      <line x1={ox} y1={oy} x2={elbX.toFixed(1)} y2={elbY.toFixed(1)}
        stroke={C.l1} strokeWidth="6" strokeLinecap="round"/>
      <line x1={elbX.toFixed(1)} y1={elbY.toFixed(1)} x2={tcpX} y2={tcpY}
        stroke={C.l2} strokeWidth="6" strokeLinecap="round"/>
      <circle cx={ox} cy={oy} r={6} fill="#555" stroke="#888" strokeWidth="1.5"/>
      <circle cx={elbX} cy={elbY} r={5} fill={C.l1} stroke="white" strokeWidth="1.5"/>
      <circle cx={tcpX} cy={tcpY} r={12} fill={C.l2} opacity="0.10"/>
      <circle cx={tcpX} cy={tcpY} r={7}  fill={C.l2} opacity="0.85"/>
      <circle cx={tcpX} cy={tcpY} r={3}  fill="white"/>
      <text x={(ox+elbX)/2-4} y={(oy+elbY)/2-7} fontSize="10" fill={C.l1}
        textAnchor="middle" fontFamily="monospace" fontWeight="bold">L1</text>
      <text x={(elbX+tcpX)/2+7} y={(elbY+tcpY)/2-7} fontSize="10" fill={C.l2}
        textAnchor="middle" fontFamily="monospace" fontWeight="bold">L2</text>
      {j2 > 1 && (
        <text x={ox+aR1*0.55+14} y={oy-aR1*0.35-4} fontSize="9.5" fill={C.j2}
          fontFamily="monospace" fontWeight="bold">J2={j2.toFixed(0)}°</text>
      )}
      {Math.abs(j3) > 1 && (
        <text x={elbX+aR2*0.5+11} y={elbY-aR2*0.5-3} fontSize="9" fill={C.j3}
          fontFamily="monospace" fontWeight="bold">J3={j3.toFixed(0)}°</text>
      )}
      <text x={(ox+tcpX)/2} y={oy+14} fontSize="9.5" fill={C.x}
        textAnchor="middle" fontFamily="monospace">x={reach.toFixed(0)}</text>
      {height > 8 && (
        <text x={tcpX+6} y={(oy+tcpY)/2+4} fontSize="9.5" fill={C.y}
          textAnchor="start" fontFamily="monospace">h={height.toFixed(0)}</text>
      )}
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════
   ③ WaveViz — sin/cos 파형 (SVG 어두운 배경)
   ═══════════════════════════════════════════════════════════ */
function WaveViz({ angleDeg }: { angleDeg: number }) {
  const W = 392, H = 80;
  const mL=30, mR=10, mT=7, mB=18;
  const iW = W-mL-mR, iH = H-mT-mB;
  const midY = mT+iH/2, ampY = iH/2-2;

  const N = 240;
  const sPts: string[] = [], cPts: string[] = [];
  for (let i=0;i<=N;i++) {
    const t=i/N, th=t*2*Math.PI;
    const sx=mL+t*iW;
    sPts.push(`${sx.toFixed(1)},${(midY-Math.sin(th)*ampY).toFixed(1)}`);
    cPts.push(`${sx.toFixed(1)},${(midY-Math.cos(th)*ampY).toFixed(1)}`);
  }

  const norm = ((angleDeg%360)+360)%360;
  const t = norm/360;
  const dotX = mL+t*iW;
  const sRad = norm*Math.PI/180;
  const sDotY = midY-Math.sin(sRad)*ampY;
  const cDotY = midY-Math.cos(sRad)*ampY;
  const sv = Math.sin(sRad);

  return (
    <svg width={W} height={H} style={{ borderRadius:10, background:C.bg, display:"block" }}>
      <line x1={mL} y1={midY} x2={mL+iW} y2={midY} stroke="#2a2d4e" strokeWidth="1.5"/>
      {[0,0.25,0.5,0.75,1].map((f,i) => {
        const lx=mL+f*iW;
        return <g key={i}>
          <line x1={lx} y1={mT} x2={lx} y2={mT+iH} stroke="#2a2d50" strokeWidth="1" strokeDasharray="2 4"/>
          <text x={lx} y={H-3} fontSize="8.5" fill="#6b7280" textAnchor="middle" fontFamily="monospace">
            {["0°","90°","180°","270°","360°"][i]}
          </text>
        </g>;
      })}
      <text x={mL-3} y={mT+5}    fontSize="8" fill="#6b7280" textAnchor="end" fontFamily="monospace">+1</text>
      <text x={mL-3} y={midY+4}  fontSize="8" fill="#6b7280" textAnchor="end" fontFamily="monospace"> 0</text>
      <text x={mL-3} y={mT+iH+3} fontSize="8" fill="#6b7280" textAnchor="end" fontFamily="monospace">-1</text>
      <path d={"M "+cPts.join(" L ")} fill="none" stroke={C.x} strokeWidth="1.5" opacity="0.3"/>
      <path d={"M "+sPts.join(" L ")} fill="none" stroke={C.y} strokeWidth="2.5"/>
      <line x1={dotX} y1={mT} x2={dotX} y2={mT+iH} stroke={C.j1} strokeWidth="1.5" strokeDasharray="3 2" opacity="0.9"/>
      <circle cx={dotX} cy={cDotY} r={4.5} fill={C.x} opacity="0.6"/>
      <circle cx={dotX} cy={sDotY} r={10} fill={C.y} opacity="0.10"/>
      <circle cx={dotX} cy={sDotY} r={6}  fill={C.y} opacity="0.85"/>
      <circle cx={dotX} cy={sDotY} r={2.5} fill="white"/>
      <rect x={Math.min(Math.max(dotX-22,mL),mL+iW-44)} y={sDotY<midY?sDotY+10:sDotY-21}
        width={44} height={13} rx={4} fill="#1a3d2a" stroke={`${C.y}44`} strokeWidth="1"/>
      <text x={Math.min(Math.max(dotX,mL+22),mL+iW-22)}
        y={sDotY<midY?sDotY+20.5:sDotY-11}
        fontSize="9.5" fill={C.y} textAnchor="middle" fontFamily="monospace" fontWeight="bold">
        {sv>=0?"+":""}{sv.toFixed(2)}
      </text>
      <text x={mL+4} y={mT+10} fontSize="8.5" fill={C.y} fontFamily="monospace">sin</text>
      <text x={mL+28} y={mT+10} fontSize="8.5" fill={C.x} fontFamily="monospace" opacity="0.5">cos</text>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════
   조그 버튼 (라이트 테마)
   ═══════════════════════════════════════════════════════════ */
function JogBtn({ label, color, onStart, onStop }: {
  label: string; color: string;
  onStart: () => void; onStop: () => void;
}) {
  return (
    <button
      onMouseDown={onStart} onMouseUp={onStop} onMouseLeave={onStop}
      onTouchStart={(e) => { e.preventDefault(); onStart(); }} onTouchEnd={onStop}
      className="flex items-center justify-center rounded-lg text-xs font-bold select-none active:scale-95 transition-transform"
      style={{ background:"#f0f2ff", border:`1.5px solid ${color}55`, color, height:34,
        userSelect:"none", WebkitUserSelect:"none" as const }}
    >{label}</button>
  );
}

/* ═══════════════════════════════════════════════════════════
   ③ J4SideView — 손목(J4) 회전 측면도 + 고스트
   ═══════════════════════════════════════════════════════════ */
export function J4SideView({ joints }: { joints: Joints }) {
  const W = 440, H = 200;
  const L_BASE = 50, L1 = 76, L2 = 76, LW = 24;
  const CX = 220, BY = 182;
  const D = Math.PI / 180;

  const frozenRef = useRef<Joints>(joints);
  const movingRef = useRef(false);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [ghostJ, setGhostJ] = useState<Joints>(joints);
  const [showGhost, setShowGhost] = useState(false);

  useEffect(() => {
    if (!movingRef.current) {
      frozenRef.current = { ...joints };
      setGhostJ({ ...joints });
      setShowGhost(true);
      movingRef.current = true;
    }
    clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(() => {
      movingRef.current = false;
      setTimeout(() => setShowGhost(false), 1400);
    }, 120);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joints.j4]);

  function fk(j: Joints) {
    const j2r   = j.j2 * D;
    const forer = j2r + j.j3 * D;
    const toolr = forer + j.j4 * D;
    const cx1   = Math.cos(j.j1 * D);
    const ax    = (x: number) => CX + (x - CX) * cx1;
    const j2py  = BY - L_BASE;
    const j3px  = CX + L1 * Math.sin(j2r),   j3py = j2py - L1 * Math.cos(j2r);
    const j4px  = j3px + L2 * Math.sin(forer), j4py = j3py - L2 * Math.cos(forer);
    const tpx   = j4px + LW * Math.sin(toolr), tpy  = j4py - LW * Math.cos(toolr);
    return {
      j2:  [ax(CX),   j2py] as [number, number],
      j3:  [ax(j3px), j3py] as [number, number],
      j4:  [ax(j4px), j4py] as [number, number],
      tip: [ax(tpx),  tpy ] as [number, number],
      forer, toolr,
    };
  }

  const cur = fk(joints);
  const gst = fk(ghostJ);

  const drawArm = (p: ReturnType<typeof fk>, col: string, sw = 3.5) => (
    <g>
      <line x1={CX} y1={BY} x2={CX} y2={BY - L_BASE} stroke={col} strokeWidth={sw + 1} strokeLinecap="round"/>
      <line x1={p.j2[0]} y1={p.j2[1]} x2={p.j3[0]} y2={p.j3[1]} stroke={col} strokeWidth={sw} strokeLinecap="round"/>
      <line x1={p.j3[0]} y1={p.j3[1]} x2={p.j4[0]} y2={p.j4[1]} stroke={col} strokeWidth={sw * 0.85} strokeLinecap="round"/>
      <line x1={p.j4[0]} y1={p.j4[1]} x2={p.tip[0]} y2={p.tip[1]} stroke={col} strokeWidth={sw * 0.7} strokeLinecap="round"/>
      <circle cx={p.j2[0]}  cy={p.j2[1]}  r={5}   fill={col}/>
      <circle cx={p.j3[0]}  cy={p.j3[1]}  r={5}   fill={col}/>
      <circle cx={p.j4[0]}  cy={p.j4[1]}  r={4}   fill={col}/>
      <circle cx={p.tip[0]} cy={p.tip[1]} r={3}   fill={col} opacity={0.7}/>
    </g>
  );

  const ARC_R = 26;
  const [j4x, j4y] = cur.j4;
  const refA  = cur.forer - Math.PI / 2;
  const curA  = cur.toolr - Math.PI / 2;
  const j4val = joints.j4;
  const j4abs = Math.abs(j4val);
  const sweep    = j4val >= 0 ? 1 : 0;
  const largeArc = j4abs > 180 ? 1 : 0;

  const arcSx = j4x + ARC_R * Math.cos(refA);
  const arcSy = j4y + ARC_R * Math.sin(refA);
  const arcEx = j4x + ARC_R * Math.cos(curA);
  const arcEy = j4y + ARC_R * Math.sin(curA);

  const tang   = curA + (sweep ? 1 : -1) * Math.PI / 2;
  const ap     = 6;
  const arrPts = [
    [arcEx + ap * Math.cos(tang - 0.42), arcEy + ap * Math.sin(tang - 0.42)],
    [arcEx, arcEy],
    [arcEx + ap * Math.cos(tang + 0.42), arcEy + ap * Math.sin(tang + 0.42)],
  ].map(p => p.join(",")).join(" ");

  const midA = refA + (j4val * D) / 2;
  const lR   = ARC_R + 20;
  const lx   = j4x + lR * Math.cos(midA);
  const ly   = j4y + lR * Math.sin(midA);

  return (
    <div style={{ borderRadius: 12, border: "1.5px solid #e2e8f0", overflow: "hidden", background: "#f8fafc" }}>
      <svg width={W} height={H} style={{ display: "block" }}>
        <line x1={20} y1={BY} x2={W - 20} y2={BY} stroke="#c0c4cc" strokeWidth={1.5}/>

        {showGhost && (
          <g opacity={0.55}>
            {drawArm(gst, "#94a3b8", 3)}
            <circle cx={gst.j4[0]} cy={gst.j4[1]} r={7}
              fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="3 2"/>
            <text x={gst.j4[0] + 9} y={gst.j4[1] - 4}
              fill="#64748b" fontSize={9} fontWeight={600}
              fontFamily="'Pretendard','Arial',sans-serif">이전</text>
          </g>
        )}

        {drawArm(cur, "#1e3a5f")}

        {j4abs > 0.5 ? (
          <g>
            <line x1={j4x} y1={j4y}
              x2={j4x + (ARC_R + 13) * Math.cos(refA)} y2={j4y + (ARC_R + 13) * Math.sin(refA)}
              stroke="#94a3b8" strokeWidth={1.3} strokeDasharray="3 2.5" strokeLinecap="round"/>
            <path d={`M ${arcSx} ${arcSy} A ${ARC_R} ${ARC_R} 0 ${largeArc} ${sweep} ${arcEx} ${arcEy}`}
              fill="none" stroke="#f97316" strokeWidth={2.5} strokeLinecap="round"/>
            <polygon points={arrPts} fill="#f97316"/>
            <line x1={j4x} y1={j4y}
              x2={j4x + (ARC_R + 13) * Math.cos(curA)} y2={j4y + (ARC_R + 13) * Math.sin(curA)}
              stroke="#f97316" strokeWidth={2} strokeLinecap="round"/>
            <text x={lx} y={ly} fill="#c2410c"
              fontSize={11} fontWeight={800} textAnchor="middle" dominantBaseline="middle"
              fontFamily="'Pretendard','Arial',sans-serif"
              style={{ paintOrder:"stroke", stroke:"rgba(248,250,252,0.95)",
                strokeWidth:3, strokeLinejoin:"round" as const }}>
              θ₄={j4val >= 0 ? "+" : ""}{j4val.toFixed(1)}°
            </text>
          </g>
        ) : (
          <line x1={j4x} y1={j4y}
            x2={j4x + (ARC_R + 13) * Math.cos(refA)} y2={j4y + (ARC_R + 13) * Math.sin(refA)}
            stroke="#94a3b8" strokeWidth={1.3} strokeLinecap="round"/>
        )}

        <text x={W / 2} y={H - 6} fill="#475569"
          fontSize={12} fontWeight={700} textAnchor="middle"
          fontFamily="'Pretendard','Arial',sans-serif">
          J4 / R：{j4val >= 0 ? "+" : ""}{j4val.toFixed(1)}°
        </text>
      </svg>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   용어와 기호 탭 — 좌표/관절 기호 설명 카드
   ═══════════════════════════════════════════════════════════ */
function TermCard({ symbol, color, title, desc, live }: {
  symbol: string; color: string; title: string; desc: string; live?: string;
}) {
  return (
    <div style={{
      display:"flex", gap:12, padding:"10px 12px",
      background:"#fafafa", border:"1.5px solid #e5e7eb", borderRadius:12,
      alignItems:"flex-start",
    }}>
      <div style={{
        minWidth:42, height:42, borderRadius:10,
        background:`${color}18`, border:`2px solid ${color}55`,
        display:"flex", alignItems:"center", justifyContent:"center",
        fontFamily:"'JetBrains Mono','Fira Mono',monospace",
        fontWeight:800, fontSize:18, color,
      }}>{symbol}</div>
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:700, fontSize:13.5, color:"#1e293b", marginBottom:2 }}>{title}</div>
        <div style={{ fontSize:12, color:"#64748b", lineHeight:1.55 }}>{desc}</div>
        {live && (
          <div style={{
            marginTop:5, display:"inline-block",
            padding:"2px 8px", borderRadius:6,
            background:`${color}15`, border:`1px solid ${color}40`,
            fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700, color,
          }}>{live}</div>
        )}
      </div>
    </div>
  );
}

/* 위에서 본 2D 뷰 — X, Y, R, J1 주석 */
function TopView({ x, y, j1 }: { x: number; y: number; j1: number }) {
  const W = 440, H = 200;
  const cx = W * 0.38, cy = H / 2;
  const MAX = 420;
  const sc = (Math.min(W * 0.38, H / 2) - 14) / MAX;
  const r = Math.sqrt(x*x + y*y);

  const px = Math.max(14, Math.min(W - 14, cx + x * sc));
  const py = Math.max(14, Math.min(H - 14, cy - y * sc));
  const xE = Math.max(14, Math.min(W - 14, cx + x * sc));

  // J1 arc
  const aR = 28;
  const j1r = j1 * Math.PI / 180;
  const arcEnd = { x: cx + aR * Math.cos(-j1r + Math.PI/2 - Math.PI/2), y: cy + aR * Math.sin(-j1r + Math.PI/2 - Math.PI/2) };
  // at J1=0 arm goes in +X direction (right)
  const arcEx = cx + aR * Math.cos(-j1r);
  // Note: in this top-view SVG, +X is right, +Y is up
  // J1=0 → arm toward +X (right from origin)
  // arcEx = cx + aR*cos(j1r counterclockwise from +X... but displayed with y flipped)
  void arcEnd;

  const midArm = { x: (cx + px) / 2, y: (cy + py) / 2 };

  return (
    <svg width={W} height={H} style={{ borderRadius:10, background:C.bg, display:"block" }}>
      {/* grid */}
      {[-2,-1,1,2].map(i => (
        <g key={i}>
          <line x1={0} y1={cy+i*22} x2={W*0.76} y2={cy+i*22} stroke="#1e2248" strokeWidth="1"/>
          <line x1={cx+i*22} y1={0} x2={cx+i*22} y2={H} stroke="#1e2248" strokeWidth="1"/>
        </g>
      ))}
      {/* axes */}
      <line x1={12} y1={cy} x2={W*0.76-8} y2={cy} stroke="#444870" strokeWidth="1.5"/>
      <line x1={cx} y1={H-10} x2={cx} y2={10} stroke="#444870" strokeWidth="1.5"/>
      <polygon points={`${W*0.76-8},${cy} ${W*0.76-16},${cy-5} ${W*0.76-16},${cy+5}`} fill={C.x} opacity="0.8"/>
      <polygon points={`${cx},10 ${cx-4},18 ${cx+4},18`} fill={C.y} opacity="0.8"/>
      <text x={W*0.76-14} y={cy-8} fontSize="11" fill={C.x} fontFamily="monospace" fontWeight="bold">X</text>
      <text x={cx+6} y={17} fontSize="11" fill={C.y} fontFamily="monospace" fontWeight="bold">Y</text>

      {/* J1 arc */}
      {Math.abs(j1) > 1 && (
        <>
          <path
            d={`M ${cx+aR} ${cy} A ${aR} ${aR} 0 ${Math.abs(j1)>180?1:0} ${j1>0?1:0} ${cx+aR*Math.cos(-j1r)} ${cy+aR*Math.sin(-j1r)}`}
            fill="none" stroke={C.j1} strokeWidth="2" opacity="0.9"/>
          <text x={cx+aR+6} y={cy-(j1>0?10:4)} fontSize="9.5" fill={C.j1}
            fontFamily="monospace" fontWeight="bold">J1={j1.toFixed(0)}°</text>
        </>
      )}

      {/* R dashed */}
      <line x1={cx} y1={cy} x2={px} y2={py} stroke={C.r} strokeWidth="1.5" strokeDasharray="6 3" opacity="0.65"/>
      {/* X component */}
      <line x1={cx} y1={cy} x2={xE} y2={cy} stroke={C.x} strokeWidth="5" strokeLinecap="round" opacity="0.85"/>
      {/* Y component */}
      {Math.abs(y) > 4 && (
        <line x1={xE} y1={cy} x2={px} y2={py} stroke={C.y} strokeWidth="5" strokeLinecap="round" opacity="0.85"/>
      )}
      {/* arm tip dot */}
      <circle cx={px} cy={py} r={18} fill="#6366f1" opacity="0.07"/>
      <circle cx={px} cy={py} r={9}  fill="#818cf8" opacity="0.9"/>
      <circle cx={px} cy={py} r={3.5} fill="white"/>
      {/* base dot */}
      <circle cx={cx} cy={cy} r={5} fill="#555" stroke="#888" strokeWidth="1.5"/>

      {/* ── Annotation panel (right side) ── */}
      <rect x={W*0.77} y={0} width={W*0.23} height={H} fill="#12142c"/>
      {[
        { sym:"X", col:C.x,  val:`${x.toFixed(0)} mm`,  y:26 },
        { sym:"Y", col:C.y,  val:`${y.toFixed(0)} mm`,  y:58 },
        { sym:"R", col:C.r,  val:`${r.toFixed(0)} mm`,  y:90 },
        { sym:"J1",col:C.j1, val:`${j1.toFixed(1)}°`,   y:122 },
      ].map(({ sym, col, val, y: ly }) => (
        <g key={sym}>
          <rect x={W*0.77+6} y={ly-14} width={W*0.23-12} height={22} rx={5} fill={`${col}18`} stroke={`${col}44`} strokeWidth="1"/>
          <text x={W*0.77+14} y={ly} fontSize="12" fill={col} fontFamily="'JetBrains Mono',monospace" fontWeight="800">{sym}</text>
          <text x={W-8} y={ly} fontSize="10.5" fill={col} fontFamily="'JetBrains Mono',monospace" textAnchor="end">{val}</text>
        </g>
      ))}
      <text x={W*0.77+(W*0.23)/2} y={H-8} fontSize="8.5" fill="#4a5080" textAnchor="middle"
        fontFamily="monospace">위에서 본 뷰</text>

      {/* pointer lines from dots to annotation */}
      <line x1={xE} y1={cy} x2={W*0.77+2} y2={26-3} stroke={C.x} strokeWidth="0.8" strokeDasharray="3 3" opacity="0.4"/>
      {Math.abs(y) > 4 && (
        <line x1={(xE+px)/2} y1={(cy+py)/2} x2={W*0.77+2} y2={58-3} stroke={C.y} strokeWidth="0.8" strokeDasharray="3 3" opacity="0.4"/>
      )}
      <line x1={midArm.x} y1={midArm.y} x2={W*0.77+2} y2={90-3} stroke={C.r} strokeWidth="0.8" strokeDasharray="3 3" opacity="0.4"/>
    </svg>
  );
}

/* 옆에서 본 2D 뷰 — Z, J2, J3 주석 */
function SideView({ coords, joints }: { coords: Coords; joints: Joints }) {
  const W = 440, H = 190;
  const ox = 46, oy = 156;
  const SC = 0.34;
  const l1p = ARM_L1 * SC, l2p = ARM_L2 * SC;
  const j2r = joints.j2 * Math.PI / 180;
  const j3r = joints.j3 * Math.PI / 180;

  const elbX = ox + l1p * Math.cos(j2r);
  const elbY = oy - l1p * Math.sin(j2r);
  const rawTcpX = elbX + l2p * Math.cos(j2r + j3r);
  const rawTcpY = elbY - l2p * Math.sin(j2r + j3r);
  const tcpX = Math.max(ox+4, Math.min(W*0.74-4, rawTcpX));
  const tcpY = Math.max(8, Math.min(oy-2, rawTcpY));

  const reach  = ARM_L1 * Math.cos(j2r) + ARM_L2 * Math.cos(j2r + j3r);
  const height = ARM_L1 * Math.sin(j2r) + ARM_L2 * Math.sin(j2r + j3r);
  void reach;

  return (
    <svg width={W} height={H} style={{ borderRadius:10, background:C.bg, display:"block" }}>
      {/* floor & axis */}
      <line x1={ox-10} y1={oy} x2={W*0.74} y2={oy} stroke="#444870" strokeWidth="2"/>
      <line x1={ox} y1={oy+8} x2={ox} y2={10} stroke="#444870" strokeWidth="1.5"/>
      <polygon points={`${ox},10 ${ox-4},18 ${ox+4},18`} fill={C.y} opacity="0.7"/>
      <text x={ox+4} y={17} fontSize="9" fill={C.y} fontFamily="monospace">Z↑</text>

      {/* vertical drop to floor */}
      {height > 8 && (
        <line x1={tcpX} y1={oy} x2={tcpX} y2={tcpY} stroke="#2563eb" strokeWidth="2" strokeDasharray="5 3" opacity="0.7"/>
      )}
      {/* horizontal reach */}
      <line x1={ox} y1={oy} x2={tcpX} y2={oy} stroke={C.x} strokeWidth="1.5" strokeDasharray="5 3" opacity="0.55"/>

      {/* J2 arc */}
      {joints.j2 > 1 && (
        <path d={`M ${ox+26} ${oy} A 26 26 0 0 0 ${ox+26*Math.cos(j2r)} ${oy-26*Math.sin(j2r)}`}
          fill="none" stroke={C.j2} strokeWidth="2.5" opacity="0.9"/>
      )}
      {/* J3 arc */}
      {Math.abs(joints.j3) > 1 && (
        <path d={`M ${elbX+18*Math.cos(j2r)} ${elbY-18*Math.sin(j2r)} A 18 18 0 ${Math.abs(joints.j3)>180?1:0} ${joints.j3<0?1:0} ${elbX+18*Math.cos(j2r+j3r)} ${elbY-18*Math.sin(j2r+j3r)}`}
          fill="none" stroke={C.j3} strokeWidth="2" opacity="0.85"/>
      )}

      {/* arm links */}
      <line x1={ox} y1={oy} x2={elbX.toFixed(1)} y2={elbY.toFixed(1)}
        stroke={C.l1} strokeWidth="7" strokeLinecap="round"/>
      <line x1={elbX.toFixed(1)} y1={elbY.toFixed(1)} x2={tcpX} y2={tcpY}
        stroke={C.l2} strokeWidth="7" strokeLinecap="round"/>

      {/* L1 label along first link */}
      {(() => {
        const mx = (ox + elbX) / 2;
        const my = (oy + elbY) / 2;
        const angle = Math.atan2(elbY - oy, elbX - ox) * 180 / Math.PI;
        return (
          <g transform={`translate(${mx},${my}) rotate(${angle})`}>
            <rect x={-18} y={-20} width={36} height={14} rx={4} fill={C.l1} opacity="0.9"/>
            <text x={0} y={-9} fontSize="10" fill="white" fontFamily="'JetBrains Mono',monospace"
              fontWeight="800" textAnchor="middle">L1</text>
          </g>
        );
      })()}

      {/* L2 label along second link */}
      {(() => {
        const mx = (elbX + tcpX) / 2;
        const my = (elbY + tcpY) / 2;
        const angle = Math.atan2(tcpY - elbY, tcpX - elbX) * 180 / Math.PI;
        return (
          <g transform={`translate(${mx},${my}) rotate(${angle})`}>
            <rect x={-18} y={-20} width={36} height={14} rx={4} fill={C.l2} opacity="0.9"/>
            <text x={0} y={-9} fontSize="10" fill="white" fontFamily="'JetBrains Mono',monospace"
              fontWeight="800" textAnchor="middle">L2</text>
          </g>
        );
      })()}

      {/* joints */}
      <circle cx={ox} cy={oy} r={6} fill="#555" stroke="#888" strokeWidth="1.5"/>
      <circle cx={elbX} cy={elbY} r={5} fill={C.l1} stroke="white" strokeWidth="1.5"/>
      <circle cx={tcpX} cy={tcpY} r={14} fill={C.l2} opacity="0.09"/>
      <circle cx={tcpX} cy={tcpY} r={8}  fill={C.l2} opacity="0.85"/>
      <circle cx={tcpX} cy={tcpY} r={3.5} fill="white"/>

      {/* ── Annotation panel (right side) ── */}
      <rect x={W*0.77} y={0} width={W*0.23} height={H} fill="#12142c"/>
      {[
        { sym:"Z",  col:"#fb923c", val:`${coords.z.toFixed(0)} mm`, y:22 },
        { sym:"L1", col:C.l1,      val:`${ARM_L1} mm`,              y:50 },
        { sym:"L2", col:C.l2,      val:`${ARM_L2} mm`,              y:78 },
        { sym:"J2", col:C.j2,      val:`${joints.j2.toFixed(1)}°`,  y:106 },
        { sym:"J3", col:C.j3,      val:`${joints.j3.toFixed(1)}°`,  y:134 },
      ].map(({ sym, col, val, y: ly }) => (
        <g key={sym}>
          <rect x={W*0.77+6} y={ly-14} width={W*0.23-12} height={22} rx={5} fill={`${col}18`} stroke={`${col}44`} strokeWidth="1"/>
          <text x={W*0.77+14} y={ly} fontSize="11" fill={col} fontFamily="'JetBrains Mono',monospace" fontWeight="800">{sym}</text>
          <text x={W-8} y={ly} fontSize="10" fill={col} fontFamily="'JetBrains Mono',monospace" textAnchor="end">{val}</text>
        </g>
      ))}
      <text x={W*0.77+(W*0.23)/2} y={H-8} fontSize="8.5" fill="#4a5080" textAnchor="middle"
        fontFamily="monospace">옆에서 본 뷰</text>

      {/* pointer lines */}
      {height > 8 && (
        <line x1={tcpX} y1={(oy+tcpY)/2} x2={W*0.77+2} y2={22-3} stroke="#fb923c" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.4"/>
      )}
      <line x1={(ox+elbX)/2} y1={(oy+elbY)/2} x2={W*0.77+2} y2={106-3} stroke={C.j2} strokeWidth="0.8" strokeDasharray="3 3" opacity="0.4"/>
    </svg>
  );
}

function SymCard({ sym, col, desc, val }: { sym:string; col:string; desc:string; val:string }) {
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:8, padding:"7px 10px",
      background:"#fafafa", border:"1.5px solid #e5e7eb", borderRadius:10,
    }}>
      <div style={{
        minWidth:32, height:32, borderRadius:8,
        background:`${col}18`, border:`2px solid ${col}50`,
        display:"flex", alignItems:"center", justifyContent:"center",
        fontFamily:"'JetBrains Mono',monospace", fontWeight:800, fontSize:14, color:col,
      }}>{sym}</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:11, color:"#64748b", lineHeight:1.3 }}>{desc}</div>
        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:700, color:col }}>{val}</div>
      </div>
    </div>
  );
}

function TermsTab({ coords, joints, onJogStart, onJogStop }: {
  coords: Coords;
  joints: Joints;
  onJogStart: (axis: "x"|"y"|"z"|"r", dir: 1|-1) => void;
  onJogStop: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">

      {/* 조그 버튼 — 맨 위에 배치해서 바로 사용 가능 */}
      <div className="rounded-xl p-2.5" style={{ background:"#f9fafb", border:"1.5px solid #e5e7eb" }}>
        <div className="text-xs uppercase tracking-widest mb-2" style={{ color:"#9ca3af" }}>
          끝점 이동 (누르고 있기)
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <JogBtn label="X+" color={T.x}      onStart={() => onJogStart("x", 1)}  onStop={onJogStop}/>
          <JogBtn label="Y+" color={T.y}      onStart={() => onJogStart("y", 1)}  onStop={onJogStop}/>
          <JogBtn label="Z+" color="#2563eb"  onStart={() => onJogStart("z", 1)}  onStop={onJogStop}/>
          <JogBtn label="X−" color={T.x}     onStart={() => onJogStart("x", -1)} onStop={onJogStop}/>
          <JogBtn label="Y−" color={T.y}     onStart={() => onJogStart("y", -1)} onStop={onJogStop}/>
          <JogBtn label="Z−" color="#2563eb" onStart={() => onJogStart("z", -1)} onStop={onJogStop}/>
        </div>
      </div>

      {/* 위에서 본 뷰 — X, Y, R, J1 */}
      <div>
        <div className="text-xs uppercase tracking-widest mb-1.5" style={{ color:"#9ca3af" }}>
          위에서 본 뷰 — X · Y · R · J1
        </div>
        <TopView x={coords.x} y={coords.y} j1={joints.j1} />
      </div>

      {/* 옆에서 본 뷰 — Z, L1, L2, J2, J3 */}
      <div>
        <div className="text-xs uppercase tracking-widest mb-1.5" style={{ color:"#9ca3af" }}>
          옆에서 본 뷰 — Z · L1 · L2 · J2 · J3
        </div>
        <SideView coords={coords} joints={joints} />
      </div>

      {/* 기호 요약 그리드 */}
      <div>
        <div className="text-xs uppercase tracking-widest mb-1.5" style={{ color:"#9ca3af" }}>끝점 좌표</div>
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {[
            { sym:"X",  col:T.x,      desc:"앞뒤 수평 거리",   val:`${coords.x.toFixed(1)} mm` },
            { sym:"Y",  col:T.y,      desc:"좌우 수평 거리",   val:`${coords.y.toFixed(1)} mm` },
            { sym:"Z",  col:"#2563eb",desc:"높이",             val:`${coords.z.toFixed(1)} mm` },
            { sym:"R",  col:T.r,      desc:"수평 직선 거리",   val:`${Math.sqrt(coords.x**2+coords.y**2).toFixed(1)} mm` },
          ].map(({ sym, col, desc, val }) => (
            <SymCard key={sym} sym={sym} col={col} desc={desc} val={val} />
          ))}
        </div>

        <div className="text-xs uppercase tracking-widest mb-1.5" style={{ color:"#9ca3af" }}>팔 링크 길이 (고정)</div>
        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {[
            { sym:"L1", col:T.l1, desc:"첫 번째 팔 길이",  val:`${ARM_L1} mm` },
            { sym:"L2", col:T.l2, desc:"두 번째 팔 길이",  val:`${ARM_L2} mm` },
          ].map(({ sym, col, desc, val }) => (
            <SymCard key={sym} sym={sym} col={col} desc={desc} val={val} />
          ))}
        </div>

        <div className="text-xs uppercase tracking-widest mb-1.5" style={{ color:"#9ca3af" }}>관절 각도</div>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { sym:"J1", col:T.j1,     desc:"베이스 회전 → X, Y", val:`${joints.j1.toFixed(1)}°` },
            { sym:"J2", col:T.l1,     desc:"어깨 관절 → R, Z",   val:`${joints.j2.toFixed(1)}°` },
            { sym:"J3", col:T.l2,     desc:"팔꿈치 → R, Z",      val:`${joints.j3.toFixed(1)}°` },
            { sym:"J4", col:"#f97316",desc:"손목 회전",           val:`${joints.j4.toFixed(1)}°` },
          ].map(({ sym, col, desc, val }) => (
            <SymCard key={sym} sym={sym} col={col} desc={desc} val={val} />
          ))}
        </div>
      </div>

    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   CrossPad — circular 4-way jog dial (same design as home screen)
   ═══════════════════════════════════════════════════════════ */
type JogBtnDef = { label: string; onPress: () => void; onRelease: () => void };

function PieWedge({
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
  const e = (endAngle   * Math.PI) / 180;
  const x1 = cx + outerR * Math.cos(s), y1 = cy + outerR * Math.sin(s);
  const x2 = cx + outerR * Math.cos(e), y2 = cy + outerR * Math.sin(e);
  const xi1 = cx + innerR * Math.cos(s), yi1 = cy + innerR * Math.sin(s);
  const xi2 = cx + innerR * Math.cos(e), yi2 = cy + innerR * Math.sin(e);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  const d = `M ${xi1} ${yi1} L ${x1} ${y1} A ${outerR} ${outerR} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${innerR} ${innerR} 0 ${large} 0 ${xi1} ${yi1} Z`;
  const mid = ((startAngle + endAngle) / 2) * (Math.PI / 180);
  const lr = (outerR + innerR) / 2;
  const lx = cx + lr * Math.cos(mid), ly = cy + lr * Math.sin(mid);
  return (
    <g onMouseDown={onMouseDown} onMouseUp={onMouseUp} onMouseLeave={onMouseLeave}
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onTouchCancel={onTouchCancel}
      style={{ cursor:"pointer", touchAction:"none" }}>
      <path d={d}
        fill={active ? (highlight ?? "#d8d8d8") : (highlight ? highlight+"33" : "#f4f4f4")}
        stroke={highlight ? highlight+"88" : "#e0e0e0"} strokeWidth="1.5"
        style={{ transition:"fill 0.08s" }}/>
      <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
        fontSize="13" fontWeight="700"
        fill={active ? "#111" : (highlight ?? "#444")}
        style={{ pointerEvents:"none", userSelect:"none" }}>{label}</text>
    </g>
  );
}

function CrossPad2D({
  top, bottom, left, right, size = 130,
  topColor, bottomColor, leftColor, rightColor,
}: {
  top: JogBtnDef; bottom: JogBtnDef; left: JogBtnDef; right: JogBtnDef;
  size?: number;
  topColor?: string; bottomColor?: string; leftColor?: string; rightColor?: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const cx = size / 2, cy = size / 2;
  const outerR = size / 2 - 3, innerR = outerR * 0.2;
  const press = (id: string, btn: JogBtnDef, e?: React.MouseEvent | React.TouchEvent) => {
    e?.preventDefault(); setActive(id); btn.onPress();
  };
  const release = (btn: JogBtnDef) => { setActive(null); btn.onRelease(); };
  const wedges = [
    { id:"top",    btn:top,    start:225, end:315, color:topColor    },
    { id:"right",  btn:right,  start:315, end:405, color:rightColor  },
    { id:"bottom", btn:bottom, start:45,  end:135, color:bottomColor },
    { id:"left",   btn:left,   start:135, end:225, color:leftColor   },
  ];
  return (
    <svg width={size} height={size}
      style={{ display:"block", touchAction:"none", filter:"drop-shadow(0 2px 6px #00000018)" }}>
      <circle cx={cx} cy={cy} r={outerR+1} fill="#f0f0f0"/>
      {wedges.map(({ id, btn, start, end, color }) => (
        <PieWedge key={id} cx={cx} cy={cy} outerR={outerR} innerR={innerR}
          startAngle={start} endAngle={end} label={btn.label}
          active={active === id} highlight={color}
          onMouseDown={(e) => press(id, btn, e)} onMouseUp={() => release(btn)}
          onMouseLeave={() => release(btn)}
          onTouchStart={(e) => press(id, btn, e)} onTouchEnd={() => release(btn)}
          onTouchCancel={() => release(btn)}/>
      ))}
      <circle cx={cx} cy={cy} r={innerR} fill="#e0e0e0" stroke="#cccccc" strokeWidth="1"/>
      <circle cx={cx} cy={cy} r={innerR*0.45} fill="#bbbbbb"/>
    </svg>
  );
}

/* ── 클릭하여 직접 수치 입력 ──────────────────────────────── */
function InlineReadout({ value, onCommit, label }: { value: string; onCommit: (v: number) => boolean; label?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    const raw = parseFloat(value.replace(/^\+/, ""));
    setDraft(isNaN(raw) ? "" : String(raw));
    setEditing(true);
    setError(false);
  }
  function commit() {
    const v = parseFloat(draft);
    if (isNaN(v)) { setError(true); return; }
    const ok = onCommit(v);
    if (!ok) { setError(true); setTimeout(() => setError(false), 600); return; }
    setEditing(false); setError(false);
  }
  function cancel() { setEditing(false); setError(false); }
  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);

  if (editing) {
    return (
      <input ref={inputRef} type="number" value={draft} aria-label={label}
        onChange={e => { setDraft(e.target.value); setError(false); }}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") cancel(); }}
        onBlur={commit}
        style={{
          width: 82, fontSize: 15, fontWeight: 700,
          border: `1.5px solid ${error ? "#ef4444" : "#3b82f6"}`,
          borderRadius: 4, padding: "0 4px", outline: "none",
          background: error ? "#fff5f5" : "#eff6ff",
          color: error ? "#ef4444" : "#1d4ed8",
          fontFamily: "monospace", fontVariantNumeric: "tabular-nums", textAlign: "right",
        }}
      />
    );
  }
  return (
    <span role="button" tabIndex={0} aria-label={label ? `${label} 편집` : undefined} onClick={startEdit}
      onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); startEdit(); } }}
      title="클릭하여 값 직접 입력 (Enter 확정 / Esc 취소)"
      style={{ fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif", fontVariantNumeric:"tabular-nums", fontSize:14, color:"#111", fontWeight:900, cursor:"text", borderBottom:"1px dashed #bbb", paddingBottom:1 }}>
      {value}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════
   LargeKinematicView — 전체 패널 크기 2D 기구학 뷰 (측면 + TCP 제어)
   ═══════════════════════════════════════════════════════════ */
function LargeKinematicView({
  coords, joints, onJogStart, onJogStop, onCoordSet,
}: {
  coords: Coords; joints: Joints;
  onJogStart: (axis: "x"|"y"|"z"|"r", dir: 1|-1) => void;
  onJogStop: () => void;
  onCoordSet?: (axis: "x"|"y"|"z"|"r", v: number) => boolean;
}) {
  const { x, y, z, r } = coords;
  const { j2, j3 } = joints;

  const SC = 0.65;
  const ox = 72, oy = 212;
  const l1p = ARM_L1 * SC, l2p = ARM_L2 * SC;
  const j2r = j2 * Math.PI / 180;
  const j3r = j3 * Math.PI / 180;

  // oy_draw: physical J2 axis in SVG coords — sits below floor (oy) because
  // display z=0 is 41.2 mm above the J2 axis. Floor fill will hide this portion.
  const oy_draw = oy - COORD_OZ * SC;  // ≈ 211.8

  const elbX = ox + l1p * Math.cos(j2r);
  const elbY = oy_draw - l1p * Math.sin(j2r);
  const rawTcpX = elbX + l2p * Math.cos(j2r + j3r);
  const rawTcpY = elbY - l2p * Math.sin(j2r + j3r);
  const tcpX = Math.max(ox + 6, rawTcpX);
  const tcpY = Math.max(10, Math.min(oy + 10, rawTcpY));

  const reach  = ARM_L1 * Math.cos(j2r) + ARM_L2 * Math.cos(j2r + j3r);
  const height = ARM_L1 * Math.sin(j2r) + ARM_L2 * Math.sin(j2r + j3r);

  const projection = basicMathProjection(joints);

  // where L1 exits the floor (display z=0 at oy) — mount circle goes here
  // when j2 ≤ 0 the arm points downward so it never crosses the floor; fall back to ox
  const l1FloorFrac = j2 > 0 ? Math.min(1, (oy_draw - oy) / (l1p * Math.sin(j2r))) : 0;
  const l1CutX = ox + l1FloorFrac * l1p * Math.cos(j2r);

  const aR2 = 32, aR3 = 22;
  const j3ArcStart = { x: elbX + aR3 * Math.cos(j2r), y: elbY - aR3 * Math.sin(j2r) };
  const j3ArcEnd   = { x: elbX + aR3 * Math.cos(j2r + j3r), y: elbY - aR3 * Math.sin(j2r + j3r) };

  // L1 label centred on the visible portion (floor-cut → elbow)
  const l1MidX = (l1CutX + elbX) / 2, l1MidY = (oy + elbY) / 2;
  const l1Angle = Math.atan2(elbY - oy, elbX - l1CutX) * 180 / Math.PI;
  const l2MidX = (elbX + tcpX) / 2, l2MidY = (elbY + tcpY) / 2;
  const l2Angle = Math.atan2(tcpY - elbY, tcpX - elbX) * 180 / Math.PI;

  // ── 작업공간 경계 경로 (관절 한계 기반, 매 렌더마다 재계산 X) ──────────
  const wsPath = useMemo(() => {
    // The controls expose calibrated/display joint angles, while this SVG uses
    // the same internal link angles as fkMG400 and the 3D model. Convert the
    // supported display ranges before sampling the workspace boundary.
    const J2_MODEL_OFFSET = 69.02 - 41.29;
    const J3_MODEL_OFFSET = -113.32 - 34.27;
    const J2_MIN = -25 + J2_MODEL_OFFSET, J2_MAX = 85 + J2_MODEL_OFFSET;
    const J3_MIN = -25 + J3_MODEL_OFFSET, J3_MAX = 105 + J3_MODEL_OFFSET;
    const N = 180;
    const D = Math.PI / 180;
    const wsPt = (j2d: number, j3d: number) => {
      const j2r = j2d * D, j3r = j3d * D;
      const px = ox + (ARM_L1 * Math.cos(j2r) + ARM_L2 * Math.cos(j2r + j3r)) * SC;
      const py = oy_draw - (ARM_L1 * Math.sin(j2r) + ARM_L2 * Math.sin(j2r + j3r)) * SC;
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    };
    const p: string[] = [];
    // Seg 1: j3=J3_MIN, j2: J2_MIN→J2_MAX  (folded/inner boundary)
    for (let i = 0; i <= N; i++) {
      const j2 = J2_MIN + (J2_MAX - J2_MIN) * i / N;
      p.push((i === 0 ? 'M' : 'L') + wsPt(j2, J3_MIN));
    }
    // Seg 2: j2=J2_MAX, j3: J3_MIN→J3_MAX  (high-j2 end cap)
    for (let i = 1; i <= N; i++) {
      const j3 = J3_MIN + (J3_MAX - J3_MIN) * i / N;
      p.push('L' + wsPt(J2_MAX, j3));
    }
    // Seg 3: j3=J3_MAX, j2: J2_MAX→J2_MIN  (extended/outer boundary)
    for (let i = 1; i <= N; i++) {
      const j2 = J2_MAX - (J2_MAX - J2_MIN) * i / N;
      p.push('L' + wsPt(j2, J3_MAX));
    }
    // Seg 4: j2=J2_MIN, j3: J3_MAX→J3_MIN  (low-j2 end cap)
    for (let i = 1; i <= N; i++) {
      const j3 = J3_MAX - (J3_MAX - J3_MIN) * i / N;
      p.push('L' + wsPt(J2_MIN, j3));
    }
    p.push('Z');
    return p.join(' ');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // ox, oy_draw, SC, ARM_L1/L2 are all layout/physical constants

  // r_max = L1+L2 = 350mm, SVG x at floor level
  const rMaxSvgX = (ox + (ARM_L1 + ARM_L2) * SC).toFixed(1);

  const jb = (label: string, onPress: () => void): JogBtnDef => ({ label, onPress, onRelease: onJogStop });

  // ── zoom / pan state ──────────────────────────────────────────
  const VB_DEFAULT = { x: -5, y: 0, w: 370, h: 248 };
  const [vb, setVb] = useState(VB_DEFAULT);
  const svgRef = useRef<SVGSVGElement>(null);
  const panRef = useRef<{ sx: number; sy: number; svb: typeof vb } | null>(null);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    setVb(prev => {
      const rect = svg.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / rect.width  * prev.w + prev.x;
      const my = (e.clientY - rect.top)  / rect.height * prev.h + prev.y;
      const nw = Math.max(80, Math.min(900, prev.w * factor));
      const nh = nw * (VB_DEFAULT.h / VB_DEFAULT.w);
      const sc = nw / prev.w;
      return { x: mx - (mx - prev.x) * sc, y: my - (my - prev.y) * sc, w: nw, h: nh };
    });
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  const onSvgMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    panRef.current = { sx: e.clientX, sy: e.clientY, svb: vb };
  };
  const onSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!panRef.current) return;
    const { sx, sy, svb } = panRef.current;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = (e.clientX - sx) / rect.width  * svb.w;
    const dy = (e.clientY - sy) / rect.height * svb.h;
    setVb({ ...svb, x: svb.x - dx, y: svb.y - dy });
  };
  const onSvgMouseUp = () => { panRef.current = null; };
  // ─────────────────────────────────────────────────────────────

  return (
    <div style={{ height:"100%", display:"flex", flexDirection:"column", background:C.bg }}>

      {/* ── 측면도 (XZ 평면) ── */}
      <div style={{ flex:1, minHeight:0, padding:"12px 8px 0", position:"relative" }}>
        <div style={{ position:"absolute", top:10, left:12, maxWidth:"calc(100% - 100px)", lineHeight:1.25, color:"#cbd5e1", fontSize:11, pointerEvents:"none" }}>
          베이스 φ={joints.j1.toFixed(1)}°
        </div>
        {/* 리셋 버튼 */}
        <button onClick={() => setVb(VB_DEFAULT)}
          style={{ position:"absolute", top:16, right:12, zIndex:10,
            background:"rgba(255,255,255,0.12)", border:"1px solid rgba(255,255,255,0.25)",
            color:"#cdd6f4", borderRadius:6, fontSize:11, padding:"2px 7px", cursor:"pointer" }}>
          ⟳ 리셋
        </button>
        <svg ref={svgRef} role="img" aria-label="팔 측면의 2D 링크와 수평 성분"
          viewBox={`${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`}
          width="100%" height="100%"
          preserveAspectRatio="xMidYMid meet"
          style={{ display:"block", cursor: panRef.current ? "grabbing" : "grab", userSelect:"none" }}
          onMouseDown={onSvgMouseDown}
          onMouseMove={onSvgMouseMove}
          onMouseUp={onSvgMouseUp}
          onMouseLeave={onSvgMouseUp}
          onDoubleClick={() => setVb(VB_DEFAULT)}>
          <rect x={0} y={0} width={360} height={248} fill={C.bg}/>

          {/* grid — relative to display z=0 floor */}
          {[1,2,3,4,5,6,7,8,9].map(i => (
            <line key={`h${i}`} x1={0} y1={oy-i*26} x2={320} y2={oy-i*26} stroke="#252848" strokeWidth="1"/>
          ))}
          {[1,2,3,4,5,6,7,8].map(i => (
            <line key={`v${i}`} x1={ox+i*26} y1={0} x2={ox+i*26} y2={290} stroke="#252848" strokeWidth="1"/>
          ))}

          {/* ── 작업공간 (Workspace) — 그리드 위, 팔 아래, floor fill이 아래쪽 클립 ── */}
          <path d={wsPath}
            fill="#2dd4bf" fillOpacity="0.13"
            stroke="#2dd4bf" strokeWidth="2" strokeOpacity="0.6" strokeDasharray="5 3"/>

          {/* ── Arm drawn first so floor fill hides the below-floor portion ── */}
          {/* J3 arc */}
          {Math.abs(j3) > 0.5 && (
            <path d={`M ${j3ArcStart.x.toFixed(1)} ${j3ArcStart.y.toFixed(1)} A ${aR3} ${aR3} 0 ${Math.abs(j3)>180?1:0} ${j3<0?1:0} ${j3ArcEnd.x.toFixed(1)} ${j3ArcEnd.y.toFixed(1)}`}
              fill="none" stroke={C.j3} strokeWidth="2" opacity="0.85"/>
          )}

          {/* arm links — L1 from J2 (below floor) up, L2 down to TCP at floor */}
          <line x1={ox} y1={oy_draw} x2={elbX.toFixed(1)} y2={elbY.toFixed(1)}
            stroke={C.l1} strokeWidth="10" strokeLinecap="round"/>
          <line x1={elbX.toFixed(1)} y1={elbY.toFixed(1)} x2={tcpX.toFixed(1)} y2={tcpY.toFixed(1)}
            stroke={C.l2} strokeWidth="10" strokeLinecap="round"/>

          {/* L1 label */}
          <g transform={`translate(${l1MidX},${l1MidY}) rotate(${l1Angle})`}>
            <rect x={-21} y={-23} width={42} height={17} rx={5} fill={C.l1} opacity="0.92"/>
            <text x={0} y={-10} fontSize="11" fill="white" fontFamily="'JetBrains Mono',monospace"
              fontWeight="800" textAnchor="middle">L1</text>
          </g>

          {/* L2 label */}
          <g transform={`translate(${l2MidX},${l2MidY}) rotate(${l2Angle})`}>
            <rect x={-21} y={-23} width={42} height={17} rx={5} fill={C.l2} opacity="0.92"/>
            <text x={0} y={-10} fontSize="11" fill="white" fontFamily="'JetBrains Mono',monospace"
              fontWeight="800" textAnchor="middle">L2</text>
          </g>

          {/* ── Floor fill: covers everything below display z=0 ── */}
          <rect x={0} y={oy} width={360} height={248} fill={C.bg}/>

          {/* Floor line — display z=0 baseline */}
          <line x1={0} y1={oy} x2={330} y2={oy} stroke="#444870" strokeWidth="2"/>

          {/* Z axis — solid orange highlight */}
          <line x1={ox} y1={oy} x2={ox} y2={4} stroke="#fb923c" strokeWidth="2.5"/>
          <polygon points={`${ox},4 ${ox-5},14 ${ox+5},14`} fill="#fb923c"/>
          <text x={ox+8} y={13} fontSize="13" fill="#fb923c" fontFamily="monospace" fontWeight="bold">Z</text>

          {/* Link-plane horizontal reach, independent of base rotation. */}
          <line x1={ox} y1={oy} x2={320} y2={oy} stroke="#22c55e" strokeWidth="2.5"/>
          <polygon points={`330,${oy} 320,${oy-5} 320,${oy+5}`} fill="#22c55e"/>
          <text x={316} y={oy-9} fontSize="13" fill="#22c55e" fontFamily="monospace" fontWeight="bold">ρ</text>

          {/* ── 작업공간 r_max 주석 ── */}
          {/* 수직 틱 at ox */}
          <line x1={ox} y1={oy-6} x2={ox} y2={oy+6} stroke="#2dd4bf" strokeWidth="1.5" opacity="0.7"/>
          {/* 수직 틱 at r_max */}
          <line x1={rMaxSvgX} y1={oy-6} x2={rMaxSvgX} y2={oy+6} stroke="#2dd4bf" strokeWidth="1.5" opacity="0.7"/>
          {/* 수평 스팬 라인 */}
          <line x1={ox} y1={oy} x2={rMaxSvgX} y2={oy} stroke="#2dd4bf" strokeWidth="1.2" opacity="0.55"/>

          {/* 작업공간 레이블 — workspace 영역 중앙부 */}
          <rect x={158} y={52} width={84} height={18} rx={4} fill="#0f2027" opacity="0.55"/>
          <text x="200" y="65" textAnchor="middle" fontSize="11" fill="#2dd4bf" opacity="0.95"
            fontFamily="'Pretendard','Apple SD Gothic Neo',sans-serif" fontWeight="700">작업공간</text>

          {/* reach projection */}
          <line x1={ox} y1={oy} x2={tcpX} y2={oy}
            stroke="#22c55e" strokeWidth="1.5" strokeDasharray="6 3" opacity="0.45"/>

          {/* height projection — only when display z ≠ 0 */}
          {Math.abs(z) > 2 && (
            <line x1={tcpX} y1={oy} x2={tcpX} y2={tcpY}
              stroke="#fb923c" strokeWidth="1.5" strokeDasharray="6 3" opacity="0.45"/>
          )}

          {/* 수평 기준선 점선 (θ₁ 기준 — 어깨) */}
          {j2 > 0.5 && (
            <line x1={l1CutX} y1={oy} x2={(l1CutX + aR2 + 20).toFixed(1)} y2={oy}
              stroke={C.j2} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.75"/>
          )}

          {/* J2 arc — centered at the L1 floor-exit point */}
          {j2 > 0.5 && (
            <path d={`M ${l1CutX+aR2} ${oy} A ${aR2} ${aR2} 0 ${j2>180?1:0} 0 ${(l1CutX+aR2*Math.cos(j2r)).toFixed(1)} ${(oy-aR2*Math.sin(j2r)).toFixed(1)}`}
              fill="none" stroke={C.j2} strokeWidth="2.5" opacity="0.9"/>
          )}

          {/* L1 연장선 점선 기준 (θ₂ 기준선) */}
          {Math.abs(j3) > 0.5 && (
            <line
              x1={(elbX + 4*Math.cos(j2r)).toFixed(1)} y1={(elbY - 4*Math.sin(j2r)).toFixed(1)}
              x2={(elbX + (aR3+20)*Math.cos(j2r)).toFixed(1)} y2={(elbY - (aR3+20)*Math.sin(j2r)).toFixed(1)}
              stroke={C.j3} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.75"/>
          )}

          {/* elbow */}
          <circle cx={elbX} cy={elbY} r={7} fill={C.l1} stroke="white" strokeWidth="1.5" opacity="0.9"/>
          <circle cx={elbX} cy={elbY} r={3} fill="white"/>

          {/* TCP */}
          <circle cx={tcpX} cy={tcpY} r={13} fill={C.l2} opacity="0.07"/>
          <circle cx={tcpX} cy={tcpY} r={8}  fill={C.l2} opacity="0.85"/>
          <circle cx={tcpX} cy={tcpY} r={3}  fill="white"/>

          {/* base mount — pinned to true origin (ox, oy) */}
          <circle cx={ox} cy={oy} r={11} fill="none" stroke="#6b7280" strokeWidth="1.5" opacity="0.5"/>
          <circle cx={ox} cy={oy} r={8}  fill="#374162" stroke="#9ca3af" strokeWidth="2"/>
          <circle cx={ox} cy={oy} r={3.5} fill="#e2e8f0"/>

          {/* angle labels — θ₁/θ₂ badge style */}
          {j2 > 0.5 && (
            <g>
              <rect x={l1CutX+aR2+2} y={oy-aR2*0.45-14} width={82} height={17} rx={3} fill="#0f172a" opacity="0.65"/>
              <text x={l1CutX+aR2+6} y={oy-aR2*0.45} fontSize="12" fill={C.j2}
                fontFamily="monospace" fontWeight="800">θ₁ = {j2.toFixed(1)}°</text>
            </g>
          )}
          {Math.abs(j3) > 0.5 && (
            <g>
              <rect x={elbX+aR3} y={elbY-21} width={j3 < 0 ? 96 : 82} height={17} rx={3} fill="#0f172a" opacity="0.65"/>
              <text x={elbX+aR3+4} y={elbY-8} fontSize="12" fill={C.j3}
                fontFamily="monospace" fontWeight="800">θ₂ = {j3.toFixed(1)}°</text>
            </g>
          )}

          {Math.abs(z) > 2 && (
            <g>
              <rect x={tcpX+5} y={(oy+tcpY)/2-8} width={60} height={15} rx={3} fill="#0f172a" opacity="0.55"/>
              <text x={tcpX+9} y={(oy+tcpY)/2+4} fontSize="11" fill="#fb923c"
                fontFamily="monospace" fontWeight="bold">h={z.toFixed(0)} mm</text>
            </g>
          )}

          {/* 좌표 레이블 — 교재 스타일 */}
          <text x={ox} y={oy+26} fontSize="12" fill="#cbd5e1"
            textAnchor="middle" fontFamily="monospace" fontWeight="800">(0,0)</text>
          <g>
            <rect x={Math.min(tcpX+12, 330)} y={tcpY-9} width={74} height={16} rx={3} fill="#0f172a" opacity="0.6"/>
            <text x={Math.min(tcpX+15, 333)} y={tcpY+4} fontSize="11" fill={C.l2}
              fontFamily="monospace" fontWeight="bold" opacity="0.95">({projection.rho.toFixed(0)}, {projection.z.toFixed(0)})</text>
          </g>

        </svg>
      </div>

      {/* ── TCP 좌표 제어 ── */}
      <div style={{
        flexShrink: 0, borderTop: "1px solid #e5e7eb", background: "#f9fafb",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "4px 30px",
        fontFamily: "'Pretendard','-apple-system','Apple SD Gothic Neo',sans-serif",
      }}>
        {/* 좌표 수치 */}
        <div style={{ display:"flex", flexDirection:"column", gap:3, flexShrink:0 }}>
          <div style={{ fontSize:15, fontWeight:700, color:"#555", marginBottom:1 }}>TCP 좌표 제어</div>
          {([
            { label:"X", val:x, axis:"x" as const },
            { label:"Y", val:y, axis:"y" as const },
            { label:"Z", val:z, axis:"z" as const },
            { label:"R", val:r, axis:"r" as const },
          ]).map(({ label, val, axis }) => (
            <div key={label} style={{ display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ width:18, fontSize:15, fontWeight:700, color:"#666" }}>{label}</span>
              {onCoordSet ? (
                <InlineReadout
                  label={`TCP ${label}`}
                  value={(val >= 0 ? "+" : "") + val.toFixed(2)}
                  onCommit={v => onCoordSet(axis, v)}
                />
              ) : (
                <span style={{ fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif", fontVariantNumeric:"tabular-nums", fontSize:14, color:"#111", fontWeight:900 }}>
                  {val >= 0 ? "+" : ""}{val.toFixed(2)}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* X/Y 다이얼 */}
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:1 }}>
          <span style={{ fontSize:13, fontWeight:600, color:"#555" }}>X / Y</span>
          <CrossPad2D size={130}
            top={jb("X+", () => onJogStart("x",  1))}
            bottom={jb("X-", () => onJogStart("x", -1))}
            left={jb("Y+", () => onJogStart("y",  1))}
            right={jb("Y-", () => onJogStart("y", -1))}
          />
        </div>

        {/* Z/R 다이얼 */}
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:1 }}>
          <span style={{ fontSize:13, fontWeight:600, color:"#555" }}>Z / R</span>
          <CrossPad2D size={130}
            top={jb("Z+", () => onJogStart("z",  1))}
            bottom={jb("Z-", () => onJogStart("z", -1))}
            left={jb("R+", () => onJogStart("r",  1))}
            right={jb("R-", () => onJogStart("r", -1))}
          />
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MatBracket — 행렬 브래킷 렌더러
   ═══════════════════════════════════════════════════════════ */
function MatBracket({ rows, colors }: { rows: string[][], colors: string[][] }) {
  return (
    <div style={{ display:"flex", alignItems:"stretch" }}>
      <div style={{ borderLeft:"2.5px solid #374151", borderTop:"2px solid #374151",
        borderBottom:"2px solid #374151", paddingLeft:5, paddingRight:2, borderRadius:"4px 0 0 4px" }}>
        <div style={{ height:10 }}/><div style={{ height:10 }}/>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"5px 12px",
        padding:"5px 6px", fontFamily:"monospace", fontSize:13 }}>
        {rows.flat().map((cell, i) => (
          <span key={i} style={{ color:colors.flat()[i], fontWeight:700 }}>{cell}</span>
        ))}
      </div>
      <div style={{ borderRight:"2.5px solid #374151", borderTop:"2px solid #374151",
        borderBottom:"2px solid #374151", paddingRight:5, paddingLeft:2, borderRadius:"0 4px 4px 0" }}>
        <div style={{ height:10 }}/><div style={{ height:10 }}/>
      </div>
    </div>
  );
}

function BasicConceptsTab({ joints, onHighlightLinks }: { joints: Joints; coords: Coords; onHighlightLinks?: (hl: {l1:boolean;l2:boolean}|null) => void }) {
  const font = "'Pretendard',-apple-system,'Apple SD Gothic Neo',sans-serif";

  /* ══ ① 직각삼각형 상태 ══ */
  const [theta, setTheta] = useState(42);
  const [rVal, setRVal]   = useState(100);
  const ar   = theta * Math.PI / 180;
  const cosT = Math.cos(ar), sinT = Math.sin(ar);
  const absC = Math.abs(cosT), absS = Math.abs(sinT);
  const Xval = +(rVal * cosT).toFixed(1);
  const Zval = +(rVal * sinT).toFixed(1);

  /* ══ ② 링크1 상태 ══ */
  const [j2Link, setJ2Link] = useState<number | null>(null);
  const deg2 = j2Link ?? joints.j2;
  const ar2  = deg2 * Math.PI / 180;
  const cos2 = Math.cos(ar2), sin2 = Math.sin(ar2);
  const X1 = +(175 * cos2).toFixed(1), Z1 = +(175 * sin2).toFixed(1);

  /* ══ ③ 두 링크 상태 ══ */
  const [j2c, setJ2c] = useState<number | null>(20);
  const [j3c, setJ3c] = useState<number | null>(40);
  const dA = j2c ?? joints.j2;
  const dB = j3c ?? joints.j3;
  const rA  = dA * Math.PI / 180;
  const rAB = (dA + dB) * Math.PI / 180;
  const cosA = Math.cos(rA), sinA = Math.sin(rA);
  const cosAB= Math.cos(rAB),sinAB= Math.sin(rAB);
  const l1x = +(175*cosA).toFixed(1),  l1z = +(175*sinA).toFixed(1);
  const l2x = +(175*cosAB).toFixed(1), l2z = +(175*sinAB).toFixed(1);
  const Xt = +(+l1x + +l2x).toFixed(1), Zt = +(+l1z + +l2z).toFixed(1);

  /* 공유 SVG 치수 */
  const TW=220, TH=118, TOX=30, TOY=110, TSC=148;
  const tex = TOX + TSC*absC, tey = TOY - TSC*absS;
  const LW=220, LH=156, LOX=28, LOY=130, LSC=0.60;
  const Lp1= 175*LSC, lrx= LOX+Lp1*cos2, lry= LOY-Lp1*sin2;
  const DW=270, DH=240, DOX=40, DOY=210, DSC=0.73;
  const Dp = 175*DSC;
  const do2x= DOX+Dp*cosA, do2y= DOY-Dp*sinA;
  const dtcx= do2x+Dp*cosAB, dtcy= do2y-Dp*sinAB;

  /* 공식 박스 공통 스타일 */
  const fBox = (bg: string, border: string) => ({
    borderRadius:0, border:`1.5px solid ${border}`,
    background:bg, padding:"5px 12px", 
    fontSize:13, fontWeight:800, textAlign:"center" as const, lineHeight:1.4,
  });

  /* 섹션 헤더 공통 */
  const SectionHead = ({ n, title, sub, color, bg, border }:{
    n:string; title:string; sub:string;
    color:string; bg:string; border:string;
  }) => (
    <div style={{ padding:"8px 14px 6px", background:bg, borderBottom:`1px solid ${border}` }}>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <div style={{ width:22, height:22, borderRadius:"50%",
          background:color, display:"flex", alignItems:"center",
          justifyContent:"center", fontSize:12, fontWeight:900,
          color:"white", flexShrink:0 }}>{n}</div>
        <span style={{ fontSize:15, fontWeight:800, color:"#1e293b" }}>{title}</span>
      </div>
      {sub && <div style={{ fontSize:10.5, color:"#64748b", marginTop:3, paddingLeft:30 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ fontFamily:font, display:"flex", flexDirection:"column",
      gap:0, overflowY:"auto", flex:1 }}>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          ① 직각삼각형
         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div style={{ background:"white", flexShrink:0 }}>
        <SectionHead n="1" title="삼각함수로 가로·세로 성분 이해하기"
          sub=""
          color="#0B2D5C" bg="#f8fafc" border="#e2e8f0"/>

        {/* 본문: SVG 좌 + 공식 우 */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
          padding:"0px 16px 2px", gap:70 }}>

          {/* 삼각형 SVG */}
          <svg width={TW} height={TH} viewBox={`0 0 ${TW} ${TH}`}
            overflow="visible"
            style={{ flex:"0 0 auto", width:TW }}>
            {/* 축 힌트 */}
            <line x1={TOX} y1={8} x2={TOX} y2={TOY} stroke="#f1f5f9" strokeWidth="1"/>
            <line x1={TOX} y1={TOY} x2={TW-8} y2={TOY} stroke="#f1f5f9" strokeWidth="1"/>
            {/* 수직 성분 Z */}
            <line x1={tex} y1={TOY} x2={tex} y2={tey}
              stroke="#1e293b" strokeWidth="2.5" strokeLinecap="round"/>
            <text x={tex+9} y={(TOY+tey)/2+5} fontSize="15" fill="#1e293b"
              fontWeight="bold">Z</text>
            {/* 수평 성분 X */}
            <line x1={TOX} y1={TOY} x2={tex} y2={TOY}
              stroke="#1e293b" strokeWidth="2.5" strokeLinecap="round"/>
            <text x={(TOX+tex)/2} y={TOY+17} fontSize="15" fill="#1e293b"
              textAnchor="middle" fontWeight="bold">X</text>
            {/* 직각 */}
            <rect x={tex-11} y={TOY-11} width={11} height={11}
              fill="none" stroke="#1e293b" strokeWidth="1.3"/>
            {/* 빗변 r */}
            <line x1={TOX} y1={TOY} x2={tex} y2={tey}
              stroke="#1e293b" strokeWidth="3" strokeLinecap="round"/>
            <text x={(TOX+tex)/2-14*sinT} y={(TOY+tey)/2-14*cosT}
              fontSize="17" fill="#1e293b" textAnchor="middle"
              dominantBaseline="middle" fontWeight="900">r</text>
            {/* θ 호 */}
            {theta > 2 && (
              <path d={`M ${TOX+50},${TOY} A 50,50 0 0,0 ${TOX+50*absC},${TOY-50*absS}`}
                fill="none" stroke="#1e293b" strokeWidth="2.2" strokeLinecap="round"/>
            )}
            <text x={TOX+66*Math.cos(ar/2)} y={TOY-66*Math.sin(ar/2)+3}
              fontSize="16" fill="#1e293b" fontWeight="900"
              textAnchor="middle" dominantBaseline="middle">θ</text>
          </svg>

          {/* 공식 박스 */}
          <div style={{ flex:"0 0 auto", width:148, display:"flex", flexDirection:"column", gap:8 }}>
            <div style={fBox("white","#94a3b8")}>
              <span style={{ color:"#1e293b" }}>X</span>
              <span style={{ color:"#1e293b" }}> = </span>
              <span style={{ color:"#1e293b", fontSize:16, fontWeight:900 }}>r</span>
              <span style={{ color:"#94a3b8" }}> · </span>
              <span style={{ color:"#1e293b", fontSize:15 }}>cos θ</span>
            </div>
            <div style={fBox("white","#94a3b8")}>
              <span style={{ color:"#1e293b" }}>Z</span>
              <span style={{ color:"#1e293b" }}> = </span>
              <span style={{ color:"#1e293b", fontSize:16, fontWeight:900 }}>r</span>
              <span style={{ color:"#94a3b8" }}> · </span>
              <span style={{ color:"#1e293b", fontSize:15 }}>sin θ</span>
            </div>
          </div>
        </div>

        {/* θ 슬라이더 */}
        <style>{`
          .theta-slider{-webkit-appearance:none;appearance:none;height:5px;border-radius:3px;outline:none;cursor:pointer;}
          .theta-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:13px;height:13px;border-radius:50%;background:#1e293b;cursor:pointer;box-shadow:none;}
          .theta-slider::-moz-range-thumb{width:13px;height:13px;border-radius:50%;background:#1e293b;border:none;cursor:pointer;}
          .r-input{border:1.5px solid #94a3b8;border-radius:3px;padding:2px 6px;font-size:14px;font-weight:800;width:72px;text-align:center;outline:none;font-family:inherit;}
          .r-input:focus{border-color:#1e293b;}
        `}</style>
        <div style={{ padding:"0 14px 11px", borderTop:"1px solid #f1f5f9" }}>
          {/* θ 슬라이더 + r 입력 한 줄 */}
          <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:6 }}>
            <span style={{ fontSize:14, fontWeight:700, color:"#d97706", flexShrink:0 }}>θ (각도)</span>
            <input type="range" min={5} max={85} step={1} value={theta}
              onChange={e => setTheta(Number(e.target.value))}
              className="theta-slider"
              style={{ flex:1, minWidth:0, cursor:"pointer",
                background:`linear-gradient(to right,#1e293b ${(theta-5)/80*100}%,#e5e7eb ${(theta-5)/80*100}%)` }}/>
            <span style={{ fontSize:15, fontWeight:900, color:"#d97706", flexShrink:0 }}>{theta}°</span>
            <span style={{ fontSize:15, color:"#1e293b", fontWeight:800, flexShrink:0, marginLeft:4 }}>r =</span>
            <input type="number" min={1} max={9999} value={rVal}
              onChange={e => { const v = Number(e.target.value); if (!isNaN(v) && v > 0) setRVal(v); }}
              className="r-input"
              style={{ width:60, flexShrink:0 }}/>
          </div>
          {/* cos/sin + 결과 2열 그리드 */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr",
            gap:"4px 8px", marginTop:7, fontSize:14 }}>
            {/* X열 */}
            <div style={{ display:"flex", flexDirection:"column", gap:2,
              border:"1.5px solid #1e293b", padding:"5px 8px 5px 20px" }}>
              <span>
                <span style={{ color:"#1e293b" }}>cos </span>
                <span style={{ color:"#d97706", fontWeight:700 }}>{theta}°</span>
                <span style={{ color:"#1e293b" }}> = </span>
                <span style={{ color:"#1e293b", fontWeight:800 }}>{cosT.toFixed(4)}</span>
              </span>
              <span>
                <span style={{ color:"#1e293b", fontWeight:700 }}>X</span>
                <span style={{ color:"#1e293b" }}> = </span>
                <span style={{ color:"#1e293b", fontWeight:700 }}>r</span>
                <span style={{ color:"#1e293b" }}>·cos</span>
                <span style={{ color:"#d97706", fontWeight:700 }}>{theta}°</span>
                <span style={{ color:"#1e293b" }}> = </span>
                <span style={{ color:"#1e293b" }}>{rVal} × </span>
                <span style={{ color:"#1e293b", fontWeight:700 }}>{cosT.toFixed(4)}</span>
                <span style={{ color:"#1e293b" }}> = </span>
                <span style={{ color:"#1e293b", fontWeight:900 }}>{Xval}</span>
              </span>
            </div>
            {/* Z열 */}
            <div style={{ display:"flex", flexDirection:"column", gap:2,
              border:"1.5px solid #1e293b", padding:"5px 8px 5px 20px" }}>
              <span>
                <span style={{ color:"#1e293b" }}>sin </span>
                <span style={{ color:"#d97706", fontWeight:700 }}>{theta}°</span>
                <span style={{ color:"#1e293b" }}> = </span>
                <span style={{ color:"#1e293b", fontWeight:800 }}>{sinT.toFixed(4)}</span>
              </span>
              <span>
                <span style={{ color:"#1e293b", fontWeight:700 }}>Z</span>
                <span style={{ color:"#1e293b" }}> = </span>
                <span style={{ color:"#1e293b", fontWeight:700 }}>r</span>
                <span style={{ color:"#1e293b" }}>·sin</span>
                <span style={{ color:"#d97706", fontWeight:700 }}>{theta}°</span>
                <span style={{ color:"#1e293b" }}> = </span>
                <span style={{ color:"#1e293b" }}>{rVal} × </span>
                <span style={{ color:"#1e293b", fontWeight:700 }}>{sinT.toFixed(4)}</span>
                <span style={{ color:"#1e293b" }}> = </span>
                <span style={{ color:"#1e293b", fontWeight:900 }}>{Zval}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="math-extension-details" style={{ borderTop:"1px solid #e2e8f0" }}>
        <div
          className="math-extension-summary"
          style={{
            padding:"10px 14px",
            color:"#3730a3",
            background:"#f8fafc",
            fontSize:15,
            fontWeight:800,
          }}
        >
          ▼ 2–3단계 수학 확장: 링크 성분과 순기구학
        </div>
        <p className="lesson-note">1번의 변화량 관계를 이해한 뒤, 링크 길이와 관절각으로 확장한 계산을 아래에 바로 제시합니다.</p>
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          ② 로봇 첫 번째 팔(Link1)에 적용하기
         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div style={{ background:"white", borderTop:"2px solid #e2e8f0", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center",
          padding:"8px 14px 6px", background:"#f8fafc",
          borderBottom:"1px solid #e2e8f0", gap:8 }}>
          <div style={{ width:22, height:22, borderRadius:"50%",
            background:"#0B2D5C", display:"flex", alignItems:"center",
            justifyContent:"center", fontSize:12, fontWeight:900,
            color:"white", flexShrink:0 }}>2</div>
          <div style={{ flex:1 }}>
            <span style={{ fontSize:15, fontWeight:800, color:"#1e293b" }}>로봇 첫 번째 팔(Link1)에 적용하기</span>
          </div>
          <div style={{ background:"#e0f2fe",
            borderRadius:5, padding:"2px 8px", fontSize:13,
            color:"#0369a1", fontWeight:700, fontFamily:"inherit" }}>
            r = L₁ = 175 mm
          </div>
        </div>

        {/* 본문: SVG 좌 + 공식 우 */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
          padding:"0px 16px 0px", gap:70 }}>

          {/* 단일 링크 SVG */}
          <svg width={LW} height={LH} viewBox={`0 0 ${LW} ${LH}`}
            style={{ flex:"0 0 auto", width:LW, background:"white" }}>
            <line x1={0} y1={LOY} x2={LW-10} y2={LOY} stroke="#1e293b" strokeWidth="2"/>
            <line x1={LW-10} y1={LOY} x2={LW-20} y2={LOY-6} stroke="#1e293b" strokeWidth="2" strokeLinecap="round"/>
            <line x1={LW-10} y1={LOY} x2={LW-20} y2={LOY+6} stroke="#1e293b" strokeWidth="2" strokeLinecap="round"/>
            <text x={LW-10} y={LOY-11} fontSize="13" fill="#1e293b" fontWeight="bold">X</text>
            <line x1={LOX} y1={LOY} x2={LOX} y2={10} stroke="#1e293b" strokeWidth="2"/>
            <line x1={LOX} y1={10} x2={LOX-6} y2={20} stroke="#1e293b" strokeWidth="2" strokeLinecap="round"/>
            <line x1={LOX} y1={10} x2={LOX+6} y2={20} stroke="#1e293b" strokeWidth="2" strokeLinecap="round"/>
            <text x={LOX+8} y={18} fontSize="13" fill="#1e293b" fontWeight="bold">Z</text>
            {/* X 축 성분 점선 (빨강) */}
            <line x1={LOX} y1={LOY} x2={lrx} y2={LOY}
              stroke="#ef4444" strokeWidth="2" strokeDasharray="5 3" opacity="0.8"/>
            {/* Z 축 성분 점선 (파랑) */}
            <line x1={LOX} y1={LOY} x2={LOX} y2={lry}
              stroke="#3b82f6" strokeWidth="2" strokeDasharray="5 3" opacity="0.8"/>
            {/* 점선 사각형 — L1 감싸기 */}
            <rect x={LOX} y={Math.min(lry, LOY)} width={Math.abs(lrx-LOX)} height={Math.abs(LOY-lry)}
              fill="none" stroke="#334155" strokeWidth="1.5" strokeDasharray="6 3" opacity="0.5"/>
            {/* X 성분 레이블 */}
            <text x={(LOX+lrx)/2} y={LOY+18} fontSize="16" fill="#ef4444"
              fontWeight="700" textAnchor="middle">X</text>
            {/* Z 성분 레이블 */}
            <text x={LOX-13} y={(LOY+lry)/2} fontSize="16" fill="#3b82f6"
              fontWeight="700" textAnchor="middle" dominantBaseline="middle">Z</text>
            {/* 직각 */}
            <rect x={lrx+(cos2>=0?-8:0)} y={LOY+(sin2>=0?-8:0)} width={8} height={8}
              fill="none" stroke="#94a3b8" strokeWidth="1.2"/>
            {/* θ₁ 호 */}
            {Math.abs(deg2) > 2 && (
              <path d={`M ${LOX+24},${LOY} A 24,24 0 ${Math.abs(deg2)>=180?1:0},${deg2>=0?0:1} ${LOX+24*cos2},${LOY-24*sin2}`}
                fill="#f1f5f9" stroke="#1e293b" strokeWidth="1.5"/>
            )}
            <text x={LOX+34*Math.cos(ar2/2)} y={LOY-34*Math.sin(ar2/2)+4}
              fontSize="12" fill="#1e293b" fontWeight="bold"
              textAnchor="middle" dominantBaseline="middle">θ₁</text>
            {/* 링크 */}
            <line x1={LOX} y1={LOY} x2={lrx} y2={lry}
              stroke="#818cf8" strokeWidth="10" strokeLinecap="round" opacity="0.9"/>
            {/* L₁ 레이블 — 팔 바깥쪽 (수직 오른쪽) */}
            <text x={(LOX+lrx)/2 + sin2*18} y={(LOY+lry)/2 - cos2*18}
              fontSize="17" fill="#1e293b" fontWeight="800"
              textAnchor="middle" dominantBaseline="middle">L₁</text>
            {/* 관절 */}
            <circle cx={LOX} cy={LOY} r={6} fill="white" stroke="#1e293b" strokeWidth="1.5"/>
            <circle cx={LOX} cy={LOY} r={2} fill="#1e293b"/>
            <circle cx={lrx} cy={lry} r={5} fill="white" stroke="#1e293b" strokeWidth="1.5"/>
            <circle cx={lrx} cy={lry} r={1.8} fill="#1e293b"/>
          </svg>

          {/* 공식 박스 */}
          <div style={{ flex:"0 0 auto", width:148, display:"flex", flexDirection:"column", gap:8 }}>
            <div style={fBox("white","#94a3b8")}>
              <span style={{ color:"#1e293b" }}>X</span>
              <span style={{ color:"#1e293b" }}> = </span>
              <span style={{ color:"#1e293b", fontSize:16, fontWeight:900 }}>L₁</span>
              <span style={{ color:"#94a3b8" }}> · </span>
              <span style={{ color:"#1e293b", fontSize:15 }}>cos θ₁</span>
            </div>
            <div style={fBox("white","#94a3b8")}>
              <span style={{ color:"#1e293b" }}>Z</span>
              <span style={{ color:"#1e293b" }}> = </span>
              <span style={{ color:"#1e293b", fontSize:16, fontWeight:900 }}>L₁</span>
              <span style={{ color:"#94a3b8" }}> · </span>
              <span style={{ color:"#1e293b", fontSize:15 }}>sin θ₁</span>
            </div>
          </div>
        </div>

        {/* J2 슬라이더 + 수치 */}
        <div style={{ padding:"0 14px 11px", borderTop:"1px solid #f1f5f9" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:2 }}>
            <span style={{ fontSize:15, fontWeight:700, color:"#f59e0b",
               minWidth:24, flexShrink:0, marginLeft:6 }}>θ₁</span>
            <input type="range" min={-90} max={90} step={1}
              value={Math.round(deg2)}
              onChange={e => setJ2Link(Number(e.target.value))}
              className="theta-slider"
              style={{ flex:1, minWidth:0, cursor:"pointer",
                background:`linear-gradient(to right,#1e293b ${(deg2+90)/180*100}%,#e5e7eb ${(deg2+90)/180*100}%)` }}/>
            <span style={{ fontSize:15, fontWeight:900,
              color:"#1e293b", minWidth:52, textAlign:"right", flexShrink:0 }}>
              {deg2>=0?"+":""}{deg2.toFixed(1)}°
            </span>
            <button onClick={() => setJ2Link(null)}
              style={{ fontSize:9, color:"#1e293b", background:"none",
                border:"1px solid #94a3b8", borderRadius:5,
                cursor:"pointer", padding:"2px 7px" }}>↺</button>
            <span style={{ fontSize:14, fontWeight:700, color:"#475569", flexShrink:0, marginLeft:"auto" }}>
              cos θ₁ = <strong style={{ color:"#1e293b", fontWeight:900 }}>{cos2.toFixed(4)}</strong>
            </span>
            <span style={{ fontSize:14, fontWeight:700, color:"#475569", flexShrink:0, marginLeft:12 }}>
              sin θ₁ = <strong style={{ color:"#1e293b", fontWeight:900 }}>{sin2.toFixed(4)}</strong>
            </span>
          </div>
          <div style={{ display:"flex", gap:32, marginTop:5,
             fontSize:14, padding:"6px 10px 6px 12px", alignItems:"baseline",
             border:"1.5px solid #1e293b", borderRadius:0, background:"white" }}>
            <span>
              <span style={{ color:"#ef4444", fontWeight:800 }}>X</span>
              <span style={{ color:"#1e293b" }}> = </span>
              <span style={{ color:"#1e293b", fontWeight:800 }}>L₁</span>
              <span style={{ color:"#1e293b" }}>·cos θ₁ = </span>
              <span style={{ color:"#1e293b" }}>175 × </span>
              <span style={{ color:"#1e293b", fontWeight:700 }}>{cos2.toFixed(4)}</span>
              <span style={{ color:"#1e293b" }}> = </span>
              <span style={{ color:"#ef4444", fontWeight:800 }}>{X1} mm</span>
            </span>
            <span>
              <span style={{ color:"#3b82f6", fontWeight:800 }}>Z</span>
              <span style={{ color:"#1e293b" }}> = </span>
              <span style={{ color:"#1e293b", fontWeight:800 }}>L₁</span>
              <span style={{ color:"#1e293b" }}>·sin θ₁ = </span>
              <span style={{ color:"#1e293b" }}>175 × </span>
              <span style={{ color:"#1e293b", fontWeight:700 }}>{sin2.toFixed(4)}</span>
              <span style={{ color:"#1e293b" }}> = </span>
              <span style={{ color:"#3b82f6", fontWeight:800 }}>{Z1} mm</span>
            </span>
          </div>
        </div>
      </div>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          ③ 두 링크 조합
         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div style={{ background:"white", borderTop:"2px solid #e2e8f0", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center",
          padding:"8px 14px 6px", background:"#f8fafc",
          borderBottom:"1px solid #e2e8f0", gap:8 }}>
          <div style={{ width:22, height:22, borderRadius:"50%",
            background:"#0B2D5C", display:"flex", alignItems:"center",
            justifyContent:"center", fontSize:12, fontWeight:900,
            color:"white", flexShrink:0 }}>3</div>
          <div>
            <span style={{ fontSize:15, fontWeight:800, color:"#1e293b" }}>2링크 모델로 순기구학 공식 만들기</span>
          </div>
        </div>

        {/* 본문: SVG 좌 + 표+슬라이더 우 */}
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between",
          padding:"10px 16px 8px" }}>

          {/* 두 링크 SVG */}
          <svg width={DW} height={DH} viewBox={`0 0 ${DW} ${DH}`}
            style={{ flex:"0 0 auto", width:DW, background:"white" }}>
            {/* X 축 */}
            <line x1={0} y1={DOY} x2={DW-10} y2={DOY} stroke="#1e293b" strokeWidth="2"/>
            <line x1={DW-10} y1={DOY} x2={DW-20} y2={DOY-6} stroke="#1e293b" strokeWidth="2" strokeLinecap="round"/>
            <line x1={DW-10} y1={DOY} x2={DW-20} y2={DOY+6} stroke="#1e293b" strokeWidth="2" strokeLinecap="round"/>
            <text x={DW-10} y={DOY-11} fontSize="13" fill="#1e293b" fontWeight="bold">X</text>
            {/* Z 축 */}
            <line x1={DOX} y1={DOY} x2={DOX} y2={10} stroke="#1e293b" strokeWidth="2"/>
            <line x1={DOX} y1={10} x2={DOX-6} y2={20} stroke="#1e293b" strokeWidth="2" strokeLinecap="round"/>
            <line x1={DOX} y1={10} x2={DOX+6} y2={20} stroke="#1e293b" strokeWidth="2" strokeLinecap="round"/>
            <text x={DOX+8} y={18} fontSize="13" fill="#1e293b" fontWeight="bold">Z</text>
            {/* 링크1 X·Z 성분 투영 */}
            <line x1={DOX} y1={DOY} x2={do2x} y2={DOY}
              stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" opacity="0.7"/>
            <line x1={DOX} y1={DOY} x2={DOX} y2={do2y}
              stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" opacity="0.7"/>
            <line x1={do2x} y1={DOY} x2={do2x} y2={do2y}
              stroke="#94a3b8" strokeWidth="1" strokeDasharray="5 3" opacity="0.4"/>
            <line x1={DOX} y1={do2y} x2={do2x} y2={do2y}
              stroke="#94a3b8" strokeWidth="1" strokeDasharray="5 3" opacity="0.4"/>
            {/* 링크2 X·Z 성분 투영 */}
            <line x1={do2x} y1={do2y} x2={dtcx} y2={do2y}
              stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" opacity="0.55"/>
            <line x1={do2x} y1={do2y} x2={do2x} y2={dtcy}
              stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" opacity="0.55"/>
            <line x1={dtcx} y1={do2y} x2={dtcx} y2={dtcy}
              stroke="#94a3b8" strokeWidth="1" strokeDasharray="5 3" opacity="0.35"/>
            {/* θ₁ 호 (채움) */}
            {Math.abs(dA) > 2 && (
              <path d={`M ${DOX+24},${DOY} A 24,24 0 ${Math.abs(dA)>=180?1:0},${dA>=0?0:1} ${DOX+24*cosA},${DOY-24*sinA}`}
                fill="#f1f5f9" stroke="#1e293b" strokeWidth="1.5"/>
            )}
            <text x={DOX+36*Math.cos(rA/2)} y={DOY-36*Math.sin(rA/2)+4}
              fontSize="15" fill="#1e293b" fontWeight="bold"
              textAnchor="middle" dominantBaseline="middle">θ₁</text>
            {/* 관절2 수평 연장선 */}
            <line x1={do2x} y1={do2y} x2={do2x+32} y2={do2y}
              stroke="#94a3b8" strokeWidth="1.2" strokeDasharray="4 2" opacity="0.9"/>
            {/* θ₁+θ₂ 호 (절대각, 수평→L₂) */}
            {Math.abs(dA+dB) > 2 && (
              <path d={`M ${do2x+22},${do2y} A 22,22 0 ${Math.abs(dA+dB)>=180?1:0},${(dA+dB)>=0?0:1} ${do2x+22*cosAB},${do2y-22*sinAB}`}
                fill="#f1f5f9" stroke="#1e293b" strokeWidth="1.5"/>
            )}
            <text x={do2x+36*Math.cos(rAB/2)} y={do2y-36*Math.sin(rAB/2)+4}
              fontSize="13" fill="#1e293b" fontWeight="bold"
              textAnchor="middle" dominantBaseline="middle">θ₁+θ₂</text>
            {/* L₂ 직각 마커 */}
            <rect x={dtcx+(cosAB>=0?-8:0)} y={do2y+(sinAB>=0?-8:0)} width={8} height={8}
              fill="none" stroke="#94a3b8" strokeWidth="1.2"/>
            {/* 링크1 */}
            <line x1={DOX} y1={DOY} x2={do2x} y2={do2y}
              stroke={C.j2} strokeWidth="10" strokeLinecap="round" opacity="0.9"/>
            <text x={(DOX+do2x)/2 + sinA*18} y={(DOY+do2y)/2 - cosA*18}
              fontSize="17" fill={T.j2} fontWeight="800"
              textAnchor="middle" dominantBaseline="middle">L₁</text>
            {/* 링크2 */}
            <line x1={do2x} y1={do2y} x2={dtcx} y2={dtcy}
              stroke={C.j3} strokeWidth="10" strokeLinecap="round" opacity="0.9"/>
            <text x={(do2x+dtcx)/2 + sinAB*18} y={(do2y+dtcy)/2 - cosAB*18}
              fontSize="17" fill={T.j3} fontWeight="800"
              textAnchor="middle" dominantBaseline="middle">L₂</text>
            {/* O1 관절 */}
            <circle cx={DOX} cy={DOY} r={6} fill="white" stroke="#1e293b" strokeWidth="1.5"/>
            <circle cx={DOX} cy={DOY} r={2} fill="#1e293b"/>
            <text x={DOX-2} y={DOY+14} fontSize="12" fill="#1e293b" fontWeight="bold"
              textAnchor="middle">O1</text>
            {/* 중간 관절 — P₁ */}
            <circle cx={do2x} cy={do2y} r={6} fill="white" stroke={T.j2} strokeWidth="2"/>
            <circle cx={do2x} cy={do2y} r={2.5} fill={T.j2}/>
            <text x={do2x+(cosA>=0?-5:5)} y={do2y+17}
              fontSize="11.5" fill={T.j2} fontWeight="800"
              textAnchor={cosA>=0?"end":"start"}>P₁(X₁,Z₁)</text>
            {/* TCP — P₂ */}
            <circle cx={dtcx} cy={dtcy} r={6} fill="white" stroke={T.j3} strokeWidth="2"/>
            <circle cx={dtcx} cy={dtcy} r={2.5} fill={T.j3}/>
            <text x={dtcx+(cosAB>=0?8:-8)} y={dtcy-8}
              fontSize="11.5" fill={T.j3} fontWeight="800"
              textAnchor={cosAB>=0?"start":"end"}>P₂(X₂,Z₂)</text>
          </svg>

          {/* 오른쪽: 성분 표 + 슬라이더 */}
          <div style={{ flex:1, minWidth:200, maxWidth:250, display:"flex", flexDirection:"column", gap:8 }}>
            {/* 성분 분해 표 */}
            <div style={{ borderRadius:0, border:"1.5px solid #94a3b8",
              overflow:"hidden", fontSize:12,
              display:"grid", gridTemplateColumns:"1fr 1fr" }}>
              {/* 헤더 행 */}
              <div style={{ padding:"5px 7px", color:"#1e293b", fontWeight:800, fontSize:14,
                textAlign:"center", background:"#f8fafc",
                borderBottom:"1.5px solid #94a3b8" }}>X 성분</div>
              <div style={{ padding:"5px 7px", color:"#1e293b", fontWeight:800, fontSize:14,
                textAlign:"center", background:"#f8fafc",
                borderBottom:"1.5px solid #94a3b8", borderLeft:"1.5px solid #94a3b8" }}>Z 성분</div>
              {/* L₁ 행 */}
              <div style={{ padding:"7px 7px", color:"#1e293b", fontSize:14, fontWeight:800,
                textAlign:"center", background:"white" }}>L₁·cosθ₁</div>
              <div style={{ padding:"7px 7px", color:"#1e293b", fontSize:14, fontWeight:800,
                textAlign:"center", background:"white", borderLeft:"1.5px solid #94a3b8" }}>L₁·sinθ₁</div>
              {/* L₂ 행 */}
              <div style={{ padding:"7px 7px", color:"#1e293b", fontSize:14, fontWeight:800,
                textAlign:"center", background:"#fafafa", borderTop:"1.5px solid #94a3b8" }}>L₂·cos(θ₁+θ₂)</div>
              <div style={{ padding:"7px 7px", color:"#1e293b", fontSize:14, fontWeight:800,
                textAlign:"center", background:"#fafafa",
                borderTop:"1.5px solid #94a3b8", borderLeft:"1.5px solid #94a3b8" }}>L₂·sin(θ₁+θ₂)</div>
            </div>

            {/* J2·J3 슬라이더 */}
            {([["θ₁", dA, setJ2c, C.j2], ["θ₂", dB, setJ3c, C.j3]] as const).map(
              ([label, val, setter, col]) => (
                <div key={label} style={{ display:"flex", alignItems:"center", gap:5 }}>
                  <span style={{ fontSize:13, fontWeight:700, color:"#1e293b",
                     minWidth:26 }}>{label}</span>
                  <input type="range" min={-90} max={90} step={1}
                    value={Math.round(val as number)}
                    onChange={e => (setter as (v:number|null)=>void)(Number(e.target.value))}
                    style={{ flex:1, accentColor:col as string, cursor:"pointer" }}/>
                  <span style={{ fontSize:14, fontWeight:900,
                    color:"#1e293b", minWidth:50, textAlign:"right" }}>
                    {(val as number)>=0?"+":""}{(val as number).toFixed(1)}°
                  </span>
                </div>
              )
            )}
            <button onClick={() => { setJ2c(null); setJ3c(null); }}
              style={{ fontSize:12, color:"#1e293b", background:"none",
                border:"1px solid #94a3b8", borderRadius:5,
                cursor:"pointer", padding:"4px 0", width:"100%" }}>
              ↺ 로봇 동기화
            </button>
          </div>
        </div>

        {/* P₁ / P₂ 좌표값 박스 */}
        <div style={{ margin:"0 12px 12px", display:"flex", gap:8 }}>
          <div style={{ flex:1, borderRadius:0, border:`1.5px solid ${T.j2}`,
            background:"white", padding:"5px 12px" }}>
            <span style={{ color:T.j2, fontWeight:900, fontSize:13 }}>P₁</span>
            <span style={{ color:"#1e293b", fontSize:12 }}> = (X₁, Z₁) = (</span>
            <span style={{ color:T.j2, fontWeight:800, fontSize:13 }}>{l1x.toFixed(1)}</span>
            <span style={{ color:"#1e293b", fontSize:12 }}>, </span>
            <span style={{ color:T.j2, fontWeight:800, fontSize:13 }}>{l1z.toFixed(1)}</span>
            <span style={{ color:"#1e293b", fontSize:12 }}>) mm</span>
          </div>
          <div style={{ flex:1, borderRadius:0, border:`1.5px solid ${T.j3}`,
            background:"white", padding:"5px 12px" }}>
            <span style={{ color:T.j3, fontWeight:900, fontSize:13 }}>P₂</span>
            <span style={{ color:"#1e293b", fontSize:12 }}> = (X₂, Z₂) = (</span>
            <span style={{ color:T.j3, fontWeight:800, fontSize:13 }}>{Xt}</span>
            <span style={{ color:"#1e293b", fontSize:12 }}>, </span>
            <span style={{ color:T.j3, fontWeight:800, fontSize:13 }}>{Zt}</span>
            <span style={{ color:"#1e293b", fontSize:12 }}>) mm</span>
          </div>
        </div>

      </div>
      </div>

    </div>
  );
}

export function BasicMath({
  coords,
  joints: _joints,
  onBack,
  onJogStart,
  onJogStop,
  onJointStart: _onJointStart,
  onCoordSet,
  onHighlightLinks,
  onStartCoordinates,
  onMathFocusChange,
  onCorrectMove,
  startPointMotion,
  onCancelMove,
  hardwareMode,
  onMathCoachChange,
  mathHintStep,
  onMathHintStepChange,
}: {
  coords: Coords;
  joints: Joints;
  onBack: () => void;
  onJogStart: (axis: "x"|"y"|"z"|"r", dir: 1|-1) => void;
  onJogStop: () => void;
  onJointStart: (joint: "j1"|"j2"|"j3"|"j4", dir: 1|-1) => void;
  onCoordSet?: (axis: "x"|"y"|"z"|"r", v: number) => boolean;
  onHighlightLinks?: (hl: {l1:boolean;l2:boolean}|null) => void;
  onStartCoordinates?:()=>void;
  onCorrectMove?: FoundationMove;
  startPointMotion?: MotionProps;
  onCancelMove?: () => void;
  hardwareMode?: boolean;
  onMathFocusChange?: (focus: {
    active: true;
    startZ?: number;
    targetZ?: number;
    phase: "concept" | "predict" | "review";
    taskIndex: number;
    title: string;
    guideTitle?: string;
    guideBody?: string;
    weekLabel?: string;
  } | null) => void;
  onMathCoachChange?: (coach: { tone: "success" | "guide"; title: string; body: string; next: string } | null) => void;
  mathHintStep?: number;
  onMathHintStepChange?: (step: number) => void;
}) {
  void onBack;
  void _onJointStart;

  const [activeSubTab, setActiveSubTab] = useState<"start" | "fk" | "rotmat">("start");
  useEffect(() => {
    if (activeSubTab !== "start") {
      onMathFocusChange?.(null);
      onMathHintStepChange?.(0);
    }
  }, [activeSubTab, onMathFocusChange, onMathHintStepChange]);

  const { x, y, z } = coords;
  const { j2, j3 } = _joints;

  const projection = basicMathProjection(_joints);
  const fkX = projection.rho, fkZ = projection.height;
  const dispX = projection.x, dispZ = projection.z;
  void x; void y; void z;

  return (
    <div className="flex flex-col shrink-0 overflow-hidden h-full"
      style={{ width:"100%", background:"#ffffff", borderLeft:"2px solid #e5e7eb",
        fontFamily:"'Pretendard', -apple-system, 'Apple SD Gothic Neo', sans-serif" }}>

      {/* 헤더 */}
      <div className="shrink-0"
        style={{ borderBottom:"1px solid #ddd6fe", background:"#ede9fe",
          padding:"8px 0", textAlign:"center" }}>
        <span style={{ fontSize:18, fontWeight:800, color:"#3730a3",
          letterSpacing:"0.02em", lineHeight:1 }}>용어·기호와 기초수학</span>
      </div>

      {/* 서브탭 바 — 헤더 바로 아래 */}
      <div className="shrink-0" style={{ display:"flex", borderBottom:"2px solid #c7d2fe", background:"#eef2ff" }}>
        {([ ["start", "1.", "핵심 문제"], ["rotmat", "2.", "링크 성분"], ["fk", "3.", "순기구학 확장"] ] as const).map(([id, num, label]) => (
          <button key={id} onClick={() => setActiveSubTab(id)}
            style={{
              flex:1, padding:"8px 4px", fontSize:13, fontWeight:700,
              letterSpacing:"0.02em", cursor:"pointer", border:"none",
              borderRadius:0,
              background: activeSubTab === id ? "#4f46e5" : "transparent",
              color: activeSubTab === id ? "#ffffff" : "#4338ca",
              borderBottom: activeSubTab === id ? "2px solid #4f46e5" : "2px solid transparent",
              marginBottom:"-2px",
              transition:"all 0.15s ease",
              display:"flex", alignItems:"center", justifyContent:"center", gap:5,
            }}>
            <span style={{ fontSize:16, lineHeight:1 }}>{num}</span>
            <span style={{ fontSize:14 }}>{label}</span>
          </button>
        ))}
      </div>

      {/* ── 서브탭 콘텐츠 ── */}
      {activeSubTab === "start" ? <MathStartLesson startPointMotion={startPointMotion} onCorrectMove={onCorrectMove} onCancelMove={onCancelMove} hardwareMode={hardwareMode} onStartCoordinates={onStartCoordinates} onFocusChange={onMathFocusChange} onCoachChange={onMathCoachChange} hintStep={mathHintStep} onHintStepChange={onMathHintStepChange}/> : activeSubTab === "fk" ? (
        <>
          {/* 2D 다이어그램 — 순기구학 탭에서만 */}
          <div style={{ flex:1, overflow:"hidden", padding:"4px 0 2px", minHeight:0 }}>
            <LargeKinematicView coords={coords} joints={_joints} onJogStart={onJogStart} onJogStop={onJogStop} onCoordSet={onCoordSet} />
          </div>
          {/* FK 공식 */}
          <div style={{ flexShrink:0, padding:0, lineHeight:1.3,
            fontFamily:"'Pretendard',-apple-system,'Apple SD Gothic Neo',sans-serif" }}>
            <div style={{ fontSize:15, fontWeight:700, color:"#111827", letterSpacing:"0.08em",
              textTransform:"uppercase", marginBottom:1,
              background:"#f1f5f9", padding:"3px 14px", borderTop:"1px solid #e2e8f0", borderBottom:"1px solid #e2e8f0" }}>순기구학 공식 (Forward Kinematics)</div>
            <div style={{ display:"flex", flexDirection:"column", gap:0, paddingLeft:24 }}>
              <div style={{ fontSize:17, color:"#111827" }}>
                <span style={{ color:T.x, fontWeight:700 }}>ρ</span>
                <span style={{ color:"#6b7280" }}> = </span>
                <span style={{ color:T.l1, fontWeight:600 }}>L₁</span>
                <span style={{ color:"#6b7280" }}>·cos </span>
                <span style={{ color:T.j2, fontWeight:600 }}>θ₁</span>
                <span style={{ color:"#6b7280" }}> + </span>
                <span style={{ color:T.l2, fontWeight:600 }}>L₂</span>
                <span style={{ color:"#6b7280" }}>·cos(</span>
                <span style={{ color:T.j2, fontWeight:600 }}>θ₁</span>
                <span style={{ color:T.j3, fontWeight:600 }}>+θ₂</span>
                <span style={{ color:"#6b7280" }}>)</span>
                <span style={{ color:"#64748b", fontSize:11, marginLeft:6 }}>수평 성분 합</span>
              </div>
              <div style={{ fontSize:15, color:"#555" }} aria-label="베이스 회전을 반영한 좌표식">
                <b style={{ color:T.x }}>x</b> = ρ·cos φ + offsetₓ&nbsp; · &nbsp;<b style={{ color:T.y }}>y</b> = ρ·sin φ
              </div>
              <div style={{ fontSize:17, color:"#111827" }}>
                <span style={{ color:"#2563eb", fontWeight:700 }}>z</span>
                <span style={{ color:"#6b7280" }}> = </span>
                <span style={{ color:T.l1, fontWeight:600 }}>L₁</span>
                <span style={{ color:"#6b7280" }}>·sin </span>
                <span style={{ color:T.j2, fontWeight:600 }}>θ₁</span>
                <span style={{ color:"#6b7280" }}> + </span>
                <span style={{ color:T.l2, fontWeight:600 }}>L₂</span>
                <span style={{ color:"#6b7280" }}>·sin(</span>
                <span style={{ color:T.j2, fontWeight:600 }}>θ₁</span>
                <span style={{ color:T.j3, fontWeight:600 }}>+θ₂</span>
                <span style={{ color:"#6b7280" }}>) + offset</span>
                <span style={{ color:"#6b7280", fontSize:11 }}>z</span>
              </div>
            </div>
          </div>
          <div style={{ flexShrink:0, borderTop:"1.5px solid #e5e7eb", margin:0 }}/>

          {/* 수식 패널 (하단) */}
          <div className="shrink-0 px-3 pb-1 flex flex-col">
            <div style={{ background:"#ffffff", display:"flex", flexDirection:"column", gap:3, padding:"4px 2px 2px", lineHeight:1.3 }}>

              {/* 현재 각도 */}
              <div style={{ display:"flex", alignItems:"baseline", gap:10, flexWrap:"wrap" }}>
                <span style={{ fontSize:14, textTransform:"uppercase", letterSpacing:"0.06em", fontWeight:700, color:"#111827", flexShrink:0, minWidth:72 }}>현재 각도</span>
                <Eq parts={[
                  { text:"θ₁", color:T.j2, bold:true },
                  { text:" = ", color:T.op },
                  { text:j2.toFixed(1)+"°", color:T.j2 },
                ]}/>
                <Eq parts={[
                  { text:"θ₂", color:T.j3, bold:true },
                  { text:" = ", color:T.op },
                  { text:j3.toFixed(1)+"°", color:T.j3 },
                ]}/>
                <Eq parts={[
                  { text:"θ₁+θ₂", color:"#7c3aed", bold:true },
                  { text:" = ", color:T.op },
                  { text:(j2+j3).toFixed(1)+"°", color:"#7c3aed" },
                ]}/>
              </div>

              {/* 베이스 회전을 반영한 X/Y 계산 */}
              <div style={{ display:"flex", alignItems:"flex-start", gap:10 }} aria-label="현재 X와 Y 계산">
                <span style={{ fontSize:14, fontWeight:700, color:"#111827", flexShrink:0, paddingTop:2, minWidth:72 }}>x·y 계산</span>
                <div>
                  <EqRow><Eq parts={[
                    { text:"x", color:T.x, bold:true }, { text:" = " },
                    { text:fkX.toFixed(1), color:T.sub }, { text:"·cos(" },
                    { text:projection.base.toFixed(1)+"°", color:T.j1 },
                    { text:") + 162.124" },
                  ]}/></EqRow>
                  <EqRow indent={1}><Eq parts={[
                    { text:"= " }, { text:dispX.toFixed(1)+" mm", color:T.x, bold:true },
                  ]}/></EqRow>
                  <EqRow><Eq parts={[
                    { text:"y", color:T.y, bold:true }, { text:" = " },
                    { text:fkX.toFixed(1), color:T.sub }, { text:"·sin(" },
                    { text:projection.base.toFixed(1)+"°", color:T.j1 },
                    { text:") = " }, { text:projection.y.toFixed(1)+" mm", color:T.y, bold:true },
                  ]}/></EqRow>
                </div>
              </div>

              {/* z 계산 */}
              <div style={{ display:"flex", alignItems:"flex-start", gap:10 }}>
                <span style={{ fontSize:14, textTransform:"uppercase", letterSpacing:"0.06em", fontWeight:700, color:"#111827", flexShrink:0, paddingTop:2, minWidth:72 }}>z 계산</span>
                <div>
                  <EqRow>
                    <Eq parts={[
                      { text:"z", color:"#2563eb", bold:true },
                      { text:" = " },
                      { text:"175", color:T.l1 },
                      { text:"·sin(", color:T.op },
                      { text:j2.toFixed(1)+"°", color:T.j2 },
                      { text:") + ", color:T.op },
                      { text:"175", color:T.l2 },
                      { text:"·sin(", color:T.op },
                      { text:(j2+j3).toFixed(1)+"°", color:"#7c3aed" },
                      { text:")", color:T.op },
                    ]}/>
                  </EqRow>
                  <EqRow indent={1}>
                    <Eq parts={[
                      { text:"= " },
                      { text:fkZ.toFixed(1), color:T.sub },
                      { text:" − 41.2 (오프셋)", color:T.dim },
                    ]}/>
                  </EqRow>
                  <EqRow indent={1}>
                    <Eq parts={[
                      { text:"= " },
                      { text:dispZ.toFixed(1)+" mm", color:"#2563eb", bold:true },
                      { text:"  ✓", color:"#16a34a" },
                    ]}/>
                  </EqRow>
                </div>
              </div>

            </div>
          </div>
        </>
      ) : (
        <BasicConceptsTab joints={_joints} coords={coords} onHighlightLinks={onHighlightLinks} />
      )}
    </div>
  );
}

