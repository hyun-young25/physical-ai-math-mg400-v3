import { useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import { CoordinateScreenLabels } from "./CoordinateScreenLabels";
import { coordinateLabels } from "./coordinateLabelLayout";
import { POSE_AXES } from "./curriculum";
import { COORDINATE_MODES, coordinateWorldOffset, coordinateSceneOffset, type CoordinateVector, type CoordinateVisual } from "./coordinateLearning";

function Marker({ position, color }: { position: [number,number,number]; color: string }) {
  return <group position={position}><mesh renderOrder={998}><sphereGeometry args={[3.5,12,12]}/><meshBasicMaterial color={color} depthTest={false}/></mesh></group>;
}
function Workpiece({ color = "#38bdf8" }: { color?: string }) {
  return <mesh position={[0,-10,0]} castShadow receiveShadow><boxGeometry args={[24,20,24]}/><meshStandardMaterial color={color} roughness={0.7}/></mesh>;
}
function WorkSurface({ top, anchor, color }: { top:CoordinateVector; anchor:RefObject<THREE.Group|null>; color:string }) {
  const legs=useRef<(THREE.Mesh|null)[]>([]);
  useFrame(()=>{
    if(!anchor.current)return;
    // The same calibrated origin aligns the work surface with the TCP and its legs with the scene floor.
    const height=Math.max(0,anchor.current.position.y+top.z-24);
    legs.current.forEach(leg=>{if(leg){leg.position.y=-24-height/2;leg.scale.y=height;}});
  });
  return <group position={coordinateWorldOffset(top)}>
    <mesh position={[0,-22,0]} receiveShadow><boxGeometry args={[60,4,60]}/><meshStandardMaterial color={color}/></mesh>
    {([[-23,-23],[-23,23],[23,-23],[23,23]] as const).map(([x,z],i)=><mesh key={i} ref={el=>{legs.current[i]=el;}} position={[x,-24,z]} castShadow>
      <boxGeometry args={[4,1,4]}/><meshStandardMaterial color="#94a3b8"/></mesh>)}
  </group>;
}
/** Display annotations only. The calibration uses the existing TCP; no joint or model transforms are changed. */
export function CoordinateLessonOverlay({ visual, tcpRef, coords, liveCoordsRef }: {
  visual: CoordinateVisual; tcpRef: RefObject<THREE.Mesh | null>; coords: CoordinateVector;
  liveCoordsRef?: RefObject<CoordinateVector | null>;
}) {
  const anchor = useRef<THREE.Group>(null), tcp = useRef<THREE.Group>(null);
  const calibrated = useRef(false), world = useMemo(()=>new THREE.Vector3(),[]);
  const positionOf = (value:CoordinateVector) => coordinateSceneOffset(visual,value) ?? coordinateWorldOffset(value);
  useFrame(() => {
    if (!tcpRef.current || !anchor.current || !tcp.current) return;
    tcpRef.current.getWorldPosition(world); tcp.current.position.copy(world); tcp.current.visible=true;
    if (!calibrated.current) {
      const displayed = liveCoordsRef?.current ?? coords;
      const projected = coordinateSceneOffset(visual,displayed);
      if (!projected) return;
      anchor.current.position.copy(world).sub(new THREE.Vector3(...projected));
      calibrated.current=true; anchor.current.visible=true;
    }
  });
  const labels = useMemo(() => coordinateLabels(visual), [visual]);
  const pieces = visual.workpieces;
  const heldPiece = pieces?.find(piece => piece.attached);
  const start = positionOf(visual.from);
  const origin: [number,number,number] = [0,0,0];
  return <>
    <CoordinateScreenLabels labels={labels} anchor={anchor} tcp={tcp}/>
    <group ref={tcp} visible={false}><Marker position={[0,0,0]} color="#b45309"/>{(pieces ? heldPiece : visual.workpiece?.attached)&&<Workpiece color={heldPiece && heldPiece.id === pieces?.[1]?.id ? "#818cf8" : "#38bdf8"}/>}</group>
    <group ref={anchor} visible={false}>
      {pieces?.map((piece, index) => <group key={piece.id}>
        {!piece.attached&&<group position={coordinateWorldOffset(piece.top)}><Workpiece color={piece.completed ? "#2dd4bf" : index === 0 ? "#38bdf8" : "#818cf8"}/></group>}
        <WorkSurface top={piece.pick} anchor={anchor} color="#cbd5e1"/>
        <WorkSurface top={piece.place} anchor={anchor} color={index === 0 ? "#99c9c2" : "#b6b5da"}/>
      </group>)}
      {visual.obstacles?.map(obstacle => <mesh key={obstacle.id}
        position={coordinateWorldOffset({x:obstacle.center.x,y:obstacle.center.y,z:obstacle.baseZ+obstacle.height/2})} castShadow receiveShadow>
        <boxGeometry args={[obstacle.width,obstacle.height,obstacle.depth]}/>
        <meshStandardMaterial color="#64748b" roughness={0.8}/>
      </mesh>)}
      {!pieces&&visual.workpiece&&<>
        {!visual.workpiece.attached&&<group position={coordinateWorldOffset(visual.workpiece.top)}><Workpiece/></group>}
        <WorkSurface top={visual.workpiece.pick} anchor={anchor} color="#cbd5e1"/>
        {visual.workpiece.showPlace!==false&&<WorkSurface top={visual.workpiece.place} anchor={anchor} color="#99c9c2"/>}
      </>}
      <Marker position={origin} color="#64748b"/>
      <Marker position={start} color="#334155"/>
      <Line points={[origin,start]} color="#cbd5e1" lineWidth={1} dashed dashSize={3} gapSize={6} depthTest={false}/>
      {POSE_AXES.map(axis => {
        const end = coordinateWorldOffset({x:0,y:0,z:0,[axis]:65});
        return <group key={axis}><Line points={[origin,end]} color="#94a3b8" lineWidth={1} depthTest={false}/></group>;
      })}
      {visual.points.map((p) => {
        const projected = coordinateSceneOffset(visual,p.pose);
        if (!projected) return null;
        return <group key={p.id}>
          {visual.showPaths !== false && <Line points={[p.from ? positionOf(p.from) : start,projected]} color={p.color} lineWidth={1.8} dashed dashSize={6} gapSize={4} depthTest={false}/>}
          <Marker position={projected} color={p.color}/>
        </group>;
      })}
      {COORDINATE_MODES.map((mode) => {
        const result = visual.results[mode]; if (!result) return null;
        const color = mode === "absolute" ? "#0284c7" : "#0f766e";
        return <group key={mode}><Line points={[positionOf(result.from),positionOf(result.to)]} color={color} lineWidth={mode === "absolute" ? 5 : 2.5} depthTest={false}/>
          <Marker position={positionOf(result.to)} color={color}/></group>;
      })}
      {visual.trails?.map((trail)=><group key={trail.id}>
        <Line points={[coordinateWorldOffset(trail.from),coordinateWorldOffset(trail.to)]} color={trail.color} lineWidth={3} depthTest={false}/>
        <Marker position={coordinateWorldOffset(trail.to)} color={trail.color}/>
      </group>)}
    </group>
  </>;
}
