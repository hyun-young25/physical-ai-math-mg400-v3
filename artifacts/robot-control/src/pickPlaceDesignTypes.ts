import type { LessonPose } from "./curriculum";
import type { CellCompilation, CellFrame, CellScenario } from "./processCellTypes";

export type DesignLevel = 1 | 2 | 3;
export type DesignRole = "approach" | "contact" | "grip" | "lift" | "transfer" | "above" | "lower" | "release" | "retreat";
export type DesignCommand = {
  id: string; role: DesignRole; action: "move" | "grip" | "release";
  mode: "absolute" | "relative"; motion: "MoveJ" | "MoveL";
  x: string; y: string; z: string; r?: string;
  expectedX: string; expectedY: string; expectedZ: string; expectedR?: string;
};
export type DesignRelations = {
  coordinate: string; contact: string; height: string; vertical: string;
  travelZ: string;
};
export type DesignScenario = CellScenario & {
  designLevel: DesignLevel; minimumTravelZ: number; retreatRise: number;
  orientationTolerance: number; gripRotationTolerance: number;
  surfaces: { x: number; y: number; halfX: number; halfY: number; z: number; label: string }[];
};
export type DesignObservation = {
  commandId: string; role: DesignRole; action: DesignCommand["action"];
  atMs: number; goal: LessonPose | null; target: LessonPose;
  expected: LessonPose; actual: LessonPose;
  state: "free" | "held" | "placed" | "unknown"; predictionError: number;
  rotationError?: number; inputBits?: string; outputBits?: string; measuredAt?: number;
  commandStatus?: "completed" | "interrupted" | "rejected";
};
export type DesignResult = CellCompilation & {
  observations: DesignObservation[];
  failure: "input" | "sequence" | "unreachable" | "pickup" | "target" | "height" | "collision" | "orientation" | null;
};
/** Separate additive evidence; existing chapter/process evidence schemas stay unchanged. */
export type DesignRecord = {
  id: string; sessionId: string; source: "dt" | "hardware" | "mock"; at: string; scenarioId: string;
  level: DesignLevel; variant: number; support: "guided" | "challenge";
  relations: DesignRelations; commands: DesignCommand[]; predictionReason: string;
  status: "running" | "completed" | "stopped" | "unavailable";
  frames: CellFrame[]; observations: DesignObservation[];
  result?: DesignResult["outcome"]; failure?: DesignResult["failure"]; stopReason?: string;
  observation?: string; reflection?: string;
  teacherReview: { status: "pending"; note: string };
  revisionOf?: string; revisionReason?: string;
  virtualReferenceId?: string;
  physicalObjectVerified?: false;
};