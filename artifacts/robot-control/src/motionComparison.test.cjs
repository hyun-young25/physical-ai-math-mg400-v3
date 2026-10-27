const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
function load(file, deps = {}) {
  const exports = {};
  new Function('exports', 'require', ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText)(exports, name => { assert.ok(name in deps, name); return deps[name]; });
  return exports;
}
const m = load('motionComparison.ts');
const pose = (x, y, z = 0) => ({ x, y, z, r: 0 });
const a = pose(250, 50), b = pose(300, -50);
test('floor projection preserves display origin and axis signs, independent of TCP height', () => {
  assert.deepEqual(m.motionFloorPoint(a), [250, 4, -50]);
  assert.deepEqual(m.motionFloorPoint(b), [300, 4, 50]);
  assert.deepEqual(m.motionFloorPoint(pose(0, 0, 200)), [0, 4, -0]);
  assert.deepEqual(m.motionFloorPoint(pose(250, 50, -60)), m.motionFloorPoint(a));
});
test('vertical or stationary travel does not fabricate a floor segment; a returning path remains intact', () => {
  assert.deepEqual(m.motionFloorPath([a, pose(250, 50, 20), pose(250, 50, 60)]), [[250, 4, -50]]);
  assert.deepEqual(m.motionFloorPath([a, b, a]), [[250, 4, -50], [300, 4, 50], [250, 4, -50]]);
  assert.deepEqual(m.motionFloorPath([]), []);
});
test('a running prefix replaces its own old path, retains the other method, and never mutates evidence', () => {
  const completed = { MoveJ: [a, b], MoveL: [a, b] }, before = JSON.stringify(completed);
  const visible = m.visibleMotionPaths(completed, { mode: 'MoveJ', points: [a] });
  assert.deepEqual(visible.MoveJ, [a]); assert.equal(visible.MoveL, completed.MoveL);
  assert.equal(JSON.stringify(completed), before);
  assert.equal(m.visibleMotionPaths(completed, null), completed);
});
const jsx = (type, props) => ({ type, props });
const overlay = load('MotionComparisonOverlay.tsx', {
  './motionComparison': m, '@react-three/drei': { Html: 'Html', Line: 'Line' },
  'react/jsx-runtime': { jsx, jsxs: jsx },
});
const all = node => !node || typeof node !== 'object' ? [] : Array.isArray(node)
  ? node.flatMap(all) : [node, ...all(node.props?.children)];
test('overlapping methods remain a purple solid and cyan dashed path on the floor', () => {
  const nodes = all(overlay.MotionComparisonOverlay({ visual: { from: a, to: b, paths: { MoveJ: [a, b], MoveL: [a, b] }, runningMode: null } }));
  const lines = nodes.filter(n => n.type === 'Line').map(n => n.props);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].color, '#6d28d9'); assert.equal(lines[0].dashed, false);
  assert.equal(lines[1].color, '#0891b2'); assert.equal(lines[1].dashed, true);
  assert.ok(lines[1].points[0][1] > lines[0].points[0][1]);
  assert.deepEqual(lines.map(l => l.points.map(p => [p[0], p[2]])), [[[250, -50], [300, 50]], [[250, -50], [300, 50]]]);
  assert.deepEqual(nodes.filter(n => n.type === 'span').map(n => n.props.children), ['A', 'B']);
});
test('vertical-only motion has one combined floor endpoint and no degenerate line', () => {
  const top = pose(250, 50, 60);
  const nodes = all(overlay.MotionComparisonOverlay({ visual: { from: a, to: top, paths: { MoveL: [a, top] }, runningMode: null } }));
  assert.equal(nodes.filter(n => n.type === 'Line').length, 0);
  assert.deepEqual(nodes.filter(n => n.type === 'span').map(n => n.props.children), ['A·B']);
});
