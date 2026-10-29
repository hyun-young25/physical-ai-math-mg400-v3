import type { InquiryRecord } from "./MathInquiry";
import type { ShapeLesson } from "./shapeLearning";
import type { SquareAttempt } from "./squareAttemptHistory";
import type { PaperTrialRecord, PaperPredictionPoint, PaperStudentTransform } from "./paperCoordinateStudy";
import { frameTransformPoint } from "./paperCoordinateStudy";
import { paperTaskTargets } from "./paperRectangleTask";

export type JourneyPoint = { label: string; x: number | null; y: number | null };
export type JourneyAttempt = {
  id: string; points: JourneyPoint[]; reason: string; model?: string;
  observed: JourneyPoint[]; target: JourneyPoint[]; source: string;
  complete: boolean; outcome: string; match: boolean;
  question: string; gptQuestion: string; cause: string;
};
export type RevisionJourneyData = {
  first: JourneyAttempt; previous: JourneyAttempt; current: JourneyAttempt;
  draft: JourneyPoint[]; draftReason: string; revisionReason: string;
  revising: boolean; editing: boolean; conditionsChanged: boolean;
};

const numeric = (s: string | undefined) => s?.trim() && Number.isFinite(Number(s)) ? Number(s) : null;
export const paperJourneyPoints = (points: PaperPredictionPoint[] = []): JourneyPoint[] =>
  points.map(p => ({ label: p.name, x: numeric(p.robotX), y: numeric(p.robotY) }));
const modelText = (t?: PaperStudentTransform) => t
  ? `기준점 (${t.originX || "—"}, ${t.originY || "—"}) mm · 1 cm = ${t.millimetersPerCentimeter || "—"} mm` : "";
const gpt = (a?: SquareAttempt) => a?.questions.filter(q => q.source === "openai").map(q => q.text).join("\n") ?? "";

/** Follow actual parent links only. Never join unrelated tasks, versions or visits. */
export function linkedAttempts<T extends {id:string}>(current:T, rows:T[], parent:(r:T)=>string|null|undefined, compatible:(r:T)=>boolean):T[] {
  const chain=[current], seen=new Set([current.id]);
  let row=current;
  while(parent(row)) {
    const prior=rows.find(r=>r.id===parent(row));
    if(!prior || seen.has(prior.id) || !compatible(prior)) break;
    chain.unshift(prior);seen.add(prior.id);row=prior;
  }
  return chain;
}
const targetChanged = (a:JourneyAttempt,b:JourneyAttempt) => JSON.stringify(a.target)!==JSON.stringify(b.target);

export function paperRevisionJourney(active:PaperTrialRecord|null|undefined, records:PaperTrialRecord[], snapshots:SquareAttempt[],
  draft:PaperPredictionPoint[], transform:PaperStudentTransform, stage:number):RevisionJourneyData|null {
  if(!active) return null;
  const chain=linkedAttempts(active,records,r=>r.parentAttemptId,r=>r.level===active.level&&r.taskVersion===active.taskVersion);
  if(!chain.some(r=>r.run)) return null;
  const convert=(r:PaperTrialRecord):JourneyAttempt=>{
    const snapshot=snapshots.filter(a=>a.recordId===r.id&&a.runId===r.run?.id).at(-1);
    const valid=!!r.run&&r.run.status==="completed"&&r.run.planHash===r.planHash&&r.run.frameId===r.frame?.id
      &&!r.invalidatedRunIds?.includes(r.run.id);
    const diagnosed=valid&&r.diagnosis?.status==="complete";
    return {id:r.id,points:paperJourneyPoints(r.predictions),reason:r.transform?.explanation??"",model:modelText(r.transform),
      observed:valid?r.run!.observations.map(o=>({label:o.point,x:o.pose.x,y:o.pose.y})):[],
      target:r.frame?paperTaskTargets(r.level,r.targetSet).map(p=>({label:p.name,...frameTransformPoint(r.frame!,p)})):[],
      source:r.run?.source??"",complete:valid,match:!!diagnosed&&r.diagnosis?.pattern==="match",
      outcome:diagnosed?r.diagnosis!.candidate:valid?"실행 완료 · 비교 대기":r.run?"실행 미완료 · 다시 확인":"실행 전",
      question:diagnosed?(snapshot?.visual?.plan?.question??r.diagnosis!.question):"",gptQuestion:gpt(snapshot),cause:r.studentHypothesis??""};
  };
  const first=convert(chain[0]),current=convert(active),previous=convert(chain.at(-2)??active);
  const revising=chain.length>1;
  return {first,previous,current,draft:paperJourneyPoints(draft),draftReason:transform.explanation,
    revisionReason:chain.at(-2)?.revisionReason??active.revisionReason??"",revising,
    editing:stage===7||revising&&stage<=3,conditionsChanged:revising&&(targetChanged(first,current)
      ||chain[0].frame?.coordinateSystem!==active.frame?.coordinateSystem||chain[0].frame?.user!==active.frame?.user||chain[0].frame?.tool!==active.frame?.tool)};
}

export function squareRevisionJourney(lesson:ShapeLesson, conditionKey:string, record:InquiryRecord|null, records:InquiryRecord[],
  snapshots:SquareAttempt[], draft:Record<string,string>, reason:string, stage:number):RevisionJourneyData|null {
  const active=record??records.filter(r=>r.conditionKey===conditionKey).at(-1);
  if(!active) return null;
  const chain=linkedAttempts(active,records,r=>r.previousId,r=>r.conditionKey===conditionKey&&r.taskVersion===active.taskVersion);
  if(!chain.some(r=>r.runs.some(run=>run.action==="mission"))) return null;
  const points=(answers:Record<string,string>):JourneyPoint[] => lesson.pathPlan.rows.map(r=>({label:r.label,x:numeric(answers[r.xKey]),y:numeric(answers[r.yKey])}));
  const convert=(r:InquiryRecord):JourneyAttempt=>{
    const snapshot=snapshots.filter(a=>a.recordId===r.id&&a.runId===String(r.runs.length)).at(-1);
    const mission=r.runs.filter(run=>run.action==="mission").at(-1);
    const entry=r.mismatchDiagnoses?.filter(d=>d.runCount===r.runs.length).at(-1);
    const valid=mission?.status==="completed";
    const source=snapshot?.source??entry?.source??"dt";
    const detail=mission?.detail as {observedVertices?:JourneyPoint[]}|undefined;
    return {id:r.id,points:points(r.prediction),reason:r.reason,observed:valid?(snapshot?.visual.observed??detail?.observedVertices??[]):[],
      target:snapshot?.visual.target??[],source,complete:valid,match:!!valid&&entry?.type==="match",
      outcome:valid?(entry?.label??"실행 완료 · 비교 대기"):mission?"실행 미완료 · 다시 확인":"실행 전",
      question:valid?(snapshot?.visual.plan?.question??entry?.question??""):"",gptQuestion:gpt(snapshot),cause:snapshot?.studentCause||entry?.causeExplanation||""};
  };
  const first=convert(chain[0]),current=convert(active),previous=convert(record?(chain.at(-2)??active):active);
  const revising=chain.length>1||!record;
  // While editing, a saved earlier run must not appear as the new execution result.
  return {first,previous,current:record?current:{...current,id:"draft",complete:false,observed:[],match:false,outcome:"재실행 대기"},
    draft:points(draft),draftReason:reason,revisionReason:previous.cause,revising,
    editing:stage===7||revising&&stage<=3,conditionsChanged:false};
}

export function journeySource(source:string) {
  return source==="hardware"?"실장비 · 제어기 보고 좌표":source==="mock"?"모의 · 실측 아님":source==="dt"?"DT · 실측 아님":"실행 자료 없음";
}
