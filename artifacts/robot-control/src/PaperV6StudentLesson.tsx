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
import "./paperV6StudentLesson.css";

type Props = {
  state: PaperCoordinateStudyViewState;
  actions: PaperCoordinateStudyViewActions;
  blocks: {
    references: ReactNode;
    observationsAndInk: ReactNode;
    analysis: ReactNode;
  };
};

const fieldOrder: Array<[keyof Omit<PaperV6FormulaWork, "point">, string]> = [
  ["aCos", "a·cosθ"],
  ["bSin", "b·sinθ"],
  ["aSin", "a·sinθ"],
  ["bCos", "b·cosθ"],
  ["robotX", "목표 X"],
  ["robotY", "목표 Y"],
];
const steps = [
  {
    title: "과제와 두 좌표계",
    intro: "종이 좌표를 학생의 회전·평행이동 식으로 로봇 좌표에 연결합니다.",
  },
  {
    title: "O·X·Y 기준점 측정",
    intro: "MG400이 보고한 세 점으로 종이의 실제 배치를 기록합니다.",
  },
  {
    title: "좌표 관계와 회전각",
    intro: "O에서 X까지의 변화량으로 각도를 계산하거나 θ=0 가정을 선택합니다.",
  },
  {
    title: "내 식으로 P1~P4 예측",
    intro: "P1 식을 직접 대입해 검산합니다. 다른 점은 저장한 내 식으로 계산합니다.",
  },
  {
    title: "실행하기",
    intro: "저장한 학생 예측을 DT 또는 안전 준비가 끝난 실장비에서 실행합니다.",
  },
  {
    title: "차이와 질문 확인",
    intro: "모델 예측, 제어기 TCP, 학생이 읽은 잉크를 구분해 비교합니다.",
  },
  {
    title: "모델 판단과 독립점 재검증",
    intro: "추가 관측으로 모델을 수정하거나 유지하고, 쓰지 않은 점 V에서 다시 확인합니다.",
  },
];
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

export function PaperV6StudentLesson({ state, actions, blocks }: Props) {
  const v6 = state.v6;
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"info" | "success" | "error">(
    "info",
  );
  const [selectedSupport, setSelectedSupport] = useState<"guided" | "challenge">(
    v6?.draft.supportMode ?? v6?.supportMode ?? "guided",
  );
  const step = v6?.step ?? state.stage;
  const draft = v6?.draft ?? {};
  const revalidation = state.targetSet === "revalidation";
  const currentModel = v6?.model ?? null;
  const modelForDecision = currentModel ?? state.parentAttempt?.v6?.model ?? null;
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
          {revalidation ? "DT에서 다시 검증" : "DT에서 실행"}
        </button>
        <button
          type="button"
          className="paper-v6-primary paper-v6-primary--hardware"
          disabled={state.running || !state.physicalAvailable}
          onClick={actions.onRunPhysical}
          data-testid="paper-v6-run-hardware"
        >
          {revalidation ? "실장비에서 다시 검증" : "교사 확인 후 실장비 실행"}
        </button>
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
      {!state.runAvailable && (
        <p className="paper-v6-error" role="status">
          DT 실행 차단: {state.dtBlockers?.map((blocker) => blocker.message).join(" · ") || "저장된 계획·높이·작업 범위를 확인하세요."}
        </p>
      )}
      {!state.physicalAvailable && (
        <p className="paper-v6-error" role="status">
          실장비 실행 차단: {state.physicalBlockers?.map((blocker) => blocker.message).join(" · ") || state.physicalUnavailableReason || "현재 실장비 준비를 확인하세요."}
        </p>
      )}
      {state.physicalAvailable && (
        <p className="paper-v6-callout">
          실장비 실행 가능 상태입니다. 이 버튼을 누른 뒤 기존 교사 감독·실행 확인을
          완료해야 모션이 시작됩니다. 화면 이동이나 저장으로 로봇은 움직이지 않습니다.
        </p>
      )}
    </section>
  );

  if (!v6) return null;

  return (
    <div className="paper-v6-student" data-testid="paper-v6-student-flow">
      <PaperV6StepShell
        step={step}
        title={steps[step - 1]?.title ?? steps[6].title}
        intro={steps[step - 1]?.intro ?? steps[6].intro}
        canGoBack={step > 1 && !state.running}
        canGoNext={step < 7 && !state.running}
        nextLabel={
          step === 3
            ? "모델 저장 후 다음"
            : step === 4
              ? "예측 저장 후 실행"
              : step === 6
                ? "추가 확인으로"
                : "다음 활동"
        }
        onBack={() => navigate(step - 1)}
        onNext={() => {
          if (step === 3) runAction(actions.onV6SaveModel);
          else if (step === 4) runAction(actions.onV6SavePrediction);
          else navigate(step + 1);
        }}
        statusMessage={state.error || message}
        statusKind={state.error ? "error" : messageKind}
      >
        {step === 1 && (
          <div className="paper-v6-step" data-testid="paper-v6-understand">
            <div className="paper-v6-coordinate-pair">
              <section aria-label="로봇 좌표계 A">
                <h3>로봇 좌표계 {`{A}`}</h3>
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
                <h3>종이 좌표계 {`{B}`}</h3>
                <svg viewBox="0 0 180 130" role="img" aria-label="10 곱하기 10 센티미터 종이">
                  <rect x="35" y="18" width="100" height="92" />
                  <path d="M35 110V116M135 110V116M35 115H135M29 18H23M29 110H23M24 18V110" />
                  <circle cx="45" cy="101" r="3" />
                  <circle cx="125" cy="101" r="3" />
                  <circle cx="125" cy="27" r="3" />
                  <circle cx="45" cy="27" r="3" />
                  <text x="38" y="98">P1</text><text x="127" y="98">P2</text>
                  <text x="127" y="24">P3</text><text x="38" y="24">P4</text>
                  <text x="70" y="128">0–10 cm</text>
                  <text x="2" y="68">0–10 cm</text>
                  <text x="30" y="10">B 원점 (0,0)</text>
                </svg>
              </section>
            </div>
            <p className="paper-v6-callout">
              1 cm = 10 mm는 고정값입니다. 종이는 측정하기 전에는 로봇 축에
              어떻게 놓였는지 알 수 없습니다.
            </p>
            <div className="paper-v6-target-list" aria-label="목표 사각형 종이 좌표">
              {targetPoints.map((point) => (
                <span key={point.name}>
                  {point.name} ({point.xCm}, {point.yCm}) cm
                </span>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="paper-v6-step" data-testid="paper-v6-references">
            <p className="paper-v6-callout">
              교사가 종이 모서리에 펜 끝을 맞춘 뒤 O·X·Y를 각각 새로 읽어 저장합니다.
              화면 값은 제어기 보고 좌표이며 학생이 재는 잉크 위치가 아닙니다.
            </p>
            {blocks.references}
            {state.frame && (
              <section className="paper-v6-reference-summary">
                <h3>저장된 제어기 보고값</h3>
                {(["O", "X", "Y"] as const).map((name) => {
                  const sample = state.frame?.samples.find((row) => row.point === name);
                  return (
                    <p key={name}>
                      {name}: {sample
                        ? `(${sample.pose.x.toFixed(2)}, ${sample.pose.y.toFixed(2)}, ${sample.pose.z.toFixed(2)}, ${sample.pose.r.toFixed(2)}) mm · ${sample.source === "hardware" ? "MG400 제어기" : sample.source === "mock" ? "모의" : "교사 입력"} · ${new Date(sample.capturedAt).toLocaleString()} · seq ${sample.seq ?? "—"}`
                        : "아직 기록 없음"}
                    </p>
                  );
                })}
                <small>
                  O–Y 길이와 직각은 참고 정보입니다. 학생 모델의 θ는 O–X에서 직접
                  계산하거나 θ=0 가정을 선택합니다.
                </small>
              </section>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="paper-v6-step" data-testid="paper-v6-model">
            {!state.frame && (
              <p className="paper-v6-error">
                O/X/Y 제어기 보고가 먼저 필요합니다. 이전 단계로 돌아가 기준점을
                기록하세요.
              </p>
            )}
            <p className="paper-v6-callout">
              학생이 O와 회전각을 정합니다. 측정된 프레임의 자동 회전값을 학생 답으로
              채우지 않습니다.
            </p>
            <div className="paper-v6-form-grid">
              {field("O의 로봇 X (mm)", draft.originXmm, (value) => updateDraft({ originXmm: value }), "학생 모델 O X mm", "paper-v6-origin-x")}
              {field("O의 로봇 Y (mm)", draft.originYmm, (value) => updateDraft({ originYmm: value }), "학생 모델 O Y mm", "paper-v6-origin-y")}
              {field("O→X의 ΔX (mm)", draft.deltaXmm, (value) => updateDraft({ deltaXmm: value }), "학생이 계산한 O X 델타 mm", "paper-v6-delta-x")}
              {field("O→X의 ΔY (mm)", draft.deltaYmm, (value) => updateDraft({ deltaYmm: value }), "학생이 계산한 O X 세로 델타 mm", "paper-v6-delta-y")}
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

        {step === 4 && (
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
              x = xO + a·cosθ − b·sinθ
              <br />
              y = yO + a·sinθ + b·cosθ
              <small>a, b는 종이 좌표를 mm로 바꾼 값입니다. 1 cm = 10 mm.</small>
            </p>
            {!v6?.model && (
              <p className="paper-v6-error">
                저장된 모델이 없습니다. 이전 단계에서 모델 입력을 저장하세요.
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

        {step === 5 && (
          <div className="paper-v6-step" data-testid="paper-v6-run">
            <p className="paper-v6-callout">
              모델을 만드는 데 사용한 O/X/Y와 학생 목표가 저장됐습니다. ±2.0 mm는 이
              시도의 실행 전에 고정한 비교 기준이며, DT는 실제 측정이 아닙니다.
            </p>
            {state.verificationCriteria && (
              <div className="paper-v6-criteria" data-testid="paper-v6-criteria">
                <strong>사전 고정 기준 · ±{state.verificationCriteria.positionToleranceMm.toFixed(1)} mm</strong>
                <span>독립 확인점: {state.verificationCriteria.independentVerificationPoints.join(", ") || "없음"}</span>
                <small>{state.verificationCriteria.rationale}</small>
              </div>
            )}
            {executionControls}
            {run && (
              <section className="paper-v6-run-result" aria-label="현재 실행 상태">
                <h3>현재 시도 실행</h3>
                <p>
                  {run.status === "completed" ? "완료" : run.status === "running" ? "실행 중" : "미완료"}
                  {" · "}
                  {run.source === "hardware" ? "MG400 제어기 TCP" : run.source === "dt" ? "DT · 실측 아님" : "모의 · 실측 아님"}
                </p>
                <small>명령 {run.commands.length}개 · 새 관측 {run.observations.length}개</small>
                {run.error && <p className="paper-v6-error">{run.error}</p>}
              </section>
            )}
          </div>
        )}

        {step === 6 && (
          <div className="paper-v6-step" data-testid="paper-v6-interpret">
            <div className="paper-v6-source-legend" aria-label="자료 출처">
              <span>학생 모델 예측</span><span>제어기 TCP 보고</span><span>학생 수기 잉크 · cm</span>
            </div>
            {blocks.observationsAndInk}
            {blocks.analysis}
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
          </div>
        )}

        {step === 7 && !revalidation && (
          <div className="paper-v6-step" data-testid="paper-v6-revise">
            <p className="paper-v6-callout" data-testid="paper-v6-support-level">
              도움 단계 {v6?.supportLevel ?? 1}/3 ·{" "}
              {(v6?.supportLevel ?? 1) === 1
                ? "관측 질문: 선택한 추가 확인 결과가 내 설명과 어떻게 연결되나요?"
                : (v6?.supportLevel ?? 1) === 2
                  ? "관계 힌트: O의 위치 변화와 O→X 방향 변화를 따로 비교해 보세요."
                  : "예시와 교사 도움: 목표점이 아닌 종이 (5,0), (0,5) cm를 식에 넣어 회전 항의 부호를 확인해 보세요. 필요하면 교사에게 함께 확인을 요청하세요."}
            </p>
            <details className="paper-v6-details" open>
              <summary>현재 모델과 같은 시도의 분석</summary>
              <p>
                O=({numberText(modelForDecision?.originXmm)}, {numberText(modelForDecision?.originYmm)}) mm ·
                θ {numberText(modelForDecision?.thetaDeg)}° · 가정{" "}
                {modelForDecision?.thetaAssumption === "zero" ? "θ=0" : "계산한 θ"}
              </p>
              {state.activeAttempt?.aiAnalyses?.filter((item) => item.runId === run?.id).slice(-1).map((item) => (
                <blockquote key={item.id}>
                  <strong>
                    {item.provider === "openai" && item.status === "provided"
                      ? `실제 OpenAI 응답 · ${item.model ?? "모델 정보 없음"}`
                      : `규칙 질문${item.fallbackUsed ? " · GPT 실패 후 대체" : ""}`}
                  </strong>
                  <p>{item.text}</p>
                  <small>{item.promptVersion ?? "프롬프트 버전 미기록"} · 실행 {item.runId}</small>
                </blockquote>
              ))}
            </details>
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
            <label className="paper-v6-field">
              <span>모델 판단</span>
              <select
                aria-label="모델 판단"
                value={draft.decision ?? "revise"}
                onChange={(event) => updateDraft({ decision: event.target.value as "revise" | "retain" })}
              >
                <option value="revise">O 또는 θ를 수정</option>
                <option value="retain">근거를 들어 현재 모델 유지</option>
              </select>
            </label>
            {(draft.decision ?? "revise") === "revise" && (
              <>
                <div className="paper-v6-form-grid">
                  {field("수정 모델 O의 X (mm)", draft.originXmm, (value) => updateDraft({ originXmm: value }), "수정 모델 원점 O X mm", "paper-v6-revision-origin-x")}
                  {field("수정 모델 O의 Y (mm)", draft.originYmm, (value) => updateDraft({ originYmm: value }), "수정 모델 원점 O Y mm", "paper-v6-revision-origin-y")}
                  {field("수정 모델 θ (도)", draft.thetaDeg, (value) => updateDraft({ thetaDeg: value, thetaAssumption: "calculated" }), "수정 모델 회전각 도", "paper-v6-revision-theta")}
                </div>
                <fieldset className="paper-v6-choice">
                  <legend>수정 모델에서 사용할 회전 가정</legend>
                  <label>
                    <input
                      type="radio"
                      name="paper-v6-revision-theta-assumption"
                      checked={(draft.thetaAssumption ?? "calculated") === "calculated"}
                      onChange={() => updateDraft({ thetaAssumption: "calculated" })}
                    />
                    수정한 θ 사용
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="paper-v6-revision-theta-assumption"
                      checked={draft.thetaAssumption === "zero"}
                      onChange={() => updateDraft({ thetaAssumption: "zero", thetaDeg: "0" })}
                    />
                    θ=0 가정 유지
                  </label>
                </fieldset>
              </>
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
              판단 저장 후 독립점 V 시도 만들기
            </button>
          </div>
        )}

        {step === 7 && revalidation && (
          <div className="paper-v6-step" data-testid="paper-v6-revalidate">
            <details className="paper-v6-details">
              <summary>이전 시도와 새 모델</summary>
              <p>
                이전 시도 {state.parentAttempt?.attempt ?? "—"} · O=(
                {numberText(state.parentAttempt?.v6?.model?.originXmm)}, {numberText(state.parentAttempt?.v6?.model?.originYmm)}) mm ·
                θ {numberText(state.parentAttempt?.v6?.model?.thetaDeg)}°
              </p>
              <p>
                이번 시도 · O=({numberText(currentModel?.originXmm)}, {numberText(currentModel?.originYmm)}) mm ·
                θ {numberText(currentModel?.thetaDeg)}° · V=(5, 6) cm
              </p>
              <p>{state.parentAttempt?.v6?.decisionReason ?? "이전 판단 근거 없음"}</p>
              <p>{state.parentAttempt?.v6?.followupResult ?? "추가 확인 기록 없음"}</p>
            </details>
            <div className="paper-v6-criteria">
              <strong>독립점 V=(5, 6) cm</strong>
              <span>사전 기준 ±2.0 mm · 모델 구성점 O/X/Y 및 P1~P4와 다른 위치</span>
              <small>TCP는 제어기 위치 보고, 잉크는 학생이 종이에서 읽은 값입니다.</small>
            </div>
            {!state.activeAttempt?.planHash && (
              <>
                <p className="paper-v6-callout">
                  수정한 학생 식으로 V의 로봇 목표를 계산합니다. 이 단계는 로봇을 움직이지
                  않습니다. 먼저 계획과 ±2.0 mm 기준을 같은 시도에 저장하세요.
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
                  <legend>O와 X에서 다시 재서 일치한 것만으로 모델이 맞다고 할 수 없는 이유는?</legend>
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
      {step < 7 && (
        <button
          type="button"
          className="paper-v6-export"
          onClick={actions.onV6Export}
          data-testid="paper-v6-export"
        >
          현재 시도와 연결된 연구 기록 JSON 내보내기
        </button>
      )}
    </div>
  );
}

