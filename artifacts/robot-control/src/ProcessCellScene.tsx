import { Component, Suspense, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import { ProcessRobotModel, type ViewPreset } from "./Robot3D";
import type { LessonJoints, LessonModel, LessonPose } from "./curriculum";
import type { CellRobot, CellRobotId, CellScenario, CellVisual } from "./processCellTypes";
import { processCameraFit, type ProcessCameraScope } from "./processCamera";
import { worldToLocal } from "./processCell";

type V3 = [number, number, number];
const toThree = (p: Pick<LessonPose, "x" | "y" | "z">): V3 => [p.x, p.z, -p.y];
const BLOCK_HEIGHT = 20;
type VisualRef = RefObject<CellVisual | null>;
const sceneFrame = (visual: CellVisual) => visual.liveFrameRef?.current ?? visual.frame;
const targetPoint = (visual: CellVisual, frame = sceneFrame(visual)) => visual.reviewing ? visual.focusPoint
  : visual.running || visual.predictionPreview ? frame.target : visual.focusPoint ?? frame.target
    ?? (frame.atMs === 0 ? visual.scenario.handoff ?? visual.scenario.destination : null);
// Drei Line owns a GPU geometry/material pair for each points identity. Keep
// fixed outlines stable while the robot and workpieces advance every frame.
const TARGET_LEADER: V3[] = [[0, 0, 0], [0, 24, 0]];
const TRAY_OUTLINE: V3[] = [[-17, 1, -17], [17, 1, -17], [17, 1, 17], [-17, 1, 17], [-17, 1, -17]];
const COORDINATE_AXES: { points: V3[]; label: string; color: string }[] = [
  { points: [[0, 2, 0], [125, 2, 0]], label: "+X", color: "#be123c" },
  { points: [[0, 2, 0], [0, 2, -125]], label: "+Y", color: "#047857" },
  { points: [[0, 2, 0], [0, 185, 0]], label: "+Z", color: "#1d4ed8" },
];
const StableProcessRobotModel = memo(ProcessRobotModel);
const FRAME_COLORS = { A: "#1e3a5f", B: "#0f766e" };
const textStyle = { fontFamily: "inherit", whiteSpace: "nowrap" as const, pointerEvents: "none" as const, userSelect: "none" as const };

function Label({ position, children, color = "#475569" }: {
  position: V3; children: ReactNode; color?: string;
}) {
  return <Html position={position} center zIndexRange={[25, 0]} style={textStyle}>
    <span style={{ display: "block", fontSize: 12, fontWeight: 650, color,
      textShadow: "0 1px 3px #fff, 0 0 5px #fff" }}>{children}</span>
  </Html>;
}

/** Printed on the tabletop: follows perspective and can be occluded by equipment. */
function SurfaceMark({ position, text, color, width = 44, height = 16.5 }: {
  position: V3; text: string; color: string; width?: number; height?: number;
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(96 * width / height); canvas.height = 96;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.font = "600 64px system-ui, sans-serif";
    context.textAlign = "center"; context.textBaseline = "middle";
    context.fillStyle = color;
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return map;
  }, [text, color, width, height]);
  useEffect(() => () => { texture?.dispose(); }, [texture]);
  if (!texture) return null;
  return <mesh position={position} rotation={[-Math.PI / 2, 0, 0]}>
    <planeGeometry args={[width, height]}/>
    <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false}/>
  </mesh>;
}

/** The TCP coordinates in this scene come from the exact existing URDF chain.
 * Bases remain stationary: no visual correction follows the animated TCP. */
function ModelReady({ id, onReady }: { id: CellRobotId; onReady: (id: CellRobotId, ready: boolean) => void }) {
  useEffect(() => { onReady(id, true); return () => onReady(id, false); }, [id, onReady]);
  return null;
}

const CellRobotModel = memo(function CellRobotModel({ robot, visualRef, showCoordinates, selected, dual, model, tcpRef, onReady }: {
  robot: CellRobot; visualRef: VisualRef; showCoordinates: boolean; selected: boolean; dual: boolean;
  model: LessonModel; tcpRef: RefObject<THREE.Mesh | null>;
  onReady: (id: CellRobotId, ready: boolean) => void;
}) {
  const fallback = useMemo(() => model.ik(robot.start.x, robot.start.y, robot.start.z, robot.start.r, -1)
    ?? { j1: 0, j2: 45, j3: -90, j4: 0 }, [model, robot.start]);
  const live = useRef<LessonJoints | null>(fallback);
  // Run before URDFRobot (-1): the model uses every exact playback frame,
  // independently of the slower text/status snapshots sent through React.
  useFrame(() => {
    const visual = visualRef.current;
    live.current = visual ? sceneFrame(visual).robots[robot.id]?.joints ?? fallback : fallback;
  }, -2);
  const color = FRAME_COLORS[robot.id];
  return <group position={toThree(robot.origin)} rotation={[0, robot.yaw * Math.PI / 180, 0]}>
    <Suspense fallback={<Label position={[0, 160, 0]}>로봇 {robot.id} 불러오는 중…</Label>}>
      <StableProcessRobotModel joints={fallback} liveJointsRef={live} tcpRef={tcpRef}/>
      <ModelReady id={robot.id} onReady={onReady}/>
    </Suspense>
    {dual && <Label position={[0, 12, 108]} color={color}>로봇 {robot.id}</Label>}
    {showCoordinates && (selected || dual) && <CoordinateFrame color={color} robotId={dual ? robot.id : undefined}/>}
  </group>;
});

const CoordinateFrame = memo(function CoordinateFrame({ color, robotId }: { color: string; robotId?: CellRobotId }) {
  return <group>
    {COORDINATE_AXES.map(axis => <group key={axis.label}>
      <Line points={axis.points} color={axis.color} lineWidth={2} depthTest={false}/>
      <Label position={axis.points[1]} color={axis.color}>{axis.label}{robotId && <sub>{robotId}</sub>}</Label>
    </group>)}
    <Label position={[-65, 5, 0]} color={color}>{robotId ? `${robotId} 원점` : "원점"}</Label>
  </group>;
});

const Station = memo(function Station({ point, width = 100, depth = 100, name, accent = "#8da9b6" }: {
  point: LessonPose; width?: number; depth?: number; name?: string; accent?: string;
}) {
  const surface = point.z - BLOCK_HEIGHT;
  const legHeight = Math.max(4, surface - 8);
  return <group position={[point.x, 0, -point.y]}>
    <mesh position={[0, surface - 4, 0]} castShadow receiveShadow>
      <boxGeometry args={[width, 8, depth]}/><meshStandardMaterial color="#dbe3e8" roughness={0.65} metalness={0.12}/>
    </mesh>
    <mesh position={[0, surface - 0.5, 0]} receiveShadow>
      <boxGeometry args={[width - 8, 1, depth - 8]}/><meshStandardMaterial color={accent} roughness={0.88}/>
    </mesh>
    {([-1, 1] as const).flatMap(x => ([-1, 1] as const).map(z => <mesh key={`${x}-${z}`}
      position={[x * (width / 2 - 9), legHeight / 2, z * (depth / 2 - 9)]} castShadow>
      <boxGeometry args={[6, legHeight, 6]}/><meshStandardMaterial color="#94a3b1" roughness={0.6}/>
    </mesh>))}
    {name && <SurfaceMark position={[0, surface + 0.4, depth / 2 - 10]} text={name} color="#334e5b"/>}
  </group>;
});

/** A small painted arrow on the fixed side rail points from supply to pickup. */
function FeedDirection({ position }: { position: V3 }) {
  const arrow = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-1.5, 15); shape.lineTo(1.5, 15);
    shape.lineTo(1.5, -5); shape.lineTo(3.5, -5);
    shape.lineTo(0, -15); shape.lineTo(-3.5, -5);
    shape.lineTo(-1.5, -5); shape.closePath();
    return shape;
  }, []);
  return <mesh position={position} rotation={[-Math.PI / 2, 0, 0]}>
    <shapeGeometry args={[arrow]}/><meshBasicMaterial color="#365e73" toneMapped={false}/>
  </mesh>;
}

const HandoffStation = memo(function HandoffStation({ point, status = "empty" }: {
  point: LessonPose; status?: "empty" | "A" | "ready" | "B";
}) {
  return <>
    <Station point={point} name="인계" accent="#c9d9dc" width={82} depth={82}/>
    <group position={[point.x, point.z - BLOCK_HEIGHT, -point.y]}>
      {(["A", "B"] as const).map((robot, index) => {
        const active = status === robot || status === "ready";
        const color = status === "ready" ? "#2ca89b" : status === robot ? FRAME_COLORS[robot] : "#a4b8c1";
        return <mesh key={robot} position={[index === 0 ? -33 : 33, 0.35, -4]}>
          <boxGeometry args={[3, 0.5, 52]}/>
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={active ? 0.25 : 0} roughness={0.8}/>
        </mesh>;
      })}
    </group>
  </>;
});

const Conveyor = memo(function Conveyor({ belt, visualRef, pickupReady, feeding }: {
  belt: NonNullable<CellScenario["belt"]>; visualRef: VisualRef; pickupReady: boolean; feeding: boolean;
}) {
  const center = { x: (belt.from.x + belt.to.x) / 2, y: (belt.from.y + belt.to.y) / 2, z: belt.from.z - BLOCK_HEIGHT };
  const dx = belt.to.x - belt.from.x, dz = -(belt.to.y - belt.from.y);
  const angle = Math.atan2(dx, dz);
  const length = Math.max(belt.length, Math.hypot(dx, dz) + 65), width = Math.max(60, belt.width);
  const pickupZ = Math.hypot(dx, dz) / 2;
  const sensorSide = Math.cos(angle) >= 0 ? 1 : -1;
  const sensorColor = pickupReady ? "#2dd4bf" : feeding ? "#60a5fa" : "#64748b";
  const stripeCount = Math.ceil(length / 22), pitch = length / stripeCount;
  const stripeRef = useRef<(THREE.Mesh | null)[]>([]);
  const rollerRef = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    // Belt travel is driven by the lesson frame, so pause/reset stays exact.
    const visual = visualRef.current;
    const travel = (visual ? sceneFrame(visual).beltProgress : 0) * belt.travel;
    stripeRef.current.forEach((stripe, i) => {
      if (stripe) stripe.position.z = ((i * pitch + travel) % length + length) % length - length / 2;
    });
    rollerRef.current.forEach(roller => { if (roller) roller.rotation.x = travel / 10; });
  });
  return <group position={toThree(center)} rotation={[0, angle, 0]}>
    <mesh position={[0, -10, 0]} castShadow><boxGeometry args={[width + 12, 20, length + 14]}/><meshStandardMaterial color="#8295a5" roughness={0.5} metalness={0.25}/></mesh>
    <mesh position={[0, -1, 0]} receiveShadow><boxGeometry args={[width, 2, length]}/><meshStandardMaterial color="#203948" roughness={0.98}/></mesh>
    {Array.from({ length: stripeCount }, (_, i) => <mesh key={i} ref={node => { stripeRef.current[i] = node; }} position={[0, 0.1, i * pitch - length / 2]}>
      <boxGeometry args={[width - 4, 0.2, 1.2]}/><meshStandardMaterial color="#708b98" roughness={0.95}/>
    </mesh>)}
    {[-1, 1].map((end, i) => <group key={end} position={[0, -9, end * length / 2]} ref={node => { rollerRef.current[i] = node; }}>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[10, 10, width + 8, 24]}/><meshStandardMaterial color="#c4d0d6" metalness={0.45} roughness={0.4}/></mesh>
      <mesh position={[0, 8, 0]}><boxGeometry args={[width + 8, 1.5, 2]}/><meshStandardMaterial color="#7c92a1"/></mesh>
    </group>)}
    {[-1, 1].map(side => <mesh key={side} position={[side * (width / 2 + 5), 1, 0]}>
      <boxGeometry args={[8, 8, length + 12]}/><meshStandardMaterial color="#c6d2d9" metalness={0.25}/>
    </mesh>)}
    <FeedDirection position={[sensorSide * (width / 2 + 5), 5.2, -length / 4]}/>
    {/* The pickup sensor sits outside the rail, clear of the block and TCP path. */}
    <group position={[sensorSide * (width / 2 + 17), 0, pickupZ]}>
      <mesh position={[-sensorSide * 6, 1, 0]} castShadow><boxGeometry args={[18, 4, 14]}/><meshStandardMaterial color="#8ca1ae" roughness={0.6}/></mesh>
      <mesh position={[0, 12, 0]} castShadow><boxGeometry args={[12, 18, 12]}/><meshStandardMaterial color="#344e5f" roughness={0.65}/></mesh>
      <mesh position={[-sensorSide * 6.2, 12, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[2, 2, 0.5, 12]}/><meshStandardMaterial color="#93c5fd" roughness={0.25}/>
      </mesh>
      <mesh position={[0, 21.5, 0]}>
        <cylinderGeometry args={[2.8, 2.8, 1, 16]}/>
        <meshStandardMaterial color={sensorColor} emissive={sensorColor} emissiveIntensity={pickupReady || feeding ? 0.55 : 0} toneMapped={false}/>
      </mesh>
    </group>
    {[-1, 1].flatMap(x => [-1, 1].map(z => <mesh key={`${x}-${z}`} position={[x * (width / 2 - 8), -center.z / 2 - 10, z * (length / 2 - 22)]} castShadow>
      <boxGeometry args={[8, Math.max(10, center.z - 20), 8]}/><meshStandardMaterial color="#91a5b2" roughness={0.7}/>
    </mesh>))}
  </group>;
});

const Tray = memo(function Tray({ tray, selection }: { tray: NonNullable<CellScenario["tray"]>; selection?: CellVisual["packing"] }) {
  const xs = tray.points.map(p => p.x), ys = tray.points.map(p => p.y);
  const center = { ...tray.origin, x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  const width = Math.max(...xs) - Math.min(...xs) + 60, depth = Math.max(...ys) - Math.min(...ys) + 60;
  return <>
    <Station point={center} width={width + 10} depth={depth + 10} accent="#c5d3dc" name="포장"/>
    {tray.points.map((point, i) => <group key={i} position={[point.x, point.z - BLOCK_HEIGHT - 0.5, -point.y]}>
      <mesh receiveShadow onClick={event => { event.stopPropagation(); selection?.onSelectSlot(i); }}>
        <boxGeometry args={[32, 1, 32]}/><meshStandardMaterial color={selection?.selectedSlot === i ? "#c7d2fe" : "#eaf2f6"} roughness={0.9}/></mesh>
      <Line points={TRAY_OUTLINE}
        color={selection?.selectedSlot === i ? "#4f46e5" : "#8299a9"} lineWidth={selection?.selectedSlot === i ? 3 : 1}/>
      <SurfaceMark position={[point.x < center.x ? -26 : 26, 1.1, 0]}
        text={`${i + 1}`} color="#475569" width={16} height={12}/>
    </group>)}
  </>;
});

function PackingPrediction({ visual }: { visual: CellVisual }) {
  const selected = visual.packing?.cells.find(cell => cell.slot === visual.packing?.selectedSlot);
  if (!selected?.command || visual.running || visual.predictionPreview || visual.hideTargetCoordinates) return null;
  const goal = visual.scenario.tray!.points[selected.slot], command = selected.command;
  if (![command.x, command.y, command.z].every(Number.isFinite)
    || Math.hypot(goal.x - command.x, goal.y - command.y, goal.z - command.z) < 0.2) return null;
  return <group>
    <Line points={[toThree(goal), toThree(command)]} color="#6366f1" dashed dashSize={4} gapSize={3} lineWidth={2}/>
    <mesh position={toThree(command)}><sphereGeometry args={[4, 16, 12]}/><meshBasicMaterial color="#6366f1"/></mesh>
    <Label position={[command.x, command.z + 36, -command.y]} color="#4338ca">칸 {selected.slot + 1} · 내 예측</Label>
  </group>;
}

const Workpiece = memo(function Workpiece({ id, placed, tcpRefs, visualRef }: {
  id: string; placed: boolean; tcpRefs: Record<CellRobotId, RefObject<THREE.Mesh | null>>; visualRef: VisualRef;
}) {
  const root = useRef<THREE.Group>(null);
  const world = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const visual = visualRef.current;
    if (!root.current || !visual) return;
    const frame = sceneFrame(visual);
    const piece = frame.workpieces.find(item => item.id === id);
    root.current.visible = !!piece;
    if (!piece) return;
    const tcp = piece.owner ? tcpRefs[piece.owner].current : null;
    if (tcp) {
      tcp.getWorldPosition(world);
      root.current.position.copy(world);
      const robot = visual.scenario.robots.find(r => r.id === piece.owner);
      const pose = frame.robots[piece.owner!]?.pose;
      root.current.rotation.y = ("designLevel" in visual.scenario ? piece.top.r : (robot?.yaw ?? 0) + (pose?.r ?? 0)) * Math.PI / 180;
    } else {
      root.current.position.set(...toThree(piece.top));
      root.current.rotation.y = piece.top.r * Math.PI / 180;
    }
  });
  return <group ref={root}>
    <mesh position={[0, -BLOCK_HEIGHT / 2, 0]} castShadow receiveShadow>
      <boxGeometry args={[24, BLOCK_HEIGHT, 24]}/><meshStandardMaterial color={placed ? "#4db4a8" : "#38b7e1"} roughness={0.52} metalness={0.04}/>
    </mesh>
    <mesh position={[0, 0.3, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[4, 20]}/><meshStandardMaterial color="#e0f7ff"/></mesh>
  </group>;
});

const Target = memo(function Target({ visualRef, label = "작업점" }: { visualRef: VisualRef; label?: string }) {
  const root = useRef<THREE.Group>(null);
  useFrame(() => {
    const visual = visualRef.current;
    if (!root.current || !visual) return;
    const frame = sceneFrame(visual);
    const point = targetPoint(visual, frame);
    root.current.visible = !!point;
    if (point) root.current.position.set(...toThree(point));
  });
  return <group ref={root} visible={false}>
    <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[6, 8, 32]}/><meshBasicMaterial color="#0f766e" depthTest={false} transparent opacity={0.8}/></mesh>
    <Line points={TARGET_LEADER} color="#0f766e" lineWidth={1}/>
    <Label position={[0, 33, 0]} color="#0f766e">{label}</Label>
  </group>;
});

const RouteSegment = memo(function RouteSegment({ from, to, color }: { from: LessonPose; to: LessonPose; color: string }) {
  const shape = useMemo(() => {
    const start = new THREE.Vector3(...toThree(from)), end = new THREE.Vector3(...toThree(to));
    const direction = end.clone().sub(start), length = direction.length();
    if (!Number.isFinite(length) || length < 0.1) return null;
    return { points: [start.toArray() as V3, end.toArray() as V3],
      position: start.lerp(end, 0.62).toArray() as V3,
      rotation: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()),
      size: Math.min(12, length * 0.3) };
  }, [from, to]);
  if (!shape) return null;
  return <group>
    <Line points={shape.points} color={color} lineWidth={2.6} transparent opacity={0.7} depthTest={false}/>
    <mesh position={shape.position} quaternion={shape.rotation}>
      <coneGeometry args={[shape.size * 0.38, shape.size, 12]}/><meshBasicMaterial color={color} depthTest={false}/>
    </mesh>
  </group>;
});

const PlannedRoute = memo(function PlannedRoute({ path }: { path: NonNullable<CellVisual["plannedPath"]> }) {
  const points = useMemo(() => path.map(item => toThree(item.pose)), [path]);
  if (points.length < 2 || points.some(point => point.some(value => !Number.isFinite(value)))) return null;
  return <group>
    {path.slice(1).map((item, index) => <RouteSegment key={index} from={path[index].pose} to={item.pose} color="#6366f1"/>)}
    {path.map((item, index) => <group key={item.label} position={points[index]}>
      <mesh><sphereGeometry args={[3.2, 12, 8]}/><meshBasicMaterial color="#6366f1" depthTest={false}/></mesh>
      {item.label !== "경유" && <Label position={[index % 2 ? -22 : 14, 16, 0]} color="#4338ca">{item.label}</Label>}
    </group>)}
  </group>;
});

const TcpMarker = memo(function TcpMarker({ tcpRef }: { tcpRef: RefObject<THREE.Mesh | null> }) {
  const marker = useRef<THREE.Group>(null);
  const position = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (!marker.current) return;
    marker.current.visible = !!tcpRef.current;
    if (tcpRef.current) {
      tcpRef.current.updateWorldMatrix(true, false);
      tcpRef.current.getWorldPosition(position);
      marker.current.position.copy(position);
    }
  });
  return <group ref={marker} visible={false}>
    <mesh><sphereGeometry args={[3.2, 16, 12]}/><meshBasicMaterial color="#4f46e5" depthTest={false}/></mesh>
  </group>;
});

function CellCamera({ scenario, scope, framingKey, preset, homeViewKey, onViewFree, path }: {
  scenario: CellScenario; scope: ProcessCameraScope; framingKey: number;
  preset: ViewPreset; homeViewKey: number; onViewFree?: () => void;
  path?: LessonPose[];
}) {
  const { camera, size } = useThree();
  const controls = useRef<any>(null);
  const manualOrbit = useRef(false);
  const lastView = useRef({ scenarioId: scenario.id, scope, framingKey, preset, homeViewKey, width: size.width, height: size.height });
  const fit = useMemo(() => processCameraFit(scenario, scope, preset, size.width / Math.max(1, size.height), 41, path),
    [scenario, scope, preset, size.width, size.height, path]);
  useEffect(() => {
    const previous = lastView.current;
    lastView.current = { scenarioId: scenario.id, scope, framingKey, preset, homeViewKey, width: size.width, height: size.height };
    if (manualOrbit.current && preset === "free" && previous.preset !== "free"
      && previous.homeViewKey === homeViewKey && previous.scenarioId === scenario.id
      && previous.scope === scope && previous.framingKey === framingKey
      && previous.width === size.width && previous.height === size.height) {
      manualOrbit.current = false;
      return;
    }
    manualOrbit.current = false;
    camera.position.set(...fit.position);
    camera.up.set(0, 1, 0); camera.lookAt(...fit.target); camera.updateProjectionMatrix();
    controls.current?.target.set(...fit.target); controls.current?.update();
  }, [camera, fit, scenario.id, scope, framingKey, preset, homeViewKey, size.width, size.height]);
  return <OrbitControls ref={controls} makeDefault minDistance={200} maxDistance={Math.max(2600, fit.distance * 1.5)}
    minPolarAngle={0.01} maxPolarAngle={Math.PI * 0.49} enableDamping dampingFactor={0.12}
    onStart={() => { manualOrbit.current = true; onViewFree?.(); }}/>;
}

function ContextStatus({ onLost, onRestored }: { onLost: () => void; onRestored: () => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (event: Event) => { event.preventDefault(); onLost(); };
    canvas.addEventListener("webglcontextlost", lost); canvas.addEventListener("webglcontextrestored", onRestored);
    return () => { canvas.removeEventListener("webglcontextlost", lost); canvas.removeEventListener("webglcontextrestored", onRestored); };
  }, [gl, onLost, onRestored]);
  return null;
}

class CellSceneBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function ProcessCellScene({ visual, model, viewPreset = "free", homeViewKey = 0, onViewFree, onReadyChange }: {
  visual: CellVisual | null; model: LessonModel; viewPreset?: ViewPreset; homeViewKey?: number; onViewFree?: () => void;
  onReadyChange?: (ready: boolean) => void;
}) {
  const tcpA = useRef<THREE.Mesh>(null), tcpB = useRef<THREE.Mesh>(null);
  const tcpRefs = useMemo(() => ({ A: tcpA, B: tcpB }), []);
  const visualRef = useRef(visual);
  visualRef.current = visual;
  const [contextLost, setContextLost] = useState(false);
  const [sceneFailed, setSceneFailed] = useState(false);
  const [rendererKey, setRendererKey] = useState(0);
  const rendererGeneration = useRef(rendererKey);
  rendererGeneration.current = rendererKey;
  const automaticRecoveryUsed = useRef(false);
  const [cameraScope, setCameraScope] = useState<ProcessCameraScope>("whole");
  const [framingKey, setFramingKey] = useState(0);
  const scenarioId = visual?.scenario.id ?? null;
  const collaborative = !!visual?.scenario.handoff;
  const singleDesign = visual?.scenario.id.startsWith("pickplace-design-");
  const restoreOverview = collaborative || visual?.scenario.level === 1;
  const resetView = useRef(onViewFree);
  resetView.current = onViewFree;
  useEffect(() => {
    if (!restoreOverview) return;
    // Start with the task's overview instead of an earlier lesson's preset.
    setCameraScope(visual?.scenario.level === 4 ? "work" : "whole"); setFramingKey(key => key + 1); resetView.current?.();
  }, [scenarioId, restoreOverview]);
  useEffect(() => {
    if (!visual?.cameraRequest) return;
    setCameraScope(visual.cameraRequest.scope); setFramingKey(key => key + 1); resetView.current?.();
  }, [visual?.cameraRequest]);
  const currentScenario = useRef(scenarioId);
  currentScenario.current = scenarioId;
  const [modelsReady, setModelsReady] = useState<{
    scenarioId: string | null; generation: number; robots: Partial<Record<CellRobotId, boolean>>;
  }>({ scenarioId: null, generation: 0, robots: {} });
  const handleModelReady = useCallback((id: CellRobotId, ready: boolean) => {
    // A disposed model can report "not ready" after its replacement mounts.
    // Only the current scenario AND renderer may change the readiness gate.
    if (currentScenario.current !== scenarioId || rendererGeneration.current !== rendererKey) return;
    setModelsReady(previous => {
      const same = previous.scenarioId === scenarioId && previous.generation === rendererKey;
      if (same && previous.robots[id] === ready) return previous;
      return { scenarioId, generation: rendererKey, robots: { ...(same ? previous.robots : {}), [id]: ready } };
    });
  }, [scenarioId, rendererKey]);
  const handleContextLost = useCallback(() => {
    if (rendererGeneration.current === rendererKey) setContextLost(true);
  }, [rendererKey]);
  const handleContextRestored = useCallback(() => {
    if (rendererGeneration.current === rendererKey) setContextLost(false);
  }, [rendererKey]);
  const handleSceneError = useCallback(() => {
    if (rendererGeneration.current === rendererKey) setSceneFailed(true);
  }, [rendererKey]);
  const restartRenderer = useCallback((manual = false) => {
    if (manual) automaticRecoveryUsed.current = false;
    // Invalidate old callbacks immediately, before React cleans up the canvas.
    rendererGeneration.current += 1;
    setModelsReady({ scenarioId: null, generation: rendererGeneration.current, robots: {} });
    setContextLost(false); setSceneFailed(false);
    setRendererKey(rendererGeneration.current);
  }, []);
  useEffect(() => {
    if ((!contextLost && !sceneFailed) || automaticRecoveryUsed.current) return;
    const timer = window.setTimeout(() => {
      automaticRecoveryUsed.current = true;
      restartRenderer();
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [contextLost, sceneFailed, restartRenderer]);
  const ready = !!visual && modelsReady.scenarioId === scenarioId && modelsReady.generation === rendererKey
    && !contextLost && !sceneFailed && visual.scenario.robots.every(robot => modelsReady.robots[robot.id]);
  useEffect(() => { onReadyChange?.(ready); }, [onReadyChange, ready]);
  useEffect(() => () => { onReadyChange?.(false); }, [onReadyChange]);
  if (!visual) return <div role="status" style={{ padding: 32, color: "#475569" }}>공정 과제를 준비하고 있습니다…</div>;
  const { scenario, frame } = visual;
  const selectedPose = frame.robots[visual.selectedRobot]?.pose;
  const selectedTarget = targetPoint(visual, frame);
  const targetLocal = selectedTarget && !visual.hideTargetCoordinates
    ? worldToLocal(selectedTarget, scenario.robots.find(robot => robot.id === visual.selectedRobot)!) : null;
  const gap = targetLocal && selectedPose ? Math.hypot(targetLocal.x - selectedPose.x, targetLocal.y - selectedPose.y, targetLocal.z - selectedPose.z) : null;
  const belt = scenario.belt;
  const pickupReady = !!belt && frame.beltProgress >= 1 && frame.workpieces.some(piece => !piece.owner && !piece.placed
    && Math.hypot(piece.top.x - belt.to.x, piece.top.y - belt.to.y, piece.top.z - belt.to.z) < 0.2);
  const feeding = !!belt && (visual.running || !!visual.predictionPreview) && frame.beltProgress > 0 && frame.beltProgress < 1 && frame.workpieces.some(piece => {
    if (piece.owner || piece.placed || Math.abs(piece.top.z - belt.from.z) >= 3) return false;
    const dx = belt.to.x - belt.from.x, dy = belt.to.y - belt.from.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) return false;
    const px = piece.top.x - belt.from.x, py = piece.top.y - belt.from.y;
    const along = (px * dx + py * dy) / length;
    return along >= -3 && along <= length + 3 && Math.abs(px * dy - py * dx) / length < 3;
  });
  return <div role="region" aria-label={`${scenario.title} 3D 공정`} style={{ width: "100%", height: "100%", minHeight: 320,
    position: "relative", background: "#edf2f5" }} onWheel={event => event.stopPropagation()}>
    <CellSceneBoundary key={rendererKey} onError={handleSceneError}>
      <Canvas role="img" aria-label={`${scenario.title}: ${frame.phase}`} shadows dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: "high-performance" }}
        fallback={<div style={{ padding: 32 }}>3D 화면을 표시할 수 없습니다. 브라우저의 그래픽 가속 설정을 확인해 주세요.</div>}>
        <color attach="background" args={["#edf2f5"]}/>
        <PerspectiveCamera makeDefault position={[440, 820, 1080]} fov={41} near={1} far={10000}/>
        <ambientLight intensity={0.72}/><hemisphereLight args={["#f4faff", "#b6c4cf", 0.8]}/>
        <directionalLight position={[-300, 950, 500]} intensity={2.2} castShadow shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-900} shadow-camera-right={900} shadow-camera-top={900} shadow-camera-bottom={-900}
          shadow-camera-near={10} shadow-camera-far={2200} shadow-bias={-0.0004}/>
        <directionalLight position={[900, 450, -400]} intensity={0.85} color="#e8f4ff"/>
        <mesh position={[300, -5, 0]} receiveShadow><boxGeometry args={[1550, 8, 1000]}/><meshStandardMaterial color="#e3eaf0" roughness={0.95}/></mesh>
        <mesh position={[300, -10, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[4500, 4500]}/><meshStandardMaterial color="#edf2f5"/></mesh>
        {scenario.robots.map(robot => <CellRobotModel key={`${scenario.id}-${robot.id}`} robot={robot}
          visualRef={visualRef} showCoordinates={cameraScope === "frames" || (visual.showCoordinates && cameraScope !== "packing")} selected={visual.selectedRobot === robot.id}
          dual={scenario.robots.length > 1} model={model} tcpRef={tcpRefs[robot.id]} onReady={handleModelReady}/>)}
        {scenario.belt ? <Conveyor belt={scenario.belt} visualRef={visualRef} pickupReady={pickupReady} feeding={feeding}/>
          : <Station point={scenario.source} name="출발" width={collaborative ? 82 : 100} accent="#c9dce6"/>}
        {scenario.handoff && <HandoffStation point={scenario.handoff} status={frame.processStatus?.handoff}/>}
        {scenario.tray ? <Tray tray={scenario.tray} selection={visual.packing}/> : <Station point={scenario.destination} name="도착" width={collaborative ? 82 : 100} accent="#b7d9d2"/>}
        {scenario.tray && <PackingPrediction visual={visual}/>}
        {collaborative && <>
          <Label position={[scenario.source.x - 42, scenario.source.z + 8, -scenario.source.y + 58]} color={FRAME_COLORS.A}>A 집기</Label>
          <Label position={[scenario.destination.x + 42, scenario.destination.z + 8, -scenario.destination.y + 58]} color={FRAME_COLORS.B}>{scenario.tray ? "B 포장" : "B 배치"}</Label>
        </>}
        {frame.workpieces.map(piece => <Workpiece key={piece.id} id={piece.id} placed={piece.placed}
          tcpRefs={tcpRefs} visualRef={visualRef}/>)}
        <Target visualRef={visualRef} label={visual.predictionPreview ? "예측 이동 지점" : visual.running ? "현재 작업점" : visual.focusLabel ?? (collaborative ? "공용 인계점 H" : "놓을 지점")}/>
        {visual.plannedPath && <PlannedRoute path={visual.plannedPath}/>}
        {(visual.packing?.selectedSlot == null || visual.predictionPreview || visual.running) && visual.predictedRoutes?.map(route => <group key={route.robot}>{route.segments.map((segment, index) =>
          <RouteSegment key={index} from={segment.from} to={segment.to} color={route.robot === "A" ? "#6366f1" : "#0f766e"}/>)}</group>)}
        {visual.showCoordinates && <TcpMarker tcpRef={tcpRefs[visual.selectedRobot]}/> }
        <CellCamera scenario={scenario} scope={cameraScope} framingKey={framingKey} path={visual.framingPoints}
          preset={viewPreset} homeViewKey={homeViewKey} onViewFree={onViewFree}/>
        <ContextStatus onLost={handleContextLost} onRestored={handleContextRestored}/>
      </Canvas>
    </CellSceneBoundary>
    <div role="group" aria-label="공정 보기 범위" style={{ position: "absolute", top: 12, right: 14,
      display: "flex", flexWrap: "wrap", maxWidth: "calc(100% - 28px)", gap: 3, padding: 3, border: "1px solid #cbd5e1", borderRadius: 8,
      background: "#fffffff0" }}>
      {([ ["whole", collaborative ? "협동 구도" : singleDesign ? "전체 작업" : "전체 공정"], ["work", scenario.tray ? "작업대 보기" : collaborative ? "인계점 확대" : "작업점 확대"],
        ...(collaborative ? [["frames", "좌표계 비교"]] : []),
        ...(scenario.tray ? [["packing", "포장 확대"]] : []) ] as [ProcessCameraScope, string][]).map(([scope, label]) =>
        <button key={scope} type="button" aria-pressed={cameraScope === scope}
          onClick={() => { setCameraScope(scope); setFramingKey(key => key + 1); resetView.current?.(); }}
          style={{ padding: "7px 11px", minHeight: 34, border: 0, borderRadius: 5,
            font: "inherit", fontSize: 12, fontWeight: 650, cursor: "pointer",
            color: cameraScope === scope ? "#fff" : "#475569",
            background: cameraScope === scope ? (singleDesign ? "#0c4a6e" : "#4f46e5") : "transparent" }}>{label}</button>)}
    </div>
    <div aria-hidden="true" style={{ position: "absolute", left: 14, bottom: 12, fontSize: 11, color: "#64748b", pointerEvents: "none" }}>
      <span style={{ color: "#4f46e5" }}>● TCP</span> · <span style={{ color: "#0f766e" }}>◎ 작업점</span> · 드래그로 회전 · 휠로 확대
    </div>
    {(visual.predictionPreview || visual.running || visual.plannedPath || visual.predictedRoutes) && <div role="status" style={{ position: "absolute", left: 14, bottom: 38,
      maxWidth: "calc(100% - 28px)", padding: "6px 10px", background: "#f5f7ffed", borderLeft: "3px solid #818cf8", borderRadius: 3, color: "#3730a3", fontSize: 12, pointerEvents: "none" }}>
      <strong>{visual.predictionPreview ? `예측 미리보기 · ${visual.predictionPreview.progress}%` : visual.running ? (singleDesign ? "내 계획 DT 실행" : "공정 실행") : singleDesign ? "관찰 TCP 경로 · 가상 계산" : "내 예측 경로 · 화살표는 이동 방향"}</strong>
      {(visual.predictionPreview || visual.running) && <div>{frame.processStatus?.B
        ? `A ${scenario.tray && frame.processStatus.APiece ? "블록 " + frame.processStatus.APiece + " · " : ""}${frame.processStatus.A} / B ${scenario.tray && frame.processStatus.BPiece ? "블록 " + frame.processStatus.BPiece + " · " : ""}${frame.processStatus.B}` : frame.phase}</div>}
      {visual.predictedRoutes && <div><span style={{ color: "#6366f1" }}>━ {singleDesign ? "재생된 TCP 궤적" : "A 경로"}</span>{collaborative && <> · <span style={{ color: "#0f766e" }}>━ B 경로</span></>}</div>}
    </div>}
    {scenario.tray && visual.packing && <div className="process-scene-packing" role="group" aria-label="왼쪽 포장 칸 선택">
      <strong>포장 칸 · B 기준</strong>
      <div>{[1, 0, 3, 2].map(slot => <button type="button" key={slot} aria-label={`왼쪽 칸 ${slot + 1} 보기`}
        aria-pressed={visual.packing!.selectedSlot === slot} disabled={visual.running}
        onClick={() => visual.packing!.onSelectSlot(slot)}>칸 {slot + 1}</button>)}</div>
      <small>← +X<sub>B</sub> · +Y<sub>B</sub> ↓</small>
    </div>}
    {visual.showCoordinates && <div style={{ position: "absolute", top: 64, left: 14, padding: "5px 9px", background: "#ffffffee",
      border: "1px solid #cbd5e1", color: FRAME_COLORS[visual.selectedRobot], fontSize: 12, borderRadius: 3 }}>
      <div>{visual.reviewing ? "관찰 장면 · " : ""}로봇 {visual.selectedRobot} 기준 · mm</div>
      {selectedPose && <div style={{ marginTop: 3, fontVariantNumeric: "tabular-nums", color: "#475569" }}>
        {visual.predictionPreview ? "예측 TCP" : "현재 TCP"} ({selectedPose.x.toFixed(1)}, {selectedPose.y.toFixed(1)}, {selectedPose.z.toFixed(1)})
      </div>}
      {targetLocal && <div style={{ marginTop: 3, fontVariantNumeric: "tabular-nums", color: "#0f766e" }}>
        선택 지점 ({targetLocal.x.toFixed(1)}, {targetLocal.y.toFixed(1)}, {targetLocal.z.toFixed(1)})
        <div>{gap !== null && (gap <= 0.2 ? "TCP가 선택 지점에 도달했습니다." : `TCP와 선택 지점의 거리 ${gap.toFixed(1)} mm`)}</div>
      </div>}
    </div>}
    {(contextLost || sceneFailed) && <div role="alert" style={{ position: "absolute", inset: 0, zIndex: 30,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
      background: "#edf2f5ee", color: "#334155", fontSize: 14 }}>
      <span>{automaticRecoveryUsed.current ? "3D 화면을 다시 열어 주세요." : "3D 화면을 복구하고 있습니다…"}</span>
      <span>진행하던 공정은 멈추고 마지막 위치를 유지합니다.</span>
      <button type="button" onClick={() => restartRenderer(true)} style={{ padding: "8px 16px", border: "1px solid #94a3b8",
        borderRadius: 6, background: "#fff", color: "#334155", font: "inherit", cursor: "pointer" }}>3D 화면 다시 열기</button>
    </div>}
  </div>;
}
