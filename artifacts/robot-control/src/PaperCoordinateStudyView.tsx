import { isMergedPaper,isPaperDT } from "./paperMergedLesson";
import { LEARNING_STAGES } from "./learningFramework";
import { PaperDiagnosisVisual } from "./PaperDiagnosisVisual";
import { LearningRevisionJourney, RevisionEditingLayout } from "./LearningRevisionJourney";
import { PAPER_RECTANGLE_TITLES,isPaperRectangle } from "./paperRectangleTask";
import { useEffect, useId, useState, useLayoutEffect, useRef } from "react";
import { PaperSceneMap } from "./PaperScene";
import { publishPaperScene, clearPaperScene, selectPaperPoint, usePaperScene } from "./paperSceneStore";
import type { PaperPointName } from "./paperCoordinateStudy";
import type { PaperCoordinateStudyViewProps, PaperLessonStage } from "./paperCoordinateViewModel";
import "./paperCoordinateStudyView.css";

const STAGES = LEARNING_STAGES.map((s,i)=>({id:(i+1) as PaperLessonStage,title:s.label}));

const SOURCE_LABELS: Record<string, string> = {
  hardware: "실장비 · 제어기 TCP 보고 좌표",
  mock: "모의 브리지 · 실측 아님",
  dt: "DT · 실측 아님",
  teacher: "교사 입력 · 측정값 아님",
};

const LEVEL_LABELS = {
  ...PAPER_RECTANGLE_TITLES,
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
  const rectangle=isPaperRectangle(state.level),merged=isMergedPaper(state.level),dtOnly=isPaperDT(state.level),grid=merged?20:10;
  const [hypothesisDraft, setHypothesisDraft] = useState(state.studentHypothesis);
  const [revisionDraft, setRevisionDraft] = useState(state.revisionReason);
  const journey=state.revisionJourney ? {...state.revisionJourney,
    draftRevisionReason:state.stage===7?revisionDraft:undefined} : null;
  const root=useRef<HTMLElement>(null), scene=usePaperScene();
  const selected=scene.reference??`P${scene.point+1}`;
  useLayoutEffect(()=>{
    if(merged) publishPaperScene(id,{level:state.level,stage:state.stage,frame:state.frame,samples:state.samples,targetPoints:state.targetPoints,predictions:state.predictions,revisionJourney:journey,running:state.running,diagnosis:state.diagnosis,run:state.run,displayPose:state.displayPose,displaySource:state.displaySource});
    else clearPaperScene(id);
  });
  useLayoutEffect(()=>()=>clearPaperScene(id),[id]);
  useEffect(()=>{
    if(merged&&scene.selectionOrigin==="scene") root.current?.querySelector(`[data-paper-row="${selected}"]`)?.scrollIntoView({block:"nearest",behavior:"smooth"});
  },[merged,scene.selectionVersion]);
  const rowProps=(name:string)=>merged?{"data-paper-row":name,"data-paper-selected":selected===name,onFocus:()=>selectPaperPoint(name)}:{};
  const displayPose=merged?state.displayPose??state.currentPose:state.currentPose;

  useEffect(() => setHypothesisDraft(state.studentHypothesis), [state.studentHypothesis]);
  useEffect(() => setRevisionDraft(state.revisionReason), [state.revisionReason]);

  const activeTitle = STAGES.find(stage => stage.id === state.stage)?.title ?? "과제 이해";
  const sampleFor = (point: PaperPointName) => state.samples.find(sample => sample.point === point);
  const predictionFor = (name: string) => state.predictions.find(prediction => prediction.name === name);

  const renderPaperGrid = () => merged ? null : (
    <div className="pcv-grid-wrap" aria-label={grid+"×"+grid+" cm 종이 좌표 격자"}>
      <div className="pcv-grid">
        {state.targetPoints.map(point => (
          <span
            key={point.name}
            className="pcv-grid-point"
            style={{ left: `${point.xCm * 100/grid}%`, top: `${100 - point.yCm * 100/grid}%` }}
            aria-label={`종이 점 ${point.name}, x ${point.xCm} cm, y ${point.yCm} cm`}
          ><span>{point.name}</span></span>
        ))}
        {state.stage>=5 && <svg viewBox={[-grid/10,-grid/10,grid*1.2,grid*1.2].join(" ")} style={{position:"absolute",inset:"-10%",width:"120%",height:"120%",overflow:"visible"}} aria-label="목표와 보고 위치의 차이 화살표">
          <defs><marker id={`${id}-arrow`} markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4" fill="#c24135"/></marker></defs>
          {rectangle&&<polyline points={[...state.targetPoints,state.targetPoints[0]].map(p=>p.xCm+","+(grid-p.yCm)).join(" ")} fill="none" stroke="#22c55e" strokeWidth=".06" strokeDasharray=".2 .12"/>}
          {rectangle&&state.convertedReadings.length===4&&<polyline points={[...state.convertedReadings,state.convertedReadings[0]].map(p=>p.xCm+","+(grid-(p.yCm??0))).join(" ")} fill="none" stroke="#ff9f1c" strokeWidth=".06"/>}
          {state.convertedReadings.map(o=>{const t=state.targetPoints.find(t=>t.name===o.point);if(!t||o.xCm===null||o.yCm===null)return null;
            return <g key={o.point}><line x1={t.xCm} y1={grid-t.yCm} x2={o.xCm} y2={grid-o.yCm} stroke="#c24135" strokeWidth=".04" markerEnd={`url(#${id}-arrow)`}/><circle cx={o.xCm} cy={grid-o.yCm} r=".12" fill="#c24135"/><text x={o.xCm+.18} y={grid-o.yCm-.1} fontSize=".35" fill="#9b2720">{o.point} 보고</text></g>;})}
        </svg>}
        {state.samples.map(sample => {
          const positions: Record<PaperPointName, { x: number; y: number }> = {
            O: { x: 0, y: 0 }, X: { x: 10, y: 0 }, Y: { x: 0, y: 10 },
          };
          const position = positions[sample.point];
          return <span key={`reference-${sample.point}`} className={`pcv-grid-reference pcv-grid-reference--${sample.point}`}
            style={{ left: `${position.x * 100/grid}%`, top: `${100 - position.y * 100/grid}%` }} aria-hidden="true">{sample.point}</span>;
        })}
        <span className="pcv-grid-axis pcv-grid-axis--x">x</span>
        <span className="pcv-grid-axis pcv-grid-axis--y">y</span>
      </div>
      <div className="pcv-grid-scale"><span>0</span><span>{grid/2}</span><span>{grid} cm</span></div>
    </div>
  );

  const renderReferenceEntry = (point: PaperPointName) => {
    const sample = sampleFor(point);
    return (
      <fieldset className="pcv-reference" key={point} {...rowProps(point)}>
        <legend><span className="pcv-point-tag">{point}</span> 기준점</legend>
        <div className="pcv-reference-values">
          {POSE_FIELDS.map(field => (
            <label key={field.key} htmlFor={`${id}-${point}-${field.key}`}>
              <span>{field.label} <small>{field.unit}</small></span>
              <input id={`${id}-${point}-${field.key}`} inputMode="decimal" type="number" step="any"
                aria-label={`${point} 기준점 ${field.label} 좌표 (${field.unit})`}
                value={state.manualInputs[point][field.key]}
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
          <p className="pcv-lead">{merged?"종이 원점에서 시작하는 가로 110 mm, 세로 150 mm (11×15 cm) 직사각형을 예측합니다.":rectangle?"종이 (2, 2) cm에서 시작하는 가로 6 cm, 세로 4 cm 직사각형의 네 꼭짓점을 예측합니다.":"기존 사각형 수업의 좌표 생각을 종이 위의 10×10 cm 격자로 옮겨 봅니다."}</p>
          {rectangle&&<p className="pcv-callout">{merged?(dtOnly?"주어진 O를 기준으로 로봇 좌표 = O + 종이 안의 이동량 관계를 확인하세요. DT 전용 과제입니다.":`${state.rotationAllowed?"종이를 회전해 놓을 수 있습니다. 실제 위치와 방향은 O/X/Y를 기록해 확인하세요.":"종이 축을 로봇 축과 나란히 맞춘 뒤 O/X/Y를 기록하세요."} 실장비는 각 꼭짓점에서 펜을 들고 내리는 점 확인 방식입니다. 연속 잉크 선 그리기는 검증하지 않습니다.`):state.level==="advanced-paper-quarter"?"종이 x축이 로봇 X축에서 90° 돌아가도록 놓고 O/X/Y를 기록하세요.":"종이를 비스듬히 놓고 O/X/Y를 기록하세요. 종이 방향은 기준점으로 확인합니다."} 기준점을 기록하기 전에는 목표 로봇 좌표가 정해지지 않습니다.</p>}
          <div className="pcv-task-strip">
            <div><span className="pcv-eyebrow">종이 격자</span><strong>{grid} × {grid} cm</strong><small>{merged?"화면 눈금 1 cm · O→X / O→Y 각 10 cm":"가는 눈금 1 mm · 굵은 눈금 1 cm"}</small></div>
            <div><span className="pcv-eyebrow">현재 목표 묶음</span><strong>{state.targetSet === "initial" ? "첫 목표" : "다시 확인할 목표"}</strong>
              <small>{state.level ? LEVEL_LABELS[state.level] : "수준 미선택"}</small></div>
          </div>
          <label className="pcv-field">
            <span>좌표 상황</span>
            <select aria-label="좌표 상황 선택" disabled={rectangle} value={state.level} onChange={event => actions.onLevelChange(event.target.value as typeof state.level)}>
              <option value="advanced-paper-dt">심화 1 · 종이 기준점 (DT)</option><option value="advanced-paper-hardware">심화 2 · 종이 위 경로 확인 (MG400)</option><option value="advanced-paper-quarter">심화 1 · 직각 회전</option><option value="advanced-paper-rotated">심화 2 · 비스듬히 놓인 종이</option>
              <option value="basic">기본</option><option value="quarter-turn">직각 회전</option><option value="rotated">회전</option>
            </select>
          </label>
          <a className="pcv-button" href={merged?"/paper-coordinate-grid-20cm.svg":"/paper-coordinate-grid-a4.pdf"} target="_blank" rel="noreferrer">인쇄용 모눈종이 · 100% 실제 크기</a>
          {dtOnly?<section className="pcv-callout"><h3>주어진 기준점 · DT 과제 조건</h3>{state.samples.map(p=><p key={p.point}>{p.point}: ({p.pose.x}, {p.pose.y}) mm · Z {p.pose.z} mm</p>)}<p>종이 x축은 로봇 X+, y축은 로봇 Y+ · 1 cm = 10 mm입니다.</p></section>:<section className="pcv-alignment">
            <h3>종이 정렬과 기준점 기록</h3>
            <p>교사는 제조사 소프트웨어에서 종이를 정렬한 뒤 현재 위치를 읽어 O, X, Y 기준점으로 기록합니다. 핸드 가이딩은 현재 브라우저 브리지에서 지원되지 않습니다.</p>
            <div className="pcv-reference-grid">{POINTS.map(renderReferenceEntry)}</div>
            <div className="pcv-callout">
              <strong>기준 자료의 출처</strong>
              <p>실장비 기준은 컨트롤러가 보고한 TCP 보고 좌표이며 잉크 위치 측정이 아닙니다. 모의·DT 자료는 실제 측정값이 아니고, 교사가 입력한 좌표도 측정값이 아닙니다.</p>
            </div>
            {state.referenceError && <p className="pcv-alert" role="alert">{state.referenceError}</p>}
          </section>}
          <div className="pcv-target-layout">
            {renderPaperGrid()}
            <div className="pcv-target-list">
              <h3>종이 위의 목표점</h3>
              {state.targetPoints.length ? state.targetPoints.map(point => (
                <div className="pcv-target-row" key={point.name} {...rowProps(point.name)}>{merged?<button type="button" onClick={()=>selectPaperPoint(point.name)}>{point.name}</button>:<b>{point.name}</b>}<span>x {point.xCm} cm</span><span>y {point.yCm} cm</span></div>
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
            {(!merged||state.rotationAllowed)&&<label className="pcv-field"><span>종이 x축이 향하는 방향</span><select value={state.transform.axisDirection}
              onChange={event => actions.onTransformChange("axisDirection", event.target.value)}>
              <option value="">방향 선택</option><option value="x+">로봇 X+</option><option value="y+">로봇 Y+</option>
              <option value="x-">로봇 X−</option><option value="y-">로봇 Y−</option>
            </select></label>}
            <label className="pcv-field"><span>1 cm당 길이 (mm)</span><input type="number" step="any" inputMode="decimal" value={state.transform.millimetersPerCentimeter}
              onChange={event => actions.onTransformChange("millimetersPerCentimeter", event.target.value)} /></label>
            {(!merged||state.rotationAllowed)&&<label className="pcv-field"><span>추가 회전 (°)</span><input type="number" step="any" inputMode="decimal" value={state.transform.rotationDegrees}
              onChange={event => actions.onTransformChange("rotationDegrees", event.target.value)} /></label>}
          </div>
          <label className="pcv-field"><span>이 관계를 선택한 이유</span><textarea rows={3} value={state.transform.explanation}
            onChange={event => actions.onTransformChange("explanation", event.target.value)} /></label>
          <button type="button" className="pcv-button pcv-button--primary" onClick={actions.onSaveTransform} disabled={state.running}>관계 저장</button>
          {state.transformFeedback && <p className="pcv-feedback" role="status">{state.transformFeedback}</p>}
        </>;
      case 3:
        return <>
          <p className="pcv-lead">2단계에서 세운 관계를 참고해, 각 종이 목표점의 로봇 좌표를 직접 예측하고 실행 전에 저장합니다.</p>
          {merged&&<fieldset className="pcv-concept-block"><legend>직선 이동과 닫힘 관계</legend><label>직선 경로 명령 <select aria-label="직선 경로 명령" disabled={!!state.run} value={state.pathConcept?.motion??""} onChange={e=>actions.onPathConceptChange("motion",e.target.value)}><option value="">선택</option><option>MoveJ</option><option>MoveL</option></select></label>{(["closeX","closeY"] as const).map((f,i)=><label key={f}>닫힌 경로의 Δ{i?"Y":"X"} 합 (mm)<input type="number" aria-label={"닫힌 경로 Δ"+(i?"Y":"X")+" 합"} disabled={!!state.run} value={state.pathConcept?.[f]??""} onChange={e=>actions.onPathConceptChange(f,e.target.value)}/></label>)}</fieldset>}
          <div className="pcv-predictions">
            <h3>내 로봇 좌표 예측</h3>
            <p className="pcv-note">아래는 직접 적는 예측 입력입니다. 목표 로봇 좌표는 자동으로 공개되지 않습니다.</p>
            {state.targetPoints.length ? state.targetPoints.map(point => {
              const prediction = predictionFor(point.name);
              return <fieldset className="pcv-prediction" key={point.name} {...rowProps(point.name)}>
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
            {!dtOnly&&<button type="button" className="pcv-button pcv-button--outline" onClick={actions.onRunPhysical}
              disabled={state.running || !state.physicalAvailable}>{state.currentSource === "mock" ? "모의 브리지에서 시험" : "실장비에서 확인"}</button>}
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
          <p className="pcv-note">DT는 가상 자료이며 실측이 아닙니다. 실장비 결과는 컨트롤러 TCP 보고 좌표 보고 위치입니다. 이것만으로 펜 접촉이나 잉크 위치를 확인할 수 없습니다.</p>
          {!state.physicalAvailable && state.physicalUnavailableReason && <p className="pcv-callout pcv-callout--compact" role="status">{state.physicalUnavailableReason}</p>}
          {state.running && <p className="pcv-feedback" role="status">결과를 기다리는 중입니다.</p>}
          {state.error && <p className="pcv-alert" role="alert">{state.error}</p>}
        </>;
      case 5:
        return <>
          <p className="pcv-lead">컨트롤러가 보고한 TCP 좌표와 종이 위 잉크 자국은 별개의 관찰입니다. 제어기 좌표를 변환한 결과가 잉크를 측정하거나 보증하지 않습니다.</p>
          <PaperDiagnosisVisual state={state}/>
          <section className="pcv-controller-observations" aria-label="실행에서 받은 컨트롤러 위치 관측">
            <h3>실행에서 받은 컨트롤러 위치</h3>
            {state.run?.observations.length ? <>
              <p className="pcv-note">아래는 실행 기록에 담긴 위치 보고와 측정된 종이 좌표계의 환산값입니다. 환산은 잉크 위치 측정이 아닙니다.</p>
              <div className="pcv-observation-list">
                {state.run.observations.map((observation, index) => (
                  <article className="pcv-observation-item" key={`${observation.point}-${observation.measuredAt}-${index}`} {...rowProps(observation.point)} tabIndex={merged?0:undefined} onClick={merged?()=>selectPaperPoint(observation.point):undefined}>
                    <div><span className="pcv-point-tag">{observation.point}</span><strong>{sourceLabel(observation.source)}</strong></div>
                    <p>TCP · X {numberLabel(observation.pose.x)} mm · Y {numberLabel(observation.pose.y)} mm · Z {numberLabel(observation.pose.z)} mm · R {numberLabel(observation.pose.r)}°</p>
                    {state.convertedReadings.find(reading => reading.point === observation.point && reading.measuredAt === observation.measuredAt)
                      && <p>기준점 환산 · 종이 x {numberLabel(state.convertedReadings.find(reading => reading.point === observation.point && reading.measuredAt === observation.measuredAt)?.xCm)} cm · y {numberLabel(state.convertedReadings.find(reading => reading.point === observation.point && reading.measuredAt === observation.measuredAt)?.yCm)} cm</p>}
                    <small>{observation.kind} · seq {observation.seq ?? "—"} · {timeLabel(observation.measuredAt)}</small>
                  </article>
                ))}
              </div>
            </> : <p className="pcv-empty">현재 실행에 연결된 컨트롤러 관측이 없습니다.</p>}
            <p className="pcv-note">하드웨어 자료는 컨트롤러의 TCP 보고 좌표 보고 위치입니다. 모의·DT 자료는 실제 측정값이 아닙니다.</p>
          </section>
          <div className="pcv-observation-layout">
            {renderPaperGrid()}
            <div className="pcv-ink-list">
              <h3>종이 눈금에서 잉크 위치 읽기</h3>
              {state.targetPoints.map(point => {
                const reading = state.inkReadings.find(item => item.point === point.name);
                return <fieldset className="pcv-ink-row" key={point.name} {...rowProps(point.name)}>
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
          {renderPaperGrid()}
          {state.revalidationScope && <p className="pcv-success" role="status">{state.revalidationScope}</p>}
          <PaperDiagnosisVisual state={state} cause={hypothesisDraft} onCauseChange={setHypothesisDraft} onSaveCause={()=>actions.onSaveHypothesis(hypothesisDraft)}/>
          {state.diagnosis ? <section className="pcv-interpretation" aria-label="비교 해석">
            <div className="pcv-interpretation-head"><StatusPill tone={state.diagnosis.status === "complete" ? "good" : "warn"}>{state.diagnosis.status === "complete" ? "비교 자료 준비됨" : state.diagnosis.status === "invalidated" ? "자료 다시 확인 필요" : "비교 미완료"}</StatusPill>
              <span>{sourceLabel(state.diagnosis.source)}</span></div>
            {!rectangle&&<h3>{state.diagnosis.candidate}</h3>}
            <p className="pcv-note">자료 기반 규칙 진단 · 지원 {state.diagnosis.supportLevel??1}단계 · 아래 질문은 기본 질문입니다. AI 튜터에는 같은 관측 근거를 전달합니다.</p>
            {!rectangle&&<p className="pcv-question">{state.diagnosis.question}</p>}
            <p className="pcv-note">{state.diagnosis.why}</p>
            <details className="pcv-details">
              <summary>자세한 근거 보기</summary>
              <p>{state.diagnosis.candidate}</p>
              <EvidenceRows title="제어기 보고와 명령 차이" rows={state.diagnosis.evidence} />
              <EvidenceRows title="종이 목표 대비 보고 위치 차이" rows={state.diagnosis.taskEvidence??[]} />
              <EvidenceRows title="내 변환식 대비 명령 좌표 차이" rows={state.diagnosis.predictionEvidence} />
              <p>첫 차이 지점: {state.diagnosis.firstMismatch ?? "없음"}</p>
              <p>판정 방식: {state.diagnosis.method} · 질문 출처: {state.diagnosis.tutorSource}</p>
            </details>
          </section> : <div className="pcv-empty-card"><strong>비교 자료를 기다리는 중</strong><p>실행 결과와 관찰 기록이 전달되면 이곳에 표시됩니다.</p></div>}
          {!state.comparison&&<><label className="pcv-field"><span>내가 생각하는 이유 (원인을 단정하지 않고 후보로)</span><textarea rows={4} value={hypothesisDraft}
            onChange={event => setHypothesisDraft(event.target.value)} /></label>
          <button type="button" className="pcv-button pcv-button--primary" onClick={() => actions.onSaveHypothesis(hypothesisDraft)} disabled={state.running}>생각 저장</button></>}
        </>;
      case 7:
        return <>
          <p className="pcv-lead">비교에서 발견한 점을 바탕으로 설명이나 좌표를 다시 살펴보고, 필요하면 새 조건으로 확인합니다.</p>
          {state.diagnosis && <div className="pcv-interpretation pcv-interpretation--compact"><StatusPill tone="warn">가능한 해석</StatusPill><p>{state.diagnosis.candidate}</p><p className="pcv-note">{state.diagnosis.question}</p></div>}
          <label className="pcv-field"><span>어떤 피드백을 보고, 계산의 어느 부분을 바꾸나요?</span><textarea aria-label="무엇을 다시 살펴볼까요?" rows={4} value={revisionDraft}
            placeholder="받은 질문과 연결해, 바꿀 식·좌표와 그 이유를 적어 주세요."
            onChange={event => setRevisionDraft(event.target.value)} /></label>
          <div className="pcv-button-row pcv-button-row--wrap">
            <button type="button" className="pcv-button pcv-button--primary" onClick={() => actions.onRevise(revisionDraft)} disabled={state.running}>이유와 수정 기록</button>
            {!rectangle&&<button type="button" className="pcv-button pcv-button--outline" onClick={actions.onChooseNewTarget} disabled={state.running}>다른 목표로 이어가기</button>}
          </div>
          <div className="pcv-callout pcv-callout--compact">
            <strong>종이 위치가 바뀌었나요?</strong>
            <p>종이를 옮긴 뒤에는 기존 기준점을 그대로 쓰지 않습니다. 종이를 정렬하고 기준점을 다시 기록해 주세요.</p>
            <button type="button" className="pcv-button pcv-button--quiet" onClick={()=>actions.onMovePaper(revisionDraft)} disabled={state.running}>종이를 옮겼어요 · 기준점 다시 기록</button>
          </div>
        </>;
    }
  };

  return (
    <section ref={root} className="paper-coordinate-view" data-paper-sync={merged?"true":undefined} aria-label="종이 좌표 변환 학습">
      {!merged&&<header className="pcv-header">
        <button type="button" className="pcv-back" onClick={actions.onBack} disabled={state.running}>← <span>사각형 수업으로</span></button>
        <div className="pcv-header-title"><span className="pcv-eyebrow">MG400 · {rectangle?"사각형 심화 과제":"좌표 확장 활동"}</span><h1>{rectangle?LEVEL_LABELS[state.level]:"종이 좌표를 로봇 좌표로"}</h1>
          <p>사각형에서 배운 좌표 관계를 실제 크기의 격자에 이어 봅니다.</p></div>
        <div className="pcv-header-meta"><span>현재 활동</span><strong>{activeTitle}</strong></div>
      </header>}

      <div className="pcv-stage-details">
      <nav className="pcv-stage-nav" aria-label="7단계 학습 흐름">
        {STAGES.map((stage, index) => (
          <button type="button" key={stage.id} className={`pcv-stage${state.stage === stage.id ? " is-current" : ""}`}
            aria-current={state.stage === stage.id ? "step" : undefined} onClick={() => actions.onStageChange(stage.id)}>
            <span className="pcv-stage-index">{String(index + 1).padStart(2, "0")}</span><span>{stage.title}</span>
          </button>
        ))}
      </nav></div>

      {state.error && state.stage!==4 && <p className="pcv-alert" role="alert">{state.error}</p>}
      <LearningRevisionJourney data={journey}/>
      {merged&&<PaperSceneMap/>}
      <RevisionEditingLayout data={journey}>
      <main className="pcv-main">
        <section className="pcv-activity" aria-labelledby={`${id}-activity-heading`}>
          <div className="pcv-activity-kicker"><span>지금 하는 일</span><span>단계 {state.stage} / 7</span></div>
          <h2 id={`${id}-activity-heading`}>{activeTitle}</h2>
          {renderActiveStage()}
        </section>
        <aside className="pcv-side-note" aria-label="현재 좌표 정보">
          <span className="pcv-eyebrow">{state.stage===1||state.stage===4 ? "현재 보고된 위치" : "저장된 관측을 비교합니다"}</span>
          <details open={state.stage===1||state.stage===4}><summary>연결 위치 확인</summary>
          {displayPose ? <div className="pcv-pose-readout">
            {POSE_FIELDS.map(field => <div key={field.key}><span>{field.label} · {field.unit}</span><strong>{numberLabel(displayPose?.[field.key])}</strong></div>)}
          </div> : <p>현재 위치 자료가 없습니다.</p>}
          <div className="pcv-side-source"><span>자료 출처</span><strong>{sourceLabel(merged?state.displaySource??state.currentSource:state.currentSource)}</strong>{merged&&state.currentSource&&<small>수신 {timeLabel(state.currentMeasuredAt)} · seq {state.currentSequence??"—"}</small>}</div>
          {merged&&!state.currentPose&&<p className="pcv-note">DT 표시 좌표입니다. 실제 기준점 기록에는 연결된 장비의 유효한 위치 보고가 필요합니다.</p>}
          <div className="pcv-side-source"><span>좌표 설정</span><strong>{state.coordinateSystem || "미기록"} · User {state.user} / Tool {state.tool}</strong></div>
          <StatusPill tone={state.coordinatesVerified ? "good" : "warn"}>{state.coordinatesVerified ? "좌표 설정 확인됨" : "좌표 설정 확인 전"}</StatusPill>
          </details>
          <p className="pcv-side-caution">TCP 보고 좌표는 제어기가 보고한 위치입니다. 펜 끝이나 종이의 잉크 위치를 뜻하지 않습니다.</p>
        </aside>
      </main>
      </RevisionEditingLayout>

      <div className="pcv-button-row"><button className="pcv-button" disabled={state.running||state.stage===1} onClick={()=>actions.onStageChange((state.stage-1) as PaperLessonStage)}>이전</button><button className="pcv-button pcv-button--primary" disabled={state.running||state.stage===7} onClick={()=>actions.onStageChange((state.stage+1) as PaperLessonStage)}>다음 단계</button></div>
      <details className="pcv-details pcv-records"><summary>시도 연결 기록 · {state.records.length}회</summary>
        {state.records.map(r=><article key={r.id}><h3>시도 {r.attempt} · {sourceLabel(r.run?.source??r.dataSource)}</h3><p>{isPaperRectangle(r.level)?"사각형 P1/P2/P3/P4":r.targetSet==="initial"?"첫 목표 A/B/C":"새 목표 D/E/F"} · 이전 시도 {state.records.find(p=>p.id===r.parentAttemptId)?.attempt??"없음"}</p><p>관측 {r.run?.observations.length??0}개 · {r.diagnosis?.candidate??"비교 전"}</p><p>가설: {r.studentHypothesis??"작성 전"} · 수정: {r.revisionReason??"작성 전"}</p><p>{r.revalidation?.scope??"재검증 완료 전"}</p></article>)}
        <button className="pcv-button" onClick={actions.onExport}>연결된 학습 기록 내려받기</button>
      </details>
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
      <small className="square-ui-version">과제 버전: {merged?"v4-paper-merged":"기존 종이 과제"}</small>
    </section>
  );
}

function EvidenceRows({ title, rows }: { title: string; rows: Array<{ point: string; dx: number; dy: number; distance: number }> }) {
  return <section className="pcv-evidence-rows"><h4>{title}</h4>{rows.length ? rows.map((row, index) => (
    <p key={`${row.point}-${index}`}>{row.point}: ΔX {numberLabel(row.dx)} mm · ΔY {numberLabel(row.dy)} mm · 거리 {numberLabel(row.distance)} mm</p>
  )) : <p>비교 근거가 없습니다.</p>}</section>;
}

export default PaperCoordinateStudyView;
