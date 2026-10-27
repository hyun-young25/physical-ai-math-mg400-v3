const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(file, deps = {}) {
  deps = { ...require("./learningTestAdapter.cjs"), ...deps };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('exports', 'require', source)(exports, name => {
    assert.ok(name in deps, `Unmapped dependency: ${name}`);
    return deps[name];
  });
  return exports;
}
const textOf = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(textOf).join('')
  : typeof node === 'object' ? textOf(node.props?.children) : String(node);
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes)
  : [node, ...nodes(node.props?.children)];
const STORAGE_KEY = 'physical-ai-process-evidence-v1';
const CHECKPOINT_KEY = `${STORAGE_KEY}:active-run`;

/** Run the real component and compiler; only React scheduling, storage and RAF are controlled. */
function mountLesson(level = 1, { compilationError, initialStorage = [] } = {}) {
  const slots = [], effects = [], storage = new Map(initialStorage), callbacks = new Map(), storageWrites = [];
  let cursor = 0, dirty = false, tree, visual, nextFrameId = 0, visualUpdates = 0;
  global.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { storageWrites.push({ key, value }); storage.set(key, value); },
    removeItem: key => storage.delete(key),
  };
  global.requestAnimationFrame = callback => { const id = ++nextFrameId; callbacks.set(id, callback); return id; };
  global.cancelAnimationFrame = id => callbacks.delete(id);
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]));
  const memo = (callback, deps) => {
    const index = cursor++, old = slots[index];
    if (!old || changed(old.deps, deps)) slots[index] = { value: callback(), deps };
    return slots[index].value;
  };
  const effect = (callback, deps) => {
    const index = cursor++, old = slots[index];
    if (!old || changed(old.deps, deps)) effects.push(() => {
      old?.cleanup?.(); slots[index] = { deps, cleanup: callback() };
    });
  };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => {
        const next = typeof value === 'function' ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    useRef(value) { const index = cursor++; return slots[index] ?? (slots[index] = { current: value }); },
    useMemo: memo, useCallback: (callback, deps) => memo(() => callback, deps), useEffect: effect, useLayoutEffect: effect,
  };
  const jsx = (type, props) => typeof type === 'function' ? type(props) : ({ type, props });
  const curriculum = load('curriculum.ts');
  const cell = load('processCell.ts', { './curriculum': curriculum });
  if (compilationError) cell.compileProcess = () => { throw new Error(compilationError); };
  const learning = load('processLearning.ts', { './processCell': cell });
  const model = load('processKinematics.ts').PROCESS_MODEL;
  const { ProcessCellLesson } = load('ProcessCellLesson.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, './curriculum': curriculum,
    './learningFramework': load('learningFramework.ts'), './learningEvidenceStorage': load('learningEvidenceStorage.ts'),
    './processEvidence': load('processEvidence.ts'),
    './LearningJudgment': load('LearningJudgment.tsx', { 'react/jsx-runtime': { jsx, jsxs: jsx } }),
    './processCell': cell, './processLearning': learning, './processCell.css': {},
  });
  const props = { model, hardwareConnected: false, sceneReady: true, resetKey: 0, onVisualChange: value => { visual = value; visualUpdates += 1; } };
  const history = () => JSON.parse(storage.get(STORAGE_KEY) ?? '[]');
  function render() {
    let count = 0;
    do {
      dirty = false; cursor = 0; tree = ProcessCellLesson(props);
      while (effects.length) effects.shift()();
      assert.ok(++count < 25, 'Lesson render should settle');
    } while (dirty);
  }
  function find(predicate, description = 'UI element') {
    const item = nodes(tree).find(predicate);
    assert.ok(item, `${description} missing: ${textOf(tree)}`);
    return item;
  }
  const button = label => find(node => node.type === 'button' && (textOf(node) === label || node.props['aria-label'] === label), label).props;
  function input(label) {
    const direct = nodes(tree).find(node => ['input', 'select', 'textarea'].includes(node.type) && (node.props['aria-label'] === label || node.props.id === label));
    if (direct) return direct.props;
    const wrapper = find(node => node.type === 'label' && textOf(node).trim().startsWith(label), label);
    return (nodes(wrapper).find(node => ['input', 'select', 'textarea'].includes(node.type))
      ?? find(node => node.props.id === wrapper.props.htmlFor, label)).props;
  }
  const change = (label, value) => { input(label).onChange({ target: { value: String(value), checked: Boolean(value) } }); render(); };
  function click(label) { const item = button(label); assert.equal(Boolean(item.disabled), false, `${label} is disabled`); item.onClick(); render(); }
  function forceClick(label) { button(label).onClick(); render(); }
  function chooseRelation(value = learning.processStructure(visual.scenario).expected) {
    const radio = find(node => node.type === 'input' && node.props.type === 'radio' && String(node.props.value) === value, `relation ${value}`);
    radio.props.onChange({ target: { value } }); render();
  }
  function fillQuestions(edits = {}, reason = '출발 좌표에 이동량을 더해 목표를 정하고, 먼저 들어 올린 뒤 옮긴다.') {
    for (const question of visual.scenario.questions) {
      for (const field of question.fields) {
        const value = String(edits[field.key] ?? field.expected);
        if (field.sequence) {
          while (!button('마지막 동작 취소').disabled) click('마지막 동작 취소');
          for (const step of value) click(field.sequence.find(item => item.value === Number(step)).label);
        } else if (field.options) {
          find(node => node.type === 'input' && node.props.name === `process-${field.key}` && String(node.props.value) === value, field.label)
            .props.onChange({ target: { value } }); render();
        } else change(`process-${field.key}`, value);
      }
      if (question === visual.scenario.questions.at(-1)) change('예측 근거', reason);
      click(question === visual.scenario.questions.at(-1) ? '예측 저장 · 전체 계획 보기' : '다음 작업점');
    }
  }
  function predict(edits = {}) {
    click('관계부터 생각하기'); chooseRelation(); click('관계 확인 · 좌표 예측'); fillQuestions(edits);
  }
  function reviewPlan() { change('작업점과 작업 순서를 모두 확인했습니다.', true); }
  function tick(now) { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(now)); if (dirty) render(); }
  function finish() { tick(0); tick(history().at(-1).plan.durationMs + 1); }
  function observe() {
    const full = nodes(tree).some(node => node.type === 'button' && textOf(node) === '관찰 저장 · 비교하기');
    if (full) change('실제로 일어난 일을 기록하세요', '집기→운반 ΔZ=80 mm인 장면을 확인했다.');
    click(full ? '관찰 저장 · 비교하기' : '관찰 확인 · 비교하기');
  }
  function compare(decision = 'revise') {
    change('비교 후 내 판단', decision);
    if (nodes(tree).some(node => node.props?.['aria-label'] === '가장 참고한 정보')) change('가장 참고한 정보', 'comparison');
    if (nodes(tree).some(node => node.type === 'textarea')) change('예측과 결과의 차이를 설명하세요', '저장한 좌표와 실제 이동 결과를 비교해 목표 도착 여부와 인계 순서를 확인했다.');
    click('비교·해석 저장');
  }
  render();
  if (level !== 1) change('공정 레벨', level);
  return {
    render, input, button, change, click, forceClick, chooseRelation, fillQuestions, predict, reviewPlan, tick, finish, observe, compare,
    get tree() { return tree; }, get text() { return textOf(tree); }, get visual() { return visual; },
    get scenario() { return visual.scenario; }, get structure() { return learning.processStructure(visual.scenario); },
    get stage() { return Number(textOf(tree).match(/현재 단계 (\d)\/7/)?.[1]); },
    get records() { return history(); }, get record() { return history().at(-1); }, get pending() { return [...callbacks.values()]; },
    get checkpoint() { return JSON.parse(storage.get(CHECKPOINT_KEY) ?? 'null'); },
    get storageWrites() { return storageWrites; }, get visualUpdates() { return visualUpdates; },
    update(value) { Object.assign(props, value); render(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('a practice can retain its prediction without rewriting observations, explanations or a revision plan', () => {
  const app = mountLesson(2); app.predict(); app.reviewPlan(); app.click('공정 실행'); app.finish();
  app.observe(); app.compare('maintain');
  assert.equal(app.record.taskKind, 'practice'); assert.equal(app.record.observation, '');
  assert.equal(app.record.reflection, ''); assert.ok(app.record.observedAt); assert.ok(app.record.reflectedAt);
  assert.equal(app.record.judgment.basis, ''); assert.ok(app.record.prediction);
  app.click('판단 유지 · 다음 단계');
  assert.equal(app.stage, 7); assert.equal(nodes(app.tree).some(node => node.type === 'textarea'), false);
  assert.equal(app.record.revisionPlan, undefined);
  app.click('같은 공정 · 새 조건에 도전'); assert.equal(app.stage, 1); assert.equal(app.scenario.variant, 1);
  app.unmount();
});

test('new conditions preserve a wrong first relation and allow correcting only the relation after observation', () => {
  const app = mountLesson(); app.click('조건 바꾸기');
  const wrong = app.structure.options.find(option => option.value !== app.structure.expected).value;
  app.click('관계부터 생각하기'); app.chooseRelation(wrong); app.click('관계 확인 · 좌표 예측');
  assert.equal(app.stage, 3); app.fillQuestions();
  assert.equal(app.record.taskKind, 'transfer'); assert.equal(app.record.independentPrediction, true);
  assert.equal(app.record.structureChoice, wrong);
  app.reviewPlan(); app.click('공정 실행'); app.finish(); app.observe();
  const executed = JSON.stringify(app.record.executed);
  app.change('실행 결과를 보고 다시 정한 관계', app.structure.expected); app.compare('maintain');
  assert.equal(app.record.structureChoice, wrong); assert.equal(app.record.structureReview, app.structure.expected);
  assert.equal(JSON.stringify(app.record.executed), executed);
  app.click('판단 유지 · 다음 단계'); assert.equal(app.stage, 7);
  app.unmount();
});

test('process stages advance by completed activities, and missing relationships or coordinates block execution', () => {
  const app = mountLesson();
  assert.equal(app.stage, 1);
  app.click('관계부터 생각하기'); assert.equal(app.stage, 2);
  app.click('관계 확인 · 좌표 예측'); assert.equal(app.stage, 2);
  app.chooseRelation(app.structure.options.find(option => option.value !== app.structure.expected).value);
  app.click('관계 확인 · 좌표 예측'); assert.equal(app.stage, 2);
  app.chooseRelation(); assert.equal(app.stage, 2);
  app.click('관계 확인 · 좌표 예측'); assert.equal(app.stage, 3);
  app.change('process-targetX', 300);
  for (const invalid of ['', ' ', 'NaN', 'Infinity', '-Infinity']) {
    app.change('process-targetY', invalid); app.click('다음 작업점');
    assert.equal(app.stage, 3); assert.equal(app.records.length, 0);
  }
  app.change('process-targetY', 90); assert.equal(app.stage, 3);
  app.fillQuestions(); assert.equal(app.record.status, 'submitted');
  assert.equal(app.button('공정 실행').disabled, true);
  app.forceClick('공정 실행'); assert.equal(app.record.status, 'submitted'); assert.equal(app.pending.length, 0);
  app.reviewPlan(); app.click('예측 수정');
  app.fillQuestions(); assert.equal(app.button('공정 실행').disabled, true, 'editing invalidates the plan acknowledgment');
  app.unmount();
});

test('a complete numeric plan still requires a short prediction reason', () => {
  const app = mountLesson();
  app.click('관계부터 생각하기'); app.chooseRelation(); app.click('관계 확인 · 좌표 예측');
  app.fillQuestions({}, '   ');
  assert.equal(app.records.length, 0);
  assert.match(app.text, /예상한 이유/);
  app.change('예측 근거', '블록을 들어 올린 뒤 X·Y를 바꿔 목표 위로 옮긴다.');
  app.click('예측 저장 · 전체 계획 보기');
  assert.ok(app.record.prediction); assert.equal(app.record.status, 'submitted');
  app.unmount();
});

test('preview-informed predictions form a chain without overwriting earlier answers or creating an execution', () => {
  const app = mountLesson(); app.predict({ targetY: -90 });
  const first = app.record;
  app.click('내 예측 움직임 보기'); app.tick(0); app.tick(500); app.click('예측 수정');
  app.fillQuestions();
  const second = app.record;
  assert.equal(second.previousId, first.id); assert.equal(second.predictionPreview, undefined);
  assert.ok(app.records.find(item => item.id === first.id).predictionPreview.firstViewedAt);
  assert.equal(app.records.find(item => item.id === first.id).answers.targetY, -90);
  app.click('내 예측 움직임 보기'); app.tick(0); app.click('예측 수정'); app.fillQuestions();
  assert.equal(app.record.previousId, second.id);
  assert.ok(app.records.every(item => item.status === 'submitted' && !item.executed && !item.outcome));
  app.unmount();
});

test('changing the saved decision or information source requires saving the comparison again', () => {
  const app = mountLesson(); app.predict(); app.reviewPlan(); app.click('공정 실행'); app.finish(); app.observe();
  app.change('예측과 결과의 차이를 설명하세요', '목표와 도달 위치를 비교해 같은 것을 확인했다.');
  assert.equal(app.button('비교·해석 저장').disabled, true);
  app.compare('maintain'); assert.deepEqual(app.record.judgment, { decision: 'maintain', basis: 'comparison' });
  app.change('가장 참고한 정보', 'visualization');
  assert.equal(app.button('판단 유지 · 다음 단계').disabled, true);
  app.click('비교·해석 저장'); assert.equal(app.record.judgment.basis, 'visualization');
  app.unmount();
});

for (const level of [1, 2, 3, 4]) test(`level ${level}: saved whole plan executes, then observation precedes comparison and revision`, () => {
  const app = mountLesson(level);
  app.predict(); assert.equal(app.stage, 3); assert.equal(app.record.status, 'submitted');
  const firstId = app.record.id;
  assert.equal(nodes(app.tree).some(node => node.type === 'table'), true, 'all contact points are reviewed together');
  app.reviewPlan(); app.click('공정 실행'); assert.equal(app.stage, 4); assert.equal(app.record.status, 'running');
  assert.ok(app.record.planReviewedAt); app.finish();
  assert.equal(app.stage, 5); assert.equal(app.record.status, 'completed'); assert.equal(app.record.outcome.passed, true);
  assert.equal(app.record.outcome.completedPieces, level === 4 ? 4 : 1);
  assert.equal(app.record.executed.throughIndex, app.record.plan.frameCount - 1);
  assert.equal(nodes(app.tree).some(node => node.props.className === 'process-checks'), false, 'expected answers stay hidden until observation');
  const full = level === 1 || level === 3;
  assert.equal(Boolean(app.button(full ? '관찰 저장 · 비교하기' : '관찰 확인 · 비교하기').disabled), full);
  app.observe(); assert.equal(app.stage, 6); assert.ok(app.record.observedAt);
  assert.equal(Boolean(app.record.observation), full);
  assert.equal(nodes(app.tree).some(node => node.props.className === 'process-checks'), true);
  assert.equal(app.button('수정 계획 세우기').disabled, true);
  app.compare(); assert.equal(app.stage, 6); assert.ok(app.record.reflection);
  app.click('수정 계획 세우기'); assert.equal(app.stage, 7);
  assert.equal(app.button('수정 이유 저장 · 예측 고치기').disabled, true);
  app.change('수정할 값·조건과 이유', '집기와 놓기 좌표를 다시 확인하고 같은 조건으로 결과를 재검증한다.');
  app.click('수정 이유 저장 · 예측 고치기'); assert.equal(app.stage, 3);
  app.fillQuestions(); assert.equal(app.record.previousId, firstId); assert.ok(app.record.revision);
  assert.equal(app.records.find(record => record.id === firstId).outcome.passed, true, 'prior evidence is retained');
  assert.equal(app.button('공정 실행').disabled, true, 'revised plan needs its own review');
  app.unmount();
});

test('a wrong prediction drives the robot, remains in evidence, and a reasoned revision can succeed', () => {
  const app = mountLesson();
  app.predict({ targetY: -90, approachY: -90 });
  const firstId = app.record.id;
  assert.equal(app.record.answers.targetY, -90);
  assert.ok(app.text.includes('(300, -90, 220)'), 'the reviewed plan uses the student value');
  app.reviewPlan(); app.click('공정 실행'); app.finish();
  assert.equal(app.stage, 5); assert.equal(app.record.outcome.passed, false);
  assert.equal(app.record.outcome.completedPieces, 0);
  assert.ok(Math.abs(app.visual.frame.workpieces[0].top.y + 90) < 0.2, 'the simulated block follows the entered destination');
  app.observe();
  const check = app.record.outcome.checks.find(row => row.key === 'targetY');
  assert.equal(check.actual, -90); assert.equal(check.expected, 90);
  app.compare();
  app.change('예측과 결과의 차이를 설명하세요', '목표 Y를 음수로 잘못 적어서 반대 위치에 놓았다.');
  assert.equal(app.button('수정 계획 세우기').disabled, true, 'edited comparison must be saved again');
  app.click('비교·해석 저장'); app.click('수정 계획 세우기');
  app.change('수정할 값·조건과 이유', '출발 -100에 이동량 +190을 더해 목표 Y를 +90으로 고친다.');
  app.click('수정 이유 저장 · 예측 고치기'); app.fillQuestions();
  app.reviewPlan(); app.click('공정 실행'); app.finish();
  assert.equal(app.record.outcome.passed, true); assert.equal(app.record.previousId, firstId);
  const original = app.records.find(record => record.id === firstId);
  assert.equal(original.answers.targetY, -90); assert.equal(original.outcome.passed, false);
  assert.ok(original.observedAt); assert.ok(original.reflectedAt); assert.ok(original.revisionPlan);
  app.unmount();
});

test('editing an observation invalidates its old comparison before revision or the next level', () => {
  const app = mountLesson();
  app.predict(); app.reviewPlan(); app.click('공정 실행'); app.finish(); app.observe(); app.compare();
  assert.equal(app.stage, 6); assert.ok(app.record.reflection); assert.ok(app.record.reflectedAt);
  assert.equal(app.button('수정 계획 세우기').disabled, false);
  assert.equal(app.button('다음 공정으로').disabled, false);
  app.click('실행 관찰 다시 보기'); assert.equal(app.stage, 5);
  app.change('실제로 일어난 일을 기록하세요', '블록은 목표 Y 90에 놓였고, 로봇만 집기 전의 자세로 돌아왔다.');
  app.click('관찰 저장 · 비교하기'); assert.equal(app.stage, 6);
  assert.equal(app.record.reflection, undefined); assert.equal(app.record.reflectedAt, undefined);
  assert.equal(app.input('예측과 결과의 차이를 설명하세요').value, '');
  assert.equal(app.button('수정 계획 세우기').disabled, true);
  assert.equal(nodes(app.tree).some(node => node.type === 'button' && textOf(node) === '다음 공정으로'), false);
  app.forceClick('수정 계획 세우기'); assert.equal(app.stage, 6);
  app.compare(); assert.ok(app.record.reflection); assert.equal(app.button('다음 공정으로').disabled, false);
  app.unmount();
});

test('a compiler failure keeps the reviewed plan and records no invented execution or observation', () => {
  const app = mountLesson(2, { compilationError: '검증용 경로 계산 실패' });
  app.predict(); app.reviewPlan(); app.click('공정 실행');
  assert.equal(app.stage, 5); assert.equal(app.record.status, 'unavailable');
  assert.ok(app.record.planReviewedAt); assert.equal(app.record.stopReason, '검증용 경로 계산 실패');
  assert.equal(app.record.executed, undefined); assert.equal(app.record.outcome, undefined);
  assert.equal(app.visual.frame.atMs, 0); assert.equal(app.pending.length, 0);
  assert.ok(app.text.includes('관찰 좌표가 없습니다'));
  app.change('실제로 일어난 일을 기록하세요', '경로 계산 오류로 로봇 이동을 시작하지 못했다.');
  app.click('관찰 저장 · 비교하기'); assert.equal(app.stage, 6);
  assert.equal(nodes(app.tree).some(node => node.props.className === 'process-checks'), false);
  assert.equal(app.text.includes('공정 성공'), false);
  app.unmount();
});

for (const interruption of [{ hardwareConnected: true }, { sceneReady: false }]) test(`${Object.keys(interruption)[0]} stops playback without claiming success`, () => {
  const app = mountLesson(4); app.predict(); app.reviewPlan(); app.click('공정 실행'); app.tick(0); app.tick(1000);
  const pending = app.pending, lastIndex = app.checkpoint.executed.throughIndex;
  assert.ok(lastIndex > 0);
  app.update(interruption);
  assert.equal(app.stage, 5); assert.equal(app.record.status, 'stopped'); assert.equal(app.record.outcome, undefined);
  assert.equal(app.record.executed.throughIndex, lastIndex); assert.equal(app.pending.length, 0);
  pending.forEach(callback => callback(1e9)); app.render();
  assert.equal(app.record.status, 'stopped'); assert.equal(app.record.outcome, undefined, 'stale RAF cannot fabricate completion');
  assert.equal(app.text.includes('공정 성공'), false);
  app.unmount();
});

test('reset and level changes discard the active plan while retaining actual execution evidence', () => {
  const app = mountLesson(2); app.predict(); app.reviewPlan(); app.click('공정 실행'); app.tick(0); app.tick(1000);
  const stale = app.pending, previousId = app.record.id;
  app.update({ resetKey: 1 }); assert.equal(app.stage, 1); assert.equal(app.record.status, 'stopped');
  assert.equal(app.visual.running, false); assert.equal(app.visual.frame.atMs, 0);
  stale.forEach(callback => callback(1e9)); app.render(); assert.equal(app.record.status, 'stopped');
  app.change('공정 레벨', 3); assert.equal(app.stage, 1); assert.equal(app.scenario.level, 3);
  app.predict(); assert.notEqual(app.record.id, previousId); assert.equal(app.record.condition.level, 3);
  assert.equal(app.record.previousId, undefined, 'a different scenario cannot reuse the old execution');
  assert.equal(app.records.find(record => record.id === previousId).status, 'stopped');
  assert.equal(app.button('공정 실행').disabled, true);
  app.unmount();
});

test('live 3D frames advance between React UI snapshots without changing the shared ref', () => {
  const app = mountLesson(4);
  app.predict(); app.reviewPlan(); app.click('공정 실행'); app.tick(0); app.tick(16);
  const live = app.visual.liveFrameRef, published = app.visual.frame, publishedCount = app.visualUpdates;
  assert.ok(live, 'the scene receives a live frame ref');
  app.tick(32);
  assert.equal(app.visual.liveFrameRef, live, 'the scene keeps the same frame channel');
  assert.equal(app.visualUpdates, publishedCount, 'a moving frame does not rerender the whole lesson');
  assert.equal(app.visual.frame, published, 'the text UI retains its last published snapshot');
  assert.ok(live.current.atMs > published.atMs, '3D playback still advances at the RAF cadence');
  assert.ok(live.current.beltProgress > published.beltProgress, 'conveyor motion also uses live frames');
  for (let time = 48; time <= 992; time += 16) app.tick(time);
  assert.ok(app.visualUpdates - publishedCount >= 5, 'the progress UI continues to refresh');
  assert.ok(app.visualUpdates - publishedCount < 25, 'routine motion publishes substantially fewer updates than RAF');
  app.tick(app.record.plan.durationMs + 1);
  assert.equal(app.stage, 5); assert.equal(app.record.status, 'completed');
  assert.equal(app.visual.liveFrameRef, live);
  assert.deepEqual(live.current, app.visual.frame, 'the terminal scene and UI agree');
  assert.deepEqual(live.current, app.record.executed.lastFrame, 'completion evidence records the visible terminal frame');
  app.unmount();
});

test('stopping between UI refreshes publishes the actual live frame and stale RAF cannot move it after reset', () => {
  const app = mountLesson(4);
  app.predict(); app.reviewPlan(); app.click('공정 실행'); app.tick(0); app.tick(16); app.tick(48);
  const live = app.visual.liveFrameRef, stoppedAt = live.current, stale = app.pending;
  assert.ok(stoppedAt.atMs > app.visual.frame.atMs, 'stop occurs between text UI refreshes');
  app.click('실행 중지');
  assert.equal(app.stage, 5); assert.equal(app.record.status, 'stopped');
  assert.deepEqual(app.visual.frame, stoppedAt);
  assert.deepEqual(app.record.executed.lastFrame, JSON.parse(JSON.stringify(stoppedAt)));
  assert.equal(app.record.executed.simulationMs, 48);
  stale.forEach(callback => callback(1e9)); app.render();
  assert.equal(live.current, stoppedAt); assert.equal(app.record.status, 'stopped');
  app.update({ resetKey: 1 });
  assert.equal(app.visual.liveFrameRef, live); assert.equal(live.current.atMs, 0);
  const initial = live.current;
  stale.forEach(callback => callback(2e9)); app.render();
  assert.equal(live.current, initial, 'an old run cannot overwrite the reset scene');
  assert.deepEqual(app.record.executed.lastFrame, JSON.parse(JSON.stringify(stoppedAt)), 'reset retains the actual stopped execution');
  app.unmount();
});

test('unmount preserves the last live frame even before the next UI refresh or storage checkpoint', () => {
  const app = mountLesson(4);
  app.predict(); app.reviewPlan(); app.click('공정 실행'); app.tick(0); app.tick(16); app.tick(48);
  const live = app.visual.liveFrameRef, last = live.current, stale = app.pending;
  app.unmount();
  assert.equal(app.visual, null); assert.equal(app.record.status, 'stopped');
  assert.deepEqual(app.record.executed.lastFrame, JSON.parse(JSON.stringify(last)));
  assert.equal(app.record.executed.simulationMs, 48);
  stale.forEach(callback => callback(1e9));
  assert.equal(live.current, last); assert.equal(app.record.status, 'stopped');
});

test('playback checkpoints write only the current run and terminal persistence retains unrelated history', () => {
  const prior = Array.from({ length: 150 }, (_, index) => ({ id: `future-record-${index}`, newerSchema: true, note: 'keep-unrelated-history'.repeat(80) }));
  const app = mountLesson(4, { initialStorage: [[STORAGE_KEY, JSON.stringify(prior)]] });
  app.predict(); app.reviewPlan(); app.click('공정 실행');
  const writesAtStart = app.storageWrites.length;
  app.tick(0); app.tick(1000); app.tick(2000); app.tick(3000);
  const progressWrites = app.storageWrites.slice(writesAtStart);
  assert.equal(progressWrites.filter(write => write.key === STORAGE_KEY).length, 0, 'frequent checkpoints must not serialize the growing history');
  assert.equal(progressWrites.filter(write => write.key === CHECKPOINT_KEY).length, 3);
  assert.equal(app.checkpoint.id, app.record.id); assert.equal(app.checkpoint.status, 'running');
  assert.equal(app.checkpoint.executed.simulationMs, 3000);
  assert.ok(app.checkpoint.executed.throughIndex > app.record.executed.throughIndex);
  assert.ok(progressWrites.every(write => !write.value.includes('keep-unrelated-history')));
  app.tick(app.record.plan.durationMs + 1);
  assert.equal(app.record.status, 'completed'); assert.equal(app.checkpoint, null);
  assert.deepEqual(app.records.slice(0, prior.length), prior, 'unknown schema entries are preserved exactly');
  assert.equal(app.storageWrites.slice(writesAtStart).filter(write => write.key === STORAGE_KEY).length, 1);
  app.unmount();
});

test('visible level and question routes preserve entered values and do not bypass execution gates', () => {
  const app = mountLesson();
  assert.ok(app.tree);
  app.forceClick('6비교'); assert.equal(app.stage, 1);
  app.click('3두 로봇이 이어받기'); assert.equal(app.scenario.level, 3);
  app.click('1작업대 기본 이송'); assert.equal(app.scenario.level, 1);
  app.click('관계부터 생각하기'); app.chooseRelation(); app.click('관계 확인 · 좌표 예측');
  app.change('process-targetX', 301); app.change('process-targetY', 91);
  app.click('2. 높이와 운반 순서 정하기');
  app.change('process-travelZ', 299);
  app.click('1. 이동량으로 목표 찾기');
  assert.equal(app.input('process-targetX').value, '301');
  assert.equal(app.input('process-targetY').value, '91');
  app.click('2. 높이와 운반 순서 정하기');
  assert.equal(app.input('process-travelZ').value, '299');
  app.forceClick('6비교'); assert.equal(app.stage, 3);
  app.unmount();
});

test('review points use robot-local input and replay uses recorded frames without altering evidence', () => {
  const app = mountLesson(3);
  app.predict();
  app.click('B 인계대에서 집기');
  assert.equal(app.visual.selectedRobot, 'B');
  assert.deepEqual(app.visual.focusPoint, app.scenario.handoff, 'B local point transforms back to the shared physical point');
  app.reviewPlan(); app.click('공정 실행'); app.finish();
  const terminal = JSON.stringify(app.record.executed.lastFrame);
  const moments = app.record.executed.moments;
  assert.ok(moments.length > 3);
  assert.ok(moments.some(moment => moment.label.includes('B 블록 집기')));
  app.change('관찰할 순간', 0);
  assert.equal(app.visual.reviewing, true);
  assert.deepEqual(app.visual.frame, moments[0].frame);
  assert.equal(JSON.stringify(app.record.executed.lastFrame), terminal, 'preview must not overwrite terminal execution evidence');
  app.click('종료 상태 보기');
  assert.equal(app.visual.reviewing, false);
  assert.equal(JSON.stringify(app.visual.frame), terminal);
  app.observe();
  assert.ok(app.text.includes('과제 목표 · 내 명령 · 도달 위치'));
  app.unmount();
});

test('cooperative coordinate answers stay hidden in the scene until the student submits a plan', () => {
  const app = mountLesson(3);
  assert.equal(app.visual.hideTargetCoordinates, true);
  app.click('관계부터 생각하기'); app.chooseRelation(); app.click('관계 확인 · 좌표 예측');
  assert.equal(app.visual.selectedRobot, 'B');
  assert.equal(app.visual.hideTargetCoordinates, true);
  app.fillQuestions();
  assert.equal(app.visual.hideTargetCoordinates, false);
  app.unmount();
});

test('stopping never records a future pick or placement as an observed moment', () => {
  const app = mountLesson(4);
  app.predict(); app.reviewPlan(); app.click('공정 실행'); app.tick(0); app.tick(300);
  app.click('실행 중지');
  assert.equal(app.record.status, 'stopped');
  assert.ok(app.record.executed.moments.every(moment => moment.frame.atMs <= 300));
  assert.ok(!app.record.executed.moments.some(moment => moment.label.includes('목표에 배치')));
  app.unmount();
});

test('replaying concurrent B contacts focuses B and its recorded work point', () => {
  const app = mountLesson(4);
  app.predict(); app.reviewPlan(); app.click('공정 실행'); app.finish();
  const terminal = JSON.stringify(app.record.executed.lastFrame);
  const moments = app.record.executed.moments;
  const contacts = moments.map((moment, index) => ({ moment, index })).filter(({ moment }) => moment.robot === 'B');
  assert.ok(contacts.length >= 8, 'all four B picks and placements are reviewable');
  for (const { moment, index } of contacts) {
    app.change('관찰할 순간', index);
    assert.equal(app.visual.selectedRobot, 'B');
    assert.deepEqual(app.visual.focusPoint, moment.goal ?? moment.point);
    assert.equal(app.visual.focusLabel, moment.label);
    assert.deepEqual(app.visual.frame, moment.frame);
  }
  assert.equal(JSON.stringify(app.record.executed.lastFrame), terminal);
  app.unmount();
});

test('student work points and chosen axis route appear in the plan and observed lift/approach moments', () => {
  const app = mountLesson(1);
  app.predict({ routeChoice: 2 });
  assert.deepEqual(app.visual.plannedPath.map(item => item.label), ['P1', 'P2', '경유', 'P3', 'P4']);
  assert.equal(app.visual.plannedPath[2].pose.x, app.scenario.source.x);
  assert.equal(app.visual.plannedPath[2].pose.y, app.scenario.destination.y);
  app.click('A 목표 위 접근');
  assert.deepEqual(app.visual.focusPoint, { ...app.scenario.destination, z: 300 });
  app.reviewPlan(); app.click('공정 실행'); app.finish();
  assert.ok(app.record.executed.moments.some(moment => moment.frame.event === 'A-lifted'));
  assert.ok(app.record.executed.moments.some(moment => moment.frame.event === 'A-above'));
  assert.equal(app.record.answers.routeChoice, 2);
  assert.equal(app.record.outcome.passed, true);
  app.unmount();
});

test('the sequence builder preserves the chosen wrong order and incomplete edits cannot start playback', () => {
  const app = mountLesson();
  app.predict({ transferOrder: 2134 });
  assert.deepEqual(app.visual.plannedPath.map(item => item.label), ['P1', 'P3', 'P2', 'P4']);
  app.click('예측 수정'); app.click('2. 높이와 운반 순서 정하기');
  app.click('마지막 동작 취소'); app.click('다음 작업점');
  assert.ok(app.text.includes('네 동작을 한 번씩'));
  app.click('블록 놓기'); app.click('다음 작업점'); app.click('예측 저장 · 전체 계획 보기');
  assert.equal(app.record.answers.transferOrder, 2134);
  app.reviewPlan(); app.click('공정 실행'); app.finish();
  assert.equal(app.record.outcome.passed, false);
  assert.ok(app.record.executed.moments.every(moment => !moment.point));
  app.unmount();
});

test('a missed pickup review separates the real block target from the actually reached TCP', () => {
  const app = mountLesson(2);
  app.predict({ beltY: 60 }); app.reviewPlan(); app.click('공정 실행'); app.finish();
  const index = app.record.executed.moments.findIndex(moment => moment.frame.event === 'grip-miss');
  assert.ok(index >= 0);
  const moment = app.record.executed.moments[index];
  assert.ok(Math.abs(moment.point.y - 60) < .2);
  assert.equal(moment.goal.y, app.scenario.source.y);
  app.change('관찰할 순간', index);
  assert.deepEqual(app.visual.focusPoint, moment.goal);
  assert.ok(Math.abs(app.visual.frame.robots.A.pose.y - 60) < .2);
  app.unmount();
});

for (const level of [1, 2, 3, 4]) test(`level ${level}: prediction preview matches execution without writing execution evidence`, () => {
  const app = mountLesson(level);
  app.predict(level === 1 ? { targetY: -90, approachY: -90 } : {});
  const saved = JSON.parse(JSON.stringify(app.record)), writes = app.storageWrites.length;
  if (level >= 3) assert.equal(app.visual.predictedRoutes.length, 2);
  app.click('내 예측 움직임 보기'); app.tick(0); app.tick(500);
  assert.equal(app.stage, 3); assert.equal(app.visual.running, false);
  assert.equal(app.visual.predictionPreview.playing, true);
  assert.equal(app.visual.focusPoint, undefined, 'preview clears the previously selected workpoint');
  assert.ok(app.visual.liveFrameRef.current.atMs > 0);
  app.tick(1e9);
  const predictedEnd = JSON.stringify(app.visual.frame);
  assert.equal(app.visual.predictionPreview.progress, 100);
  assert.equal(app.visual.predictionPreview.playing, false);
  const { predictionPreview, ...unchanged } = app.record;
  assert.deepEqual(unchanged, saved);
  assert.ok(predictionPreview.firstViewedAt);
  assert.ok(predictionPreview.furthestTimeMs > 0);
  assert.ok(app.storageWrites.length > writes);
  assert.equal(app.checkpoint, null);
  assert.equal(app.record.executed, undefined); assert.equal(app.record.outcome, undefined);
  if (level === 1) assert.ok(Math.abs(app.visual.frame.workpieces[0].top.y + 90) < .2, 'wrong input is previewed verbatim');
  app.reviewPlan(); app.click('공정 실행');
  assert.equal(app.visual.predictionPreview, undefined);
  assert.equal(app.visual.frame.atMs, 0); assert.equal(app.stage, 4);
  app.finish();
  assert.equal(JSON.stringify(app.visual.frame), predictedEnd);
  assert.equal(app.record.status, 'completed');
  app.unmount();
});

test('prediction preview pauses, seeks and resumes; editing invalidates its queued frames', () => {
  const app = mountLesson(); app.predict(); app.click('내 예측 움직임 보기');
  app.tick(0); app.tick(1500);
  const stale = app.pending;
  app.click('미리보기 일시정지');
  const paused = app.visual.frame;
  assert.equal(app.pending.length, 0);
  stale.forEach(callback => callback(1e9)); app.render();
  assert.equal(app.visual.frame, paused);
  app.click('다음 구간');
  assert.ok(app.visual.frame.atMs >= paused.atMs);
  app.change('예측 미리보기 진행 위치', 2500);
  assert.ok(app.visual.frame.atMs <= 2500 && app.visual.frame.atMs > 0);
  app.click('미리보기 계속'); app.tick(4000); app.tick(4300);
  assert.ok(app.visual.liveFrameRef.current.atMs > 2500);
  const queued = app.pending;
  app.click('예측 수정');
  assert.equal(app.pending.length, 0); assert.equal(app.visual.predictionPreview, undefined);
  assert.equal(app.visual.frame.atMs, 0);
  queued.forEach(callback => callback(1e9)); app.render();
  assert.equal(app.visual.frame.atMs, 0); assert.equal(app.record.executed, undefined);
  app.unmount();
});

for (const interruption of [{ hardwareConnected: true }, { sceneReady: false }, { resetKey: 1 }])
test(`${Object.keys(interruption)[0]} cancels prediction without inventing a stopped execution`, () => {
  const app = mountLesson(); app.predict(); app.click('내 예측 움직임 보기'); app.tick(0); app.tick(500);
  const queued = app.pending, saved = JSON.stringify(app.records);
  app.update(interruption);
  assert.equal(app.pending.length, 0); assert.equal(app.visual.predictionPreview, undefined);
  assert.equal(app.visual.frame.atMs, 0);
  queued.forEach(callback => callback(1e9)); app.render();
  assert.equal(app.visual.frame.atMs, 0);
  assert.equal(JSON.stringify(app.records), saved); assert.equal(app.checkpoint, null);
  app.unmount();
});

test('blocked input explains the preview limit and never moves the robot through a prohibited sequence', () => {
  const app = mountLesson(); app.predict({ transferOrder: 2134 });
  const start = JSON.stringify(app.visual.frame.robots);
  app.click('내 예측 움직임 보기'); app.tick(0); app.tick(1e9);
  assert.equal(JSON.stringify(app.visual.frame.robots), start);
  assert.ok(app.text.includes('운반 순서를 확인하세요'));
  assert.equal(app.record.status, 'submitted'); assert.equal(app.record.executed, undefined);
  app.unmount();
});

test('a preview cannot update the scene or evidence after unmount', () => {
  const app = mountLesson(); app.predict(); app.click('내 예측 움직임 보기'); app.tick(0); app.tick(500);
  const queued = app.pending, live = app.visual.liveFrameRef, last = live.current, saved = JSON.stringify(app.records);
  app.unmount(); queued.forEach(callback => callback(1e9));
  assert.equal(live.current, last); assert.equal(app.pending.length, 0);
  assert.equal(JSON.stringify(app.records), saved); assert.equal(app.checkpoint, null);
});

test('handoff questions request both reference frames before any numerical prediction', () => {
  const app = mountLesson(3);
  app.click('관계부터 생각하기'); app.chooseRelation(); app.click('관계 확인 · 좌표 예측');
  assert.equal(app.visual.cameraRequest.scope, 'frames');
  assert.equal(app.visual.hideTargetCoordinates, true);
  assert.equal(app.records.length, 0);
  app.unmount();
});

test('level-four packing selection links a reordered block to the actual recorded placement without overwriting its prediction', () => {
  const app = mountLesson(4);
  assert.equal(app.visual.focusLabel, '벨트 정지 후 집을 지점');
  app.click('칸 4 보기');
  assert.equal(app.visual.cameraRequest.scope, 'packing');
  assert.equal(app.visual.hideTargetCoordinates, true);
  assert.ok(app.visual.packing.cells.every(cell => !cell.command));
  app.predict({ packingOrder: 4132 });
  const id = app.record.id;
  app.click('칸 4 보기');
  assert.equal(app.visual.packing.cells.find(cell => cell.slot === 3).order, 1);
  assert.equal(app.visual.selectedRobot, 'B');
  app.reviewPlan(); app.click('공정 실행'); app.finish();
  app.click('칸 4 보기');
  assert.equal(app.visual.reviewing, true);
  assert.equal(app.visual.frame.eventPieceId, 'piece-1');
  assert.equal(app.visual.frame.eventTraySlot, 3);
  assert.ok(app.visual.frame.events.includes('placed'));
  assert.equal(app.record.id, id); assert.equal(app.record.answers.packingOrder, 4132);
  assert.match(app.text, /내 명령 \(260, 110, 220\)/);
  assert.match(app.text, /도달 위치 \(260, 110, 220\)/);
  app.change('관찰할 순간', 0);
  assert.equal(app.visual.packing.selectedSlot, null, 'a pickup moment must not display a later placement as its observation');
  assert.doesNotMatch(app.text, /내 명령 \(260, 110, 220\)/);
  app.unmount();
});

test('a failed packing plan shows the attempted slot while unexecuted slots have no invented observation', () => {
  const app = mountLesson(4); app.predict({ packingOrder: 4132, packingX: 268 });
  app.reviewPlan(); app.click('공정 실행'); app.finish();
  app.click('칸 4 보기');
  assert.equal(app.visual.frame.event, 'place-miss');
  assert.match(app.text, /내 명령 \(268, 110, 220\)/);
  assert.match(app.text, /과제 목표 \(260, 110, 220\)/);
  app.click('칸 1 보기');
  assert.equal(app.visual.reviewing, false);
  assert.match(app.text, /아직 이 칸에 도달한 장면이 없습니다/);
  app.unmount();
});
