import type { LessonPose } from "./curriculum";
import type { PracticeOperation } from "./practiceSession";

export type FoundationMoveResult = { summary: string; detail: unknown };
export type FoundationMove = (taskId: string) => Promise<FoundationMoveResult | null>;

export function foundationAnswerMatches(raw: string | undefined, expected: number | string): boolean {
  const value = raw?.trim() ?? "";
  return typeof expected === "number"
    ? value !== "" && Number.isFinite(Number(value)) && Math.abs(Number(value) - expected) <= 0.1
    : value === expected;
}

export function foundationHint(taskId: string, key: string): string {
  const transfer = taskId.endsWith("transfer");
  if (taskId.startsWith("height")) {
    const start = transfer ? 45 : 20;
    const hints: Record<string, string> = {
      targetZ: "목표 절대좌표는 도착 높이입니다. 이동량과 구분하여 문제의 목표 Z를 읽어 보세요.",
      deltaX: "수직 이동에서는 X가 유지됩니다. 변화가 없는 축의 변화량은 얼마일까요?",
      deltaY: "수직 이동에서는 Y가 유지됩니다. 변화가 없는 축의 변화량은 얼마일까요?",
      deltaZ: `ΔZ = 목표 − 현재 = 60 − ${start}입니다. 상승 방향의 부호도 확인하세요.`,
      delta: `ΔZ = 목표 − 현재 = 60 − ${start}입니다. 앞 문제와 출발 높이가 달라졌습니다.`,
      command: "TCP가 수직 직선을 따라야 합니다. 직선 경로를 보간하는 명령을 선택하세요.",
    };
    if (hints[key]) return hints[key];
  }
  if (taskId.startsWith("vector")) {
    const pairs = transfer ? { deltaX: "320 − 350", deltaY: "110 − 70", deltaZ: "35 − 60" }
      : { deltaX: "350 − 320", deltaY: "70 − 40", deltaZ: "60 − 20" };
    if (key in pairs) return `각 축의 변화량은 목표 − 현재입니다. ${pairs[key as keyof typeof pairs]}의 값과 부호를 확인하세요.`;
  }
  const hints: Record<string, string> = {
    command: "여러 축이 함께 변해도 TCP의 경로가 직선이면 직선 보간 명령을 사용합니다.",
    distance: "d = √(ΔX² + ΔY² + ΔZ²)입니다. 변화량을 단순히 더하지 말고, 음수도 제곱한 뒤 계산하세요.",
    horizontal: `수평 성분은 100 × cos(${transfer ? 60 : 30}°)입니다. 각도와 삼각비를 확인하세요.`,
    vertical: `높이 성분은 100 × sin(${transfer ? 60 : 30}°)입니다. 각도와 삼각비를 확인하세요.`,
    link1X: `L₁의 X 성분은 175 × cos(${transfer ? 45 : 30}°)입니다.`,
    link1Z: `L₁의 Z 성분은 175 × sin(${transfer ? 45 : 30}°)입니다.`,
    link2X: `L₂의 X 성분은 125 × cos(${transfer ? "45 − 15" : "30 + 20"}°)입니다. 두 번째 링크의 절대각을 쓰세요.`,
    link2Z: `L₂의 Z 성분은 125 × sin(${transfer ? "45 − 15" : "30 + 20"}°)입니다. 두 번째 링크의 절대각을 쓰세요.`,
    tcpX: "TCP X는 두 링크의 X 성분의 합입니다. 중간값은 가능한 한 반올림하지 말고 마지막에 정리하세요.",
    tcpZ: "TCP Z는 두 링크의 Z 성분의 합입니다. 중간값은 가능한 한 반올림하지 말고 마지막에 정리하세요.",
  };
  return hints[key] ?? "문제 조건과 관계식을 확인하고 입력값을 다시 계산하세요.";
}

export function hasFoundationMotion(taskId: string): boolean {
  return /^(height|vector|distance)-(practice|transfer)$/.test(taskId);
}

/** Symbolic link exercises have no calibrated MG400 target and never issue motion. */
export function foundationMotion(taskId: string, current: LessonPose): {
  operation: Extract<PracticeOperation, { kind: "move" }>;
  start: Partial<LessonPose>;
} | null {
  if (!hasFoundationMotion(taskId)) return null;
  if (taskId.startsWith("height")) return {
    operation: { kind: "move", motion: "MoveL", target: { ...current, z: 60 } },
    start: { z: taskId === "height-transfer" ? 45 : 20 },
  };
  if (taskId.startsWith("vector")) {
    const transfer = taskId === "vector-transfer";
    return {
      operation: { kind: "move", motion: "MoveL", target: transfer
        ? { x: 320, y: 110, z: 35, r: current.r } : { x: 350, y: 70, z: 60, r: current.r } },
      start: transfer ? { x: 350, y: 70, z: 60 } : { x: 320, y: 40, z: 20 },
    };
  }
  return {
    operation: { kind: "move", motion: "MoveL", relative: true,
      target: { x: taskId === "distance-transfer" ? -60 : 30, y: taskId === "distance-transfer" ? 80 : 40, z: 0, r: 0 } },
    start: {},
  };
}

export function foundationStartProblem(start: Partial<LessonPose>, current: LessonPose, tolerance: number): string | null {
  const mismatch = (Object.keys(start) as (keyof LessonPose)[]).filter(axis => Math.abs(current[axis] - start[axis]!) > tolerance);
  return mismatch.length ? `출발 위치가 문제 조건과 다릅니다. ${mismatch.map(axis => `${axis.toUpperCase()}=${start[axis]} mm (현재 ${current[axis].toFixed(2)})`).join(", ")}로 먼저 맞춘 뒤 다시 확인하세요.` : null;
}
