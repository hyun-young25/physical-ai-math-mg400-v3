import { useEffect, useId, useState } from "react";
import type { PaperPointName } from "./paperCoordinateStudy";
import type { PaperCoordinateStudyViewProps, PaperLessonStage } from "./paperCoordinateViewModel";
import "./paperCoordinateStudyView.css";

const STAGES: Array<{ id: PaperLessonStage; title: string }> = [
  { id: 1, title: "과제 이해" },
  { id: 2, title: "수학적 구조화" },
  { id: 3, title: "표현·예측" },
  { id: 4, title: "실행·측정" },
  { id: 5, title: "지각·표상" },
  { id: 6, title: "비교·해석" },
  { id: 7, title: "수정·재실행" },
];

const SOURCE_LABELS: Record<string, string> = {
  hardware: "실장비 · 제어기 GetPose",
  mock: "모의 브리지 · 실측 아님",
  dt: "DT · 실측 아님",
  teacher: "교사 입력 · 측정값 아님",
};

const LEVEL_LABELS = {
  basic: "기본",
  "quarter-turn": "직각 회전",
  rotated: "회전",
} as const;

const POINTS: PaperPointName[] = ["O", "X", "Y"];
const POSE_FIELDS = [
  { key: "x", label: "X", unit: "mm" },
  { key: "y", label: "Y", unit: "mm" },
  { key: "z", label: "Z", unit: "mm" },
  { key: "r", label: "R", unit: "°" },
] as const;

function sourceLabel(source: string | null | undefined) {
  return source ? SOURCE_LABELS[source] ?? source : "아직 자료 없음";
}

function timeLabel(value: number | null | undefined) {
  return value == null ? "—" : new Date(value).toLocaleString();
}

function numberLabel(value: number | null | undefined, digits = 2) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function StatusPill({ children, tone = "neutral" }: { children: string; tone?: "neutral" | "good" | "warn" }) {
  return <span className={`pcv-pill pcv-pill--${tone}`}>{children}</span>;
}

export function PaperCoordinateStudyView({ state, actions }: PaperCoordinateStudyViewProps) {
  const id = useId();
  const [hypothesisDraft, setHypothesisDraft] = useState(state.studentHypothesis);
  const [revisionDraft, setRevisionDraft] = useState(state.revisionReason);

  useEffect(() => setHypothesisDraft(state.studentHypothesis), [state.studentHypothesis]);
  useEffect(() => setRevisionDraft(state.revisionReason), [state.revisionReason]);

  const activeTitle = STAGES.find(stage => stage.id === state.stage)?.title ?? "과제 이해";
  const sampleFor = (point: PaperPointName) => state.samples.find(sample => sample.point === point);
  const predictionFor = (name: string) => state.predictions.find(prediction => prediction.name === name);

  const renderPaperGrid = () => (
    <div className="pcv-grid-wrap" aria-label="10×10 cm 종이 좌표 격자">
      <div className="pcv-grid">
        {state.targetPoints.map(point => (
          <span
            key={point.name}
            className="pcv-grid-point"
            style={{ left: `${point.xCm * 10}%`, top: `${100 - point.yCm * 10}%` }}
            aria-label={`종이 점 ${point.name}, x ${point.xCm} cm, y ${point.yCm} cm`}
          ><span>{point.name}</span></span>
        ))}
        {state.samples.map(sample => {
          const positions: Record<PaperPointName, { x: number; y: number }> = {
            O: { x: 0, y: 0 }, X: { x: 10, y: 0 }, Y: { x: 0, y: 10 },
          };
          const position = positions[sample.point];
          return <span key={`reference-${sample.point}`} className={`pcv-grid-reference pcv-grid-reference--${sample.point}`}
            style={{ left: `${position.x * 10}%`, top: `${100 - position.y * 10}%` }} aria-hidden="true">{sample.point}</span>;
        })}
        <span className="pcv-grid-axis pcv-grid-axis--x">x</span>
        <span className="pcv-grid-axis pcv-grid-axis--y">y</span>
      </div>
      <div className="pcv-grid-scale"><span>0</span><span>5</span><span>10 cm</span></div>
    </div>
  );

  const renderReferenceEntry = (point: PaperPointName) => {
    const sample = sampleFor(point);
    return (
      <fieldset className="pcv-reference" key={point}>
        <legend><span className="pcv-point-tag">{point}</span> 기준점</legend>
        <div className="pcv-reference-values">
          {POSE_FIELDS.map(field => (
            <label key={field.key} htmlFor={`${id}-${point}-${field.key}`}>
              <span>{field.label} <small>{field.unit}</small></span>
              <input id={`${id}-${point}-${field.key}`} inputMode="decimal" type="number" step="any"
                aria-label={`${point} 기준점 ${field.label} 좌표 (${field.unit})`}
                value={sample ? sample.pose[field.key] : state.manualInputs[point][field.key]}
                onChange={event => actions.onManualReferenceChange(point, field.key, event.target.value)} />
            </label>
          ))}
        </div>
        <p className="pcv-inline-note">{sample ? `${sourceLabel(sample.source)} · 기록 ${timeLabel(sample.capturedAt)}` : "기록된 기준점이 없습니다."}</p>
        <div className="pcv-button-row">
          <button type="button" className="pcv-button pcv-button--quiet" onClick={() => actions.onRecordCurrentReference(point)}
            disabled={!state.currentPose || state.running} aria-label={`${point} 기준점에 현재 위치 기록`}>
            현재 위치를 {point}로 기록
          </button>
          <button type="button" className="pcv-button pcv-button--quiet" onClick={() => actions.onSaveManualReference(point)}
            disabled={state.running}>입력값 저장</button>
        </div>
      </fieldset>
    );
  };

  const renderPredictionField = (point: string, field: "robotX" | "robotY", label: string, value: string) => (
    <label className="pcv-prediction-input" key={field}>
      <span>{label}</span>
      <input type="number" step="any" inputMode="decimal" value={value} disabled={state.running}
        aria-label={`${point} 예측 로봇 ${label}`}
        onChange={event => actions.onPredictionChange(point, field, event.target.value)} />
    </label>
  );

  const renderActiveStage = () => {
    switch (state.stage) {
      case 1:
        return <>
          <p className="pcv-lead">기존 사각형 수업의 좌표 생각을 종이 위의 10×10 cm 격자로 옮겨 봅니다.</p>
          <div className="pcv-task-strip">
            <div><span className="pcv-eyebrow">종이 격자</span><strong>10 × 10 cm</strong><small>눈금 한 칸은 1 cm</small></div>
            <div><span className="pcv-eyebrow">현재 목표 묶음</span><strong>{state.targetSet === "initial" ? "첫 목표" : "다시 확인할 목표"}</strong>
              <small>{state.level ? LEVEL_LABELS[state.level] : "수준 미선택"}</small></div>
          </div>
          <label className="pcv-field">
            <span>좌표 상황</span>
            <select aria-label="좌표 상황 선택" value={state.level} onChange={event => actions.onLevelChange(event.target.value as typeof state.level)}>
              <option value="basic">기본</option><option value="quarter-turn">직각 회전</option><option value="rotated">회전</option>
            </select>
          </label>
          <section className="pcv-alignment">
            <h3>종이 정렬과 기준점 기록</h3>
            <p>교사는 제조사 소프트웨어에서 종이를 정렬한 뒤 현재 위치를 읽어 O, X, Y 기준점으로 기록합니다. 핸드 가이딩은 현재 브라우저 브리지에서 지원되지 않습니다.</p>
            <div className="pcv-reference-grid">{POINTS.map(renderReferenceEntry)}</div>
            <div className="pcv-callout">
              <strong>기준 자료의 출처</strong>
              <p>실장비 기준은 컨트롤러가 보고한 GetPose이며 잉크 위치 측정이 아닙니다. 모의·DT 자료는 실제 측정값이 아니고, 교사가 입력한 좌표도 측정값이 아닙니다.</p>
            </div>
            {state.referenceError && <p className="pcv-alert" role="alert">{state.referenceError}</p>}
          </section>
          <div className="pcv-target-layout">
            {renderPaperGrid()}
            <div className="pcv-target-list">
              <h3>종이 위의 목표점</h3>
              {state.targetPoints.length ? state.targetPoints.map(point => (
                <div className="pcv-target-row" key={point.name}><b>{point.name}</b><span>x {point.xCm} cm</span><span>y {point.yCm} cm</span></div>
              )) : <p className="pcv-empty">목표점이 아직 전달되지 않았습니다.</p>}
            </div>
          </div>
          <p className="pcv-note">먼저 종이 좌표와 로봇 좌표가 어떻게 이어질지 생각합니다. 이 화면은 정답 좌표를 대신 계산하거나 표시하지 않습니다.</p>
        </>;
      case 2:
        return <>
          <p className="pcv-lead">1단계에서 기록한 기준점을 바탕으로 종이 좌표와 로봇 좌표 사이의 관계를 학생의 말과 수로 표현합니다.</p>
          <div className="pcv-concept-block">
            <span className="pcv-concept-mark" aria-hidden="true">O · X · Y</span>
            <p>종이의 원점은 어디인지, 축은 어느 방향인지, 길이 단위와 회전은 어떻게 나타낼지 생각해 보세요.</p>
          </div>
          <div className="pcv-form-grid">
            <label className="pcv-field"><span>원점 X (mm)</span><input type="number" step="any" inputMode="decimal" value={state.transform.originX}
              onChange={event => actions.onTransformChange("originX", event.target.value)} /></label>
            <label className="pcv-field"><span>원점 Y (mm)</span><input type="number" step="any" inputMode="decimal" value={state.transform.originY}
              onChange={event => actions.onTransformChange("originY", event.target.value)} /></label>
            <label className="pcv-field"><span>종이 x축이 향하는 방향</span><select value={state.transform.axisDirection}
              onChange={event => actions.onTransformChange("axisDirection", event.target.value)}>
              <option value="">방향 선택</option><option value="x+">로봇 X+</option><option value="y+">로봇 Y+</option>
              <option value="x-">로봇 X−</option><option value="y-">로봇 Y−</option>
            </select></label>
            <label className="pcv-field"><span>1 cm당 길이 (mm)</span><input type="number" step="any" inputMode="decimal" value={state.transform.millimetersPerCentimeter}
              onChange={event => actions.onTransformChange("millimetersPerCentimeter", event.target.value)} /></label>
            <label className="pcv-field"><span>추가 회전 (°)</span><input type="number" step="any" inputMode="decimal" value={state.transform.rotationDegrees}
              onChange={event => actions.onTransformChange("rotationDegrees", event.target.value)} /></label>
          </div>
          <label className="pcv-field"><span>이 관계를 선택한 이유</span><textarea rows={3} value={state.transform.explanation}
            onChange={event => actions.onTransformChange("explanation", event.target.value)} /></label>
          <button type="button" className="pcv-button pcv-button--primary" onClick={actions.onSaveTransform} disabled={state.running}>관계 저장</button>
          {state.transformFeedback && <p className="pcv-feedback" role="status">{state.transformFeedback}</p>}
        </>;
      case 3:
        return <>
          <p className="pcv-lead">2단계에서 세운 관계를 참고해, 각 종이 목표점의 로봇 좌표를 직접 예측하고 실행 전에 저장합니다.</p>
          <div className="pcv-predictions">
            <h3>내 로봇 좌표 예측</h3>
            <p className="pcv-note">아래는 직접 적는 예측 입력입니다. 목표 로봇 좌표는 자동으로 공개되지 않습니다.</p>
            {state.targetPoints.length ? state.targetPoints.map(point => {
              const prediction = predictionFor(point.name);
              return <fieldset className="pcv-prediction" key={point.name}>
                <legend><span className="pcv-point-tag">{point.name}</span> 종이 좌표 ({point.xCm}, {point.yCm}) cm</legend>
                <div className="pcv-prediction-grid">
                  {renderPredictionField(point.name, "robotX", "X · mm", prediction?.robotX ?? "")}
                  {renderPredictionField(point.name, "robotY", "Y · mm", prediction?.robotY ?? "")}
                </div>
              </fieldset>;
            }) : <p className="pcv-empty">예측할 목표점이 없습니다.</p>}
            <button type="button" className="pcv-button pcv-button--primary" onClick={actions.onSavePrediction}
              disabled={state.running || !state.predictionsReady}>예측 저장</button>
            {state.predictionFeedback && <p className="pcv-feedback" role="status">{state.predictionFeedback}</p>}
          </div>
        </>;
      case 4:
        return <>
          <p className="pcv-lead">예측을 저장한 뒤 선택한 환경의 결과를 살펴봅니다.</p>
          <div className="pcv-run-panel">
            <span className="pcv-eyebrow">현재 결과 자료</span>
            <strong>{state.run ? state.run.status === "completed" ? "실행 완료" : state.run.status === "running" ? "실행 중" : state.run.status : "아직 실행 기록 없음"}</strong>
            <span>{sourceLabel(state.run?.source)}</span>
          </div>
          <div className="pcv-button-row pcv-button-row--wrap">
            <button type="button" className="pcv-button pcv-button--primary" onClick={actions.onRunDT}
              disabled={state.running || !state.runAvailable}>{state.running ? "처리 중" : "DT에서 확인"}</button>
            <button type="button" className="pcv-button pcv-button--outline" onClick={actions.onRunPhysical}
              disabled={state.running || !state.physicalAvailable}>{state.currentSource === "mock" ? "모의 브리지에서 시험" : "실장비에서 확인"}</button>
          </div>
          <section className="pcv-callout pcv-height-check">
            <strong>종이 높이와 펜 이동 높이</strong>
            <p>종이 표면 Z는 기준점 O/X/Y에서 받은 값입니다. 펜 들기 높이는 제조사 프로그램에서 사람이 확인한 뒤 현재 좌표를 기록하세요. 이 화면은 높이 이동 명령을 자동 전송하지 않습니다.</p>
            <div className="pcv-form-grid">
              <label className="pcv-field"><span>종이 표면 Z (mm)</span><input value={state.paperSurfaceZ ?? ""} readOnly aria-label="기록된 종이 표면 높이" /></label>
              <label className="pcv-field"><span>펜 들기 Z (mm)</span><input type="number" step="any" inputMode="decimal"
                value={state.liftHeight ?? ""} onChange={event => actions.onLiftHeightChange(event.target.value)} aria-label="펜 들기 높이" /></label>
            </div>
            <p className="pcv-inline-note">들기 높이 자료: {sourceLabel(state.liftHeightSource)} · seq {state.liftHeightSequence ?? "—"}</p>
            <button type="button" className="pcv-button pcv-button--quiet" onClick={actions.onRecordCurrentLiftHeight}
              disabled={!state.currentPose || state.running}>현재 보고 Z를 들기 높이로 기록</button>
          </section>
          <details className="pcv-details pcv-tolerance">
            <summary>교사용 예비 허용오차 조정</summary>
            <p className="pcv-note">2 mm와 2°는 예비값입니다. 변경하면 기존 장비 준비 확인이 무효화되며, 실장비 사용 전 기존 연결·준비 절차를 다시 완료해야 합니다.</p>
            <div className="pcv-form-grid">
              <label className="pcv-field"><span>위치 허용오차 (mm)</span><input type="number" min="0.1" max="5" step="0.1" value={state.positionTolerance}
                onChange={event => actions.onToleranceChange("positionTolerance", event.target.value)} /></label>
              <label className="pcv-field"><span>방향 허용오차 (°)</span><input type="number" min="0.1" max="5" step="0.1" value={state.rotationTolerance}
                onChange={event => actions.onToleranceChange("rotationTolerance", event.target.value)} /></label>
            </div>
          </details>
          <p className="pcv-note">DT는 가상 자료이며 실측이 아닙니다. 실장비 결과는 컨트롤러 GetPose 보고 위치입니다. 이것만으로 펜 접촉이나 잉크 위치를 확인할 수 없습니다.</p>
          {!state.physicalAvailable && state.physicalUnavailableReason && <p className="pcv-callout pcv-callout--compact" role="status">{state.physicalUnavailableReason}</p>}
          {state.running && <p className="pcv-feedback" role="status">결과를 기다리는 중입니다.</p>}
          {state.error && <p className="pcv-alert" role="alert">{state.error}</p>}
        </>;
      case 5:
        return <>
          <p className="pcv-lead">컨트롤러가 보고한 TCP 좌표와 종이 위 잉크 자국은 별개의 관찰입니다. 제어기 좌표를 변환한 결과가 잉크를 측정하거나 보증하지 않습니다.</p>
          <section className="pcv-controller-observations" aria-label="실행에서 받은 컨트롤러 위치 관측">
            <h3>실행에서 받은 컨트롤러 위치</h3>
            {state.run?.observations.length ? <>
              <p className="pcv-note">아래는 실행 기록에 담긴 위치 보고와 측정된 종이 좌표계의 환산값입니다. 환산은 잉크 위치 측정이 아닙니다.</p>
              <div className="pcv-observation-list">
                {state.run.observations.map((observation, index) => (
                  <article className="pcv-observation-item" key={`${observation.point}-${observation.measuredAt}-${index}`}>
                    <div><span className="pcv-point-tag">{observation.point}</span><strong>{sourceLabel(observation.source)}</strong></div>
                    <p>TCP · X {numberLabel(observation.pose.x)} mm · Y {numberLabel(observation.pose.y)} mm · Z {numberLabel(observation.pose.z)} mm · R {numberLabel(observation.pose.r)}°</p>
                    {state.convertedReadings.find(reading => reading.point === observation.point && reading.measuredAt === observation.measuredAt)
                      && <p>기준점 환산 · 종이 x {numberLabel(state.convertedReadings.find(reading => reading.point === observation.point && reading.measuredAt === observation.measuredAt)?.xCm)} cm · y {numberLabel(state.convertedReadings.find(reading => reading.point === observation.point && reading.measuredAt === observation.measuredAt)?.yCm)} cm</p>}
                    <small>{observation.kind} · seq {observation.seq ?? "—"} · {timeLabel(observation.measuredAt)}</small>
                  </article>
                ))}
              </div>
            </> : <p className="pcv-empty">현재 실행에 연결된 컨트롤러 관측이 없습니다.</p>}
            <p className="pcv-note">하드웨어 자료는 컨트롤러의 GetPose 보고 위치입니다. 모의·DT 자료는 실제 측정값이 아닙니다.</p>
          </section>
          <div className="pcv-observation-layout">
            {renderPaperGrid()}
            <div className="pcv-ink-list">
              <h3>종이 눈금에서 잉크 위치 읽기</h3>
              {state.targetPoints.map(point => {
                const reading = state.inkReadings.find(item => item.point === point.name);
                return <fieldset className="pcv-ink-row" key={point.name}>
                  <legend><span className="pcv-point-tag">{point.name}</span> 눈금에서 읽은 위치</legend>
                  <label><span>x · cm</span><input type="number" step="any" inputMode="decimal" value={reading?.xCm ?? ""}
                    aria-label={`${point.name} 잉크 위치 x cm`} onChange={event => actions.onInkReadingChange(point.name, "xCm", event.target.value)} /></label>
                  <label><span>y · cm</span><input type="number" step="any" inputMode="decimal" value={reading?.yCm ?? ""}
                    aria-label={`${point.name} 잉크 위치 y cm`} onChange={event => actions.onInkReadingChange(point.name, "yCm", event.target.value)} /></label>
                </fieldset>;
              })}
              <button type="button" className="pcv-button pcv-button--primary" onClick={actions.onSaveInkReadings} disabled={state.running}>잉크 읽기 저장</button>
            </div>
          </div>
          <p className="pcv-note">눈금 읽기는 학생이 종이에서 관찰한 값입니다. 잉크 위치는 자동 측정되지 않습니다.</p>
        </>;
      case 6:
        return <>
          <p className="pcv-lead">예측, 제어기 보고 위치, 종이에서 읽은 잉크 좌표를 구분해서 살펴봅니다.</p>
          {state.diagnosis ? <section className="pcv-interpretation" aria-label="비교 해석">
            <div className="pcv-interpretation-head"><StatusPill tone={state.diagnosis.status === "complete" ? "good" : "warn"}>{state.diagnosis.status === "complete" ? "비교 자료 준비됨" : state.diagnosis.status === "invalidated" ? "자료 다시 확인 필요" : "비교 미완료"}</StatusPill>
              <span>{sourceLabel(state.diagnosis.source)}</span></div>
            <h3>{state.diagnosis.candidate}</h3>
            <p className="pcv-question">{state.diagnosis.question}</p>
            <p className="pcv-note">{state.diagnosis.why}</p>
            <details className="pcv-details">
              <summary>비교 근거 자세히 보기</summary>
              <EvidenceRows title="제어기 보고와 명령 차이" rows={state.diagnosis.evidence} />
              <EvidenceRows title="예측 비교 자료" rows={state.diagnosis.predictionEvidence} />
              <p>첫 차이 지점: {state.diagnosis.firstMismatch ?? "없음"}</p>
              <p>판정 방식: {state.diagnosis.method} · 질문 출처: {state.diagnosis.tutorSource}</p>
            </details>
          </section> : <div className="pcv-empty-card"><strong>비교 자료를 기다리는 중</strong><p>실행 결과와 관찰 기록이 전달되면 이곳에 표시됩니다.</p></div>}
          <label className="pcv-field"><span>내가 생각하는 이유 (원인을 단정하지 않고 후보로)</span><textarea rows={4} value={hypothesisDraft}
            onChange={event => setHypothesisDraft(event.target.value)} /></label>
          <button type="button" className="pcv-button pcv-button--primary" onClick={() => actions.onSaveHypothesis(hypothesisDraft)} disabled={state.running}>생각 저장</button>
        </>;
      case 7:
        return <>
          <p className="pcv-lead">비교에서 발견한 점을 바탕으로 설명이나 좌표를 다시 살펴보고, 필요하면 새 조건으로 확인합니다.</p>
          {state.diagnosis && <div className="pcv-interpretation pcv-interpretation--compact"><StatusPill tone="warn">가능한 해석</StatusPill><p>{state.diagnosis.candidate}</p><p className="pcv-note">{state.diagnosis.question}</p></div>}
          <label className="pcv-field"><span>무엇을 다시 살펴볼까요?</span><textarea rows={4} value={revisionDraft}
            onChange={event => setRevisionDraft(event.target.value)} /></label>
          <div className="pcv-button-row pcv-button-row--wrap">
            <button type="button" className="pcv-button pcv-button--primary" onClick={() => actions.onRevise(revisionDraft)} disabled={state.running}>이유와 수정 기록</button>
            <button type="button" className="pcv-button pcv-button--outline" onClick={actions.onChooseNewTarget} disabled={state.running}>다른 목표로 이어가기</button>
          </div>
          <div className="pcv-callout pcv-callout--compact">
            <strong>종이 위치가 바뀌었나요?</strong>
            <p>종이를 옮긴 뒤에는 기존 기준점을 그대로 쓰지 않습니다. 종이를 정렬하고 기준점을 다시 기록해 주세요.</p>
            <button type="button" className="pcv-button pcv-button--quiet" onClick={actions.onMovePaper} disabled={state.running}>종이를 옮겼어요 · 기준점 다시 기록</button>
          </div>
        </>;
    }
  };

  return (
    <section className="paper-coordinate-view" aria-label="종이 좌표 변환 학습">
      <header className="pcv-header">
        <button type="button" className="pcv-back" onClick={actions.onBack}>← <span>사각형 수업으로</span></button>
        <div className="pcv-header-title"><span className="pcv-eyebrow">MG400 · 좌표 확장 활동</span><h1>종이 좌표를 로봇 좌표로</h1>
          <p>사각형에서 배운 좌표 관계를 실제 크기의 격자에 이어 봅니다.</p></div>
        <div className="pcv-header-meta"><span>현재 활동</span><strong>{activeTitle}</strong></div>
      </header>

      <nav className="pcv-stage-nav" aria-label="7단계 학습 흐름">
        {STAGES.map((stage, index) => (
          <button type="button" key={stage.id} className={`pcv-stage${state.stage === stage.id ? " is-current" : ""}`}
            aria-current={state.stage === stage.id ? "step" : undefined} onClick={() => actions.onStageChange(stage.id)}>
            <span className="pcv-stage-index">{String(index + 1).padStart(2, "0")}</span><span>{stage.title}</span>
          </button>
        ))}
      </nav>

      <main className="pcv-main">
        <section className="pcv-activity" aria-labelledby={`${id}-activity-heading`}>
          <div className="pcv-activity-kicker"><span>지금 하는 일</span><span>단계 {state.stage} / 7</span></div>
          <h2 id={`${id}-activity-heading`}>{activeTitle}</h2>
          {renderActiveStage()}
        </section>
        <aside className="pcv-side-note" aria-label="현재 좌표 정보">
          <span className="pcv-eyebrow">현재 보고된 위치</span>
          {state.currentPose ? <div className="pcv-pose-readout">
            {POSE_FIELDS.map(field => <div key={field.key}><span>{field.label} · {field.unit}</span><strong>{numberLabel(state.currentPose?.[field.key])}</strong></div>)}
          </div> : <p>현재 위치 자료가 없습니다.</p>}
          <div className="pcv-side-source"><span>자료 출처</span><strong>{sourceLabel(state.currentSource)}</strong></div>
          <div className="pcv-side-source"><span>좌표 설정</span><strong>{state.coordinateSystem || "미기록"} · User {state.user} / Tool {state.tool}</strong></div>
          <StatusPill tone={state.coordinatesVerified ? "good" : "warn"}>{state.coordinatesVerified ? "좌표 설정 확인됨" : "좌표 설정 확인 전"}</StatusPill>
          <p className="pcv-side-caution">GetPose는 제어기가 보고한 위치입니다. 펜 끝이나 종이의 잉크 위치를 뜻하지 않습니다.</p>
        </aside>
      </main>

      <details className="pcv-details pcv-records">
        <summary>근거와 기록 자세히 보기</summary>
        <div className="pcv-evidence-grid">
          <section><h3>기준점 자료</h3><p>출처: {sourceLabel(state.frame?.source)}</p>
            <p>기준 프레임: {state.frame?.id ?? "없음"} · {state.frame?.coordinateSystem ?? "좌표계 미기록"} · User {state.frame?.user ?? "—"} / Tool {state.frame?.tool ?? "—"}</p>
            <p>프레임 기록: {timeLabel(state.frame?.capturedAt)}</p>
            {state.samples.length ? <ul>{state.samples.map(sample => <li key={`${sample.point}-${sample.capturedAt}`}>{sample.point}: ({numberLabel(sample.pose.x)}, {numberLabel(sample.pose.y)}, {numberLabel(sample.pose.z)}, {numberLabel(sample.pose.r)}) · {sourceLabel(sample.source)} · seq {sample.seq ?? "—"} · {timeLabel(sample.capturedAt)} · 좌표 설정 확인 {sample.verifiedCoordinates ? "예" : "아니요"}</li>)}</ul> : <p>기록된 O/X/Y 기준점이 없습니다.</p>}
            <p>최근 기록: {state.currentSequence ?? "seq 없음"} · {timeLabel(state.currentMeasuredAt)}</p>
          </section>
          <section><h3>변환과 예측</h3><p>원점: ({state.transform.originX || "—"}, {state.transform.originY || "—"}) mm · 축 방향: {state.transform.axisDirection || "—"}</p>
            <p>cm당 mm: {state.transform.millimetersPerCentimeter || "—"} · 추가 회전: {state.transform.rotationDegrees || "—"}°</p><p>설명: {state.transform.explanation || "작성 전"}</p>
            <p>목표 묶음: {state.targetSet} · 수준: {LEVEL_LABELS[state.level]}</p>
            {state.predictions.length ? <ul>{state.predictions.map(point => <li key={point.name}>{point.name} · 종이 ({point.xCm}, {point.yCm}) cm · 내 X/Y 예측 ({point.robotX || "—"}, {point.robotY || "—"})</li>)}</ul> : <p>저장된 예측이 없습니다.</p>}
            <p className="pcv-note">학생 예측은 로봇 X/Y입니다. Z는 기준점에서 읽은 종이 높이를, R은 기록된 도구 방향을 사용하며 학생 답으로 자동 채우지 않습니다.</p>
          </section>
          <section><h3>실행 기록</h3>{state.run ? <><p>출처: {sourceLabel(state.run.source)} · 상태: {state.run.status}</p>
            <p>시작 {timeLabel(state.run.startedAt)} · 종료 {timeLabel(state.run.endedAt)} · 시작 seq {state.run.startSequence ?? "—"}</p>
            <p>프레임 {state.run.frameId} · 계획 식별값 {state.run.planHash}</p>
            {state.run.commands.map(command => <p key={`command-${command.point}`}>명령 {command.point}: ({numberLabel(command.pose.x)}, {numberLabel(command.pose.y)}, {numberLabel(command.pose.z)}, {numberLabel(command.pose.r)})</p>)}
            {state.run.observations.map((observation, index) => <p key={`${observation.point}-${observation.measuredAt}-${index}`}>관측 {observation.point}: {observation.kind} · {sourceLabel(observation.source)} · seq {observation.seq ?? "—"} · {timeLabel(observation.measuredAt)} · ({numberLabel(observation.pose.x)}, {numberLabel(observation.pose.y)}, {numberLabel(observation.pose.z)}, {numberLabel(observation.pose.r)})</p>)}
            {state.run.error && <p>실행 메시지: {state.run.error}</p>}</> : <p>실행 기록이 없습니다.</p>}</section>
          <section><h3>잉크 읽기와 해석</h3>
            {state.inkReadings.length ? state.inkReadings.map(reading => <p key={reading.point}>종이에서 읽음 {reading.point}: x {reading.xCm ?? "—"} cm, y {reading.yCm ?? "—"} cm</p>) : <p>잉크 좌표를 읽지 않았습니다.</p>}
            {state.diagnosis && <><p>{state.diagnosis.candidate}</p><p>{state.diagnosis.why}</p></>}</section>
          <section><h3>저장 및 실행 상태</h3><p>저장 상태: {state.saveState} · {state.saveMessage || "메시지 없음"}</p>
            <p>DT 가능: {state.runAvailable ? "예" : "아니요"} · 실장비 가능: {state.physicalAvailable ? "예" : "아니요"}</p>
            <p>실장비 사용 불가 사유: {state.physicalUnavailableReason || "없음"}</p><p>기록된 생각: {state.studentHypothesis || "없음"}</p>
            <p>수정 이유: {state.revisionReason || "없음"}</p><p>실행 중: {state.running ? "예" : "아니요"} · 오류: {state.error || "없음"}</p>
            <p>가설 피드백: {state.predictionFeedback || "없음"} · 변환 피드백: {state.transformFeedback || "없음"}</p>
          </section>
        </div>
      </details>
      {state.saveState !== "ready" && <p className="pcv-save-status" role="status" aria-live="polite">
        {state.saveState === "saving" ? "기록을 저장하는 중입니다." : state.saveState === "saved" ? state.saveMessage || "기록이 저장되었습니다." : state.saveMessage || "기록을 저장하지 못했습니다."}
      </p>}
    </section>
  );
}

function EvidenceRows({ title, rows }: { title: string; rows: Array<{ point: string; dx: number; dy: number; distance: number }> }) {
  return <section className="pcv-evidence-rows"><h4>{title}</h4>{rows.length ? rows.map((row, index) => (
    <p key={`${row.point}-${index}`}>{row.point}: ΔX {numberLabel(row.dx)} mm · ΔY {numberLabel(row.dy)} mm · 거리 {numberLabel(row.distance)} mm</p>
  )) : <p>비교 근거가 없습니다.</p>}</section>;
}

export default PaperCoordinateStudyView;
