import type { LearningFeedbackInput } from "@workspace/api-client-react";
import type { InquiryField, InquiryRecord } from "./MathInquiry";

export type FeedbackContext = Omit<LearningFeedbackInput,"visitId"|"trigger">;
// Strict selection excludes account IDs, names, network addresses and raw packets.
const excluded = /name|login|email|phone|contact|account|student|visit|token|secret|password|session|ip$|url|host|socket|raw|packet/i;
export function privateText(s:string) {
  return s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[이메일 제외]")
    .replace(/(?:\+82[- ]?)?0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}/g,"[연락처 제외]")
    .replace(/(?:제\s*이름은|이름\s*[:=]|성명\s*[:=])\s*[가-힣A-Za-z ]{2,20}/g,"[이름 제외]");
}
function clean(v:unknown,depth=0):unknown {
  if(depth>7)return "[상세 생략]";
  if(typeof v==="string")return privateText(v).slice(0,1500);
  if(v===null||typeof v==="number"||typeof v==="boolean")return v;
  if(Array.isArray(v))return v.slice(-12).map(x=>clean(x,depth+1));
  if(v&&typeof v==="object")return Object.fromEntries(Object.entries(v).filter(([k])=>!excluded.test(k)).slice(0,40).map(([k,x])=>[k,clean(x,depth+1)]));
  return undefined;
}
const json=(value:unknown,max:number)=>JSON.stringify(clean(value)??null).slice(0,max);
function problemOnly(v:unknown):unknown {
  if(Array.isArray(v))return v.map(problemOnly);
  if(v&&typeof v==="object")return Object.fromEntries(Object.entries(v)
    .filter(([key])=>!["support","guidanceBeforePrediction","supportMode"].includes(key))
    .map(([key,value])=>[key,problemOnly(value)]));
  return v;
}
export function feedbackProblemKey(c:FeedbackContext) {
  try{return JSON.stringify([c.task,problemOnly(JSON.parse(c.condition))]);}
  catch{return c.task+c.condition;}
}
export function makeFeedbackContext(input:{
  task:string;condition:unknown;fields:InquiryField[];answers:Record<string,string>;reason:string;
  record:InquiryRecord|null;history:InquiryRecord[];judgment?:unknown;
  reviewDraft?:Record<string,string>;reasonRevision?:string;
}):FeedbackContext {
  const {task,condition,fields,record,history}=input;
  const same=history.filter(r=>JSON.stringify(problemOnly(r.condition??JSON.parse(r.conditionKey)))===JSON.stringify(problemOnly(condition)));
  const initial=same[0]??record;
  const reviewed=record?.answerReviews?.at(-1)?.answers;
  const editingSquarePrediction=task==="square"&&record&&fields.some(field=>input.answers[field.key]!==record.prediction[field.key]);
  const answers=editingSquarePrediction?input.answers:record ? reviewed??record.prediction : input.answers;
  const reason=record?.explanationReviews?.filter(r=>r.phase==="revision").at(-1)?.text??record?.reason??input.reason;
  const pendingAnswers=!!record&&Object.entries(input.reviewDraft??{}).some(([key,value])=>answers[key]!==value);
  const pendingReason=!!record&&!!input.reasonRevision?.trim()&&input.reasonRevision.trim()!==reason.trim();
  const support=(condition as {support?:string})?.support;
  return {
    task,condition:json({condition,fields,scope:task==="foundation"
      ? "일부 높이·벡터·거리 문항만 기존 실행 버튼 지원. 나머지는 수학 확인만."
      : "이 화면의 기존 실행 버튼 범위만 지원. 가상 계산을 실측으로 간주하지 않음."},6000),
    answers:json(pendingAnswers?{...answers,...input.reviewDraft}:answers,3000),
    reason:privateText(pendingReason?input.reasonRevision!:reason).slice(0,1500),
    initialPrediction:json({answers:initial?.prediction??answers,reason:initial?.reason??reason},3000),
    history:json(same.slice(-5).map(r=>({prediction:r.prediction,reason:r.reason,answerReviews:r.answerReviews,
      explanationReviews:r.explanationReviews?.map(e=>({text:e.text,phase:e.phase})),runs:r.runs.map(run=>({action:run.action,status:run.status,summary:run.summary}))})),6000),
    judgment:json(pendingAnswers||pendingReason?{status:"수정 입력 중 · 이 입력의 정오 미확정"}:
      input.judgment??{status:"기존 판정 전 · 정오 미확정"},2000),
    execution:json(record?.runs.slice(-4).map(r=>({
      action:r.action,status:r.status,startedAt:r.startedAt,endedAt:r.endedAt,summary:r.summary,
      // 'expected' is mathematical confirmation, NOT sensor data.
      mathematicalConfirmation:r.expected,details:r.detail,
    }))??[],10000),
    support:support==="challenge"||support==="independent"?"challenge":"guided",
    attempts:Math.min(1000,same.length),
  };
}
export const feedbackVersion=(c:FeedbackContext)=>JSON.stringify([c.task,c.condition,c.answers,c.reason,c.execution,c.judgment,c.support,c.attempts]);
export function hasFeedbackExecution(execution:string):boolean {
  try {
    const value=JSON.parse(execution);
    const results=value&&typeof value==="object"&&"results" in value?value.results:value;
    return Array.isArray(results)?results.length>0:!!results&&typeof results==="object"&&Object.keys(results).length>0;
  }catch{return false;}
}
/** Adapter for the existing coordinate lesson records, which have a different shape. */
export function numericFeedbackContext(input:{
  task:string;condition:unknown;answers:unknown;reason:string;initial?:unknown;history:unknown[];
  execution:unknown;judgment:unknown;challenge?:boolean;
}):FeedbackContext {
  return {task:input.task,condition:json({problem:input.condition,scope:"가상 DT 전용 · 실장비 실행 미지원",
    coordinateSystem:"로봇 기준 (X,Y,Z)",units:"위치 mm, 회전 degree"},6000),
    answers:json(input.answers,3000),reason:privateText(input.reason).slice(0,1500),
    initialPrediction:json(input.initial??{answers:input.answers,reason:input.reason},3000),
    history:json(input.history.slice(-4),6000),judgment:json(input.judgment,2000),
    execution:json({source:"virtual",measurement:false,results:input.execution},10000),
    support:input.challenge?"challenge":"guided",attempts:Math.min(1000,input.history.length)};
}
export function localFeedback(c:FeedbackContext, result=false):string {
  if(result||/예상.*결과|예측.*결과|측정|실행.*비교/.test(c.question??"")){
    if(!hasFeedbackExecution(c.execution))return "아직 전달된 실행 결과나 측정값이 없습니다. 예측의 기준점·좌표계·단위를 확인하고, 실제 이동했다고 판단하지 마세요.";
    const state=/unavailable|blocked|차단|미연결|불일치/.test(c.execution)?"차단·미완료가 포함된 자료입니다.":
      /stopped|cancel|취소|중단/.test(c.execution)?"취소·중단이 포함된 자료입니다.":/completed/.test(c.execution)?"완료로 기록된 자료입니다.":"전달된 실행 자료를 참고합니다.";
    const sources=[/"source"\s*:\s*"(virtual|dt)"/.test(c.execution)?"가상":null,
      /"source"\s*:\s*"(mock|test)"/.test(c.execution)?"시험용":null,
      /"source"\s*:\s*"hardware"/.test(c.execution)?"실장비 경로(실측 완료 여부 별도 확인)":null].filter(Boolean);
    return `${sources.length?`출처: ${sources.join("·")}. `:""}${state} 실측·가상·시험용 출처와 측정 시점부터 확인하세요. 확보된 전후 위치와 최초 예측은 같은 좌표계·단위에서 어떤 차이가 있나요? 차단이나 값 누락은 수학 오답이 아닙니다.`;
  }
  if(/왜.*틀|오답/.test(c.question??"")&&!/incorrect|"matched"\s*:\s*false/.test(c.judgment))return "아직 전달된 오답 판정이 없습니다. 기존 답 확인을 먼저 이용하고 확인된 항목과 풀이를 비교해 보세요.";
  if(/"status"\s*:\s*"correct"|"matched"\s*:\s*true/.test(c.judgment)&&!/incorrect|"matched"\s*:\s*false/.test(c.judgment))return "기존 수학 판정에서 확인된 항목을 기준으로 풀이를 점검하세요. 실행은 이 과제의 기존 실행 버튼과 안전 검사·학생 확인 절차에서만 진행하며, 채팅으로 장비를 움직이지 않습니다.";
  if(!c.reason.trim())return "어떤 식이나 기준으로 이 수치를 정했나요? 입력한 이유를 한 줄로 적어 주세요.";
  if(/height/.test(c.condition))return c.support==="challenge"
    ? "목표 높이와 이동량은 같은 뜻인가요?"
    : "현재 높이와 목표 높이를 먼저 구분하세요. 이동량은 ‘목표 위치 − 현재 위치’입니다. 입력한 값은 도착 위치인가요, 변화량인가요?";
  return c.support==="challenge"?"입력값의 기준점·단위·부호를 어떻게 확인했나요?"
    :"기준점과 좌표계·단위를 찾고, 입력한 값이 위치인지 변화량인지 구분해 보세요. 기존 판정에서 확인할 한 항목을 식과 연결해 볼까요?";
}
