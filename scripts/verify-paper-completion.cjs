// Verifies the full production-built student UI with explicitly synthetic services.
// Student entry, record acknowledgements, and AI responses are local test doubles;
// every lesson, input, DT run, revision control and comparison is the real built app.
// No robot WebSocket or motion command is used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const origin = "http://localhost";
const recordVideo = process.env.PAPER_RECORD === "1";
const webgl = process.env.PAPER_RENDERING !== "svg";
const { install } = require("./paper-demo-runtime.cjs");
const evidenceDir = path.resolve(process.env.PAPER_STUDENT_FLOW_EVIDENCE_DIR
  || path.resolve(__dirname, `../generated-artifacts/paper-completion-${Date.now()}`));
const firstMock = "모의 규칙 응답: P3의 목표 X 290 mm와 예측·DT 실행 X 310 mm가 다릅니다. 원점 180 mm와 종이 x=11 cm를 식에 어떻게 대입했나요?";
const secondMock = "모의 규칙 응답: 이전 질문 뒤 P3의 X를 290 mm로 수정했습니다. 새 DT 결과와 고친 대입식을 비교해 보세요.";
const requests = [];
const errors = [];
const networkFailures = [];
fs.mkdirSync(evidenceDir, { recursive: true });

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: webgl ? ["--no-sandbox", "--single-process", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--in-process-gpu"] : ["--disable-webgl", "--disable-gpu"],
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    ...(recordVideo ? { recordVideo: { dir: evidenceDir, size: { width: 1600, height: 900 } } } : {}),
  });
  const syncedEvents = await install(context);
  // Explicitly synthetic feedback; the app itself sanitizes and links the requests.
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
    const recording = page.video();
    const pause = ms => recordVideo ? page.waitForTimeout(ms) : Promise.resolve();
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
    await page.addStyleTag({ content: "html, body, * { scroll-behavior: auto !important; }" });
    if (process.env.PAPER_FONT_CSS) await page.addStyleTag({content:fs.readFileSync(process.env.PAPER_FONT_CSS,"utf8")});
    await page.getByLabel("학생 아이디").fill(`demo-paper-flow-${Date.now()}`);
    await page.getByRole("button", { name: "학습 시작", exact: true }).click({ noWaitAfter: true });
    await page.locator(".learning-student-bar").waitFor();
    assert.deepEqual(entryResponses, [200], "synthetic student entry must succeed");
    console.log("PASS student entry (synthetic service)");
    await pause(4_000);
    // Redact the synthetic test login from evidence screenshots only.
    await page.addStyleTag({ content: ".learning-student-bar > strong { filter: blur(5px); }" });

    const introClose = page.getByRole("button", { name: "×", exact: true });
    if (await introClose.count()) await introClose.first().click({ noWaitAfter: true });
    const lessonNav = page.getByRole("navigation", { name: "학습 목차" });
    if ((await lessonNav.evaluate(element => element.getBoundingClientRect().x)) < 0) {
      await page.getByRole("button", { name: "학습 목차 열기/닫기", exact: true }).click({ noWaitAfter: true });
    }
    await lessonNav.getByRole("button", { name: /2-4.*도형 경로 만들기/ }).click({ noWaitAfter: true });
    await page.getByText("2-4. 도형 경로 만들기", { exact: true }).waitFor();
    await pause(300);
    await page.getByRole("button", { name: "5. 종이 기준점 (DT)", exact: true }).click({ noWaitAfter: true });

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
    const stage = async number => {
      await view.getByText(`단계 ${number} / 7`, { exact: false }).waitFor();
    };
    const shot = async filename => { if (process.env.PAPER_SCREENSHOTS !== "0") await page.screenshot({path:path.join(evidenceDir, filename), timeout:60_000}); };

    assert.match(await view.innerText(), /DT 전용/);
    assert.match(await view.innerText(), /실측 아님/);
    await shot("01-paper-student-entry.png");

    // Step 2: student's own model explanation. It deliberately includes a
    // synthetic name marker to prove PII redaction without dropping the formula.
    await click("다음 단계");
    await stage(2);
    await view.getByLabel("원점 X (mm)", { exact: true }).fill("180");
    await view.getByLabel("원점 Y (mm)", { exact: true }).fill("-60");
    await view.getByLabel("1 cm당 길이 (mm)", { exact: true }).fill("10");
    await view.getByLabel(/이 관계를 선택한 이유/)
      .fill("이름: 홍길동, P3의 X=180+10×11을 계산해 310 mm라고 예측했어요.");
    await click("관계 저장");
    await click("다음 단계");
    await stage(3);

    const points = [[180, -60], [290, -60], [290, 90], [180, 90]];
    await view.getByLabel("직선 경로 명령").selectOption("MoveL");
    await view.getByLabel("닫힌 경로 ΔX 합", { exact: true }).fill("0");
    await view.getByLabel("닫힌 경로 ΔY 합", { exact: true }).fill("0");
    for (const [index, [x, y]] of points.entries()) {
      const point = index + 1;
      await view.getByLabel(`P${point} 예측 로봇 X · mm`, { exact: true }).fill(String(x + (point === 3 ? 20 : 0)));
      await view.getByLabel(`P${point} 예측 로봇 Y · mm`, { exact: true }).fill(String(y));
    }
    await click("예측 저장");
    await shot("03-student-prediction.png");
    await pause(4_000);
    await click("다음 단계");
    await stage(4);
    assert.match(await view.innerText(), /DT · 실측 아님|가상 DT/);
    await view.getByRole("button", { name: "실행 전 기준 저장으로", exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "실행 전 검증 기준");
    await view.getByLabel("허용오차를 선택한 근거", { exact: true }).fill("시연용 가상 DT에서 사전에 정한 위치·방향 허용 범위입니다.");
    await click("이 시도의 실행 전 기준 저장");
    await view.getByText(/저장된 기준: 위치 ±/, { exact: false }).waitFor();
    assert.equal(await view.getByText("실행 전 검증 기준과 독립 검증점을 저장해야 DT 실행이 열립니다.", { exact: true }).count(), 0);
    await click("DT에서 확인");
    await pause(2_000);
    await page.waitForFunction(() => {
      const key = Object.keys(localStorage).find(value => value.endsWith("physical-ai-paper-coordinate-v1"));
      const rows = key ? JSON.parse(localStorage.getItem(key) || "[]") : [];
      return rows.at(-1)?.run?.status === "completed";
    }, null, { timeout: 60_000 });
    const firstAfterRun = (await records())[0];
    assert.equal(firstAfterRun.run.source, "dt");
    assert.equal(firstAfterRun.run.status, "completed");
    const previewLabel = page.getByTestId("paper-preview-label");
    if (webgl) { await previewLabel.waitFor({timeout:15_000}); assert.match(await previewLabel.innerText(), /파란 고스트 · DT · 실측 아님/); }
    await shot("04-blue-ghost-dt.png");
    await pause(5_000);
    console.log("PASS first DT run and blue ghost");

    await click("다음 단계");
    await stage(5);
    await click("다음 단계");
    await stage(6);
    const first = (await records())[0];
    assert.equal(first.diagnosis.pattern, "calculation");
    assert.match(first.transform.explanation, /X=180\+10×11/);
    assert.match(first.transform.explanation, /이름: 홍길동/);
    assert.match(await page.locator(".square-type-badge").innerText(), /대입·계산 차이 · P3/);
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
    await pause(5_000);
    console.log("PASS first mocked feedback displayed, saved, and request sanitized");

    await click("다음 단계");
    const navigationGuidance = view.locator(".pcv-navigation-guidance");
    await navigationGuidance.getByText(/원인 가설을 입력하고.*생각 저장/).waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "차이가 생긴 이유");
    console.log("PASS stage 7 explains and focuses the unsaved hypothesis instead of silently blocking");

    const causeInput = view.getByTestId("paper-diagnosis-visual")
      .getByRole("textbox", { name: "차이가 생긴 이유", exact: true });
    await causeInput.waitFor({ state: "visible" });
    await causeInput
      .fill("P3의 X 계산에서 11 cm × 10 mm/cm를 110 mm로 계산해 원점 180 mm에 더해야 한다는 점을 다시 확인하겠습니다.");
    console.log("PASS student hypothesis entered through visible UI");
    await click("생각 저장");
    await click("다음 단계");
    await stage(7);
    const longRevisionReason = `이메일: qa-private@example.com; P3의 좌표 계산을 다시 확인합니다. 종이 x좌표 11 cm와 1 cm당 10 mm를 곱해 110 mm를 얻고, 원점 X 180 mm에 더합니다. 따라서 P3의 X 예측을 310 mm에서 290 mm로 수정합니다. ${"이 식의 각 항과 단위를 다시 대입해 확인합니다. ".repeat(18)}`;
    await view.getByLabel("무엇을 다시 살펴볼까요?", { exact: true })
      .fill(longRevisionReason);
    await click("이유와 수정 기록");
    await view.getByTestId("paper-retry-note").waitFor();
    console.log("PASS revision reason saved and linked retry created");
    await pause(4_000);
    let all = await records();
    assert.equal(all.length, 2);
    const parentAfterReason = all[0], child = all[1];
    assert.equal(child.parentAttemptId, parentAfterReason.id);
    assert.equal(child.run, undefined, "a revision starts without an old run");
    assert.equal(child.transform.explanation, parentAfterReason.transform.explanation);

    // The new attempt carries the old plan, but the student edits the reasoning
    // and the P3 prediction before its independent DT run.
    await click("이전");
    await stage(2);
    console.log("PASS retry returned to model stage");
    await view.getByLabel(/이 관계를 선택한 이유/)
      .fill("P3의 X=180+10×11=290 mm로 다시 계산했습니다. 11 cm×10 mm/cm=110 mm입니다.");
    console.log("PASS retry model explanation changed through visible UI");
    await click("관계 저장");
    await click("다음 단계");
    await stage(3);
    await view.getByLabel("P3 예측 로봇 X · mm", { exact: true }).fill("290");
    await click("예측 저장");
    await click("다음 단계");
    await stage(4);
    await click("DT에서 확인");
    await pause(2_000);
    await page.waitForFunction(() => {
      const key = Object.keys(localStorage).find(value => value.endsWith("physical-ai-paper-coordinate-v1"));
      const rows = key ? JSON.parse(localStorage.getItem(key) || "[]") : [];
      return rows.at(-1)?.run?.status === "completed";
    }, null, { timeout: 60_000 });
    await click("다음 단계");
    await stage(5);
    await click("다음 단계");
    await stage(6);
    console.log("PASS corrected prediction rerun in DT");
    assert.match(await page.locator(".square-type-badge").innerText(), /예측과 실행 일치/);
    all = await records();
    assert.equal(all[0].id, parentAfterReason.id);
    assert.equal(all[0].run.id, first.run.id);
    assert.equal(all[1].parentAttemptId, all[0].id);
    assert.equal(all[1].run.source, "dt");
    assert.equal(all[1].diagnosis.pattern, "match");
    assert.match(all[1].transform.explanation, /290 mm/);
    await shot("06-rerun-match.png");
    await pause(4_000);

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
    await pause(5_000);

    const comparison = page.getByTestId("revision-scene-dock");
    await comparison.getByRole("button", { name: /4.*재실행 결과/ }).click({ noWaitAfter: true });
    await comparison.waitFor();
    assert.match(await comparison.innerText(), /첫 실행/);
    assert.match(await comparison.innerText(), /수정 후 실행/);
    await shot("08-linked-comparison.png");
    await pause(8_000);
    assert.deepEqual(errors, [], "no browser runtime errors");
    assert.deepEqual(networkFailures, [], "no failed browser requests");
    const report = {
      sourceCommit: require("node:child_process").execFileSync("git",["rev-parse","HEAD"],{cwd:path.resolve(__dirname,"..")} ).toString().trim(),
      testEnvironment: "production-built UI; synthetic student, storage acknowledgements and AI response; no physical robot",
      syncedEventCount: syncedEvents.length,
      renderer: webgl ? "webgl" : "svg",
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
    await page.close();
    await context.close();
    if (recording) console.log("Recorded browser video:", await recording.path());
  } finally {
    for (const page of context.pages()) await page.close().catch(()=>{});
    await context.close().catch(()=>{});
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
