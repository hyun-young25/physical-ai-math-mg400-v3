import { SquareComparisonOverlay } from "./SquareComparisonOverlay";
import { RevisionSceneOverlay, RevisionSceneDock } from "./RevisionScene";
import { PaperSceneOverlay, PaperSceneToolbar, PaperSceneCaption, PaperSceneMap } from "./PaperScene";
import { usePaperScene } from "./paperSceneStore";
import { PaperRobotAppearance } from "./PaperRobotDisplay";
import { SquareComparisonControls,SquareFallbackComparison } from "./SquareComparisonView";
import { useSquareVisual } from "./useSquareVisual";
import { useActiveRevisionScene } from "./revisionSceneStore";
import { MotionComparisonOverlay, MotionComparisonLegend } from "./MotionComparisonOverlay";
import type { MotionComparisonVisual } from "./motionComparison";
import { useState, useEffect, useRef, Suspense, useMemo, useCallback, Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { OrbitControls, Grid, PerspectiveCamera, useGLTF, useFBX, Environment, Html, Line } from "@react-three/drei";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import * as THREE from "three";
import { AxisLessonOverlay } from "./AxisLessonOverlay";
import type { AxisLessonVisual } from "./axisLesson";
import { CoordinateStudyCamera } from "./CoordinateStudyCamera";
import { FOUNDATION_STUDY_VIEW, SHAPE_STUDY_VIEW, KINEMATICS_STUDY_VIEW } from "./coordinateStudyView";
import { SHAPE_PEN_TIP_LOCAL_Z, shapeWorldPoint } from "./shapeKinematics";
import { ShapeTraceBuffer } from "./shapeTrace";
import { KINEMATICS_JOINT_LABELS, type KinematicsVisual } from "./kinematicsLearning";
import type { ShapePlanningFocus } from "./shapeLearning";
import { CoordinateLessonOverlay } from "./CoordinateLessonOverlay";
import type { CoordinateVisual } from "./coordinateLearning";
import { SuctionCup } from "./SuctionCup";
import { SuctionZoomPanel, SuctionZoomPass } from "./SuctionZoom";
import { applyLink5Finish, cleanLink5Silhouette } from "./link5Appearance";
import { ClosedLinkTransform } from "./closedLinkTransform";

interface Joints { j1: number; j2: number; j3: number; j4: number; }

export interface LearningVisualPoint {
  label: string;
  x: number;
  y: number;
  z: number;
}

export interface LearningVisualState {
  stage: number;
  stageLabel: string;
  axisChoice: "x-plus" | "x-minus" | "y-plus" | null;
  axisDistance: number;
  studentPoints: LearningVisualPoint[];
  studentPath?: LearningVisualPoint[];
  planningFocus?: ShapePlanningFocus;
  targetPath: LearningVisualPoint[];
  programmedPath: LearningVisualPoint[];
  measuredPath: LearningVisualPoint[];
  trajectoryKind: "closed-rectangle" | "open-path" | "curved-sides" | null;
  traceActive: boolean;
  traceVisible: boolean;
  traceEndpoint?: { x: number; y: number; z: number } | null;
  activePointIndex: number;
  showTarget: boolean;
  showProgram: boolean;
  sequenceMatchesTarget: boolean;
  measurementSource: "hardware" | "virtual" | null;
}

/* ── WebGL check ─────────────────────────────────────────────────── */
function canUseWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    const context = window.WebGLRenderingContext
      ? (c.getContext("webgl") || c.getContext("experimental-webgl"))
      : null;
    const available = !!context;
    // This is only a capability probe. Release its context immediately so
    // repeated React renders cannot exhaust the browser's WebGL context limit.
    (context as WebGLRenderingContext | null)
      ?.getExtension("WEBGL_lose_context")
      ?.loseContext();
    return available;
  } catch { return false; }
}

/* ══════════════════════════════════════════════════════════════════
   MATERIAL PALETTE  — matches actual DOBOT MG400 color scheme
   • Base / arm housing : light silver-gray
   • Motor / joint      : dark anthracite
   • Tool               : blue
══════════════════════════════════════════════════════════════════ */
const MAT = {
  /* ── DOBOT MG400 palette — calibrated against real product photos ────
     Three clearly distinct tones for the base assembly (light → mid → dark):
       baseCool    : main body enclosure — clean light silver-gray (#b2b6ba)
       alum        : foot rail + corner columns — medium-dark gray  (#707478)
       collarTopDk : top collar ring (body↔J1 joint) — dark charcoal (#252929)
     No HDRI → keep metalness LOW; contrast is carried by the color value.
  ───────────────────────────────────────────────────────────────────── */

  /* ── Base enclosure — light silver-gray (brightest of the three base tones) */
  baseCool:  new THREE.MeshStandardMaterial({ color:"#b2b6ba", roughness:0.43, metalness:0.08 }),
  /* ── Foot rail / corner accents — medium-dark gray (clear step below body) */
  alum:      new THREE.MeshStandardMaterial({ color:"#707478", roughness:0.56, metalness:0.12 }),
  alumHi:    new THREE.MeshStandardMaterial({ color:"#b8bcC0", roughness:0.40, metalness:0.08 }),
  /* Top collar — darker band at the top of the base box (visible separation) */
  collarDk:  new THREE.MeshStandardMaterial({ color:"#2a2e30", roughness:0.56, metalness:0.14 }),
  /* ── Top collar ring — darkest base element; demarcates body from rotating J1 */
  collarTopDk: new THREE.MeshStandardMaterial({ color:"#252929", roughness:0.58, metalness:0.14 }),
  /* Upper third of base box — darker band independent of lighting angle */
  baseUp:      new THREE.MeshStandardMaterial({ color:"#262a2e", roughness:0.88, metalness:0.02 }),

  /* ── Shoulder / joint motor housings — dark charcoal
     With studio HDRI: environment provides multi-directional reflections so
     dark surfaces show 3D form naturally. Use true dark charcoal + moderate
     roughness for the real matte-plastic motor cover look.                 */
  shoulderDk:new THREE.MeshStandardMaterial({ color:"#282828", roughness:0.68, metalness:0.10 }),
  jnt:       new THREE.MeshStandardMaterial({ color:"#242424", roughness:0.65, metalness:0.10 }),
  shoulderMd:new THREE.MeshStandardMaterial({ color:"#303030", roughness:0.72, metalness:0.08 }),

  /* ── Arm panels — anodized aluminum (same family as base, NOT white)
     Reference clearly shows silver-gray arm panels matching the base box.
     Low metalness keeps color visible without over-shining under flat lighting. */
  armW:      new THREE.MeshStandardMaterial({ color:"#c4c8cc", roughness:0.44, metalness:0.18 }),
  armHi:     new THREE.MeshStandardMaterial({ color:"#ccd0d2", roughness:0.40, metalness:0.22 }),

  /* ── Matte black accent strip on arms                                    */
  carbon:    new THREE.MeshStandardMaterial({ color:"#0e0e0e", roughness:0.85, metalness:0.04 }),

  /* ── Tool / end-effector — dark matte gray matching real product photo   */
  toolBox:   new THREE.MeshStandardMaterial({ color:"#808488", roughness:0.72, metalness:0.08 }),
  toolDk:    new THREE.MeshStandardMaterial({ color:"#1e1e1e", roughness:0.55, metalness:0.15 }),
  lens:      new THREE.MeshStandardMaterial({ color:"#060606", roughness:0.06, metalness:0.92 }),
  /* Suction cup — neutral translucent silicone, no color tint */
  sucker:    new THREE.MeshStandardMaterial({ color:"#d0d0ce", roughness:0.78, metalness:0, transparent:true, opacity:0.82 }),
  /* Spring / hex connector — bright metallic silver (nuts, hex body) */
  spring:    new THREE.MeshStandardMaterial({ color:"#e0e4e6", roughness:0.18, metalness:0.80 }),
  /* Coil spring wire — bright polished steel, high contrast vs silver hex body */
  springCoil: new THREE.MeshStandardMaterial({ color:"#b0b8bc", roughness:0.22, metalness:0.78 }),
  orange:    new THREE.MeshStandardMaterial({ color:"#ff5500", emissive:"#ff3800", emissiveIntensity:0.9, roughness:0.3, metalness:0.0 }),
  led:       new THREE.MeshStandardMaterial({ color:"#22dd44", emissive:"#00aa22", emissiveIntensity:1.5, roughness:0.4, metalness:0.0 }),

  /* Legacy aliases */
  base:      new THREE.MeshStandardMaterial({ color:"#b2b6ba", roughness:0.43, metalness:0.08 }),
  rim:       new THREE.MeshStandardMaterial({ color:"#b8bcC0", roughness:0.40, metalness:0.08 }),
  mot:       new THREE.MeshStandardMaterial({ color:"#09010c", roughness:0.18, metalness:0.86 }),
  /* axis */
  axR:   new THREE.MeshStandardMaterial({ color:"#f04040" }),
  axG:   new THREE.MeshStandardMaterial({ color:"#22c55e" }),
  axB:   new THREE.MeshStandardMaterial({ color:"#3b82f6" }),
};

/* ── L1/L2 교육 하이라이트 재질 — 2D 기구학 다이어그램 색상과 일치 ── */
const HL_LINK = {
  l1: new THREE.MeshStandardMaterial({ color:"#818cf8", emissive:"#6366f1", emissiveIntensity:0.55, roughness:0.35, metalness:0.15 }),
  l2: new THREE.MeshStandardMaterial({ color:"#67e8f9", emissive:"#22d3ee", emissiveIntensity:0.55, roughness:0.35, metalness:0.15 }),
};

type V3 = [number,number,number];
const PI2 = Math.PI / 2;

function Box({ w,h,d,p,r,mat }:{ w:number;h:number;d:number;p:V3;r?:V3;mat:THREE.Material }) {
  return <mesh position={p} rotation={r} material={mat} castShadow receiveShadow>
    <boxGeometry args={[w,h,d]}/>
  </mesh>;
}
function Cyl({ r,h,p,rot,s=32,mat }:{ r:number;h:number;p:V3;rot?:V3;s?:number;mat:THREE.Material }) {
  return <mesh position={p} rotation={rot} material={mat} castShadow receiveShadow>
    <cylinderGeometry args={[r,r,h,s]}/>
  </mesh>;
}
/* Truncated cone — top radius rt, bottom radius rb */
function Cone({ rt,rb,h,p,rot,s=32,mat }:{ rt:number;rb:number;h:number;p:V3;rot?:V3;s?:number;mat:THREE.Material }) {
  return <mesh position={p} rotation={rot} material={mat} castShadow receiveShadow>
    <cylinderGeometry args={[rt,rb,h,s]}/>
  </mesh>;
}
/* Exact helix — avoids CatmullRom endpoint artefacts so every coil is
   identical: perfectly uniform wire cross-section from top to bottom. */
class HelixCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private readonly cr: number,
    private readonly pitch: number,
    private readonly nCoils: number,
  ) { super(); }
  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const a = t * this.nCoils * Math.PI * 2;
    return target.set(this.cr * Math.cos(a), -this.cr * Math.sin(a), -t * this.nCoils * this.pitch);
  }
}
/* Helical coil spring — TubeGeometry along exact helix curve.
   14 radial segments → properly round wire cross-section. */
function CoilSpring({ r,pitch,nCoils,tubeR,p,mat }:{
  r:number; pitch:number; nCoils:number; tubeR:number; p:V3; mat:THREE.Material
}) {
  const geo = useMemo(() => {
    const curve = new HelixCurve(r, pitch, nCoils);
    return new THREE.TubeGeometry(curve, Math.round(nCoils * 48), tubeR, 14, false);
  }, [r, pitch, nCoils, tubeR]);
  return <mesh position={p} geometry={geo} material={mat} castShadow receiveShadow/>;
}
/* Smooth capsule — used for arm links (non-uniform scale → oval cross-section) */
function Cap({ r,l,p,mat,sx=1,sz=1 }:{ r:number;l:number;p:V3;mat:THREE.Material;sx?:number;sz?:number }) {
  return <group position={p} scale={[sx,1,sz]}>
    <mesh castShadow receiveShadow material={mat}>
      <capsuleGeometry args={[r,l,8,40]}/>
    </mesh>
  </group>;
}

/* ── Axis helpers ─────────────────────────────────────────────────── */
function Axes() {
  const L=70, R=2.5, HR=6, HL=14;
  return <group position={[0,1,0]}>
    <mesh position={[L/2,0,0]}    rotation={[0,0,-PI2]} material={MAT.axR}><cylinderGeometry args={[R,R,L,8]}/></mesh>
    <mesh position={[L+HL/2,0,0]} rotation={[0,0,-PI2]} material={MAT.axR}><cylinderGeometry args={[0,HR,HL,8]}/></mesh>
    <mesh position={[0,L/2,0]}                           material={MAT.axG}><cylinderGeometry args={[R,R,L,8]}/></mesh>
    <mesh position={[0,L+HL/2,0]}                        material={MAT.axG}><cylinderGeometry args={[0,HR,HL,8]}/></mesh>
    <mesh position={[0,0,L/2]}    rotation={[PI2,0,0]}   material={MAT.axB}><cylinderGeometry args={[R,R,L,8]}/></mesh>
    <mesh position={[0,0,L+HL/2]} rotation={[PI2,0,0]}   material={MAT.axB}><cylinderGeometry args={[0,HR,HL,8]}/></mesh>
  </group>;
}

/* ── XY Floor Overlay ─────────────────────────────────────────────
   Coordinate mapping (from STEP comment above):
     Robot X (arm forward)  →  Three.js +Z
     Robot Y (arm left)     →  Three.js -X
   So end-effector floor projection: Three.js (tx, 0, tz) = (-robotY, 0, robotX)
────────────────────────────────────────────────────────────────── */
function LineSeg({ p1, p2, color, opacity = 1 }: {
  p1:[number,number,number]; p2:[number,number,number]; color:string; opacity?:number;
}) {
  const obj = useMemo(() => {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...p1), new THREE.Vector3(...p2),
    ]);
    const mat = new THREE.LineBasicMaterial({ color, opacity, transparent: opacity < 1 });
    return new THREE.Line(geo, mat);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p1[0],p1[1],p1[2],p2[0],p2[1],p2[2],color,opacity]);
  return <primitive object={obj}/>;
}

/** Flat "floor tape" arrow visible from isometric camera — lies flat on the XZ plane.
 *  Correct robot→Three.js mapping (verified by visual inspection at J1=0):
 *    Robot X (arm forward)  →  Three.js -Z  (away from camera)
 *    Robot Y (arm left)     →  Three.js +X  (right in scene)
 */
function FloorArrow({ toNegZ, toX, len, color, label }: {
  toNegZ?:true; toX?:true; len:number; color:string; label:string;
}) {
  const W = 22, H = 7;
  // toNegZ: stripe runs along -Z axis; toX: stripe runs along +X axis
  const stripeArgs: [number,number,number] = toNegZ ? [W, H, len] : [len, H, W];
  const stripePos:  [number,number,number] = toNegZ ? [0, H/2, -len/2] : [len/2, H/2, 0];
  const tipArgs: [number,number,number] = [42, H, 42];
  const tipPos:  [number,number,number] = toNegZ ? [0, H/2, -len] : [len, H/2, 0];
  const tipRot:  [number,number,number] = [0, Math.PI/4, 0];
  const lblPos:  [number,number,number] = toNegZ ? [0, 30, -len-55] : [len+55, 30, 0];

  return (
    <group>
      <mesh position={stripePos}>
        <boxGeometry args={stripeArgs}/>
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.55} roughness={0.3}/>
      </mesh>
      <mesh position={tipPos} rotation={tipRot}>
        <boxGeometry args={tipArgs}/>
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.55} roughness={0.3}/>
      </mesh>
      <Html position={lblPos} center style={{ pointerEvents:"none" }}>
        <div style={{
          background: color, color:"#fff", padding:"2px 8px", borderRadius:"5px",
          fontSize:"13px", fontWeight:"bold", fontFamily:"monospace", whiteSpace:"nowrap",
          boxShadow:"0 1px 4px rgba(0,0,0,0.4)",
        }}>{label}</div>
      </Html>
    </group>
  );
}

// Three.js Y of arm base joint (measured from scene origin)
const ARM_BASE_Y = 109;

function XYFloorOverlay({ coords }: { coords?: { x:number; y:number; z?:number } }) {
  const AX = 400;   // axis arrow length mm
  const FY = 2;     // slightly above floor to avoid z-fighting

  const rx = coords?.x ?? 0;
  const ry = coords?.y ?? 0;
  const r  = Math.sqrt(rx*rx + ry*ry);

  // Robot X (arm forward at J1=0) → Three.js +X  →  tx=rx
  // Robot Y (arm left  at J1=90°) → Three.js -Z  →  tz=-ry
  const tx =  rx;
  const tz = -ry;

  const origin: [number,number,number] = [0,0,0];
  const corner: [number,number,number] = [tx,0,0];
  const endPt:  [number,number,number] = [tx,0,tz];

  const showComp = coords !== undefined && r > 5;

  const arcObj = useMemo(() => {
    if (!showComp || r < 5) return null;
    const N = 72;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= N; i++) {
      const a = (i/N) * 2 * Math.PI;
      pts.push(new THREE.Vector3(r*Math.cos(a), 0, -r*Math.sin(a)));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color:"#ff9900", opacity:0.30, transparent:true });
    return new THREE.Line(geo, mat);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showComp, Math.round(r/5)*5]);

  return (
    <group position={[0, FY, 0]}>
      {/* ── Static axis direction arrows ── */}
      <FloorArrow toX    len={AX} color="#ee3333" label="X방향"/>
      <FloorArrow toNegZ len={AX} color="#22cc44" label="Y방향"/>

      {/* ── Dynamic component lines (only in math mode) ── */}
      {showComp && (
        <>
          {arcObj && <primitive object={arcObj}/>}
          {/* Reach vector orange */}
          <LineSeg p1={origin} p2={endPt}  color="#ff8800" opacity={0.9}/>
          {/* X component red */}
          <LineSeg p1={origin} p2={corner} color="#ee4444" opacity={1}/>
          {/* Y component green */}
          <LineSeg p1={corner} p2={endPt}  color="#22cc44" opacity={1}/>
          {/* Corner dot */}
          <mesh position={corner}>
            <sphereGeometry args={[5,10,10]}/>
            <meshStandardMaterial color="#888" opacity={0.7} transparent/>
          </mesh>
          {/* ── Floor projection dot — THIS is the (x, y) point ── */}
          <mesh position={endPt}>
            <sphereGeometry args={[13,16,16]}/>
            <meshStandardMaterial color="#ff6600" emissive="#ff4400" emissiveIntensity={0.8}/>
          </mesh>
          {/* ── Coordinate badge floating just above the (x,y) floor point ── */}
          <Html position={[tx, 35, tz]} center zIndexRange={[100,0]} style={{ pointerEvents:"none" }}>
            <div style={{
              background:"rgba(15,15,20,0.88)",
              backdropFilter:"blur(8px)",
              border:"1.5px solid rgba(255,150,50,0.75)",
              borderRadius:"10px",
              padding:"5px 11px",
              pointerEvents:"none",
              whiteSpace:"nowrap",
              boxShadow:"0 2px 16px rgba(0,0,0,0.5)",
              fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
              fontVariantNumeric:"tabular-nums",
            }}>
              <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                <span style={{ color:"#ff6633", fontSize:"13px", fontWeight:700 }}>
                  x<span style={{ color:"rgba(255,255,255,0.45)", fontWeight:400 }}>=</span>
                  {rx.toFixed(1)}
                  <span style={{ color:"rgba(255,255,255,0.4)", fontSize:"10px" }}> mm</span>
                </span>
                <span style={{ color:"rgba(255,255,255,0.3)", fontSize:"11px" }}>·</span>
                <span style={{ color:"#44dd77", fontSize:"13px", fontWeight:700 }}>
                  y<span style={{ color:"rgba(255,255,255,0.45)", fontWeight:400 }}>=</span>
                  {ry.toFixed(1)}
                  <span style={{ color:"rgba(255,255,255,0.4)", fontSize:"10px" }}> mm</span>
                </span>
              </div>
            </div>
          </Html>
          {/* Small inline dimension labels on the component lines */}
          <Html position={[6, 0, tz * 0.5]} center style={{ pointerEvents:"none" }}>
            <span style={{
              color:"#ee3333", fontSize:"11px", fontWeight:"bold", fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
              WebkitTextStroke:"2px white", paintOrder:"stroke",
            } as React.CSSProperties}>x={rx.toFixed(0)}</span>
          </Html>
          {Math.abs(ry) > 8 && (
            <Html position={[tx*0.5, 0, tz - 20]} center style={{ pointerEvents:"none" }}>
              <span style={{
                color:"#22cc44", fontSize:"11px", fontWeight:"bold", fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
                WebkitTextStroke:"2px white", paintOrder:"stroke",
              } as React.CSSProperties}>y={ry.toFixed(0)}</span>
            </Html>
          )}
        </>
      )}
    </group>
  );
}

/* ══════════════════════════════════════════════════════════════════
   CAD MODEL — loaded from converted STEP → GLB
   STEP coordinate system: Z-up, Y = left-right (190mm), X = arm direction
   Three.js: Y-up → rotation [-PI/2, PI/2, 0]
     Three.js X = -STEP_Y  (left-right symmetric) 
     Three.js Y = STEP_Z   (height ✓)
     Three.js Z = -STEP_X  (arm extension toward +Z = toward camera ✓)

   Materials applied per-mesh by Y-height range:
     Y < 113mm  → baseCool gray (base box)
     Y 113-228  → jnt dark  (shoulder housing, J1 column)
     Y > 228    → armW light (arm links)
══════════════════════════════════════════════════════════════════ */
const CAD_MATS = {
  base:     new THREE.MeshStandardMaterial({ color:"#c2ccd6", roughness:0.52, metalness:0.12 }),
  shoulder: new THREE.MeshStandardMaterial({ color:"#0c1018", roughness:0.28, metalness:0.74 }),
  arm:      new THREE.MeshStandardMaterial({ color:"#dde4ec", roughness:0.52, metalness:0.06 }),
  bolt:     new THREE.MeshStandardMaterial({ color:"#8a96a0", roughness:0.42, metalness:0.40 }),
};

function applyHeightMaterial(mesh: THREE.Mesh) {
  // Assign material per-vertex based on transformed Y position
  // We set mesh.material directly after world-transform
  const geom = mesh.geometry;
  if (!geom || !geom.attributes.position) { mesh.material = CAD_MATS.base; return; }
  const pos = geom.attributes.position;
  // Sample first vertex world Y for quick classification
  const v = new THREE.Vector3(pos.getX(0), pos.getY(0), pos.getZ(0));
  mesh.localToWorld(v);
  if (v.y < 115)       mesh.material = CAD_MATS.base;
  else if (v.y < 230)  mesh.material = CAD_MATS.shoulder;
  else                 mesh.material = CAD_MATS.arm;
  mesh.castShadow    = true;
  mesh.receiveShadow = true;
}

function CADRobot() {
  const gltf = useGLTF("/mg400.glb");

  useEffect(() => {
    gltf.scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      // Assign material based on mesh name for screws
      if (obj.name.toLowerCase().includes("m3") || obj.name.toLowerCase().includes("gb70")) {
        obj.material = CAD_MATS.bolt;
      } else {
        applyHeightMaterial(obj);
      }
      obj.castShadow    = true;
      obj.receiveShadow = true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf.scene]);

  /* STEP Z-up → Three.js Y-up:
     rotation[-PI/2, PI/2, 0] achieves THREE(x,y,z) = STEP(-y, z, -x)
     which correctly maps: width→X, height→Y, arm→+Z             */
  return (
    <primitive
      object={gltf.scene}
      rotation={[-Math.PI / 2, Math.PI / 2, 0]}
      position={[0, 0, 0]}
    />
  );
}
// This legacy model is not mounted by the current scene. Do not preload it:
// the active URDF renderer should not compete with an unused multi-megabyte file.

/* ══════════════════════════════════════════════════════════════════
   ARTICULATED CAD ROBOT — official simplified GLB with separate joint nodes
   GLB coord system: Z-up, meters → rotation[-PI/2, PI/2, 0] + scale 1000
   Joint nodes (manipulate in GLB local space):
     J1  → rotation.z  (+ve = CCW from above)
     J2  → rotation.y  (+ve = arm tilts up from horizontal)
     J3  → rotation.y  (+ve = forearm bends upward)
     J4  → rotation.z  (+ve = wrist CCW)
   Materials by mesh name: base→light gray, column/discs→dark, links→white
══════════════════════════════════════════════════════════════════ */
const ARTICULATED_MAT: Record<string, THREE.Material> = {
  "MG400_base_fixed_mesh":          new THREE.MeshStandardMaterial({ color:"#bec8d2", roughness:0.50, metalness:0.12 }),
  "MG400_J1_column_mesh":           new THREE.MeshStandardMaterial({ color:"#0b0f14", roughness:0.26, metalness:0.76 }),
  "MG400_J2_shoulder_axis_mesh":    new THREE.MeshStandardMaterial({ color:"#0d1218", roughness:0.24, metalness:0.78 }),
  "MG400_link1_175mm_mesh":         new THREE.MeshStandardMaterial({ color:"#e2e8f0", roughness:0.52, metalness:0.05 }),
  "MG400_J3_elbow_axis_mesh":       new THREE.MeshStandardMaterial({ color:"#0d1218", roughness:0.24, metalness:0.78 }),
  "MG400_link2_175mm_mesh":         new THREE.MeshStandardMaterial({ color:"#e2e8f0", roughness:0.52, metalness:0.05 }),
  "MG400_J4_wrist_66mm_mesh":       new THREE.MeshStandardMaterial({ color:"#0d1218", roughness:0.24, metalness:0.78 }),
  "MG400_TCP_reference_point_mesh": new THREE.MeshStandardMaterial({ color:"#22dd44", emissive:"#00aa22", emissiveIntensity:1.2, roughness:0.4, metalness:0.0 }),
};

function ArticulatedRobot({ joints }: { joints: Joints }) {
  const { scene, nodes } = useGLTF("/mg400_articulated.glb") as {
    scene: THREE.Group;
    nodes: Record<string, THREE.Object3D>;
  };
  const D = Math.PI / 180;

  // Ref so useFrame never has a stale closure
  const jr = useRef(joints);
  jr.current = joints;

  // Apply materials once on mount
  useEffect(() => {
    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mat = ARTICULATED_MAT[obj.name];
      if (mat) obj.material = mat;
      obj.castShadow    = true;
      obj.receiveShadow = true;
    });
  }, [scene]);

  // Drive joint rotations every frame — no re-render overhead
  useFrame(() => {
    const { j1, j2, j3, j4 } = jr.current;
    const n1 = nodes["J1_BASE_YAW_ROTATE_Z__manipulate_this_node"];
    const n2 = nodes["J2_SHOULDER_PITCH_ROTATE_Y__manipulate_this_node"];
    const n3 = nodes["J3_ELBOW_PITCH_ROTATE_Y__manipulate_this_node"];
    const n4 = nodes["J4_WRIST_YAW_ROTATE_Z__manipulate_this_node"];
    if (n1) n1.rotation.z = j1 * D;
    if (n2) n2.rotation.y = j2 * D;
    if (n3) n3.rotation.y = j3 * D;
    if (n4) n4.rotation.z = j4 * D;
  });

  /* GLB is Z-up in meters; rotation[-PI/2, PI/2, 0] + scale 1000
     maps GLB(x,y,z) → THREE(-y*1000, z*1000, -x*1000) reversed sign,
     but the same transform used for the full STEP export → correct ✓  */
  return (
    <group rotation={[-Math.PI / 2, Math.PI / 2, 0]} scale={1000}>
      <primitive object={scene} />
    </group>
  );
}
// This legacy model is not mounted by the current scene; avoid an unused preload.

/* ══════════════════════════════════════════════════════════════════
   FBX ROBOT — high-quality external FBX model
   Loads the user-supplied FBX, auto-scales to fit the scene,
   and attempts to drive joints by scanning node names that
   contain "j1/j2/j3/j4", "joint1..4", "bone" variants, etc.
══════════════════════════════════════════════════════════════════ */
type JointNodes = { n1:THREE.Object3D|null; n2:THREE.Object3D|null; n3:THREE.Object3D|null; n4:THREE.Object3D|null };

function FBXRobot({ joints }: { joints: Joints }) {
  const fbx   = useFBX("/dobot_mg400.fbx");
  const D     = Math.PI / 180;
  const jr    = useRef(joints);
  jr.current  = joints;
  const jnRef = useRef<JointNodes>({ n1:null, n2:null, n3:null, n4:null });
  const axRef = useRef<[string,string,string,string]>(["z","z","z","z"]);

  useEffect(() => {
    /* ── 1. collect all named nodes ── */
    const nm: Record<string, THREE.Object3D> = {};
    fbx.traverse((o) => {
      if (o.name) nm[o.name.toLowerCase()] = o;
      if (o instanceof THREE.Mesh) {
        o.castShadow    = true;
        o.receiveShadow = true;
      }
    });

    /* ── 2. log names for debugging ── */
    console.log("[FBX] top-level node names:", Object.keys(nm).slice(0, 40).join(", "));

    /* ── 3. find joint nodes by common naming patterns ── */
    const find = (...keys: string[]) => {
      for (const k of keys) { const v = nm[k]; if (v) return v; }
      // fallback: partial match
      for (const k of keys) {
        const hit = Object.keys(nm).find(n => n.includes(k));
        if (hit) return nm[hit];
      }
      return null;
    };
    jnRef.current = {
      n1: find("j1","joint1","joint_1","rotate_z","base_yaw","yaw1"),
      n2: find("j2","joint2","joint_2","shoulder","pitch1","link1_pivot"),
      n3: find("j3","joint3","joint_3","elbow","pitch2","link2_pivot"),
      n4: find("j4","joint4","joint_4","wrist","yaw2","tcp_yaw"),
    };
    console.log("[FBX] joint nodes found:", {
      n1: jnRef.current.n1?.name ?? "none",
      n2: jnRef.current.n2?.name ?? "none",
      n3: jnRef.current.n3?.name ?? "none",
      n4: jnRef.current.n4?.name ?? "none",
    });

    /* ── 4. auto-scale: fit the robot into ~450 mm height ── */
    const box  = new THREE.Box3().setFromObject(fbx);
    const size = box.getSize(new THREE.Vector3());
    console.log("[FBX] raw bbox size (before scale):", size.x.toFixed(2), size.y.toFixed(2), size.z.toFixed(2));
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) {
      const s = 450 / maxDim;
      fbx.scale.setScalar(s);
    }
    /* sit on floor */
    const box2 = new THREE.Box3().setFromObject(fbx);
    fbx.position.y = -box2.min.y;
  }, [fbx]);

  useFrame(() => {
    const { j1, j2, j3, j4 } = jr.current;
    const { n1, n2, n3, n4 } = jnRef.current;
    const [a1, a2, a3, a4]   = axRef.current;
    const set = (n: THREE.Object3D|null, ax: string, deg: number) => {
      if (!n) return;
      if (ax === "z") n.rotation.z = deg * D;
      else if (ax === "y") n.rotation.y = deg * D;
      else n.rotation.x = deg * D;
    };
    set(n1, a1, j1);
    set(n2, a2, j2);
    set(n3, a3, j3);
    set(n4, a4, j4);
  });

  return <primitive object={fbx} />;
}

/* ══════════════════════════════════════════════════════════════════
   MG400  — accurate dimensions + correct color scheme
   
   DOBOT MG400 real appearance:
   • Base:        white/silver-gray plastic box
   • Arm housing: light silver-gray panels
   • Motors:      dark anthracite cylinders at J1, J2, J3, J4
   • Tool:        user-defined — here a blue camera module
══════════════════════════════════════════════════════════════════ */
/* ─────────────────────────────────────────────────────────────────────
   MG400  v2 — high-quality curved model
   Key improvements over v1:
   • Arm links: CapsuleGeometry with non-uniform XZ scale → smooth oval
     cross-section instead of flat boxes
   • Shoulder housing: LatheGeometry profile → perfectly smooth revolution
   • Joint discs: more layers, higher segment count
   • Proportions from STEP file + official spec sheet
─────────────────────────────────────────────────────────────────────── */
function ShoulderHousing({ h }:{ h:number }) {
  /* Lathe profile: (radius, y) points for the shoulder D-body.
     Revolves 180° around Y to create the smooth front face,
     then a box fills the flat-back side. */
  const pts = useMemo(()=>{
    const pts2d:[number,number][] = [
      [38, 0],[55, 12],[64, 28],[68, 48],[68, 68],[64, 90],[56, 108],[38, h],
    ];
    return pts2d.map(([r,y])=>new THREE.Vector2(r,y));
  },[h]);
  return <group>
    {/* Smooth curved front face — half-revolution lathe */}
    <mesh castShadow receiveShadow material={MAT.jnt} rotation={[0,0,0]}>
      <latheGeometry args={[pts, 40, 0, Math.PI]}/>
    </mesh>
    {/* Flat-back fill box (D-shape) */}
    <Box w={136} h={h+4} d={70} p={[0,h/2-2,-38]} mat={MAT.jnt}/>
    {/* Aluminum side bracket plates */}
    <Box w={14} h={h+6} d={134} p={[-82,h/2-3,0]} mat={MAT.alum}/>
    <Box w={14} h={h+6} d={134} p={[ 82,h/2-3,0]} mat={MAT.alum}/>
    {/* Narrow highlight strips on side bracket front edges */}
    <Box w={6} h={h+6} d={4} p={[-82,h/2-3, 68]} mat={MAT.alumHi}/>
    <Box w={6} h={h+6} d={4} p={[ 82,h/2-3, 68]} mat={MAT.alumHi}/>
  </group>;
}

function ArmLinkLabel({ name, length, color }: { name: string; length: number; color: string }) {
  return (
    <Html center style={{ pointerEvents:"none", userSelect:"none" }}>
      <div style={{
        background: color,
        color: "white",
        fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        fontVariantNumeric: "tabular-nums",
        fontWeight: 800,
        fontSize: 13,
        padding: "4px 10px",
        borderRadius: 8,
        boxShadow: `0 2px 12px ${color}88`,
        whiteSpace: "nowrap",
        border: "1.5px solid white",
      }}>
        {name} = {length} mm
      </div>
    </Html>
  );
}

function MG400({ joints, highlightLinks }:{ joints:Joints; highlightLinks?:{ l1:boolean; l2:boolean }|null }) {
  const D = Math.PI/180;
  const { j1, j2, j3, j4 } = joints;
  const [hoverLink, setHoverLink] = useState<null|"L1"|"L2">(null);

  /* ── DOBOT MG400 spec dimensions [mm] ─────────────────────────────
     Base:    190 × 113 × 100 (W × H × D)
     J2 axis: 228 mm from floor  →  shoulder column = 228 - 113 = 115
     L1 (upper arm J2→J3): 175 mm
     L2 (forearm  J3→J4): 175 mm
     TCP offset: 66 mm (tool flange to end-effector)
  ─────────────────────────────────────────────────────────────────── */
  const BW=190, BD=100, BH=113;
  const COL=115;
  const L1=175, L2=175;
  const TL=58;

  /* ── Dynamic base shading based on j1 ─────────────────────────────
     factor ∈ [-1, 1]: +1 = arm iso-right (darker), -1 = arm iso-left (lighter).
     Inline <meshStandardMaterial> lets R3F reactively update color on every render. */
  const j1factor = (Math.sin(j1*D) + Math.cos(j1*D)) / Math.SQRT2;
  const dimPct = Math.max(0, j1factor); // 0 → 1
  // baseCool base rgb(178,182,186); darken up to 68 units when arm faces right
  const bc = (v:number) => Math.max(60, Math.round(v - dimPct * 68));
  const baseCoolColor = `rgb(${bc(178)},${bc(182)},${bc(186)})`;
  // corner alum rgb(112,116,120); darken up to 46 units
  const ac = (v:number) => Math.max(40, Math.round(v - dimPct * 46));
  const alumDynColor  = `rgb(${ac(112)},${ac(116)},${ac(120)})`;

  return <group>

    {/* ════════════  BASE — 190 × 113 × 100 mm  ════════════ */}
    {/* Base box — lower 75 mm: j1-reactive inline material */}
    <mesh position={[0,37.5,0]} castShadow receiveShadow>
      <boxGeometry args={[BW,75,BD]}/>
      <meshStandardMaterial color={baseCoolColor} roughness={0.52} metalness={0.12}/>
    </mesh>
    <Box w={BW}   h={38}   d={BD}   p={[0,94,0]}             mat={MAT.baseUp}/>
    {/* Bottom foot rail */}
    <Box w={BW+10} h={13}  d={BD+10} p={[0,6.5,0]}            mat={MAT.alum}/>
    {/* Top collar step */}
    <Box w={BW+6}  h={10}  d={BD+6}  p={[0,BH+5,0]}           mat={MAT.collarTopDk}/>
    {/* Beveled corner columns — lower j1-reactive / upper dark */}
    {([[-1,-1],[-1,1],[1,-1],[1,1]] as [number,number][]).map(([sx,sz],i)=>(
      <group key={i}>
        <mesh key={i} position={[sx*(BW/2-5),37.5,sz*(BD/2-5)]} castShadow receiveShadow>
          <boxGeometry args={[10,75,10]}/>
          <meshStandardMaterial color={alumDynColor} roughness={0.50} metalness={0.22}/>
        </mesh>
        <Box w={10} h={38} d={10} p={[sx*(BW/2-5),94,  sz*(BD/2-5)]} mat={MAT.baseUp}/>
      </group>
    ))}
    {/* Front face recessed panel — lower silver section only (upper 38mm is exposed dark baseUp) */}
    <Box w={148} h={50} d={5} p={[0,38,BD/2+1.5]} mat={MAT.alumHi}/>
    {/* Vent slots */}
    {[-28,0,28].map((x,i)=><Box key={i} w={22} h={7} d={4} p={[x,BH*0.20,BD/2+2]} mat={MAT.jnt}/>)}
    {/* Status LED ring + glow */}
    <Cyl r={9}   h={5}  p={[0,BH*0.74,BD/2+1.5]} rot={[PI2,0,0]} s={24} mat={MAT.jnt}/>
    <Cyl r={6}   h={6}  p={[0,BH*0.74,BD/2+2.5]} rot={[PI2,0,0]} s={20} mat={MAT.led}/>
    {/* DOBOT logo plate */}
    <Box w={80} h={9} d={4} p={[0,BH*0.37,BD/2+1.5]} mat={MAT.alum}/>

    {/* ════════════  J1 TURNTABLE  ════════════ */}
    {/* Outer ring — dark collar matching upper base tone */}
    <Cyl r={78} h={24} p={[0,BH+12,0]} s={64} mat={MAT.baseUp}/>
    {/* Inner recessed disc */}
    <Cyl r={60} h={20} p={[0,BH+10,0]} s={56} mat={MAT.shoulderDk}/>
    {/* 8 bolt studs */}
    {Array.from({length:8},(_,i)=>{
      const a=i*Math.PI/4;
      return <Cyl key={i} r={5} h={10} p={[Math.cos(a)*67,BH+14,Math.sin(a)*67]} s={10} mat={MAT.alum}/>;
    })}

    {/* ════════════  J1 ROTATION  ════════════ */}
    <group rotation={[0,j1*D,0]} position={[0,BH,0]}>

      {/* Shoulder housing (D-shape via LatheGeometry + back box) */}
      <ShoulderHousing h={COL}/>
      {/* Bottom pedestal */}
      <Box w={162} h={18} d={106} p={[0,9,-2]} mat={MAT.shoulderDk}/>
      {/* Pedestal highlight trim */}
      <Box w={164} h={4} d={4} p={[0,17.5,54]} mat={MAT.alumHi}/>

      {/* J2 horizontal shaft */}
      <Cyl r={22} h={200} p={[0,COL,0]} rot={[0,0,PI2]} s={40} mat={MAT.jnt}/>
      {/* J2 outer disc caps — silver */}
      <Cyl r={48} h={14} p={[-102,COL,0]} rot={[0,0,PI2]} s={56} mat={MAT.alum}/>
      <Cyl r={48} h={14} p={[ 102,COL,0]} rot={[0,0,PI2]} s={56} mat={MAT.alum}/>
      {/* J2 inner motor hubs — dark */}
      <Cyl r={30} h={18} p={[-102,COL,0]} rot={[0,0,PI2]} s={44} mat={MAT.jnt}/>
      <Cyl r={30} h={18} p={[ 102,COL,0]} rot={[0,0,PI2]} s={44} mat={MAT.jnt}/>
      {/* J2 center bore */}
      <Cyl r={14} h={22} p={[-102,COL,0]} rot={[0,0,PI2]} s={32} mat={MAT.shoulderDk}/>
      <Cyl r={14} h={22} p={[ 102,COL,0]} rot={[0,0,PI2]} s={32} mat={MAT.shoulderDk}/>

      {/* ════  J2 ROTATION  ════ */}
      <group position={[0,COL,0]} rotation={[-j2*D,0,0]}>

        {/* ── UPPER ARM — smooth oval capsule (scale X=1.45 Z=0.70) ── */}
        <Cap r={24} l={L1-66} p={[0,L1/2,0]} sx={1.45} sz={0.70} mat={highlightLinks?.l1 ? HL_LINK.l1 : MAT.armW}/>
        {/* Dark accent line on front face */}
        <Box w={22} h={L1-50} d={5} p={[0,L1/2, 20]} mat={MAT.carbon}/>
        {/* L1 hover hitbox */}
        <mesh position={[0, L1/2, 0]}
          onPointerEnter={(e) => { e.stopPropagation(); setHoverLink("L1"); }}
          onPointerLeave={() => setHoverLink(null)}>
          <boxGeometry args={[52, L1, 52]}/>
          <meshStandardMaterial transparent opacity={0} depthWrite={false}/>
          {hoverLink === "L1" && <ArmLinkLabel name="L1" length={L1} color="#4f46e5"/>}
        </mesh>
        {/* Shoulder root clamp */}
        <Box w={88} h={32} d={56} p={[0,15,0]} mat={MAT.jnt}/>
        {/* Clamp bevel strips */}
        <Box w={90} h={6} d={4} p={[0,30, 29]} mat={MAT.alumHi}/>

        {/* J3 ELBOW — layered discs */}
        <Cyl r={48} h={20} p={[0,L1,0]} rot={[0,0,PI2]} s={56} mat={MAT.alum}/>
        <Cyl r={34} h={26} p={[0,L1,0]} rot={[0,0,PI2]} s={48} mat={MAT.jnt}/>
        <Cyl r={16} h={30} p={[0,L1,0]} rot={[0,0,PI2]} s={36} mat={MAT.shoulderDk}/>
        {/* Elbow fork brackets */}
        <Box w={16} h={44} d={58} p={[-54,L1-20,0]} mat={MAT.alum}/>
        <Box w={16} h={44} d={58} p={[ 54,L1-20,0]} mat={MAT.alum}/>
        {/* Top clamp cap */}
        <Box w={88} h={16} d={56} p={[0,L1-7,0]} mat={highlightLinks?.l1 ? HL_LINK.l1 : MAT.armW}/>
        <Box w={90} h={4}  d={4}  p={[0,L1-14,29]} mat={MAT.alumHi}/>

        {/* ════  J3 ROTATION  ════ */}
        <group position={[0,L1,0]} rotation={[-j3*D,0,0]}>

          {/* ── FOREARM — smooth oval capsule (slightly narrower) ── */}
          <Cap r={21} l={L2-90} p={[0,L2/2-15,0]} sx={1.35} sz={0.68} mat={highlightLinks?.l2 ? HL_LINK.l2 : MAT.armW}/>
          {/* Dark accent line */}
          <Box w={18} h={L2-74} d={5} p={[0,L2/2-15, 17]} mat={MAT.carbon}/>
          {/* L2 hover hitbox */}
          <mesh position={[0, L2/2, 0]}
            onPointerEnter={(e) => { e.stopPropagation(); setHoverLink("L2"); }}
            onPointerLeave={() => setHoverLink(null)}>
            <boxGeometry args={[46, L2, 46]}/>
            <meshStandardMaterial transparent opacity={0} depthWrite={false}/>
            {hoverLink === "L2" && <ArmLinkLabel name="L2" length={L2} color="#0891b2"/>}
          </mesh>
          {/* Elbow root clamp */}
          <Box w={78} h={30} d={50} p={[0,13,0]} mat={MAT.jnt}/>
          <Box w={80} h={6}  d={4}  p={[0,27, 26]} mat={MAT.alumHi}/>

          {/* J4 WRIST — thin flange where forearm meets tool body */}
          <Cyl r={30} h={10} p={[0,L2,   0]} s={44} mat={MAT.alum}/>
          <Cyl r={22} h={14} p={[0,L2,   0]} s={38} mat={MAT.jnt}/>
          <Box w={64} h={10} d={44}           p={[0,L2-4, 0]} mat={highlightLinks?.l2 ? HL_LINK.l2 : MAT.armW}/>

          {/* ── TOOL BODY (STATIC — J4 motor housing) ──
               In the real MG400: arm attaches at the TOP of this box;
               J4 output shaft exits from the BOTTOM; suction cup hangs below.
               In the 3D model (arm extends +Y): tool body sits above the wrist flange,
               J4 pivot is at the TOP of the box (highest Y), shaft goes DOWN.
          */}
          <Box w={54} h={TL}  d={60} p={[0, L2+8+TL/2, 0]} mat={MAT.toolBox}/>   {/* center ≈ L2+37 */}
          <Box w={56} h={12}  d={62} p={[0, L2+8+TL,    0]} mat={MAT.toolDk}/>    {/* top cap (arm attach) */}
          <Box w={56} h={12}  d={62} p={[0, L2+8,        0]} mat={MAT.toolDk}/>    {/* bottom cap           */}
          {/* Camera / sensor on front face */}
          <Cyl r={10} h={10} p={[0, L2+8+TL/2+8, 32]} rot={[PI2,0,0]} s={24} mat={MAT.lens}/>

          {/* ════  J4 ROTATION  ════
               Real MG400 geometry (see attached_assets photos):
               - Vertical shaft exits BOTTOM of tool body
               - L-BRACKET: short vertical drop, then horizontal arm extends in local +Z
               - Suction cup at tip of horizontal arm
               When J4 rotates (yaw), the arm + cup ORBIT around the shaft axis.
               At j4=0: cup is at [0, -TL-22, 30] in J4 local = robot forward (+Z)
               At j4=90°: cup is at [30, -TL-22, 0] = robot left (+X)
               World-Y compensation: [(j2+j3)*D, j4*D, 0] keeps J4 local-Y = world-Y.
          */}
          <group position={[0, L2+8+TL, 0]} rotation={[(j2+j3)*D, j4*D, 0]}>
            {/* Vertical output shaft running DOWN through tool body */}
            <Cyl r={9}  h={TL+20} p={[0,-(TL+20)/2,0]} s={24} mat={MAT.jnt}/>
            {/* Exit collar just below tool body bottom cap */}
            <Cyl r={14} h={10}   p={[0,-TL-2, 0]}  s={28} mat={MAT.alum}/>
            {/* L-BRACKET — vertical drop section */}
            <Box w={14} h={18}   d={14} p={[0,-TL-13, 0]}  mat={MAT.jnt}/>
            {/* L-BRACKET — horizontal arm extending in local +Z (robot fwd at j4=0) */}
            <Box w={12} h={10}   d={30} p={[0,-TL-19, 15]} mat={MAT.jnt}/>
            {/* SUCTION CUP at tip of horizontal arm — orbits when J4 rotates */}
            <Cyl r={28} h={6}   p={[0,-TL-22, 30]} s={40} mat={MAT.alum}/>     {/* rim   */}
            <Cyl r={23} h={11}  p={[0,-TL-19, 30]} s={36} mat={MAT.baseCool}/> {/* disc  */}
            <Cyl r={8}  h={5}   p={[0,-TL-15, 30]} s={20} mat={MAT.jnt}/>      {/* port  */}
          </group>
        </group>
      </group>
    </group>

    <Axes/>
  </group>;
}

/* ══════════════════════════════════════════════════════════════════
   ISOMETRIC SVG FALLBACK  (no WebGL)
══════════════════════════════════════════════════════════════════ */
function IsoFallback({ joints }:{ joints:Joints }) {
  const R = Math.PI/180;
  const { j1, j2, j3, j4 } = joints;
  // Tabletop-mount isometric: Y=0 = floor (screen bottom), Y increases upward.
  // Base plate at bottom, arm rises up — matches reference DOBOT MG400 orientation.
  const SC=0.45, CX=220, CY=400;

  function iso(X:number, Y:number, Z:number):[number,number] {
    return [CX+(X-Z)*Math.cos(30*R)*SC, CY-(X+Z)*Math.sin(30*R)*SC-Y*SC];
  }
  const j1r=j1*R;
  function rj1(dx:number,dz:number):[number,number] {
    return [dx*Math.cos(j1r)-dz*Math.sin(j1r), dx*Math.sin(j1r)+dz*Math.cos(j1r)];
  }

  const BH=228, COL=129, L1=175, L2=175;
  const J2y=BH+COL; // height of j2 above floor = 357mm
  const j2r=j2*R, j3r=j2r-(j3*R);

  function step(len:number,ang:number,base:[number,number,number]):[number,number,number] {
    const [rx,rz]=rj1(0,len*Math.sin(ang));
    return [base[0]+rx, base[1]+len*Math.cos(ang), base[2]+rz];
  }
  const p0:[number,number,number]=[0,J2y,0];
  const p1=step(L1,j2r,p0), p2=step(L2,j3r,p1), p3=step(65,j3r,p2);
  const [x0,y0]=iso(...p0), [x1,y1]=iso(...p1);
  const [x2,y2]=iso(...p2), [x3,y3]=iso(...p3);

  function top(cx:number,cy:number,cz:number,W:number,D:number,f:string) {
    const pts=[iso(cx-W/2,cy,cz-D/2),iso(cx+W/2,cy,cz-D/2),iso(cx+W/2,cy,cz+D/2),iso(cx-W/2,cy,cz+D/2)];
    return <polygon points={pts.map(p=>p.join(",")).join(" ")} fill={f} stroke="#8899aa" strokeWidth="0.7"/>;
  }
  function frt(cx:number,y0b:number,y1:number,cz:number,W:number,f:string) {
    const pts=[iso(cx-W/2,y0b,cz),iso(cx+W/2,y0b,cz),iso(cx+W/2,y1,cz),iso(cx-W/2,y1,cz)];
    return <polygon points={pts.map(p=>p.join(",")).join(" ")} fill={f} stroke="#8899aa" strokeWidth="0.7"/>;
  }
  function sid(cx:number,y0b:number,y1:number,z0:number,z1:number,f:string) {
    const pts=[iso(cx,y0b,z0),iso(cx,y0b,z1),iso(cx,y1,z1),iso(cx,y1,z0)];
    return <polygon points={pts.map(p=>p.join(",")).join(" ")} fill={f} stroke="#8899aa" strokeWidth="0.7"/>;
  }

  return (
    <div style={{width:"100%",height:"100%",background:"linear-gradient(175deg,#e8e8e8,#d4d4d4)",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <svg width="100%" height="100%" viewBox="0 0 500 510" preserveAspectRatio="xMidYMid meet">
        {/* FLOOR GRID — at Y=-1, represents the ground surface */}
        {Array.from({length:11},(_,i)=>{
          const v=(i-5)*50;
          const [ax,ay]=iso(v,-1,-260),[bx,by]=iso(v,-1,260);
          const [cx2,cy2]=iso(-260,-1,v),[dx,dy]=iso(260,-1,v);
          return <g key={i}>
            <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#8899aa" strokeWidth="0.5" opacity="0.5"/>
            <line x1={cx2} y1={cy2} x2={dx} y2={dy} stroke="#8899aa" strokeWidth="0.5" opacity="0.5"/>
          </g>;
        })}
        {/* BASE — floor-mounted box.  Y=0 = base foot at floor (bottom of scene).
            Shading: top face (at Y=BH) is lighter.
            Front/side faces rise UP from Y=0 to Y=BH.                              */}
        {(()=>{
          const factor = (Math.sin(j1r) + Math.cos(j1r)) / Math.SQRT2;
          const shade  = factor * 68;
          const sc = (v:number) => Math.round(Math.max(88, Math.min(255, v - shade)));
          const ceilColor = `rgb(${sc(216)},${sc(226)},${sc(236)})`;
          const lidColor  = `rgb(${sc(191)},${sc(205)},${sc(216)})`;
          const fShade = -factor * 16;
          const fc = (v:number) => Math.round(Math.max(88, Math.min(255, v - fShade)));
          const frtColor = `rgb(${fc(202)},${fc(213)},${fc(226)})`;
          return <>
            {/* front + side faces hang from ceiling down to BH */}
            {frt(0,0,BH,-95,190,frtColor)}
            {sid(95,0,BH,-95,95,"#b8c5d0")}
            {/* ceiling mounting face at Y=0 (top of base, visible from below) */}
            {top(0,0,0,196,196,ceilColor)}
            {/* j1 collar ring at Y=BH+10 */}
            {top(0,BH+10,0,196,196,lidColor)}
          </>;
        })()}
        {/* J1 DISK — dark */}
        {(()=>{ const [cx,cy]=iso(0,BH+25,0); return <>
          <ellipse cx={cx} cy={cy} rx={66*SC} ry={66*SC*0.44} fill="#191e28" stroke="#0a0f16" strokeWidth="0.8"/>
          <ellipse cx={cx} cy={cy} rx={54*SC} ry={54*SC*0.44} fill="#2a3040"/>
          <ellipse cx={cx} cy={cy} rx={40*SC} ry={40*SC*0.44} fill="#191e28"/>
        </>; })()}
        {/* SHOULDER COLUMN — hangs from j1 disk down to j2 */}
        {frt(0,BH+26,BH+26+COL,-27,68,"#bec9d4")}
        {sid(34,BH+26,BH+26+COL,-27,27,"#a8b8c4")}
        {top(0,BH+26+COL,0,68,54,"#b0c0cc")}
        {/* J2 SHOULDER MOTOR HOUSINGS — two compact boxes at j2 joint level */}
        {([-38,38] as number[]).map(mx=>{
          const [ecx,ecy]=iso(mx,BH+26+COL*0.82,0);
          return <g key={mx}>
            <ellipse cx={ecx} cy={ecy} rx={32*SC} ry={32*SC*0.44} fill="#1c2230" stroke="#0e1320" strokeWidth="0.8"/>
            <ellipse cx={ecx} cy={ecy} rx={24*SC} ry={24*SC*0.44} fill="#2a3040"/>
            <ellipse cx={ecx} cy={ecy} rx={14*SC} ry={14*SC*0.44} fill="#191e28"/>
            <ellipse cx={ecx-3*SC} cy={ecy-2*SC} rx={4*SC} ry={2*SC} fill="white" opacity="0.15"/>
          </g>;
        })}
        {/* ARM LINKS — main beam + parallel bar (diamond/parallelogram mechanism) */}
        {(()=>{
          /* beam(): draws a 3D box beam between world points a→b */
          function beam(
            a:[number,number,number], b:[number,number,number],
            hw:number, hd:number,
            cFront:string, cSide:string, cTop:string
          ) {
            const j=(pts:[number,number][])=>pts.map(([x,y])=>`${x},${y}`).join(" ");
            const fla=iso(a[0]-hw,a[1],a[2]-hd), fra=iso(a[0]+hw,a[1],a[2]-hd);
            const bra=iso(a[0]+hw,a[1],a[2]+hd);
            const flb=iso(b[0]-hw,b[1],b[2]-hd), frb=iso(b[0]+hw,b[1],b[2]-hd);
            const brb=iso(b[0]+hw,b[1],b[2]+hd), blb=iso(b[0]-hw,b[1],b[2]+hd);
            return <>
              <polygon points={j([fla,fra,frb,flb])} fill={cFront} stroke="#6a7a88" strokeWidth="0.7"/>
              <polygon points={j([fra,bra,brb,frb])} fill={cSide}  stroke="#5a6a78" strokeWidth="0.7"/>
              <polygon points={j([flb,frb,brb,blb])} fill={cTop}   stroke="#7a8a98" strokeWidth="0.6"/>
            </>;
          }
          /* Parallel offset: main arm at +39mm X, parallel bar at 0mm X (matches DOBOT MG400 geometry) */
          const DX=39; /* X separation between main chain and parallel chain */
          /* Upper arm — main link (l21G) */
          const p0m:[number,number,number]=[p0[0]+DX, p0[1], p0[2]];
          const p1m:[number,number,number]=[p1[0]+DX, p1[1], p1[2]];
          /* Forearm — main link (l31G) */
          const p1m2:[number,number,number]=[p1[0]+DX, p1[1], p1[2]];
          const p2m:[number,number,number]=[p2[0]+DX, p2[1], p2[2]];
          /* Parallel bars (l22G, l32G) — at base X (creates diamond with main chain) */
          const p0p:[number,number,number]=[p0[0],    p0[1], p0[2]];
          const p1p:[number,number,number]=[p1[0],    p1[1], p1[2]];
          const p2p:[number,number,number]=[p2[0],    p2[1], p2[2]];
          return <>
            {/* Parallel bars first (behind) — dark carbon color */}
            {beam(p0p,p1p, 10,10, "#3a4050","#2a3040","#4a5060")}
            {beam(p1p,p2p, 10,10, "#3a4050","#2a3040","#4a5060")}
            {/* Main arm links on top — silver-gray */}
            {beam(p0m,p1m, 40,16, "#bec9d4","#9aaab8","#cdd7e2")}
            {beam(p1m2,p2m, 30,12, "#bec9d4","#9aaab8","#cdd7e2")}
          </>;
        })()}
        {/* TOOL */}
        <line x1={x2} y1={y2} x2={x3} y2={y3} stroke="#0d47a1" strokeWidth="14" strokeLinecap="round"/>
        <line x1={x2} y1={y2} x2={x3} y2={y3} stroke="#1565c0" strokeWidth="9"  strokeLinecap="round"/>
        {/* JOINTS */}
        {([{x:x0,y:y0,r:20},{x:x1,y:y1,r:15},{x:x2,y:y2,r:12}]).map((jj,i)=>(
          <g key={i}>
            <circle cx={jj.x} cy={jj.y} r={jj.r+3}   fill="#080c12"/>
            <circle cx={jj.x} cy={jj.y} r={jj.r}     fill="#1c2230"/>
            <circle cx={jj.x} cy={jj.y} r={jj.r*0.5} fill="#0e1320"/>
            <circle cx={jj.x-jj.r*0.25} cy={jj.y-jj.r*0.25} r={jj.r*0.18} fill="white" opacity="0.22"/>
          </g>
        ))}
        {/* J4 TOOL ASSEMBLY */}
        {(()=>{
          const D=R;
          const cupR=14;
          const A=Math.cos(30*R)*SC, B=Math.sin(30*R)*SC;
          const armLen=30;
          const cj=Math.cos(j4*D), sj=Math.sin(j4*D);
          const cupDx=armLen*sj, cupDz=armLen*cj;
          const cupSx=(cupDx-cupDz)*A, cupSy=(cupDx+cupDz)*B;
          const juncX=x3, juncY=y3+64;
          const cupX=juncX+cupSx, cupY=juncY+7+cupSy;
          return <>
            <defs>
              <linearGradient id="toolBoxGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%"   stopColor="#7a8898"/>
                <stop offset="30%"  stopColor="#b0bfc8"/>
                <stop offset="60%"  stopColor="#cdd8e0"/>
                <stop offset="100%" stopColor="#8a9aaa"/>
              </linearGradient>
            </defs>
            <rect x={x3-14} y={y3+2} width={28} height={8} rx={2} fill="#c0ccd4" stroke="#8090a0" strokeWidth="0.7"/>
            <rect x={x3-11} y={y3+4} width={22} height={4} rx={1} fill="#d8e4ea"/>
            <rect x={x3-18} y={y3+10} width={36} height={42} rx={2} fill="url(#toolBoxGrad)" stroke="#6a7a8a" strokeWidth="0.9"/>
            <rect x={x3-19} y={y3+10} width={38} height={7} rx={2} fill="#7a8898" stroke="#5a6a7a" strokeWidth="0.7"/>
            <rect x={x3-19} y={y3+45} width={38} height={7} rx={2} fill="#7a8898" stroke="#5a6a7a" strokeWidth="0.7"/>
            <rect x={x3-2}  y={y3+14} width={4}  height={28} rx={1} fill="#2a3a4a" opacity="0.7"/>
            <circle cx={x3+11} cy={y3+30} r={5} fill="#1a2a3a" stroke="#606a78" strokeWidth="0.6"/>
            <circle cx={x3+11} cy={y3+30} r={3} fill="#0d1a28"/>
            <circle cx={x3+9.5} cy={y3+28.5} r={1.2} fill="white" opacity="0.4"/>
            <ellipse cx={x3} cy={y3+53} rx={7} ry={2.5} fill="#9aaab8" stroke="#6a7a88" strokeWidth="0.7"/>
            <line x1={x3} y1={y3+51} x2={juncX} y2={juncY} stroke="#1c2230" strokeWidth="7" strokeLinecap="round"/>
            <line x1={x3} y1={y3+51} x2={juncX} y2={juncY} stroke="#3a4a5a" strokeWidth="3.5" strokeLinecap="round"/>
            <line x1={juncX} y1={juncY} x2={cupX} y2={cupY} stroke="#1c2230" strokeWidth="7" strokeLinecap="round"/>
            <line x1={juncX} y1={juncY} x2={cupX} y2={cupY} stroke="#3a4a5a" strokeWidth="3.5" strokeLinecap="round"/>
            <ellipse cx={cupX} cy={cupY+4} rx={cupR} ry={4.5} fill="#c8d8e4" stroke="#8090a0" strokeWidth="0.9"/>
            <ellipse cx={cupX} cy={cupY+3} rx={9} ry={3} fill="#9ab8c8"/>
            <ellipse cx={cupX} cy={cupY+2} rx={3.5} ry={1.2} fill="#6090a8"/>
          </>;
        })()}
        {/* AXES — positioned near floor (Y≈0) in lower-left */}
        {([
          {s:[0,1,0] as V3, e:[72,1,0] as V3, c:"#f04040", l:"X"},
          {s:[0,1,0] as V3, e:[0,73,0] as V3, c:"#22c55e", l:"Y"},
          {s:[0,1,0] as V3, e:[0,1,72] as V3, c:"#3b82f6", l:"Z"},
        ]).map(({s,e,c,l},i)=>{
          const [sx,sy]=iso(...s),[ex,ey]=iso(...e);
          return <g key={i}>
            <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={c} strokeWidth="2.8" strokeLinecap="round"/>
            <text x={ex+4} y={ey+4} fill={c} fontSize="11" fontWeight="bold" fontFamily="monospace">{l}</text>
          </g>;
        })}
        {/* Tabletop mount label */}
        <text x="8" y="498" fontSize="9.5" fill="#778899" opacity="0.75" fontFamily="monospace">⊥ 바닥 설치 (테이블탑)</text>
      </svg>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   URDF ROBOT  —  real CAD STL meshes + kinematic chain
══════════════════════════════════════════════════════════════════ */
const BADGE_STYLE = (_bg: string, _color: string): React.CSSProperties => ({
  background: "rgba(255,255,255,0.82)",
  color: "#111",
  padding: "3px 9px",
  borderRadius: 20,
  fontFamily: "'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
  fontSize: 12,
  fontWeight: 700,
  whiteSpace: "nowrap",
  letterSpacing: "0.2px",
  boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
  border: "none",
  backdropFilter: "blur(4px)",
});

const STL_URLS: string[] = [
  "/stl/base_link.STL", "/stl/link1.STL",
  "/stl/link2_1.STL",   "/stl/link2_2.STL",
  "/stl/link3_1.STL",   "/stl/link3_2.STL",
  "/stl/link4_1.STL",   "/stl/link4_2.STL",
  "/stl/link5.STL",
];

/* ── Theta arc: draws a reference ray, arm-direction ray, and an arc between them ──
   baseAngleDeg: the "zero" direction in the XZ plane (0 = +Z axis).
   angleDeg: angle swept from the base direction (positive = toward +X).         ── */
function ThetaArc({ angleDeg, baseAngleDeg = 0, radius = 0.065, color, label }: {
  angleDeg: number;
  baseAngleDeg?: number;
  radius?: number;
  color: string;
  label: string;
}) {
  const arcPoints = useMemo<[number,number,number][]>(() => {
    const steps = Math.max(2, Math.ceil(Math.abs(angleDeg) / 2));
    const b = baseAngleDeg * Math.PI / 180;
    const a = angleDeg   * Math.PI / 180;
    const pts: [number,number,number][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = b + (a * i) / steps;
      pts.push([Math.sin(t) * radius, 0, Math.cos(t) * radius]);
    }
    return pts;
  }, [angleDeg, baseAngleDeg, radius]);

  if (Math.abs(angleDeg) < 1) return null;

  const b = baseAngleDeg * Math.PI / 180;
  const a = angleDeg     * Math.PI / 180;
  const refLen = radius * 1.25;
  const refEnd:  [number,number,number] = [Math.sin(b)     * refLen, 0, Math.cos(b)     * refLen];
  const armEnd:  [number,number,number] = [Math.sin(b + a) * refLen, 0, Math.cos(b + a) * refLen];
  const midA = b + a / 2;
  const lDist = radius * 1.85;
  const labelPos: [number,number,number] = [Math.sin(midA) * lDist, 0.004, Math.cos(midA) * lDist];

  return (
    <group>
      {/* arc only — no reference/arm rays */}
      <Line points={arcPoints} color={color} lineWidth={2.5}/>
      {/* label */}
      <Html position={labelPos} center style={{ pointerEvents:"none", userSelect:"none" }}>
        <div style={{
          background:"rgba(255,255,255,0.9)",
          color,
          fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
          fontSize:12, fontWeight:800, padding:"2px 8px",
          borderRadius:20, whiteSpace:"nowrap",
          boxShadow:"0 2px 7px rgba(0,0,0,0.16)",
          border:`1.5px solid ${color}66`,
        }}>{label}</div>
      </Html>
    </group>
  );
}

/* ── Closed-chain STL link ───────────────────────────────────────
   Keep the user's original link4_2 STL visible and map its two mounting holes
   onto the two live pivots. Only its longitudinal scale is adjusted to absorb
   the small mismatch in the legacy parallel-chain calibration; the original
   silhouette, cut-outs and surface detail remain intact. */
function DynamicClosedStlLink({
  geometry,
  startRef,
  endRef,
  material,
}: {
  geometry: THREE.BufferGeometry;
  startRef: React.RefObject<THREE.Group | null>;
  endRef: React.RefObject<THREE.Group | null>;
  material: THREE.Material;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const transform = useMemo(() => new ClosedLinkTransform(), []);

  useFrame(() => {
    if (!meshRef.current || !startRef.current || !endRef.current) return;
    transform.update(meshRef.current, startRef.current, endRef.current);
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      castShadow
      receiveShadow
      frustumCulled={false}
    />
  );
}

function URDFRobot({ suctionSourceRef, joints, liveJointsRef, onLinkHover, linkRefs, jointAnchorRefs, showL1, showL2, showBadges, endEffTrackerRef, highlightJoint, highlightLinks, l31LeftTarget, l31RightTarget, l21UpperHole, l32YOffset, l31PosOffset, l31RotOffset, l31UpperHoleTilt, onL31Delta, onL31DragStart, onL31DragEnd, onL31RotChange, onL31LeftTargetChange, applyL31RotRef, l31Locked, endEffector = "suction" }:{
  joints:Joints;
  suctionSourceRef?: React.MutableRefObject<THREE.Group|null>;
  liveJointsRef?: React.MutableRefObject<Joints | null>;
  onLinkHover?:(mesh:THREE.Object3D|null)=>void;
  linkRefs?: React.MutableRefObject<Partial<Record<keyof Joints, THREE.Mesh>>>;
  jointAnchorRefs?: React.MutableRefObject<Partial<Record<keyof Joints, THREE.Object3D>>>;
  showL1?: boolean;
  showL2?: boolean;
  showBadges?: boolean;
  endEffTrackerRef?: React.RefObject<THREE.Mesh|null>;
  highlightJoint?: "j1"|"j2"|"j3"|"j4"|null;
  highlightLinks?: { l1: boolean; l2: boolean } | null;
  l31LeftTarget?: [number,number,number];
  l31RightTarget?: [number,number,number];
  l21UpperHole?: [number,number,number];
  l32YOffset?: number;
  l31PosOffset?: [number,number,number];
  l31RotOffset?: [number,number,number];
  l31UpperHoleTilt?: [number,number,number];
  onL31Delta?: (dx: number, dy: number, dz: number) => void;
  onL31DragStart?: () => void;
  onL31DragEnd?: () => void;
  onL31RotChange?: (rot: [number,number,number]) => void;
  onL31LeftTargetChange?: (v: [number,number,number]) => void;
  applyL31RotRef?: React.MutableRefObject<(() => void) | null>;
  l31Locked?: boolean;
  endEffector?: "pen"|"suction";
}) {
  const D = Math.PI / 180;
  const { j1, j2, j3, j4 } = joints;
  const { camera, gl, raycaster } = useThree();

  /* ── l31G mouse-drag refs ─────────────────────────────────────── */
  const _isDraggingL31   = useRef(false);
  const _l31_dragPlane   = useRef(new THREE.Plane());
  const _l31_dragStart   = useRef(new THREE.Vector3());
  const _l31_dragCurr    = useRef(new THREE.Vector3());
  const _l31_dragNdc     = useRef(new THREE.Vector2());
  // Stable callback refs so useEffect doesn't re-run on every render
  const _onL31DeltaRef     = useRef(onL31Delta);
  const _onL31DragEndRef   = useRef(onL31DragEnd);
  const _onL31RotChangeRef = useRef(onL31RotChange);
  useEffect(() => { _onL31DeltaRef.current = onL31Delta; });
  useEffect(() => { _onL31DragEndRef.current = onL31DragEnd; });
  useEffect(() => { _onL31RotChangeRef.current = onL31RotChange; });

  /* Two-sphere hR handle — Blue(현재) + Orange(목표) */
  const _l31_hrSphere     = useRef<THREE.Mesh>(null); // 🟠 orange: target (applies rotation)
  const _l31_hr_dragging  = useRef(false);
  const _l31_hr_plane     = useRef(new THREE.Plane());
  const _l31_hr_ndc       = useRef(new THREE.Vector2());
  const _l31_hr_hit       = useRef(new THREE.Vector3());
  const _l31_hr_tmpQ      = useRef(new THREE.Quaternion());
  const _l31_hr_tmpE      = useRef(new THREE.Euler());
  const _l31_hr_baseDir   = useRef(new THREE.Vector3());
  const _l31_hr_newDir    = useRef(new THREE.Vector3());
  const _l31_hr_inited    = useRef(false); // one-time init of orange sphere position

  const _l31_hl_sphere = useRef<THREE.Mesh>(null); // 🟢 green: hL target marker
  const _l31_hl_drag   = useRef(false);
  const _l31_hl_plane  = useRef(new THREE.Plane());
  const _l31_hl_ndc    = useRef(new THREE.Vector2());
  const _l31_hl_hit    = useRef(new THREE.Vector3());

  useEffect(() => {
    const el = gl.domElement;
    const onMove = (e: PointerEvent) => {
      if (!_isDraggingL31.current) return;
      const rect = el.getBoundingClientRect();
      _l31_dragNdc.current.set(
        ((e.clientX - rect.left) / rect.width)  * 2 - 1,
        -((e.clientY - rect.top)  / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(_l31_dragNdc.current, camera);
      if (raycaster.ray.intersectPlane(_l31_dragPlane.current, _l31_dragCurr.current)) {
        const dx = _l31_dragCurr.current.x - _l31_dragStart.current.x;
        const dy = _l31_dragCurr.current.y - _l31_dragStart.current.y;
        const dz = _l31_dragCurr.current.z - _l31_dragStart.current.z;
        _l31_dragStart.current.copy(_l31_dragCurr.current);
        _onL31DeltaRef.current?.(dx, dy, dz);
      }
    };
    const onUp = () => {
      if (!_isDraggingL31.current) return;
      _isDraggingL31.current = false;
      el.style.cursor = '';
      _onL31DragEndRef.current?.();
    };
    el.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [camera, gl, raycaster]);

  /* Orange sphere (target hR) drag ─────────────────────────────
     onMove / onUp : sphere moves only — NO rotation applied.
     Rotation is applied only when user clicks the "적용" button. */
  useEffect(() => {
    const el = gl.domElement;
    const onMove = (e: PointerEvent) => {
      if (!_l31_hr_dragging.current) return;
      const rect = el.getBoundingClientRect();
      _l31_hr_ndc.current.set(
        ((e.clientX - rect.left) / rect.width)  * 2 - 1,
        -((e.clientY - rect.top)  / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(_l31_hr_ndc.current, camera);
      if (!raycaster.ray.intersectPlane(_l31_hr_plane.current, _l31_hr_hit.current)) return;
      if (!j31Ref.current || !_l31_hrSphere.current) return;
      j31Ref.current.worldToLocal(_l31_hr_hit.current);
      _l31_hrSphere.current.position.copy(_l31_hr_hit.current);
    };
    const onUp = () => {
      _l31_hr_dragging.current = false;
      el.style.cursor = '';
    };
    el.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [camera, gl, raycaster]);

  /* 🟢 Green sphere (hL target) drag — moves sphere, updates l31LeftTarget */
  useEffect(() => {
    const el = gl.domElement;
    const onMove = (e: PointerEvent) => {
      if (!_l31_hl_drag.current) return;
      const rect = el.getBoundingClientRect();
      _l31_hl_ndc.current.set(
        ((e.clientX - rect.left) / rect.width)  * 2 - 1,
        -((e.clientY - rect.top)  / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(_l31_hl_ndc.current, camera);
      if (!raycaster.ray.intersectPlane(_l31_hl_plane.current, _l31_hl_hit.current)) return;
      if (!j32Ref.current || !_l31_hl_sphere.current) return;
      j32Ref.current.worldToLocal(_l31_hl_hit.current);
      _l31_hl_sphere.current.position.copy(_l31_hl_hit.current);
      onL31LeftTargetChange?.([
        +_l31_hl_hit.current.x.toFixed(6),
        +_l31_hl_hit.current.y.toFixed(6),
        +_l31_hl_hit.current.z.toFixed(6),
      ]);
    };
    const onUp = () => { _l31_hl_drag.current = false; el.style.cursor = ''; };
    el.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [camera, gl, raycaster, onL31LeftTargetChange]);

  /* Mimic joints (degrees) ─────────────────────────────────────
     j2_2  = j2                (mimic j2)
     j3_2  = −j2               (mimic j2_2 × −1)
     j4_2  = j3                (mimic j3)
     j3_1  = j3_2 = −j2        (mimic j3_2)
     j4_1  = −j4_2 = −j3       (mimic j4_2 × −1)              */
  const j2_2 =  j2;
  const j3_2 = -j2;
  const j4_2 =  j3;
  const j3_1 =  j3_2;   // −j2
  const j4_1 = -j4_2;   // −j3

  /* Mesh refs exposed to parent for outline / angle-badge effects */
  const l1R = useRef<THREE.Mesh>(null);
  const l2R = useRef<THREE.Mesh>(null);
  const l3R = useRef<THREE.Mesh>(null);
  const l4R = useRef<THREE.Mesh>(null);
  useEffect(() => {
    if (!linkRefs) return;
    if (l1R.current) linkRefs.current.j1 = l1R.current;
    if (l2R.current) linkRefs.current.j2 = l2R.current;
    if (l3R.current) linkRefs.current.j3 = l3R.current;
    if (l4R.current) linkRefs.current.j4 = l4R.current;
  });

  /* Imperative refs for all revolute joints — set every frame so
     React rerender lag never stalls the visual update.           */
  const j1Ref  = useRef<THREE.Group>(null);
  const j2Ref  = useRef<THREE.Group>(null);
  const j3Ref  = useRef<THREE.Group>(null);
  const j31Ref  = useRef<THREE.Group>(null);
  const j31RefA = useRef<THREE.Group>(null);  // 앞쪽 요크 구멍 (URDF −Y = Three.js +Z)
  const j31RefB = useRef<THREE.Group>(null);  // 뒤쪽 요크 구멍 (URDF +Y = Three.js −Z)
  const l32SharedPivotRef = useRef<THREE.Group>(null);
  const j41Ref = useRef<THREE.Group>(null);
  const j41UpperPivotRef = useRef<THREE.Group>(null);
  const j4Ref  = useRef<THREE.Group>(null);
  const j22Ref   = useRef<THREE.Group>(null);
  const j32Ref   = useRef<THREE.Group>(null);
  const l32AssemblyRef = useRef<THREE.Group>(null);
  const j42Ref   = useRef<THREE.Group>(null);
  const l3_2R      = useRef<THREE.Mesh>(null);    // l32G mesh ref for lower-hole alignment
  useEffect(() => {
    if (!jointAnchorRefs) return;
    const anchors = { j1: j1Ref.current, j2: j2Ref.current, j3: j3Ref.current, j4: j4Ref.current };
    for (const key of ["j1", "j2", "j3", "j4"] as const) {
      if (anchors[key]) jointAnchorRefs.current[key] = anchors[key]!;
    }
    return () => { jointAnchorRefs.current = {}; };
  }, [jointAnchorRefs]);
  const jRef   = useRef(joints);
  jRef.current = liveJointsRef?.current ?? joints;

  const [j1Hovered, setJ1Hovered] = useState(false);

  /* Scratch objects for bridge updates — allocated once, reused every frame */
  const _eb_p1  = useRef(new THREE.Vector3());
  const _eb_p2  = useRef(new THREE.Vector3());
  const _eb_dir = useRef(new THREE.Vector3());
  const _eb_q   = useRef(new THREE.Quaternion());
  const _eb_up  = useRef(new THREE.Vector3(0, 1, 0));
  /* l21G two-pivot alignment scratch */
  const _l21_hL    = useRef(new THREE.Vector3(0, 0.03577, 0));
  const _l21_hU    = useRef(new THREE.Vector3(-0.00105, 0.03577, 0.175)); // mesh-local hole (URDF j3 pos)
  const _l21_tgtU  = useRef(new THREE.Vector3());
  const _l21_tgtL  = useRef(new THREE.Vector3(0, 0.03577, 0));
  const _l21_from  = useRef(new THREE.Vector3());
  const _l21_to    = useRef(new THREE.Vector3());
  const _l21_quat  = useRef(new THREE.Quaternion());
  const _l21_xform = useRef(new THREE.Vector3());
  const _l21_world = useRef(new THREE.Vector3()); // scratch: world pos of l21G upper hole
  /* l32G lower-hole alignment scratch */
  const _l32_hL    = useRef(new THREE.Vector3(0.037, 0.047, -0.021)); // j32Ref local lower hole
  /* l31G two-hole rigid alignment scratch — allocated once, reused every frame */
  const _l31_tgtL  = useRef(new THREE.Vector3());
  const _l31_tgtR        = useRef(new THREE.Vector3(0.177, 0, 0.008));
  const _l31_tgtR_fixed  = useRef(new THREE.Vector3());
  // The j3_1 axis in the source URDF is the centre bore at the mesh origin.
  // link3_1 also has a short lug at x≈-0.045; that is a different
  // hole and must not be used as the fan-centre attachment.
  const _l31_hL    = useRef(new THREE.Vector3(0, 0, 0));
  // Canonical j4_1 axis from the source URDF; this is the visible right hole
  // of link3_1.STL and must coincide with j41Ref.
  const _l31_hR    = useRef(new THREE.Vector3(0.1749697841, -0.017, 0.0032518714));
  const _l31_from   = useRef(new THREE.Vector3());
  const _l31_to     = useRef(new THREE.Vector3());
  const _l31_quat   = useRef(new THREE.Quaternion());
  const _l31_rot    = useRef(new THREE.Vector3());
  const _l31_extraQ  = useRef(new THREE.Quaternion());
  const _l31_extraE  = useRef(new THREE.Euler());
  const _l31_posOffV = useRef(new THREE.Vector3());
  const _l31_pwp     = useRef(new THREE.Vector3());
  const _l31_baseQ   = useRef(new THREE.Quaternion()); // base orientation (no rotOffset)
  const _l31_anchor  = useRef(new THREE.Vector3());    // hL in parent-local, fixed pivot
  const _l31_hLcurr  = useRef(new THREE.Vector3());   // hL after rotation, for repositioning
  /* Parallel-chain freeze: compute once at home, restore every frame */
  const _pc_frozen   = useRef(false);
  const _pc_l3Pos    = useRef(new THREE.Vector3());
  const _pc_l3Q      = useRef(new THREE.Quaternion());
  const _pc_l32Pos   = useRef(new THREE.Vector3());
  /* link4_2 closed-chain calibration */
  const _l42_frozen    = useRef(false);
  const _l42Clone      = useRef<THREE.Mesh | null>(null);
  const _a2h           = useRef(0);
  const _a3h           = useRef(0);
  /* unused legacy refs kept for safety */
  const _l42_j41home   = useRef(new THREE.Vector3());
  const _l42_j42home   = useRef(new THREE.Vector3());
  const _l42_Q_offset  = useRef(new THREE.Quaternion());
  /* wrist bridge scratch */
  const _wb_p1  = useRef(new THREE.Vector3());
  const _wb_p2  = useRef(new THREE.Vector3());
  const _wb_dir = useRef(new THREE.Vector3());
  const _wb_q   = useRef(new THREE.Quaternion());
  const _wb_q2  = useRef(new THREE.Quaternion());

  useFrame(() => {
    if (liveJointsRef?.current) jRef.current = liveJointsRef.current;
    const { j1: a1, j2: a2, j3: a3, j4: a4 } = jRef.current;
    const dd  = Math.PI / 180;
    const PI2 = Math.PI / 2;
    if (j1Ref.current)  j1Ref.current.rotation.z  =  a1 * dd;
    /* Tabletop mount: root rotation -π/2 maps URDF Y → World -Z, URDF Z → World +Y.
       Original ceiling-mount Y-rotation formulas are still correct here:
       rotating around root-local Y (= World -Z) by (PI2-a2*dd) gives arm horizontal at j2=0
       and arm vertical-up at j2=90° — same geometry, opposite world-axis direction.
       Net Y-rotation: (PI2-a2) + (-a3) + (a2+a3-PI2) + 0 = 0 → TCP always faces down ✓ */
    if (j2Ref.current)  j2Ref.current.rotation.y  =  PI2 - a2 * dd;
    if (j3Ref.current)  j3Ref.current.rotation.y  = -a3 * dd;
    /* Joint rotation formulas — full derivation:
       Root rotation R_X(-π/2) maps URDF-Z → World-Y.  All rotations are around root-local Y.
       Abbrev: a2 = j2 (deg), a3 = j3 (deg), dd = π/180.
       Main chain (j31 kinematic, l31G main forearm bar, l41G wrist bracket):
         j31 = -π/2          → j31_total = (PI2−a2)+(−a3)+(−PI2) = −(a2+a3)·dd → l31G in FK ✓
         j41 = (a2+a3)·dd    → j41_total = −(a2+a3)+(a2+a3) = 0   → l41G at URDF pose ✓
       Parallel chain constraint: j22+j32+j42 must = −(a2+a3)·dd so l42G ∥ l31G ✓
         j22 = PI2−a2·dd     → j22_total = PI2−a2
         j32 = −a3·dd−PI2    → j32_total = (PI2−a2)+(−a3−PI2) = −(a2+a3)·dd  → l32G ∥ l31G ✓
         j42 = 0             → j42_total = j22+j32+j42 = −(a2+a3)·dd          → l42G ∥ l31G ✓  */
    if (j31Ref.current) j31Ref.current.rotation.y = -PI2;
    if (j41Ref.current) j41Ref.current.rotation.y =  (a2 + a3) * dd;
    if (j4Ref.current)  j4Ref.current.rotation.z  =  a4 * dd;
    if (j22Ref.current) j22Ref.current.rotation.y =  PI2 - a2 * dd;
    if (j32Ref.current) j32Ref.current.rotation.y = -a3 * dd - PI2;
    if (j42Ref.current) j42Ref.current.rotation.y =  0;

    /* l41G: FK natural */
    if (l4R.current) { l4R.current.visible = true; l4R.current.position.set(0,0,0); }

    /* The shared shoulder axis is the centre hole of the fan-shaped link3_2.
       First preserve the calibrated fan assembly, then fasten link2_1 and the
       short link3_1 crank to that same live axis. */
    if (l2R.current && j2Ref.current) {
      const [ux, uy, uz] = l21UpperHole ?? [-0.017, 0.029, 0.147];
      _l21_tgtU.current.set(ux, uy, uz);

      /* Align the complete l32 assembly, not only its mesh. Moving the mesh
         alone left j42Ref behind, so link4_2 appeared detached from the upper
         shoulder pivot. The mesh and its j42 child now keep the same offset. */
      if (l3_2R.current && l32AssemblyRef.current && j32Ref.current) {
        if (!_pc_frozen.current) {
          j2Ref.current?.updateWorldMatrix(true, true);
          j22Ref.current?.updateWorldMatrix(true, true);
          _l21_world.current.copy(_l21_tgtU.current);
          j2Ref.current.localToWorld(_l21_world.current);   // → world
          j32Ref.current.worldToLocal(_l21_world.current);  // → j32Ref local
          l32AssemblyRef.current.position.subVectors(_l21_world.current, _l32_hL.current);
          l32AssemblyRef.current.position.y += (l32YOffset ?? 0);
          _pc_l32Pos.current.copy(l32AssemblyRef.current.position);  // freeze
        } else {
          l32AssemblyRef.current.position.copy(_pc_l32Pos.current);  // restore frozen
        }
      }

      if (l32SharedPivotRef.current) {
        j2Ref.current.updateWorldMatrix(true, true);

        /* link2_1: keep the lower J2 bore fixed and map its upper bore to the
           fan centre. Y is kept on its original layer; all three bores share
           the same revolute axis through X/Z. */
        l32SharedPivotRef.current.getWorldPosition(_l21_world.current);
        j2Ref.current.worldToLocal(_l21_world.current);
        _l21_world.current.y = _l21_hU.current.y;
        _l21_from.current.subVectors(_l21_hU.current, _l21_hL.current);
        _l21_to.current.subVectors(_l21_world.current, _l21_tgtL.current);
        const l21TargetLength = _l21_to.current.length();
        const l21LateralSq = _l21_from.current.x ** 2 + _l21_from.current.y ** 2;
        const l21ZScaleSq = (l21TargetLength ** 2 - l21LateralSq) / (_l21_from.current.z ** 2);

        if (l21TargetLength > 0.001 && Number.isFinite(l21ZScaleSq) && l21ZScaleSq > 0) {
          const zScale = Math.sqrt(l21ZScaleSq);
          _l21_from.current.z *= zScale;
          _l21_quat.current.setFromUnitVectors(_l21_from.current.normalize(), _l21_to.current.normalize());
          l2R.current.scale.set(1, 1, zScale);
          l2R.current.quaternion.copy(_l21_quat.current);
          _l21_xform.current.copy(_l21_hL.current);
          _l21_xform.current.z *= zScale;
          _l21_xform.current.applyQuaternion(_l21_quat.current);
          l2R.current.position.subVectors(_l21_tgtL.current, _l21_xform.current);
        }

        /* link3_1: map its centre bore (the source-URDF j3_1 origin) to the
           same fan centre while its
           right bore remains locked to the already-correct wrist pivot. */
        if (l3R.current && j31Ref.current && j41Ref.current) {
          l32SharedPivotRef.current.getWorldPosition(_l31_tgtL.current);
          j31Ref.current.worldToLocal(_l31_tgtL.current);
          _l31_tgtL.current.y = _l31_hL.current.y;
          _l31_tgtR.current.copy(j41Ref.current.position);
          _l31_from.current.subVectors(_l31_hR.current, _l31_hL.current);
          _l31_to.current.subVectors(_l31_tgtR.current, _l31_tgtL.current);
          const l31TargetLength = _l31_to.current.length();
          const l31FixedSq = _l31_from.current.y ** 2 + _l31_from.current.z ** 2;
          const l31XScaleSq = (l31TargetLength ** 2 - l31FixedSq) / (_l31_from.current.x ** 2);

          if (l31TargetLength > 0.001 && Number.isFinite(l31XScaleSq) && l31XScaleSq > 0) {
            const xScale = Math.sqrt(l31XScaleSq);
            _l31_from.current.x *= xScale;
            _l31_quat.current.setFromUnitVectors(_l31_from.current.normalize(), _l31_to.current.normalize());
            l3R.current.scale.set(xScale, 1, 1);
            l3R.current.quaternion.copy(_l31_quat.current);
            _l31_hLcurr.current.copy(_l31_hL.current);
            _l31_hLcurr.current.x *= xScale;
            _l31_hLcurr.current.applyQuaternion(_l31_quat.current);
            l3R.current.position.subVectors(_l31_tgtL.current, _l31_hLcurr.current);
          }
        }
      }
    }

    /* One-time init: orange sphere at j41Ref */
    if (!_l31_hr_inited.current && j41Ref.current && _l31_hrSphere.current) {
      _l31_hrSphere.current.position.copy(j41Ref.current.position);
      _l31_hr_inited.current = true;
    }



    /* Lock parallel chain after first frame */
    if (!_pc_frozen.current) _pc_frozen.current = true;

  }, -1); // Update the actual joint matrices before coordinate overlays sample the TCP.

  /* Load all link geometries (R3F Suspense-based) */
  const geoms = useLoader(STLLoader, STL_URLS) as THREE.BufferGeometry[];
  const [bG,l1G,l21G,l22G,l31G,l32G,l41G,l42G,l5G] = geoms;

  /* Highlight overlay materials — emissive glow per joint color */
  const hlMats = useMemo(() => ({
    j1: new THREE.MeshStandardMaterial({ color:"#f59e0b", roughness:0.45, metalness:0.2 }),
    j2: new THREE.MeshStandardMaterial({ color:"#3b82f6", roughness:0.45, metalness:0.2 }),
    j3: new THREE.MeshStandardMaterial({ color:"#22c55e", roughness:0.45, metalness:0.2 }),
    j4: new THREE.MeshStandardMaterial({ color:"#ec4899", roughness:0.45, metalness:0.2 }),
  }), []);

  /* Vertex-colour base_link only.
     Top faces (STL nz > 0.5 in URDF Z-up) → dark gray; sides → silver */
  const baseVertexMat = useMemo(() => {
    if (bG) {
      const nor  = bG.attributes.normal;
      const cols = new Float32Array(nor.count * 3);
      const topDk = new THREE.Color("#212426");
      const silver = new THREE.Color("#9ea4a8");
      for (let i = 0; i < nor.count; i++) {
        const c = nor.getZ(i) > 0.5 ? topDk : silver;
        cols[i*3] = c.r; cols[i*3+1] = c.g; cols[i*3+2] = c.b;
      }
      bG.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    }
    geoms.forEach(g => g.computeVertexNormals());
    return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.50, metalness: 0.12 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bG, l1G, l21G, l22G, l31G, l32G, l41G, l42G, l5G]);

  const wM = MAT.armW;
  const link5DisplayG = useMemo(() => {
    const cleaned = cleanLink5Silhouette(l5G);
    applyLink5Finish(cleaned);
    return cleaned;
  }, [l5G]);
  const link5M = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.62,
      metalness: 0.06,
    });
  }, []);
  const bM = baseVertexMat;
  const jM = MAT.jnt;
  /* Parallel linkage bars are the dark carbon-fibre spine visible in the reference photo */
  const cM = MAT.carbon;

  return (
    <>
    {/* Convert URDF Z-up (metres) → Three.js Y-up (mm) for tabletop-mount display.
        rotation-x −90° maps URDF Z → THREE +Y so the arm extends upward from base.
        Suction cup in j4 local +Z faces World +Y (up) → flip cup to -Z so it faces down.
        scale 1000 converts metres → mm */}
    <group rotation={[-Math.PI/2, 0, 0]} scale={1000}>

      {/* base_link — fixed to world */}
      <mesh geometry={bG} material={bM} castShadow receiveShadow/>
      {/* j1 : xyz(−0.005, 0, 0.109)  axis Z */}
      <group ref={j1Ref} position={[-0.005, 0, 0.109]}>
        <mesh ref={l1R} geometry={l1G} material={highlightJoint === "j1" ? hlMats.j1 : jM} castShadow receiveShadow
          onPointerEnter={e => { e.stopPropagation(); setJ1Hovered(true); }}
          onPointerLeave={() => setJ1Hovered(false)}
        />

        {/* θ₁ arc → moved to SideViewGuideLines (world-space, aligns with green X axis) */}

        {/* ── MAIN CHAIN ─────────────────────────────────────── */}
        {/* j2 : xyz(0.0435, −0.0358, 0.119)  axis Y */}
        <group ref={j2Ref} position={[0.0435, -0.0358, 0.119]}>
          <mesh ref={l2R} geometry={l21G} material={highlightLinks?.l1 ? HL_LINK.l1 : (highlightJoint === "j2" ? hlMats.j2 : jM)} castShadow receiveShadow/>
          {/* l21G upper hole marker removed — alignment confirmed 2025-06-27 */}

          {showL1 && <>
            {/* Witness lines from arm edge to dimension line (−X side, away from parallel linkage) */}
            <Line points={[[-0.038,0.016,0.005],[-0.155,0.016,0.005]]} color="#00d4ff" lineWidth={1.2} dashed dashSize={0.008} gapSize={0.006}/>
            <Line points={[[-0.038,0.016,0.168],[-0.155,0.016,0.168]]} color="#00d4ff" lineWidth={1.2} dashed dashSize={0.008} gapSize={0.006}/>
            {/* Main dimension line */}
            <Line points={[[-0.155,0.016,0.005],[-0.155,0.016,0.168]]}
              color="#00d4ff" lineWidth={2.5} dashed dashSize={0.013} gapSize={0.007}/>
            {/* Tick marks */}
            <Line points={[[-0.137,0.016,0.005],[-0.173,0.016,0.005]]} color="#00d4ff" lineWidth={2}/>
            <Line points={[[-0.137,0.016,0.168],[-0.173,0.016,0.168]]} color="#00d4ff" lineWidth={2}/>
            <Html position={[-0.190, 0.016, 0.087]} center style={{ pointerEvents:"none", userSelect:"none" }}>
              <div style={{
                background:"#818cf8", backdropFilter:"blur(6px)",
                color:"#fff", fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
                fontWeight:700, fontSize:13, padding:"3px 10px",
                borderRadius:6, whiteSpace:"nowrap", letterSpacing:"0.4px",
                boxShadow:"0 0 10px #818cf888",
              }}>L1</div>
            </Html>
          </>}

          {/* θ₂ arc — j3 관절 위치, 상완 연장선(−Z) 기준 → 전완 방향까지의 각도 */}
          {showBadges && (
            <group position={[-0.00105, 0.03577, 0.175]}>
              {/* baseAngleDeg=0: +Z 방향(상완 연장선, 팔꿈치 앞쪽)을 기준선으로 사용 */}
              <ThetaArc angleDeg={j3} baseAngleDeg={0} color="#67e8f9"
                label={`θ₂ ${j3>=0?"+":""}${j3.toFixed(1)}°`}/>
            </group>
          )}

        {/* j3 → fake_link : xyz(−0.00105, 0.03577, 0.175)  axis Y */}
          <group ref={j3Ref} position={[-0.00105, 0.03577, 0.175]}>

            {/* j3_1 → link3_1 : no offset  axis Y  mimic = −j2
                j31Ref holds the KINEMATIC rotation (-π/2).
                l31G mesh has root-local Y-rot = j2+j3+j31 = -(a2+a3)*dd,
                so it always points in the FK forearm direction. No vis wrapper needed. */}
            <group ref={j31Ref}>
              <group ref={j31RefA} position={[0, 0, 0]}/>
              <group ref={j31RefB} position={[0, 0, -0.012]}/>
              <mesh ref={l3R} geometry={l31G} material={highlightLinks?.l2 ? HL_LINK.l2 : jM} castShadow receiveShadow
                onPointerDown={(e) => {
                  e.stopPropagation();
                  _isDraggingL31.current = true;
                  camera.getWorldDirection(_l31_dragPlane.current.normal);
                  _l31_dragPlane.current.setFromNormalAndCoplanarPoint(_l31_dragPlane.current.normal, e.point);
                  _l31_dragStart.current.copy(e.point);
                  gl.domElement.style.cursor = 'grabbing';
                  onL31DragStart?.();
                }}
                onPointerEnter={() => { if (!_isDraggingL31.current) gl.domElement.style.cursor = 'grab'; }}
                onPointerLeave={() => { if (!_isDraggingL31.current) gl.domElement.style.cursor = ''; }}
              />
              {/* l31G has three visible bores: short lug x≈-0.045, shared J3 axis x=0, and wrist x≈0.175. */}
              {/* l31G hole alignment: j32Ref local offset [0, -0.027, 0] confirmed 2025-06-27 */}
              {/* l31G rightmost hole = j41Ref position [0.175,-0.017,0.00325] in j31Ref local (confirmed 2025-06-27) */}
              {/* l31G rightmost hole target locked at [0.177, 0, 0.008] in j31Ref local (2025-06-27) */}
              {/* l31G leftmost hole target locked at j32Ref local [-0.1343, 0.0324, -0.0193] (2025-06-28) */}

              {showL2 && <>
                {/* Witness lines from arm edge to dimension line */}
                <Line points={[[0.005, -0.008, 0.038],[0.005, -0.008, 0.115]]} color="#00d4ff" lineWidth={1.2} dashed dashSize={0.008} gapSize={0.006}/>
                <Line points={[[0.170, -0.017, 0.038],[0.170, -0.017, 0.115]]} color="#00d4ff" lineWidth={1.2} dashed dashSize={0.008} gapSize={0.006}/>
                {/* Main dimension line (far outside arm) */}
                <Line points={[[0.005, -0.008, 0.115],[0.170, -0.017, 0.115]]}
                  color="#00d4ff" lineWidth={2.5} dashed dashSize={0.013} gapSize={0.007}/>
                {/* Tick marks */}
                <Line points={[[0.005, -0.008, 0.098],[0.005, -0.008, 0.132]]} color="#00d4ff" lineWidth={2}/>
                <Line points={[[0.170, -0.017, 0.098],[0.170, -0.017, 0.132]]} color="#00d4ff" lineWidth={2}/>
                <Html position={[0.087, -0.013, 0.138]} center style={{ pointerEvents:"none", userSelect:"none" }}>
                  <div style={{
                    background:"#67e8f9", backdropFilter:"blur(6px)",
                    color:"#fff", fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
                    fontWeight:700, fontSize:13, padding:"3px 10px",
                    borderRadius:6, whiteSpace:"nowrap", letterSpacing:"0.4px",
                    boxShadow:"0 0 10px #67e8f988",
                  }}>L2</div>
                </Html>
              </>}

              {/* j4_1 → link4_1 : xyz(0.175, −0.017, 0.00325)  axis Y
                  j41 = (a2+a3)*dd → net root-local = 0 → l41G at URDF designed orientation. */}
              <group ref={j41Ref} position={[0.175, -0.017, 0.00325]}>
                <mesh ref={l4R} geometry={l41G} material={wM} castShadow receiveShadow/>
                {/* Upper circular mounting hole measured from link4_1.STL.
                    link4_2 must fasten here, not at the lower j41 origin. */}
                <group ref={j41UpperPivotRef} position={[0.029175, 0, 0.0344723]}/>
                {/* J4 motor housing stays fixed to the forearm. Only the coaxial
                    output shaft and end-effector rotate around the J4 axis. */}
                <group position={[0.066, 0.017, 0.031]}>
                  <mesh geometry={link5DisplayG} material={link5M}/>

                  {/* j4 output : same pivot and axis as before, without rotating
                      the rectangular cover or its vertical vent details. */}
                  <group ref={j4Ref}>
                  {/* Suction cup assembly: tabletop mount — j4 local +Z = World +Y (up).
                      Cup must point DOWN (World -Y), so place at -Z in j4 local space.
                      Wrist shaft — hex cross-section (s=6) makes j4 spin obvious */}
                  <Cyl r={0.010} h={0.096} p={[0,0,-0.048] as V3} rot={[PI2,0,0] as V3} s={6} mat={MAT.jnt}/>
                  {/* Coil spring — positive pitch so helix spirals in -Z (downward in world) */}
                  <CoilSpring r={0.013} pitch={0.006} nCoils={4} tubeR={0.0024}
                    p={[0,0,-0.069] as V3} mat={MAT.springCoil}/>
                  {/* End-effector: suction cup OR pen depending on prop */}
                  {endEffector === "pen" ? (<>
                    {/* Pen — thin straight rod, no tip */}
                    <Cyl r={0.0012} h={0.080} p={[0,0,-0.104] as V3} rot={[PI2,0,0] as V3} s={10} mat={new THREE.MeshStandardMaterial({color:"#1e3a8a",roughness:0.4,metalness:0.1})}/>
                  </>) : <SuctionCup sourceRef={suctionSourceRef}/>}
                  {/* J4 highlight: keep a short sleeve next to the fixed housing.
                      Highlighting the full shaft showed pink through every spring gap
                      and visually contaminated the suction-cup direction markings. */}
                  {highlightJoint === "j4" && <>
                    <Cyl r={0.0108} h={0.030} p={[0,0,-0.022] as V3} rot={[PI2,0,0] as V3} s={6} mat={hlMats.j4}/>
                    {/* Keep surface contrast visible when J4 is selected.
                        The pen's existing highlight stays unchanged. */}
                    {endEffector === "pen" && <>
                      <Cyl r={0.0108} h={0.016} p={[0,0,-0.102] as V3} rot={[PI2,0,0] as V3} s={6} mat={hlMats.j4}/>
                      <Cone rt={0.0108} rb={0.0144} h={0.012} p={[0,0,-0.114] as V3} rot={[PI2,0,0] as V3} s={6} mat={hlMats.j4}/>
                      <Cyl r={0.0144} h={0.003} p={[0,0,-0.120] as V3} rot={[PI2,0,0] as V3} s={40} mat={hlMats.j4}/>
                    </>}
                  </>}
                  {/* Track the selected tool's visible tip; the 80 mm pen ends at -144 mm. */}
                  <mesh ref={endEffTrackerRef} position={[0,0,endEffector === "pen" ? SHAPE_PEN_TIP_LOCAL_Z : -0.121]} visible={false}>
                    <sphereGeometry args={[0.001]}/>
                    <meshBasicMaterial/>
                  </mesh>
                  </group>
                </group>
              </group>
            </group>
          </group>
        </group>

        {/* ── PARALLEL LINKAGE — dark carbon spine (matches reference photo) */}
        {/* j2_2 : URDF xyz(0.00453, −0.0305, 0.1415)  axis Y  mimic j2 */}
        <group ref={j22Ref} position={[0.00453, -0.0305, 0.1415]}>
          <mesh geometry={l22G} material={highlightJoint === "j2" ? hlMats.j2 : wM} castShadow receiveShadow/>

          {/* j3_2 : xyz(−0.00105, 0.0065, 0.175)  axis Y  mimic −j2 */}
          <group ref={j32Ref} position={[-0.00105, 0.0065, 0.175]}>
            <group ref={l32AssemblyRef}>
              <mesh ref={l3_2R} geometry={l32G} material={cM} castShadow receiveShadow/>
              {/* l32G 아래구멍 at j32Ref local [0.037, 0.047, -0.021]; aligned to l21G upper hole in useFrame */}
              {/* Invisible pivot anchor: keep the joint math unchanged without
                  rendering the temporary grey alignment pin. */}
              <group ref={l32SharedPivotRef} position={[0.037, 0.047, -0.021]}/>

              {/* j4_2 moves with the aligned l32 mesh so link4_2 remains
                  fastened to the visible upper shoulder pivot. */}
              <group ref={j42Ref} position={[0.0679, 0.0005, 0.01197]}>
                {/* Rear mounting pivot for the original link4_2 STL. */}
              </group>
            </group>
          </group>
        </group>

      </group>
    </group>
    <DynamicClosedStlLink
      geometry={l42G}
      startRef={j42Ref}
      endRef={j41UpperPivotRef}
      material={highlightJoint === "j3" ? hlMats.j3 : wM}
    />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════
   AXES INDICATOR — XYZ colored arrows at a world position
══════════════════════════════════════════════════════════════════ */
const AXIS_DEFS = [
  { label:"X", color:"#ee3333", rot:[0, 0, -Math.PI/2] as [number,number,number] },
  { label:"Y", color:"#22cc44", rot:[0, 0, 0]          as [number,number,number] },
  { label:"Z", color:"#3388ff", rot:[Math.PI/2, 0, 0]  as [number,number,number] },
] as const;

/* ── 우하단 좌표계 — HTML SVG 오버레이 (항상 올바르게 보임) ────── */
function CoordAxisOverlay({ robotMode = false }: { robotMode?: boolean }) {
  const O  = 62; // origin
  const L  = 46; // axis length
  const HL = 10; // arrowhead length
  const HW = 5;  // arrowhead half-width
  const ang = 30 * Math.PI / 180;

  // Three.js isometric directions
  const ThreeX = { x: O + L * Math.cos(ang), y: O + L * Math.sin(ang) }; // lower-right
  const ThreeY = { x: O,                      y: O - L                  }; // up
  const ThreeZ = { x: O - L * Math.cos(ang), y: O + L * Math.sin(ang) }; // lower-left

  // Robot coordinate directions in the isometric projection (corrected):
  //   Robot X  = Three.js -Z → upper-right in iso (arm forward, away from camera)
  //   Robot Y  = Three.js +X → lower-right in iso (arm swings left when J1>0)
  //   Robot Z  = Three.js +Y → up (height)
  const RobotX = { x: O + L * Math.cos(ang), y: O - L * Math.sin(ang) }; // upper-right
  const RobotY = ThreeX;   // lower-right (same as Three.js +X)
  const RobotZ = ThreeY;   // up (height)

  function Arrow({ ex, ey, color, label, lx, ly }:
    { ex:number; ey:number; color:string; label:string; lx:number; ly:number }) {
    const dx = ex - O, dy = ey - O;
    const len = Math.sqrt(dx*dx + dy*dy);
    const ux = dx/len, uy = dy/len;
    const sx = O + ux*(L - HL), sy = O + uy*(L - HL);
    const px = -uy*HW, py = ux*HW;
    return (
      <g>
        <line x1={O} y1={O} x2={sx} y2={sy}
          stroke={color} strokeWidth={2.2} strokeLinecap="round"/>
        <polygon
          points={`${ex},${ey} ${sx+px},${sy+py} ${sx-px},${sy-py}`}
          fill={color}/>
        <text x={lx} y={ly} fill={color}
          fontSize={12} fontWeight={800} textAnchor="middle" dominantBaseline="middle"
          fontFamily="'Pretendard','Arial',sans-serif"
          style={{ paintOrder:"stroke", stroke:"#f7f8ff", strokeWidth:3, strokeLinejoin:"round" as const }}>
          {label}
        </text>
      </g>
    );
  }

  const W = 124;
  return (
    <div style={{
      position:"absolute", bottom:14, right:14, zIndex:10,
      width:W, height:W,
      background:"rgba(247,248,255,0.82)",
      backdropFilter:"blur(6px)",
      borderRadius:14,
      border:"1px solid rgba(150,160,200,0.35)",
      boxShadow:"0 2px 12px rgba(0,0,0,0.10)",
      pointerEvents:"none",
    }}>
      <svg width={W} height={W}>
        <circle cx={O} cy={O} r={4} fill="#444"/>
        {robotMode ? (
          <>
            {/* 로봇 좌표계: X=팔 앞방향(우상), Y=팔 왼쪽(우하), Z높이=위 */}
            <Arrow ex={RobotX.x} ey={RobotX.y} color="#ee3333" label="X"
              lx={RobotX.x + 14} ly={RobotX.y - 4}/>
            <Arrow ex={RobotY.x} ey={RobotY.y} color="#22aa44" label="Y"
              lx={RobotY.x + 14} ly={RobotY.y + 14}/>
            <Arrow ex={RobotZ.x} ey={RobotZ.y} color="#888" label="Z높이"
              lx={RobotZ.x + 22} ly={RobotZ.y + 2}/>
            {/* 모드 레이블 */}
            <text x={O} y={W - 8} textAnchor="middle" fontSize={9} fill="#888"
              fontFamily="'Pretendard','Arial',sans-serif">로봇 좌표계</text>
          </>
        ) : (
          <>
            <Arrow ex={ThreeZ.x} ey={ThreeZ.y} color="#3388ff" label="Z"
              lx={ThreeZ.x-10} ly={ThreeZ.y+14}/>
            <Arrow ex={ThreeX.x} ey={ThreeX.y} color="#ee3333" label="X"
              lx={ThreeX.x+12} ly={ThreeX.y+10}/>
            <Arrow ex={ThreeY.x} ey={ThreeY.y} color="#22aa44" label="Y"
              lx={ThreeY.x+14} ly={ThreeY.y+2}/>
          </>
        )}
      </svg>
    </div>
  );
}

function AxesIndicator({ size = 110, at = [0, 0, 0] as [number,number,number] }) {
  const shaftL = size * 0.75;
  const headL  = size * 0.25;
  const shaftR = size * 0.013;
  const headR  = size * 0.042;

  const shaftGeo = useMemo(() => new THREE.CylinderGeometry(shaftR, shaftR, shaftL, 12), [shaftR, shaftL]);
  const headGeo  = useMemo(() => new THREE.ConeGeometry(headR, headL, 12), [headR, headL]);
  const dotGeo   = useMemo(() => new THREE.SphereGeometry(size * 0.030, 12, 12), [size]);
  const discGeo  = useMemo(() => new THREE.CircleGeometry(size * 0.58, 64), [size]);
  const ringGeo  = useMemo(() => new THREE.TorusGeometry(size * 0.56, size * 0.010, 6, 64), [size]);

  const dotMat  = useMemo(() => new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.92 }), []);
  const discMat = useMemo(() => new THREE.MeshBasicMaterial({ color: 0x6699ff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthTest: false }), []);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: 0x88aaff, transparent: true, opacity: 0.40, depthTest: false }), []);

  const axisMats = useMemo(() => ({
    X: new THREE.MeshBasicMaterial({ color: 0xee3333, transparent: true, opacity: 0.82, depthTest: false }),
    Y: new THREE.MeshBasicMaterial({ color: 0x22cc44, transparent: true, opacity: 0.82, depthTest: false }),
    Z: new THREE.MeshBasicMaterial({ color: 0x3388ff, transparent: true, opacity: 0.82, depthTest: false }),
  }), []);

  return (
    <group position={at}>
      {/* Hover platform — translucent disc + ring */}
      <mesh geometry={discGeo} material={discMat} rotation={[-Math.PI/2, 0, 0]} renderOrder={997}/>
      <mesh geometry={ringGeo} material={ringMat} rotation={[-Math.PI/2, 0, 0]} renderOrder={998}/>

      {/* Origin dot */}
      <mesh geometry={dotGeo} material={dotMat} renderOrder={999}/>

      {AXIS_DEFS.map(({ label, color, rot }) => {
        const mat = axisMats[label as keyof typeof axisMats];
        return (
          <group key={label} rotation={rot}>
            <mesh geometry={shaftGeo} material={mat}
                  position={[0, shaftL / 2, 0]} renderOrder={999}/>
            <mesh geometry={headGeo} material={mat}
                  position={[0, shaftL + headL / 2, 0]} renderOrder={999}/>
            <Html
              position={[0, size * 1.14, 0]}
              center
              style={{ pointerEvents:"none", userSelect:"none" }}>
              <span style={{
                color, fontFamily:"'Pretendard','Courier New',monospace",
                fontSize: 14, fontWeight: 800,
                textShadow: `0 0 8px ${color}99, 0 0 3px #000`,
                lineHeight: 1,
              }}>{label}</span>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

/* ══════════════════════════════════════════════════════════════════
   JOINT ANGLE BADGE — follows a mesh in world space
══════════════════════════════════════════════════════════════════ */
/** One task-linked label at the actual joint pivot, updated throughout DT playback. */
function KinematicsJointMarker({ visual, anchors, joints, liveJointsRef }: {
  visual: KinematicsVisual;
  anchors: React.MutableRefObject<Partial<Record<keyof Joints, THREE.Object3D>>>;
  joints: Joints;
  liveJointsRef?: React.MutableRefObject<Joints | null>;
}) {
  const group = useRef<THREE.Group>(null);
  const label = useRef<HTMLDivElement>(null);
  const angle = useRef<HTMLSpanElement>(null);
  const position = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const anchor = anchors.current[visual.joint];
    if (!group.current || !label.current) return;
    group.current.visible = !!anchor;
    label.current.style.visibility = anchor ? "visible" : "hidden";
    if (!anchor) return;
    anchor.updateWorldMatrix(true, false);
    anchor.getWorldPosition(position);
    group.current.position.copy(position);
    if (angle.current) angle.current.textContent = (liveJointsRef?.current ?? joints)[visual.joint].toFixed(1) + "°";
  });
  return <group ref={group}>
    <mesh renderOrder={900}><sphereGeometry args={[5, 16, 16]}/><meshBasicMaterial color="#4f46e5" depthTest={false}/></mesh>
    <Line points={[[0, 0, 0], [0, 40, 0]]} color="#6366f1" lineWidth={1.5} depthTest={false}/>
    <Html position={[0, 62, 0]} center zIndexRange={[40, 0]} style={{ pointerEvents: "none", userSelect: "none" }}>
      <div ref={label} style={{ visibility: "hidden", background: "rgba(248,250,255,.96)", border: "1px solid #c7d2fe",
        borderRadius: 7, padding: "6px 10px", color: "#334155", fontSize: 13, lineHeight: 1.5, whiteSpace: "nowrap" }}>
        <strong style={{ color: "#4338ca" }}>{KINEMATICS_JOINT_LABELS[visual.joint]}</strong>
        <div>현재 <span ref={angle}>{joints[visual.joint].toFixed(1)}°</span> · 기준 {visual.reference}°</div>
        {visual.input !== undefined && <div>문제의 새 각도 {visual.input}°</div>}
      </div>
    </Html>
  </group>;
}

function JointAngleBadge({ mesh, angle, label }: {
  mesh: THREE.Mesh;
  angle: number;
  label: string;
}) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!groupRef.current) return;
    const p = new THREE.Vector3();
    mesh.getWorldPosition(p);
    p.y += 75;
    groupRef.current.position.copy(p);
  });
  return (
    <group ref={groupRef}>
      <Html center style={{ pointerEvents:"none", userSelect:"none" }}>
        <div style={{
          background:"rgba(0,210,255,0.92)",
          color:"#000",
          padding:"3px 10px",
          borderRadius:12,
          fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
          fontVariantNumeric:"tabular-nums",
          fontSize:13,
          fontWeight:700,
          whiteSpace:"nowrap",
          boxShadow:"0 0 10px rgba(0,210,255,0.7)",
          border:"1px solid rgba(0,210,255,0.9)",
          letterSpacing:"0.02em",
        }}>
          {label} {angle >= 0 ? "+" : ""}{angle.toFixed(1)}°
        </div>
      </Html>
    </group>
  );
}

/* ══════════════════════════════════════════════════════════════════
   3-D CANVAS  (WebGL)
══════════════════════════════════════════════════════════════════ */
const LINK_INFO = {
  base: { name:"Base  베이스",  joint:"—",   range:"fixed",          angleKey: null as null },
  l1:   { name:"L1  어깨 링크", joint:"J1",  range:"-175° ~ +175°",  angleKey:"j1" as keyof Joints },
  l2:   { name:"L2  상완 링크", joint:"J2",  range:"-3° ~ +90°",     angleKey:"j2" as keyof Joints },
  l3:   { name:"L3  전완 링크", joint:"J3",  range:"-90° ~ +3°",     angleKey:"j3" as keyof Joints },
  l4:   { name:"L4  손목 링크", joint:"J4",  range:"-180° ~ +180°",  angleKey:"j4" as keyof Joints },
};

const JOINT_LABEL: Record<keyof Joints, string> = {
  j1:"J1", j2:"J2", j3:"J3", j4:"J4",
};

/* ── End-effector X/Y/Z badge in 3D space ───────────────────────── */
function EndEffBadge({ worldPos, coords }: {
  worldPos: THREE.Vector3;
  coords: { x:number; y:number; z?:number };
}) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!groupRef.current) return;
    // Place at floor level (y≈2) under the TCP, offset slightly to the side
    groupRef.current.position.set(worldPos.x + 50, 2, worldPos.z);
  });
  const fmt = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(1);
  return (
    <group ref={groupRef}>
      <Html center style={{ pointerEvents:"none", userSelect:"none" }}>
        <div style={{
          background:"rgba(255,255,255,0.82)", backdropFilter:"blur(4px)",
          color:"#111", fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
          fontSize:12, fontWeight:700, padding:"3px 10px",
          borderRadius:20, whiteSpace:"nowrap", letterSpacing:"0.2px",
          boxShadow:"0 2px 8px rgba(0,0,0,0.18)", border:"none",
        }}>
          <span style={{color:"#e03030"}}>X</span> {fmt(coords.x)}&nbsp;&nbsp;
          <span style={{color:"#22a845"}}>Y</span> {fmt(coords.y)}
        </div>
      </Html>
    </group>
  );
}

/* ── End-effector 3D projection (hover) ─────────────────────────── */
/** Side-view auxiliary guide lines (vertical + horizontal crosshair through J2 origin) */
function SideViewGuideLines({ tcpPos, coordZ, joints, showTheta }: { tcpPos: THREE.Vector3; coordZ: number; joints: { j2: number; j3: number }; showTheta?: boolean }) {
  const COORD_OZ = -41.202;
  const VISUAL_OFFSET = 10;
  const floorY = tcpPos.y - coordZ - COORD_OZ + VISUAL_OFFSET;

  const GREEN = "#22c55e"; // X axis (horizontal reach)
  const ORANGE = "#fb923c"; // Z axis (vertical height)

  const vBot: [number,number,number] = [0,              0, 0];
  const vTop: [number,number,number] = [0,            560, 0];
  const hL:   [number,number,number] = [-80,       floorY, 0];
  const hR:   [number,number,number] = [tcpPos.x + 130, floorY, 0];

  return (
    <>
      {/* Z axis — orange solid */}
      <Line points={[vBot, vTop]} color={ORANGE} lineWidth={3}/>
      <mesh position={[0, 577, 0]}>
        <coneGeometry args={[8, 26, 8]}/>
        <meshStandardMaterial color={ORANGE} emissive={ORANGE} emissiveIntensity={0.5}/>
      </mesh>
      {/* Z label */}
      <Html position={[0, 618, 0]} center style={{ pointerEvents:"none", userSelect:"none" }}>
        <span style={{
          fontSize: 22, fontWeight: 800, color: ORANGE,
          fontFamily: "'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
          textShadow: "0 0 8px rgba(251,146,60,0.7)",
        }}>Z</span>
      </Html>

      {/* XZ-plane projection — matching 2D diagram style */}
      {/* Horizontal dashed: origin → TCP x-reach (green) */}
      <Line points={[[0, floorY, 0], [tcpPos.x, floorY, 0]]} color={GREEN} lineWidth={2.2} dashed dashSize={15} gapSize={7}/>
      {/* Vertical dashed: floor ↔ TCP z-height (orange) */}
      {Math.abs(coordZ) > 2 && (
        <Line points={[[tcpPos.x, floorY, 0], [tcpPos.x, tcpPos.y, 0]]} color={ORANGE} lineWidth={2.2} dashed dashSize={15} gapSize={7}/>
      )}


      {/* θ₁ arc — world space, centered on actual j2 joint world Y (= tcpPos.y - FK_height) so arc endpoint sits on link2 */}
      {(showTheta !== false) && joints.j2 > 0.5 && (() => {
        const arcR = 65;  // 적당한 크기
        const arcCX = 38.5; // j2 관절 X
        const j2r = joints.j2 * Math.PI / 180;
        // Z=0 — 초록 X축(Z=0)과 같은 평면
        const arcCY = floorY - 20;
        // 호가 초록 X축(floorY)과 만나는 시작 각도
        const startA = Math.asin(Math.min(1, (floorY - arcCY) / arcR));
        const endA = j2r + 20 * Math.PI / 180; // link2 쪽으로 더 뻗도록 20° 연장
        const steps = Math.max(2, Math.ceil((endA - startA) * 180 / Math.PI / 2));
        const pts: [number,number,number][] = [];
        for (let i = 0; i <= steps; i++) {
          const a = startA + (endA - startA) * i / steps;
          pts.push([arcCX + arcR * Math.cos(a), arcCY + arcR * Math.sin(a), 0]);
        }
        const midA = (startA + j2r) / 2;
        const lp: [number,number,number] = [arcCX + arcR * 1.85 * Math.cos(midA), arcCY + arcR * 1.85 * Math.sin(midA) - 30, 0];
        return (
          <>
            <Line points={pts} color="#818cf8" lineWidth={2.5}/>
            <Html position={lp} center style={{ pointerEvents:"none", userSelect:"none" }}>
              <div style={{
                background:"rgba(255,255,255,0.9)", color:"#818cf8",
                fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
                fontSize:12, fontWeight:800, padding:"2px 8px",
                borderRadius:20, whiteSpace:"nowrap",
                boxShadow:"0 2px 7px rgba(0,0,0,0.16)", border:"1.5px solid #818cf855",
              }}>{`θ₁ ${joints.j2>=0?"+":""}${joints.j2.toFixed(1)}°`}</div>
            </Html>
          </>
        );
      })()}

      {/* X axis — green solid */}
      <Line points={[hL, hR]} color={GREEN} lineWidth={3}/>
      <mesh position={[tcpPos.x + 146, floorY, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[8, 26, 8]}/>
        <meshStandardMaterial color={GREEN} emissive={GREEN} emissiveIntensity={0.5}/>
      </mesh>
      {/* X label */}
      <Html position={[tcpPos.x + 182, floorY, 0]} center style={{ pointerEvents:"none", userSelect:"none" }}>
        <span style={{
          fontSize: 22, fontWeight: 800, color: GREEN,
          fontFamily: "'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
          textShadow: "0 0 8px rgba(34,197,94,0.7)",
        }}>X</span>
      </Html>
    </>
  );
}

function EndEffectorProjection({
  coords,
  worldPos,
}: {
  coords?: { x:number; y:number; z?:number };
  worldPos?: THREE.Vector3;
}) {
  if (!worldPos && !coords) return null;

  // Use actual mesh world-position for lines/dots; fall back to FK if unavailable
  const tx = worldPos ? worldPos.x : (coords!.x);
  const ty = worldPos ? worldPos.y : (ARM_BASE_Y - (coords!.z ?? 0));
  const tz = worldPos ? worldPos.z : -(coords!.y);

  // Label text always from FK coords (robot mm)
  const rx = coords?.x ?? 0, ry = coords?.y ?? 0, rz = coords?.z ?? 0;

  const tip:  [number,number,number] = [tx, ty,  tz];
  const foot: [number,number,number] = [tx,  2,  tz];
  const ox:   [number,number,number] = [ 0,  2,  tz];
  const org:  [number,number,number] = [ 0,  2,   0];

  return (
    <>
      {/* Vertical drop (cyan) */}
      <Line points={[tip, foot]} color="#00d4ff" lineWidth={2} dashed dashSize={18} gapSize={9}/>
      {/* Floor X component (red) */}
      <Line points={[org, ox]}   color="#ff4444" lineWidth={1.8} dashed dashSize={16} gapSize={8}/>
      {/* Floor Y component (green) */}
      <Line points={[ox, foot]}  color="#22cc44" lineWidth={1.8} dashed dashSize={16} gapSize={8}/>
      {/* Glowing dot at end-effector */}
      <mesh position={tip}>
        <sphereGeometry args={[6, 14, 14]}/>
        <meshStandardMaterial color="#00d4ff" emissive="#00d4ff" emissiveIntensity={1.4}/>
      </mesh>
      {/* Shadow dot on floor */}
      <mesh position={foot}>
        <sphereGeometry args={[4, 10, 10]}/>
        <meshStandardMaterial color="#00d4ff" opacity={0.45} transparent/>
      </mesh>
    </>
  );
}

function TcpFocusHighlight({
  worldPos,
  startZ,
  targetZ,
  currentZ,
}: {
  worldPos: THREE.Vector3;
  startZ?: number;
  targetZ?: number;
  currentZ?: number;
}) {
  const [hovered, setHovered] = useState(false);
  const hasHeightGuide = typeof startZ === "number" && Number.isFinite(startZ) && typeof targetZ === "number" && Number.isFinite(targetZ);
  const showHeightGuide = hasHeightGuide;
  const measuredZ = currentZ ?? startZ ?? 0;
  const currentY = worldPos.y + ((startZ ?? measuredZ) - measuredZ);
  const targetY = hasHeightGuide ? worldPos.y + (targetZ! - measuredZ) : worldPos.y;
  const lineLeft = worldPos.x - 270;
  const lineRight = worldPos.x + 230;
  const guideZ = worldPos.z;
  const deltaZ = hasHeightGuide ? targetZ! - startZ! : 0;

  const lineLabelStyle = {
    padding: "4px 9px",
    borderRadius: 999,
    background: "rgba(239,246,255,0.96)",
    border: "1px solid rgba(96,165,250,0.58)",
    color: "#2563eb",
    fontSize: 11,
    fontWeight: 850,
    whiteSpace: "nowrap" as const,
    boxShadow: "0 2px 8px rgba(59,130,246,0.12)",
  };

  return (
    <>
      {showHeightGuide && (
        <>
          <Line
            points={[[lineLeft, currentY, guideZ], [lineRight, currentY, guideZ]]}
            color="#bfdbfe"
            lineWidth={2.5}
            dashed
            dashSize={14}
            gapSize={8}
          />
          <Line
            points={[[lineLeft, targetY, guideZ], [lineRight, targetY, guideZ]]}
            color="#93c5fd"
            lineWidth={2.8}
            dashed
            dashSize={14}
            gapSize={8}
          />
          <Line
            points={[[worldPos.x, currentY, guideZ], [worldPos.x, targetY, guideZ]]}
            color="#60a5fa"
            lineWidth={2.2}
            dashed
            dashSize={9}
            gapSize={6}
          />
          <Html
            position={[lineRight, currentY, guideZ]}
            center
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            <span style={lineLabelStyle}>출발 높이 · Z={startZ} mm</span>
          </Html>
          <Html
            position={[lineRight, targetY, guideZ]}
            center
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            <span style={lineLabelStyle}>목표 높이 · Z={targetZ} mm</span>
          </Html>
          <Html
            position={[worldPos.x + 20, (currentY + targetY) / 2, guideZ]}
            center
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            <span style={{
              ...lineLabelStyle,
              color: "#2563eb",
              background: "rgba(219,234,254,0.96)",
            }}>
              ΔZ={deltaZ >= 0 ? "+" : ""}{deltaZ} mm
            </span>
          </Html>
        </>
      )}
      <Html
        position={[worldPos.x, worldPos.y, worldPos.z]}
        center
        style={{ pointerEvents: "auto", userSelect: "none" }}
      >
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          title="커서를 올려 현재 높이와 목표 높이 확인"
          style={{
            position: "relative",
            width: 76,
            height: 76,
            cursor: "help",
          }}
        >
          <div style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: hovered ? 34 : 28,
            height: hovered ? 34 : 28,
            border: "3px solid #60a5fa",
            borderRadius: "50%",
            background: hovered ? "rgba(191,219,254,0.34)" : "rgba(219,234,254,0.18)",
            boxShadow: hovered
              ? "0 0 0 6px rgba(96,165,250,0.18), 0 0 18px rgba(96,165,250,0.42)"
              : "0 0 0 4px rgba(147,197,253,0.12)",
            transition: "all 140ms ease",
          }} />
          <span style={{
            position: "absolute",
            left: "50%",
            top: "calc(50% + 19px)",
            transform: "translateX(-50%)",
            padding: "2px 7px",
            borderRadius: 999,
            background: "rgba(239,246,255,0.9)",
            border: "1px solid rgba(147,197,253,0.55)",
            color: "#2563eb",
            fontSize: 10,
            fontWeight: 850,
            whiteSpace: "nowrap",
            opacity: hovered ? 1 : 0.78,
          }}>
            TCP
          </span>
        </div>
      </Html>
    </>
  );
}

/* ── 마커 클릭 배치 — Canvas 내부 컴포넌트 ── */
function MarkerPlacer({ enabled, onPlace }: {
  enabled: boolean;
  onPlace: (pos: [number,number,number]) => void;
}) {
  const { camera, scene, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;

  useEffect(() => {
    if (!enabled) return;
    const canvas = gl.domElement;
    const onDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
      const hits = raycaster.intersectObjects(scene.children, true);
      // 마커 자신(renderOrder 999)은 제외
      const hit = hits.find(h => (h.object as THREE.Mesh).renderOrder !== 999);
      if (hit) {
        const p = hit.point;
        onPlaceRef.current([Math.round(p.x), Math.round(p.y), Math.round(p.z)]);
      }
    };
    canvas.addEventListener("pointerdown", onDown);
    return () => canvas.removeEventListener("pointerdown", onDown);
  }, [enabled, camera, scene, gl, raycaster]);

  return null;
}

/* ── End-effector world position tracker (useFrame, no hover needed) ── */
function EndEffTracker({ meshRef, enabled, onPos }: {
  meshRef: React.RefObject<THREE.Mesh|null>;
  enabled: boolean;
  onPos: (p: THREE.Vector3) => void;
}) {
  const lastPos = useRef(new THREE.Vector3(Infinity, Infinity, Infinity));
  useFrame(() => {
    if (!enabled || !meshRef.current) return;
    const p = new THREE.Vector3();
    meshRef.current.getWorldPosition(p);
    if (p.distanceTo(lastPos.current) > 0.5) {
      lastPos.current.copy(p);
      onPos(p.clone());
    }
  });
  return null;
}

/* ── Camera view presets ─────────────────────────────────────────── */
type ViewPreset = "free" | "top" | "side" | "front";
/* Tabletop: base at y=0, TCP at y≈+340mm; arm center ≈ [60, 230, 0]mm
   Camera at mid-arm height (y≈250) so there's no upward distortion.
   side = looking along -Z from +Z (shows X-Y plane — arm forward/up profile)
   front = looking along -X from +X (shows Z-Y plane — arm depth profile) */
const VIEW_PRESETS: Record<Exclude<ViewPreset,"free">, { pos:[number,number,number]; tgt:[number,number,number] }> = {
  top:   { pos:[ 60, 1800,   0], tgt:[ 60, 200,  0] },
  side:  { pos:[ 40,  280, 1500], tgt:[ 60, 200,  0] },
  front: { pos:[1150,  280,  40], tgt:[ 60, 200,  0] },
};

// Home 기준 시점: 전체 장비가 보이는 중간 거리의 사선 전면 시점.
const HOME_CAMERA_POSITION: [number,number,number] = [650, 380, 850];
const HOME_CAMERA_TARGET: [number,number,number] = [60, 220, 0];

function HomeCameraReset({ requestKey }: { requestKey?: number }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as any;

  useEffect(() => {
    if (requestKey === undefined || !controls) return;
    camera.position.set(...HOME_CAMERA_POSITION);
    camera.lookAt(...HOME_CAMERA_TARGET);
    controls.target.set(...HOME_CAMERA_TARGET);
    controls.update();
  }, [requestKey, camera, controls]);

  return null;
}

function CameraAnimator({ preset, onFree }: { preset: ViewPreset; onFree: ()=>void }) {
  const { camera } = useThree();
  const animating = useRef(false);
  const prevPreset = useRef<ViewPreset>("free");

  useEffect(() => {
    if (preset !== "free") { animating.current = true; prevPreset.current = preset; }
  }, [preset]);

  useFrame((state) => {
    if (!animating.current || preset === "free") return;
    const { pos, tgt } = VIEW_PRESETS[preset as Exclude<ViewPreset,"free">];
    const ctrl = state.controls as any;
    camera.position.lerp(new THREE.Vector3(...pos), 0.10);
    if (ctrl?.target) ctrl.target.lerp(new THREE.Vector3(...tgt), 0.10);
    const distPos = camera.position.distanceTo(new THREE.Vector3(...pos));
    if (distPos < 8) animating.current = false;
  });
  return null;
}

/* ── Coord axis directional arrows at TCP ───────────────────────── */


function CoordGuideArrows({ worldPos, axis }: { worldPos: THREE.Vector3; axis: "x"|"y"|"z"|"r" }) {
  const COLORS: Record<string,string> = { x:"#0284c7", y:"#7c3aed", z:"#059669", r:"#1e3a8a" };
  const col = COLORS[axis];

  // Robot→Three.js: Robot X→+X (arm forward), Robot Y→-Z (lateral), Robot Z→+Y (up)
  const DIRS: Record<string, THREE.Vector3> = {
    x: new THREE.Vector3(1, 0, 0),
    y: new THREE.Vector3(0, 0, -1),
    z: new THREE.Vector3(0, 1, 0),
    r: new THREE.Vector3(0, 1, 0),
  };

  const axMat = <meshStandardMaterial color={col} roughness={0.45} depthTest depthWrite/>;

  const wp = worldPos.toArray() as [number,number,number];
  const SPHERE_R = 3;

  // ── End Effector marker (TCP indicator) ──────────────────────────
  const tcpMarker = (
    <>
      {/* 움직임을 가리지 않는 작은 무광 TCP 기준점 */}
      <mesh position={wp}>
        <sphereGeometry args={[SPHERE_R, 16, 16]}/>
        <meshStandardMaterial color="#dbeafe" roughness={0.65} metalness={0}
          depthTest depthWrite/>
      </mesh>
    </>
  );

  // ── Floor projection of TCP — arrows are drawn flat on the floor ─
  const floorPos = new THREE.Vector3(worldPos.x, 2, worldPos.z);
  const fp = floorPos.toArray() as [number,number,number];

  if (axis === "r") {
    const radius = 30, sweep = Math.PI * 0.68;
    const arc = (rotation:number, direction:1|-1) => {
      const end = sweep;
      return <group rotation={[0,0,rotation]}>
        <mesh>
          <torusGeometry args={[radius, 1.6, 6, 28, sweep]}/>
          {axMat}
        </mesh>
        <mesh position={[radius*Math.cos(end),radius*Math.sin(end),0]}
          rotation={[0,0,end + (direction === 1 ? 0 : Math.PI)]}>
          <coneGeometry args={[4.2,9,10]}/>
          {axMat}
        </mesh>
      </group>;
    };
    return (
      <>
        {tcpMarker}
        {/* Two short arrowed arcs communicate both R directions without making
            a large ring that hides the actual tool rotation. */}
        <group position={wp} rotation={[-Math.PI / 2,0,0]}>
          {arc(-Math.PI * 0.84, 1)}
          {arc(Math.PI * 0.16, -1)}
        </group>
      </>
    );
  }

  if (axis === "z") {
    const xOffset = 42, half = 46, tipH = 10;
    const center = worldPos.clone().add(new THREE.Vector3(xOffset,0,0));
    const labelStyle: React.CSSProperties = {
      background:col,color:"#fff",padding:"2px 8px",borderRadius:6,fontSize:12,
      fontWeight:800,fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      whiteSpace:"nowrap",boxShadow:"0 1px 5px rgba(0,0,0,.22)",pointerEvents:"none",
    };
    return <>
      {tcpMarker}
      <mesh position={center.toArray() as [number,number,number]}>
        <cylinderGeometry args={[2.2,2.2,half*2-tipH,10]}/>{axMat}
      </mesh>
      <mesh position={center.clone().add(new THREE.Vector3(0,half,0)).toArray() as [number,number,number]}>
        <coneGeometry args={[5,tipH,10]}/>{axMat}
      </mesh>
      <mesh position={center.clone().add(new THREE.Vector3(0,-half,0)).toArray() as [number,number,number]}
        rotation={[0,0,Math.PI]}>
        <coneGeometry args={[5,tipH,10]}/>{axMat}
      </mesh>
      <Html position={center.clone().add(new THREE.Vector3(0,half+16,0)).toArray() as [number,number,number]} center>
        <div style={labelStyle}>Z+</div>
      </Html>
      <Html position={center.clone().add(new THREE.Vector3(0,-half-16,0)).toArray() as [number,number,number]} center>
        <div style={labelStyle}>Z−</div>
      </Html>
    </>;
  }

  // ── Bidirectional 3D arrows drawn on the floor ───────────────────
  const dir = DIRS[axis];
  const OFFSET  = 50;   // mm gap from floor-projection center
  const SHAFT_L = 90;   // shaft length
  const SHAFT_R = 3;    // shaft radius
  // Chevron tip dimensions (J1~J4 style V-shape)
  const CHEV_BACK = 18; // how far back from tip the V arms start (= TIP_GAP so shaft meets chevron)
  const CHEV_WIDE = 12; // lateral spread per arm
  const CHEV_R    = 2.5;  // arm cylinder radius
  const TIP_GAP   = CHEV_BACK; // keep shaft flush with chevron — no gap

  const makeArrow = (sign: 1|-1, label: string) => {
    const d = dir.clone().multiplyScalar(sign);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    const eu = new THREE.Euler().setFromQuaternion(q);
    const rot: [number,number,number] = [eu.x, eu.y, eu.z];
    // Shaft extends all the way through the chevron base so no visual gap
    const shaftTotal = SHAFT_L + CHEV_BACK;
    const shaftCtr = floorPos.clone().addScaledVector(d, OFFSET + shaftTotal / 2)
      .toArray() as [number,number,number];
    const lblPos   = floorPos.clone().addScaledVector(d, OFFSET + SHAFT_L + TIP_GAP + 45)
      .toArray() as [number,number,number];

    // ── Chevron tip (V-shape, J1~J4 style) ──────────────────────────
    const tipPt = floorPos.clone().addScaledVector(d, OFFSET + SHAFT_L + TIP_GAP);
    // Perpendicular direction for V spread
    const yUp = new THREE.Vector3(0, 1, 0);
    let perpVec = d.clone().cross(yUp);
    if (perpVec.lengthSq() < 0.001) perpVec = d.clone().cross(new THREE.Vector3(1, 0, 0));
    perpVec.normalize().multiplyScalar(CHEV_WIDE);

    const makeChevArm = (spread: THREE.Vector3) => {
      const start = tipPt.clone().addScaledVector(d, -CHEV_BACK).add(spread);
      const vec   = tipPt.clone().sub(start);
      const len   = vec.length();
      const mid   = start.clone().lerp(tipPt, 0.5);
      const aq    = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), vec.clone().normalize());
      const aeu   = new THREE.Euler().setFromQuaternion(aq);
      return (
        <mesh position={mid.toArray() as [number,number,number]}
              rotation={[aeu.x, aeu.y, aeu.z]} renderOrder={999}>
          <cylinderGeometry args={[CHEV_R, CHEV_R, len, 8]}/>
          {axMat}
        </mesh>
      );
    };

    return (
      <group key={sign}>
        <mesh position={shaftCtr} rotation={rot}>
          <cylinderGeometry args={[SHAFT_R, SHAFT_R, shaftTotal, 12]}/>{axMat}
        </mesh>
        {makeChevArm(perpVec)}
        {makeChevArm(perpVec.clone().negate())}
        <Html position={lblPos} center style={{ pointerEvents:"none" }}>
          <div style={{
            background: col, color:"#fff",
            padding:"3px 9px", borderRadius:6, fontSize:13, fontWeight:800,
            fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
            whiteSpace:"nowrap",
            boxShadow:`0 2px 8px ${col}99, 0 1px 3px rgba(0,0,0,0.5)`,
            border:`1.5px solid ${col}cc`,
            letterSpacing:"0.3px",
          }}>{label}</div>
        </Html>
      </group>
    );
  };

  const UP  = axis.toUpperCase() + "+";
  const DN  = axis.toUpperCase() + "-";

  return (
    <>
      {tcpMarker}
      {makeArrow(1,  UP)}
      {makeArrow(-1, DN)}
    </>
  );
}


/* TCP → 설명 박스 리더 선 — useFrame에서 SVG line DOM 직접 갱신, React 리렌더 없음 */
function TcpLineProjector({
  worldPos,
  svgLine,
  descBox,
}: {
  worldPos: THREE.Vector3;
  svgLine: React.RefObject<SVGLineElement | null>;
  descBox: React.RefObject<HTMLDivElement | null>;
}) {
  const { gl, camera } = useThree();
  const wpRef = useRef(worldPos);
  useEffect(() => { wpRef.current = worldPos; }, [worldPos]);

  useFrame(() => {
    const line = svgLine.current;
    const box  = descBox.current;
    if (!line || !box) return;

    const canvas = gl.domElement;
    const parent = canvas.parentElement;
    if (!parent) return;

    const parentRect = parent.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();

    // TCP 투영 → CSS 픽셀 좌표
    const v  = wpRef.current.clone().project(camera);
    const sx = (v.x *  0.5 + 0.5) * canvasRect.width  + (canvasRect.left - parentRect.left);
    const sy = (1 - (v.y * 0.5 + 0.5)) * canvasRect.height + (canvasRect.top  - parentRect.top);

    const hidden = v.z >= 1;
    line.style.display = hidden ? "none" : "block";
    if (hidden) return;

    // 리더 선: TCP → 고정된 박스 왼쪽 중앙
    const boxRect = box.getBoundingClientRect();
    const bx = boxRect.left - parentRect.left;
    const by = boxRect.top  - parentRect.top + boxRect.height / 2;

    line.setAttribute("x1", String(Math.round(sx)));
    line.setAttribute("y1", String(Math.round(sy)));
    line.setAttribute("x2", String(Math.round(bx)));
    line.setAttribute("y2", String(Math.round(by)));
  });

  return null;
}

/* ── Shape drawing plane and its floor projection ──────────────────
   Display coordinates use the pen's calibrated origin. Main paths lie
   at the physical pen height; their faint floor copies are projections.
──────────────────────────────────────────────────────────────────── */
const TRACE_MAX = 8000;

function toFloorPoint(point: LearningVisualPoint, height = 5): [number, number, number] {
  const [x, , z] = shapeWorldPoint(point);
  return [x, height, z];
}

function toDrawingPoint(point: LearningVisualPoint, lift = 0): [number, number, number] {
  const [x, y, z] = shapeWorldPoint(point);
  return [x, y + lift, z];
}

function sameVisualPoint(a: LearningVisualPoint, b: LearningVisualPoint) {
  return Math.abs(a.x-b.x)<0.001 && Math.abs(a.y-b.y)<0.001 && Math.abs(a.z-b.z)<0.001;
}

function LearningDirectionArrow({ visual }: { visual: LearningVisualState }) {
  const arrow = useMemo(() => {
    const start = visual.studentPoints[0];
    if (!start || !visual.axisChoice) return null;
    const direction = visual.axisChoice === "x-plus"
      ? new THREE.Vector3(1,0,0)
      : visual.axisChoice === "x-minus"
        ? new THREE.Vector3(-1,0,0)
        : new THREE.Vector3(0,0,-1);
    const origin = new THREE.Vector3(...toDrawingPoint(start, 12));
    return new THREE.ArrowHelper(direction, origin, Math.min(visual.axisDistance, 110), 0xf59e0b, 18, 10);
  }, [visual.axisChoice, visual.axisDistance, visual.studentPoints]);
  if (!arrow) return null;
  return <primitive object={arrow}/>;
}

function LearningFloorOverlay({ visual }: { visual: LearningVisualState }) {
  const studentPath = visual.studentPath ?? [];
  const directionPoints = visual.stage <= 2 ? visual.planningFocus?.directionPoints ?? [] : [];
  const displayPoints = directionPoints.length > 1 ? directionPoints : visual.studentPoints.length > 1
    ? visual.studentPoints
    : visual.showProgram && visual.programmedPath.length
      ? visual.programmedPath
      : visual.showTarget
        ? visual.targetPath
        : visual.studentPoints;
  const uniquePoints = displayPoints.filter((point,index,all) =>
    !!point.label && index === all.findIndex(candidate=>sameVisualPoint(point,candidate)),
  );
  const focusPoint = displayPoints.find(point => point.label === `${visual.planningFocus?.pointLabel} 예측`)
    ?? (visual.stage <= 2 ? visual.planningFocus?.activeSegment.at(-1) : undefined);
  const predictionPath = visual.trajectoryKind === "open-path"
    ? visual.programmedPath.slice(0,-1)
    : visual.programmedPath;
  const curvedPrediction = useMemo(() => {
    if (visual.trajectoryKind !== "curved-sides" || predictionPath.length < 3) return null;
    const curve = new THREE.CatmullRomCurve3(predictionPath.map(point=>new THREE.Vector3(...toDrawingPoint(point,0.7))), true, "catmullrom", 0.35);
    return curve.getPoints(80).map(point=>[point.x,point.y,point.z] as [number,number,number]);
  }, [predictionPath, visual.trajectoryKind]);
  return (
    <group>
      <LearningDirectionArrow visual={visual}/>
      {visual.planningFocus && visual.studentPoints[0] && <group>
        {(["x", "y"] as const).map(axis => {
          const origin = visual.studentPoints[0];
          const negative = {...origin, [axis]: origin[axis] - 60};
          const positive = {...origin, [axis]: origin[axis] + 90};
          const active = visual.planningFocus?.axis === axis;
          return <group key={axis}>
            <Line points={[toDrawingPoint(negative, 2), toDrawingPoint(positive, 2)]}
              color={active ? "#2563a3" : "#94a3b8"} lineWidth={active ? 2.5 : 1} transparent opacity={active ? 1 : 0.65}/>
            <Html center position={toDrawingPoint(positive, 16)} style={{pointerEvents:"none"}} zIndexRange={[110,0]}>
              <span style={{fontSize:12,fontWeight:800,color:active?"#164e83":"#64748b",background:"rgba(255,255,255,.9)",padding:"2px 4px"}}>+{axis.toUpperCase()}</span>
            </Html>
          </group>;
        })}
      </group>}
      {directionPoints.length > 1 && <Line points={directionPoints.map(point=>toDrawingPoint(point, 1))}
        color="#6366f1" lineWidth={2} dashed dashSize={7} gapSize={5}/>}
      {visual.stage <= 2 && visual.planningFocus?.activeSegment.length === 2 &&
        <Line points={visual.planningFocus.activeSegment.map(point=>toDrawingPoint(point, 2))} color="#2563a3" lineWidth={4}/>}
      {visual.showTarget && visual.targetPath.length > 1 && (
        <Line points={visual.targetPath.map(point=>toFloorPoint(point,4))} color="#16a34a" lineWidth={1.4} transparent opacity={0.28} dashed dashSize={10} gapSize={6}/>
      )}
      {studentPath.length > 1 && <Line points={studentPath.map(point=>toDrawingPoint(point,0.6))}
        color="#6366f1" lineWidth={2} dashed dashSize={7} gapSize={5}/>}
      {visual.showTarget && visual.targetPath.length > 1 && (
        <Line points={visual.targetPath.map(point=>toDrawingPoint(point,0.4))} color="#16a34a" lineWidth={2.2} dashed dashSize={10} gapSize={6}/>
      )}
      {visual.showProgram && predictionPath.length > 1 && !curvedPrediction && (
        <Line points={predictionPath.map(point=>toDrawingPoint(point,0.7))} color={visual.sequenceMatchesTarget?"#7c3aed":"#f59e0b"} lineWidth={2.5} dashed dashSize={9} gapSize={5}/>
      )}
      {curvedPrediction && (
        <Line points={curvedPrediction} color="#7c3aed" lineWidth={2.5} dashed dashSize={9} gapSize={5}/>
      )}
      {visual.measuredPath.length > 1 && (
        <Line points={visual.measuredPath.map(point=>toDrawingPoint(point,1))} color="#f97316" lineWidth={3}/>
      )}
      {uniquePoints.map((point,index)=>{
        const active = index === visual.activePointIndex || !!focusPoint && sameVisualPoint(point, focusPoint);
        return (
          <group key={`${point.label}-${point.x}-${point.y}`} position={toDrawingPoint(point,0.9)}>
            <mesh rotation={[-Math.PI/2,0,0]}>
              <ringGeometry args={[7,active?14:11,28]}/>
              <meshBasicMaterial color={active?"#ef4444":"#4f46e5"} transparent opacity={0.95} depthTest={false}/>
            </mesh>
            <Html center position={[0,24,0]} zIndexRange={[120,0]} style={{pointerEvents:"none"}}>
              <div style={{padding:"3px 7px",borderRadius:6,background:"rgba(15,23,42,.92)",border:"1px solid rgba(255,255,255,.85)",color:"#fff",fontSize:12,fontWeight:950,whiteSpace:"nowrap",boxShadow:"0 3px 10px rgba(15,23,42,.2)",fontFamily:"'Pretendard','Apple SD Gothic Neo',sans-serif"}}>
                {point.label.replace(/ 예측$/, "")}
              </div>
            </Html>
          </group>
        );
      })}
    </group>
  );
}

function FloorRectTrace({
  liveCoordsRef,
  tcpRef,
  traceKey,
  active,
  visible,
  endpoint,
}: {
  liveCoordsRef: React.MutableRefObject<{ x:number; y:number; z:number; r:number } | null>;
  tcpRef: React.RefObject<THREE.Mesh | null>;
  traceKey: number;
  active: boolean;
  visible: boolean;
  endpoint?: { x: number; y: number; z: number } | null;
}) {
  const samples = useMemo(() => new ShapeTraceBuffer(TRACE_MAX), []);
  const buf = samples.positions;
  const floorBuf = samples.floorPositions;
  const tcpPosition = useRef(new THREE.Vector3());
  const prevKey  = useRef(traceKey);

  const traceGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(buf, 3);
    g.setAttribute('position', attr);
    g.setDrawRange(0, 0);
    return g;
  }, [buf]);

  const floorGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(floorBuf, 3));
    g.setDrawRange(0, 0);
    return g;
  }, [floorBuf]);

  const traceLine = useMemo(() => {
    const l = new THREE.Line(traceGeo, new THREE.LineBasicMaterial({ color: '#2563eb' }));
    l.frustumCulled = false;
    return l;
  }, [traceGeo]);

  const floorLine = useMemo(() => {
    const line = new THREE.Line(floorGeo, new THREE.LineBasicMaterial({ color: '#2563eb', transparent: true, opacity: 0.28 }));
    line.frustumCulled = false;
    return line;
  }, [floorGeo]);

  useEffect(() => () => {
    traceGeo.dispose(); floorGeo.dispose(); traceLine.material.dispose(); floorLine.material.dispose();
  }, [traceGeo, floorGeo, traceLine, floorLine]);

  useFrame(() => {
    if (traceKey !== prevKey.current) {
      samples.reset();
      prevKey.current = traceKey;
      traceGeo.setDrawRange(0, 0);
      floorGeo.setDrawRange(0, 0);
      (traceGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (floorGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
    const lc = liveCoordsRef.current;
    // URDFRobot updates its matrices at priority -1, before this sample.
    // Record the actual pen mesh tip so the visible stroke follows the tool.
    let tip: [number, number, number] | null = null;
    if (active && lc) {
      if (tcpRef.current) tcpRef.current.getWorldPosition(tcpPosition.current);
      else tcpPosition.current.set(...shapeWorldPoint(lc));
      tip = tcpPosition.current.toArray();
    }
    // The final drawing RAF can disable tracing before the next R3F frame.
    // Seal with that frozen measured pose, never the robot's returning pose.
    if (!samples.sample(tip, active, endpoint ? shapeWorldPoint(endpoint) : null)) return;
    traceGeo.setDrawRange(0, samples.count);
    floorGeo.setDrawRange(0, samples.count);
    (traceGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (floorGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  });

  return visible ? <group><primitive object={traceLine}/><primitive object={floorLine}/></group> : null;
}

/* ══════════════════════════════════════════════════════════════════
   PICK-AND-PLACE SCENE — physical tray + colored blocks
   Physical tray: 97×97mm, 3×3 cells (27mm each), walls/gaps 4mm
   Coordinate mapping: robot X→+X, robot Y→-Z (tz = -ry)

   Block layout (matches TrayView + photo):
     row=0, col=1 → Blue   → robot (280,  62) → Three.js (280, ?, -62)
     row=1, col=1 → Purple → robot (280,  31) → Three.js (280, ?, -31)
     row=2, col=1 → Red    → robot (280,   0) → Three.js (280, ?,   0) ← PICK

   Tray center: robot (280, 31) → Three.js (280, 0, -31)
   Target:      robot (280,-80) → Three.js (280, ?, 80)
══════════════════════════════════════════════════════════════════ */
function PickBlocks({ gripActive, missionDone }: { gripActive: boolean; missionDone: boolean }) {
  // ─── Dimensions (mm) ───
  const TRAY_W   = 97;   // tray outer width & depth
  const BASE_H   = 7;    // base plate thickness
  const WALL_H   = 17;   // wall height above base (inside cell depth)
  const WALL_T   = 4;    // wall / divider thickness
  const CELL     = 27;   // cell inner size
  const BLOCK    = 27;   // block cube side
  const STEP     = CELL + WALL_T; // 31 mm — distance between cell centres

  // ─── Tray group position in Three.js ───
  // Tray centre XZ = robot (280, +31) → tx=280, tz=-31
  //
  // Tray Y (vertical) — derived from FK / URDF chain:
  //   COORD_OZ = −41.202mm  (App.tsx line 851)
  //   Robot Z=−10 → IK input z′ = −10+41.202 = 31.202mm = FK h
  //   j2Ref (shoulder) Three.js world y:
  //     j1Ref URDF z=0.109m → Three.js y=109mm
  //     j2Ref URDF z=0.119m (local) → Three.js y=119mm  → shoulder = 228mm
  //   arm endpoint y = shoulder + h = 228 + 31.2 = 259mm
  //   j4Ref URDF local z=0.031m → Three.js +31mm above endpoint → j4Ref y = 290mm
  //   tracker mesh URDF local z=−0.120m → Three.js −120mm → tip y = 170mm
  //   Block TOP must equal suction-cup tip y at pick: 170mm
  //   Block top within group = BASE_H + BLOCK = 7 + 27 = 34mm
  //   → tray group Y = 170 − 34 = 136mm
  const TX = 280, TY = 136, TZ = -31;

  // Block centre Y relative to tray group bottom (y=0 within group)
  const BLOCK_Y_REL = BASE_H + BLOCK / 2; // 7 + 13.5 = 20.5 (local)
  // Block centre in world Y
  const BLOCK_Y_WORLD = TY + BLOCK_Y_REL; // 296 + 20.5 = 316.5

  // Helper: block world position
  const cellPos = (row: number, col: number): [number, number, number] => [
    TX + (col - 1) * STEP,       // world X
    BLOCK_Y_WORLD,                // world Y (all blocks same height)
    TZ + (row - 1) * STEP,       // world Z (row0=-62, row1=-31, row2=0)
  ];

  // Wall centres: outer ±46.5, inner ±15.5 (from tray XZ centre)
  const OUTER = TRAY_W / 2 - WALL_T / 2;  // 46.5
  const INNER = CELL / 2 + WALL_T / 2;    // 15.5

  // Target position in world Three.js (robot 280,-80 → tz=80)
  // Same table height → block centre y same
  const TARGET_POS: [number, number, number] = [280, BLOCK_Y_WORLD, 80];

  // Tray / table material
  const trayColor  = "#dde3e8";
  const trayRough  = 0.72;

  return (
    <group>
      {/* ── SOURCE TRAY ─────────────────────────────────────────── */}
      {/* ── Work desk ────────────────────────────────────────────── */}
      {/* Desk top: spans tray area (-100~+120 Z) and tray X (230~340) */}
      {(() => {
        const DW  = 130;   // desk width  (X)  — covers tray
        const DD  = 240;   // desk depth  (Z)  — from tray to target
        const DT  = 18;    // desk top thickness
        const LW  = 14;    // leg cross-section
        const LH  = TY;    // leg height (floor → table top underside = TY)
        const DX  = TX;    // desk centre X
        const DZ  = (TZ + 80) / 2;  // midpoint z=24.5
        const dkColor = "#b0a090";   // warm beige-brown wood tone
        const dkRough = 0.78;
        const legX = DW / 2 - LW;   // leg offset from desk centre
        const legZ = DD / 2 - LW;
        return (
          <>
            {/* Table top */}
            <mesh position={[DX, TY - DT / 2, DZ]} receiveShadow castShadow>
              <boxGeometry args={[DW, DT, DD]}/>
              <meshStandardMaterial color={dkColor} roughness={dkRough} metalness={0.0}/>
            </mesh>
            {/* 4 legs */}
            {([ [-legX,-legZ],[legX,-legZ],[-legX,legZ],[legX,legZ] ] as [number,number][]).map(([lx,lz], i) => (
              <mesh key={i} position={[DX + lx, LH / 2, DZ + lz]} castShadow receiveShadow>
                <boxGeometry args={[LW, LH, LW]}/>
                <meshStandardMaterial color={dkColor} roughness={dkRough} metalness={0.0}/>
              </mesh>
            ))}
          </>
        );
      })()}

      {/* ── SOURCE TRAY (group origin = tray bottom-centre at TY) ── */}
      <group position={[TX, TY, TZ]}>
        {/* Base plate */}
        <mesh position={[0, BASE_H / 2, 0]} receiveShadow castShadow>
          <boxGeometry args={[TRAY_W, BASE_H, TRAY_W]}/>
          <meshStandardMaterial color={trayColor} roughness={trayRough} metalness={0.0}/>
        </mesh>

        {/* Walls running along X (separate rows) — z positions */}
        {([-OUTER, -INNER, INNER, OUTER] as number[]).map(z => (
          <mesh key={z} position={[0, BASE_H + WALL_H / 2, z]} castShadow>
            <boxGeometry args={[TRAY_W, WALL_H, WALL_T]}/>
            <meshStandardMaterial color={trayColor} roughness={trayRough} metalness={0.0}/>
          </mesh>
        ))}

        {/* Walls running along Z (separate columns) — x positions */}
        {([-OUTER, -INNER, INNER, OUTER] as number[]).map(x => (
          <mesh key={x} position={[x, BASE_H + WALL_H / 2, 0]} castShadow>
            <boxGeometry args={[WALL_T, WALL_H, TRAY_W]}/>
            <meshStandardMaterial color={trayColor} roughness={trayRough} metalness={0.0}/>
          </mesh>
        ))}
      </group>

      {/* ── Blocks (absolute world positions via cellPos) ── */}
      {/* Blue  row=0, col=1 */}
      <mesh position={cellPos(0, 1)} castShadow receiveShadow>
        <boxGeometry args={[BLOCK, BLOCK, BLOCK]}/>
        <meshStandardMaterial color="#2563eb" roughness={0.28} metalness={0.04}/>
      </mesh>
      {/* Purple row=1, col=1 */}
      <mesh position={cellPos(1, 1)} castShadow receiveShadow>
        <boxGeometry args={[BLOCK, BLOCK, BLOCK]}/>
        <meshStandardMaterial color="#7c3aed" roughness={0.28} metalness={0.04}/>
      </mesh>
      {/* Red row=2, col=1 — the picked block (disappears when gripped) */}
      {!gripActive && !missionDone && (
        <mesh position={cellPos(2, 1)} castShadow receiveShadow>
          <boxGeometry args={[BLOCK, BLOCK, BLOCK]}/>
          <meshStandardMaterial color="#dc2626" roughness={0.28} metalness={0.04}/>
        </mesh>
      )}

      {/* ── TARGET AREA ─────────────────────────────────────────── */}
      {/* Drop-zone pad at same table height */}
      <mesh position={[280, TY + BASE_H / 2, 80]} receiveShadow castShadow>
        <boxGeometry args={[BLOCK + 24, BASE_H, BLOCK + 24]}/>
        <meshStandardMaterial color={trayColor} roughness={trayRough} metalness={0.0}/>
      </mesh>
      {/* Ghost hint block */}
      {!missionDone && (
        <mesh position={TARGET_POS}>
          <boxGeometry args={[BLOCK, BLOCK, BLOCK]}/>
          <meshStandardMaterial color="#dc2626" transparent opacity={0.14} roughness={0.5}/>
        </mesh>
      )}
      {/* Placed red block */}
      {missionDone && (
        <mesh position={TARGET_POS} castShadow receiveShadow>
          <boxGeometry args={[BLOCK, BLOCK, BLOCK]}/>
          <meshStandardMaterial color="#dc2626" roughness={0.28} metalness={0.04}/>
        </mesh>
      )}
    </group>
  );
}

function WebGLContextRecovery({ onLost, onRestored }: {
  onLost: () => void;
  onRestored: () => void;
}) {
  const { gl } = useThree();

  useEffect(() => {
    const canvas = gl.domElement;
    const handleLost = (event: Event) => {
      event.preventDefault();
      onLost();
    };
    const handleRestored = () => {
      gl.setSize(canvas.clientWidth, canvas.clientHeight);
      onRestored();
    };
    canvas.addEventListener("webglcontextlost", handleLost, false);
    canvas.addEventListener("webglcontextrestored", handleRestored, false);
    return () => {
      canvas.removeEventListener("webglcontextlost", handleLost, false);
      canvas.removeEventListener("webglcontextrestored", handleRestored, false);
    };
  }, [gl, onLost, onRestored]);

  return null;
}

function ModelLoadingFallback() {
  return (
    <Html center style={{ pointerEvents:"none" }}>
      <div style={{
        minWidth:180, padding:"11px 16px", borderRadius:10,
        color:"#334155", background:"rgba(255,255,255,0.92)",
        border:"1px solid rgba(148,163,184,0.5)",
        boxShadow:"0 8px 24px rgba(15,23,42,0.12)",
        fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
        fontSize:13, fontWeight:700, textAlign:"center", whiteSpace:"nowrap",
      }}>
        3D 모델 불러오는 중…
      </div>
    </Html>
  );
}

function ThreeDScene({ suctionZoomOpen, onSuctionZoomClose, joints, liveJointsRef, liveCoordsRef, coords, viewPreset = "free", homeViewKey, onViewFree, annotations, highlightJoint, highlightCoord, highlightLinks, focusTcp, showFloorRect, traceKey, learningVisual, axisLessonVisual, coordinateVisual, motionVisual, kinematicsVisual, coordinateStudyViewKey, shapeStudyViewKey, kinematicsStudyViewKey, compactCoordinateHelp, endEffector = "suction", pickBlockState, onContextLost, onContextRestored }:{ suctionZoomOpen?:boolean; onSuctionZoomClose?:()=>void; joints:Joints; liveJointsRef?: React.MutableRefObject<Joints | null>; liveCoordsRef?: React.MutableRefObject<{x:number;y:number;z:number;r:number}|null>; coords?:{x:number;y:number;z?:number}; viewPreset?:ViewPreset; homeViewKey?:number; onViewFree?:()=>void; annotations?:{l1:boolean;l2:boolean;endEff:boolean;projection?:boolean}; highlightJoint?:"j1"|"j2"|"j3"|"j4"|null; highlightCoord?:"x"|"y"|"z"|"r"|null; highlightLinks?:{l1:boolean;l2:boolean}|null; focusTcp?:{startZ?:number;targetZ?:number}|null; showFloorRect?:boolean; traceKey?:number; learningVisual?:LearningVisualState|null; axisLessonVisual?:AxisLessonVisual|null; coordinateVisual?:CoordinateVisual|null; motionVisual?:MotionComparisonVisual|null; kinematicsVisual?:KinematicsVisual|null; coordinateStudyViewKey?:number; shapeStudyViewKey?:number; kinematicsStudyViewKey?:number; compactCoordinateHelp?:boolean; endEffector?:"pen"|"suction"; pickBlockState?:{ gripActive:boolean; missionDone:boolean }; onContextLost:()=>void; onContextRestored:()=>void }) {
  const comparison=useSquareVisual();
  const revision=useActiveRevisionScene();
  const paper=usePaperScene();
  const comparisonShown=!!paper.data||!!comparison.visual&&comparison.enabled||!!revision.data&&!revision.data.running;

  const suctionSourceRef = useRef<THREE.Group|null>(null);
  const suctionSlotRef = useRef<HTMLDivElement|null>(null);
  const suctionAngleRef = useRef<HTMLOutputElement|null>(null);
  const showSuctionZoom = !!suctionZoomOpen && endEffector === "suction";
  const [hoveredMesh, setHoveredMesh] = useState<THREE.Object3D|null>(null);
  // l31G 윗구멍 타겟 (j32Ref local) — adjustable via UI sliders
  const [debugLeftHole, setDebugLeftHole] = useState<[number,number,number]>([-0.1343, 0.0324, -0.0193]);
  // l31G 아랫구멍 타겟 (j31Ref local) — 기울기 조절
  const [debugRightHole, setDebugRightHole] = useState<[number,number,number]>([0.185, 0.000, 0.008]);
  // l21G upper hole target — locked by user 2025-06-27
  const debugUpperHole: [number,number,number] = [-0.020, 0.036, 0.147]; // locked
  const debugL32Y = 0.025; // locked
  // hR 오른쪽구멍 위치 — 절대 고정 (사용자 확인값 2025-06-28)
  const l31PosOffset: [number,number,number] = [-34.6518, -31.5474, 0.8969];
  const [l31RotOffset, setL31RotOffset] = useState<[number,number,number]>([0, 0, 0]);
  const applyL31RotRef = useRef<(() => void) | null>(null);
  const [l31Locked, setL31Locked] = useState(false);
  const [l31UpperHoleTilt, setL31UpperHoleTilt] = useState<[number,number,number]>([7.2, 0.0, 0.0]);
  const [l31IsDragging, setL31IsDragging] = useState(false);

  // ── 위치 지정 디버그 마커 ──
  const [showMarker, setShowMarker] = useState(false);
  const [pickMode, setPickMode] = useState(false);
  const [markerPos, setMarkerPos] = useState<[number,number,number]>([0, 400, 150]);

  // hR 고정됨 — l31PosOffset 변경 불가
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleL31Delta = useCallback((_dx: number, _dy: number, _dz: number) => {}, []);
  const handleL31DragStart = useCallback(() => {
    setL31IsDragging(true);
    if (orbitRef.current) orbitRef.current.enabled = false;
  }, []);
  const handleL31DragEnd = useCallback(() => {
    setL31IsDragging(false);
    if (orbitRef.current) orbitRef.current.enabled = true;
  }, []);

  const handleHover = useCallback((mesh: THREE.Object3D|null) => setHoveredMesh(mesh), []);
  const endEffMeshRef      = useRef<THREE.Mesh|null>(null);
  const [endEffWorldPos, setEndEffWorldPos] = useState<THREE.Vector3|null>(null);
  const orbitRef    = useRef<any>(null);
  const svgLineRef  = useRef<SVGLineElement | null>(null);
  const descBoxRef  = useRef<HTMLDivElement | null>(null);

  /* Active-joint tracking — set when any joint value changes, auto-clears */
  const linkMeshRefs = useRef<Partial<Record<keyof Joints, THREE.Mesh>>>({});
  const jointAnchorRefs = useRef<Partial<Record<keyof Joints, THREE.Object3D>>>({});
  const [activeJoint, setActiveJoint] = useState<keyof Joints|null>(null);
  const timerRef     = useRef<ReturnType<typeof setTimeout>|null>(null);
  const prevJoints   = useRef(joints);

  useEffect(() => {
    const prev = prevJoints.current;
    const changed = (["j1","j2","j3","j4"] as (keyof Joints)[]).find(k => joints[k] !== prev[k]);
    if (changed) {
      setActiveJoint(changed);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setActiveJoint(null), 1500);
    }
    prevJoints.current = joints;
  }, [joints]);

  const activeMesh = activeJoint ? (linkMeshRefs.current[activeJoint] ?? null) : null;

  /* Emissive hover highlight — material-based, no postprocessing needed.
     Clones the original material, applies a cyan emissive tint while hovered,
     and restores the original on pointer-out. */
  const prevMeshRef = useRef<THREE.Mesh | null>(null);
  const prevMatRef  = useRef<THREE.Material | null>(null);

  useEffect(() => {
    // Restore previous mesh material
    if (prevMeshRef.current && prevMatRef.current) {
      prevMeshRef.current.material = prevMatRef.current;
    }
    prevMeshRef.current = null;
    prevMatRef.current  = null;

    if (hoveredMesh instanceof THREE.Mesh) {
      const orig = hoveredMesh.material as THREE.Material;
      prevMeshRef.current = hoveredMesh;
      prevMatRef.current  = orig;
      if (orig instanceof THREE.MeshStandardMaterial) {
        const hi = orig.clone();
        hi.emissive.set(0x00aacc);
        hi.emissiveIntensity = 0.45;
        hoveredMesh.material = hi;
      }
    }
  }, [hoveredMesh]);


  return (
    <div style={{width:"100%",height:"100%", position:"relative",
      background:"linear-gradient(165deg,#f2f2f2 0%,#ebebeb 50%,#e2e2e2 100%)"}}
      onWheel={e => e.stopPropagation()}>
      <Canvas key="robot-3d-v2" shadows frameloop="always"
        gl={{ antialias:true, failIfMajorPerformanceCaveat:false, powerPreference:"high-performance", preserveDrawingBuffer:false }}
        dpr={[1, 1.25]}
        style={{ display:"block" }}>
        <WebGLContextRecovery onLost={onContextLost} onRestored={onContextRestored}/>
        {/* scene.background 명시 — WebGL 일시 중단 시 흰 화면 방지 */}
        <color attach="background" args={["#ebebeb"]}/>
        <PerspectiveCamera makeDefault position={HOME_CAMERA_POSITION} fov={42} near={1} far={6000}/>
        <Suspense fallback={null}>
          <Environment preset="studio" environmentIntensity={0.22}/>
        </Suspense>
        <ambientLight intensity={0.22} color="#f5f8ff"/>
        <directionalLight
          position={[600,420,650]} intensity={1.45} color="#fff6e8" castShadow
          shadow-mapSize-width={1024} shadow-mapSize-height={1024}
          shadow-camera-near={10}   shadow-camera-far={3000}
          shadow-camera-left={-700} shadow-camera-right={700}
          shadow-camera-top={700}   shadow-camera-bottom={-200}
          shadow-bias={-0.0005}/>
        <directionalLight position={[-550,350,-300]} intensity={0.52} color="#e8f0ff"/>
        <directionalLight position={[0,280,-900]} intensity={0.28} color="#ffffff"/>
        {/* ── Floor / work surface — robot base sits at y=0 ── */}
        <Grid position={[0,-1,0]} args={[2000,2000]}
          cellSize={50} cellThickness={0.4} cellColor="#c0c4c8"
          sectionSize={200} sectionThickness={0.8} sectionColor="#a0a8b0"
          fadeDistance={99999} fadeStrength={0} infiniteGrid={false}/>
        <mesh rotation={[-Math.PI/2,0,0]} position={[0,-2,0]} receiveShadow>
          <planeGeometry args={[3000,3000]}/>
          <meshStandardMaterial color="#e8eaed" roughness={0.9} metalness={0.0}/>
        </mesh>
        {/* Shadow catcher on top of floor plane */}
        <mesh rotation={[-Math.PI/2,0,0]} position={[0,-1,0]} receiveShadow>
          <planeGeometry args={[3000,3000]}/>
          <shadowMaterial opacity={0.25}/>
        </mesh>
        <Suspense fallback={<ModelLoadingFallback/>}>
          <PaperRobotAppearance active={!!paper.data} tcpRef={endEffMeshRef}>
          <URDFRobot suctionSourceRef={suctionSourceRef} joints={joints} liveJointsRef={liveJointsRef} onLinkHover={handleHover} linkRefs={linkMeshRefs} jointAnchorRefs={jointAnchorRefs} showL1={annotations?.l1} showL2={annotations?.l2} showBadges={annotations?.endEff} endEffTrackerRef={endEffMeshRef} highlightJoint={highlightJoint} highlightLinks={highlightLinks} l31LeftTarget={debugLeftHole} l31RightTarget={debugRightHole} l21UpperHole={debugUpperHole} l32YOffset={debugL32Y} l31PosOffset={l31PosOffset} l31RotOffset={l31RotOffset} l31UpperHoleTilt={l31UpperHoleTilt} onL31Delta={handleL31Delta} onL31DragStart={handleL31DragStart} onL31DragEnd={handleL31DragEnd} onL31RotChange={setL31RotOffset} onL31LeftTargetChange={(v) => setDebugLeftHole(v)} applyL31RotRef={applyL31RotRef} l31Locked={l31Locked} endEffector={endEffector}/>
          </PaperRobotAppearance>
        </Suspense>
        {paper.data?<PaperSceneOverlay/>:<><SquareComparisonOverlay/><RevisionSceneOverlay/></>}
        {pickBlockState && (
          <PickBlocks gripActive={pickBlockState.gripActive} missionDone={pickBlockState.missionDone}/>
        )}
        {showMarker && (
          <mesh position={markerPos} renderOrder={999}>
            <sphereGeometry args={[5, 16, 16]}/>
            <meshBasicMaterial color="#ff2200" depthTest={false} transparent opacity={0.9}/>
          </mesh>
        )}
        <MarkerPlacer enabled={pickMode} onPlace={(p) => { setMarkerPos(p); setShowMarker(true); }}/>
        <EndEffTracker meshRef={endEffMeshRef} enabled={!!annotations?.endEff || !!annotations?.projection || !!highlightCoord || !!highlightLinks || !!focusTcp} onPos={setEndEffWorldPos}/>
        {axisLessonVisual && <AxisLessonOverlay key={axisLessonVisual.key} visual={axisLessonVisual} tcpRef={endEffMeshRef} coords={coords} liveCoordsRef={liveCoordsRef}/>}
        {coordinateVisual && coords && <CoordinateLessonOverlay key={coordinateVisual.key} visual={coordinateVisual} tcpRef={endEffMeshRef}
          coords={{x:coords.x,y:coords.y,z:coords.z ?? 0}} liveCoordsRef={liveCoordsRef}/>}
        {motionVisual && <MotionComparisonOverlay visual={motionVisual}/>}
        {kinematicsVisual && <KinematicsJointMarker visual={kinematicsVisual} anchors={jointAnchorRefs} joints={joints} liveJointsRef={liveJointsRef}/>}
        {showFloorRect && learningVisual && !comparisonShown && <LearningFloorOverlay visual={learningVisual}/>}
        {showFloorRect && liveCoordsRef && <FloorRectTrace liveCoordsRef={liveCoordsRef} tcpRef={endEffMeshRef} traceKey={traceKey ?? 0} active={learningVisual?.traceActive ?? false} visible={(learningVisual?.traceVisible ?? false) && !comparisonShown} endpoint={learningVisual?.traceEndpoint}/>}
        {(annotations?.endEff || annotations?.projection) && !highlightLinks && endEffWorldPos && <EndEffectorProjection worldPos={endEffWorldPos} coords={coords}/>}
        {focusTcp && endEffWorldPos && <TcpFocusHighlight worldPos={endEffWorldPos} startZ={focusTcp.startZ} targetZ={focusTcp.targetZ} currentZ={coords?.z}/>}
        {!axisLessonVisual && !coordinateVisual && highlightCoord && endEffWorldPos && <CoordGuideArrows worldPos={endEffWorldPos} axis={highlightCoord}/>}
        {!compactCoordinateHelp && highlightCoord && endEffWorldPos && <TcpLineProjector worldPos={endEffWorldPos} svgLine={svgLineRef} descBox={descBoxRef}/>}
        {highlightLinks && endEffWorldPos && <SideViewGuideLines tcpPos={endEffWorldPos} coordZ={coords?.z ?? 0} joints={{ j2: joints.j2, j3: joints.j3 }} showTheta={annotations?.l1 ?? true}/>}
        {showSuctionZoom && <SuctionZoomPass sourceRef={suctionSourceRef} slotRef={suctionSlotRef} angleRef={suctionAngleRef}/>}
        {!paper.data&&<CoordinateStudyCamera requestKey={focusTcp ? 0 : kinematicsStudyViewKey ?? shapeStudyViewKey ?? coordinateStudyViewKey} preset={viewPreset}
          minimumAspect={focusTcp || kinematicsStudyViewKey !== undefined || shapeStudyViewKey !== undefined ? 1.05 : undefined}
          view={focusTcp ? FOUNDATION_STUDY_VIEW : kinematicsStudyViewKey !== undefined ? KINEMATICS_STUDY_VIEW : shapeStudyViewKey !== undefined ? SHAPE_STUDY_VIEW : undefined}/>}
        <CameraAnimator preset={viewPreset} onFree={() => onViewFree?.()}/>
        <OrbitControls ref={orbitRef} makeDefault
          target={HOME_CAMERA_TARGET} minDistance={280} maxDistance={2200}
          minPolarAngle={0.01} maxPolarAngle={Math.PI*0.95}
          enablePan={!pickMode} enableRotate={!pickMode} enableZoom={!pickMode}
          dampingFactor={0.09} enableDamping
          mouseButtons={{ LEFT: 0, MIDDLE: 2, RIGHT: 0 }}
          onStart={() => { if (!pickMode) onViewFree?.(); }}/>
        <HomeCameraReset requestKey={homeViewKey}/>
      </Canvas>
      {showSuctionZoom && <SuctionZoomPanel slotRef={suctionSlotRef} angleRef={suctionAngleRef} onClose={onSuctionZoomClose}/>}
      {/* SVG 리더 선 오버레이 — TcpLineProjector가 매 프레임 DOM 직접 갱신 */}
      {!compactCoordinateHelp && highlightCoord && (
        <svg style={{ position:"absolute", inset:0, width:"100%", height:"100%", pointerEvents:"none", overflow:"visible" }}>
          <line ref={svgLineRef}
            stroke="#f97316" strokeWidth="1.5" strokeDasharray="6 4"
            strokeLinecap="round" opacity="0.75"
            x1="0" y1="0" x2="0" y2="0"
          />
        </svg>
      )}
      {showFloorRect && learningVisual && !revision.data && !paper.data && (
        <div style={{position:"absolute",left:18,bottom:18,pointerEvents:"none",minWidth:250,maxWidth:360,padding:"10px 12px",borderRadius:10,background:"rgba(255,255,255,.94)",border:"1px solid #c7d2fe",boxShadow:"0 8px 24px rgba(15,23,42,.14)",fontFamily:"'Pretendard','Apple SD Gothic Neo',sans-serif"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
            <strong style={{fontSize:12,color:"#312e81"}}>수학 판단 → 3D 로봇</strong>
            <span style={{fontSize:10,fontWeight:900,color:"#4f46e5"}}>{learningVisual.stage}/7</span>
          </div>
          <div style={{fontSize:11,fontWeight:800,color:"#334155",marginTop:4}}>{learningVisual.stageLabel}</div>
          {learningVisual.planningFocus && <div style={{fontSize:11,color:"#164e83",marginTop:5}}>
            {learningVisual.planningFocus.label}
          </div>}
          <div style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:7,fontSize:9,fontWeight:800,color:"#475569"}}>
            {learningVisual.stage<=3&&<span><b style={{color:"#6366f1"}}>○</b> {learningVisual.studentPoints.length>1?"입력한 경로점":"주어진 P1"}</span>}
            {!!learningVisual.studentPath?.length&&<span><b style={{color:"#6366f1"}}>┄</b> 내 예상 경로</span>}
            {learningVisual.stage <= 2 && (learningVisual.planningFocus?.directionPoints.length ?? 0) > 1 &&
              <span><b style={{color:"#6366f1"}}>┄</b> 선택한 방향으로 예상한 경로</span>}
            {learningVisual.axisChoice&&<span><b style={{color:"#f59e0b"}}>━</b> 선택한 방향</span>}
            {learningVisual.showProgram&&<span><b style={{color:learningVisual.sequenceMatchesTarget?"#7c3aed":"#f59e0b"}}>┄</b> 실행 명령 경로</span>}
            {learningVisual.showTarget&&<span><b style={{color:"#16a34a"}}>┄</b> 수학적 목표</span>}
            {learningVisual.traceVisible&&<span><b style={{color:"#2563eb"}}>━</b> DT 실행 궤적</span>}
            {learningVisual.measuredPath.length>1&&<span><b style={{color:"#f97316"}}>━</b> {learningVisual.measurementSource==="hardware"?"실장비 측정":"가상 센서 측정"}</span>}
          </div>
        </div>
      )}
      {axisLessonVisual && <div style={{position:"absolute",left:14,bottom:16,padding:"8px 12px",borderRadius:8,background:"rgba(255,255,255,.94)",fontSize:12,pointerEvents:"none"}}>
        {axisLessonVisual.numeric ? <span>{axisLessonVisual.started&&!axisLessonVisual.result?"이동 관찰 · 현재 TCP와 이동 방향":"A 출발 · P 예상 · D 결과 · 같은 점은 P = D"}</span> : axisLessonVisual.independent ? <span>독립 적용 · 로봇 기준축 +X·+Y·+Z</span> : <><span style={{color:"#b45309",fontWeight:800}}>주황: {axisLessonVisual.task.reverse?"내 선택 명령":"문제 방향"}</span> · <span style={{color:"#9333ea",fontWeight:800}}>보라: 내 예측</span></>}
        {!axisLessonVisual.numeric && axisLessonVisual.result && <span style={{color:"#0f766e"}}> · 초록: DT 이동</span>}
      </div>}
      {motionVisual && <MotionComparisonLegend runningMode={motionVisual.runningMode}/>}
      {coordinateVisual && <div style={{position:"absolute",left:14,bottom:16,padding:"8px 12px",borderRadius:8,background:"rgba(255,255,255,.94)",fontSize:12,pointerEvents:"none"}}>
        점선: 주어진 위치·내 예상 · 실선: 실행 후 DT 결과
      </div>}
      {/* END EFFECTOR/TCP 설명 카드 — 완전 고정 2D 오버레이, 카메라·마우스 무관 */}
      {!compactCoordinateHelp && highlightCoord && (
        <>
          {/* ① 흡착기 이미지 — 우상단 고정 */}
          <div style={{
            position:"absolute", right:20, top:110,
            width:220, borderRadius:10, overflow:"hidden",
            pointerEvents:"none", userSelect:"none",
          }}>
            <img
              src={`${import.meta.env.BASE_URL}suction-cup.png`}
              alt="흡착기"
              style={{ width:"100%", height:160, objectFit:"cover", objectPosition:"center 30%", display:"block" }}
            />
            {/* 노란 TCP 점 아래 라벨 */}
            <span style={{
              position:"absolute", bottom:14, left:"50%", transform:"translateX(-50%)",
              color:"#f97316", fontSize:11, fontWeight:800,
              fontFamily:"'Pretendard','Apple SD Gothic Neo',sans-serif",
              letterSpacing:"1px",
              textShadow:"0 1px 4px rgba(0,0,0,0.95), 0 0 10px rgba(0,0,0,0.8)",
              whiteSpace:"nowrap",
            }}>
              TCP
            </span>
          </div>
          {/* ② 설명 텍스트 박스 — 이미지(top:110, h:160) 바로 아래 */}
          <div ref={descBoxRef} style={{
            position:"absolute", right:20, top:282,
            background:"rgba(15,15,20,0.92)",
            border:"1.5px solid #f97316",
            borderRadius:8,
            padding:"10px 16px 12px",
            boxShadow:"0 6px 20px rgba(0,0,0,0.55)",
            backdropFilter:"blur(4px)",
            whiteSpace:"nowrap",
            pointerEvents:"none", userSelect:"none",
          }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
              <span style={{
                display:"inline-block", width:11, height:11, borderRadius:"50%",
                background:"#f97316", boxShadow:"0 0 7px #f97316", flexShrink:0,
              }}/>
              <span style={{ color:"#f97316", fontSize:13, fontWeight:700, fontFamily:"sans-serif" }}>
                END EFFECTOR:
              </span>
              <span style={{ color:"#ffffff", fontSize:13, fontWeight:700, fontFamily:"sans-serif" }}>
                로봇 끝 작업 도구(흡착기)
              </span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{
                display:"inline-block", width:11, height:11, borderRadius:"50%",
                background:"#f97316", boxShadow:"0 0 7px #f97316", flexShrink:0,
              }}/>
              <span style={{ color:"#f97316", fontSize:13, fontWeight:700, fontFamily:"sans-serif" }}>TCP:</span>
              <span style={{ color:"#ffffff", fontSize:13, fontWeight:700, fontFamily:"sans-serif" }}>흡착 중심점</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Canvas error boundary ───────────────────────────────────────── */
interface EBState { crashed: boolean; key: number; }
class CanvasErrorBoundary extends Component<{ joints: Joints; children: ReactNode }, EBState> {
  state: EBState = { crashed: false, key: 0 };
  static getDerivedStateFromError(): Partial<EBState> { return { crashed: true }; }
  componentDidCatch(err: Error, info: ErrorInfo) {
    console.warn("[RobotScene] Canvas crashed — will show reset UI.", err.message, info.componentStack?.slice(0, 200));
  }
  reset = () => this.setState(s => ({ crashed: false, key: s.key + 1 }));
  render() {
    if (this.state.crashed) {
      return (
        <div style={{ width:"100%", height:"100%", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:"#f4f4f6", gap:16 }}>
          <IsoFallback joints={this.props.joints}/>
          <button
            onClick={this.reset}
            style={{ marginTop:8, padding:"8px 24px", borderRadius:8, border:"1px solid #bbb", background:"#fff", fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif", fontSize:13, fontWeight:700, cursor:"pointer", color:"#222", boxShadow:"0 1px 4px rgba(0,0,0,0.10)" }}>
            3D 뷰 재시작
          </button>
        </div>
      );
    }
    return <div style={{ width:"100%", height:"100%" }} key={this.state.key}>{this.props.children}</div>;
  }
}

/* ── Sanitize joints — guard against NaN / Infinity ─────────────── */
function safeJoints(j: Joints): Joints {
  const s = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
  return { j1: s(j.j1, 0), j2: s(j.j2, 69.02), j3: s(j.j3, -113.32), j4: s(j.j4, 0) };
}

/* ── Public exports ──────────────────────────────────────────────── */
export { CoordAxisOverlay };
/** The process cell reuses the established MG400 geometry and joint chain.
 * Keep this wrapper free of per-frame base correction or alternative tool meshes. */
export function ProcessRobotModel({ joints, liveJointsRef, tcpRef }: {
  joints: Joints;
  liveJointsRef?: React.MutableRefObject<Joints | null>;
  tcpRef: React.RefObject<THREE.Mesh | null>;
}) {
  return <URDFRobot joints={joints} liveJointsRef={liveJointsRef} endEffTrackerRef={tcpRef}
    l31LeftTarget={[-0.1343, 0.0324, -0.0193]} l31RightTarget={[0.185, 0, 0.008]}
    l21UpperHole={[-0.020, 0.036, 0.147]} l32YOffset={0.025}
    l31PosOffset={[-34.6518, -31.5474, 0.8969]} l31RotOffset={[0, 0, 0]}
    l31UpperHoleTilt={[7.2, 0, 0]} l31Locked endEffector="suction"/>;
}

export type { ViewPreset };
export function RobotScene({ suctionZoomOpen, onSuctionZoomClose, joints, liveJointsRef, liveCoordsRef, coords, viewPreset, homeViewKey, onViewFree, annotations, highlightJoint, highlightCoord, highlightLinks, focusTcp, showFloorRect, traceKey, learningVisual, axisLessonVisual, coordinateVisual, motionVisual, kinematicsVisual, coordinateStudyViewKey, shapeStudyViewKey, kinematicsStudyViewKey, compactCoordinateHelp, endEffector, pickBlockState }:{ suctionZoomOpen?:boolean; onSuctionZoomClose?:()=>void; joints:Joints; liveJointsRef?: React.MutableRefObject<Joints | null>; liveCoordsRef?: React.MutableRefObject<{x:number;y:number;z:number;r:number}|null>; coords?:{x:number;y:number;z?:number}; viewPreset?:ViewPreset; homeViewKey?:number; onViewFree?:()=>void; annotations?:{l1:boolean;l2:boolean;endEff:boolean;projection?:boolean}; highlightJoint?:"j1"|"j2"|"j3"|"j4"|null; highlightCoord?:"x"|"y"|"z"|"r"|null; highlightLinks?:{l1:boolean;l2:boolean}|null; focusTcp?:{startZ?:number;targetZ?:number}|null; showFloorRect?:boolean; traceKey?:number; learningVisual?:LearningVisualState|null; axisLessonVisual?:AxisLessonVisual|null; coordinateVisual?:CoordinateVisual|null; motionVisual?:MotionComparisonVisual|null; kinematicsVisual?:KinematicsVisual|null; coordinateStudyViewKey?:number; shapeStudyViewKey?:number; kinematicsStudyViewKey?:number; compactCoordinateHelp?:boolean; endEffector?:"pen"|"suction"; pickBlockState?:{ gripActive:boolean; missionDone:boolean } }) {
  const sj = safeJoints(joints);
  const [webglAvailable] = useState(() => canUseWebGL());
  const [rendererKey, setRendererKey] = useState(0);
  const [contextLost, setContextLost] = useState(false);

  const restartRenderer = useCallback(() => {
    setContextLost(false);
    setRendererKey(key => key + 1);
  }, []);
  const handleContextLost = useCallback(() => setContextLost(true), []);
  const handleContextRestored = useCallback(() => setContextLost(false), []);

  // Browsers do not always emit webglcontextrestored. Remount the renderer
  // after a short grace period so a transient GPU reset cannot leave a blank view.
  useEffect(() => {
    if (!contextLost) return;
    const timer = window.setTimeout(restartRenderer, 1800);
    return () => window.clearTimeout(timer);
  }, [contextLost, restartRenderer]);

  const paper=usePaperScene();
  if (!webglAvailable) return <div className="revision-robot-shell"><div className="revision-robot-canvas"><IsoFallback joints={sj}/>{paper.data?<div className="paper-scene-fallback"><PaperSceneMap fallback/></div>:<><SquareFallbackComparison/><SquareComparisonControls/></>}<PaperSceneToolbar/></div><PaperSceneCaption/><RevisionSceneDock fallback/></div>;
  return (
    <div className="revision-robot-shell"><div className="revision-robot-canvas">
      <CanvasErrorBoundary key={rendererKey} joints={sj}>
        <ThreeDScene suctionZoomOpen={suctionZoomOpen} onSuctionZoomClose={onSuctionZoomClose} joints={sj} liveJointsRef={liveJointsRef} liveCoordsRef={liveCoordsRef} coords={coords} viewPreset={viewPreset} homeViewKey={homeViewKey} onViewFree={onViewFree} annotations={annotations} highlightJoint={highlightJoint} highlightCoord={highlightCoord} highlightLinks={highlightLinks} focusTcp={focusTcp} showFloorRect={showFloorRect} traceKey={traceKey} learningVisual={learningVisual} axisLessonVisual={axisLessonVisual} coordinateVisual={coordinateVisual} motionVisual={motionVisual} kinematicsVisual={kinematicsVisual} coordinateStudyViewKey={coordinateStudyViewKey} shapeStudyViewKey={shapeStudyViewKey} kinematicsStudyViewKey={kinematicsStudyViewKey} compactCoordinateHelp={compactCoordinateHelp} endEffector={endEffector} pickBlockState={pickBlockState} onContextLost={handleContextLost} onContextRestored={handleContextRestored}/>
      </CanvasErrorBoundary>
      {paper.data?<PaperSceneToolbar/>:<SquareComparisonControls/>}
      {contextLost && (
        <div role="status" style={{
          position:"absolute", inset:0, zIndex:20,
          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12,
          background:"rgba(241,245,249,0.94)", color:"#334155",
          fontFamily:"'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif",
        }}>
          <div style={{ fontSize:14, fontWeight:800 }}>3D 화면을 복구하는 중입니다…</div>
          <button onClick={restartRenderer} style={{
            padding:"8px 18px", borderRadius:8, border:"1px solid #94a3b8",
            background:"#fff", color:"#334155", fontSize:13, fontWeight:700, cursor:"pointer",
          }}>
            지금 다시 시작
          </button>
        </div>
      )}
    </div><PaperSceneCaption/><RevisionSceneDock/></div>
  );
}

