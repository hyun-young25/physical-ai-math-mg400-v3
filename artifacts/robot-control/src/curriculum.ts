export const CHAPTERS = [
  "용어·기호와 기초수학",
  "좌표와 로봇 이동",
  "로봇 운동학",
  "운동학 종합과제: 픽앤플레이스",
] as const;
export type Chapter = typeof CHAPTERS[number];

export const COORDINATE_TOPICS = [
  { id: "axes", label: "좌표축과 이동 방향" },
  { id: "coordinates", label: "절대좌표·상대좌표와 변화량" },
  { id: "motion", label: "MoveJ·MoveL 비교" },
  { id: "shapes", label: "도형 경로 만들기" },
] as const;
export type CoordinateTopic = typeof COORDINATE_TOPICS[number]["id"];

export const KINEMATICS_TOPICS = [
  { id: "fk", label: "순기구학(FK)" },
  { id: "ik", label: "역기구학(IK)" },
] as const;
export type KinematicsTopic = typeof KINEMATICS_TOPICS[number]["id"];

export type LessonPose = { x: number; y: number; z: number; r: number };
export type LessonJoints = { j1: number; j2: number; j3: number; j4: number };
export type LessonModel = {
  fk: (joints: LessonJoints) => LessonPose;
  ik: (x: number, y: number, z: number, r: number, hint: number) => LessonJoints | null;
};
export const POSE_AXES = ["x", "y", "z"] as const;
export const JOINT_AXES = ["j1", "j2", "j3", "j4"] as const;
export function parseLessonNumber(raw: string): number | null {
  if (!raw.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
export function translatePose(start: LessonPose, delta: Pick<LessonPose, "x" | "y" | "z">): LessonPose {
  return { x: start.x + delta.x, y: start.y + delta.y, z: start.z + delta.z, r: start.r };
}
export function poseDifference(start: LessonPose, end: LessonPose) {
  return { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z };
}
export function interpolatePose(from: LessonPose, to: LessonPose, t: number): LessonPose {
  return { x: from.x + (to.x-from.x)*t, y: from.y + (to.y-from.y)*t,
    z: from.z + (to.z-from.z)*t, r: from.r + (to.r-from.r)*t };
}
export function interpolateJoints(from: LessonJoints, to: LessonJoints, t: number): LessonJoints {
  return { j1: from.j1+(to.j1-from.j1)*t, j2: from.j2+(to.j2-from.j2)*t,
    j3: from.j3+(to.j3-from.j3)*t, j4: from.j4+(to.j4-from.j4)*t };
}
export type LessonFrame = { pose: LessonPose; joints: LessonJoints };
// Uses the same FK/IK callbacks as the existing robot. Never sends hardware commands.
export function sampleLessonMotion(model: LessonModel, from: LessonPose, to: LessonPose,
  mode: "MoveJ" | "MoveL", hint: number): LessonFrame[] | null {
  if (![...Object.values(from), ...Object.values(to)].every(Number.isFinite)) return null;
  const a = model.ik(from.x, from.y, from.z, from.r, hint);
  const b = a && model.ik(to.x, to.y, to.z, to.r, a.j3);
  if (!a || !b) return null;
  const frames: LessonFrame[] = [];
  let previous = a;
  for (let i = 0; i <= 120; i++) {
    const t = i / 120;
    const linear = interpolatePose(from, to, t);
    const joints = mode === "MoveJ" ? interpolateJoints(a, b, t)
      : model.ik(linear.x, linear.y, linear.z, linear.r, previous.j3);
    if (!joints || !Object.values(joints).every(Number.isFinite)) return null;
    const pose = mode === "MoveJ" ? model.fk(joints) : linear;
    if (!Object.values(pose).every(Number.isFinite)) return null;
    frames.push({ pose, joints });
    previous = joints;
  }
  return frames;
}
