const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const THREE = require('three');
const { OrbitControls } = require(require.resolve('three-stdlib', { paths: [require.resolve('@react-three/drei')] }));
function load(name, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, name), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('exports', 'require', code)(exports, name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name];
  });
  return exports;
}
const { CoordinateViewSession, fitStudyView, SHAPE_STUDY_VIEW: view } = load('coordinateStudyView.ts', { three: THREE });
const { getShapeLesson, shapeLessonTargetPath, shapeLessonProgramPath } = load('shapeLearning.ts');
const processKinematics = load('processKinematics.ts');
const { shapeWorldPoint } = load('shapeKinematics.ts', { './processKinematics': processKinematics });
function cameraAt(position, aspect = 1190 / 1128, target = view.target) {
  const camera = new THREE.PerspectiveCamera(42, aspect, 1, 6000);
  camera.position.set(...position); camera.lookAt(...target); camera.updateMatrixWorld(); return camera;
}
function project(point, camera) {
  const p = new THREE.Vector3(...point).project(camera);
  return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
}

test('shape view frames the complete robot and all 18 drawing paths from above the work plane', () => {
  const direction = new THREE.Vector3(...view.position).sub(new THREE.Vector3(...view.target));
  const elevation = Math.atan2(direction.y, Math.hypot(direction.x, direction.z)) * 180 / Math.PI;
  assert.ok(elevation > 50 && elevation < 65);
  for (const [width, height] of [[1190, 1128], [760, 900], [500, 650]]) {
    const fitted = fitStudyView(view, width / height, 1.05);
    const camera = cameraAt(fitted.position, width / height, fitted.target);
    const points = [];
    // Conservative initial arm/base bounds, plus the TCP and every task-plane path.
    for (const x of [-100, 120]) for (const y of [0, 440]) for (const z of [-100, 100]) points.push([x, y, z]);
    points.push([350, 200, 0]);
    for (const shape of ['사각형', '삼각형', '동그라미']) for (let index = 0; index < 6; index++) {
      const lesson = getShapeLesson(shape, index);
      for (const p of [...shapeLessonTargetPath(lesson), ...shapeLessonProgramPath(lesson)]) {
        const world = shapeWorldPoint(p);
        points.push(world, [world[0], 2, world[2]]);
      }
    }
    for (const point of points) {
      const p = project(point, camera);
      assert.ok(p.x > 0.05 && p.x < 0.95 && p.y > 0.05 && p.y < 0.78, JSON.stringify({ width, height, point, p }));
    }
    const center = project([90, 220, 0], camera);
    const planeCenter = project(shapeWorldPoint({x:250,y:0,z:0}), camera);
    assert.ok(center.x < planeCenter.x - 0.025, 'robot remains left of the work-plane center');
    assert.ok(center.y < planeCenter.y - 0.08, 'work plane opens below the body and arm');
  }
});

test('shape entry/reset converges with OrbitControls, then leaves user orbit untouched and restores on exit', () => {
  const camera = cameraAt([650, 380, 850], 1, [60, 220, 0]), controls = new OrbitControls(camera);
  controls.target.set(60, 220, 0); controls.update();
  const previousPosition = camera.position.clone(), previousTarget = controls.target.clone();
  const session = new CoordinateViewSession(camera, controls.target, () => controls.update(), view);
  session.request(); for (let i = 0; i < 180; i++) session.step(1 / 60);
  assert.ok(camera.position.distanceTo(new THREE.Vector3(...view.position)) < 1e-6);
  assert.deepEqual(controls.target.toArray(), [...view.target]);
  camera.position.set(700, 900, 600); controls.target.set(80, 150, 20); controls.update();
  const manualPosition = camera.position.clone(), manualTarget = controls.target.clone();
  for (let i = 0; i < 120; i++) session.step(1 / 60);
  assert.deepEqual(camera.position.toArray(), manualPosition.toArray());
  assert.deepEqual(controls.target.toArray(), manualTarget.toArray());
  session.request(); for (let i = 0; i < 180; i++) session.step(1 / 60);
  assert.ok(camera.position.distanceTo(new THREE.Vector3(...view.position)) < 1e-6);
  session.restore();
  assert.ok(camera.position.distanceTo(previousPosition) < 1e-6);
  assert.deepEqual(controls.target.toArray(), previousTarget.toArray());
});

test('shape camera cancellation immediately yields to top, side and front views', () => {
  for (const preset of [[60, 1800, 0], [40, 280, 1500], [1150, 280, 40]]) {
    const camera = cameraAt([650, 380, 850]), target = new THREE.Vector3(60, 220, 0);
    const session = new CoordinateViewSession(camera, target, () => camera.lookAt(target), view);
    session.request(); session.step(1 / 60); session.cancel();
    camera.position.set(...preset); target.set(60, 200, 0);
    for (let i = 0; i < 120; i++) session.step(1 / 60);
    assert.deepEqual(camera.position.toArray(), preset);
    assert.deepEqual(target.toArray(), [60, 200, 0]);
  }
});

test('FK/IK study framing fits narrow panes while retaining the preferred zoom on wider panes', () => {
  const { KINEMATICS_STUDY_VIEW, fitStudyView } = load('coordinateStudyView.ts', { three: THREE });
  for (const aspect of [0.5, 0.75, 1.05, 1.5]) {
    const framed = fitStudyView(KINEMATICS_STUDY_VIEW, aspect, 1.05);
    const camera = cameraAt(framed.position, aspect, framed.target);
    // Conservative base, shoulder, elbow and wrist label envelopes for the lesson poses.
    const envelopes = [
      [[-85, 95], [0, 150], [-100, 100]],
      [[10, 65], [170, 315], [-40, 65]],
      [[95, 190], [250, 465], [-95, 45]],
      [[275, 400], [160, 430], [-200, 45]],
    ];
    for (const [xs, ys, zs] of envelopes) for (const x of xs) for (const y of ys) for (const z of zs) {
      const p = project([x, y, z], camera);
      assert.ok(p.x > 0.04 && p.x < 0.96 && p.y > 0.04 && p.y < 0.96, JSON.stringify({aspect, x, y, z, p}));
    }
    assert.deepEqual(framed.target, KINEMATICS_STUDY_VIEW.target);
    if (aspect >= 1.05) assert.equal(framed, KINEMATICS_STUDY_VIEW);
    assert.equal(fitStudyView(view, aspect), view, 'other lessons retain their existing framing');
  }
});


test('the drawing plane occupies more screen area and the first four labels clear the initial forearm', () => {
  const previous = cameraAt([650, 820, 1150], 1190 / 1128, [210, 35, 0]);
  const current = cameraAt(view.position);
  const points = shapeLessonTargetPath(getShapeLesson('사각형', 0)).map(shapeWorldPoint);
  const area = camera => {
    const p = points.map(point => project(point, camera));
    return Math.abs(p.slice(0, -1).reduce((sum, point, index) =>
      sum + point.x * p[index + 1].y - p[index + 1].x * point.y, 0)) / 2;
  };
  assert.ok(area(current) > area(previous) * 2.4, 'P1–P4 need a materially larger reading area');
  // Initial rendered elbow/wrist pivots, in world millimetres; 40 mm covers the link width.
  const elbow = new THREE.Vector3(100.177, 391.774, 0.03);
  const wrist = new THREE.Vector3(227.693, 271.878, 17.03);
  for (const point of points.slice(0, 4)) {
    const direction = new THREE.Vector3(...point).sub(current.position).normalize();
    const sightline = new THREE.Ray(current.position, direction);
    assert.ok(sightline.distanceSqToSegment(elbow, wrist) > 40 ** 2, 'a corner must clear the forearm');
  }
});
