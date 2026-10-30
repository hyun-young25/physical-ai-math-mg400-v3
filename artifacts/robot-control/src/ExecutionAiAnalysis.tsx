import { useEffect, useRef, useState } from "react";
import type { LearningAiController } from "./LearningAiFeedback";
import { setTutorMode } from "./tutorMode";
import "./executionAiAnalysis.css";

export type DisplayedExecutionAnalysis = {
  id: string;
  mode: "trial" | "gpt";
  provider: "rules" | "openai";
  status: string;
  failureReason?: string;
  question: string;
  text: string;
  requestedAt: string;
  displayedAt: string;
};

export function ExecutionAiAnalysis({ ai, scopeKey, attemptLabel, sourceLabel, available, onDisplayed }: {
  ai: LearningAiController;
  scopeKey: string;
  attemptLabel: string;
  sourceLabel: string;
  available: boolean;
  onDisplayed?: (analysis: DisplayedExecutionAnalysis) => void;
}) {
  const [request, setRequest] = useState<{ scopeKey: string; mode: "trial" | "gpt"; question: string; requestedAt: string } | null>(null);
  const [inView, setInView] = useState(false);
  const resultNode = useRef<HTMLDivElement>(null);
  const handled = useRef("");
  const acknowledge = useRef(ai.acknowledge);
  const onDisplayedRef = useRef(onDisplayed);
  acknowledge.current = ai.acknowledge;
  onDisplayedRef.current = onDisplayed;

  useEffect(() => {
    setRequest(null);
    setInView(false);
    handled.current = "";
  }, [scopeKey]);

  const question = `종이·도형 과제 ${attemptLabel}의 이번 실행자료를 근거로 검토해 주세요. 학생의 저장된 풀이와 목표-명령 차이, 명령-관측 차이를 구분하고, 출처가 실장비·DT·모의 중 무엇인지 밝히세요. 가능한 설명과 근거, 다음에 확인할 질문 하나를 제시하되 원인을 확정하거나 채점하지 마세요.`;
  const resultMatches = !!request && request.scopeKey === scopeKey && request.mode === ai.mode
    && ai.feedbackQuestion === request.question && !!ai.feedback && !ai.pending;
  const resultId = resultMatches && ai.feedback
    ? `${request!.question}:${ai.feedback.createdAt}:${ai.feedback.provider}:${ai.feedback.failureReason ?? ""}` : "";

  useEffect(() => {
    if (!resultMatches || !resultNode.current) {
      setInView(false);
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.2)) setInView(true);
    }, { threshold: 0.2 });
    observer.observe(resultNode.current);
    return () => observer.disconnect();
  }, [resultMatches, resultId]);

  useEffect(() => {
    if (!inView || !resultMatches || !resultId || handled.current === resultId || !request || !ai.feedback) return;
    handled.current = resultId;
    acknowledge.current();
    onDisplayedRef.current?.({
      id: ai.feedbackId ?? crypto.randomUUID(),
      mode: request.mode,
      provider: ai.feedback.provider,
      status: ai.feedback.status,
      ...(ai.feedback.failureReason ? { failureReason: ai.feedback.failureReason } : {}),
      question: request.question,
      text: ai.feedback.text,
      requestedAt: request.requestedAt,
      displayedAt: new Date().toISOString(),
    });
  }, [inView, resultMatches, resultId, request, ai.feedback]);

  return (
    <section className="execution-ai-panel" aria-label="실행자료 AI 분석">
      <div className="execution-ai-heading">
        <div><span className="execution-ai-eyebrow">자료 기반 진단과 AI 튜터 구분</span><h3>실행자료로 AI 분석</h3></div>
        <span className="execution-ai-source">{sourceLabel}</span>
      </div>
      <p className="execution-ai-note">규칙 진단은 좌표 차이를 계산하고, 튜터는 학생의 설명과 근거를 바탕으로 질문을 표현합니다. 원인 판정·채점·로봇 제어는 하지 않습니다.</p>
      <label className="execution-ai-mode">
        <span>분석 방식</span>
        <select value={ai.mode} onChange={event => setTutorMode(event.target.value as "trial" | "gpt")} disabled={ai.pending}>
          <option value="trial">기본 체험 · 무료, 외부 AI 호출 없음</option>
          <option value="gpt">실제 GPT · 아래 버튼을 눌렀을 때만 요청</option>
        </select>
      </label>
      <p className="execution-ai-note">방식을 바꾸는 것만으로는 요청을 보내지 않습니다. GPT 선택 후 분석 버튼을 누르면 현재 자료가 외부 AI 서비스로 전송될 수 있습니다.</p>
      <button type="button" className="execution-ai-button" disabled={!available || ai.pending}
        onClick={() => {
          const requestedAt = new Date().toISOString();
          setRequest({ scopeKey, mode: ai.mode, question, requestedAt });
          void ai.ask(question);
        }}>
        {ai.pending ? "분석 요청 중…" : ai.mode === "gpt" ? "실행자료를 GPT에 보내 분석" : "기본 체험 분석 보기"}
      </button>
      {!available && <p className="execution-ai-blocked" role="status">현재 시도의 완료된 실행과 같은 계획의 유효한 관측이 필요합니다. 누락·이전 계획·미완료 자료는 분석 근거로 사용할 수 없습니다.</p>}
      {resultMatches && ai.feedback && (
        <div className="execution-ai-result" ref={resultNode} data-testid="execution-ai-result">
          <strong>{request.mode === "trial"
            ? "기본 체험 응답 · 규칙 기반 · 외부 AI 호출 없음"
            : ai.feedback.provider === "openai" && ai.feedback.status === "provided"
              ? "실제 GPT 응답"
              : `GPT 분석 미완료 · ${ai.feedback.failureReason ?? ai.feedback.status} · 아래 내용은 GPT 응답이 아닙니다`}</strong>
          <p>{ai.feedback.text}</p>
        </div>
      )}
      <details className="execution-ai-evidence">
        <summary>요청에 포함되는 같은 시도의 근거 확인</summary>
        <p>과제: {attemptLabel} · 출처: {sourceLabel}</p>
        <pre>{JSON.stringify({
          condition: JSON.parse(ai.context.condition),
          answers: JSON.parse(ai.context.answers),
          reason: ai.context.reason,
          initialPrediction: JSON.parse(ai.context.initialPrediction),
          linkedHistory: JSON.parse(ai.context.history),
          ruleDiagnosis: JSON.parse(ai.context.judgment),
          execution: JSON.parse(ai.context.execution),
          previouslyDisplayedConversation: ai.messages.map(({ role, text, source }) => ({ role, text, source })),
        }, null, 2)}</pre>
      </details>
    </section>
  );
}
