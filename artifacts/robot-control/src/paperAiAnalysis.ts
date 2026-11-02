import type { FeedbackContext } from "./learningAiContext";
import { canonicalPaperVerificationCriteria, classifyPaperVerificationPoints, frameTransformPoint,
  paperVerificationPointsAreValid } from "./paperCoordinateStudy";
import type { PaperDiagnosis, PaperGridPoint, PaperTrialRecord } from "./paperCoordinateStudy";

type PointDelta = { dx: number; dy: number; distance: number } | null;
const rotationDelta = (a: number | undefined, b: number | undefined) =>
  a === undefined || b === undefined ? null : Math.abs(((b - a + 540) % 360) - 180);

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
  while (item && item.task === current.task && item.task === "paper-coordinate"
    && item.level === current.level && chain.length < 6 && !seen.has(item.id)) {
    seen.add(item.id);
    chain.unshift(item);
    const parent: PaperTrialRecord | undefined=item.parentAttemptId ? byId.get(item.parentAttemptId) : undefined;
    // The explicit parent link is authoritative across a task-version bump:
    // retain the actual prior model/feedback, while its taskVersion remains
    // visible in the summary. A different level/assignment or task is excluded.
    item=parent && parent.task===current.task && parent.level===current.level ? parent : undefined;
  }
  return chain;
}

export function paperAnalysisReady(current: PaperTrialRecord | null, currentPlanHash: string, diagnosis: PaperDiagnosis | null, targets?:PaperGridPoint[]) {
  const run = current?.run;
  return !!current?.frame && !!run && run.status === "completed" && !!diagnosis && diagnosis.status === "complete"
    && current.planHash === currentPlanHash && run.planHash === currentPlanHash && run.frameId === current.frame.id
    && !!run.verificationCriteria && run.verificationCriteria.recordId === current.id
    && run.verificationCriteria.frameId === run.frameId && run.verificationCriteria.planHash === run.planHash
    && run.verificationCriteria.confirmedAt <= run.startedAt
    && (!targets||paperVerificationPointsAreValid(run.verificationCriteria,targets,true));
}

export function paperRunComparisons(current: PaperTrialRecord, targets: PaperGridPoint[]) {
  const frame = current.frame;
  const run = current.run;
  if (!frame || !run) return [];
  const verificationPoints=classifyPaperVerificationPoints(targets);
  return targets.map(target => {
    const transformed = frameTransformPoint(frame, target);
    const command = run.commands.find(entry => entry.point === target.name)?.pose ?? null;
    const observation = run.observations.find(entry => entry.point === target.name) ?? null;
    return {
      point: target.name,
      isIndependentVerificationPoint: verificationPoints.independentVerificationPoints.includes(target.name),
      constructionPointOverlap: verificationPoints.constructionOverlaps.find(item=>item.targetPoint===target.name)?.constructionPoint??null,
      targetPaperCm: { x: target.xCm, y: target.yCm },
      targetRobotMm: { x: transformed.x, y: transformed.y, z: transformed.z, r: transformed.r },
      commandRobotMm: command,
      controllerReportedMm: observation?.pose ?? null,
      targetVsCommandMm: delta({ x: transformed.x, y: transformed.y }, command),
      targetVsControllerReportedMm: delta({ x: transformed.x, y: transformed.y }, observation?.pose ?? null),
      commandVsReportedMm: delta(command, observation?.pose ?? null),
      targetVsControllerReportedRotationDeg: rotationDelta(transformed.r, observation?.pose.r),
      commandVsReportedRotationDeg: rotationDelta(command?.r, observation?.pose.r),
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

/** Convert student-read ink through the measured O/X/Y frame, never the student's model. */
export function paperInkComparisons(current: PaperTrialRecord, targets: PaperGridPoint[]) {
  const frame = current.frame;
  const run = current.run;
  if (!frame || !run) return [];
  const verificationPoints=classifyPaperVerificationPoints(targets);
  return targets.map(target => {
    const reading = current.inkReadings?.find(item => item.point === target.name
      && item.recordId === current.id && item.runId === run.id && item.frameId === frame.id
      && item.unit === "cm" && item.source === "student-manual-ink");
    const targetRobot = frameTransformPoint(frame, target);
    const reported = run.observations.find(item => item.point === target.name
      && item.source === run.source && item.kind === (run.source === "hardware" ? "controller-tcp" : run.source === "mock" ? "mock-bridge" : "dt"));
    const measured = reading?.status === "measured" && Number.isFinite(reading.xCm) && Number.isFinite(reading.yCm)
      ? frameTransformPoint(frame, { xCm: reading.xCm!, yCm: reading.yCm! }) : null;
    return {
      point: target.name,
      isIndependentVerificationPoint: verificationPoints.independentVerificationPoints.includes(target.name),
      constructionPointOverlap: verificationPoints.constructionOverlaps.find(item=>item.targetPoint===target.name)?.constructionPoint??null,
      runId: run.id,
      recordId: current.id,
      frameId: frame.id,
      paperUnit: "cm",
      robotUnit: "mm",
      targetRobotMm: { x: targetRobot.x, y: targetRobot.y },
      controllerReportedMm: reported ? { x: reported.pose.x, y: reported.pose.y } : null,
      inkReading: reading ?? null,
      inkAsMeasuredFrameRobotMm: measured ? { x: measured.x, y: measured.y } : null,
      targetVsCommandMm: paperRunComparisons(current, targets).find(item => item.point === target.name)?.targetVsCommandMm ?? null,
      targetVsControllerReportedMm: delta({ x: targetRobot.x, y: targetRobot.y }, reported?.pose ?? null),
      targetVsControllerReportedRotationDeg: rotationDelta(targetRobot.r, reported?.pose.r),
      targetVsInkMm: delta({ x: targetRobot.x, y: targetRobot.y }, measured),
      controllerReportedVsInkMm: delta(reported?.pose ?? null, measured),
      criterionPositionToleranceMm: run.verificationCriteria?.positionToleranceMm ?? null,
      criterionRotationToleranceDeg: run.verificationCriteria?.rotationToleranceDeg ?? null,
    };
  });
}

function linkedSummary(record: PaperTrialRecord) {
  const run=record.run;
  const priorTargets=(record.predictions??[]).map(point=>({name:point.name,xCm:point.xCm,yCm:point.yCm}));
  const criteria=run?.verificationCriteria&&priorTargets.length
    ?canonicalPaperVerificationCriteria(run.verificationCriteria,priorTargets):run?.verificationCriteria??null;
  const displayedFeedback=(record.aiAnalyses??[])
    .filter(analysis=>!!analysis.displayedAt&&analysis.recordId===record.id&&!!run
      &&analysis.runId===run.id&&analysis.planHash===run.planHash&&analysis.source===run.source)
    .map(({mode,provider,status,failureReason,question,text,requestedAt,displayedAt,source})=>({
      mode,provider,status,...(failureReason?{failureReason}:{}),source,question,text,requestedAt,displayedAt,
    }));
  return {
    recordId: record.id,
    parentAttemptId: record.parentAttemptId,
    attempt: record.attempt,
    taskVersion: record.taskVersion,
    level:record.level,
    targetSet: record.targetSet,
    status: record.status,
    dataSource: record.dataSource,
    transform: record.transform,
    predictions: record.predictions,
    studentHypothesis: record.studentHypothesis,
    followupObservation: record.followupObservation,
    modelDecision: record.modelDecision,
    modelDecisionReason: record.modelDecisionReason,
    revisionReason: record.revisionReason,
    revalidation: record.revalidation,
    previouslyDisplayedFeedback: displayedFeedback,
    frame: record.frame ? {
      id: record.frame.id,
      source: record.frame.source,
      coordinateSystem: record.frame.coordinateSystem,
      user: record.frame.user,
      tool: record.frame.tool,
      capturedAt: record.frame.capturedAt,
      samples: record.frame.samples,
    } : null,
    run: run ? {
      id: run.id,
      planHash: run.planHash,
      frameId: run.frameId,
      source: run.source,
      status: run.status,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      commands: run.commands,
      observations: run.observations,
      verificationCriteria: criteria,
    } : null,
    runHistory: (record.runHistory ?? []).map(previousRun => ({
      id: previousRun.id, planHash: previousRun.planHash, frameId: previousRun.frameId,
      source: previousRun.source, status: previousRun.status, startedAt: previousRun.startedAt,
      endedAt: previousRun.endedAt ?? null, commands: previousRun.commands,
      observations: previousRun.observations, verificationCriteria: previousRun.verificationCriteria ?? null,
    })),
    inkReadings: record.inkReadings ?? [],
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
  };
}

/** Build the exact, current-attempt evidence packet; unrelated task history is excluded. */
export function paperFeedbackContext(current: PaperTrialRecord, records: PaperTrialRecord[], targets: PaperGridPoint[]): FeedbackContext {
  const chain = linkedPaperAttempts(current, records);
  const comparisons = paperRunComparisons(current, targets);
  const samples = current.referenceSamples ?? current.frame?.samples ?? [];
  const run = current.run;
  const criteria=run?.verificationCriteria?canonicalPaperVerificationCriteria(run.verificationCriteria,targets):null;
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
      verificationPoints: classifyPaperVerificationPoints(targets),
      taskVersion:current.taskVersion,
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
      modelDecision: current.modelDecision ?? null,
      modelDecisionReason: current.modelDecisionReason ?? "",
      followupObservation: current.followupObservation ?? null,
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
    // The immediately preceding linked attempt is the actionable context. Keeping
    // it whole avoids truncating its displayed feedback before the AI request.
    history: JSON.stringify(chain.slice(-2, -1).map(linkedSummary)),
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
      toleranceMm: criteria?.positionToleranceMm ?? diagnosis?.toleranceMm ?? null,
      rotationToleranceDeg: criteria?.rotationToleranceDeg ?? null,
      verificationCriteria: criteria,
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
      // Each ink comparison contains its raw reading, source, timestamp and
      // unit. Do not repeat the same readings in a second array.
      inkComparisons: paperInkComparisons(current, targets).map(({targetVsCommandMm:_duplicate,...row})=>row),
      verificationCriteria: criteria,
      diagnosisMethod: diagnosis?.method ?? "rule-based",
      linkedPreviousAttemptId: current.parentAttemptId,
      revisionReason: current.revisionReason ?? null,
      revalidation: current.revalidation ?? null,
      followupObservation: current.followupObservation?.runId === run.id ? current.followupObservation : null,
      modelDecision: current.modelDecision ?? null,
      modelDecisionReason: current.modelDecisionReason ?? null,
      sameAttemptEarlierRuns: (current.runHistory ?? []).filter(previousRun => previousRun.planHash === run.planHash
        && previousRun.frameId === run.frameId).slice(-1).map(previousRun => ({
        recordId: current.id, runId: previousRun.id, planHash: previousRun.planHash,
        frameId: previousRun.frameId, source: previousRun.source, status: previousRun.status,
        startedAt: previousRun.startedAt, endedAt: previousRun.endedAt ?? null,
        observationCount:previousRun.observations.length,
        verificationCriteria: previousRun.verificationCriteria
          ?{positionToleranceMm:previousRun.verificationCriteria.positionToleranceMm,
            targetSet:previousRun.verificationCriteria.targetSet,
            confirmedAt:previousRun.verificationCriteria.confirmedAt}:null,
      })),
    }] : []),
    support: current.support === "challenge" ? "challenge" : "guided",
    attempts: chain.length,
  };
}

