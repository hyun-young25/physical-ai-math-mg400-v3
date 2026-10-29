import { useEffect,useMemo,useRef,useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html,Line } from "@react-three/drei";
import * as THREE from "three";
import { shapeWorldPoint } from "./shapeKinematics";
import { useSquareVisual } from "./useSquareVisual";
import { useActiveRevisionScene } from "./revisionSceneStore";
import { COMPARISON_COLORS as C,fmtSquare,signedSquare,squareExecutionLabel,squareClosureGap,squareReplayPoint } from "./squareComparisonVisual";
import type { SquareObservedVertex } from "./squareMismatchDiagnosis";

const world=(p:{x:number;y:number;z?:number}):[number,number,number]=>{
  const [x,y,z]=shapeWorldPoint({...p,z:p.z??0});return [x,y+3,z];
};
function Marker({position,color,ghost=false}:{position:[number,number,number];color:string;ghost?:boolean}){
  return <mesh position={position} renderOrder={200}><sphereGeometry args={[ghost?5:4,16,12]}/><meshBasicMaterial color={color} transparent opacity={ghost?0.45:1} depthTest={false}/></mesh>;
}
function ErrorArrow({from,to,neutral=false}:{from:SquareObservedVertex;to:SquareObservedVertex;neutral?:boolean}){
  const a=world(from),b=world(to),distance=Math.hypot(to.x-from.x,to.y-from.y,(to.z??0)-(from.z??0));
  const arrow=useMemo(()=>{
    const origin=new THREE.Vector3(...a),direction=new THREE.Vector3(...b).sub(origin);
    return new THREE.ArrowHelper(direction.clone().normalize(),origin,direction.length(),neutral?"#94a3b8":C.mismatch,Math.min(5,direction.length()/2),2);
  },[...a,...b,neutral]);

  if(distance<.001)return null;
  return <group>{neutral?<Line points={[a,b]} color="#94a3b8" dashed dashSize={3} gapSize={3} lineWidth={2}/>:<primitive object={arrow}/>}<Html position={b} center zIndexRange={[12,0]} style={{pointerEvents:"none"}}><span className={"square-3d-label "+(neutral?"square-3d-neutral":"square-3d-error")}>{fmtSquare(distance)} mm</span></Html></group>;
}
export function SquareComparisonOverlay(){
  const revision=useActiveRevisionScene();
  const state=useSquareVisual(),v=state.visual;
  const expectedMarker=useRef<THREE.Group>(null),actualMarker=useRef<THREE.Group>(null),mismatch=useRef<THREE.Group>(null);
  const dimension=useRef<HTMLDivElement>(null);
  const shownAt=useRef(performance.now());
  useEffect(()=>{shownAt.current=performance.now();},[v?.key,v?.diagnosis.type]);
  const [reduced,setReduced]=useState(false);
  useEffect(()=>{const m=window.matchMedia("(prefers-reduced-motion: reduce)"),update=()=>setReduced(m.matches);update();m.addEventListener("change",update);return()=>m.removeEventListener("change",update);},[]);
  useFrame(()=>{
    if(mismatch.current)mismatch.current.visible=reduced||performance.now()-shownAt.current>=1200||Math.sin((performance.now()-shownAt.current)/1000*Math.PI*4)>-.45;
    if(!v||!state.replay){if(dimension.current)dimension.current.style.visibility="visible";return;}
    const progress=Math.min(1,(performance.now()-state.replay.startedAt)/(4000/state.replay.speed));
    const a=squareReplayPoint(v.target,progress),b=squareReplayPoint(v.observed,progress);
    if(a&&expectedMarker.current)expectedMarker.current.position.set(...world(a));
    if(b&&actualMarker.current)actualMarker.current.position.set(...world(b));
    const diverged=!!a&&!!b&&Math.hypot(a.x-b.x,a.y-b.y)>.1;
    if(mismatch.current)mismatch.current.visible=diverged;
    if(dimension.current)dimension.current.style.visibility=diverged?"visible":"hidden";
  });
  if(!v||!state.enabled||revision.data)return null;
  const {diagnosis:d,target,observed}=v,edgeIndex=v.match===true||v.diagnosis.type==="model-real"?undefined:state.emphasis?.edgeIndex??d.edgeIndex;
  const edge=edgeIndex?d.evidence.edges?.[edgeIndex-1]:undefined;
  const a=edgeIndex?observed[edgeIndex-1]:undefined,b=edgeIndex?observed[edgeIndex]:undefined;
  const midpoint=a&&b?world({x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:((a.z??0)+(b.z??0))/2}):null;
  const gap=squareClosureGap(observed),rejected=d.evidence.rejected;
  return <group name="square-diagnosis-visual-only">
    <Line points={target.map(world)} color={C.target} dashed dashSize={8} gapSize={5} lineWidth={2} transparent opacity={.6} depthTest={false}/>
    {observed.length>1&&<Line points={observed.map(world)} color={d.type==="model-real"?"#94a3b8":(v.match??d.type==="match")?C.target:C.executed} dashed={d.type==="model-real"} lineWidth={4} depthTest={false}/>}
    {a&&b&&<group ref={mismatch}><Line points={[world(a),world(b)]} color={C.mismatch} lineWidth={12} depthTest={false}/></group>}
    {midpoint&&edge&&<Html position={midpoint} center zIndexRange={[15,0]} style={{pointerEvents:"none"}}><div ref={dimension} className="square-3d-label" data-testid="square-3d-dimension">
      <b>{edge.edge}{v.coordinateLabel?" · "+v.coordinateLabel:""}</b><span>조건 {signedSquare(edge.condition.delta,edge.condition.axis)}</span><span>실행 {squareExecutionLabel(edge.executed.dx,edge.executed.dy)}</span>
      {gap!==null&&gap>.1&&<span>시작점과 {fmtSquare(gap)} mm 떨어짐</span>}
    </div></Html>}
    {rejected&&<group position={world(rejected)}>
      <Line points={[[-7,-7,0],[7,7,0]]} color={C.mismatch} lineWidth={4} depthTest={false}/>
      <Line points={[[-7,7,0],[7,-7,0]]} color={C.mismatch} lineWidth={4} depthTest={false}/>
      <Html position={[0,14,0]} center style={{pointerEvents:"none"}}><span className="square-3d-label square-3d-error">도달 불가 · 관절 해 없음</span></Html>
    </group>}
    {gap!==null&&gap>.1&&<><Line points={[world(observed[4]),world(observed[0])]} color={C.mismatch} dashed dashSize={5} gapSize={4} lineWidth={2} depthTest={false}/>
      {!edge&&<Html position={world(observed[4])} center style={{pointerEvents:"none"}}><span className="square-3d-label square-3d-error">시작점과 {fmtSquare(gap)} mm 떨어짐</span></Html>}</>}
    {(v.errorArrows&&d.type!=="match"||d.type==="model-real"&&d.evidence.source==="hardware")&&observed.slice(0,v.connectedVerticesOnly?4:5).map((p,i)=>target[i]&&<ErrorArrow key={i} from={target[i]} to={p} neutral={d.type==="model-real"}/>)}
    {(v.match??d.type==="match")&&<Html position={world(target[0])} center style={{pointerEvents:"none"}}><span className="square-3d-label square-3d-match">✓ 목표와 일치</span></Html>}
    {state.replay&&observed.length===5&&<>
      <group ref={expectedMarker} position={world(target[0])}><Marker position={[0,0,0]} color={C.target} ghost/></group>
      <group ref={actualMarker} position={world(observed[0])}><Marker position={[0,0,0]} color={C.executed}/></group>
    </>}
  </group>;
}
