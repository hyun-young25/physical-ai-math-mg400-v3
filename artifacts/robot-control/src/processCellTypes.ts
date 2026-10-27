import type { LessonJoints, LessonPose } from "./curriculum";

export type CellRobotId = "A" | "B";
export type CellLevel = 1 | 2 | 3 | 4;
export type CellRobot = { id: CellRobotId; origin: LessonPose; yaw: number; start: LessonPose };
export type CellField = {
  key: string; label: string; unit: string; expected: number; hint: string;
  options?: { value: number; label: string }[]; accepted?: number[];
  sequence?: { value: number; label: string }[];
};
export type CellQuestion = {
  id: string; title: string; prompt: string; givens: string[]; fields: CellField[];
  focusRobot: CellRobotId; focusPoint?: LessonPose; focusLabel?: string;
};
export type CellScenario = {
  id: string; level: CellLevel; variant: number; title: string; goal: string;
  robots: CellRobot[]; source: LessonPose; destination: LessonPose;
  handoff?: LessonPose;
  belt?: { from: LessonPose; to: LessonPose; travel: number; speedMmPerSec: number; travelSeconds: number; width: number; length: number };
  tray?: { origin: LessonPose; rows: number; columns: number; rowStep: number; columnStep: number; points: LessonPose[]; predictionSlot?: number };
  questions: CellQuestion[];
};
export type CellPiece = { id: string; top: LessonPose; owner: CellRobotId | null; placed: boolean; traySlot?: number };
export type CellFrame = {
  atMs: number; robots: Partial<Record<CellRobotId, { pose: LessonPose; joints: LessonJoints }>>;
  workpieces: CellPiece[]; beltProgress: number; phase: string;
  activeRobot: CellRobotId | null; target: LessonPose | null; event?: string; events?: string[];
  eventRobot?: CellRobotId; eventPoint?: LessonPose; eventGoal?: LessonPose;
  eventPieceId?: string; eventTraySlot?: number;
  processStatus?: { feed: string; A: string; B?: string; APiece?: number; BPiece?: number; handoff: "empty" | "A" | "ready" | "B"; completed: number; total: number };
};
export type CellCheck = { key: string; label: string; expected: number; actual: number; passed: boolean };
export type CellOutcome = {
  finished: boolean; passed: boolean; completedPieces: number; totalPieces: number;
  checks: CellCheck[]; issues: string[]; finalFrame: CellFrame;
  observations: { robot: CellRobotId; target: LessonPose; observed: LessonPose; joints: LessonJoints; error: number; label?: string; goal?: LessonPose; atMs?: number; pieceId?: string; traySlot?: number }[];
};
export type CellCompilation = { frames: CellFrame[]; durationMs: number; outcome: CellOutcome };
export type CellVisual = {
  scenario: CellScenario; frame: CellFrame; showCoordinates: boolean;
  selectedRobot: CellRobotId; focusPoint?: LessonPose; focusLabel?: string; reviewing?: boolean; running: boolean;
  plannedPath?: { label: string; pose: LessonPose }[];
  predictedRoutes?: { robot: CellRobotId; segments: { from: LessonPose; to: LessonPose }[] }[];
  /** A calculated preview stays in the prediction stage and produces no execution evidence. */
  predictionPreview?: { playing: boolean; progress: number };
  /** Keep coordinates to be predicted out of the scene's numeric overlay. */
  hideTargetCoordinates?: boolean;
  cameraRequest?: { scope: "whole" | "work" | "packing" | "frames"; key: number };
  packing?: { selectedSlot: number | null; onSelectSlot: (slot: number) => void;
    cells: { slot: number; order?: number; command?: LessonPose; observed?: LessonPose }[] };
  /** Exact playback sample for the render loop; frame is the slower UI snapshot. */
  liveFrameRef?: { current: CellFrame };
  /** Camera-only bounds of the selected student's path; does not expose answers. */
  framingPoints?: LessonPose[];
};
