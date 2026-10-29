import { useId, useLayoutEffect, type ReactNode } from "react";
import { publishRevisionScene, clearRevisionScene } from "./revisionSceneStore";
import { RevisionPhaseButtons } from "./RevisionScene";
import { journeySource, type JourneyAttempt, type JourneyPoint, type RevisionJourneyData } from "./revisionJourney";
import "./revisionJourney.css";

const fmt=(n:number|null)=>n===null?"—":String(Math.round(n*100)/100);
function PointList({points}:{points:JourneyPoint[]}) {
  return <ul className="revision-points">{points.map((p,i)=><li key={p.label+":"+i}><span>{p.label}</span><b>({fmt(p.x)}, {fmt(p.y)})</b></li>)}</ul>;
}
function Thought({attempt}:{attempt:JourneyAttempt}) {
  return <>{attempt.model&&<p className="revision-model">{attempt.model}</p>}<PointList points={attempt.points}/><p className="revision-quote">{attempt.reason||"작성한 예측 근거가 없습니다."}</p></>;
}
function Feedback({attempt}:{attempt:JourneyAttempt}) {
  return <><span className="revision-source">규칙 기반 확인 질문</span><p className="revision-question">{attempt.question||"실행 결과를 비교하면 확인 질문이 표시됩니다."}</p>
    {attempt.gptQuestion&&<details><summary>이 시도에서 받은 GPT 설명</summary><p className="revision-quote">{attempt.gptQuestion}</p></details>}</>;
}

/** Only renders recorded observations. It never executes or changes a judgment. */
function ResultPlot({first,current}:{first:JourneyAttempt;current:JourneyAttempt}) {
  const groups=[{name:"목표점",points:current.target,color:"#64748b",dash:"5 4"},{name:"첫 실행",points:first.observed,color:"#c2410c",dash:"2 4"},{name:"수정 후 실행",points:current.observed,color:"#2563eb",dash:undefined}];
  const all=groups.flatMap(g=>g.points).filter(p=>p.x!==null&&p.y!==null&&Number.isFinite(p.x)&&Number.isFinite(p.y));
  if(!all.length)return null;
  const minX=Math.min(...all.map(p=>p.x!)),maxX=Math.max(...all.map(p=>p.x!)),minY=Math.min(...all.map(p=>p.y!)),maxY=Math.max(...all.map(p=>p.y!));
  const scale=Math.min(320/Math.max(maxX-minX,1),180/Math.max(maxY-minY,1));
  const x=(n:number)=>40+(n-minX)*scale,y=(n:number)=>218-(n-minY)*scale;
  return <figure className="revision-plot"><svg viewBox="0 0 400 260" role="img" aria-label="목표점과 첫 실행·수정 후 실행의 도착점 비교">
    <path d="M30 20V230H380" fill="none" stroke="#cbd5e1"/><text x="370" y="247">X</text><text x="10" y="20">Y</text>
    {groups.map(g=><g key={g.name} data-journey-series={g.name}><polyline fill="none" stroke={g.color} strokeWidth="2" strokeDasharray={g.dash}
      points={g.points.filter(p=>p.x!==null&&p.y!==null).map(p=>`${x(p.x!)},${y(p.y!)}`).join(" ")}/>
      {g.points.filter(p=>p.x!==null&&p.y!==null).map((p,i)=><g key={i}><circle cx={x(p.x!)} cy={y(p.y!)} r={g.name==="목표점"?6:3} fill={g.name==="목표점"?"white":g.color} stroke={g.color}/><title>{g.name} {p.label}: ({fmt(p.x)}, {fmt(p.y)}) mm</title></g>)}</g>)}
  </svg><figcaption><span>○ 목표점</span><span className="revision-first-key">··· 첫 실행</span><span className="revision-current-key">━ 수정 후 실행</span></figcaption>
  <small>같은 로봇 X/Y 좌표 · mm. 선은 도착점을 잇는 비교선입니다.</small></figure>;
}

export function LearningRevisionJourney({data}:{data:RevisionJourneyData|null}) {
  const owner=useId(),key=JSON.stringify(data);
  useLayoutEffect(()=>{publishRevisionScene(owner,data);},[owner,key]);
  useLayoutEffect(()=>()=>clearRevisionScene(owner),[owner]);
  if(!data)return null;
  const {first,previous,current,revising,editing}=data;
  const hasNewResult=revising&&current.id!==first.id&&current.complete;
  const editingNewAnswer=editing&&!hasNewResult;
  const revisedPoints=editingNewAnswer?data.draft:current.points;
  const revisionReason=hasNewResult?data.revisionReason:data.draftRevisionReason||data.revisionReason||data.draftReason;
  return <section className="revision-journey" aria-label="첫 시도부터 재실행까지" data-testid="revision-journey" data-result={hasNewResult?"complete":"pending"}>
    <header><div><span className="revision-eyebrow">내 생각과 움직임의 변화</span><h3>첫 시도 → 피드백 → 답 수정 → 재실행 결과</h3></div>
      <span className="revision-status">{hasNewResult?"수정 전후 비교":editing?"피드백을 보며 수정 중":revising?"재실행 결과 대기":"첫 실행 확인"}</span></header>
    <RevisionPhaseButtons/>
    <p className="revision-scene-link">단계를 선택하면 도봇 작업대의 점과 아래 설명이 함께 바뀝니다. <button type="button" onClick={()=>document.getElementById("revision-robot-scene")?.parentElement?.scrollIntoView({block:"nearest",behavior:"smooth"})}>도봇과 함께 보기</button></p>
    <details className="revision-report"><summary>좌표·생각 변화 상세 기록</summary>
    <ol className="revision-flow">
      <li><h4><span>1</span> 첫 시도</h4><Thought attempt={first}/><p className="revision-outcome">{first.outcome}</p><small>{journeySource(first.source)}</small></li>
      <li><h4><span>2</span> 받은 피드백</h4>{previous.id!==first.id&&<small>가장 최근 시도에서 받은 질문</small>}<Feedback attempt={previous}/></li>
      <li data-current={editingNewAnswer||undefined}><h4><span>3</span> 내가 바꾼 답</h4>{revising||editing?<><PointList points={revisedPoints}/><p className="revision-quote">{revisionReason||"어떤 질문을 보고 무엇을 바꿨는지 적어 주세요."}</p><small>{editingNewAnswer?"편집 중 · 예측을 저장한 뒤 실행하세요":"저장된 수정 예측"}</small></>:<p className="revision-empty">피드백을 확인한 뒤, 바꿀 좌표와 이유를 직접 적습니다.</p>}</li>
      <li data-success={hasNewResult&&current.match||undefined}><h4><span>4</span> 재실행 결과</h4>{hasNewResult?<><p className="revision-outcome">{current.outcome}</p><PointList points={current.observed}/><small>{journeySource(current.source)}</small></>:<><strong className="revision-pending">재실행 결과 대기</strong><p className="revision-empty">수정한 답을 저장하고 실행하면 새 도착점이 여기에 표시됩니다.</p></>}</li>
    </ol>
    {hasNewResult&&<div className="revision-result" role="status"><h4>수정 후 움직임은 어떻게 달라졌나요?</h4>
      {data.conditionsChanged?<p>기준점 또는 목표 조건이 달라졌습니다. 두 실행의 좌표를 같은 목표의 개선 결과로 겹쳐 표시하지 않습니다.</p>:<ResultPlot first={first} current={current}/>}
      <p><b>첫 실행:</b> {first.outcome} <span aria-hidden="true">→</span> <b>수정 후:</b> {current.outcome}</p>
      {first.source!==current.source&&<p className="revision-source">자료 출처가 다릅니다: {journeySource(first.source)} → {journeySource(current.source)}.</p>}
      <p className="revision-source">{current.source==="hardware"?"제어기가 보고한 도착점 비교입니다. 종이 위 잉크 위치 측정은 별도로 확인합니다.":"가상·모의 실행의 비교이며 실물 도달을 입증하지 않습니다."}</p>
    </div>}
    </details>
  </section>;
}

export function RevisionEditingLayout({data,children}:{data:RevisionJourneyData|null;children:ReactNode}) {
  const show=!!data?.editing;
  return <div className={`revision-workspace${show?" is-editing":""}`}>
    {show&&data&&<aside className="revision-reference" aria-label="수정하며 참고할 첫 시도와 피드백"><h3>처음 생각을 보며 고쳐 보세요</h3>
      <details><summary>처음 좌표와 예측 근거</summary><Thought attempt={data.first}/></details><hr/>{(data.referenceFeedback??data.previous).id!==data.first.id&&<small>최근 시도에서 받은 질문</small>}<Feedback attempt={data.referenceFeedback??data.previous}/>
      <p className="revision-source">처음 답은 그대로 보존됩니다. 옆 입력란에서 수정하세요.</p></aside>}
    <div className="revision-editor">{children}</div>
  </div>;
}
