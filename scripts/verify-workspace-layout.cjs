// Real application, isolated student storage/HTTP and browser-only protocol mock.
// No physical bridge sockets or learning-server writes.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { installMockBridge } = require("./mg400-mock-socket.cjs");
const URL = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/` : "http://localhost:80/";
let browser;
(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || "/repl/tools/bin/chromium",
    args: ["--disable-webgl", "--disable-gpu"] });
  const context = await browser.newContext({ viewport: { width: 1904, height: 913 } });
  const mock = await installMockBridge(context);
  await context.route("**/api/learning/**", route => {
    const path = new globalThis.URL(route.request().url()).pathname;
    const body = path.endsWith("/student/enter")
      ? { user: { id: "layout-test-only", role: "student", login: "layout-test-only", visitId: "layout-isolated" } }
      : path.endsWith("/records") ? { acknowledged: route.request().postDataJSON().events.map(e => e.eventId) } : {};
    return route.fulfill({ json: body });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const id = name => page.getByTestId(name);
  const panel = () => page.getByRole("region", { name: "실습 설정", exact: true });
  const passed = [];
  async function navigate(name) {
    const nav = page.getByRole("navigation", { name: "학습 목차" });
    // The closed drawer remains mounted offscreen; isVisible() alone is insufficient.
    if (await nav.evaluate(e => e.getBoundingClientRect().right <= 1))
      await page.getByRole("button", { name: "☰", exact: true }).click();
    await nav.getByRole("button", { name, exact: false }).click();
  }
  async function geometry() {
    return page.evaluate(() => {
      const rect = selector => {
        const el = document.querySelector(selector), r = el?.getBoundingClientRect();
        return r ? { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
          clientWidth: el.clientWidth, scrollWidth: el.scrollWidth } : null;
      };
      return { scene: rect(".curriculum-scene"), lesson: rect(".curriculum-panel") || rect(".foundation-panel"),
        settings: rect(".practice-settings-host"), workspace: rect(".learning-workspace") };
    });
  }
  const overlaps = (a, b) => a.x < b.right - 1 && a.right > b.x + 1 && a.y < b.bottom - 1 && a.bottom > b.y + 1;
  async function checkLayout(width) {
    const g = await geometry();
    assert(g.scene.width >= Math.min(width, 300), JSON.stringify(g));
    assert(g.lesson.width >= Math.min(width, 300), JSON.stringify(g));
    assert(!overlaps(g.scene, g.lesson), JSON.stringify(g));
    assert(!overlaps(g.lesson, g.settings), JSON.stringify(g));
    assert(!overlaps(g.scene, g.settings), JSON.stringify(g));
    assert(g.settings.scrollWidth <= g.settings.clientWidth + 1, JSON.stringify(g));
    assert.equal(await panel().evaluate(e => e.scrollWidth <= e.clientWidth + 1), true);
    assert.equal(await page.locator(".workspace-layout").evaluate(e => e.scrollWidth <= e.clientWidth + 1), true);
    // Programmatically scroll each action into view, then verify its horizontal reachability.
    for (const container of [panel(), page.locator(".curriculum-panel, .foundation-panel")]) {
      // Read a single DOM snapshot: telemetry may insert/remove an error-dismiss
      // button while an indexed locator is awaiting the next animation frame.
      const unreachable = await container.evaluate(root => [...root.querySelectorAll("button")].flatMap(button => {
        if (!button.checkVisibility() || button.closest("details:not([open])")) return [];
        button.scrollIntoView({ block: "nearest", inline: "nearest" });
        const r = button.getBoundingClientRect();
        return r.x < -1 || r.right > innerWidth + 1 || r.y < -1 || r.bottom > innerHeight + 1
          ? [{ text: button.textContent, x: r.x, y: r.y, right: r.right, bottom: r.bottom }] : [];
      }));
      assert.deepEqual(unreachable, []);
    }
    await page.locator(".workspace-layout").evaluate(e => { e.scrollTop = 0; });
  }
  await page.goto(URL);
  await page.getByLabel("학생 아이디", { exact: true }).fill("layout-test-only");
  await page.getByRole("button", { name: "학습 시작", exact: true }).click();
  await navigate("좌표축과 이동 방향");
  const wideClosed = (await geometry()).workspace.width;
  await id("button-mode-hardware").click();
  await id("button-practice-panel").click();
  await checkLayout(1904);
  assert(wideClosed - (await geometry()).workspace.width >= 370);
  const lessonScroll = page.locator(".lesson-scroll");
  await panel().evaluate(e => { e.scrollTop = 75; });
  await lessonScroll.evaluate(e => { e.scrollTop = 120; });
  assert.equal(await panel().evaluate(e => e.scrollTop), 75);
  await panel().evaluate(e => { e.scrollTop = 0; });
  assert.equal(await lessonScroll.evaluate(e => e.scrollTop), 120);
  await lessonScroll.evaluate(e => { e.scrollTop = 0; });
  await page.locator(".pr-panel").evaluate(e => { e.scrollTop = 0; });
  await page.screenshot({ path: "/tmp/mg400-workspace-wide.png" });
  assert.equal(mock.requests.length, 0);
  await id("button-bridge-connect").click(); // Intercepted inside the browser only.
  await id("button-bridge-disconnect").waitFor();
  const setupSpeed = panel().getByText("속도 %", { exact: true }).locator("input");
  await setupSpeed.fill("12");
  for (const flag of ["firmware", "network", "coordinates", "tool", "io", "workspace"])
    await id(`check-${flag}`).check();
  await id("button-apply-setup").click();
  await id("button-confirm-ok").click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="button-servo-on"]')?.disabled);
  // One mock servo operation creates a journal entry without a motion command.
  await id("button-servo-on").click();
  await id("button-confirm-ok").click();
  await id("list-journal").waitFor();
  const journal = await id("list-journal").innerText();
  // Pending uploads are asynchronously acknowledged; compare durable lesson records only.
  const durableRecords = () => page.evaluate(() => JSON.stringify(Object.fromEntries(
    Object.entries(localStorage).filter(([key]) => key.startsWith("mg400:visit:")))));
  const stored = await durableRecords();
  const poseInput = panel().locator('input[type="number"]').last();
  await poseInput.fill("19");
  await id("button-practice-close").click();
  assert((await geometry()).workspace.width >= wideClosed - 1);
  await id("button-practice-panel").click();
  assert.equal(await poseInput.inputValue(), "19");
  assert.equal(await setupSpeed.inputValue(), "12");
  assert.equal(await id("list-journal").innerText(), journal);
  assert.equal(await id("input-robot-ip").inputValue(), "192.168.1.6");
  passed.push("1904×913: three separate columns, closing restores learning width; no automatic connection");

  // Preserve this actual lesson DOM and its draft through toggles and breakpoints.
  const draft = page.getByLabel("예상 변화량 X", { exact: true });
  if (await draft.count()) await draft.fill("37");
  const choice = page.locator(".curriculum-panel").getByRole("radio").first();
  await choice.check();
  await page.locator(".curriculum-panel").evaluate(e => { window.__layoutLesson = e; });
  const requestsBeforeResize = mock.requests.length;
  for (const [width, height] of [[1440, 900], [1280, 900], [900, 700], [768, 1024], [390, 844], [360, 740], [844, 390], [1904, 913]]) {
    await page.setViewportSize({ width, height });
    await checkLayout(width);
    await id("button-practice-close").scrollIntoViewIfNeeded();
    await id("button-practice-close").click();
    await id("button-practice-panel").click();
    assert.equal(await page.locator(".curriculum-panel").evaluate(e => window.__layoutLesson === e), true);
    assert.equal(await setupSpeed.inputValue(), "12");
    assert.equal(await poseInput.inputValue(), "19");
    assert.equal(await id("check-workspace").isChecked(), true);
    assert.equal(await id("list-journal").innerText(), journal);
    assert.equal(await id("button-servo-on").isDisabled(), true);
    assert.equal(await id("button-servo-off").isEnabled(), true);
    if (await draft.count()) assert.equal(await draft.inputValue(), "37");
    assert.equal(await choice.isChecked(), true);
    if (width === 390) {
      await page.locator(".workspace-layout").evaluate(e => { e.scrollTop = 0; });
      await page.screenshot({ path: "/tmp/mg400-workspace-mobile.png" });
    }
  }
  assert.equal(mock.requests.length, requestsBeforeResize);
  assert.equal(await durableRecords(), stored);
  passed.push("8 desktop/tablet/phone/landscape sizes: accessible actions, connection/setup/journal/drafts and lesson DOM retained");
  for (const name of ["용어·기호와 기초수학", "절대좌표·상대좌표와 변화량", "MoveJ·MoveL 비교", "도형 경로 만들기", "순기구학(FK)", "역기구학(IK)", "운동학 종합과제"]) {
    await navigate(name);
    for (const [width, height] of [[1904, 913], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await checkLayout(width);
    }
    passed.push(`${name}: no overlap at desktop and phone sizes`);
  }
  // This layout runner deliberately disables WebGL. Process-cell lessons still
  // attempt a canvas before using their fallback; only that exact error is expected.
  assert.deepEqual(errors.filter(message => message !== "Error creating WebGL context."), []);
  assert.equal(mock.requests.filter(r => r.type === "execute" && r.operation.kind === "move").length, 0);
  assert.equal(mock.requests.filter(r => r.type === "connect").length, 1);
  console.log(JSON.stringify({ passed, mockOperations: mock.requests.map(r => r.type === "execute" ? r.operation.kind : r.type),
    expectedWebGLUnavailable: errors.length, realRobotSockets: 0, learningServerWrites: 0 }, null, 2));
  await browser.close();
})().catch(async error => { console.error(error); if (browser) await browser.close(); process.exitCode = 1; });
