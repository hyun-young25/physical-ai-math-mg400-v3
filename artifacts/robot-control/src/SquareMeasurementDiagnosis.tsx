import { useEffect, useRef, useState } from "react";
import type { useMathInquiry } from "./MathInquiry";
import type { ShapeLesson } from "./shapeLearning";
import { diagnoseSquare, priorSquareDiagnoses, squareFeedbackPlan, squareMismatchName, squarePlannedVertices, type SquareMeasurement } from "./squareMismatchDiagnosis";
import { SquareDiagnosisPanel } from "./SquareDiagnosisPanel";

/**
 * Hardware-only: compares the real robot's measured vertices with the (already correct)
 * command/DT plan. Shown only when the gap exceeds the model–real threshold, i.e. when the
 * physical execution itself, not the learner's arithmetic, is the source of the difference.
 */
export function SquareMeasurementDiagnosis({ lesson, inquiry: q, measurements, trialKey, supportMode, disabled }: {
  lesson:ShapeLesson; inquiry:ReturnType<typeof useMathInquiry>; measurements:SquareMeasurement[];
  trialKey:string; supportMode:"guided"|"challenge"; disabled?:boolean;
}) {
  const record = q.record;
  const diagnosis = record ? diagnoseSquare(lesson, record.prediction, { measurements }) : null;
  const plan = diagnosis?.type === "model-real"
    ? squareFeedbackPlan(diagnosis, priorSquareDiagnoses(q.history, lesson, record?.id).filter(type => type === "model-real").length, supportMode)
    : null;
  const [cause, setCause] = useState("");
  const sent = useRef("");
  useEffect(() => {
    if (!diagnosis || !plan || !record || sent.current === trialKey) return;
    sent.current = trialKey;
    const entry = { type: diagnosis.type, label: diagnosis.label, level: plan.level, question: plan.question,
      relationHint: plan.relationHint, supportMode, priorSameType: 0, teacherFlag: plan.teacherFlag,
      evidence: diagnosis.evidence, source: "hardware" as const };
    q.recordDiagnosis(entry);
    q.requestAi({ status: "correct", errorCount: 0, fields: [],
      diagnosis: { type: diagnosis.type, name: squareMismatchName(diagnosis.type), label: diagnosis.label, level: plan.level,
        levelLabel: plan.levelLabel, question: plan.question, relationHint: plan.relationHint, example: plan.example,
        teacherFlag: plan.teacherFlag, evidence: diagnosis.evidence } }, record.prediction);
  }, [trialKey, diagnosis?.type, record?.id]);
  if (!diagnosis || !plan) return null;
  const observedVertices=measurements.map((point,index)=>({
    label:point.label??`P${index+1}`,x:point.actual.x,y:point.actual.y,
  }));
  return <div>
    <SquareDiagnosisPanel diagnosis={diagnosis} plan={plan}
      plannedVertices={squarePlannedVertices(lesson,record?.prediction??{})??undefined}
      observedVertices={observedVertices} sourceLabel="실장비 GetPose 자료 · 제어기 보고 좌표"
      cause={cause} onCauseChange={setCause} disabled={disabled}/>
    <button type="button" disabled={disabled || !cause.trim()} onClick={() => q.recordDiagnosis({
      type: diagnosis.type, label: diagnosis.label, level: plan.level, question: plan.question, relationHint: plan.relationHint,
      supportMode, priorSameType: 0, teacherFlag: plan.teacherFlag, evidence: diagnosis.evidence, source: "hardware", causeExplanation: cause })}>
      실물 차이에 대한 내 설명 저장
    </button>
    <p className="lesson-note">이 설명은 측정으로 확인된 원인이 아니라 학생의 가설로 기록됩니다.</p>
  </div>;
}
