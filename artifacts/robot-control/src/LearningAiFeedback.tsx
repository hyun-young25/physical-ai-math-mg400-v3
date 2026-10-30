import { squareEvidenceTag,type SquareEvidenceTag } from "./squareComparisonVisual";
import { useEffect, useRef, useState } from "react";
import type { LearningFeedback, LearningFeedbackInput } from "@workspace/api-client-react";
import { getLearningUser } from "./learningClient";
import { learningRecordContext } from "./learningFramework";
import { readEvidence, writeEvidence } from "./learningEvidenceStorage";
import { feedbackProblemKey, feedbackVersion, hasFeedbackExecution, privateText, type FeedbackContext } from "./learningAiContext";
import { updateTutor, unregisterTutor } from "./tutorRegistry";
import { useTutorMode } from "./tutorMode";
import { trialTutorFeedback } from "./trialTutorFeedback";
import { useSubmissionFeedback } from "./useSubmissionFeedback";
import { feedbackFailures } from "./feedbackAvailability";

const KEY="physical-ai-inquiry-feedback-v1";
type Trigger=LearningFeedbackInput["trigger"];
type Activity = ReturnType<typeof learningRecordContext> & {
  id:string;task:string;at:string;prediction:FeedbackContext;feedback?:LearningFeedback;
  feedbackStatus:"requested"|"displayed"|"discarded";trigger:Trigger;question?:string;
  conversation?:{role:"student"|"tutor";text:string;source?:"openai"|"rules"}[];
  displayedAt?:string;
  automatic?:boolean;
};
export type TutorMessage={id:string;role:"student"|"tutor";text:string;source?:"openai"|"rules";at?:string;automatic?:boolean;unavailable?:boolean;evidence?:SquareEvidenceTag};
const rows=()=>readEvidence<Activity>(KEY,(x):x is Activity=>!!x&&typeof x==="object"&&"id" in x);
const delivered=(context:FeedbackContext)=>rows().filter(x=>x.feedbackStatus==="displayed"&&x.feedback&&feedbackProblemKey(x.prediction)===feedbackProblemKey(context));
type DeliveredTurn=Pick<Activity,"id"|"prediction"|"feedback"|"question"|"automatic">;
const messagesFor=(history:DeliveredTurn[]):TutorMessage[]=>history.flatMap(row=>[
  ...(row.question?[{id:row.id+"-question",role:"student" as const,text:row.question,at:row.feedback!.createdAt}]:[]),
  {id:row.id,role:"tutor" as const,text:row.feedback!.text,source:row.feedback!.provider,at:row.feedback!.createdAt,automatic:row.automatic,
    unavailable:!!row.feedback!.failureReason,evidence:row.feedback!.failureReason?undefined:squareEvidenceTag(row.prediction)},
]);

export function useLearningAi(context:FeedbackContext,editVersion="") {
  const mode=useTutorMode();
  const automatic=useSubmissionFeedback(context,mode);
  const currentMode=useRef(mode);currentMode.current=mode;
  const trialHistory=useRef<DeliveredTurn[]>([]);
  const trialReady=useRef<{key:string;row:DeliveredTurn}|null>(null);
  const current=useRef(context);current.current=context;
  const editing=useRef(editVersion);editing.current=editVersion;
  const id=useRef(crypto.randomUUID()).current;
  const active=useRef<{key:string;abort:AbortController;row:Activity}|null>(null);
  const lastQuestion=useRef<{problem:string;text:string}|null>(null);
  const ready=useRef<{key:string;row:Activity}|null>(null);
  const [state,setState]=useState<{key:string;pending:boolean;feedback?:LearningFeedback;question?:string;id?:string}>();
  const [storageFailed,setStorageFailed]=useState(false);
  const [,refresh]=useState(0);
  const version=feedbackVersion(context)+editVersion+mode;
  const currentVersion=()=>feedbackVersion(current.current)+editing.current+currentMode.current;
  const problemKey=feedbackProblemKey(context);
  const cancel=()=>{
    const a=active.current;if(!a)return;
    a.abort.abort();active.current=null;
    // Unanswered questions and discarded responses never become delivered activity.
  };
  useEffect(()=>{
    if(active.current&&active.current.key!==version){cancel();setState(undefined);}
    if(ready.current?.key!==version)ready.current=null;
    if(trialReady.current?.key!==version)trialReady.current=null;
  },[version]);
  useEffect(()=>()=>{cancel();},[]);
  const request=async(trigger:Trigger,snapshot:FeedbackContext=current.current,question="",submissionId?:string,carryToNext=false)=>{
    if(trigger==="submit"||trigger==="result"){
      automatic.submit(snapshot,submissionId,carryToNext,trigger==="result");return;
    }
    const key=feedbackVersion(snapshot)+editing.current+currentMode.current;
    if(active.current?.key===key)return;
    cancel();
    ready.current=null;
    trialReady.current=null;
    const problem=feedbackProblemKey(snapshot);
    if(trigger==="retry"&&!question&&lastQuestion.current?.problem===problem)question=lastQuestion.current.text;
    question=privateText(question.trim()).slice(0,1000);
    lastQuestion.current={problem,text:question};
    const prior=currentMode.current==="trial"?trialHistory.current.filter(row=>feedbackProblemKey(row.prediction)===problem):delivered(snapshot);
    const priorMessages=messagesFor(prior.filter(row=>!row.feedback?.failureReason));
    for(const message of automatic.providedMessages())if(!priorMessages.some(row=>row.id===message.id))priorMessages.push(message);
    priorMessages.sort((a,b)=>(Date.parse(a.at??"")||0)-(Date.parse(b.at??"")||0));
    const conversation=priorMessages.slice(-8).map(({role,text,source})=>({role,text:text.slice(0,1000),...(source?{source}:{})}));
    if(currentMode.current==="trial") {
      const feedback:LearningFeedback={provider:"rules",status:"unconfigured",createdAt:new Date().toISOString(),
        text:trialTutorFeedback({...snapshot,question,conversation})};
      const trialRow={id:crypto.randomUUID(),prediction:structuredClone(snapshot),question,feedback};
      trialReady.current={key,row:trialRow};
      setState({key,pending:false,feedback,question,id:trialRow.id});
      return;
    }
    const row:Activity={...learningRecordContext("math"),id:crypto.randomUUID(),task:snapshot.task,
      at:new Date().toISOString(),prediction:structuredClone(snapshot),feedbackStatus:"displayed",trigger,
      ...(question?{question}:{}),conversation:structuredClone(conversation)};
    const input={...snapshot,question,conversation,attempts:Math.min(1000,snapshot.attempts),
      history:JSON.stringify({attempts:snapshot.history.slice(0,3500),
        providedHints:priorMessages.filter(m=>m.role==="tutor").slice(-3).map(m=>m.text),
        recentAnswers:prior.slice(-2).map(x=>({answers:x.prediction.answers,reason:x.prediction.reason}))}).slice(0,6000)};
    const abort=new AbortController();active.current={key,abort,row};
    setState({key,pending:true,question,id:row.id});
    const timer=setTimeout(()=>abort.abort(),12000);
    let feedback:LearningFeedback;
    let invalidResponse=false;
    try {
      const visitId=getLearningUser()?.visitId;
      if(!visitId)throw new Error("visit");
      const response=await fetch("/api/learning/feedback",{method:"POST",credentials:"same-origin",
        signal:abort.signal,headers:{"Content-Type":"application/json","X-Learning-Request":"1"},
        body:JSON.stringify({...input,visitId,trigger})});
      if(!response.ok)throw new Error("feedback");
      invalidResponse=true;
      const data=await response.json();
      if(!["openai","rules"].includes(data.provider)||typeof data.text!=="string"||data.text.length>700
        ||!["provided","unconfigured","limited","timeout","unavailable"].includes(data.status)
        ||(data.provider==="openai"&&data.status!=="provided")
        ||(data.provider==="rules"&&data.status==="provided")
        ||(data.failureReason!==undefined&&!Object.hasOwn(feedbackFailures,data.failureReason))
        ||(data.provider==="openai"&&data.failureReason!==undefined))throw new Error("schema");
      feedback=data;
    }catch {
      const failureReason=abort.signal.aborted?"timeout":invalidResponse?"invalid_response":"network_error";
      feedback={provider:"rules",status:abort.signal.aborted?"timeout":"unavailable",failureReason,
        createdAt:new Date().toISOString(),text:`GPT 답변을 받지 못했습니다. ${feedbackFailures[failureReason].label}로 지금은 질문에 답할 수 없습니다. 자동 과제 피드백과 학습 화면은 계속 사용할 수 있습니다.`};
    }finally{clearTimeout(timer);}
    if(active.current?.row.id!==row.id)return;
    active.current=null;
    if(currentVersion()!==key){setState(undefined);return;}
    ready.current={key,row:{...row,feedback}};
    setState({key,pending:false,feedback,question,id:row.id});
  };
  const history=mode==="trial"?trialHistory.current.filter(row=>feedbackProblemKey(row.prediction)===problemKey):delivered(context);
  const messages=messagesFor(history);
  if(trialReady.current?.key===version&&!history.some(row=>row.id===trialReady.current!.row.id))messages.push(...messagesFor([trialReady.current.row]));
  if(ready.current?.key===version&&!history.some(row=>row.id===ready.current!.row.id))messages.push(...messagesFor([ready.current.row]));
  if(state?.key===version&&state.pending&&state.question)messages.push({id:"pending-question",role:"student",text:state.question});
  for(const message of automatic.messages)if(!messages.some(row=>row.id===message.id))messages.push(message);
  messages.sort((a,b)=>(Date.parse(a.at??"")||Number.MAX_SAFE_INTEGER)-(Date.parse(b.at??"")||Number.MAX_SAFE_INTEGER));
  const executionAvailable=hasFeedbackExecution(context.execution);
  const incorrect=/incorrect|"matched"\s*:\s*false/.test(context.judgment);
  return {id,context,problemKey,version,messages,request,storageFailed:storageFailed||automatic.storageFailed,mode,
    unread:automatic.unread,preview:automatic.preview,
    acknowledge:()=>{
       const autoDisplayed=automatic.acknowledge();
       if(currentMode.current==="trial") {
         const pending=trialReady.current;
         if(!pending||pending.key!==currentVersion())return autoDisplayed;
         trialReady.current=null;
         trialHistory.current=[...trialHistory.current,pending.row];
         refresh(n=>n+1);
         return true;
       }
      const pending=ready.current;
       if(!pending||pending.key!==currentVersion())return autoDisplayed;
      ready.current=null;
      const displayed={...pending.row,displayedAt:new Date().toISOString()};
      if(!writeEvidence(KEY,[...rows(),displayed]))setStorageFailed(true);
      refresh(n=>n+1);
      return true;
    },
    ask:(text:string)=>request("hint",current.current,text),
    pending:state?.key===version&&state.pending,
    feedback:state?.key===version?state.feedback:undefined,
    feedbackQuestion:state?.key===version?state.question:undefined,
    feedbackId:state?.key===version?state.id:undefined,
    quickActions:[
      {label:"힌트만 주세요",question:"힌트만 주세요",enabled:true},
      {label:"왜 틀렸나요?",question:"왜 틀렸나요?",enabled:incorrect},
      {label:"예상과 실제 결과 비교",question:"예상과 실제 결과를 비교해 주세요",enabled:executionAvailable},
    ],
  };
}
export type LearningAiController=ReturnType<typeof useLearningAi>;

/** Existing lesson placements now publish context to one shared tutor, not duplicate panels. */
export function LearningAiFeedback({ai}:{ai:LearningAiController;result?:boolean}) {
  const token=useRef(crypto.randomUUID()).current;
  useEffect(()=>()=>unregisterTutor(token),[token]);
  useEffect(()=>updateTutor(token,ai),[token,ai]);
  return null;
}
