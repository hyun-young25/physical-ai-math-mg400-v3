import { useEffect,useId,useRef,useState } from "react";
import type { SquareDiagnosis,SquareFeedbackPlan,SquareObservedVertex } from "./squareMismatchDiagnosis";
import { squareMismatchName,LEVEL_LABELS } from "./squareMismatchDiagnosis";
import { COMPARISON_COLORS as C,fmtSquare,signedSquare,squareExecutionLabel,squareClosureGap,squareReplayPoint,targetFromDiagnosis } from "./squareComparisonVisual";
import { useSquareVisual } from "./useSquareVisual";
import { replaySquareComparison,toggleSquareVisual } from "./squareVisualizationStore";
import "./squareDiagnosis.css";

export function SquareComparisonDiagram({target,observed,diagnosis,compact=false,emphasized=false,progress,connectedOnly=false,matches}:{
  target:SquareObservedVertex[];observed:SquareObservedVertex[];diagnosis:SquareDiagnosis;compact?:boolean;emphasized?:boolean;progress?:number;connectedOnly?:boolean;matches?:boolean;
}) {
  const marker=useId().replace(/:/g,"");
  const points=[...target,...observed,...(diagnosis.evidence.rejected?[diagnosis.evidence.rejected]:[])];
  const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y));
  const scale=136/Math.max(maxX-minX,maxY-minY,1),cx=(minX+maxX)/2,cy=(minY+maxY)/2;
  const xy=(p:{x:number;y:number})=>[100+(p.x-cx)*scale,100-(p.y-cy)*scale];
  const line=(a:{x:number;y:number},b:{x:number;y:number})=>{const [x1,y1]=xy(a),[x2,y2]=xy(b);return {x1,y1,x2,y2};};
  const poly=(ps:SquareObservedVertex[])=>ps.map(p=>xy(p).join(",")).join(" ");
  const gap=squareClosureGap(observed),closed=gap!==null&&gap<=0.1;
  return <figure className={`square-comparison-diagram${compact?" square-comparison-mini":""}`} data-testid={compact?"square-mini-diagram":"square-comparison-diagram"}>
    <svg viewBox="0 0 200 200" role="img" aria-label={`목표와 ${diagnosis.evidence.source==="hardware"?"제어기 보고":"실행 관측"} 좌표 비교 · ${closed?"닫힌 경로":"열린 경로 또는 관측 미완료"}`}>
      <defs><marker id={marker} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6" fill={C.mismatch}/></marker></defs>
      <path d="M15 185H190M15 185V10" fill="none" stroke="#cbd5e1"/>
      <text x="183" y="198">X</text><text x="3" y="14">Y</text>
      <polyline points={poly(target)} fill="none" stroke={C.target} strokeWidth="2" strokeDasharray="6 4" opacity=".7"/>
      {observed.slice(1).map((p,i)=><line key={i} {...line(observed[i],p)} stroke={(matches??diagnosis.type==="match")?C.target:i+1===diagnosis.edgeIndex?C.mismatch:C.executed}
        strokeWidth={i+1===diagnosis.edgeIndex?emphasized?6:4:3} className={i+1===diagnosis.edgeIndex?"square-edge-mismatch":undefined} data-edge={i+1}/>)}
      {gap!==null&&gap>0.1&&<line {...line(observed[4],observed[0])} stroke={C.mismatch} strokeWidth="2" strokeDasharray="3 3"/>}
      {diagnosis.type==="model-real"&&diagnosis.evidence.source==="hardware"&&observed.map((p,i)=>target[i]&&<line key={i} {...line(target[i],p)} stroke={C.mismatch} markerEnd={`url(#${marker})`}/>)}
      {observed.slice(0,4).map((p,i)=>{const [x,y]=xy(p);return <g key={i}><circle cx={x} cy={y} r="3" fill={(matches??diagnosis.type==="match")?C.target:C.executed}/><text x={x+5} y={y-6}>{p.label}</text></g>;})}
      {progress!==undefined&&[target,observed].map((ps,i)=>{const p=squareReplayPoint(ps,progress);if(!p)return null;const [x,y]=xy(p);return <circle key={"replay"+i} cx={x} cy={y} r={i?4:6} fill={i?C.executed:C.target} opacity={i?1:.45}/>;})}
      {diagnosis.evidence.rejected&&(()=>{const [x,y]=xy(diagnosis.evidence.rejected!);return <g stroke={C.mismatch} strokeWidth="3"><path d={`M${x-5} ${y-5}l10 10m0 -10l-10 10`}/></g>;})()}
    </svg>
    {!compact&&<figcaption>관측 좌표 비교도 · {connectedOnly?"네 꼭짓점 연결":diagnosis.type==="unreachable"?"도달 불가 · 관측 미완료":closed?"닫힌 경로":"열린 경로"}<small>{connectedOnly?"연속 경로·닫힘·잉크 측정 아님":"점 사이 선은 관측 꼭짓점의 연결선입니다."}</small></figcaption>}
  </figure>;
}

export function SquareEdgeBars({diagnosis}:{diagnosis:SquareDiagnosis}){
  const edge=diagnosis.edgeIndex?diagnosis.evidence.edges?.[diagnosis.edgeIndex-1]:undefined;
  if(!edge)return null;
  const actual=edge.condition.axis==="X"?edge.executed.dx:edge.executed.dy;
  const cross=edge.condition.axis==="X"?edge.executed.dy:edge.executed.dx;
  const max=Math.max(Math.abs(edge.condition.delta),Math.abs(actual),1);
  return <div className="square-edge-bars" aria-label={`${edge.edge} 이동량 비교`}>
    <strong>{edge.edge}</strong>
    {[{label:"조건",n:edge.condition.delta,color:C.target},{label:"실행",n:actual,color:C.executed}].map(row=><div className="square-bar-row" key={row.label}>
      <span>{row.label}</span><div className="square-bar-track"><i style={{left:row.n>=0?"50%":`${50-Math.abs(row.n)/max*48}%`,width:`${Math.abs(row.n)/max*48}%`,background:row.color}}/><b aria-hidden="true">{row.n<0?"←":"→"}</b></div>
      <span>{signedSquare(row.n,edge.condition.axis)}</span>
    </div>)}
    {Math.abs(cross)>0.1&&<small>다른 축 이동도 관측됨: {squareExecutionLabel(edge.executed.dx,edge.executed.dy)}</small>}
  </div>;
}

export function SquareFeedbackProgress({plan,match,priorSameType=0,supportMode="guided"}:{
  plan:SquareFeedbackPlan|null;match:boolean;priorSameType?:number;supportMode?:"guided"|"challenge";
}){
  const level=plan?.level??(match?"self-regulation":"task"),levels=Object.keys(LEVEL_LABELS) as (keyof typeof LEVEL_LABELS)[];
  const index=levels.indexOf(level),previous=useRef(index);
  const increased=index>previous.current;
  useEffect(()=>{previous.current=index;},[index]);
  return <div className="square-feedback-progress">
    <ol aria-label="피드백 단계">{levels.map((id,i)=><li key={id} aria-current={i===index?"step":undefined} data-state={i<index?"past":i===index?"current":"future"}
      className={increased&&i===index?"square-level-advance":undefined}><span>{i+1}</span>{LEVEL_LABELS[id]}</li>)}</ol>
    <div className="square-feedback-meta">{!match&&<span>같은 오류 {priorSameType+1}회째</span>}
      {plan?.teacherFlag&&<strong role="status">🔔 선생님 화면에 도움 요청됨</strong>}</div>
    {supportMode==="challenge"&&!match&&<small>도전 모드: 지원을 한 단계 늦게 늘립니다</small>}
  </div>;
}
export function SquareReplayControls(){
  const state=useSquareVisual(),[speed,setSpeed]=useState<1|0.5>(1);
  if(!state.visual||state.visual.stage!==6)return null;
  return <div className="square-replay-controls">
    <button type="button" disabled={state.visual.observed.length!==5} onClick={()=>replaySquareComparison(speed)}>{state.replay?"비교 다시 재생":"비교 재생"}</button>
    <label>재생 속도 <select aria-label="비교 재생 속도" value={speed} onChange={e=>setSpeed(Number(e.target.value) as 1|0.5)}><option value={1}>1×</option><option value={.5}>0.5×</option></select></label>
    <small>화면 표시 전용 · 실제 이동 시간과 다를 수 있습니다</small>
  </div>;
}
export function SquareComparisonControls(){
  const state=useSquareVisual();
  if(!state.visual)return null;
  return <div className="square-scene-controls" data-testid="square-scene-comparison">
    <div className="square-comparison-legend"><span style={{color:C.target}}>┄ 목표 경로</span><span style={{color:C.executed}}>━ 실행 경로</span><span style={{color:C.mismatch}}>━ 어긋난 구간</span></div>
    <button type="button" aria-pressed={state.enabled} onClick={toggleSquareVisual}>비교 보기 {state.enabled?"켜짐":"꺼짐"}</button>
  </div>;
}
/** Used by the existing command diagram only after an observed square execution. */
export function SquareObservedDiagram(){
  const state=useSquareVisual(),v=state.visual;
  if(!v||v.stage<5||v.stage>6)return null;
  return <SquareComparisonDiagram target={v.target} observed={v.observed} diagnosis={v.diagnosis} connectedOnly={v.connectedVerticesOnly} matches={v.match} emphasized={!!state.emphasis}/>;
}
export function SquareFallbackComparison(){
  const state=useSquareVisual(),v=state.visual;
  const [tick,setTick]=useState(0);
  useEffect(()=>{
    if(!state.replay)return;
    let frame=0;const update=()=>{setTick(performance.now());frame=requestAnimationFrame(update);};frame=requestAnimationFrame(update);
    return()=>cancelAnimationFrame(frame);
  },[state.replay]);
  if(!v||!state.enabled)return null;
  const t=state.replay?Math.min(1,Math.max(0,tick-state.replay.startedAt)/(4000/state.replay.speed)):0;
  const a=state.replay?squareReplayPoint(v.target,t):null,b=state.replay?squareReplayPoint(v.observed,t):null;
  return <div className="square-fallback-comparison"><p>3D 미지원 · 관측 좌표 비교</p><SquareComparisonDiagram target={v.target} observed={v.observed} diagnosis={v.diagnosis} emphasized={!!state.emphasis} progress={state.replay?t:undefined}/>
    {a&&b&&<p role="status">비교 재생 {Math.round(t*100)}% · 목표 ({fmtSquare(a.x)}, {fmtSquare(a.y)}) / 실행 ({fmtSquare(b.x)}, {fmtSquare(b.y)})</p>}
  </div>;
}

export function SquareDiagnosisVisualSummary({diagnosis,observed}:{diagnosis:SquareDiagnosis;observed:SquareObservedVertex[]}){
  const state=useSquareVisual(),emphasized=!!state.emphasis&&state.visual?.diagnosis.type===diagnosis.type;
  return <div className="square-visual-summary" data-emphasized={emphasized||undefined} data-testid="square-visual-summary">
    <h4 className="square-type-badge">{diagnosis.type==="match"?"✓ 예측과 실행 일치":"⚠ "+squareMismatchName(diagnosis.type)+(diagnosis.edge?" · "+diagnosis.edge:"")}</h4>
    <div className="square-visual-comparison">
      <SquareEdgeBars diagnosis={diagnosis}/>
      <SquareComparisonDiagram target={targetFromDiagnosis(diagnosis)} observed={observed} diagnosis={diagnosis} compact emphasized={emphasized}/>
    </div>
  </div>;
}
