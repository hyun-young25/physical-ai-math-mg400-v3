import type { PaperCoordinateStudyViewState } from "./paperCoordinateViewModel";
import { SquareDiagnosisPanel } from "./SquareDiagnosisPanel";
import { SquareReplayControls } from "./SquareComparisonView";
export function PaperDiagnosisVisual({state,cause,onCauseChange,onSaveCause}:{state:PaperCoordinateStudyViewState;cause?:string;onCauseChange?:(s:string)=>void;onSaveCause?:()=>void}){
 const v=state.comparison;if(!v)return null;
 return <div data-testid="paper-diagnosis-visual"><SquareDiagnosisPanel diagnosis={v.diagnosis} plan={v.plan}
 gptQuestion={state.gptQuestion} connectedOnly targetVertices={v.target} observedVertices={v.observed} toleranceMm={v.toleranceMm} priorSameType={v.priorSameType} supportMode={v.supportMode}
 cause={cause??state.studentHypothesis} onCauseChange={onCauseChange} disabled={state.running} causeRequired={v.diagnosis.type!=="match"&&v.diagnosis.type!=="model-real"}>
 {onSaveCause&&<button type="button" className="pcv-button pcv-button--primary" disabled={state.running} onClick={onSaveCause}>생각 저장</button>}
 </SquareDiagnosisPanel>
 <p className="pcv-note">변 수치는 종이 축 기준, 비교도는 로봇 좌표 기준입니다. 선은 네 꼭짓점의 연결이며 연속 경로·닫힘·잉크 측정이 아닙니다.</p>
 {state.rotationAllowed&&state.transformEstimate&&<p data-testid="paper-transform-estimate">선택 심화 · 관측 회전 {state.transformEstimate.relativeAngle.toFixed(1)}° · 배율 X {state.transformEstimate.scaleX.toFixed(3)} / Y {state.transformEstimate.scaleY.toFixed(3)}</p>}
 {state.stage===6&&<SquareReplayControls/>}</div>;
}
