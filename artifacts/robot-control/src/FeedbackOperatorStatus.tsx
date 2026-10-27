import {useEffect,useState} from "react";
import type {LearningFeedbackAvailability,LearningFeedbackDiagnostic} from "@workspace/api-client-react";
import {feedbackFailures} from "./feedbackAvailability";
export default function FeedbackOperatorStatus(){
  const [state,setState]=useState<LearningFeedbackAvailability>(),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const load=async(signal?:AbortSignal)=>{
    setBusy(true);setError("");
    try{
      const r=await fetch("/api/learning/feedback/status",{credentials:"same-origin",signal});
      if(!r.ok)throw new Error("status");
      const data=await r.json();
      if(typeof data.configured!=="boolean"||!data.limits||typeof data.model!=="string")throw new Error("schema");
      setState(data);
    }catch{if(!signal?.aborted)setError("소유자 인증 또는 서버 상태 조회를 확인하세요. API 키나 결제 정보를 여기 입력하지 마세요.");}
    finally{if(!signal?.aborted)setBusy(false);}
  };
  useEffect(()=>{const abort=new AbortController();void load(abort.signal);return()=>abort.abort();},[]);
  const diagnostic=(title:string,d:LearningFeedbackDiagnostic|undefined)=>d&&<div>
    <strong>{title}: {d.failureReason?feedbackFailures[d.failureReason]?.label:"GPT API 응답 성공"}</strong>
    <p>{d.failureReason?feedbackFailures[d.failureReason]?.action:"실제 제공자 응답이 확인되었습니다."}</p>
    <small>{new Date(d.at).toLocaleString("ko-KR")} · 제공자 호출 {d.providerAttempted?"시도함":"하지 않음"}{d.httpStatus?` · HTTP ${d.httpStatus}`:""}</small>
  </div>;
  return <section className="la-panel" aria-label="GPT 연결 상태" style={{padding:16}}>
    <h2>GPT 연결 상태 · 운영자</h2>
    <p>키 값·학생 자료 없이 현재 서버 프로세스의 상태만 조회합니다. 이 조회는 유료 GPT 요청을 보내지 않습니다.</p>
    <button type="button" disabled={busy} onClick={()=>void load()}>상태 새로고침</button>
    {error&&<p role="alert">{error}</p>}
    {state&&<>
      <p>서버 키: {state.configured?"설정 있음 · 유효성은 실제 응답으로 확인":"미설정"} · 모델: {state.model}</p>
      {diagnostic("최근 요청",state.latest)}
      {state.latestProvider?.at!==state.latest?.at&&diagnostic("최근 제공자 호출",state.latestProvider)}
      {!state.latest&&<p>아직 이 프로세스에서 확인된 질문 응답이 없습니다. 키가 있다는 사실만으로 연결 성공을 뜻하지 않습니다.</p>}
      <p>앱 상한: IP당 {state.limits.ipPerMinute}회/분 · 방문당 {state.limits.visitPerHour}회/시간 · 전체 {state.limits.globalPerDay}회/일 · 동시 {state.limits.concurrency}개</p>
      <small>현재 일일 집계 {state.limits.globalUsed}회 · 처리 중 {state.limits.active}개. 상한·결제·키를 이 화면에서 변경하지 않습니다.</small>
    </>}
  </section>;
}
