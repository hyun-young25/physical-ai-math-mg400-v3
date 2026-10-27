export const JUDGMENT_BASES = [
  { value: "manipulation", label: "직접 조작" },
  { value: "visualization", label: "좌표·경로 그림" },
  { value: "comparison", label: "예측과 결과 비교" },
  { value: "feedback", label: "질문·힌트·피드백" },
  { value: "teacher", label: "교수자 안내" },
  { value: "own-reasoning", label: "내 계산·설명" },
] as const;
export type LearningJudgment = {
  decision: "" | "maintain" | "revise";
  basis: "" | typeof JUDGMENT_BASES[number]["value"];
};
export const emptyJudgment = (): LearningJudgment => ({ decision: "", basis: "" });
export type LearningTaskKind = "practice" | "representative" | "transfer";
export function learningTaskKind(condition: unknown): LearningTaskKind {
  const kind = (condition as { taskKind?: LearningTaskKind } | null)?.taskKind;
  return kind === "practice" || kind === "transfer" ? kind : "representative";
}
export const judgmentComplete = (value: LearningJudgment, requireBasis = true) =>
  ["maintain", "revise"].includes(value.decision) && (!requireBasis || JUDGMENT_BASES.some(item => item.value === value.basis));
export const reflectionRequired = (kind: LearningTaskKind, value: LearningJudgment) =>
  kind !== "practice" || value.decision === "revise";
export const sameJudgment = (a: LearningJudgment | undefined, b: LearningJudgment) =>
  !!a && a.decision === b.decision && a.basis === b.basis;

/** Two compact choices reuse the current lesson's input styles and explanation field. */
export function LearningJudgmentFields({ value, onChange, disabled, idPrefix, fieldClassName = "", showBasis = true }: {
  value: LearningJudgment; onChange: (value: LearningJudgment) => void;
  disabled?: boolean; idPrefix: string; fieldClassName?: string; showBasis?: boolean;
}) {
  return <div className="inquiry-fields learning-judgment" aria-label="판단 정리">
    <div className={fieldClassName}>
      <label htmlFor={`${idPrefix}-decision`}>비교 후 내 판단</label>
      <select id={`${idPrefix}-decision`} aria-label="비교 후 내 판단" value={value.decision} disabled={disabled}
        onChange={event => onChange({ ...value, decision: event.target.value as LearningJudgment["decision"] })}>
        <option value="">선택하세요</option><option value="maintain">처음 판단 유지</option><option value="revise">판단 수정</option>
      </select>
    </div>
    {showBasis && <div className={fieldClassName}>
      <label htmlFor={`${idPrefix}-basis`}>가장 참고한 정보</label>
      <select id={`${idPrefix}-basis`} aria-label="가장 참고한 정보" value={value.basis} disabled={disabled}
        onChange={event => onChange({ ...value, basis: event.target.value as LearningJudgment["basis"] })}>
        <option value="">선택하세요</option>{JUDGMENT_BASES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
    </div>}
  </div>;
}
