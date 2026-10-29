import { getPaperFrameAngleDegrees, type PaperFrame, type PaperRunSnapshot, type PaperGridPoint } from "./paperCoordinateStudy";
import { paperTransformEstimate } from "./paperRectangleTask";

/** Display-only angle from the completed P1→P2 observation. Never supplies an answer or a grade. */
export function paperRotationVisual(frame: PaperFrame | null, targets: PaperGridPoint[], run: PaperRunSnapshot | null) {
  if (!frame || run?.status!=="completed" || run.frameId!==frame.id) return null;
  const estimate=paperTransformEstimate(frame,targets,run);
  if (!estimate || ![estimate.relativeAngle,estimate.scaleX,estimate.scaleY].every(Number.isFinite)
    || estimate.scaleX<1e-6 || Math.abs(estimate.relativeAngle)<=1) return null;
  const start=run.observations.find(o=>o.point==="P1")?.pose;
  if (!start) return null;
  const angle=estimate.relativeAngle, base=getPaperFrameAngleDegrees(frame)*Math.PI/180;
  const radius=44, arc=Array.from({length:33},(_,i)=>{
    const a=base+angle*Math.PI/180*i/32;
    return {x:start.x+radius*Math.cos(a),y:start.y+radius*Math.sin(a),z:frame.samples[0].pose.z};
  });
  const mid=base+angle*Math.PI/360;
  return {...estimate,arc,start:{...start,z:frame.samples[0].pose.z},
    label:{x:start.x+70*Math.cos(mid),y:start.y+70*Math.sin(mid),z:frame.samples[0].pose.z},
    text:`↻ 내 경로가 종이보다 ${Math.abs(angle).toFixed(1)}° ${angle<0?"시계":"반시계"} 방향으로 돌아가 있어요`,
    scaleText:`배율 X ${estimate.scaleX.toFixed(2)} · Y ${estimate.scaleY.toFixed(2)}`};
}
