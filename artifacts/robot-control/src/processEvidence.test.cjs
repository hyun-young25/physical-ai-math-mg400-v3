const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const moduleExports = {};
new Function('exports', 'require', ts.transpileModule(fs.readFileSync(path.join(__dirname, 'processEvidence.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(moduleExports, name => require("./learningTestAdapter.cjs")[name]);
const { createProcessEvidenceStore } = moduleExports;
const key = 'test-process-history', checkpointKey = `${key}:active-run`;
const valid = value => !!value && typeof value.id === 'string' && typeof value.status === 'string';
const open = () => createProcessEvidenceStore({ key, isRecord: valid,
  isCheckpoint: value => valid(value) && ['running', 'completed', 'stopped'].includes(value.status),
  recoverCheckpoint: (checkpoint, saved) => !saved || ['running', 'submitted'].includes(saved.status) ? checkpoint : null,
  normalizeRecord: record => record.status === 'running' ? { ...record, status: 'stopped', reason: 'interrupted' } : record,
});
function storage(initial = {}) {
  const values = new Map(Object.entries(initial)), writes = [], removed = [];
  const failures = { history: false, checkpoint: false, remove: false };
  global.localStorage = {
    getItem: name => values.get(name) ?? null,
    setItem(name, value) {
      if (name === key && failures.history || name === checkpointKey && failures.checkpoint) throw new Error('Storage failed');
      writes.push({ name, value }); values.set(name, value);
    },
    removeItem(name) { if (failures.remove) throw new Error('Remove failed'); removed.push(name); values.delete(name); },
  };
  return { values, writes, removed, failures };
}

test('frequent checkpoints write one small run, retaining all previous and unknown evidence', () => {
  const history = Array.from({ length: 500 }, (_, index) => ({ id: `old-${index}`, status: 'completed', prediction: 'x'.repeat(2000) }));
  history.push({ futureSchema: 9, data: ['untouched'] });
  const device = storage({ [key]: JSON.stringify(history) }), store = open();
  const before = device.values.get(key);
  for (let index = 1; index <= 20; index++) store.checkpoint({ id: 'active', status: 'running', executed: { throughIndex: index, events: ['feed'] } });
  assert.equal(device.values.get(key), before);
  assert.equal(device.writes.length, 20);
  assert.ok(device.writes.every(write => write.name === checkpointKey && write.value.length < 150));
  assert.equal(store.records.length, 502);
  assert.deepEqual(store.records[500], history[500]);
  assert.equal(store.save({ id: 'active', status: 'completed', executed: { throughIndex: 99 } }, true), true);
  assert.equal(device.values.has(checkpointKey), false);
  const saved = JSON.parse(device.values.get(key));
  assert.equal(saved.length, 502);
  assert.deepEqual(saved.slice(0, 501), history);
  assert.equal(saved.at(-1).executed.throughIndex, 99);
});

test('reload restores the latest executed checkpoint as stopped, never as a completed run', () => {
  storage({ [key]: JSON.stringify([{ id: 'run', status: 'running', executed: { throughIndex: 0 } }, { unknown: true }]),
    [checkpointKey]: JSON.stringify({ id: 'run', status: 'running', executed: { throughIndex: 417 } }) });
  const store = open();
  assert.equal(store.records[0].status, 'stopped');
  assert.equal(store.records[0].executed.throughIndex, 417);
  assert.deepEqual(store.records[1], { unknown: true });
});

test('a stale checkpoint cannot replace an already committed terminal result', () => {
  const terminal = { id: 'run', status: 'completed', executed: { throughIndex: 999 }, observation: 'saved' };
  storage({ [key]: JSON.stringify([terminal]), [checkpointKey]: JSON.stringify({ id: 'run', status: 'running', executed: { throughIndex: 400 } }) });
  assert.deepEqual(open().records, [terminal]);
});

test('terminal history write failure retains the terminal record in its checkpoint and reports failure', () => {
  const device = storage(), store = open();
  store.save({ id: 'run', status: 'running' });
  store.checkpoint({ id: 'run', status: 'running', executed: { throughIndex: 5 } });
  device.failures.history = true;
  const terminal = { id: 'run', status: 'stopped', executed: { throughIndex: 17 } };
  assert.equal(store.save(terminal, true), false);
  assert.equal(device.removed.length, 0);
  assert.deepEqual(JSON.parse(device.values.get(checkpointKey)), terminal);
  assert.deepEqual(open().records, [terminal]);
});

test('failed storage never overwrites unreadable history or a future checkpoint schema', () => {
  for (const corruptHistory of ['not json', '{"schema":9}']) {
    const device = storage({ [key]: corruptHistory, [checkpointKey]: '{"futureSchema":9}' });
    const store = open();
    assert.equal(store.failed, true);
    assert.equal(store.backups.history, corruptHistory);
    assert.equal(store.backups.checkpoint, '{"futureSchema":9}');
    assert.equal(store.checkpoint({ id: 'new', status: 'running' }), false);
    assert.equal(store.save({ id: 'new', status: 'stopped' }, true), false);
    assert.equal(device.values.get(key), corruptHistory);
    assert.equal(device.values.get(checkpointKey), '{"futureSchema":9}');
    assert.equal(device.writes.length, 0);
    assert.equal(store.records.length, 1, 'new evidence remains available to export');
  }
});

test('a second run cannot replace the only durable checkpoint before its history is committed', () => {
  const old = { id: 'old', status: 'running', executed: { throughIndex: 40 } };
  const device = storage({ [checkpointKey]: JSON.stringify(old) }), store = open();
  device.failures.history = true;
  assert.equal(store.save({ id: 'new', status: 'running' }), false);
  assert.equal(store.checkpoint({ id: 'new', status: 'running', executed: { throughIndex: 8 } }), false);
  assert.deepEqual(JSON.parse(device.values.get(checkpointKey)), old);
  device.failures.history = false;
  assert.equal(store.save({ id: 'new', status: 'running' }), true);
  assert.equal(store.checkpoint({ id: 'new', status: 'running', executed: { throughIndex: 10 } }), true);
  assert.equal(JSON.parse(device.values.get(key))[0].executed.throughIndex, 40);
  assert.equal(JSON.parse(device.values.get(checkpointKey)).id, 'new');
});

test('failed checkpoint removal leaves committed final evidence authoritative on reload', () => {
  const device = storage(), store = open();
  store.save({ id: 'run', status: 'running' });
  store.checkpoint({ id: 'run', status: 'running', executed: { throughIndex: 2 } });
  device.failures.remove = true;
  const terminal = { id: 'run', status: 'completed', executed: { throughIndex: 90 } };
  assert.equal(store.save(terminal, true), false);
  assert.deepEqual(open().records, [terminal]);
});
