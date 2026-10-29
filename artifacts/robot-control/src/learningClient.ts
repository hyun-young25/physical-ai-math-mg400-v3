import type { LearningIdentity } from "@workspace/api-client-react";
export type LearningUser = LearningIdentity;
export type LearningClass = { code: string; title: string; created_at: string };
export type LearningStudent = { id: string; class_code: string; login: string; record_count: number; attempt_count: number; last_activity: string | null };
export type LearningEvent = { sequence: number; event_id: string; class_code: string; login: string; store_key: string; record_id: string;
  chapter: string; task: string; event_kind: string; occurred_at: string; received_at: string; content_version: string; data_source: string;
  payload: Record<string, unknown>; changed_paths: string[] };
export type LearningFilter = { login?: string; chapter?: string; from?: string; to?: string };
let activeUser: LearningUser | null = null;
export const getLearningUser = () => activeUser;
export function setLearningUser(user: LearningUser | null) { activeUser = user; }
// API is registered at /api by the shared proxy, separate from the UI artifact.
const API = "/api/learning";
export async function learningRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method, credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Learning-Request": "1",
      ...(activeUser && path!=="/records" ? { "X-Learning-Account": activeUser.id } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "서버 요청에 실패했습니다.");
  return data;
}
export async function enterStudent(input: { login: string }) {
  const data = await learningRequest<{ user: LearningUser }>("/student/enter", "POST", input);
  setLearningUser(data.user); return data.user;
}
export const getOwnerIdentity = () => learningRequest<{user:LearningUser}>("/session");
export async function logoutLearning() { await learningRequest("/logout", "POST", {}); setLearningUser(null); }
export const listLearningStudents = () => learningRequest<{ students: LearningStudent[] }>("/teacher/students");
export const filterQuery = (f: LearningFilter) => new URLSearchParams(Object.entries(f).filter(([,v]) => !!v) as [string,string][]).toString();
export const listTeacherRecords = (f: LearningFilter, offset=0) =>
  learningRequest<{ records: LearningEvent[]; total: number; offset: number; limit: number }>(`/teacher/records?${filterQuery(f)}&offset=${offset}`);
export type AttemptFilter=LearningFilter&{taskIndex?:string;taskVersion?:string};
export const downloadSquareAttemptCsv=(f:AttemptFilter)=>downloadTeacherCsv(f,true);
export async function downloadTeacherCsv(f: LearningFilter = {},attempts=false) {
  const res = await fetch(`${API}/teacher/${attempts?"attempts/csv":"csv"}?${filterQuery(f)}`, { credentials: "same-origin",
    headers: { "X-Learning-Account": activeUser?.id ?? "" } });
  if (!res.ok) { const data=await res.json(); throw new Error(data.error ?? "CSV를 내려받지 못했습니다."); }
  const url=URL.createObjectURL(await res.blob()); const a=document.createElement("a");
  a.href=url; a.download=attempts?"MG400-시도별기록.csv":"MG400-학습기록.csv"; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
