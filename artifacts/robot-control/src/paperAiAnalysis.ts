import type { FeedbackContext } from "./learningAiContext";
import { frameTransformPoint } from "./paperCoordinateStudy";
import type { PaperDiagnosis, PaperGridPoint, PaperTrialRecord } from "./paperCoordinateStudy";

type PointDelta = { dx: number; dy: number; distance: number } | null;

function delta(a: { x: number; y: number } | null, b: { x: number; y: number } | null): PointDelta {
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return { dx, dy, distance: Math.hypot(dx, dy) };
}

export function linkedPaperAttempts(current: PaperTrialRecord, records: PaperTrialRecord[]) {
  const byId = new Map(records.map(record => [record.id, record]));
  const chain: PaperTrialRecord[] = [];
  const seen = new Set<string>();
  let item: PaperTrialRecord | undefined = current;
  while (item && item.task === "paper-coordinate" && chain.length < 6 && !seen.has(item.id)) {
    seen.add(item.id);
    chain.unshift(item);
    item = item.parentAttemptId ? byId.get(item.parentAttemptId) : undefined;
  }
  return chain;
}

export function paperAnalysisReady(current: PaperTrialRecord | null, currentPlanHash: string, diagnosis: PaperDiagnosis | null) {
  const run = current?.run;
  return !!current?.frame && !!run && run.status === "completed" && !!diagnosis && diagnosis.status === "complete"
    && current.planHash === currentPlanHash && run.planHash === currentPlanHash && run.frameId === current.frame.id;
}

export function paperRunComparisons(current: PaperTrialRecord, targets: PaperGridPoint[]) {
  const frame = current.frame;
  const run = current.run;
  if (!frame || !run) return [];
  return targets.map(target => {
    const transformed = frameTransformPoint(frame, target);
    const command = run.commands.find(entry => entry.point === target.name)?.pose ?? null;
    const observation = run.observations.find(entry => entry.point === target.name) ?? null;
    return {
      point: target.name,
      targetPaperCm: { x: target.xCm, y: target.yCm },
      targetRobotMm: { x: transformed.x, y: transformed.y, z: transformed.z, r: transformed.r },
      commandRobotMm: command,
      controllerReportedMm: observation?.pose ?? null,
      targetVsCommandMm: delta({ x: transformed.x, y: transformed.y }, command),
      commandVsReportedMm: delta(command, observation?.pose ?? null),
      observation: observation ? {
        source: observation.source,
        kind: observation.kind,
        seq: observation.seq,
        measuredAt: observation.measuredAt,
        ageMs: observation.ageMs,
      } : null,
    };
  });
}

function linkedSummary(record: PaperTrialRecord) {
  return {
    recordId: record.id,
    parentAttemptId: record.parentAttemptId,
    attempt: record.attempt,
    taskVersion: record.taskVersion,
    targetSet: record.targetSet,
    status: record.status,
    dataSource: record.dataSource,
    frame: record.frame ? {
      id: record.frame.id,
      source: record.frame.source,
      coordinateSystem: record.frame.coordinateSystem,
      user: record.frame.user,
      tool: record.frame.tool,
      capturedAt: record.frame.capturedAt,
      samples: record.frame.samples,
    } : null,
    transform: record.transform,
    predictions: record.predictions,
    run: record.run ? {
      id: record.run.id,
      planHash: record.run.planHash,
      frameId: record.run.frameId,
      source: record.run.source,
      status: record.run.status,
      startedAt: record.run.startedAt,
      endedAt: record.run.endedAt,
      commands: record.run.commands,
      observations: record.run.observations,
    } : null,
    diagnosis: record.diagnosis ? {
      method: record.diagnosis.method,
      status: record.diagnosis.status,
      candidate: record.diagnosis.candidate,
      evidence: record.diagnosis.evidence,
      predictionEvidence: record.diagnosis.predictionEvidence,
      taskEvidence: record.diagnosis.taskEvidence,
      firstMismatch: record.diagnosis.firstMismatch,
      question: record.diagnosis.question,
      why: record.diagnosis.why,
    } : null,
    studentHypothesis: record.studentHypothesis,
    revisionReason: record.revisionReason,
    revalidation: record.revalidation,
  };
}

/** Build the exact, current-attempt evidence packet; unrelated task history is excluded. */
export function paperFeedbackContext(current: PaperTrialRecord, records: PaperTrialRecord[], targets: PaperGridPoint[]): FeedbackContext {
  const chain = linkedPaperAttempts(current, records);
  const comparisons = paperRunComparisons(current, targets);
  const samples = current.referenceSamples ?? current.frame?.samples ?? [];
  const run = current.run;
  const diagnosis = current.diagnosis;
  const targetAndFrame = {
    task: "paper-coordinate",
    recordId: current.id,
    attempt: current.attempt,
    targetSet: current.targetSet,
    targetPaperCm: targets.map(({ name, xCm, yCm }) => ({ name, xCm, yCm })),
    units: { paper: "cm", robot: "mm", rotation: "degree" },
    frame: current.frame ? {
      id: current.frame.id,
      source: current.frame.source,
      coordinateSystem: current.frame.coordinateSystem,
      user: current.frame.user,
      tool: current.frame.tool,
      capturedAt: current.frame.capturedAt,
      samples,
    } : null,
  };
  return {
    task: "paper-coordinate",
    condition: JSON.stringify({
      ...targetAndFrame,
      analysisScope: "현재 시도와 직접 연결된 이전 시도만 포함합니다.",
      runId: run?.id ?? null,
      planHash: run?.planHash ?? null,
      frameId: run?.frameId ?? current.frame?.id ?? null,
    }),
    answers: JSON.stringify({
      savedStudentTransform: current.transform ?? null,
      savedStudentExplanation: current.transform?.explanation ?? "",
      savedPredictedRobotCoordinates: current.predictions ?? [],
      studentHypothesis: current.studentHypothesis ?? "",
      revisionReason: current.revisionReason ?? "",
      pathConcept: current.pathConcept ?? null,
    }),
    reason: [
      current.transform?.explanation ? `학생이 저장한 변환식 설명: ${current.transform.explanation}` : "",
      current.studentHypothesis ? `학생의 차이 원인 가설: ${current.studentHypothesis}` : "",
      current.revisionReason ? `수정 이유: ${current.revisionReason}` : "",
    ].filter(Boolean).join("\n").slice(0, 1500),
    initialPrediction: JSON.stringify({
      recordId: current.id,
      planHash: current.planHash,
      transform: current.transform ?? null,
      predictions: current.predictions ?? [],
    }),
    history: JSON.stringify(chain.slice(0, -1).map(linkedSummary)),
    judgment: JSON.stringify({
      method: diagnosis?.method ?? "rule-based",
      status: diagnosis?.status ?? "not-ready",
      candidate: diagnosis?.candidate ?? "자료 부족",
      evidence: diagnosis?.evidence ?? [],
      predictionEvidence: diagnosis?.predictionEvidence ?? [],
      taskEvidence: diagnosis?.taskEvidence ?? [],
      firstMismatch: diagnosis?.firstMismatch ?? null,
      question: diagnosis?.question ?? null,
      why: diagnosis?.why ?? null,
      interpretation: "규칙 기반 수치 비교이며 학생의 인지 원인을 확정하거나 채점한 결과가 아닙니다.",
    }),
    execution: JSON.stringify(run ? [{
      recordId: current.id,
      runId: run.id,
      planHash: run.planHash,
      frameId: run.frameId,
      source: run.source,
      status: run.status,
      startedAt: run.startedAt,
      endedAt: run.endedAt ?? null,
      startSequence: run.startSequence,
      commands: run.commands,
      observations: run.observations,
      comparisons,
      inkReadings: current.inkReadings ?? [],
      diagnosisMethod: diagnosis?.method ?? "rule-based",
      linkedPreviousAttemptId: current.parentAttemptId,
      revisionReason: current.revisionReason ?? null,
      revalidation: current.revalidation ?? null,
    }] : []),
    support: current.support === "challenge" ? "challenge" : "guided",
    attempts: chain.length,
  };
}

