import { useState } from "react";
import { learningRecordContext } from "./learningFramework";
import { readEvidence, writeEvidence, downloadEvidence } from "./learningEvidenceStorage";
import { compareMeasurements, measurementRmse, type MeasurementReview, type MeasurementPlan, type ReviewSample } from "./measurementReview";

const KEY="physical-ai-measurement-feedback-v1";
let backupFailed=false;
const records=readEvidence<MeasurementReview>(KEY,(v):v is MeasurementReview=>{
  if(!v||typeof v!=="object")return false;
  const r=v as MeasurementReview;
  return typeof r.id==="string"&&typeof r.problemId==="string"&&["hardware","virtual"].includes(r.source)&&Array.isArray(r.plans)&&
    Array.isArray(r.samples)&&r.samples.every(s=>s.target&&s.actual&&[s.target.x,s.target.y,s.target.z,s.actual.x,s.actual.y,s.actual.z].every(Number.isFinite));
});
/** Register only a completed run; the previous plan is frozen before its new result is reviewed. */
export function registerMeasurementReview(id:string,problemId:string,source:MeasurementReview["source"],samples:ReviewSample[]) {
  if(records.some(r=>r.id===id))return;
  const sessionId=learningRecordContext(source).sessionId;
  const previous=records.filter(r=>r.problemId===problemId&&r.sessionId===sessionId).at(-1);
  records.push({id,problemId,source,sessionId,at:new Date().toISOString(),samples:JSON.parse(JSON.stringify(samples)),
    previousId:previous?.id,previousPlan:previous?.plans.at(-1),plans:[]});
  backupFailed=!writeEvidence(KEY,records);
}

export function MeasurementFeedbackReview({trialId,locked}:{trialId:string;locked:boolean}) {
  const [version,setVersion]=useState(0);
  const [evidence,setEvidence]=useState("");
  const [action,setAction]=useState<MeasurementPlan["action"]|"">("");
  const [prediction,setPrediction]=useState<MeasurementPlan["prediction"]|"">("");
  const [notice,setNotice]=useState("");
  const [storageFailed,setStorageFailed]=useState(backupFailed);
  const record=records.find(r=>r.id===trialId);
  if(!record)return null;
  const previous=records.find(r=>r.id===record.previousId),comparison=compareMeasurements(record,previous);
  const save=()=>{
    if(locked||!action||!prediction||!evidence.trim())return;
    record.plans.push({at:new Date().toISOString(),evidence:evidence.trim(),action,prediction});
    backupFailed=!writeEvidence(KEY,records);setStorageFailed(backupFailed);setVersion(version+1);setNotice("근거와 다음 확인 계획을 저장했습니다. 아래 실행 버튼으로 직접 확인하세요.");
  };
  const labels={smaller:"작아진다",similar:"비슷하다",larger:"커진다",unknown:"아직 방향을 판단하기 어렵다"};
  return <section className="lesson-card math-inquiry" aria-label="측정 피드백과 다음 검증">
    <h3>오차를 보고 다음 확인을 계획하세요</h3>
    <p>이번 거리오차 RMSE: {measurementRmse(record.samples)?.toFixed(2)??"계산 불가"} mm. 오차는 측정값 − 목표값입니다. 값이 작다는 사실만으로 원인을 확정하지 않습니다.</p>
    {previous&&<div className="lesson-feedback">
      <strong>지난 계획과 이번 결과</strong>
      {record.previousPlan&&<p>지난 근거: {record.previousPlan.evidence}<br/>예상: RMSE가 {labels[record.previousPlan.prediction]}</p>}
      {comparison.comparable?<><p>같은 목표·자료 출처에서 RMSE {comparison.before.toFixed(2)} → {comparison.after.toFixed(2)} mm</p>
        <p>{comparison.predictionConsistent===null?"이 변화의 의미를 근거와 함께 설명하세요.":comparison.predictionConsistent?"예상한 방향과 수치 변화가 일치합니다.":"예상한 방향과 수치 변화가 다릅니다. 가설이나 확인 방법을 다시 검토하세요."} 한 번의 변화로 원인이 입증되지는 않습니다. ‘비슷함’은 0.01 mm 표시값 기준입니다.</p></>:<p>{comparison.reason}</p>}
    </div>}
    {record.source==="virtual"&&<p className="lesson-note">가상값으로는 해석 절차를 연습합니다. 실제 피드백 순환의 확인에는 장비 측정과 반복 검증이 필요합니다.</p>}
    <label>어느 점·축의 값을 근거로, 어떤 원인을 확인하고 싶나요?
      <textarea aria-label="측정 근거와 가설" rows={2} maxLength={1000} disabled={locked} value={evidence} onChange={e=>setEvidence(e.target.value)}/></label>
    <label>다음에 확인할 방법<select aria-label="다음 검증 방법" disabled={locked} value={action} onChange={e=>setAction(e.target.value as MeasurementPlan["action"])}>
      <option value="">선택하세요</option><option value="repeat">같은 조건으로 다시 측정해 반복되는지 확인</option>
      <option value="reference">원점·TCP 높이 기준을 확인한 뒤 다시 측정</option><option value="revise">명령 조건 하나를 수정하고 DT부터 다시 검증</option>
    </select></label>
    <label>같은 기준으로 다시 측정하면 RMSE가 어떻게 될까요?<select aria-label="재측정 예상" disabled={locked} value={prediction} onChange={e=>setPrediction(e.target.value as MeasurementPlan["prediction"])}>
      <option value="">선택하세요</option>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}
    </select></label>
    <button disabled={locked||!evidence.trim()||!action||!prediction} onClick={save}>근거·다음 확인 계획 저장</button>
    {notice&&<p role="status">{notice}</p>}
    <p className="lesson-note">계획 저장으로 장비가 움직이지는 않습니다. 좌표를 고쳤다면 DT 검증을 먼저 진행하세요. 원인 설명은 교사가 검토합니다.</p>
    <details><summary>측정·계획 기록 {records.length}회</summary>
      {record.plans.map((p,i)=><p key={i}>계획 {i+1}: {p.evidence} · 예상 {labels[p.prediction]}</p>)}
      <button onClick={()=>downloadEvidence("measurement-feedback.json",{...learningRecordContext(record.source),records})}>측정 피드백 기록 내려받기</button>
    </details>
    {storageFailed&&<p role="alert">브라우저 저장에 실패했습니다. 새로고침 전에 측정 피드백 기록을 내려받으세요.</p>}
  </section>;
}
