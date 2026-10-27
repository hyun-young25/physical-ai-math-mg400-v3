import type { LessonJoints, LessonModel, LessonPose } from "./curriculum";
import { processFK, processIK } from "./processKinematics";

/** The drawing pen extends 23 mm below the suction-tip reference. */
export const SHAPE_PEN_TIP_LOCAL_Z = -0.144;
export const SHAPE_PEN_TIP_OFFSET = 23;
export const SHAPE_HOME_JOINTS: Readonly<LessonJoints> = Object.freeze({
  j1: 0, j2: 69.02, j3: -113.32, j4: 0,
});

// Calibrate once against the unchanged rendered chain. A fixed Cartesian
// origin preserves the lesson coordinates while the actual rotating shoulder
// and wrist offsets remain in FK/IK. Never recalibrate from the current pose.
const home = processFK(SHAPE_HOME_JOINTS);
export const SHAPE_WORLD_ORIGIN = Object.freeze({
  x: home.x - 350,
  y: home.y,
  z: home.z - SHAPE_PEN_TIP_OFFSET,
});

export function shapeFK(joints: LessonJoints): LessonPose {
  const tip = processFK(joints);
  return {
    x: tip.x - SHAPE_WORLD_ORIGIN.x,
    y: tip.y - SHAPE_WORLD_ORIGIN.y,
    z: tip.z - SHAPE_PEN_TIP_OFFSET - SHAPE_WORLD_ORIGIN.z,
    r: tip.r,
  };
}

export function shapeIK(x: number, y: number, z: number, r: number, hintJ3 = -1): LessonJoints | null {
  return processIK(
    x + SHAPE_WORLD_ORIGIN.x,
    y + SHAPE_WORLD_ORIGIN.y,
    z + SHAPE_WORLD_ORIGIN.z + SHAPE_PEN_TIP_OFFSET,
    r,
    hintJ3,
  );
}

/** Drawing coordinates (Z up) to the rendered pen tip (Three.js Y up). */
export function shapeWorldPoint(point: Pick<LessonPose, "x" | "y" | "z">): [number, number, number] {
  return [
    point.x + SHAPE_WORLD_ORIGIN.x,
    point.z + SHAPE_WORLD_ORIGIN.z,
    -(point.y + SHAPE_WORLD_ORIGIN.y),
  ];
}

export const SHAPE_MODEL: LessonModel = { fk: shapeFK, ik: shapeIK };
