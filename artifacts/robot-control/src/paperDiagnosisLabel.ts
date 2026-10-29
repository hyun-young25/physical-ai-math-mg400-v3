import type { PaperDiagnosis } from "./paperCoordinateStudy";

export const PAPER_PATTERN_LABELS: Record<NonNullable<PaperDiagnosis["pattern"]>, string> = {
  match: "목표와 일치", "origin-missing": "기준점 누락", tracking: "명령–보고 위치 차이",
  translation: "이동 차이", rotation: "회전 오류", scale: "배율 차이", calculation: "대입·계산 차이", mixed: "혼합 차이",
};
// A specific observed calculation pattern is carried in the existing candidate text.
// Keep the persisted pattern vocabulary and CSV schema backward compatible.
export const PAPER_AXIS_SWAP_CANDIDATE = "축 뒤바뀜: ";
export function paperDiagnosisLabel(d: PaperDiagnosis) {
  return (d.pattern === "calculation" && d.candidate.startsWith(PAPER_AXIS_SWAP_CANDIDATE)
    ? "축 뒤바뀜" : d.pattern ? PAPER_PATTERN_LABELS[d.pattern] : "판정 전")
    + (d.firstMismatch ? ` · ${d.firstMismatch}` : "");
}
