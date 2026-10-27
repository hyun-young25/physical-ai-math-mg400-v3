import { getLearningUser, learningRequest, type LearningUser } from "./learningClient";

export const LEARNING_CONTENT_VERSION = "mg400-math-content-2026-10";
type Json = Record<string, any>;
export type PendingEvent = { eventId: string; storeKey: string; recordId: string; chapter: string; task: string;
  eventKind: string; occurredAt: string; contentVersion: string; dataSource: string; payload: Json; changedPaths: string[] };
export type SaveState = { pending: number; state: "ready" | "pending" | "saving" | "failed"; message: string; };
let saveState: SaveState = { pending: 0, state: "ready", message: "아직 새 학습 기록이 없습니다." };
const listeners = new Set<() => void>();
export const subscribeLearningSave = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const getLearningSaveState = () => saveState;
const setState = (state: SaveState) => { saveState = state; for (const listener of listeners) listener(); };
const previous = new Map<string, string>();
let queue: PendingEvent[] = [];
let inFlight:Promise<boolean>|undefined;
let localQueueFailed = false;
let timer: ReturnType<typeof setInterval> | undefined;
export const learningStorageKey = (key: string) => {
  const user = getLearningUser();
  if(user?.role!=="student")return key;
  if(!user.visitId)throw new Error("학습 시작 정보가 없습니다.");
  return `mg400:visit:${user.visitId}:${key}`;
};
const OUTBOX_PREFIX="mg400:pending-visit:";
type Outbox={version:2;visitId:string;events:PendingEvent[]};
const queueKey = (visitId=getLearningUser()?.visitId) => `${OUTBOX_PREFIX}${visitId??"none"}`;
export function getEvidenceItem(key: string) { return localStorage.getItem(learningStorageKey(key)); }
export function removeEvidenceItem(key: string) { localStorage.removeItem(learningStorageKey(key)); }

function changedPaths(a: unknown, b: unknown, path = "", out: string[] = []): string[] {
  if (JSON.stringify(a) === JSON.stringify(b) || out.length >= 1000) return out;
  if (b === null || typeof b !== "object") { out.push(path || "$"); return out; }
  if (Array.isArray(b)) { b.forEach((item,i) => changedPaths((a as unknown[] | undefined)?.[i], item, `${path}[${i}]`, out)); return out; }
  for (const [key,value] of Object.entries(b)) changedPaths((a as Json | undefined)?.[key], value, path ? `${path}.${key}` : key, out);
  return out;
}
function metadata(key: string, record: Json, paths: string[]) {
  const task = String(record.task ?? record.taskId ?? record.condition?.id ?? record.lessonId ?? record.id ?? key);
  let chapter = /math-start|foundation|height-practice|height-transfer|vector-practice|vector-transfer|trig|link/.test(task) && key.includes("inquiry") ? "기초수학"
    : /shape|square|triangle|circle/.test(key + task) ? "도형 경로"
    : /pickplace|pick-place/.test(key + task) ? "픽앤플레이스"
    : /process/.test(key) ? "공정 확장"
    : /coordinate|axis|motion/.test(key + task) ? "좌표와 이동"
    : /fk|ik|kinematic/.test(task) ? "운동학" : "기초수학";
  if (key.includes("hardware") || task === "hardware-operations") chapter = "실장비 조작";
  if (task === "process-cell") chapter = "공정 확장";
  const kinds = new Set<string>();
  if (paths.some(p => /prediction|answers|draft|commands|plan/.test(p))) kinds.add("예측·수치 확정");
  if (paths.some(p => /feedback|hint|support|practice|checks/.test(p))) kinds.add("힌트·보충 지원");
  if (paths.some(p => /reflection|explanation|observation|judgment|reason|revision/.test(p))) kinds.add("관찰·비교·해석·수정");
  const allStatuses: string[] = [];
  const walk = (v: any) => {
    if (!v || typeof v !== "object") return;
    if (typeof v.status === "string") allStatuses.push(v.status);
    for (const child of Object.values(v)) if (child && typeof child === "object") walk(child);
  };
  if (paths.some(p => /status|runs|executed|results|endedAt|startedAt/.test(p))) {
    walk(record);
    const status = record.status ?? allStatuses.at(-1);
    if (status === "running") kinds.add("실행 시작·진행");
    else if (status === "completed") kinds.add("실행 완료");
    else if (status === "stopped") kinds.add("실행 중단");
    else if (["failed","unavailable","invalid"].includes(status)) kinds.add("실행 실패·실행 불가");
    // Opening a hint / submitting a prediction is not an execution.
  }
  return { chapter, task, eventKind: [...kinds].join(" / ") || "학습 기록 확정",
    dataSource: String(record.dataSource ?? record.source ?? record.measurement?.source ?? (chapter === "기초수학" ? "math" : "dt")) };
}
function persistQueue(visitId=getLearningUser()?.visitId,events=queue) {
  if(!visitId)return false;
  try {
    localStorage.setItem(queueKey(visitId), JSON.stringify({version:2,visitId,events} satisfies Outbox));
    if(visitId===getLearningUser()?.visitId)localQueueFailed=false;
    return true;
  }catch{
    if(visitId===getLearningUser()?.visitId)localQueueFailed=true;
    return false;
  }
}
function readOutbox(key:string):Outbox {
  const value:unknown=JSON.parse(localStorage.getItem(key)??"null");
  const box=value as Outbox|null;
  if(!box||box.version!==2||typeof box.visitId!=="string"||key!==queueKey(box.visitId)||!Array.isArray(box.events))
    throw new Error("전송 대기 기록을 읽지 못했습니다. 브라우저 저장소를 지우지 말고 교수자에게 문의하세요.");
  return box;
}
/** Capture only committed evidence. Anonymous records are never assigned to a student. */
export function captureEvidence(key: string, value: unknown) {
  const user = getLearningUser();
  if (!user || user.role !== "student" || !user.visitId) return;
  const normalized = key.replace(/:active-run$/, "");
  const rows = Array.isArray(value) ? value : [value];
  for (const [index, raw] of rows.entries()) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Json;
    const recordId = String(record.id ?? record.taskId ?? `${normalized}:${index}`);
    const identity = `${normalized}/${recordId}`;
    const serialized = JSON.stringify(record);
    if (previous.get(identity) === serialized) continue;
    const before = previous.get(identity);
    const paths = changedPaths(before ? JSON.parse(before) : undefined, record);
    // App initializes empty aggregate state; that is not a student activity.
    if (record.id === "coordinate-lessons" && !Object.entries(record).some(([k,v]) =>
      !["id","version","savedAt"].includes(k) && (Array.isArray(v) ? v.length > 0 : v && typeof v === "object" && Object.keys(v).length > 0))) {
      previous.set(identity,serialized); continue;
    }
    // savedAt alone is bookkeeping, not a new activity.
    if (before && paths.every(p => p === "savedAt")) { previous.set(identity,serialized); continue; }
    const clean = JSON.parse(serialized) as Json;
    const event: PendingEvent = { eventId: crypto.randomUUID(), storeKey: normalized, recordId, ...metadata(normalized,clean,paths),
      occurredAt: new Date().toISOString(), contentVersion: LEARNING_CONTENT_VERSION, payload: clean, changedPaths: paths };
    queue.push(event); previous.set(identity,serialized);
  }
  persistQueue();
  setState({ pending: queue.length, state: localQueueFailed ? "failed" : queue.length ? "pending" : saveState.state,
    message: localQueueFailed ? "브라우저 임시 저장 실패 · 화면을 닫지 마세요." : queue.length ? `전송 대기 ${queue.length}건` : saveState.message });
}
export function setEvidenceItem(key: string, text: string) {
  // Queue independently, even if a history write hits browser quota.
  captureEvidence(key, JSON.parse(text));
  localStorage.setItem(learningStorageKey(key), text);
}
export function recordLearningAction(task: string, kind: string, payload: Json, source = "dt") {
  const id = crypto.randomUUID();
  captureEvidence("physical-ai-action-events-v1", { id, task, status: kind, dataSource: source, ...payload });
}
export function flushLearningQueue():Promise<boolean>{
  if(inFlight)return inFlight;
  inFlight=performFlush().finally(()=>{inFlight=undefined;});
  return inFlight;
}
export const canLeaveLearningVisit=()=>!localQueueFailed||queue.length===0;
async function performFlush(): Promise<boolean> {
  const currentVisit=getLearningUser()?.visitId;
  let failed=false;
  try {
    const boxes=new Map<string,Outbox>();
    // Only new, explicitly attributed outboxes. Never adopt anonymous evidence
    // or older password-account queues merely because a student typed an ID.
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);if(key?.startsWith(OUTBOX_PREFIX)){
        try{const box=readOutbox(key);if(box.events.length)boxes.set(box.visitId,box);}
        catch{failed=true;} // Preserve unreadable data, but do not block new valid visits.
      }
    }
    if(currentVisit&&queue.length)boxes.set(currentVisit,{version:2,visitId:currentVisit,events:queue});
    for(const box of boxes.values()){
      try{
        while(box.events.length){
          const events=box.events.slice(0,3);
          if(getLearningUser()?.visitId===box.visitId)
            setState({pending:queue.length,state:"saving",message:`서버 전송 중 ${queue.length}건`});
          const {acknowledged}=await learningRequest<{acknowledged:string[]}>("/records","POST",{visitId:box.visitId,events});
          if(!Array.isArray(acknowledged)||events.some(e=>!acknowledged.includes(e.eventId)))throw new Error("저장 확인 누락");
          const ids=new Set(events.map(e=>e.eventId));
          if(getLearningUser()?.visitId===box.visitId){
            queue=queue.filter(e=>!ids.has(e.eventId));box.events=queue;
          }else box.events=box.events.filter(e=>!ids.has(e.eventId));
          if(!persistQueue(box.visitId,box.events))throw new Error("대기 목록 정리 실패");
        }
      }catch{failed=true;} // Preserve the original visit and continue other students' outboxes.
    }
    if(currentVisit&&getLearningUser()?.visitId===currentVisit)
      setState({pending:queue.length,state:failed||localQueueFailed?"failed":"ready",
        message:failed?"기록 전송 지연 · 원래 식별값으로 다시 시도합니다.":localQueueFailed?"브라우저 임시 저장 실패 · 화면을 닫지 마세요.":"서버 저장 완료"});
    return !failed&&!localQueueFailed&&queue.length===0;
  } catch (error) {
    if(currentVisit&&getLearningUser()?.visitId===currentVisit)
      setState({pending:queue.length,state:"failed",message:error instanceof Error?error.message:"전송 대기 기록 확인 실패"});
    return false;
  }
}
export async function initializeLearningSync(user: LearningUser) {
  if(!user.visitId||getLearningUser()?.visitId!==user.visitId)throw new Error("학습 시작 정보를 확인하세요.");
  previous.clear(); queue = []; localQueueFailed = false;
  if(localStorage.getItem(queueKey(user.visitId))!==null)queue=readOutbox(queueKey(user.visitId)).events;
  for(const e of queue)previous.set(`${e.storeKey}/${e.recordId}`,JSON.stringify(e.payload));
  // Deliberately no GET /records and no account-ID/anonymous cache hydration.
  setState({pending:queue.length,state:queue.length?"pending":"ready",message:queue.length?`전송 대기 ${queue.length}건`:"학습 기록은 자동 저장됩니다."});
  if (timer) clearInterval(timer);
  timer = setInterval(() => { void flushLearningQueue(); }, 2500);
  void flushLearningQueue();
}
export function stopLearningSync() { if (timer) clearInterval(timer); timer = undefined; }
if (typeof window !== "undefined") {
  window.addEventListener("online", () => { void flushLearningQueue(); });
  window.addEventListener("beforeunload", event => {
    if (getLearningUser()?.role === "student" && (queue.length || localQueueFailed)) { event.preventDefault(); event.returnValue = ""; }
  });
}
