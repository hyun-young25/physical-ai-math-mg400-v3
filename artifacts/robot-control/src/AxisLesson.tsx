import { learningRecordContext } from "./learningFramework";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { POSE_AXES, parseLessonNumber, sampleLessonMotion } from "./curriculum";
import { useLessonMotion, type MotionProps } from "./LessonPages";
import { AXIS_LESSON_TASKS, axisLearningMode, type AxisAttempt, type AxisErrorKind, type AxisLessonVisual,
  type AxisRelationReview, type AxisTask, type AxisTaskRecord, type AxisView, type Axis } from "./axisLesson";
import { axisCondition, axisNumericEndpoint, blankAxisDelta, readAxisDelta, makeAxisNumericAttempt,
  completeAxisNumeric, canReviewAxisRelation, diagnoseAxisNumeric, axisDiagnosisMatches, axisComparisonStatus, axisConditionSummary, axisRelationContext, AXIS_ERROR_LABEL, AXIS_ERROR_FEEDBACK } from "./axisReasoning";
import { createAxisSceneProjection } from "./axisSceneProjection";
import { AdaptiveSupport } from "./AdaptiveSupport";
import { MeasuredCard } from "./PracticeControls";
import { LessonConceptHeader } from "./LessonConceptHeader";
import { LessonCoursePath } from "./LessonCoursePath";
import { axisErrorEvent, type SupportProps } from "./learningSupport";
import { LearningAiFeedback, useLearningAi } from "./LearningAiFeedback";
import { numericFeedbackContext } from "./learningAiContext";

const fmt=(n:number)=>Number(n.toFixed(2)).toString();
const VIEW_NAMES:Record<AxisView,string>={top:"탑뷰",side:"사이드뷰",front:"프론트뷰"};
const point=(p:{x:number;y:number;z:number})=>`(${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)})`;

function AxisRelationQuestion({task,attempt,value,onChange,disabled=false,error}: {
  task:AxisTask;attempt?:AxisAttempt;value:string;onChange:(value:string)=>void;disabled?:boolean;error?:string|null;
}) {
  const id=useId(),context=axisRelationContext(task,attempt);
  return <fieldset className="axis-relation-question" disabled={disabled} aria-describedby={`${id}-context${error?` ${id}-feedback`:""}`}>
    <legend>{context.question}</legend>
    <table className="axis-move-comparison" id={`${id}-context`}><caption>{context.caption}</caption>
      <tbody>{context.rows.map(row=><tr key={row.label}><th scope="row">{row.label}</th><td>{row.value}</td></tr>)}</tbody>
    </table>
    <div className="axis-relation-options">{axisCondition(task).options.map(option=><label key={option.value} data-selected={value===option.value}>
      <input type="radio" name={id} value={option.value} checked={value===option.value} onChange={()=>onChange(option.value)}/><span>{option.label}</span>
    </label>)}</div>
    {error&&<p className="lesson-feedback" id={`${id}-feedback`} role="alert">{error}</p>}
  </fieldset>;
}

import { TaskStartPoint, moveVirtualTaskStart } from "./TaskStartPoint";

export function AxisLesson(props:MotionProps & SupportProps & {
  view:"free"|AxisView;onViewChange:(view:AxisView)=>void;onVisualChange:(visual:AxisLessonVisual|null)=>void;
  records:AxisTaskRecord[];onRecord:(record:AxisTaskRecord)=>void;onNext:()=>void;
  attemptHistory:Record<string,AxisAttempt[]>;onAttempt:(taskId:string,attempt:AxisAttempt)=>void;
}) {
  const motion=useLessonMotion(props);
  const [taskIndex,setTaskIndex]=useState(()=>Math.max(0,AXIS_LESSON_TASKS.findIndex(t=>!props.records.some(r=>r.taskId===t.id))));
  const task=AXIS_LESSON_TASKS[taskIndex],condition=axisCondition(task),mode=axisLearningMode(task),independent=mode==="independent";
  const [phase,setPhase]=useState<"predict"|"observe"|"complete">("predict");
  const [epoch,setEpoch]=useState(0),[start,setStart]=useState(()=>({...props.coords}));
  const [draft,setDraft]=useState(blankAxisDelta),[relation,setRelation]=useState(""),[explanation,setExplanation]=useState("");
  const [commandAxis,setCommandAxis]=useState<Axis|"">(""),[commandSign,setCommandSign]=useState<""|"-1"|"1">("");
  const [commandDistance,setCommandDistance]=useState("");
  const [attempts,setAttempts]=useState<AxisAttempt[]>([]),[submitted,setSubmitted]=useState<AxisAttempt|null>(null);
  const [diagnosis,setDiagnosis]=useState<AxisErrorKind[]>([]),[revisionExplanation,setRevisionExplanation]=useState("");
  const [reviewRelation,setReviewRelation]=useState("");
  const [hintOpen,setHintOpen]=useState(false),[hints,setHints]=useState(0);
  const [introOpen,setIntroOpen]=useState(true);
  const [supportMode,setSupportMode]=useState<"guided"|"challenge">("guided");
  const [feedback,setFeedback]=useState<string|null>(null);
  const latest=useRef(props);latest.current=props;
  const panel=useRef<HTMLDivElement>(null);
  const history=attempts.filter(a=>a.numeric?.conditionId===condition.id),last=history.at(-1);
  const comparison=last?axisComparisonStatus(task,last):null;
  const relationOnly=!!last&&canReviewAxisRelation(task,last);
  const scenePoint=useMemo(()=>createAxisSceneProjection(props.model,props.joints.j3),[props.model.ik,props.joints.j3]);
  const issues=last?diagnoseAxisNumeric(task,last):[];
  const needsDiagnosis=!!last&&issues.length>0;
  const correcting=phase==="observe"&&needsDiagnosis&&!relationOnly;
  const delta=readAxisDelta(draft),predictedEnd=axisNumericEndpoint(start,delta);
  const distance=parseLessonNumber(commandDistance);
  const command=commandAxis&&commandSign&&distance!==null?{axis:commandAxis,sign:Number(commandSign) as -1|1,distance}:null;
  const supportIds=props.supportRecords.filter(r=>r.lesson==="2-1").map(r=>r.id);
  const completed=AXIS_LESSON_TASKS.filter(t=>props.records.some(r=>r.taskId===t.id)).length,allComplete=completed===AXIS_LESSON_TASKS.length;
  const hasRemaining=AXIS_LESSON_TASKS.some(t=>t.id!==task.id&&!props.records.some(r=>r.taskId===t.id));
  const independentRecord=props.records.find(r=>r.taskId===AXIS_LESSON_TASKS.at(-1)!.id);
  const errorEvents=AXIS_LESSON_TASKS.flatMap(t=>(props.attemptHistory[t.id]??[]).map((a,i)=>axisErrorEvent(t,a,i)));
  const challengeMode=independent||supportMode==="challenge";
  // An earlier execution's judgment is not a judgment of edited predictions.
  const aiDraftPending=!!last?.numeric&&(!delta||POSE_AXES.some(a=>delta[a]!==last.numeric!.delta[a])
    ||relation!==last.numeric.relation||!!(task.reverse&&last.command&&(
      commandAxis!==last.command.axis||Number(commandSign)!==last.command.sign||distance!==last.command.distance)));
  const ai=useLearningAi(numericFeedbackContext({
    task:`axis-${task.id}`,
    condition:{lesson:"2-1 좌표축과 이동 방향",id:task.id,task,condition,start,prompt:axisConditionSummary(task)},
    answers:{deltaX:draft.x,deltaY:draft.y,deltaZ:draft.z,relation,commandAxis,commandSign,commandDistance},
    reason:revisionExplanation||explanation,
    initial:props.attemptHistory[task.id]?.[0],
    history:props.attemptHistory[task.id]??[],
    execution:last?.numeric?.executedAt?{status:"completed",from:last.from,to:last.to,executedAt:last.numeric.executedAt}:{},
    judgment:last?.numeric?.executedAt?{
      status:aiDraftPending?"unconfirmed":issues.length?"incorrect":"correct",
      currentDraftPendingCheck:aiDraftPending,
      previousSubmission:{delta:last.numeric.delta,relation:last.numeric.relation,errors:issues,comparison},
    }:"기존 판정 전",
    challenge:challengeMode,
  }));
  const taskDrafts=useRef(new Map<string, {start:typeof start;draft:typeof draft;relation:string;explanation:string;
    commandAxis:typeof commandAxis;commandSign:typeof commandSign;commandDistance:string;phase:typeof phase;
    hints:number;supportMode:typeof supportMode;diagnosis:typeof diagnosis;revisionExplanation:string;reviewRelation:string}>());
  const lastReset=useRef({key:props.resetKey,hardware:props.hardwareConnected});
  const openTask=(index:number)=>{
    if(motion.running||index===taskIndex)return;
    taskDrafts.current.set(task.id,{start,draft,relation,explanation,commandAxis,commandSign,commandDistance,phase,
      hints,supportMode,diagnosis,revisionExplanation,reviewRelation});
    setTaskIndex(index);
  };
  const canSubmit=!!delta&&!!relation&&(!challengeMode||!!explanation.trim())&&(!task.reverse||!!command&&command.distance>0)&&(!needsDiagnosis||correcting);
  useLayoutEffect(()=>{
    const reset=lastReset.current.key!==props.resetKey||lastReset.current.hardware!==props.hardwareConnected;
    if(reset)taskDrafts.current.clear();
    lastReset.current={key:props.resetKey,hardware:props.hardwareConnected};
    const saved=taskDrafts.current.get(task.id);
    const previous=reset?undefined:latest.current.attemptHistory[task.id]?.at(-1);
    setStart(saved?.start??previous?.from??{...latest.current.coords});
    setDraft(saved?.draft??(previous?.numeric?{x:String(previous.numeric.delta.x),y:String(previous.numeric.delta.y),z:String(previous.numeric.delta.z)}:blankAxisDelta()));
    setRelation(saved?.relation??previous?.numeric?.relation??"");setExplanation(saved?.explanation??previous?.reasoning??"");
    setAttempts(latest.current.attemptHistory[task.id]??[]);setSubmitted(null);
    setDiagnosis(saved?.diagnosis??[]);setRevisionExplanation(saved?.revisionExplanation??"");setReviewRelation(saved?.reviewRelation??"");
    setCommandAxis(saved?.commandAxis??previous?.command?.axis??"");
    setCommandSign(saved?.commandSign??(previous?.command?String(previous.command.sign) as "-1"|"1":""));
    setCommandDistance(saved?.commandDistance??(previous?.command?.distance!==undefined?String(previous.command.distance):""));
    setHintOpen(false);setHints(saved?.hints??previous?.numeric?.hints??0);setSupportMode(saved?.supportMode??"guided");setFeedback(null);setEpoch(n=>n+1);
    setPhase(latest.current.records.some(r=>r.taskId===task.id)?"complete":saved?.phase??(previous?"observe":"predict"));
  },[props.resetKey,props.hardwareConnected,taskIndex]);
  useLayoutEffect(()=>{if(panel.current)panel.current.scrollTop=0;},[taskIndex,phase]);
  // The parent requests the initial study view on lesson entry. Task changes,
  // retries and Home preserve the learner's camera; presets are optional tools.
  useEffect(()=>{
    const saved=submitted??(phase==="observe"?last:null);
    const from=saved?.from??start;
    const numeric=saved?.numeric?.delta??delta;
    const end=axisNumericEndpoint(from,numeric??null);
    props.onVisualChange(phase==="complete"?null:{key:`${task.id}:${epoch}:${from.x}:${from.y}:${from.z}`,task:condition.goal,started:!!saved,numeric:true,
      independent,command:saved?.command??command,from,scenePoint,
      prediction:saved?.prediction??{x:null,y:null,z:null},
      predictedEnd:independent&&!saved?null:end,
      result:phase==="observe"&&!submitted&&last?{from:last.from,to:last.to}:null});
  },[task,epoch,phase,start,draft.x,draft.y,draft.z,last,submitted,independent,commandAxis,commandSign,commandDistance,scenePoint,props.onVisualChange]);
  useEffect(()=>()=>latest.current.onVisualChange(null),[]);

  const execute=()=>{
    if(props.hardwareConnected||motion.running||!canSubmit)return;
    if(correcting&&!axisDiagnosisMatches(issues,diagnosis)){
      setFeedback("비교 결과에서 수정할 원인을 모두 선택하세요. 입력값을 고친 뒤 같은 화면에서 다시 실행할 수 있습니다.");return;
    }
    if(correcting&&independent&&!revisionExplanation.trim()){setFeedback("무엇을 어떻게 바꿨는지 수정 근거를 적어 주세요.");return;}
    const revision=correcting&&last?.id?{of:last.id,kinds:[...diagnosis],explanation:revisionExplanation.trim()}:undefined;
    const trial=makeAxisNumericAttempt(task,start,{draft,relation,explanation:correcting&&challengeMode?revisionExplanation:explanation,command,view:props.view,hints,supportIds,revision});
    if(!trial)return;
    const frames=sampleLessonMotion(props.model,trial.from,trial.to,"MoveL",props.joints.j3);
    if(!frames){setFeedback("현재 출발점에서 선택한 이동을 계산할 수 없습니다. 명령을 확인하거나 DT 원위치로 돌아오세요.");return;}
    if(motion.hardware){
      // Real mode: confirmed canonical coordinate moves; the virtual attempt record is not created or relabeled.
      setFeedback(null);setIntroOpen(false);
      void motion.runHardware([{kind:"move",motion:"MoveJ",target:{...trial.from}},{kind:"move",motion:"MoveL",target:{x:trial.numeric!.delta.x,y:trial.numeric!.delta.y,z:trial.numeric!.delta.z,r:0},relative:true}],"2-1 같은 출발점과 변화량을 실제 로봇 좌표 이동으로 실측");
      return;
    }
    setSubmitted(trial);setFeedback(null);setIntroOpen(false);
    motion.play(frames,"MoveL",()=>{
      const observed={...trial,from:{...frames[0].pose},to:{...frames.at(-1)!.pose},numeric:{...trial.numeric!,executedAt:new Date().toISOString()}};
      const previous=latest.current.attemptHistory[task.id]??[];
      props.onAttempt(task.id,structuredClone(observed));setAttempts([...previous,observed]);
      const errors=diagnoseAxisNumeric(task,observed);
      void ai.request("result",{
        ...ai.context,
        answers:JSON.stringify({deltaX:observed.numeric.delta.x,deltaY:observed.numeric.delta.y,deltaZ:observed.numeric.delta.z,relation:observed.numeric.relation}),
        judgment:JSON.stringify({status:errors.length?"incorrect":"correct",errors}),
        execution:JSON.stringify({source:"virtual",measurement:false,results:{from:observed.from,to:observed.to}}),
      },"",observed.id);
      setDiagnosis([]);setRevisionExplanation("");setReviewRelation("");setSubmitted(null);setPhase("observe");
    });
  };
  const reopenResult=()=>{
    if(!last?.numeric)return;
    setStart({...last.from});setDraft({x:String(last.numeric.delta.x),y:String(last.numeric.delta.y),z:String(last.numeric.delta.z)});
    setRelation(last.numeric.relation);setExplanation(last.reasoning??"");
    if(last.command){setCommandAxis(last.command.axis);setCommandSign(String(last.command.sign) as "-1"|"1");setCommandDistance(String(last.command.distance??condition.goal.distance));}
    setSubmitted(null);setPhase("observe");setFeedback(null);
  };
  const advance=(justCompleted?:AxisTaskRecord)=>{
    const isComplete=(id:string)=>id===justCompleted?.taskId||props.records.some(r=>r.taskId===id);
    const next=AXIS_LESSON_TASKS.findIndex((t,i)=>i>taskIndex&&!isComplete(t.id));
    const remaining=next<0?AXIS_LESSON_TASKS.findIndex(t=>!isComplete(t.id)):next;
    if(remaining>=0)setTaskIndex(remaining);
  };
  const finish=(relationReview?:AxisRelationReview)=>{
    const record=completeAxisNumeric(task,attempts,relationReview);
    if(!record){setFeedback("조건·예측·실행 결과와 수정 기록을 함께 확인해야 완료할 수 있습니다.");return;}
    props.onRecord(record);setFeedback(null);setPhase("complete");
    advance(record);
  };
  const relationSubmission=useRef(0);
  const confirmRelation=()=>{
    if(!relationOnly||!last?.id||motion.running)return;
    if(reviewRelation!==condition.relation){
      void ai.request("submit",{...ai.context,answers:JSON.stringify({...JSON.parse(ai.context.answers),relation:reviewRelation}),
        judgment:JSON.stringify({status:"incorrect",errors:["relation"]})},"",`${last.id}:relation:${++relationSubmission.current}`);
      setFeedback(axisRelationContext(task,last).feedback);return;
    }
    if(independent&&!revisionExplanation.trim()){setFeedback("이동 설명을 어떻게 고쳤는지 근거를 적어 주세요.");return;}
    void ai.request("submit",{...ai.context,answers:JSON.stringify({...JSON.parse(ai.context.answers),relation:reviewRelation}),
      judgment:JSON.stringify({status:"correct",errors:[]})},"",`${last.id}:relation:${++relationSubmission.current}`,true);
    finish({of:last.id,submittedAt:new Date().toISOString(),relation:reviewRelation,explanation:revisionExplanation.trim()});
  };
  const revisionReason=<label>무엇을 어떻게 바꿀까요? {independent?"(필수)":"(선택)"}
    <textarea aria-label="수정 근거" rows={2} maxLength={600} disabled={motion.running} value={revisionExplanation} onChange={e=>setRevisionExplanation(e.target.value)}/></label>;
  const relationQuestion=<AxisRelationQuestion task={task} disabled={motion.running} value={relation} onChange={value=>{setRelation(value);setFeedback(null);}}/>;
  const predictionFields=<>
        {task.reverse&&<fieldset className="lesson-coordinates" disabled={motion.running}><legend>내 이동 명령</legend>
          <label>축<select value={commandAxis} onChange={e=>setCommandAxis(e.target.value as Axis|"")}><option value="">선택</option>{POSE_AXES.map(a=><option key={a} value={a}>{a.toUpperCase()}</option>)}</select></label>
          <label>방향<select value={commandSign} onChange={e=>setCommandSign(e.target.value as ""|"-1"|"1")}><option value="">선택</option><option value="1">+</option><option value="-1">−</option></select></label>
          <label>거리 (mm)<input aria-label="명령 이동 거리" type="number" min="0" step="any" placeholder="?" value={commandDistance} onChange={e=>setCommandDistance(e.target.value)}/></label>
        </fieldset>}
        <fieldset className="lesson-coordinates" disabled={motion.running}><legend>{task.reverse?"내 명령을 실행하면?":"새 조건대로 이동하면?"} 예상 변화량 (mm)</legend>
          {POSE_AXES.map(a=>{const value=parseLessonNumber(draft[a]);return <label key={a}>Δ{a.toUpperCase()} · 이동량<input aria-label={`예상 변화량 ${a.toUpperCase()}`} type="number" step="any" placeholder="?" value={draft[a]}
            onChange={e=>{setDraft(v=>({...v,[a]:e.target.value}));setFeedback(null);}}/>
            {!challengeMode&&!correcting&&<span className="axis-input-equation">출발 {fmt(start[a])} + ({value===null?"?":fmt(value)})<br/>= 예상 {value===null?"?":fmt(start[a]+value)} mm</span>}
            {correcting&&last?.numeric&&<span className="axis-input-comparison" data-match={Math.abs(last.numeric.delta[a]-(last.to[a]-last.from[a]))<0.01}>
              직전 제출 {fmt(last.numeric.delta[a])} → DT {fmt(last.to[a]-last.from[a])} mm
            </span>}
          </label>;})}
        </fieldset>
        {mode==="guided"&&!challengeMode&&!correcting&&<p className="lesson-note">증가는 +, 감소는 −로 입력하세요. 유지되는 좌표도 변화량을 입력합니다. 도착 위치 = 출발 위치 + 변화량입니다.</p>}
        {predictedEnd&&!challengeMode&&!correcting&&<p className="lesson-note">내 입력으로 만든 예상점 P {point(predictedEnd)} mm · 정답 표시가 아닙니다.</p>}
        {predictedEnd&&!challengeMode&&!scenePoint(predictedEnd)&&<p className="lesson-note">내 예상점은 DT 계산 범위를 벗어나 3D에 표시되지 않습니다. 입력값은 그대로 비교에 사용됩니다.</p>}
        {correcting&&comparison?.relation?<details className="axis-help"><summary>✓ 이동 설명 일치 · 필요하면 변경</summary>{relationQuestion}</details>:relationQuestion}
        {challengeMode&&!correcting&&<label>축·부호·거리를 그렇게 판단한 근거는?<textarea rows={2} maxLength={600} disabled={motion.running} value={explanation} onChange={e=>setExplanation(e.target.value)}/>
          <span className="lesson-note">풀이 힌트 없이 먼저 제출합니다. 서술 근거는 교사가 확인할 기록이며 자동 정답 처리하지 않습니다.</span></label>}
        {!challengeMode&&<><button type="button" disabled={motion.running} onClick={()=>{setHintOpen(v=>!v);if(!hintOpen)setHints(n=>n+1);}}>{hintOpen?"힌트 접기":"풀이 힌트 보기"}</button>
          {hintOpen&&<p className="lesson-formula">{condition.hint}</p>}</>}
  </>;
  return <div className="lesson-scroll axis-lesson math-start-lesson" ref={panel}>
    <LearningAiFeedback ai={ai}/>
    <div className="axis-status">
      <strong>2-1 · 축·방향·거리</strong>
      <span>{allComplete?"활동 완료":("현재 문항 "+(taskIndex+1)+"/7 · "+(phase==="predict"?"표현·예측":phase==="observe"?(issues.length?"비교·수정":"실행·측정"):"확인"))}</span>
    </div>
    <LessonCoursePath label="좌표축 수업 경로" current={taskIndex} disabled={motion.running}
      items={AXIS_LESSON_TASKS.map((item,index)=>({label:["X 거리","Y 거리","Z 거리","방향 반전","이동 축","명령 설계","새 조건"][index],
        detail:axisCondition(item).prompt,complete:props.records.some(record=>record.taskId===item.id)}))} onSelect={openTask}/>
    <TaskStartPoint taskKey={`axes:${task.id}:${props.resetKey}`} start={start} coords={props.coords}
      disabled={motion.running} legacyConnected={props.hardwareConnected} onVirtualMove={p=>moveVirtualTaskStart(props,p)}/>
    <div className="math-cycle-rail" aria-label="피지컬 AI 학습 순환">
      <div className="math-cycle-current">
        <b>{allComplete?"7/7":phase==="complete"?"6/7":phase==="observe"?(issues.length?"6/7":"4/7"):"3/7"}</b>
        {allComplete?"수정·재실행":phase==="complete"?"비교·해석":phase==="observe"?(issues.length?"비교·수정":"실행·측정"):"표현·예측"}
      </div>
    </div>
    <div className="math-support-bar" role="group" aria-label="지원 수준">
      <strong>지원 수준</strong>
      <button type="button" disabled={independent} className={!challengeMode?"is-selected":""} aria-pressed={!challengeMode}
        onClick={()=>{setSupportMode("guided");setFeedback(null);}}>기초 지원</button>
      <button type="button" className={challengeMode?"is-selected":""} aria-pressed={challengeMode}
        onClick={()=>{setSupportMode("challenge");setHintOpen(false);setFeedback(null);}}>도전 모드</button>
    </div>
    <div className="math-stage-rail coordinate-stage-rail" aria-label="현재 활동 단계">
      {["표현·예측","실행·측정","비교·수정"].map((label,i)=>
        <span key={label} aria-current={(phase==="predict"?0:phase==="observe"?(issues.length?2:1):2)===i?"step":undefined}>{i+1}. {label}</span>)}
    </div>
    <details className="lesson-context"><summary>좌표축·부호·이동량 개념 보기</summary><LessonConceptHeader
      section="2-1"
      label="개념 학습"
      title="좌표축·부호·이동량"
      duration="수업 1회 20~30분"
      definition="로봇 기준축에서 어느 좌표가 얼마나, 어느 방향으로 바뀌는지 예측하고 DT의 실제 변화량과 비교합니다."
      columns={[]}
      showColumns={false}
    /></details>
    <section className="coordinate-concept-bridge" aria-labelledby="axis-concept-bridge-title">
      <strong id="axis-concept-bridge-title">핵심 관계를 이번 이동에 연결하기</strong>
      <div className="coordinate-concept-bridge__points">
        <div><small>문항 출발점 A</small><b>{point(start)} mm</b></div>
        <span aria-hidden="true">→</span>
        <div><small>{task.reverse?"목표 조건":"이동 조건"}</small><b>{axisConditionSummary(task)}</b></div>
      </div>
      <div className="coordinate-concept-bridge__formula">도착점 = 출발점 + 변화량&nbsp;&nbsp;·&nbsp;&nbsp;Δp = (ΔX, ΔY, ΔZ)</div>
      <p>한 축과 평행한 이동이면 바뀌는 좌표와 유지되는 좌표를 구분합니다. 증가·감소는 화면 방향이 아니라 로봇 기준축의 부호로 판단합니다.</p>
    </section>
    {motion.hardware&&<div className="lesson-notice" role="status"><b>실제 로봇 모드</b>: 실행하면 확인 창 후 출발점 MoveJ, 변화량만큼 MoveL을 실제로 보냅니다. 아래에는 측정값만 표시되며 가상 DT 도착점과 구분됩니다.
      {motion.hwError&&<p role="alert">{motion.hwError}</p>}
      <MeasuredCard title="2-1 실측 TCP (1: 출발점, 2: 변화량 이동 후)" measurements={motion.measured}/>
      {motion.measured.length>=2&&<p>실측 변화량 ΔX {(motion.measured[1].pose.x-motion.measured[0].pose.x).toFixed(2)} · ΔY {(motion.measured[1].pose.y-motion.measured[0].pose.y).toFixed(2)} · ΔZ {(motion.measured[1].pose.z-motion.measured[0].pose.z).toFixed(2)} mm (내 예상: {draft.x||"?"}, {draft.y||"?"}, {draft.z||"?"})</p>}</div>}
    {props.hardwareConnected&&<p className="lesson-notice">실장비 연결 중에는 DT 실행을 사용할 수 없습니다. 연결을 해제한 뒤 진행하세요.</p>}
    {phase!=="complete"&&<div className="axis-condition-context" aria-label="현재 문제 조건">
      <strong>{task.reverse?"목표 조건":"바뀐 조건"}: {axisConditionSummary(task)}</strong>
      {!task.reverse&&<span>기준 이동: {condition.reference.axis.toUpperCase()}{condition.reference.sign>0?"+":"−"} · {condition.reference.distance} mm</span>}
    </div>}
    {phase==="predict"&&<>
      <div className="lesson-card"><strong>{condition.prompt}</strong><p>출발점 A {point(start)} mm</p>
        {mode==="guided"&&!challengeMode&&<details className="axis-help axis-first-guide" open={introOpen} onToggle={e=>setIntroOpen(e.currentTarget.open)}>
          <summary>처음에는 축 → 방향 → 거리 순서로 생각하세요</summary>
          <ol><li><b>축:</b> X·Y·Z 중 어떤 좌표를 바꾸나요?</li><li><b>방향:</b> 증가하면 +, 감소하면 −입니다.</li><li><b>거리:</b> 기준 이동에서 거리만 어떻게 바뀌었나요? 움직이지 않는 축의 변화량은 0입니다.</li></ol>
          <p>아래에는 도착 좌표가 아니라 변화량을 입력합니다.</p>
        </details>}
        {predictionFields}
      </div>
      {needsDiagnosis&&<div className="lesson-feedback"><p>{relationOnly?"지난 실행의 수치 예측과 이동은 맞았습니다. 결과 화면에서 두 이동을 비교하고 이동 설명을 다시 선택하세요.":"지난 오답 기록이 있습니다. 원인을 확인한 뒤 수정·재실행하세요."}</p><button onClick={reopenResult}>지난 제출과 DT 결과 비교</button></div>}
      <button className="lesson-primary" disabled={motion.running||props.hardwareConnected||!canSubmit} onClick={execute}>{motion.running?(motion.hardware?"실제 이동 측정 중…":"DT 이동 관찰 중…"):motion.hardware?"예측 비교 · 확인 후 실제 실행":"예측 저장 · DT 실행"}</button>
      <p className="lesson-note">세 변화량을 입력하고 이동 설명을 선택하세요. 재실행은 같은 출발점에서 시작합니다.</p>
    </>}
    {phase==="observe"&&last?.numeric&&<>
      <div className="lesson-card axis-result-card"><strong>내 예상점 P와 DT 도착점 D 비교</strong>
        {comparison&&<div className="axis-result-status" role="status" aria-label="비교 결과 요약">
          <span data-match={comparison.prediction}>{comparison.prediction?"✓ 수치 예측 일치":"수치 예측 재검토"}</span>
          <span data-match={comparison.target}>{comparison.target?"✓ 목표 조건 충족":"이동 명령 재검토"}</span>
          <span data-match={comparison.relation}>{comparison.relation?"✓ 이동 설명 일치":"이동 설명 재검토"}</span>
        </div>}
      {issues.length===0?<><p className="lesson-feedback">✓ 수치 예측과 이동 설명이 조건 및 DT 결과와 일치합니다. 수정 없이 다음으로 진행할 수 있습니다.</p><button className="lesson-primary" onClick={()=>finish()}>{hasRemaining?"확인 · 다음 문항":"확인 · 활동 마치기"}</button></>
        :relationOnly?<div className="lesson-revision-fields"><strong>{task.reverse?"목표에 맞는 이동 방법을 확인해 보세요":"기존 이동과 이번 이동을 다시 비교해 보세요"}</strong>
          <p>수치 예측과 이동은 맞았습니다. 아래 질문의 답을 확인하면 재실행 없이 다음으로 진행합니다.</p>
          <AxisRelationQuestion task={task} attempt={last} value={reviewRelation} error={feedback} onChange={value=>{setReviewRelation(value);setFeedback(null);}}/>
          {independent&&<label>이동 설명을 어떻게 고쳤나요? (필수)<textarea aria-label="이동 설명 수정 근거" rows={2} maxLength={600} value={revisionExplanation} onChange={e=>{setRevisionExplanation(e.target.value);setFeedback(null);}}/>
            <span className="lesson-note">서술 근거는 교사 확인용으로 기록합니다.</span></label>}
          <button className="lesson-primary" disabled={!reviewRelation||(independent&&!revisionExplanation.trim())} onClick={confirmRelation}>{hasRemaining?"설명 확인 · 다음 문항":"설명 확인 · 활동 마치기"}</button>
          <p className="lesson-note">처음 제출한 답과 수정한 설명을 구분해 기록합니다.</p>
        </div>
        :<div className="lesson-revision-fields axis-inline-revision"><strong>틀린 항목을 여기서 바로 수정하세요.</strong>
          <p>수정할 원인을 모두 고르고, 아래 입력을 고친 뒤 같은 출발점에서 다시 실행하세요.</p>
          <div className="lesson-toggle">{(Object.keys(AXIS_ERROR_LABEL) as AxisErrorKind[]).map(k=><button type="button" key={k} disabled={motion.running} aria-pressed={diagnosis.includes(k)} onClick={()=>setDiagnosis(v=>v.includes(k)?v.filter(x=>x!==k):[...v,k])}>{AXIS_ERROR_LABEL[k]}</button>)}</div>
          <ul className="axis-revision-causes">{issues.map(k=><li key={k}><b>{AXIS_ERROR_LABEL[k]}</b> · {AXIS_ERROR_FEEDBACK[k]}</li>)}</ul>
          {predictionFields}
          {independent?revisionReason:<details className="axis-help"><summary>수정 근거 남기기 (선택)</summary>{revisionReason}</details>}
          {feedback&&<p className="lesson-feedback" role="status">{feedback}</p>}
          <button className="lesson-primary" disabled={motion.running||props.hardwareConnected||!canSubmit} onClick={execute}>{motion.running?(motion.hardware?"실제 이동 측정 중…":"DT 이동 관찰 중…"):motion.hardware?"예측 비교 · 확인 후 실제 실행":"수정한 판단 저장 · 다시 실행"}</button>
        </div>}
        <details className="axis-help axis-result-details" key={last.id}><summary>출발·예상·결과 전체 비교</summary>
        <p>출발 A {point(last.from)} → 내 예상 P {point(axisNumericEndpoint(last.from,last.numeric.delta)!)} / DT 결과 D {point(last.to)}</p>
        {last.command&&<p>실행 명령: {last.command.axis.toUpperCase()}{last.command.sign>0?"+":"−"} · {last.command.distance} mm</p>}
        <table className="axis-comparison"><thead><tr><th>축</th><th>내 예상 Δ</th><th>DT 변화량</th><th>차이 P−D</th></tr></thead><tbody>{POSE_AXES.map(a=>{
          const actual=last.to[a]-last.from[a],error=last.numeric!.delta[a]-actual;
          return <tr key={a} data-match={Math.abs(error)<0.01}><th>{a.toUpperCase()}</th><td>{fmt(last.numeric!.delta[a])}</td><td>{fmt(actual)}</td><td>{fmt(error)} mm</td></tr>;
        })}</tbody></table>
        <p>실행 전 선택한 이동 설명: {condition.options.find(o=>o.value===last.numeric!.relation)?.label}</p>
        <p className="lesson-note">DT 계산 결과입니다. 실장비 측정값이 아닙니다. 내 예상과 DT가 같아도, 직접 고른 명령이 목표 조건을 만족하는지 함께 확인합니다.</p>
        </details>
      </div>
    </>}
    {phase==="complete"&&<div className="lesson-card axis-complete" role="status"><strong>{allComplete?"2-1 활동 완료":"이 문항 완료"}</strong>
      <p>완료 {completed}/7 · 조건 변화와 DT 결과를 비교한 기록을 남겼습니다.</p>
      <p>새 조건에서 첫 제출부터 일치 {props.records.filter(r=>r.numericVersion===1&&r.independentResult==="first-match").length}문항 · 수정 후 일치 {props.records.filter(r=>r.numericVersion===1&&r.independentResult==="revised").length}문항</p>
      {(independent||allComplete)&&independentRecord&&<details className="axis-help"><summary>독립 적용 근거 기록 보기</summary>
        <p>첫 실행 전 근거: {independentRecord.attempts[0]?.reasoning}</p>
        {independentRecord.attempts.filter(a=>a.numeric?.revision).map((a,i)=><p key={a.id??i}>수정 {i+1}: {a.numeric!.revision!.explanation}</p>)}
        {independentRecord.relationReview&&<p>재실행 없이 관계 설명 수정: {independentRecord.relationReview.explanation}</p>}
        <p>서술 근거의 타당성은 자동 채점하지 않습니다. 교사 확인이 필요합니다.</p>
      </details>}
      {!allComplete&&<button className="lesson-primary" onClick={()=>advance()}>{taskIndex===5?"혼자 새 조건 적용하기 →":"다음 조건 문제 →"}</button>}
    </div>}
    {feedback&&!correcting&&!(relationOnly&&phase==="observe")&&<p className="lesson-feedback" role="status">{feedback}</p>}
    {(!challengeMode||phase!=="predict")&&<AdaptiveSupport {...props} lesson="2-1" taskId={task.id} events={errorEvents} disabled={motion.running}/>}
    {independent&&supportIds.length>0&&<p className="lesson-note">앞선 선택 보충 사용 이력도 이번 제출에 함께 기록합니다.</p>}
    <details className="axis-help"><summary>관찰 도구 · 시점과 표시 읽기</summary><p>A는 출발점, 보라 P는 내 예상점, 초록 D는 실행 후 도착점입니다. 예상과 결과가 같으면 P = D로 함께 표시합니다. 이동 중에는 현재 TCP와 이동 방향을, 실행 후에는 출발·예상·결과를 표시합니다.</p>
      <p>문항이 바뀌어도 현재 시점을 유지합니다. 보는 방향이 달라도 로봇 기준축은 같습니다. 자유 회전과 시점 버튼은 필요할 때 사용하며 완료 조건에 포함되지 않습니다. 사선 시점으로 돌아가려면 화면의 ‘학습 시점’ 버튼을 누르세요.</p>
      <div className="lesson-toggle">{(["top","side","front"] as AxisView[]).map(v=><button key={v} type="button" onClick={()=>props.onViewChange(v)} aria-pressed={props.view===v}>{VIEW_NAMES[v]}</button>)}</div>
    </details>
    <details className="axis-help"><summary>제출·수정·보충 기록</summary><button onClick={()=>{
      const url=URL.createObjectURL(new Blob([JSON.stringify({...learningRecordContext("dt"),lesson:"2-1",version:1,attempts:props.attemptHistory,completed:props.records,support:props.supportRecords.filter(r=>r.lesson==="2-1")},null,2)],{type:"application/json"}));
      const a=document.createElement("a");a.href=url;a.download="axis-learning-records.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }}>학습 기록 내려받기</button></details>
    <div className="lesson-actions">{motion.running&&<button onClick={()=>{motion.stop();setSubmitted(null);setFeedback("실행을 중지했습니다. 완료된 실행만 비교 기록에 남습니다. 같은 출발점에서 다시 실행할 수 있습니다.");}}>DT 정지</button>}
      <button disabled={props.hardwareConnected} onClick={motion.reset}>↺ DT 원위치</button></div>
    <button className="lesson-next" disabled={motion.running} onClick={props.onNext}>다음: 절대좌표·상대좌표와 변화량 →</button>
    <p className="lesson-note">제출·수정·보충 기록은 이 브라우저에 저장됩니다. 수업 기록은 내려받아 보관할 수 있습니다.</p>
  </div>;
}
