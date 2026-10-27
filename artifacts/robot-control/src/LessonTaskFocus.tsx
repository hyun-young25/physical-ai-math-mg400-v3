type LessonTaskFocusProps = {
  title: string;
  goal: string;
  steps: string[];
  required?: string;
};

export function LessonTaskFocus({ title, goal, steps, required }: LessonTaskFocusProps) {
  return (
    <section className="lesson-task-focus lesson-task-focus--compact" aria-label="이번 문제">
      <div className="lesson-task-focus__compact-line">
        <strong>학습 과제</strong>
        <b>{title}</b>
        <span>{goal}</span>
      </div>
      <details className="lesson-task-focus__details">
        <summary>문제·진행 순서·완료 조건 보기</summary>
        <div className="lesson-task-focus__goal">
          <strong>문제</strong>
          <p>{goal}</p>
        </div>
        <div className="lesson-task-focus__sequence">
          <strong>진행 순서</strong>
          <ol className="lesson-task-steps">
            {steps.slice(0, 4).map((step, index) => (
              <li key={`${index}-${step}`}>
                <strong>{step}</strong>
              </li>
            ))}
          </ol>
        </div>
        {required && (
          <div className="lesson-task-focus__required">
            <strong>완료 조건</strong>
            <p>{required}</p>
          </div>
        )}
      </details>
    </section>
  );
}
