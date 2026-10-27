const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const THREE = require('three');
const model = {};
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(__dirname, 'processKinematics.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(model);
const D = Math.PI / 180;

// Independently execute the actual nested URDF transforms, rather than using
// the solver's effective-link equations as its expected result.
function actualChain(joints) {
  const root = new THREE.Group();
  root.rotation.x = -Math.PI / 2;
  root.scale.setScalar(1000);
  let tail = root;
  const add = (position, axis, angle) => {
    const group = new THREE.Group();
    group.position.set(...position);
    if (axis) group.rotation[axis] = angle;
    tail.add(group); tail = group;
  };
  add([-0.005, 0, 0.109], 'z', joints.j1 * D);
  add([0.0435, -0.0358, 0.119], 'y', Math.PI / 2 - joints.j2 * D);
  add([-0.00105, 0.03577, 0.175], 'y', -joints.j3 * D);
  add([0, 0, 0], 'y', -Math.PI / 2);
  add([0.175, -0.017, 0.00325], 'y', (joints.j2 + joints.j3) * D);
  add([0.066, 0.017, 0.031]);
  add([0, 0, 0], 'z', joints.j4 * D);
  add([0, 0, -0.121]);
  root.updateMatrixWorld(true);
  const tip = tail.getWorldPosition(new THREE.Vector3());
  const direction = new THREE.Vector3(1, 0, 0).transformDirection(tail.matrixWorld);
  return { x: tip.x, y: -tip.z, z: tip.y, r: Math.atan2(-direction.z, direction.x) / D };
}

function assertPose(actual, expected, tolerance = 1e-8) {
  for (const key of ['x', 'y', 'z']) assert.ok(Math.abs(actual[key] - expected[key]) < tolerance, `${key}: ${actual[key]} vs ${expected[key]}`);
  assert.ok(Math.abs(model.processAngle(actual.r - expected.r)) < tolerance);
}

test('process FK matches the unmodified rendered URDF chain over changing base, shoulder, elbow, and tool angles', () => {
  for (const j1 of [-90, -35, 0, 48, 150]) {
    for (const j2 of [-20, 40, 69.02, 110]) {
      for (const j3 of [-145, -113.32, -20, 60]) {
        for (const j4 of [-170, 0, 125]) {
          const joints = { j1, j2, j3, j4 };
          assertPose(model.processFK(joints), actualChain(joints));
        }
      }
    }
  }
});

test('process task locations and carry routes land the visible suction tip exactly on the mathematical coordinates', () => {
  for (const x of [250, 280, 300, 350]) {
    for (const y of [-170, -100, -30, 40, 100, 170]) {
      for (const z of [220, 240, 280, 300]) {
        for (const r of [0, 90, 180, -170]) {
          const joints = model.processIK(x, y, z, r, -110);
          assert.ok(joints, `unreachable ${x},${y},${z}`);
          assertPose(model.processFK(joints), { x, y, z, r });
          assertPose(actualChain(joints), { x, y, z, r });
        }
      }
    }
  }
});

test('elbow hint selects the nearest solution without changing the TCP, and wrist compensation preserves world-local tool yaw', () => {
  const negative = model.processIK(280, -100, 300, 35, -130);
  const positive = model.processIK(280, -100, 300, 35, 130);
  assert.ok(negative.j3 < 0); assert.ok(positive.j3 > 0);
  assert.notEqual(negative.j2, positive.j2);
  for (const joints of [negative, positive]) {
    assertPose(actualChain(joints), { x: 280, y: -100, z: 300, r: 35 });
    assert.ok(Math.abs(model.processAngle(joints.j1 + joints.j4 - 35)) < 1e-8);
  }
});

test('invalid and unreachable targets never create fabricated poses', () => {
  assert.equal(model.processIK(1000, 0, 220, 0, -1), null);
  assert.equal(model.processIK(-5, 0, 220, 0, -1), null);
  for (let index = 0; index < 5; index++) {
    for (const value of [NaN, Infinity, -Infinity]) {
      const args = [280, -100, 220, 0, -1]; args[index] = value;
      assert.equal(model.processIK(...args), null);
    }
  }
  assert.throws(() => model.processFK({ j1: NaN, j2: 0, j3: 0, j4: 0 }), RangeError);
});

test('every real pick, handoff and placement aligns the rendered tip, block top and task point in both robot frames', () => {
  const load = (file, deps = {}) => {
    const exports = {};
    new Function('exports', 'require', ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText)(exports, name => { assert.ok(name in deps); return deps[name]; });
    return exports;
  };
  const cell = load('processCell.ts', { './curriculum': load('curriculum.ts') });
  const vector = p => new THREE.Vector3(p.x, p.z, -p.y);
  for (const level of [1, 2, 3, 4]) for (const variant of [0, 1, 2]) {
    const scenario = cell.processScenario(level, variant);
    const answers = Object.fromEntries(scenario.questions.flatMap(question => question.fields.map(field => [field.key, field.expected])));
    const result = cell.compileProcess(model.PROCESS_MODEL, scenario, answers);
    assert.equal(result.outcome.passed, true);
    const contacts = result.frames.filter(frame => ['A-grip', 'B-grip', 'handoff-release', 'placed'].includes(frame.event));
    assert.ok(contacts.length >= 2);
    for (const frame of contacts) {
      const robot = scenario.robots.find(item => item.id === frame.eventRobot);
      const rendered = vector(actualChain(frame.robots[robot.id].joints))
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), robot.yaw * D).add(vector(robot.origin));
      assert.ok(rendered.distanceTo(vector(frame.eventPoint)) < 1e-6);
      assert.ok(rendered.distanceTo(vector(frame.eventGoal)) < .2, `${level}/${variant}/${frame.event}`);
      assert.ok(frame.workpieces.some(piece => rendered.distanceTo(vector(piece.top)) < .2), 'visible block top meets suction tip');
    }
  }
});
