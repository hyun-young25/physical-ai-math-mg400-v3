import { useEffect, useState } from "react";
import { ERROR_LABEL, openSupport, startSupportCheck, submitSupport, supportProblem, supportTrigger,
  type ErrorEvent, type SupportProps, type SupportRecord } from "./learningSupport";

/** Optional remediation never increments lesson item counts or moves the robot. */
export function AdaptiveSupport(props:SupportProps & {lesson:SupportRecord["lesson"];taskId:string;events:ErrorEvent[];disabled:boolean}) {
  const records=props.supportRecords.filter(r=>r.lesson===props.lesson);
  const active=records.find(r=>r.status!=="complete");
  const trigger=supportTrigger(props.events,records);
  const last=records.at(-1);
  const [answers,setAnswers]=useState<Record<string,string>>({});
  const [notice,setNotice]=useState("");
  useEffect(()=>{setAnswers({});setNotice("");},[active?.id,active?.status,active?.checks.length]);
  if(!active) return trigger?<aside className="lesson-card adaptive-support" aria-label="선택 보충">
    <strong>같은 유형의 차이가 두 번 이상 나타났습니다: {ERROR_LABEL[trigger.error]}</strong>
    <p>짧은 보충 연습을 선택할 수 있습니다. 이후 다른 조건을 힌트 없이 확인하며, 기존 제출과 보충 사용 기록은 함께 남습니다.</p>
    <button disabled={props.disabled} onClick={()=>props.onSupport(openSupport(props.lesson,props.taskId,trigger))}>선택 보충 시작</button>
  </aside>:last?.status==="complete"?<p className="lesson-note">✓ {ERROR_LABEL[last.error]} 보충 후 새 조건 확인 완료 · 보충 사용 기록 유지</p>:null;
  const checking=active.status==="check";
  const problem=supportProblem(active.error,checking?"check":"practice",active.checks.length,active.lesson);
  const practicePassed=!checking&&active.practice.at(-1)?.correct;
  const submit=()=>{
    const result=submitSupport(active,answers);
    if(!result){setNotice("모든 답을 입력하세요. 빈칸은 0으로 처리하지 않습니다.");return;}
    props.onSupport(result);
    setNotice(result.status==="complete"?"새 조건에서 관계를 올바르게 적용했습니다.":result.practice.at(-1)?.correct&&!checking?"보충 연습을 확인했습니다. 이제 다른 조건으로 확인하세요.":"입력과 조건을 다시 비교해 보세요.");
  };
  return <aside className="lesson-card adaptive-support" aria-label={checking?"보충 후 독립 확인":"선택 보충 연습"}>
    <strong>{checking?"힌트 없이 새 조건 확인":"선택 보충 연습"} · {ERROR_LABEL[active.error]}</strong>
    {!checking&&<p className="lesson-formula">{problem.explanation}</p>}
    {checking&&active.checks.length>0&&<p role="status">직전 답이 조건과 일치하지 않았습니다. 바뀐 조건으로 다시 판단하세요.</p>}
    <p>{problem.prompt}</p>
    <fieldset className="lesson-coordinates" disabled={props.disabled||practicePassed}>
      <legend>{checking?"스스로 판단한 답":"보충 연습 답"}</legend>
      {problem.fields.map(f=><label key={f.key}>{f.label}{f.options?<select aria-label={f.label} value={answers[f.key]??""}
        onChange={e=>setAnswers(a=>({...a,[f.key]:e.target.value}))}><option value="">선택</option>{f.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>
        :<input aria-label={f.label} type="number" step="any" placeholder="?" value={answers[f.key]??""} onChange={e=>setAnswers(a=>({...a,[f.key]:e.target.value}))}/>}</label>)}
    </fieldset>
    {practicePassed?<button disabled={props.disabled} onClick={()=>{const next=startSupportCheck(active);if(next)props.onSupport(next);}}>힌트 접고 새 조건 확인</button>
      :<button disabled={props.disabled} onClick={submit}>{checking?"새 조건 답 제출":"보충 연습 확인"}</button>}
    {notice&&<p role="status">{notice}</p>}
    <p className="lesson-note">문항 수와 완료 수에는 포함되지 않는 수학 보충입니다. DT는 움직이지 않습니다.</p>
  </aside>;
}
