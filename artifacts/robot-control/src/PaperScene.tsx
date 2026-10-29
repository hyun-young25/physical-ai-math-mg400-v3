import { useMemo } from "react";
import { Html, Line } from "@react-three/drei";
import { DoubleSide } from "three";
import { CoordinateStudyCamera } from "./CoordinateStudyCamera";
import { shapeWorldPoint } from "./shapeKinematics";
import { PAPER_COLORS as C, paperCorners, paperGrid, paperMismatchPoints, paperPoint, paperSceneSeries, paperSeriesSegments, paperFrameSource, validPaperPoint, type PaperScenePoint } from "./paperSceneModel";
import { requestPaperCamera, selectPaperPoint, usePaperScene } from "./paperSceneStore";
import "./paperScene.css";

const references=[{name:"O",x:0,y:0},{name:"X",x:10,y:0},{name:"Y",x:0,y:10}];
export function PaperSceneLegend(){
  return <div className="paper-scene-legend" aria-label="종이와 도봇 공통 범례">{[
    ["O·X·Y 기준점",C.reference],["목표점",C.target],["예측 (점선)",C.prediction],["첫 실행",C.first],["재실행",C.result],["불일치 근거",C.mismatch],
  ].map(([label,color])=><span key={label}><i style={{borderColor:color,borderTopStyle:color===C.prediction?"dashed":"solid"}}/>{label}</span>)}</div>;
}
export function PaperSceneToolbar(){
  const {data}=usePaperScene();if(!data)return null;
  return <div className="paper-scene-toolbar"><span>{data.frame?"종이 20×20 cm · 1 cm 눈금":"위치 미확인 · 반투명 종이는 배치 예시"}</span><button type="button" onClick={requestPaperCamera}>↺ 종이 시점</button></div>;
}
export function PaperSceneCaption(){
  const {data}=usePaperScene();if(!data)return null;
  return <div className="paper-scene-caption"><PaperSceneLegend/><small>{data.frame?`${paperFrameSource(data)} · 기록된 O→X / O→Y 방향`:`O/X/Y 기록 ${data.samples.length}/3 · 종이의 실제 위치·방향은 아직 미확인`}<br/>종이 x·y축과 로봇 X·Y축은 서로 다를 수 있습니다. 선은 점 사이의 비교선이며 잉크 궤적이 아닙니다.</small></div>;
}
/** Shared measured-frame geometry, placed at the recorded paper Z (never changes robot pose). */
export function PaperSceneOverlay(){
  const {data,point,reference,phase,cameraKey}=usePaperScene();
  const frame=data?.frame??null;
  const center=paperPoint(frame,10,10);
  const position=(p:PaperScenePoint):[number,number,number]=>shapeWorldPoint(frame?p:{x:p.x+180,y:p.y-60,z:p.z});
  const centerWorld=position(center);
  // Camera changes only on entry, frame change or an explicit reset; not on keystrokes.
  const view=useMemo(()=>({position:[centerWorld[0]-70,centerWorld[1]+850,centerWorld[2]+520] as const,target:[centerWorld[0]-70,centerWorld[1]+90,centerWorld[2]] as const}),[frame?.id]);
  const corners=paperCorners(frame);
  const vertices=new Float32Array([0,1,2,0,2,3].flatMap(i=>position(corners[i])));
  if(!data)return null;
  const series=paperSceneSeries(data,phase),mismatch=paperMismatchPoints(data,series);
  const raised=(p:PaperScenePoint):[number,number,number]=>{const v=position(p);return [v[0],v[1]+1.5,v[2]];};
  const wp=(p:{x:number;y:number})=>raised({...p,z:center.z});
  const selected=(label:string)=>reference?reference===label:`P${point+1}`===label;
  return <group name="measured-paper-sheet">
    <CoordinateStudyCamera requestKey={cameraKey} preset="free" view={view} minimumAspect={1.05}/>
    <mesh renderOrder={5}><bufferGeometry><bufferAttribute attach="attributes-position" args={[vertices,3]}/></bufferGeometry><meshBasicMaterial color="#f8fafc" transparent opacity={frame ? .92 : .25} side={DoubleSide} depthWrite={false}/></mesh>
    {paperGrid(frame).map((line,i)=><Line key={i} points={line.map(raised)} color={i%10===0?"#94a3b8":"#cbd5e1"} lineWidth={i%10===0?1.1:.65} transparent opacity={frame ? .8 : .3}/>)}
    <Line points={[...corners,corners[0]].map(raised)} color={C.reference} lineWidth={2} dashed={!frame}/>
    {series.map(s=><group key={s.label}>
      {paperSeriesSegments(s.points).map((segment,i)=><Line key={i} points={segment.map(wp)} color={s.color} lineWidth={s.label==="목표점"?2:3} dashed={s.dashed} dashSize={5} gapSize={4} depthTest={false}/>)}
      {s.points.filter(validPaperPoint).map(p=><mesh key={p.label} position={wp(p)} renderOrder={210}><sphereGeometry args={[s.label==="목표점"?3.8:2.7,12,8]}/><meshBasicMaterial color={s.color} depthTest={false}/></mesh>)}
    </group>)}
    {frame&&data.targetPoints.map(p=>{const pos=paperPoint(frame,p.xCm,p.yCm),bad=mismatch.includes(p.name),last=series.slice(1).filter(s=>s.points.some(v=>v.label===p.name&&validPaperPoint(v))).at(-1),value=last?.points.find(v=>v.label===p.name);return <Html key={p.name} position={raised(pos)} center zIndexRange={[16,0]}><button type="button" className={`paper-point-label${bad?" paper-mismatch-pulse":""}`} style={{borderColor:bad?C.mismatch:C.target}} aria-label={`장면에서 ${p.name} 선택`} aria-pressed={selected(p.name)} onClick={()=>selectPaperPoint(p.name,"scene")}>{p.name}{selected(p.name)&&value&&validPaperPoint(value)&&<small>{last?.dashed?"예측":"관측"} ({Math.round(value.x*100)/100}, {Math.round(value.y*100)/100}) mm</small>}</button></Html>;})}
    {mismatch.map(label=>{const target=series[0]?.points.find(p=>p.label===label),observed=data.run?.observations.find(p=>p.point===label);return target&&validPaperPoint(target)&&observed?<Line key={label} points={[wp(target),wp(observed.pose)]} color={C.mismatch} lineWidth={4} depthTest={false}/>:null;})}
    {references.map(r=>{
      const sample=data.samples.find(s=>s.point===r.name);
      const p=frame?raised(paperPoint(frame,r.x,r.y)):sample?shapeWorldPoint({...sample.pose,z:sample.pose.z+2}):raised(paperPoint(null,r.x,r.y));
      return <group key={r.name}><mesh position={p}><sphereGeometry args={[3,12,8]}/><meshBasicMaterial color={C.reference} depthTest={false}/></mesh><Html position={p} zIndexRange={[15,0]}><button key={sample?.capturedAt??r.name} type="button" className={`paper-reference-label${sample?" paper-mismatch-pulse":""}`} aria-label={`장면에서 ${r.name} 기준점 선택`} aria-pressed={reference===r.name} onClick={()=>selectPaperPoint(r.name,"scene")}>{r.name}{sample?" ✓":" ?"}</button></Html></group>;
    })}
    <Html position={raised(paperPoint(frame,20,0))} zIndexRange={[14,0]}><span className="paper-axis-label">종이 x+ · 20 cm</span></Html>
    <Html position={raised(paperPoint(frame,0,20))} zIndexRange={[14,0]}><span className="paper-axis-label">종이 y+ · 20 cm</span></Html>
    {!frame&&<Html position={raised(center)} center><b className="paper-unknown">위치 미확인<br/><small>배치 예시 · O/X/Y 기록 필요</small></b></Html>}
    {/* World-aligned robot axes outside the sheet; independent of paper rotation. */}
    <Line points={[[centerWorld[0]-160,centerWorld[1]+4,centerWorld[2]+145],[centerWorld[0]-100,centerWorld[1]+4,centerWorld[2]+145]]} color={C.reference} lineWidth={2}/>
    <Line points={[[centerWorld[0]-160,centerWorld[1]+4,centerWorld[2]+145],[centerWorld[0]-160,centerWorld[1]+4,centerWorld[2]+85]]} color={C.reference} lineWidth={2}/>
    <Html position={[centerWorld[0]-100,centerWorld[1]+4,centerWorld[2]+145]}><span className="paper-axis-label">로봇 X+</span></Html>
    <Html position={[centerWorld[0]-160,centerWorld[1]+4,centerWorld[2]+85]}><span className="paper-axis-label">로봇 Y+</span></Html>
  </group>;
}

/** Top-down robot XY view. The paper axes rotate with the same measured basis as 3D. */
export function PaperSceneMap({fallback=false}:{fallback?:boolean}){
  const {data,point,reference,phase}=usePaperScene();if(!data)return null;
  const frame=data.frame, corners=paperCorners(frame),series=paperSceneSeries(data,phase),mismatch=paperMismatchPoints(data,series);
  const all=[...corners,...series.flatMap(s=>s.points.filter(validPaperPoint))];
  const minX=Math.min(...all.map(p=>p.x)),maxX=Math.max(...all.map(p=>p.x)),minY=Math.min(...all.map(p=>p.y)),maxY=Math.max(...all.map(p=>p.y));
  const scale=260/Math.max(maxX-minX,maxY-minY,200);
  const xy=(p:{x:number;y:number})=>({x:65+(p.x-minX)*scale,y:295-(p.y-minY)*scale});
  const path=(pts:{x:number;y:number}[])=>pts.map(p=>{const q=xy(p);return `${q.x},${q.y}`;}).join(" ");
  const choose=(name:string)=>selectPaperPoint(name);
  return <section className="paper-scene-map" aria-label={fallback?"3D 미지원 · 종이 좌표 대체 도면":"도봇과 맞춰 보는 종이 도면"} data-frame={frame?.id??"unknown"}>
    <header><b>{fallback?"3D 미지원 · 좌표 도면":frame?"도봇과 같은 종이 · 위에서 보기":"종이 좌표 예시 · 위치 미확인"}</b><span>20×20 cm · 눈금 1 cm</span></header>
    <svg viewBox="0 0 410 350" role="group" aria-label="종이 좌표와 로봇 좌표를 구분한 도면">
      <polygon points={path(corners)} fill="#f8fafc" stroke={C.reference} opacity={frame?1:.4}/>
      {paperGrid(frame).map((l,i)=><polyline key={i} points={path(l)} fill="none" stroke="#cbd5e1" strokeWidth={i%10===0?1.2:.6}/ >)}
      {series.map(s=><g key={s.label} data-paper-series={s.label}>
        {paperSeriesSegments(s.points).map((segment,i)=><polyline key={i} points={path(segment)} fill="none" stroke={s.color} strokeWidth="2.4" strokeDasharray={s.dashed?"5 4":undefined}/>)}
        {s.points.filter(validPaperPoint).map(p=>{const q=xy(p);return <circle key={p.label} cx={q.x} cy={q.y} r="3.5" fill={s.color}/>;})}
      </g>)}
      {data.targetPoints.map(p=>{const q=xy(paperPoint(frame,p.xCm,p.yCm)),bad=mismatch.includes(p.name);return <g key={p.name} role="button" tabIndex={0} aria-label={`도면에서 ${p.name} 선택`} aria-pressed={!reference&&point===Number(p.name.slice(1))-1} onClick={()=>choose(p.name)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();choose(p.name);}}} className={bad?"paper-mismatch-pulse":""}>
        <rect x={q.x-12} y={q.y-26} width="48" height="40" fill="transparent"/><circle cx={q.x} cy={q.y} r="9" fill="white" fillOpacity=".8" stroke={bad?C.mismatch:C.target} strokeWidth={!reference&&point===Number(p.name.slice(1))-1?3:1.5}/><text x={q.x+12} y={q.y-10} fill={C.target} fontSize="13" fontWeight="700">{p.name}</text></g>;})}
      {mismatch.map(label=>{const a=series[0]?.points.find(p=>p.label===label),b=data.run?.observations.find(p=>p.point===label);return a&&validPaperPoint(a)&&b?<polyline key={label} points={path([a,b.pose])} stroke={C.mismatch} strokeWidth="3"/>:null;})}
      {references.map(r=>{const p=xy(paperPoint(frame,r.x,r.y)),saved=data.samples.some(s=>s.point===r.name);return <g key={r.name} role="button" tabIndex={0} aria-label={`도면에서 ${r.name} 기준점 선택`} onClick={()=>choose(r.name)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();choose(r.name);}}}><rect x={p.x-10} y={p.y+12} width="35" height="20" rx="4" fill={reference===r.name?"#dbeafe":"#f1f5f9"} stroke={C.reference}/><text x={p.x-7} y={p.y+26} fontSize="12" fill={C.reference}>{r.name}{saved?" ✓":" ?"}</text></g>;})}
      {[[20,0,"종이 x+"],[0,20,"종이 y+"]].map(([x,y,label])=>{const q=xy(paperPoint(frame,Number(x),Number(y)));return <text key={label} x={q.x-20} y={q.y-15} fontSize="12" fill={C.reference}>{label}</text>;})}
      <path d="M345 325 h42 m-5 -4 l5 4 -5 4 M345 325 v-42 m-4 5 l4 -5 4 5" fill="none" stroke={C.reference}/><text x="345" y="345" fontSize="11" fill={C.reference}>{frame?"로봇 X+ →":"종이 x+ →"}</text><text x="340" y="273" fontSize="11" fill={C.reference}>{frame?"로봇 Y+ ↑":"종이 y+ ↑"}</text>
    </svg>
    <PaperSceneLegend/>
    <p>{frame?`${paperFrameSource(data)} · O→X / O→Y를 기준으로 배치`:`위치 미확인 · 기록 ${data.samples.length}/3. 그림은 종이 좌표 예시이며 실제 배치를 뜻하지 않습니다.`}</p>
    <div className="paper-point-picker">{data.targetPoints.map(p=><button key={p.name} type="button" aria-pressed={!reference&&point===Number(p.name.slice(1))-1} onClick={()=>choose(p.name)}>{p.name}</button>)}<span>점을 선택하면 양쪽에서 강조됩니다.</span></div>
    {!data.revisionJourney&&<p>보라 점선은 입력 중 예측입니다. 실행 전에는 정답 로봇 좌표·오차 수치를 표시하지 않습니다.</p>}
    {data.revisionJourney?.conditionsChanged&&<p>기준점·목표가 바뀌어 이전 실행을 현재 종이에 겹치지 않습니다.</p>}
  </section>;
}
