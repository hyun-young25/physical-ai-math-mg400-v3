import type { LessonPose } from "./curriculum";

export type MotionMode = "MoveJ" | "MoveL";
export type MotionPaths = Partial<Record<MotionMode, LessonPose[]>>;
export type MotionTrace = { mode: MotionMode; points: LessonPose[] };
export type MotionComparisonVisual = {
  from: LessonPose;
  to: LessonPose;
  paths: MotionPaths;
  runningMode: MotionMode | null;
};
export const MOTION_COLORS = { MoveJ: "#6d28d9", MoveL: "#0891b2" } as const;

// Both plots share the executed prefix; a new run replaces only its own trace.
export function visibleMotionPaths(completed: MotionPaths, trace: MotionTrace | null): MotionPaths {
  return trace ? { ...completed, [trace.mode]: trace.points } : completed;
}

// Display coordinates already include the robot model offsets. Floor projection
// uses scene +X for robot +X and scene -Z for robot +Y, discarding TCP height.
export function motionFloorPoint(point: Pick<LessonPose, "x" | "y">, height = 4): [number, number, number] {
  return [point.x, height, -point.y];
}

export function motionFloorPath(points: LessonPose[], height = 4): [number, number, number][] {
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y)
    .map(p => motionFloorPoint(p, height));
}
