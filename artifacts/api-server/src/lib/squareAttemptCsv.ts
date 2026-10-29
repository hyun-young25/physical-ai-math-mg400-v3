import { csvCell } from "./learningCsv";
type Row=Record<string,any>;
export const ATTEMPT_HEADERS=["studentId","visitId","taskVersion","taskIndex","supportMode","attempt","predictions","predictionReason","observed","source","diagnosisType","edge","feedbackLevel","teacherFlag","questionSource","questionText","studentCause","meanError","maxError","createdAt","recordId","runId","provenance"];
/** Export recorded facts only. No diagnosis or question is reconstructed for legacy rows. */
export function attemptRows(event:Row):Row[]{
 const p=event.payload??{},base={studentId:event.account_id,visitId:event.visit_id,recordId:event.record_id};
 if(p.task==="square-attempt")return [{...p,...base,provenance:"stored-attempt"}];
 if(p.taskVersion==="v4-paper-merged")return []; // the separate comparison snapshot is authoritative
 if(p.task==="square"&&Array.isArray(p.mismatchDiagnoses))return p.mismatchDiagnoses.map((d:Row)=>({
 ...base,taskVersion:p.taskVersion,taskIndex:p.taskIndex,supportMode:d.supportMode,attempt:d.attempt,
 predictions:p.prediction,predictionReason:p.reason,observed:d.evidence?.executed?.vertices,source:d.source,
 diagnosisType:d.type,edge:d.edge,feedbackLevel:d.level,teacherFlag:d.teacherFlag,questionSource:d.question?"rules":undefined,
 questionText:d.question,studentCause:d.causeExplanation,meanError:d.evidence?.measured?.meanError,maxError:d.evidence?.measured?.maxError,
 createdAt:d.at??p.submittedAt,runId:d.runCount,provenance:"legacy-recorded-fields"
 }));
 if(p.task==="paper-coordinate"&&p.diagnosis?.status==="complete"){
 const d=p.diagnosis;
 return [{...base,taskVersion:p.taskVersion,taskIndex:p.taskIndex,supportMode:p.support,attempt:p.attempt,
 predictions:p.predictions,predictionReason:p.transform?.explanation,observed:p.run?.observations,source:p.run?.source,
 diagnosisType:d.pattern,edge:d.firstMismatch,feedbackLevel:d.supportLevel,teacherFlag:d.teacherFlag,
 questionSource:d.tutorSource,questionText:d.question,studentCause:p.studentHypothesis,
 meanError:d.meanError,maxError:d.maxError,createdAt:p.run?.endedAt?new Date(p.run.endedAt).toISOString():p.createdAt,runId:p.run?.id,provenance:"legacy-recorded-fields"}];
 }
 return [];
}
export type AttemptFilter={from?:string;to?:string;taskIndex?:string;taskVersion?:string};
export function parseAttemptFilter(query:Row):AttemptFilter{
 const f:AttemptFilter={};
 for(const name of ["from","to","taskIndex","taskVersion"] as const){
 const value=query[name];if(value===undefined||value==="")continue;
 if(typeof value!=="string"||value.length>100)throw Error("filter");
 if((name==="from"||name==="to")&&!Number.isFinite(Date.parse(value)))throw Error("date");
 if(name==="taskIndex"&&!/^[0-5]$/.test(value))throw Error("task");
 f[name]=value;
 }if(f.from&&f.to&&Date.parse(f.from)>=Date.parse(f.to))throw Error("range");
 return f;
}
export function matchesAttempt(row:Row,f:AttemptFilter){
 const date=Date.parse(row.createdAt);
 return (!f.taskIndex||String(row.taskIndex)===f.taskIndex)
 &&(!f.taskVersion||(f.taskVersion==="legacy"?!row.taskVersion:row.taskVersion===f.taskVersion))
 &&(!f.from||(Number.isFinite(date)&&date>=Date.parse(f.from)))
 &&(!f.to||(Number.isFinite(date)&&date<Date.parse(f.to)));
}
export const attemptCsvLine=(row:Row)=>ATTEMPT_HEADERS.map(k=>csvCell(row[k])).join(",")+"\r\n";
