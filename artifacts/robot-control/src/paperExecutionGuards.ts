import type { LessonPose } from "./curriculum";
import { frameInversePoint, frameTransformPoint, type PaperFrame } from "./paperCoordinateStudy";

export const PAPER_SUPERVISED_MARGIN_MM = 30;
export type PaperRunBlocker = { message: string; target: "prediction" | "height" | "connection" | "teacher" | "dt" };

/** Distance to the physical 20 cm sheet, in robot millimetres, including rotated frames. */
export function paperBoundary(frame: PaperFrame, pose: LessonPose) {
  const local = frameInversePoint(frame, pose);
  if (!local || !Number.isFinite(local.xCm) || !Number.isFinite(local.yCm)) return { outside: true, distance: Infinity };
  const outside = local.xCm < -1e-7 || local.yCm < -1e-7 || local.xCm > 20 + 1e-7 || local.yCm > 20 + 1e-7;
  if (!outside) return { outside: false, distance: 0 };
  const corners = [[0,0],[20,0],[20,20],[0,20]].map(([xCm,yCm]) => frameTransformPoint(frame,{xCm,yCm}));
  const distance = Math.min(...corners.map((a,i) => {
    const b = corners[(i+1)%4], dx=b.x-a.x, dy=b.y-a.y;
    const t = Math.max(0,Math.min(1,((pose.x-a.x)*dx+(pose.y-a.y)*dy)/(dx*dx+dy*dy)));
    return Math.hypot(pose.x-a.x-t*dx,pose.y-a.y-t*dy);
  }));
  return { outside, distance };
}

export function supervisedPaperBlockers(enabled: boolean, mismatch: boolean, dtCompleted: boolean,
  frame: PaperFrame | null, points: { point:string; pose:LessonPose }[]): PaperRunBlocker[] {
  if (!mismatch) return [];
  const reasons: PaperRunBlocker[] = [];
  if (!enabled) reasons.push({message:"목표와 다른 예측입니다. 교사 감독 허용이 꺼져 있어 실장비로 실행할 수 없습니다.",target:"teacher"});
  if (!dtCompleted) reasons.push({message:"같은 예측을 DT에서 먼저 끝까지 실행하세요.",target:"dt"});
  if (frame) for (const p of points) {
    if (paperBoundary(frame,p.pose).distance > PAPER_SUPERVISED_MARGIN_MM)
      reasons.push({message:`${p.point}이 종이 영역에서 ${PAPER_SUPERVISED_MARGIN_MM} mm를 초과해 벗어났습니다. 예측을 수정하세요.`,target:"prediction"});
  }
  return reasons;
}
