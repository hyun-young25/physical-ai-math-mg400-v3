import { getLearningUser } from "./learningClient";
import { LEARNING_CONTENT_VERSION } from "./learningSync";
export const LEARNING_STAGES = [
  { id:1, short:"과제 이해", label:"과제 이해" },
  { id:2, short:"수학 구조화", label:"수학 구조화" },
  { id:3, short:"표현·예측", label:"표현·예측" },
  { id:4, short:"실행·측정", label:"실행·측정" },
  { id:5, short:"지각·표상", label:"지각·표상" },
  { id:6, short:"비교·해석", label:"비교·해석" },
  { id:7, short:"수정·재실행", label:"수정·재실행" },
] as const;
// One anonymous session joins exports across lessons without collecting identity.
const sessionId=globalThis.crypto?.randomUUID?.()??String(Date.now())+"-"+String(Math.random());
export function learningRecordContext(source:"dt"|"virtual"|"hardware"|"math") {
  return { schemaVersion:3, sessionId, contentVersion:LEARNING_CONTENT_VERSION,
    ...(getLearningUser() ? { learningAccountId:getLearningUser()!.id } : {}),
    dataSource:source, supportProvider:"rule-based",
    framework:{version:"seven-stage-v1",stages:LEARNING_STAGES,
      compactGroups:[[1,2,3],[4,5],[6,7]],
      legacySevenStepMap:[1,2,3,4,5,6,7]}, 
  };
}
/** The stored activity state now uses the dissertation's seven-stage cycle directly. */
export function frameworkStage(legacyStep:number) {
  return [1,2,3,4,5,6,7][Math.max(0,Math.min(6,legacyStep-1))];
}
