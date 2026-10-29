import { useSyncExternalStore } from "react";
import type { JourneyPoint, RevisionJourneyData } from "./revisionJourney";
import { useSquareVisual } from "./useSquareVisual";

export const REVISION_PHASES = ["첫 시도", "피드백", "답 수정", "재실행 결과"] as const;
export type RevisionPhase = 0 | 1 | 2 | 3;
type Snapshot = { owner: string | null; data: RevisionJourneyData | null; phase: RevisionPhase; point: number };
let state: Snapshot = { owner: null, data: null, phase: 1, point: 0 };
const listeners = new Set<() => void>();
const set = (next: Snapshot) => { state = next; listeners.forEach(fn => fn()); };
export const revisionSceneSnapshot = () => state;
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const useRevisionScene = () => useSyncExternalStore(subscribe, revisionSceneSnapshot, revisionSceneSnapshot);
export const hasRevisionResult = (d: RevisionJourneyData) => d.revising && d.current.id !== d.first.id && d.current.complete;
const defaultPhase = (d: RevisionJourneyData): RevisionPhase => hasRevisionResult(d) ? 3 : d.editing || d.revising ? 2 : 1;
/** Display selection only: no robot commands, storage, scoring or answer changes. */
export function publishRevisionScene(owner: string, data: RevisionJourneyData | null) {
  if (!data) { clearRevisionScene(owner); return; }
  const fresh = owner !== state.owner || data.first.id !== state.data?.first.id;
  const progressed = data.current.id !== state.data?.current.id || data.current.complete !== state.data?.current.complete || data.editing !== state.data?.editing;
  if (!fresh && JSON.stringify(data) === JSON.stringify(state.data)) return;
  set({ owner, data, phase: fresh || progressed ? defaultPhase(data) : state.phase, point: fresh ? 0 : state.point });
}
export function clearRevisionScene(owner: string) { if (state.owner === owner) set({ owner: null, data: null, phase: 1, point: 0 }); }
export function selectRevisionPhase(phase: RevisionPhase) { if (state.data) set({ ...state, phase }); }
export function selectRevisionPoint(point: number) { if (Number.isInteger(point) && point >= 0 && point < 4) set({ ...state, point }); }
export function useActiveRevisionScene() {
  const scene = useRevisionScene(), square = useSquareVisual();
  // Existing history inspection, evidence highlighting and replay retain priority.
  return { ...scene, data: square.visual?.review?.selected || square.emphasis || square.replay ? null : scene.data };
}
export type RevisionSeries = { label: string; points: JourneyPoint[]; color: string; dashed: boolean; source: string };
const sameConditions = (a: RevisionJourneyData["first"], b: RevisionJourneyData["first"]) => a.coordinateFrame === b.coordinateFrame && JSON.stringify(a.target) === JSON.stringify(b.target);
export function revisionSceneSeries(d: RevisionJourneyData, phase: RevisionPhase): RevisionSeries[] {
  const reference = d.referenceFeedback ?? d.previous;
  const attempt = phase === 0 ? d.first : phase === 1 ? reference : d.current;
  const series: RevisionSeries[] = [{ label: "목표점", points: attempt.target, color: "#64748b", dashed: true, source: "과제 조건" }];
  const observed = (label: string, a: typeof attempt, color: string) => ({ label, points: a.complete ? a.observed : [], color, dashed: false, source: a.source });
  if (phase === 0 || phase === 1) series.push(observed(phase === 0 ? "첫 실행" : "피드백 받은 실행", attempt, "#c2410c"));
  if (phase === 2) {
    if (!d.conditionsChanged && sameConditions(reference,d.current)) series.push(observed("수정 전 실행", reference, "#c2410c"));
    series.push({ label: d.editing ? "편집 중 예측" : "저장한 수정 예측", points: d.editing ? d.draft : d.revising ? d.current.points : [], color: "#7c3aed", dashed: true, source: "예측 · 실행 전" });
  }
  if (phase === 3) {
    if (!d.conditionsChanged) series.push(observed("첫 실행", d.first, "#c2410c"));
    series.push({ ...observed("수정 후 실행", d.current, "#2563eb"), points: hasRevisionResult(d) ? d.current.observed : [] });
  }
  return series;
}
export const validJourneyPoint = (p: JourneyPoint): p is JourneyPoint & { x: number; y: number } => p.x !== null && p.y !== null && Number.isFinite(p.x) && Number.isFinite(p.y);
