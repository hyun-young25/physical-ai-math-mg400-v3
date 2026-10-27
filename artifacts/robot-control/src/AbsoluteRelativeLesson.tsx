import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createAxisSceneProjection } from "./axisSceneProjection";
import { LearningAiFeedback, useLearningAi } from "./LearningAiFeedback";
import { numericFeedbackContext } from "./learningAiContext";
import { LessonConceptHeader } from "./LessonConceptHeader";import { POSE_AXES, poseDifference, sampleLessonMotion } from "./curriculum";
import { useLessonMotion, type MotionProps } from "./LessonPages";
import {
  COORDINATE_TASKS, COORDINATE_MODES, MODE_LABEL, FIELD_LABEL, blankCoordinateDraft, coordinateFields,
  coordinateStart, coordinateRule, coordinateCommands, coordinatePreview, coordinateProblemContext, makeCoordinateAttempt,
  analyzeCoordinateAttempt, completeCoordinateAttempt, coordinateArguments, canReviewCoordinateJudgment, reviewCoordinateJudgment,
  type CoordinateVector, type CoordinateAttempt, type CoordinateMode, type CoordinateVisual,
} from "./coordinateLearning";

import { CoordinateCommandTable } from "./CoordinateCommandTable";
import { LessonCoursePath } from "./LessonCoursePath";
import { CoordinateTransferLesson } from "./CoordinateTransferLesson";
import { CoordinateApplicationLesson } from "./CoordinateApplicationLesson";
import type { ApplicationRecord } from "./coordinateApplication";
import type { TransferLearningRecord } from "./transferLearning";
import { learningRecordContext } from "./learningFramework";
import { CoordinateStrategyLesson } from "./CoordinateStrategyLesson";
import { COORDINATE_SCENARIOS, type StrategyAttempt } from "./coordinateStrategies";
import { AdaptiveSupport } from "./AdaptiveSupport";
import { coordinateErrorEvent, strategyErrorEvent, type ErrorEvent, type SupportProps } from "./learningSupport";

type Props = MotionProps & SupportProps & {
  applicationRecords?:ApplicationRecord[]; onApplicationRecord?:(record:ApplicationRecord)=>void;
  transferLearningRecords?:TransferLearningRecord[]; onTransferLearningRecord?:(record:TransferLearningRecord)=>void;
  attempts: CoordinateAttempt[]; onAttempt: (attempt: CoordinateAttempt) => void;
  strategyAttempts: StrategyAttempt[]; onStrategyAttempt: (attempt: StrategyAttempt) => void;
  onVisualChange: (visual: CoordinateVisual | null) => void; onNext: () => void;
};
export function AbsoluteRelativeLesson(props: Props) {
  const [section,setSection] = useState(() => COORDINATE_TASKS.every(t=>props.attempts.some(a=>a.taskId===t.id&&a.completed)) ? "transfer" : "concepts");
  const [localRecords,setLocalRecords]=useState<ApplicationRecord[]>([]);
  const applicationRecords=props.applicationRecords??localRecords;
  const [localLearning,setLocalLearning]=useState<TransferLearningRecord[]>([]);
  const transferLearningRecords=props.transferLearningRecords??localLearning;
  const saveLearning=(record:TransferLearningRecord)=>{
    if(props.onTransferLearningRecord)props.onTransferLearningRecord(record);
    else setLocalLearning(previous=>[...previous.filter(r=>r.id!==record.id),record]);
  };
  const saveApplication=(record:ApplicationRecord)=>{
    if(props.onApplicationRecord)props.onApplicationRecord(record);
    else setLocalRecords(previous=>[...previous.filter(r=>r.id!==record.id),record]);
  };
  const returnSection=useRef(section);
  const openApplication=()=>{returnSection.current=section;setSection("application");};
  const openTransfer=()=>setSection("transfer");
  const openPractice=()=>setSection("situations");
  const exportRecords = () => {
    const blob=new Blob([JSON.stringify({...learningRecordContext("dt"),lesson:"2-2",source:"dt",explanationReview:"teacher",attempts:props.attempts,strategyAttempts:props.strategyAttempts,applicationRecords,transferLearningRecords,support:props.supportRecords.filter(r=>r.lesson==="2-2")},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="coordinate-learning-records.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const errorEvents=[...props.attempts.flatMap(a=>{const task=COORDINATE_TASKS.find(t=>t.id===a.taskId);return task?[coordinateErrorEvent(task,a)]:[];}),
    ...props.strategyAttempts.flatMap(a=>{const task=COORDINATE_SCENARIOS.find(t=>t.id===a.taskId);return task?[strategyErrorEvent(task,a)]:[];})];
  const content = section === "transfer" ? <CoordinateTransferLesson {...props} records={applicationRecords} onRecord={saveApplication}
    learningRecords={transferLearningRecords} onLearningRecord={saveLearning}
    onBack={()=>setSection("concepts")} onFree={openApplication} onPractice={openPractice} onExport={exportRecords}/> : section === "application" ? <CoordinateApplicationLesson {...props} records={applicationRecords} onRecord={saveApplication}
    onBack={()=>setSection(returnSection.current)} onExport={exportRecords}/> : section === "concepts" ? <CoordinateComparisonLesson {...props} errorEvents={errorEvents} onExport={exportRecords} onApplication={openApplication} onNext={openTransfer} onPractice={openPractice}/>
    : <CoordinateStrategyLesson {...props} attempts={props.strategyAttempts} onAttempt={props.onStrategyAttempt}
        errorEvents={errorEvents} onExport={exportRecords} onApplication={openApplication} onNext={openTransfer} onBack={()=>setSection("concepts")}/>;
  const sections = ["concepts", "transfer", "situations", "application"];
  return <><div className="coordinate-section-nav"><LessonCoursePath label="절대·상대좌표 학습 선택" current={sections.indexOf(section)}
    items={[{label:"개념 비교"},{label:"물체 실습"},{label:"상황 설계"},{label:"자유 적용"}]}
    onSelect={index=>index===3?openApplication():setSection(sections[index])}/></div>{content}</>;
}

const fmt = (n: number) => Number(n.toFixed(2)).toString();
const point = (p: CoordinateVector) => `(${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)})`;
import { TaskStartPoint, moveVirtualTaskStart } from "./TaskStartPoint";

function CoordinateComparisonLesson(props: MotionProps & SupportProps & {
  attempts: CoordinateAttempt[]; onAttempt: (attempt: CoordinateAttempt) => void;
  onVisualChange: (visual: CoordinateVisual | null) => void; onNext: () => void; onExport: () => void;
  errorEvents:ErrorEvent[]; onApplication:()=>void; onPractice:()=>void;
}) {
  const motion = useLessonMotion(props);
  const [index, setIndex] = useState(() => {
    const remaining = COORDINATE_TASKS.findIndex(t => !props.attempts.some(a => a.taskId === t.id && a.completed));
    return remaining < 0 ? COORDINATE_TASKS.length - 1 : remaining;
  });
  const task = COORDINATE_TASKS[index], from = coordinateStart(task), context = coordinateProblemContext(task);
  const scenePoint = useMemo(() => createAxisSceneProjection(props.model, props.joints.j3), [props.model.ik, props.joints.j3]);
  const independent = task.support === "independent";
  const [draft, setDraft] = useState(blankCoordinateDraft);
  const [comparison, setComparison] = useState("");
  const [rule, setRule] = useState("");
  const [explanation, setExplanation] = useState("");
  const [hints, setHints] = useState(0);
  const [hintOpen, setHintOpen] = useState(false);
  const [attempt, setAttempt] = useState<CoordinateAttempt | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [reviewComparison,setReviewComparison] = useState("");
  const [reviewRule,setReviewRule] = useState("");
  const [reviewExplanation,setReviewExplanation] = useState("");
  const [epoch, setEpoch] = useState(0);
  const [supportMode, setSupportMode] = useState<"guided"|"challenge">("guided");
  const isChallengeMode = supportMode === "challenge";
  const latest = useRef(props); latest.current = props;
  const scroll = useRef<HTMLDivElement>(null);
  const complete = props.attempts.some(a => a.taskId === task.id && a.completed);
  const completed = COORDINATE_TASKS.filter(t => props.attempts.some(a => a.taskId === t.id && a.completed)).length;
  const allComplete = completed === COORDINATE_TASKS.length;
  const analysis = attempt ? analyzeCoordinateAttempt(task,attempt) : null;
  const bothObserved = analysis?.observed ?? false;
  const judgmentOnly = !!attempt && canReviewCoordinateJudgment(task,attempt);
  const locked = motion.running || attempt !== null;
  const ready = !!coordinateCommands(task,draft) && !!comparison && (!coordinateRule(task) || !!rule) && (!(independent || isChallengeMode) || !!explanation.trim());
  const supportIds=props.supportRecords.filter(r=>r.lesson==="2-2").map(r=>r.id);
  const aiContext=(next=attempt)=>numericFeedbackContext({
    task:`coordinate-${task.id}`,condition:{task,context},answers:next?.draft??draft,
    reason:next?.explanation??explanation,
    initial:props.attempts.find(a=>a.taskId===task.id),history:props.attempts.filter(a=>a.taskId===task.id),
    execution:next?.results??{},judgment:next?analyzeCoordinateAttempt(task,next):"기존 판정 전",
    challenge:independent||isChallengeMode,
  });
  const ai=useLearningAi(aiContext());
  const taskDrafts=useRef(new Map<string,{draft:typeof draft;comparison:string;rule:string;explanation:string;
    hints:number;supportMode:typeof supportMode;attempt:CoordinateAttempt|null}>());
  const lastReset=useRef({key:props.resetKey,connected:props.hardwareConnected});
  const openTask=(next:number)=>{
    if(motion.running||next===index)return;
    taskDrafts.current.set(task.id,{draft,comparison,rule,explanation,hints,supportMode,attempt});
    setIndex(next);
  };

  // HOME/hardware/navigation keep their existing cancellation behavior. Submitted records stay in App.
  useLayoutEffect(() => {
    const reset=lastReset.current.key!==props.resetKey||lastReset.current.connected!==props.hardwareConnected;
    lastReset.current={key:props.resetKey,connected:props.hardwareConnected};
    if(reset)taskDrafts.current.clear();
    const saved=taskDrafts.current.get(task.id);
    const previous=reset?null:saved?.attempt??latest.current.attempts.filter(a=>a.taskId===task.id).at(-1)??null;
    setDraft(saved?.draft??previous?.draft??blankCoordinateDraft()); setComparison(saved?.comparison??previous?.comparison??"");
    setRule(saved?.rule??previous?.rule??"");setExplanation(saved?.explanation??previous?.explanation??"");setAttempt(previous);
    setSupportMode(saved?.supportMode??previous?.supportMode??"guided");
    setHints(Math.max(saved?.hints??0,...latest.current.attempts.filter(a => a.taskId === task.id).map(a => a.hints)));
    setHintOpen(false); setFeedback(null); setEpoch(n=>n+1);
    setReviewComparison("");setReviewRule("");setReviewExplanation("");
  }, [task.id, props.resetKey, props.hardwareConnected]);
  useEffect(() => { scroll.current?.scrollTo({top:0}); }, [task.id,complete,bothObserved]);
  useEffect(() => {
    props.onVisualChange(complete ? null : { key:`${task.id}:${epoch}`, from, scenePoint, fromLabel:task.changedStart ? "C" : "A",
      points:coordinatePreview(task,attempt?.draft ?? draft,!!attempt), results:attempt?.results ?? {} });
  }, [task,epoch,from,draft,attempt,complete,scenePoint,props.onVisualChange]);
  useEffect(() => () => latest.current.onVisualChange(null), []);

  const save = (value: CoordinateAttempt,carryToNext=false) => {
    setAttempt(value); props.onAttempt(structuredClone(value));
    if(!attempt||JSON.stringify(value.results)!==JSON.stringify(attempt.results)
      ||JSON.stringify(value.judgmentReviews)!==JSON.stringify(attempt.judgmentReviews))
      void ai.request(Object.keys(value.results).length?"result":"submit",aiContext(value),"",
        value.id+(value.judgmentReviews?.length?`:review:${value.judgmentReviews.length}`:""),carryToNext);
  };
  const submitPrediction=()=>{
    if(motion.running||attempt||!ready)return;
    const value=makeCoordinateAttempt(task,draft,{comparison,rule,explanation,hints,supportIds,supportMode});if(value)save(value);
  };
  const execute = (mode: CoordinateMode) => {
    if (props.hardwareConnected || motion.running || complete) return;
    if(independent&&!attempt)return;
    const submitted = attempt ?? makeCoordinateAttempt(task,draft,{comparison,rule,explanation,hints,supportIds,supportMode});
    if (!submitted || submitted.results[mode]) return;
    const commands = coordinateCommands(task,submitted.draft);
    if (!commands) return;
    save(submitted); // Preserve the first expression even when preflight rejects its path.
    // Both commands must be playable. No student coordinate is clamped or silently corrected.
    const absolute = sampleLessonMotion(props.model,from,commands.absolute,"MoveL",props.joints.j3);
    const relative = sampleLessonMotion(props.model,from,commands.relative,"MoveL",props.joints.j3);
    if (!absolute || !relative) {
      const guidance = task.support === "guided" ? analyzeCoordinateAttempt(task,submitted).fields.find(f=>!f.correct)?.feedback : null;
      setFeedback(`${!absolute ? MODE_LABEL.absolute : MODE_LABEL.relative}의 입력 위치 또는 중간 경로를 이 DT 모델에서 계산할 수 없습니다. ${guidance ?? "문제 조건과 입력값을 확인하세요."}`); return;
    }
    const frames = mode === "absolute" ? absolute : relative;
    setFeedback(null);
    motion.play(frames,"MoveL",() => save({ ...submitted, results:{...submitted.results,
      [mode]:{from:{...frames[0].pose},to:{...frames.at(-1)!.pose}}}, completed:false }));
  };
  const saveAndAdvance = (value: CoordinateAttempt) => {
    save(value,true); setFeedback(null);
    const next=COORDINATE_TASKS.findIndex(t=>t.id!==value.taskId&&!props.attempts.some(a=>a.taskId===t.id&&a.completed));
    if(next>=0)setIndex(next);
  };
  const finish = () => {
    if (!attempt) return;
    const result = completeCoordinateAttempt(task,attempt);
    if (!result) { setFeedback("비교표의 차이를 확인한 뒤 예측을 수정하고 다시 검증하세요."); return; }
    saveAndAdvance(result);
  };
  const confirmJudgment = () => {
    if(!attempt||!analysis||motion.running||props.hardwareConnected)return;
    const result=reviewCoordinateJudgment(task,attempt,{
      comparison:analysis.comparisonCorrect?attempt.comparison:reviewComparison,
      rule:analysis.ruleCorrect?attempt.rule:reviewRule,explanation:reviewExplanation,
    });
    if(!result)return;
    if(result.completed)saveAndAdvance(result);
    else {save(result);setFeedback("위의 두 DT 도착점을 비교하고, 각 명령에서 위치와 변화량 중 무엇을 지정했는지 다시 확인하세요.");}
  };
  const retry = () => {
    if (motion.running) return;
    setAttempt(null); setFeedback(null);setReviewComparison("");setReviewRule("");setReviewExplanation("");scroll.current?.scrollTo({top:0});
  };
  const advance = () => {
    const next = COORDINATE_TASKS.findIndex(t => !props.attempts.some(a => a.taskId === t.id && a.completed));
    if (next >= 0) setIndex(next);
  };


  return <div className="lesson-scroll coordinate-learning math-start-lesson" ref={scroll}>
    <TaskStartPoint taskKey={`coordinates:${task.id}:${props.resetKey}`} start={from} coords={props.coords}
      disabled={motion.running} legacyConnected={props.hardwareConnected} onVirtualMove={p=>moveVirtualTaskStart(props,p)}/>
    <div className="axis-status">
      <strong>{index+1}/{COORDINATE_TASKS.length} · {task.title}</strong>
      <span>난이도: 좌표 표현·DT 비교 · 현재 단계: {bothObserved ? "비교·수정" : attempt ? "실행·측정" : "표현·예측"}</span>
    </div>
    <div className="math-cycle-rail" aria-label="피지컬 AI 학습 순환">
      <div className="math-cycle-current">
        <b>{bothObserved ? "6/7" : attempt ? "4/7" : "3/7"}</b>
        {bothObserved ? "비교·해석" : attempt ? "실행·측정" : "예측"}
      </div>
    </div>
    <div className="math-support-bar" role="group" aria-label="지원 수준">
      <strong>지원 수준</strong>
      <button type="button" className={supportMode === "guided" ? "is-selected" : ""} onClick={() => { setSupportMode("guided"); setFeedback(null); }}>
        기초 지원
      </button>
      <button type="button" className={supportMode === "challenge" ? "is-selected" : ""} onClick={() => { setSupportMode("challenge"); setHintOpen(false); setFeedback(null); }}>
        도전 모드
      </button>
    </div>
    <LessonCoursePath label="절대·상대좌표 문항 선택" current={index} disabled={motion.running}
      items={COORDINATE_TASKS.map((item,i)=>({label:["변화량","도착점","같은 숫자","출발점 변경","새 조건"][i],detail:item.title,
        complete:props.attempts.some(row=>row.taskId===item.id&&row.completed)}))} onSelect={openTask}/>
    <div className="math-stage-rail coordinate-stage-rail" aria-label="현재 활동 단계">
      <span aria-current={!attempt ? "step" : undefined}>1. 표현·예측</span>
      <span aria-current={attempt && !bothObserved ? "step" : undefined}>2. 실행·측정</span>
      <span aria-current={bothObserved ? "step" : undefined}>3. 비교·수정</span>
    </div>
    <LearningAiFeedback ai={ai} result={bothObserved}/>
    <details className="lesson-context"><summary>절대좌표·상대좌표 개념 보기</summary><LessonConceptHeader
      section="2-2"
      label="개념 학습"
      title="절대좌표와 상대좌표"
      duration="수업 1회 20~30분"
      definition="절대좌표는 원점 기준의 도착 위치이고, 상대좌표는 현재 TCP에서 목표까지의 변화량입니다. 같은 이동을 두 표현으로 바꾸고 DT 결과로 확인합니다."
      columns={[]}
      showColumns={false}
    /></details>
    <section className="coordinate-concept-bridge" aria-labelledby="coordinate-concept-bridge-title">
      <strong id="coordinate-concept-bridge-title">핵심 관계를 이번 문제에 연결하기</strong>
      <div className="coordinate-concept-bridge__points">
        <div><small>시작 기준 {task.changedStart ? "C" : "A"}</small><b>{point(from)} mm</b></div>
        <span aria-hidden="true">→</span>
        <div><small>{context.label}</small><b>{point(context.value)} mm</b></div>
      </div>
      <div className="coordinate-concept-bridge__formula">{context.relation}</div>
      <p>{context.instruction}</p>
      <small className="lesson-note">좌표 순서 (X, Y, Z) · 단위 mm · 변화량은 로봇 기준축으로 표현합니다.</small>
    </section>
    {props.hardwareConnected && <p className="lesson-notice">실장비 연결 중에는 DT 실행을 사용할 수 없습니다. 연결을 해제한 뒤 진행하세요.</p>}
    {!complete ? <>
      {!bothObserved && <>
        {task.changedStart && <div className="lesson-card coordinate-conditions">
          <p><strong>원래 출발점 A</strong> {point(task.a)} mm → <strong>원래 도착점 B</strong> {point(task.b)} mm</p>
          {!independent && !isChallengeMode && <p>이때의 변화량 Δ: {point(poseDifference(task.a,task.b))} mm</p>}
        </div>}
        {!independent && !isChallengeMode && <>
          <button className="coordinate-hint" disabled={locked} onClick={() => { setHintOpen(!hintOpen); if (!hintOpen) setHints(n=>n+1); }}>
            {hintOpen ? "힌트 접기" : "관계 힌트 보기"}</button>
          {hintOpen && <div className="lesson-formula">{(task.kind === "transfer" || task.kind === "literal")
            ? "절대 명령은 원점 기준 위치를 지정합니다. 상대 이동 명령은 실행할 때의 출발점에 변화량을 더합니다."
            : <>도착점 B = 출발점 A + 변화량 Δ<br/>변화량 Δ = B − A</>}</div>}
        </>}
        {coordinateFields(task).map(field => <fieldset className="lesson-coordinates" disabled={locked} key={field}>
          <legend>{task.kind === "delta" ? "같은 이동을 만드는 내 변화량 Δ" : task.kind === "endpoint" ? "같은 이동을 만드는 내 도착점 B" : `${task.changedStart ? "C" : "A"}에서 실행할 때 예상 ${FIELD_LABEL[field]}`} (mm)</legend>
          {POSE_AXES.map(axis => <label key={axis}>{field === "delta" ? "Δ" : ""}{axis.toUpperCase()}
            <input type="number" step="any" placeholder="?" value={draft[field][axis]} aria-label={`${FIELD_LABEL[field]} ${axis.toUpperCase()}`}
              onChange={e => { setDraft(previous=>({...previous,[field]:{...previous[field],[axis]:e.target.value}})); setFeedback(null); }}/>
          </label>)}
        </fieldset>)}
        {coordinateRule(task) && <label>{task.kind === "transfer" ? "출발점이 바뀌면 무엇이 유지될까요?" : "도착 위치를 변화량으로 바꾸는 관계는?"}
          <select value={rule} disabled={locked} onChange={e=>setRule(e.target.value)}>
            <option value="">관계 선택</option>
            {task.kind === "transfer" ? <><option value="absolute-fixed">절대 명령의 도착 위치 · 상대 명령의 변화량</option>
              <option value="relative-fixed">절대 명령의 변화량 · 상대 명령의 도착 위치</option><option value="both-fixed">두 명령의 도착 위치가 모두 유지</option></>
              : <><option value="subtract">Δ = B − A</option><option value="reverse">Δ = A − B</option><option value="endpoint">Δ = B</option></>}
          </select>
        </label>}
        {attempt && <CoordinateCommandTable rows={COORDINATE_MODES.map(mode=>({mode,argument:coordinateArguments(task,attempt.draft)[mode],from,
          to:attempt.results[mode]?.to}))}/>}
        <label>이 두 명령을 같은 출발점에서 실행하면 도착점이 같을까요?
          <select value={comparison} disabled={locked} onChange={e=>setComparison(e.target.value)}>
            <option value="">실행 전 예측</option><option value="same">같다</option><option value="different">다르다</option>
          </select>
        </label>
        {(independent || isChallengeMode) && <label>{isChallengeMode ? "계산 근거를 한 문장으로 설명하세요." : "출발점과 두 명령의 관계를 근거로 예측을 설명하세요."}
          <textarea rows={3} maxLength={600} value={explanation} disabled={locked} onChange={e=>setExplanation(e.target.value)}/>
          <span className="lesson-note">근거는 자동 정답 처리하지 않고 교사 확인을 위한 기록으로 남깁니다.</span>
        </label>}
        <p className="lesson-note">{task.kind === "transfer" ? "두 실행 모두 C" : "두 실행 모두 A"} {point(from)}에 DT를 배치한 뒤 MoveL로 이동합니다. {task.kind === "delta" ? "상대 이동에는 내가 입력한 Δ를 사용합니다." : task.kind === "endpoint" ? "절대 명령에는 내가 입력한 B를 사용합니다." : "입력칸은 예상 도착점이며, 주어진 두 명령을 그대로 실행합니다."} R=0°.</p>
        {independent&&!attempt&&<><p className="lesson-note">예상 도착점·판단 근거를 먼저 제출하세요. 계산된 명령값과 경로는 제출 후 표시됩니다.</p>
          <button className="lesson-primary" disabled={!ready||motion.running} onClick={submitPrediction}>예측·근거 먼저 제출</button></>}
        <div className="lesson-actions">{COORDINATE_MODES.map(mode => <button key={mode} className="lesson-primary"
          disabled={motion.running || props.hardwareConnected || (independent&&!attempt) || (!attempt && !ready) || !!attempt?.results[mode]} onClick={()=>execute(mode)}>
          {attempt?.results[mode] ? "✓ 관찰 완료 · " : ""}{MODE_LABEL[mode]} 실행</button>)}</div>
        {!ready && !attempt && <p className="lesson-note">{isChallengeMode ? "모든 입력·예측·근거를 작성하면 DT 실행을 시작할 수 있습니다." : "빈칸과 예측을 모두 작성하면 실행할 수 있습니다."}</p>}
        {attempt && <p className="lesson-note">제출한 예측을 저장했습니다. 나머지 명령도 실행해 같은 출발점에서 비교하세요.</p>}
      </>}
      {bothObserved && attempt && analysis && <div className="lesson-card coordinate-result-card">
        <strong>{analysis.numericCorrect?"계산 결과 확인":"내 입력과 DT 결과 비교"}</strong>
        <p className="lesson-note">같은 출발점 {task.changedStart?"C":"A"} {point(from)} · 좌표 (X, Y, Z), mm</p>
        <div className="coordinate-endpoint-summary" aria-label="두 명령의 DT 도착점">
          {COORDINATE_MODES.map(mode=><div key={mode}><span>{MODE_LABEL[mode]} 도착</span><strong>{point(attempt.results[mode]!.to)}</strong></div>)}
        </div>
        <p className="coordinate-result-conclusion">{analysis.actualSame?`두 명령 모두 ${point(attempt.results.absolute!.to)}에 도착했습니다.`:"두 명령이 서로 다른 위치에 도착했습니다."}</p>
        {!analysis.numericCorrect&&<ul className="axis-revision-causes" aria-label="다시 확인할 입력">{analysis.fields.filter(f=>!f.correct).map(f=><li key={`${f.field}-${f.axis}`}>
          <b>{FIELD_LABEL[f.field]} {f.axis.toUpperCase()}</b> · {f.feedback}
        </li>)}</ul>}
        {judgmentOnly?<div className="lesson-revision-fields coordinate-judgment"><strong>{!analysis.comparisonCorrect?"도착점이 같은지 다시 판단해 보세요":"위치와 변화량의 관계를 다시 확인하세요"}</strong>
          <p>계산과 이동은 맞았습니다. 아래 판단만 고치면 재실행 없이 다음으로 진행합니다.</p>
          {!analysis.comparisonCorrect&&<fieldset className="axis-relation-question" aria-label="도착점 비교 판단 수정">
            <legend>처음에는 ‘{attempt.comparison==="same"?"같다":"다르다"}’고 예상했습니다. 위의 두 DT 도착점을 비교하면?</legend>
            <div className="axis-relation-options coordinate-comparison-choices">{(["same","different"] as const).map(value=><label key={value} data-selected={reviewComparison===value}>
              <input type="radio" name={`endpoint-review-${attempt.id}`} value={value} checked={reviewComparison===value} onChange={()=>{setReviewComparison(value);setFeedback(null);}}/>
              <span>{value==="same"?"도착점이 같다":"도착점이 다르다"}</span>
            </label>)}</div>
          </fieldset>}
          {!analysis.ruleCorrect&&<p className="lesson-note">{task.kind==="transfer"?"절대 명령은 도착 위치를, 상대 명령은 출발점에 더할 변화량을 지정합니다.":"변화량 Δ는 도착 위치 B에서 출발 위치 A를 뺀 값입니다."}</p>}
          {!analysis.ruleCorrect&&<label>{task.kind==="transfer"?"출발점이 달라져도 각 명령에서 유지되는 것은?":"출발점 A와 도착점 B로 변화량 Δ를 구하는 관계는?"}
            <select aria-label="좌표 관계 판단 수정" value={reviewRule} onChange={e=>{setReviewRule(e.target.value);setFeedback(null);}}><option value="">다시 선택</option>
              {task.kind==="transfer"?<><option value="absolute-fixed">절대 명령의 도착 위치 · 상대 명령의 변화량</option><option value="relative-fixed">절대 명령의 변화량 · 상대 명령의 도착 위치</option><option value="both-fixed">두 명령의 도착 위치가 모두 유지</option></>
                :<><option value="subtract">Δ = B − A</option><option value="reverse">Δ = A − B</option><option value="endpoint">Δ = B</option></>}
            </select></label>}
          {independent&&<label>DT 결과를 보고 판단을 어떻게 고쳤나요?
            <textarea aria-label="좌표 판단 수정 근거" rows={2} maxLength={600} value={reviewExplanation} onChange={e=>setReviewExplanation(e.target.value)}/></label>}
          {feedback&&<p className="lesson-feedback" role="status">{feedback}</p>}
          <button className="lesson-primary" disabled={props.hardwareConnected||(!analysis.comparisonCorrect&&!reviewComparison)||(!analysis.ruleCorrect&&!reviewRule)||(independent&&!reviewExplanation.trim())}
            onClick={confirmJudgment}>판단 확인 · {index===COORDINATE_TASKS.length-1?"개념 비교 마치기":"다음 문항"}</button>
          <p className="lesson-note">처음 제출한 판단과 수정한 판단을 함께 기록합니다.</p>
        </div>:analysis.canComplete ? <button className="lesson-primary" onClick={finish}>비교 확인 · {index===COORDINATE_TASKS.length-1?"개념 비교 마치기":"다음 문항"}</button>
          : <button className="lesson-primary" onClick={retry}>예측·표현 수정하고 다시 검증</button>}
        <details className="axis-help coordinate-result-details" key={attempt.id}><summary>명령값·계산 관계·제출 내용 자세히</summary>
          <CoordinateCommandTable rows={COORDINATE_MODES.map(mode=>({mode,argument:coordinateArguments(task,attempt.draft)[mode],from,to:attempt.results[mode]!.to}))}/>
          <p>{task.kind === "literal" ? "같은 숫자를 넣어도 기준이 다릅니다. 상대 이동은 실행 출발점에 그 숫자를 변화량으로 더하므로 도착점이 달라집니다."
            : analysis.actualSame ? "같은 이동을 두 방식으로 표현했으므로 도착점이 같습니다. 절대 명령의 위치와 상대 명령의 변화량이 같은 뜻이라는 의미는 아닙니다."
            : task.kind === "transfer" ? "절대 명령은 지정 위치를 유지하고, 상대 명령은 새 출발점에 같은 변화량을 더하므로 도착점이 달라집니다." : "지금은 두 명령이 서로 다른 이동을 나타냅니다. 위치와 변화량을 연결해 보세요."}</p>
          <p>내 예측: {attempt.comparison === "same" ? "같다" : "다르다"} · DT 도착점: {analysis.actualSame ? "같음" : "다름"} {analysis.comparisonCorrect ? "✓ 일치" : "↻ 예측과 다름"}</p>
          {!analysis.numericCorrect && (task.kind === "delta" || task.kind === "endpoint") && <p>두 명령이 다른 곳에 도착했다면, 내가 입력한 표현이 주어진 이동과 같은지 확인하세요.</p>}
          {!analysis.ruleCorrect && <p className="lesson-feedback">{task.kind === "transfer" ? "절대 명령에서 유지되는 것은 원점 기준 도착 위치입니다. 상대 명령에서 유지되는 것은 출발점에 더할 변화량입니다." : "Δ는 위치 자체가 아니라 도착 위치에서 출발 위치를 뺀 변화량입니다."}</p>}
          <p className="lesson-note">DT 계산 결과입니다. 실장비 측정값과 구분해 기록합니다.</p>
        <strong>제출한 표현과 수학적 관계 비교</strong>
          <table className="coordinate-comparison"><thead><tr><th>항목</th><th>내 입력</th><th>판단·확인할 관계</th></tr></thead>
            <tbody>{analysis.fields.map(f=><tr key={`${f.field}-${f.axis}`} data-match={f.correct}>
              <th>{FIELD_LABEL[f.field]} {f.axis.toUpperCase()}</th><td>{f.value === null ? "미입력" : fmt(f.value)}<br/>{f.correct ? "✓ 일치" : "↻ 다시 확인"}</td>
              <td>{f.correct ? "관계와 일치합니다." : f.feedback}</td>
            </tr>)}</tbody></table>
          {!analysis.numericCorrect&&<details className="axis-help coordinate-solution" key={attempt.id} onToggle={e=>{
            if(e.currentTarget.open)save({...attempt,solutionViews:[...(attempt.solutionViews??[]),new Date().toISOString()]});
          }}><summary>풀이 확인 (선택)</summary><p>먼저 위의 관계를 이용해 수정해 보세요. 아래는 관계에 따라 계산한 값입니다.</p>
            <table><thead><tr><th>다시 확인할 항목</th><th>관계에 따른 값 (mm)</th></tr></thead>
              <tbody>{analysis.fields.filter(f=>!f.correct).map(f=><tr key={`${f.field}-${f.axis}`}><th>{FIELD_LABEL[f.field]} {f.axis.toUpperCase()}</th><td>{fmt(f.expected)}</td></tr>)}</tbody></table>
          </details>}
        </details>
        <p className="lesson-note">DT 계산 결과입니다. 처음 제출한 답과 수정한 판단은 함께 기록합니다.</p>
      </div>}
      {attempt && !motion.running && !bothObserved && <button onClick={retry}>입력·예측 수정하기</button>}
    </> : <div className="lesson-card axis-complete" role="status">
      <strong>{allComplete ? "개념 비교 완료 · 이제 내 방식으로 설계하기" : "이 문항의 표현·예측·비교 완료"}</strong>
      <p>{task.kind === "literal" ? "명령에 넣은 숫자가 같아도, 절대 이동은 위치로 해석하고 상대 이동은 변화량으로 해석합니다."
        : task.kind === "transfer" ? "출발점이 달라지면 같은 상대 이동의 도착점도 달라집니다. 같은 절대 명령은 원점 기준 도착 위치를 유지합니다."
        : "위치와 변화량을 연결하면 같은 이동을 절대 명령과 상대 이동 명령으로 표현할 수 있습니다."}</p>
      {independent && <details className="axis-help"><summary>독립 적용의 예측·근거 기록</summary>
        {props.attempts.filter(a=>a.taskId===task.id).map((a,i)=><div key={a.id}><p>{i+1}차 제출 · {a.completed ? "활동 완료" : "재검토 또는 미완료"}</p><p>{a.explanation}</p>
          {a.judgmentReviews?.map((r,j)=><p key={j}>판단 수정 {j+1}: {r.comparison==="same"?"도착점이 같다":"도착점이 다르다"} · {r.explanation}</p>)}</div>)}
        <p>서술의 타당성은 교사 확인이 필요합니다.</p>
      </details>}
      {!allComplete ? <button className="lesson-primary" onClick={advance}>다음 문항 →</button>
        : <><button className="lesson-primary" onClick={props.onNext}>같은 물체를 절대·상대 두 방식으로 옮기기 →</button>
          <button onClick={props.onPractice}>상황에 맞게 명령 설계하기 →</button></>}
    </div>}
    {feedback && !judgmentOnly && <p className="lesson-feedback" role="status">{feedback}</p>}
    {!isChallengeMode && (!independent||attempt||complete)&&<AdaptiveSupport {...props} lesson="2-2" taskId={task.id} events={props.errorEvents} disabled={motion.running}/>}
    {independent&&supportIds.length>0&&<p className="lesson-note">보충 사용 이력이 있는 재도전입니다. 최초 응답과 구분해 기록합니다.</p>}
    <div className="lesson-actions">{motion.running && <button onClick={()=>{motion.stop();setFeedback("중지한 실행은 관찰 완료로 기록하지 않습니다. 같은 출발점에서 다시 실행할 수 있습니다.");}}>DT 정지</button>}
      <button disabled={props.hardwareConnected} onClick={motion.reset}>↺ DT 원위치</button></div>
    <button className="lesson-next" disabled={motion.running} onClick={props.onNext}>물체 실습으로: 절대·상대 두 방식 풀기 →</button>
    <details className="axis-help"><summary>추가 연습 선택</summary>
      <div className="lesson-actions"><button disabled={motion.running} onClick={props.onApplication}>직접 적용: 좌표 이동·물체 옮기기 →</button>
        <button disabled={motion.running} onClick={props.onPractice}>상황 풀이로: 절대·상대 방식 직접 선택 →</button></div>
    </details>
    <p className="lesson-note">제출한 예측·실행·설명과 보충 기록은 이 브라우저에 저장됩니다.</p>
  </div>;
}
