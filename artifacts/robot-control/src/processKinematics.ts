import type { LessonJoints, LessonModel, LessonPose } from "./curriculum";

/**
 * The process cell uses the actual, unchanged URDFRobot joint chain in Robot3D.
 * Coordinates are millimetres from the fixed base, Z up. Unlike the earlier
 * two-link lesson model, the shoulder and tool offsets rotate with J1.
 * This is a geometric model of the displayed assembly, not hardware limits.
 */
const D = Math.PI / 180;
const L1 = Math.hypot(175, 1.05);
const L2 = Math.hypot(175, 3.25);
const A1 = Math.atan2(1.05, 175);
const A2 = Math.atan2(3.25, 175);
const RADIAL_OFFSET = 109.5;
const TANGENTIAL_OFFSET = -0.03;
const BASE_X = -5;
const BASE_Z = 138;

export function processAngle(degrees: number): number {
  return ((degrees + 180) % 360 + 360) % 360 - 180;
}

export function processFK(joints: LessonJoints): LessonPose {
  if (![joints.j1, joints.j2, joints.j3, joints.j4].every(Number.isFinite)) {
    throw new RangeError("Process cell joints must be finite");
  }
  const yaw = joints.j1 * D;
  const shoulder = joints.j2 * D + A1;
  const elbow = (joints.j2 + joints.j3) * D + A2;
  const reach = RADIAL_OFFSET + L1 * Math.cos(shoulder) + L2 * Math.cos(elbow);
  return {
    x: BASE_X + reach * Math.cos(yaw) - TANGENTIAL_OFFSET * Math.sin(yaw),
    y: reach * Math.sin(yaw) + TANGENTIAL_OFFSET * Math.cos(yaw),
    z: BASE_Z + L1 * Math.sin(shoulder) + L2 * Math.sin(elbow),
    r: processAngle(joints.j1 + joints.j4),
  };
}

export function processIK(x: number, y: number, z: number, r: number, hintJ3 = -1): LessonJoints | null {
  if (![x, y, z, r, hintJ3].every(Number.isFinite)) return null;
  const baseX = x - BASE_X;
  const radiusSquared = baseX * baseX + y * y;
  const radialSquared = radiusSquared - TANGENTIAL_OFFSET ** 2;
  if (!Number.isFinite(radialSquared) || radialSquared < -1e-9) return null;
  const radialMagnitude = Math.sqrt(Math.max(0, radialSquared));
  const height = z - BASE_Z;

  // Prefer the outward-facing branch. A folded arm can also have negative
  // radial reach; consider that branch only if no outward solution exists.
  for (const reach of [radialMagnitude, -radialMagnitude]) {
    const planarX = reach - RADIAL_OFFSET;
    const cosine = (planarX ** 2 + height ** 2 - L1 ** 2 - L2 ** 2) / (2 * L1 * L2);
    if (!Number.isFinite(cosine) || cosine < -1 - 1e-10 || cosine > 1 + 1e-10) continue;
    const magnitude = Math.acos(Math.max(-1, Math.min(1, cosine)));
    const yaw = Math.atan2(y, baseX) - Math.atan2(TANGENTIAL_OFFSET, reach);
    const candidates = [-magnitude, magnitude].map(delta => {
      const shoulder = Math.atan2(height, planarX)
        - Math.atan2(L2 * Math.sin(delta), L1 + L2 * Math.cos(delta));
      const j1 = processAngle(yaw / D);
      return {
        j1,
        j2: processAngle((shoulder - A1) / D),
        j3: (delta + A1 - A2) / D,
        j4: processAngle(r - j1),
      };
    });
    candidates.sort((a, b) => Math.abs(a.j3 - hintJ3) - Math.abs(b.j3 - hintJ3));
    return candidates[0];
  }
  return null;
}

export const PROCESS_MODEL: LessonModel = { fk: processFK, ik: processIK };
