import { validatePaperFrame } from "./paperCoordinateStudy";
import type { PaperCoordinateLevel,PaperReferenceSample } from "./paperCoordinateStudy";
export const PAPER_TASK_VERSION="v4-paper-merged";
export const isMergedPaper=(level:PaperCoordinateLevel)=>level==="advanced-paper-dt"||level==="advanced-paper-hardware";
export const isPaperDT=(level:PaperCoordinateLevel)=>level==="advanced-paper-dt";
export const PAPER_ROTATION_SETTING="mg400:teacher:paper-rotation-allowed";
export function givenPaperFrame(shifted=false) {
  const x=shifted?200:180,y=shifted?-40:-60,now=Date.now();
  const samples:PaperReferenceSample[]=(["O","X","Y"] as const).map((point,i)=>({
    point,pose:{x:x+(i===1?100:0),y:y+(i===2?100:0),z:60,r:0},source:"teacher",seq:null,
    capturedAt:now,ageMsAtCapture:null,user:0,tool:0,coordinateSystem:"과제 조건 · DT 전용",verifiedCoordinates:false,
  }));
  const result=validatePaperFrame(samples);
  if(!result.ok)throw Error(result.reason);
  return result.frame;
}
export type PaperPathConcept={motion:string;closeX:string;closeY:string};
export const paperConceptValid=(v:PaperPathConcept|undefined)=>v?.motion==="MoveL"&&v.closeX==="0"&&v.closeY==="0";
