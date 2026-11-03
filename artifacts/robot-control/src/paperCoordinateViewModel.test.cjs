const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = path.join(__dirname, "paperCoordinateViewModel.ts");
const exports_ = {};
new Function(
  "exports",
  "require",
  ts.transpileModule(fs.readFileSync(source, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText,
)(exports_, (name) => {
  throw new Error(`Unexpected runtime import: ${name}`);
});

test("7단계 진입 차단은 실제 누락 항목과 이동 위치를 반환한다", () => {
  assert.deepEqual(exports_.paperStageNavigationRequirement(7, false, false), {
    target: "diagnosis",
    message:
      "6단계 비교 자료가 아직 완성되지 않았습니다. 실행 결과와 연결된 비교 자료를 먼저 확인하세요.",
  });
  assert.deepEqual(exports_.paperStageNavigationRequirement(7, true, false), {
    target: "hypothesis",
    message:
      "7단계로 가기 전에 6단계에서 관측 자료에 대한 원인 가설을 입력하고 ‘생각 저장’을 눌러야 합니다.",
  });
  assert.equal(exports_.paperStageNavigationRequirement(7, true, true), null);
  assert.equal(exports_.paperStageNavigationRequirement(6, false, false), null);
});

test("기존 저장 단계는 학생에게 세 화면으로 묶여 재시도도 수정 화면에 남는다", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7].map(exports_.paperStudentScreenForStage),
    [1, 1, 1, 2, 2, 2, 3],
  );
});

test("재시도는 완료 전에는 비교 화면을 열고, 완료 직후에만 판단 화면으로 자동 이동한다", () => {
  assert.equal(exports_.paperRetryExecutionReady(1), false);
  assert.equal(exports_.paperRetryExecutionReady(2), false);
  assert.equal(exports_.paperRetryExecutionReady(3), true);
  assert.equal(exports_.paperRetryExecutionReady(4), true);
  assert.equal(exports_.paperRetryInitialStep("running", true), 3);
  assert.equal(exports_.paperRetryInitialStep("completed", true), 4);
  assert.equal(exports_.paperRetryInitialStep(null, false), 1);
  assert.equal(
    exports_.paperRetryRunJustCompleted("running", "completed"),
    true,
  );
  assert.equal(
    exports_.paperRetryRunJustCompleted("failed", "completed"),
    true,
  );
  assert.equal(
    exports_.paperRetryRunJustCompleted("completed", "completed"),
    false,
  );
  assert.equal(
    exports_.paperRetryRunJustCompleted("completed", "running"),
    false,
  );
});

test("실행 비교는 같은 저장 계획·기준·과제의 이전 실행만 나란히 연결한다", () => {
  const run = (
    id,
    source,
    planHash = "plan-a",
    targetSet = "revalidation",
  ) => ({
    id,
    source,
    planHash,
    frameId: "frame-a",
    targetSet,
    status: "completed",
    startedAt: 1,
    startSequence: null,
    commands: [],
    observations: [],
  });
  const pair = exports_.paperComparableRunPair(
    [
      run("old-other-plan", "dt", "plan-old"),
      run("dt-current-plan", "dt"),
      run("old-other-target", "hardware", "plan-a", "initial"),
    ],
    run("hardware-current-plan", "hardware"),
    "plan-a",
    "frame-a",
    "revalidation",
  );
  assert.equal(pair.previous?.id, "dt-current-plan");
  assert.equal(pair.current?.id, "hardware-current-plan");

  const mismatched = exports_.paperComparableRunPair(
    [run("old", "dt")],
    run("new-plan", "hardware", "plan-b"),
    "plan-b",
    "frame-a",
    "revalidation",
  );
  assert.equal(mismatched.previous, null);
  assert.equal(mismatched.current?.id, "new-plan");
});

test("최종 판단은 유효한 비교 자료에만 열리고, 완료 자료가 있어도 이전 이동으로 돌아갈 수 있다", () => {
  assert.equal(exports_.paperRetryComparisonReady("complete"), true);
  assert.equal(exports_.paperRetryComparisonReady("invalidated"), false);
  assert.equal(exports_.paperRetryComparisonReady(null), false);

  const view = fs.readFileSync(
    path.join(__dirname, "PaperCoordinateStudyView.tsx"),
    "utf8",
  );
  const previous = view.match(
    /const returnToRetryComparison = \(\) => \{([\s\S]*?)\n  \};/,
  )?.[1];
  assert.ok(previous, "실행 비교로 돌아가는 동작이 있어야 합니다.");
  assert.match(previous, /setFlowGuidance/);
  assert.match(previous, /data-testid="revalidation-comparison-step"/);
  assert.doesNotMatch(
    previous,
    /onFinalizeRevalidation|onRunDT|onRunPhysical|setFinalDecisionReason|onModelDecisionReasonChange|upsert|persistDraft/,
  );
  const reasonInput = view.match(
    /aria-label="재검증 판단 근거"([\s\S]*?)\/>/,
  )?.[1];
  assert.ok(reasonInput, "최종 판단 근거 입력란이 있어야 합니다.");
  assert.match(reasonInput, /value=\{finalDecisionReason\}/);
  assert.match(reasonInput, /setFinalDecisionReason\(event\.target\.value\)/);
  assert.match(
    view,
    /state\.run\?\.status === "completed"[\s\S]*paperRetryComparisonReady\(state\.diagnosis\?\.status\)/,
  );
  const study = fs.readFileSync(
    path.join(__dirname, "PaperCoordinateStudy.tsx"),
    "utf8",
  );
  const finalizer = study.match(
    /onFinalizeRevalidation: \(decision, reason\) => \{([\s\S]*?)\n    \},/,
  )?.[1];
  assert.ok(finalizer, "최종 판단 저장 핸들러가 있어야 합니다.");
  assert.match(finalizer, /latest\.diagnosis\?\.status !== "complete"/);
});

test("간략화된 실행·비교와 수정·재확인 화면에 실행 조작과 동일 계획 결과 비교가 노출된다", () => {
  const view = fs.readFileSync(
    path.join(__dirname, "PaperCoordinateStudyView.tsx"),
    "utf8",
  );
  assert.match(
    view,
    /const renderExecutionControls = \(retryExecution = false\) =>/,
  );
  assert.match(view, /data-testid="paper-execution-controls"/);
  assert.match(view, /onClick=\{actions\.onRunDT\}/);
  assert.match(view, /onClick=\{actions\.onRunPhysical\}/);
  const dtButton = view
    .match(/data-testid="paper-run-dt"[\s\S]*?<\/button>/)?.[0]
    .replace(/\s+/g, " ");
  const physicalButton = view
    .match(/data-testid="paper-run-physical"[\s\S]*?<\/button>/)?.[0]
    .replace(/\s+/g, " ");
  assert.match(
    dtButton,
    /disabled=\{state\.running \|\| !state\.runAvailable\}/,
  );
  assert.match(
    physicalButton,
    /disabled=\{state\.running \|\| dtOnly \|\| !state\.physicalAvailable\}/,
  );
  assert.match(
    view,
    /renderExecutionControls\(state\.targetSet === "revalidation"\)[\s\S]*renderStage\(4\)[\s\S]*renderStage\(5\)[\s\S]*renderStage\(6\)/,
  );
  const retryScreen = view.match(
    /const renderRetryScreen = \(\) => \(\s*<>[\s\S]*?<\/>\s*\);/,
  )?.[0];
  assert.ok(retryScreen, "수정 후 재확인 화면이 있어야 합니다.");
  assert.match(retryScreen, /\{renderExecutionControls\(true\)\}/);
  const retryControlsIndex = retryScreen.indexOf("{renderExecutionControls(");
  const retryComparisonIndex = retryScreen.indexOf(
    'data-testid="revalidation-comparison-step"',
  );
  assert.ok(retryControlsIndex >= 0, "③ 화면에 재실행 패널이 있어야 합니다.");
  assert.ok(
    retryComparisonIndex >= 0 && retryControlsIndex < retryComparisonIndex,
    "재실행 패널은 ③ 화면의 재실행 비교 영역 앞에 항상 표시되어야 합니다.",
  );
  assert.match(
    view,
    /data-retry-execution=\{retryExecution \? "true" : undefined\}/,
  );
  assert.match(
    view,
    /retryExecution \? "수정한 계획 다시 실행" : "저장된 계획 실행"/,
  );
  assert.match(view, /retryExecution\s*\?\s*"DT로 다시 확인"/);
  assert.match(view, /retryExecution\s*\?\s*"실장비로 다시 확인"/);
  assert.match(view, /: "DT에서 확인"/);
  assert.match(view, /: "실장비에서 확인"/);
  assert.match(view, /모의 브리지에서 다시 시험/);
  assert.doesNotMatch(
    retryScreen,
    /guidedRetryStep|renderExecutionControls\(\s*paperRetryExecutionReady/,
  );
  assert.match(view, /actions\.onSaveRetryPlan\(\)/);
  assert.match(view, /수정 모델과 새 예측 저장/);
  assert.match(view, /독립 검증점/);
  assert.match(view, /onClick=\{actions\.onFocusExecutionCriteria\}/);
  assert.match(
    view,
    /paperComparableRunPair\([\s\S]*state\.activeAttempt\?\.runHistory/,
  );
  assert.match(view, /이전 실행[\s\S]*현재 실행/);
  assert.match(view, /DT는 가상 자료/);
  assert.match(view, /실장비 실행 전 확인/);
});

test("세 화면은 한 번의 핵심 저장 동작으로 관계·예측과 실행 자료를 이어준다", () => {
  const view = fs.readFileSync(
    path.join(__dirname, "PaperCoordinateStudyView.tsx"),
    "utf8",
  );
  const firstScreen = view.match(
    /if \(screenIndex === 1\) \{([\s\S]*?)\n    \}\n    if \(screenIndex === 2\)/,
  )?.[1];
  assert.ok(firstScreen, "첫 화면 구성이 있어야 합니다.");
  for (const stage of [1, 2, 3])
    assert.match(firstScreen, new RegExp(`renderStage\\(${stage}\\)`));
  assert.match(firstScreen, /actions\.onSavePlanAndContinue/);
  assert.doesNotMatch(
    firstScreen,
    /advancePredictionGuide|다음: 좌표 관계|관계 저장 후 좌표 예측/,
  );

  const secondScreen = view.match(
    /if \(screenIndex === 2\) \{([\s\S]*?)\n    \}\n    if \(state\.targetSet === "revalidation"\)/,
  )?.[1];
  assert.ok(secondScreen, "둘째 화면 구성이 있어야 합니다.");
  for (const stage of [4, 5, 6])
    assert.match(secondScreen, new RegExp(`renderStage\\(${stage}\\)`));
  assert.match(secondScreen, /actions\.onContinueToRevision/);
  assert.match(secondScreen, /renderExecutionControls/);

  const retryScreen = view.match(
    /const renderRetryScreen = \(\) => \(\s*<>[\s\S]*?<\/>\s*\);/,
  )?.[0];
  assert.ok(retryScreen, "수정 계획이 셋째 화면에 있어야 합니다.");
  assert.match(retryScreen, /renderStage\(2\)[\s\S]*renderStage\(3\)/);
  assert.match(retryScreen, /renderExecutionControls\(true\)/);
  assert.match(retryScreen, /data-testid="revalidation-comparison-step"/);
  assert.match(retryScreen, /최종 판단 저장/);
  assert.match(retryScreen, /DT·모의 실행은 실측이 아닙니다/);

  const criteriaSummary = view.match(
    /className="pcv-student-criteria-summary"([\s\S]*?)<\/section>/,
  )?.[1];
  assert.ok(criteriaSummary, "학생용 확정 기준 요약이 있어야 합니다.");
  assert.match(criteriaSummary, /currentVerificationPoints/);
  assert.match(criteriaSummary, /independentVerificationPoints/);
  assert.match(criteriaSummary, /constructionOverlaps/);
  assert.match(criteriaSummary, /positionToleranceMm/);
  assert.match(criteriaSummary, /rotationToleranceDeg/);
});

test("MG400 손가이딩은 교사 준비의 조건부 안내이며 웹 Unlock 명령이 아니다", () => {
  const view = fs.readFileSync(
    path.join(__dirname, "PaperCoordinateStudyView.tsx"),
    "utf8",
  );
  const guide = view.match(
    /state\.level === "advanced-paper-hardware" && \(\s*<details className="pcv-details pcv-hand-guiding-guide">([\s\S]*?)<\/details>/,
  )?.[1];
  assert.ok(guide, "손가이딩 안내는 실장비 교사 준비 영역에 있어야 합니다.");
  const guideText = guide.replace(/\s+/g, " ");
  assert.match(
    guideText,
    /학생 과제가 아니며 웹이 Unlock을 실행하거나 잠금 상태를 감지하지 않습니다/,
  );
  assert.match(
    guideText,
    /TCP\/IP 외부 제어 모드에서 손가이딩을 사용할 수 있는지 명시하지 않습니다/,
  );
  assert.match(guideText, /설치된 컨트롤러·펌웨어와 맞는 매뉴얼/);
  assert.match(guideText, /새 TCP 보고/);
  assert.match(guideText, /전완부와 장착물을 지지/);
  assert.match(guideText, /Hand-guiding status|손가이딩 종료/);
  assert.match(guideText, /download\.dobot\.cc\/DobotStudio-pro\/20231116/);
  assert.match(
    guideText,
    /dobot\.us\/wp-content\/uploads\/2024\/10\/MG400-QUICKSTART-GUIDE\.pdf/,
  );
  assert.doesNotMatch(guide, /onUnlock|unlockRobot|releaseBrake|sendUnlock/);
});

test("실행 전 기준은 실행 기록이 없어도 현재 시도·기준점·계획에 맞으면 저장됨으로 표시된다", () => {
  const criteria = {
    recordId: "attempt-2",
    frameId: "frame-2",
    planHash: "plan-2",
    positionToleranceMm: 2,
  };
  assert.equal(
    exports_.paperVerificationCriteriaSavedForAttempt(
      criteria,
      "attempt-2",
      "frame-2",
      "plan-2",
      true,
    ),
    true,
  );
  assert.equal(
    exports_.paperVerificationCriteriaSavedForAttempt(
      criteria,
      "attempt-2",
      "frame-2",
      "plan-3",
      true,
    ),
    false,
  );
  assert.equal(
    exports_.paperVerificationCriteriaSavedForAttempt(
      criteria,
      "attempt-2",
      "frame-2",
      "plan-2",
      false,
    ),
    false,
  );
  assert.equal(
    exports_.paperVerificationCriteriaSavedForAttempt(
      criteria,
      "attempt-other",
      "frame-2",
      "plan-2",
      true,
    ),
    false,
  );
});
