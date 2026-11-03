const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const cache = {};
function load(name) {
  if (cache[name]) return cache[name];
  const exports = (cache[name] = {});
  const source = fs.readFileSync(path.join(__dirname, `${name}.ts`), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  new Function("exports", "require", javascript)(exports, (id) =>
    load(id.replace("./", "")),
  );
  return exports;
}

const v6 = load("paperV6Model");
const paper = load("paperCoordinateStudy");
const aiAnalysis = load("paperAiAnalysis");
const guards = load("paperExecutionGuards");

const frame = {
  id: "mock-frame-1",
  source: "hardware",
  coordinateSystem: "User 0 / Tool 0",
  user: 0,
  tool: 0,
  capturedAt: 100,
  samples: [
    {
      point: "O",
      pose: { x: 200, y: 50, z: -119.7128, r: 5 },
      source: "hardware",
      seq: 1,
      capturedAt: 100,
      user: 0,
      tool: 0,
      coordinateSystem: "User 0 / Tool 0",
    },
    {
      point: "X",
      pose: { x: 286.6, y: 100, z: -119.7128, r: 35 },
      source: "hardware",
      seq: 2,
      capturedAt: 101,
      user: 0,
      tool: 0,
      coordinateSystem: "User 0 / Tool 0",
    },
    {
      point: "Y",
      pose: { x: 150, y: 136.6, z: -119.7128, r: -15 },
      source: "hardware",
      seq: 3,
      capturedAt: 102,
      user: 0,
      tool: 0,
      coordinateSystem: "User 0 / Tool 0",
    },
  ],
};

test("v6 computes the student model from O and student Δ values and keeps θ=0 as an explicit assumption", () => {
  const theta = v6.paperV6ThetaFromDeltas(86.6, 50);
  assert.ok(Math.abs(theta - 30) < 0.01);
  const parsed = v6.paperV6ModelFromDraft({
    originXmm: "200",
    originYmm: "50",
    deltaXmm: "86.6",
    deltaYmm: "50",
    thetaDeg: "30",
    thetaAssumption: "calculated",
  });
  assert.equal(parsed.error, null);
  const p3 = v6.paperV6EquationTerms({ name: "P3", xCm: 10, yCm: 6 }, parsed.model);
  assert.ok(Math.abs(p3.robotX - 256.6025) < 0.01);
  assert.ok(Math.abs(p3.robotY - 151.9615) < 0.01);

  const zero = v6.paperV6ModelFromDraft({
    originXmm: "200",
    originYmm: "50",
    deltaXmm: "86.6",
    deltaYmm: "50",
    thetaDeg: "30",
    thetaAssumption: "zero",
  });
  assert.equal(zero.model.thetaDeg, 0);
  assert.equal(zero.model.thetaAssumption, "zero");
  assert.equal(v6.paperV6TaskVersionForLevel("advanced-paper-hardware", "v5-paper-10cm"), "v6-paper-transform");
  assert.equal(v6.paperV6TaskVersionForLevel("advanced-paper-dt", "v5-paper-10cm"), "v5-paper-10cm");
});

test("guided P1 hand substitution is checked against the student's equation, not the measured frame", () => {
  const model = v6.paperV6ModelFromDraft({
    originXmm: "200",
    originYmm: "50",
    deltaXmm: "86.6",
    deltaYmm: "50",
    thetaDeg: "30",
    thetaAssumption: "calculated",
  }).model;
  const terms = v6.paperV6EquationTerms({ name: "P1", xCm: 10, yCm: 6 }, model);
  const valid = v6.paperV6PredictionsFromDraft(
    frame,
    [{ name: "P1", xCm: 10, yCm: 6 }],
    model,
    {
      supportMode: "guided",
      formulaWork: {
        P1: Object.fromEntries(
          ["aCos", "bSin", "aSin", "bCos", "robotX", "robotY"].map((key) => [
            key,
            String(terms[key]),
          ]),
        ),
      },
    },
  );
  assert.equal(valid.error, null);
  assert.equal(valid.predictions[0].robotX, String(terms.robotX));
  const mismatch = v6.paperV6PredictionsFromDraft(
    frame,
    [{ name: "P1", xCm: 10, yCm: 6 }],
    model,
    {
      supportMode: "guided",
      formulaWork: {
        P1: Object.fromEntries(
          ["aCos", "bSin", "aSin", "bCos", "robotX", "robotY"].map((key) => [
            key,
            String(key === "robotX" ? 999 : valid.formulaWork[0][key]),
          ]),
        ),
      },
    },
  );
  assert.match(mismatch.error, /본인 O·θ 모델과 맞지 않습니다/);
});

test("the production v6 planner sends student XY, plane contact Z, constant O rotation, and preserves the higher start", () => {
  const predictions = ["P1", "P2", "P3", "P4"].map((name, index) => ({
    name,
    xCm: index,
    yCm: index,
    robotX: String(200 + index * 10),
    robotY: String(50 + index * 5),
    robotZ: "-119.7128",
  }));
  const captures = [];
  for (const gap of [19.2128, 24.4628, 40]) {
    const plan = v6.buildPaperV6MovePlan({
      startPose: { x: 250, y: 80, z: -119.7128, r: 90 },
      paperOriginPose: frame.samples[0].pose,
      predictions,
      surfaceZ: -119.7128,
      liftGapMm: gap,
    });
    assert.equal(plan.ok, true);
    const mockReceiver = [];
    for (const operation of plan.operations) mockReceiver.push(operation.target);
    assert.equal(mockReceiver.length, 14);
    const approach = mockReceiver[1].z;
    const contact = mockReceiver[2].z;
    const up = mockReceiver[3].z;
    captures.push({ gap, safeZ: plan.safeZ, approach, contact, up, count: mockReceiver.length });
    assert.equal(approach, plan.safeZ);
    assert.equal(up, plan.safeZ);
    assert.equal(contact, -119.7128);
    assert.equal(mockReceiver[0].r, 5);
    assert.equal(mockReceiver[1].r, 5);
    assert.deepEqual(plan.capturePointByOperationIndex, { "2": "P1", "5": "P2", "8": "P3", "11": "P4" });
  }
  assert.equal(captures[0].safeZ, -100.5);
  assert.equal(captures[1].safeZ, -95.25);
  assert.equal(captures[2].safeZ, -79.7128);
  const highStart = v6.buildPaperV6MovePlan({
    startPose: { x: 250, y: 80, z: -70, r: 90 },
    paperOriginPose: frame.samples[0].pose,
    predictions: predictions.slice(0, 1),
    surfaceZ: -119.7128,
    liftGapMm: 24.4628,
  });
  assert.equal(highStart.ok, true);
  assert.equal(highStart.safeZ, -70);
  assert.equal(v6.buildPaperV6MovePlan({
    startPose: { x: 250, y: 80, z: -119.7128, r: 90 },
    paperOriginPose: frame.samples[0].pose,
    predictions,
    surfaceZ: -119.7128,
    liftGapMm: 0,
  }).ok, false);
});

test("v6 supervised physical guard requires DT/teacher confirmation and blocks only the 30 mm sheet margin, not a 2 mm prediction difference", () => {
  const within = {
    point: "P1",
    pose: paper.frameTransformPoint(frame, { xCm: 0, yCm: 0.2 }),
  };
  assert.deepEqual(guards.supervisedPaperBlockers(false, true, false, frame, [within], 10).map((x) => x.target), ["teacher", "dt"]);
  assert.deepEqual(guards.supervisedPaperBlockers(true, true, true, frame, [within], 10), []);
  const outsidePose = paper.frameTransformPoint(frame, { xCm: 13.1, yCm: 0 });
  const outside = { point: "P4", pose: outsidePose };
  const reasons = guards.supervisedPaperBlockers(true, true, true, frame, [outside], 10);
  assert.equal(reasons.length, 1);
  assert.match(reasons[0].message, /30 mm/);
});

test("V assessment rejects DT, stale run/ink mixing, and only accepts a same-run hardware TCP plus ink record", () => {
  const target = { name: "V", xCm: 5, yCm: 6 };
  const hardwareRun = {
    id: "run-v",
    planHash: "hash-v",
    frameId: frame.id,
    source: "hardware",
    status: "completed",
    startedAt: 100,
    endedAt: 200,
    commands: [{ point: "V", pose: { x: 250, y: 110, z: -119.7128, r: 5 } }],
    observations: [{
      point: "V",
      source: "hardware",
      kind: "controller-tcp",
      seq: 4,
      measuredAt: 150,
      pose: { x: 251, y: 110, z: -119.7128, r: 5 },
    }],
  };
  const ink = {
    recordId: "attempt-v",
    runId: "run-v",
    frameId: frame.id,
    point: "V",
    source: "student-manual-ink",
    status: "measured",
    xCm: 5.1,
    yCm: 6,
  };
  assert.equal(v6.paperV6Assessment(hardwareRun, "attempt-v", frame.id, "hash-v", target, ink).status, "within-tolerance");
  assert.equal(v6.paperV6Assessment({ ...hardwareRun, source: "dt" }, "attempt-v", frame.id, "hash-v", target, ink).status, "simulation-only");
  assert.equal(v6.paperV6Assessment(hardwareRun, "attempt-v", frame.id, "hash-v", target, { ...ink, runId: "old-run" }).status, "incomplete");
  assert.deepEqual(paper.classifyPaperVerificationPoints([
    { name: "P1", xCm: 0, yCm: 0 },
    target,
  ]).independentVerificationPoints, ["V"]);
});

test("sanitized AI evidence carries the current and directly linked parent math without learner identifiers", () => {
  const parent = {
    id: "parent-attempt",
    learnerId: "PII_SHOULD_NOT_BE_SENT",
    task: "paper-coordinate",
    version: 1,
    taskVersion: "v6-paper-transform",
    attempt: 1,
    parentAttemptId: null,
    targetSet: "initial",
    level: "advanced-paper-hardware",
    status: "reasoned",
    dataSource: "hardware",
    createdAt: "2026-11-04T00:00:00.000Z",
    updatedAt: "2026-11-04T00:00:00.000Z",
    frame,
    planHash: "parent-plan",
    transform: { originX: "190", originY: "-60", axisDirection: "x+", millimetersPerCentimeter: "10", rotationDegrees: "0", explanation: "이전 학생 식" },
    predictions: [{ name: "P1", xCm: 0, yCm: 0, robotX: "190", robotY: "-60", robotZ: "-119.7", robotR: "5" }],
    run: {
      id: "parent-run", planHash: "parent-plan", frameId: frame.id, targetSet: "initial",
      source: "hardware", status: "completed", startedAt: 100, endedAt: 200, startSequence: 1,
      commands: [{ point: "P1", pose: { x: 190, y: -60, z: -119.7, r: 5 } }],
      observations: [{ point: "P1", source: "hardware", kind: "controller-tcp", seq: 9, measuredAt: 150, pose: { x: 200, y: -60, z: -119.7, r: 5 } }],
    },
    diagnosis: { method: "rule-based", source: "hardware", status: "complete", candidate: "translation", evidence: [], predictionEvidence: [], taskEvidence: [{ point: "P1", dx: 10, dy: 0, distance: 10, xCm: 0, yCm: 0 }], firstMismatch: "P1", question: "O와 P1을 비교해 볼까요?", why: "10 mm 차이", tutorSource: "default question", pattern: "translation" },
    studentHypothesis: "기준점 위치를 더 확인",
    followupObservation: { recordId: "parent-attempt", runId: "parent-run", source: "student-report", text: "O에서 10mm 차이", recordedAt: 201 },
    modelDecision: "revise",
    modelDecisionReason: "O의 기준을 다시 확인",
    revisionReason: "기준점 원인을 확인",
    v6: {
      model: { originXmm: 190, originYmm: -60, deltaXmm: 100, deltaYmm: 0, thetaDeg: 0, thetaAssumption: "zero", savedAt: 100 },
      initialModel: { originXmm: 190, originYmm: -60, deltaXmm: 100, deltaYmm: 0, thetaDeg: 0, thetaAssumption: "zero", savedAt: 100 },
      formulaWork: [{ point: "P1", aCos: 0, bSin: 0, aSin: 0, bCos: 0, robotX: 190, robotY: -60 }],
      explanation: "x=O+a, y=O+b",
      supportMode: "guided",
      followupChecks: ["review-ox-direction"],
      followupResult: "O→X를 다시 확인",
      decision: "revise",
      decisionReason: "O 기준 위치",
      promptVersion: "paper-v6-question-1",
    },
    aiAnalyses: [{
      id: "parent-ai", mode: "gpt", provider: "openai", status: "provided",
      question: "O 기준을 확인할까요?", text: "O와 X의 관계를 확인해 보세요.",
      requestedAt: "2026-11-04T00:00:00.000Z", displayedAt: "2026-11-04T00:00:01.000Z",
      recordId: "parent-attempt", runId: "parent-run", planHash: "parent-plan", source: "hardware",
      promptVersion: "paper-v6-question-1",
    }],
  };
  const child = {
    ...parent,
    id: "child-attempt",
    learnerId: "PII_SHOULD_NOT_BE_SENT",
    attempt: 2,
    parentAttemptId: parent.id,
    run: undefined,
    aiAnalyses: [],
    modelDecision: undefined,
    v6: {
      ...parent.v6,
      model: { ...parent.v6.model, originXmm: 180, savedAt: 300 },
      decision: undefined,
      decisionReason: undefined,
    },
  };
  const context = aiAnalysis.paperFeedbackContext(
    child,
    [parent, child],
    [{ name: "P1", xCm: 0, yCm: 0 }],
  );
  const serialized = JSON.stringify(context);
  assert.match(serialized, /190/);
  assert.match(serialized, /180/);
  assert.match(serialized, /10 mm/);
  assert.match(serialized, /O 기준 위치/);
  assert.match(serialized, /O→X를 다시 확인/);
  assert.match(serialized, /x=O\+a, y=O\+b/);
  assert.doesNotMatch(serialized, /PII_SHOULD_NOT_BE_SENT/);
});
