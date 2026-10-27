import type { LessonJoints, LessonModel } from "./curriculum";
export const FK_REFERENCE: LessonJoints = { j1: 0, j2: 45, j3: -90, j4: 0 };
export const FK_FIRST: LessonJoints = { j1: 0, j2: 60, j3: -90, j4: 0 };
export const horizontalReach = (j: LessonJoints) =>
  175 *
  (Math.cos((j.j2 * Math.PI) / 180) +
    Math.cos(((j.j2 + j.j3) * Math.PI) / 180));
const trend = (difference: number) =>
  Math.abs(difference) <= 0.15
    ? "same"
    : difference > 0
      ? "increase"
      : "decrease";
export function fkTrends(
  model: LessonModel,
  input: LessonJoints,
  reference: LessonJoints,
) {
  return {
    height: trend(model.fk(input).z - model.fk(reference).z),
    reach: trend(horizontalReach(input) - horizontalReach(reference)),
  };
}
export function nextFKJoints(j: LessonJoints, round: number): LessonJoints {
  const shift = (n: number, delta: number) =>
    n + delta > 180 ? n - delta : n + delta;
  if (round % 3 === 0) return { ...j, j2: shift(j.j2, 15) };
  if (round % 3 === 1) return { ...j, j3: shift(j.j3, 15) };
  return { ...j, j4: shift(j.j4, 30) };
}
