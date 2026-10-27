/* Optional browser regression: REPLIT_DEV_DOMAIN=... node .../pickPlaceChapter.browser.cjs */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
function load(name, deps = {}) {
  const exports = {};
  new Function("exports", "require", ts.transpileModule(fs.readFileSync(path.join(__dirname, name), "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)
    (exports, name => deps[name]);
  return exports;
}
const curriculum = load("curriculum.ts");
const core = load("pickPlaceCore.ts", { "./curriculum": curriculum });
const KEY = "physical-ai-pickplace-design-v1";
const errors = [];
const successful = [];
let browser;
async function check(name, fn) { await fn(); successful.push(name); console.log("PASS", name); }
function plan(level, variant = 0, relative = false) {
  const s = core.designScenario(level, variant), z = s.minimumTravelZ + 15;
  let from = s.robots[0].start;
  return { z, steps: core.DESIGN_ROLES.map((role, i) => {
    const target = core.designGoal(s, role.role, z) ?? { ...s.destination, z };
    const values = relative ? curriculum.poseDifference(from, target) : target;
    from = target;
    return { ...role, target, values, mode: relative ? "relative" : "absolute", motion: i ? "MoveL" : "MoveJ" };
  }) };
}
async function enterChapter(page) {
  await page.goto(`https://${process.env.REPLIT_DEV_DOMAIN}/`, { waitUntil: "domcontentloaded" });
  console.log("loaded app");
  const menu = page.getByRole("button", { name: /4\..*픽앤플레이스/ });
  await page.getByRole("button", { name: "☰", exact: true }).click();
  await menu.click();
  await page.locator(".pick-place-chapter[data-stage=task]").waitFor();
  console.log("entered chapter");
}
async function inputPlan(page, level, variant = 0, relative = false, edit) {
  const f = plan(level, variant, relative), panel = page.locator(".pick-place-chapter");
  await panel.getByRole("button", { name: "관계 정하기", exact: true }).click();
  const choices = ["B=A+Δ", "TCP=top", "travelZ>=min", "XY constant"];
  for (let i = 0; i < 4; i++) await panel.locator(".pp-field select").nth(i).selectOption(choices[i]);
  await panel.getByLabel("운반 Z (mm)").fill(String(f.z));
  await panel.getByRole("button", { name: "동작 계획으로", exact: true }).click();
  if (level === 3) for (const step of f.steps) await panel.getByLabel("역할 추가").selectOption(step.role);
  for (let i = 0; i < f.steps.length; i++) {
    const card = panel.locator(".pp-cmd").nth(i), step = f.steps[i];
    if (step.action === "move") {
      await card.locator("select").nth(0).selectOption(step.mode);
      await card.locator("select").nth(1).selectOption(step.motion);
    }
    const numbers = step.action === "move" ? [...Object.values(step.values).slice(0, 3),
      step.target.x, step.target.y, step.target.z] : [step.target.x, step.target.y, step.target.z];
    // Use explicit coordinates rather than relying on object key order.
    if (step.action === "move") numbers.splice(0, 3, step.values.x, step.values.y, step.values.z);
    for (let j = 0; j < numbers.length; j++) await card.locator("input").nth(j).fill(String(numbers[j]));
  }
  if (edit) await edit(panel);
  await panel.getByLabel("예측 이유", { exact: true }).fill("도착점은 출발점에 변화량을 더하고, 접촉 높이와 운반 높이를 구분하여 예측했다.");
  await panel.getByRole("button", { name: "실행 단계로", exact: true }).click();
  return f;
}
async function run(page) {
  const panel = page.locator(".pick-place-chapter");
  const start = panel.getByRole("button", { name: "실행 시작", exact: true });
  await start.waitFor();
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll(".pick-place-chapter button")].find(b => b.textContent === "실행 시작");
    return b && !b.disabled;
  }, { timeout: 30000 });
  await start.click();
  await page.locator(".pick-place-chapter[data-stage=observation]").waitFor({ timeout: 30000 });
}
async function compare(page) {
  const panel = page.locator(".pick-place-chapter");
  await panel.getByLabel("관찰한 점", { exact: true }).fill("TCP가 각 작업점에 도착했고 물체가 집기 후 붙었다가 놓기 후 분리되는 것을 관찰했다.");
  await panel.getByRole("button", { name: "관찰 저장", exact: true }).click();
  await panel.getByRole("button", { name: "비교로", exact: true }).click();
  await panel.getByLabel("설명 (교사가 확인합니다)", { exact: true }).fill("목표·명령·관찰 TCP를 비교했고, 높이와 이동량의 관계로 차이를 설명했다.");
  await panel.getByRole("button", { name: "설명 저장", exact: true }).click();
}
async function records(page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key) || "[]"), KEY); }

(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium",
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(20000);
  page.on("pageerror", e => { errors.push(e.message); console.error("PAGEERROR", e.message); });
  await enterChapter(page);
  await check("4장 메뉴는 단일 MG400 설계이고 확장 공정은 잠김", async () => {
    assert.equal(await page.locator(".pp-ext").count(), 0);
    await page.getByRole("button", { name: "전체 작업", exact: true }).waitFor();
    await page.waitForFunction(() => {
      const c = document.querySelector(".pick-place-chapter-scene canvas");
      return c && c.width > 0;
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "/tmp/chapter4-desktop.png" });
  });
  if (process.env.SMOKE_ONLY) return;
  await inputPlan(page, 1, 0, false, async panel => {
    // A wrong predicted value, not a substituted actual command.
    await panel.locator(".pp-cmd").nth(4).locator("input").nth(5).fill("999");
  });
  await run(page); await compare(page);
  await check("이송 성공과 잘못된 예측을 분리", async () => {
    const r = (await records(page)).at(-1);
    assert.equal(r.result.finished, true); assert.equal(r.result.passed, false);
    assert.equal(r.teacherReview.status, "pending");
  });
  await page.getByRole("button", { name: "수정으로", exact: true }).click();
  await page.getByLabel("수정 이유", { exact: true }).fill("수평 이송에서 Z가 유지되어야 하므로 예상 Z만 운반 높이로 고친다.");
  await page.getByRole("button", { name: "수정해서 다시 시도", exact: true }).click();
  await page.locator(".pp-cmd").nth(4).locator("input").nth(5).fill(String(plan(1).z));
  await page.getByLabel("예측 이유", { exact: true }).fill("수평 이송의 Z는 운반 높이를 유지하고 X·Y만 달라진다.");
  await page.getByRole("button", { name: "실행 단계로", exact: true }).click();
  await run(page); await compare(page);
  await check("필요한 관계만 수정해 재실행하고 원시 답안 보존", async () => {
    const [first, second] = await records(page);
    assert.equal(first.commands[4].expectedZ, "999");
    assert.equal(second.revisionOf, first.id);
    assert.equal(second.result.passed, true);
    for (const o of second.observations) {
      const at = second.frames.findLast(f => f.atMs <= o.atMs);
      assert.equal(at.atMs, o.atMs, "row inspection needs an exact boundary frame");
      assert.deepEqual(at.robots.A.pose, o.actual);
    }
  });
  await page.getByRole("button", { name: "다음 레벨", exact: true }).click();
  await inputPlan(page, 2, 0, true); await run(page); await compare(page);
  await page.getByRole("button", { name: "다음 레벨", exact: true }).click();
  await check("직접 설계는 빈 계획에서 시작", async () => {
    await page.locator(".pick-place-chapter[data-stage=task]").waitFor();
    assert.equal(await page.locator(".pp-ext").count(), 0);
  });
  await inputPlan(page, 3); await run(page); await compare(page);
  await check("전체 설계 완료 후에만 접이식 확장 공정 제공", async () => {
    await page.locator(".pp-ext > summary").waitFor();
    assert.equal(await page.locator(".pp-ext-body").count(), 0);
    await page.locator(".pp-ext > summary").click();
    await page.locator(".pp-ext-body .process-lesson").waitFor();
    assert.equal(await page.locator(".pp-ext-body .process-levels button").count(), 4);
    await page.locator(".pp-ext > summary").click();
    await page.locator(".pp-ext-body").waitFor({ state: "detached" });
  });
  await page.getByRole("button", { name: "바뀐 조건에 도전", exact: true }).click();
  await check("새 조건은 힌트·완성 좌표 없이 새 계획", async () => {
    await page.locator(".pick-place-chapter[data-stage=task]").waitFor();
    assert.equal(await page.locator(".pp-card.hint").count(), 0);
    assert.ok((await page.locator(".pick-place-chapter").innerText()).includes("바뀐 조건"));
  });
  await inputPlan(page, 3, 1, true); await run(page); await compare(page);
  await check("내보내기는 DT 출처와 수정 이력을 보존", async () => {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "학습 기록 내보내기", exact: true }).click();
    const downloaded = await downloadPromise;
    const exported = JSON.parse(fs.readFileSync(await downloaded.path(), "utf8"));
    assert.ok(exported.records.every(r => r.source === "dt" && r.teacherReview.status === "pending"));
    assert.ok(exported.records.some(r => r.revisionOf));
  });
  for (const viewport of [{ width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await check(`4장 반응형 ${viewport.width}×${viewport.height}`, async () => {
      const bounds = await page.locator(".pick-place-chapter-layout").boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1);
      const panel = await page.locator(".pick-place-chapter").boundingBox();
      assert.ok(panel.width > 250);
      await page.screenshot({ path: `/tmp/chapter4-${viewport.width}.png` });
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "과제 초기화", exact: true }).click();
  await inputPlan(page, 3, 1); // current variant remains 1
  await page.getByRole("button", { name: "실행 시작", exact: true }).click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "중지", exact: true }).click();
  await check("정지는 재생된 부분만 기록", async () => {
    const r = (await records(page)).at(-1);
    assert.equal(r.status, "stopped"); assert.equal(r.result, undefined);
    assert.ok(r.frames.at(-1).atMs < 7500);
  });
  await page.getByRole("button", { name: "과제 초기화", exact: true }).click();
  await inputPlan(page, 3, 1);
  await page.getByRole("button", { name: "실행 시작", exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "초기값", exact: true }).click();
  await page.waitForTimeout(1800);
  await check("HOME 이후 이전 애니메이션은 새 상태를 덮어쓰지 않음", async () => {
    await page.locator(".pick-place-chapter[data-stage=task]").waitFor();
    const r = (await records(page)).at(-1); assert.equal(r.status, "stopped");
  });
  await inputPlan(page, 3, 1);
  await page.getByRole("button", { name: "실행 시작", exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "☰", exact: true }).click();
  await page.getByRole("button", { name: "홈", exact: true }).click();
  await page.waitForTimeout(1000);
  await check("목차 이동은 실행 중단 기록을 남김", async () => {
    assert.equal(await page.locator(".pick-place-chapter").count(), 0);
    assert.equal((await records(page)).at(-1).status, "stopped");
  });
  await page.getByRole("button", { name: "☰", exact: true }).click();
  await page.getByRole("button", { name: /4\..*픽앤플레이스/ }).click();
  await inputPlan(page, 1);
  await page.getByRole("button", { name: "실행 시작", exact: true }).click();
  await page.waitForTimeout(500);
  const sent = [];
  // In-memory bridge mock only: never connect to or command a physical device.
  await page.routeWebSocket(/ws:\/\/127\.0\.0\.1:8765/, socket => {
    socket.onMessage(message => sent.push(JSON.parse(String(message))));
  });
  await page.getByRole("button", { name: "실장비 연결", exact: true }).click();
  await page.getByLabel("IP 주소", { exact: true }).fill("127.0.0.1");
  await page.getByLabel("포트", { exact: true }).fill("8765");
  await page.getByRole("button", { name: "연결", exact: true }).click();
  await page.waitForTimeout(1000);
  await check("연결 시작 시 DT 중단·판정 없음, 로봇 이동 명령 없음", async () => {
    const r = (await records(page)).at(-1);
    assert.equal(r.status, "stopped"); assert.equal(r.result, undefined);
    assert.ok((await page.locator(".pick-place-chapter").innerText()).includes("가상 실행이 잠겼습니다"));
    assert.ok(sent.every(message => message.type === "connect"));
  });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ successful, pageErrors: errors }, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { await browser?.close(); });