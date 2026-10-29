import type { ReactNode } from "react";
import { squareMismatchName,squareDiagnosisName,type SquareMismatchType } from "./squareMismatchDiagnosis";
import { SquareDiagnosisVisualSummary,SquareFeedbackProgress } from "./SquareComparisonView";
import type { SquareDiagnosis, SquareFeedbackPlan, SquareObservedVertex } from "./squareMismatchDiagnosis";
import "./squareDiagnosis.css";

const fmt = (n:number) => String(Math.round(n*100)/100);
const signedLength = (n:number, axis:string) => `${n>=0?"+":"−"}${axis} ${fmt(Math.abs(n))} mm`;
function executedEdge(dx:number, dy:number) {
  const parts = [Math.abs(dx) > 1e-6 ? signedLength(dx,"X") : "", Math.abs(dy) > 1e-6 ? signedLength(dy,"Y") : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "이동 없음";
}
const pointList = (points:SquareObservedVertex[]|undefined) => points?.length
  ?points.map(point=>`${point.label} (${fmt(point.x)}, ${fmt(point.y)})`).join(" → ")
  :"좌표 정보 없음";
function verifiedDifference(diagnosis:SquareDiagnosis) {
  const measured=diagnosis.evidence.measured;
  if(diagnosis.type==="model-real"&&measured)
    return `계획·목표와 제어기 보고 좌표의 최대 차이 ${fmt(measured.maxError)} mm, 평균 ${fmt(measured.meanError)} mm (평균 ΔX ${fmt(measured.meanOffset.x)}, ΔY ${fmt(measured.meanOffset.y)} mm)`;
  if(diagnosis.type==="unreachable")
    return diagnosis.evidence.rejected
      ?`도달할 수 없는 점으로 판정됨: (${fmt(diagnosis.evidence.rejected.x)}, ${fmt(diagnosis.evidence.rejected.y)})`
      :"도달할 수 없는 점이 보고됨";
  if(diagnosis.type==="match")
    return "과제 조건과 이번 실행 관측이 허용 오차 안에서 일치";
  const edge=diagnosis.evidence.edges?.find(item=>{
    const expected=item.condition.axis==="X"?{x:item.condition.delta,y:0}:{x:0,y:item.condition.delta};
    return Math.abs(expected.x-item.executed.dx)>0.1||Math.abs(expected.y-item.executed.dy)>0.1;
  });
  if(!edge)return "좌표 근거가 부족해 차이를 구체화할 수 없음";
  const expected=edge.condition.axis==="X"?{x:edge.condition.delta,y:0}:{x:0,y:edge.condition.delta};
  return `${edge.edge}: 조건 ${executedEdge(expected.x,expected.y)} · 관측 ${executedEdge(edge.executed.dx,edge.executed.dy)}`;
}
function questionReason(diagnosis:SquareDiagnosis) {
  if(diagnosis.type==="model-real")
    return "계획 좌표와 제어기 보고 좌표의 차이가 확인되어, 학생의 계산 오류로 단정하지 않고 장비·좌표계 차이를 살펴보도록 묻습니다.";
  if(diagnosis.type==="match")
    return "이번 실행이 조건과 맞아, 다음 과제에서 실행 전에 무엇을 점검할지 스스로 정리하도록 묻습니다.";
  if(diagnosis.type==="origin-missing")return "제출한 네 좌표가 모두 목표에서 기준점 O를 뺀 값이고 관측이 그 명령을 따라, 기준점 덧셈 관계를 확인하도록 묻습니다.";
  if(diagnosis.type==="unreachable")
    return "실행할 수 없다고 보고된 점이 있어, 시작점과 목표점 사이의 거리 및 과제 범위를 확인하도록 묻습니다.";
  const edge=diagnosis.evidence.edges?.find(item=>{
    const expected=item.condition.axis==="X"?{x:item.condition.delta,y:0}:{x:0,y:item.condition.delta};
    return Math.abs(expected.x-item.executed.dx)>0.1||Math.abs(expected.y-item.executed.dy)>0.1;
  });
  return edge
    ?`${edge.edge}에서 과제 조건과 관측 이동량이 달라, 이 구간의 좌표·축·방향을 함께 확인하도록 묻습니다.`
    :"이번 실행에서 확인된 좌표와 과제 조건을 다시 대조하도록 묻습니다.";
}

/**
 * Summarizes observed evidence without treating a geometric mismatch as proof of a
 * learner's cognitive cause. The learner's explanation remains a saved hypothesis.
 */
export function SquareDiagnosisPanel({ diagnosis, plan, plannedVertices, observedVertices:observedVerticesOverride, sourceLabel:sourceLabelOverride, cause, onCauseChange, causeRequired, disabled, priorSameType=0, supportMode="guided", toleranceMm, targetVertices, connectedOnly, gptQuestion, children }: {
  diagnosis:SquareDiagnosis; plan:SquareFeedbackPlan|null; plannedVertices?:SquareObservedVertex[]; cause?:string; onCauseChange?:(text:string)=>void;
  observedVertices?:SquareObservedVertex[]; sourceLabel?:string;
  connectedOnly?:boolean; toleranceMm?:number; targetVertices?:SquareObservedVertex[]; gptQuestion?:string; children?:ReactNode;
  causeRequired?:boolean; disabled?:boolean; priorSameType?:number; supportMode?:"guided"|"challenge";
}) {
  const paperLabel = connectedOnly && diagnosis.label.includes("\n");
  const reason = paperLabel ? plan?.relationHint : questionReason(diagnosis);
  const edges = diagnosis.evidence.edges ?? [];
  const tol=toleranceMm??(diagnosis.evidence.source==="hardware"?1:0.1);
  const types:SquareMismatchType[]=["unreachable","origin-missing","displacement-as-position","axis-swap","direction","closure","arithmetic","model-real","match"];
  const measured = diagnosis.evidence.measured;
  const mismatch = diagnosis.type !== "match";
  const sourceLabel=sourceLabelOverride??(diagnosis.evidence.source==="hardware"?"실장비 브리지 회신 · 제어기 보고 TCP 좌표"
    :diagnosis.evidence.source==="mock"?"모의 브리지 회신 · 실측 증거 아님"
    :diagnosis.evidence.source==="dt"?"DT 시뮬레이터 관측 좌표 · 실물 측정 아님":"학생 예측 좌표 · 실행 관측 아님");
  const {condition}=diagnosis.evidence;
  const conditionText=`P1 (${fmt(condition.start.x)}, ${fmt(condition.start.y)}) · 가로 X ${condition.xDir>0?"+":"−"}${fmt(condition.width)} mm · 세로 Y ${condition.yDir>0?"+":"−"}${fmt(condition.height)} mm · 시작점 복귀`;
  const observedVertices=observedVerticesOverride??diagnosis.evidence.executed?.vertices;
  const observedText=observedVertices?.length
    ?pointList(observedVertices)
    :diagnosis.evidence.rejected
      ?`실행 좌표 회신 없음 · 도달 불가 점 (${fmt(diagnosis.evidence.rejected.x)}, ${fmt(diagnosis.evidence.rejected.y)})`
      :"이번 실행의 좌표 관측 없음";
  return <section className="square-diagnosis" data-type={diagnosis.type} data-level={plan?.level??"self-regulation"} aria-label="실행 결과와 과제 조건 비교" data-testid="square-diagnosis">
    <p className="square-diagnosis-source">{sourceLabel}</p>
    <section className="square-decision-section square-question-first"><h3>먼저 이 질문을 보고 다시 생각해 보세요</h3>
      <p className="square-diagnosis-question"><strong>규칙 기반 기본 질문</strong> {plan?.question??"이번 관계를 다음 과제에서도 확인하려면 무엇을 먼저 점검할까요?"}</p>
      <p>{diagnosis.label}</p>
      {plan?.teacherFlag&&<p className="square-diagnosis-teacher"><strong>교사 확인 필요</strong> · 같은 차이가 반복되어 함께 확인할 단계입니다.</p>}
      {gptQuestion&&<p><strong>GPT가 표현한 질문·설명</strong> {gptQuestion}</p>}
    </section>
    <section className="square-decision-section"><h3>어디가 달랐나요? · 조건과 관측 비교</h3>
      <SquareDiagnosisVisualSummary diagnosis={diagnosis} observed={observedVertices??[]} target={targetVertices} connectedOnly={connectedOnly}/>
      <p>판정 허용오차 {fmt(tol)} mm · {toleranceMm?"종이 목표·명령과 보고 위치":diagnosis.evidence.source==="hardware"?"명령과 제어기 보고 위치 · 수학적 변 계산 0.1 mm":"수학적 변 계산"}</p>
      <div className="square-edge-cards">{edges.map((e,i)=>{const want=e.condition.axis==="X"?{dx:e.condition.delta,dy:0}:{dx:0,dy:e.condition.delta};const same=diagnosis.type==="match"||(Math.abs(want.dx-e.executed.dx)<=tol&&Math.abs(want.dy-e.executed.dy)<=tol);
        return <article key={e.edge} data-different={!same&&diagnosis.type!=="model-real"}><strong>{e.edge}</strong><p>조건 {executedEdge(want.dx,want.dy)}</p><p>관측 {executedEdge(e.executed.dx,e.executed.dy)}</p><small>{same?"허용 범위":"차이 확인"}{diagnosis.edgeIndex===i+1?" · 먼저 확인할 변":""}</small></article>;})}</div>
      {measured&&<p>평균 차이 {fmt(measured.meanError)} mm · 최대 차이 {fmt(measured.maxError)} mm · {measured.reference==="student-plan"?"명령":"목표"} 대비</p>}
      {diagnosis.type==="model-real"&&<p>학생 오류로 단정할 수 없습니다. 장비·좌표계·측정 조건을 먼저 확인하세요.</p>}
    </section>
    <details className="square-diagnosis-details"><summary>판정 종류와 피드백 단계 보기</summary>
    <section className="square-decision-section"><h3>규칙 기반 판정</h3><div className="square-type-chips">{paperLabel?<span data-selected="true">{squareDiagnosisName(diagnosis,true)}</span>:types.map(t=><span key={t} data-selected={t===diagnosis.type}>{squareMismatchName(t)}</span>)}</div><p>{reason}</p></section>
    <section className="square-decision-section"><h3>피드백 단계</h3><SquareFeedbackProgress plan={plan} match={diagnosis.type==="match"} priorSameType={priorSameType} supportMode={supportMode}/>{diagnosis.type==="model-real"&&<p>장비·모형 차이는 학습 오류 반복에 따른 지원 상향에서 제외합니다.</p>}</section>
    </details>
    <details className="square-diagnosis-details">
      <summary>자세한 근거 보기</summary>
    <dl className="square-diagnosis-summary">
      <div><dt>과제 조건</dt><dd>{conditionText}</dd></div>
      <div><dt>학생 계획</dt><dd>{pointList(plannedVertices)}</dd></div>
      <div><dt>이번 실행 관측</dt><dd>{observedText}</dd></div>
      <div><dt>확인된 차이</dt><dd>{verifiedDifference(diagnosis)}</dd></div>
    </dl>
    <h4>{diagnosis.label}</h4>
    <p className="square-diagnosis-honesty">규칙 기반 비교가 좌표와 변의 차이를 표시합니다. 이 차이만으로 학생의 생각 원인을 확정하지 않습니다. 튜터 질문은 확인된 근거를 살펴보도록 돕습니다.</p>
    <p className="square-diagnosis-why"><strong>왜 이 질문인가요?</strong> {reason}</p>

      {diagnosis.type !== "match" && edges.length > 0 && diagnosis.type !== "model-real" && <div className="square-diagnosis-table" tabIndex={0} aria-label="변별 과제 조건과 이번 실행 관측">
      <table>
        <thead><tr><th scope="col">변</th><th scope="col">과제 조건</th><th scope="col">관측 이동</th><th scope="col">비교</th></tr></thead>
        <tbody>{edges.map((edge,index) => {
          const want = edge.condition.axis === "X" ? {dx:edge.condition.delta,dy:0} : {dx:0,dy:edge.condition.delta};
          const same = Math.abs(want.dx-edge.executed.dx) <= 0.1 && Math.abs(want.dy-edge.executed.dy) <= 0.1;
          return <tr key={edge.edge} data-focus={diagnosis.edgeIndex === index+1 || undefined} data-same={same}>
            <th scope="row">{edge.edge}</th>
            <td>{signedLength(edge.condition.delta, edge.condition.axis)}</td>
            <td>{executedEdge(edge.executed.dx, edge.executed.dy)}</td>
            <td>{same ? "일치" : "차이"}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
      {observedVertices?.length===5&&<p className="square-diagnosis-evidence">관측 꼭짓점: {pointList(observedVertices)}</p>}
      {measured && <p className="square-diagnosis-measured">비교 꼭짓점 {measured.count}개 · 평균 차이 {fmt(measured.meanError)} mm · 최대 차이 {fmt(measured.maxError)} mm · 평균 편차 (ΔX {fmt(measured.meanOffset.x)}, ΔY {fmt(measured.meanOffset.y)} mm)</p>}
      {plan?.relationHint && <p className="square-diagnosis-hint"><strong>관계 힌트</strong> {plan.relationHint}</p>}
      {plan?.example && <p className="square-diagnosis-example">{plan.example}</p>}
    </details>
    <section className="square-decision-section"><h3>이 질문을 보고 내가 생각한 원인</h3>
    {onCauseChange ? <label className="square-diagnosis-cause">
      {causeRequired ? "위 피드백을 보고, 어떤 계산을 왜 바꾸려고 하나요?" : plan?.level === "self-regulation" ? "다음 과제에서 미리 점검할 방법 (선택)" : "이 차이에 대한 내 설명 (선택)"}
      <textarea aria-label="차이가 생긴 이유" rows={2} maxLength={1000} disabled={disabled} value={cause ?? ""}
        onChange={event => onCauseChange(event.target.value)}
        placeholder={mismatch ? "확인된 차이를 설명할 수 있는 생각을 적으세요. 확실하지 않으면 가설이라고 표시해도 됩니다." : "다음 과제에서 먼저 확인할 관계를 적어 보세요."}/>
      <span className="square-diagnosis-hypothesis-note">이 내용은 학생의 설명으로 저장되며, 관측만으로 원인을 자동 확정하지 않습니다.</span>
    </label>:<p>{cause||"아직 작성하지 않았습니다. 원인은 관측만으로 확정하지 않습니다."}</p>}
    {children}</section>
  </section>;
}
