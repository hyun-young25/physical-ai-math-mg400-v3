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

const clone = value => JSON.parse(JSON.stringify(value));
const textOf = node => node == null ? '' : Array.isArray(node) ? node.map(textOf).join('')
  : typeof node === 'object' ? textOf(node.props?.children) : String(node);
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes)
  : [node, ...nodes(node.props?.children)];

/** The lesson and inquiry run with separate hook scopes, as two actual React components would. */
function mountLesson(shape = '삼각형', lessonIndex = 0, supportMode = 'guided', taskKind = 'representative') {
  const scopes = new Map(), effects = [], storage = new Map();
  let activeScope, cursor = 0, dirty = false, tree, inquiry, lesson, stage = 0, locked = false, advanced = 0, canAdvance = true;
  global.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]));
  const scope = (name, callback) => {
    activeScope = scopes.get(name) ?? [];
    scopes.set(name, activeScope);
    cursor = 0;
    return callback();
  };
  const effect = (callback, deps) => {
    const slots = activeScope, index = cursor++, old = slots[index];
    if (!old || changed(old.deps, deps)) effects.push(() => {
      old?.cleanup?.();
      slots[index] = { deps, cleanup: callback() };
    });
  };
  const memo = (callback, deps) => {
    const index = cursor++, old = activeScope[index];
    if (!old || changed(old.deps, deps)) activeScope[index] = { value: callback(), deps };
    return activeScope[index].value;
  };
  const react = {
    useState(initial) {
      const slots = activeScope, index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => {
        const next = typeof value === 'function' ? value(slots[index].value) : value;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    useRef(value) { const index = cursor++; return activeScope[index] ?? (activeScope[index] = { current: value }); },
    useId() { const index = cursor++; return activeScope[index] ?? (activeScope[index] = `lesson-field-${index}`); },
    useCallback: (callback, deps) => memo(() => callback, deps),
    useMemo: memo,
    useEffect: effect,
    useLayoutEffect: effect,
  };
  const jsx = (type, props) => ({ type, props });
  const runtime = { jsx, jsxs: jsx, Fragment: 'Fragment' };
  const judgmentModule = load('LearningJudgment.tsx', { 'react/jsx-runtime': runtime });
  const curriculum = load('curriculum.ts');
  const framework = load('learningFramework.ts');
  const domain = load('shapeLearning.ts', { './curriculum': curriculum });
  const inquiryModule = load('MathInquiry.tsx', {
    react, 'react/jsx-runtime': runtime, './LearningJudgment': judgmentModule,
    './ExplanationFeedbackPanel': { ExplanationFeedback: 'ExplanationFeedback' },
    './explanationFeedback': load('explanationFeedback.ts'),
    './curriculum': curriculum, './learningFramework': framework,
    './inquiryFeedback': load('inquiryFeedback.ts'),
    './learningEvidenceStorage': load('learningEvidenceStorage.ts'),
  });
  const { ShapeLessonSteps } = load('ShapeLessonSteps.tsx', {
    react, 'react/jsx-runtime': runtime, './LearningJudgment': judgmentModule,
    './MathInquiry': inquiryModule,
    './ExplanationFeedbackPanel': { ExplanationFeedback: 'ExplanationFeedback' },
    './shapeLearning': domain,
    './learningFramework': framework,
    './curriculum': curriculum,
    './shapeLessonSteps.css': {},
  });
  lesson = domain.getShapeLesson(shape, lessonIndex);
  const onStageChange = value => { stage = value; };

  function expand(node) {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (node.type === inquiryModule.MathInquiryPanel || node.type === judgmentModule.LearningJudgmentFields) return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props?.children) } };
  }
  function render() {
    let count = 0;
    do {
      dirty = false;
      inquiry = scope('inquiry', () => inquiryModule.useMathInquiry(
        `${shape} 단계 학습`, { id:lesson.id, lessonId: lesson.id, taskKind, sequence: lesson.sequence, circleCenter: lesson.circleCenter, supportMode,
          support:taskKind === 'transfer' && supportMode === 'challenge' ? 'independent' : supportMode },
        domain.shapeLessonFields(lesson), ['mission'], 0, false,
      ));
      tree = scope('steps', () => ShapeLessonSteps({
        lesson, inquiry, locked, onStageChange, supportMode, canAdvance,
        advanceBlockedReason: '명령을 수정하고 다시 실행해 확인하세요.',
        execution: jsx('button', { children: 'DT에서 실행', onClick: () => inquiry.begin('mission'), disabled: locked }),
        observation: jsx('p', { children: '실행 궤적과 시작 자세 복귀 확인' }),
        onNewCondition: () => { advanced++; lessonIndex = (lessonIndex + 1) % 6; lesson = domain.getShapeLesson(shape, lessonIndex); },
        onEditProgram: () => {},
      }));
      tree = expand(tree);
      while (effects.length) effects.shift()();
      assert.ok(++count < 20, 'Lesson render should settle');
    } while (dirty);
    return tree;
  }
  function find(predicate, description = 'UI element') {
    const item = nodes(tree).find(predicate);
    assert.ok(item, `${description} missing: ${textOf(tree)}`);
    return item;
  }
  const button = label => find(node => node.type === 'button' && (node.props['aria-label'] === label || textOf(node) === label), label).props;
  const input = label => find(node => ['input', 'select', 'textarea'].includes(node.type) && node.props['aria-label'] === label, label).props;
  const fields = stageName => lesson[stageName];
  function setField(field, value) { input(field.label).onChange({ target: { value: String(value) } }); render(); }
  function fill(stageName, answers = {}) {
    for (const field of fields(stageName)) setField(field, answers[field.key] ?? field.answer);
  }
  function click(label) { const props = button(label); assert.equal(Boolean(props.disabled), false, `${label} is disabled`); props.onClick(); render(); }
  const nextConcept = () => click('확인하고 다음');
  const nextCalculation = () => click('확인하고 다음');
  function setReason(value = '두 축의 좌표 변화를 사용해 길이와 닫힌 경로를 판단했다.') {
    input('예측 근거').onChange({ target: { value } }); render();
  }
  function complete(answers = {}) {
    fill('concept', answers); nextConcept();
    fill('relations', answers); nextCalculation();
    fill('calculation', answers); fill('prediction', answers); setReason(); click('예측 저장 · 실행 준비');
  }
  render();
  return {
    observe() { if (inquiry.detailedReflection) input('관찰한 경로의 수학적 표현').onChange({ target: { value: 'P1→P2: ΔX=100, ΔY=0 mm인 구간을 관찰했다.' } }); render(); click('관찰 완료 · 비교하기'); },
    render, button, input, fields, setField, fill, click, nextConcept, nextCalculation, setReason, complete,
    get lesson() { return lesson; }, get inquiry() { return inquiry; }, get stage() { return stage; },
    get text() { return textOf(tree); }, get tree() { return tree; }, get storage() { return storage; }, get advanced() { return advanced; },
    expected: () => domain.shapeLessonExpected(lesson),
    compare: () => inquiryModule.compareInquiry(inquiry.record),
    setCanAdvance(value) { canAdvance = value; render(); },
    setLocked(value) { locked = value; render(); },
    setSupportMode(value) { supportMode = value; render(); },
    changeShape(value) { shape = value; lessonIndex = 0; lesson = domain.getShapeLesson(shape, 0); render(); },
    changeLesson(index) { lessonIndex = index; lesson = domain.getShapeLesson(shape, index); render(); },
    editSequence() {
      const sequence = clone(lesson.sequence);
      sequence[1].coords.x += 10;
      lesson = domain.getShapeLesson(shape, lessonIndex, sequence, lesson.circleCenter);
      render();
    },
    unmount() { for (const slots of scopes.values()) for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('practice records a learner observation acknowledgement and decision without inventing an explanation', () => {
  const app = mountLesson('삼각형', 0, 'guided', 'practice');
  app.complete(); app.click('DT에서 실행'); app.inquiry.finish('DT 경로 완료', app.expected(), {}); app.render();
  assert.equal(app.stage, 5); assert.doesNotMatch(app.text, /관찰한 경로를 좌표나 변화량/);
  app.observe(); assert.equal(app.inquiry.record.observations.at(-1).text, '');
  assert.equal(app.inquiry.record.observations.at(-1).acknowledged, true);
  assert.equal(app.button('비교 확인 저장').disabled, true);
  app.input('비교 후 내 판단').onChange({target:{value:'maintain'}}); app.render(); app.click('비교 확인 저장');
  assert.equal(app.inquiry.reviewed, true);
  assert.equal(app.inquiry.record.reflections.at(-1).review, 'learner');
  assert.equal(app.inquiry.record.reflections.at(-1).text, '');
  assert.equal(app.inquiry.record.reflections.at(-1).assessment, undefined);
  app.input('비교 후 내 판단').onChange({target:{value:'revise'}}); app.render();
  assert.equal(app.inquiry.reviewed, false); assert.equal(app.button('비교 확인 저장').disabled, true);
  assert.ok(app.input('결과 해석')); app.unmount();
});

test('transfer requires a short comparison reason but does not require copying the observation or choosing a support source', () => {
  const app = mountLesson('삼각형', 1, 'challenge', 'transfer');
  app.complete(); assert.equal(app.inquiry.record.independentPrediction, true);
  app.click('DT에서 실행'); app.inquiry.finish('DT 경로 완료', app.expected(), {}); app.render(); app.observe();
  app.input('비교 후 내 판단').onChange({target:{value:'maintain'}}); app.render();
  assert.equal(app.button('내 설명 저장').disabled, true);
  assert.doesNotMatch(app.text, /가장 참고한 정보/);
  app.input('결과 해석').onChange({target:{value:'세 변의 변화량을 더해 ΔX=0, ΔY=0이므로 시작점으로 돌아왔다.'}}); app.render();
  app.click('내 설명 저장'); assert.ok(app.inquiry.record.reflections.at(-1).text);
  assert.equal(app.inquiry.record.reflections.at(-1).judgment.basis, ''); app.unmount();
});

test('changing support after viewing a hint cannot erase pre-submission guidance', () => {
  const app = mountLesson('삼각형', 1, 'challenge', 'transfer');
  const question = app.fields('concept')[0];
  app.click(`${question.label} 힌트`); app.setSupportMode('guided'); app.setSupportMode('challenge');
  app.complete(); assert.equal(app.inquiry.record.independentPrediction, false);
  assert.ok(app.inquiry.record.feedbackEvents.some(event => event.kind === 'hint')); app.unmount();
});

for (const shape of ['사각형', '삼각형', '동그라미']) test(`${shape}: basics reveal one activity, reject wrong answers, and require a reason before execution`, () => {
  const app = mountLesson(shape);
  assert.equal(app.stage, 1);
  assert.equal(app.inquiry.ready, false);
  assert.equal(nodes(app.tree).some(node => node.props?.['aria-label'] === app.lesson.calculation[0].label), false);
  app.nextConcept();
  assert.equal(app.stage, 1);
  assert.ok(app.text.includes('답을 입력해 주세요.'));

  const concept = app.lesson.concept.find(field => field.options.length > 1);
  app.fill('concept');
  app.setField(concept, concept.options.find(option => option.value !== concept.answer).value);
  app.nextConcept();
  assert.equal(app.stage, 1);
  assert.equal(app.input(concept.label)['aria-invalid'], true);
  app.setField(concept, concept.answer); app.nextConcept();
  assert.equal(app.stage, 2);
  assert.equal(nodes(app.tree).some(node => node.props?.['aria-label'] === concept.label), false);

  app.fill('relations'); app.nextCalculation();
  assert.equal(app.stage, 3);
  app.fill('calculation');
  const numeric = app.lesson.calculation[0];
  app.setField(numeric, Number(numeric.answer) + 20); app.click('예측 저장 · 실행 준비');
  assert.equal(app.stage, 3);
  assert.equal(app.input(numeric.label)['aria-invalid'], true);
  app.setField(numeric, numeric.answer);
  app.fill('prediction'); app.click('예측 저장 · 실행 준비');
  assert.equal(app.inquiry.ready, false);
  assert.equal(app.stage, 3);
  app.setReason(); app.click('예측 저장 · 실행 준비');
  assert.equal(app.stage, 4);
  assert.equal(app.inquiry.ready, true);
  assert.deepEqual(app.inquiry.record.prediction, app.inquiry.draft);
  assert.equal(app.inquiry.record.runs.length, 0);
  app.unmount();
});

test('challenge rejects blank, nonfinite and invalid choices without requiring a correct prediction', () => {
  const app = mountLesson('삼각형', 2, 'challenge');
  assert.notEqual(app.lesson.difficulty, '기초');
  app.fill('concept'); app.nextConcept();
  app.fill('relations');
  const relation = app.lesson.relations[0];
  app.setField(relation, 'not-an-option'); app.nextCalculation();
  assert.equal(app.stage, 2);
  app.setField(relation, relation.options.find(option => option.value !== relation.answer).value);
  app.nextCalculation();
  assert.equal(app.stage, 3);
  app.fill('calculation'); app.fill('prediction'); app.setReason();
  const numeric = app.lesson.calculation[0];
  for (const invalid of ['', ' ', 'NaN', 'Infinity', '-Infinity']) {
    app.setField(numeric, invalid); app.click('예측 저장 · 실행 준비');
    assert.equal(app.stage, 3);
    assert.equal(app.inquiry.ready, false);
  }
  app.setField(numeric, Number(numeric.answer) + 10);
  app.fill('prediction'); app.setReason(); app.click('예측 저장 · 실행 준비');
  assert.equal(app.inquiry.ready, true);
  assert.equal(app.inquiry.record.prediction[numeric.key], String(Number(numeric.answer) + 10));
  app.unmount();
});

for (const shape of ['사각형', '삼각형', '동그라미']) test(`${shape}: challenge compares a wrong first prediction and preserves it after correction and revision`, () => {
  const app = mountLesson(shape, 2, 'challenge'), numeric = app.lesson.calculation[0];
  const wrong = String(Number(numeric.answer) + 25);
  app.complete({ [numeric.key]: wrong });
  const initialId = app.inquiry.record.id;
  assert.equal(app.inquiry.ready, true);
  assert.equal(app.inquiry.begin('mission'), true); app.render();
  app.inquiry.finish('도형을 완성하고 시작 자세로 복귀했습니다.', app.expected(), { closed: true }); app.render();
  assert.equal(app.inquiry.observed, true);
  assert.equal(app.inquiry.checked, false);
  assert.equal(app.compare().find(row => row.key === numeric.key).matched, false);
  app.inquiry.setReviewDraft({ [numeric.key]: String(numeric.answer) }); app.render();
  app.inquiry.reviewAnswers(); app.render();
  assert.equal(app.inquiry.checked, true);
  assert.equal(app.inquiry.record.prediction[numeric.key], wrong);
  assert.equal(app.inquiry.record.answerReviews[0].answers[numeric.key], String(numeric.answer));

  app.click('과제 이해 다시 편집');
  assert.equal(app.stage, 1);
  assert.equal(app.inquiry.ready, false);
  assert.equal(app.inquiry.draft[numeric.key], wrong);
  app.complete();
  assert.notEqual(app.inquiry.record.id, initialId);
  assert.equal(app.inquiry.record.previousId, initialId);
  assert.equal(app.inquiry.record.attemptKind, 'revision');
  const records = JSON.parse(app.storage.get('physical-ai-inquiry-evidence-v1'));
  assert.equal(records.length, 2);
  assert.equal(records[0].prediction[numeric.key], wrong);
  assert.equal(records[0].runs.length, 1);
  assert.equal(records[1].prediction[numeric.key], String(numeric.answer));
  app.unmount();
});

test('reopening a basic checkpoint invalidates execution and requires later checkpoints again', () => {
  const app = mountLesson(); app.complete();
  app.click('표현·예측 다시 편집');
  assert.equal(app.inquiry.ready, false);
  assert.equal(app.stage, 3);
  const numeric = app.lesson.calculation[0];
  app.setField(numeric, Number(numeric.answer) + 10); app.click('예측 저장 · 실행 준비');
  assert.equal(app.stage, 3);
  assert.equal(app.inquiry.ready, false);
  app.setField(numeric, numeric.answer); app.click('예측 저장 · 실행 준비');
  assert.equal(app.inquiry.ready, true);
  assert.equal(app.inquiry.record.attemptKind, 'revision');
  app.unmount();
});

test('a new condition clears answers and approvals while retaining the previous saved evidence', () => {
  const app = mountLesson(); app.complete();
  const initialId = app.inquiry.record.id;
  app.changeLesson(1);
  assert.equal(app.stage, 1);
  assert.equal(app.inquiry.ready, false);
  assert.deepEqual(app.inquiry.draft, {});
  assert.equal(app.inquiry.reason, '');
  app.complete();
  assert.equal(app.inquiry.record.attemptKind, 'changed-condition');
  assert.equal(app.inquiry.record.previousId, initialId);
  assert.equal(JSON.parse(app.storage.get('physical-ai-inquiry-evidence-v1')).length, 2);
  app.unmount();
});

test('editing coordinates within the same lesson resets checkpoints and interrupts the previous observation', () => {
  const app = mountLesson(); app.complete();
  const initialId = app.inquiry.record.id, lessonId = app.lesson.id;
  app.inquiry.begin('mission'); app.render();
  app.editSequence();
  assert.equal(app.lesson.id, lessonId);
  assert.equal(app.stage, 1);
  assert.equal(app.inquiry.ready, false);
  assert.equal(app.inquiry.observed, false);
  assert.deepEqual(app.inquiry.draft, {});
  const records = JSON.parse(app.storage.get('physical-ai-inquiry-evidence-v1'));
  assert.equal(records[0].id, initialId);
  assert.equal(records[0].runs[0].status, 'stopped');
  app.complete();
  assert.equal(app.inquiry.record.attemptKind, 'changed-condition');
  assert.equal(app.inquiry.record.previousId, initialId);
  app.unmount();
});

test('running or hardware-locked lessons disable all checkpoint changes and preserve the saved prediction', () => {
  const app = mountLesson(); app.fill('concept'); app.setLocked(true);
  const next = app.button('확인하고 다음');
  assert.equal(next.disabled, true);
  next.onClick(); app.render();
  assert.equal(app.stage, 1);
  assert.ok(nodes(app.tree).filter(node => ['input', 'select', 'textarea', 'button'].includes(node.type)).every(node => node.props.disabled));
  app.setLocked(false); app.complete();
  const record = clone(app.inquiry.record);
  app.setLocked(true);
  const reopen = app.button('과제 이해 다시 편집');
  assert.equal(reopen.disabled, true);
  reopen.onClick(); app.render();
  assert.equal(app.inquiry.ready, true);
  assert.deepEqual(clone(app.inquiry.record), record);
  app.unmount();
});

for (const shape of ['사각형', '삼각형', '동그라미']) test(`${shape}: support mode is independent of difficulty and changing it invalidates approvals`, () => {
  const app = mountLesson(shape, 4, 'guided');
  assert.equal(app.lesson.difficulty, '심화');
  app.fill('concept');
  const field = app.lesson.concept[0];
  const wrong = field.options.find(option => option.value !== field.answer).value;
  app.setField(field, wrong);
  app.nextConcept();
  assert.equal(app.stage, 1, 'Guided mode checks even advanced questions');
  app.setSupportMode('challenge');
  assert.equal(app.stage, 1);
  assert.deepEqual(app.inquiry.draft, {});
  app.complete({ [field.key]: wrong });
  assert.equal(app.inquiry.ready, true, 'Challenge mode retains the learner’s wrong judgment');
  const previous = app.inquiry.record.id;
  app.setSupportMode('guided');
  assert.equal(app.stage, 1);
  assert.equal(app.inquiry.ready, false);
  assert.equal(app.inquiry.observed, false);
  assert.deepEqual(app.inquiry.draft, {});
  assert.equal(JSON.parse(app.storage.get('physical-ai-inquiry-evidence-v1'))[0].id, previous);
  app.unmount();
});

for (const shape of ['사각형', '삼각형', '동그라미']) test(`${shape}: challenge mode permits a wrong prediction in a basic lesson`, () => {
  const app = mountLesson(shape, 0, 'challenge');
  assert.equal(app.lesson.difficulty, '기초');
  const numeric = app.lesson.calculation[0];
  app.complete({ [numeric.key]: Number(numeric.answer) + 10 });
  assert.equal(app.stage, 4);
  assert.equal(app.inquiry.ready, true);
  assert.notEqual(app.inquiry.record.prediction[numeric.key], String(numeric.answer));
  app.unmount();
});

for (const shape of ['사각형', '삼각형', '동그라미']) test(`${shape}: switching shapes clears the current approvals and inputs`, () => {
  const app = mountLesson(shape);
  app.complete();
  app.inquiry.begin('mission'); app.render();
  const id = app.inquiry.record.id;
  app.changeShape(shape === '사각형' ? '동그라미' : '사각형');
  assert.equal(app.stage, 1);
  assert.equal(app.inquiry.ready, false);
  assert.equal(app.inquiry.observed, false);
  assert.deepEqual(app.inquiry.draft, {});
  const saved = JSON.parse(app.storage.get('physical-ai-inquiry-evidence-v1')).find(record => record.id === id);
  assert.equal(saved.runs[0].status, 'stopped');
  app.unmount();
});

function assertOneActivity(app, stage) {
  assert.equal(app.stage, stage);
  assert.equal(nodes(app.tree).filter(node => node.props?.className === 'shape-step-active').length, 1,
    'Exactly one active activity is rendered');
  assert.equal(nodes(app.tree).find(node => node.props?.['data-shape-stage'] !== undefined).props['data-shape-stage'], stage);
  if (stage > 3) {
    for (const question of [...app.lesson.concept, ...app.lesson.relations, ...app.lesson.calculation, ...app.lesson.prediction]) {
      assert.equal(nodes(app.tree).some(node => ['input','select'].includes(node.type) && node.props?.['aria-label'] === question.label), false,
        'Completed input controls are absent from the active activity');
    }
  }
}

function explainAndContinue(app) {
  app.input('비교 후 내 판단').onChange({ target: { value: 'maintain' } }); app.render();
  app.input('가장 참고한 정보').onChange({ target: { value: 'comparison' } }); app.render();
  app.input('결과 해석').onChange({ target: { value: '좌표의 차이를 이용해 예측하고 실행 경로와 비교했다. 시작점과 끝점을 구분해 확인했다.' } });
  app.render();
  app.click('내 설명 저장');
  if (!app.inquiry.reviewed) app.click('교사 검토용으로 남기고 계속');
  assert.equal(app.inquiry.reviewed, true);
  assert.equal(app.stage, 6, 'Saving a reflection does not silently skip the comparison acknowledgement');
  app.click('비교 완료 · 다음');
  assertOneActivity(app, 7);
}

for (const mode of ['guided', 'challenge']) test(`${mode}: all three shapes expose identical controls through the full seven-stage cycle`, () => {
  let reference;
  for (const shape of ['사각형', '삼각형', '동그라미']) {
    const app = mountLesson(shape, 0, mode), controls = [];
    const capture = stage => {
      assertOneActivity(app, stage);
      const active = nodes(app.tree).find(node => node.props?.className === 'shape-step-active');
      controls.push(nodes(active).filter(node => node.type === 'button' && !node.props['aria-label']?.endsWith('힌트')).map(textOf));
    };
    capture(1); app.fill('concept'); app.nextConcept();
    capture(2); app.fill('relations'); app.nextCalculation();
    capture(3); app.fill('calculation'); app.fill('prediction'); app.setReason(); app.click('예측 저장 · 실행 준비');
    capture(4);
    assert.equal(nodes(app.tree).some(node => node.props?.className === 'shape-step-observation'), false);
    app.click('DT에서 실행');
    app.inquiry.finish('도형을 닫고 실행 전 자세로 돌아왔습니다.', app.expected(), { closed: true }); app.render();
    capture(5);
    assert.equal(nodes(app.tree).some(node => node.props?.className === 'shape-step-execution'), false);
    assert.equal(nodes(app.tree).some(node => node.type === 'table'), false, 'Comparison is shown only after observation');
    app.observe();
    capture(6);
    assert.equal(nodes(app.tree).some(node => node.type === 'table'), true);
    explainAndContinue(app); capture(7);
    assert.equal(nodes(app.tree).some(node => node.type === 'table'), false);
    if (reference) assert.deepEqual(controls, reference, 'Shape changes content without changing interaction controls');
    else reference = controls;
    const saved = app.inquiry.record.id;
    app.click('다음 과제');
    assert.equal(app.advanced, 1);
    assertOneActivity(app, 1);
    assert.equal(app.inquiry.ready, false);
    assert.equal(app.inquiry.observed, false);
    assert.deepEqual(app.inquiry.draft, {});
    const history = JSON.parse(app.storage.get('physical-ai-inquiry-evidence-v1'));
    assert.equal(history[0].id, saved);
    assert.equal(history[0].reflections.length, 1);
    app.unmount();
  }
});

for (const shape of ['사각형', '삼각형', '동그라미']) test(`${shape}: comparison UI corrects a wrong prediction and revision requires another observation`, () => {
  const app = mountLesson(shape, 0, 'challenge'), numeric = app.lesson.calculation[0];
  const wrong = String(Number(numeric.answer) + 25);
  app.complete({ [numeric.key]: wrong });
  const initialId = app.inquiry.record.id;
  app.click('DT에서 실행');
  app.inquiry.finish('도형을 닫고 복귀했습니다.', app.expected(), { closed: true }); app.render();
  assertOneActivity(app, 5); app.observe();
  assertOneActivity(app, 6);
  assert.equal(nodes(app.tree).some(node => node.props?.['aria-label'] === '결과 해석'), false);
  assert.equal(app.inquiry.checked, false);
  app.input(`다시 판단 ${numeric.label}`).onChange({ target: { value: String(numeric.answer) } }); app.render();
  if(shape==='사각형'){
    // Execution-based diagnosis: the executed P1 → P2 edge is 125 mm, not the 100 mm condition.
    const panel=nodes(app.tree).find(node=>node.type==='SquareDiagnosisPanel');
    assert.ok(panel,'diagnosis panel shown after the DT run');
    assert.equal(panel.props.diagnosis.type,'arithmetic');
    assert.equal(panel.props.diagnosis.edge,'P1 → P2');
    assert.equal(panel.props.plan.level,'task');
    assert.equal(panel.props.causeRequired,true);
    assert.equal(app.inquiry.record.mismatchDiagnoses[0].type,'arithmetic');
    assert.equal(Boolean(app.button('이유 저장 · 예측 고쳐 다시 실행').disabled),true,'cause is required before revising');
    assert.equal(app.text.includes(`${numeric.label}${wrong} mm차이 있음${numeric.answer} mm`),false,'mismatched answer is not revealed');
    panel.props.onCauseChange('P1의 X에 가로 길이 100이 아니라 125를 더했다.'); app.render();
    app.click('이유 저장 · 예측 고쳐 다시 실행');
    assertOneActivity(app,3);
    assert.equal(app.inquiry.ready,false);
    assert.equal(app.inquiry.checked,false);
    const saved=JSON.parse(app.storage.get('physical-ai-inquiry-evidence-v1'))[0].mismatchDiagnoses[0];
    assert.equal(saved.causeExplanation,'P1의 X에 가로 길이 100이 아니라 125를 더했다.');
    app.fill('calculation'); app.fill('prediction'); app.click('예측 저장 · 실행 준비');
    assert.notEqual(app.inquiry.record.id,initialId);
    assert.equal(app.inquiry.record.previousId,initialId);
    assert.equal(app.inquiry.record.prediction[numeric.key],String(numeric.answer));
    assertOneActivity(app,4);
    app.click('DT에서 실행');
    app.inquiry.finish('수정한 좌표를 새 DT에서 확인했습니다.',app.expected(),{closed:true});app.render();
    assertOneActivity(app,5);
    const history=JSON.parse(app.storage.get('physical-ai-inquiry-evidence-v1'));
    assert.equal(history.length,2);
    assert.equal(history[0].prediction[numeric.key],wrong);
    assert.equal(history[1].runs.length,1);
    return;
  }
  app.click('수정한 판단 확인');
  assert.equal(app.inquiry.checked, true);
  assert.equal(app.inquiry.record.prediction[numeric.key], wrong);
  assert.equal(app.inquiry.record.answerReviews[0].answers[numeric.key], String(numeric.answer));
  explainAndContinue(app);
  app.click('예측 수정 · 재실행');
  assertOneActivity(app, 1);
  assert.equal(app.inquiry.ready, false);
  app.complete();
  assert.equal(app.inquiry.record.previousId, initialId);
  assert.equal(app.inquiry.record.attemptKind, 'revision');
  assertOneActivity(app, 4);
  app.click('DT에서 실행');
  app.inquiry.finish('수정한 예측으로 다시 실행했습니다.', app.expected(), { closed: true }); app.render();
  assertOneActivity(app, 5);
  const history = JSON.parse(app.storage.get('physical-ai-inquiry-evidence-v1'));
  assert.equal(history.length, 2);
  assert.equal(history[0].prediction[numeric.key], wrong);
  assert.equal(history[0].answerReviews.length, 1);
  assert.equal(history[1].prediction[numeric.key], String(numeric.answer));
  assert.equal(history[1].runs.length, 1);
  app.unmount();
});

for (const shape of ['사각형', '삼각형', '동그라미']) test(`${shape}: an unavailable IK run stays at execution and requires an actual run for observation`, () => {
  const app = mountLesson(shape);
  app.complete(); app.click('DT에서 실행');
  app.inquiry.finish('작업영역 밖이라 실행하지 못했습니다.', {}, { reason: 'unreachable' }, 'unavailable'); app.render();
  assert.equal(app.inquiry.observed, true, 'The inquiry retains its generic unavailable evidence');
  assertOneActivity(app, 4);
  assert.equal(nodes(app.tree).some(node => node.props?.className === 'shape-step-observation'), false);
  assert.equal(app.text.includes('4. 실행·측정 완료'), false);
  assert.equal(nodes(app.tree).some(node => node.type === 'button' && textOf(node) === '다음 과제'), false);
  app.click('예측 수정');
  assertOneActivity(app, 1);
  app.complete(); app.click('DT에서 실행');
  app.inquiry.finish('도형을 완성하고 실행 전 자세로 복귀했습니다.', app.expected(), { closed: true }); app.render();
  assertOneActivity(app, 5);
  const history = JSON.parse(app.storage.get('physical-ai-inquiry-evidence-v1'));
  assert.equal(history[0].runs[0].status, 'unavailable');
  assert.equal(history[1].runs[0].status, 'completed');
  app.unmount();
});

test('a reviewed diagnosis cannot advance while the parent requires a repaired program and rerun', () => {
  const app = mountLesson('사각형', 5);
  app.setCanAdvance(false);
  app.complete(); app.click('DT에서 실행');
  app.inquiry.finish('마지막 점으로 돌아왔지만 목표 경로와 다릅니다.', app.expected(), { closed: true }); app.render();
  app.observe(); explainAndContinue(app);
  assert.equal(app.button('다음 과제').disabled, true);
  app.button('다음 과제').onClick(); app.render();
  assert.equal(app.advanced, 0, 'The callback is guarded as well as visibly disabled');
  assertOneActivity(app, 7);
  assert.ok(app.text.includes('명령을 수정하고 다시 실행해 확인하세요.'));
  app.setCanAdvance(true); app.click('다음 과제');
  assert.equal(app.advanced, 1); assertOneActivity(app, 1); app.unmount();
});

for (const shape of ['사각형', '삼각형', '동그라미']) test(`${shape}: every task requires the full point plan, including closure and arc via points`, () => {
  for (let index = 0; index < 6; index++) {
    const app = mountLesson(shape, index, 'challenge');
    assert.equal(app.text.includes('현재 단계 1/7 · 과제 이해'), true);
    app.fill('concept'); app.nextConcept();
    assert.equal(app.text.includes('현재 단계 2/7 · 수학 구조화'), true);
    for (const field of app.lesson.calculation) {
      assert.equal(nodes(app.tree).some(node => node.type === 'input' && node.props['aria-label'] === field.label), false,
        `${field.key}: calculations belong to expression/prediction, not the relation stage`);
    }
    app.fill('relations'); app.nextCalculation();
    assert.equal(app.text.includes('현재 단계 3/7 · 표현·예측'), true);
    const table = nodes(app.tree).find(node => node.props?.className === 'shape-step-coordinate-table');
    assert.ok(table, 'The complete path uses one compact coordinate table');
    if (shape === '동그라미') {
      const rowKinds = nodes(table).filter(node => node.type === 'tr' && node.props['data-point-kind']).map(node => node.props['data-point-kind']);
      assert.deepEqual(rowKinds, ['via', 'vertex', 'via', 'vertex', 'via', 'vertex', 'via', 'closure'], 'Each arc via point precedes its endpoint');
      const radius = app.lesson.calculation.find(question => question.key === app.lesson.pathPlan.radiusKey);
      const traversal = nodes(app.tree);
      assert.ok(traversal.findIndex(node => node.props?.['aria-label'] === radius.label) < traversal.indexOf(table), 'Compute the radius before the points');
    }
    assert.equal(nodes(table).filter(node => node.type === 'input').length, app.lesson.pathPlan.rows.length * 2);
    assert.equal(app.lesson.pathPlan.rows.filter(row => row.kind === 'closure').length, 1);
    assert.equal(app.lesson.pathPlan.rows.filter(row => row.kind === 'via').length, shape === '동그라미' ? 4 : 0);
    const visibleKeys = new Set(app.lesson.pathPlan.rows.flatMap(row => [row.xKey, row.yKey]));
    assert.ok([...visibleKeys].every(key => app.lesson.pathPlan.requiredKeys.includes(key)));
    app.fill('calculation'); app.fill('prediction'); app.setReason();
    for (const key of visibleKeys) {
      const field = app.lesson.calculation.find(question => question.key === key);
      app.setField(field, ''); app.click('예측 저장 · 실행 준비');
      assert.equal(app.stage, 3, `${shape} task ${index + 1}: ${key} cannot be skipped`);
      assert.equal(app.inquiry.ready, false);
      assert.equal(nodes(app.tree).some(node => node.type === 'button' && textOf(node) === 'DT에서 실행'), false);
      app.setField(field, field.answer);
    }
    app.click('예측 저장 · 실행 준비');
    assert.equal(app.stage, 4);
    assert.equal(app.inquiry.ready, true);
    assert.ok(app.text.includes(shape==='사각형'
      ?'내가 입력한 XY 좌표가 DT 실행 경로에 반영됩니다.'
      :'예측 좌표는 비교에 사용하며, 로봇은 실행 명령의 좌표로 움직입니다.'));
    app.unmount();
  }
});
