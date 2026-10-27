import type { InquiryField } from "./MathInquiry";
import type { LessonFrame, LessonJoints, LessonModel, LessonPose } from "./curriculum";
import { FK_FIRST, FK_REFERENCE, fkTrends, horizontalReach } from "./fkLearning";

// These are the existing display model's constants, not hardware specifications.
export const LEARNING_MODEL = { l1: 175, l2: 175, offsetX: 162.124, offsetZ: -41.202 };
export const KINEMATICS_TOLERANCE = 0.1;
export const KINEMATICS_JOINT_LABELS: Record<keyof LessonJoints, string> = {
  j1: "θ₁ 베이스", j2: "θ₂ 어깨", j3: "θ₃ 상대 팔꿈치", j4: "θ₄ 말단",
};
export type KinematicsVisual = {
  joint: keyof LessonJoints;
  reference: number;
  input?: number;
};
const trendOptions = [{ value: "increase", label: "증가" }, { value: "decrease", label: "감소" }, { value: "same", label: "유지" }];
const coordinate = (key: string): InquiryField => ({ key, label: `예상 ${key.toUpperCase()}`, unit: key === "r" ? "°" : "mm" });
export const FK_EXERCISES: {
  title: string; goal: string; prompt: string; reflection: string;
  reference: LessonJoints; input: LessonJoints; fields: InquiryField[];
}[] = [
  {
    title: "어깨각과 높이", goal: "θ₂만 45° → 60°로 바꿉니다. 수평 성분 합과 높이가 어떻게 달라질까요?",
    prompt: "두 링크의 높이 성분을 더해 새 Z를 구하세요. 높이와 수평 성분 합 ρ가 변하는 방향도 예측하세요.",
    reflection: "θ₂가 커졌을 때 높이와 수평 성분 합이 서로 어떻게 변했나요? 두 링크의 sin·cos 성분을 근거로 설명하세요.",
    reference: FK_REFERENCE, input: FK_FIRST,
    fields: [{ key: "reach", label: "수평 성분 합 ρ", options: trendOptions }, { key: "height", label: "TCP 높이", options: trendOptions }, coordinate("z")],
  },
  {
    title: "상대 팔꿈치각", goal: "θ₂=60°를 유지하고 θ₃만 −90° → −60°로 바꿉니다. 두 번째 링크의 방향을 확인하세요.",
    prompt: "두 번째 링크의 각도는 θ₃ 자체일까요, θ₂+θ₃일까요? 수평 성분 합 ρ와 새 X·Z를 계산하세요.",
    reflection: "두 번째 링크의 절대 방향에 θ₂+θ₃를 사용한 이유를 설명하고, 첫 번째 과제와 높이·수평 성분 변화를 비교하세요.",
    reference: FK_FIRST, input: { ...FK_FIRST, j3: -60 },
    fields: [{ key: "rho", label: "예상 수평 성분 합 ρ", unit: "mm" }, coordinate("x"), coordinate("z")],
  },
  {
    title: "위치와 방향 구분", goal: "팔 모양은 유지하고 θ₁=30°, θ₄=45°로 바꿉니다. X·Y·Z와 R을 구분하세요.",
    prompt: "같은 수평 성분 합 ρ를 X·Y로 나누세요. 베이스 회전과 말단 회전이 Z와 R에 각각 어떤 영향을 주나요?",
    reflection: "θ₁이 바꾸는 위치 성분과 θ₄가 바꾸는 방향을 구분해 설명하세요. Z가 유지되는 이유도 포함하세요.",
    reference: { ...FK_FIRST, j3: -60 }, input: { j1: 30, j2: 60, j3: -60, j4: 45 },
    fields: [coordinate("x"), coordinate("y"), coordinate("z"), coordinate("r")],
  },
];

const reachable: InquiryField = { key: "reachable", label: "이 모델에서 목표에 도달하는 해", options: [{ value: "yes", label: "있다" }, { value: "no", label: "없다" }] };
const restored: InquiryField = { key: "restored", label: "IK → FK로 확인할 결과", options: [{ value: "same", label: "목표와 일치 (허용오차 안)" }, { value: "different", label: "목표와 다름" }, { value: "none", label: "해가 없어 복원할 수 없음" }] };
export const IK_EXERCISES = [
  { title: "목표에서 베이스각 찾기", target: { x: 300, y: 50, z: 0, r: 0 },
    goal: "목표 TCP에서 베이스 회전각 θ₁을 먼저 구하고, IK 결과를 FK로 확인합니다.",
    prompt: "표시 원점 오프셋을 빼고 θ₁=atan2(Y, X−offsetₓ)를 계산하세요. IK와 FK가 무엇을 입력받는지도 생각하세요.",
    reflection: "목표 좌표에서 구한 관절각을 FK에 다시 넣는 이유는 무엇인가요? 좌표 오차를 근거로 설명하세요.",
    fields: [reachable, { key: "j1", label: "예상 베이스각 θ₁", unit: "°" }, restored] as InquiryField[] },
  { title: "높이와 팔꿈치각", target: { x: 300, y: 50, z: 80, r: 0 },
    goal: "X·Y는 같고 목표 Z만 0 → 80 mm로 높입니다. 팔꿈치각 θ₃은 어떻게 달라질까요?",
    prompt: "목표까지의 거리 d를 구하고 cos θ₃ 식에 대입하세요. 이 과제는 θ₃≤0인 가지를 사용하므로 θ₃=−acos(계산값)입니다.",
    reflection: "목표의 X·Y가 같을 때 θ₁과 θ₃은 각각 어떻게 달라졌나요? 목표 높이·거리와 관절각을 연결해 설명하세요.",
    fields: [reachable, { key: "j3", label: "예상 상대 팔꿈치각 θ₃", unit: "°" }, restored] as InquiryField[] },
  { title: "도달 범위와 목표 수정", target: { x: 552.124, y: 0, z: -41.202, r: 0 },
    goal: "먼저 주어진 목표의 도달 가능 여부를 판단합니다. 이후 목표를 직접 수정해 가능한 해를 찾습니다.",
    prompt: "표시 좌표에서 원점 오프셋을 빼고 거리 d를 계산하세요. |L₁−L₂| ≤ d ≤ L₁+L₂ 조건과 비교하세요.",
    reflection: "해가 없다고 판단한 수학적 이유를 쓰고, 어떤 목표 좌표를 바꾸면 해를 찾을 수 있을지 설명하세요.",
    fields: [{ key: "distance", label: "모델 원점에서 목표까지 거리 d", unit: "mm" }, reachable, restored] as InquiryField[] },
];

export function targetDistance(target: LessonPose) {
  return Math.hypot(target.x - LEARNING_MODEL.offsetX, target.y, target.z - LEARNING_MODEL.offsetZ);
}

export function fkObservation(model: LessonModel, input: LessonJoints, reference: LessonJoints) {
  return { ...model.fk(input), ...fkTrends(model, input, reference), rho: horizontalReach(input) };
}

export function ikObservation(model: LessonModel, target: LessonPose, hint = FK_REFERENCE.j3) {
  const joints = model.ik(target.x, target.y, target.z, target.r, hint);
  if (!joints) return { joints: null, pose: null, residual: null,
    expected: { distance: targetDistance(target), reachable: "no", restored: "none" } as Record<string, number | string> };
  const pose = model.fk(joints);
  const residual = Math.hypot(pose.x - target.x, pose.y - target.y, pose.z - target.z);
  return { joints, pose, residual,
    expected: { ...joints, distance: targetDistance(target), reachable: "yes", restored: residual <= KINEMATICS_TOLERANCE ? "same" : "different" } as Record<string, number | string> };
}

/** Preserves entered angles and elbow branch; never round-trips through IK. */
export function kinematicsFrames(model: LessonModel, from: LessonJoints, to: LessonJoints): LessonFrame[] {
  return Array.from({ length: 121 }, (_, i) => {
    const t = i / 120;
    const joints = { j1: from.j1 + (to.j1 - from.j1) * t, j2: from.j2 + (to.j2 - from.j2) * t,
      j3: from.j3 + (to.j3 - from.j3) * t, j4: from.j4 + (to.j4 - from.j4) * t };
    return { joints, pose: model.fk(joints) };
  });
}

export function kinematicsCanAdvance(reviewed: boolean, topic: "fk" | "ik", index: number,
  repairing: boolean, observedReachable: boolean) {
  return reviewed && !(topic === "ik" && index === 2 && (!repairing || !observedReachable));
}
