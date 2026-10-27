// Run from artifacts/robot-control: node --test src/curriculum.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
function loadTypescript(source, dependencies = {}) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function('exports', 'require', compiled)(exports, name => {
    assert.ok(name in dependencies, `Unexpected test dependency: ${name}`);
    return dependencies[name];
  });
  return exports;
}
const curriculum = loadTypescript(read('curriculum.ts'));
const axes = loadTypescript(read('axisLesson.ts'), { './curriculum': curriculum });
const app = read('App.tsx');
const lesson = read('LessonPages.tsx');
const arm = read('RobotArm.tsx');
// Exercise the existing application's actual FK/IK, not a duplicated test model.
const parsed = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = parsed.statements.filter(statement =>
  (ts.isFunctionDeclaration(statement) && ['fkMG400', 'ikMG400'].includes(statement.name?.text)) ||
  (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration =>
    ['ARM_L1', 'COORD_OX', 'COORD_OZ'].includes(declaration.name.getText(parsed))))
).map(statement => statement.getText(parsed)).join('\n');
const core = loadTypescript(declarations + '\nexport { fkMG400, ikMG400, COORD_OX, COORD_OZ };');
const model = {
  fk(j) { const p = core.fkMG400(j.j1, j.j2, j.j3); return { x:p.x+core.COORD_OX, y:p.y, z:p.z+core.COORD_OZ, r:j.j4 }; },
  ik(x,y,z,r,hint) { const j = core.ikMG400(x-core.COORD_OX,y,z-core.COORD_OZ,hint); return j && { ...j, j4:r }; },
};
const A = { x:250, y:50, z:0, r:0 };
const B = { x:300, y:-50, z:0, r:0 };
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);

test('four main chapters, without obsolete vision/FK/IK standalone entries', () => {
  assert.deepEqual(curriculum.CHAPTERS, ['용어·기호와 기초수학', '좌표와 로봇 이동', '로봇 운동학', '운동학 종합과제: 픽앤플레이스']);
  assert.match(app, /const NAV_ITEMS = CHAPTERS/);
  assert.doesNotMatch(app, /좌표로 움직여보기|비전 좌표변환|정기구학\(FK\)/);
});
test('coordinate content order places motion comparison before shapes', () => {
  assert.deepEqual(curriculum.COORDINATE_TOPICS.map(t=>t.id), ['axes','coordinates','motion','shapes']);
  assert.deepEqual(curriculum.KINEMATICS_TOPICS.map(t=>t.id), ['fk','ik']);
  assert.match(app, /<CoordinateLesson key=\{coordinateTopic\}/);
  assert.match(app, /<KinematicsLesson key=\{kinematicsTopic\}/);
});
test('shape and pick content are routed independently while preserving BasicMath', () => {
  assert.match(app, /isShapeLesson = activeNav === "좌표와 로봇 이동" && coordinateTopic === "shapes"/);
  assert.match(app, /isPickLesson = activeNav === "운동학 종합과제: 픽앤플레이스"/);
  assert.match(app, /activity=\{isPickLesson \? "pick" : "rect"\}/);
  assert.match(app, /<BasicMath[\s\S]*?onCoordSet=/);
  assert.match(arm, /useState<"rect"\|"pick">\(activity \?\? "rect"\)/);
  assert.match(arm, /!activity && <div/);
  assert.match(arm, /s === "동그라미" \? "원" : s/);
});
test('shape lessons share a staged shell while preserving shape-specific mathematics', () => {
  assert.match(arm, /function ShapeLearningPanel/);
  assert.equal((arm.match(/<ShapeLearningPanel\b/g) ?? []).length, 1, 'all shapes use one learning panel');
  assert.equal((arm.match(/<ShapeLessonSteps\b/g) ?? []).length, 1, 'all shapes use one staged controller');
  assert.match(arm, /<ShapeLessonSteps[^>]*lesson=\{lesson\} inquiry=\{inquiry\}/);
  const shapes = loadTypescript(read('shapeLearning.ts'));
  for (const [shape, pointCount] of [['사각형', 5], ['삼각형', 4], ['동그라미', 5]]) {
    const task = shapes.getShapeLesson(shape, 0);
    for (const phase of ['concept', 'relations', 'calculation', 'prediction']) {
      assert.ok(task[phase].length > 0, `${shape} supplies its mathematics to the shared ${phase} phase`);
    }
    assert.equal(task.sequence.length, pointCount);
    assert.deepEqual(task.sequence.at(-1).coords, task.sequence[0].coords, `${shape} closes at P1`);
    assert.ok(task.sequence.slice(1).every(step => step.type === (shape === '동그라미' ? 'MoveC' : 'MoveL')));
    if (shape === '동그라미') assert.ok(task.sequence.slice(1).every(step => step.via), 'each circle arc retains its via point');
  }
});

test('blank and invalid inputs remain invalid, while zero/negative/decimal work', () => {
  for (const value of ['', ' ', '-', 'NaN', 'Infinity', '1e999']) assert.equal(curriculum.parseLessonNumber(value), null);
  for (const value of ['0','-100','12.5']) assert.equal(curriculum.parseLessonNumber(value), Number(value));
});
test('relative and absolute coordinates describe the same endpoint', () => {
  const delta = curriculum.poseDifference(A,B);
  assert.deepEqual(delta, {x:50,y:-100,z:0});
  assert.deepEqual(curriculum.translatePose(A,delta), B);
});
test('axis translation changes only the selected coordinate and preserves R', () => {
  assert.deepEqual(curriculum.translatePose({...A,r:20},{x:0,y:0,z:-10}), {...A,z:-10,r:20});
});
test('MoveJ and MoveL share endpoints under the existing application model', () => {
  for (const mode of ['MoveJ','MoveL']) {
    const samples = curriculum.sampleLessonMotion(model,A,B,mode,-113.32);
    assert.equal(samples.length,121);
    assert.ok(distance(samples[0].pose,A)<0.15);
    assert.ok(distance(samples.at(-1).pose,B)<0.15);
    assert.ok(samples.every(s=>Object.values(s.joints).every(Number.isFinite)));
  }
});
test('MoveL samples are collinear in Cartesian space', () => {
  const samples = curriculum.sampleLessonMotion(model,A,B,'MoveL',-113.32);
  for (const sample of samples) {
    assert.ok(Math.abs((sample.pose.x-A.x)*(B.y-A.y)-(sample.pose.y-A.y)*(B.x-A.x))<1e-7);
    assert.equal(sample.pose.z,0);
  }
});
test('default MoveJ lesson visibly differs from MoveL in between endpoints', () => {
  const j = curriculum.sampleLessonMotion(model,A,B,'MoveJ',-113.32);
  const l = curriculum.sampleLessonMotion(model,A,B,'MoveL',-113.32);
  assert.ok(distance(j[60].pose,l[60].pose)>1);
});
test('unreachable, nonfinite, and invalid intermediate paths are rejected before execution', () => {
  assert.equal(curriculum.sampleLessonMotion(model,A,{...B,x:2000},'MoveL',-1),null);
  assert.equal(curriculum.sampleLessonMotion(model,A,{...B,x:NaN},'MoveJ',-1),null);
  const blocked = {...model,ik:(x,...rest)=>Math.abs(x-275)<0.1?null:model.ik(x,...rest)};
  assert.equal(curriculum.sampleLessonMotion(blocked,A,B,'MoveL',-1),null);
});
test('IK followed by FK recovers targets within existing rounding precision', () => {
  for (const target of [A,B,{x:350,y:0,z:0,r:15},{x:270,y:40,z:50,r:0}]) {
    const joints=model.ik(target.x,target.y,target.z,target.r,-113.32);
    assert.ok(joints);
    assert.ok(distance(model.fk(joints),target)<0.15);
    assert.equal(model.fk(joints).r,target.r);
  }
});
test('new lesson module has no bridge commands and guards DT-only execution', () => {
  assert.doesNotMatch(lesson,/RobotBridge|bridgeRef|onHardwareMove|executeHardwareMove/);
  assert.match(lesson,/if \(latest.current.hardwareConnected \|\| prRef.current.hardware \|\| !frames.length\) return/);
  assert.match(lesson,/cancel\(false\);[\s\S]*?\[props.resetKey, cancel\]/);
  assert.match(lesson,/useEffect\(\(\) => \(\) => \{ cancel\(\); prRef.current.cancelConfirmation\(\);[\s\S]*?\}, \[cancel\]\)/);
});

test('six axis tasks cover both signs, are reachable in sequence, and preserve the other coordinates', () => {
  assert.deepEqual(axes.AXIS_TASKS.map(t => `${t.axis}:${t.sign}`).sort(), ['x:-1','x:1','y:-1','y:1','z:-1','z:1']);
  let from = { x:350, y:0, z:0, r:17 };
  for (const task of axes.AXIS_TASKS) {
    const to = axes.axisTarget(from, task);
    const frames = curriculum.sampleLessonMotion(model, from, to, 'MoveL', -113.32);
    assert.ok(frames, task.id);
    for (const frame of frames) {
      assert.equal(frame.pose.r, 17);
      for (const axis of curriculum.POSE_AXES.filter(a => a !== task.axis)) assert.equal(frame.pose[axis], from[axis]);
      assert.ok(distance(model.fk(frame.joints), frame.pose) < 0.15, `${task.id}: FK/IK agrees with displayed path`);
    }
    assert.equal(to[task.axis] - from[task.axis], task.sign * task.distance);
    from = to;
  }
  assert.deepEqual(from, { x:350, y:0, z:0, r:17 });
});

test('unanswered coordinates are not treated as unchanged; all three predictions must match', () => {
  const from = { x:350, y:0, z:0, r:0 }, to = { ...from, x:400 };
  for (const p of [axes.blankAxisPrediction(), {x:1,y:0,z:null}]) {
    assert.equal(axes.hasAxisPrediction(p), false);
    assert.equal(axes.axisPredictionMatches(p, from, to), false);
  }
  assert.equal(axes.axisPredictionMatches({x:1,y:0,z:0}, from, to), true);
  assert.equal(axes.axisPredictionMatches({x:1,y:1,z:0}, from, to), false);
  assert.equal(axes.axisPredictionMatches({x:-1,y:0,z:0}, from, to), false);
  assert.equal(axes.axisPredictionMatches({x:1,y:0,z:0}, from, {...to,y:0.001,z:-0.001}), true);
});

test('axis rendering keeps the existing robot-to-world orientation in both signs', () => {
  assert.deepEqual(axes.axisWorldVector('x'), [1,0,0]);
  assert.deepEqual(axes.axisWorldVector('y'), [0,0,-1]);
  assert.deepEqual(axes.axisWorldVector('z'), [0,1,0]);
  for (const task of axes.AXIS_TASKS) {
    const vector = axes.axisWorldVector(task.axis, task.sign);
    const zero = {x:0,y:0,z:0,r:0}, end = axes.axisTarget(zero, task);
    assert.deepEqual(vector.map(n => n * task.distance || 0), [end.x,end.z,-end.y].map(n=>n || 0));
    assert.notEqual(task.view, task.transferView);
  }
});

const evidence = () => ({
  attempts: [{ prediction:{x:-1,y:0,z:0}, from:{x:350,y:0,z:0,r:0}, to:{x:400,y:0,z:0,r:0} }],
  reason:'parallel', reasonAttempts:1, transferAttempts:1,
  transferPrediction:{x:1,y:0,z:0}, transferReason:'base', viewChanged:true, currentView:'top',
});
test('completion requires observed motion, explanation, and a correct prediction in the changed view', () => {
  const task = axes.AXIS_TASKS[0];
  for (const missing of [
    {attempts:[]}, {reason:''}, {reason:'one-joint'}, {viewChanged:false}, {currentView:'side'},
    {transferPrediction:{x:1,y:0,z:null}}, {transferPrediction:{x:-1,y:0,z:0}}, {transferReason:'screen'},
  ]) assert.equal(axes.completeAxisTask(task, {...evidence(), ...missing}), null);
  const record = axes.completeAxisTask(task, evidence());
  assert.ok(record, 'An initial misconception can be corrected after observation and transfer');
  assert.equal(record.source, 'dt');
  assert.equal(record.attempts[0].prediction.x, -1, 'Do not rewrite the initial wrong prediction');
});

test('completed evidence is an immutable snapshot of first prediction and retries', () => {
  const data = evidence();
  data.attempts.push({prediction:{x:1,y:0,z:0},from:{x:350,y:0,z:0,r:0},to:{x:400,y:0,z:0,r:0}});
  const record = axes.completeAxisTask(axes.AXIS_TASKS[0], data);
  data.attempts[0].prediction.x = 1;
  data.attempts[0].from.x = -1;
  data.attempts[1].to.x = 999;
  data.transferPrediction.y = 1;
  data.attempts.pop();
  assert.equal(record.attempts.length, 2);
  assert.equal(record.attempts[0].prediction.x, -1);
  assert.equal(record.attempts[0].from.x, 350);
  assert.equal(record.attempts[1].to.x, 400);
  assert.equal(record.transferPrediction.y, 0);
});
