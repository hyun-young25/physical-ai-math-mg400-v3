import type { PaperCoordinateStudyViewState } from "./paperCoordinateViewModel";
import { SquareComparisonDiagram,SquareEdgeBars,SquareFeedbackProgress,SquareReplayControls } from "./SquareComparisonView";
import { PAPER_PATTERN_LABELS } from "./paperRectangleTask";
import { useSquareVisual } from "./useSquareVisual";
import { fmtSquare } from "./squareComparisonVisual";
export function PaperDiagnosisVisual({state}:{state:PaperCoordinateStudyViewState}){
  const shared=useSquareVisual(),v=state.comparison,d=state.diagnosis,e=state.transformEstimate;
  if(!v)return null;
  return <section className="square-diagnosis paper-diagnosis-visual" data-type={d?.pattern} data-testid="paper-diagnosis-visual">
    <p className="square-diagnosis-source">{state.run?.source==="hardware"?"실장비 GetPose · 제어기 보고 TCP 좌표":state.run?.source==="mock"?"모의 브리지 관측 · 실측 아님":"DT 좌표 · 실측 아님"} · 종이 기준 {state.frame?.source==="teacher"?"교사 입력 · 실측 아님":state.frame?.source}</p>
    <div className="square-visual-summary" data-emphasized={!!shared.emphasis||undefined}>
      <h3 className="square-type-badge">{d?.pattern?PAPER_PATTERN_LABELS[d.pattern]:"목표와 관측 꼭짓점 비교"}</h3>
      <div className="square-visual-comparison">
        <div><p>변 이동량 · 종이 축 기준 (mm)</p><SquareEdgeBars diagnosis={v.diagnosis}/></div>
        <SquareComparisonDiagram target={v.target} observed={v.observed} diagnosis={v.diagnosis} compact emphasized={!!shared.emphasis} connectedOnly matches={v.match}/>
      </div>
    </div>
    <p className="pcv-note">네 꼭짓점의 연결선입니다. 연속 선·닫힘·잉크 위치를 측정한 결과가 아닙니다.</p>
    {e&&<div className="paper-transform-estimate" data-testid="paper-transform-estimate">
      <strong>관측 변환 추정</strong>
      <p>평균 이동 {fmtSquare(e.translationMm)} mm · 배율 X {e.scaleX.toFixed(3)} / Y {e.scaleY.toFixed(3)} · 회전 {fmtSquare(e.relativeAngle)}°</p>
      <small>회전은 종이 축 대비 값 · 기준점에서 읽은 종이 방향 {fmtSquare(e.paperAngle)}° · 평균 ΔX {fmtSquare(e.dx)}, ΔY {fmtSquare(e.dy)} mm</small>
    </div>}
    {d&&<><p className="square-diagnosis-question"><strong>확인 질문</strong>{d.question}</p>
      <SquareFeedbackProgress plan={v.plan} match={d.pattern==="match"} priorSameType={state.priorSameType}/>
      {d.supportLevel===3&&d.pattern!=="match"&&<p>🔔 예시를 확인하고 선생님과 함께 검산해 보세요.</p>}
    </>}
    {state.stage===6&&<SquareReplayControls/>}
  </section>;
}
