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
  new Function('exports', 'require', source)(exports, name => { assert.ok(name in deps, name); return deps[name]; });
  return exports;
}
const textOf = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(textOf).join('')
  : typeof node === 'object' ? textOf(node.props?.children) : String(node);
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];

function mountLesson(options = {}) {
  const slots = [], effects = [], storage = new Map();
  let cursor = 0, dirty = false, tree, focus, coach;
  global.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]));
  const effect = (callback, deps) => {
    const index = cursor++, old = slots[index];
    if (!old || changed(old.deps, deps)) effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; });
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
    useCallback(callback, deps) {
      const index = cursor++, old = slots[index];
      if (!old || changed(old.deps, deps)) slots[index] = { value: callback, deps };
      return slots[index].value;
    },
    useEffect: effect, useLayoutEffect: effect,
  };
  const jsx = (type, props) => ({ type, props }), runtime = { jsx, jsxs: jsx, Fragment: 'Fragment' };
  const judgment = load('LearningJudgment.tsx', { 'react/jsx-runtime': runtime });
  const inquiry = load('MathInquiry.tsx', {
    react, 'react/jsx-runtime': runtime, './LearningJudgment': judgment,
    './curriculum': load('curriculum.ts'), './learningFramework': load('learningFramework.ts'),
    './ExplanationFeedbackPanel': { ExplanationFeedback: 'ExplanationFeedback' },
    './explanationFeedback': load('explanationFeedback.ts'), './inquiryFeedback': load('inquiryFeedback.ts'),
    './learningEvidenceStorage': load('learningEvidenceStorage.ts'),
  });
  const { MathStartLesson } = load('MathStartLesson.tsx', {
    react, 'react/jsx-runtime': runtime, './MathInquiry': inquiry,
    './LessonConceptHeader': { LessonConceptHeader: 'LessonConceptHeader' },
    './foundationMotion': load('foundationMotion.ts'),
    './FoundationMovePanel': load('FoundationMovePanel.tsx', {'react/jsx-runtime':runtime}),
  });
  const onFocusChange = value => { focus = value; };
  const onCoachChange = value => { coach = value; };
  function expand(node) {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props?.children) } };
  }
  function render() {
    let count = 0;
    do {
      dirty = false; cursor = 0;
      tree = expand(MathStartLesson({ onFocusChange, onCoachChange, ...options }));
      while (effects.length) effects.shift()();
      assert.ok(++count < 25, 'render must settle');
    } while (dirty);
  }
  const find = (predicate, label) => { const node = nodes(tree).find(predicate); assert.ok(node, `${label}: ${textOf(tree)}`); return node; };
  const button = label => find(node => node.type === 'button' && (textOf(node) === label
    || label === '정답 확인 · 실제 로봇 이동 →' && textOf(node) === '정답 확인 · 실제 로봇 이동 (확인 창) →'), label).props;
  const enter = (label, value) => { find(node => ['input', 'select', 'textarea'].includes(node.type) && node.props?.['aria-label']?.endsWith(label), label).props.onChange({ target: { value } }); render(); };
  const click = label => { const item = button(label); assert.ok(!item.disabled, label); item.onClick(); render(); };
  const explain = () => {
    enter('비교 후 내 판단', 'maintain');
    const practice = nodes(tree).some(node => node.type === 'button' && textOf(node) === '비교 확인 저장');
    if (!practice) enter('결과 해석', '목표 좌표에서 현재 좌표를 빼서 상승량을 계산하고 예측과 결과가 같은지 비교했다.');
    click(practice ? '비교 확인 저장' : '내 설명 저장');
    if (practice) {
      const saved = JSON.parse(storage.get('physical-ai-inquiry-evidence-v1')).at(-1);
      assert.equal(saved.taskKind, 'practice'); assert.equal(saved.reflections.at(-1).text, '');
      assert.equal(saved.reflections.at(-1).review, 'learner'); assert.equal(saved.reflections.at(-1).assessment, undefined);
      assert.equal(saved.reflections.at(-1).judgment.basis, '');
    }
    if (nodes(tree).some(node => node.type === 'button' && textOf(node) === '교사 검토용으로 남기고 계속')) click('교사 검토용으로 남기고 계속');
  };
  const goTransfer = () => {
    click('도전 모드');
    for (const [label, value] of [['목표 절대좌표 Z', '60'], ['X축 변화량 ΔX', '0'], ['Y축 변화량 ΔY', '0'], ['Z축 변화량 ΔZ', '40'], ['이동 명령', 'MoveL']]) enter(label, value);
    enter('예측 근거', '목표 60에서 현재 20을 빼면 상승량은 40 mm이다. 수직 직선 이동은 MoveL이다.');
    click('도전 답 확인'); assert.ok(coach);
    click('예측·근거 저장'); assert.equal(coach, null, 'saved predictions must dismiss the obsolete save instruction');
    click('수학 관계 확인 →'); explain();
    click('같은 관계를 새 조건에 적용 →');
  };
  render();
  return { enter, click, button, goTransfer, explain, render, get text() { return textOf(tree); }, get focus() { return focus; },
    get record() { return JSON.parse(storage.get('physical-ai-inquiry-evidence-v1') ?? '[]').at(-1); } };
}

test('transfer preserves an unaided wrong first answer before revealing feedback, and a revision is no longer independent', () => {
  const app = mountLesson(); app.goTransfer();
  assert.match(app.text, /현재 Z=45 mm/);
  assert.doesNotMatch(app.text + app.focus.guideBody, /ΔZ=15|60−45|60-45/);
  assert.match(app.button('도전 모드').className, /is-selected/);
  app.enter('상승량 ΔZ', '999'); app.enter('예측 근거', '높이가 999 mm 늘어날 것으로 예상했다.');
  app.click('예측·근거 저장');
  const original = app.record;
  assert.equal(original.prediction.delta, '999'); assert.equal(original.independentPrediction, true);
  assert.equal(original.condition.support, 'independent');
  app.click('수학 관계 확인 →');
  assert.match(app.text, /입력값 오류/);
  assert.equal(app.record.prediction.delta, '999');
  app.enter('상승량 ΔZ', '15'); app.enter('예측 근거', '목표 60에서 현재 45를 빼면 15 mm이다.'); app.click('예측·근거 저장');
  assert.equal(app.record.prediction.delta, '15'); assert.equal(app.record.previousId, original.id);
  assert.equal(app.record.independentPrediction, false);
});

test('requesting basic support is available in transfer and is not later relabeled as unaided', () => {
  const app = mountLesson(); app.goTransfer(); app.click('기초 지원');
  assert.match(app.text, /60−45/);
  app.click('도전 모드'); app.enter('상승량 ΔZ', '15'); app.enter('예측 근거', '60에서 45를 빼면 15이다.');
  app.click('예측·근거 저장');
  assert.equal(app.record.condition.guidanceBeforePrediction, true);
  assert.equal(app.record.independentPrediction, false);
});



test('correct saved answers dispatch one target move and repeated clicks cannot resend it', async () => {
  let calls = 0, complete;
  const app = mountLesson({ hardwareMode: true, onCorrectMove: id => {
    assert.equal(id, 'height-practice'); calls++;
    return new Promise(resolve => { complete = resolve; });
  } });
  app.click('도전 모드');
  for (const [label, value] of [['목표 절대좌표 Z', '60'], ['X축 변화량 ΔX', '0'], ['Y축 변화량 ΔY', '0'], ['Z축 변화량 ΔZ', '40'], ['이동 명령', 'MoveL']]) app.enter(label, value);
  app.enter('예측 근거', '목표 60에서 현재 20을 빼면 40이고 직선 이동은 MoveL이다.');
  app.click('도전 답 확인'); app.click('예측·근거 저장');
  const action = app.button('정답 확인 · 실제 로봇 이동 →');
  action.onClick(); action.onClick(); app.render();
  assert.equal(calls, 1);
  assert.equal(app.button('이동 확인 중…').disabled, true);
  complete({ summary: '실제 목표 도달 확인', detail: { source: 'hardware', seq: 12 } });
  await new Promise(resolve => setImmediate(resolve)); app.render();
  assert.equal(app.record.runs.at(-1).status, 'completed');
  assert.equal(app.record.runs.at(-1).detail.motion.seq, 12);
});

test('editing a previously checked answer cannot send a robot command', () => {
  let calls = 0;
  const app = mountLesson({ onCorrectMove: async () => { calls++; return null; } });
  app.click('도전 모드');
  for (const [label, value] of [['목표 절대좌표 Z', '60'], ['X축 변화량 ΔX', '0'], ['Y축 변화량 ΔY', '0'], ['Z축 변화량 ΔZ', '40'], ['이동 명령', 'MoveL']]) app.enter(label, value);
  app.enter('예측 근거', '목표에서 현재를 빼면 40이다.');
  app.click('도전 답 확인');
  app.enter('Z축 변화량 ΔZ', '400');
  app.click('도전 답 확인');
  assert.match(app.text, /다시|확인/);
  assert.equal(calls, 0);
});

test('a failed or cancelled motion is not recorded as a completed observation', async () => {
  for (const fail of [true, false]) {
    const app = mountLesson({ hardwareMode: true, onCorrectMove: async () => {
      if (fail) throw new Error('timed out');
      return null;
    } });
    app.click('도전 모드');
    for (const [label, value] of [['목표 절대좌표 Z', '60'], ['X축 변화량 ΔX', '0'], ['Y축 변화량 ΔY', '0'], ['Z축 변화량 ΔZ', '40'], ['이동 명령', 'MoveL']]) app.enter(label, value);
    app.enter('예측 근거', '60에서 20을 빼면 40이고 직선 이동이다.');
    app.click('도전 답 확인'); app.click('예측·근거 저장'); app.click('정답 확인 · 실제 로봇 이동 →');
    await new Promise(resolve => setImmediate(resolve)); app.render();
    assert.equal(app.record.runs.length, 1);
    assert.equal(app.record.runs[0].action, 'motion-attempt');
    assert.notEqual(app.record.runs[0].status, 'completed');
    assert.match(app.text, fail ? /정답이지만 이동하지 못했습니다.*timed out/ : /이동을 취소/);
    assert.equal(app.button('정답 확인 · 실제 로봇 이동 →').disabled, false);
  }
});
