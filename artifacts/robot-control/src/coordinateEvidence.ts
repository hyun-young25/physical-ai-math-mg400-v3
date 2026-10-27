import type { AxisAttempt, AxisTaskRecord } from "./axisLesson";
import type { CoordinateAttempt } from "./coordinateLearning";
import type { ApplicationRecord } from "./coordinateApplication";
import type { TransferLearningRecord } from "./transferLearning";
import type { StrategyAttempt } from "./coordinateStrategies";
import type { SupportRecord } from "./learningSupport";
import { createProcessEvidenceStore } from "./processEvidence";

export const COORDINATE_EVIDENCE_KEY = "physical-ai-coordinate-evidence-v1";
export type CoordinateEvidence = {
  id: "coordinate-lessons"; version: 1; savedAt?: string;
  axisRecords: AxisTaskRecord[]; axisAttempts: Record<string, AxisAttempt[]>;
  supportRecords: SupportRecord[]; coordinateAttempts: CoordinateAttempt[];
  applicationRecords: ApplicationRecord[]; transferRecords: TransferLearningRecord[];
  strategyAttempts: StrategyAttempt[];
};
export const emptyCoordinateEvidence = (): CoordinateEvidence => ({
  id: "coordinate-lessons", version: 1, axisRecords: [], axisAttempts: {}, supportRecords: [],
  coordinateAttempts: [], applicationRecords: [], transferRecords: [], strategyAttempts: [],
});
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value: unknown, valid: (item: any) => boolean) => Array.isArray(value) && value.every(item => object(item) && valid(item));
const pose = (value: unknown) => object(value) && ["x", "y", "z", "r"].every(key => Number.isFinite(value[key]));
const attempt = (value: any) => pose(value.from) && pose(value.to) && object(value.prediction);
export function isCoordinateEvidence(value: unknown): value is CoordinateEvidence {
  if (!object(value) || value.id !== "coordinate-lessons" || value.version !== 1) return false;
  return list(value.axisRecords, row => typeof row.taskId === "string" && Array.isArray(row.attempts))
    && object(value.axisAttempts) && Object.values(value.axisAttempts).every(rows => list(rows, attempt))
    && list(value.supportRecords, row => typeof row.id === "string" && Array.isArray(row.practice) && Array.isArray(row.checks))
    && list(value.coordinateAttempts, row => typeof row.id === "string" && typeof row.taskId === "string"
      && object(row.draft) && ["delta", "absolute", "relative"].every(key => object(row.draft[key])) && object(row.results))
    && list(value.applicationRecords, row => typeof row.id === "string" && pose(row.from)
      && list(row.entries, entry => typeof entry.id === "string" && typeof entry.status === "string" && pose(entry.from) && object(entry.target)))
    && list(value.transferRecords, row => typeof row.id === "string" && list(row.explanations, explanation => typeof explanation.text === "string")
      && list(row.trials, trial => list(trial.results, result => typeof result.id === "string" && typeof result.status === "string" && pose(result.from) && pose(result.target)) && object(trial.commands)))
    && list(value.strategyAttempts, row => typeof row.id === "string" && typeof row.taskId === "string"
      && Array.isArray(row.commands) && Array.isArray(row.results));
}
/** Reload never turns an interrupted movement into completed evidence. */
export function recoverCoordinateEvidence(record: CoordinateEvidence): CoordinateEvidence {
  return { ...record,
    applicationRecords: record.applicationRecords.map(run => ({ ...run,
      completed: run.entries.some(entry => entry.status === "running") ? false : run.completed,
      entries: run.entries.map(entry => entry.status === "running"
        ? { ...entry, status: "stopped", message: "새로고침으로 실행이 중단되었습니다." } : entry),
    })),
    transferRecords: record.transferRecords.map(run => ({ ...run,
      ...(run.trials.some(trial => trial.results.some(result => result.status === "running")) ? { completedAt: undefined } : {}),
      trials: run.trials.map(trial => ({ ...trial, results: trial.results.map(result => result.status === "running"
        ? { ...result, status: "stopped", message: "새로고침으로 실행이 중단되었습니다." } : result) })),
    })),
  };
}
export function createCoordinateEvidenceStore() {
  const store = createProcessEvidenceStore<CoordinateEvidence>({ key: COORDINATE_EVIDENCE_KEY,
    isRecord: isCoordinateEvidence, recoverCheckpoint: checkpoint => checkpoint,
    normalizeRecord: recoverCoordinateEvidence });
  const initial = store.records.find(isCoordinateEvidence) ?? emptyCoordinateEvidence();
  return { ...store, initial,
    failed: store.failed || store.records.some(record => !isCoordinateEvidence(record)) };
}
