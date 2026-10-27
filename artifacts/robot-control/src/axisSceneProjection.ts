import type { LessonJoints, LessonModel, LessonPose } from "./curriculum";

export type ScenePoint = [number, number, number];

/** Read-only projection of URDFRobot's existing main chain and coaxial TCP.
 * The teaching FK uses two 175 mm links. The CAD scene additionally contains
 * shoulder, wrist and tool offsets, some of which rotate with J1/J2/J3.
 * A single Cartesian translation cannot align both after lateral movement.
 * Keep those angles and offsets intact; project annotations through that chain.
 */
export function axisSceneTcp(joints: LessonJoints): ScenePoint {
  const d = Math.PI / 180, a1 = joints.j1*d, a2 = joints.j2*d, a23 = (joints.j2+joints.j3)*d;
  // URDF offsets in mm: J1 (-5,0,109), J2 (43.5,-35.8,119),
  // J3 (-1.05,35.77,175), J41 (175,-17,3.25), suction TCP (66,17,31-121).
  const reach = 43.5 + 175*Math.cos(a2) - 1.05*Math.sin(a2)
    + 175*Math.cos(a23) - 3.25*Math.sin(a23) + 66;
  const lateral = -35.8 + 35.77 - 17 + 17;
  const height = 109 + 119 + 175*Math.sin(a2) + 1.05*Math.cos(a2)
    + 175*Math.sin(a23) + 3.25*Math.cos(a23) + 31 - 121;
  // Root rotation -PI/2 around X, metres converted to mm.
  return [-5 + reach*Math.cos(a1) - lateral*Math.sin(a1), height,
    -(reach*Math.sin(a1) + lateral*Math.cos(a1))];
}

export function createAxisSceneProjection(model: LessonModel, hintJ3: number) {
  return (pose: LessonPose): ScenePoint | null => {
    if (!Object.values(pose).every(Number.isFinite)) return null;
    const joints = model.ik(pose.x, pose.y, pose.z, pose.r, hintJ3);
    return joints && Object.values(joints).every(Number.isFinite) ? axisSceneTcp(joints) : null;
  };
}
