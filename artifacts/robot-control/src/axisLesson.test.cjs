// Run from artifacts/robot-control: node --test src/axisLesson.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
function load(source, deps = {}) {
  const exports = {};
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', 'require', code)(exports, name => {
    assert.ok(name in deps, `Unexpected dependency: ${name}`);
    return deps[name];
  });
  return exports;
}
const curriculum = load(read('curriculum.ts'));
const axes = load(read('axisLesson.ts'), { './curriculum': curriculum });
const home = { x:350, y:0, z:0, r:0 };
const final = axes.AXIS_INDEPENDENT_TASK;
const correct = { x:0, y:-1, z:0 };
const attempt = (prediction = correct, task = final, extra = {}) => ({
  prediction: { ...prediction }, from: { ...home }, to: axes.axisTarget(home, task),
  view: task.transferView, reasoning: '+Y와 반대이므로 Y는 감소하고 다른 두 좌표는 유지된다.', ...extra,
});
const independentEvidence = (attempts = [attempt()]) => ({ attempts, correction: { ...correct }, revisedReasoning: '' });

test('feedback distinguishes wrong axis, reversed sign, unnecessary changes, and missing movement', () => {
  const to = { ...home, x:400 };
  const kinds = p => axes.diagnoseAxisPrediction(p, home, to).map(d => d.kind);
  assert.deepEqual(kinds({x:0,y:1,z:0}), ['axis']);
  assert.deepEqual(kinds({x:-1,y:0,z:0}), ['sign']);
  assert.deepEqual(kinds({x:1,y:-1,z:1}), ['fixed']);
  assert.deepEqual(kinds({x:0,y:0,z:0}), ['missing']);
  assert.deepEqual(kinds({x:-1,y:1,z:0}), ['fixed','sign']);
  assert.deepEqual(kinds({x:1,y:0,z:0}), []);
  assert.deepEqual(kinds({x:null,y:0,z:0}), ['unanswered']);
  assert.match(axes.axisReasonFeedback('one-joint'), /관절/);
  assert.match(axes.axisReasonFeedback('camera'), /카메라/);
  assert.notEqual(axes.axisReasonFeedback('camera'), axes.axisReasonFeedback('one-joint'));
});

test('all 27 predictions for every sign/axis receive feedback exactly when incorrect', () => {
  for (const task of axes.AXIS_TASKS) {
    const to = axes.axisTarget(home, task);
    for (const x of [-1,0,1]) for (const y of [-1,0,1]) for (const z of [-1,0,1]) {
      const p = {x,y,z};
      assert.equal(axes.diagnoseAxisPrediction(p,home,to).length === 0, axes.axisPredictionMatches(p,home,to), `${task.id}: ${JSON.stringify(p)}`);
    }
  }
});

test('support fades after the introduction and ends with a new movement condition and view', () => {
  assert.deepEqual(axes.AXIS_LESSON_TASKS.map(axes.axisLearningMode), ['guided','practice','practice','practice','practice','practice','independent']);
  assert.equal(axes.AXIS_LESSON_TASKS.at(-1), final);
  assert.equal(new Set(axes.AXIS_LESSON_TASKS.map(t=>t.id)).size, 7);
  assert.notEqual(final.view, final.transferView);
  assert.notEqual(axes.AXIS_TASKS.at(-1).view, final.transferView);
  assert.ok(!axes.AXIS_TASKS.some(t => t.axis===final.axis && t.sign===final.sign && t.distance===final.distance));
});

test('practice completes after observation and corrected judgment, without repeated reason quizzes', () => {
  const task = axes.AXIS_TASKS[1];
  const wrong = attempt({x:0,y:1,z:0}, task);
  assert.equal(axes.completeAxisPractice(task, [], correct), null);
  assert.equal(axes.completeAxisPractice(task, [wrong], {x:0,y:1,z:0}), null);
  assert.equal(axes.completeAxisPractice(task, [wrong], {x:0,y:-1,z:null}), null);
  assert.equal(axes.completeAxisPractice(task, [{...wrong,to:{...wrong.to,y:-1}}], correct), null);
  assert.equal(axes.completeAxisPractice(final, [attempt()], correct), null);
  const result = axes.completeAxisPractice(task, [wrong], correct);
  assert.equal(result.mode, 'practice');
  assert.equal(result.reasonAttempts, 0);
  assert.equal(result.attempts[0].prediction.y, 1);
  assert.equal(result.correctionPrediction.y, -1);
});

test('independent completion requires actual full motion, the changed view and a pre-execution explanation', () => {
  for (const data of [
    independentEvidence([]),
    independentEvidence([attempt(correct, final, {view:final.view})]),
    independentEvidence([attempt(correct, final, {view:'free'})]),
    independentEvidence([attempt(correct, final, {reasoning:'  '})]),
    independentEvidence([attempt(correct, final, {to:{...home,y:-10}})]),
    independentEvidence([attempt(correct, final, {to:{...home,y:-25,r:10}})]),
    independentEvidence([attempt(correct, final, {to:{...home,y:NaN}})]),
    { ...independentEvidence(), correction:{x:0,y:-1,z:null} },
  ]) assert.equal(axes.completeAxisIndependent(final, data), null);
  const result = axes.completeAxisIndependent(final, independentEvidence());
  assert.equal(result.independentResult, 'first-match');
  assert.equal(result.source, 'dt');
  assert.equal(result.explanationReview, 'teacher');
  // Presence is checked; the software must not assert that prose is semantically correct.
  const prose = axes.completeAxisIndependent(final, independentEvidence([attempt(correct, final, {reasoning:'모르겠습니다.'})]));
  assert.equal(prose.explanationReview, 'teacher');
  assert.equal(prose.explanation, '모르겠습니다.');
});

test('feedback and retries cannot rewrite the first independent misconception or its explanation', () => {
  const data = independentEvidence([attempt({x:0,y:1,z:0})]);
  assert.equal(axes.completeAxisIndependent(final, data), null, 'A misconception requires a written revision');
  data.attempts.push(attempt());
  data.revisedReasoning = '화면 방향 대신 로봇의 +Y와 비교해서 부호를 고쳤다.';
  const record = axes.completeAxisIndependent(final, data);
  assert.equal(record.independentResult, 'revised');
  data.attempts[0].prediction.y = -1;
  data.attempts[0].reasoning = 'changed';
  data.attempts[0].from.x = -999;
  data.correction.y = 1;
  assert.equal(record.attempts[0].prediction.y, 1);
  assert.notEqual(record.attempts[0].reasoning, 'changed');
  assert.equal(record.attempts[0].from.x, 350);
  assert.equal(record.correctionPrediction.y, -1);
  assert.equal(record.explanationReview, 'teacher');
});

test('the independent MoveL condition is reachable after the course and after HOME with actual FK/IK', () => {
  const app = ts.createSourceFile('App.tsx', read('App.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = app.statements.filter(s =>
    (ts.isFunctionDeclaration(s) && ['fkMG400','ikMG400'].includes(s.name?.text)) ||
    (ts.isVariableStatement(s) && s.declarationList.declarations.some(d => ['ARM_L1','COORD_OX','COORD_OZ'].includes(d.name.getText(app))))
  ).map(s => s.getText(app)).join('\n');
  const core = load(declarations + '\nexport {fkMG400,ikMG400,COORD_OX,COORD_OZ};');
  const model = {
    fk(j) { const p=core.fkMG400(j.j1,j.j2,j.j3); return {x:p.x+core.COORD_OX,y:p.y,z:p.z+core.COORD_OZ,r:j.j4}; },
    ik(x,y,z,r,hint) { const j=core.ikMG400(x-core.COORD_OX,y,z-core.COORD_OZ,hint); return j && {...j,j4:r}; },
  };
  let courseEnd = { ...home };
  for (const task of axes.AXIS_TASKS) courseEnd = axes.axisTarget(courseEnd,task);
  for (const from of [courseEnd, home]) {
    const samples = curriculum.sampleLessonMotion(model, from, axes.axisTarget(from,final), 'MoveL', -113.32);
    assert.equal(samples.length, 121);
    for (const sample of samples) {
      const actual = model.fk(sample.joints);
      assert.ok(Math.hypot(actual.x-sample.pose.x,actual.y-sample.pose.y,actual.z-sample.pose.z)<0.15);
      assert.equal(sample.pose.x, from.x);
      assert.equal(sample.pose.z, from.z);
      assert.equal(sample.pose.r, from.r);
    }
  }
});
