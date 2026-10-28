import { PAPER_TARGETS, frameInversePoint, frameTransformPoint, getPaperFrameAngleDegrees } from "./paperCoordinateStudy";
import type { PaperCoordinateLevel, PaperTargetSet, PaperGridPoint, PaperFrame, PaperRunSnapshot, PaperDiagnosis } from "./paperCoordinateStudy";
import { getShapeLesson } from "./shapeLearning";
import { diagnoseSquare, LEVEL_LABELS } from "./squareMismatchDiagnosis";
import type { SquareVisual } from "./squareComparisonVisual";
import type { FeedbackContext } from "./learningAiContext";

export const PAPER_RECTANGLE_TITLES = {
  "advanced-paper-quarter": "종이 위 사각형 · 직각 회전",
  "advanced-paper-rotated": "종이 위 사각형 · 비스듬히 놓인 종이",
} as const;
export const isPaperRectangle = (level:PaperCoordinateLevel) => level==="advanced-paper-quarter"||level==="advanced-paper-rotated";
export function paperTaskTargets(level:PaperCoordinateLevel,set:PaperTargetSet):PaperGridPoint[] {
  if(!isPaperRectangle(level))return PAPER_TARGETS[set];
  return [[2,2],[8,2],[8,6],[2,6]].map(([xCm,yCm],i)=>({name:"P"+(i+1),xCm,yCm}));
}
export const PAPER_PATTERN_LABELS:Record<NonNullable<PaperDiagnosis["pattern"]>,string>={
  match:"목표와 일치",tracking:"명령–보고 위치 차이",translation:"이동 차이",rotation:"회전 오류",
  scale:"배율 차이",calculation:"대입·계산 차이",mixed:"혼합 차이",
};
export const paperFeedbackKey=(c:Pick<FeedbackContext,"condition"|"answers"|"execution">)=>JSON.stringify(["paper",c.condition,c.answers,c.execution]);
/** Display estimates use the same first-three-point basis as the existing classifier.
 * No estimate here decides a grade or alters a recorded diagnosis. */
export function paperTransformEstimate(frame:PaperFrame,targets:PaperGridPoint[],run:PaperRunSnapshot) {
  const ps=run.observations.map(o=>frameInversePoint(frame,o.pose));
  if(ps.length<3||ps.some(p=>!p)||targets.length!==ps.length)return null;
  const [a,b,c]=ps as {xCm:number;yCm:number}[],[ta,tb,tc]=targets;
  const ux=(b.xCm-a.xCm)/(tb.xCm-ta.xCm),uy=(b.yCm-a.yCm)/(tb.xCm-ta.xCm);
  const vx=(c.xCm-a.xCm-ux*(tc.xCm-ta.xCm))/(tc.yCm-ta.yCm);
  const vy=(c.yCm-a.yCm-uy*(tc.xCm-ta.xCm))/(tc.yCm-ta.yCm);
  const dx=run.observations.reduce((n,o,i)=>n+o.pose.x-frameTransformPoint(frame,targets[i]).x,0)/ps.length;
  const dy=run.observations.reduce((n,o,i)=>n+o.pose.y-frameTransformPoint(frame,targets[i]).y,0)/ps.length;
  return {dx,dy,translationMm:Math.hypot(dx,dy),scaleX:Math.hypot(ux,uy),scaleY:Math.hypot(vx,vy),
    relativeAngle:Math.atan2(uy,ux)*180/Math.PI,paperAngle:getPaperFrameAngleDegrees(frame)};
}
export function paperRectangleVisual(frame:PaperFrame,targets:PaperGridPoint[],run:PaperRunSnapshot,diagnosis:PaperDiagnosis,
  stage:number,feedbackKey:string,priorSameType:number):SquareVisual|null {
  if(targets.length!==4||run.observations.length!==4||diagnosis.status!=="complete")return null;
  const local=run.observations.map((o,i)=>{const p=frameInversePoint(frame,o.pose)!;return {x:p.xCm*10,y:p.yCm*10,z:0,label:"P"+(i+1)};});
  const localPlan=run.commands.map((o,i)=>{const p=frameInversePoint(frame,o.pose)!;return {x:p.xCm*10,y:p.yCm*10,z:0,label:"P"+(i+1)};});
  const base=getShapeLesson("사각형",0),given=targets.map(t=>({x:t.xCm*10,y:t.yCm*10,z:0,r:0}));
  const targetSequence=[...given,given[0]].map((coords,i)=>({type:"MoveL" as const,label:"P"+(i+1),coords}));
  const lesson={...base,id:"square-paper-visual",sequence:targetSequence,targetSequence,pathPlan:{...base.pathPlan,start:given[0]}};
  const answers:Record<string,string>={};
  base.pathPlan.rows.forEach((row,i)=>{answers[row.xKey]=String(localPlan[(i+1)%4].x);answers[row.yKey]=String(localPlan[(i+1)%4].y);});
  const edgeDiagnosis=diagnoseSquare(lesson,answers,{source:run.source==="teacher"?"dt":run.source,observedVertices:[...local,{...local[0],label:"P1"}]});
  if(!edgeDiagnosis)return null;
  const level=diagnosis.pattern==="match"?"self-regulation":diagnosis.supportLevel===3?"worked":diagnosis.supportLevel===2?"process":"task";
  const target=targets.map((p,i)=>({...frameTransformPoint(frame,p),label:"P"+(i+1)}));
  const observed=run.observations.map((p,i)=>({...p.pose,label:"P"+(i+1)}));
  return {key:run.id,feedbackKey,stage,diagnosis:edgeDiagnosis,plan:{level,levelLabel:LEVEL_LABELS[level],question:diagnosis.question,teacherFlag:false},
    target:[...target,target[0]],observed:[...observed,observed[0]],priorSameType,supportMode:"guided",
    coordinateLabel:"종이 축 기준",connectedVerticesOnly:true,
    // The paper diagnosis remains authoritative; the square comparison only annotates edge geometry.
    match:diagnosis.pattern==="match",errorArrows:true};
}
