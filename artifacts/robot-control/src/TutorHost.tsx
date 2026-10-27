import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { subscribeTutor, tutorSnapshot } from "./tutorRegistry";
import TutorWindow from "./TutorWindow";
import { setTutorMode } from "./tutorMode";
import { feedbackFailures } from "./feedbackAvailability";

const labels:Record<string,string>={foundation:"기초수학",motion:"이동과 경로",fk:"순기구학",ik:"역기구학",
  "pick-place":"픽앤플레이스",square:"사각형",triangle:"삼각형",circle:"원"};
export function TutorHost() {
  const ai=useSyncExternalStore(subscribeTutor,tutorSnapshot,tutorSnapshot);
  const [open,setOpen]=useState(false);
  useEffect(()=>{
    const show=()=>setOpen(true);
    window.addEventListener("square-tutor-feedback",show);
    return ()=>window.removeEventListener("square-tutor-feedback",show);
  },[]);
  useEffect(()=>{
    document.body.classList.toggle("ai-tutor-available",!!ai);
    document.body.classList.toggle("ai-tutor-open",open&&!!ai);
    const header=document.querySelector(".learning-student-bar");
    const menu=document.querySelector(".robot-app-header");
    // The development preview can inject an additional banner above the app.
    const update=()=>{
      document.documentElement.style.setProperty("--ai-tutor-header",
        `${Math.max(0,menu?.getBoundingClientRect().bottom??header?.getBoundingClientRect().bottom??0)}px`);
      document.documentElement.style.setProperty("--ai-tutor-banner-bottom",
        `${Math.max(0,header?.getBoundingClientRect().top??0)}px`);
      document.documentElement.style.setProperty("--ai-tutor-root-top",
        `${Math.max(0,document.querySelector("#root")?.getBoundingClientRect().top??0)}px`);
    };
    update();
    const observer=new ResizeObserver(update);
    if(header)observer.observe(header);
    if(menu)observer.observe(menu);
    window.addEventListener("resize",update);
    window.visualViewport?.addEventListener("scroll",update);
    return ()=>{
      observer.disconnect();
      window.removeEventListener("resize",update);
      window.visualViewport?.removeEventListener("scroll",update);
      document.body.classList.remove("ai-tutor-open","ai-tutor-available");
    };
  },[open,!!ai]);
  useEffect(()=>{if(open&&ai)ai.acknowledge();},[open,ai]);
  if(!ai)return null;
  const feedback=ai.feedback??[...ai.messages].reverse().find(m=>m.role==="tutor");
  const source=feedback&&("provider" in feedback?feedback.provider:feedback.source);
  const statuses={unconfigured:"OpenAI 미설정",limited:"사용량 제한",timeout:"응답 시간 초과",unavailable:"연결 오류",provided:"응답 완료"};
  const status=ai.mode==="trial"?"체험 모드 · 기본 힌트":ai.pending?"답변 준비 중":ai.feedback?.failureReason?`GPT 미응답 · ${feedbackFailures[ai.feedback.failureReason].label}`:source==="openai"?(ai.feedback?"OpenAI GPT · 응답 완료":"이전 답변 · OpenAI GPT"):
    source==="rules"?`기본 안내 · ${ai.feedback?statuses[ai.feedback.status]:"규칙 기반"}`:"질문 대기 · 연결 미확인";
  return createPortal(<TutorWindow key={ai.problemKey+ai.mode} open={open} onToggle={()=>setOpen(value=>!value)}
    contextLabel={`${ai.context.task.startsWith("axis-")?"2-1 좌표축과 이동 방향":ai.context.task.startsWith("coordinate-")?"2-2 절대·상대좌표와 변화량":labels[ai.context.task]??"좌표 학습"} · 현재 문제`}
    status={status} pending={!!ai.pending} messages={ai.messages}
    unread={ai.unread} preview={ai.preview}
    onSend={text=>{ai.acknowledge();void ai.ask(text);}} quickActions={ai.quickActions}
    onRetry={ai.mode==="gpt"&&source==="rules"&&![...ai.messages].reverse().find(m=>m.role==="tutor")?.automatic?()=>void ai.request("retry"):undefined}
    mode={ai.mode} onModeChange={setTutorMode}
    storageFailed={ai.storageFailed}/>,document.body);
}
