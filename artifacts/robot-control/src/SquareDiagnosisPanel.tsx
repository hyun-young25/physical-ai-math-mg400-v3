import type { SquareDiagnosis, SquareFeedbackPlan } from "./squareMismatchDiagnosis";
import "./squareDiagnosis.css";

const fmt = (n:number) => String(Math.round(n*100)/100);
const signedLength = (n:number, axis:string) => `${n>=0?"+":"−"}${axis} ${fmt(Math.abs(n))} mm`;
function executedEdge(dx:number, dy:number) {
  const parts = [Math.abs(dx) > 1e-6 ? signedLength(dx,"X") : "", Math.abs(dy) > 1e-6 ? signedLength(dy,"Y") : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "이동 없음";
}

/**
 * Shows what the robot actually did next to the task condition, plus one leveled question.
 * The learner must explain the cause before revising (onCauseChange / causeRequired).
 */
export function SquareDiagnosisPanel({ diagnosis, plan, cause, onCauseChange, causeRequired, disabled }: {
  diagnosis:SquareDiagnosis; plan:SquareFeedbackPlan; cause?:string; onCauseChange?:(text:string)=>void;
  causeRequired?:boolean; disabled?:boolean;
}) {
  const edges = diagnosis.evidence.edges ?? [];
  const measured = diagnosis.evidence.measured;
  const mismatch = diagnosis.type !== "match";
  const sourceLabel=diagnosis.evidence.source==="hardware"?"실장비 브리지 회신 · 제어기 보고 TCP 좌표"
    :diagnosis.evidence.source==="mock"?"모의 브리지 회신 · 실측 증거 아님"
    :diagnosis.evidence.source==="dt"?"DT 시뮬레이터 관측 좌표":"학생 예측 좌표";
  return <section className="square-diagnosis" data-type={diagnosis.type} data-level={plan.level} aria-label="실행 결과와 과제 조건 비교" data-testid="square-diagnosis">
    <p className="square-diagnosis-source">{sourceLabel}</p>
    <p className="square-diagnosis-level">{plan.levelLabel}</p>
    <h4>{diagnosis.label}</h4>
    {mismatch && edges.length > 0 && diagnosis.type !== "model-real" && <div className="square-diagnosis-table" tabIndex={0} aria-label="변별 과제 조건과 로봇이 그린 변">
      <table>
        <thead><tr><th scope="col">변</th><th scope="col">과제 조건</th><th scope="col">로봇이 그린 변</th></tr></thead>
        <tbody>{edges.map((edge,index) => {
          const want = edge.condition.axis === "X" ? {dx:edge.condition.delta,dy:0} : {dx:0,dy:edge.condition.delta};
          const same = Math.abs(want.dx-edge.executed.dx) <= 0.1 && Math.abs(want.dy-edge.executed.dy) <= 0.1;
          return <tr key={edge.edge} data-focus={diagnosis.edgeIndex === index+1 || undefined} data-same={same}>
            <th scope="row">{edge.edge}</th>
            <td>{signedLength(edge.condition.delta, edge.condition.axis)}</td>
            <td>{executedEdge(edge.executed.dx, edge.executed.dy)}<small>{same ? "같음" : "다름"}</small></td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
    {measured && <p className="square-diagnosis-measured">실측 꼭짓점 {measured.count}개 · 평균 오차 {fmt(measured.meanError)} mm · 최대 {fmt(measured.maxError)} mm · 평균 어긋남 (ΔX {fmt(measured.meanOffset.x)}, ΔY {fmt(measured.meanOffset.y)}) mm</p>}
    <p className="square-diagnosis-question">{plan.question}</p>
    {plan.relationHint && <p className="square-diagnosis-hint"><strong>관계 힌트</strong> {plan.relationHint}</p>}
    {plan.example && <p className="square-diagnosis-example">{plan.example}</p>}
    {plan.teacherFlag && <p className="square-diagnosis-teacher" role="status">같은 차이가 반복되어 선생님 화면에 도움 요청을 표시했어요.</p>}
    {onCauseChange && <label className="square-diagnosis-cause">
      {causeRequired ? "차이가 생긴 이유 (예측을 고치기 전에 적어 주세요)" : plan.level === "self-regulation" ? "다음 과제에서 미리 점검할 방법 (선택)" : "차이가 생긴 이유 (선택)"}
      <textarea aria-label="차이가 생긴 이유" rows={2} maxLength={1000} disabled={disabled} value={cause ?? ""}
        onChange={event => onCauseChange(event.target.value)}
        placeholder={mismatch ? "예: 가로는 X 방향인데 세로 길이를 X에 더했다." : "예: 각 변에서 변하는 축을 먼저 표시하고 계산한다."}/>
    </label>}
  </section>;
}
