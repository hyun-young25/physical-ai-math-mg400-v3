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
const rectangle = load("paperRectangleTask");

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

test("advanced v6 student UI maps seven saved stages to the five requested scenes without changing save gates", () => {
  const ui = fs.readFileSync(path.join(__dirname, "PaperV6StudentLesson.tsx"), "utf8");
  const shell = fs.readFileSync(path.join(__dirname, "PaperV6StepShell.tsx"), "utf8");
  for (const title of [
    "종이가 어디 있지?",
    "내 식으로 예측하기",
    "로봇이 그려요",
    "비교하고 AI에게 묻기",
    "고칠까, 유지할까? → 새 점에서 확인",
  ]) assert.ok(ui.includes(title), `missing scene title: ${title}`);
  assert.match(ui, /editingRevisionModel \? 2 : step <= 2 \? 1 : step <= 4 \? 2 : step === 5 \? 3 : step === 6 \? 4 : 5/);
  assert.match(ui, /if \(scene === 1\) navigate\(3\)/);
  assert.match(ui, /canGoNext=.*hasAllReferences/s);
  assert.match(ui, /data-testid="paper-v6-current-reference"/);
  assert.match(ui, /data-testid="paper-v6-record-current-reference"/);
  assert.match(ui, /const saveModelAndPrediction = \(\) => \{\s*const modelResult = actions\.onV6SaveModel\?\.\(\);[\s\S]*?if \(modelResult\?\.kind === "error"\)[\s\S]*?const predictionResult = actions\.onV6SavePrediction\?\.\(\);/);
  assert.match(ui, /scene === 2 && \(step === 3 \|\| step === 4 \|\| editingRevisionModel\)/);
  assert.match(ui, /scene === 2 && !editingRevisionModel/);
  assert.match(ui, /data-testid="paper-v6-lift-gap-input"/);
  assert.match(ui, /aria-label="펜 들기 간격 mm"/);
  assert.match(ui, /value=\{state\.liftGapInput \?\? ""\}/);
  assert.match(ui, /actions\.onLiftGapChange\?\.\(event\.target\.value\)/);
  assert.match(ui, /state\.liftGapSaved[\s\S]*state\.paperSurfaceZ/);
  assert.match(ui, /state\.currentPose\.z > state\.liftHeight/);
  assert.match(ui, /paper-v6-revision-deltas/);
  assert.match(ui, /totalSteps=\{5\}/);
  assert.match(ui, /state\.error\?\.trim\(\) \|\| message\?\.trim\(\) \|\| undefined/);
  assert.match(ui, /runAction\(actions\.onV6CreateRevalidation\)/);
  assert.match(ui, /식 고치기/);
  assert.match(ui, /식 유지/);
  assert.equal((ui.match(/무엇을 추가로 확인했나요\?/g) ?? []).length, 1);
  assert.doesNotMatch(ui, /paper-v6-current-ai-output/);
  assert.equal((ui.match(/\{blocks\.analysis\}/g) ?? []).length, 1);
  assert.match(ui, /state\.runAvailable/);
  assert.match(ui, /state\.physicalAvailable/);
  assert.match(ui, /교사용 상세/);
  assert.match(shell, /totalSteps\?: number/);
  assert.match(shell, /totalSteps = 7/);
  assert.match(shell, /max=\{stepCount\}/);
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

test("entering advanced-paper-hardware with a saved v5 attempt starts a new v6 attempt", () => {
  const savedV5 = {
    task: "paper-coordinate",
    id: "saved-v5",
    level: "advanced-paper-hardware",
    taskVersion: "v5-paper-10cm",
    status: "incomplete",
    attempt: 4,
  };
  assert.equal(
    paper.initialPaperAttemptForLevel(
      [savedV5],
      "advanced-paper-hardware",
    ),
    undefined,
  );
  assert.match(
    paper.paperLegacyRecordNotice(
      "advanced-paper-hardware",
      savedV5.taskVersion,
    ),
    /v5.*10×10 cm.*자동 변환.*읽기 전용/,
  );
  assert.equal(paper.isPaperHardwareAttemptReadOnly(savedV5), true);
  assert.equal(
    paper.isPaperHardwareAttemptReadOnly({
      ...savedV5,
      taskVersion: undefined,
    }),
    true,
  );
  assert.equal(
    paper.isPaperHardwareAttemptReadOnly({
      ...savedV5,
      level: "advanced-paper-dt",
    }),
    false,
  );
  assert.equal(
    v6.paperV6TaskVersionForLevel(
      "advanced-paper-hardware",
      savedV5.taskVersion,
    ),
    paper.PAPER_HARDWARE_V6_VERSION,
  );
  assert.equal(paper.PAPER_GRID_SIZE_CM, 10);
  const initialTargets = rectangle.paperTaskTargets(
    "advanced-paper-hardware",
    "initial",
    paper.PAPER_HARDWARE_V6_VERSION,
  );
  assert.deepEqual(
    initialTargets.map(({ xCm, yCm }) => [xCm, yCm]),
    [[1, 1], [9, 1], [9, 9], [1, 9]],
  );
  assert.ok(
    initialTargets.every(
      ({ xCm, yCm }) => xCm >= 0 && xCm <= 10 && yCm >= 0 && yCm <= 10,
    ),
  );
  assert.deepEqual(
    rectangle.paperTaskTargets(
      "advanced-paper-hardware",
      "revalidation",
      paper.PAPER_HARDWARE_V6_VERSION,
    ),
    [{ name: "V", xCm: 5, yCm: 6 }],
  );

  const activeV6 = {
    ...savedV5,
    id: "active-v6",
    taskVersion: paper.PAPER_HARDWARE_V6_VERSION,
    status: "model",
    v6: { assessment: { status: "incomplete" } },
  };
  assert.equal(
    paper.initialPaperAttemptForLevel(
      [savedV5, activeV6],
      "advanced-paper-hardware",
    )?.id,
    "active-v6",
  );
  assert.equal(paper.isPaperHardwareAttemptReadOnly(activeV6), false);

  const completedV6 = {
    ...activeV6,
    status: "revalidated",
    v6: { assessment: { status: "within-tolerance" } },
  };
  assert.equal(
    paper.initialPaperAttemptForLevel(
      [savedV5, completedV6],
      "advanced-paper-hardware",
    ),
    undefined,
  );
  assert.equal(
    paper.initialPaperAttemptForLevel(
      [
        savedV5,
        {
          ...activeV6,
          status: "running",
          run: { status: "running" },
        },
      ],
      "advanced-paper-hardware",
    ),
    undefined,
  );
  const retiredHardware = {
    task: "paper-coordinate",
    id: "retired-hardware",
    level: "advanced-paper-hardware",
    taskVersion: "v4-paper-merged",
    status: "incomplete",
    originalPrediction: { x: 11, y: 15 },
  };
  const retiredDt = {
    ...retiredHardware,
    id: "retired-dt",
    level: "advanced-paper-dt",
  };
  assert.deepEqual(
    paper.visiblePaperAttempts([retiredHardware, savedV5, retiredDt]).map(
      ({ id }) => id,
    ),
    ["saved-v5"],
  );
  const preservedStorage = paper.paperAttemptsForStorage(
    [{ ...savedV5, status: "model" }, activeV6],
    [retiredHardware, savedV5, retiredDt],
  );
  assert.deepEqual(
    preservedStorage.filter(paper.isArchivedPaperAttempt),
    [retiredHardware, retiredDt],
  );
  assert.deepEqual(
    paper.visiblePaperAttempts(preservedStorage).map(({ id }) => id),
    ["saved-v5", "active-v6"],
  );
  assert.doesNotMatch(
    paper.paperLegacyRecordNotice(
      "advanced-paper-hardware",
      "unversioned-legacy",
    ),
    /20\s*[×x]\s*20|20\s*cm/i,
  );
  for (const filename of [
    "PaperCoordinateStudyView.tsx",
    "PaperScene.tsx",
  ]) {
    const source = fs.readFileSync(path.join(__dirname, filename), "utf8");
    assert.doesNotMatch(source, /20\s*[×x]\s*20|20\s*cm/i);
  }
});

test("v6 off-sheet predictions pass with the pen lifted instead of blocking the run (thesis case A)", () => {
  // θ=0 assumption on a sheet rotated by ~28.6°: P2/P3 land off the sheet.
  const rotated = {
    ...frame,
    samples: ["O", "X", "Y"].map((point) => ({ ...frame.samples[0], point, pose: paper.paperV6MockReferencePose(point) })),
  };
  const predictions = [
    { name: "P1", xCm: 1, yCm: 1, robotX: "210", robotY: "60", robotZ: "0" },
    { name: "P2", xCm: 9, yCm: 1, robotX: "290", robotY: "60", robotZ: "0" },
    { name: "P3", xCm: 9, yCm: 9, robotX: "290", robotY: "140", robotZ: "0" },
    { name: "P4", xCm: 1, yCm: 9, robotX: "210", robotY: "140", robotZ: "0" },
  ];
  const plan = v6.buildPaperV6MovePlan({
    startPose: { x: 250, y: 80, z: 40, r: 0 },
    paperOriginPose: rotated.samples[0].pose,
    predictions,
    surfaceZ: 0,
    liftGapMm: 10,
    penDownAt: (pose) => paper.paperPenDownAllowed(rotated, pose),
  });
  assert.equal(plan.ok, true);
  const captured = Object.entries(plan.capturePointByOperationIndex).map(([index, point]) => [point, plan.operations[Number(index)].target.z]);
  assert.deepEqual(captured.map(([point]) => point), ["P1", "P2", "P3", "P4"]);
  // Pen down only on the sheet; off-sheet points are observed at the lifted height.
  assert.deepEqual(captured.map(([, z]) => z === 0), [true, false, false, true]);
  assert.ok(plan.operations.every((operation) => operation.target.z >= 0));
  // The 30 mm sheet distance no longer blocks v6, but teacher/DT gates remain.
  const outside = { point: "P3", pose: { x: 290, y: 140, z: 0, r: 0 } };
  assert.equal(guards.supervisedPaperBlockers(true, true, true, rotated, [outside], 10, true).length, 0);
  assert.deepEqual(guards.supervisedPaperBlockers(false, true, false, rotated, [outside], 10, true).map((x) => x.target), ["teacher", "dt"]);
  // Mock ink: off-sheet points are reported as no ink with a reason; on-sheet ones carry ruler-like noise.
  const ink = paper.paperV6MockInkDrafts(rotated, predictions.map((p) => ({ point: p.name, pose: { x: Number(p.robotX), y: Number(p.robotY), z: 0, r: 0 } })));
  assert.deepEqual(ink.map((row) => row.status), ["measured", "outside-range", "outside-range", "measured"]);
  assert.ok(ink.filter((row) => row.status === "outside-range").every((row) => row.reason.trim() && !row.xCm && !row.yCm));
  for (const row of ink.filter((item) => item.status === "measured")) {
    const exact = paper.frameInversePoint(rotated, { x: Number(predictions.find((p) => p.name === row.point).robotX), y: Number(predictions.find((p) => p.name === row.point).robotY), z: 0, r: 0 });
    assert.ok(Math.abs(Number(row.xCm) - exact.xCm) <= 0.051 && Math.abs(Number(row.yCm) - exact.yCm) <= 0.051);
  }
});

test("v6 runs stay on the '로봇이 그려요' scene (stage 5) while executing", () => {
  const source = fs.readFileSync(path.join(__dirname, "PaperCoordinateStudy.tsx"), "utf8");
  assert.match(source, /const runStage: PaperLessonStage =\s*isMergedPaper\(level\) && active\.targetSet === "revalidation"\s*\?\s*7\s*:\s*isV6Attempt\s*\?\s*5\s*:\s*4;/);
  const arm = fs.readFileSync(path.join(__dirname, "RobotArm.tsx"), "utf8");
  assert.match(arm, /document\.hidden/);
});
