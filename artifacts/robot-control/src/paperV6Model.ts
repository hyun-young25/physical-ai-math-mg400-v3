import {
  PAPER_HARDWARE_V6_VERSION,
  frameTransformPoint,
} from "./paperCoordinateStudy";
import type {
  PaperFrame,
  PaperGridPoint,
  PaperInkReading,
  PaperPredictionPoint,
  PaperRunSnapshot,
  PaperStudentTransform,
  PaperTrialRecord,
  PaperV6Draft,
  PaperV6FormulaWork,
  PaperV6StudentModel,
} from "./paperCoordinateStudy";
import type { LessonPose } from "./curriculum";

export const PAPER_V6_PROMPT_VERSION = "paper-v6-question-1";
export const PAPER_V6_VERIFICATION_TOLERANCE_MM = 2;
export const PAPER_V6_VERIFICATION_RATIONALE =
  "실행 전에 고정한 기준: 측정 분해능 0.5 mm와 반복 측정 표준편차 0.6 mm를 고려한 위치 오차 2.0 mm.";
export const PAPER_V6_REVALIDATION_POINT: PaperGridPoint = {
  name: "V",
  xCm: 5,
  yCm: 6,
};

export function canResumePaperV6SavedPrediction(input: {
  savedPlanHash?: string | null;
  currentPlanHash?: string | null;
  criteriaPlanHash?: string | null;
  draftMatchesPlan: boolean;
}): boolean {
  return !!input.savedPlanHash &&
    input.savedPlanHash === input.currentPlanHash &&
    input.savedPlanHash === input.criteriaPlanHash &&
    input.draftMatchesPlan;
}

export type PaperV6MoveOperation = {
  kind: "move";
  motion: "MoveL";
  target: LessonPose;
};

/** The production run path uses this planner before handing operations to the
 * practice/bridge executor. Tests can pass its output to an in-memory sink. */
export function buildPaperV6MovePlan(input: {
  startPose: LessonPose;
  paperOriginPose: LessonPose;
  predictions: PaperPredictionPoint[];
  surfaceZ: number;
  liftGapMm: number;
}):
  | {
      ok: true;
      safeZ: number;
      operations: PaperV6MoveOperation[];
      capturePointByOperationIndex: Record<string, string>;
    }
  | { ok: false; error: string } {
  const { startPose, paperOriginPose, predictions, surfaceZ, liftGapMm } = input;
  if (
    ![startPose.x, startPose.y, startPose.z, startPose.r, paperOriginPose.r, surfaceZ, liftGapMm]
      .every(Number.isFinite) ||
    liftGapMm <= 0 ||
    predictions.length === 0 ||
    predictions.some((point) => ![point.robotX, point.robotY].every((value) => Number.isFinite(Number(value))))
  )
    return { ok: false, error: "실행 시작점, 종이 표면, 펜 들기 간격 또는 학생 예측을 확인하세요." };
  const safeZ = Math.max(startPose.z, surfaceZ + liftGapMm);
  const operations: PaperV6MoveOperation[] = [
    {
      kind: "move",
      motion: "MoveL",
      target: { x: startPose.x, y: startPose.y, z: safeZ, r: paperOriginPose.r },
    },
  ];
  const capturePointByOperationIndex: Record<string, string> = {};
  for (const point of predictions) {
    const contactZ = Number(point.robotZ ?? surfaceZ);
    if (!Number.isFinite(contactZ))
      return { ok: false, error: `${point.name}의 종이 접촉 Z를 계산할 수 없습니다.` };
    const elevated = {
      x: Number(point.robotX),
      y: Number(point.robotY),
      z: safeZ,
      r: paperOriginPose.r,
    };
    const contact = {
      x: Number(point.robotX),
      y: Number(point.robotY),
      z: contactZ,
      r: paperOriginPose.r,
    };
    operations.push({ kind: "move", motion: "MoveL", target: elevated });
    operations.push({ kind: "move", motion: "MoveL", target: contact });
    capturePointByOperationIndex[String(operations.length - 1)] = point.name;
    operations.push({ kind: "move", motion: "MoveL", target: { ...elevated } });
  }
  operations.push({
    kind: "move",
    motion: "MoveL",
    target: { x: paperOriginPose.x, y: paperOriginPose.y, z: safeZ, r: paperOriginPose.r },
  });
  return { ok: true, safeZ, operations, capturePointByOperationIndex };
}

export function isPaperHardwareV6(version: string | undefined): boolean {
  return version === PAPER_HARDWARE_V6_VERSION;
}

export function paperV6TaskVersionForLevel(
  level: string,
  previousVersion?: string,
): string {
  if (level === "advanced-paper-hardware") return PAPER_HARDWARE_V6_VERSION;
  return previousVersion ?? "v5-paper-10cm";
}

export function paperV6ThetaFromDeltas(
  deltaXmm: string | number,
  deltaYmm: string | number,
): number | null {
  const dx = typeof deltaXmm === "number" ? deltaXmm : Number(deltaXmm);
  const dy = typeof deltaYmm === "number" ? deltaYmm : Number(deltaYmm);
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 1e-6)
    return null;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

export function paperV6EstimatedRotationDifference(
  frame: PaperFrame,
  model: PaperV6StudentModel,
): number | null {
  const origin = frame.samples.find((sample) => sample.point === "O")?.pose;
  const xPoint = frame.samples.find((sample) => sample.point === "X")?.pose;
  if (!origin || !xPoint) return null;
  const dx = xPoint.x - origin.x;
  const dy = xPoint.y - origin.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 1)
    return null;
  const observed = (Math.atan2(dy, dx) * 180) / Math.PI;
  const difference = observed - model.thetaDeg;
  return ((difference + 180) % 360 + 360) % 360 - 180;
}

export function paperV6ModelFromDraft(
  draft: PaperV6Draft,
  savedAt = Date.now(),
): { model: PaperV6StudentModel | null; error: string | null } {
  const values = [draft.originXmm, draft.originYmm, draft.deltaXmm, draft.deltaYmm]
    .map((value) => (value ?? "").trim())
    .map((value) => (value === "" ? NaN : Number(value)));
  if (!values.every(Number.isFinite))
    return {
      model: null,
      error:
        "O의 로봇 X/Y와 O에서 X까지의 ΔX/ΔY를 mm로 입력하세요. 빈칸을 0으로 처리하지 않습니다.",
    };
  const [originXmm, originYmm, deltaXmm, deltaYmm] = values;
  if (Math.hypot(deltaXmm, deltaYmm) < 1)
    return {
      model: null,
      error: "ΔX와 ΔY가 너무 작아 방향각을 정할 수 없습니다. O/X 자료를 확인하세요.",
    };
  const thetaAssumption = draft.thetaAssumption ?? "calculated";
  let thetaDeg: number;
  if (thetaAssumption === "zero") {
    thetaDeg = 0;
  } else {
    const rawTheta = (draft.thetaDeg ?? "").trim();
    if (!rawTheta || !Number.isFinite(Number(rawTheta)))
      return {
        model: null,
        error: "계산한 θ를 입력하거나 θ=0 가정을 선택하세요.",
      };
    thetaDeg = Number(rawTheta);
  }
  if (thetaDeg < -360 || thetaDeg > 360)
    return { model: null, error: "θ는 -360°에서 360° 사이로 입력하세요." };
  return {
    model: {
      originXmm,
      originYmm,
      deltaXmm,
      deltaYmm,
      thetaDeg,
      thetaAssumption,
      savedAt,
    },
    error: null,
  };
}

export function paperV6TransformFromModel(
  model: PaperV6StudentModel,
  explanation: string,
): PaperStudentTransform {
  return {
    originX: String(model.originXmm),
    originY: String(model.originYmm),
    axisDirection: "x+",
    millimetersPerCentimeter: "10",
    rotationDegrees: String(model.thetaDeg),
    explanation,
  };
}

export function paperV6EquationTerms(
  point: PaperGridPoint,
  model: PaperV6StudentModel,
): PaperV6FormulaWork {
  const a = point.xCm * 10;
  const b = point.yCm * 10;
  const theta = (model.thetaDeg * Math.PI) / 180;
  const aCos = a * Math.cos(theta);
  const bSin = b * Math.sin(theta);
  const aSin = a * Math.sin(theta);
  const bCos = b * Math.cos(theta);
  return {
    point: point.name,
    aCos,
    bSin,
    aSin,
    bCos,
    robotX: model.originXmm + aCos - bSin,
    robotY: model.originYmm + aSin + bCos,
  };
}

/** Apply the saved student O/θ model to a point without the hand-work gate.
 * Used only for the unseen V point after the model decision is saved. */
export function paperV6GeneratedPredictions(
  frame: PaperFrame,
  targets: readonly PaperGridPoint[],
  model: PaperV6StudentModel,
): PaperPredictionPoint[] {
  return targets.map((target) => {
    const terms = paperV6EquationTerms(target, model);
    const measuredPlane = frameTransformPoint(frame, target);
    return {
      ...target,
      robotX: String(terms.robotX),
      robotY: String(terms.robotY),
      robotZ: String(measuredPlane.z),
      robotR: String(frame.samples.find((sample) => sample.point === "O")!.pose.r),
    };
  });
}

const manualFields = [
  "aCos",
  "bSin",
  "aSin",
  "bCos",
  "robotX",
  "robotY",
] as const;
const numberFromDraft = (value: string | undefined) => {
  const text = value?.trim() ?? "";
  return text === "" || !Number.isFinite(Number(text)) ? null : Number(text);
};

export function paperV6PredictionsFromDraft(
  frame: PaperFrame,
  targets: readonly PaperGridPoint[],
  model: PaperV6StudentModel,
  draft: PaperV6Draft,
): {
  predictions: PaperPredictionPoint[] | null;
  formulaWork: PaperV6FormulaWork[];
  error: string | null;
} {
  if (targets.length === 0)
    return { predictions: null, formulaWork: [], error: "예측할 점이 없습니다." };
  const manualPoints =
    (draft.supportMode ?? "guided") === "challenge"
      ? new Set(targets.map((point) => point.name))
      : new Set([targets[0].name]);
  const formulaWork: PaperV6FormulaWork[] = [];
  const predictions: PaperPredictionPoint[] = [];
  for (const target of targets) {
    const expected = paperV6EquationTerms(target, model);
    let work = expected;
    if (manualPoints.has(target.name)) {
      const row = draft.formulaWork?.[target.name];
      const parsed = Object.fromEntries(
        manualFields.map((field) => [field, numberFromDraft(row?.[field])]),
      ) as Record<(typeof manualFields)[number], number | null>;
      const missing = manualFields.filter((field) => parsed[field] === null);
      if (missing.length)
        return {
          predictions: null,
          formulaWork,
          error: `${target.name}의 식 항과 최종 X/Y 계산을 모두 입력하세요.`,
        };
      const differences = manualFields.filter(
        (field) => Math.abs(parsed[field]! - expected[field]) > 0.51,
      );
      if (differences.length)
        return {
          predictions: null,
          formulaWork,
          error: `${target.name}에서 입력한 식의 ${differences.join(", ")} 값이 본인 O·θ 모델과 맞지 않습니다. 단위와 부호를 다시 대입하세요.`,
        };
      work = {
        point: target.name,
        aCos: parsed.aCos!,
        bSin: parsed.bSin!,
        aSin: parsed.aSin!,
        bCos: parsed.bCos!,
        robotX: parsed.robotX!,
        robotY: parsed.robotY!,
      };
    }
    formulaWork.push(work);
    predictions.push({
      ...target,
      robotX: String(work.robotX),
      robotY: String(work.robotY),
      robotZ: String(frameTransformPoint(frame, target).z),
      robotR: String(frame.samples.find((sample) => sample.point === "O")!.pose.r),
    });
  }
  return { predictions, formulaWork, error: null };
}

export function paperV6Assessment(
  run: PaperRunSnapshot | undefined,
  recordId: string,
  frameId: string,
  planHash: string,
  target: PaperGridPoint,
  ink: PaperInkReading | undefined,
): {
  status: "incomplete" | "simulation-only" | "within-tolerance" | "outside-tolerance";
  tcpErrorMm: number | null;
  inkErrorMm: number | null;
  message: string;
} {
  if (
    !run ||
    run.status !== "completed" ||
    run.frameId !== frameId ||
    run.planHash !== planHash ||
    run.observations.length !== 1 ||
    run.observations[0].point !== target.name
  )
    return {
      status: "incomplete",
      tcpErrorMm: null,
      inkErrorMm: null,
      message: "현재 시도의 검증점 V 실행이 완료되지 않았습니다.",
    };
  if (run.source !== "hardware")
    return {
      status: "simulation-only",
      tcpErrorMm: null,
      inkErrorMm: null,
      message: "DT·모의 자료입니다. 실측 재검증이 아닙니다.",
    };
  const observation = run.observations[0];
  if (
    observation.source !== "hardware" ||
    observation.kind !== "controller-tcp" ||
    !Number.isSafeInteger(observation.seq) ||
    observation.measuredAt < run.startedAt ||
    observation.measuredAt > (run.endedAt ?? 0)
  )
    return {
      status: "incomplete",
      tcpErrorMm: null,
      inkErrorMm: null,
      message: "V의 같은 실행에서 받은 유효한 제어기 TCP 보고가 없습니다.",
    };
  const prediction = run.commands[0]?.pose;
  if (!prediction)
    return {
      status: "incomplete",
      tcpErrorMm: null,
      inkErrorMm: null,
      message: "V의 저장된 학생 목표 좌표를 찾지 못했습니다.",
    };
  const tcpErrorMm = Math.hypot(
    observation.pose.x - prediction.x,
    observation.pose.y - prediction.y,
  );
  if (
    !ink ||
    ink.recordId !== recordId ||
    ink.runId !== run.id ||
    ink.frameId !== frameId ||
    ink.point !== target.name ||
    ink.source !== "student-manual-ink" ||
    ink.status !== "measured" ||
    ink.xCm === null ||
    ink.yCm === null
  )
    return {
      status: "incomplete",
      tcpErrorMm,
      inkErrorMm: null,
      message: "V의 학생 수기 잉크 측정을 이 실행에 연결해 입력하세요.",
    };
  const inkErrorMm = Math.hypot(
    (ink.xCm - target.xCm) * 10,
    (ink.yCm - target.yCm) * 10,
  );
  const within =
    tcpErrorMm <= PAPER_V6_VERIFICATION_TOLERANCE_MM &&
    inkErrorMm <= PAPER_V6_VERIFICATION_TOLERANCE_MM;
  return {
    status: within ? "within-tolerance" : "outside-tolerance",
    tcpErrorMm,
    inkErrorMm,
    message: within
      ? `실물 V 재검증 충족 · TCP ${tcpErrorMm.toFixed(2)} mm · 잉크 ${inkErrorMm.toFixed(2)} mm · 사전 기준 ±2.0 mm`
      : `실물 V 재검증 미충족 · TCP ${tcpErrorMm.toFixed(2)} mm · 잉크 ${inkErrorMm.toFixed(2)} mm · 사전 기준 ±2.0 mm`,
  };
}

export function paperV6OperationalIndicators(record: PaperTrialRecord) {
  const run = record.run;
  const linkedAnalysis = (record.aiAnalyses ?? []).find(
    (analysis) =>
      !!analysis.evidenceSnapshot &&
      analysis.recordId === record.id &&
      !!run &&
      analysis.runId === run.id &&
      analysis.planHash === run.planHash &&
      analysis.source === run.source,
  );
  const linkedInk = (record.inkReadings ?? []).some(
    (reading) =>
      reading.recordId === record.id &&
      !!run &&
      reading.runId === run.id &&
      reading.frameId === run.frameId &&
      reading.status === "measured",
  );
  return {
    I1: {
      evidenceSentForSameRun: !!linkedAnalysis,
      provider: linkedAnalysis?.provider ?? null,
      source: linkedAnalysis?.source ?? null,
      actualOpenAi: linkedAnalysis?.provider === "openai",
      promptVersion: linkedAnalysis?.promptVersion ?? null,
    },
    I2: {
      studentJudgmentLinked:
        !!record.v6?.decision &&
        !!record.v6?.decisionReason?.trim() &&
        !!record.v6?.followupChecks?.length &&
        !!record.v6?.followupResult?.trim() &&
        !!record.followupObservation &&
        record.followupObservation.recordId === record.id &&
        record.followupObservation.runId === run?.id,
      decision: record.v6?.decision ?? null,
    },
    I3: {
      independentlyRevalidated:
        record.targetSet === "revalidation" &&
        !!run &&
        run.source === "hardware" &&
        run.status === "completed" &&
        record.v6?.assessment?.runId === run.id &&
        record.v6.assessment.planHash === run.planHash &&
        record.v6.assessment.status === "within-tolerance" &&
        linkedInk,
      source: run?.source ?? null,
      status: record.v6?.assessment?.status ?? "incomplete",
      toleranceMm: record.v6?.assessment?.toleranceMm ?? null,
    },
  };
}
