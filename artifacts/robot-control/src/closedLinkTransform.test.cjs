const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const THREE = require('three');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const compiled = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const api = {};
new Function('exports', 'require', compiled(read('closedLinkTransform.ts')))(api, name => {
  assert.equal(name, 'three'); return THREE;
});
const near = (actual, expected, message) => assert.ok(actual.distanceTo(expected) < 1e-8,
  `${message}: ${actual.toArray()} vs ${expected.toArray()}`);

function fixture() {
  const scene = new THREE.Scene(), robot = new THREE.Group(), urdf = new THREE.Group();
  scene.add(robot); robot.add(urdf);
  urdf.rotation.x = -Math.PI / 2; urdf.scale.setScalar(1000);
  const start = new THREE.Group(), end = new THREE.Group(), mesh = new THREE.Mesh();
  urdf.add(start, end); robot.add(mesh);
  start.position.set(.12, .015, .32); end.position.set(.295, -.019, .355);
  start.rotation.y = -.28;
  return { scene, robot, urdf, start, end, mesh, transform: new api.ClosedLinkTransform() };
}
function update(f) {
  f.transform.update(f.mesh, f.start, f.end);
  f.scene.updateMatrixWorld(true);
}
const points = [[0, .0235, 0], [.175, .0235, 0], [.09, .02, .025]];
const sample = mesh => points.map(p => mesh.localToWorld(new THREE.Vector3(...p)));
function assertBores(f) {
  const normal = new THREE.Vector3(0, 1, 0).transformDirection(f.start.matrixWorld);
  const a = f.start.getWorldPosition(new THREE.Vector3()), b = f.end.getWorldPosition(new THREE.Vector3());
  const [rear, front] = sample(f.mesh);
  // The centre of each bore may slide along its shaft; in-plane error must
  // vanish. The front bore's mid-plane retains the existing 17 mm calibration.
  const rearError = rear.clone().sub(a), frontError = front.clone().sub(b);
  near(rearError.clone().addScaledVector(normal, -rearError.dot(normal)), new THREE.Vector3(), 'rear mounting axis');
  near(frontError, normal.clone().multiplyScalar(17), 'front mounting mid-plane');
  near(new THREE.Vector3(0, 1, 0).transformDirection(f.mesh.matrixWorld), normal, 'parallel bore axes');
}

test('unparented link preserves millimetre dimensions, mounting axes and wrist mid-plane', () => {
  const f = fixture(); f.scene.add(f.mesh); update(f); assertBores(f);
  const [a, b] = sample(f.mesh);
  assert.ok(Math.abs(a.distanceTo(b) - Math.hypot(175, 35)) < 1e-8);
  const origin = f.mesh.localToWorld(new THREE.Vector3());
  const thickness = f.mesh.localToWorld(new THREE.Vector3(0, .01, 0)).distanceTo(origin);
  assert.ok(Math.abs(thickness - 10) < 1e-8, 'STL metres become world millimetres exactly once');
});

test('A and opposing B keep both link bores on their own live pivots without a second base transform', () => {
  const reference = fixture(); update(reference); const baseline = sample(reference.mesh);
  for (const [x, z, yaw] of [[0, 0, 0], [650, 0, Math.PI], [120, -230, .71]]) {
    const f = fixture(); f.robot.position.set(x, 0, z); f.robot.rotation.y = yaw;
    for (const delta of [0, .025, -.04, 0]) {
      f.end.position.z = .355 + delta;
      reference.end.position.z = .355 + delta; update(reference);
      update(f); assertBores(f);
      const expected = sample(reference.mesh).map(point => point.applyMatrix4(f.robot.matrixWorld));
      sample(f.mesh).forEach((point, i) => near(point, expected[i], 'rigid parent transform applies once'));
    }
    assert.ok(f.mesh.visible);
  }
  baseline.forEach((point, i) => near(point, sample(reference.mesh)[i], 'return to initial geometry'));
});

test('moving and scaled nested mesh parents leave the requested world construction exact', () => {
  const f = fixture(); update(f); const expected = sample(f.mesh);
  const parent = new THREE.Group(), ancestor = new THREE.Group();
  f.scene.add(ancestor); ancestor.add(parent); parent.add(f.mesh);
  for (const angle of [0, .5, Math.PI, -.7]) {
    ancestor.position.set(90, 10, -75); ancestor.rotation.set(.2, angle, -.1); ancestor.scale.set(2, 1.2, .7);
    parent.position.set(-12, 24, 60); parent.rotation.set(-.12, -.4, .3); parent.scale.set(.5, .8, 1.3);
    update(f);
    sample(f.mesh).forEach((point, i) => near(point, expected[i], 'parent inverse also handles nonuniform scale'));
  }
});

test('collapsed span hides the mesh and a later valid pose restores it without moving pivots', () => {
  const f = fixture(), originalStart = f.start.position.clone(), originalEnd = f.end.position.clone();
  f.end.position.copy(f.start.position); update(f); assert.equal(f.mesh.visible, false);
  f.end.position.copy(originalEnd); update(f); assert.equal(f.mesh.visible, true); assertBores(f);
  near(f.start.position, originalStart, 'start pivot unchanged'); near(f.end.position, originalEnd, 'end pivot unchanged');
});

test('the rendered DynamicClosedStlLink frame callback applies the parent-aware transform', () => {
  const ast = ts.createSourceFile('Robot3D.tsx', read('Robot3D.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'DynamicClosedStlLink');
  assert.ok(declaration);
  const refs = [], callbacks = [], exports = {};
  const source = `export ${declaration.getText(ast)}`;
  new Function('exports', 'require', 'useRef', 'useMemo', 'useFrame', 'ClosedLinkTransform', compiled(source))(
    exports, require,
    value => { const ref = { current: value }; refs.push(ref); return ref; },
    factory => factory(), callback => callbacks.push(callback), api.ClosedLinkTransform,
  );
  const f = fixture(); f.robot.position.x = 650; f.robot.rotation.y = Math.PI;
  const startRef = { current: f.start }, endRef = { current: f.end };
  exports.DynamicClosedStlLink({ geometry: f.mesh.geometry, material: f.mesh.material, startRef, endRef });
  assert.equal(refs.length, 1); refs[0].current = f.mesh; assert.equal(callbacks.length, 1);
  callbacks[0](); f.scene.updateMatrixWorld(true); assertBores(f);
  const currentMatrix = f.mesh.matrix.clone(); endRef.current = null; callbacks[0]();
  assert.deepEqual(f.mesh.matrix, currentMatrix, 'loading/missing pivots do not fabricate a transform');
});
