export type ReviewPoint={x:number;y:number;z:number;r?:number};
export type ReviewSample={label:string;target:ReviewPoint;actual:ReviewPoint};
export type MeasurementPlan={at:string;evidence:string;action:"repeat"|"reference"|"revise";prediction:"smaller"|"similar"|"larger"|"unknown"};
export type MeasurementReview={
  id:string;sessionId:string;problemId:string;source:"hardware"|"virtual";at:string;
  samples:ReviewSample[];previousId?:string;previousPlan?:MeasurementPlan;plans:MeasurementPlan[];
};
export function measurementRmse(samples:ReviewSample[]) {
  if(!samples.length)return null;
  const squares=samples.map(s=>(s.actual.x-s.target.x)**2+(s.actual.y-s.target.y)**2+(s.actual.z-s.target.z)**2);
  return squares.every(Number.isFinite)?Math.sqrt(squares.reduce((a,b)=>a+b,0)/squares.length):null;
}
export function compareMeasurements(current:MeasurementReview,previous:MeasurementReview|undefined) {
  if(!previous)return {comparable:false,reason:"첫 측정입니다. 근거와 다음 확인 계획을 남기세요."} as const;
  if(current.source!==previous.source)return {comparable:false,reason:"자료 출처가 달라 개선 전후로 비교하지 않습니다."} as const;
  if(current.source==="virtual")return {comparable:false,reason:"가상 연습값은 정해진 패턴을 사용합니다. 재실행으로 실제 장비의 개선이나 원인을 검증할 수 없습니다."} as const;
  const sameTargets=current.samples.length===previous.samples.length&&current.samples.every((s,i)=>
    s.label===previous.samples[i].label&&(["x","y","z","r"] as const).every(axis=>(s.target[axis]??0)===(previous.samples[i].target[axis]??0)));
  if(current.problemId!==previous.problemId||!sameTargets)
    return {comparable:false,reason:"목표 또는 경로 조건이 달라졌습니다. RMSE의 증감만으로 개선을 판단하지 마세요."} as const;
  const before=measurementRmse(previous.samples),after=measurementRmse(current.samples);
  if(before===null||after===null)return {comparable:false,reason:"비교 가능한 완료 측정값이 없습니다."} as const;
  const difference=after-before;
  const change=Math.round(after*100)===Math.round(before*100)?"similar":difference<0?"smaller":"larger";
  const prediction=current.previousPlan?.prediction;
  return {comparable:true,before,after,difference,change,predictionConsistent:!prediction||prediction==="unknown"?null:prediction===change} as const;
}
