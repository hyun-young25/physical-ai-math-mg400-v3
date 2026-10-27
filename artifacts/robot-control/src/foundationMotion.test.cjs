const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const exports_ = {};
new Function('exports', ts.transpileModule(fs.readFileSync(__dirname + '/foundationMotion.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(exports_);
const { foundationAnswerMatches: matches, foundationHint: hint, foundationMotion: plan, foundationStartProblem: startProblem } = exports_;
const current = { x: 300, y: 12, z: 20, r: 5 };
test('invalid numbers and blank input cannot pass; finite answers use the lesson tolerance', () => {
  for (const raw of ['', ' ', 'NaN', 'Infinity', 'abc']) assert.equal(matches(raw, 0), false);
  assert.equal(matches('40', 40), true);
  assert.equal(matches('40.05', 40), true);
  assert.equal(matches('40.11', 40), false);
  assert.equal(matches('MoveJ', 'MoveL'), false);
});
test('height moves preserve XY/R and use the absolute target, never delta as position', () => {
  const p = plan('height-practice', current);
  assert.deepEqual(p.operation.target, { ...current, z: 60 });
  assert.equal(p.operation.motion, 'MoveL');
  assert.deepEqual(p.start, { z: 20 });
  assert.equal(startProblem(p.start, current, 2), null);
  assert.match(startProblem(p.start, { ...current, z: 45 }, 2), /出|출발/);
  assert.deepEqual(plan('height-transfer', { ...current, z: 45 }).start, { z: 45 });
});
test('vector destinations and signed distance offsets match the question', () => {
  assert.deepEqual(plan('vector-practice', current).operation.target, { x: 350, y: 70, z: 60, r: 5 });
  assert.deepEqual(plan('vector-transfer', current).operation.target, { x: 320, y: 110, z: 35, r: 5 });
  const distance = plan('distance-transfer', current).operation;
  assert.equal(distance.relative, true);
  assert.deepEqual(distance.target, { x: -60, y: 80, z: 0, r: 0 });
  for (const id of ['projection-practice', 'two-link-practice', 'unknown']) assert.equal(plan(id, current), null);
});
test('vector feedback does not incorrectly claim the X and Y changes are zero', () => {
  assert.match(hint('vector-practice', 'deltaX'), /350 − 320/);
  assert.match(hint('vector-transfer', 'deltaZ'), /35 − 60/);
  assert.match(hint('height-transfer', 'delta'), /60 − 45/);
  assert.match(hint('two-link-transfer', 'link2X'), /45 − 15/);
});
