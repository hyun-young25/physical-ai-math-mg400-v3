import type { Evidence } from "./MathInquiry";

function sourceLabel(run: Evidence) {
  const detail = run.detail as { source?: string; requestedMode?: string; motion?: { source?: string } } | undefined;
  const source = detail?.source ?? detail?.motion?.source;
  if (!source && detail?.requestedMode) return detail.requestedMode === "hardware"
    ? "실제 모드 이동 요청 · 완료 측정 없음" : "가상 이동 요청";
  return source === "hardware" ? "실제 측정" : source === "mock" ? "모의 통신 · 실측 아님"
    : source === "virtual" ? "가상 DT · 실측 아님" : "수학 확인 · 실측 아님";
}

export function FoundationMovePanel({ hardware, moving, observed, motion, message, runs, onMove, taskId }: {
  hardware: boolean; moving: boolean; observed: boolean; motion: boolean;
  message: string; runs: Evidence[]; onMove: () => void; taskId: string;
}) {
  return <section className="lesson-card" aria-label="최종 정답 확인과 로봇 이동">
    <h3>최종 단계 · {motion ? "정답 확인 후 로봇 이동" : "수학 관계 확인"}</h3>
    <p>단계별 ‘답 확인’은 채점만 합니다. 아래 버튼을 눌러야 저장된 전체 답을 확인하고
      {motion ? " 이동을 요청합니다." : " 수학 관계를 확인합니다."}
      {hardware && motion ? " 실제 실행은 별도 확인 창에서 승인해야 시작됩니다." : ""}</p>
    {motion && taskId.startsWith("height-") && <p>
      MoveL 직선 이동: Z={taskId === "height-transfer" ? 45 : 20} → 60 mm, X·Y·R 유지.
      실제 출발 위치가 다르면 이동을 차단하고 현재값과 필요한 출발값을 안내합니다. 자동으로 맞추지 않습니다.
      흡착·집기 명령은 포함하지 않습니다.
    </p>}
    {observed && motion && <p>처음 입력한 답·근거와 이전 실행 기록을 그대로 사용합니다.
      모드를 바꾸는 것만으로는 움직이지 않습니다.</p>}
    <button className="lesson-primary" disabled={moving || (!motion && observed)} onClick={onMove}>
      {moving ? "이동 확인 중…" : motion
        ? hardware ? observed ? "같은 답으로 실제 로봇 이동 (확인 창) →" : "정답 확인 · 실제 로봇 이동 (확인 창) →"
          : observed ? "같은 답으로 가상 로봇 이동 →" : "정답 확인 · 가상 로봇 이동 →"
        : "수학 관계 확인 →"}
    </button>
    {message && <p role="status" aria-live="polite" className="lesson-feedback">{message}</p>}
    {runs.length > 0 && <details open>
      <summary>이 답으로 확인한 실행 기록 ({runs.length})</summary>
      <ol>{runs.map((run, i) => <li key={`${run.startedAt}-${i}`}>
        <strong>{sourceLabel(run)} · {run.status === "completed" ? "완료" : run.status === "stopped" ? "취소·중단" : "실행 차단"}</strong>
        <p>{run.summary}</p>
      </li>)}</ol>
    </details>}
  </section>;
}
