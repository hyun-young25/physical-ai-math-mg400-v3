const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const THREE = require('three');

function load(name, dependencies = {}) {
  const exported = {};
  new Function('exports', 'require', ts.transpileModule(fs.readFileSync(path.join(__dirname, `${name}.ts`), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText)(exported, dependency => {
    assert.ok(dependency in dependencies, `Unexpected runtime dependency: ${dependency}`);
    return dependencies[dependency];
  });
  return exported;
}
const processModel = load('processKinematics');
const model = load('shapeKinematics', { './processKinematics': processModel });
const lessons = load('shapeLearning');
const D = Math.PI / 180;

// Execute the displayed assembly's nested transforms independently of the
// solver. The visible pen ends at -0.144 m, below the -0.121 m suction tracker.
function actualPenChain(joints) {
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
  add([0, 0, -0.144]);
  root.updateMatrixWorld(true);
  const tip = tail.getWorldPosition(new THREE.Vector3());
  const direction = new THREE.Vector3(1, 0, 0).transformDirection(tail.matrixWorld);
  return { world: tip.toArray(), r: Math.atan2(-direction.z, direction.x) / D };
}

const near = (actual, expected, message, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${message}: ${actual} vs ${expected}`);

function assertActualPose(joints, expected) {
  const actual = actualPenChain(joints);
  const expectedWorld = model.shapeWorldPoint(expected);
  actual.world.forEach((value, index) => near(value, expectedWorld[index], `world axis ${index}`));
  const displayed = model.shapeFK(joints);
  for (const key of ['x', 'y', 'z']) near(displayed[key], expected[key], key);
  near(processModel.processAngle(actual.r - expected.r), 0, 'actual world tool yaw');
  near(processModel.processAngle(displayed.r - expected.r), 0, 'displayed world tool yaw');
}

test('fixed drawing calibration keeps the canonical model pose at (350, 0, 0) and uses the visible pen tip', () => {
  const pose = { x: 350, y: 0, z: 0, r: 0 };
  assert.deepEqual(model.shapeFK(model.SHAPE_HOME_JOINTS), pose);
  assertActualPose(model.SHAPE_HOME_JOINTS, pose);
  const solved = model.shapeIK(350, 0, 0, 0, model.SHAPE_HOME_JOINTS.j3);
  for (const key of ['j1', 'j2', 'j3', 'j4']) near(solved[key], model.SHAPE_HOME_JOINTS[key], key);
  const suction = processModel.processFK(model.SHAPE_HOME_JOINTS);
  near(suction.z - model.shapeWorldPoint(pose)[1], 23, 'pen extension below suction reference');
});

test('shape FK and world mapping match the actual pen chain over changing base, arm, and wrist angles', () => {
  for (const j1 of [-90, -35, 0, 48, 150]) {
    for (const j2 of [-20, 40, 69.02, 110]) {
      for (const j3 of [-145, -113.32, -20, 60]) {
        for (const j4 of [-170, 0, 125]) {
          const joints = { j1, j2, j3, j4 };
          assertActualPose(joints, model.shapeFK(joints));
        }
      }
    }
  }
});

test('all 18 shape task paths and their intermediate points place the real pen on the displayed route', () => {
  for (const shape of ['사각형', '삼각형', '동그라미']) {
    for (let index = 0; index < 6; index++) {
      const lesson = lessons.getShapeLesson(shape, index);
      for (const route of [lessons.shapeLessonTargetPath(lesson), lessons.shapeLessonProgramPath(lesson)]) {
        let hint = model.SHAPE_HOME_JOINTS.j3;
        for (let segment = 1; segment < route.length; segment++) {
          const from = route[segment - 1], to = route[segment];
          for (let step = 0; step <= 20; step++) {
            const t = step / 20;
            const point = Object.fromEntries(['x', 'y', 'z', 'r'].map(key => [key, from[key] + (to[key] - from[key]) * t]));
            const joints = model.shapeIK(point.x, point.y, point.z, point.r, hint);
            assert.ok(joints, `Unreachable ${lesson.id}, segment ${segment}, t=${t}`);
            assertActualPose(joints, point);
            assert.ok(joints.j3 < 0, 'retain the starting elbow branch');
            hint = joints.j3;
          }
        }
      }
    }
  }
});

test('square closing edge stays straight in the actual pen motion when J1 crosses zero', () => {
  // Previously the trace stayed at x=200, while the actual pen bowed sideways
  // by about 71 mm because a fixed X offset was used as a rotating-arm offset.
  const startWorld = model.shapeWorldPoint({ x: 200, y: -100, z: 0 });
  let hint = model.SHAPE_HOME_JOINTS.j3;
  let previous;
  for (let y = -100; y <= 100; y++) {
    const joints = model.shapeIK(200, y, 0, 0, hint);
    assert.ok(joints);
    const actual = actualPenChain(joints);
    near(actual.world[0], startWorld[0], 'constant actual pen X');
    near(actual.world[1], startWorld[1], 'constant actual pen height');
    if (previous) {
      for (const key of ['j1', 'j2', 'j3', 'j4']) assert.ok(Math.abs(joints[key] - previous[key]) < 1, `continuous ${key}`);
    }
    previous = joints; hint = joints.j3;
  }
});

test('shape IK handles either elbow branch, compensates tool yaw, and rejects invalid targets', () => {
  for (const hint of [-130, 130]) {
    const joints = model.shapeIK(280, -100, 20, 35, hint);
    assert.ok(joints);
    assert.equal(joints.j3 < 0, hint < 0);
    assertActualPose(joints, { x: 280, y: -100, z: 20, r: 35 });
  }
  assert.equal(model.shapeIK(1000, 0, 0, 0), null);
  for (let index = 0; index < 5; index++) {
    for (const value of [NaN, Infinity, -Infinity]) {
      const args = [280, -100, 20, 0, -1]; args[index] = value;
      assert.equal(model.shapeIK(...args), null);
    }
  }
  assert.throws(() => model.shapeFK({ j1: NaN, j2: 0, j3: 0, j4: 0 }), RangeError);
});
