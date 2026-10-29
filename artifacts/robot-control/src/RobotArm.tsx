import { PAPER_RECTANGLE_TITLES } from "./paperRectangleTask";
import type { PaperRectangleLevel } from "./paperCoordinateStudy";
import { SquareObservedDiagram } from "./SquareComparisonView";
import { useSquareVisual } from "./useSquareVisual";
import { MeasurementFeedbackReview, registerMeasurementReview } from "./MeasurementFeedbackReview";
import { TaskStartPoint, moveVirtualTaskStart } from "./TaskStartPoint";
import { MathInquiryPanel, useMathInquiry } from "./MathInquiry";
import { learningRecordContext } from "./learningFramework";
import { measurementHint } from "./measurementFeedback";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ShapeLessonSteps } from "./ShapeLessonSteps";
import { LessonCoursePath } from "./LessonCoursePath";
import { getShapeLesson, SHAPE_LESSON_COUNT, shapeLessonFields, shapeLessonExpected, shapeLessonStudentPoints, shapeLessonStudentPreview, shapePlanningFocus, shapeLessonTargetPath, shapeLessonProgramPath, shapeLessonMatchesTarget, hasCompleteShapePlan } from "./shapeLearning";
import type { ShapeLesson } from "./shapeLearning";
import { assessSquare, squareStudentSequence, squareExecutionKey, squareAnswersUnchanged, squarePlanMatchesTarget } from "./squareLearningFlow";
import { SquareContinuation, type SquareContinuationPhase } from "./squareContinuation";
import type { LearningVisualState } from "./Robot3D";
import { copyShapePose, measureShapeClosure, prepareShapeMotion, sampleShapeMotion, prepareShapeReturn, sampleShapeReturn, ShapeFrameScheduler } from "./shapeRun";
import type { ShapeClosure, ShapeMotion, ShapePoseSnapshot, ShapeReturn, ShapeRunPhase } from "./shapeRun";
import { usePractice } from "./PracticeProvider";
import { PaperCoordinateStudy } from "./PaperCoordinateStudy";
import { downloadEvidence, readEvidence, writeEvidence } from "./learningEvidenceStorage";
import { getEvidenceItem, setEvidenceItem } from "./learningSync";
import type { SquareObservedVertex } from "./squareMismatchDiagnosis";

interface Joints { j1: number; j2: number; j3: number; j4: number; }
interface Coords { x: number; y: number; z: number; r: number; }
type MissionStatus = "idle" | "running" | "done";
type StepType = "MoveJ" | "MoveL" | "MoveC" | "GRIP" | "RELEASE";
type ShapeType = "사각형" | "삼각형" | "동그라미";
type RunKind = "hardware" | "legacy";
type MeasurementSource = "hardware" | "virtual" | null;
type SupportMode = "guided" | "challenge";

interface SeqStep {
  type: StepType;
  label: string;
  coords?: Coords;
  via?: Coords;
}

interface WaypointMeasurement {
  label: string;
  target: Coords;
  actual: Coords;
  source?: "hardware" | "mock";
  seq?: number;
  measuredAt?: number;
  ageMs?: number;
  errorX: number;
  errorY: number;
  errorZ: number;
  distanceError: number;
  durationMs: number;
}

const FONT = "'Pretendard',-apple-system,'Apple SD Gothic Neo',sans-serif";

const TYPE_COLOR: Record<StepType, { bg: string; text: string }> = {
  MoveJ:   { bg: "#4f46e5", text: "#fff" },
  MoveL:   { bg: "#0891b2", text: "#fff" },
  MoveC:   { bg: "#7c3aed", text: "#fff" },
  GRIP:    { bg: "#d97706", text: "#fff" },
  RELEASE: { bg: "#6b7280", text: "#fff" },
};

const PICK_SEQ: SeqStep[] = [
  { type:"MoveJ",   label:"블록 상단 접근   X280  Y0    Z40",  coords:{x:280,y:0,z:40,r:0} },
  { type:"MoveL",   label:"블록 하강        X280  Y0    Z−10", coords:{x:280,y:0,z:-10,r:0} },
  { type:"GRIP",    label:"흡착 ON" },
  { type:"MoveL",   label:"들어올리기       X280  Y0    Z40",  coords:{x:280,y:0,z:40,r:0} },
  { type:"MoveJ",   label:"목표 위치 이동   X280  Y−80  Z40",  coords:{x:280,y:-80,z:40,r:0} },
  { type:"MoveL",   label:"내려놓기         X280  Y−80  Z−10", coords:{x:280,y:-80,z:-10,r:0} },
  { type:"RELEASE", label:"흡착 OFF" },
  { type:"MoveL",   label:"복귀             X280  Y−80  Z40",  coords:{x:280,y:-80,z:40,r:0} },
];

/* ─── Shape diagram (generic) ─────────────────────────── */
function ShapeDiagram({ seq, currentStep, status, shapeType, measuredPath = [] }: {
  seq: SeqStep[]; currentStep: number; status: MissionStatus; shapeType: ShapeType;
  measuredPath?: Coords[];
}) {
  const comparison=useSquareVisual();
  if(shapeType==="사각형"&&comparison.visual&&comparison.visual.stage>=5&&comparison.visual.stage<=6)return <SquareObservedDiagram/>;
  const W = 340, H = 160, padding = 22;
  const waypoints = seq.map((step, index) => ({ step, index }))
    .filter(item => item.step.coords && Number.isFinite(item.step.coords.x) && Number.isFinite(item.step.coords.y));
  if (!waypoints.length) return null;
  const pts = waypoints.map(item => item.step.coords!);
  // Sample each actual MoveC through its edited via point; straight links only summarize other commands.
  const segments = waypoints.slice(1).map((item, index) => ({
    step: item.index,
    points: shapeLessonTargetPath({ sequence: [waypoints[index].step, item.step] } as ShapeLesson),
  }));
  const allPoints = [...pts, ...segments.flatMap(segment => segment.points), ...measuredPath]
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  const minX = Math.min(...allPoints.map(point => point.x)), maxX = Math.max(...allPoints.map(point => point.x));
  const minY = Math.min(...allPoints.map(point => point.y)), maxY = Math.max(...allPoints.map(point => point.y));
  const scale = Math.min((W - padding * 2) / Math.max(1, maxX - minX), (H - padding * 2) / Math.max(1, maxY - minY));
  const sx = (x:number) => W / 2 + (x - (minX + maxX) / 2) * scale;
  const sy = (y:number) => H / 2 - (y - (minY + maxY) / 2) * scale;
  const first = pts[0], last = pts[pts.length - 1];
  const closed = pts.length > 1 && Math.hypot(last.x - first.x, last.y - first.y, last.z - first.z) < 0.1;
  const dots = (closed ? waypoints.slice(0, -1) : waypoints).slice(0, 4);
  const hasJointEdges = waypoints.slice(1).some(item => item.step.type === "MoveJ");
  const caption = shapeType === "동그라미" ? "명령 좌표·원호 개략도" : "명령 좌표 개략도";
  const colorAt = (step:number) => status === "running" && currentStep === step
    ? "#4f46e5" : status === "done" || (status === "running" && currentStep > step) ? "#16a34a" : "#374151";

  return <figure style={{margin:0,flexShrink:0}}>
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
      aria-label={`${shapeType} ${caption}, ${closed ? "닫힌 경로" : "열린 경로"}`}
      style={{display:"block",margin:"0 auto",maxWidth:"100%",overflow:"visible"}}>
      <title>{shapeType} {caption}</title>
      {measuredPath.length > 1 && <polyline
        points={measuredPath.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)).map(point => `${sx(point.x)},${sy(point.y)}`).join(" ")}
        fill="none" stroke="#f97316" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.9}
      />}
      {segments.map((segment, index) => {
        if (segment.points.length < 2) return null;
        const active = status === "running" && currentStep === segment.step;
        const stroke = colorAt(segment.step);
        const middle = Math.floor((segment.points.length - 1) / 2);
        const before = segment.points[Math.max(0, middle - 1)], after = segment.points[Math.min(segment.points.length - 1, middle + 1)];
        const center = segment.points.length === 2
          ? { x: (before.x + after.x) / 2, y: (before.y + after.y) / 2 }
          : segment.points[middle];
        const angle = Math.atan2(sy(after.y) - sy(before.y), sx(after.x) - sx(before.x)) * 180 / Math.PI;
        return <g key={index}>
          <polyline points={segment.points.map(point => `${sx(point.x)},${sy(point.y)}`).join(" ")}
            fill="none" stroke={stroke} strokeWidth={active ? 3 : 2}
            strokeDasharray={active ? "6 3" : undefined} strokeLinejoin="round"/>
          <path d="M-4,-4 L4,0 L-4,4 Z" fill={stroke}
            transform={`translate(${sx(center.x)},${sy(center.y)}) rotate(${angle})`}/>
        </g>;
      })}
      {dots.map((item, index) => {
        const point = item.step.coords!, fill = colorAt(item.index);
        return <g key={item.index}>
          <circle cx={sx(point.x)} cy={sy(point.y)} r={11} fill={fill}/>
          <text x={sx(point.x)} y={sy(point.y) + 4} textAnchor="middle" fill="#fff" fontSize={10} fontWeight="700">P{index + 1}</text>
        </g>;
      })}
      {!closed && waypoints.length > 4 && <circle cx={sx(last.x)} cy={sy(last.y)} r={4} fill={colorAt(waypoints[waypoints.length - 1].index)}/>}
    </svg>
    <figcaption style={{fontSize:11,lineHeight:1.6,color:"#64748b",textAlign:"center",marginTop:5}}>
      {caption} · {closed ? "닫힌 경로" : "열린 경로"}
      {hasJointEdges && <div>직선 연결은 좌표 개략도 · MoveJ의 실제 궤적은 실행에서 확인</div>}
    </figcaption>
  </figure>;
}

/* ─── Shape selector dropdown ─────────────────────────── */
const SHAPE_ICONS: Record<ShapeType,string> = { "사각형":"□", "삼각형":"△", "동그라미":"○" };

function ShapeSelector({ value, onChange, disabled }: {
  value: ShapeType; onChange:(s:ShapeType)=>void; disabled:boolean;
}) {
  return (
    <span style={{ display:"inline-flex", borderRadius:6, overflow:"hidden", border:"1.5px solid #c4b5fd", verticalAlign:"middle" }}>
      {(["사각형","삼각형","동그라미"] as ShapeType[]).map(s=>(
        <button key={s} onClick={()=>{ if(!disabled) onChange(s); }}
          disabled={disabled}
          style={{
            display:"inline-flex", alignItems:"center", gap:4,
            padding:"2px 10px", border:"none", cursor:disabled?"default":"pointer",
            background: s===value?"#4f46e5":"transparent",
            color: s===value?"#fff":"#4338ca",
            fontSize:12, fontWeight:700,
            transition:"all 0.15s ease",
            borderRight: s!=="동그라미" ? "1px solid #c4b5fd" : "none",
          }}>
          <span style={{fontSize:12}}>{SHAPE_ICONS[s]}</span>
          <span>{s === "동그라미" ? "원" : s}</span>
        </button>
      ))}
    </span>
  );
}

/* ─── Tray visualization ──────────────────────────────── */
function TrayView({ gripActive, missionDone }: { gripActive: boolean; missionDone: boolean }) {
  const cell = 44, gap = 5;
  const cols = 3, rows = 3;
  const W = cols*(cell+gap)-gap+20, H = rows*(cell+gap)-gap+20;

  const blocks = [
    { row:0, col:1, color:"#3b82f6", letter:"B", isTarget:false },
    { row:1, col:1, color:"#7c3aed", letter:"P", isTarget:false },
    { row:2, col: missionDone ? 0 : 1, color:"#ef4444", letter:"R", isTarget:true },
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
      <div style={{ fontSize:11, color:"#9ca3af", letterSpacing:"0.05em", fontWeight:600 }}>
        ▼ 트레이 (위에서 본 모습)
      </div>
      <svg width={W} height={H}>
        {Array.from({length:rows},(_,r)=>Array.from({length:cols},(_,c)=>{
          const x = 10+c*(cell+gap), y = 10+r*(cell+gap);
          return <rect key={`${r}-${c}`} x={x} y={y} width={cell} height={cell}
            rx={5} fill="#f8fafc" stroke="#cbd5e1" strokeWidth={1.5}/>;
        }))}
        {blocks.map(({row,col,color,letter,isTarget})=>{
          const x=10+col*(cell+gap), y=10+row*(cell+gap);
          const faded = gripActive && isTarget;
          return (
            <g key={letter}>
              <rect x={x+4} y={y+4} width={cell-8} height={cell-8}
                rx={4} fill={color} opacity={faded ? 0.3 : 1}
                style={{ transition:"all 0.4s ease" }}/>
              <text x={x+cell/2} y={y+cell/2+5} textAnchor="middle"
                fill="white" fontSize={13} fontWeight="800">{letter}</text>
            </g>
          );
        })}
        {!missionDone && (
          <rect x={10+0*(cell+gap)+4} y={10+2*(cell+gap)+4}
            width={cell-8} height={cell-8} rx={4}
            fill="none" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="5 3"/>
        )}
        <text x={10+0*(cell+gap)+cell/2} y={10+2*(cell+gap)+cell/2+5}
          textAnchor="middle" fill="#ef4444" fontSize={9}>목표</text>
      </svg>
      <div style={{ fontSize:10, color:"#9ca3af" }}>
        R(빨강) → 목표 위치로 이동
      </div>
    </div>
  );
}

/* ─── Step list ───────────────────────────────────────── */
const COORD_RANGES = { x:[150,350], y:[-150,150], z:[-150,150] } as const;
const displayCoordinate = (value:number) => String(Number(value.toFixed(3)));

function CoordInput({ val, field, disabled, onChange }: {
  val: number; field:'x'|'y'|'z'; disabled: boolean;
  onChange:(v:number)=>void;
}) {
  const [raw, setRaw] = useState(displayCoordinate(val));
  useEffect(() => { setRaw(displayCoordinate(val)); }, [val]);
  const [lo, hi] = COORD_RANGES[field];
  const outOfRange = val < lo || val > hi;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:3, flexShrink:0 }}>
      <span style={{ fontSize:13, color:"#1e293b", fontFamily:FONT, fontWeight:800 }}>
        {field.toUpperCase()}
      </span>
      <input
        type="number"
        value={raw}
        disabled={disabled}
        onChange={e => { setRaw(e.target.value); const n=Number(e.target.value); if(!isNaN(n)) onChange(n); }}
        onBlur={() => setRaw(displayCoordinate(val))}
        style={{
          width:70, padding:"1px 6px", fontSize:14,
          fontFamily:FONT,
          border: outOfRange ? "1.5px solid #ef4444" : "1px solid #d1d5db",
          borderRadius:7,
          background: disabled ? "#f3f4f6" : outOfRange ? "#fef2f2" : "#fff",
          color: outOfRange ? "#dc2626" : "#1e293b",
          textAlign:"center",
          cursor: disabled ? "not-allowed" : "text",
        }}
      />
    </div>
  );
}

function waypointLabel(step: SeqStep) {
  return step.label.match(/→\s*(P\d+)/)?.[1] ?? step.label.split(/\s+/)[0];
}

function StepList({ seq, currentStep, status, onToggleType, onEditCoord, lockZ = false, editableWhenDone = false }: {
  seq: SeqStep[]; currentStep: number; status: MissionStatus;
  onToggleType?: (i: number) => void;
  onEditCoord?: (i: number, field: 'x'|'y'|'z', val: number) => void;
  lockZ?: boolean;
  editableWhenDone?: boolean;
}) {
  const canEdit = (status === "idle" || editableWhenDone && status === "done") && !!onEditCoord;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      {seq.map((step, i) => {
        const isDone = status !== "idle" && i < currentStep;
        const isActive = i === currentStep && status === "running";
        const tc = TYPE_COLOR[step.type];
        const canToggle = !!onToggleType && status === "idle" && (step.type === "MoveJ" || step.type === "MoveL");
        const hasCoords = !!step.coords && step.type !== "GRIP" && step.type !== "RELEASE";
        const isReturn = step.label.includes("복귀");
        const pLabel = waypointLabel(step);
        return (
          <div key={i} style={{
            display:"flex", alignItems:"center", gap:10,
            padding:"6px 12px", borderRadius:7,
            background: isActive ? "#eef2ff" : isDone ? "#f0fdf4" : "#fafafa",
            border:`1px solid ${isActive?"#a5b4fc":isDone?"#86efac":"#e5e7eb"}`,
            transition:"all 0.18s ease",
          }}>
            <span style={{
              width:18, height:18, borderRadius:"50%",
              display:"flex", alignItems:"center", justifyContent:"center",
              background: isActive?"#4f46e5":isDone?"#16a34a":"#e5e7eb",
              color: isActive||isDone?"#fff":"#9ca3af",
              fontSize:9, fontWeight:800, flexShrink:0,
            }}>
              {isDone ? "✓" : isActive ? "▶" : i+1}
            </span>
            <span
              onClick={canToggle ? () => onToggleType!(i) : undefined}
              title={canToggle ? "클릭하여 MoveJ / MoveL 전환" : undefined}
              style={{
                fontSize:11, fontWeight:800, letterSpacing:"0.05em",
                color:tc.text, background:tc.bg,
                borderRadius:4, padding:"1px 5px", flexShrink:0,
                cursor: canToggle ? "pointer" : "default",
                outline: canToggle ? "2px dashed rgba(255,255,255,0.5)" : "none",
                outlineOffset:1, userSelect:"none", transition:"filter 0.12s",
              }}
              onMouseEnter={e => { if (canToggle) (e.currentTarget as HTMLElement).style.filter="brightness(1.2)"; }}
              onMouseLeave={e => { if (canToggle) (e.currentTarget as HTMLElement).style.filter=""; }}
            >{step.type}</span>

            {step.type === "MoveC" && step.via ? (
              <div style={{ display:"flex", flexDirection:"column", gap:4, flex:1, minWidth:0 }}>
                {/* via 행 */}
                <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:6 }}>
                  <span style={{ fontSize:10, fontWeight:800, color:"#7c3aed",
                    background:"#ede9fe", borderRadius:3, padding:"1px 5px",
                    flexShrink:0, letterSpacing:"0.04em" }}>경유</span>
                  <span style={{ fontSize:13, color:"#6b7280", fontFamily:FONT, fontWeight:700 }}>
                    X {displayCoordinate(step.via.x)}&nbsp;&nbsp;Y {displayCoordinate(step.via.y)}&nbsp;&nbsp;Z {displayCoordinate(step.via.z)}
                  </span>
                </div>
                {/* end 행 */}
                <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:6 }}>
                  <span style={{ fontSize:10, fontWeight:800, color:"#374151",
                    background:"#f3f4f6", borderRadius:3, padding:"1px 5px",
                    flexShrink:0, letterSpacing:"0.04em" }}>{pLabel} 도착</span>
                  {(["x","y","z"] as const).map(f => (
                    <CoordInput key={f} val={step.coords![f]} field={f}
                      disabled={!canEdit || isReturn || lockZ && f === "z"}
                      onChange={v => onEditCoord!(i, f, v)}/>
                  ))}
                  {isReturn && <span style={{fontSize:10,color:"#64748b",fontWeight:700}}>P1과 동일 · 시작점 수정 시 함께 변경</span>}
                </div>
              </div>
            ) : hasCoords && !isReturn ? (
              <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:8, flex:1, minWidth:0 }}>
                <span style={{ fontSize:14, fontWeight:800, color:"#1e293b",
                  fontFamily:FONT, flexShrink:0, minWidth:20 }}>{pLabel}</span>
                {(["x","y","z"] as const).map(f => (
                  <CoordInput key={f} val={step.coords![f]} field={f}
                    disabled={!canEdit || lockZ && f === "z"}
                    onChange={v => onEditCoord!(i, f, v)}/>
                ))}
              </div>
            ) : (
              <div style={{ display:"flex", alignItems:"center", gap:16, flex:1, minWidth:0 }}>
                {step.label.trim().split(/\s+/).map((token, ti) => (
                  <span key={ti} style={{
                    fontSize:14, color:"#1e293b", fontFamily:FONT, fontWeight:800,
                    whiteSpace:"nowrap",
                  }}>{token}</span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Run / Stop button ───────────────────────────────── */
function RunBtn({ status, onRun, onStop, onReset }: {
  status: MissionStatus; onRun:()=>void; onStop:()=>void; onReset:()=>void;
}) {
  if (status === "running") {
    return (
      <button onClick={onStop} style={{
        width:"100%", padding:"10px 0", borderRadius:8, fontSize:14, fontWeight:700,
        background:"#fef2f2", border:"1.5px solid #fca5a5", color:"#dc2626", cursor:"pointer",
        fontFamily:FONT,
      }}>■ 중지</button>
    );
  }
  if (status === "done") {
    return (
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={onReset} style={{
          flex:1, padding:"10px 0", borderRadius:8, fontSize:13, fontWeight:700,
          background:"#f9fafb", border:"1.5px solid #e5e7eb", color:"#6b7280", cursor:"pointer",
          fontFamily:FONT,
        }}>↺ 초기화</button>
        <button onClick={onRun} style={{
          flex:2, padding:"10px 0", borderRadius:8, fontSize:14, fontWeight:700,
          background:"#f0fdf4", border:"1.5px solid #86efac", color:"#16a34a", cursor:"pointer",
          fontFamily:FONT,
        }}>✓ 완료!  다시 실행 ▶</button>
      </div>
    );
  }
  return (
    <button onClick={onRun} style={{
      width:"100%", padding:"10px 0", borderRadius:8, fontSize:14, fontWeight:700,
      background:"#4f46e5", border:"none", color:"#fff", cursor:"pointer",
      fontFamily:FONT,
    }}>▶  실행</button>
  );
}

/* ─── Mission card ────────────────────────────────────── */
function MissionCard({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div style={{
      borderLeft:"4px solid #4f46e5", paddingLeft:12,
      background:"#f5f3ff", borderRadius:"0 8px 8px 0",
      padding:"10px 12px 10px 14px",
    }}>
      <div style={{ fontSize:16, fontWeight:800, color:"#1e1b4b", marginBottom:children ? 8 : 0,
        display:"flex", alignItems:"center", flexWrap:"wrap", gap:4 }}>
        미션. {title}
      </div>
      {children}
    </div>
  );
}

/* ─── Coords display ──────────────────────────────────── */
function CoordsBar({ coords }: { coords: Coords }) {
  const items = [
    { k:"X", v:coords.x, c:"#ef4444" },
    { k:"Y", v:coords.y, c:"#22c55e" },
    { k:"Z", v:coords.z, c:"#3b82f6" },
    { k:"R", v:coords.r, c:"#a78bfa" },
  ];
  return (
    <div style={{
      display:"flex", gap:6, padding:"7px 10px",
      background:"#1e1e2e", borderRadius:8,
    }}>
      {items.map(({k,v,c})=>(
        <div key={k} style={{ flex:1, textAlign:"center" }}>
          <div style={{ fontSize:9, color:c, fontWeight:700, marginBottom:2 }}>{k}</div>
          <div style={{
            fontSize:12, fontWeight:700, color:"#f8fafc",
            fontFamily:FONT,
          }}>{(v>=0?"+":"")+v.toFixed(1)}</div>
        </div>
      ))}
    </div>
  );
}

function summarizeMeasurements(items: WaypointMeasurement[]) {
  if (!items.length) return { rmse: 0, maxError: 0, meanX: 0, meanY: 0, meanZ: 0 };
  const mean = (key: "errorX"|"errorY"|"errorZ") =>
    items.reduce((sum, item) => sum + item[key], 0) / items.length;
  return {
    rmse: Math.sqrt(items.reduce((sum, item) => sum + item.distanceError ** 2, 0) / items.length),
    maxError: Math.max(...items.map(item => item.distanceError)),
    meanX: mean("errorX"),
    meanY: mean("errorY"),
    meanZ: mean("errorZ"),
  };
}

function MeasurementResults({ items, attempt, source }: { items: WaypointMeasurement[]; attempt: number; source: MeasurementSource }) {
  const summary = summarizeMeasurements(items);
  return (
    <div className="shape-measurement-results">
      <div className="lesson-notice shape-measurement-source" data-source={source}>
        {source==="hardware"
          ? "실장비가 보고한 텔레메트리 좌표입니다. 목표와 보고 좌표의 차이를 해석하세요. 외부 센서로 직접 측정한 위치와는 구분합니다."
          : "가상 센서 연습값입니다. 측정·오차 해석 절차를 연습하며, 실증 데이터로 사용하려면 실장비를 연결하세요."}
      </div>
      <div className="shape-measurement-metrics">
        {[
          ["시도", `${attempt}회`],
          ["RMSE", `${summary.rmse.toFixed(2)} mm`],
          ["최대 오차", `${summary.maxError.toFixed(2)} mm`],
        ].map(([label,value]) => (
          <div key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="shape-measurement-table-wrap" tabIndex={0} aria-label="목표 좌표와 측정 좌표의 오차 비교표">
        <table>
          <thead><tr>
            {['점','ΔX','ΔY','ΔZ','거리오차'].map(h=><th key={h} scope="col">{h}</th>)}
          </tr></thead>
          <tbody>{items.map((item,index)=><tr key={`${item.label}-${index}`}>
            <th scope="row">{item.label}</th>
            {[item.errorX,item.errorY,item.errorZ,item.distanceError].map((v,i)=><td key={i} className="num-mono">{v>=0?"+":""}{v.toFixed(2)}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
      <div className="lesson-feedback shape-measurement-hint">
        <strong>결과 비교 힌트</strong><br/>{measurementHint(items,source==="hardware"?"hardware":"virtual")}
      </div>
    </div>
  );
}


/* ─── Shape learning shell ───────────────────────────── */
function ShapeLearningPanel({
  shapeType, motionMode, onMotionModeChange, supportMode, onSupportModeChange, inquiry, lesson, lessonIndex,
  seq, currentStep, status, onEditCoord, onRun, onStop, onReset,
  onNewCondition, onLessonChange, hardwareConnected, onStageChange, onQuestionFocus, lessonKey, completedShapeRun, executionSeq, continuousExecution,
}: {
  shapeType: ShapeType;
  motionMode: "MoveJ"|"MoveL";
  onMotionModeChange: (mode:"MoveJ"|"MoveL") => void;
  supportMode: SupportMode;
  onSupportModeChange: (mode:SupportMode) => void;
  inquiry: ReturnType<typeof useMathInquiry>;
  lesson: ShapeLesson;
  lessonIndex: number;
  lessonKey: string;
  activeStep: number;
  onStageChange: (stage:number) => void;
  onQuestionFocus: (key:string|null) => void;
  completedShapeRun: boolean;
  executionSeq?: SeqStep[];
  seq: SeqStep[];
  currentStep: number;
  status: MissionStatus;
  onEditCoord: (index:number, field:"x"|"y"|"z", value:number) => void;
  onRun: () => void;
  onStop: () => void;
  onReset: () => void;
  onNewCondition: () => void;
  onLessonChange: (index:number) => void;
  hardwareConnected: boolean;
  continuousExecution?: import("react").ReactNode;
}) {
  const locked = status === "running";
  const [editorOpen, setEditorOpen] = useState(false);
  useEffect(() => { setEditorOpen(false); }, [shapeType,lessonIndex]);
  const matchesTarget = executionSeq&&lesson.id.startsWith("square-")
    ?squarePlanMatchesTarget(lesson,executionSeq as ShapeLesson["sequence"]):shapeLessonMatchesTarget(lesson);
  const diagramSeq=executionSeq??seq;
  return (
    <div className="shape-learning-panel">
      <LessonCoursePath label="도형 수업 경로" current={lessonIndex} disabled={locked || editorOpen}
        items={Array.from({length: SHAPE_LESSON_COUNT}, (_, index) => ({
          label: `${["기초", "응용", "심화"][Math.floor(index / 2)]} ${index % 2 + 1}`,
          detail: shapeType==="사각형"&&index>=4 ? PAPER_RECTANGLE_TITLES[index===4?"advanced-paper-dt":"advanced-paper-hardware"] : getShapeLesson(shapeType, index).title,
        }))} onSelect={onLessonChange}/>
      <details className="shape-lesson-settings">
        <summary>
          <span className="shape-settings-current">{lesson.difficulty} · {supportMode === "guided" ? "기초 지원" : "도전 모드"}<span>과제 {lessonIndex+1}/{SHAPE_LESSON_COUNT}</span></span>
          <span className="shape-settings-toggle"><span className="shape-settings-open-label">설정 변경</span><span className="shape-settings-close-label">설정 접기</span><span aria-hidden="true">⌄</span></span>
        </summary>
        <div className="shape-lesson-toolbar">
        <label>학습 지원 <select aria-label="도형 학습 지원" value={supportMode} disabled={locked || editorOpen}
          onChange={event=>onSupportModeChange(event.target.value as SupportMode)}>
          <option value="guided">기초 지원</option><option value="challenge">도전 모드</option>
        </select></label>
        </div>
      </details>
      <section className="shape-problem-focus" aria-label="이번 문제의 핵심 조건">
        <h2>{lesson.title}</h2>
        <dl className="shape-problem-facts">
          <div><dt>{lesson.brief.contextLabel}</dt><dd>{lesson.brief.contextValue}</dd></div>
          <div><dt>{lesson.brief.conditionLabel}</dt><dd>{lesson.brief.conditionValue}</dd></div>
        </dl>
        {lesson.brief.note && <p className="shape-problem-note">{lesson.brief.note}</p>}
        <details className="shape-problem-details" key={lesson.id}><summary>전체 과제 보기</summary><p>{lesson.brief.focus}</p><p>{lesson.instruction}</p></details>
      </section>
      {editorOpen && <section className="lesson-card shape-coordinate-editor" aria-label="실행 좌표 수정">
        <h3>실행 좌표 수정</h3>
        <p className="lesson-note">좌표나 이동 방식을 바꾸면 새 조건으로 개념·계산·예측을 다시 확인합니다.</p>
        <label>{shapeType === "동그라미" ? "P1 접근" : "변의 이동 방식"} <select aria-label="도형 이동 방식" disabled={locked}
          value={motionMode} onChange={e=>onMotionModeChange(e.target.value as "MoveJ"|"MoveL")}>
          <option value="MoveL">MoveL</option><option value="MoveJ">MoveJ</option>
        </select></label>
        {shapeType === "동그라미" && <p className="lesson-note">원호는 MoveC이며 Z=0인 XY 평면에서 진행합니다.</p>}
        <StepList seq={seq} currentStep={currentStep} status={status} onEditCoord={onEditCoord} lockZ={shapeType === "동그라미"} editableWhenDone/>
        <button type="button" disabled={locked} onClick={()=>setEditorOpen(false)}>좌표 수정 마치기</button>
      </section>}
      <div hidden={editorOpen}><ShapeLessonSteps key={lessonKey} lesson={lesson} inquiry={inquiry} locked={locked || editorOpen}
        executionSequence={executionSeq as ShapeLesson["sequence"]|undefined}
        onStageChange={onStageChange} onQuestionFocus={onQuestionFocus} supportMode={supportMode}
        execution={editorOpen ? <p className="lesson-note">좌표 수정을 마치면 실행할 수 있습니다.</p> : <>
          <ShapeDiagram seq={diagramSeq} currentStep={currentStep} status={status} shapeType={shapeType}/>
          {hardwareConnected && shapeType!=="사각형" ? <p className="lesson-note">실장비 연결 중에는 DT 실습을 잠급니다.</p>
            : <RunBtn status={status} onRun={onRun} onStop={onStop} onReset={onReset}/>}
          {continuousExecution}
          <button type="button" disabled={locked} onClick={()=>setEditorOpen(true)}>실행 좌표 보기·수정</button>
          <p className="lesson-note">도형을 닫고 실행 전 자세로 돌아온 뒤 예측과 결과를 비교합니다.</p>
        </>}
        observation={<>
                {continuousExecution}
          <ShapeDiagram seq={diagramSeq} currentStep={currentStep} status={status} shapeType={shapeType}/>
          {!matchesTarget && <p role="status" className="lesson-feedback">현재 명령과 수학적 목표가 다릅니다. 목표 좌표·이동 방식을 비교하고 수정한 뒤 다시 실행하세요.</p>}
        </>}
        onEditProgram={()=>setEditorOpen(true)}
        canAdvance={completedShapeRun && matchesTarget}
        advanceBlockedReason={!matchesTarget ? "목표와 다른 실행 좌표·이동 방식을 수정하고 다시 실행하세요." : "도형을 끝까지 실행한 결과를 확인한 뒤 다음 과제로 진행하세요."}
        nextLabel={lessonIndex+1 < SHAPE_LESSON_COUNT ? "다음 과제로 적용" : "과정 완료 · 첫 과제 다시 풀기"}
        onNewCondition={onNewCondition}/></div>
      {!locked && <button onClick={onReset}>↺ DT 장비 원위치</button>}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════ */
export function RobotArm({
  joints: _joints,
  coords,
  onJointStart: _onJointStart,
  onJogStop: _onJogStop,
  onMoveTo,
  onMoveEnd,
  onMissionStart,
  onTabChange,
  onPickStateChange,
  onGetJoints,
  onComputeIK,
  onComputeFK,
  onMoveJoints,
  onCapturePose,
  onRestorePose,
  hardwareConnected,
  hardwareHomed,
  onHardwareMove,
  onHardwareStop,
  onResetPose,
  onLearningVisualChange,
  resetKey,
  activity,
  onNextKinematics,
  embedded = false,
}: {
  joints: Joints;
  coords: Coords;
  onJointStart: (joint:"j1"|"j2"|"j3"|"j4", dir:1|-1) => void;
  onJogStop: () => void;
  onMoveTo: (x:number, y:number, z:number, r:number) => void;
  onMoveEnd: () => void;
  onMissionStart?: () => void;
  onTabChange?: (tab: "rect"|"pick") => void;
  onPickStateChange?: (state: { gripActive: boolean; missionDone: boolean }) => void;
  onGetJoints: () => Joints;
  onComputeIK: (x:number, y:number, z:number, r:number, hintJ3:number) => Joints | null;
  onComputeFK: (j: Joints) => Coords;
  onMoveJoints: (j: Joints) => void;
  onCapturePose?: () => ShapePoseSnapshot;
  onRestorePose?: (pose: ShapePoseSnapshot) => void;
  hardwareConnected: boolean;
  hardwareHomed: boolean;
  onHardwareMove: (motion: "MoveJ"|"MoveL", target: Coords) => Promise<Coords>;
  onHardwareStop: () => void;
  onResetPose: () => void;
  onLearningVisualChange?: (visual: LearningVisualState | null) => void;
  resetKey: number;
  /** Chapter routing supplies one activity; legacy callers may still use the two tabs. */
  activity?: "rect" | "pick";
  onNextKinematics?: () => void;
  embedded?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<"rect"|"pick">(activity ?? "rect");
  const [status, setStatus] = useState<MissionStatus>("idle");
  const [currentStep, setCurrentStep] = useState(-1);
  const [gripActive, setGripActive] = useState(false);
  const [motionMode, setMotionMode] = useState<"MoveJ"|"MoveL">("MoveL");
  const [shapeType, setShapeType] = useState<ShapeType>("사각형");
  const [shapeLessonIndex, setShapeLessonIndex] = useState(0);
  const [shapeLessonStage, setShapeLessonStage] = useState(1);
  const [shapeQuestionKey, setShapeQuestionKey] = useState<string|null>(null);
  const [shapeSupportChoices, setShapeSupportChoices] = useState<Record<string, { mode:SupportMode; usedGuidance:boolean }>>({});
  const [runKind, setRunKind] = useState<RunKind | null>(null);
  const [shapeRunPhase, setShapeRunPhase] = useState<ShapeRunPhase>("idle");
  const [shapeInitialPose, setShapeInitialPose] = useState<ShapePoseSnapshot | null>(null);
  const [shapeClosure, setShapeClosure] = useState<ShapeClosure | null>(null);
  const [shapeStorageFailed, setShapeStorageFailed] = useState(false);
  const [paperLevel,setPaperLevel] = useState<PaperRectangleLevel|null>(null);
  const paperCoordinateOpen=paperLevel!==null;
  const [paperBusy,setPaperBusy]=useState(false);
  const paperDtCancelRef = useRef(false);
  const [dtCompletionKey, setDtCompletionKey] = useState<string | null>(null);
  const shapeEvidenceRef = useRef<Record<string, unknown>[] | null>(null);
  const [measurements, setMeasurements] = useState<WaypointMeasurement[]>([]);
  const [measurementTrialId, setMeasurementTrialId] = useState<string | null>(null);
  const [measuredPath, setMeasuredPath] = useState<Coords[]>([]);
  const [measurementSource, setMeasurementSource] = useState<MeasurementSource>(null);
  const [attemptCount, setAttemptCount] = useState(0);
  const [runError, setRunError] = useState<string | null>(null);
  const runKindRef = useRef<RunKind | null>(null);
  const continuationRef=useRef<SquareContinuation|null>(null);
  const continuationBusyRef=useRef(false);
  const continuationSettingsRef=useRef<{draft:string;bridge:string}|null>(null);
  const [continuationPhase,setContinuationPhase]=useState<SquareContinuationPhase|null>(null);
  const [continuationReason,setContinuationReason]=useState<string|null>(null);
  const virtualUnlockRef=useRef<(()=>void)|null>(null);
  const practice = usePractice();
  const practiceRef = useRef(practice); practiceRef.current = practice;
  const [mockRun, setMockRun] = useState(false);
  useEffect(() => () => {
    practiceRef.current.cancelConfirmation();
    if (runKindRef.current === "hardware") practiceRef.current.session.stop();
  }, []);
  // The DT prediction run and any real run both hold the mode lock while active.
  useEffect(() => {
    if (status !== "running") return;
    const unlock=practiceRef.current.lockVirtual();virtualUnlockRef.current=unlock;
    return ()=>{unlock();if(virtualUnlockRef.current===unlock)virtualUnlockRef.current=null;};
  }, [status]);
  const measuredPathRef = useRef<Coords[]>([]);
  const hardwareRunTokenRef = useRef(0);
  const makeBaseSeq = (shape: ShapeType, mode: "MoveJ"|"MoveL") =>
    getShapeLesson(shape, shapeLessonIndex, undefined, undefined, mode).sequence;
  const [editableSeq, setEditableSeq] = useState<SeqStep[]>(() => makeBaseSeq("사각형", "MoveL"));
  const [liftHeight,setLiftHeight]=useState(40);
  const [circleCenter,setCircleCenter]=useState({x:250,y:0});
  const [conditionRound,setConditionRound]=useState(0);
  const pickSeq=PICK_SEQ.map(step=>({...step,coords:step.coords?{...step.coords,z:step.coords.z===40?liftHeight:step.coords.z}:undefined}));
  const inquirySeq=activeTab==="pick"?pickSeq:editableSeq;
  const currentShapeLesson = useMemo(() => getShapeLesson(shapeType, shapeLessonIndex, editableSeq, circleCenter, motionMode), [shapeType,shapeLessonIndex,editableSeq,circleCenter,motionMode]);
  const supportMode = shapeSupportChoices[currentShapeLesson.id]?.mode ?? (currentShapeLesson.taskKind === "transfer" ? "challenge" : "guided");
  const shapeUsedGuidance = shapeSupportChoices[currentShapeLesson.id]?.usedGuidance ?? currentShapeLesson.taskKind !== "transfer";
  const setSupportMode = (mode:SupportMode) => setShapeSupportChoices(previous => ({ ...previous,
    [currentShapeLesson.id]: { mode, usedGuidance: shapeUsedGuidance || mode === "guided" } }));
  const shapeLessonKey = JSON.stringify([shapeType,currentShapeLesson.id,editableSeq,circleCenter,conditionRound,motionMode,supportMode]);
  const inquiry=useMathInquiry(activeTab==="pick"?"pick-place":shapeType==="사각형"?"square":shapeType==="삼각형"?"triangle":"circle",
    {sequence:inquirySeq,circleCenter:shapeType==="동그라미"?circleCenter:undefined,conditionRound,
      ...(activeTab === "rect" ? {id:currentShapeLesson.id,lessonId:currentShapeLesson.id,taskKind:currentShapeLesson.taskKind,
        ...(shapeType==="사각형"?{instruction:currentShapeLesson.instruction}:{}),
        difficulty:currentShapeLesson.difficulty,motionMode,supportMode,guidanceBeforePrediction:shapeUsedGuidance,
        support:currentShapeLesson.taskKind==="transfer"&&!shapeUsedGuidance&&supportMode==="challenge"?"independent":supportMode} : {})},
    activeTab==="pick"?[
      {key:"lift",label:"흡착 후 상승 변화량 ΔZ",unit:"mm"},{key:"carry",label:"운반 변화량 ΔY",unit:"mm"}
    ]:shapeLessonFields(currentShapeLesson),
    ["mission"],resetKey,shapeType==="사각형"&&activeTab==="rect"?false:hardwareConnected);
  const inquiryExpectedRef=useRef<Record<string,number|string>>({});
  const inquiryPathRef=useRef<Coords[]>([]);
  const inquiryVerticesRef=useRef<SquareObservedVertex[]>([]);
  const squarePlan=useMemo(()=>shapeType==="사각형"&&inquiry.record
    ?squareStudentSequence(currentShapeLesson,inquiry.record.prediction):null,[shapeType,currentShapeLesson,inquiry.record]);
  const executionSeq=squarePlan??editableSeq;
  const executionKey=shapeType==="사각형"
    ?squareExecutionKey(shapeLessonKey,inquiry.record?.id,squarePlan):shapeLessonKey;
  const squareInputCurrent=shapeType!=="사각형"||!!inquiry.record
    &&squareAnswersUnchanged(inquiry.record.prediction,inquiry.draft,inquiry.reviewDraft);
  const squareCorrect=shapeType!=="사각형"||!!inquiry.record
    &&assessSquare(currentShapeLesson,inquiry.record.prediction).every(row=>row.matched);
  const shapeLearningStep = status === "running" ? 4 : shapeLessonStage;
  const sequenceMatchesTarget = squarePlan?squarePlanMatchesTarget(currentShapeLesson,squarePlan):shapeLessonMatchesTarget(currentShapeLesson);
  const latestMission = inquiry.record?.runs.filter(run => run.action === "mission").at(-1);
  const completedDetail = latestMission?.detail as { closure?: ShapeClosure; returnedToInitialPose?: boolean } | undefined;
  const completedShapeRun = inquiry.ready && dtCompletionKey === executionKey && latestMission?.status === "completed"
    && completedDetail?.closure?.closed === true && completedDetail.returnedToInitialPose === true;
  const measurementApproved = shapeType === "사각형" && !!squarePlan && squareInputCurrent && squareCorrect
    && completedShapeRun && inquiry.reviewed && sequenceMatchesTarget;
  const challengeWrongPlanEligible = supportMode === "challenge" && !squareCorrect;
  const squareApprovalRef=useRef({key:executionKey,approved:measurementApproved&&activeTab==="rect"});
  squareApprovalRef.current={key:executionKey,approved:measurementApproved&&activeTab==="rect"};
  const squareInputKey=JSON.stringify([executionKey,inquiry.draft,inquiry.reviewDraft,inquiry.reason,activeTab,resetKey]);
  const squareLiveRef=useRef({key:executionKey,inputKey:squareInputKey,eligible:false});
  squareLiveRef.current={key:executionKey,inputKey:squareInputKey,
    eligible:activeTab==="rect"&&shapeType==="사각형"&&!!squarePlan&&squareInputCurrent
      &&(squareCorrect?sequenceMatchesTarget:challengeWrongPlanEligible)
      &&completedShapeRun&&inquiry.ready
      &&!inquiry.record?.runs.some(run=>run.action==="square-measurement"&&run.status==="completed"
        &&(run.detail as {planKey?:string}|undefined)?.planKey===executionKey)};
  useLayoutEffect(()=>{
    const pending=continuationRef.current;
    const settings=continuationSettingsRef.current;
    if(pending&&(pending.key!==executionKey||pending.inputKey!==squareInputKey
      ||settings&&(settings.draft!==JSON.stringify(practice.setupDraft)||settings.bridge!==practice.bridgeUrl)))
      cancelContinuation("입력이나 과제가 변경되어 가상·후속 실제 실행을 취소했습니다. 새로 승인해야 합니다.");
  },[executionKey,squareInputKey,practice.setupDraft,practice.bridgeUrl]);

  useLayoutEffect(() => {
    if (!onLearningVisualChange) return;
    if (activeTab !== "rect" || paperCoordinateOpen) { onLearningVisualChange(null); return; }
    const answers = shapeLearningStep === 6 && inquiry.record
      ? {...inquiry.record.prediction, ...inquiry.record.answerReviews?.at(-1)?.answers, ...inquiry.reviewDraft}
      : inquiry.record?.prediction ?? inquiry.draft ?? {};
    const points = shapeLessonStudentPoints(currentShapeLesson, answers).map((point,index) => ({...point,label:point.label ?? `예측 ${index+1}`}));
    const start = currentShapeLesson.pathPlan.start;
    const anchors = start ? [{...start,label:"P1"}] : [];
    onLearningVisualChange({
      stage: shapeLearningStep,
      stageLabel: shapeRunPhase === "returning"
        ? shapeClosure?.closed === false ? "도형이 닫히지 않았습니다. 실제 궤적을 보존하고 실행 전 자세로 복귀합니다." : "도형은 P1에서 닫혔습니다. 실행 전 자세로 복귀하며 그린 궤적은 보존합니다."
        : shapeRunPhase === "complete" ? "그린 궤적을 예측과 비교하세요. 장비는 실행 전 자세로 복귀했습니다."
        : shapeLearningStep === 1 ? "출발점과 좌표 조건을 읽고 개념을 판단하세요."
        : shapeLearningStep === 2 ? "각 구간의 좌표 변화와 경로를 닫는 관계를 정하세요."
        : shapeLearningStep === 3 ? "모든 경로점의 좌표를 입력해 내 예상 경로를 완성하세요."
        : "P1 접근을 제외한 도형 경로만 기록합니다.",
      axisChoice: null, axisDistance: 0, studentPoints: [...anchors,...points],
      planningFocus: shapeLearningStep <= 3 || shapeLearningStep === 6
        ? shapePlanningFocus(currentShapeLesson, answers, shapeQuestionKey) : undefined,
      studentPath: shapeLearningStep >= 3
        ? shapeLessonStudentPreview(currentShapeLesson, answers).map(point=>({...point,label:""})) : [],
      targetPath: shapeLessonTargetPath(currentShapeLesson).map(point=>({...point,label:""})),
      programmedPath: shapeLessonProgramPath(squarePlan?{...currentShapeLesson,sequence:squarePlan}:currentShapeLesson).map(point=>({...point,label:""})),
      measuredPath: measuredPath.map(point=>({...point,label:""})), trajectoryKind: null,
      traceActive: shapeRunPhase === "drawing",
      traceVisible: shapeRunPhase !== "idle" && shapeRunPhase !== "approach",
      traceEndpoint: shapeRunPhase === "returning" || shapeRunPhase === "complete"
        ? inquiryPathRef.current.at(-1) ?? null : null,
      activePointIndex: -1, showTarget: inquiry.observed,
      showProgram: inquiry.observed && !sequenceMatchesTarget,
      sequenceMatchesTarget, measurementSource,
    });
  }, [onLearningVisualChange, paperCoordinateOpen, activeTab, shapeType, editableSeq, measuredPath, measurementSource, sequenceMatchesTarget,
    shapeRunPhase, shapeClosure, currentShapeLesson, squarePlan, shapeLearningStep, shapeQuestionKey, inquiry.record, inquiry.draft, inquiry.reviewDraft, inquiry.observed]);

  useEffect(() => () => onLearningVisualChange?.(null), [onLearningVisualChange]);

  useEffect(() => {
    setEditableSeq(makeBaseSeq(shapeType, motionMode));
    setShapeRunPhase("idle");
    setShapeInitialPose(null);
    setDtCompletionKey(null);
    setShapeClosure(null);
    setCircleCenter(getShapeLesson(shapeType,shapeLessonIndex).circleCenter);
    setShapeLessonStage(1);
    setMeasurements([]);
    setMeasuredPath([]);
    setMeasurementSource(null);
    setMeasurementTrialId(null);
    setRunError(null);
  }, [shapeType, shapeLessonIndex]);

  useEffect(() => {
    onPickStateChange?.({ gripActive, missionDone: status === "done" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gripActive, status]);

  function handleEditCoord(stepIdx: number, field: 'x'|'y'|'z', val: number) {
    // Closing coordinates are derived from P1 for every interpolation type.
    if (editableSeq[stepIdx]?.label.includes("복귀")) return;
    if (shapeType === "동그라미" && field === "z") return;
    if (status === "running") return;
    resetMission();
    setEditableSeq(prev => {
      const next = prev.map((s, i) => {
        if (i !== stepIdx) return s;
        return { ...s, coords: { ...s.coords!, [field]: val } };
      });
      // Auto-sync return step (last) with step 0 (P1) when P1 changes
      if (stepIdx === 0) {
        const last = next.length - 1;
        if (next[last]?.label.includes("복귀")) {
          const c = next[0].coords!;
          const newLabel = `P1   X${c.x}  Y${c.y}   Z${c.z}  (복귀)`;
          next[last] = { ...next[last], coords: { ...c }, label: newLabel };
        }
      }
      return next;
    });
    setMeasurements([]);
    setMeasuredPath([]);
    setMeasurementSource(null);
    setMeasurementTrialId(null);
    setRunError(null);
  }

  const frameScheduler = useRef<ShapeFrameScheduler | null>(null);
  frameScheduler.current ??= new ShapeFrameScheduler(callback => requestAnimationFrame(callback), id => cancelAnimationFrame(id));
  const animState  = useRef<{
    seq: SeqStep[];
    stepIdx: number;
    from: Coords;
    segStart: number | null;
    pauseEnd: number | null;
    segMs: number;
    fromJoints: Joints | null;
    toJoints: Joints | null;
    shape: ShapeType | null;
    initialPose: ShapePoseSnapshot | null;
    returnState: ShapeReturn | null;
    motion: ShapeMotion | null;
    conditionKey: string;
  } | null>(null);

  const stopAnim = useCallback(() => {
    if(continuationRef.current?.phase==="virtual")
      continuationRef.current.cancel("가상 실행이 중단되어 후속 실제 실행 승인을 폐기했습니다.");
    frameScheduler.current?.cancel();
    animState.current = null;
    inquiry.interrupt();
  }, [inquiry.interrupt]);

  useEffect(() => () => {
    hardwareRunTokenRef.current += 1;
    stopAnim();
    if (runKindRef.current === "hardware") stopHardware();
    onMoveEnd();
  }, [stopAnim, onHardwareStop, onMoveEnd]);

  useLayoutEffect(() => {
    hardwareRunTokenRef.current += 1;
    stopAnim();
    setStatus("idle");
    setShapeRunPhase("idle");
    setShapeInitialPose(null);
    setDtCompletionKey(null);
    setShapeClosure(null);
    setCurrentStep(-1);
    setGripActive(false);
    setRunKind(null);
    runKindRef.current = null;
    setMeasurements([]);
    setMeasuredPath([]);
    setMeasurementSource(null);
    measuredPathRef.current = [];
    setAttemptCount(0);
    setRunError(null);
  }, [resetKey, stopAnim]);

  useEffect(() => {
    if (runKind !== "hardware" || status !== "running") return;
    // Continuous square telemetry is appended by runOps.onStep below. Never
    // seed that physical path with the just-finished virtual scene's pose.
    if(continuationRef.current?.phase==="hardware")return;
    const point = { ...coords };
    const last = measuredPathRef.current[measuredPathRef.current.length - 1];
    if (!last || Math.hypot(point.x-last.x, point.y-last.y, point.z-last.z) >= 0.25) {
      measuredPathRef.current.push(point);
    }
  }, [coords, runKind, status]);

  useLayoutEffect(()=>{
    if(hardwareConnected&&animState.current?.shape!=="사각형"&&(runKindRef.current==="legacy"||animState.current?.initialPose)) {
      stopAnim();onMoveEnd();setStatus("idle");setCurrentStep(-1);setGripActive(false);
      setShapeRunPhase("idle");setShapeInitialPose(null);
      setRunKind(null);runKindRef.current=null;
    }
  },[hardwareConnected,stopAnim,onMoveEnd]);

  useLayoutEffect(() => {
    if (hardwareConnected || runKindRef.current !== "hardware" || continuationRef.current) return;
    hardwareRunTokenRef.current += 1;
    onHardwareStop();
    setStatus("idle");
    setRunKind(null);
    runKindRef.current = null;
    setRunError("실장비 연결이 끊겨 측정을 중단했습니다.");
  }, [hardwareConnected, onHardwareStop]);

  const finishAnimatedMission = useCallback((stepCount: number) => {
    const kind = runKindRef.current;
    const completed = animState.current;
    if(!completed)return;
    const drawing = completed?.returnState;
    const closure = drawing?.closure ?? (completed?.shape ? measureShapeClosure(inquiryPathRef.current[0], onComputeFK(onGetJoints())) : null);
    if(kind==="legacy") {
      const observed=drawing?.closedAt ?? onComputeFK(onGetJoints());
      const observedVertices=[...inquiryVerticesRef.current];
      inquiry.finish(completed?.shape
        ? closure?.closed
          ? "P1에서 도형을 닫고 실행 전 자세로 복귀했습니다. 비교할 실행 궤적에는 접근·복귀 이동을 포함하지 않습니다. 표의 값은 문항의 수학적 확인값이며, 실제 TCP 궤적과 구분하여 비교하세요."
          : "시퀀스 실행을 마쳤지만 도형이 닫히지 않았습니다. 실제 끝점과 P1을 비교하세요. 실행 전 자세로의 복귀는 도형 완성과 별개입니다."
        : "DT 시퀀스 실행을 완료했습니다. 표의 값은 문항의 수학적 확인값이며, 실제 TCP 궤적과 구분하여 비교하세요. 실제 TCP 경로와 직선거리가 같은지는 궤적을 보고 설명하세요.",
        inquiryExpectedRef.current,{source:"dt",planKey:completed.conditionKey,observed,observedVertices,
          observedPath:drawing?.observedPath ?? [...inquiryPathRef.current,observed],completedSteps:stepCount,
          ...(drawing ? {initialPose:drawing.initialPose,closure,returnedToInitialPose:true} : {})});
    }
    setStatus("done");
    if (completed?.shape) {
      setShapeRunPhase("complete");
      setDtCompletionKey(closure?.closed ? completed.conditionKey : null);
    }
    setCurrentStep(stepCount);
    animState.current = null;
    onMoveEnd();
    if (drawing) {
      onRestorePose?.(copyShapePose(drawing.initialPose));
      const key="physical-ai-shape-runs-v1";
      const previous=shapeEvidenceRef.current ?? readEvidence(key,(value):value is Record<string,unknown>=>!!value&&typeof value==="object");
      const record={...learningRecordContext("dt"),id:globalThis.crypto?.randomUUID?.()??`${Date.now()}`,
        recordedAt:new Date().toISOString(),shape:completed?.shape,status:"completed",
        initialPose:drawing.initialPose,closedAt:drawing.closedAt,observedPath:drawing.observedPath,closure,
        returnedToInitialPose:true,completedSteps:stepCount};
      shapeEvidenceRef.current=[...previous,record];
      setShapeStorageFailed(!writeEvidence(key,shapeEvidenceRef.current));
    }
    setRunKind(null);
    runKindRef.current = null;
    continuationRef.current?.completeVirtual(completed.conditionKey,closure?.closed===true,!!drawing,stepCount,completed.seq.length);
  }, [onMoveEnd,onComputeFK,onGetJoints,onRestorePose,inquiry.finish]);

  const tick = useCallback((time: number) => {
    const s = animState.current;
    if (!s) return;

    if (s.returnState) {
      const frame=sampleShapeReturn(s.returnState,time);
      onMoveJoints(frame.joints);
      if (frame.done) finishAnimatedMission(s.seq.length);
      else frameScheduler.current?.schedule(tick);
      return;
    }

    const closeDrawing = () => {
      if (s.shape) setShapeClosure(measureShapeClosure(inquiryPathRef.current[0],onComputeFK(onGetJoints())));
      if (s.shape && s.initialPose) {
        s.returnState=prepareShapeReturn(s.initialPose,onGetJoints(),onComputeFK(onGetJoints()),inquiryPathRef.current,onComputeFK);
        setShapeRunPhase("returning");
        setCurrentStep(s.seq.length);
        frameScheduler.current?.schedule(tick);
      } else finishAnimatedMission(s.seq.length);
    };

    // A rejected DT sample must not silently become a completed learning run.
    let rejected=false;
    const rejectSample=(x:number,y:number,z:number,r:number)=>{
        rejected=true;
        const message="중간 경로를 연속된 관절 자세로 실행할 수 없어 DT를 중단했습니다. 목표 좌표와 경로를 다시 확인하세요.";
        if (runKindRef.current === "legacy") inquiry.finish(message,{},
          {rejectedTarget:{x,y,z,r},observedPath:[...inquiryPathRef.current]},"unavailable");
        setRunError(message);
        stopAnim();onMoveEnd();setStatus("idle");setShapeRunPhase("idle");setGripActive(false);setRunKind(null);runKindRef.current=null;
    };
    const moveSample=(x:number,y:number,z:number,r:number)=>{
      if(!onComputeIK(x,y,z,r,onGetJoints().j3)) {
        rejectSample(x,y,z,r);
        return;
      }
      onMoveTo(x,y,z,r);
    };

    const step = s.seq[s.stepIdx];

    /* ── GRIP / RELEASE pause ── */
    if (!step.coords) {
      if (s.pauseEnd === null) {
        s.pauseEnd = time + 480;
        if (step.type === "GRIP")    setGripActive(true);
        if (step.type === "RELEASE") setGripActive(false);
      }
      if (time < s.pauseEnd) { frameScheduler.current?.schedule(tick); return; }
      s.pauseEnd = null;
      s.stepIdx++;
      if (s.stepIdx >= s.seq.length) { closeDrawing(); return; }
      setCurrentStep(s.stepIdx);
      frameScheduler.current?.schedule(tick);
      return;
    }

    /* ── Motion segment ── */
    if (s.segStart === null) {
      s.segStart = time;
      if (s.shape) {
        s.motion = prepareShapeMotion(s.from, onGetJoints(), step.coords, step.type as "MoveJ"|"MoveL"|"MoveC",
          step.via, onComputeIK, onComputeFK);
        if (!s.motion) { rejectSample(step.coords.x,step.coords.y,step.coords.z,step.coords.r); return; }
        s.segMs = s.motion.durationMs;
      } else {
        // Retain the legacy pick sequence timing; shape lessons use the bounded plan above.
        s.segMs = step.type === "MoveJ" ? 1400 : step.type === "MoveC" ? 1200 : 700;
        if (step.type === "MoveJ") {
          const fj = onGetJoints();
          s.fromJoints = fj;
          s.toJoints = onComputeIK(step.coords.x, step.coords.y, step.coords.z, step.coords.r, fj.j3);
        } else {
          s.fromJoints = null;
          s.toJoints = null;
        }
      }
    }
    const t = Math.min((time - s.segStart) / s.segMs, 1);
    const to = step.coords;

    if (s.motion) {
      const frame = sampleShapeMotion(s.motion, time - s.segStart);
      if (!frame.joints) { rejectSample(to.x,to.y,to.z,to.r); return; }
      onMoveJoints(frame.joints);
    } else if (step.type === "MoveC" && step.via) {
      /* ── 원호 보간 (MoveC) ── */
      const via = step.via;
      const ax = s.from.x, ay = s.from.y;
      const bx = via.x,    by = via.y;
      const cx2 = to.x,    cy2 = to.y;
      // 외접원 중심 계산
      const D = 2*(ax*(by-cy2) + bx*(cy2-ay) + cx2*(ay-by));
      if (Math.abs(D) < 1e-6) {
        // 직선 폴백
        moveSample(ax+(cx2-ax)*t, ay+(cy2-ay)*t, s.from.z+(to.z-s.from.z)*t, s.from.r+(to.r-s.from.r)*t);
      } else {
        const a2=ax*ax+ay*ay, b2=bx*bx+by*by, c22=cx2*cx2+cy2*cy2;
        const ocx = (a2*(by-cy2)+b2*(cy2-ay)+c22*(ay-by))/D;
        const ocy = (a2*(cx2-bx)+b2*(ax-cx2)+c22*(bx-ax))/D;
        const rad2 = Math.sqrt((ax-ocx)**2+(ay-ocy)**2);
        const a0 = Math.atan2(ay-ocy, ax-ocx);
        const aV = Math.atan2(by-ocy, bx-ocx);
        const a1 = Math.atan2(cy2-ocy, cx2-ocx);
        // CW 방향 판별: a0→a1 시계방향 스윕 안에 aV가 있으면 CW
        const norm360 = (a: number) => ((a%(2*Math.PI))+(2*Math.PI))%(2*Math.PI);
        const cwSweep = norm360(a0-a1);
        const cwToV   = norm360(a0-aV);
        let angle: number;
        if (cwToV <= cwSweep + 1e-6) {
          angle = a0 - cwSweep * t;  // 시계방향
        } else {
          angle = a0 + (2*Math.PI - cwSweep) * t;  // 반시계
        }
        moveSample(ocx+rad2*Math.cos(angle), ocy+rad2*Math.sin(angle),
          s.from.z+(to.z-s.from.z)*t, s.from.r+(to.r-s.from.r)*t);
      }
    } else if (step.type === "MoveJ" && s.fromJoints && s.toJoints) {
      /* ── 관절 공간 보간 (MoveJ) ── TCP가 호를 그리며 이동 */
      const fj = s.fromJoints, tj = s.toJoints;
      onMoveJoints({
        j1: fj.j1 + (tj.j1 - fj.j1) * t,
        j2: fj.j2 + (tj.j2 - fj.j2) * t,
        j3: fj.j3 + (tj.j3 - fj.j3) * t,
        j4: fj.j4 + (tj.j4 - fj.j4) * t,
      });
    } else {
      /* ── 직선 보간 (MoveL) ── TCP가 직선으로 이동 */
      moveSample(
        s.from.x + (to.x - s.from.x)*t,
        s.from.y + (to.y - s.from.y)*t,
        s.from.z + (to.z - s.from.z)*t,
        s.from.r + (to.r - s.from.r)*t,
      );
    }

    if(rejected)return;
    if (s.shape ? s.stepIdx > 0 : runKindRef.current === "legacy") inquiryPathRef.current.push(onComputeFK(onGetJoints()));
    if (t < 1) { frameScheduler.current?.schedule(tick); return; }

    // Approach and return are separate from the closed shape being compared.
    if (s.shape && s.stepIdx === 0) {
      const p1={ ...onComputeFK(onGetJoints()) };
      inquiryPathRef.current = [p1];
      inquiryVerticesRef.current=[{...p1,label:"P1"}];
      onMissionStart?.();
      setShapeRunPhase("drawing");
    } else if(s.shape&&s.stepIdx>0) {
      const point={...onComputeFK(onGetJoints())};
      const labels=["P1","P2","P3","P4","P1"];
      inquiryVerticesRef.current.push({...point,label:labels[s.stepIdx]??`P${s.stepIdx+1}`});
    }

    s.from = { ...to };
    s.segStart = null;
    s.motion = null;
    s.fromJoints = null;
    s.toJoints = null;
    s.stepIdx++;
    if (s.stepIdx >= s.seq.length) { closeDrawing(); return; }
    setCurrentStep(s.stepIdx);
    frameScheduler.current?.schedule(tick);
  }, [onMoveTo, onGetJoints, onComputeIK, onMoveJoints, onMissionStart, onComputeFK, finishAnimatedMission, inquiry.finish, stopAnim, onMoveEnd]);

  function stopHardware() {
    onHardwareStop();
    if (runKindRef.current === "hardware") practice.session.stop();
  }

  function startMission(seq: SeqStep[], continuous=false): boolean {
    if ((hardwareConnected&&!(activeTab==="rect"&&shapeType==="사각형")) || !inquiry.ready || status === "running" || (!continuous&&continuationBusyRef.current)) return false;
    if(activeTab==="rect"&&shapeType==="사각형") {
      if(!squarePlan||!squareInputCurrent) {
        setRunError("입력이 변경되었거나 좌표가 빠졌습니다. 새로운 입력을 확인하고 예측을 다시 저장하세요.");return false;
      }
      seq=squarePlan;
    }
    if (activeTab === "rect" && !hasCompleteShapePlan(currentShapeLesson, inquiry.record?.prediction ?? {})) {
      setRunError("모든 경로점과 마지막 닫힘 좌표를 입력하고 관계식을 확인한 뒤 예측을 다시 저장하세요.");
      return false;
    }
    if(!continuous)stopAnim();
    if (inquiry.begin("mission") === false) return false;
    inquiryPathRef.current=[];
    inquiryVerticesRef.current=[];
    const invalid=seq.flatMap(step=>[step.coords,step.via]).find(p=>p&&(!Object.values(p).every(Number.isFinite)||!onComputeIK(p.x,p.y,p.z,p.r,onGetJoints().j3)));
    if(invalid) {
      inquiry.finish("입력 좌표에 모델 해가 없어 DT 실행을 시작하지 않았습니다. 좌표를 바꾸고 다시 예측하세요.",{}, {rejectedTarget:invalid},"unavailable");
      return false;
    }
    const pts=seq.filter(s=>s.coords).map(s=>s.coords!);
    inquiryExpectedRef.current=activeTab==="pick"?{lift:pts[2].z-pts[1].z,carry:pts[3].y-pts[2].y}:shapeLessonExpected(currentShapeLesson);
    onMissionStart?.();
    runKindRef.current = "legacy";
    setRunKind("legacy");
    setRunError(null);
    setStatus("running");
    setCurrentStep(0);
    setGripActive(false);
    const initialPose=activeTab === "rect" && (!hardwareConnected||shapeType==="사각형")
      ? copyShapePose(onCapturePose?.() ?? {joints:onGetJoints(),coords}) : null;
    setDtCompletionKey(null);
    setShapeInitialPose(initialPose);
    setShapeClosure(null);
    setShapeRunPhase(activeTab === "rect" ? "approach" : "idle");
    inquiryPathRef.current=[];
    animState.current = { seq, stepIdx:0, from:initialPose ? onComputeFK(initialPose.joints) : {...coords}, segStart:null, pauseEnd:null, segMs:900, fromJoints:null, toJoints:null, motion:null,
      shape:activeTab === "rect" ? shapeType : null, initialPose, returnState:null, conditionKey:executionKey };
    frameScheduler.current?.schedule(tick);
    return true;
  }

  function cancelContinuation(reason:string,alreadyStopping=false) {
    const pending=continuationRef.current;
    if(!pending)return;
    continuationRef.current=null;pending.cancel(reason);
    setContinuationReason(reason);
    practiceRef.current.cancelConfirmation();
    if(runKindRef.current==="hardware"&&!alreadyStopping)stopHardware();
    hardwareRunTokenRef.current++;
    stopAnim();onMoveEnd();virtualUnlockRef.current?.();virtualUnlockRef.current=null;
    setStatus("idle");setRunKind(null);runKindRef.current=null;
    setShapeRunPhase("idle");setDtCompletionKey(null);setRunError(reason);
  }

  function resetMission() {
    cancelContinuation("취소·정지로 가상과 후속 실제 실행 승인을 모두 폐기했습니다.");
    if (runKindRef.current === "hardware") practice.session.stop();
    hardwareRunTokenRef.current += 1;
    stopAnim();
    setShapeRunPhase("idle");
    setShapeInitialPose(null);
    setDtCompletionKey(null);
    setShapeClosure(null);
    setStatus("idle");
    setCurrentStep(-1);
    setGripActive(false);
    setRunKind(null);
    runKindRef.current = null;
    setMeasurements([]);
    setMeasuredPath([]);
    setMeasurementSource(null);
    setMeasurementTrialId(null);
    measuredPathRef.current = [];
    setRunError(null);
  }

  const previousInquiryId = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = inquiry.record?.id ?? null;
    if (previousInquiryId.current !== null && id === null) {
      resetMission();
      onMoveEnd();
    }
    previousInquiryId.current = id;
  }, [inquiry.record?.id]);

  async function startHardwareSquare(continuous=false) {
    if (continuationBusyRef.current || status==="running") return;
    if(continuous?!squareLiveRef.current.eligible:!measurementApproved)return;
    if(!practice.hardware) {setRunError("연속 실행은 시작 전에 안내·연결에서 실제 로봇 모드와 연결·장비 준비를 확인하세요. 가상 전용 실행은 연결 없이 가능합니다.");return;}
    const approvedKey=executionKey;
    // Same plan as the DT lesson: the student's own editable points, in order, as absolute coordinates.
    const plan = executionSeq.map((step, index) => ({ step, index })).filter(x => x.step.coords);
    if (plan.some(x => x.step.type !== "MoveJ" && x.step.type !== "MoveL")) {
      setRunError("이 계획에는 MoveC 원호가 있어 실제 로봇 실행을 지원하지 않습니다. 직선·관절 이동으로 근사하지 않고 거부합니다."); return;
    }
    if (plan.length === 0 || plan.length > 30) { setRunError("실제 실행은 좌표 1~30개만 지원합니다."); return; }
    const ops = plan.map(x => ({ kind: "move" as const, motion: x.step.type as "MoveJ" | "MoveL", target: { ...x.step.coords! } }));
    const token = ++hardwareRunTokenRef.current;
    const pending=continuous?new SquareContinuation(approvedKey,squareInputKey,setContinuationPhase):null;
    if(pending) {
      continuationRef.current=pending;continuationBusyRef.current=true;
      continuationSettingsRef.current={draft:JSON.stringify(practice.setupDraft),bridge:practice.bridgeUrl};
      setContinuationPhase("confirming");setContinuationReason(null);setRunError(null);
    }
    const session=practice.session,connectionId=session.getConnectionId(),setup=session.getSnapshot().setup;
    const setupDraftKey=JSON.stringify(practice.setupDraft),bridge=practice.bridgeUrl;
    const unsubscribe=pending?session.subscribe(()=>{
      if(continuationRef.current!==pending)return;
      const snap=session.getSnapshot(),problem=session.readiness(true);
      if(session.getConnectionId()!==connectionId||snap.setup!==setup||problem
        ||pending.phase!=="hardware"&&snap.measurement?.moving)
        cancelContinuation(`연속 실행 차단: ${problem||"연결·준비·장비 정지 상태가 변경되었습니다."} 재연결만으로 재실행하지 않습니다.`);
    }):()=>{};
    const unsubscribeStop=pending?session.subscribeStop(()=>{
      if(continuationRef.current===pending)
        cancelContinuation("장비 중단 요청으로 가상과 후속 실제 실행을 모두 취소했습니다. 실제 정지는 현장에서 확인하고 새로 승인하세요.",true);
    }):()=>{};
    const attempt = attemptCount + 1;
    const results: WaypointMeasurement[] = [];
    const runStartedAt=new Date().toISOString();
    let src = practice.session.getSnapshot().source === "mock" ? "mock" as const : "hardware" as const;
    let stepStart = performance.now();
    const saveMeasurementRun=(status:"completed"|"unavailable"|"stopped",summary:string)=>{
      const sequenceOrder=["P1","P2","P3","P4","P1"];
      const valid=results.length===5&&results.every((row,index)=>row.source===src
        &&Number.isFinite(row.actual.x)&&Number.isFinite(row.actual.y)&&Number.isFinite(row.actual.z)
        &&Number.isFinite(row.seq)&&typeof row.ageMs==="number"&&row.ageMs>=0&&row.ageMs<=1500
        &&(index===0||row.seq!>results[index-1].seq!));
      const observedVertices:SquareObservedVertex[]|undefined=valid
        ?results.map((row,index)=>({...row.actual,label:sequenceOrder[index]})):undefined;
      inquiry.recordExecution(inquiry.record!,{
        action:"square-measurement",status,startedAt:runStartedAt,endedAt:new Date().toISOString(),summary,
        detail:{source:src,planKey:approvedKey,complete:status==="completed"&&valid,
          measurementContract:"bridge controller-reported TCP (MG400 port 30004 feedback); not pen contact or paper drawing",
          observedVertices,measurements:results.map(row=>({label:row.label,target:row.target,actual:row.actual,
            source:row.source,seq:row.seq,measuredAt:row.measuredAt,ageMs:row.ageMs,distanceError:row.distanceError}))},
      });
      return valid;
    };
    try {
      const done = await practice.runOps(ops, continuous
        ? `사각형 연속 실행: 학생의 ${squareCorrect?"예측 경로":"오답 가능성이 있는 예측 경로"}를 DT에서 완주·닫힘·복귀 확인한 뒤, 같은 계획을 실제 장비에서 1회 실행합니다. 오답이면 목표와 다른 도형이 그려질 수 있습니다. DT 중 물리 명령은 없으며 연결·준비·서보·작업 범위와 사람의 최종 확인을 통과해야 합니다.`
        : "2-3 도형 · 내가 입력한 같은 좌표 계획을 실제 로봇에서 실측 (펜·바닥 접촉은 측정되지 않음)", (m, i, op) => {
        if (hardwareRunTokenRef.current !== token) return;
        src=m.source;
        const target = op.kind === "move" ? { ...op.target } : { ...plan[i].step.coords! };
        const actual = { ...m.pose };
        const errorX = actual.x - target.x, errorY = actual.y - target.y, errorZ = actual.z - target.z;
        results.push({ label: waypointLabel(plan[i].step), target, actual, errorX, errorY, errorZ,
      source:m.source,seq:m.seq,measuredAt:m.measuredAt,ageMs:m.ageMs,
          distanceError: Math.hypot(errorX, errorY, errorZ), durationMs: performance.now() - stepStart });
        stepStart = performance.now();
        measuredPathRef.current = [...measuredPathRef.current, actual];
        setMeasuredPath([...measuredPathRef.current]);
        setCurrentStep(plan[i].index + 1);
      }, () => {
        if(pending) {
          pending.assertCurrent(squareLiveRef.current.key,squareLiveRef.current.inputKey);
          if(!squareLiveRef.current.eligible||hardwareRunTokenRef.current!==token)throw new Error("이번 답안의 연속 실행 승인이 폐기되었습니다.");
          pending.beginHardware();
        } else if(!squareApprovalRef.current.approved||squareApprovalRef.current.key!==approvedKey
          ||hardwareRunTokenRef.current!==token)throw new Error("확인 중 답안이나 실행 계획이 변경되었습니다. 새 입력으로 DT 실행·비교를 다시 완료하세요.");
        stopAnim(); onMissionStart?.();
        setAttemptCount(attempt); setStatus("running"); setRunKind("hardware"); runKindRef.current = "hardware";
        setCurrentStep(plan[0].index); setMeasurements([]); setMeasuredPath([]); setMeasurementSource(null); setMockRun(false);
        measuredPathRef.current = []; setRunError(null);
      },pending?async()=>{
        pending.assertCurrent(squareLiveRef.current.key,squareLiveRef.current.inputKey);
        if(!squareLiveRef.current.eligible||JSON.stringify(practiceRef.current.setupDraft)!==setupDraftKey||practiceRef.current.bridgeUrl!==bridge)
          throw new Error("답안 또는 연결·속도·설치 입력이 변경되어 연속 실행 승인을 폐기했습니다.");
        await pending.waitForVirtual(()=>startMission(executionSeq,true));
        pending.assertCurrent(squareLiveRef.current.key,squareLiveRef.current.inputKey);
        if(JSON.stringify(practiceRef.current.setupDraft)!==setupDraftKey||practiceRef.current.bridgeUrl!==bridge)
          throw new Error("가상 실행 중 연결·속도·설치 입력이 변경되어 실제 실행을 취소했습니다.");
        virtualUnlockRef.current?.();virtualUnlockRef.current=null;
      }:undefined);
      if (!done) {
        if(inquiry.record)saveMeasurementRun("stopped","사람이 시작 전 확인을 취소했습니다. 좌표 실측은 없습니다.");
        pending?.cancel("시작 전 물리 실행 확인을 취소했습니다.");
        if(pending)setContinuationReason(pending.reason);
        return;
      }
      if (hardwareRunTokenRef.current !== token) return;
      setMockRun(src === "mock");
      const trialId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${attempt}`;
      if (src === "hardware") registerMeasurementReview(trialId, currentShapeLesson.id, "hardware", results);
      setMeasurementTrialId(src === "hardware" ? trialId : null);
      setMeasurements(results);
      setMeasuredPath([...measuredPathRef.current]);
      setMeasurementSource(src === "hardware" ? "hardware" : "virtual");
      setStatus("done");
      setRunKind(null);
      runKindRef.current = null;
      pending?.finish();

      const summary = summarizeMeasurements(results);
      const completeMeasurements=saveMeasurementRun("completed",src==="mock"
        ?"모의 브리지 회신으로 좌표를 기록했습니다. 실장비 실측 증거가 아닙니다."
        :"브리지 제어기 보고 TCP 좌표를 기록했습니다. 펜 접촉이나 종이 위 선의 측정은 아닙니다.");
      if(!completeMeasurements)setRunError("실행은 끝났지만 같은 계획의 유효한 브리지 관측 꼭짓점 5개가 없어 실측 기반 진단은 완료되지 않았습니다.");
      try {
        if (src !== "hardware") throw new Error("mock runs are not stored as hardware evidence");
        const storageKey = "physical-ai-square-trials-v1";
        const previous = JSON.parse(getEvidenceItem(storageKey) ?? "[]");
        const record = {
          ...learningRecordContext("hardware"),
          id: trialId,
          task: "사각형 그리기",
          attempt,
          recordedAt: new Date().toISOString(),
          motionPlan: "P1 접근 MoveJ + 네 변 MoveL",
          mathPrediction: inquiry.record?.prediction,
          inquiryId: inquiry.record?.id,
          dtInterpretation: inquiry.record?.reflections.at(-1),
          problemId: currentShapeLesson.id,
          difficulty: currentShapeLesson.difficulty,
          targets: executionSeq.filter(step => step.coords).map(step => step.coords),
          measurements: results,
          rmse: summary.rmse,
          maxError: summary.maxError,
          aiHint: measurementHint(results,"hardware"),
        };
        setEvidenceItem(storageKey, JSON.stringify([...previous, record]));
      } catch {
        // Learning continues even when browser storage is unavailable.
      }
    } catch (error) {
      if (hardwareRunTokenRef.current !== token) return;
      if(inquiry.record&&results.length)saveMeasurementRun("unavailable","실행이 끝나지 않았거나 유효한 최신 측정이 부족합니다. 이 자료로는 전체 도형을 진단하지 않습니다.");
      setStatus("idle");
      setRunKind(null);
      runKindRef.current = null;
      setRunError(error instanceof Error ? error.message : "실장비 실행 중 오류가 발생했습니다.");
      // Keep only the measured prefix; no review/learning record is created for an incomplete run.
      setMockRun(src === "mock");
      if (results.length) { setMeasurements(results); setMeasurementSource(src === "hardware" ? "hardware" : "virtual"); }
      setMeasuredPath([...measuredPathRef.current]);
      pending?.cancel(error instanceof Error?error.message:"연속 실행 실패");
      if(pending)setContinuationReason(pending.reason);
    } finally {
      unsubscribe();
      unsubscribeStop();
      if(continuationRef.current===pending)continuationRef.current=null;
      if(pending)continuationBusyRef.current=false;
    }
  }

  function runVirtualMeasurement() {
    if (!measurementApproved || hardwareConnected || practice.hardware || status==="running") return;
    const pattern = [
      {x:0.8,y:-0.5,z:0.3},
      {x:1.4,y:0.6,z:-0.2},
      {x:-0.9,y:1.1,z:0.4},
      {x:-1.2,y:-0.7,z:-0.3},
      {x:0.6,y:-0.4,z:0.2},
    ];
    const targets = executionSeq.filter(step=>step.coords).map(step=>step.coords!);
    const results = targets.map((target,index)=>{
      const base = pattern[(index+shapeLessonIndex)%pattern.length];
      const scale = 1+shapeLessonIndex*0.12;
      const actual = {
        x:target.x+base.x*scale,
        y:target.y+base.y*scale,
        z:target.z+base.z*scale,
        r:target.r,
      };
      const errorX=actual.x-target.x;
      const errorY=actual.y-target.y;
      const errorZ=actual.z-target.z;
      return {
        label:index===targets.length-1?"P1":`P${index+1}`,
        target:{...target},actual,errorX,errorY,errorZ,
        distanceError:Math.hypot(errorX,errorY,errorZ),
        durationMs:700,
      };
    });
    const attempt=attemptCount+1;
    setAttemptCount(attempt);
    const trialId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${attempt}`;
    registerMeasurementReview(trialId, currentShapeLesson.id, "virtual", results);
    setMeasurementTrialId(trialId);
    setMeasurements(results);
    setMeasuredPath(results.map(item=>item.actual));
    setMeasurementSource("virtual");
    try {
      const storageKey="physical-ai-square-trials-v1";
      const previous=JSON.parse(getEvidenceItem(storageKey)??"[]");
      const record={...learningRecordContext("virtual"),id:trialId,task:"사각형 그리기",attempt,
        recordedAt:new Date().toISOString(),problemId:currentShapeLesson.id,difficulty:currentShapeLesson.difficulty,
        mathPrediction:inquiry.record?.prediction,inquiryId:inquiry.record?.id,targets,measurements:results,...summarizeMeasurements(results),
        supportHint:measurementHint(results,"virtual")};
      setEvidenceItem(storageKey,JSON.stringify([...previous,record]));
    } catch { /* Practice remains available if browser storage is unavailable. */ }
    setStatus("done");
    setRunError(null);
  }

  function stopHardwareSquare() {
    if(continuationRef.current){cancelContinuation("연속 실행을 중지했습니다. 실제 장비 정지 여부는 현장에서 확인하고 새로 승인하세요.");return;}
    hardwareRunTokenRef.current += 1;
    stopHardware();
    setStatus("idle");
    setRunKind(null);
    runKindRef.current = null;
    setRunError("실장비 실행을 중지했습니다. 알람 해제와 원점 복귀 후 다시 실행하세요.");
    setMeasuredPath([...measuredPathRef.current]);
  }

  function switchTab(t: "rect"|"pick") {
    if (runKindRef.current === "hardware") stopHardware();
    resetMission();
    setActiveTab(t);
    onTabChange?.(t);
  }


  function selectShapeLesson(index: number) {
    if (status === "running") return;
    const nextIndex = Math.max(0, Math.min(SHAPE_LESSON_COUNT-1,index));
    resetMission();
    const next = getShapeLesson(shapeType,nextIndex);
    setShapeLessonIndex(nextIndex);
    setMotionMode("MoveL");
    setEditableSeq(next.sequence);
    setCircleCenter(next.circleCenter);
    setShapeLessonStage(1);
    setConditionRound(n=>n+1);
  }

  function selectShapeCourse(index:number) {
    if(status==="running")return;
    if(shapeType==="사각형"&&index>=4){resetMission();setPaperLevel(index===4?"advanced-paper-dt":"advanced-paper-hardware");}
    else selectShapeLesson(index);
  }

  function changeShapeCondition() {
    if (!inquiry.reviewed || !completedShapeRun || !sequenceMatchesTarget) return;
    selectShapeCourse((shapeLessonIndex+1)%SHAPE_LESSON_COUNT);
  }

  /* ── render ── */
  const runPaperDigitalTwin = async (commands: Coords[]) => {
    if (hardwareConnected) throw new Error("실장비 연결 중에는 좌표 변환 DT를 시작하지 않았습니다.");
    if (status === "running") throw new Error("기존 로봇 동작이 진행 중입니다.");
    paperDtCancelRef.current = false;
    const start = { ...coords };
    setStatus("running");
    setRunError(null);
    onMissionStart?.();
    const animate = (from: Coords, to: Coords) => new Promise<void>((resolve, reject) => {
      const started = performance.now();
      const duration = 350;
      const tick = (now: number) => {
        if (paperDtCancelRef.current) { reject(new Error("DT가 중단되었습니다. 완료로 기록하지 않습니다.")); return; }
        const t = Math.min(1, Math.max(0, (now - started) / duration));
        const next = {
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
          z: from.z + (to.z - from.z) * t,
          r: from.r + (to.r - from.r) * t,
        };
        if (!onComputeIK(next.x, next.y, next.z, next.r, onGetJoints().j3)) {
          reject(new Error("DT 기구학 검사에서 도달 불가 지점을 확인했습니다."));
          return;
        }
        onMoveTo(next.x, next.y, next.z, next.r);
        if (t < 1) requestAnimationFrame(tick);
        else { onMoveEnd(); resolve(); }
      };
      requestAnimationFrame(tick);
    });
    try {
      let previous = start;
      for (const command of [...commands, start]) {
        if (!onComputeIK(command.x, command.y, command.z, command.r, onGetJoints().j3))
          throw new Error("DT 기구학 검사에서 도달 불가 지점을 확인했습니다.");
        await animate(previous, command);
        previous = command;
      }
    } finally {
      paperDtCancelRef.current = false;
      onMoveTo(start.x, start.y, start.z, start.r);
      onMoveEnd();
      setStatus("idle");
    }
  };

  if (paperCoordinateOpen) {
    return (
      <div className="paper-coordinate-host">
        <LessonCoursePath label="도형 수업 경로" current={paperLevel==="advanced-paper-dt"?4:5} disabled={status==="running"||paperBusy}
          items={Array.from({length:SHAPE_LESSON_COUNT},(_,index)=>({label:`${["기초","응용","심화"][Math.floor(index/2)]} ${index%2+1}`,
            detail:index>=4?PAPER_RECTANGLE_TITLES[index===4?"advanced-paper-dt":"advanced-paper-hardware"]:getShapeLesson("사각형",index).title}))}
          onSelect={index=>{if(status==="running"||paperBusy)return;if(index>=4)setPaperLevel(index===4?"advanced-paper-dt":"advanced-paper-hardware");else{setPaperLevel(null);selectShapeLesson(index);}}}/>

        <PaperCoordinateStudy key={paperLevel!} initialLevel={paperLevel!} supportMode={supportMode} onRunningChange={setPaperBusy}
          onBack={() => { paperDtCancelRef.current = true; setPaperLevel(null); }}
          hardwareConnected={hardwareConnected}
          currentPose={coords}
          canReach={pose => !!onComputeIK(pose.x, pose.y, pose.z, pose.r, onGetJoints().j3)}
          runDigitalTwin={runPaperDigitalTwin}
        />
        <details className="pcv-details"><summary>이전 심화 과제·학습 기록 보기</summary>{[4,5].map(index=><button key={index} disabled={paperBusy||status==="running"} onClick={()=>{setPaperLevel(null);selectShapeLesson(index);}}>이전 심화 {index-3} · {getShapeLesson("사각형",index).title}</button>)}</details>
      </div>
    );
  }

  return (
    <div className="flex flex-col shrink-0 overflow-hidden h-full"
      style={{ width:embedded ? "100%" : "clamp(500px,36vw,580px)", minWidth:0, minHeight:0, background:"#fff", borderLeft:embedded ? "none" : "2px solid #e5e7eb", fontFamily:FONT }}>

      {/* Header */}
      {!embedded && <div className="shrink-0"
        style={{ borderBottom:"1px solid #ddd6fe", background:"#ede9fe",
          padding:"8px 0", textAlign:"center" }}>
        <span style={{ fontSize:18, fontWeight:800, color:"#3730a3",
          letterSpacing:"0.02em", lineHeight:1 }}>
          {activity === "pick" ? "운동학 종합과제: 픽앤플레이스" : "좌표와 로봇 이동"}
        </span>
      </div>}

      <div className="shrink-0" style={{
        padding:"7px 12px",
        background:hardwareConnected ? (hardwareHomed ? "#ecfdf5" : "#fff7ed") : "#f8fafc",
        color:hardwareConnected ? (hardwareHomed ? "#166534" : "#9a3412") : "#475569",
        borderBottom:`1px solid ${hardwareConnected ? (hardwareHomed ? "#bbf7d0" : "#fed7aa") : "#e2e8f0"}`,
        fontSize:11, fontWeight:700, lineHeight:1.45,
      }}>
        {hardwareConnected
          ? hardwareHomed
            ? "● 실장비 준비 완료 — DT 검증 후 저속 실행·측정 가능"
            : "● 실장비 연결됨 — 상단 초기값을 눌러 원점을 확인하세요"
          : "○ DT 예측 모드 — 실장비 측정은 장비 연결 후 활성화됩니다"}
      </div>

      {/* Legacy standalone tabs; chapter routing selects a single activity. */}
      {!activity && <div className="shrink-0" style={{ display:"flex", borderBottom:"2px solid #c7d2fe", background:"#eef2ff" }}>
        {([["rect","1.","사각형 그리기"],["pick","2.","픽앤 플레이스"]] as const).map(([id,num,label])=>(
          <button key={id} onClick={()=>switchTab(id)} style={{
            flex:1, padding:"8px 4px", fontSize:13, fontWeight:700,
            letterSpacing:"0.02em", cursor:"pointer", border:"none", borderRadius:0,
            background: activeTab===id ? "#4f46e5" : "transparent",
            color: activeTab===id ? "#fff" : "#4338ca",
            borderBottom: activeTab===id ? "2px solid #4f46e5" : "2px solid transparent",
            marginBottom:"-2px",
            transition:"all 0.15s ease",
            display:"flex", alignItems:"center", justifyContent:"center", gap:5,
          }}>
            <span style={{ fontSize:16, lineHeight:1 }}>{num}</span>
            <span style={{ fontSize:14 }}>{label}</span>
          </button>
        ))}
      </div>}

      {/* Content */}
      <div className={activeTab === "rect" ? "lesson-scroll shape-lesson-content" : undefined}
        style={activeTab === "rect" ? undefined : { flex:1, overflowY:"auto", padding:"12px 12px 16px", display:"flex", flexDirection:"column", gap:12 }}>

        {activeTab === "rect" ? (
          <>
            <TaskStartPoint taskKey={`shape:${currentShapeLesson.id}:${shapeType}:${resetKey}`} start={currentShapeLesson.pathPlan.start ?? null}
              coords={coords} disabled={status==="running"} legacyConnected={hardwareConnected}
              onVirtualMove={p=>moveVirtualTaskStart({model:{ik:onComputeIK},joints:_joints,onMoveTo,onMoveEnd},p)}/>
            {/* 도형 탭 */}
            <div className="lesson-toggle shape-type-tabs" role="group" aria-label="도형 선택">
              {(["사각형","삼각형","동그라미"] as ShapeType[]).map(s => (
                <button key={s} onClick={()=>{ if(status!=="running" && s!==shapeType){ setShapeType(s); setShapeLessonIndex(0); setMotionMode("MoveL"); setShapeLessonStage(1); resetMission(); } }}
                  disabled={status==="running"} aria-pressed={shapeType===s}>
                  <span aria-hidden="true">{SHAPE_ICONS[s]}</span>
                  <span>{s === "동그라미" ? "원" : s}</span>
                </button>
              ))}
            </div>

            {(shapeRunPhase !== "idle" || shapeStorageFailed) && <div className="lesson-notice shape-run-status" role="status" aria-live="polite">
              <strong>{shapeRunPhase === "approach" ? "도형 시작점 P1로 접근 중"
                : shapeRunPhase === "drawing" ? "도형 경로를 그리는 중"
                : shapeRunPhase === "returning" ? shapeClosure?.closed === false ? "경로 미완성 · 실행 전 자세로 복귀 중" : "도형 완성 · 실행 전 자세로 복귀 중"
                : shapeRunPhase === "complete" && shapeInitialPose ? shapeClosure?.closed === false ? "장비 복귀 완료 · 도형이 닫히지 않았습니다" : "도형 완성 · 실행 전 자세로 복귀 완료"
                : "도형 닫기와 장비 복귀를 구분하세요."}</strong>
              <div>{shapeInitialPose
                ? `실행 전 위치 (${shapeInitialPose.coords.x.toFixed(2)}, ${shapeInitialPose.coords.y.toFixed(2)}, ${shapeInitialPose.coords.z.toFixed(2)}, ${shapeInitialPose.coords.r.toFixed(2)}) · 도형 궤적에는 접근·복귀 이동을 포함하지 않습니다.`
                : hardwareConnected ? "도형의 마지막 P1은 도형 시작점입니다. 실장비는 별도의 조작 없이 자동 복귀하지 않습니다."
                : "P1로 돌아오면 도형이 닫힙니다. 이어서 실행 전 위치·관절 자세로 복귀하며 그린 궤적은 남습니다."}</div>
              {shapeClosure && <div>시작점–끝점 거리 {shapeClosure.positionErrorMm?.toFixed(2) ?? "확인 불가"} mm · 방향 차이 {shapeClosure.rotationErrorDeg?.toFixed(2) ?? "확인 불가"}°</div>}
              {shapeStorageFailed && <div role="alert" style={{color:"#b91c1c"}}>기록을 브라우저에 저장하지 못했습니다. 창을 닫기 전에 실행 기록을 내려받으세요.</div>}
              {((shapeRunPhase === "complete" && shapeInitialPose) || shapeStorageFailed) && <button onClick={()=>downloadEvidence("shape-execution-records.json",shapeEvidenceRef.current??[])}>도형 실행 기록 내려받기</button>}
            </div>}

            <ShapeLearningPanel
              shapeType={shapeType}
              motionMode={motionMode}
              onMotionModeChange={mode => {
                if (status === "running") return;
                resetMission();
                setMotionMode(mode);
                setEditableSeq(previous => previous.map((step,index) => ({...step,
                  type: step.type === "MoveJ" || step.type === "MoveL"
                    ? index === 0 && shapeType !== "동그라미" ? "MoveJ" : mode : step.type,
                })));
              }}
              supportMode={supportMode}
              onSupportModeChange={mode => { resetMission(); setSupportMode(mode); setShapeLessonStage(1); }}
              inquiry={inquiry}
              lesson={currentShapeLesson}
              lessonIndex={shapeLessonIndex}
              lessonKey={shapeLessonKey}
              activeStep={shapeLearningStep}
              completedShapeRun={completedShapeRun}
              onStageChange={setShapeLessonStage} onQuestionFocus={setShapeQuestionKey}
              onLessonChange={selectShapeCourse}
              seq={editableSeq}
              executionSeq={shapeType==="사각형"?executionSeq:undefined}
              continuousExecution={shapeType==="사각형"?<div className="lesson-notice">
                <p>이 버튼은 DT에서 완주·닫힘·복귀를 확인한 <strong>같은 좌표 계획을 실제 장비에서 1회 실행</strong>합니다. 도전 모드에서는 정답 확인 전 자신의 예측을 실행하므로 오답이면 목표와 다른 도형이 그려질 수 있습니다. 연결·준비·서보·작업 범위 검사와 사람의 최종 승인은 그대로 필요합니다.</p>
                <button type="button" data-testid="button-square-continuous-run" disabled={!squareLiveRef.current.eligible||status==="running"||continuationBusyRef.current}
                  onClick={()=>void startHardwareSquare(true)}>{challengeWrongPlanEligible
                    ?"내 예측을 DT 확인 후 실제 실행 · 오답이면 다른 도형":"가상 → 실제 사각형 연속 실행 · 시작 전 확인"}</button>
              </div>:undefined}
              currentStep={currentStep}
              status={status}
              onEditCoord={handleEditCoord}
              onRun={() => startMission(editableSeq)}
              onStop={() => { onMoveEnd(); resetMission(); }}
              onReset={() => { resetMission(); onResetPose(); }}
              onNewCondition={changeShapeCondition}
              hardwareConnected={hardwareConnected}
            />
            {onNextKinematics && <button className="lesson-next" disabled={status === "running"} onClick={onNextKinematics}>
              다음 단원 · 3-1 순기구학 →
            </button>}
            {(runError||continuationPhase==="cancelled"&&continuationReason) && <p role="alert" className="lesson-feedback">{runError??continuationReason}
              {continuationPhase==="cancelled"&&practice.snap.error&&<span> · 장비 상태: {practice.snap.error}</span>}</p>}
            {shapeType==="사각형"&&continuationPhase&&<div className="lesson-notice" role="status" data-testid="square-continuous-status">
              {continuationPhase==="confirming"?"연속 실행 시작 전 승인 대기 · 물리 명령 없음"
                :continuationPhase==="virtual"?"1/2 가상 사각형 실행 중 · 실제 장비 명령 없음"
                :continuationPhase==="verified"?"가상 완주 확인 · 실제 실행 직전 안전 조건 재검사 중"
                :continuationPhase==="hardware"?"2/2 같은 학생 좌표로 실제 실행 중 · DT는 실측 피드백 사용"
                :continuationPhase==="complete"?"연속 실행 완료 · 아래 관찰·비교·성찰 학습을 이어가세요."
                :"연속 실행 승인 폐기 · 다시 시작하려면 새 승인이 필요합니다."}
              {["confirming","virtual","verified","hardware"].includes(continuationPhase)&&<button type="button" data-testid="button-square-continuous-stop"
                onClick={()=>cancelContinuation("취소·정지로 가상과 후속 실제 실행을 함께 취소했습니다. 물리 정지 여부는 현장에서 확인하세요.")}>연속 실행 취소·정지 (물리 비상정지 아님)</button>}
            </div>}
            {shapeType==="사각형"&&continuationPhase==="complete"&&measurements.length>0&&<div>
              {mockRun&&<p role="status">모의 통신 · 실측 아님: 이 값은 학습 증거로 저장하지 않습니다.</p>}
              <MeasurementResults items={measurements} attempt={attemptCount} source={measurementSource}/>
            </div>}
            {shapeType === "사각형" && inquiry.reviewed && shapeLessonStage === 7 && <details className="lesson-card">
              <summary>추가 측정 · 실장비 / 가상 센서</summary>
              <p className="lesson-note">DT 실행·결과 비교가 끝난 현재 좌표로 측정합니다. 가상 센서는 오차 해석 연습값입니다.</p>
              <p className="lesson-note">실제로 그리려면 안내·연결에서 실제 로봇 모드를 선택하고 연결·준비 설정·서보 상태를 확인한 뒤 아래 실행 버튼을 누르세요. 모든 목표가 현장 작업 범위 안에 있어야 하며, 마지막 실행 확인은 사람이 합니다. 펜 접촉은 자동 확인하지 않습니다.</p>
              {!measurementApproved && <p role="status">수학적 목표와 일치하는 경로를 끝까지 실행하고 결과를 비교하면 측정할 수 있습니다.</p>}
              {runKind === "hardware" && status === "running"
                ? <button onClick={stopHardwareSquare}>화면 중단 요청 (물리 비상정지 아님)</button>
                : <button onClick={practice.hardware ? ()=>void startHardwareSquare() : runVirtualMeasurement} data-testid="button-shape-hardware-run"
                    disabled={!measurementApproved || status === "running" || (practice.hardware && (!practice.snap.setup || practice.snap.connection !== "connected"))}>
                    {practice.hardware ? (practice.snap.setup ? "내 좌표 계획 · 확인 후 실제 실행·측정" : "안내·연결에서 준비 필요") : "가상 센서로 측정·오차 연습"}
                  </button>}
              {mockRun && measurements.length > 0 && <p role="status" className="lesson-feedback">모의 통신 · 실측 아님: 이 값은 학습 증거로 저장하지 않습니다.</p>}
              {measurements.length > 0 && <>
                <MeasurementResults items={measurements} attempt={attemptCount} source={measurementSource}/>
                {measurementTrialId && <MeasurementFeedbackReview key={measurementTrialId} trialId={measurementTrialId} locked={status === "running"}/>}
              </>}
              <details><summary>이전 사각형 학습·측정 기록</summary>
                <button onClick={() => downloadEvidence("square-legacy-learning-records.json", Object.fromEntries([
                  "physical-ai-square-math-events-v2", "physical-ai-square-dt-reflections-v1", "physical-ai-square-trials-v1", "physical-ai-square-course-results-v1",
                ].map(key => { try { return [key, JSON.parse(getEvidenceItem(key) ?? "null")]; } catch { return [key,null]; } })))}>이전 기록 내려받기</button>
              </details>
            </details>}
          </>
        ) : (
          <>
            <MissionCard title="블록을 집어 목표 위치에 놓으시오." />

            <p className="lesson-note">DT에서 같은 블록을 흡착 높이 −10 mm에서 운반 높이 {liftHeight} mm로 올립니다. 먼저 절대 높이와 변화량을 구분해 예측하세요.</p>
            <MathInquiryPanel inquiry={inquiry} part="before" locked={status==="running"}
              prompt="흡착 후 얼마나 상승하고, 목표 위치까지 Y가 얼마나 변하나요? 위로 들어 올린 뒤 옆으로 이동하는 이유도 적으세요."/>
            <TrayView gripActive={gripActive} missionDone={status==="done"}/>

            <div style={{ fontSize:12, fontWeight:700, color:"#6b7280", textTransform:"uppercase", letterSpacing:"0.08em" }}>
              시퀀스
            </div>
            <StepList seq={pickSeq} currentStep={currentStep} status={status}/>

            {(!inquiry.ready||hardwareConnected)&&<p className="lesson-note">{hardwareConnected?"실장비 연결 중에는 DT 실습을 잠급니다.":"예측을 저장하면 실행할 수 있습니다."}</p>}
            {(inquiry.ready&&!hardwareConnected||status==="running")&&<RunBtn status={status} onRun={()=>startMission(pickSeq)} onStop={()=>{onMoveEnd();stopAnim();setStatus("idle");}} onReset={onResetPose}/>}
            <MathInquiryPanel inquiry={inquiry} part="after" locked={status==="running"}
              reflectionPrompt="흡착 높이, 운반 높이, 상승 변화량을 연결해 설명하세요. 왜 하강·상승에는 MoveL, 위쪽 운반에는 MoveJ를 썼나요? 이 실행만으로 실제 장애물 충돌 여부도 확인할 수 있나요?"
              onNewCondition={()=>{resetMission();setLiftHeight(h=>h===40?60:40);setConditionRound(n=>n+1);}}/>
            <button disabled={status==="running"} onClick={onResetPose}>↺ DT 장비 원위치</button>
          </>
        )}
      </div>
    </div>
  );
}
