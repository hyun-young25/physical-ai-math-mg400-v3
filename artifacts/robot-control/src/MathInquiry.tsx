import { assessExplanation, type ExplanationAssessment } from "./explanationFeedback";
import { ExplanationFeedback } from "./ExplanationFeedbackPanel";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { learningRecordContext } from "./learningFramework";
import { parseLessonNumber } from "./curriculum";
import { inquiryGuidance } from "./inquiryFeedback";
import { readEvidence, writeEvidence, downloadEvidence } from "./learningEvidenceStorage";
import { recordLearningAction } from "./learningSync";
import { LearningJudgmentFields, emptyJudgment, judgmentComplete, sameJudgment, learningTaskKind, reflectionRequired, type LearningJudgment, type LearningTaskKind } from "./LearningJudgment";
import { LearningAiFeedback, useLearningAi } from "./LearningAiFeedback";
import { makeFeedbackContext } from "./learningAiContext";

export type InquiryField = { key:string; label:string; unit?:string; options?:{value:string;label:string}[] };
export type Evidence = { action:string; status:"running"|"completed"|"unavailable"|"stopped"; startedAt:string;
  endedAt?:string; summary?:string; expected?:Record<string,number|string>; detail?:unknown };
export type ExplanationEntry = { text:string; at:string; runCount:number; phase:"initial"|"revision"; answers:Record<string,string>; assessment:ExplanationAssessment };
export type InquiryRecord = ReturnType<typeof learningRecordContext> & {
  taskVersion?:string; id:string; task:string; conditionKey:string; condition:unknown; fields:InquiryField[];
  prediction:Record<string,string>; reason:string; submittedAt:string; previousId?:string;
  attemptKind:"initial"|"revision"|"changed-condition";
  independentPrediction?:boolean;
  taskKind?:LearningTaskKind;
  runs:Evidence[]; reflections:{text:string;at:string;runCount:number;review:"teacher"|"learner";assessment?:ExplanationAssessment;teacherReviewRequested?:boolean;unresolved?:boolean;answers?:Record<string,string>;judgment?:LearningJudgment}[];
  observations?:{text:string;at:string;runCount:number;acknowledged?:boolean}[];
  explanationReviews?:ExplanationEntry[];
  answerReviews?:{answers:Record<string,string>;at:string;runCount:number}[];
  feedbackEvents?:{kind:"hint"|"guided-check"|"answer-review"|"revise"|"transfer";at:string;runCount:number;keys:string[]}[];
  /** Rule-based prediction–execution diagnosis shown after a run, with the learner's cause explanation. */
  mismatchDiagnoses?:MismatchDiagnosisEntry[];
};
export type MismatchDiagnosisEntry={runCount:number;at:string;type:string;edge?:string;label:string;
  level:string;question:string;relationHint?:string;supportMode:string;priorSameType:number;teacherFlag:boolean;
  evidence:unknown;source?:"dt"|"hardware"|"mock";causeExplanation?:string;explainedAt?:string};
const now=()=>new Date().toISOString();
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v));
const STORAGE_KEY="physical-ai-inquiry-evidence-v1";
const memory:InquiryRecord[]=readEvidence<InquiryRecord>(STORAGE_KEY,(v):v is InquiryRecord=>{
  if(!v||typeof v!=="object")return false;
  const r=v as InquiryRecord;
  return typeof r.id==="string"&&typeof r.task==="string"&&typeof r.reason==="string"&&!!r.prediction&&
    Array.isArray(r.fields)&&r.fields.every(f=>typeof f.key==="string"&&typeof f.label==="string")&&
    Array.isArray(r.runs)&&r.runs.every(run=>typeof run.action==="string"&&typeof run.status==="string")&&Array.isArray(r.reflections)&&
    (!r.explanationReviews||Array.isArray(r.explanationReviews))&&(!r.answerReviews||Array.isArray(r.answerReviews))&&(!r.feedbackEvents||Array.isArray(r.feedbackEvents));
}).map(r=>({...r,runs:r.runs.map(run=>run.status==="running"?{...run,status:"stopped",endedAt:now(),summary:"새로고침으로 실행이 중단되었습니다."}:run)}));
// Interrupted runs must reach the server even if the learner performs no next action.
if (memory.some(r=>r.runs.some(run=>run.summary==="새로고침으로 실행이 중단되었습니다."))) writeEvidence(STORAGE_KEY,memory);
/** Geometric path difference, independent of how quickly each path is traversed. */
export function maximumLineDeviation(points:{x:number;y:number;z:number}[],a:{x:number;y:number;z:number},b:{x:number;y:number;z:number}) {
  const d={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z},length2=d.x*d.x+d.y*d.y+d.z*d.z;
  return Math.max(0,...points.map(p=>{
    const t=length2===0?0:Math.max(0,Math.min(1,((p.x-a.x)*d.x+(p.y-a.y)*d.y+(p.z-a.z)*d.z)/length2));
    return Math.hypot(p.x-a.x-t*d.x,p.y-a.y-t*d.y,p.z-a.z-t*d.z);
  }));
}
export function compareInquiry(record:InquiryRecord, answers=record.prediction) {
  const expected=Object.assign({},...latestInquiryRuns(record).filter(r=>r.status==="completed"||r.status==="unavailable").map(r=>r.expected??{}));
  return record.fields.filter(f=>expected[f.key]!==undefined).map(f=>{
    const result=expected[f.key] as number|string, raw=answers[f.key]??"";
    const value=typeof result==="number"?parseLessonNumber(raw):raw;
    return {...f,prediction:raw,result,matched:typeof result==="number"?value!==null&&Math.abs(Number(value)-result)<=0.1:value===result};
  });
}
export function currentInquiryComparison(record:InquiryRecord) {
  const reviewed=record.answerReviews?.filter(r=>r.runCount===record.runs.length).at(-1);
  return compareInquiry(record,reviewed?.answers??record.prediction);
}
export function latestInquiryRuns(record:InquiryRecord) {
  return [...new Map(record.runs.map(r=>[r.action,r])).values()];
}
export function explanationContext(record:InquiryRecord,answers=record.prediction,purpose:"prediction"|"reflection"="prediction") {
  return {condition:record.condition,purpose,fields:record.fields,answers,expected:Object.assign({},...latestInquiryRuns(record).filter(r=>r.status==="completed"||r.status==="unavailable").map(r=>r.expected??{}))};
}
export function explanationReviewed(record:InquiryRecord, text?:string) {
  const latest=record.reflections.filter(r=>r.runCount===record.runs.length).at(-1);
  const answers=record.answerReviews?.filter(r=>r.runCount===record.runs.length).at(-1)?.answers??record.prediction;
  const sameAnswers=!latest?.answers ? !latest?.assessment : record.fields.every(f=>latest.answers?.[f.key]===answers[f.key]);
  return !!latest && sameAnswers && (text===undefined||latest.text===text.trim()) && (!latest.assessment||latest.assessment.verdict==="confirmed"||(latest.assessment.version==="math-explanation-v2"&&latest.assessment.verdict!=="revise")||latest.teacherReviewRequested===true);
}
function remember(record:InquiryRecord) {
  const index=memory.findIndex(r=>r.id===record.id);
  if(index<0)memory.push(clone(record));else memory[index]=clone(record);
  return writeEvidence(STORAGE_KEY,memory);
}
/** Local backup keeps evidence after reload; each app session remains distinguishable. */
export function useMathInquiry(task:string, condition:unknown, fields:InquiryField[], requiredActions:string[], resetKey:number, connected:boolean, source:"dt"|"math"="dt") {
  const conditionKey=JSON.stringify(condition);
  const taskKind=learningTaskKind(condition), detailedReflection=taskKind==="representative";
  const exposureKey=`${task}:${(condition as {id?:string;lessonId?:string}|null)?.id??(condition as {lessonId?:string}|null)?.lessonId??conditionKey}`;
  const [record,setRecord]=useState<InquiryRecord|null>(null);
  const [draft,setDraft]=useState<Record<string,string>>({});
  const [reason,setReason]=useState("");
  const [reflection,setReflection]=useState("");
  const [judgment,setJudgment]=useState<LearningJudgment>(emptyJudgment);
  const latestReasonReview=record?.explanationReviews?.filter(item=>item.runCount===record.runs.length).at(-1);
  const needsReflection=reflectionRequired(taskKind,judgment)||latestReasonReview?.assessment.verdict==="revise";
  const [observation,setObservation]=useState("");
  const pendingFeedback=useRef<NonNullable<InquiryRecord["feedbackEvents"]>>([]);
  const priorGuidance=useRef(new Map<string,NonNullable<InquiryRecord["feedbackEvents"]>>());
  const [reasonRevision,setReasonRevision]=useState("");
  const [message,setMessage]=useState("");
  const [reviewDraft,setReviewDraft]=useState<Record<string,string>>({});
  const [squareReviewEdited,setSquareReviewEdited]=useState(false);
  const [openHints,setOpenHints]=useState<string[]>([]);
  const [storageFailed,setStorageFailed]=useState(false);
  const ref=useRef(record);ref.current=record;
  const active=useRef<{id:string;index:number}|null>(null);
  const save=useCallback((next:InquiryRecord)=>{ref.current=next;setStorageFailed(!remember(next));setRecord(next);},[]);
  const interrupt=useCallback(()=>{
    const token=active.current,r=ref.current;
    active.current=null;
    if(!token||!r||token.id!==r.id)return;
    save({...r,runs:r.runs.map((run,i)=>i===token.index?{...run,status:"stopped",endedAt:now()}:run)});
  },[save]);
  useLayoutEffect(()=>{interrupt();setRecord(null);ref.current=null;setDraft({});setReason("");setReflection("");setMessage("");pendingFeedback.current=[...(priorGuidance.current.get(exposureKey)??[])];},[task,conditionKey,interrupt]);
  useLayoutEffect(()=>{interrupt();},[resetKey,connected,interrupt]);
  useLayoutEffect(()=>()=>{interrupt();},[interrupt]);
  useLayoutEffect(()=>{setReviewDraft({});setOpenHints([]);setReasonRevision("");setJudgment(emptyJudgment());setObservation("");},[record?.id,record?.runs.length]);
  useLayoutEffect(()=>{setSquareReviewEdited(false);},[record?.id]);
  const ready=!!record&&record.conditionKey===conditionKey
    &&(task!=="square"||fields.every(field=>draft[field.key]===record.prediction[field.key]));
  const observed=ready&&requiredActions.every(action=>latestInquiryRuns(record).some(r=>r.action===action&&(r.status==="completed"||r.status==="unavailable")));
  const checked=observed&&(task!=="square"||!squareReviewEdited)
    &&currentInquiryComparison(record).length===fields.length&&currentInquiryComparison(record).every(f=>f.matched);
  const comparisonAvailable=observed&&compareInquiry(record).length===fields.length;
  const aiJudgment=useRef<{conditionKey:string;answerKey:string;value:unknown}|null>(null);
  const feedbackContext=(next=record,judgment?:unknown,answers=draft)=>makeFeedbackContext({
    task,condition,fields,answers,reason,record:next,reviewDraft,reasonRevision,
    history:memory.filter(r=>r.task===task),
    judgment:judgment??(task==="square"&&aiJudgment.current?.conditionKey===conditionKey
      &&aiJudgment.current.answerKey===JSON.stringify([draft,reason])?aiJudgment.current.value:next?currentInquiryComparison(next).map(r=>({key:r.key,label:r.label,matched:r.matched})):
      aiJudgment.current?.conditionKey===conditionKey&&aiJudgment.current.answerKey===JSON.stringify([draft,reason])?aiJudgment.current.value:undefined),
  });
  const latestFeedbackContext=useRef(feedbackContext);
  latestFeedbackContext.current=feedbackContext;
  const ai=useLearningAi(feedbackContext(),JSON.stringify([draft,reason,reviewDraft,reasonRevision,reflection]));
  const aiSubmission=useRef(0);
  const requestAi=(judgment?:unknown,answers=draft)=>{
    const squareWrong=task==="square"&&!!judgment&&typeof judgment==="object"
      &&"status" in judgment&&judgment.status==="incorrect";
    const verdict=judgment;
    aiJudgment.current={conditionKey,answerKey:JSON.stringify([answers,reason]),value:verdict};
    // The square comparison panel owns the explicit GPT analysis action; grading/submission
    // must not silently turn into a paid call merely because the global tutor mode is GPT.
    if(task==="square"&&ai.mode==="gpt")return;
    const snapshot=feedbackContext(task==="square"?null:ref.current,verdict,answers);
    void ai.request("submit",snapshot,"",`${conditionKey}:check:${++aiSubmission.current}`);
    const diagnosed=task==="square"&&!!judgment&&typeof judgment==="object"&&"diagnosis" in judgment;
    if(squareWrong||diagnosed) {
      window.dispatchEvent(new Event("square-tutor-feedback"));
      if(ai.mode==="gpt")void ai.request("hint",snapshot,diagnosed
        ?"전달된 실행 결과 진단(diagnosis)의 유형·근거·피드백 수준에 맞춰, 로봇이 실제로 그린 결과와 과제 조건의 차이를 학생이 스스로 찾도록 질문 1개만 2문장 이내로 해 주세요. 정답 좌표나 정답 값은 말하지 마세요."
        :"방금 확인한 틀린 항목과 내 입력값을 문제 조건에 연결해, 오류 이유와 단계별 힌트·개선 방법을 친절하게 설명해 주세요. 정답 수치를 바로 대신 쓰지 말고 스스로 고칠 수 있게 도와주세요.");
    }
  };
  const submit=()=>{
    if(!reason.trim()||fields.some(f=>f.options?!f.options.some(o=>o.value===draft[f.key]):parseLessonNumber(draft[f.key]??"")===null)) {
      setMessage("각 예측과 그렇게 생각한 근거를 입력하세요.");return;
    }
    const previous=memory.filter(r=>r.task===task).at(-1);
    const settings=condition as {id?:string;support?:string;guidanceBeforePrediction?:boolean};
    const alreadyObserved=memory.some(r=>r.task===task&&
      (r.conditionKey===conditionKey || (!!settings?.id&&(r.condition as {id?:string})?.id===settings.id))&&
      (r.runs.length>0 || !!r.feedbackEvents?.length));
    save({...learningRecordContext(source),id:globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random()}`,
      task,...(task==="square"?{taskVersion:"v4-paper-merged"}:{}),taskKind,conditionKey,condition:clone(condition),fields:clone(fields),prediction:clone(draft),reason:reason.trim(),
      submittedAt:now(),previousId:previous?.id,attemptKind:!previous?"initial":previous.conditionKey===conditionKey?"revision":"changed-condition",
      independentPrediction:settings?.support ? settings.support==="independent"&&!settings.guidanceBeforePrediction&&!alreadyObserved&&pendingFeedback.current.length===0 : undefined,
      runs:[],reflections:[],feedbackEvents:clone(pendingFeedback.current)});pendingFeedback.current=[];setMessage("");
  };
  const begin=useCallback((action:string)=>{
    const r=ref.current;if(!r)return false;
    interrupt();const current=ref.current!;
    active.current={id:current.id,index:current.runs.length};
    save({...current,runs:[...current.runs,{action,status:"running",startedAt:now()}]});return true;
  },[interrupt,save]);
  const finish=useCallback((summary:string,expected:Record<string,number|string>,detail:unknown,status:"completed"|"unavailable"="completed")=>{
    const token=active.current,r=ref.current;if(!token||!r||r.id!==token.id)return;
    active.current=null;
    const updated={...r,runs:r.runs.map((run,i)=>i===token.index?{...run,status,endedAt:now(),summary,expected:clone(expected),detail:clone(detail)}:run)};
    const complete=requiredActions.every(action=>latestInquiryRuns(updated).some(run=>run.action===action&&(run.status==="completed"||run.status==="unavailable")));
    if(complete)updated.explanationReviews=[...(r.explanationReviews??[]),{text:r.reason,at:now(),runCount:updated.runs.length,phase:"initial",answers:clone(r.prediction),assessment:assessExplanation(r.reason,explanationContext(updated))}];
    save(updated);
    void ai.request("result",latestFeedbackContext.current(updated,undefined,updated.prediction),"",`${updated.id}:run:${updated.runs.length}`);
  },[save,JSON.stringify(requiredActions)]);
  // Append a separate execution to the SAME prediction, even if its screen was
  // left while awaiting confirmation. Never replace predictions or older runs.
  const recordExecution=useCallback((original:InquiryRecord,run:Evidence)=>{
    const current=ref.current?.id===original.id ? ref.current : memory.find(r=>r.id===original.id)??original;
    const updated={...current,runs:[...current.runs,clone(run)]};
    if(run.action==="math-check"&&run.status==="completed") {
      updated.explanationReviews=[...(current.explanationReviews??[]),{
        text:current.reason,at:now(),runCount:updated.runs.length,phase:"initial",
        answers:clone(current.prediction),assessment:assessExplanation(current.reason,explanationContext(updated)),
      }];
    }
    if(ref.current?.id===original.id) save(updated); else remember(updated);
    if(ref.current?.id===original.id) void ai.request("result",latestFeedbackContext.current(updated,undefined,updated.prediction),"",`${updated.id}:run:${updated.runs.length}`);
  },[save]);
  const feedbackEvent=(kind:NonNullable<InquiryRecord["feedbackEvents"]>[number]["kind"],keys:string[]=[])=>{
    const r=ref.current;
    const event={kind,keys,at:now(),runCount:r?.runs.length??0};
    if(!r){pendingFeedback.current.push(event);priorGuidance.current.set(exposureKey,[...pendingFeedback.current]);
      recordLearningAction(task,"support-used",{condition,feedbackEvents:[event]},source);return;}
    save({...r,feedbackEvents:[...(r.feedbackEvents??[]),event]});
  };
  /** One entry per run; a later call for the same run updates it (e.g. adds the cause explanation). */
  const recordDiagnosis=(entry:Omit<MismatchDiagnosisEntry,"at"|"runCount">&{causeExplanation?:string})=>{
    const r=ref.current;if(!r)return;
    const runCount=r.runs.length,list=r.mismatchDiagnoses??[],source=entry.source??"dt";
    const same=(item:MismatchDiagnosisEntry)=>item.runCount===runCount&&(item.source??"dt")===source;
    const existing=list.find(same);
    if(existing&&existing.type===entry.type&&!entry.causeExplanation)return;
    const next:MismatchDiagnosisEntry={...existing,...clone(entry),source,runCount,at:existing?.at??now(),
      ...(entry.causeExplanation?{causeExplanation:entry.causeExplanation.trim(),explainedAt:now()}:{})};
    save({...r,mismatchDiagnoses:[...list.filter(item=>!same(item)),next]});
  };
  const showHint=(key:string)=>{if(openHints.includes(key))return;setOpenHints(v=>[...v,key]);feedbackEvent("hint",[key]);};
  const reviewAnswers=()=>{
    const r=ref.current;if(!observed||!r)return;
    const previous=r.answerReviews?.filter(v=>v.runCount===r.runs.length).at(-1)?.answers??r.prediction;
    const answers={...previous,...reviewDraft};
    if(fields.some(f=>f.options?!f.options.some(o=>o.value===answers[f.key]):parseLessonNumber(answers[f.key]??"")===null)){
      setMessage("다시 판단할 항목을 빠짐없이 입력하세요.");return;
    }
    const rows=compareInquiry(r,answers);
    if(rows.length!==fields.length){setMessage("이번 실행에는 판단에 필요한 결과가 없습니다. 조건을 확인하고 다시 실행하세요.");return;}
    save({...r,answerReviews:[...(r.answerReviews??[]),{answers:clone(answers),at:now(),runCount:r.runs.length}],
      feedbackEvents:[...(r.feedbackEvents??[]),{kind:"answer-review",keys:rows.filter(f=>!f.matched).map(f=>f.key),at:now(),runCount:r.runs.length}]});
    void ai.request("submit",feedbackContext(ref.current),"",`${r.id}:review:${r.answerReviews?.length??0}`);
    setMessage(rows.every(f=>f.matched)?"수정한 판단이 확인값과 일치합니다. 로봇을 다시 실행하지 않아도 됩니다. 어떤 관계를 고쳤는지 설명하세요.":`아직 확인할 항목: ${rows.filter(f=>!f.matched).map(f=>f.label).join(", ")}. 아래 질문과 실행 결과를 연결해 보세요.`);
  };
  const revise=()=>{interrupt();feedbackEvent("revise");setRecord(null);ref.current=null;setReflection("");setMessage("처음 예측은 기록에 보존됩니다. 바꾼 예측과 근거를 저장하세요.");};
  const reviewReason=()=>{
    const r=ref.current;if(!r||!observed||!comparisonAvailable||!reasonRevision.trim())return;
    const answers=r.answerReviews?.filter(v=>v.runCount===r.runs.length).at(-1)?.answers??r.prediction;
    const entry:ExplanationEntry={text:reasonRevision.trim(),at:now(),runCount:r.runs.length,phase:"revision",answers:clone(answers),assessment:assessExplanation(reasonRevision,explanationContext(r,answers))};
    save({...r,explanationReviews:[...(r.explanationReviews??[]),entry]});
    setMessage("고친 근거와 피드백을 저장했습니다. 처음 쓴 근거는 그대로 남습니다.");
  };
  const explain=()=>{
    if(!checked||!record||(needsReflection&&!reflection.trim()))return;
    if(!judgmentComplete(judgment,detailedReflection)){setMessage(detailedReflection?"유지·수정 판단과 가장 참고한 정보를 선택하세요.":"비교 후 내 판단을 선택하세요.");return;}
    const answers=record.answerReviews?.filter(v=>v.runCount===record.runs.length).at(-1)?.answers??record.prediction;
    const assessment=reflection.trim()?assessExplanation(reflection,explanationContext(record,answers,"reflection")):undefined;
    // Keep same-tick additions (e.g. a diagnosis note saved just before) instead of a stale render copy.
    const latest=ref.current?.id===record.id?ref.current:record;
    save({...latest,reflections:[...latest.reflections,{text:reflection.trim(),at:now(),runCount:record.runs.length,review:assessment?"teacher":"learner",assessment,unresolved:assessment?assessment.verdict!=="confirmed":undefined,answers:clone(answers),judgment:clone(judgment)}]});
    setMessage(!assessment?"비교 확인을 저장했습니다. 처음 쓴 예측 근거는 그대로 남습니다.":assessment.verdict==="confirmed"?"설명과 피드백을 저장했습니다. 다음 조건으로 진행할 수 있습니다.":assessment.verdict==="revise"?"설명을 저장했습니다. 표시된 오류를 확인하거나 검토용으로 남길 수 있습니다.":"설명을 판단 보류 상태로 저장했습니다. 아래 질문은 더 생각해 볼 때 참고하세요. 다시 쓰지 않고 다음 조건으로 진행할 수 있습니다.");
  };
  const requestExplanationReview=()=>{
    const r=ref.current;if(!checked||!r)return;
    const last=r.reflections.at(-1);if(!last||last.runCount!==r.runs.length||last.text!==reflection.trim())return;
    if(!sameJudgment(last.judgment,judgment))return;
    const answers=r.answerReviews?.filter(v=>v.runCount===r.runs.length).at(-1)?.answers??r.prediction;
    if(!r.fields.every(f=>last.answers?.[f.key]===answers[f.key]))return;
    save({...r,reflections:[...r.reflections,{...last,at:now(),teacherReviewRequested:true}]});
    setMessage("교사 검토가 필요한 답으로 기록했습니다. 자동 정답 판정이 아닙니다. 교사에게는 학습 기록을 내려받아 전달하세요.");
  };
  const download=()=>{
    const records=memory.filter(r=>r.task===task);
    downloadEvidence(`${task}-learning.json`,{...learningRecordContext(source),task,records});
  };
  const saveObservation=()=>{
    const r=ref.current;if(!observed||!r||(detailedReflection&&!observation.trim()))return false;
    save({...r,observations:[...(r.observations??[]),{text:observation.trim(),at:now(),runCount:r.runs.length,acknowledged:true}]});
    return true;
  };
  const recordedAi={...ai,acknowledge:()=>{
    const displayed=ai.acknowledge();
    if(displayed)feedbackEvent("hint",["ai-feedback"]);
    return displayed;
  }};
  const updateDraft:typeof setDraft=update=>{
    const next=typeof update==="function"?update(draft):update;
    if(task==="square"&&ref.current&&fields.some(field=>next[field.key]!==ref.current!.prediction[field.key]))revise();
    setDraft(next);
  };
  const updateReviewDraft:typeof setReviewDraft=update=>{
    const next=typeof update==="function"?update(reviewDraft):update;
    if(task==="square"&&ref.current&&Object.entries(next).some(([key,value])=>value!==ref.current!.prediction[key]))setSquareReviewEdited(true);
    setReviewDraft(next);
  };
  return {conditionKey,record,draft,setDraft:updateDraft,reason,setReason,reflection,setReflection,message,ready,observed,ai:recordedAi,requestAi,
    taskKind,detailedReflection,reflectionRequired:needsReflection,reflectionReady:!needsReflection||!!reflection.trim(),
    judgment,setJudgment,judgmentReady:judgmentComplete(judgment,detailedReflection),observation,setObservation,saveObservation,
    checked,comparisonAvailable,reviewDraft,setReviewDraft:updateReviewDraft,reviewAnswers,openHints,showHint,feedbackEvent,storageFailed,
    reviewed:checked&&!!record&&explanationReviewed(record,reflection)&&sameJudgment(record.reflections.at(-1)?.judgment,judgment),
    reasonRevision,setReasonRevision,reviewReason,requestExplanationReview,recordDiagnosis,submit,begin,finish,recordExecution,interrupt,revise,explain,download,
    fields,history:memory.filter(r=>r.task===task),recordCount:memory.filter(r=>r.task===task).length};
}

export function MathInquiryPanel({inquiry,part,prompt,reflectionPrompt,locked=false,onNewCondition,nextLabel="조건을 바꿔 스스로 적용",visibleFieldKeys,showReason=true,showSubmit=true,onNextHint,nextHintLabel="다음 힌트 보기 →",actionFeedback,fieldStatuses,onFieldChange}: {
  inquiry:ReturnType<typeof useMathInquiry>; part:"before"|"after"; prompt?:string;
  reflectionPrompt?:string; locked?:boolean; onNewCondition?:()=>void; nextLabel?:string;
  visibleFieldKeys?:string[]; showReason?:boolean; showSubmit?:boolean;
  onNextHint?:()=>void; nextHintLabel?:string; actionFeedback?:string;
  fieldStatuses?:Record<string,"correct"|"incorrect">;
  onFieldChange?: (key:string,value:string)=>void;
}) {
  const q=inquiry;
  const visibleFields=visibleFieldKeys?q.fields.filter(f=>visibleFieldKeys.includes(f.key)):q.fields;
  const reasonFeedback=q.record?.explanationReviews?.filter(r=>r.runCount===q.record!.runs.length).at(-1);
  const reflectionFeedback=q.record?.reflections.filter(r=>r.runCount===q.record!.runs.length).at(-1);
  const reflectionAnswers=q.record?.answerReviews?.filter(r=>r.runCount===q.record!.runs.length).at(-1)?.answers??q.record?.prediction;
  const reflectionCurrent=reflectionFeedback?.text===q.reflection.trim()&&q.fields.every(f=>reflectionFeedback?.answers?.[f.key]===reflectionAnswers?.[f.key])&&sameJudgment(reflectionFeedback?.judgment,q.judgment);
  const reflectionField=<label>{q.taskKind==="practice"?(q.reflectionRequired?"확인하거나 바꾼 근거를 한 줄로 적으세요":"덧붙이고 싶은 설명"):reflectionPrompt}<textarea maxLength={4000} aria-label="결과 해석" value={q.reflection} disabled={locked} rows={q.detailedReflection?3:2} onChange={e=>q.setReflection(e.target.value)}/></label>;
  if(part==="before")return <section className="lesson-card math-inquiry" aria-label="실행 전 수학 예측">
    <h3>먼저 예측하기</h3><p>{prompt}</p>
    {q.ready?<p>예측과 근거를 저장했습니다. 아래에서 실행한 뒤 결과를 비교하세요.</p>:<>
      <div className="inquiry-fields">{visibleFields.map(f=>{
        const status=fieldStatuses?.[f.key];
        const statusStyle=status==="correct"
          ? {border:"2px solid #16a34a",background:"#f0fdf4",boxShadow:"0 0 0 2px rgba(22,163,74,.12)"}
          : status==="incorrect"
            ? {border:"2px solid #dc2626",background:"#fef2f2",boxShadow:"0 0 0 2px rgba(220,38,38,.12)"}
            : undefined;
        const update=(value:string)=>{q.setDraft({...q.draft,[f.key]:value});onFieldChange?.(f.key,value);};
        return <label key={f.key}>
          <span>{f.label}{f.unit&&` (${f.unit})`}{status&&<small style={{color:status==="correct"?"#15803d":"#b91c1c",fontWeight:800}}>{status==="correct"?" ✓ 확인됨":" ✕ 다시 확인"}</small>}</span>
          {f.options?<select aria-label={f.label} value={q.draft[f.key]??""} disabled={locked} style={statusStyle} aria-invalid={status==="incorrect"||undefined}
            onChange={e=>update(e.target.value)}>
            <option value="">선택하세요</option>{f.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>:<input aria-label={f.label} type="number" step="any" value={q.draft[f.key]??""} disabled={locked} style={statusStyle} aria-invalid={status==="incorrect"||undefined}
            onChange={e=>update(e.target.value)}/>}
        </label>;
      })}</div>
      {showReason&&<label>왜 그렇게 예상했나요?<textarea maxLength={4000} aria-label="예측 근거" value={q.reason} disabled={locked} rows={2} onChange={e=>q.setReason(e.target.value)}/></label>}
      {onNextHint&&!showSubmit&&<button className="lesson-secondary" disabled={locked} onClick={onNextHint}>{nextHintLabel}</button>}
      {!showSubmit&&actionFeedback&&<p className="lesson-feedback" role="status">{actionFeedback}</p>}
      {showSubmit&&<button className="lesson-primary" disabled={locked} onClick={q.submit}>예측·근거 저장</button>}
    </>}
    {!q.ready&&q.message&&<p role="status">{q.message}</p>}
    <LearningAiFeedback ai={q.ai}/>
  </section>;
  return <section className="lesson-card math-inquiry" aria-label="예측과 결과 비교">
    {q.record&&<LearningAiFeedback ai={q.ai} result/>}
    {q.observed&&q.record?<>
      <h3>예측과 결과를 비교하고 설명하기</h3>
      <table><thead><tr><th>항목</th><th>처음 예측</th><th>DT·수학적 확인</th>{!!q.record.answerReviews?.some(r=>r.runCount===q.record!.runs.length)&&<th>피드백 후 판단</th>}</tr></thead><tbody>
        {compareInquiry(q.record).map(f=>{
          const display=(v:string|number)=>f.options?.find(o=>o.value===v)?.label??(typeof v==="number"?Number(v.toFixed(2)):v);
          const reviewed=currentInquiryComparison(q.record!).find(r=>r.key===f.key)!;
          return <tr key={f.key}><th>{f.label}</th><td>{display(f.prediction)} · {f.matched?"일치":"차이 있음"}</td><td>{display(f.result)} {f.unit}</td>
            {!!q.record!.answerReviews?.some(r=>r.runCount===q.record!.runs.length)&&<td>{display(reviewed.prediction)} · {reviewed.matched?"일치":"다시 확인"}</td>}</tr>;
        })}</tbody></table>
      <p>처음 쓴 근거: {q.record.reason}</p>
      {reasonFeedback&&q.comparisonAvailable&&<>
        <ExplanationFeedback title="예측 근거 피드백" assessment={reasonFeedback.assessment}/>
        {reasonFeedback.phase==="revision"&&<p>고친 근거: {reasonFeedback.text}</p>}
        <details><summary>근거만 고쳐 다시 확인하기</summary>
          <label>고친 근거<textarea aria-label="고친 예측 근거" rows={3} maxLength={4000} disabled={locked} value={q.reasonRevision} onChange={e=>q.setReasonRevision(e.target.value)}/></label>
          <button disabled={locked||!q.reasonRevision.trim()} onClick={q.reviewReason}>근거 수정·피드백 저장</button>
          <p className="lesson-note">최초 답·근거는 보존됩니다. 숫자 답을 고치려면 아래 수치 판단도 함께 확인하세요.</p>
        </details>
      </>}
      {latestInquiryRuns(q.record).filter(r=>r.summary).map(r=><p key={r.action}>{r.summary}</p>)}
      {q.checked?<p className="lesson-feedback">✓ {compareInquiry(q.record).every(f=>f.matched)?"첫 예측":"피드백 후 판단"}이 확인값과 일치합니다. {q.reflectionRequired?"관계를 한 줄로 정리한 뒤 새 조건에서 확인하세요.":"처음 근거를 유지할지, 판단을 바꿀지 선택하세요."}</p>:!q.comparisonAvailable?<p className="lesson-feedback">이번 실행에는 판단에 필요한 결과가 없습니다. 실행 불가 사유와 조건을 확인하고 다시 실행하세요. 결과가 없다는 이유로 예측을 오답 처리하지 않습니다.</p>:<div className="inquiry-feedback" aria-label="결과에 따른 수학 피드백">
        <h4>관찰한 결과를 근거로 다시 판단해 보세요</h4>
        <p>이번 실행 결과는 위 표에 있습니다. 차이가 난 관계를 다시 판단하면 재실행 없이 확인할 수 있습니다.</p>
        {currentInquiryComparison(q.record).filter(f=>!f.matched).map(f=>{
          const guidance=inquiryGuidance(q.record!.task,f);
          return <div className="inquiry-feedback-item" key={f.key}><strong>{f.label}</strong><p>{guidance.question}</p>
            {q.openHints.includes(f.key)?<p className="lesson-formula">{guidance.hint}</p>:<button disabled={locked} onClick={()=>q.showHint(f.key)}>관계 힌트 · {f.label}</button>}
            <label>다시 판단한 {f.label}{f.options?<select aria-label={`다시 판단 ${f.label}`} disabled={locked} value={q.reviewDraft[f.key]??f.prediction}
              onChange={e=>q.setReviewDraft({...q.reviewDraft,[f.key]:e.target.value})}>{f.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>
              :<input aria-label={`다시 판단 ${f.label}`} type="number" step="any" disabled={locked} value={q.reviewDraft[f.key]??f.prediction}
                onChange={e=>q.setReviewDraft({...q.reviewDraft,[f.key]:e.target.value})}/>}</label>
          </div>;
        })}
        <button className="lesson-primary" disabled={locked} onClick={q.reviewAnswers}>수정한 판단 확인</button>
      </div>}
      <LearningJudgmentFields value={q.judgment} onChange={q.setJudgment} disabled={locked} idPrefix={`inquiry-${q.record.id}`} showBasis={q.detailedReflection}/>
      {q.reflectionRequired?reflectionField:<details><summary>설명 덧붙이기 (선택)</summary>{reflectionField}</details>}
      <p className="lesson-note">{q.detailedReflection?"참고한 정보가 판단에 어떻게 쓰였는지 짧은 문장이나 식으로 설명하세요. 관찰한 값은 반복하지 않아도 됩니다.":q.reflectionRequired?"관계식이나 달라진 점을 한 줄로 적으면 됩니다.":"처음 쓴 근거를 유지한다면 다시 적지 않고 비교 확인을 저장하세요."}</p>
      <div className="lesson-actions"><button disabled={locked||!q.checked||!q.reflectionReady||!q.judgmentReady} onClick={q.explain}>{q.taskKind==="practice"?"비교 확인 저장":"내 설명 저장"}</button>
        <button disabled={locked} onClick={q.revise}>예측을 수정해 다시 확인</button></div>
      {reflectionFeedback?.assessment&&<>
        <ExplanationFeedback title="결과 설명 피드백" assessment={reflectionFeedback.assessment}/>
        {!reflectionCurrent&&<p role="status">설명 또는 숫자 판단이 바뀌었습니다. ‘내 설명 저장’을 눌러 현재 답으로 다시 확인하세요.</p>}
        {reflectionCurrent&&!q.reviewed&&!reflectionFeedback.teacherReviewRequested&&<button disabled={locked||!q.checked} onClick={q.requestExplanationReview}>교사 검토용으로 남기고 계속</button>}
        {reflectionFeedback.teacherReviewRequested&&<p>교사 검토 필요로 기록됨 · 자동 정답 판정 아님</p>}
      </>}
      {q.message&&<p role="status">{q.message}</p>}
      {q.reviewed&&onNewCondition&&<button className="lesson-primary" disabled={locked} onClick={()=>{q.feedbackEvent("transfer");onNewCondition();}}>{nextLabel}</button>}
      <p className="lesson-note">예측을 유지할 때는 재실행 없이 다음 과제로 진행할 수 있습니다.</p>
    </>:q.ready?<p>실행을 끝내면 예측과 결과가 나란히 표시됩니다. 중지한 실행은 완료로 처리하지 않습니다.</p>:null}
    <details><summary>내 학습 정리 · 최근 조건의 관계별 확인</summary>
      {q.record?<table><thead><tr><th>수학 관계</th><th>확인 상태</th></tr></thead><tbody>{q.fields.map(f=>{
        const first=q.history.find(r=>r.conditionKey===q.record!.conditionKey),current=currentInquiryComparison(q.record!).find(row=>row.key===f.key);
        const original=first&&compareInquiry(first).find(row=>row.key===f.key);
        const status=!current?"실행·확인 전":!current.matched?"다시 확인 필요":original?.matched&&!first?.feedbackEvents?.some(e=>e.kind==="hint"&&e.keys.includes(f.key))?"첫 예측 일치":"피드백·수정 후 일치";
        return <tr key={f.key}><th>{f.label}</th><td>{status}</td></tr>;
      })}</tbody></table>:<p>예측을 제출하면 관계별 확인 상태를 보여줍니다.</p>}
      <p className="lesson-note">최근 조건의 수치·선택 판단 상태입니다. 개념 이해의 최종 판정은 설명과 새 조건 수행을 함께 검토합니다.</p>
    </details>
    <details><summary>이 단원 학습 기록 · {q.recordCount}회</summary>
      <p>최초 예측·근거, 실행 결과, 힌트 사용, 재판단과 설명을 학생별로 기록하고 서버에 전송합니다. 저장 상태는 화면 위에서 확인하세요. 서술형 원문·항목별 피드백·수정 이력·검토 요청도 함께 보관합니다. 과정 기록은 별도 이해도 시험과 구분하며, 자동 판단을 보류한 설명도 정답으로 바꾸지 않습니다.</p>
      <button disabled={!q.recordCount} onClick={q.download}>단원 기록 내려받기</button>
    </details>
    {q.storageFailed&&<p role="alert">브라우저에 기록을 저장하지 못했습니다. 현재 세션의 기록은 내려받을 수 있습니다. 새로고침 전에 내려받으세요.</p>}
  </section>;
}
