import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Bot, ChevronDown, RotateCcw, SendHorizontal, X } from "lucide-react";
import "./TutorWindow.css";
import type { TutorMode } from "./tutorMode";

export type TutorMessage = { id: string; role: "student" | "tutor"; text: string; source?: "openai" | "rules"; unavailable?:boolean };
export type TutorQuickAction = { label: string; enabled: boolean; question: string };
export type TutorWindowProps = {
  open: boolean;
  onToggle: () => void;
  contextLabel: string;
  pending: boolean;
  status: string;
  messages: TutorMessage[];
  onSend: (text: string) => void;
  quickActions: TutorQuickAction[];
  onRetry?: () => void;
  storageFailed: boolean;
  mode: TutorMode;
  onModeChange: (mode:TutorMode) => void;
  unread?:number;
  preview?:string;
};

const MAX = 1000;

export default function TutorWindow({ open, onToggle, contextLabel, pending, status, messages, onSend, quickActions, onRetry, storageFailed, mode, onModeChange, unread=0, preview }: TutorWindowProps) {
  const [draft, setDraft] = useState("");
  const composing = useRef(false);
  const sendLock = useRef(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);
  const titleId = useId();
  const inputId = useId();
  const hintId = useId();

  useEffect(() => { setDraft(""); }, [contextLabel]);
  useEffect(() => { if (!pending) sendLock.current = false; }, [pending, messages.length]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, open, pending]);

  useEffect(() => {
    if (wasOpen.current && !open) launcherRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // Track the visible viewport, including keyboard resize and browser panning.
  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => {
      const height = vv?.height ?? window.innerHeight;
      const top = vv?.offsetTop ?? 0;
      const inset = Math.max(0, window.innerHeight - height - top);
      document.documentElement.style.setProperty("--ai-tutor-kb", `${inset}px`);
      document.documentElement.style.setProperty("--ai-tutor-viewport-top", `${top}px`);
      document.documentElement.style.setProperty("--ai-tutor-viewport-height", `${height}px`);
    };
    update();
    window.addEventListener("resize", update);
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      for (const name of ["--ai-tutor-kb", "--ai-tutor-viewport-top", "--ai-tutor-viewport-height"])
        document.documentElement.style.removeProperty(name);
    };
  }, []);

  const trimmed = draft.trim();
  const tooLong = draft.length > MAX;
  const canSend = !pending && !!trimmed && !tooLong;

  const send = (text: string) => {
    const t = text.trim();
    if (!t || t.length > MAX || pending || sendLock.current) return false;
    sendLock.current = true;
    onSend(t);
    return true;
  };
  const submit = () => { if (send(draft)) setDraft(""); };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    submit();
  };

  const lastTutor = [...messages].reverse().find(m => m.role === "tutor");
  const showRetry = !!onRetry && !pending && lastTutor?.source === "rules";

  return (
    <div className="ait-root" data-open={open}>
      {open && (
        <section className="ait-window" role="dialog" aria-modal="false" aria-labelledby={titleId}
          onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); onToggle(); } }} data-testid="panel-ai-tutor">
          <header className="ait-head">
            <span className="ait-avatar" aria-hidden="true"><Bot size={16} strokeWidth={2.2} /></span>
            <div className="ait-titles">
              <h2 id={titleId} className="ait-title">AI 수학 튜터</h2>
              <p className="ait-context" title={contextLabel} data-testid="text-ai-tutor-context">{contextLabel}</p>
            </div>
            <button type="button" className="ait-icon-btn" onClick={onToggle} aria-label="AI 수학 튜터 접기" title="최소화 · 대화 유지" aria-expanded={true} data-testid="button-ai-tutor-collapse"><ChevronDown size={17} /><span>최소화</span></button>
            <button type="button" className="ait-icon-btn" onClick={onToggle} aria-label="AI 수학 튜터 닫기" title="닫기" data-testid="button-ai-tutor-close"><X size={16} /><span>닫기</span></button>
          </header>

          <div className="ait-scroll">
          <p className="ait-note">현재 화면에서 전달된 자료만 참고해요. 이전 답변은 당시 입력 기준입니다. 정답 판정과 실행 승인은 학습 화면에서 직접 하세요.</p>
          <div className="ait-mode">
            <label>응답 방식
              <select aria-label="튜터 응답 방식" value={mode} onChange={e=>onModeChange(e.target.value as TutorMode)} data-testid="select-ai-tutor-mode">
                <option value="trial">체험 모드 · 기본 힌트</option>
                <option value="gpt">실제 GPT · 운영자 선택</option>
              </select>
            </label>
            <small>{mode==="trial"?"외부 AI 호출 없음 · 체험 대화는 현재 탭에서만 보관하며 학습 기록에 전송하지 않습니다."
              :"운영자가 준비한 연결을 사용합니다. 질문·단계 확인 시 외부 AI를 요청하며 비용이 발생할 수 있습니다. 실패 시 기본 안내를 제공합니다."}</small>
          </div>

          <div ref={logRef} className="ait-log" role="log" aria-label="튜터 대화 기록" aria-live="polite" tabIndex={0} data-testid="log-ai-tutor">
            {messages.length === 0 && !pending && (
              <div className="ait-empty">
                <span className="ait-empty-mark" aria-hidden="true"><Bot size={22} /></span>
                <p>예측하다 막힌 곳을 짧게 적어 보세요.<br />튜터가 다음 질문으로 생각을 이어 줍니다.</p>
              </div>
            )}
            {messages.map(m => (
              <div key={m.id} className={`ait-msg ait-msg--${m.role}`} data-testid={`msg-ai-tutor-${m.id}`}>
                <span className="ait-sr">{m.role === "student" ? "학생:" : "튜터:"}</span>
                <p className="ait-bubble">{m.text}</p>
                {m.role === "tutor" && m.source && (
                  <span className="ait-source">{m.unavailable?"GPT 미응답 · 상태 안내":m.source === "openai" ? "AI 생성 힌트" : "기본 안내"}</span>
                )}
              </div>
            ))}
            {pending && (
              <div className="ait-msg ait-msg--tutor" aria-hidden="true">
                <p className="ait-bubble ait-typing"><i /><i /><i /></p>
              </div>
            )}
          </div>

          <div className="ait-status" role="status" aria-live="polite" data-testid="status-ai-tutor">
            <span className={`ait-dot${pending ? " ait-dot--busy" : ""}`} aria-hidden="true" />
            <span>{status}</span>
            {showRetry && (
              <button type="button" className="ait-retry" onClick={onRetry} data-testid="button-ai-tutor-retry">
                <RotateCcw size={13} /> 다시 시도
              </button>
            )}
          </div>
          {storageFailed && <p className="ait-alert" role="alert">대화 기록을 저장하지 못했습니다. 새로고침 전에 저장 상태를 확인하세요.</p>}

          {quickActions.length > 0 && (
            <div className="ait-chips" role="group" aria-label="짧은 질문">
              {quickActions.map((q, i) => (
                <button key={q.label} type="button" className="ait-chip" disabled={!q.enabled || pending}
                  onClick={() => send(q.question)} data-testid={`button-ai-tutor-quick-${i}`}>{q.label}</button>
              ))}
            </div>
          )}
          </div>

          <form className="ait-compose" onSubmit={e => { e.preventDefault(); submit(); }}>
            <label htmlFor={inputId} className="ait-sr">튜터에게 질문</label>
            <textarea id={inputId} className="ait-input" rows={2} value={draft} aria-describedby={hintId}
              aria-invalid={tooLong || undefined}
              placeholder="어디서 막혔나요? (Enter 전송, Shift+Enter 줄바꿈)"
              onChange={e => setDraft(e.target.value)} onKeyDown={onKeyDown}
              onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={() => { composing.current = false; }}
              data-testid="input-ai-tutor" />
            <div className="ait-compose-row">
              <span id={hintId} className={`ait-count${tooLong ? " ait-count--over" : ""}`}>
                {tooLong ? `${MAX}자 이하로 줄여 주세요 · ` : "개인정보는 적지 마세요 · "}{draft.length}/{MAX}
              </span>
              <button type="submit" className="ait-send" disabled={!canSend} aria-label="질문 전송" data-testid="button-ai-tutor-send">
                <SendHorizontal size={16} />
              </button>
            </div>
          </form>
        </section>
      )}
      {!open&&unread>0&&preview&&<button type="button" className="ait-preview" onClick={onToggle}
        aria-label={`새 자동 피드백 ${unread}개 보기`} data-testid="notice-ai-tutor-feedback">
        <strong aria-live="polite">새 자동 피드백 {unread}개</strong><span>{preview.replace(/^자동 피드백[^\n]*\n/,"")}</span>
      </button>}
      {!open && (
        <button ref={launcherRef} type="button" className="ait-launcher" onClick={onToggle}
          aria-label={`AI 수학 튜터 열기${unread?` · 새 피드백 ${unread}개`:""}`} aria-expanded={false} data-testid="button-ai-tutor-open">
          <Bot size={24} strokeWidth={2} />
          {(pending || unread > 0) && <span className="ait-launcher-badge" aria-hidden="true" />}
        </button>
      )}
    </div>
  );
}
