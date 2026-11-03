const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const cache = {};
function load(name) {
  if (cache[name]) return cache[name];
  const exports = (cache[name] = {});
  const file = path.join(__dirname, `${name}.ts`);
  const javascript = ts.transpileModule(fs.readFileSync(file, "utf8"), {
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

const {
  archiveCompletedPaperRunForLiftEdit,
  paperLiftHeightDraftState,
  parsePaperLiftHeightDraft,
} = load("paperCoordinateStudy");

const savedHeight = {
  z: 50,
  source: "hardware",
  connectionToken: "test-connection",
  seq: 17,
  capturedAt: 1234,
  ageMsAtCapture: 0,
  user: 0,
  tool: 0,
  coordinateSystem: "User 0 / Tool 0",
};

test("lift Z accepts negative and fractional absolute coordinates", () => {
  assert.equal(parsePaperLiftHeightDraft("-119.71277618408203"), -119.71277618408203);
  assert.equal(parsePaperLiftHeightDraft(".5"), 0.5);
  assert.equal(parsePaperLiftHeightDraft("12."), 12);
  assert.equal(parsePaperLiftHeightDraft("0"), 0);
});

test("blank and transient sign/decimal drafts stay intact and never reuse an old saved height", () => {
  for (const input of ["", "-", ".", "-."]) {
    assert.equal(parsePaperLiftHeightDraft(input), null);
    assert.deepEqual(paperLiftHeightDraftState(input, savedHeight), {
      input,
      value: null,
      saved: false,
      source: null,
      sequence: null,
    });
  }
  assert.deepEqual(paperLiftHeightDraftState("-22.5", savedHeight), {
    input: "-22.5",
    value: null,
    saved: false,
    source: null,
    sequence: null,
  });
});

test("only a draft matching the saved record exposes its source and sequence", () => {
  assert.deepEqual(paperLiftHeightDraftState("50.0", savedHeight), {
    input: "50.0",
    value: 50,
    saved: true,
    source: "hardware",
    sequence: 17,
  });
});

test("editing after a completed run archives immutable evidence and invalidates old confirmation", () => {
  const previousRun = {
    id: "run-old",
    planHash: "old-plan",
    frameId: "frame",
    targetSet: "initial",
    source: "dt",
    status: "completed",
    startedAt: 1,
    endedAt: 2,
    startSequence: null,
    commands: [{ point: "P1", pose: { x: 10, y: 20, z: 50, r: 0 } }],
    observations: [],
  };
  const record = {
    id: "trial",
    task: "paper-coordinate",
    version: 1,
    attempt: 2,
    parentAttemptId: "parent",
    targetSet: "initial",
    level: "advanced-paper-hardware",
    status: "observed",
    dataSource: "dt",
    createdAt: "a",
    updatedAt: "b",
    frame: { id: "frame" },
    run: previousRun,
    runHistory: [],
    dtRunPlanHash: "old-plan",
    verificationCriteria: { planHash: "old-plan" },
    diagnosis: { status: "complete" },
    predictions: [{ name: "P1", xCm: 1, yCm: 2 }],
    aiAnalyses: [{ id: "ai-old", runId: "run-old" }],
  };

  const edited = archiveCompletedPaperRunForLiftEdit(record);
  assert.equal(edited.run, undefined);
  assert.deepEqual(edited.runHistory, [previousRun]);
  assert.equal(edited.dtRunPlanHash, undefined);
  assert.equal(edited.verificationCriteria, undefined);
  assert.equal(edited.diagnosis, undefined);
  assert.equal(edited.id, record.id);
  assert.equal(edited.parentAttemptId, record.parentAttemptId);
  assert.deepEqual(edited.predictions, record.predictions);
  assert.deepEqual(edited.aiAnalyses, record.aiAnalyses);
  assert.equal(record.run, previousRun, "the original record object remains unchanged");
});

test("an in-progress run is never archived or modified for a lift edit", () => {
  const record = {
    id: "trial",
    task: "paper-coordinate",
    version: 1,
    attempt: 1,
    parentAttemptId: null,
    targetSet: "initial",
    level: "advanced-paper-hardware",
    status: "running",
    dataSource: "dt",
    createdAt: "a",
    updatedAt: "b",
    run: { id: "run-live", status: "running" },
  };
  assert.equal(archiveCompletedPaperRunForLiftEdit(record), record);
});

test("the UI binds the raw text draft and renders its local status beside the input", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "PaperCoordinateStudyView.tsx"),
    "utf8",
  );
  assert.match(source, /type="text"[\s\S]{0,220}value=\{state\.liftHeightInput\}/);
  assert.match(source, /inputMode="decimal"/);
  assert.match(source, /state\.liftRecordFeedback/);
  assert.match(source, /state\.run\?\.status === "running"/);
});
