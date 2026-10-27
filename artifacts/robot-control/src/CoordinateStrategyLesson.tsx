import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LearningAiFeedback, useLearningAi } from "./LearningAiFeedback";
import { numericFeedbackContext } from "./learningAiContext";
import { LessonConceptHeader } from "./LessonConceptHeader";import { POSE_AXES, sampleLessonMotion } from "./curriculum";
import { useLessonMotion, type MotionProps } from "./LessonPages";
import { COORDINATE_MODES, MODE_LABEL, readCoordinateVector, type CoordinateVisual } from "./coordinateLearning";
import { AdaptiveSupport } from "./AdaptiveSupport";
import { type ErrorEvent, type SupportProps } from "./learningSupport";
import { CoordinateCommandTable, CoordinateMeaning, coordinatePoint, coordinateDelta } from "./CoordinateCommandTable";
import {
  COORDINATE_SCENARIOS, blankStrategyCommands, changeStrategyMode, strategyPlan, strategyPreviewPlan,
  makeStrategyAttempt, analyzeStrategyAttempt, completeStrategyAttempt, strategyVisual, type StrategyAttempt,
  blankStrategyPredictions, hasStrategyPredictions, strategyRevealed,
  canReviewStrategyJudgment, reviewStrategyJudgment,
} from "./coordinateStrategies";

import { TaskStartPoint, moveVirtualTaskStart } from "./TaskStartPoint";

export function CoordinateStrategyLesson(props: MotionProps & SupportProps & {
  attempts:StrategyAttempt[]; onAttempt:(attempt:StrategyAttempt)=>void;
  onVisualChange:(visual:CoordinateVisual|null)=>void; onBack:()=>void; onNext:()=>void; onExport:()=>void;
  errorEvents:ErrorEvent[]; onApplication?:()=>void;
}) {
  const motion=useLessonMotion(props);
  const [index,setIndex]=useState(()=>{
    const next=COORDINATE_SCENARIOS.findIndex(t=>!props.attempts.some(a=>a.taskId===t.id&&a.completed));
    return next<0?COORDINATE_SCENARIOS.length-1:next;
  });
  const task=COORDINATE_SCENARIOS[index], independent=task.support==="independent";
  const [commands,setCommands]=useState(()=>blankStrategyCommands(task));
  const [predictions,setPredictions]=useState(()=>blankStrategyPredictions(task));
  const [requirement,setRequirement]=useState("");
  const [explanation,setExplanation]=useState("");
  const [hints,setHints]=useState(0), [hintOpen,setHintOpen]=useState(false);
  const [attempt,setAttempt]=useState<StrategyAttempt|null>(null);
  const [feedback,setFeedback]=useState<string|null>(null);
  const [reviewRequirement,setReviewRequirement]=useState(""),[reviewExplanation,setReviewExplanation]=useState("");
  const [openStep,setOpenStep]=useState(0);
  const stepButtons=useRef<(HTMLButtonElement|null)[]>([]);
  const [epoch,setEpoch]=useState(0);
  const scroll=useRef<HTMLDivElement>(null), latest=useRef(props);latest.current=props;
  const complete=props.attempts.some(a=>a.taskId===task.id&&a.completed);
  const completed=COORDINATE_SCENARIOS.filter(t=>props.attempts.some(a=>a.taskId===t.id&&a.completed)).length;
  const locked=motion.running||!!attempt;
  const revealed=strategyRevealed(task,!!attempt);
  const plan=revealed?strategyPreviewPlan(task,attempt?.commands??commands):[];
  const analysis=attempt?analyzeStrategyAttempt(task,attempt):null;
  const observed=!!analysis?.observed;
  const judgmentOnly=!!attempt&&canReviewStrategyJudgment(task,attempt);
  const ready=!!strategyPlan(task,commands)&&!!requirement&&!!explanation.trim()&&(!independent||hasStrategyPredictions(task,predictions));
  const supportIds=props.supportRecords.filter(r=>r.lesson==="2-2").map(r=>r.id);
  const aiContext=(next=attempt)=>numericFeedbackContext({
    task:`coordinate-strategy-${task.id}`,condition:task,answers:next?.commands??commands,
    reason:next?.explanation??explanation,initial:props.attempts.find(a=>a.taskId===task.id),
    history:props.attempts.filter(a=>a.taskId===task.id),execution:next?.results??[],
    judgment:next?analyzeStrategyAttempt(task,next):"기존 판정 전",challenge:independent,
  });
  const ai=useLearningAi(aiContext());
  useLayoutEffect(()=>{
    setCommands(blankStrategyCommands(task));setRequirement("");setExplanation("");setAttempt(null);setFeedback(null);
    setPredictions(blankStrategyPredictions(task));
    setReviewRequirement("");setReviewExplanation("");setOpenStep(0);
    setHintOpen(false);setHints(Math.max(0,...latest.current.attempts.filter(a=>a.taskId===task.id).map(a=>a.hints)));setEpoch(n=>n+1);
  },[task,props.resetKey,props.hardwareConnected]);
  useEffect(()=>{scroll.current?.scrollTo({top:0});},[task.id,complete]);
  useEffect(()=>{
    props.onVisualChange(complete?null:strategyVisual(task,attempt?.commands??commands,attempt?.results??[],`${task.id}:${epoch}`,!!attempt));
  },[task,commands,attempt,complete,epoch,props.onVisualChange]);
  useEffect(()=>()=>latest.current.onVisualChange(null),[]);
  const save=(value:StrategyAttempt)=>{
    setAttempt(value);props.onAttempt(structuredClone(value));
    if(!attempt||JSON.stringify(value.results)!==JSON.stringify(attempt.results)
      ||JSON.stringify(value.judgmentReviews)!==JSON.stringify(attempt.judgmentReviews))
      void ai.request(value.results.length?"result":"submit",aiContext(value),"",
        value.id+(value.judgmentReviews?.length?`:review:${value.judgmentReviews.length}`:""),!!value.completed);
  };
  const submitPrediction=()=>{
    if(motion.running||attempt||!ready)return;
    const value=makeStrategyAttempt(task,commands,{requirement,explanation,hints,predictions,supportIds});if(value)save(value);
  };
  const runNext=()=>{
    if (motion.running||props.hardwareConnected||complete) return;
    if(independent&&!attempt)return;
    const submitted=attempt??makeStrategyAttempt(task,commands,{requirement,explanation,hints,predictions:independent?predictions:undefined,supportIds});
    if (!submitted) return;
    const planned=strategyPlan(task,submitted.commands);if(!planned) return;
    save(submitted); // Invalid paths remain submitted evidence; retry creates a new snapshot.
    const frames=planned.map(step=>sampleLessonMotion(props.model,step.from,step.to,"MoveL",props.joints.j3));
    const invalid=frames.findIndex(f=>!f);
    if(invalid>=0){setFeedback(`${invalid+1}번 명령의 위치 또는 중간 경로를 이 DT 모델에서 계산할 수 없습니다. 표현 방식과 명령값을 확인하세요.`);return;}
    const next=submitted.results.length;if(next>=planned.length) return;
    setFeedback(null);
    motion.play(frames[next]!,"MoveL",()=>save({...submitted,results:[...submitted.results,
      {from:{...frames[next]![0].pose},to:{...frames[next]!.at(-1)!.pose}}],completed:false}));
  };
  const retry=()=>{if(!motion.running){setAttempt(null);setFeedback(null);setReviewRequirement("");setReviewExplanation("");setOpenStep(0);scroll.current?.scrollTo({top:0});}};
  const saveAndAdvance=(value:StrategyAttempt)=>{
    save(value);setFeedback(null);
    const next=COORDINATE_SCENARIOS.findIndex(t=>t.id!==value.taskId&&!props.attempts.some(a=>a.taskId===t.id&&a.completed));
    if(next>=0)setIndex(next);
  };
  const finish=()=>{if(attempt){const result=completeStrategyAttempt(task,attempt);if(result)saveAndAdvance(result);}};
  const confirmJudgment=()=>{
    if(!attempt||motion.running||props.hardwareConnected)return;
    const result=reviewStrategyJudgment(task,attempt,{requirement:reviewRequirement,explanation:reviewExplanation});
    if(!result)return;
    if(result.completed)saveAndAdvance(result);
    else {save(result);setFeedback("문제에서 같은 위치를 요구하는지, 같은 간격을 요구하는지 구간별로 다시 확인하세요.");}
  };
  const selectStep=(i:number)=>{setOpenStep(i);requestAnimationFrame(()=>stepButtons.current[i]?.focus());};
  const nextTask=()=>{
    const next=COORDINATE_SCENARIOS.findIndex(t=>!props.attempts.some(a=>a.taskId===t.id&&a.completed));
    if(next>=0)setIndex(next);
  };
return <div className="lesson-scroll coordinate-learning math-start-lesson" ref={scroll}>
  <TaskStartPoint taskKey={`strategy:${task.id}:${props.resetKey}`} start={task.from} coords={props.coords}
    disabled={motion.running} legacyConnected={props.hardwareConnected} onVirtualMove={p=>moveVirtualTaskStart(props,p)}/>
    <div className="axis-status">
      <strong>{index+1}/{COORDINATE_SCENARIOS.length} · {task.title}</strong>
      <span>난이도: 좌표 설계·DT 비교 · 현재 단계: {observed ? "비교·수정" : attempt ? "실행·측정" : "표현·예측"} · 완료 {completed}/{COORDINATE_SCENARIOS.length}</span>
    </div>
    <div className="math-cycle-rail" aria-label="피지컬 AI 학습 순환">
      <div className="math-cycle-current"><b>{observed ? "6/7" : attempt ? "4/7" : "3/7"}</b> {observed ? "비교·해석" : attempt ? "실행·측정" : "예측"}</div>
    </div>
    <LessonConceptHeader
      section="2-2"
      label="상황 적용"
      title="상황에 맞는 좌표 방식 선택"
      duration="수업 1회 20~30분"
      definition="지정 위치에는 절대좌표, 반복 변화에는 상대좌표를 선택하고 DT 결과로 판단합니다. 중요한 것은 방식 이름이 아니라 좌표가 뜻하는 기준입니다."
      columns={[]}
      showColumns={false}
    />
    <div className="math-stage-rail coordinate-stage-rail" aria-label="현재 학습 단계">
      <span aria-current={!attempt?"step":undefined}>1. 방식·명령 설계</span>
      <span aria-current={attempt&&!observed?"step":undefined}>2. DT 실행</span>
      <span aria-current={observed?"step":undefined}>3. 비교·수정</span>
    </div>
    <LearningAiFeedback ai={ai} result={observed}/>
    {props.hardwareConnected&&<p className="lesson-notice">실장비 연결 중에는 DT 실행을 사용할 수 없습니다.</p>}
    {!complete?<>
      <div className="lesson-card"><p>{task.situation}</p><p className="lesson-note">좌표·변화량은 로봇 기준 (X, Y, Z), mm입니다. 모든 구간은 MoveL, R=0°입니다.</p></div>
      {!observed?<>
        <p><strong>절대·상대 중 한 가지 정답 방식을 고르는 문제가 아닙니다.</strong> 목표를 만족하면 두 방식 모두 가능합니다. 구간마다 다르게 선택해도 됩니다.</p>
        {!independent&&<>
          <button className="coordinate-hint" disabled={locked} onClick={()=>{setHintOpen(!hintOpen);if(!hintOpen)setHints(n=>n+1);}}>{hintOpen?"힌트 접기":"방식 선택 힌트"}</button>
          {hintOpen&&<div className="axis-help"><CoordinateMeaning/><p>{task.requirement==="location"
            ?"같은 작업대를 지정할 때 절대 값은 유지할 수 있습니다. 상대 방식을 쓰면 각 출발점에서 작업대까지의 차이를 계산하세요."
            :"같은 간격을 반복할 때 상대 변화량은 유지할 수 있습니다. 절대 방식을 쓰면 각 구간의 누적 도착 위치를 계산하세요."}</p></div>}
        </>}
        <label>이 상황에서 지켜야 할 핵심 조건은?
          <select value={requirement} disabled={locked} onChange={e=>setRequirement(e.target.value)}><option value="">조건 선택</option>
            <option value="location">출발점이 달라도 같은 위치에 도착</option><option value="displacement">매번 같은 변화량으로 이동</option>
            <option value="mixed">지정 위치에 도착한 뒤 같은 변화량으로 반복 이동</option></select>
        </label>
        {independent&&<p className="lesson-note">구간별로 명령과 예상 도착점을 작성하세요. 작성한 구간은 다시 펼쳐 수정할 수 있습니다. 모든 구간의 예측을 제출한 뒤 DT를 실행합니다.</p>}
        {task.steps.map((step,i)=>{
          const command=commands[i]??blankStrategyCommands(task)[i];
          const prediction=predictions[i]??blankStrategyPredictions(task)[i];
          const filled=!!command.mode&&!!readCoordinateVector(command.argument)&&!!readCoordinateVector(prediction);
          const raw=(v:{x:string;y:string;z:string})=>`(${v.x||"?"}, ${v.y||"?"}, ${v.z||"?"})`;
          return <div className="lesson-card coordinate-step" key={`${task.id}-${i}`}>
          {independent?<button className="coordinate-step-heading" type="button" ref={el=>{stepButtons.current[i]=el;}}
            aria-expanded={openStep===i} aria-controls={`coordinate-step-${i}`} onClick={()=>setOpenStep(openStep===i?-1:i)}>
            <strong>{i+1}. {step.label}</strong><span>{filled?"입력 완료":"작성 중"} · {openStep===i?"접기":"펼치기"}</span>
          </button>:<strong>{i+1}. {step.label}</strong>}
          {independent&&openStep!==i&&<p className="coordinate-step-summary">내 명령: {command.mode?`${MODE_LABEL[command.mode]} ${raw(command.argument)}`:"방식 미선택"}<br/>내 예상 도착점: {raw(prediction)} mm</p>}
          {(!independent||openStep===i)&&<div className="coordinate-step-fields" id={`coordinate-step-${i}`}>
          <p className="lesson-note">{step.start?`이 경우의 출발점: ${coordinatePoint(step.start)}`:i===0?`출발점: ${coordinatePoint(task.from)}`
            :plan[i-1]?`앞 명령에 따른 출발점: ${coordinatePoint(plan[i-1].to)}`:"앞 구간의 도착점에서 이어집니다."}</p>
          <div className="lesson-toggle" role="group" aria-label={`${i+1}번 명령 표현 방식`}>{COORDINATE_MODES.map(mode=><button key={mode} disabled={locked} aria-pressed={command.mode===mode}
            onClick={()=>{setCommands(previous=>previous.map((c,j)=>i===j?changeStrategyMode(c,mode):c));setFeedback(null);}}>
            {MODE_LABEL[mode]} · {mode==="absolute"?"도착 위치":"변화량"}</button>)}</div>
          {command.mode&&<fieldset className="lesson-coordinates" disabled={locked}>
            <legend>{i+1}번 명령에 넣을 {command.mode==="absolute"?"원점 기준 도착 좌표":"실행 출발점에서의 변화량"} (mm)</legend>
            {POSE_AXES.map(axis=><label key={axis}>{command.mode==="relative"?"Δ":""}{axis.toUpperCase()}
              <input type="number" step="any" placeholder="?" value={command.argument[axis]} aria-label={`${i+1}번 ${command.mode==="relative"?"변화량":"위치"} ${axis.toUpperCase()}`}
                onChange={e=>{setCommands(previous=>previous.map((c,j)=>j===i?{...c,argument:{...c.argument,[axis]:e.target.value}}:c));setFeedback(null);}}/>
            </label>)}
          </fieldset>}
          {independent&&<fieldset className="lesson-coordinates" disabled={locked}>
            <legend>{i+1}번 명령 실행 뒤 내가 예상한 도착점 (mm)</legend>
            {POSE_AXES.map(axis=><label key={axis}>{axis.toUpperCase()}<input type="number" step="any" placeholder="?" value={prediction[axis]}
              aria-label={`${i+1}번 예상 도착 ${axis.toUpperCase()}`} onChange={e=>setPredictions(previous=>previous.map((p,j)=>j===i?{...p,[axis]:e.target.value}:p))}/></label>)}
          </fieldset>}
          {plan[i]&&<p className="lesson-note">내 명령이 가리키는 도착점: {coordinatePoint(plan[i].to)} · {attempt?.results[i]?"✓ DT 관찰 완료":"아직 실행하지 않음"}</p>}
          {independent&&!attempt&&i<task.steps.length-1&&<button type="button" disabled={!filled} onClick={()=>selectStep(i+1)}>입력 유지 · 다음 구간</button>}
          </div>}
        </div>;})}
        <p className="lesson-note">방식을 바꾸면 명령값을 다시 입력합니다. 같은 숫자라도 의미가 달라지기 때문입니다.</p>
        <label>왜 이 방식을 선택했나요? 어떤 값을 유지하고, 어떤 값을 다시 계산했는지 설명하세요.
          <textarea rows={3} maxLength={600} value={explanation} disabled={locked} onChange={e=>setExplanation(e.target.value)}/>
        </label>
        <p className="lesson-note">이유는 실행 전에 기록하며 교사가 검토합니다. 문장 작성 여부만으로 개념 이해를 판정하지 않습니다.</p>
        {independent&&!attempt&&<><p className="lesson-note">명령·예상 도착점·이유를 제출하기 전에는 계산된 도착점과 경로를 표시하지 않습니다.</p>
          <button className="lesson-primary" disabled={!ready||motion.running} onClick={submitPrediction}>명령·예측·이유 먼저 제출</button></>}
        <button className="lesson-primary" disabled={motion.running||props.hardwareConnected||(independent&&!attempt)||(!attempt&&!ready)} onClick={runNext}>
          {attempt?`${attempt.results.length+1}번 명령 실행`:`설계 제출 · 1번 명령 실행`}</button>
        {!attempt&&!ready&&<p className="lesson-note">모든 구간의 방식·명령값{independent?"·예상 도착점":""}, 상황 조건과 선택 이유를 작성하세요.</p>}
        {attempt&&<p className="lesson-note">첫 설계를 기록했습니다. {task.requirement==="location"?"다음 경우는 지정된 다른 출발점에 배치해 실행합니다.":"다음 명령은 앞 명령의 실제 DT 도착점에서 이어집니다."}</p>}
        {attempt&&!motion.running&&<button onClick={retry}>설계 수정하기</button>}
      </>:attempt&&analysis&&<>
        <div className="lesson-card"><strong>내 명령과 DT 도착 결과</strong>
          {analysis.rows.map((row,i)=><div className="coordinate-strategy-result" key={i}>
            <p><strong>{i+1}. {task.steps[i].label}</strong> · 실행 출발점 {coordinatePoint(row.from)}</p>
            <CoordinateCommandTable rows={[{mode:row.mode,argument:row.argument,from:row.from,to:attempt.results[i].to}]}/>
            <p data-match={row.correct}>{row.correct?"✓ 목표 일치":"↻ 목표와 차이"} · 목표 {coordinatePoint(row.goal)}</p>
            {independent&&<p data-match={row.predictionCorrect}>제출한 예상 도착점: {row.prediction?coordinatePoint(row.prediction):"미입력"} · {row.predictionCorrect?"✓ DT와 일치":"↻ DT 결과와 다름"}</p>}
            {!row.correct&&<p className="lesson-feedback">{row.feedback}</p>}
          </div>)}
          {!analysis.requirementsCorrect&&<p className="lesson-feedback">{task.requirement==="location"?"이 문제는 같은 작업대 위치에 도착하는 것이 조건입니다."
            :task.requirement==="displacement"?"이 문제는 같은 변화량을 연속해서 적용하는 것이 조건입니다.":"첫 구간은 지정 위치, 이후 구간은 일정한 변화량이 조건입니다."}</p>}
          <p>절대·상대 중 어떤 방식을 골랐는지가 아니라, 그 값이 뜻하는 위치·변화량으로 목표를 만족했는지 비교합니다.</p>
          <details><summary>두 방식으로 풀 때 달라지는 계산</summary><p>{task.requirement==="location"
            ?"절대: 같은 작업대 좌표를 유지합니다. 상대: 작업대 좌표에서 각 출발점 좌표를 뺍니다. 두 방식 모두 유효합니다."
            :task.requirement==="displacement"?"상대: 같은 변화량을 반복할 수 있습니다. 절대: 매번 달라지는 도착 좌표를 계산합니다. 두 방식 모두 유효합니다."
            :"고정 작업대에는 절대 위치, 반복 간격에는 상대 변화량을 쓰면 일부 계산을 줄일 수 있습니다. 전부 절대 또는 전부 상대여도 좌표를 올바르게 변환하면 같은 작업을 수행합니다."}</p></details>
          {!analysis.numericCorrect&&<details className="axis-help coordinate-solution" key={attempt.id} onToggle={e=>{
            if(e.currentTarget.open)save({...attempt,solutionViews:[...(attempt.solutionViews??[]),new Date().toISOString()]});
          }}><summary>풀이 확인 (선택)</summary><p>먼저 각 구간의 실제 출발점과 목표를 이용해 명령값을 수정해 보세요.</p>
            {analysis.rows.filter(row=>!row.correct).map(row=><p key={analysis.rows.indexOf(row)}>{analysis.rows.indexOf(row)+1}번 · 이 실행 출발점에서 목표까지 필요한 {row.mode==="relative"?"변화량":"도착 위치"}: {row.mode==="relative"?coordinateDelta(row.requiredArgument):coordinatePoint(row.requiredArgument)}</p>)}
          </details>}
        </div>
        {judgmentOnly?<div className="lesson-card coordinate-judgment"><strong>명령과 이동은 맞았습니다. 상황 조건을 확인하세요.</strong>
          <p>{task.situation}</p><p>완료한 DT 실행은 유지합니다. 아래 조건 판단을 고치면 다시 실행하지 않고 진행합니다.</p>
          <label>이 작업에서 같게 유지하거나 순서대로 만족해야 하는 것은?
            <select aria-label="상황 조건 판단 수정" value={reviewRequirement} onChange={e=>{setReviewRequirement(e.target.value);setFeedback(null);}}><option value="">다시 선택</option>
              <option value="location">출발점이 달라도 같은 위치에 도착</option><option value="displacement">매번 같은 변화량으로 이동</option>
              <option value="mixed">지정 위치에 도착한 뒤 같은 변화량으로 반복 이동</option></select></label>
          {independent&&<label>조건 판단을 어떻게 고쳤나요?<textarea aria-label="상황 판단 수정 근거" rows={2} maxLength={600} value={reviewExplanation} onChange={e=>setReviewExplanation(e.target.value)}/></label>}
          <button className="lesson-primary" disabled={props.hardwareConnected||!reviewRequirement||(independent&&!reviewExplanation.trim())} onClick={confirmJudgment}>판단 확인 · {index===COORDINATE_SCENARIOS.length-1?"설계 마치기":"다음 상황"}</button>
          <p className="lesson-note">처음 선택한 조건과 수정한 판단을 함께 기록합니다.</p>
        </div>:analysis.canComplete?<button className="lesson-primary" onClick={finish}>비교 확인 · {index===COORDINATE_SCENARIOS.length-1?"설계 마치기":"다음 상황"}</button>
          :<button className="lesson-primary" onClick={retry}>내 설계 수정하고 다시 검증</button>}
      </>}
    </>:<div className="lesson-card axis-complete"><strong>{completed===COORDINATE_SCENARIOS.length?"상황별 명령 설계 활동 완료":"이 상황의 명령 설계·검증 완료"}</strong>
      <p>선택한 표현 방식과 수치가 목표 조건을 만족했습니다. 선택 이유의 타당성은 기록을 바탕으로 교사가 확인합니다.</p>
      {completed<COORDINATE_SCENARIOS.length&&<button className="lesson-primary" onClick={nextTask}>다음 상황 →</button>}
    </div>}
    {feedback&&<p className="lesson-feedback" role="status">{feedback}</p>}
    {(!independent||attempt||complete)&&<AdaptiveSupport {...props} lesson="2-2" taskId={task.id} events={props.errorEvents} disabled={motion.running}/>}
    {independent&&supportIds.length>0&&<p className="lesson-note">보충 사용 이력이 있는 재도전입니다. 최초 응답과 구분해 기록합니다.</p>}
    <div className="lesson-actions">{motion.running&&<button onClick={()=>{motion.stop();setFeedback("중단한 구간은 완료로 기록하지 않습니다. 같은 명령을 다시 실행할 수 있습니다.");}}>DT 정지</button>}
      <button disabled={props.hardwareConnected} onClick={motion.reset}>↺ DT 원위치</button></div>
    {props.onApplication&&<button className="coordinate-application-entry" disabled={motion.running} onClick={props.onApplication}>직접 적용: 좌표 이동·물체 옮기기 →</button>}
    <button disabled={motion.running} onClick={props.onBack}>절대·상대 개념 비교로</button>
    <button className="lesson-next" disabled={motion.running} onClick={props.onNext}>다음: 좌표 명령으로 물체 옮기기 →</button>
  </div>;
}
