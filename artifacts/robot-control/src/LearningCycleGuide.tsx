import { LEARNING_STAGES } from "./learningFramework";

export function LearningCycleGuide() {
  return <details className="axis-help learning-cycle-guide">
    <summary>이 활동의 학습 흐름 · 지금은 한 단계만</summary>
    <div className="learning-cycle-summary">
      {LEARNING_STAGES.map((s, index) => <span key={s.id} className="learning-cycle-step">
        <b>{index + 1}</b>{s.short}
      </span>)}
    </div>
    <p>현재 단계의 조건을 수학으로 표현하고, 예측한 뒤 DT를 실행합니다. 결과와 예측이 다르면 한 가지 관계만 고쳐 새 조건에서 다시 확인합니다.</p>
    <p className="lesson-note">이 화면의 실행은 DT 기록입니다. 실장비 측정값과 구분해 저장하며, 서술형 설명은 자동 판정과 교사 검토를 구분합니다.</p>
  </details>;
}
