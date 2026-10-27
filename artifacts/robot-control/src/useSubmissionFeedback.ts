import { useRef, useSyncExternalStore } from "react";
import { feedbackProblemKey, type FeedbackContext } from "./learningAiContext";
import { getLearningUser } from "./learningClient";
import { learningRecordContext } from "./learningFramework";
import { readEvidence, writeEvidence } from "./learningEvidenceStorage";
import { automaticHint, submittedAssessment, type SubmissionAssessment } from "./submissionFeedback";
import type { TutorMode } from "./tutorMode";

const KEY="physical-ai-inquiry-feedback-v1";
type Turn={id:string;at:string;text:string;context:FeedbackContext;seen:boolean;attempt:number;mode:TutorMode};
type Thread={ids:Set<string>;attempt:number;wrong:number;previous?:SubmissionAssessment;turns:Turn[];storageFailed:boolean;
  lastSubmission?:{signature:string;at:number}};
// Visit-scoped, tab-only pending/trial state. Never restores another visit's history.
const threads=new Map<string,Thread>(),listeners=new Set<()=>void>();
let revision=0;
const emit=()=>{revision++;listeners.forEach(fn=>fn());};
const subscribe=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
const snapshot=()=>revision;
export function useSubmissionFeedback(context:FeedbackContext,mode:TutorMode){
  useSyncExternalStore(subscribe,snapshot,snapshot);
  const visit=getLearningUser()?.visitId;
  const keyFor=(c:FeedbackContext)=>`${visit??"no-visit"}:${feedbackProblemKey(c)}`;
  const key=keyFor(context);
  const carried=useRef<{key:string;id:string}|null>(null);
  // Application steps advance immediately. Keep their explicitly labeled prior
  // step feedback visible, without treating it as the new step's verdict.
  const related=[...threads.entries()].filter(([k,t])=>k===key||(k===carried.current?.key&&k.startsWith(`${visit}:`))||
    (context.task.startsWith("coordinate-application-")&&k.startsWith(`${visit}:`)&&t.turns[0]?.context.task===context.task));
  const turns=related.flatMap(([k,t])=>t.turns.filter(turn=>k===key||context.task.startsWith("coordinate-application-")||turn.id===carried.current?.id)
    .map(turn=>({...turn,threadKey:k}))).sort((a,b)=>a.at.localeCompare(b.at));
  const unseen=turns.filter(t=>!t.seen);
  const display=(t:typeof turns[number])=>`${t.threadKey!==key?"이전 문항·단계의 ":""}${t.text}`;
  return {
    submit:(submitted:FeedbackContext,submissionId?:string,carryToNext=false,resultOnly=false)=>{
      if(!visit)return;
      const assessment=submittedAssessment(submitted);if(!assessment)return;
      const submittedKey=keyFor(submitted);
      if(submittedKey!==key)return;
      const next=threads.get(key)??{ids:new Set<string>(),attempt:0,wrong:0,turns:[],storageFailed:false};
      // Same attempt can be saved once per DT result; execution status is NOT a new math submission.
      const signature=submissionId?`event:${submissionId}`:JSON.stringify([submitted.answers,assessment]);
      if(next.ids.has(signature))return;
      next.ids.add(signature);
      // Re-saving execution evidence for an already graded answer is not a
      // resubmission. Explicit new submissions still receive progressed help.
      const previousTurn=next.turns.at(-1);
      if(resultOnly&&previousTurn?.context.answers===submitted.answers&&next.previous?.correct===assessment.correct
        &&JSON.stringify(next.previous.errors.map(e=>e.key).sort())===JSON.stringify(assessment.errors.map(e=>e.key).sort())){
        threads.set(key,next);return;
      }
      // A double tap can create two UI event IDs for the same unchanged answer.
      const content=JSON.stringify([submitted.answers,assessment]),at=Date.now();
      if(next.lastSubmission?.signature===content&&at-next.lastSubmission.at<350){
        threads.set(key,next);return;
      }
      next.lastSubmission={signature:content,at};next.attempt++;
      if(!assessment.correct)next.wrong++;
      const turn:Turn={id:crypto.randomUUID(),at:new Date().toISOString(),context:structuredClone(submitted),seen:false,
        mode,attempt:next.attempt,text:automaticHint(submitted,assessment,next.attempt,next.wrong,next.previous)};
      next.turns.push(turn);next.previous=assessment;
      if(carryToNext&&assessment.correct)carried.current={key,id:turn.id};
      threads.set(key,next);emit();
    },
    messages:turns.map(t=>({id:t.id,role:"tutor" as const,text:display(t),source:"rules" as const,at:t.at,automatic:true})),
    providedMessages:()=>turns.filter(t=>t.threadKey===key&&threads.get(t.threadKey)?.turns.find(row=>row.id===t.id)?.seen)
      .map(t=>({id:t.id,role:"tutor" as const,text:display(t),source:"rules" as const,at:t.at,automatic:true})),
    unread:unseen.length,preview:unseen.length?display(unseen.at(-1)!):undefined,
    storageFailed:related.some(([,t])=>t.storageFailed),
    acknowledge:()=>{
      if(!unseen.length)return false;
      if(mode==="gpt"){
        const rows=readEvidence<Record<string,unknown>>(KEY,(v):v is Record<string,unknown>=>!!v&&typeof v==="object"&&"id" in v);
        const added=unseen.filter(t=>t.mode==="gpt"&&!rows.some(row=>row.id===t.id)).map(t=>({
          ...learningRecordContext("math"),id:t.id,task:t.context.task,at:t.at,prediction:t.context,
          feedbackStatus:"displayed",trigger:"submit",automatic:true,
          feedback:{provider:"rules",status:"unconfigured",createdAt:t.at,text:t.text},
        }));
        if(added.length&&!writeEvidence(KEY,[...rows,...added]))related.forEach(([,t])=>{t.storageFailed=true;});
      }
      for(const [,t] of related)for(const turn of t.turns)if(unseen.some(row=>row.id===turn.id))turn.seen=true;
      emit();return true;
    },
  };
}
