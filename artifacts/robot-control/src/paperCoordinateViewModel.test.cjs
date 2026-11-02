const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = path.join(__dirname, "paperCoordinateViewModel.ts");
const exports_ = {};
new Function("exports", "require", ts.transpileModule(fs.readFileSync(source, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(exports_, name => {
  throw new Error(`Unexpected runtime import: ${name}`);
});

test("7단계 진입 차단은 실제 누락 항목과 이동 위치를 반환한다", () => {
  assert.deepEqual(
    exports_.paperStageNavigationRequirement(7, false, false),
    {
      target: "diagnosis",
      message: "6단계 비교 자료가 아직 완성되지 않았습니다. 실행 결과와 연결된 비교 자료를 먼저 확인하세요.",
    },
  );
  assert.deepEqual(
    exports_.paperStageNavigationRequirement(7, true, false),
    {
      target: "hypothesis",
      message: "7단계로 가기 전에 6단계에서 관측 자료에 대한 원인 가설을 입력하고 ‘생각 저장’을 눌러야 합니다.",
    },
  );
  assert.equal(exports_.paperStageNavigationRequirement(7, true, true), null);
  assert.equal(exports_.paperStageNavigationRequirement(6, false, false), null);
});

test("실행 전 기준은 실행 기록이 없어도 현재 시도·기준점·계획에 맞으면 저장됨으로 표시된다", () => {
  const criteria = {
    recordId: "attempt-2",
    frameId: "frame-2",
    planHash: "plan-2",
    positionToleranceMm: 2,
  };
  assert.equal(
    exports_.paperVerificationCriteriaSavedForAttempt(criteria, "attempt-2", "frame-2", "plan-2", true),
    true,
  );
  assert.equal(
    exports_.paperVerificationCriteriaSavedForAttempt(criteria, "attempt-2", "frame-2", "plan-3", true),
    false,
  );
  assert.equal(
    exports_.paperVerificationCriteriaSavedForAttempt(criteria, "attempt-2", "frame-2", "plan-2", false),
    false,
  );
  assert.equal(
    exports_.paperVerificationCriteriaSavedForAttempt(criteria, "attempt-other", "frame-2", "plan-2", true),
    false,
  );
});
