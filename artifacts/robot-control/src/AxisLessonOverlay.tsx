import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { POSE_AXES, type LessonPose } from "./curriculum";
import { axisWorldVector, type AxisLessonVisual } from "./axisLesson";
import { axisDisplayPoints, axisPointOffset } from "./axisReasoning";
import { CoordinateScreenLabels } from "./CoordinateScreenLabels";
import type { CoordinateLabel } from "./coordinateLabelLayout";

const LABEL_STYLE = { pointerEvents: "none" as const, whiteSpace: "nowrap" as const, fontSize: 12, fontWeight: 800,
  background: "rgba(255,255,255,.95)", padding: "2px 5px", borderRadius: 4, color: "#334155" };
function Arrow({ direction, length, color }: { direction: [number, number, number]; length: number; color: number }) {
  const arrow = useMemo(() => {
    const value = new THREE.ArrowHelper(new THREE.Vector3(...direction).normalize(), new THREE.Vector3(), length, color, 8, 5);
    for (const object of [value.line, value.cone]) {
      const material = object.material as THREE.Material;
      material.depthTest = true; material.depthWrite = false;
    }
    return value;
  }, [direction[0], direction[1], direction[2], length, color]);
  useEffect(() => () => arrow.dispose(), [arrow]);
  return <primitive object={arrow}/>;
}

/** Overlays only: robot geometry, joints and model transforms are never edited. */
export function AxisLessonOverlay({ visual, tcpRef, coords, liveCoordsRef }: {
  visual: AxisLessonVisual; tcpRef: RefObject<THREE.Mesh | null>;
  coords?: {x:number;y:number;z?:number}; liveCoordsRef?: RefObject<LessonPose|null>;
}) {
  const anchor = useRef<THREE.Group>(null);
  const tcp = useRef<THREE.Group>(null);
  const captured = useRef(false);
  const world = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (!tcpRef.current || !anchor.current || !tcp.current) return;
    tcpRef.current.getWorldPosition(world);
    tcp.current.position.copy(world);
    // Follow the real mesh before the attempt, then keep the initial reference
    // fixed throughout motion, comparison, retry and camera transfer.
    if (visual.numeric && visual.from) {
      if (!captured.current) {
        const displayed=liveCoordsRef?.current??coords;
        if (!displayed) return;
        const pose={...displayed,z:displayed.z??0,r:"r" in displayed&&typeof displayed.r==="number"?displayed.r:0};
        const origin=visual.scenePoint?.(visual.from),current=visual.scenePoint?.(pose);
        if(visual.scenePoint&&(!origin||!current)) return;
        const offset=origin&&current?current.map((v,i)=>v-origin[i]):axisPointOffset(visual.from,pose);
        anchor.current.position.copy(world).sub(new THREE.Vector3(...offset as [number,number,number]));
        captured.current=true;
      }
    } else if (!captured.current || !visual.started) {
      anchor.current.position.copy(world); captured.current = true;
    }
    anchor.current.visible=true;tcp.current.visible=true;
  });
  const points=useMemo(()=>axisDisplayPoints(visual),[visual]);
  const moving=visual.started&&!visual.result;
  const showTcp=!visual.numeric||moving;
  const directions=useMemo(()=>visual.numeric&&visual.result?[]:
    visual.numeric&&moving?[{axis:visual.command?.axis??visual.task.axis,sign:visual.command?.sign??visual.task.sign}]:
    POSE_AXES.map(axis=>({axis,sign:1})),[visual.numeric,visual.result,moving,visual.command?.axis,visual.command?.sign,visual.task.axis,visual.task.sign]);
  const labels=useMemo<CoordinateLabel[]>(()=>[
    ...points.map(p=>({id:p.id,text:p.label,fullText:p.label,color:p.color,position:p.position})),
    ...directions.map(({axis:a,sign})=>({id:a,text:`${sign>0?"+":"−"}${a.toUpperCase()}`,fullText:`로봇 기준 ${sign>0?"+":"−"}${a.toUpperCase()}`,color:a==="x"?"#0284c7":a==="y"?"#7c3aed":"#059669",
      position:axisWorldVector(a,sign).map(v=>v*85) as [number,number,number],live:moving})),
    ...(showTcp?[{id:"tcp",text:"현재 TCP",fullText:"현재 TCP",color:"#334155",position:[0,0,0] as [number,number,number],live:true}]:[]),
  ],[points,directions,moving,showTcp]);
  const delta: [number, number, number] | null = visual.result ? [
    visual.result.to.x - visual.result.from.x,
    visual.result.to.z - visual.result.from.z,
    -(visual.result.to.y - visual.result.from.y),
  ] : null;
  return <>
    {visual.numeric&&<CoordinateScreenLabels description="2-1 출발·예상·DT 도착점" labels={labels} anchor={anchor} tcp={tcp}/>}
    <group ref={tcp} visible={false}>
      {showTcp&&<mesh><sphereGeometry args={[2.5, 12, 12]}/><meshBasicMaterial color="#334155"/></mesh>}
      {visual.numeric&&moving&&directions.map(({axis,sign})=><Arrow key={axis} direction={axisWorldVector(axis,sign)} length={70} color={axis==="x"?0x0284c7:axis==="y"?0x7c3aed:0x059669}/>)}
      {!visual.numeric&&<Html position={[0, 15, 0]} center style={{ pointerEvents: "none" }}><span style={LABEL_STYLE}>TCP</span></Html>}
    </group>
    <group ref={anchor} visible={false}>
      {(!visual.numeric||!moving)&&directions.map(({axis,sign}) => {
        const d = axisWorldVector(axis,sign); const color = axis === "x" ? 0x0284c7 : axis === "y" ? 0x7c3aed : 0x059669;
        return <group key={axis}>
          <Arrow direction={d} length={70} color={color}/>
          {!visual.numeric&&<Html position={d.map(v => v * 85) as [number, number, number]} center style={{ pointerEvents: "none" }}>
            <span style={{ ...LABEL_STYLE, color: `#${color.toString(16).padStart(6, "0")}` }}>+{axis.toUpperCase()}</span>
          </Html>}
        </group>;
      })}
      {!visual.numeric && !visual.independent && !visual.task.reverse && <Arrow direction={axisWorldVector(visual.task.axis, visual.task.sign)} length={65} color={0xf59e0b}/>}
      {!visual.numeric && visual.task.reverse && visual.command && <Arrow direction={axisWorldVector(visual.command.axis, visual.command.sign)} length={65} color={0xf59e0b}/>}
      {!visual.numeric && !visual.independent && POSE_AXES.map(axis => {
        const choice = visual.prediction[axis];
        return choice === null || choice === 0 ? null : <group key={axis} position={[0, 12, 0]}>
          <Arrow direction={axisWorldVector(axis, choice)} length={82} color={0xa855f7}/>
        </group>;
      })}
      {!visual.numeric && delta && <>
        <Line points={[[0, 0, 0], delta]} color="#0f766e" lineWidth={3} depthTest={false}/>
        <mesh position={delta} renderOrder={999}><sphereGeometry args={[4, 12, 12]}/><meshBasicMaterial color="#0f766e" depthTest={false}/></mesh>
      </>}
      {visual.numeric&&<>
        {points.map(p=><group key={p.id}>
          {p.id!=="a"&&<Line points={[[0,0,0],p.position]} color={p.color} lineWidth={1.5} dashed={p.id==="p"} dashSize={5} gapSize={3} depthTest/>}
          <mesh position={p.position}><sphereGeometry args={[p.id==="p"?4:2.5,12,12]}/><meshBasicMaterial color={p.color} wireframe={p.id==="p"}/></mesh>
        </group>)}
      </>}
    </group>
  </>;
}

