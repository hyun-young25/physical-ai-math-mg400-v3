const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const exported = {};
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(__dirname, 'shapeTrace.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(exported);
const { ShapeTraceBuffer } = exported;
const last = trace => Array.from(trace.positions.slice((trace.count - 1) * 3, trace.count * 3));

test('final inactive frame captures the exact measured endpoint despite decimation and return motion', () => {
  const trace = new ShapeTraceBuffer();
  trace.sample([200, 159, -100], true);
  trace.sample([300, 159, -100], true);
  trace.sample([300, 159, 100], true);
  trace.sample([200, 159, 100], true);
  trace.sample([200, 159, -99], true);
  // The drawing endpoint arrives after traceActive turned false and the pen
  // is already returning elsewhere; the last 1 mm must not be discarded.
  assert.equal(trace.sample([350, 180, 0], false, [200, 159, -100]), true);
  assert.deepEqual(last(trace), [200, 159, -100]);
  assert.deepEqual(Array.from(trace.floorPositions.slice((trace.count - 1) * 3, trace.count * 3)), [200, 2, -100]);
  const count = trace.count;
  for (let i = 0; i < 100; i++) trace.sample([350 + i, 180, 0], false, [200, 159, -100]);
  assert.equal(trace.count, count);
  assert.deepEqual(last(trace), [200, 159, -100]);
});

test('an open drawing retains its measured endpoint and is never connected back to its start', () => {
  const trace = new ShapeTraceBuffer();
  trace.sample([200, 159, -100], true);
  trace.sample([300, 159, -100], true);
  trace.sample(null, false, [300, 159, -99.5]);
  assert.deepEqual(last(trace), [300, 159, -99.5]);
  assert.equal(trace.count, 3);
});

test('reset clears the sealed stroke and a pause without endpoint does not record approach or return poses', () => {
  const trace = new ShapeTraceBuffer();
  assert.equal(trace.sample([350, 180, 0], false), false);
  trace.sample([200, 159, -100], true);
  trace.sample(null, false, [201, 159, -100]);
  trace.reset();
  assert.equal(trace.count, 0);
  assert.equal(trace.sample([250, 159, 10], true), true);
  assert.deepEqual(last(trace), [250, 159, 10]);
  assert.equal(trace.sample([250, 200, 10], false), false);
  assert.equal(trace.count, 1);
});

test('a full trace still preserves its final measured point', () => {
  const trace = new ShapeTraceBuffer(2);
  trace.sample([0, 159, 0], true);
  trace.sample([5, 159, 0], true);
  assert.equal(trace.sample([10, 159, 0], true), false);
  trace.sample(null, false, [12, 159, 0]);
  assert.equal(trace.count, 2);
  assert.deepEqual(last(trace), [12, 159, 0]);
});
