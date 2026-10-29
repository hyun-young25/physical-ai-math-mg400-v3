import { useEffect,useState } from "react";
import { readEvidence,writeEvidence } from "./learningEvidenceStorage";
import { getLearningUser } from "./learningClient";
import { squareEvidenceTag,type SquareVisual } from "./squareComparisonVisual";
import { SquareDiagnosisPanel } from "./SquareDiagnosisPanel";
import { squareDiagnosisName } from "./squareMismatchDiagnosis";
export const SQUARE_ATTEMPT_KEY="physical-ai-square-attempts-v1";
export type SquareAttempt={
 id:string;task:"square-attempt";recordId:string;runId:string;studentId?:string;visitId?:string;taskVersion:string;
 taskIndex:number;supportMode:"guided"|"challenge";attempt:number;predictions:unknown;predictionReason:string;
 observed:unknown;source:string;diagnosisType:string;edge?:string;feedbackLevel:string;teacherFlag:boolean;
 questionSource:string;questionText:string;questions:{source:string;text:string;at?:string}[];
 studentCause:string;meanError?:number;maxError?:number;createdAt:string;visual:SquareVisual;
};
export type AttemptDraft=Omit<SquareAttempt,"task"|"studentId"|"visitId"|"attempt"|"questions"|"questionSource"|"questionText"|"diagnosisType"|"feedbackLevel"|"teacherFlag"|"source"|"edge"|"meanError"|"maxError">;
const valid=(x:unknown):x is SquareAttempt=>!!x&&typeof x==="object"&&(x as SquareAttempt).task==="square-attempt";
export const readSquareAttempts=()=>readEvidence(SQUARE_ATTEMPT_KEY,valid);
export function displayedQuestions(key:string){
 const rows=readEvidence<any>("physical-ai-inquiry-feedback-v1",(x):x is any=>!!x&&typeof x==="object");
 return rows.filter(r=>r.feedbackStatus==="displayed"&&r.feedback?.provider==="openai"&&!r.feedback.failureReason&&r.prediction&&squareEvidenceTag(r.prediction)?.key===key)
 .map(r=>({source:"openai",text:String(r.feedback.text),at:r.feedback.createdAt}));
}
export function saveSquareAttempt(draft:AttemptDraft):boolean{
 const rows=readSquareAttempts(),prior=rows.find(r=>r.id===draft.id),u=getLearningUser(),v=draft.visual,d=v.diagnosis;
 const questions=[{source:"rules",text:v.plan?.question??"이번 관계를 다음 과제에서도 확인하려면 무엇을 먼저 점검할까요?"},...(prior?.questions.filter(q=>q.source==="openai")??[]),...displayedQuestions(v.feedbackKey)].filter((q,i,a)=>a.findIndex(p=>p.source===q.source&&p.text===q.text&&("at" in p?p.at:undefined)===("at" in q?q.at:undefined))===i);
 const next:SquareAttempt={...structuredClone(draft),task:"square-attempt",studentId:u?.id,visitId:u?.visitId,
 attempt:prior?.attempt??1+rows.filter(r=>r.taskIndex===draft.taskIndex&&r.taskVersion===draft.taskVersion).length,
 createdAt:prior?.createdAt??draft.createdAt,diagnosisType:d.type,source:d.evidence.source,edge:d.edge,
 feedbackLevel:v.plan?.level??"self-regulation",teacherFlag:v.plan?.teacherFlag??false,
 questions,questionSource:questions.map(q=>q.source).filter((x,i,a)=>a.indexOf(x)===i).join("+"),
 questionText:questions.map(q=>q.text).join("\n"),meanError:d.evidence.measured?.meanError,maxError:d.evidence.measured?.maxError};
 if(JSON.stringify(prior)===JSON.stringify(next))return true;
 return writeEvidence(SQUARE_ATTEMPT_KEY,prior?rows.map(r=>r.id===next.id?next:r):[...rows,next]);
}
export function useSquareAttemptHistory(owner:string,taskIndex:number,draft:AttemptDraft|null,locked:boolean){
 const [rows,setRows]=useState(readSquareAttempts),[selected,setSelected]=useState<string|null>(null),[failed,setFailed]=useState(false);
 const [,refreshQuestions]=useState(0);
 useEffect(()=>{const changed=(event:Event)=>{if((event as CustomEvent).detail?.key==="physical-ai-inquiry-feedback-v1")refreshQuestions(n=>n+1);};window.addEventListener("learning-evidence-written",changed);return()=>window.removeEventListener("learning-evidence-written",changed);},[]);
 const provided=draft?displayedQuestions(draft.visual.feedbackKey):[],questionKey=JSON.stringify(provided);
 const key=JSON.stringify(draft);
 const capture=()=>{if(!draft)return;const ok=saveSquareAttempt(draft);setFailed(!ok);if(ok)setRows(readSquareAttempts());};
 useEffect(()=>{capture();},[key,questionKey]);
 useEffect(()=>{setSelected(null);setRows(readSquareAttempts());},[taskIndex]);
 useEffect(()=>{const f=(event:Event)=>{const e=(event as CustomEvent).detail;if(e?.owner===owner&&!locked)setSelected(e.id||null);};window.addEventListener("square-attempt-review",f);return()=>window.removeEventListener("square-attempt-review",f);},[owner,locked]);
 const items=rows.filter(r=>r.taskIndex===taskIndex),reviewed=items.find(r=>r.id===selected)??null;
 return {items,reviewed,failed,capture,gptQuestion:[...(rows.find(r=>r.id===draft?.id)?.questions.filter(q=>q.source==="openai")??[]),...provided].filter((q,i,a)=>a.findIndex(p=>p.text===q.text&&p.at===q.at)===i).map(q=>q.text).join("\n"),select:(id:string|null)=>{if(!locked)setSelected(id);},meta:{owner,selected:reviewed?.id??"",items:items.map(r=>({id:r.id,label:"시도 "+r.attempt+" · "+squareDiagnosisName(r.visual.diagnosis,r.visual.connectedVerticesOnly)}))}};
}
export function SquareAttemptHistory({history,locked}:{history:ReturnType<typeof useSquareAttemptHistory>;locked:boolean}){
 return <section className="square-attempt-history"><h3>시도별 기록 · 읽기 전용 비교</h3>
 {history.failed&&<p role="alert">시도 기록 저장에 실패했습니다. 화면을 닫기 전에 학습 기록을 내려받으세요.</p>}
 <button disabled={locked} onClick={()=>history.select(null)} aria-pressed={!history.reviewed}>현재 시도로 돌아가기</button>
 {history.items.map(r=><button key={r.id} disabled={locked} aria-pressed={history.reviewed?.id===r.id} onClick={()=>history.select(r.id)}>시도 {r.attempt} · {squareDiagnosisName(r.visual.diagnosis,r.visual.connectedVerticesOnly)} · {r.feedbackLevel}<small>{r.studentCause||"원인 가설 작성 전"}</small></button>)}
 {!history.items.length&&<p>비교를 완료한 새 시도부터 표시합니다. 이전 기록은 기존 내보내기에 보존됩니다.</p>}
 </section>;
}
export function SquareAttemptReview({attempt}:{attempt:SquareAttempt}){
 const v=attempt.visual;
 return <section data-testid="square-attempt-review"><h3>시도 {attempt.attempt} · 저장된 결과</h3><p>{attempt.taskVersion} · {attempt.createdAt} · 읽기 전용</p>
 <SquareDiagnosisPanel diagnosis={v.diagnosis} plan={v.plan} targetVertices={v.target} observedVertices={v.observed} toleranceMm={v.toleranceMm} connectedOnly={v.connectedVerticesOnly} priorSameType={v.priorSameType} supportMode={v.supportMode} cause={attempt.studentCause} gptQuestion={attempt.questions.filter(q=>q.source==="openai").map(q=>q.text).join("\n")}/>
 <details><summary>당시 예측·근거·관측 원문</summary><pre>{JSON.stringify({predictions:attempt.predictions,predictionReason:attempt.predictionReason,observed:attempt.observed},null,2)}</pre></details></section>;
}
