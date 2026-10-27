const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const exports = {}; cache.set(name, exports);
  const source = fs.readFileSync(path.join(__dirname, name + '.ts'), 'utf8');
  new Function('exports', 'require', ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }}).outputText)(exports, dep => load(dep.replace('./', '')));
  return exports;
}
const c = load('coordinateLearning'), axes = load('axisLesson'), reasoning = load('axisReasoning');
const evidence = load('coordinateEvidence'), projection = load('basicMathProjection').basicMathProjection;
const app = fs.readFileSync(path.join(__dirname, 'App.tsx'), 'utf8');
const fn = name => ts.transpileModule(app.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))[0], {
  compilerOptions: {target: ts.ScriptTarget.ES2022},
}).outputText;
const fk = new Function('ARM_L1','ARM_L2', `${fn('fkMG400')}; return fkMG400`)(175,175);
const ik = new Function('ARM_L1','ARM_L2', `${fn('ikMG400')}; return ikMG400`)(175,175);
const origin = {x:350, y:0, z:20, r:0};

test('the basic-math projection agrees with the actual DT at nonzero Y and rotated bases', () => {
  for (const y of [-100, -50, 0, 50, 100]) {
    const joints = {...ik(350 - 162.124, y, 20 + 41.202, -90), j4:0};
    const expected = fk(joints.j1, joints.j2, joints.j3), actual = projection(joints);
    assert.ok(Math.abs(actual.x - expected.x - 162.124) < .051);
    assert.ok(Math.abs(actual.y - expected.y) < .051);
    assert.ok(Math.abs(actual.z - expected.z + 41.202) < .051);
    assert.ok(Math.abs(actual.x - 350) < .1 && Math.abs(actual.y - y) < .1);
    if (y !== 0) assert.ok(Math.abs(actual.rho + 162.124 - actual.x) > 5,
      'the link-plane reach cannot be labelled as world X');
  }
  for (const base of [-135, -90, 45, 90, 135, 180]) {
    const joints = {j1:base,j2:60,j3:-90,j4:0}, actual = projection(joints), expected = fk(base,60,-90);
    assert.ok(Math.abs(actual.x-expected.x-162.124)<.051 && Math.abs(actual.y-expected.y)<.051);
  }
});
test('each coordinate problem displays its givens rather than the requested endpoint', () => {
  const [delta, endpoint, literal, transfer] = c.COORDINATE_TASKS;
  assert.deepEqual(c.coordinateProblemContext(delta).value, delta.b);
  const context = c.coordinateProblemContext(endpoint);
  assert.deepEqual(context.value, {x:-40,y:80,z:20});
  assert.notDeepEqual(context.value, c.coordinateExpected(endpoint).absolute);
  assert.match(context.label, /변화량/);
  assert.match(c.coordinateProblemContext(literal).label, /똑같이 넣을 숫자/);
  assert.match(c.coordinateProblemContext(transfer).label, /원래 명령/);
});

function storage(seed = {}) {
  const data = new Map(Object.entries(seed));
  global.localStorage = { getItem: key => data.get(key) ?? null,
    setItem: (key,value) => data.set(key,value), removeItem: key => data.delete(key) };
  return data;
}
function snapshot() {
  const record = evidence.emptyCoordinateEvidence();
  const task = axes.AXIS_LESSON_TASKS[0];
  const attempt = reasoning.makeAxisNumericAttempt(task, origin, {draft:{x:'25',y:'0',z:'0'},
    relation:'same-half', explanation:'같은 방향에서 이동 거리가 절반이다.', command:null,
    view:'free',hints:0,supportIds:['support-1']});
  attempt.numeric.executedAt = new Date().toISOString();
  record.axisAttempts[task.id] = [attempt];
  record.axisRecords = [reasoning.completeAxisNumeric(task,[attempt])];
  record.supportRecords = [{id:'support-1',lesson:'2-1',taskId:task.id,error:'sign',triggerIds:[],
    openedAt:'2026-10-01',status:'practice',practice:[],checks:[]}];
  const comparisonTask = c.COORDINATE_TASKS[1], draft = c.blankCoordinateDraft();
  draft.absolute={x:'260',y:'30',z:'20'};
  const comparison = c.makeCoordinateAttempt(comparisonTask,draft,{comparison:'same',rule:'',explanation:'',hints:0});
  comparison.results.absolute={from:comparisonTask.a,to:comparisonTask.b};
  record.coordinateAttempts = [comparison];
  record.applicationRecords = [{id:'application-1',task:'transfer',source:'dt',startedAt:'2026-10-01',from:origin,completed:false,
    entries:[{id:'move-1',step:0,submittedAt:'2026-10-01',action:'move',from:origin,target:origin,status:'running'}]}];
  record.transferRecords=[{id:'transfer-1',pairId:'pair-1',source:'dt',explanationReview:'teacher',explanations:[],
    trials:[{id:'trial-1',submittedAt:'2026-10-01',commands:{absolute:'60',relative:'40'},revisionReason:'',
      results:[{id:'lift-1',mode:'absolute',startedAt:'2026-10-01',from:origin,target:{...origin,z:60},status:'running'}]}]}];
  const strategy=load('coordinateStrategies'), scenario=strategy.COORDINATE_SCENARIOS[0];
  record.strategyAttempts=[{id:'strategy-1',taskId:scenario.id,source:'dt',submittedAt:'2026-10-01',
    commands:[],requirement:'location',explanation:'위치를 지정한다.',hints:0,results:[],completed:false,explanationReview:'teacher'}];
  return record;
}
test('reload retains first attempts, completed tasks, support and a partially observed pair', () => {
  storage(); const record = snapshot(), store = evidence.createCoordinateEvidenceStore();
  assert.equal(evidence.isCoordinateEvidence(record),true);
  assert.equal(store.save(record,true),true);
  const restored = evidence.createCoordinateEvidenceStore().initial;
  for(const key of ['axisAttempts','axisRecords','supportRecords','coordinateAttempts','strategyAttempts'])
    assert.deepEqual(restored[key],record[key]);
  assert.equal(restored.coordinateAttempts[0].completed,false);
  assert.equal(restored.coordinateAttempts[0].results.relative,undefined);
  assert.equal(restored.applicationRecords[0].entries[0].status,'stopped');
  assert.equal(restored.transferRecords[0].trials[0].results[0].status,'stopped');
  assert.equal(restored.transferRecords[0].completedAt,undefined);
});
test('malformed history stays recoverable and a later snapshot is retained separately', () => {
  const data=storage({[evidence.COORDINATE_EVIDENCE_KEY]:'{broken'}), store=evidence.createCoordinateEvidenceStore();
  assert.equal(store.failed,true); assert.equal(store.backups.history,'{broken');
  assert.equal(store.save(snapshot(),true),false);
  assert.equal(data.get(evidence.COORDINATE_EVIDENCE_KEY),'{broken');
  assert.ok(evidence.createCoordinateEvidenceStore().initial.axisRecords.length===1);
  const bad=snapshot();bad.applicationRecords[0].entries=[null];
  assert.equal(evidence.isCoordinateEvidence(bad),false);
});
test('quota failure keeps the complete in-memory history and never reports a successful save', () => {
  storage(); const store=evidence.createCoordinateEvidenceStore(), record=snapshot();
  global.localStorage.setItem=()=>{throw new Error('QuotaExceededError');};
  assert.equal(store.save(record,true),false);
  assert.deepEqual(store.records,[record]);
});
