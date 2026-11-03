import { useEffect, useRef, useState } from "react";
import type { LearningAiController } from "./LearningAiFeedback";
import type { FeedbackContext } from "./learningAiContext";
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
  promptVersion?: string;
  fallbackUsed?: boolean;
  evidenceSnapshot?: FeedbackContext;
};

export function ExecutionAiAnalysis({
  ai,
  scopeKey,
  attemptLabel,
  sourceLabel,
  available,
  onDisplayed,
  evidenceDraftKey,
  prepareRequest,
  promptVersion,
  paperV6 = false,
}: {
  ai: LearningAiController;
  scopeKey: string;
  attemptLabel: string;
  sourceLabel: string;
  available: boolean;
  onDisplayed?: (analysis: DisplayedExecutionAnalysis) => void;
  evidenceDraftKey?: string;
  prepareRequest?: () =>
    | { ok: true; context: FeedbackContext }
    | { ok: false; message: string; target?: "ink" };
  promptVersion?: string;
  paperV6?: boolean;
}) {
  const [request, setRequest] = useState<{
    scopeKey: string;
    mode: "trial" | "gpt";
    question: string;
    requestedAt: string;
    evidenceSnapshot: FeedbackContext;
  } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [preparedPreview, setPreparedPreview] = useState<{
    scopeKey: string;
    draftKey: string;
    text: string;
  } | null>(null);
  const [inView, setInView] = useState(false);
  const resultNode = useRef<HTMLDivElement>(null);
  const handled = useRef("");
  const aiRef = useRef(ai);
  const acknowledge = useRef(ai.acknowledge);
  const onDisplayedRef = useRef(onDisplayed);
  aiRef.current = ai;
  acknowledge.current = ai.acknowledge;
  onDisplayedRef.current = onDisplayed;

  useEffect(() => {
    setRequest(null);
    setInView(false);
    setActionError("");
    setPreparedPreview(null);
    handled.current = "";
  }, [scopeKey]);

  const question = paperV6
    ? `2-4 심화2 ${attemptLabel}의 같은 시도 실행자료만 사용하세요. 학생의 O, ΔX/ΔY, θ 가정, 직접 대입한 수학식과 예측, 실행 출처(DT/모의/실장비), 같은 실행의 제어기 보고와 학생 잉크 측정 및 사전 허용오차를 구분하세요. 원인을 단정하거나 정답 좌표를 제시하지 말고, 가능한 설명과 근거를 바탕으로 학생이 확인할 관계 또는 추가 관측을 묻는 짧은 질문 하나만 하세요. 로봇을 제어하지 마세요.`
    : `종이·도형 과제 ${attemptLabel}의 이번 실행자료를 근거로 검토해 주세요. 학생의 저장된 풀이와 목표-명령 차이, 명령-관측 차이를 구분하고, 출처가 실장비·DT·모의 중 무엇인지 밝히세요. 가능한 설명과 근거, 다음에 확인할 질문 하나를 제시하되 원인을 확정하거나 채점하지 마세요.`;
  let previewText: string | null = null;
  try {
    previewText = JSON.stringify(ai.previewRequest(question), null, 2) ?? null;
  } catch {
    /* Keep the lesson usable if an optional preview cannot be formed. */
  }
  const draftKey = evidenceDraftKey ?? "";
  const visiblePreview =
    preparedPreview?.scopeKey === scopeKey &&
    preparedPreview.draftKey === draftKey
      ? preparedPreview.text
      : previewText;
  const requestAnalysis = async () => {
    if (!available || preparing || aiRef.current.pending) return;
    setActionError("");
    setPreparing(true);
    try {
      const prepared = prepareRequest?.() ?? {
        ok: true as const,
        context: aiRef.current.context,
      };
      if (!prepared.ok) {
        setActionError(prepared.message);
        if (prepared.target === "ink") {
          document
            .querySelector(".pcv-ink-list")
            ?.scrollIntoView({ block: "center", behavior: "smooth" });
          document
            .querySelector<HTMLElement>('[aria-label$="잉크 측정 상태"]')
            ?.focus();
        }
        return;
      }
      const snapshot = prepared.context;
      // Ink drafts are committed synchronously before this component is asked to
      // request analysis. Wait for the parent context to refresh, then require
      // the exact saved snapshot to be the one the AI hook will send.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const latest = aiRef.current;
      if (JSON.stringify(latest.context) !== JSON.stringify(snapshot)) {
        setActionError(
          "저장한 잉크 관측이 분석 자료에 반영되지 않아 요청하지 않았습니다. 저장 상태를 확인하고 다시 누르세요.",
        );
        return;
      }
      const preview = JSON.stringify(
        latest.previewRequest(question, snapshot),
        null,
        2,
      );
      if (preview) setPreparedPreview({ scopeKey, draftKey, text: preview });
      const requestedAt = new Date().toISOString();
      setRequest({
        scopeKey,
        mode: latest.mode,
        question,
        requestedAt,
        evidenceSnapshot: snapshot,
      });
      void latest.ask(question, snapshot);
    } catch {
      setActionError(
        "현재 입력을 저장하거나 분석 자료를 준비하지 못했습니다. 입력은 유지했습니다. 저장 상태를 확인한 뒤 다시 시도하세요.",
      );
    } finally {
      setPreparing(false);
    }
  };
  const resultMatches =
    !!request &&
    request.scopeKey === scopeKey &&
    request.mode === ai.mode &&
    ai.feedbackQuestion === request.question &&
    !!ai.feedback &&
    !ai.pending;
  const resultId =
    resultMatches && ai.feedback
      ? `${request!.question}:${ai.feedback.createdAt}:${ai.feedback.provider}:${ai.feedback.failureReason ?? ""}`
      : "";

  useEffect(() => {
    if (!resultMatches || !resultNode.current) {
      setInView(false);
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries.some(
            (entry) => entry.isIntersecting && entry.intersectionRatio >= 0.2,
          )
        )
          setInView(true);
      },
      { threshold: 0.2 },
    );
    observer.observe(resultNode.current);
    return () => observer.disconnect();
  }, [resultMatches, resultId]);

  useEffect(() => {
    if (
      !inView ||
      !resultMatches ||
      !resultId ||
      handled.current === resultId ||
      !request ||
      !ai.feedback
    )
      return;
    handled.current = resultId;
    acknowledge.current();
    onDisplayedRef.current?.({
      id: ai.feedbackId ?? crypto.randomUUID(),
      mode: request.mode,
      provider: ai.feedback.provider,
      status: ai.feedback.status,
      ...(ai.feedback.failureReason
        ? { failureReason: ai.feedback.failureReason }
        : {}),
      question: request.question,
      text: ai.feedback.text,
      requestedAt: request.requestedAt,
      displayedAt: new Date().toISOString(),
      ...(promptVersion ? { promptVersion } : {}),
      fallbackUsed:
        request.mode === "gpt" && ai.feedback.provider === "rules",
      evidenceSnapshot: request.evidenceSnapshot,
    });
  }, [inView, resultMatches, resultId, request, ai.feedback]);

  return (
    <section className="execution-ai-panel" aria-label="실행자료 AI 분석">
      <div className="execution-ai-heading">
        <div>
          <span className="execution-ai-eyebrow">
            자료 기반 진단과 AI 튜터 구분
          </span>
          <h3>실행자료로 AI 분석</h3>
        </div>
        <span className="execution-ai-source">{sourceLabel}</span>
      </div>
      <p className="execution-ai-note">
        규칙 진단은 좌표 차이를 계산하고, 튜터는 학생의 설명과 근거를 바탕으로
        질문을 표현합니다. 원인 판정·채점·로봇 제어는 하지 않습니다.
      </p>
      <label className="execution-ai-mode">
        <span>분석 방식</span>
        <select
          value={ai.mode}
          onChange={(event) =>
            setTutorMode(event.target.value as "trial" | "gpt")
          }
          disabled={ai.pending || preparing}
        >
          <option value="trial">기본 체험 · 무료, 외부 AI 호출 없음</option>
          <option value="gpt">실제 GPT · 아래 버튼을 눌렀을 때만 요청</option>
        </select>
      </label>
      <p className="execution-ai-note">
        방식을 바꾸는 것만으로는 요청을 보내지 않습니다. GPT 선택 후 분석 버튼을
        누르면 현재 자료가 외부 AI 서비스로 전송될 수 있습니다.
      </p>
      <button
        type="button"
        className="execution-ai-button"
        disabled={!available || ai.pending || preparing}
        onClick={() => void requestAnalysis()}
      >
        {preparing
          ? "입력 확인·저장 중…"
          : ai.pending
            ? "분석 요청 중…"
            : ai.mode === "gpt"
              ? "실행자료를 GPT에 보내 분석"
              : "기본 체험 분석 보기"}
      </button>
      {actionError && (
        <p className="execution-ai-blocked" role="alert">
          {actionError}
        </p>
      )}
      {!available && (
        <p className="execution-ai-blocked" role="status">
          현재 시도의 완료된 실행과 같은 계획의 유효한 관측이 필요합니다.
          누락·이전 계획·미완료 자료는 분석 근거로 사용할 수 없습니다.
        </p>
      )}
      {resultMatches && ai.feedback && (
        <div
          className="execution-ai-result"
          ref={resultNode}
          data-testid="execution-ai-result"
        >
          <strong>
            {request.mode === "trial"
              ? "기본 체험 응답 · 규칙 기반 · 외부 AI 호출 없음"
              : ai.feedback.provider === "openai" &&
                  ai.feedback.status === "provided"
                ? "실제 GPT 응답"
                : `GPT 분석 미완료 · ${ai.feedback.failureReason ?? ai.feedback.status} · 아래 내용은 GPT 응답이 아닙니다`}
          </strong>
          <p>{ai.feedback.text}</p>
        </div>
      )}
      <details className="execution-ai-evidence">
        <summary>실제 전송 전 근거 미리보기</summary>
        <p>
          잉크 입력은 분석을 누를 때 유효성을 확인해 현재 실행 기록에 먼저
          저장합니다. 아래 자료와 같은 저장본만 요청에 사용하며, 잘못되거나
          저장되지 않은 값은 전송하지 않습니다. 서버가 관리하는 방문 식별자와
          요청 종류는 개인정보 보호를 위해 여기서 제외되며, 서버도 이 입력을
          다시 개인정보 제거합니다.
        </p>
        {visiblePreview ? (
          <pre>{visiblePreview}</pre>
        ) : (
          <p role="status">
            요청 미리보기를 만들지 못했습니다. 저장된 학습 기록은 유지되며
            화면을 계속 사용할 수 있습니다.
          </p>
        )}
      </details>
    </section>
  );
}
