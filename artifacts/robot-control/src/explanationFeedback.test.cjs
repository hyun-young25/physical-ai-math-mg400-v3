const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  ts = require("typescript");
function load(file, deps = {}) {
  deps = { ...require("./learningTestAdapter.cjs"), ...deps };
  const exports = {};
  new Function(
    "exports",
    "require",
    ts.transpileModule(fs.readFileSync(path.join(__dirname, file), "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
  )(exports, (n) => {
    assert.ok(n in deps, n);
    return deps[n];
  });
  return exports;
}
const engine = load("explanationFeedback.ts");
const inquiry = load("MathInquiry.tsx", {
  "./LearningJudgment": load("LearningJudgment.tsx", { "react/jsx-runtime": {} }),
  "./ExplanationFeedbackPanel": {},
  "./explanationFeedback": engine,
  "./curriculum": load("curriculum.ts"),
  "./learningFramework": load("learningFramework.ts"),
  "./inquiryFeedback": load("inquiryFeedback.ts"),
  "./learningEvidenceStorage": load("learningEvidenceStorage.ts"),
  react: {},
  "react/jsx-runtime": {},
});
const height = (start = 45, answer = "15") => ({
  condition: {
    reasoning: { kind: "difference", start, target: 60, key: "delta" },
  },
  fields: [{ key: "delta", label: "상승량", unit: "mm" }],
  answers: { delta: answer },
  expected: { delta: 60 - start },
});
const assess = (text, context = height()) =>
  engine.assessExplanation(text, context);
const row = (result, key) => result.criteria.find((c) => c.key === key);
test("equivalent formulas, Unicode operators and Korean subtraction receive task-specific feedback", () => {
  for (const text of [
    "출발 45 mm, 목표 60 mm이므로 ΔZ=60-45=15 mm이다.",
    "15 mm = 60 − 45",
    "60에서 45를 빼면 15 mm이다.",
    "상승량 = 목표 - 출발 = 15 mm",
    "60 mm - 45 mm = 15 mm",
  ]) {
    const r = assess(text);
    assert.equal(r.verdict, "confirmed", text);
    assert.equal(r.provider, "rule-based");
    assert.equal(r.scope, "task-math");
  }
});
test("a correct numeric answer cannot conceal addition, reversed subtraction or false arithmetic", () => {
  for (const text of ["ΔZ=60+45=15 mm", "ΔZ=45-60=15 mm", "60-45=10 mm"])
    assert.equal(assess(text).verdict, "revise", text);
  const sum = assess("ΔZ=60+45=15 mm");
  assert.equal(row(sum, "relation").state, "error");
  assert.equal(row(sum, "calculation").state, "error");
});
test("wrong start/goal roles and prose/numeric contradictions are retained with evidence", () => {
  const a = assess("출발 60 mm, 목표 45 mm이므로 60-45=15 mm");
  assert.equal(row(a, "reference").state, "error");
  const b = assess("ΔZ=60-45=15 mm", height(45, "60"));
  assert.equal(row(b, "consistency").state, "error");
  assert.match(row(b, "consistency").evidence[0], /60-45/);
});
test("unsupported reasoning, keywords and empty text never become correct", () => {
  for (const text of ["", "그냥 찍었다", "목표 출발 관계식 단위 15 mm"])
    assert.notEqual(assess(text).verdict, "confirmed", text);
  assert.equal(row(assess("60-45=15"), "unit").state, "context");
  assert.equal(assess("60-45=15").verdict, "confirmed");
});
test("past mistakes or negation are not graded as current incorrect claims", () => {
  const corrected = assess(
    "처음에는 45-60=-15 mm라고 생각했다. 현재는 ΔZ=60-45=15 mm이다.",
  );
  assert.equal(corrected.verdict, "confirmed");
  for (const text of ["60+45=15 mm는 틀렸다.", "60-45=15 mm가 아니다."])
    assert.notEqual(assess(text).verdict, "confirmed");
});
test("alternative units and unsupported long arguments are deferred, not falsely accepted", () => {
  for (const t of ["ΔZ=60-45=15 cm", "15 mm=1.5 cm"])
    assert.ok(["review", "elaborate"].includes(assess(t).verdict));
  assert.equal(assess("가".repeat(4001)).verdict, "review");
});
test("distance requires squared components and a square root, including negative displacements", () => {
  for (const [delta, answer, text] of [
    [[30, 40, 0], 50, "거리=√(30²+40²)=50 mm"],
    [[-60, 80, 0], 100, "거리=sqrt((-60)^2+80^2)=100 mm"],
  ]) {
    const c = {
      condition: { reasoning: { kind: "distance", delta, key: "distance" } },
      fields: [{ key: "distance", unit: "mm" }],
      answers: { distance: String(answer) },
      expected: { distance: answer },
    };
    assert.equal(assess(text, c).verdict, "confirmed");
    const sum = delta[0] + delta[1];
    assert.equal(
      assess(`${delta[0]}+${delta[1]}=${sum} mm`, c).verdict,
      "revise",
    );
    assert.equal(
      assess("꺾인 경로는 30+40=70 mm이다. 거리=√(30²+40²)=50 mm", {
        ...c,
        condition: {
          reasoning: { kind: "distance", delta: [30, 40, 0], key: "distance" },
        },
        answers: { distance: "50" },
        expected: { distance: 50 },
      }).verdict,
      "confirmed",
    );
  }
});
test("projection binds horizontal/cos and vertical/sin and uses degrees", () => {
  for (const [angle, h, v] of [
    [30, 86.6, 50],
    [60, 50, 86.6],
  ]) {
    const c = {
      condition: {
        reasoning: {
          kind: "projection",
          length: 100,
          angle,
          horizontal: "horizontal",
          vertical: "vertical",
        },
      },
      fields: [
        { key: "horizontal", unit: "mm" },
        { key: "vertical", unit: "mm" },
      ],
      answers: { horizontal: String(h), vertical: String(v) },
      expected: { horizontal: h, vertical: v },
    };
    assert.equal(
      assess(
        `수평=100*cos(${angle})=${h} mm\n높이=100*sin(${angle})=${v} mm`,
        c,
      ).verdict,
      "confirmed",
    );
    assert.equal(
      assess(
        `수평=100*sin(${angle})=${v} mm\n높이=100*cos(${angle})=${h} mm`,
        c,
      ).verdict,
      "revise",
    );
  }
});
test("a generic lesson only confirms arithmetic, never whole free-form semantics", () => {
  const r = assess("1+1=2 mm. 관측을 비교했다.", {
    condition: {},
    fields: [],
    answers: {},
    expected: {},
  });
  assert.equal(r.scope, "arithmetic-only");
  assert.notEqual(r.verdict, "confirmed");
  assert.equal(row(r, "calculation").state, "confirmed");
  assert.equal(row(r, "meaning").state, "review");
});
test("restricted expression parser rejects code, invalid domains and expensive nesting", () => {
  for (const text of [
    "globalThis.pwned=1",
    'constructor.constructor("return process")()',
    "1/0",
    "sqrt(-1)",
    "(".repeat(50) + "1" + ")".repeat(50),
    "9^9999",
    "sin(30);alert(1)",
  ])
    assert.equal(engine.mathExpression(text), null, text);
  assert.equal(engine.mathExpression("-2^2").value, -4);
  assert.equal(engine.mathExpression("(-2)^2").value, 4);
  assert.ok(
    Math.abs(engine.mathExpression("100*cos30").value - 86.60254) < 0.001,
  );
  assert.equal(globalThis.pwned, undefined);
  assert.notEqual(assess("ΔZ=60-45=15 mm. 1//2=3").verdict, "confirmed");
});
test("later text edits, answer reviews or new runs invalidate a prior explanation result", () => {
  const record = {
    ...height(),
    prediction: { delta: "15" },
    runs: [{ action: "math", status: "completed", expected: { delta: 15 } }],
    reflections: [],
  };
  const text = "ΔZ=60-45=15 mm",
    assessment = assess(text);
  record.reflections.push({
    text,
    at: "a",
    runCount: 1,
    review: "teacher",
    assessment,
    answers: { delta: "15" },
  });
  assert.equal(inquiry.explanationReviewed(record, text), true);
  assert.equal(inquiry.explanationReviewed(record, text + "?"), false);
  record.answerReviews = [{ answers: { delta: "15.01" }, runCount: 1 }];
  assert.equal(inquiry.explanationReviewed(record, text), false);
  record.answerReviews = [];
  record.runs.push({ action: "math", status: "stopped" });
  assert.equal(inquiry.explanationReviewed(record, text), false);
});
test("an explicit teacher-review request preserves an unresolved assessment without relabelling it correct", () => {
  const text = "상승량=60+45=15 mm",
    assessment = assess(text),
    record = {
      ...height(),
      prediction: { delta: "15" },
      runs: [{}],
      reflections: [
        { text, runCount: 1, assessment, answers: { delta: "15" } },
      ],
    };
  assert.equal(inquiry.explanationReviewed(record, text), false);
  record.reflections.push({
    ...record.reflections[0],
    teacherReviewRequested: true,
  });
  assert.equal(inquiry.explanationReviewed(record, text), true);
  assert.equal(record.reflections[1].assessment.verdict, "revise");
});

test("long malformed input is bounded and cannot hang the feedback UI", () => {
  const before = Date.now();
  for (const t of [
    "1".repeat(3900),
    "(".repeat(3900),
    "1+".repeat(1900) + "=2",
    "x".repeat(3800) + "=15",
    "sin(".repeat(300) + "1",
  ])
    assert.notEqual(assess(t).verdict, "confirmed");
  assert.ok(Date.now() - before < 1000);
});

test("brief prose, omitted repeated units and alternative equations use problem plus numeric context", () => {
  for (const text of [
    "목표 높이에서 현재 높이를 빼면 15가 나오기 때문입니다.",
    "현재 높이를 목표 높이에서 빼서 구했어요.",
    "목표에서 출발을 빼면 된다",
    "두 높이의 차이를 구했어요.",
    "60-45=15",
    "60-45",
    "15 = 60 − 45",
    "45+15=60",
    "60=45+15",
  ]) {
    const r = assess(text);
    assert.equal(r.verdict, "confirmed", text);
    assert.equal(r.version, "math-explanation-v2");
    assert.ok(!r.criteria.some((c) => c.state === "missing"));
    assert.equal(r.feedback.question, undefined);
  }
  const r = assess("목표 높이에서 현재 높이를 빼면 15가 나옵니다.");
  for (const k of ["reference", "calculation", "unit"])
    assert.equal(row(r, k).state, "context", k);
  assert.notEqual(
    assess("목표에서 현재 높이를 뺐어요.", height(45, "60")).verdict,
    "confirmed",
  );
});

test("a correct numeric answer completes a natural from-to motion explanation", () => {
  for (const text of [
    "20에서 60으로 이동했으므로",
    "현재 20 mm에서 목표 60 mm로 옮겼기 때문에 상승량은 40입니다.",
    "20부터 60까지 올라갔어요.",
  ]) {
    const r = assess(text, {
      ...height(20, "40"),
      condition: {
        id: "height-practice",
        reasoning: { kind: "difference", start: 20, target: 60, key: "delta" },
      },
    });
    assert.equal(r.verdict, "confirmed", text);
    assert.equal(row(r, "relation").state, "confirmed");
  }
  assert.notEqual(
    assess("20에서 60으로 이동했으므로", height(20, "15")).verdict,
    "confirmed",
  );
});
test("natural from-to prose exposes wrong reference values instead of deferring", () => {
  const wrongStart = assess("200에서 60으로 40만큼 증가", {
    ...height(20, "40"),
    condition: {
      id: "height-practice",
      reasoning: { kind: "difference", start: 20, target: 60, key: "delta" },
    },
  });
  assert.equal(wrongStart.verdict, "revise");
  assert.equal(row(wrongStart, "relation").state, "error");
  assert.match(wrongStart.feedback.message, /200에서 60/);
  assert.match(wrongStart.feedback.message, /20에서 60/);
  const wrongAmount = assess("20에서 60으로 30만큼 증가", {
    ...height(20, "40"),
    condition: {
      id: "height-practice",
      reasoning: { kind: "difference", start: 20, target: 60, key: "delta" },
    },
  });
  assert.equal(wrongAmount.verdict, "revise");
  assert.equal(row(wrongAmount, "relation").state, "error");
  assert.match(wrongAmount.feedback.message, /30 mm/);
});

test("flexible phrasing does not excuse explicit contradictions or later errors", () => {
  for (const text of [
    "현재 높이에서 목표 높이를 빼면 15가 나옵니다.",
    "목표 높이에서 현재 높이를 빼면 20가 나옵니다.",
    "목표에서 현재를 빼서 구했어요. 상승량은 20입니다.",
    "목표에서 현재를 뺍니다. 현재에서 목표를 뺍니다.",
    "목표에서 현재를 뺐어요. 2+2=5",
  ])
    assert.equal(assess(text).verdict, "revise", text);
  assert.equal(
    assess("목표에서 현재를 뺐어요. 1+1=2").verdict,
    "confirmed",
    "unrelated correct arithmetic is not a task conclusion",
  );
  for (const text of [
    "목표에서 현재를 빼는 것이 아니다.",
    "목표에서 현재를 빼면 될까요?",
    "목표에서 현재를 빼면 15 cm이다.",
  ])
    assert.notEqual(assess(text).verdict, "confirmed", text);
});

const distanceContext = (independent = false, purpose = "prediction") => ({
  condition: {
    id: independent ? "distance-transfer" : "distance-practice",
    reasoning: {
      kind: "distance",
      delta: independent ? [-60, 80, 0] : [30, 40, 0],
      key: "distance",
    },
  },
  fields: [{ key: "distance", unit: "mm" }],
  answers: { distance: independent ? "100" : "50" },
  expected: { distance: independent ? 100 : 50 },
  purpose,
});
const projectionContext = (independent = false, purpose = "prediction") => ({
  condition: {
    id: independent ? "projection-transfer" : "projection-practice",
    reasoning: {
      kind: "projection",
      length: 100,
      angle: independent ? 60 : 30,
      horizontal: "h",
      vertical: "v",
    },
  },
  fields: [
    { key: "h", unit: "mm" },
    { key: "v", unit: "mm" },
  ],
  answers: { h: independent ? "50" : "86.6", v: independent ? "86.6" : "50" },
  expected: { h: independent ? 50 : 86.6, v: independent ? 86.6 : 50 },
  purpose,
});
test("distance and projection explanations need not repeat all given numbers", () => {
  for (const t of [
    "피타고라스 정리를 적용했습니다.",
    "각 축의 변화량을 제곱해서 더한 뒤 루트를 구했어요.",
    "√(30²+40²)",
  ])
    assert.equal(assess(t, distanceContext()).verdict, "confirmed", t);
  for (const t of [
    "수평에는 cos, 높이에는 sin을 사용했어요.",
    "수평은 코사인, 높이는 사인을 곱했습니다.",
  ])
    assert.equal(assess(t, projectionContext()).verdict, "confirmed", t);
  assert.equal(
    assess("수평은 사인, 높이는 코사인을 사용했습니다.", projectionContext())
      .verdict,
    "revise",
  );
});

test("reflection feedback follows the interpretation question, without requiring the calculation again", () => {
  const c = height();
  c.purpose = "reflection";
  c.condition.id = "height-transfer";
  const cases = [
    ["출발 높이가 높아져서 남은 상승량이 줄었습니다.", c],
    [
      "두 축을 따라 꺾어 가는 길보다 직선거리가 짧아요.",
      distanceContext(false, "reflection"),
    ],
    [
      "음수를 제곱하면 양수가 되어서 거리도 양수입니다.",
      distanceContext(true, "reflection"),
    ],
    [
      "링크가 빗변이라서 수평과 높이 성분이 더 짧아요.",
      projectionContext(false, "reflection"),
    ],
    [
      "수평 성분은 줄고 높이는 커집니다.",
      projectionContext(true, "reflection"),
    ],
  ];
  for (const [t, context] of cases)
    assert.equal(assess(t, context).verdict, "confirmed", t);
  assert.notEqual(
    assess("수평 성분은 줄고 높이는 커집니다.", projectionContext()).verdict,
    "confirmed",
    "comparison depends on the actual question",
  );
});

test("unrecognized prose remains unresolved and can continue without a teacher-request click", () => {
  for (const text of [
    "목적지까지 모자란 만큼 올려 주었어요.",
    "잘 모르겠어요.",
  ]) {
    const assessment = assess(text),
      record = {
        ...height(),
        prediction: { delta: "15" },
        runs: [{}],
        reflections: [
          {
            text,
            runCount: 1,
            assessment,
            unresolved: true,
            answers: { delta: "15" },
          },
        ],
      };
    assert.ok(["review", "elaborate"].includes(assessment.verdict));
    assert.equal(inquiry.explanationReviewed(record, text), true);
    assert.equal(record.reflections[0].teacherReviewRequested, undefined);
    assert.equal(record.reflections[0].unresolved, true);
    assert.equal(typeof assessment.feedback.question, "string");
    assert.equal((assessment.feedback.question.match(/\?/g) || []).length, 1);
    assert.equal(inquiry.explanationReviewed(record, text + " 변경"), false);
    const legacy = {
      ...record,
      reflections: [
        {
          ...record.reflections[0],
          assessment: { ...assessment, version: "math-explanation-v1" },
        },
      ],
    };
    assert.equal(
      inquiry.explanationReviewed(legacy, text),
      false,
      "old result is not silently regraded",
    );
  }
});
