import type { ReactNode } from "react";
import "./paperV6StepShell.css";

export type PaperV6StepShellProps = {
  step: number;
  totalSteps?: number;
  title: string;
  intro: string;
  children: ReactNode;
  canGoBack: boolean;
  canGoNext: boolean;
  nextLabel: string;
  onBack?: () => void;
  onNext?: () => void;
  statusMessage?: string;
  statusKind?: "info" | "success" | "error";
};

export function PaperV6StepShell({
  step,
  totalSteps = 7,
  title,
  intro,
  children,
  canGoBack,
  canGoNext,
  nextLabel,
  onBack,
  onNext,
  statusMessage,
  statusKind = "info",
}: PaperV6StepShellProps) {
  const stepCount = Math.max(1, Math.trunc(totalSteps));
  const currentStep = Math.min(stepCount, Math.max(1, Math.trunc(step)));
  const message = statusMessage?.trim();

  return (
    <section className="paper-v6-shell" aria-labelledby="paper-v6-step-title">
      <header className="paper-v6-shell__header">
        <div className="paper-v6-shell__progress">
          <div className="paper-v6-shell__progress-label">
            <span>종이 좌표 학습</span>
            <strong data-testid="paper-v6-step-count">
              {currentStep} <span aria-hidden="true">/</span> {stepCount}
            </strong>
          </div>
          <progress
            className="paper-v6-shell__progress-bar"
            value={currentStep}
            max={stepCount}
            aria-label={`전체 ${stepCount}단계 중 ${currentStep}단계`}
            data-testid="paper-v6-progress"
          />
        </div>

        <div className="paper-v6-shell__heading">
          <span className="paper-v6-shell__step-mark" aria-hidden="true">
            {String(currentStep).padStart(2, "0")}
          </span>
          <div>
            <h2 id="paper-v6-step-title" data-testid="paper-v6-step-title">
              {title}
            </h2>
            <p className="paper-v6-shell__intro" data-testid="paper-v6-step-intro">
              {intro}
            </p>
          </div>
        </div>
      </header>

      <div className="paper-v6-shell__content" data-testid="paper-v6-step-content">
        {children}
      </div>

      <footer className="paper-v6-shell__footer">
        <div
          className={`paper-v6-shell__status paper-v6-shell__status--${message ? statusKind : "info"}`}
          role={message && statusKind === "error" ? "alert" : "status"}
          aria-live={statusKind === "error" ? "assertive" : "polite"}
          data-testid="paper-v6-status"
        >
          <span className="paper-v6-shell__status-dot" aria-hidden="true" />
          <span className="paper-v6-shell__status-copy">
            <strong>{message ? statusKind === "success" ? "저장됨" : statusKind === "error" ? "확인 필요" : "안내" : "저장 상태"}</strong>
            <span>
              {message ?? "이 단계의 저장 안내가 여기에 표시됩니다."}
            </span>
          </span>
        </div>

        <nav className="paper-v6-shell__navigation" aria-label="단계 이동">
          <button
            type="button"
            className="paper-v6-shell__button paper-v6-shell__button--back"
            onClick={onBack}
            disabled={!canGoBack || !onBack}
            data-testid="paper-v6-back"
          >
            <span aria-hidden="true">←</span>
            <span>이전</span>
          </button>
          <button
            type="button"
            className="paper-v6-shell__button paper-v6-shell__button--next"
            onClick={onNext}
            disabled={!canGoNext || !onNext}
            data-testid="paper-v6-next"
          >
            <span>{nextLabel}</span>
            <span aria-hidden="true">→</span>
          </button>
        </nav>
      </footer>
    </section>
  );
}

export default PaperV6StepShell;
