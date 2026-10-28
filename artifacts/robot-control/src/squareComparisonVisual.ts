import type { SquareDiagnosis, SquareFeedbackPlan, SquareObservedVertex } from "./squareMismatchDiagnosis";
import type { FeedbackContext } from "./learningAiContext";

export const DIAG_VISUAL_UI_VERSION = "diag-visual-v2";
export const COMPARISON_COLORS = { target:"#22c55e", executed:"#ff9f1c", mismatch:"#ff3b5c" } as const;
export type SquareVisual = {
  review?:{owner:string;selected:string;items:{id:string;label:string}[]}; toleranceMm?:number; coordinateLabel?:string; connectedVerticesOnly?:boolean; match?:boolean; errorArrows?:boolean;
  key:string; feedbackKey:string; stage:number; diagnosis:SquareDiagnosis; plan:SquareFeedbackPlan|null;
  target:SquareObservedVertex[]; observed:SquareObservedVertex[]; priorSameType:number; supportMode:"guided"|"challenge";
};
export type SquareEvidenceTag = { key:string; edgeIndex?:number; label:string; levelLabel:string };
export const fmtSquare = (n:number) => String(Math.round(n*100)/100);
export const signedSquare = (n:number, axis:string) => `${n>=0?"+":"−"}${axis} ${fmtSquare(Math.abs(n))} mm`;
export function squareExecutionLabel(dx:number,dy:number) {
  return [Math.abs(dx)>1e-6?signedSquare(dx,"X"):"",Math.abs(dy)>1e-6?signedSquare(dy,"Y"):""].filter(Boolean).join(" · ") || "이동 없음";
}
export function squareSourceLabel(source:SquareDiagnosis["evidence"]["source"]) {
  return source==="hardware"?"실장비 GetPose · 제어기 보고 TCP 좌표":source==="mock"?"모의 브리지 관측 · 실물 측정 아님":
    source==="dt"?"DT 시뮬레이터 관측 좌표 · 실물 측정 아님":"학생 예측 좌표 · 실행 관측 아님";
}
export function targetFromDiagnosis(d:SquareDiagnosis,z=0):SquareObservedVertex[] {
  const c=d.evidence.condition,a=c.start,b={x:a.x+c.width*c.xDir,y:a.y},v={x:b.x,y:b.y+c.height*c.yDir};
  return [a,b,v,{x:a.x,y:v.y},a].map((p,i)=>({...p,z,label:i===4?"P1":`P${i+1}`}));
}
export function squareFeedbackKey(c:Pick<FeedbackContext,"answers"|"attempts"|"history">,evidence:SquareDiagnosis["evidence"]) {
  return JSON.stringify([c.answers,c.attempts,c.history,evidence.source,evidence.condition,evidence.executed?.vertices.map(p=>[p.x,p.y,p.label]),evidence.rejected]);
}
/** Display metadata only. Incomplete/truncated contexts do not acquire invented evidence. */
export function squareEvidenceTag(c:FeedbackContext):SquareEvidenceTag|undefined {
  if(c.task==="paper-coordinate"){
    try{const j=JSON.parse(c.judgment),r=JSON.parse(c.execution)?.[0];if(!j.candidate||r?.status!=="completed")return;
      return {key:JSON.stringify(["paper",c.condition,c.answers,c.execution]),label:[j.candidate,r.source==="hardware"?"실장비 보고":r.source==="mock"?"모의 관측":"DT 관측"].join(" · "),levelLabel:""};
    }catch{return;}
  }
  if(c.task!=="square")return;
  try {
    const d=JSON.parse(c.judgment)?.diagnosis;
    if(!d||!d.evidence||!["dt","hardware","mock"].includes(d.evidence.source))return;
    const source=d.evidence.source==="hardware"?"실장비 보고":d.evidence.source==="mock"?"모의 관측":"DT 관측";
    return {key:squareFeedbackKey(c,d.evidence),edgeIndex:d.edge?["P1 → P2","P2 → P3","P3 → P4","P4 → P1"].indexOf(d.edge)+1||undefined:undefined,
      label:[d.edge,d.name,source].filter(Boolean).join(" · "),levelLabel:d.levelLabel??""};
  }catch{return;}
}
export function squareClosureGap(points:SquareObservedVertex[]) {
  return points.length===5?Math.hypot(points[4].x-points[0].x,points[4].y-points[0].y):null;
}
/** Equal edge time is a comparison animation, never a reconstruction of robot timing. */
export function squareReplayPoint(points:SquareObservedVertex[],progress:number) {
  if(points.length<2)return null;
  const t=Math.max(0,Math.min(1,progress))*(points.length-1),edge=Math.min(points.length-2,Math.floor(t)),f=t-edge;
  const a=points[edge],b=points[edge+1];
  return {x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,z:(a.z??0)+((b.z??0)-(a.z??0))*f,edgeIndex:edge+1};
}
