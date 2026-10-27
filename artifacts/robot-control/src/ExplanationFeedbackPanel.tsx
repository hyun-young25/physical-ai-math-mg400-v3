import type { ExplanationAssessment } from "./explanationFeedback";

const verdicts = {
  confirmed: "수학 관계 확인",
  revise: "이 부분을 확인해 보세요",
  elaborate: "생각을 더 풀어볼까요?",
  review: "설명 기록·교사 검토",
};
const states = {
  confirmed: "확인됨",
  error: "다시 확인",
  missing: "아직 확인하지 못함",
  review: "교사 검토 필요",
  context: "문항·입력값 참고",
};
export function ExplanationFeedback({
  assessment,
  title,
}: {
  assessment: ExplanationAssessment;
  title: string;
}) {
  const focus = assessment.feedback ?? {
    message:
      assessment.criteria.find((c) => c.state === "error")?.message ??
      "저장된 확인 내용입니다. 문항과 숫자 답을 함께 보며 설명을 검토하세요.",
  };
  return (
    <section className="explanation-feedback" aria-label={title}>
      <h4>
        {title} · {verdicts[assessment.verdict]}
      </h4>
      <p>{focus.message}</p>
      {focus.question && (
        <p className="explanation-question">
          <strong>생각해 볼 질문</strong> {focus.question}
        </p>
      )}
      <details>
        <summary>확인한 내용 보기</summary>
        <p className="lesson-note">
          문항과 입력값, 설명을 함께 참고합니다. 자동으로 확인하지 못한 표현을
          오답으로 처리하지 않습니다. 설명 전체의 타당성은 교사가 검토할 수
          있습니다.
        </p>
        <ul>
          {assessment.criteria.map((c) => (
            <li key={c.key} data-state={c.state}>
              <strong>
                {c.label} · {states[c.state]}
              </strong>
              <p>{c.message}</p>
              {!!c.evidence.length && (
                <details>
                  <summary>확인에 사용한 내 표현</summary>
                  {[...new Set(c.evidence)].map((e, i) => (
                    <blockquote key={i}>{e}</blockquote>
                  ))}
                </details>
              )}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
