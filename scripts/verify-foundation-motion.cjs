// Runs the real app with isolated storage, mocked learning HTTP responses, and
// Playwright's in-browser MG400 protocol mock. Never connects to a robot/PC.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { installMockBridge } = require('./mg400-mock-socket.cjs');
const URL = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/` : 'http://localhost:80/';
const KEY = 'physical-ai-inquiry-evidence-v1';
let browser;
const passed = [];
(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || '/repl/tools/bin/chromium',
    args: ['--disable-webgl', '--disable-gpu'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const mock = await installMockBridge(context);
  const uploads = [];
  await context.route('**/api/learning/**', route => {
    const req = route.request(), path = new globalThis.URL(req.url()).pathname;
    let data = {};
    if (path.endsWith('/student/enter')) data = { user: {
      id: 'foundation-test-only', role: 'student', login: 'foundation-test-only',
      visitId: 'foundation-isolated-visit',
    }};
    if (path.endsWith('/records')) {
      const body = req.postDataJSON(); uploads.push(...body.events);
      data = { acknowledged: body.events.map(e => e.eventId) };
    }
    return route.fulfill({ json: data });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const id = name => page.getByTestId(name);
  const lesson = () => page.locator('.math-start-lesson');
  const final = () => lesson().getByRole('region', { name: '최종 정답 확인과 로봇 이동' });
  const move = () => final().getByRole('button');
  const status = () => final().getByRole('status');
  const executes = () => mock.requests.filter(r => r.type === 'execute');
  const moves = () => executes().filter(r => r.operation.kind === 'move');
  const records = () => page.evaluate(key => JSON.parse(
    localStorage.getItem(`mg400:visit:foundation-isolated-visit:${key}`) || '[]'), KEY);
  const latest = async () => (await records()).filter(r => r.task === 'foundation').at(-1);
  async function waitStatus(text) { await status().filter({ hasText: text }).waitFor(); }
  async function noDialog() { assert.equal(await page.locator('.pr-modal').count(), 0); }
  async function applySetup() {
    await id('button-practice-panel').click();
    for (const flag of ['firmware', 'network', 'coordinates', 'tool', 'io', 'workspace'])
      await id('check-' + flag).check();
    await id('button-apply-setup').click();
    await id('button-confirm-ok').click();
    await page.waitForFunction(() => !document.querySelector('[data-testid=button-servo-on]')?.disabled);
    await id('button-practice-panel').click();
  }
  async function publish(patch) {
    Object.assign(mock.measurement, patch); mock.publish();
    await page.waitForTimeout(120); // allow the app to receive the mock packet
  }
  await page.goto(URL);
  await page.getByLabel('학생 아이디', { exact: true }).fill('foundation-test-only');
  await page.getByRole('button', { name: '학습 시작', exact: true }).click();
  await id('button-mode-virtual').waitFor();
  await page.getByText('☰', { exact: true }).click();
  await page.getByRole('navigation', { name: '학습 목차' }).getByRole('button', { name: /용어·기호와 기초수학/ }).click();
  await lesson().waitFor();

  // Guided stage checking grades only. Wrong field gets a specific hint.
  await lesson().getByLabel('① 목표 절대좌표 Z', { exact: true }).fill('20');
  await lesson().getByRole('button', { name: '답 확인 · 다음 힌트 보기 →', exact: true }).click();
  assert.equal(await lesson().getByLabel('① 목표 절대좌표 Z', { exact: true }).getAttribute('aria-invalid'), 'true');
  assert.ok((await lesson().innerText()).includes('목표 절대좌표는 도착 높이'));
  assert.equal(mock.requests.length, 0);
  assert.equal(await final().count(), 0);
  await lesson().getByLabel('① 목표 절대좌표 Z', { exact: true }).fill('60');
  await lesson().getByRole('button', { name: '답 확인 · 다음 힌트 보기 →', exact: true }).click();
  for (const [label, value] of [['② X축 변화량 ΔX', '0'], ['③ Y축 변화량 ΔY', '0'], ['④ Z축 변화량 ΔZ', '40']])
    await lesson().getByLabel(label, { exact: true }).fill(value);
  await lesson().getByRole('button', { name: '답 확인 · 다음 힌트 보기 →', exact: true }).click();
  await lesson().getByLabel('⑤ 이동 명령', { exact: true }).selectOption('MoveL');
  await lesson().getByRole('button', { name: '답 확인 · 다음 힌트 보기 →', exact: true }).click();
  const reason = '목표 Z=60에서 현재 Z=20을 빼면 ΔZ=40이다. X·Y와 방향은 유지하고 수직 직선이므로 MoveL을 사용한다.';
  await lesson().getByLabel('예측 근거', { exact: true }).fill(reason);
  await lesson().getByRole('button', { name: '답 확인 · 다음 힌트 보기 →', exact: true }).click();
  assert.equal(await final().count(), 0);
  await lesson().getByRole('button', { name: '예측·근거 저장', exact: true }).click();
  await final().waitFor();
  const original = await latest();
  assert.equal(original.reason, reason);
  assert.deepEqual(original.runs, []);
  assert.equal(mock.requests.length, 0);
  passed.push('guided grading and prediction save issue no commands; wrong item has its hint');

  // This calls the real App.tsx virtual motion/IK path.
  await move().click();
  await waitStatus('가상 로봇이 목표 위치에 도달');
  const virtual = await latest();
  assert.equal(virtual.id, original.id);
  assert.equal(virtual.runs.length, 1);
  assert.equal(virtual.runs[0].detail.motion.source, 'virtual');
  assert.equal(virtual.runs[0].detail.motion.target.z, 60);
  assert.equal(mock.requests.length, 0);
  passed.push('correct virtual execution through real App callback');

  // Completed virtual work stays executable using the same saved answers.
  await id('button-mode-hardware').click();
  assert.match(await move().innerText(), /같은 답으로 실제 로봇 이동/);
  assert.equal(await move().isEnabled(), true);
  assert.equal(mock.requests.length, 0);
  await move().click(); await waitStatus('로봇 옆 PC에 연결'); await noDialog();
  assert.equal(moves().length, 0);
  await id('button-practice-panel').click();
  assert.equal(await id('input-robot-ip').inputValue(), '192.168.1.6');
  await id('button-bridge-connect').click();
  await page.getByText('모의 통신 · 실측 아님', { exact: true }).first().waitFor();
  await id('button-practice-panel').click();
  await move().click(); await waitStatus('준비 설정'); await noDialog();
  await applySetup();
  await move().click(); await waitStatus('서보'); await noDialog();
  await id('button-practice-panel').click();
  await id('button-servo-on').click(); await id('button-confirm-ok').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid=button-servo-off]')?.disabled);
  await id('button-practice-panel').click();
  assert.deepEqual(executes().map(r => r.operation.kind), ['enable']);
  await move().click(); await waitStatus('출발 위치가 문제 조건과 다릅니다'); await noDialog();
  assert.match(await status().innerText(), /Z=20 mm \(현재 300\.00\)/);
  assert.equal(moves().length, 0);
  passed.push('virtual completion can request hardware; connection/setup/servo/start failures appear beside button');

  // Only mock packet data are repositioned; no positioning commands are sent.
  await publish({ pose: { x: 270, y: -75, z: 20, r: 12 } });
  mock.pause = true;
  await page.waitForTimeout(1750);
  await move().click(); await waitStatus('측정값이 없거나 오래'); await noDialog();
  mock.pause = false; mock.publish(); await page.waitForTimeout(120);
  // Workspace restriction remains effective.
  await publish({ pose: { x: 500, y: -75, z: 20, r: 12 } });
  await move().click(); await waitStatus('작업 범위 밖'); await noDialog();
  await publish({ pose: { x: 270, y: -75, z: 20, r: 12 } });
  passed.push('stale measurement and current workspace checks remain in force');

  // Cancel the real provider confirmation, then explicitly approve a retry.
  await id('button-ai-tutor-open').click();
  await move().evaluate(button => { button.click(); button.click(); });
  await page.getByRole('dialog', { name: '모의 통신 실행 확인 — 실장비 아님' }).waitFor();
  assert.equal(await page.locator('.pr-modal').count(), 1);
  assert(await id('panel-ai-tutor').isVisible());
  assert(await id('input-ai-tutor').evaluate(el=>{
    const r=el.getBoundingClientRect();
    return !!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.pr-modal');
  }), 'robot approval must cover even the chat input until approved/cancelled');
  assert.equal(moves().length, 0);
  await id('button-confirm-cancel').click();
  await waitStatus('이동을 취소했습니다');
  assert.equal(moves().length, 0);
  const cancelled = await latest();
  assert.equal(cancelled.runs.at(-1).status, 'stopped');
  assert.deepEqual(cancelled.runs[0], virtual.runs[0]);
  await move().click(); await id('button-confirm-ok').click();
  await waitStatus('모의 통신으로 목표 위치 도달');
  await id('button-ai-tutor-close').click();
  passed.push('open tutor never bypasses the robot confirmation; approval overlay wins hit-testing; double click creates one confirmation; cancel sends no move');
  assert.equal(moves().length, 1);
  assert.deepEqual(moves()[0].operation, { kind: 'move', motion: 'MoveL', target: { x: 270, y: -75, z: 60, r: 12 } });
  const completed = await latest();
  assert.equal(completed.id, original.id);
  assert.equal(completed.submittedAt, original.submittedAt);
  assert.deepEqual(completed.prediction, original.prediction);
  assert.equal(completed.reason, reason);
  assert.deepEqual(completed.runs[0], virtual.runs[0]);
  const mockRun = completed.runs.at(-1);
  assert.equal(mockRun.status, 'completed');
  assert.equal(mockRun.detail.motion.source, 'mock');
  assert.equal(mockRun.detail.motion.measurements[0].source, 'mock');
  assert.equal(completed.runs.filter(r => r.status === 'completed').length, 2);
  assert.ok((await final().innerText()).includes('가상 DT · 실측 아님'));
  assert.ok((await final().innerText()).includes('모의 통신 · 실측 아님'));
  await final().evaluate(element => element.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: '/tmp/foundation-motion-desktop.png' });
  passed.push('cancel sends no move; approved retry preserves XY/R and appends mock outcome to same original record');

  // A second hardware request cannot move from Z=60 without matching start.
  await move().click(); await waitStatus('출발 위치가 문제 조건과 다릅니다');
  assert.equal(moves().length, 1);
  // Position changes DURING confirmation must also be rejected before execute.
  await publish({ pose: { x: 270, y: -75, z: 20, r: 12 } });
  await move().click();
  await publish({ pose: { x: 272, y: -75, z: 20, r: 12 } });
  await id('button-confirm-ok').click();
  await waitStatus('실행 확인 중 현재 위치가 바뀌었습니다');
  assert.equal(moves().length, 1);
  passed.push('post-completion start and confirmation-time position guards still block commands');
  await publish({ pose: { x: 270, y: -75, z: 20, r: 12 } });
  await move().click();
  await page.getByRole('dialog').waitFor();
  // The modal blocks pointer interaction with mode controls. Dispatch the mode
  // event directly to exercise cancellation if an external state change occurs.
  await id('button-mode-virtual').evaluate(button => button.click());
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(key => {
    const rows = JSON.parse(localStorage.getItem(`mg400:visit:foundation-isolated-visit:${key}`) || '[]');
    return rows.find(r => r.task === 'foundation')?.runs.at(-1)?.status === 'stopped';
  }, KEY);
  await id('button-mode-hardware').click();
  assert.equal(moves().length, 1);
  passed.push('double click opens one confirmation; mode switch cancels pending request without motion');

  // A saved prediction can be edited before final execution; final guard must
  // regrade the saved values, not trust previously green stage indicators.
  await lesson().getByRole('button', { name: '예측을 수정해 다시 확인', exact: true }).click();
  await lesson().getByLabel('④ Z축 변화량 ΔZ', { exact: true }).fill('99');
  await lesson().getByRole('button', { name: '예측·근거 저장', exact: true }).click();
  await move().click();
  await lesson().getByRole('status').filter({ hasText: '입력값 오류' }).first().waitFor();
  assert.equal(moves().length, 1);
  assert.equal(await final().count(), 0);
  const history = await records();
  assert.deepEqual(history.find(r => r.id === original.id).prediction, original.prediction);
  assert.equal(history.find(r => r.id === original.id).reason, reason);
  assert.equal(history.filter(r => r.task === 'foundation').length, 2);
  passed.push('final wrong-answer guard prevents execution and keeps earlier prediction and all runs');

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed, mockOperations: executes().map(r => r.operation.kind),
    realRobotSockets: 0, learningServerWrites: 0, interceptedLearningEvents: uploads.length }, null, 2));
  await browser.close();
})().catch(async error => {
  console.error(error); if (browser) await browser.close(); process.exitCode = 1;
});
