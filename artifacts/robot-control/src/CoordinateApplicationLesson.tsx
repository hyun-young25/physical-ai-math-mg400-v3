import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LearningAiFeedback, useLearningAi } from "./LearningAiFeedback";
import { numericFeedbackContext } from "./learningAiContext";
import { LessonConceptHeader } from "./LessonConceptHeader";import { POSE_AXES, poseDifference, sampleLessonMotion } from "./curriculum";
import { useLessonMotion, type MotionProps } from "./LessonPages";
import { COORDINATE_MODES, MODE_LABEL, readCoordinateVector, type CoordinateMode, type CoordinateVisual } from "./coordinateLearning";
import { coordinatePoint, coordinateDelta } from "./CoordinateCommandTable";
import {
  APPLICATION_START, APPLICATION_PICK, APPLICATION_PLACE, APPLICATION_STEPS,
  applicationId, applicationMatches, applicationTarget, applicationPathError, applicationRepresentation,
  type ApplicationTask, type ApplicationRecord, type ApplicationEntry,
} from "./coordinateApplication";

const blank=()=>({x:"",y:"",z:""});
import { TaskStartPoint, moveVirtualTaskStart } from "./TaskStartPoint";

export function CoordinateApplicationLesson(props:MotionProps & {
  records:ApplicationRecord[]; onRecord:(record:ApplicationRecord)=>void;
  onVisualChange:(visual:CoordinateVisual|null)=>void; onBack:()=>void; onNext:()=>void; onExport:()=>void;
  assignment?:{pairId:string;mode:CoordinateMode}; onFree?:()=>void;
}) {
  const motion=useLessonMotion(props);
  const [task,setTask]=useState<ApplicationTask>(props.assignment?"transfer":"position");
  const [step,setStep]=useState(0),[record,setRecord]=useState<ApplicationRecord|null>(null);
  const [selectedMode,setMode]=useState<CoordinateMode>("absolute"),[raw,setRaw]=useState(blank);
  const mode=props.assignment?.mode??selectedMode;
  const [attached,setAttached]=useState(false),[placed,setPlaced]=useState(false);
  const [goalRaw,setGoalRaw]=useState({x:"300",y:"-50",z:"30"});
  const [feedback,setFeedback]=useState("");
  const [reason,setReason]=useState("");
  const goal=record?.goal??readCoordinateVector(goalRaw);
  const current=task==="position"&&step===0&&goal?{...APPLICATION_STEPS.position[0],target:goal}:APPLICATION_STEPS[task][step];
  const locked=motion.running||props.hardwareConnected;
  const latest=useRef(props);latest.current=props;
  const active=useRef<ApplicationRecord|null>(null);
  const aiContext=(next=record)=>numericFeedbackContext({
    task:`coordinate-application-${task}`,condition:{task,mode,goal:goalRaw,current,step},
    answers:{mode,values:raw},reason,initial:props.records.find(r=>r.task===task),
    history:props.records.filter(r=>r.task===task),execution:next?.entries??[],
    judgment:{status:next?.entries.at(-1)?.status??"기존 실행 전",message:next?.entries.at(-1)?.message},
  });
  const ai=useLearningAi(aiContext());
  const save=(value:ApplicationRecord)=>{
    active.current=value;setRecord(value);latest.current.onRecord(structuredClone(value));
    const entry=value.entries.at(-1);
    if(entry?.action==="move"&&(entry.status==="reached"||entry.status==="missed")){
      void ai.request("result",{
        ...aiContext(value),answers:JSON.stringify({mode:entry.mode,values:entry.argument}),
        judgment:JSON.stringify({status:entry.status==="reached"?"correct":"incorrect",errors:entry.status==="missed"?["좌표·변화량"]:[]}),
      },"",entry.id);
    }
  };
  const interrupt=()=>{
    const value=active.current;
    if(value?.entries.some(e=>e.status==="running")){
      const stopped={...value,entries:value.entries.map(e=>e.status==="running"?{...e,status:"stopped" as const}:e)};
      active.current=stopped;latest.current.onRecord(structuredClone(stopped));return stopped;
    }
    return value;
  };
  useLayoutEffect(()=>{
    interrupt();active.current=null;setRecord(null);setStep(0);setAttached(false);setPlaced(false);setRaw(blank());setFeedback("");
  },[task,props.resetKey,props.hardwareConnected]);
  useEffect(()=>()=>{interrupt();latest.current.onVisualChange(null);},[]);
  useEffect(()=>{
    const trails=record?.entries.filter(e=>e.action==="move"&&e.to&&(e.status==="reached"||e.status==="missed"))??[];
    props.onVisualChange({key:`application:${record?.id??task}`,from:record?.from??{...APPLICATION_START,r:props.coords.r},fromLabel:"A",
      points:current?[{id:"goal",label:task==="transfer"?current.label:"목표 위치",pose:{...current.target,r:props.coords.r},color:"#0369a1",kind:"given"}]:[],
      results:{},showPaths:false,
      trails:trails.slice(-1).map(e=>({id:e.id,label:"직전 DT 도착",from:e.from,to:e.to!,color:e.mode==="absolute"?"#0284c7":"#0f766e"})),
      workpiece:task==="transfer"?{top:placed?APPLICATION_PLACE:APPLICATION_PICK,attached,pick:APPLICATION_PICK,place:APPLICATION_PLACE}:undefined,
    });
  },[task,record,step,attached,placed,goalRaw,props.onVisualChange]);
  const prepare=()=>{
    if(locked||(task==="position"&&!goal))return;
    const from={...APPLICATION_START,r:props.coords.r};
    if(!props.model.ik(from.x,from.y,from.z,from.r,props.joints.j3)){setFeedback("현재 자세에서 시작 위치를 계산할 수 없습니다.");return;}
    props.onMoveTo(from.x,from.y,from.z,from.r);props.onMoveEnd();
    save({id:applicationId(),task,source:"dt",startedAt:new Date().toISOString(),from,entries:[],completed:false,
      ...(props.assignment?{pairId:props.assignment.pairId,requiredMode:props.assignment.mode}:{}),...(task==="position"&&goal?{goal:{...goal}}:{})});
    setStep(0);setAttached(false);setPlaced(false);setRaw(blank());setFeedback("시작 위치에 배치했습니다. 목표를 보고 명령값을 입력하세요.");
  };
  const execute=()=>{
    if(locked||!record||!current||current.action!=="move")return;
    const from={...props.coords},to=applicationTarget(from,mode,raw),argument=readCoordinateVector(raw);
    if(!to||!argument)return;
    const entry:ApplicationEntry={id:applicationId(),step,submittedAt:new Date().toISOString(),action:"move",from,target:{...current.target},mode,argument,to,status:"running"};
    const error=applicationPathError(task,from,to,attached);
    const frames=error?null:sampleLessonMotion(props.model,from,to,"MoveL",props.joints.j3);
    if(!frames){const message=error??"입력 위치 또는 중간 경로를 이 DT 모델에서 계산할 수 없습니다. 명령값을 확인하세요.";
      save({...record,entries:[...record.entries,{...entry,status:"rejected",message}]});setFeedback(message);return;}
    const submitted={...record,entries:[...record.entries,entry]};save(submitted);setFeedback("");
    motion.play(frames,"MoveL",()=>{
      const observed=props.model.fk(frames.at(-1)!.joints);
      const reached=applicationMatches(observed,current.target),next=step+1;
      save({...submitted,entries:submitted.entries.map(e=>e.id===entry.id?{...e,to:observed,status:reached?"reached":"missed"}:e),completed:reached&&next===APPLICATION_STEPS[task].length});
      if(reached){setStep(next);setRaw(blank());}
      setFeedback(reached?"목표에 도착했습니다.":"목표와 다른 곳에 도착했습니다. 현재 TCP를 출발점으로 명령값을 수정하세요.");
    });
  };
  const grip=()=>{
    if(locked||!record||!current||current.action==="move"||!applicationMatches(props.coords,current.target))return;
    if((current.action==="grip"&&attached)||(current.action==="release"&&!attached))return;
    const next=step+1;
    save({...record,entries:[...record.entries,{id:applicationId(),step,submittedAt:new Date().toISOString(),action:current.action,
      from:{...props.coords},target:{...current.target},status:"reached"}],completed:next===APPLICATION_STEPS[task].length});
    setAttached(current.action==="grip");if(current.action==="release")setPlaced(true);setStep(next);setFeedback(current.action==="grip"?"가상 물체를 흡착했습니다. 다음 명령으로 들어 올리세요.":"놓을 위치에서 흡착을 해제했습니다.");
  };
  const last=record?.entries.filter(e=>e.action==="move"&&(e.status==="reached"||e.status==="missed")).at(-1);
  const applicationStage=!record ? "prepare" : record.completed ? "compare" : "execute";
  return <div className="lesson-scroll coordinate-learning coordinate-application math-start-lesson">
    <TaskStartPoint taskKey={`application:${task}:${props.assignment?.pairId ?? "free"}:${props.resetKey}`} start={APPLICATION_START} coords={props.coords}
      disabled={motion.running} legacyConnected={props.hardwareConnected} onVirtualMove={p=>moveVirtualTaskStart(props,p)}/>
    <div className="axis-status">
      <strong>{props.assignment ? `물체 실습 · ${mode==="absolute"?"절대좌표":"상대좌표"}` : "직접 적용 · 좌표 명령으로 작업하기"}</strong>
      <span>현재 단계: {applicationStage==="prepare" ? "준비·예측" : applicationStage==="execute" ? "DT 실행·측정" : "비교·수정"}</span>
    </div>
    <div className="lesson-card">
      <label>명령값을 정한 이유<textarea aria-label="좌표 명령의 이유" rows={2} maxLength={1500}
        disabled={locked} value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <p className="lesson-note">가상 DT 전용 · 실장비 실행 미지원. 입력한 수치와 출발·도착 위치를 비교합니다.</p>
      <LearningAiFeedback ai={ai} result={!!last}/>
    </div>
    <div className="math-cycle-rail" aria-label="피지컬 AI 학습 순환">
      <div className="math-cycle-current">
        <b>{applicationStage==="prepare" ? "3/7" : applicationStage==="execute" ? "4/7" : "6/7"}</b>
        {applicationStage==="prepare" ? "예측" : applicationStage==="execute" ? "실행·측정" : "비교·해석"}
      </div>
    </div>
    <div className="math-stage-rail coordinate-stage-rail" aria-label="물체 이동 실습 단계">
      <span aria-current={applicationStage==="prepare" ? "step" : undefined}>1. 준비·입력</span>
      <span aria-current={applicationStage==="execute" ? "step" : undefined}>2. DT 실행</span>
      <span aria-current={applicationStage==="compare" ? "step" : undefined}>3. 비교·수정</span>
    </div>
    <LessonConceptHeader
      section="2-2"
      label="물체 이동 실습"
      title={props.assignment ? "절대좌표와 상대좌표로 물체 옮기기" : "좌표 명령으로 TCP 이동하기"}
      duration="수업 1회 20~30분"
      definition="절대좌표는 목표 위치를 직접 입력하고, 상대좌표는 현재 TCP에서 목표까지의 변화량을 입력합니다. 입력한 명령을 DT에서 실행해 도착점을 확인합니다."
      columns={[]}
      showColumns={false}
    />
    <div className="coordinate-application-brief">
      <strong>{props.assignment ? "같은 작업을 한 가지 좌표 방식으로 실행하기" : "현재 TCP와 목표를 읽고 명령을 실행하기"}</strong>
      <p>{props.assignment ? mode==="absolute" ? "이번 차례에는 원점 기준 도착 위치를 입력합니다." : "이번 차례에는 현재 TCP에서의 변화량을 입력합니다." : "이 화면은 개념 확인 뒤 실제 좌표 입력과 DT 동작을 연결하는 적용 단계입니다."}</p>
    </div>
    {props.hardwareConnected&&<p className="lesson-notice">실장비 연결 중에는 DT 실습을 사용할 수 없습니다.</p>}
    {task==="transfer"&&<p>물체 윗면 {coordinatePoint(APPLICATION_PICK)} → 놓을 위치 {coordinatePoint(APPLICATION_PLACE)}. 물체를 40 mm 올려 옮긴 뒤 내려놓습니다.</p>}
    {!record?<div className="lesson-card"><strong>시작 위치 {coordinatePoint(APPLICATION_START)}</strong><p>시작 위치에 배치한 뒤 직접 명령을 입력합니다. R은 현재 각도를 유지합니다.</p>
      {task==="position"&&<fieldset className="lesson-coordinates" disabled={locked}><legend>내가 이동할 목표 좌표 (mm)</legend>
        {POSE_AXES.map(axis=><label key={axis}>{axis.toUpperCase()}<input aria-label={`작업 목표 ${axis.toUpperCase()}`} type="number" step="any" value={goalRaw[axis]}
          onChange={e=>setGoalRaw({...goalRaw,[axis]:e.target.value})}/></label>)}</fieldset>}
      <button className="lesson-primary" disabled={locked||(task==="position"&&!goal)} onClick={prepare}>시작 위치에 배치</button></div>
    :record.completed?<div className="lesson-card axis-complete" role="status"><strong>{task==="transfer"?"물체 옮기기 완료":"좌표 이동 완료"}</strong>
      <p>{applicationRepresentation(record)} 명령으로 {task==="transfer"?"물체를 놓고 흡착기를 올렸습니다.":"목표 좌표에 도착했습니다."}</p>
      {props.assignment?<button className="lesson-primary" disabled={locked} onClick={props.onNext}>{mode==="absolute"?"같은 작업을 상대좌표로 풀기 →":"두 방식의 입력·결과 비교 →"}</button>
        :<button className="lesson-primary" disabled={locked} onClick={prepare}>같은 시작점에서 다시 설계</button>}</div>
    :current&&<div className="lesson-card">
      <strong>{step+1}/{APPLICATION_STEPS[task].length} · {current.label}</strong>
      <p>현재 TCP {coordinatePoint(props.coords)} → 목표 {coordinatePoint(current.target)} mm</p>
      {current.action==="move"?<>
        {props.assignment?<strong className="transfer-mode">{mode==="absolute"?"절대좌표 이동 · 도착 위치 입력":"상대좌표 이동 · 변화량 입력"}</strong>:<div className="lesson-toggle" role="group" aria-label="직접 적용 좌표 방식">{COORDINATE_MODES.map(m=><button key={m} disabled={locked} aria-pressed={mode===m}
          onClick={()=>{if(m!==mode){setMode(m);setRaw(blank());setFeedback("");}}}>{MODE_LABEL[m]}</button>)}</div>}
        <fieldset className="lesson-coordinates" disabled={locked}><legend>{mode==="absolute"?"원점 기준 도착 위치":"현재 TCP에서의 변화량"} (mm)</legend>
          {POSE_AXES.map(axis=><label key={axis}>{mode==="relative"?"Δ":""}{axis.toUpperCase()}<input type="number" step="any" placeholder="?" value={raw[axis]} aria-label={`작업 명령 ${axis.toUpperCase()}`}
            onChange={e=>setRaw({...raw,[axis]:e.target.value})}/></label>)}
        </fieldset>
        <p className="lesson-note">{props.assignment?mode==="absolute"?"입력값은 원점 기준 위치입니다. 현재 TCP 값과 구분하세요.":"변화가 없는 축도 0을 입력하세요. 직전 목표가 아닌 현재 TCP에서 변화량을 구합니다.":"방식을 바꾸면 값을 다시 입력합니다. 상대 명령은 매번 실제 실행 출발점을 기준으로 계산합니다."}</p>
        <button className="lesson-primary" disabled={locked||!readCoordinateVector(raw)} onClick={execute}>입력한 명령 실행</button>
      </>:<><p>{current.action==="grip"?"TCP가 물체 윗면에 도착했습니다. 가상 흡착을 켜세요.":"물체가 작업면에 도착했습니다. 가상 흡착을 해제하세요."}</p>
        <button className="lesson-primary" disabled={locked||!applicationMatches(props.coords,current.target)} onClick={grip}>{current.action==="grip"?"가상 흡착":"가상 흡착 해제"}</button></>}
    </div>}
    {feedback&&<p className="lesson-feedback" role="status">{feedback}</p>}
    {last?.to&&<div className="axis-help"><strong>직전 명령과 결과</strong><p>{MODE_LABEL[last.mode!]} {last.mode==="relative"?coordinateDelta(last.argument!):coordinatePoint(last.argument!)} → DT {coordinatePoint(last.to)}</p>
      <p>{coordinatePoint(last.from)} + {coordinateDelta(poseDifference(last.from,last.to))} = {coordinatePoint(last.to)}</p>
      <p>{last.status==="reached"?"✓ 목표 일치":"목표까지 남은 변화량"}{last.status==="missed"?`: ${coordinateDelta(poseDifference(last.to,{...last.target,r:last.to.r}))}`:""}</p></div>}
    <p className="lesson-note">물체 흡착은 DT의 가상 상태입니다. {props.assignment?"두 방식의 수행과 수정 기록을 함께 보관합니다.":"이 자유 적용 기록은 개념 문항의 정답·완료 기록과 별도로 남습니다."}</p>
    <div className="lesson-actions">{motion.running&&<button onClick={()=>{motion.stop();const value=interrupt();if(value)setRecord(value);setFeedback("이동을 중지했습니다. 현재 TCP에서 다시 입력해 실행하세요.");}}>DT 정지</button>}
      <button disabled={props.hardwareConnected} onClick={motion.reset}>↺ DT 원위치</button>
      {record&&!record.completed&&<button disabled={locked} onClick={prepare}>작업 처음부터</button>}</div>
    <button className="lesson-next" disabled={locked} onClick={props.onBack}>개념·상황 풀이로 돌아가기</button>
    {props.assignment?props.onFree&&<button className="lesson-next" disabled={locked} onClick={props.onFree}>추가 연습: 좌표 직접 이동·방식 자유 선택 →</button>
      :<button className="lesson-next" disabled={locked} onClick={props.onNext}>다음: MoveJ·MoveL 경로 비교 →</button>}
  </div>;
}
