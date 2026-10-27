import type { LessonJoints } from "./curriculum";
import type { PracticeOperation } from "./practiceSession";

/** Display-only conversion; never apply this to TCP commands or raw readouts.
 * DOBOT's J2 is measured from vertical; J3 is an absolute forearm angle.
 * Robot3D expects shoulder elevation and an elbow angle relative to the upper arm.
 * Source geometry: Dobot-Arm/MG400_ROS, mg400_description/urdf/mg400_description.urdf.
 * The URDF main forearm rotation is J2 + J3 - J2 = J3 about +Y.
 */
export function hardwareToSceneJoints(q: LessonJoints): LessonJoints {
  return { j1: q.j1, j2: 90 - q.j2, j3: q.j2 - q.j3 - 90, j4: q.j4 };
}

/** Resolve against fresh measured TCP in PracticeSession, after confirmation. */
export function hardwareStep(axis: "x" | "y" | "z" | "r", direction: 1 | -1, step: number): PracticeOperation {
  if (!Number.isFinite(step) || step <= 0 || step > 10) throw new Error("이동 간격은 0 초과 10 이하로 선택하세요.");
  return { kind: "move", motion: "MoveL", relative: true,
    target: { x: 0, y: 0, z: 0, r: 0, [axis]: direction * step } };
}
