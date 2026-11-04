import { useMemo, useState } from "react";
import { Html, Line } from "@react-three/drei";
import { DoubleSide } from "three";
import { CoordinateStudyCamera } from "./CoordinateStudyCamera";
import { shapeWorldPoint } from "./shapeKinematics";
import { PAPER_COLORS as C, paperCorners, paperGrid, paperMismatchPoints, paperPoint, paperFrameAngleDegrees, paperSceneLiveModel, paperSceneLivePredictions, paperSceneReadout, paperSceneRotation, paperSceneSeries, paperSeriesSegments, paperFrameSource, paperSceneSourceText, validPaperPoint, type PaperScenePoint } from "./paperSceneModel";
import { navigatePaperScene, requestPaperCamera, selectPaperPoint, usePaperScene } from "./paperSceneStore";
import { paperV6EquationTerms } from "./paperV6Model";
import { PAPER_HARDWARE_V6_VERSION, PAPER_V6_MOCK_ORIGIN } from "./paperCoordinateStudy";
import "./paperScene.css";

const references=[{name:"O",x:0,y:0},{name:"X",x:10,y:0},{name:"Y",x:0,y:10}];
type SceneData=NonNullable<ReturnType<typeof usePaperScene>["data"]>;
const isV6Scene=(data:SceneData|null)=>data?.activeAttempt?.taskVersion===PAPER_HARDWARE_V6_VERSION;
/** Student scene (1–5) from saved lesson state only (display, never a gate). */
export function paperLoopPosition(data:SceneData):number{
  const stage=data.activeAttempt?.stage??data.stage;
  if(data.running)return 3;
  return stage<=2?1:stage<=4?2:stage===5?3:stage===6?4:5;
}
const STEPS=["기준점 측정","변환식 예측","로봇 실행","비교 · AI 질문","모델 판단 · 검증"];
/** v6: the measured θ is what the student computes in step 2, so it stays hidden until a prediction is saved. */
function paperThetaRevealed(data:SceneData):boolean{return !isV6Scene(data)||!!data.activeAttempt?.planHash;}
function stepValue(data:SceneData,step:number):string{
  const a=data.activeAttempt,ev=data.diagnosis?.taskEvidence??[];
  const worst=ev.reduce((m,e)=>Math.max(m,e.distance),0);
  if(step===1){const measured=paperFrameAngleDegrees(data.frame);return measured===null||!paperThetaRevealed(data)?`O·X·Y ${data.samples.length}/3`:`종이 θ ${measured.toFixed(1)}°`;}
  if(step===2){const m=a?.v6?.model;return m?`내 θ ${m.thetaDeg.toFixed(1)}°`:"";}
  if(step===3)return data.running?"그리는 중…":data.run?.status==="completed"?`${data.run.observations.length}점 완료`:"";
  if(step===4)return ev.length?`차이 ${worst.toFixed(1)} mm`:"";
  return a?.v6?.decision==="revise"?"식 수정":a?.v6?.decision==="retain"?"식 유지":"";
}
/** Screen ⇄ bridge ⇄ controller: the same buttons drive DT, the mock controller or the MG400. */
function PaperLinkPath({data}:{data:SceneData}){
  const source=data.displaySource;
  const live=source==="hardware"||source==="mock";
  const device=source==="hardware"?"MG400":source==="mock"?"연습 로봇":"MG400 미연결";
  const tip=data.displayPose;
  return <div className="paper-link-path" data-source={source??"dt"} data-testid="paper-link-path" aria-label="장비 연결 경로">
    <span className="is-on">화면</span><i aria-hidden="true">⇄</i>
    <span className={live?"is-on":""}>{device}</span>
    <em className={live?"is-live":""}>{live?"●":"○"} 펜 끝 {tip?`(${tip.x.toFixed(0)}, ${tip.y.toFixed(0)})`:"—"}</em>
  </div>;
}
function PaperLoopRing({data}:{data:SceneData}){
  const current=paperLoopPosition(data),attempt=data.activeAttempt?.attempt??1;
  return <ol className="paper-loop-ring" aria-label="학습 단계" data-testid="paper-loop-ring">
    {STEPS.map((label,index)=>{const step=index+1,value=stepValue(data,step);return <li key={label} className={step===current?"is-current":step<current?"is-done":""} data-current={step===current}>
      {step<current&&!data.running
        ?<button type="button" className="paper-loop-ring__back" onClick={()=>navigatePaperScene(step)} title={`${label} 단계로 돌아가기`} data-testid={`paper-loop-back-${step}`}><b><span aria-hidden="true">✓</span>{label}</b>{value&&<small>{value}</small>}</button>
        :<><b><span aria-hidden="true">{step<current?"✓":step}</span>{label}</b>{value&&<small>{value}</small>}</>}
    </li>;})}
    <li className="paper-loop-ring__again" aria-label={`${attempt}회차`}>↻ {attempt}회차</li>
  </ol>;
}
export function PaperSceneLegend(){
  const entries=[
    {label:"O·X·Y 기준점",color:C.reference},
    {label:"목표점 · P표식",color:C.target},
    {label:"학생 예측 · 점선",color:C.prediction,dashed:true},
    {label:"첫 실행 · 1",color:C.first},
    {label:"재실행 · 2",color:C.result},
    {label:"불일치 근거",color:C.mismatch},
    {label:"DT 고스트 로봇 · 실측 아님",color:C.robotPreview,outline:C.robotOutline,robot:true},
  ];
  return <div className="paper-scene-legend" aria-label="종이와 도봇 공통 범례">{entries.map(entry=><span key={entry.label}><i className={entry.robot?"paper-legend-robot":undefined} style={entry.robot?{borderColor:entry.outline,backgroundColor:entry.color}:{borderColor:entry.color,borderTopStyle:entry.dashed?"dashed":"solid"}}/>{entry.label}</span>)}</div>;
}
export function PaperSceneToolbar(){
  const {data}=usePaperScene();if(!data)return null;
  if(isV6Scene(data))return <div className="paper-scene-toolbar paper-scene-toolbar--v6" data-v6="true">
    <PaperLoopRing data={data}/>
    <PaperLinkPath data={data}/>
    <button type="button" onClick={requestPaperCamera}>↺ 시점</button>
  </div>;
  const measured=data.displaySource==="hardware"||data.displaySource==="mock";
  return <div className="paper-scene-toolbar"><span>{data.frame?"종이 10×10 cm · 1 cm 눈금":"위치 미확인 · 반투명 종이는 배치 예시"}<small>{measured?"원래 색: 현재 보고 위치":"원래 색: 현재 위치 고정 · 파란 고스트: DT 예측 이동 · 실측 아님"}</small></span><button type="button" onClick={requestPaperCamera}>↺ 종이 시점</button></div>;
}
export function PaperSceneCaption(){
  const {data,point,reference,phase,robotDisplay}=usePaperScene();if(!data)return null;
  if(isV6Scene(data))return null;
  const readout=paperSceneReadout(data,phase,point,reference),number=(value:number)=>Number.isFinite(value)?(Math.round(value*100)/100).toFixed(2):"—";
  const xy=(value:{x:number;y:number}|null)=>value?`X ${number(value.x)} · Y ${number(value.y)} mm`:"자료 없음";
  const pose=data.displayPose;
  const observed=readout.observation,referenceObservation=readout.referenceObservation;
  const runStatus=observed?.runStatus==="completed"?"완료된 실행":observed?.runStatus==="running"?"진행 중 · 부분 관측":"완료되지 않은 실행";
  return <div className="paper-scene-caption">
    <div className="paper-scene-readout" role="region" aria-label="장면 고정 정보">
      {robotDisplay.current&&pose&&<section className="paper-scene-readout__card paper-scene-readout__card--current" data-testid="paper-current-label">
        <h3>현재 위치 · 고정</h3>
        <b>X {number(pose.x)} · Y {number(pose.y)} · Z {number(pose.z)} mm · R {number(pose.r)}°</b>
        <small>고스트 이동 전 고정 위치 · DT 기준 · 실측 아님</small>
      </section>}
      {robotDisplay.preview&&<section className="paper-scene-readout__card paper-scene-readout__card--preview" data-testid="paper-preview-label">
        <h3>{data.running?"예측 이동 중":"예상 이동 위치"}</h3>
        <b>{readout.selectedName??"선택한 점"} · {xy(readout.prediction)}</b>
        <small>파란 고스트 · DT · 실측 아님</small>
      </section>}
      <section className="paper-scene-readout__card paper-scene-readout__card--point" aria-live="polite">
        <h3>{readout.selectedName?`${readout.selectedName} 상세`:"선택한 점"}</h3>
        {readout.selectedName?.startsWith("P")?<>
          <p><span>학생 예측</span><b>{xy(readout.prediction)}</b></p>
          <p><span>이번 실행 관측</span><b>{observed?xy(observed):"아직 없음"}</b></p>
          {observed&&<small>{paperSceneSourceText(observed.source)} · {runStatus}</small>}
        </>:referenceObservation?<>
          <p><span>기준점 좌표</span><b>{xy(referenceObservation)}</b></p>
          <small>{paperSceneSourceText(referenceObservation.source)}</small>
        </>:<small>도면이나 점 표식에서 P1–P4 또는 O/X/Y를 선택하세요.</small>}
      </section>
      <section className="paper-scene-readout__card paper-scene-readout__card--axes">
        <h3>회전 · 원점 · 축</h3>
        <b className="paper-scene-readout__angle" data-testid={readout.rotationDegrees===null?undefined:"paper-rotation-3d"}>
          {readout.rotationDegrees===null?"회전 자료 없음":`${readout.rotationDegrees.toFixed(1)}°`}
        </b>
        <small>{readout.rotationDegrees===null?"기록된 실행의 회전 판정이 있을 때 표시":"경로 · 종이 x축 기준"}</small>
        <p><strong>O</strong> 원점 · 종이 x+/y+ · 로봇 X+/Y+</p>
        <small>종이 축과 로봇 축 방향은 서로 다를 수 있습니다.</small>
      </section>
    </div>
    <PaperSceneLegend/>
    <small>{data.frame?`${paperFrameSource(data)} · 기록된 O→X / O→Y 방향`:`O/X/Y 기록 ${data.samples.length}/3 · 종이의 실제 위치·방향은 아직 미확인`}<br/>점 이름은 장면에, 좌표·회전·축 설명은 아래 고정 영역에 표시합니다. 선은 점 사이의 비교선이며 잉크 궤적이 아닙니다.</small>
  </div>;
}
/** Shared measured-frame geometry, placed at the recorded paper Z (never changes robot pose). */
export function PaperSceneOverlay(){
  const {data,point,reference,phase,cameraKey,formulaTerm}=usePaperScene();
  const frame=data?.frame??null;
  const displayPoint=(xCm:number,yCm:number):PaperScenePoint=>{
    if(frame)return paperPoint(frame,xCm,yCm);
    const angle=(28.6*Math.PI)/180,a=xCm*10,b=yCm*10;
    return {x:PAPER_V6_MOCK_ORIGIN.x+a*Math.cos(angle)-b*Math.sin(angle),y:PAPER_V6_MOCK_ORIGIN.y+a*Math.sin(angle)+b*Math.cos(angle),z:0};
  };
  const center=displayPoint(5,5);
  const position=(p:PaperScenePoint):[number,number,number]=>shapeWorldPoint(p);
  const centerWorld=position(center);
  const v6Scene=isV6Scene(data);
  // v6 keeps the whole MG400 and the sheet in frame: the robot is the point of the lesson.
  const baseWorld=position({x:0,y:0,z:center.z});
  const loopStep=v6Scene&&data?paperLoopPosition(data):0;
  const paperFocus=v6Scene&&loopStep>=2;
  const view=useMemo(()=>{
    // From step 2 the sheet is the subject: close, higher view centred on the paper (pen still in frame).
    if(paperFocus){const t=[centerWorld[0],centerWorld[1],centerWorld[2]] as const;return {position:[t[0]+40,t[1]+250,t[2]+150] as const,target:t};}
    if(!v6Scene)return {position:[centerWorld[0]-30,centerWorld[1]+480,centerWorld[2]+230] as const,target:[centerWorld[0]-30,centerWorld[1],centerWorld[2]] as const};
    // Known-good framing (whole MG400 with the sheet in front of it), pulled in a little.
    // Same angle, a little farther out (smaller robot) and aimed past the sheet so the robot sits further left.
    const t=[baseWorld[0]*0.1+centerWorld[0]*0.9+60,centerWorld[1]+50,baseWorld[2]*0.1+centerWorld[2]*0.9] as const;
    return {position:[t[0]+125,t[1]+475,t[2]+560] as const,target:t};
  },[frame?.id,v6Scene,paperFocus]);
  const corners=[[0,0],[10,0],[10,10],[0,10]].map(([x,y])=>displayPoint(x,y));
  const vertices=new Float32Array([0,1,2,0,2,3].flatMap(i=>position(corners[i])));
  if(!data)return null;
  // v6: the target square P1–P4 is the step-2 task; it appears once the student reaches step 2.
  const showTargets=!v6Scene||loopStep>=2;
  const thetaShown=paperThetaRevealed(data);
  const series=paperSceneSeries(data,phase).filter(s=>showTargets||s.label!=="목표점"),mismatch=paperMismatchPoints(data,series);
  const rotation=paperSceneRotation(data,series);
  const measuredAngle=paperFrameAngleDegrees(frame);
  const displayAngle=measuredAngle??28.6;
  const grid=Array.from({length:11},(_,i)=>[
    [displayPoint(i,0),displayPoint(i,10)],
    [displayPoint(0,i),displayPoint(10,i)],
  ]).flat();
  const raised=(p:PaperScenePoint):[number,number,number]=>{const v=position(p);return [v[0],v[1]+1.5,v[2]];};
  const wp=(p:{x:number;y:number})=>raised({...p,z:center.z});
  const selected=(label:string)=>reference?reference===label:point!==null&&`P${point+1}`===label;
  const liveModel=paperSceneLiveModel(data);
  const livePredictions=paperSceneLivePredictions(data);
  // v6: the student's own arithmetic comes first; coordinates appear on the sheet once the prediction is saved.
  const predictionSaved=!!data.activeAttempt?.planHash;
  // v6 step 2: show what a and b mean for the selected target (O → along paper x by a → along paper y by b).
  const abTarget=v6Scene&&loopStep===2&&frame?data.targetPoints[point??0]:null;
  const abCorner=abTarget?displayPoint(abTarget.xCm,0):null;
  const rulerTicks=v6Scene&&frame&&loopStep>=2?[0,2,4,6,8,10]:[];
  const firstTarget=data.targetPoints[0];
  const firstTerms=liveModel&&firstTarget?paperV6EquationTerms(firstTarget,liveModel):null;
  const livePoint=livePredictions[0];
  const livePose=livePoint?{x:Number(livePoint.robotX),y:Number(livePoint.robotY),z:Number(livePoint.robotZ??center.z)}:null;
  const origin=liveModel?{x:liveModel.originXmm,y:liveModel.originYmm,z:center.z}:null;
  const modelVectorSegments=origin&&firstTerms?[
    {id:"aCos",a:origin,b:{x:origin.x+firstTerms.aCos,y:origin.y,z:origin.z},color:"#db2777"},
    {id:"bSin",a:{x:origin.x+firstTerms.aCos,y:origin.y,z:origin.z},b:{x:origin.x+firstTerms.aCos-firstTerms.bSin,y:origin.y,z:origin.z},color:"#ea580c"},
    {id:"aSin",a:{x:origin.x+firstTerms.aCos-firstTerms.bSin,y:origin.y,z:origin.z},b:{x:origin.x+firstTerms.aCos-firstTerms.bSin,y:origin.y+firstTerms.aSin,z:origin.z},color:"#7c3aed"},
    {id:"bCos",a:{x:origin.x+firstTerms.aCos-firstTerms.bSin,y:origin.y+firstTerms.aSin,z:origin.z},b:{x:origin.x+firstTerms.aCos-firstTerms.bSin,y:origin.y+firstTerms.aSin+firstTerms.bCos,z:origin.z},color:"#0891b2"},
  ]:[];
  const arc=(originPoint:PaperScenePoint,degrees:number,radius=20)=>{
    const radians=(degrees*Math.PI)/180;
    return Array.from({length:13},(_,i)=>{const a=radians*i/12;return {x:originPoint.x+radius*Math.cos(a),y:originPoint.y+radius*Math.sin(a),z:originPoint.z};});
  };
  const frameOrigin=displayPoint(0,0);
  const frameArc=arc(frameOrigin,displayAngle);
  const studentArc=origin?arc(origin,liveModel!.thetaDeg):[];
  const evidence=data.diagnosis?.taskEvidence??[];
  const worst=evidence.reduce<(typeof evidence)[number]|null>((best,item)=>!best||item.distance>best.distance?item:best,null);
  const latestAi=data.activeAttempt?.aiAnalyses?.filter(item=>item.runId===data.run?.id&&!!item.displayedAt).at(-1);
  const aiAnchor=worst?data.run?.observations.find(item=>item.point===worst.point)?.pose:null;
  // Ink is what the pen physically left on the sheet (student ruler reading or mock ink), never the TCP report.
  const inkMarks=(data.activeAttempt?.inkReadings??[])
    .filter(r=>r.runId===data.run?.id&&r.status==="measured"&&r.xCm!==null&&r.yCm!==null)
    .map(r=>({point:r.point,world:position(displayPoint(r.xCm!,r.yCm!))}));
  return <group name="measured-paper-sheet">
    <CoordinateStudyCamera requestKey={cameraKey} preset="free" view={view} minimumAspect={v6Scene&&!paperFocus?1.8:1.05}/>
    <mesh renderOrder={5}><bufferGeometry><bufferAttribute attach="attributes-position" args={[vertices,3]}/></bufferGeometry><meshBasicMaterial color="#ffffff" transparent opacity={frame ? .9 : v6Scene ? .78 : .23} side={DoubleSide} depthWrite={false}/></mesh>
    {v6Scene&&<Line points={[...corners,corners[0]].map(raised)} color={frame?"#334155":"#64748b"} lineWidth={frame?2.2:1.6} dashed={!frame} dashSize={6} gapSize={4} depthTest={false} renderOrder={6}/>}
    {grid.map((line,i)=><Line key={i} points={line.map(raised)} color={i%2===0?"#cbd5e1":"#94a3b8"} lineWidth={i%2===0?.55:1} transparent opacity={frame ? .75 : v6Scene ? .6 : .2}/>)}
    <Line points={[...corners,corners[0]].map(raised)} color={C.reference} lineWidth={2} dashed={!frame}/>
    {frameArc.length>1&&<group name="paper-measured-x-axis">
      <Line points={[position(frameOrigin),position(displayPoint(2,0))]} color="#0f766e" lineWidth={3} depthTest={false} renderOrder={219}/>
      <Line points={[position(frameOrigin),position(displayPoint(0,2))]} color="#0284c7" lineWidth={3} depthTest={false} renderOrder={219}/>
      {thetaShown&&<Line points={frameArc.map(raised)} color={measuredAngle===null?"#94a3b8":"#f59e0b"} lineWidth={measuredAngle===null?2:3} dashed={measuredAngle===null} depthTest={false} renderOrder={220}/>}
      {(!v6Scene||frame)&&<>
      {rulerTicks.length===0&&<>
      <Html position={raised(displayPoint(2,0))} zIndexRange={[20,0]}><span className="paper-axis-tag paper-axis-tag--x">종이 x+</span></Html>
      <Html position={raised(displayPoint(0,2))} zIndexRange={[20,0]}><span className="paper-axis-tag paper-axis-tag--y">종이 y+</span></Html>
      </>}
      {thetaShown&&<Html position={raised(frameOrigin)} zIndexRange={[20,0]}><span className="paper-angle-tag">{measuredAngle===null?"예시 θ 28.6°":`측정 θ ${measuredAngle.toFixed(1)}°`}</span></Html>}
      </>}
    </group>}
    {rotation&&<Line points={rotation.arc.map(raised)} color="#b45309" lineWidth={3} depthTest={false} renderOrder={220}/>}
    {series.map(s=><group key={s.label}>
      {paperSeriesSegments(s.points).map((segment,i)=><Line key={i} points={segment.map(wp)} color={s.color} lineWidth={s.label==="목표점"?2:3} dashed={s.dashed} dashSize={5} gapSize={4} transparent depthTest={false} renderOrder={200}/>)}
      {s.points.filter(validPaperPoint).map(p=><mesh key={p.label} position={wp(p)} renderOrder={210}><sphereGeometry args={[s.label==="목표점"?3.8:2.7,12,8]}/><meshBasicMaterial color={s.color} transparent depthTest={false}/></mesh>)}
    </group>)}
    {frame&&showTargets&&data.targetPoints.map(p=>{const pos=displayPoint(p.xCm,p.yCm),bad=mismatch.includes(p.name);return <Html key={p.name} position={raised(pos)} center zIndexRange={[16,0]}><button type="button" data-point={p.name} className={`paper-point-label${bad?" paper-mismatch-pulse":""}`} style={{borderColor:bad?C.mismatch:C.target}} aria-label={`장면에서 ${p.name} 선택`} aria-pressed={selected(p.name)} onClick={()=>selectPaperPoint(p.name,"scene")}>{p.name}</button></Html>;})}
    {!frame&&!v6Scene&&data.targetPoints.map(p=>{const pos=displayPoint(p.xCm,p.yCm);return <Html key={`example-${p.name}`} position={raised(pos)} center zIndexRange={[14,0]}><span className="paper-point-label paper-point-label--example">{p.name}</span></Html>;})}
    {mismatch.map(label=>{const target=series[0]?.points.find(p=>p.label===label),observed=data.run?.observations.find(p=>p.point===label);return target&&validPaperPoint(target)&&observed?<Line key={label} points={[wp(target),wp(observed.pose)]} color={C.mismatch} lineWidth={4} transparent depthTest={false} renderOrder={215}/>:null;})}
    {rulerTicks.map(cm=><Html key={`rx-${cm}`} position={raised(displayPoint(cm,-0.9))} center zIndexRange={[12,0]}><span className="paper-ruler-tick">{cm}</span></Html>)}
    {rulerTicks.length>0&&<Html position={raised(displayPoint(-0.9,11.4))} center zIndexRange={[12,0]}><span className="paper-ruler-tick paper-ruler-tick--unit">종이 y (cm)</span></Html>}
    {rulerTicks.filter(cm=>cm>0).map(cm=><Html key={`ry-${cm}`} position={raised(displayPoint(-0.9,cm))} center zIndexRange={[12,0]}><span className="paper-ruler-tick">{cm}</span></Html>)}
    {rulerTicks.length>0&&<Html position={raised(displayPoint(11.2,-0.9))} center zIndexRange={[12,0]}><span className="paper-ruler-tick paper-ruler-tick--unit">종이 x (cm)</span></Html>}
    {abTarget&&abCorner&&<group name="paper-ab-legs">
      <Line points={[raised(displayPoint(0,0)),raised(abCorner)]} color="#db2777" lineWidth={4} depthTest={false} renderOrder={224}/>
      <Line points={[raised(abCorner),raised(displayPoint(abTarget.xCm,abTarget.yCm))]} color="#0891b2" lineWidth={4} depthTest={false} renderOrder={224}/>
      <Html position={raised(displayPoint(abTarget.xCm/2,-2.1))} center zIndexRange={[27,0]}><span className="paper-ab-tag paper-ab-tag--a">a = {abTarget.xCm*10} mm</span></Html>
      <Html position={raised(displayPoint(abTarget.xCm+1.8,Math.max(abTarget.yCm/2,1.2)))} center zIndexRange={[27,0]}><span className="paper-ab-tag paper-ab-tag--b">b = {abTarget.yCm*10} mm</span></Html>
    </group>}
    {references.map(r=>{
       const sample=data.samples.find(s=>s.point===r.name);
       const p=frame?raised(displayPoint(r.x,r.y)):sample?shapeWorldPoint({...sample.pose,z:sample.pose.z+2}):raised(displayPoint(r.x,r.y));
       return <group key={r.name}><mesh position={p}><sphereGeometry args={[sample?4:3,12,8]}/><meshBasicMaterial color={sample?.source==="mock"?C.robotPreview:C.reference} depthTest={false}/></mesh><Html position={p} zIndexRange={[15,0]}><button type="button" className="paper-reference-label" aria-label={`장면에서 ${r.name} 기준점 선택`} aria-pressed={reference===r.name} onClick={()=>selectPaperPoint(r.name,"scene")}>{r.name}{v6Scene&&sample?` (${sample.pose.x.toFixed(0)}, ${sample.pose.y.toFixed(0)})`:""}</button></Html></group>;
    })}
    {data.displayPose&&<group>
      <mesh position={position({x:data.displayPose.x,y:data.displayPose.y,z:data.displayPose.z+3})} renderOrder={230}><sphereGeometry args={[4.5,16,12]}/><meshBasicMaterial color={data.displaySource==="mock"?C.robotPreview:C.reference} transparent opacity={.9} depthTest={false}/></mesh>
      {data.displaySource==="mock"&&<Html position={position({x:data.displayPose.x,y:data.displayPose.y,z:data.displayPose.z+8})} zIndexRange={[24,0]}><span className="paper-robot-tip-tag">연습 펜 끝</span></Html>}
    </group>}
    {v6Scene&&livePredictions.slice(1).map(prediction=>{const x=Number(prediction.robotX),y=Number(prediction.robotY);if(!Number.isFinite(x)||!Number.isFinite(y))return null;return <group key={`ghost-${prediction.name}`} name="student-equation-ghost-point">
      <mesh position={position({x,y,z:center.z+3})} renderOrder={229}><sphereGeometry args={[3.6,14,10]}/><meshBasicMaterial color={C.robotPreview} transparent opacity={.85} depthTest={false}/></mesh>
      <Html position={position({x,y,z:center.z+8})} zIndexRange={[25,0]}><span className="paper-robot-tip-tag paper-robot-tip-tag--soft">{prediction.name}{predictionSaved?` (${x.toFixed(0)}, ${y.toFixed(0)})`:""}</span></Html>
    </group>;})}
    {livePose&&<group name="student-equation-ghost">
      <Line points={[raised(displayPoint(firstTarget.xCm,firstTarget.yCm)),raised({x:livePose.x,y:livePose.y,z:livePose.z})]} color={C.robotPreview} lineWidth={2} dashed depthTest={false} renderOrder={226}/>
      <mesh position={position({x:livePose.x,y:livePose.y,z:livePose.z+4})} renderOrder={230}><sphereGeometry args={[5,16,12]}/><meshBasicMaterial color={C.robotPreview} transparent opacity={.9} depthTest={false}/></mesh>
      <Html position={position({x:livePose.x,y:livePose.y,z:livePose.z+10})} zIndexRange={[26,0]}><span className="paper-robot-tip-tag">내 식 · {livePoint?.name}{v6Scene&&predictionSaved?` (${livePose.x.toFixed(0)}, ${livePose.y.toFixed(0)})`:""}</span></Html>
    </group>}
    {origin&&<group name="student-origin-and-components">
      <Line points={[position({x:0,y:0,z:origin.z}),position(origin)]} color={formulaTerm==="originX"||formulaTerm==="originY"?"#7c3aed":"#a78bfa"} lineWidth={formulaTerm?.startsWith("origin")?4:2} dashed depthTest={false} renderOrder={217}/>
      {studentArc.length>1&&<Line points={studentArc.map(raised)} color="#7c3aed" lineWidth={formulaTerm==="theta"?4:2} transparent depthTest={false} renderOrder={221}/>}
      {modelVectorSegments.map(segment=><Line key={segment.id} points={[position(segment.a),position(segment.b)]} color={segment.color} lineWidth={formulaTerm===segment.id?5:formulaTerm?1.5:2.3} transparent opacity={formulaTerm&&formulaTerm!==segment.id?0.25:1} depthTest={false} renderOrder={218}/>)}
      <Html position={position(origin)} zIndexRange={[22,0]}><span className="paper-origin-tag">O · {liveModel?.thetaDeg.toFixed(1)}°</span></Html>
    </group>}
    {worst&&latestAi?.question&&aiAnchor&&<group name="ai-question-anchor">
      <Line points={[position(aiAnchor),position({x:aiAnchor.x+28,y:aiAnchor.y+24,z:aiAnchor.z+3})]} color="#7c3aed" lineWidth={2} dashed depthTest={false} renderOrder={232}/>
      <Html position={position({x:aiAnchor.x+28,y:aiAnchor.y+24,z:aiAnchor.z+4})} zIndexRange={[30,0]}><span className="paper-ai-anchor">AI · {latestAi.question.slice(0,76)}</span></Html>
    </group>}
    {frame&&inkMarks.map(mark=><group key={`ink-${mark.point}`} name="paper-ink-mark">
      <mesh position={[mark.world[0],mark.world[1]+1.6,mark.world[2]]} rotation={[-Math.PI/2,0,0]} renderOrder={212}><circleGeometry args={[2.2,20]}/><meshBasicMaterial color="#1e3a8a" transparent opacity={.92} depthTest={false}/></mesh>
    </group>)}
    {frame&&inkMarks.length>1&&<Line points={inkMarks.map(mark=>[mark.world[0],mark.world[1]+1.4,mark.world[2]] as [number,number,number])} color="#1e3a8a" lineWidth={1} dashed dashSize={2} gapSize={3} transparent opacity={.45} depthTest={false} renderOrder={211}/>}
    {!frame&&!v6Scene&&<Html position={raised(center)} center><b className="paper-unknown">배치 예시<br/><small>비스듬한 종이 · 아직 실측 전</small></b></Html>}

  </group>;
}

/** Top-down robot XY view. The paper axes rotate with the same measured basis as 3D. */
export function PaperSceneMap({fallback=false,compact=false}:{fallback?:boolean;compact?:boolean}){
  const [expanded,setExpanded]=useState(false);
  const {data,point,reference,phase}=usePaperScene();if(!data)return null;
  const frame=data.frame, corners=paperCorners(frame),series=paperSceneSeries(data,phase),mismatch=paperMismatchPoints(data,series);
  const rotation=paperSceneRotation(data,series);
  const all=[...corners,...series.flatMap(s=>s.points.filter(validPaperPoint))];
  const minX=Math.min(...all.map(p=>p.x)),maxX=Math.max(...all.map(p=>p.x)),minY=Math.min(...all.map(p=>p.y)),maxY=Math.max(...all.map(p=>p.y));
  const scale=260/Math.max(maxX-minX,maxY-minY,200);
  const xy=(p:{x:number;y:number})=>({x:65+(p.x-minX)*scale,y:295-(p.y-minY)*scale});
  const path=(pts:{x:number;y:number}[])=>pts.map(p=>{const q=xy(p);return `${q.x},${q.y}`;}).join(" ");
  const choose=(name:string)=>selectPaperPoint(name);
  const selectedName=reference??(point===null?null:`P${point+1}`);
  return <section className={`paper-scene-map${compact?expanded?" paper-scene-map--expanded":" paper-scene-map--compact":""}`} aria-label={fallback?"3D 미지원 · 종이 좌표 대체 도면":"도봇과 맞춰 보는 종이 도면"} data-frame={frame?.id??"unknown"}>
    <header><b>{fallback?"3D 미지원 · 좌표 도면":frame?"도봇과 같은 종이 · 위에서 보기":"종이 좌표 예시 · 위치 미확인"}</b><span>10×10 cm · 눈금 1 cm</span>{compact&&<button type="button" className="paper-map-expand" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?"접기":"크게 보기"}</button>}</header>
    <svg viewBox="0 0 410 350" role="group" aria-label="종이 좌표와 로봇 좌표를 구분한 도면">
      <polygon points={path(corners)} fill="#f8fafc" stroke={C.reference} opacity={frame?1:.4}/>
      {paperGrid(frame).map((l,i)=><polyline key={i} points={path(l)} fill="none" stroke="#cbd5e1" strokeWidth={i%10===0?1.2:.6}/ >)}
      {series.map(s=><g key={s.label} data-paper-series={s.label}>
        {paperSeriesSegments(s.points).map((segment,i)=><polyline key={i} points={path(segment)} fill="none" stroke={s.color} strokeWidth="2.4" strokeDasharray={s.dashed?"5 4":undefined}/>)}
        {s.points.filter(validPaperPoint).map(p=>{const q=xy(p);return <circle key={p.label} cx={q.x} cy={q.y} r="3.5" fill={s.color}/>;})}
      </g>)}
      {rotation&&<g data-testid="paper-rotation-map"><polyline points={path(rotation.arc)} fill="none" stroke="#b45309" strokeWidth="3"/><text x={xy(rotation.label).x} y={xy(rotation.label).y} fontSize="18" fill="#92400e" fontWeight="800">{rotation.relativeAngle.toFixed(1)}°</text></g>}
      {data.targetPoints.map(p=>{const q=xy(paperPoint(frame,p.xCm,p.yCm)),bad=mismatch.includes(p.name),active=selectedName===p.name;return <g key={p.name} role="button" tabIndex={0} aria-label={`도면에서 ${p.name} 선택`} aria-pressed={active} onClick={()=>choose(p.name)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();choose(p.name);}}} className={bad?"paper-mismatch-pulse":""}>
        <rect x={q.x-18} y={q.y-30} width="68" height="50" fill="transparent"/>
        {active&&<circle className="paper-selection-halo" cx={q.x} cy={q.y} r="18" fill="#ede9fe" fillOpacity=".8" stroke="#7c3aed" strokeWidth="3"/>}
        <circle cx={q.x} cy={q.y} r={active?10:7} fill={active?C.target:"white"} fillOpacity=".9" stroke={bad?C.mismatch:C.target} strokeWidth={active?3:1.5}/>
        {active&&<rect x={q.x+16} y={q.y-32} width="42" height="25" rx="5" fill="#5b21b6"/>}
        <text x={q.x+(active?20:12)} y={q.y-(active?13:10)} fill={active?"white":C.target} fontSize={compact||active?19:15} fontWeight="800">{p.name}</text></g>;})}
      {mismatch.map(label=>{const a=series[0]?.points.find(p=>p.label===label),b=data.run?.observations.find(p=>p.point===label);return a&&validPaperPoint(a)&&b?<polyline key={label} points={path([a,b.pose])} stroke={C.mismatch} strokeWidth="3"/>:null;})}
      {references.map(r=>{const p=xy(paperPoint(frame,r.x,r.y)),saved=data.samples.some(s=>s.point===r.name);return <g key={r.name} role="button" tabIndex={0} aria-label={`도면에서 ${r.name} 기준점 선택`} onClick={()=>choose(r.name)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();choose(r.name);}}}><rect x={p.x-10} y={p.y+12} width="35" height="20" rx="4" fill={reference===r.name?"#dbeafe":"#f1f5f9"} stroke={C.reference}/><text x={p.x-7} y={p.y+26} fontSize="12" fill={C.reference}>{r.name}{saved?" ✓":" ?"}</text></g>;})}
      {[[20,0,"종이 x+"],[0,20,"종이 y+"]].map(([x,y,label])=>{const q=xy(paperPoint(frame,Number(x),Number(y)));return <text key={label} x={q.x-20} y={q.y-15} fontSize="12" fill={C.reference}>{label}</text>;})}
      <path d="M345 325 h42 m-5 -4 l5 4 -5 4 M345 325 v-42 m-4 5 l4 -5 4 5" fill="none" stroke={C.reference}/><text x="345" y="345" fontSize="11" fill={C.reference}>{frame?"로봇 X+ →":"종이 x+ →"}</text><text x="340" y="273" fontSize="11" fill={C.reference}>{frame?"로봇 Y+ ↑":"종이 y+ ↑"}</text>
    </svg>
    <div className="paper-selection-summary" role="status">{selectedName?<><strong>{selectedName} 선택</strong><span>도봇·도면·입력 칸 함께 강조</span></>:<span>점을 선택해 양쪽 위치를 확인하세요.</span>}</div>
    <PaperSceneLegend/>
    <p>{frame?`${paperFrameSource(data)} · O→X / O→Y를 기준으로 배치`:`위치 미확인 · 기록 ${data.samples.length}/3. 그림은 종이 좌표 예시이며 실제 배치를 뜻하지 않습니다.`}</p>
    <div className="paper-point-picker">{data.targetPoints.map(p=><button key={p.name} type="button" aria-pressed={selectedName===p.name} onClick={()=>choose(p.name)}>{p.name}</button>)}</div>
    {!data.revisionJourney&&<p>보라 점선은 입력 중 예측입니다. 실행 전에는 정답 로봇 좌표·오차 수치를 표시하지 않습니다.</p>}
    {data.revisionJourney?.conditionsChanged&&<p>기준점·목표가 바뀌어 이전 실행을 현재 종이에 겹치지 않습니다.</p>}
  </section>;
}
