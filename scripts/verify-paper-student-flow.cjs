// Verifies the published student shell against the real Vite preview and API.
// Only the optional GPT response is mocked; the lesson, student entry,
// persistence, DT run, revision controls, and comparison are the real app UI.
// No robot WebSocket or motion command is used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const domain = process.env.REPLIT_DEV_DOMAIN;
if (!domain) throw new Error("REPLIT_DEV_DOMAIN is required for the real student preview.");
const origin = process.env.PAPER_STUDENT_FLOW_URL || `https://${domain}`;
const evidenceDir = path.resolve(process.env.PAPER_STUDENT_FLOW_EVIDENCE_DIR
  || path.resolve(__dirname, "../generated-artifacts/paper-student-flow"));
const firstMock = "모의 규칙 응답: P3의 목표 X 290 mm와 예측·DT 실행 X 310 mm가 다릅니다. 원점 180 mm와 종이 x=11 cm를 식에 어떻게 대입했나요?";
const secondMock = "모의 규칙 응답: 이전 질문 뒤 P3의 X를 290 mm로 수정했습니다. 새 DT 결과와 고친 대입식을 비교해 보세요.";
const requests = [];
const errors = [];
const networkFailures = [];
fs.mkdirSync(evidenceDir, { recursive: true });
for (const file of fs.readdirSync(evidenceDir)) {
  if (file.endsWith(".png") || file.endsWith(".json") || file.endsWith(".webm")) {
    fs.rmSync(path.join(evidenceDir, file), { force: true });
  }
}

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || "/repl/tools/bin/chromium",
    args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  });
  // Keep the real API for student entry and record sync. Stub only the paid GPT
  // endpoint so the visible UI is truthful about its fallback source.
  await context.route("**/api/learning/feedback", async route => {
    const request = route.request().postDataJSON();
    requests.push(request);
    const text = requests.length === 1 ? firstMock : secondMock;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider: "rules",
        status: "limited",
        failureReason: "app_global_limit",
        createdAt: new Date().toISOString(),
        text,
      }),
    });
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error" && !message.text().includes("temporary development")) errors.push(message.text());
    });
    page.on("requestfailed", request => networkFailures.push(`${request.method()} ${new URL(request.url()).pathname}`));
    const entryResponses = [];
    page.on("response", response => {
      if (response.url().includes("/api/learning/student/enter")) entryResponses.push(response.status());
    });

    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.setViewportSize({width:1280,height:720});
    await page.addStyleTag({ content: "html, body, * { scroll-behavior: auto !important; }" });
    await page.getByLabel("학생 아이디").fill(`demo-paper-flow-${Date.now()}`);
    await page.getByRole("button", { name: "학습 시작", exact: true }).click({ noWaitAfter: true });
    await page.locator(".learning-student-bar").waitFor();
    assert.deepEqual(entryResponses, [200], "the real student-entry API must succeed");
    console.log("PASS real student entry");
    await page.waitForTimeout(4_000);
    // Redact the synthetic test login from evidence screenshots only.
    await page.addStyleTag({ content: ".learning-student-bar > strong { filter: blur(5px); }" });

    const introClose = page.getByRole("button", { name: "×", exact: true });
    if (await introClose.count()) await introClose.first().click({ noWaitAfter: true });
    const lessonNav = page.getByRole("navigation", { name: "학습 목차" });
    if ((await lessonNav.evaluate(element => element.getBoundingClientRect().x)) < 0) {
      await page.getByRole("button", { name: "학습 목차 열기/닫기", exact: true }).click({ noWaitAfter: true });
    }
    const paperLesson=lessonNav.getByRole("button", { name: /2-4.*도형 경로 만들기/ });
    await paperLesson.waitFor({state:"visible"});
    await paperLesson.evaluate(element=>element.click());
    await page.getByText("2-4. 도형 경로 만들기", { exact: true }).waitFor();
    await page.waitForTimeout(300);
    const paperTaskButton=page.getByRole("button", { name: "5. 종이 기준점 (DT)", exact: true });
    await paperTaskButton.waitFor({state:"visible"});
    await paperTaskButton.evaluate(element=>element.click());

    const view = page.getByRole("region", { name: "종이 좌표 변환 학습" });
    await view.waitFor();
    console.log("PASS paper task opened through student menu");
    const records = () => page.evaluate(() => {
      const key = Object.keys(localStorage).find(value => value.endsWith("physical-ai-paper-coordinate-v1"));
      return key ? JSON.parse(localStorage.getItem(key) || "[]") : [];
    });
    const attempts = () => page.evaluate(() => {
      const key = Object.keys(localStorage).find(value => value.endsWith("physical-ai-square-attempts-v1"));
      return key ? JSON.parse(localStorage.getItem(key) || "[]") : [];
    });
    const click = async label => {
      const button = view.getByRole("button", { name: label, exact: true });
      await button.waitFor({ state: "visible" });
      await button.evaluate(element => element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
      console.log(`UI click: ${label}`);
      try {
        await button.click({ noWaitAfter: true });
      } catch (error) {
        await page.screenshot({ path: path.join(evidenceDir, `click-failure-${Date.now()}.png`) });
        throw error;
      }
      console.log(`UI clicked: ${label}`);
    };
    const screen = async number => {
      await view.getByText(`화면 ${number} / 3`, { exact: true }).waitFor();
    };
    const assertFlowNavReadable = async () => {
      const items=await view.getByRole("navigation",{name:"종이 좌표 학습 세 화면"})
        .getByRole("listitem").evaluateAll(rows=>rows.map(row=>{
          const title=row.querySelector("strong"),rect=row.getBoundingClientRect(),style=title?getComputedStyle(title):null;
          return {width:rect.width,height:rect.height,wordBreak:style?.wordBreak,overflowWrap:style?.overflowWrap};
        }));
      assert.equal(items.length,3);
      assert.ok(items.every(item=>item.width>=80&&item.height<120),"three screen titles must fit the learning panel without vertical character wrapping");
      assert.ok(items.every(item=>item.wordBreak==="keep-all"&&item.overflowWrap==="normal"));
    };
    const shot = async filename => page.screenshot({ path: path.join(evidenceDir, filename) });
    const prepareCriteria = async () => {
      const details=view.locator(".pcv-teacher-prep--execution");
      if (!(await details.evaluate(element=>element.open))) await details.locator(":scope > summary").click();
      await view.getByLabel("허용오차를 선택한 근거", { exact: true })
        .fill("실행 전 합의한 2 mm 범위로 측정 자료를 비교합니다.");
      await click("이 시도의 실행 전 기준 저장");
    };

    assert.match(await view.innerText(), /DT 전용/);
    assert.match(await view.innerText(), /실측 아님/);
    await screen(1);
    assert.equal(await view.getByRole("navigation", { name: "종이 좌표 학습 세 화면" }).getByRole("listitem").count(), 3);
    await assertFlowNavReadable();
    await page.setViewportSize({width:390,height:844});
    await assertFlowNavReadable();
    await page.setViewportSize({width:1280,height:720});
    assert.equal(await view.getByRole("button", { name: "다음 단계" }).count(), 0,
      "the simplified flow must not require repeated seven-step navigation");
    await shot("01-paper-student-entry.png");

    // Screen 1: student's own model explanation. It deliberately includes a
    // synthetic name marker to prove PII redaction without dropping the formula.
    await view.getByLabel("원점 X (mm)", { exact: true }).fill("180");
    await view.getByLabel("원점 Y (mm)", { exact: true }).fill("-60");
    await view.getByLabel("1 cm당 길이 (mm)", { exact: true }).fill("10");
    await view.getByLabel(/이 관계를 선택한 이유/)
      .fill("이름: 홍길동, P3의 X=180+10×11을 계산해 310 mm라고 예측했어요.");
    assert.equal(await view.getByRole("button", { name: "관계 저장", exact: true }).count(), 0);

    const points = [[180, -60], [290, -60], [290, 90], [180, 90]];
    await view.getByLabel("직선 경로 명령").selectOption("MoveL");
    await view.getByLabel("닫힌 경로 ΔX 합", { exact: true }).fill("0");
    await view.getByLabel("닫힌 경로 ΔY 합", { exact: true }).fill("0");
    for (const [index, [x, y]] of points.entries()) {
      const point = index + 1;
      await view.getByLabel(`P${point} 예측 로봇 X · mm`, { exact: true }).fill(String(x + (point === 3 ? 20 : 0)));
      await view.getByLabel(`P${point} 예측 로봇 Y · mm`, { exact: true }).fill(String(y));
    }
    await click("예측을 저장하고 실행 비교로");
    await shot("03-student-prediction.png");
    await page.waitForTimeout(4_000);
    await screen(2);
    assert.match(await view.innerText(), /DT · 실측 아님|가상 DT/);
    await prepareCriteria();
    await click("DT에서 확인");
    await page.waitForTimeout(2_000);
    await page.waitForFunction(() => {
      const key = Object.keys(localStorage).find(value => value.endsWith("physical-ai-paper-coordinate-v1"));
      const rows = key ? JSON.parse(localStorage.getItem(key) || "[]") : [];
      return rows.at(-1)?.run?.status === "completed";
    }, null, { timeout: 60_000 });
    const firstAfterRun = (await records())[0];
    assert.equal(firstAfterRun.run.source, "dt");
    assert.equal(firstAfterRun.run.status, "completed");
    assert.deepEqual(firstAfterRun.run.verificationCriteria.independentVerificationPoints, ["P2","P3","P4"]);
    assert.deepEqual(firstAfterRun.run.verificationCriteria.constructionOverlaps,
      [{targetPoint:"P1",constructionPoint:"O"}]);
    const previewLabel = page.getByTestId("paper-preview-label");
    await previewLabel.waitFor({ timeout: 15_000 });
    assert.match(await previewLabel.innerText(), /파란 고스트 · DT · 실측 아님/);
    await shot("04-blue-ghost-dt.png");
    await page.waitForTimeout(5_000);
    console.log("PASS first DT run and blue ghost");

    await screen(2);
    const first = (await records())[0];
    assert.equal(first.diagnosis.pattern, "calculation");
    assert.match(first.transform.explanation, /X=180\+10×11/);
    assert.match(first.transform.explanation, /이름: 홍길동/);
    assert.equal(await view.locator(".square-type-badge").count(),1,"the comparison is shown once in the combined execution/comparison screen");
    assert.match(await view.locator(".square-type-badge").innerText(), /대입·계산 차이 · P3/);
    assert.match(await view.getByTestId("paper-diagnosis-visual").innerText(), /P3/);
    console.log("PASS first rule-based diagnosis");

    async function requestMockAnalysis(expectedCount, expectedText) {
      const analysis = view.getByRole("region", { name: "실행자료 AI 분석" });
      await analysis.evaluate(element => element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
      console.log("Analysis panel visible");
      await analysis.getByLabel("분석 방식").selectOption("gpt");
      console.log("Analysis mode selected");
      await click("실행자료를 GPT에 보내 분석");
      const result = analysis.getByTestId("execution-ai-result");
      await result.waitFor();
      assert.match(await result.innerText(), /GPT 분석 미완료/);
      assert.match(await result.innerText(), /아래 내용은 GPT 응답이 아닙니다/);
      assert.match(await result.innerText(), new RegExp(expectedText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      await page.waitForFunction(text => {
        const key = Object.keys(localStorage).find(value => value.endsWith("physical-ai-paper-coordinate-v1"));
        const current = key ? JSON.parse(localStorage.getItem(key) || "[]").at(-1) : null;
        return current?.aiAnalyses?.some(item => item.text === text && item.displayedAt
          && item.recordId === current.id && item.runId === current.run?.id);
      }, expectedText, { timeout: 15_000 });
      assert.equal(requests.length, expectedCount);
      return requests.at(-1);
    }

    const firstRequest = await requestMockAnalysis(1, firstMock);
    const firstCondition = JSON.parse(firstRequest.condition);
    const firstAnswers = JSON.parse(firstRequest.answers);
    const firstExecution = JSON.parse(firstRequest.execution);
    assert.equal(firstCondition.frame.samples.length, 3);
    assert.equal(firstCondition.units.paper, "cm");
    assert.equal(firstCondition.units.robot, "mm");
    assert.equal(firstAnswers.savedStudentTransform.millimetersPerCentimeter, "10");
    assert.match(firstAnswers.savedStudentTransform.explanation, /이름: \[이름 제외\]/);
    assert.match(firstAnswers.savedStudentTransform.explanation, /X=180\+10×11/);
    assert.match(JSON.stringify(firstExecution), /"source":"dt"/);
    assert.match(JSON.stringify(firstExecution), /"status":"completed"/);
    const firstBody = JSON.stringify(firstRequest);
    assert.doesNotMatch(firstBody, /홍길동/);
    const firstEnvelope = JSON.parse(firstRequest.history);
    assert.equal(firstEnvelope.attempts, "[]");
    assert.equal((await records())[0].aiAnalyses.at(-1).provider, "rules");
    await shot("05-mock-feedback.png");
    await page.waitForTimeout(5_000);
    console.log("PASS first mocked feedback displayed, saved, and request sanitized");

    const causeInput = view.getByTestId("paper-diagnosis-visual")
      .getByRole("textbox", { name: "차이가 생긴 이유", exact: true });
    await causeInput.waitFor({ state: "visible" });
    await causeInput
      .fill("P3의 X 계산에서 11 cm × 10 mm/cm를 110 mm로 계산해 원점 180 mm에 더해야 한다는 점을 다시 확인하겠습니다.");
    console.log("PASS student hypothesis entered through visible UI");
    assert.equal(await view.getByRole("button", { name: "생각 저장", exact: true }).count(),0);
    await click("수정하고 다시 확인하기로");
    await screen(3);
    await view.getByLabel("추가 관측과 근거", { exact: true })
      .fill("종이 눈금에서 P3의 11 cm 위치를 다시 확인했습니다.");
    const decisionSelect=view.getByLabel("모델 판단 선택",{exact:true});
    assert.equal(await decisionSelect.count(),1,"screen three exposes one distinctly named model decision control");
    await decisionSelect.selectOption("revise");
    await view.getByLabel("모델 판단 근거", { exact: true })
      .fill("P3 목표와 DT 결과의 차이를 확인하고 단위 환산식을 다시 계산했습니다.");
    const longRevisionReason = `이메일: qa-private@example.com; P3의 좌표 계산을 다시 확인합니다. 종이 x좌표 11 cm와 1 cm당 10 mm를 곱해 110 mm를 얻고, 원점 X 180 mm에 더합니다. 따라서 P3의 X 예측을 310 mm에서 290 mm로 수정합니다. ${"이 식의 각 항과 단위를 다시 대입해 확인합니다. ".repeat(18)}`;
    await view.getByLabel("무엇을 다시 살펴볼까요?", { exact: true })
      .fill(longRevisionReason);
    await click("수정 근거를 저장하고 새 시도 준비");
    console.log("PASS revision reason saved and linked retry created");
    await page.waitForTimeout(4_000);
    let all = await records();
    assert.equal(all.length, 2);
    const parentAfterReason = all[0], child = all[1];
    assert.equal(child.parentAttemptId, parentAfterReason.id);
    assert.equal(child.run, undefined, "a revision starts without an old run");
    assert.equal(child.transform.explanation, parentAfterReason.transform.explanation);

    // The revalidation attempt remains on screen 3; the student edits the
    // mathematical explanation and enters fresh independent predictions.
    await view.getByLabel(/이 관계를 선택한 이유/)
      .fill("P3의 X=180+10×11=290 mm로 다시 계산했습니다. 11 cm×10 mm/cm=110 mm입니다.");
    console.log("PASS retry model explanation changed through visible UI");
    for (const [index, [x, y]] of [[200,-30],[270,-30],[270,60],[200,60]].entries()) {
      const point=index+1;
      await view.getByLabel(`P${point} 예측 로봇 X · mm`, { exact: true }).fill(String(x));
      await view.getByLabel(`P${point} 예측 로봇 Y · mm`, { exact: true }).fill(String(y));
    }
    await click("수정 모델과 새 예측 저장");
    await screen(3);
    assert.equal(await view.getByRole("button", { name: "다음 단계" }).count(),0);
    const plannedChild=(await records())[1];
    assert.equal(plannedChild.verificationCriteria.targetSet,"revalidation");
    assert.deepEqual(plannedChild.verificationCriteria.independentVerificationPoints,["P1","P2","P3","P4"]);
    assert.deepEqual(plannedChild.verificationCriteria.constructionOverlaps,[]);
    await click("DT에서 확인");
    await page.waitForTimeout(2_000);
    await page.waitForFunction(() => {
      const key = Object.keys(localStorage).find(value => value.endsWith("physical-ai-paper-coordinate-v1"));
      const rows = key ? JSON.parse(localStorage.getItem(key) || "[]") : [];
      return rows.at(-1)?.run?.status === "completed";
    }, null, { timeout: 60_000 });
    await screen(3);
    console.log("PASS corrected prediction rerun in DT");
    assert.equal(await view.locator(".square-type-badge").count(),1,"the retry comparison is not duplicated");
    assert.match(await view.locator(".square-type-badge").innerText(), /예측과 실행 일치/);
    all = await records();
    assert.equal(all[0].id, parentAfterReason.id);
    assert.equal(all[0].run.id, first.run.id);
    assert.equal(all[1].parentAttemptId, all[0].id);
    assert.equal(all[1].run.source, "dt");
    assert.equal(all[1].diagnosis.pattern, "match");
    assert.match(all[1].transform.explanation, /290 mm/);
    await shot("06-rerun-match.png");
    await page.waitForTimeout(4_000);

    const secondRequest = await requestMockAnalysis(2, secondMock);
    const secondAnswers = JSON.parse(secondRequest.answers);
    const secondEnvelope = JSON.parse(secondRequest.history);
    const linked = JSON.parse(secondEnvelope.attempts);
    assert.equal(linked.length, 1);
    assert.equal(linked[0].recordId, all[0].id);
    assert.equal(linked[0].previouslyDisplayedFeedback[0].text, firstMock);
    assert.equal(linked[0].previouslyDisplayedFeedback[0].provider, "rules");
    assert.match(linked[0].revisionReason, /P3의 X 예측/);
    assert.match(linked[0].studentHypothesis, /11 cm/);
    assert.match(secondAnswers.savedStudentTransform.explanation, /290 mm/);
    const secondBody = JSON.stringify(secondRequest);
    assert.doesNotMatch(secondBody, /qa-private@example\.com|QA-12345/);
    assert.match(secondBody, /이름: \[이름 제외\]/);
    assert.ok(secondBody.length > 3500, "follow-up history should exercise the long-history path");
    await shot("07-follow-up-history.png");
    await page.waitForTimeout(5_000);

    const comparison=view.getByTestId("paper-diagnosis-visual");
    await comparison.waitFor();
    assert.match(await comparison.innerText(), /✓ 예측과 실행 일치/);
    assert.match(await comparison.innerText(), /P1/);
    const previousAttempt=view.getByRole("region",{name:"이전 시도와 수정 근거"});
    assert.match(await previousAttempt.innerText(),/원점 \(180, -60\) mm/);
    assert.match(await previousAttempt.innerText(),new RegExp(firstMock.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
    assert.match(await previousAttempt.innerText(),/모델 판단: 수정/);
    assert.match(await previousAttempt.innerText(),/P3의 X 예측/);
    const interpretation=view.locator(".pcv-interpretation").last();
    assert.match(await interpretation.innerText(),/비교 자료 준비됨/);
    await interpretation.locator("summary").click({noWaitAfter:true});
    const detailedComparison=await interpretation.innerText();
    assert.match(detailedComparison,/P1/);
    assert.match(detailedComparison,/P4/);
    await shot("08-linked-comparison.png");
    await page.waitForTimeout(8_000);
    const finalDecisionSelect=view.getByLabel("재검증 후 모델 판단",{exact:true});
    assert.equal(await finalDecisionSelect.count(),1,"final revalidation judgment has a distinct accessible name");
    await finalDecisionSelect.selectOption("retain");
    await view.getByLabel("재검증 판단 근거", {exact:true})
      .fill("독립 검증점 네 곳의 새 DT 결과를 원래 시도에서 고정한 2 mm 기준과 비교했습니다. DT이므로 실물 검증은 아닙니다.");
    await click("최종 판단 저장");
    all=await records();
    assert.equal(all[1].revalidation.result,"simulation-only");
    assert.equal(all[1].status,"diagnosed","DT results must not be promoted to physical verification");
    assert.deepEqual(all[1].run.verificationCriteria.independentVerificationPoints,["P1","P2","P3","P4"]);
    assert.deepEqual(all[1].run.verificationCriteria.constructionOverlaps,[]);
    await shot("09-independent-revalidation-judgment.png");
    assert.deepEqual(errors, [], "no browser runtime errors");
    assert.deepEqual(networkFailures, [], "no failed browser requests");
    const report = {
      runSource: "dt",
      physicalRobotCommands: 0,
      aiMode: "mock-rules",
      requestCount: requests.length,
      attempts: all.length,
      diagnosisBefore: all[0].diagnosis.pattern,
      diagnosisAfter: all[1].diagnosis.pattern,
      previousDisplayedFeedbackLinked: linked[0].previouslyDisplayedFeedback[0].text === firstMock,
      screenshots: fs.readdirSync(evidenceDir).filter(file => file.endsWith(".png")),
      errors,
      networkFailures,
    };
    fs.writeFileSync(path.join(evidenceDir, "verification.json"), JSON.stringify(report, null, 2));
    console.log("PASS real student shell end-to-end:", JSON.stringify(report));
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
