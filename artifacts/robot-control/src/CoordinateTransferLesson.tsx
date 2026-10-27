import { useEffect, useMemo, useState } from "react";
import { LessonConceptHeader } from "./LessonConceptHeader";import type { MotionProps } from "./LessonPages";
import type { CoordinateMode, CoordinateVisual } from "./coordinateLearning";
import { coordinatePoint, coordinateDelta } from "./CoordinateCommandTable";
import { CoordinateApplicationLesson } from "./CoordinateApplicationLesson";
import { APPLICATION_START, APPLICATION_PICK, APPLICATION_PLACE, applicationId, transferPair, type ApplicationRecord } from "./coordinateApplication";
import { CoordinateTransferReview } from "./CoordinateTransferReview";
import type { TransferLearningRecord } from "./transferLearning";

type Props = MotionProps & {
  records:ApplicationRecord[]; onRecord:(record:ApplicationRecord)=>void;
  learningRecords:TransferLearningRecord[]; onLearningRecord:(record:TransferLearningRecord)=>void;
  onVisualChange:(visual:CoordinateVisual|null)=>void;
  onBack:()=>void; onNext:()=>void; onFree:()=>void; onPractice:()=>void; onExport:()=>void;
};

/** One common task, two separately recorded methods. Reentry resumes the unfinished method. */
import { TaskStartPoint, moveVirtualTaskStart } from "./TaskStartPoint";

export function CoordinateTransferLesson(props:Props) {
  const [pairId,setPairId]=useState(()=>props.records.filter(r=>r.pairId).at(-1)?.pairId??applicationId());
  const pair=useMemo(()=>transferPair(props.records,pairId),[props.records,pairId]);
  const learningRecord=props.learningRecords.find(r=>r.pairId===pairId);
  const [stage,setStage]=useState<CoordinateMode|"compare"|"review">(()=>pair.complete?(learningRecord?"review":"compare"):pair.absolute?"relative":"absolute");
  useEffect(()=>{setStage(pair.complete?(learningRecord?"review":"compare"):pair.absolute?"relative":"absolute");},[props.resetKey,props.hardwareConnected]);
  useEffect(()=>{
    if(stage!=="compare"||!pair.complete)return;
    props.onVisualChange({key:`transfer-comparison:${pairId}`,from:pair.absolute!.from,fromLabel:"A",results:{},showPaths:false,trails:[],
      points:[{id:"place",label:"물체 도착 위치",pose:{...APPLICATION_PLACE,r:pair.absolute!.from.r},color:"#0f766e",kind:"given"}],
      workpiece:{top:APPLICATION_PLACE,attached:false,pick:APPLICATION_PICK,place:APPLICATION_PLACE}});
    return ()=>props.onVisualChange(null);
  },[stage,pairId,pair.absolute,pair.relative,props.onVisualChange]);

  if(stage==="review"&&pair.complete)return <CoordinateTransferReview {...props} key={pairId} pairId={pairId}
    record={learningRecord} onRecord={props.onLearningRecord} onBack={()=>setStage("compare")}/>;
  if(stage!=="compare")return <CoordinateApplicationLesson {...props} key={`${pairId}:${stage}`}
    assignment={{pairId,mode:stage as CoordinateMode}} onNext={()=>{
      if(stage==="absolute"&&pair.absolute)setStage("relative");
      else if(stage==="relative"&&pair.complete)setStage("compare");
    }}/>;

return <div className="lesson-scroll coordinate-learning coordinate-transfer-comparison math-start-lesson">
  <TaskStartPoint taskKey={`transfer-compare:${pairId}:${props.resetKey}`} start={APPLICATION_START} coords={props.coords}
    legacyConnected={props.hardwareConnected} onVirtualMove={p=>moveVirtualTaskStart(props,p)}/>
    <div className="axis-status"><strong>실습 결과 · 같은 물체를 두 방식으로 옮기기</strong><span>현재 단계: 결과 비교</span></div>
    <div className="math-cycle-rail" aria-label="피지컬 AI 학습 순환">
      <div className="math-cycle-current"><b>6/7</b> 비교·해석</div>
    </div>
    <LessonConceptHeader
      section="2-2"
      label="학습 정리"
      title="절대좌표와 상대좌표 비교"
      duration="수업 1회 20~30분"
      definition="같은 물체를 옮겨도 절대좌표는 도착 위치를, 상대좌표는 출발점에서의 변화량을 기록합니다. 두 실행 결과를 나란히 비교합니다."
      columns={[]}
      showColumns={false}
    />
    <div className="math-stage-rail coordinate-stage-rail" aria-label="두 방식 물체 실습 단계"><span>✓ 절대좌표</span><span>✓ 상대좌표</span><span aria-current="step">3. 결과 비교</span></div>
    <div className="lesson-card axis-complete"><strong>두 방식으로 같은 물체 운반 과제를 완료했습니다.</strong>
      <p>같은 시작 위치 {coordinatePoint(APPLICATION_START)}에서 출발해, 물체를 {coordinatePoint(APPLICATION_PICK)}에서 {coordinatePoint(APPLICATION_PLACE)}로 옮겼습니다.</p>
      <p>절대좌표에는 <b>도착 위치</b>를, 상대좌표에는 <b>각 실행 출발점에서의 변화량</b>을 입력했습니다.</p>
    </div>
    <div className="lesson-card"><strong>내가 입력한 두 방법 나란히 보기</strong>
      <p className="lesson-note">좌표 순서 (X, Y, Z), 단위 mm · 각 구간을 완료한 입력과 DT 도착 결과입니다.</p>
      <table className="transfer-comparison-table"><thead><tr><th>작업 단계</th><th>절대좌표로 풀기<br/>도착 위치 입력</th><th>상대좌표로 풀기<br/>변화량 입력</th></tr></thead>
        <tbody>{pair.rows.map(({step,absolute,relative},i)=><tr key={i} data-lift={i===3}>
          <th scope="row">{i+1}. {step.label}</th>
          {step.action==="move"?<><td><b>{coordinatePoint(absolute.argument!)}</b><small>DT 도착 {coordinatePoint(absolute.to!)}</small></td>
            <td><b>{coordinateDelta(relative.argument!)}</b><small>실행 출발 {coordinatePoint(relative.from)}</small><small>DT 도착 {coordinatePoint(relative.to!)}</small></td></>
            :<td colSpan={2}>{step.action==="grip"?"물체 윗면에서 가상 흡착":"놓을 위치에서 가상 흡착 해제"} · 두 방법 모두 완료</td>}
        </tr>)}</tbody>
      </table>
    </div>
    <div className="lesson-formula"><strong>들어 올리는 구간에서 비교해 보세요.</strong>
      <p>절대좌표는 ‘높이 Z=60인 위치로’, 상대좌표는 ‘현재 높이에서 ΔZ만큼 위로’를 지정합니다.</p>
      <p>두 방법 모두 출발 위치 + 변화량 = 도착 위치의 관계를 사용합니다.</p>
    </div>
    <p className="lesson-note">DT의 가상 물체 실습입니다. 두 방식 모두 MoveL을 사용했습니다. 실장비 측정 결과와 구분합니다.</p>
    <button className="lesson-primary" onClick={()=>setStage("review")}>내 말로 설명하고 · 새 조건에 적용하기 →</button>
    <div className="lesson-actions"><button disabled={props.hardwareConnected} onClick={()=>{setPairId(applicationId());setStage("absolute");}}>두 방식 다시 풀기</button></div>
    <button onClick={props.onPractice}>추가 연습: 상황에 맞게 방식 선택하기 →</button>
    <button onClick={props.onFree}>추가 연습: 좌표 직접 이동·방식 자유 선택 →</button>
    <button className="lesson-next" onClick={props.onBack}>절대·상대 개념 학습으로 돌아가기</button>
  </div>;
}
