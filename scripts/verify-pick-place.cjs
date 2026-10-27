const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(path.join(process.env.PICK_QA_MODULES, 'playwright'));

(async () => {
  const browser = await chromium.launch({ channel: process.env.PICK_QA_BROWSER_CHANNEL || undefined,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(25000);
  page.setDefaultNavigationTimeout(30000);
  const deadline = setTimeout(() => { console.error('Browser verification exceeded seven minutes'); process.exit(1); }, 420000);
  deadline.unref();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const output = process.env.PICK_QA_OUTPUT || 'pick-place-qa';
  fs.mkdirSync(output, { recursive: true });
  try {
    await page.goto('http://127.0.0.1:5184', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '탑뷰', exact: true }).click();
    console.log('PICK_QA_STAGE open-menu');
    await page.getByRole('button', { name: '☰', exact: true }).click();
    await page.getByRole('navigation', { name: '학습 목차', exact: true }).getByRole('button', { name: /운동학 종합과제/ }).click();
    const lesson = page.locator('.process-lesson');
    const levels = [
      { title: '작업대 기본 이송', relation: 'destination', questions: [{ targetX: 300, targetY: 90 }, { travelZ: 300, transferOrder: 1234 }, { approachX: 300, approachY: 90, routeChoice: 1 }] },
      { title: '컨베이어에서 집기', relation: 'position', questions: [{ beltY: -110 }, { travelZ: 300, transferOrder: 1234 }, { approachX: 300, approachY: 90, routeChoice: 1 }] },
      { title: '두 로봇이 이어받기', relation: 'frames', questions: [{ handoffX: 350, handoffY: -40, handoffReady: 2 }] },
      { title: '이송·포장 공정 완성', relation: 'combined', questions: [{ beltY: -110 }, { handoffX: 350, handoffY: -40, handoffReady: 2 }, { columnStep: 40, rowStep: 40, packingX: 260, packingY: 110, packingOrder: 4132 }] },
    ];
    const results = [];
    for (const [index, level] of levels.entries()) {
      console.log('PICK_QA_STAGE level-' + (index + 1) + '-plan');
      if (index === 2) await page.getByRole('button', { name: '프론트뷰', exact: true }).click();
      await lesson.getByRole('navigation', { name: '픽앤플레이스 수업 경로' }).getByRole('button', { name: new RegExp(level.title) }).click();
      if (index === 0 || index >= 2) {
        if (index === 0) await page.setViewportSize({ width: 1280, height: 800 });
        await lesson.evaluate(node => { node.scrollTop = 0; });
        assert.equal(await page.getByRole('group', { name: '공정 보기 범위' }).getByRole('button', { name: index === 3 ? '작업대 보기' : index >= 2 ? '협동 구도' : '전체 공정', exact: true }).getAttribute('aria-pressed'), 'true');
        await page.waitForFunction(() => [...document.querySelectorAll('.process-lesson button')].some(button => button.textContent === '관계부터 생각하기' && !button.disabled));
        if (index === 0) {
          const action = await lesson.getByRole('button', { name: '관계부터 생각하기', exact: true }).boundingBox();
          const panel = await lesson.boundingBox();
          assert.ok(action && panel && action.y + action.height <= panel.y + panel.height, 'first activity must be visible without scrolling at 1280×800');
        }
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 65 });
        fs.writeFileSync(path.join(output, 'level-' + (index + 1) + '-overview.jpg'), screenshot);
        console.log('PICK_SCREENSHOT:level-' + (index + 1) + '-overview:' + screenshot.toString('base64') + ':END_PICK_SCREENSHOT');
        if (index === 0) await page.setViewportSize({ width: 1440, height: 960 });
      }
      await lesson.getByRole('button', { name: '관계부터 생각하기', exact: true }).click();
      await lesson.locator('input[name="process-structure"][value="' + level.relation + '"]').check();
      await lesson.getByRole('button', { name: '관계 확인 · 좌표 예측', exact: true }).click();
      if (index === 2) {
        const scene = page.getByRole('region', { name: '두 로봇이 이어받기 3D 공정' });
        const text = await scene.innerText();
        assert.ok(text.includes('A 원점') && text.includes('B 원점'), 'both reference frames must remain visible');
        assert.ok(!text.includes('선택 지점 ('), 'the B-coordinate question must not reveal its answer');
        await scene.getByRole('button', { name: '좌표계 비교', exact: true }).and(page.locator('[aria-pressed="true"]')).waitFor();
        await page.screenshot({ path: path.join(output, 'level-3-coordinate-frames.png') });
        await scene.getByRole('button', { name: '인계점 확대', exact: true }).click();
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 65 });
        fs.writeFileSync(path.join(output, 'level-3-handoff.jpg'), screenshot);
        console.log('PICK_SCREENSHOT:level-3-handoff:' + screenshot.toString('base64') + ':END_PICK_SCREENSHOT');
        await scene.getByRole('button', { name: '협동 구도', exact: true }).click();
      }
      for (const [q, answers] of level.questions.entries()) {
        for (const [key, value] of Object.entries(answers)) {
          if (key === 'packingOrder') {
            for (const step of String(value)) await lesson.getByRole('button', { name: '칸 ' + step, exact: true }).click();
          } else if (key === 'transferOrder') {
            const actions = { 1: '들어 올리기', 2: '목표 위로 이동', 3: '수직으로 내리기', 4: '블록 놓기' };
            for (const step of String(value)) await lesson.getByRole('button', { name: actions[step], exact: true }).click();
          } else if (['routeChoice', 'handoffReady'].includes(key))
            await lesson.locator('input[name="process-' + key + '"][value="' + value + '"]').check();
          else await lesson.locator('#process-' + key).fill(String(value));
        }
        if (index === 0 && q === 1) {
          const screenshot = await page.screenshot({ type: 'jpeg', quality: 60 });
          fs.writeFileSync(path.join(output, 'level-1-sequence.jpg'), screenshot);
          console.log('PICK_SCREENSHOT:level-1-sequence:' + screenshot.toString('base64') + ':END_PICK_SCREENSHOT');
        }
        if (index === 3 && q === 2) {
          const scene = page.getByRole('region', { name: '이송·포장 공정 완성 3D 공정' });
          assert.equal(await scene.getByRole('button', { name: '포장 확대', exact: true }).getAttribute('aria-pressed'), 'true');
          assert.ok(!(await scene.innerText()).includes('선택 지점 ('), 'do not reveal the fourth coordinate before the first prediction');
          await lesson.evaluate(node => { node.scrollTop = 0; });
          await page.screenshot({ path: path.join(output, 'level-4-packing-input.png') });
          await page.setViewportSize({ width: 390, height: 844 });
          const widths = await lesson.evaluate(node => ({ client: node.clientWidth, scroll: node.scrollWidth }));
          assert.ok(widths.scroll <= widths.client + 2, 'packing fields and selector must fit mobile');
          await page.screenshot({ path: path.join(output, 'level-4-mobile.png'), fullPage: true });
          await page.setViewportSize({ width: 1440, height: 960 });
        }
        if (q === level.questions.length - 1) await lesson.getByLabel('예측 근거', { exact: true }).fill('출발 좌표에 이동량을 더해 목표를 구하고, 들어 올린 뒤 이동해 놓는다.');
        await lesson.getByRole('button', { name: q === level.questions.length - 1 ? '예측 저장 · 전체 계획 보기' : '다음 작업점', exact: true }).click();
      }
      if (index === 3) {
        await lesson.getByRole('button', { name: '칸 4 보기', exact: true }).click();
        assert.ok((await lesson.getByLabel('선택한 포장 칸 비교').innerText()).includes('블록 1'));
        await lesson.evaluate(node => { node.scrollTop = 0; });
        await page.screenshot({ path: path.join(output, 'level-4-packing-plan.png') });
      }
      if (index === 0) {
        await lesson.getByRole('button', { name: 'A 목표 위 접근', exact: true }).click();
        assert.ok((await page.getByRole('region', { name: '작업대 기본 이송 3D 공정' }).innerText()).includes('(300.0, 90.0, 300.0)'));
      }
      if (index === 2) {
        await lesson.getByRole('button', { name: 'B 인계대에서 집기', exact: true }).click();
        assert.ok((await page.getByRole('region', { name: '두 로봇이 이어받기 3D 공정' }).innerText()).includes('(350.0, -40.0, 220.0)'));
      }
      console.log('PICK_QA_STAGE level-' + (index + 1) + '-preview');
      const savedEvidence = () => page.evaluate(() => ({
        records: localStorage.getItem('physical-ai-process-evidence-v1'),
        checkpoint: localStorage.getItem('physical-ai-process-evidence-v1:active-run'),
      }));
      const beforePreview = await savedEvidence();
      const scene = page.getByRole('region', { name: level.title + ' 3D 공정' });
      const preview = lesson.getByRole('group', { name: '예측 움직임 미리보기' });
      assert.ok((await scene.innerText()).includes('화살표는 이동 방향'));
      await preview.getByRole('button', { name: '내 예측 움직임 보기', exact: true }).click();
      await preview.getByRole('button', { name: '미리보기 일시정지', exact: true }).click();
      const stops = preview.getByLabel('미리보기 구간');
      const stop = stops.locator('option').filter({ hasText: index < 2 ? 'P2 · 블록을 들어 올린 순간' : 'B 블록 집기' }).first();
      await stops.selectOption(await stop.getAttribute('value'));
      assert.equal(await lesson.getAttribute('data-process-stage'), '3', 'preview must remain in prediction');
      assert.equal(await lesson.locator('.process-plan tr.is-selected').count(), 0, 'preview must clear the old workpoint highlight');
      assert.ok((await scene.innerText()).includes('예측 TCP'), 'scene must identify predicted movement');
      if (index >= 2) assert.ok((await scene.innerText()).includes('B 경로'), 'both robot routes must be visible');
      const afterPreview = await savedEvidence();
      const beforeRecord = JSON.parse(beforePreview.records).at(-1);
      const { predictionPreview, ...predictionRecord } = JSON.parse(afterPreview.records).at(-1);
      const { predictionPreview: earlierPreview, ...beforePrediction } = beforeRecord;
      assert.deepEqual(predictionRecord, beforePrediction, 'preview must preserve prediction and execution fields');
      assert.ok(predictionPreview.firstViewedAt, 'preview exposure must be recorded separately');
      assert.equal(afterPreview.checkpoint, beforePreview.checkpoint, 'preview must not create an execution checkpoint');
      if (index === 0 || index === 2) {
        if (index === 0) await page.setViewportSize({ width: 1280, height: 800 });
        await preview.scrollIntoViewIfNeeded();
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 65 });
        fs.writeFileSync(path.join(output, 'level-' + (index + 1) + '-preview.jpg'), screenshot);
        console.log('PICK_SCREENSHOT:level-' + (index + 1) + '-preview:' + screenshot.toString('base64') + ':END_PICK_SCREENSHOT');
        if (index === 0) await page.setViewportSize({ width: 1440, height: 960 });
      }
      await preview.getByRole('button', { name: '시작 자세로', exact: true }).click();
      assert.ok(!(await scene.innerText()).includes('예측 TCP'));
      await lesson.getByRole('checkbox', { name: '작업점과 작업 순서를 모두 확인했습니다.' }).check();
      await lesson.getByLabel('재생 속도').selectOption('2');
      if (index === 0) {
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 60 });
        fs.writeFileSync(path.join(output, 'level-1-plan.jpg'), screenshot);
        console.log('PICK_SCREENSHOT:level-1-plan:' + screenshot.toString('base64') + ':END_PICK_SCREENSHOT');
      }
      console.log('PICK_QA_STAGE level-' + (index + 1) + '-run');
      await lesson.getByRole('button', { name: '공정 실행', exact: true }).click({ timeout: 60000 });
      await page.locator('.process-lesson[data-process-stage="5"]').waitFor({ timeout: 120000 });
      console.log('PICK_QA_STAGE level-' + (index + 1) + '-observe');
      const moments = lesson.getByLabel('관찰할 순간');
      assert.ok(await moments.locator('option').count() > 1, 'execution must record real contact moments');
      if (index === 3) {
        await lesson.getByRole('button', { name: '칸 4 보기', exact: true }).click();
        const selected = await moments.locator('option:checked').innerText();
        assert.ok(selected.includes('블록 1') && selected.includes('칸 4') && selected.includes('목표에 배치'));
        const summary = await lesson.getByLabel('선택한 포장 칸 비교').innerText();
        assert.ok(summary.includes('내 명령 (260, 110, 220)') && summary.includes('도달 위치 (260, 110, 220)'));
        await lesson.evaluate(node => { node.scrollTop = 0; });
        await page.screenshot({ path: path.join(output, 'level-4-packing-result.png') });
        await page.getByRole('button', { name: '왼쪽 칸 2 보기', exact: true }).click();
        assert.ok((await moments.locator('option:checked').innerText()).includes('블록 4'));
      }
      await moments.selectOption('0');
      await lesson.getByRole('button', { name: '종료 상태 보기', exact: true }).click();
      const detailed = index === 0 || index === 2;
      if (detailed) await lesson.getByLabel('실제로 일어난 일을 기록하세요').fill(index === 0 ? '집기→운반 ΔZ=80 mm인 장면을 확인했다.' : '같은 인계점은 A(300,40), B(350,-40) mm로 표시되었다.');
      await lesson.getByRole('button', { name: detailed ? '관찰 저장 · 비교하기' : '관찰 확인 · 비교하기', exact: true }).click();
      await lesson.getByRole('heading', { name: '과제 목표 · 내 명령 · 도달 위치', exact: true }).waitFor();
      assert.ok((await lesson.innerText()).includes('목표 위치에 모든 블록을 놓고 시작 자세로 돌아왔습니다.'));
      await lesson.getByLabel('비교 후 내 판단', { exact: true }).selectOption('maintain');
      if (index !== 1) await lesson.getByLabel('예측과 결과의 차이를 설명하세요').fill('좌표의 기준을 맞춰 계산했으며 명령 좌표와 도달 위치가 과제 목표와 일치했다.');
      if (detailed) await lesson.getByLabel('가장 참고한 정보', { exact: true }).selectOption('comparison');
      await lesson.getByRole('button', { name: '비교·해석 저장', exact: true }).click();
      await page.screenshot({ path: path.join(output, 'level-' + (index + 1) + '-result.png') });
      results.push({ level: index + 1, completed: true, moments: await moments.locator('option').count() - 1 });
      if (index === 0) {
        await moments.selectOption({ label: await moments.locator('option').filter({ hasText: '목표에 배치' }).innerText() });
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 60 });
        console.log('PICK_SCREENSHOT:level-1-observation:' + screenshot.toString('base64') + ':END_PICK_SCREENSHOT');
      }
      await lesson.getByRole('button', { name: '판단 유지 · 다음 단계', exact: true }).click();
      assert.equal(await lesson.locator('textarea').count(), 0, 'maintaining a successful judgment must not require another revision paragraph');
      if (index === 0) await page.screenshot({ path: path.join(output, 'level-1-maintain.png') });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await lesson.getByRole('navigation', { name: '픽앤플레이스 수업 경로' }).getByRole('button', { name: /작업대 기본 이송/ }).click();
    const widths = await lesson.evaluate(node => ({ client: node.clientWidth, scroll: node.scrollWidth }));
    assert.ok(widths.scroll <= widths.client + 2, 'lesson panel must fit the narrow viewport');
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    console.log('PICK_QA_STAGE foundation-practice-transfer');
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByRole('button', { name: '☰', exact: true }).click();
    await page.getByRole('navigation', { name: '학습 목차', exact: true }).getByRole('button', { name: /용어·기호와 기초수학/ }).click();
    const foundation = page.locator('.math-start-lesson');
    await foundation.getByRole('button', { name: '도전 모드', exact: true }).click();
    for (const [label, value] of [['목표 절대좌표 Z', '60'], ['X축 변화량 ΔX', '0'], ['Y축 변화량 ΔY', '0'], ['Z축 변화량 ΔZ', '40']])
      await foundation.getByRole('spinbutton', { name: new RegExp(label) }).fill(value);
    await foundation.getByRole('combobox', { name: /이동 명령/ }).selectOption('MoveL');
    await foundation.getByLabel('예측 근거', { exact: true }).fill('목표 60에서 현재 20을 빼면 상승량은 40 mm이다. 수직 직선 이동은 MoveL이다.');
    await foundation.getByRole('button', { name: '도전 답 확인', exact: true }).click();
    await foundation.getByRole('button', { name: '예측·근거 저장', exact: true }).click();
    assert.equal(await page.getByText('도전 확인 완료', { exact: true }).count(), 0, 'the previous save instruction must close once prediction is saved');
    await foundation.getByRole('button', { name: '수학 관계 확인 →', exact: true }).click();
    await foundation.getByLabel('비교 후 내 판단', { exact: true }).selectOption('maintain');
    assert.equal(await foundation.getByLabel('가장 참고한 정보', { exact: true }).count(), 0);
    assert.equal(await foundation.getByLabel('결과 해석', { exact: true }).isVisible(), false);
    await foundation.getByRole('button', { name: '비교 확인 저장', exact: true }).click();
    const practice = await page.evaluate(() => JSON.parse(localStorage.getItem('physical-ai-inquiry-evidence-v1')).at(-1));
    assert.equal(practice.reflections.at(-1).review, 'learner');
    assert.equal(practice.reflections.at(-1).text, '');
    assert.equal(practice.reflections.at(-1).assessment, undefined);
    await page.screenshot({ path: path.join(output, 'foundation-practice.png') });
    await foundation.getByRole('button', { name: '같은 관계를 새 조건에 적용 →', exact: true }).click();
    await foundation.getByRole('spinbutton', { name: /상승량 ΔZ/ }).fill('999');
    await foundation.getByLabel('예측 근거', { exact: true }).fill('높이가 999 mm 늘어날 것으로 예상했다.');
    await foundation.getByRole('button', { name: '예측·근거 저장', exact: true }).click();
    const transfer = await page.evaluate(() => JSON.parse(localStorage.getItem('physical-ai-inquiry-evidence-v1')).at(-1));
    assert.equal(transfer.prediction.delta, '999');
    assert.equal(transfer.independentPrediction, true);
    assert.equal(transfer.runs.length, 0);
    await page.screenshot({ path: path.join(output, 'foundation-transfer.png') });
    results.push({ lesson: 'foundation', practice: 'brief-confirmation', transfer: 'unaided-first-prediction-preserved' });
    assert.deepEqual(errors, [], 'no browser runtime errors');
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors, widths }, null, 2));
    console.log('PICK_QA_RESULTS ' + JSON.stringify({ results, errors, widths }));
  } catch (error) {
    console.error('PICK_QA_FAILURE', error);
    console.log('PICK_QA_DOM ' + await page.locator('body').innerText({ timeout: 3000 }).catch(() => 'No DOM available'));
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 55, timeout: 10000 }).catch(() => null);
    if (screenshot) {
      fs.writeFileSync(path.join(output, 'failure.jpg'), screenshot);
      console.log('PICK_SCREENSHOT:failure:' + screenshot.toString('base64') + ':END_PICK_SCREENSHOT');
    }
    throw error;
  } finally {
    clearTimeout(deadline);
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
