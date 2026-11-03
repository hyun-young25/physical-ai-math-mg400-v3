import { useMemo, useState, type ReactNode } from "react";
import { PaperV6StepShell } from "./PaperV6StepShell";
import type {
  PaperV6Draft,
  PaperV6FormulaWork,
} from "./paperCoordinateStudy";
import type {
  PaperCoordinateStudyViewActions,
  PaperCoordinateStudyViewState,
} from "./paperCoordinateViewModel";
import { selectPaperFormulaTerm } from "./paperSceneStore";
import "./paperV6StudentLesson.css";

type Props = {
  state: PaperCoordinateStudyViewState;
  actions: PaperCoordinateStudyViewActions;
  blocks: {
    references: ReactNode;
    observationsAndInk: ReactNode;
    analysis: ReactNode;
    teacherDetails?: ReactNode;
  };
};

const numberText = (value: number | undefined) =>
  value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(2);

function field(
  label: string,
  value: string | undefined,
  onChange: (value: string) => void,
  ariaLabel: string,
  testId: string,
) {
  return (
    <label className="paper-v6-field">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value ?? ""}
        aria-label={ariaLabel}
        data-testid={testId}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function linkedFormulaTerm(term: string, label: string) {
  const select = () => selectPaperFormulaTerm(term);
  const clear = () => selectPaperFormulaTerm(null);
  return (
    <span
      className="paper-v6-formula-link"
      role="button"
      tabIndex={0}
      aria-label={`${label} 항을 3D 장면에서 강조`}
      data-formula-term={term}
      onMouseEnter={select}
      onMouseLeave={clear}
      onFocus={select}
      onBlur={clear}
      onTouchStart={select}
      onClick={select}
      onKeyDown={(event) => {
        if (event.key === "Escape") clear();
      }}
    >
      {label}
    </span>
  );
}

export function PaperV6StudentLesson({ state, actions, blocks }: Props) {
  const v6 = state.v6;
  const [editingRevisionModel, setEditingRevisionModel] = useState(false);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"info" | "success" | "error">(
    "info",
  );
  const [selectedSupport, setSelectedSupport] = useState<"guided" | "challenge">(
    v6?.draft.supportMode ?? v6?.supportMode ?? "guided",
  );
  const step = v6?.step ?? state.stage;
  const scene = editingRevisionModel ? 2 : step <= 2 ? 1 : step <= 4 ? 2 : step === 5 ? 3 : step === 6 ? 4 : 5;
  const draft = v6?.draft ?? {};
  const revalidation = state.targetSet === "revalidation";
  const currentModel = v6?.model ?? null;
  const modelForDecision = currentModel ?? state.parentAttempt?.v6?.model ?? null;
  const hasAllReferences = (["O", "X", "Y"] as const).every((point) =>
    state.frame?.samples.some((sample) => sample.point === point),
  );
  const thetaFromDelta = useMemo(() => {
    const dx = Number(draft.deltaXmm);
    const dy = Number(draft.deltaYmm);
    if (
      !draft.deltaXmm?.trim() ||
      !draft.deltaYmm?.trim() ||
      !Number.isFinite(dx) ||
      !Number.isFinite(dy) ||
      Math.hypot(dx, dy) < 1e-6
    )
      return null;
    return (Math.atan2(dy, dx) * 180) / Math.PI;
  }, [draft.deltaXmm, draft.deltaYmm]);
  const targetPoints = state.targetPoints;
  const updateDraft = (patch: Partial<PaperV6Draft>) => {
    const next = { ...draft, ...patch };
    const result = actions.onV6DraftChange?.(next);
    if (result) {
      setMessage(result.message);
      setMessageKind(result.kind ?? "error");
    } else {
      setMessage("입력 내용을 현재 시도 초안으로 저장했습니다.");
      setMessageKind("info");
    }
  };
  const updateWork = (
    point: string,
    key: keyof Omit<PaperV6FormulaWork, "point">,
    value: string,
  ) => {
    updateDraft({
      formulaWork: {
        ...draft.formulaWork,
        [point]: { ...draft.formulaWork?.[point], [key]: value },
      },
    });
  };
  const runAction = (
    action: (() => { message: string; kind?: "info" | "success" | "error" } | null) | undefined,
  ) => {
    const result = action?.();
    if (!result) {
      setMessage("저장했습니다. 입력과 실행 기록은 현재 시도에 연결되어 있습니다.");
      setMessageKind("success");
      return;
    }
    setMessage(result.message);
    setMessageKind(result.kind ?? "error");
  };
  const saveModelAndPrediction = () => {
    const modelResult = actions.onV6SaveModel?.();
    if (modelResult?.kind === "error") {
      setMessage(modelResult.message);
      setMessageKind("error");
      return;
    }
    const predictionResult = actions.onV6SavePrediction?.();
    if (predictionResult) {
      setMessage(predictionResult.message);
      setMessageKind(predictionResult.kind ?? "error");
      return;
    }
    setMessage("학생 모델과 예측을 저장했습니다. 로봇 실행은 다음 장면에서 직접 시작하세요.");
    setMessageKind("success");
  };
  const navigate = (next: number) => {
    if (!actions.onV6Navigate) return;
    const result = actions.onV6Navigate(next);
    if (result) {
      setMessage(result.message);
      setMessageKind(result.kind ?? "error");
      return;
    }
    setMessage("");
    setMessageKind("info");
  };
  const pointCalculation = (point: (typeof targetPoints)[number]) =>
    v6?.formulaWork.find((row) => row.point === point.name);
  const manualPointNames =
    selectedSupport === "challenge"
      ? targetPoints.map((point) => point.name)
      : [targetPoints[0]?.name].filter((name): name is string => !!name);
  const run = state.run;
  const attempt = state.activeAttempt?.attempt ?? 1;
  const latestAi = state.activeAttempt?.aiAnalyses
    ?.filter((item) => item.runId === run?.id && !!item.displayedAt)
    .at(-1);
  const cycleScene = scene === 5 ? (revalidation ? 6 : 5) : scene;
  const cycle = [
    { label: "로봇이 잰다", value: state.frame ? `O·X·Y ${state.frame.samples.length}/3` : "기준점 대기" },
    { label: "내 식으로 예측", value: currentModel ? `θ ${numberText(currentModel.thetaDeg)}°` : "식 입력 대기" },
    { label: "로봇이 그린다", value: run?.status === "completed" ? "실행 완료" : run?.status === "running" ? "실행 중" : "명시 실행 대기" },
    { label: "AI가 묻는다", value: latestAi ? `AI: ${state.diagnosis?.candidate ?? "질문 도착"}` : "요청 전" },
    { label: "내가 판단", value: state.activeAttempt?.v6?.decision === "retain" ? "식 유지" : state.activeAttempt?.v6?.decision === "revise" ? "식 수정" : "판단 대기" },
    { label: "새 점에서 확인", value: v6?.assessment ? v6.assessment.status === "within-tolerance" ? "V 통과" : "V 다시 확인" : revalidation ? "V 실행 준비" : "다음 시도" },
  ];
  const missingReference = (["O", "X", "Y"] as const).find(
    (point) => !state.samples.some((sample) => sample.point === point),
  );
  const referencePrompt = missingReference
    ? `지금 찍을 점: ${missingReference} · 펜 끝을 맞춘 뒤 현재 위치를 기록하세요.`
    : "O·X·Y 기록 완료 · 다음은 내 식으로 예측합니다.";
  const sketchPoint = (xCm: number, yCm: number) => ({
    x: 40 + xCm * 9.6 - yCm * 0.9,
    y: 103 + xCm * 0.9 - yCm * 8,
  });
  const blockerTargets = new Set((state.physicalBlockers ?? []).map((blocker) => blocker.target));
  const readyChecks = [
    { label: "MG400 연결", ok: !blockerTargets.has("connection") },
    { label: "DT로 먼저 확인", ok: !blockerTargets.has("dt") },
    { label: "교사 확인", ok: !blockerTargets.has("teacher") && !blockerTargets.has("criteria") && !blockerTargets.has("height") },
  ];
  const executionControls = (
    <section className="paper-v6-run-controls" aria-label="명시적 실행 선택">
      <div className="paper-v6-run-buttons">
        <button
          type="button"
          className="paper-v6-primary"
          disabled={state.running || !state.runAvailable}
          onClick={actions.onRunDT}
          data-testid="paper-v6-run-dt"
        >
          {state.mockPracticeEnabled
            ? revalidation
              ? "모의 로봇으로 V 연습"
              : "모의 로봇으로 연습 실행"
            : revalidation
              ? "DT에서 다시 검증"
              : "DT에서 실행"}
        </button>
        {!state.mockPracticeEnabled && <button
          type="button"
          className="paper-v6-primary paper-v6-primary--hardware"
          disabled={state.running || !state.physicalAvailable}
          onClick={actions.onRunPhysical}
          data-testid="paper-v6-run-hardware"
        >
          {revalidation ? "실장비에서 다시 검증" : "교사 확인 후 실장비 실행"}
        </button>}
        {state.running && (
          <button
            type="button"
            className="paper-v6-secondary"
            onClick={actions.onStopRun}
            data-testid="paper-v6-stop-run"
          >
            실행 중단
          </button>
        )}
      </div>
      {!state.runAvailable && !state.running && (
        <p className="paper-v6-error" role="status">
          {state.dtBlockers?.[0]?.message ?? "예측을 저장한 뒤 실행할 수 있어요."}
        </p>
      )}
      {state.mockPracticeEnabled ? (
        <p className="paper-v6-callout" data-testid="paper-v6-mock-run-note">
          지금은 연습 로봇이에요. 실제 MG400을 연결하면 이 화면, 이 버튼 그대로 실물 로봇이 움직여요.
        </p>
      ) : (
        <ul className="paper-v6-ready-checks" aria-label="실물 실행 준비" data-testid="paper-v6-ready-checks">
          {readyChecks.map((check) => (
            <li key={check.label} className={check.ok ? "is-ok" : "is-pending"}>
              <span aria-hidden="true">{check.ok ? "✓" : "○"}</span>
              {check.label}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  if (!v6) return null;

  const sceneTitles = [
    "종이가 어디 있지?",
    "내 식으로 예측하기",
    "로봇이 그려요",
    "비교하고 AI에게 묻기",
    "고칠까, 유지할까? → 새 점에서 확인",
  ];
  const sceneIntros = [
    "로봇이 종이의 O·X·Y를 읽고, 종이와 로봇 좌표의 차이를 살펴봅니다.",
    "O와 회전각으로 내 식을 세우고, 목표점을 직접 계산합니다.",
    "저장된 학생 예측을 확인한 뒤 DT 또는 교사 감독 실장비를 직접 실행합니다.",
    "예측·제어기 보고·잉크를 구분해 비교하고, 현재 실행에 대해 AI에게 묻습니다.",
    "추가 근거로 모델을 판단하고, 독립점 V에서 다시 확인합니다.",
  ];
  const advance = () => {
    if (scene === 1) navigate(3);
    else if (scene === 2) {
      if (editingRevisionModel) setEditingRevisionModel(false);
      else saveModelAndPrediction();
    } else if (scene === 3) navigate(6);
    else if (scene === 4) navigate(7);
  };
  const goBack = () => {
    if (scene === 2 && editingRevisionModel) {
      setEditingRevisionModel(false);
      return;
    }
    if (scene === 2) navigate(step === 4 ? 3 : 2);
    else if (scene === 3) navigate(4);
    else if (scene === 4) navigate(5);
    else if (scene === 5) navigate(6);
  };

  return (
    <div
      className="paper-v6-student"
      data-scene={scene}
      data-testid="paper-v6-student-flow"
    >
      <nav className="paper-v6-cycle" aria-label="물리 AI 학습 순환" data-testid="paper-v6-cycle">
        <div className="paper-v6-cycle__meta">
          <span>{attempt > 1 ? `${attempt}회차` : "첫 시도"}</span>
          <strong>측정 → 예측 → 실행 → 질문 → 판단 → 새 점 검증</strong>
        </div>
        <ol>
          {cycle.map((item, index) => (
            <li key={item.label} className={cycleScene === index + 1 ? "is-current" : ""} data-current={cycleScene === index + 1} data-testid={`paper-v6-cycle-${index + 1}`}>
              <span className="paper-v6-cycle__number">0{index + 1}</span>
              <span className="paper-v6-cycle__label">{item.label}</span>
              <small>{item.value}</small>
            </li>
          ))}
        </ol>
      </nav>
      <PaperV6StepShell
        step={scene}
        totalSteps={5}
        title={sceneTitles[scene - 1]}
        intro={sceneIntros[scene - 1]}
        canGoBack={scene > 1 && !state.running}
        canGoNext={scene < 5 && !state.running && (scene !== 1 || hasAllReferences)}
        nextLabel={scene === 2 ? editingRevisionModel ? "판단 화면으로 돌아가기" : "모델과 예측 저장" : scene === 3 ? "비교하기" : scene === 4 ? "판단 이어가기" : "기준점 확인 후 계속"}
        onBack={goBack}
        onNext={advance}
        statusMessage={state.error?.trim() || message?.trim() || undefined}
        statusKind={state.error?.trim() ? "error" : messageKind}
      >
        {scene === 1 && (
          <div className="paper-v6-step" data-testid="paper-v6-understand">
            <div className="paper-v6-coordinate-pair">
              <section aria-label="로봇 좌표계 A">
                <h3><span className="paper-v6-role">🤖 로봇</span> 좌표계 {`{A}`}</h3>
                <svg viewBox="0 0 180 130" role="img" aria-label="로봇 X와 Y 축">
                  <path d="M28 104H154M28 104V20" />
                  <path d="m154 104-9-5m9 5-9 5M28 20l-5 9m5-9 5 9" />
                  <text x="158" y="108">X mm</text>
                  <text x="32" y="20">Y mm</text>
                  <circle cx="28" cy="104" r="4" />
                  <text x="10" y="124">원점 O</text>
                </svg>
              </section>
              <section aria-label="종이 좌표계 B">
                <h3><span className="paper-v6-role">🧮 계산</span> 종이 좌표계 {`{B}`}</h3>
                <svg viewBox="0 0 180 140" role="img" aria-label="비스듬한 10 곱하기 10 센티미터 종이와 O X Y 기준점">
                  <polygon className="paper-v6-paper-shape" points="40,103 136,112 127,32 31,23" />
                  <path className="paper-v6-paper-grid" d="M50 104L41 24M69 106L60 26M88 108L79 28M107 109L98 30M40 103L127 32M59 105L108 33M78 107L89 34M97 109L70 35M116 110L50 34" />
                  {targetPoints.map((point) => {
                    const position = sketchPoint(point.xCm, point.yCm);
                    return <g key={point.name} className="paper-v6-target-marker">
                      <circle cx={position.x} cy={position.y} r="2.2" />
                      <text x={position.x + 3} y={position.y - 3}>{point.name}</text>
                    </g>;
                  })}
                  {([
                    ["O", 0, 0],
                    ["X", 10, 0],
                    ["Y", 0, 10],
                  ] as const).map(([name, xCm, yCm]) => {
                    const position = sketchPoint(xCm, yCm);
                    const measured = state.samples.some((sample) => sample.point === name);
                    return <g key={name} className={`paper-v6-reference-marker${measured ? " is-measured" : ""}`} data-testid={`paper-v6-diagram-point-${name}`}>
                      <circle cx={position.x} cy={position.y} r="4" />
                      <text x={position.x - 8} y={position.y + (name === "Y" ? -7 : 13)}>{name}</text>
                    </g>;
                  })}
                  <path className="paper-v6-paper-axis" d="M40 103L136 112M40 103L31 23" />
                  <text x="70" y="132">10 cm</text>
                  <text x="3" y="65">10 cm</text>
                  <text x="42" y="15">비스듬한 종이 · 예시</text>
                </svg>
              </section>
            </div>
            <p className="paper-v6-paper-note paper-v6-paper-note--lead">
              로봇은 종이가 어디 있는지 몰라요. 내가 세운 식이 로봇 펜이 갈 곳을 정해요.
              그래서 먼저 로봇 팔로 종이의 O·X·Y를 재요.
            </p>
            <p className="paper-v6-reference-prompt" role="status" data-testid="paper-v6-current-reference">
              {referencePrompt}
            </p>
            <section className="paper-v6-live-points" aria-label="현재 O X Y 측정값" data-testid="paper-v6-live-points">
              <div className="paper-v6-section-heading">
                <span className="paper-v6-role">🤖 로봇</span>
                <div><h3>종이의 O · X · Y</h3></div>
              </div>
              <div className="paper-v6-live-points__grid">
                {(["O", "X", "Y"] as const).map((name) => {
                  const sample = state.samples.find((row) => row.point === name);
                  return <article key={name} data-testid={`paper-v6-live-point-${name}`}>
                    <strong>{name}</strong>
                    {sample ? <p>X {sample.pose.x.toFixed(2)} · Y {sample.pose.y.toFixed(2)} mm</p> : <p>측정 대기</p>}
                    <small>{sample ? `${sample.source === "hardware" ? "MG400 TCP" : sample.source === "mock" ? "연습 자료" : "교사 입력"}` : "기록 전"}</small>
                  </article>;
                })}
              </div>
            </section>
            <button
              type="button"
              className="paper-v6-reference-record"
              disabled={!missingReference || state.running || !state.currentPose}
              onClick={() => {
                if (missingReference)
                  actions.onRecordCurrentReference(missingReference);
              }}
              data-testid="paper-v6-record-current-reference"
            >
              {missingReference
                ? `현재 위치를 ${missingReference}로 기록`
                : "O · X · Y 기록 완료"}
            </button>
            {!hasAllReferences && (
              <p className="paper-v6-hint" data-testid="paper-v6-references-required">
                O·X·Y 세 점을 모두 기록하면 다음 장면으로 넘어가요.
              </p>
            )}
            {state.referenceError && (
              <p className="paper-v6-error" role="status">
                {state.referenceError}
              </p>
            )}
            <details className="paper-v6-teacher-prep" data-testid="paper-v6-teacher-prep">
              <summary>교사 준비</summary>
              <label className="paper-v6-mock-switch">
                <input
                  type="checkbox"
                  aria-label="장비 없이 연습 모의 로봇"
                  checked={state.mockPracticeEnabled}
                  disabled={
                    !state.mockPracticeEnabled &&
                    !!state.mockPracticeReason
                  }
                  onChange={(event) =>
                    actions.onToggleMockPractice(event.target.checked)
                  }
                />
                <span>장비 없이 연습(모의 로봇)</span>
              </label>
              {state.mockPracticeEnabled ? (
                <p className="paper-v6-mock-note">
                  연습 자료 · 실제 MG400 명령이나 실측 기록은 만들지 않습니다.
                </p>
              ) : state.mockPracticeReason ? (
                <p className="paper-v6-error" role="status">
                  {state.mockPracticeReason}
                </p>
              ) : null}
              {blocks.references}
            </details>
          </div>
        )}

        {scene === 2 && (step === 3 || step === 4 || editingRevisionModel) && (
          <div className="paper-v6-step" data-testid="paper-v6-model">
            {!state.frame && (
              <p className="paper-v6-error">
                O/X/Y 제어기 보고가 먼저 필요합니다. 이전 단계로 돌아가 기준점을
                기록하세요.
              </p>
            )}
            <div className="paper-v6-form-grid">
              {field("O의 로봇 X (mm)", draft.originXmm, (value) => updateDraft({ originXmm: value }), "학생 모델 O X mm", "paper-v6-origin-x")}
              {field("O의 로봇 Y (mm)", draft.originYmm, (value) => updateDraft({ originYmm: value }), "학생 모델 O Y mm", "paper-v6-origin-y")}
              {editingRevisionModel ? (
                <p className="paper-v6-hint paper-v6-model-reference" data-testid="paper-v6-revision-deltas">
                  기존 O→X 변화량은 고정된 기준으로 사용합니다: ΔX {draft.deltaXmm || "—"} mm · ΔY {draft.deltaYmm || "—"} mm
                </p>
              ) : (
                <>
                  {field("O→X의 ΔX (mm)", draft.deltaXmm, (value) => updateDraft({ deltaXmm: value }), "학생이 계산한 O X 델타 mm", "paper-v6-delta-x")}
                  {field("O→X의 ΔY (mm)", draft.deltaYmm, (value) => updateDraft({ deltaYmm: value }), "학생이 계산한 O X 세로 델타 mm", "paper-v6-delta-y")}
                </>
              )}
            </div>
            <p className="paper-v6-equation">θ = tan⁻¹(ΔY / ΔX)</p>
            <div className="paper-v6-form-grid">
              {field("내가 구한 θ (도)", draft.thetaDeg, (value) => updateDraft({ thetaDeg: value }), "학생이 구한 회전각 도", "paper-v6-theta")}
              <button
                type="button"
                className="paper-v6-secondary"
                onClick={() =>
                  thetaFromDelta === null
                    ? (setMessage("ΔX와 ΔY를 확인하세요. 둘 다 0이면 각도를 계산할 수 없습니다."), setMessageKind("error"))
                    : updateDraft({ thetaDeg: thetaFromDelta.toFixed(2) })
                }
                disabled={thetaFromDelta === null}
                data-testid="paper-v6-angle-calculator"
              >
                tan⁻¹ 계산값을 입력칸에 넣기
              </button>
            </div>
            {thetaFromDelta !== null && (
              <p className="paper-v6-hint">
                각도 계산기 결과: {thetaFromDelta.toFixed(2)}° · O→X 방향
              </p>
            )}
            <fieldset className="paper-v6-choice">
              <legend>종이가 로봇 축과 나란하다는 가정을 사용할까요?</legend>
              <label>
                <input
                  type="radio"
                  name="paper-v6-theta-assumption"
                  checked={(draft.thetaAssumption ?? "calculated") === "calculated"}
                  onChange={() => updateDraft({ thetaAssumption: "calculated" })}
                />
                입력한 θ 사용
              </label>
              <label>
                <input
                  type="radio"
                  name="paper-v6-theta-assumption"
                  checked={draft.thetaAssumption === "zero"}
                  onChange={() =>
                    updateDraft({ thetaAssumption: "zero", thetaDeg: "0" })
                  }
                />
                θ=0 가정으로 진행
              </label>
            </fieldset>
            {draft.thetaAssumption === "zero" && (
              <p className="paper-v6-hint">
                θ=0 가정을 기록합니다. 측정된 O–X 방향과 차이가 있어도 실행 후 비교할 수
                있습니다.
              </p>
            )}
            <section
              className="paper-v6-lift-gap"
              aria-labelledby="paper-v6-lift-gap-heading"
              data-testid="paper-v6-lift-gap"
            >
              <div className="paper-v6-lift-gap__intro">
                <h3 id="paper-v6-lift-gap-heading">
                  <span className="paper-v6-role">🤖 로봇</span>
                  펜 들기 간격
                </h3>
                <p>
                  종이 표면에서 펜을 띄울 거리입니다. 종이 표면 Z에 더해 이동 높이를
                  계산합니다.
                </p>
              </div>
              <label className="paper-v6-field">
                <span>펜 들기 간격 (mm)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label="펜 들기 간격 mm"
                  data-testid="paper-v6-lift-gap-input"
                  value={state.liftGapInput ?? ""}
                  disabled={state.running || state.run?.status === "running"}
                  onChange={(event) =>
                    actions.onLiftGapChange?.(event.target.value)
                  }
                  placeholder="예: 10"
                />
              </label>
              <p
                className="paper-v6-lift-gap__status"
                role="status"
                aria-live="polite"
                data-testid="paper-v6-lift-gap-status"
              >
                {state.liftGapSaved &&
                typeof state.liftGapMm === "number" &&
                state.paperSurfaceZ !== null
                  ? `저장됨 · 종이 표면 Z ${numberText(state.paperSurfaceZ)} mm + 간격 ${numberText(state.liftGapMm)} mm = 이동 기준 Z ${numberText(state.paperSurfaceZ + state.liftGapMm)} mm`
                  : state.paperSurfaceZ === null
                    ? "O/X/Y 기록 후 종이 표면 Z에 이 간격을 더해 이동 높이를 계산합니다."
                    : state.mockPracticeEnabled
                      ? "모의 연습은 미입력 시 연습용 30 mm를 씁니다. 실장비 실행 전에는 간격을 직접 저장해야 합니다."
                      : "양수 간격을 입력하면 현재 시도에 저장됩니다. 저장되지 않은 값은 실장비 실행에 사용되지 않습니다."}
              </p>
              {state.liftGapSaved &&
                state.currentPose &&
                state.liftHeight !== null &&
                state.currentPose.z > state.liftHeight && (
                  <p className="paper-v6-hint">
                    현재 시작 Z {numberText(state.currentPose.z)} mm가 계산된 이동 높이보다
                    높아 그대로 유지합니다.
                  </p>
                )}
              {state.liftRecordFeedback && (
                <p className="paper-v6-lift-gap__feedback" role="status" aria-live="polite">
                  {state.liftRecordFeedback}
                </p>
              )}
            </section>
            {state.frame && (
              <details className="paper-v6-details">
                <summary>Y점 방향·축척 참고</summary>
                <p>
                  O–Y: {Math.hypot(
                    state.frame.samples.find((sample) => sample.point === "Y")!.pose.x -
                      state.frame.samples.find((sample) => sample.point === "O")!.pose.x,
                    state.frame.samples.find((sample) => sample.point === "Y")!.pose.y -
                      state.frame.samples.find((sample) => sample.point === "O")!.pose.y,
                  ).toFixed(2)} mm (약 100 mm 참고) · O–X와 O–Y의 직각 편차는 별도 참고입니다.
                  이 값은 학생 식을 자동 변경하거나 실행을 막지 않습니다.
                </p>
              </details>
            )}
          </div>
        )}

        {scene === 2 && !editingRevisionModel && (
          <div className="paper-v6-step" data-testid="paper-v6-prediction">
            <label className="paper-v6-field">
              <span>계산 연습</span>
              <select
                aria-label="예측 계산 지원 모드"
                value={selectedSupport}
                onChange={(event) => {
                  const value = event.target.value as "guided" | "challenge";
                  setSelectedSupport(value);
                  updateDraft({ supportMode: value });
                }}
              >
                <option value="guided">기본 지원 · P1만 직접 대입</option>
                <option value="challenge">도전 · P1~P4 모두 직접 계산</option>
              </select>
            </label>
            <p className="paper-v6-equation">
              x = {linkedFormulaTerm("originX", "xO")} + {linkedFormulaTerm("aCos", "a·cosθ")} − {linkedFormulaTerm("bSin", "b·sinθ")}
              <br />
              y = {linkedFormulaTerm("originY", "yO")} + {linkedFormulaTerm("aSin", "a·sinθ")} + {linkedFormulaTerm("bCos", "b·cosθ")}
              <small>a, b는 종이 좌표를 mm로 바꾼 값입니다. 1 cm = 10 mm.</small>
            </p>
            {!v6?.model && (
              <p className="paper-v6-callout" data-testid="paper-v6-model-pending">
                O와 θ를 입력하면 아래 버튼 한 번으로 모델과 예측을 순서대로 저장합니다.
              </p>
            )}
            <div className="paper-v6-points">
              {targetPoints.map((point, index) => {
                const work = pointCalculation(point);
                const manual = manualPointNames.includes(point.name);
                return (
                  <fieldset className="paper-v6-point" key={point.name}>
                    <legend>
                      {point.name} · 종이 ({point.xCm}, {point.yCm}) cm
                    </legend>
                    {manual ? (
                      <div className="paper-v6-form-grid">
                        {field(`${point.name} a·cosθ`, draft.formulaWork?.[point.name]?.aCos, (value) => updateWork(point.name, "aCos", value), `${point.name} a 코사인 세타`, `paper-v6-${point.name}-acos`)}
                        {field(`${point.name} b·sinθ`, draft.formulaWork?.[point.name]?.bSin, (value) => updateWork(point.name, "bSin", value), `${point.name} b 사인 세타`, `paper-v6-${point.name}-bsin`)}
                        {field(`${point.name} a·sinθ`, draft.formulaWork?.[point.name]?.aSin, (value) => updateWork(point.name, "aSin", value), `${point.name} a 사인 세타`, `paper-v6-${point.name}-asin`)}
                        {field(`${point.name} b·cosθ`, draft.formulaWork?.[point.name]?.bCos, (value) => updateWork(point.name, "bCos", value), `${point.name} b 코사인 세타`, `paper-v6-${point.name}-bcos`)}
                        {field(`${point.name} 최종 X (mm)`, draft.formulaWork?.[point.name]?.robotX, (value) => updateWork(point.name, "robotX", value), `${point.name} 계산한 로봇 X mm`, `paper-v6-${point.name}-x`)}
                        {field(`${point.name} 최종 Y (mm)`, draft.formulaWork?.[point.name]?.robotY, (value) => updateWork(point.name, "robotY", value), `${point.name} 계산한 로봇 Y mm`, `paper-v6-${point.name}-y`)}
                      </div>
                    ) : (
                      <p className="paper-v6-generated" data-testid={`paper-v6-generated-${point.name}`}>
                        내 식으로 계산 · X {numberText(v6?.predictions?.[index] ? Number(v6.predictions[index].robotX) : undefined)} mm · Y {numberText(v6?.predictions?.[index] ? Number(v6.predictions[index].robotY) : undefined)} mm
                      </p>
                    )}
                    {work && (
                      <small>
                        {manual ? "입력한 대입값이 학생의 O·θ 식과 일치합니다." : "학생이 저장한 식으로 계산한 목표입니다."}
                      </small>
                    )}
                  </fieldset>
                );
              })}
            </div>
            <label className="paper-v6-field">
              <span>왜 이 좌표를 예측했나요? 한두 문장</span>
              <textarea
                aria-label="최초 예측 설명"
                rows={2}
                value={draft.explanation ?? ""}
                onChange={(event) => updateDraft({ explanation: event.target.value })}
                data-testid="paper-v6-explanation"
              />
            </label>
            {v6?.predictionError && (
              <p className="paper-v6-error" role="alert">{v6.predictionError}</p>
            )}
            {v6?.predictions && (
              <p className="paper-v6-callout" role="status">
                {v6.supportMode === "guided"
                  ? "P1 계산을 확인했습니다. P2~P4는 저장된 내 식으로 계산했습니다."
                  : "P1~P4 직접 계산을 확인했습니다."}
              </p>
            )}
          </div>
        )}

        {scene === 3 && step === 5 && (
          <div className="paper-v6-step" data-testid="paper-v6-run">
            <p className="paper-v6-callout">
              로봇은 내 식이 가리키는 곳에 펜을 찍어요. 종이 밖을 가리키면 펜을 든 채 지나가요.
              {state.verificationCriteria && ` 판정 기준: ±${state.verificationCriteria.positionToleranceMm.toFixed(1)} mm`}
            </p>
            {executionControls}
            {run && (
              <section className="paper-v6-run-result" aria-label="현재 실행 상태">
                <h3>🤖 로봇 실행</h3>
                <p>
                  {run.status === "completed" ? "완료 · 다음 장면에서 비교해요" : run.status === "running" ? "그리는 중…" : "끝나지 않았어요 · 다시 실행하세요"}
                </p>
                <small>
                  {run.source === "hardware"
                    ? "MG400 실물"
                    : state.mockPracticeEnabled
                      ? "연습 로봇"
                      : "DT 미리보기"}
                  {" · "}찍은 점 {run.observations.length}/{run.commands.length}
                </small>
                {run.error && <p className="paper-v6-error">{run.error}</p>}
              </section>
            )}
          </div>
        )}

        {scene === 4 && step === 6 && (
          <div className="paper-v6-step" data-testid="paper-v6-interpret">
            <div className="paper-v6-source-legend" aria-label="자료 출처">
              <span>🧮 학생 모델 예측</span>
              {state.mockPracticeEnabled ? (
                <span>🤖 연습 자료 · 모의 TCP/잉크</span>
              ) : (
                <>
                  <span>🤖 제어기 TCP 보고</span>
                  <span>🙋 학생 수기 잉크 · cm</span>
                </>
              )}
            </div>
            {blocks.observationsAndInk}
            <section className="paper-v6-ai-card">
              <div className="paper-v6-section-heading">
                <span className="paper-v6-role">💬 AI</span>
                <div><h3>현재 실행에 대해 묻기</h3><p>원인 후보를 적고, 직접 요청할 때만 답변을 받습니다.</p></div>
              </div>
              {blocks.analysis}
            </section>
            {state.diagnosis && (
              <p className="paper-v6-callout" data-testid="paper-v6-rule-diagnosis">
                규칙 계산은 원인 후보를 제안할 뿐 원인을 단정하지 않습니다.{" "}
                {state.diagnosis.estimatedRotationDifferenceDeg != null && (
                  <>
                    O→X 회전 차이 추정{" "}
                    {state.diagnosis.estimatedRotationDifferenceDeg.toFixed(1)}°{" "}
                  </>
                )}
                {state.diagnosis.candidate} 질문: {state.diagnosis.question}
              </p>
            )}
            <section className="paper-v6-followup-card" aria-label="추가 확인 기록">
              <div className="paper-v6-section-heading">
                <span className="paper-v6-role">🙋 나</span>
                <div><h3>AI 질문 뒤에 더 확인한 것</h3><p>확인 항목과 관찰 결과를 초안으로 남깁니다.</p></div>
              </div>
              <fieldset className="paper-v6-choice">
                <legend>무엇을 추가로 확인했나요? 하나 이상 선택</legend>
                {[
                  ["remeasure-y", "Y점을 다시 측정"],
                  ["review-ox-direction", "O→X 방향을 다시 봄"],
                  ["remeasure-ink", "잉크 위치를 다시 측정"],
                  ["substitute-one-point", "내 식에 한 점을 대입해 검산"],
                  ["check-units", "cm와 mm 단위를 확인"],
                ].map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="checkbox"
                      checked={draft.followupChecks?.includes(value as NonNullable<PaperV6Draft["followupChecks"]>[number]) ?? false}
                      onChange={(event) => {
                        const current = draft.followupChecks ?? [];
                        const next = event.target.checked
                          ? [...current, value as NonNullable<PaperV6Draft["followupChecks"]>[number]]
                          : current.filter((item) => item !== value);
                        updateDraft({ followupChecks: next });
                      }}
                      data-testid={`paper-v6-followup-check-${value}`}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <label className="paper-v6-field">
                <span>추가로 확인한 결과 · 한 줄</span>
                <textarea
                  aria-label="추가 확인 결과"
                  rows={2}
                  value={draft.followupResult ?? ""}
                  onChange={(event) => updateDraft({ followupResult: event.target.value })}
                  data-testid="paper-v6-followup-result"
                />
              </label>
            </section>
          </div>
        )}

        {scene === 5 && step === 7 && !revalidation && (
          <div className="paper-v6-step" data-testid="paper-v6-revise">
            <p className="paper-v6-callout" data-testid="paper-v6-support-level">
              도움 단계 {v6?.supportLevel ?? 1}/3 ·{" "}
              {(v6?.supportLevel ?? 1) === 1
                ? "관측 질문: 선택한 추가 확인 결과가 내 설명과 어떻게 연결되나요?"
                : (v6?.supportLevel ?? 1) === 2
                  ? "관계 힌트: O의 위치 변화와 O→X 방향 변화를 따로 비교해 보세요."
                  : "예시와 교사 도움: 목표점이 아닌 종이 (5,0), (0,5) cm를 식에 넣어 회전 항의 부호를 확인해 보세요. 필요하면 교사에게 함께 확인을 요청하세요."}
            </p>
            <details className="paper-v6-details">
              <summary>현재 모델과 판단 근거</summary>
              <p>
                O=({numberText(modelForDecision?.originXmm)}, {numberText(modelForDecision?.originYmm)}) mm ·
                θ {numberText(modelForDecision?.thetaDeg)}° · 가정{" "}
                {modelForDecision?.thetaAssumption === "zero" ? "θ=0" : "계산한 θ"}
              </p>
            </details>
            <section className="paper-v6-followup-summary" aria-label="Scene 4에 저장한 추가 확인">
              <strong>추가 확인 기록</strong>
              <p>{draft.followupChecks?.length ? draft.followupChecks.join(" · ") : "Scene 4에서 확인 항목을 선택하세요."}</p>
              <p>{draft.followupResult?.trim() || "관찰 결과가 아직 기록되지 않았습니다."}</p>
            </section>
            <fieldset className="paper-v6-decision">
              <legend>모델 판단 · 근거가 있는 쪽을 선택하세요</legend>
              <div className="paper-v6-decision-buttons" role="group" aria-label="모델 판단 선택">
                <button
                  type="button"
                  className={`paper-v6-decision-button${(draft.decision ?? "revise") === "revise" ? " is-selected" : ""}`}
                  aria-pressed={(draft.decision ?? "revise") === "revise"}
                  onClick={() => updateDraft({ decision: "revise" })}
                  data-testid="paper-v6-decision-revise"
                >
                  <strong>식 고치기</strong>
                  <small>O 또는 θ를 바꿔 새 시도에서 확인</small>
                </button>
                <button
                  type="button"
                  className={`paper-v6-decision-button${draft.decision === "retain" ? " is-selected" : ""}`}
                  aria-pressed={draft.decision === "retain"}
                  onClick={() => updateDraft({ decision: "retain" })}
                  data-testid="paper-v6-decision-retain"
                >
                  <strong>식 유지</strong>
                  <small>현재 식을 유지하고 새 점에서 확인</small>
                </button>
              </div>
            </fieldset>
            {(draft.decision ?? "revise") === "revise" && (
              <section className="paper-v6-revision-preview" data-testid="paper-v6-revision-preview">
                <p>수정 초안 · O=({draft.originXmm || "—"}, {draft.originYmm || "—"}) mm · θ {draft.thetaDeg || "—"}°</p>
                <button
                  type="button"
                  className="paper-v6-secondary paper-v6-revise-model"
                  onClick={() => setEditingRevisionModel(true)}
                  data-testid="paper-v6-edit-revision-model"
                >
                  🧮 수정할 O·θ와 식 다시 살펴보기
                </button>
              </section>
            )}
            <label className="paper-v6-field">
              <span>유지 또는 수정 근거</span>
              <textarea
                aria-label="모델 판단 근거"
                rows={2}
                value={draft.decisionReason ?? draft.revisionReason ?? ""}
                onChange={(event) => updateDraft({
                  decisionReason: event.target.value,
                  revisionReason: event.target.value,
                })}
              />
            </label>
            {v6?.modelError && <p className="paper-v6-error">{v6.modelError}</p>}
            <button
              type="button"
              className="paper-v6-primary"
              disabled={state.running}
              onClick={() => runAction(actions.onV6CreateRevalidation)}
              data-testid="paper-v6-create-revalidation"
            >
              추가 근거와 판단 저장 후 V 시도 만들기
            </button>
          </div>
        )}

        {scene === 5 && step === 7 && revalidation && (
          <div className="paper-v6-step" data-testid="paper-v6-revalidate">
            <details className="paper-v6-details">
              <summary>이전 모델과 새 모델 · 시도 연결</summary>
              <p>
                이전 시도 {state.parentAttempt?.attempt ?? "—"}회차 · O=(
                {numberText(state.parentAttempt?.v6?.model?.originXmm)}, {numberText(state.parentAttempt?.v6?.model?.originYmm)}) mm ·
                θ {numberText(state.parentAttempt?.v6?.model?.thetaDeg)}°
              </p>
              <p>
                이번 시도 {attempt}회차 · O=({numberText(currentModel?.originXmm)}, {numberText(currentModel?.originYmm)}) mm ·
                θ {numberText(currentModel?.thetaDeg)}° · V=(5, 6) cm
              </p>
              <p>{state.parentAttempt?.v6?.decisionReason ?? "이전 판단 근거 없음"}</p>
              <p>{state.parentAttempt?.v6?.followupResult ?? "추가 확인 기록 없음"}</p>
              <ol className="paper-v6-attempt-chain" aria-label="연결된 시도 기록">
                {v6?.attemptChain.map((record) => (
                  <li key={record.id} data-testid={`paper-v6-attempt-${record.attempt}`}>
                    <strong>{record.attempt}회차 · {record.targetSet === "revalidation" ? "독립점 검증" : "첫 목표"}</strong>
                    <span>
                      O ({numberText(record.v6?.model?.originXmm)}, {numberText(record.v6?.model?.originYmm)}) mm ·
                      θ {numberText(record.v6?.model?.thetaDeg)}°
                    </span>
                  </li>
                ))}
              </ol>
            </details>
            <div className="paper-v6-criteria">
              <strong><span className="paper-v6-role">🧮 계산</span> 독립점 V=(5, 6) cm</strong>
              <span>사전 기준 ±2.0 mm · 모델 구성점 O/X/Y 및 P1~P4와 다른 위치</span>
              <small>TCP는 제어기 위치 보고, 잉크는 학생이 종이에서 읽은 값입니다.</small>
            </div>
            {!state.activeAttempt?.planHash && (
              <>
                <p className="paper-v6-callout">
                  새 시도에서 저장된 학생 식으로 V 목표를 계산합니다. 저장만으로 로봇은 움직이지 않습니다.
                </p>
                <button
                  type="button"
                  className="paper-v6-primary"
                  onClick={() => runAction(actions.onV6SaveRevalidationPlan)}
                  data-testid="paper-v6-save-v-plan"
                >
                  내 식으로 V 예측과 사전 기준 저장
                </button>
              </>
            )}
            {state.activeAttempt?.planHash && (
              <>
                {executionControls}
                <div className="paper-v6-role-note"><span className="paper-v6-role">🤖 로봇</span><span>새 시도에서만 DT 또는 교사 감독 실장비 실행을 시작합니다.</span></div>
                {blocks.observationsAndInk}
                {v6?.assessment && (
                  <p
                    className={v6.assessment.status === "within-tolerance" ? "paper-v6-success" : "paper-v6-callout"}
                    role="status"
                    data-testid="paper-v6-v-assessment"
                  >
                    {v6.assessment.message}
                  </p>
                )}
                <fieldset className="paper-v6-choice">
                  <legend><span className="paper-v6-role">🙋 나</span> O와 X가 맞아도 다른 위치를 확인해야 하는 이유는?</legend>
                  <label><input type="radio" name="paper-v6-final-question" checked={draft.finalQuestionAnswer === "model-points"} onChange={() => updateDraft({ finalQuestionAnswer: "model-points" })} /> 모델을 만드는 데 쓴 점이라 일치해도 다른 위치에서 성립하는지는 알 수 없다.</label>
                  <label><input type="radio" name="paper-v6-final-question" checked={draft.finalQuestionAnswer === "independent-point"} onChange={() => updateDraft({ finalQuestionAnswer: "independent-point" })} /> 두 점이 맞으면 다른 위치도 자동으로 맞는다.</label>
                </fieldset>
                <button
                  type="button"
                  className="paper-v6-primary"
                  disabled={state.running}
                  onClick={() =>
                    runAction(() =>
                      actions.onV6Finalize?.({
                        finalQuestionAnswer:
                          draft.finalQuestionAnswer ?? "model-points",
                      }) ?? null,
                    )
                  }
                  data-testid="paper-v6-finalize"
                >
                  V 실물 재검증과 판단 저장
                </button>
              </>
            )}
          </div>
        )}
      </PaperV6StepShell>
      <details className="paper-v6-details paper-v6-teacher-details" data-testid="paper-v6-teacher-details">
        <summary>교사용 상세</summary>
        <p>수업 기록과 진단 정보를 확인하거나 현재 시도 연결 기록을 JSON으로 내보냅니다.</p>
        <div className="paper-v6-teacher-details__facts">
          <span>연구 버전: {state.activeAttempt?.taskVersion ?? "—"}</span>
          <span>시도: {attempt}회차</span>
          <span>현재 기록 ID: {state.activeAttempt?.id ?? "—"}</span>
          <span>부모 기록 ID: {state.activeAttempt?.parentAttemptId ?? "없음"}</span>
          <span>기준 프레임 ID: {state.frame?.id ?? "—"}</span>
          <span>실행 ID: {run?.id ?? "—"}</span>
        </div>
        {state.verificationCriteria && (
          <p data-testid="paper-v6-criteria">
            사전 고정 기준 ±{state.verificationCriteria.positionToleranceMm.toFixed(1)} mm · 독립 확인점{" "}
            {state.verificationCriteria.independentVerificationPoints.join(", ") || "없음"} · {state.verificationCriteria.rationale}
          </p>
        )}
        {(state.physicalBlockers?.length ?? 0) > 0 && (
          <p>실장비 차단 사유: {state.physicalBlockers!.map((blocker) => blocker.message).join(" · ")}</p>
        )}
        {state.diagnosis && <p>진단: {state.diagnosis.candidate} · {state.diagnosis.question} · {state.diagnosis.why}</p>}
        {blocks.teacherDetails}
        <button type="button" className="paper-v6-export" onClick={actions.onV6Export} data-testid="paper-v6-export">
          현재 시도와 연결된 JSON 내보내기
        </button>
      </details>
    </div>
  );
}

