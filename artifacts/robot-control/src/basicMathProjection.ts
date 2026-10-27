import type { LessonJoints } from "./curriculum";

/** Link-plane coordinates and robot-base coordinates are different when J1 rotates. */
export function basicMathProjection(joints: LessonJoints) {
  const radians = Math.PI / 180;
  const shoulder = joints.j2 * radians, elbow = (joints.j2 + joints.j3) * radians;
  const base = joints.j1 * radians;
  const rho = 175 * Math.cos(shoulder) + 175 * Math.cos(elbow);
  const height = 175 * Math.sin(shoulder) + 175 * Math.sin(elbow);
  return { rho, height, base: joints.j1,
    projectedX: rho * Math.cos(base), x: rho * Math.cos(base) + 162.124,
    y: rho * Math.sin(base), z: height - 41.202 };
}
