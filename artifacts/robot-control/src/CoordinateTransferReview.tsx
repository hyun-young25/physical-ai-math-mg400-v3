import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LessonConceptHeader } from "./LessonConceptHeader";import { parseLessonNumber, sampleLessonMotion } from "./curriculum";
import { useLessonMotion, type MotionProps } from "./LessonPages";
import type { CoordinateMode, CoordinateVisual } from "./coordinateLearning";
import { applicationId } from "./coordinateApplication";
import { TRANSFER_START, TRANSFER_GOAL, liftTarget, liftTrialResult, liftFeedback, transferLearningComplete,
  type TransferLearningRecord, type LiftResult } from "./transferLearning";

type Props=MotionProps & {
  pairId:string; record?:TransferLearningRecord; onRecord:(record:TransferLearningRecord)=>void;
  onVisualChange:(visual:CoordinateVisual|null)=>void; onBack:()=>void; onNext:()=>void; onExport:()=>void;
};
import { TaskStartPoint, moveVirtualTaskStart } from "./TaskStartPoint";

export function CoordinateTransferReview(props:Props) {
  const motion=useLessonMotion(props),latest=useRef(props);latest.current=props;
  const active=useRef(props.record);active.current=props.record;
  const trial=props.record?.trials.at(-1),analysis=trial?liftTrialResult(trial,TRANSFER_START,TRANSFER_GOAL):null;
  const complete=transferLearningComplete(props.record,TRANSFER_START,TRANSFER_GOAL);
  const [explanation,setExplanation]=useState(props.record?.explanations.at(-1)?.text??"");
  const [commands,setCommands]=useState(trial?.commands??{absolute:"",relative:""});
  const [revisionReason,setRevisionReason]=useState("");
  const [editing,setEditing]=useState(!trial),[prepared,setPrepared]=useState<CoordinateMode|null>(null);
  const [notice,setNotice]=useState("");
  const locked=motion.running||props.hardwareConnected;
  const save=(r:TransferLearningRecord)=>{active.current=r;latest.current.onRecord(structuredClone(r));};
  const newRecord=():TransferLearningRecord=>({id:applicationId(),pairId:props.pairId,source:"dt",explanationReview:"teacher",explanations:[],trials:[]});
  const interrupt=()=>{
    const r=active.current;if(!r||!r.trials.some(t=>t.results.some(v=>v.status==="running")))return;
    save({...r,trials:r.trials.map(t=>({...t,results:t.results.map(v=>v.status==="running"
      ?{...v,status:"stopped" as const,finishedAt:new Date().toISOString()}:v)}))});
  };
  useLayoutEffect(()=>{interrupt();setPrepared(null);},[props.resetKey,props.hardwareConnected]);
  useEffect(()=>()=>{interrupt();latest.current.onVisualChange(null);},[]);
  useEffect(()=>{
    props.onVisualChange({key:`lift:${props.pairId}`,from:{...TRANSFER_START,r:props.coords.r},fromLabel:"A",results:{},showPaths:false,
      points:[{id:"lift-goal",label:"목표 높이 Z=60",pose:{...TRANSFER_GOAL,r:props.coords.r},color:"#0f766e",kind:"given"}],
      trails:[],workpiece:{top:TRANSFER_START,attached:!!prepared,pick:TRANSFER_START,place:TRANSFER_GOAL,showPlace:false}});
  },[props.pairId,prepared,props.onVisualChange]);
  const saveExplanation=()=>{
    if(!explanation.trim())return;
    const r=active.current??newRecord();
    save({...r,explanations:[...r.explanations,{submittedAt:new Date().toISOString(),text:explanation.trim()}]});
    setNotice("설명을 저장했습니다. 설명의 타당성은 교사가 확인합니다.");
  };
  const submit=()=>{
    const r=active.current;
    if(locked||!r?.explanations.length||Object.values(commands).some(v=>parseLessonNumber(v)===null)||(r.trials.length>0&&!revisionReason.trim()))return;
    save({...r,completedAt:undefined,trials:[...r.trials,{id:applicationId(),submittedAt:new Date().toISOString(),commands:{...commands},revisionReason:revisionReason.trim(),results:[]}]});
    setEditing(false);setPrepared(null);setNotice("두 예측을 저장했습니다. 같은 출발 높이에서 각각 실행해 확인하세요.");
  };
  const prepare=(mode:CoordinateMode)=>{
    if(locked||editing||!trial)return;
    const from={...TRANSFER_START,r:props.coords.r};
    if(!props.model.ik(from.x,from.y,from.z,from.r,props.joints.j3)){setNotice("현재 자세에서 시작 위치를 계산할 수 없습니다.");return;}
    props.onMoveTo(from.x,from.y,from.z,from.r);props.onMoveEnd();setPrepared(mode);
    setNotice("물체 윗면에 배치하고 가상 흡착했습니다. 저장한 명령으로 들어 올리세요.");
  };
  const run=(mode:CoordinateMode)=>{
    const r=active.current,t=r?.trials.at(-1);
    if(locked||editing||prepared!==mode||!r||!t)return;
    const from={...props.coords},target=liftTarget(from,mode,t.commands[mode]);if(!target)return;
    const frames=target.z<TRANSFER_START.z-0.1?null:sampleLessonMotion(props.model,from,target,"MoveL",props.joints.j3);
    const result:LiftResult={id:applicationId(),mode,from,target,startedAt:new Date().toISOString(),status:frames?"running":"rejected",
      ...(!frames?{message:"물체 윗면 아래이거나 이 DT에서 도달할 수 없는 명령입니다. 입력을 확인하세요."}:{} )};
    const submitted={...r,trials:r.trials.map(v=>v.id===t.id?{...v,results:[...v.results,result]}:v)};save(submitted);
    if(!frames){setNotice(result.message!);return;}
    setNotice("");motion.play(frames,"MoveL",()=>{
      const observed=props.model.fk(frames.at(-1)!.joints);
      const finished={...submitted,trials:submitted.trials.map(v=>({...v,results:v.results.map(e=>e.id===result.id?{...e,observed,status:"completed" as const,finishedAt:new Date().toISOString()}:e)}))};
      if(transferLearningComplete(finished,TRANSFER_START,TRANSFER_GOAL))finished.completedAt=new Date().toISOString();
      save(finished);setNotice("이동을 마쳤습니다. 입력값과 DT 도착 높이를 비교하세요.");
    });
  };
  const explanationSaved=!!props.record?.explanations.length;
return <div className="lesson-scroll coordinate-learning transfer-review math-start-lesson">
  <TaskStartPoint taskKey={`transfer:${props.pairId}:${props.resetKey}`} start={TRANSFER_START} coords={props.coords}
    disabled={motion.running} legacyConnected={props.hardwareConnected} onVirtualMove={p=>moveVirtualTaskStart(props,p)}/>
    <div className="axis-status"><strong>설명·새 조건 적용</strong><span>현재 단계: 비교·수정</span></div>
    <div className="math-cycle-rail" aria-label="피지컬 AI 학습 순환">
      <div className="math-cycle-current"><b>7/7</b> 수정·재실행</div>
    </div>
    <LessonConceptHeader
      section="2-2"
      label="설명·피드백"
      title="두 좌표 표현을 말로 설명하기"
      duration="수업 1회 20~30분"
      definition="입력한 수치가 달라도 출발 위치와 변화량의 관계가 같으면 같은 도착점에 도달합니다. 새 조건에서 다시 예측하고 실행합니다."
      columns={[]}
      showColumns={false}
    />
    <div className="math-stage-rail coordinate-stage-rail" aria-label="현재 학습 단계"><span aria-current={!trial?"step":undefined}>1. 설명·예측</span><span aria-current={trial&&!analysis?.observed?"step":undefined}>2. 실행·관찰</span><span aria-current={analysis?.observed?"step":undefined}>3. 비교·수정</span></div>
    <section className="lesson-card"><strong>입력한 숫자가 달라도 같은 위치에 도착한 이유는?</strong>
      <label>출발 위치·변화량·도착 위치를 연결해 내 말로 설명하세요.
        <textarea aria-label="두 방식 관계 설명" rows={2} maxLength={600} disabled={locked} value={explanation} onChange={e=>setExplanation(e.target.value)}/></label>
      <button disabled={locked||!explanation.trim()||explanation.trim()===props.record?.explanations.at(-1)?.text} onClick={saveExplanation}>{explanationSaved?"설명 수정 저장":"내 설명 저장"}</button>
      {explanationSaved&&<p className="lesson-note">설명 저장됨 · 교사 검토용이며 자동 정답 판정하지 않습니다.</p>}
    </section>
    <section className="lesson-card"><strong>조건이 바뀌어도 두 방식으로 들어 올릴 수 있나요?</strong>
      <p>물체 윗면의 높이가 <b>Z=30 mm</b>로 바뀌었습니다. 들어 올린 뒤 목표 높이는 <b>Z=60 mm</b>로 유지합니다. X=300, Y=−50은 바뀌지 않습니다.</p>
      <p>각 방식은 같은 출발 높이 Z=30에서 시작합니다. 두 명령을 먼저 정한 뒤 각각 실행하세요.</p>
      <fieldset className="lesson-coordinates" disabled={locked||!editing||!explanationSaved}><legend>실행 전 내 예측 (mm)</legend>
        <label>절대 명령 Z<input aria-label="새 조건 절대 Z" type="number" step="any" value={commands.absolute} onChange={e=>setCommands({...commands,absolute:e.target.value})}/></label>
        <label>상대 명령 ΔZ<input aria-label="새 조건 상대 ΔZ" type="number" step="any" value={commands.relative} onChange={e=>setCommands({...commands,relative:e.target.value})}/></label>
      </fieldset>
      {editing&&!!props.record?.trials.length&&<label>무엇을 왜 수정하나요?<textarea aria-label="높이 예측 수정 근거" rows={2} maxLength={600} disabled={locked} value={revisionReason} onChange={e=>setRevisionReason(e.target.value)}/></label>}
      {editing&&<button className="lesson-primary" disabled={locked||!explanationSaved||Object.values(commands).some(v=>parseLessonNumber(v)===null)||(!!props.record?.trials.length&&!revisionReason.trim())} onClick={submit}>두 예측 저장 · 실행으로 확인</button>}
      {!editing&&trial&&<div className="lift-methods">{(["absolute","relative"] as CoordinateMode[]).map(mode=>{
        const result=analysis?.[mode],done=result?.status==="completed",label=mode==="absolute"?"절대":"상대";
        return <div className="lift-method" key={mode}><b>{label} 명령 {mode==="absolute"?"Z":"ΔZ"}={trial.commands[mode]} mm</b>
          <div className="lesson-actions"><button disabled={locked||done} onClick={()=>prepare(mode)}>{label} 방식 준비</button>
            <button disabled={locked||done||prepared!==mode} onClick={()=>run(mode)}>{label} 명령 실행</button></div>
          {result?.observed&&<p>{result.status==="stopped"?"중지 위치":"DT 도착 높이"}: Z={result.observed.z.toFixed(2)} mm</p>}
          {result?.status==="rejected"&&<p role="status">{result.message}</p>}
        </div>;
      })}</div>}
      {motion.running&&<button onClick={()=>{motion.stop();interrupt();setPrepared(null);setNotice("중지한 실행은 완료로 처리하지 않습니다. 같은 높이에서 다시 준비하세요.");}}>DT 정지</button>}
    </section>
    {analysis?.observed&&!editing&&<section className="lesson-card" aria-live="polite"><strong>{complete?"두 명령 모두 목표 높이에 도착했습니다.":"목표 높이와 DT 도착 높이를 비교하세요."}</strong>
      <p>목표 Z=60 · 절대 결과 Z={analysis.absolute!.observed!.z.toFixed(2)} · 상대 결과 Z={analysis.relative!.observed!.z.toFixed(2)} mm</p>
      {complete&&<p>목표 위치를 유지하면 절대 Z는 그대로입니다. 상대 ΔZ는 출발 높이가 달라진 만큼 달라집니다. 이번에는 30 + 30 = 60입니다.</p>}
      {!complete&&<><p>명령대로 움직였는지와 목표 높이에 도착했는지를 구분하세요.</p>{trial&&liftFeedback(trial,TRANSFER_START,TRANSFER_GOAL).map(text=><p key={text} className="lesson-feedback">{text}</p>)}</>}
    </section>}
    {!editing&&trial&&!complete&&!motion.running&&<button onClick={()=>{setEditing(true);setPrepared(null);setRevisionReason("");setNotice("");}}>예측·근거 수정하기</button>}
    {notice&&<p className="lesson-feedback" role="status">{notice}</p>}
    {complete&&<button className="lesson-primary" onClick={props.onNext}>설명·새 조건 확인 완료 · 다음: MoveJ·MoveL →</button>}
    <p className="lesson-note">DT 가상 흡착 실습 · R은 현재 방향을 유지합니다. 새 조건은 힌트 없이 확인하며, 처음 답과 수정 답을 함께 기록합니다.</p>
    <div className="lesson-actions"><button disabled={props.hardwareConnected} onClick={motion.reset}>↺ DT 원위치</button></div>
    <button disabled={motion.running} onClick={props.onBack}>두 방식 비교표로 돌아가기</button>
  </div>;
}
