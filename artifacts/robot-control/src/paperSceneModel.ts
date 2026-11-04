import {
  PAPER_GRID_SIZE_CM,
  frameTransformPoint,
  type PaperFrame,
  type PaperPredictionPoint,
  type PaperV6StudentModel,
} from "./paperCoordinateStudy";
import { paperV6EquationTerms, paperV6ModelFromDraft } from "./paperV6Model";
import type { PaperCoordinateStudyViewState } from "./paperCoordinateViewModel";
import type { JourneyPoint } from "./revisionJourney";
import { revisionSceneSeries, type RevisionPhase, type RevisionSeries } from "./revisionSceneStore";
import { paperRotationVisual } from "./paperRotationVisual";

export const PAPER_COLORS = { reference: "#64748b", target: "#22a06b", prediction: "#8b5cf6", first: "#f97316", result: "#2563eb", mismatch: "#ef4444", robotPreview: "#60a5fa", robotOutline: "#3b82f6" } as const;
export type PaperSceneData = Pick<PaperCoordinateStudyViewState, "level" | "stage" | "frame" | "samples" | "targetPoints" | "predictions" | "revisionJourney" | "running" | "diagnosis" | "run" | "displayPose" | "displaySource" | "activeAttempt">;
export type PaperScenePoint = { x: number; y: number; z: number };
export function paperFrameSource(data: PaperSceneData) {
  if (!data.frame) return "위치 미확인";
  if (data.level==="advanced-paper-dt") return "주어진 기준점 · DT 과제 조건";
  return data.frame.source==="hardware"?"실장비 · 제어기 TCP 보고 좌표":data.frame.source==="mock"?"모의 브리지 · 실측 아님":data.frame.source==="teacher"?"교사 입력 · 측정값 아님":"DT · 실측 아님";
}

/** Display geometry for the current 10 × 10 cm paper task. */
export function paperPoint(frame: PaperFrame | null, xCm: number, yCm: number): PaperScenePoint {
  return frame ? frameTransformPoint(frame, { xCm, yCm }) : { x: xCm * 10, y: yCm * 10, z: 0 };
}
export function paperCorners(frame: PaperFrame | null) {
  return [
    [0, 0],
    [PAPER_GRID_SIZE_CM, 0],
    [PAPER_GRID_SIZE_CM, PAPER_GRID_SIZE_CM],
    [0, PAPER_GRID_SIZE_CM],
  ].map(([x, y]) => paperPoint(frame, x, y));
}
export function paperGrid(frame: PaperFrame | null) {
  return Array.from({length:PAPER_GRID_SIZE_CM+1},(_,i) => [
    [paperPoint(frame,i,0),paperPoint(frame,i,PAPER_GRID_SIZE_CM)],
    [paperPoint(frame,0,i),paperPoint(frame,PAPER_GRID_SIZE_CM,i)],
  ]).flat();
}
export function paperSceneGridSize(data: PaperSceneData) {
  return PAPER_GRID_SIZE_CM;
}
const number = (text: string) => text.trim() && Number.isFinite(Number(text)) ? Number(text) : null;

export function paperFrameAngleDegrees(frame: PaperFrame | null): number | null {
  if (!frame) return null;
  const origin = frameTransformPoint(frame, { xCm: 0, yCm: 0 });
  const xUnit = frameTransformPoint(frame, { xCm: 1, yCm: 0 });
  const dx = xUnit.x - origin.x;
  const dy = xUnit.y - origin.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 1e-6)
    return null;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

export function paperSceneLiveModel(data: PaperSceneData): PaperV6StudentModel | null {
  const attempt = data.activeAttempt;
  if (
    !data.frame ||
    attempt?.taskVersion !== "v6-paper-transform"
  )
    return null;
  const draft = attempt.drafts?.v6;
  const model = draft
    ? paperV6ModelFromDraft({
        ...draft,
        // Only the θ the student entered (or the θ=0 assumption) drives the preview —
        // never a θ derived from ΔX/ΔY, which would show the answer before it is computed.
        thetaDeg:
          draft.thetaAssumption === "zero" ? "0" : draft.thetaDeg?.trim() ?? "",
      }).model
    : attempt.v6?.model ?? null;
  return model;
}

export function paperSceneLivePredictions(data: PaperSceneData): PaperPredictionPoint[] {
  if (!data.frame) return [];
  const model = paperSceneLiveModel(data);
  if (!model) return [];
  const attempt = data.activeAttempt!;
  const draft = attempt.drafts?.v6;
  const first = data.targetPoints[0];
  return data.targetPoints.map((point) => {
    const terms = paperV6EquationTerms(point, model);
    const manuallyEntered = draft?.formulaWork?.[point.name];
    const x = point.name === first?.name
      ? number(manuallyEntered?.robotX ?? "") ?? terms.robotX
      : terms.robotX;
    const y = point.name === first?.name
      ? number(manuallyEntered?.robotY ?? "") ?? terms.robotY
      : terms.robotY;
    const plane = frameTransformPoint(data.frame!, point);
    return {
      ...point,
      robotX: String(x),
      robotY: String(y),
      robotZ: String(plane.z),
    };
  });
}

export function paperSceneSeries(data: PaperSceneData, phase: RevisionPhase): RevisionSeries[] {
  if (!data.frame) return [];
  const targets = data.targetPoints.map(p=>({label:p.name,...paperPoint(data.frame,p.xCm,p.yCm)}));
  const target: RevisionSeries = {label:"목표점",points:targets,color:PAPER_COLORS.target,dashed:false,source:"과제 조건"};
  const livePredictions = paperSceneLivePredictions(data);
  if (!data.revisionJourney) return [target, {label:"입력 중 예측",points:(livePredictions.length ? livePredictions : data.predictions).map(p=>({label:p.name,x:number(p.robotX),y:number(p.robotY)})),color:PAPER_COLORS.prediction,dashed:true,source:"예측 · 실행 전"}];
  const result = revisionSceneSeries(data.revisionJourney,phase);
  // Never overlay an old frame/target set onto today's sheet.
  if (JSON.stringify(result[0].points.map(({label,x,y})=>({label,x,y}))) !== JSON.stringify(targets.map(({label,x,y})=>({label,x,y})))) return [target];
  return [
    target,
    ...result.slice(1).map(s=>({...s,color:s.dashed?PAPER_COLORS.prediction:s.label==="수정 후 실행"?PAPER_COLORS.result:PAPER_COLORS.first})),
    ...(livePredictions.length
      ? [{
          label: "현재 식 미리보기",
          points: livePredictions.map((p) => ({ label: p.name, x: number(p.robotX), y: number(p.robotY) })),
          color: PAPER_COLORS.robotPreview,
          dashed: true,
          source: "학생 식 · 입력 중",
        }]
      : []),
  ];
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

export function paperSceneSourceText(source: string | null | undefined) {
  if (source === "hardware") return "실장비 · 제어기 TCP 보고값";
  if (source === "mock") return "모의 브리지 · 실측 아님";
  if (source === "dt") return "DT 시뮬레이션 · 실측 아님";
  if (source === "teacher") return "교사 입력 · 측정값 아님";
  return "출처 확인 필요";
}

export function paperSceneReadout(
  data: PaperSceneData,
  phase: RevisionPhase,
  point: number | null,
  reference: string | null,
) {
  const selectedName = reference ?? (point === null ? null : `P${point + 1}`);
  const prediction = selectedName?.startsWith("P")
    ? data.predictions.find(item => item.name === selectedName)
    : undefined;
  const predictionX = prediction ? number(prediction.robotX) : null;
  const predictionY = prediction ? number(prediction.robotY) : null;
  const observation = selectedName?.startsWith("P")
    ? data.run?.observations?.find(item => item.point === selectedName)
    : undefined;
  const referenceObservation = selectedName && /^[OXY]$/.test(selectedName)
    ? data.samples.find(item => item.point === selectedName)
    : undefined;
  const series = paperSceneSeries(data, phase);
  const rotation = paperSceneRotation(data, series);

  return {
    selectedName,
    currentPose: data.displayPose ?? null,
    currentSource: data.displaySource ?? null,
    prediction: predictionX !== null && predictionY !== null
      ? { x: predictionX, y: predictionY }
      : null,
    observation: observation && Number.isFinite(observation.pose.x) && Number.isFinite(observation.pose.y)
      ? {
          x: observation.pose.x,
          y: observation.pose.y,
          source: observation.source ?? data.run?.source ?? null,
          runSource: data.run?.source ?? null,
          runStatus: data.run?.status ?? null,
        }
      : null,
    referenceObservation: referenceObservation
      ? {
          x: referenceObservation.pose.x,
          y: referenceObservation.pose.y,
          source: referenceObservation.source ?? data.frame?.source ?? null,
        }
      : null,
    rotationDegrees: rotation?.relativeAngle ?? null,
  };
}

export function paperSeriesSegments(points: JourneyPoint[]) {
  const pairs=points.slice(1).map((p,i)=>[points[i],p]);
  if(points.length===4&&points.every(validPaperPoint)) pairs.push([points[3],points[0]]);
  return pairs.filter(pair=>pair.every(validPaperPoint)) as (JourneyPoint & {x:number;y:number})[][];
}
