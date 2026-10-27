import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { parseLessonNumber } from "./curriculum";
import { compareInquiry, currentInquiryComparison, latestInquiryRuns, type useMathInquiry } from "./MathInquiry";
import { ExplanationFeedback } from "./ExplanationFeedbackPanel";
import { shapeLessonAnswerMatches, shapeLessonFeedback, shapeLessonStages, type LessonQuestion, type ShapeLesson } from "./shapeLearning";
import { assessSquare, squareTutorJudgment } from "./squareLearningFlow";
import { LearningAiFeedback } from "./LearningAiFeedback";
import { LEARNING_STAGES } from "./learningFramework";
import "./shapeLessonSteps.css";
import { LearningJudgmentFields, sameJudgment } from "./LearningJudgment";
import { diagnoseSquare, priorSquareDiagnoses, squareFeedbackPlan, squareMismatchName, squarePlannedVertices, type SquareObservedVertex, type SquareExecutionSource, type XY } from "./squareMismatchDiagnosis";
import { SquareDiagnosisPanel } from "./SquareDiagnosisPanel";

type LessonStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;
type BeforeRunStep = 1 | 2 | 3;
export type ShapeSupportMode = "guided" | "challenge";
const STEP_TITLES = LEARNING_STAGES.map(stage => stage.label);

function hasAnswer(question: LessonQuestion, raw: string) {
  return question.options
    ? question.options.some(option => option.value === raw)
    : parseLessonNumber(raw) !== null;
}
function displayAnswer(question: { options?: { value:string; label:string }[]; unit?:string }, value: string | number) {
  const label = question.options?.find(option => option.value === String(value))?.label;
  return label ?? `${typeof value === "number" ? Number(value.toFixed(2)) : value}${question.unit ? ` ${question.unit}` : ""}`;
}

/** All shapes share this state machine, controls, feedback and evidence; only question data differs. */
export function ShapeLessonSteps({ lesson, inquiry: q, locked, onStageChange, onQuestionFocus, supportMode, execution, observation, onNewCondition, nextLabel = "다음 과제", onEditProgram, canAdvance = true, advanceBlockedReason, executionSequence }: {
  lesson: ShapeLesson;
  inquiry: ReturnType<typeof useMathInquiry>;
  locked: boolean;
  onStageChange: (stage: number) => void;
  onQuestionFocus?: (key: string | null) => void;
  supportMode: ShapeSupportMode;
  execution: ReactNode;
  observation: ReactNode;
  onNewCondition: () => void;
  nextLabel?: string;
  onEditProgram?: () => void;
  canAdvance?: boolean;
  advanceBlockedReason?: string;
  executionSequence?: ShapeLesson["sequence"];
}) {
  const fieldId = useId();
  const [step, setStep] = useState<LessonStep>(1);
  const [attemptedStep, setAttemptedStep] = useState<BeforeRunStep | null>(null);
  const [hints, setHints] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const guided = supportMode === "guided";
  const stages = shapeLessonStages(lesson);
  const coordinateRows = [...lesson.pathPlan.rows].sort((a, b) => a.sequenceIndex - b.sequenceIndex || (a.kind === "via" ? -1 : b.kind === "via" ? 1 : 0));
  const coordinateKeys = new Set(coordinateRows.flatMap(row => [row.xKey, row.yKey]));
  const radiusCalculation = lesson.calculation.find(question => question.key === lesson.pathPlan.radiusKey);
  const additionalCalculations = lesson.calculation.filter(question => !coordinateKeys.has(question.key) && question !== radiusCalculation);
  const questions = stages.flat();
  const record = q.record;
  const latestRuns = record ? latestInquiryRuns(record) : [];
  const hasCompletedObservation = q.observed && latestRuns.some(run => run.action === "mission" && run.status === "completed");
  const activeStage: LessonStep = !q.ready ? step <= 3 ? step : 1 : !hasCompletedObservation ? 4 : step >= 5 ? step : 5;
  const currentQuestions = activeStage <= 3 ? stages[activeStage - 1] : [];
  const comparison = record && hasCompletedObservation ? compareInquiry(record) : [];
  const currentComparison = record && hasCompletedObservation ? currentInquiryComparison(record) : [];
  const hasReview = !!record?.answerReviews?.some(review => review.runCount === record.runs.length);
  const reasonFeedback = record?.explanationReviews?.filter(review => review.runCount === record.runs.length).at(-1);
  const reflectionFeedback = record?.reflections.filter(review => review.runCount === record.runs.length).at(-1);
  const reflectionAnswers = record?.answerReviews?.filter(review => review.runCount === record.runs.length).at(-1)?.answers ?? record?.prediction;
  const reflectionCurrent = reflectionFeedback?.text === q.reflection.trim() && q.fields.every(field => reflectionFeedback?.answers?.[field.key] === reflectionAnswers?.[field.key]) && sameJudgment(reflectionFeedback?.judgment, q.judgment);
  // Prediction–execution diagnosis (square only): what the robot executed vs the task condition.
  const isSquare = lesson.id.startsWith("square-");
  const mission = record?.runs.filter(run => run.action === "mission").at(-1);
  const missionDetail=mission?.detail as {rejectedTarget?:XY;observedVertices?:SquareObservedVertex[];planKey?:string}|undefined;
  const rejected = mission?.status === "unavailable" ? missionDetail?.rejectedTarget ?? null : null;
  const latestMeasurement=record?.runs.filter(run=>run.action==="square-measurement").at(-1);
  const measurementDetail=latestMeasurement?.detail as {source?:SquareExecutionSource;planKey?:string;complete?:boolean;observedVertices?:SquareObservedVertex[]}|undefined;
  const samePlanMeasurement=!!latestMeasurement&&!!measurementDetail
    &&measurementDetail.planKey===missionDetail?.planKey
    &&(measurementDetail.source==="hardware"||measurementDetail.source==="mock");
  const diagnosisSource=samePlanMeasurement?measurementDetail?.source:"dt";
  const diagnosisVertices=samePlanMeasurement
    ?measurementDetail?.complete?measurementDetail.observedVertices:undefined
    :missionDetail?.observedVertices;
  const diagnosis = isSquare && record && q.ready && (hasCompletedObservation || rejected)
    ? diagnoseSquare(lesson,record.prediction,{rejected,observedVertices:diagnosisVertices,source:diagnosisSource}) : null;
  const priorTypes = diagnosis && record ? priorSquareDiagnoses(q.history, lesson, record.id) : [];
  const diagnosisPlan = diagnosis ? squareFeedbackPlan(diagnosis, priorTypes.filter(type => type === diagnosis.type).length, supportMode,
    diagnosis.type === "match" ? priorTypes.at(-1) : undefined) : null;
  const diagnosisMismatch = !!diagnosis && diagnosis.type !== "match" && diagnosis.type !== "model-real";
  const [cause, setCause] = useState("");
  const sentDiagnosis = useRef("");
  useLayoutEffect(() => { setCause(""); }, [record?.id, record?.runs.length]);
  useEffect(() => {
    if (!diagnosis || !diagnosisPlan || !record) return;
    const key = `${record.id}:${record.runs.length}:${diagnosis.type}`;
    if (sentDiagnosis.current === key) return;
    sentDiagnosis.current = key;
    const diagnosisSource:"dt"|"hardware"|"mock"=diagnosis.evidence.source==="hardware"?"hardware":diagnosis.evidence.source==="mock"?"mock":"dt";
    const entry = { type: diagnosis.type, edge: diagnosis.edge, label: diagnosis.label, level: diagnosisPlan.level,
      question: diagnosisPlan.question, relationHint: diagnosisPlan.relationHint, supportMode,
      priorSameType: priorTypes.filter(type => type === diagnosis.type).length, teacherFlag: diagnosisPlan.teacherFlag, evidence: diagnosis.evidence,
      source:diagnosisSource };
    q.recordDiagnosis(entry);
    const rows = assessSquare(lesson, record.prediction);
    const errors = rows.filter(row => !row.matched);
    q.requestAi({ status: errors.length ? "incorrect" : "correct", errorCount: errors.length,
      fields: (errors.length ? errors : rows).slice(0, 3).map(row => ({ key: row.key, label: row.label, value: row.value.slice(0, 60), matched: row.matched, feedback: "" })),
      diagnosis: { type: diagnosis.type, name: squareMismatchName(diagnosis.type), label: diagnosis.label, edge: diagnosis.edge,
        level: diagnosisPlan.level, levelLabel: diagnosisPlan.levelLabel, question: diagnosisPlan.question,
        relationHint: diagnosisPlan.relationHint, example: diagnosisPlan.example, teacherFlag: diagnosisPlan.teacherFlag,
        evidence: diagnosis.evidence } }, record.prediction);
  }, [diagnosis?.type, diagnosisPlan?.level, record?.id, record?.runs.length]);
  const diagnosisPanel = diagnosis && diagnosisPlan ? <SquareDiagnosisPanel diagnosis={diagnosis} plan={diagnosisPlan}
    plannedVertices={squarePlannedVertices(lesson, record?.prediction ?? {}) ?? undefined}
    cause={cause} onCauseChange={setCause} causeRequired={diagnosisMismatch && diagnosis.type !== "unreachable"} disabled={locked}/> : null;

  useLayoutEffect(() => {
    setStep(1); setAttemptedStep(null); setHints([]); setFeedback("");
  }, [lesson.id]);
  useLayoutEffect(() => {
    if (Object.keys(q.draft).length !== 0) return;
    setStep(1); setAttemptedStep(null); setHints([]); setFeedback("");
  }, [q.draft]);
  useLayoutEffect(() => {
    // A fresh run always needs a new observation acknowledgement; stopped runs stay at execution.
    if (q.ready) { setStep(hasCompletedObservation ? 5 : 4); setFeedback(""); }
  }, [record?.id, record?.runs.length, hasCompletedObservation, q.ready]);
  useLayoutEffect(() => { onStageChange(activeStage); }, [activeStage, onStageChange]);
  useLayoutEffect(() => { onQuestionFocus?.(currentQuestions[0]?.key ?? null); }, [lesson.id, activeStage, onQuestionFocus]);

  const reopen = (target: BeforeRunStep = 1) => {
    if (locked) return;
    if (q.ready) q.revise();
    setStep(target); setAttemptedStep(null); setFeedback(""); setHints([]);
  };
  const advance = () => {
    if (locked || q.ready || activeStage > 3) return;
    const before = activeStage as BeforeRunStep;
    setAttemptedStep(before);
    if(lesson.id.startsWith("square-")) {
      q.requestAi(squareTutorJudgment(assessSquare(lesson,q.draft,before===3?questions:currentQuestions)),q.draft);
    }
    if (guided) q.feedbackEvent("guided-check", currentQuestions.map(question => question.key));
    if (currentQuestions.some(question => !hasAnswer(question, q.draft[question.key] ?? ""))) {
      setFeedback("각 항목을 선택하거나 유한한 숫자로 입력하세요."); return;
    }
    if (guided && currentQuestions.some(question => !shapeLessonAnswerMatches(question, q.draft[question.key] ?? ""))) {
      setFeedback("다시 확인할 항목의 힌트를 보고 관계를 고쳐 보세요."); return;
    }
    if (before < 3) {
      setStep((before + 1) as BeforeRunStep); setAttemptedStep(null); setFeedback(""); return;
    }
    const invalidStage = stages.findIndex(group => group.some(question => {
      const value = q.draft[question.key] ?? "";
      return !hasAnswer(question, value) || (guided && !shapeLessonAnswerMatches(question, value));
    }));
    if (invalidStage !== -1) {
      const target = (invalidStage + 1) as BeforeRunStep;
      setStep(target); setAttemptedStep(target); setFeedback("이 단계의 답을 확인한 뒤 다시 예측을 저장하세요."); return;
    }
    if (!q.reason.trim()) { setFeedback("예측에 사용한 관계와 그렇게 생각한 근거를 적어 주세요."); return; }
    setFeedback(""); q.submit();
  };

  const reviewAnswers = () => {
    if(!lesson.id.startsWith("square-")){q.reviewAnswers();return;}
    if(diagnosisMismatch&&!cause.trim()){setFeedback("로봇이 그린 결과와 과제 조건이 왜 달랐는지 먼저 한 문장으로 적어 주세요.");return;}
    if(diagnosis&&diagnosisPlan&&cause.trim())q.recordDiagnosis({type:diagnosis.type,edge:diagnosis.edge,label:diagnosis.label,level:diagnosisPlan.level,
      question:diagnosisPlan.question,relationHint:diagnosisPlan.relationHint,supportMode,priorSameType:priorTypes.filter(type=>type===diagnosis.type).length,
      teacherFlag:diagnosisPlan.teacherFlag,evidence:diagnosis.evidence,
      source:diagnosis.evidence.source==="hardware"?"hardware":diagnosis.evidence.source==="mock"?"mock":"dt",
      causeExplanation:cause});
    const answers={...q.record?.prediction,...q.reviewDraft};
    q.requestAi(squareTutorJudgment(assessSquare(lesson,answers)),answers);
    // A changed answer is a new prediction, never approval of an old DT path.
    q.revise();q.setDraft(answers);
    // After an execution-based diagnosis only the coordinates change: return to the coordinate plan.
    setStep(diagnosisMismatch?3:1);setAttemptedStep(null);
    setFeedback(diagnosisMismatch
      ?"차이의 이유를 기록했어요. 고친 좌표로 예측을 다시 저장하고 DT에서 다시 실행해 결과를 비교하세요. 처음 예측과 이유는 기록에 남습니다."
      :"수정한 입력으로 다시 확인해 주세요. 예측 저장 → DT 실행 → 비교·성찰 후 실제 실행할 수 있어요. 처음 예측은 기록에 남습니다.");
  };

  const renderQuestion = (question: LessonQuestion, review = false, compact = false) => {
    const row = currentComparison.find(value => value.key === question.key);
    const raw = review ? q.reviewDraft[question.key] ?? row?.prediction ?? "" : q.draft[question.key] ?? "";
    const valid = hasAnswer(question, raw);
    const hintOpen = review ? q.openHints.includes(question.key) : hints.includes(question.key);
    const showCorrectness = review || (guided && attemptedStep === activeStage) || hintOpen;
    const invalid = (review || attemptedStep === activeStage) && !valid;
    const correct = valid && shapeLessonAnswerMatches(question, raw);
    const status = invalid ? "empty" : showCorrectness && valid ? correct ? "correct" : "incorrect" : "none";
    const inputId = `${fieldId}-${review ? "review-" : ""}${question.key}`;
    const descriptionId = `${inputId}-feedback`;
    const update = (value: string) => {
      onQuestionFocus?.(question.key);
      if (review) q.setReviewDraft(previous => ({ ...previous, [question.key]: value }));
      else q.setDraft(previous => ({ ...previous, [question.key]: value }));
      setFeedback("");
    };
    return <div className={`shape-step-field${compact ? " shape-step-coordinate-field" : ""}`} key={question.key} data-status={status}
      onFocusCapture={() => onQuestionFocus?.(question.key)}>
      <label htmlFor={inputId}>{review && "다시 판단 · "}{question.label}{question.unit && ` (${question.unit})`}</label>
      {question.options ? <select id={inputId} aria-label={`${review ? "다시 판단 " : ""}${question.label}`}
        aria-invalid={status === "empty" || status === "incorrect" || undefined}
        aria-describedby={status !== "none" || hintOpen ? descriptionId : undefined}
        value={raw} disabled={locked} onChange={event => update(event.target.value)}>
        <option value="">선택하세요</option>
        {question.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select> : <input id={inputId} aria-label={`${review ? "다시 판단 " : ""}${question.label}`}
        type="number" step="any" value={raw} disabled={locked}
        aria-invalid={status === "empty" || status === "incorrect" || undefined}
        aria-describedby={status !== "none" || hintOpen ? descriptionId : undefined}
        onChange={event => update(event.target.value)} />}
      <div className="shape-step-field-help">
        <span id={descriptionId}>
          {status === "empty" ? "답을 입력해 주세요." : status === "correct" ? "✓ 관계와 일치합니다." : status === "incorrect" ? "다시 확인해 보세요." : ""}
          {(hintOpen || status === "incorrect") && <span className="shape-step-hint">{status === "incorrect" ? shapeLessonFeedback(question, raw) : question.hint}</span>}
        </span>
        {!hintOpen && status !== "incorrect" && <button type="button" disabled={locked}
          className="shape-step-text-button" aria-label={`${question.label} 힌트`}
          onClick={() => { if (review) q.showHint(question.key); else { setHints(previous => [...previous, question.key]); q.feedbackEvent("hint", [question.key]); } }}>힌트</button>}
      </div>
    </div>;
  };

  const primary = activeStage <= 3 ? <button type="button" className="lesson-primary" disabled={locked} onClick={advance}>
    {activeStage === 3 ? "예측 저장 · 실행 준비" : "확인하고 다음"}
  </button> : activeStage === 5 ? <button type="button" className="lesson-primary" disabled={locked || !hasCompletedObservation || (q.detailedReflection && !q.observation.trim())} onClick={() => { if (q.saveObservation()) setStep(6); }}>관찰 완료 · 비교하기</button>
    : activeStage === 6 ? !q.comparisonAvailable ? <button type="button" className="lesson-primary" disabled={locked} onClick={() => reopen()}>예측·조건 다시 확인</button>
      : !q.checked ? <button type="button" className="lesson-primary" disabled={locked || (diagnosisMismatch && !cause.trim())} onClick={diagnosisMismatch ? () => setStep(7) : reviewAnswers}>{diagnosisMismatch ? "이유 확인 · 수정·재실행으로" : "수정한 판단 확인"}</button>
        : !q.reviewed ? <button type="button" className="lesson-primary" disabled={locked || !q.reflectionReady || !q.judgmentReady} onClick={() => {
            // The optional self-check plan after a resolved mismatch is kept with the diagnosis.
            if (diagnosis && diagnosisPlan && cause.trim()) q.recordDiagnosis({ type: diagnosis.type, label: diagnosis.label, level: diagnosisPlan.level,
              question: diagnosisPlan.question, supportMode, priorSameType: 0, teacherFlag: false, evidence: diagnosis.evidence,
              source:diagnosis.evidence.source==="hardware"?"hardware":diagnosis.evidence.source==="mock"?"mock":"dt",
              causeExplanation: cause });
            q.explain();
          }}>{q.taskKind === "practice" ? "비교 확인 저장" : "내 설명 저장"}</button>
          : <button type="button" className="lesson-primary" disabled={locked} onClick={() => setStep(7)}>비교 완료 · 다음</button>
    : activeStage === 7 && diagnosisMismatch ? <button type="button" className="lesson-primary" disabled={locked || !cause.trim()} onClick={reviewAnswers}>수정한 예측으로 재검증 준비</button>
    : activeStage === 7 ? <button type="button" className="lesson-primary" disabled={locked || !q.reviewed || !canAdvance} onClick={() => { if (!canAdvance) return; q.feedbackEvent("transfer"); onNewCondition(); }}>{nextLabel}</button> : null;

  return <div className="shape-lesson-steps" data-shape-stage={activeStage} data-support-mode={supportMode}>
    <p className="shape-step-progress" aria-live="polite">현재 단계 {activeStage}/7 · <strong>{STEP_TITLES[activeStage - 1]}</strong></p>
    <details className="shape-stage-overview">
      <summary>전체 학습 7단계 보기</summary>
      <ol aria-label="과제 이해부터 수정·재실행까지의 학습 단계">
        {STEP_TITLES.map((title,index)=>{
          const stage=index+1;
          const status=stage<activeStage?"complete":stage===activeStage?"current":"pending";
          const group=stages[index];
          return <li key={title} data-status={status} aria-current={status==="current"?"step":undefined}>
            <div className="shape-stage-overview-heading">
              <strong>{stage}. {title}</strong>
              <span>{status==="complete"?"완료":status==="current"?"현재":"대기"}</span>
              {stage<=3&&status==="complete"&&<button type="button" className="shape-step-text-button" disabled={locked}
                aria-label={`${title} 다시 편집`} onClick={()=>reopen(stage as BeforeRunStep)}>수정</button>}
            </div>
            {stage<=3&&status==="complete"&&<div className="shape-stage-overview-content">
              {group.map(question=><span key={question.key}>{question.label}: {displayAnswer(question,(q.record?.prediction??q.draft)[question.key]??"")}</span>)}
            </div>}
            {stage===4&&activeStage>4&&<p className="lesson-note">{record&&latestInquiryRuns(record).map(run=>run.summary).filter(Boolean).join(" ")}</p>}
            {stage===5&&activeStage>5&&<p className="lesson-note">{q.detailedReflection
              ?`관찰한 경로의 표현: ${record?.observations?.filter(item=>item.runCount===record.runs.length).at(-1)?.text??""}`
              :"실행 장면 관찰 확인 완료"}</p>}
            {stage===6&&activeStage>6&&<p className="lesson-note">{q.reflection||(q.judgment.decision==="maintain"?"처음 예측 근거 유지":"판단 수정")}</p>}
          </li>;
        })}
      </ol>
    </details>
    <section className="shape-step-active" aria-label={STEP_TITLES[activeStage - 1]}>
      {activeStage === 1 && <>
        <div className="shape-step-fields">{lesson.concept.map(question => renderQuestion(question))}</div>
      </>}
      {activeStage === 2 && <>
        <p className="shape-step-intro">각 구간의 좌표 변화와 마지막 점이 시작점으로 돌아오는 관계를 정하세요.</p>
        <div className="shape-step-fields">{lesson.relations.map(question => renderQuestion(question))}</div>
      </>}
      {activeStage === 3 && <>
        <p className="shape-step-intro">{lesson.pathPlan.instruction}</p>
        {radiusCalculation && renderQuestion(radiusCalculation)}
        <div className="shape-step-coordinate-wrap" tabIndex={0} aria-label="전체 도형 경로 좌표 입력표">
          <table className="shape-step-coordinate-table">
            <caption>이동 순서대로 좌표를 완성하세요. 단위: mm</caption>
            <thead><tr><th scope="col">지점</th><th scope="col">X</th><th scope="col">Y</th><th scope="col">Z (주어짐)</th></tr></thead>
            <tbody>{coordinateRows.map(row => <tr key={`${row.kind}-${row.sequenceIndex}`} data-point-kind={row.kind}>
              <th scope="row">{row.label}</th>
              {[row.xKey, row.yKey].map(key => <td key={key}>{renderQuestion(lesson.calculation.find(question => question.key === key)!, false, true)}</td>)}
              <td className="shape-step-given-coordinate">{Number(row.z.toFixed(2))}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="shape-step-fields">{additionalCalculations.map(question => renderQuestion(question))}{lesson.prediction.map(question => renderQuestion(question))}</div>
        <label className="shape-step-reason">왜 그렇게 예상했나요?
          <textarea aria-label="예측 근거" maxLength={4000} rows={3} disabled={locked}
            value={q.reason} onChange={event => { q.setReason(event.target.value); setFeedback(""); }}
            placeholder="사용한 관계와 계산 결과를 연결해서 적어 주세요." />
        </label>
      </>}
      {activeStage === 4 && <>
        <p>{lesson.id.startsWith("square-")
          ? "내가 입력한 XY 좌표가 DT 실행 경로에 반영됩니다. 가상 전용 실행은 연결 없이 가능합니다. 도전 모드에서는 오답 예측도 DT 완주·닫힘·복귀 확인 후, 동일 계획의 작업 범위·연결·준비·서보 검사와 최종 승인을 통과하면 1회 비교 실행할 수 있습니다. 비교·성찰은 결과에서 진행합니다."
          : "예측 좌표는 비교에 사용하며, 로봇은 실행 명령의 좌표로 움직입니다."}</p>
        <details className="shape-step-evidence">
          <summary>내 예측 ↔ 실행 명령 좌표</summary>
          <div className="shape-step-coordinate-wrap"><table className="shape-step-coordinate-table">
            <caption>XY 좌표 비교 · 단위 mm</caption>
            <thead><tr><th scope="col">지점</th><th scope="col">내 예측 (X, Y)</th><th scope="col">실행 명령 (X, Y)</th></tr></thead>
            <tbody>{coordinateRows.map(row => {
              const program=executionSequence??lesson.sequence;
              const command = row.kind === "via" ? program[row.sequenceIndex]?.via : program[row.sequenceIndex]?.coords;
              return <tr key={`${row.kind}-${row.sequenceIndex}`}><th scope="row">{row.label}</th>
                <td>({String(record?.prediction[row.xKey] ?? "?")}, {String(record?.prediction[row.yKey] ?? "?")})</td>
                <td>{command ? `(${Number(command.x.toFixed(2))}, ${Number(command.y.toFixed(2))})` : "명령 없음"}</td></tr>;
            })}</tbody>
          </table></div>
        </details>
        <div className="shape-step-execution">{execution}</div>
        {latestRuns.filter(run => run.status === "unavailable" || run.status === "stopped").map(run => <p className="shape-step-feedback" role="status" key={run.action}>{run.summary ?? "실행이 완료되지 않았습니다. 조건을 확인하고 다시 실행하세요."}</p>)}
        {diagnosis?.type === "unreachable" && diagnosisPanel}
      </>}
      {activeStage === 5 && <>
        <p>경로의 모양, 마지막 점, 실행 전 자세로의 복귀를 확인하세요.</p>
        <div className="shape-step-observation">{observation}</div>
        {q.detailedReflection ? <label className="shape-step-reason">관찰한 경로를 좌표나 변화량으로 나타내세요
          <textarea aria-label="관찰한 경로의 수학적 표현" rows={2} maxLength={1000} disabled={locked} value={q.observation}
            onChange={event => q.setObservation(event.target.value)}
            placeholder="한 구간을 골라 ‘P__→P__: ΔX=__, ΔY=__ mm’처럼 적으세요. 원은 중심·반지름과 지나는 점으로 나타내도 됩니다."/>
        </label> : <p className="lesson-note">장면에서 한 구간의 방향과 도형이 닫히는지 확인한 뒤 비교로 넘어가세요. 아래에서 이미 입력한 예측과 결과를 나란히 봅니다.</p>}
      </>}
      {activeStage === 6 && record && <>
        {diagnosisPanel}
        {samePlanMeasurement&&!measurementDetail?.complete&&<p className="shape-step-feedback" role="status">
          {measurementDetail?.source==="mock"?"모의 GetPose 회신":"GetPose 회신"} 좌표 5개가 모두 확인되지 않아 실측 기반 진단은 완료되지 않았습니다. 입력 좌표나 이전 측정값으로 대체하지 않습니다.
        </p>}
        <details className="shape-step-evidence"><summary>처음 예측과 확인값 자세히 보기</summary>
        <div className="shape-step-table-wrap" tabIndex={0} aria-label="처음 예측과 확인값 비교표">
          <table><thead><tr><th scope="col">항목</th><th scope="col">처음 예측</th><th scope="col">확인값</th>{hasReview && <th scope="col">수정한 판단</th>}</tr></thead>
            <tbody>{comparison.map(row => {
              const reviewed = currentComparison.find(value => value.key === row.key);
              return <tr key={row.key}><th scope="row">{row.label}</th>
                <td data-match={row.matched}>{displayAnswer(row, row.prediction)}<small>{row.matched ? "일치" : "차이 있음"}</small></td>
                <td>{diagnosisMismatch && !row.matched && !reviewed?.matched ? <small>실행 결과로 다시 계산</small> : displayAnswer(row, row.result)}</td>
                {hasReview && <td data-match={reviewed?.matched}>{reviewed && displayAnswer(row, reviewed.prediction)}<small>{reviewed?.matched ? "일치" : "다시 확인"}</small></td>}
              </tr>;
            })}</tbody>
          </table>
        </div></details>
        {!q.comparisonAvailable ? <p className="shape-step-feedback">이번 실행에는 비교에 필요한 결과가 없습니다. 실행 조건을 다시 확인하세요. 결과가 없다는 이유로 예측을 오답 처리하지 않습니다.</p>
          : !q.checked && diagnosisMismatch ? <p className="lesson-note">위 관측자료와 질문을 바탕으로 차이의 이유를 적은 뒤, ⑦ 수정·재실행에서 좌표를 고칩니다.</p>
          : !q.checked ? <>
            <p>차이가 난 항목의 관계를 다시 확인하세요. 처음 예측은 기록에 남습니다.</p>
            <div className="shape-step-fields">{currentComparison.filter(row => !row.matched).map(row => {
              const question = questions.find(item => item.key === row.key);
              return question ? renderQuestion(question, true) : null;
            })}</div>
          </> : <>
            <p className="shape-step-success">✓ {hasReview ? "수정한 판단" : "처음 예측"}이 확인값과 일치합니다.</p>
            <LearningJudgmentFields value={q.judgment} onChange={q.setJudgment} disabled={locked} idPrefix={`${fieldId}-judgment`} fieldClassName="shape-step-field" showBasis={q.detailedReflection}/>
            {q.detailedReflection && <p className="lesson-note">위에서 적은 관찰을 다시 쓰지 않고, 그 관찰이 판단에 어떻게 쓰였는지 설명하세요.</p>}
            {q.reflectionRequired ? <label className="shape-step-reason">{q.taskKind === "practice" ? "확인하거나 바꾼 근거를 한 줄로 적으세요" : lesson.reflection}
              <textarea aria-label="결과 해석" maxLength={4000} rows={3} disabled={locked} value={q.reflection} onChange={event => q.setReflection(event.target.value)} />
            </label> : <p className="lesson-note">처음 쓴 예측 근거를 유지한다면 다시 적지 않고 비교 확인을 저장하세요.</p>}
            {reflectionFeedback?.assessment && <>
              <ExplanationFeedback title="결과 설명 피드백" assessment={reflectionFeedback.assessment} />
              {!reflectionCurrent && <p className="lesson-note" role="status">설명이나 판단을 수정했습니다. 현재 답으로 다시 저장하세요.</p>}
              {reflectionCurrent && !q.reviewed && !reflectionFeedback.teacherReviewRequested && <button type="button" disabled={locked || !q.checked} onClick={q.requestExplanationReview}>교사 검토용으로 남기고 계속</button>}
              {reflectionFeedback.teacherReviewRequested && <p className="lesson-note">교사 검토가 필요한 설명으로 기록했습니다. 자동 정답 판정은 아닙니다.</p>}
            </>}
          </>}
        <details className="shape-step-evidence"><summary>처음 근거와 피드백 보기</summary>
          <p>{record.reason}</p>
          {reasonFeedback && q.comparisonAvailable && <>
            <ExplanationFeedback title="예측 근거 피드백" assessment={reasonFeedback.assessment} />
            {reasonFeedback.phase === "revision" && <p>고친 근거: {reasonFeedback.text}</p>}
            <label className="shape-step-reason">고친 근거<textarea aria-label="고친 예측 근거" rows={3} maxLength={4000} disabled={locked} value={q.reasonRevision} onChange={event => q.setReasonRevision(event.target.value)} /></label>
            <button type="button" disabled={locked || !q.reasonRevision.trim()} onClick={q.reviewReason}>근거 수정·피드백 저장</button>
          </>}
        </details>
      </>}
      {activeStage === 7 && diagnosisMismatch && <>
        <p>관측한 차이를 바탕으로 좌표를 수정하세요. 저장 후 ③ 표현·예측 → ④ 실행·측정으로 돌아가 새 결과를 확인합니다.</p>
        <p className="lesson-note">수정 이유: {cause}</p>
        <div className="shape-step-fields">{currentComparison.filter(row => !row.matched).map(row => {
          const question = questions.find(item => item.key === row.key);
          return question ? renderQuestion(question, true) : null;
        })}</div>
      </>}
      {activeStage === 7 && !diagnosisMismatch && <>
        <p>같은 조건에서 예측을 수정해 다시 실행하거나, 다음 과제에 적용하세요.</p>
        <p className="lesson-note">예측이 맞았다면 재실행 없이 다음 과제로 진행할 수 있습니다.</p>
        {!canAdvance && <p className="shape-step-feedback" role="status">{advanceBlockedReason ?? "이동 명령을 수정하고 다시 실행한 결과를 확인하세요."}</p>}
        {onEditProgram && <button type="button" disabled={locked} onClick={onEditProgram}>이동 명령 수정</button>}
      </>}
      {feedback && <p className="shape-step-feedback" role="status">{feedback}</p>}
      {q.message && <p className="lesson-note" role="status">{q.message}</p>}
      <div className="shape-step-actions">
        {activeStage > 1 && <button type="button" className="shape-step-secondary" disabled={locked} onClick={() => {
          if (activeStage <= 3) { setStep((activeStage - 1) as BeforeRunStep); setAttemptedStep(null); setFeedback(""); }
          else if (activeStage === 6) setStep(5);
          else if (activeStage === 7) setStep(6);
          else reopen();
        }}>{activeStage === 4 || activeStage === 5 ? "예측 수정" : "이전"}</button>}
        {activeStage === 7 && !diagnosisMismatch && <button type="button" className="shape-step-secondary" disabled={locked} onClick={() => reopen()}>예측 수정 · 재실행</button>}
        {primary}
      </div>
    </section>
    <details className="shape-step-evidence"><summary>학습 기록 · {q.recordCount}회</summary>
      <p className="lesson-note">처음 예측과 근거, 실행, 수정한 판단과 설명을 구분해 보관합니다. 교사 검토가 필요한 설명도 함께 내려받습니다.</p>
      <button type="button" disabled={locked || !q.recordCount} onClick={q.download}>학습 기록 내려받기</button>
    </details>
    {q.storageFailed && <p className="shape-step-feedback" role="alert">기기 저장 공간에 기록을 보관하지 못했습니다. 새로고침 전에 학습 기록을 내려받아 주세요.</p>}
    {lesson.id.startsWith("square-") && <LearningAiFeedback ai={q.ai}/>}
  </div>;
}
