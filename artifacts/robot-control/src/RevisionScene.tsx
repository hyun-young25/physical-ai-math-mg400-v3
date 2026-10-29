import { Html, Line } from "@react-three/drei";
import { shapeWorldPoint } from "./shapeKinematics";
import { journeySource, type JourneyPoint } from "./revisionJourney";
import { useSquareVisual } from "./useSquareVisual";
import { usePaperScene, selectPaperPoint } from "./paperSceneStore";
import { paperSceneSeries } from "./paperSceneModel";
import { hasRevisionResult, REVISION_PHASES, revisionSceneSeries, selectRevisionPhase, selectRevisionPoint, useActiveRevisionScene, useRevisionScene, validJourneyPoint, type RevisionPhase } from "./revisionSceneStore";
import "./revisionScene.css";

const coordinate = (p?: JourneyPoint) => p && validJourneyPoint(p) ? `(${Math.round(p.x * 100) / 100}, ${Math.round(p.y * 100) / 100})` : "미입력 / 결과 대기";
// These are explicitly labelled XY projections, not invented Z measurements.
const world = (p: JourneyPoint & { x: number; y: number }): [number, number, number] => {
  const [x,y,z] = shapeWorldPoint({ x:p.x, y:p.y, z:0 }); return [x,y+4,z];
};
export function RevisionPhaseButtons() {
  const {data,phase} = useRevisionScene();
  const square=useSquareVisual(),review=square.visual?.review;
  if (!data) return null;
  return <><nav className="revision-phase-buttons" aria-label="로봇 장면에서 볼 학습 과정">{REVISION_PHASES.map((label,i) =>
    <button key={label} type="button" disabled={data.running||!!review?.selected} aria-pressed={phase===i} onClick={() => selectRevisionPhase(i as RevisionPhase)}><span>{i+1}</span>{label}</button>)}</nav>
    {review?.selected&&<p className="revision-scene-note">과거 시도를 확인 중입니다. <button type="button" onClick={()=>window.dispatchEvent(new CustomEvent("square-attempt-review",{detail:{owner:review.owner,id:""}}))}>현재 과정 비교로 돌아가기</button></p>}</>;
}

/** Uses the existing robot coordinate mapping; never moves a joint or TCP. */
export function RevisionSceneOverlay() {
  const {data,phase,point} = useActiveRevisionScene();
  if (!data || data.running) return null;
  const series = revisionSceneSeries(data,phase), target = series[0].points;
  return <group name="revision-recorded-xy-projection">
    {series.map(s => <group key={s.label}>
      {s.points.slice(1).map((p,i) => validJourneyPoint(p) && validJourneyPoint(s.points[i]) && <Line key={i} points={[world(s.points[i] as JourneyPoint & {x:number;y:number}),world(p)]} color={s.color} lineWidth={s.label==="목표점"?2:3} dashed={s.dashed} dashSize={5} gapSize={4} depthTest={false}/>)}
      {s.points.filter(validJourneyPoint).map((p,i) => <mesh key={i} position={world(p)} renderOrder={210}><sphereGeometry args={[s.label==="목표점"?5:3.5,12,8]}/><meshBasicMaterial color={s.color} depthTest={false} transparent opacity={s.label==="목표점"?.55:1}/></mesh>)}
    </group>)}
    {target.slice(0,4).map((p,i) => validJourneyPoint(p) && <Html key={i} position={world(p)} center zIndexRange={[16,0]}><button type="button" className="revision-point-label" aria-label={`장면에서 ${p.label} 선택`} aria-pressed={point===i} onClick={() => selectRevisionPoint(i)}>{p.label}</button></Html>)}
    {series.slice(1).map(s => {
      const a=target[point],b=s.points[point];
      if (!a || !b || !validJourneyPoint(a) || !validJourneyPoint(b) || Math.hypot(a.x-b.x,a.y-b.y)<.1) return null;
      return <Line key={s.label} points={[world(a),world(b)]} color={s.color} lineWidth={6} depthTest={false}/>;
    })}
  </group>;
}

export function RevisionSceneDock({fallback=false}:{fallback?:boolean}) {
  const {data,phase,point} = useActiveRevisionScene();
  const paper=usePaperScene();
  if (!data) return null;
  const series=paper.data?paperSceneSeries(paper.data,phase):revisionSceneSeries(data,phase), feedback=data.referenceFeedback??data.previous;
  const before=series.find(s=>s.label==="첫 실행"||s.label==="수정 전 실행")?.points[point],after=series.at(-1)?.points[point];
  const signed=(n:number)=>(n>0?"+":"")+String(Math.round(n*100)/100);
  const change=(phase===2||phase===3)&&before&&after&&validJourneyPoint(before)&&validJourneyPoint(after)?`P${point+1} · X ${signed(after.x-before.x)} mm, Y ${signed(after.y-before.y)} mm (${phase===2?"수정 전 실행 → 예측":"첫 실행 → 수정 후 실행"})`:null;
  const message=phase===0 ? data.first.reason : phase===1 ? feedback.question : phase===2 ? data.draftRevisionReason||data.revisionReason||data.draftReason : hasRevisionResult(data) ? data.current.outcome : "수정한 예측을 저장한 뒤 실행하면 결과가 표시됩니다.";
  return <section className="revision-scene-dock" id="revision-robot-scene" aria-label="도봇과 함께 보는 생각의 변화" data-testid="revision-scene-dock">
    <header><b>도봇과 함께 비교하기</b><span>{fallback?"3D 미지원 · 아래 좌표로 비교":"로봇 X/Y 평면 투영 · mm"}</span></header>
    <RevisionPhaseButtons/>
    <div className="revision-point-picker" aria-label="비교할 꼭짓점">{[0,1,2,3].map(i => <button key={i} type="button" disabled={data.running} aria-pressed={point===i} onClick={() => paper.data?selectPaperPoint(`P${i+1}`,"scene"):selectRevisionPoint(i)}>P{i+1}</button>)}<small>{data.running?"실행 중 · 로봇의 현재 움직임을 관찰하세요.":"선택한 점을 작업대에서 확인하세요."}</small></div>
    <div className="revision-scene-values">{series.map(s => <div key={s.label} data-scene-series={s.label} style={{borderTopColor:s.color}}><span style={{color:s.color}}>{s.dashed?"┄":"━"} {s.label}</span><b>{coordinate(s.points[point])}</b><small>{s.source==="과제 조건"||s.source==="예측 · 실행 전"?s.source:journeySource(s.source)}</small></div>)}</div>
    {change&&<p className="revision-scene-change">{change}</p>}
    <p className="revision-scene-message"><b>{phase===1?"확인 질문 · 규칙 기반":phase===2?"바꾼 생각":phase===3?"재실행 결과":"처음 생각"}</b> {message||"입력한 생각과 실행 기록을 이 장면에서 비교합니다."}</p>
    {data.conditionsChanged&&<p className="revision-scene-note">기준점·목표 조건이 달라 첫 실행을 현재 목표에 겹치지 않습니다. ‘첫 시도’에서 따로 확인하세요.</p>}
    <small className="revision-scene-note">점과 연결선은 기록·예측 비교용입니다. 단계·점 선택은 장비를 움직이지 않습니다.{phase===3&&data.current.source==="hardware"?" 잉크 위치 측정은 별도입니다.":""}</small>
  </section>;
}
