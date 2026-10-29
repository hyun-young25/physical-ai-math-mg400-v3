import { frameTransformPoint, type PaperFrame } from "./paperCoordinateStudy";
import type { PaperCoordinateStudyViewState } from "./paperCoordinateViewModel";
import type { JourneyPoint } from "./revisionJourney";
import { revisionSceneSeries, type RevisionPhase, type RevisionSeries } from "./revisionSceneStore";
import { paperRotationVisual } from "./paperRotationVisual";

export const PAPER_COLORS = { reference: "#64748b", target: "#22a06b", prediction: "#8b5cf6", first: "#f97316", result: "#2563eb", mismatch: "#ef4444" } as const;
export type PaperSceneData = Pick<PaperCoordinateStudyViewState, "level" | "stage" | "frame" | "samples" | "targetPoints" | "predictions" | "revisionJourney" | "running" | "diagnosis" | "run" | "displayPose" | "displaySource">;
export type PaperScenePoint = { x: number; y: number; z: number };
export function paperFrameSource(data: PaperSceneData) {
  if (!data.frame) return "위치 미확인";
  if (data.level==="advanced-paper-dt") return "주어진 기준점 · DT 과제 조건";
  return data.frame.source==="hardware"?"실장비 · 제어기 TCP 보고 좌표":data.frame.source==="mock"?"모의 브리지 · 실측 아님":data.frame.source==="teacher"?"교사 입력 · 측정값 아님":"DT · 실측 아님";
}

/** Display geometry only. O→X and O→Y each span 10 cm; the sheet spans 20 cm. */
export function paperPoint(frame: PaperFrame | null, xCm: number, yCm: number): PaperScenePoint {
  return frame ? frameTransformPoint(frame, { xCm, yCm }) : { x: xCm * 10, y: yCm * 10, z: 0 };
}
export function paperCorners(frame: PaperFrame | null) {
  return [[0,0],[20,0],[20,20],[0,20]].map(([x,y]) => paperPoint(frame,x,y));
}
export function paperGrid(frame: PaperFrame | null) {
  return Array.from({length:21},(_,i) => [
    [paperPoint(frame,i,0),paperPoint(frame,i,20)],
    [paperPoint(frame,0,i),paperPoint(frame,20,i)],
  ]).flat();
}
const number = (text: string) => text.trim() && Number.isFinite(Number(text)) ? Number(text) : null;
export function paperSceneSeries(data: PaperSceneData, phase: RevisionPhase): RevisionSeries[] {
  if (!data.frame) return [];
  const targets = data.targetPoints.map(p=>({label:p.name,...paperPoint(data.frame,p.xCm,p.yCm)}));
  const target: RevisionSeries = {label:"목표점",points:targets,color:PAPER_COLORS.target,dashed:false,source:"과제 조건"};
  if (!data.revisionJourney) return [target, {label:"입력 중 예측",points:data.predictions.map(p=>({label:p.name,x:number(p.robotX),y:number(p.robotY)})),color:PAPER_COLORS.prediction,dashed:true,source:"예측 · 실행 전"}];
  const result = revisionSceneSeries(data.revisionJourney,phase);
  // Never overlay an old frame/target set onto today's sheet.
  if (JSON.stringify(result[0].points.map(({label,x,y})=>({label,x,y}))) !== JSON.stringify(targets.map(({label,x,y})=>({label,x,y})))) return [target];
  return [target,...result.slice(1).map(s=>({...s,color:s.dashed?PAPER_COLORS.prediction:s.label==="수정 후 실행"?PAPER_COLORS.result:PAPER_COLORS.first}))];
}
export function paperMismatchPoints(data: PaperSceneData, series: RevisionSeries[]): string[] {
  // Reuse the recorded diagnosis evidence. Do not create a new grade from the drawing.
  if (data.running || data.diagnosis?.status !== "complete" || data.run?.status !== "completed" || data.run.frameId !== data.frame?.id) return [];
  const shown = series.find(s=>!s.dashed && s.label!=="목표점" && s.points.length===data.run!.observations.length && s.points.every(p=>data.run!.observations.some(o=>o.point===p.label&&o.pose.x===p.x&&o.pose.y===p.y)));
  return shown ? (data.diagnosis.taskEvidence??[]).filter(e=>e.distance>(data.diagnosis?.toleranceMm??2)).map(e=>e.point) : [];
}
export function validPaperPoint(p: JourneyPoint): p is JourneyPoint & {x:number;y:number} {
  return p.x!==null && p.y!==null && Number.isFinite(p.x) && Number.isFinite(p.y);
}
export function paperSceneRotation(data: PaperSceneData, series: RevisionSeries[]) {
  if(data.level!=="advanced-paper-hardware" || ![5,6].includes(data.stage) || data.running || data.diagnosis?.status!=="complete") return null;
  const shown=series.some(s=>!s.dashed&&s.label!=="목표점"&&s.points.length===data.run?.observations.length&&s.points.every(p=>data.run!.observations.some(o=>o.point===p.label&&o.pose.x===p.x&&o.pose.y===p.y)));
  return shown ? paperRotationVisual(data.frame,data.targetPoints,data.run) : null;
}
export function paperSeriesSegments(points: JourneyPoint[]) {
  const pairs=points.slice(1).map((p,i)=>[points[i],p]);
  if(points.length===4&&points.every(validPaperPoint)) pairs.push([points[3],points[0]]);
  return pairs.filter(pair=>pair.every(validPaperPoint)) as (JourneyPoint & {x:number;y:number})[][];
}
