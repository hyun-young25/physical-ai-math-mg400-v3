const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const THREE = require('three');
const React = require('react');

function load(file, deps = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('exports', 'require', code)(exports, name => {
    assert.ok(name in deps, `Unmapped dependency: ${name}`);
    return deps[name];
  });
  return exports;
}
const nodes = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes)
  : [node, ...nodes(node.props?.children)];
const textOf = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(textOf).join('')
  : typeof node === 'object' ? textOf(node.props?.children) : String(node);
const named = (tree, name) => nodes(tree).filter(node => typeof node.type === 'function' && node.type.name === name);
const curriculum = load('curriculum.ts');
const cell = load('processCell.ts', { './curriculum': curriculum });
const model = load('processKinematics.ts').PROCESS_MODEL;
const visualFor = level => {
  const scenario = cell.processScenario(level);
  return { scenario, frame: cell.initialProcessFrame(model, scenario), showCoordinates: false, selectedRobot: 'A', running: false };
};

/** Run actual scene components without creating a WebGL renderer. Frame and
 * effect callbacks run explicitly, so geometry identity/recovery can be checked. */
function harness() {
  let active;
  let timerId = 0;
  const timers = new Map();
  global.window = { setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id) };
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]));
  const memo = (factory, deps) => {
    const env = active, i = env.cursor++, old = env.slots[i];
    if (!old || changed(old.deps, deps)) env.slots[i] = { value: factory(), deps };
    return env.slots[i].value;
  };
  const react = {
    Component: React.Component, Suspense: 'Suspense', memo: component => component,
    useRef(value) { const env = active, i = env.cursor++; return env.slots[i] ?? (env.slots[i] = { current: value }); },
    useState(initial) {
      const env = active, i = env.cursor++;
      if (!(i in env.slots)) env.slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [env.slots[i].value, value => {
        const next = typeof value === 'function' ? value(env.slots[i].value) : value;
        if (!Object.is(next, env.slots[i].value)) { env.slots[i].value = next; env.dirty = true; }
      }];
    },
    useMemo: memo, useCallback: (callback, deps) => memo(() => callback, deps),
    useEffect(callback, deps) {
      const env = active, i = env.cursor++, old = env.slots[i];
      if (!old || changed(old.deps, deps)) env.effects.push(() => {
        old?.cleanup?.(); env.slots[i] = { deps, cleanup: callback() };
      });
    },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  function ProcessRobotModel() {}
  const api = load('ProcessCellScene.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, three: THREE,
    '@react-three/fiber': { Canvas: 'Canvas', useFrame: (callback, priority = 0) => active.frames.push({ callback, priority }), useThree: () => ({}) },
    '@react-three/drei': { Html: 'Html', Line: 'Line', OrbitControls: 'OrbitControls', PerspectiveCamera: 'PerspectiveCamera' },
    './processCell': cell, './Robot3D': { ProcessRobotModel }, './processCamera': { processCameraFit: () => ({}) },
  });
  function mount(Component, initialProps) {
    const env = { slots: [], effects: [], cursor: 0, frames: [], dirty: false, tree: null, props: initialProps };
    env.render = (next = env.props) => {
      env.props = next;
      let renders = 0;
      do {
        env.dirty = false; env.cursor = 0; env.frames = []; active = env;
        env.tree = Component(env.props);
        while (env.effects.length) env.effects.shift()();
        assert.ok(++renders < 20, 'Scene state must settle');
      } while (env.dirty);
      return env.tree;
    };
    env.tick = () => env.frames.slice().sort((a, b) => a.priority - b.priority).forEach(frame => frame.callback());
    env.render();
    return env;
  }
  return { mount, api, timers, flushTimers() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } } };
}

function child(scene, name, index = 0) {
  const node = named(scene.tree, name)[index];
  assert.ok(node, `${name} exists`);
  return node;
}
const sceneProps = visual => ({ visual, model, onReadyChange() {} });

test('playback snapshots keep robot/static props and every fixed line geometry identity stable', () => {
  const h = harness(), visual = visualFor(4);
  visual.liveFrameRef = { current: visual.frame };
  const scene = h.mount(h.api.ProcessCellScene, sceneProps(visual));
  const before = Object.fromEntries(['CellRobotModel', 'Tray', 'Conveyor', 'Target'].map(name => [name, child(scene, name)]));
  const outline = h.mount(before.Target.type, before.Target.props);
  const targetPoints = nodes(outline.tree).find(node => node.type === 'Line').props.points;
  const tray = h.mount(before.Tray.type, before.Tray.props);
  const trayPoints = nodes(tray.tree).filter(node => node.type === 'Line').map(node => node.props.points);
  for (let i = 1; i <= 60; i++) {
    const frame = { ...visual.frame, atMs: i * 16, phase: `frame ${i}` };
    visual.liveFrameRef.current = frame;
    scene.render({ ...scene.props, visual: { ...visual, frame } });
    for (const name of Object.keys(before)) {
      const after = child(scene, name);
      assert.equal(after.type, before[name].type);
      for (const key of Object.keys(after.props)) assert.equal(after.props[key], before[name].props[key], `${name}.${key} is stable`);
    }
    // Even a forced component render cannot replace fixed Line point arrays.
    outline.render(); tray.render();
    assert.equal(nodes(outline.tree).find(node => node.type === 'Line').props.points, targetPoints);
    nodes(tray.tree).filter(node => node.type === 'Line').forEach((line, index) => assert.equal(line.props.points, trayPoints[index]));
  }
});

test('changing level retains Canvas identity and makes only current scenario model callbacks ready', () => {
  const h = harness(), reports = [];
  const scene = h.mount(h.api.ProcessCellScene, { ...sceneProps(visualFor(1)), onReadyChange: ready => reports.push(ready) });
  const boundary = child(scene, 'CellSceneBoundary'), oldModel = child(scene, 'CellRobotModel');
  oldModel.props.onReady('A', true); scene.render(); assert.equal(reports.at(-1), true);
  scene.render({ ...scene.props, visual: visualFor(4) });
  assert.equal(child(scene, 'CellSceneBoundary').key, boundary.key, 'No context remount on level change');
  assert.equal(reports.at(-1), false);
  const newModel = child(scene, 'CellRobotModel');
  oldModel.props.onReady('A', true); scene.render(); assert.equal(reports.at(-1), false);
  newModel.props.onReady('A', true); newModel.props.onReady('B', true); scene.render(); assert.equal(reports.at(-1), true);
  oldModel.props.onReady('A', false); scene.render(); assert.equal(reports.at(-1), true);
});

test('robot, workpiece, target and conveyor consume exact live frames without another React render', () => {
  const h = harness(), visual = visualFor(4);
  visual.running = true; visual.liveFrameRef = { current: visual.frame };
  const scene = h.mount(h.api.ProcessCellScene, sceneProps(visual));
  const robotNode = child(scene, 'CellRobotModel'), robot = h.mount(robotNode.type, robotNode.props);
  const modelNode = child(robot, 'ProcessRobotModel');
  const initialJoints = modelNode.props.joints;
  const targetNode = child(scene, 'Target'), target = h.mount(targetNode.type, targetNode.props);
  const targetObject = new THREE.Group(); target.tree.props.ref.current = targetObject;
  const pieceNode = child(scene, 'Workpiece'), piece = h.mount(pieceNode.type, pieceNode.props);
  const pieceObject = new THREE.Group(); piece.tree.props.ref.current = pieceObject;
  const conveyorNode = child(scene, 'Conveyor'), conveyor = h.mount(conveyorNode.type, conveyorNode.props);
  const stripeNode = nodes(conveyor.tree).find(node => node.type === 'mesh' && typeof node.props.ref === 'function');
  const stripe = new THREE.Mesh(); stripeNode.props.ref(stripe);
  const tcp = new THREE.Mesh(); tcp.position.set(73, 92, -46); tcp.updateMatrixWorld();
  pieceNode.props.tcpRefs.A.current = tcp;
  const liveJoints = { j1: 12, j2: 33, j3: -44, j4: 55 };
  const owned = { ...visual.frame.workpieces[0], owner: 'A' };
  const live = { ...visual.frame, atMs: 1200, robots: { A: { joints: liveJoints, pose: { x: 73, y: 46, z: 92, r: 31 } } },
    target: { x: 101, y: 102, z: 103, r: 0 }, workpieces: [owned], beltProgress: 0.4 };
  visual.liveFrameRef.current = live;
  robot.tick(); target.tick(); piece.tick(); conveyor.tick();
  assert.equal(robot.frames[0].priority, -2, 'Copy joints before the URDF frame callback');
  assert.equal(modelNode.props.liveJointsRef.current, liveJoints);
  assert.equal(modelNode.props.joints, initialJoints, 'React model props stay fixed');
  assert.deepEqual(targetObject.position.toArray(), [101, 103, -102]);
  assert.deepEqual(pieceObject.position.toArray(), [73, 92, -46]);
  const previousStripe = stripe.position.z;
  visual.liveFrameRef.current = { ...live, beltProgress: 0.5, target: null,
    workpieces: [{ ...owned, owner: null, top: { x: 9, y: 8, z: 7, r: 6 } }] };
  target.tick(); piece.tick(); conveyor.tick();
  assert.equal(targetObject.visible, false);
  assert.deepEqual(pieceObject.position.toArray(), [9, 7, -8]);
  assert.notEqual(stripe.position.z, previousStripe);
});

test('legacy visuals without a live ref keep their snapshot target and workpiece positions', () => {
  const h = harness(), visual = visualFor(1);
  const scene = h.mount(h.api.ProcessCellScene, sceneProps(visual));
  const targetNode = child(scene, 'Target'), target = h.mount(targetNode.type, targetNode.props);
  const object = new THREE.Group(); target.tree.props.ref.current = object; target.tick();
  assert.deepEqual(object.position.toArray(), [visual.scenario.destination.x, visual.scenario.destination.z, -visual.scenario.destination.y]);
  const pieceNode = child(scene, 'Workpiece'), piece = h.mount(pieceNode.type, pieceNode.props);
  const block = new THREE.Group(); piece.tree.props.ref.current = block; piece.tick();
  const top = visual.frame.workpieces[0].top;
  assert.deepEqual(block.position.toArray(), [top.x, top.z, -top.y]);
});

test('context loss closes the ready gate, retries once, ignores disposed models and still allows manual recovery', () => {
  const h = harness(), reports = [], visual = visualFor(1);
  const scene = h.mount(h.api.ProcessCellScene, { ...sceneProps(visual), onReadyChange: ready => reports.push(ready) });
  const oldModel = child(scene, 'CellRobotModel');
  oldModel.props.onReady('A', true); scene.render(); assert.equal(reports.at(-1), true);
  const oldContext = child(scene, 'ContextStatus');
  oldContext.props.onLost(); scene.render(); assert.equal(reports.at(-1), false);
  assert.equal(h.timers.size, 1);
  h.flushTimers(); scene.render();
  assert.equal(child(scene, 'CellSceneBoundary').key, 1);
  assert.equal(reports.at(-1), false, 'A replacement canvas is not ready until models mount');
  const currentModel = child(scene, 'CellRobotModel');
  oldModel.props.onReady('A', true); scene.render(); assert.equal(reports.at(-1), false);
  currentModel.props.onReady('A', true); scene.render(); assert.equal(reports.at(-1), true);
  oldModel.props.onReady('A', false); oldContext.props.onLost(); scene.render(); assert.equal(reports.at(-1), true);
  child(scene, 'ContextStatus').props.onLost(); scene.render();
  assert.equal(reports.at(-1), false); assert.equal(h.timers.size, 0, 'Repeated loss cannot create an automatic restart loop');
  assert.equal(scene.props.visual, visual, 'Recovery never modifies or restarts lesson playback');
  const retry = nodes(scene.tree).find(node => node.type === 'button' && textOf(node) === '3D 화면 다시 열기');
  assert.ok(retry); retry.props.onClick(); scene.render();
  assert.equal(child(scene, 'CellSceneBoundary').key, 2); assert.equal(reports.at(-1), false);
});

test('render failures expose the same bounded recovery instead of requiring a page reload', () => {
  const h = harness();
  const scene = h.mount(h.api.ProcessCellScene, sceneProps(visualFor(1)));
  child(scene, 'CellSceneBoundary').props.onError(); scene.render();
  assert.match(textOf(scene.tree), /3D 화면 다시 열기/);
  assert.equal(h.timers.size, 1);
  h.flushTimers(); scene.render();
  child(scene, 'CellSceneBoundary').props.onError(); scene.render();
  assert.equal(h.timers.size, 0);
  assert.match(textOf(scene.tree), /3D 화면을 다시 열어 주세요/);
});

test('review target stays at the real missed block while the TCP marker follows the rendered robot tip', () => {
  const h = harness(), visual = visualFor(2);
  visual.showCoordinates = true; visual.reviewing = true;
  visual.focusPoint = { ...visual.scenario.source };
  visual.frame = { ...visual.frame, atMs: 1000, robots: { A: {
    joints: model.ik(280, 60, 220, 0), pose: { x: 280, y: 60, z: 220, r: 0 },
  } } };
  const scene = h.mount(h.api.ProcessCellScene, sceneProps(visual));
  const targetNode = child(scene, 'Target'), target = h.mount(targetNode.type, targetNode.props);
  const targetObject = new THREE.Group(); target.tree.props.ref.current = targetObject;
  const markerNode = child(scene, 'TcpMarker'), marker = h.mount(markerNode.type, markerNode.props);
  const tcp = new THREE.Mesh(); tcp.position.set(280, 220, -60); tcp.updateMatrixWorld();
  markerNode.props.tcpRef.current = tcp;
  const markerObject = new THREE.Group(); marker.tree.props.ref.current = markerObject;
  target.tick(); marker.tick();
  assert.deepEqual(targetObject.position.toArray(), [280, 220, 110]);
  assert.deepEqual(markerObject.position.toArray(), [280, 220, -60]);
  assert.ok(textOf(scene.tree).includes('거리 170.0 mm'));
  scene.render({ ...scene.props, visual: { ...visual, focusPoint: undefined } }); target.tick();
  assert.equal(targetObject.visible, false, 'a preflight-only observation cannot invent a completed target');
});

test('cooperative scene marks the shared handoff and both robot frames without revealing an unsubmitted coordinate', () => {
  const h = harness(), visual = visualFor(3);
  visual.showCoordinates = true; visual.selectedRobot = 'B'; visual.hideTargetCoordinates = true;
  const scene = h.mount(h.api.ProcessCellScene, sceneProps(visual));
  const targetNode = child(scene, 'Target'), target = h.mount(targetNode.type, targetNode.props);
  const marker = new THREE.Group(); target.tree.props.ref.current = marker; target.tick();
  assert.deepEqual(marker.position.toArray(), [300, 220, -40], 'initial focus is the actual common handoff, not the final destination');
  assert.equal(targetNode.props.label, '공용 인계점 H');
  for (const [index, id] of ['A', 'B'].entries()) {
    const node = child(scene, 'CellRobotModel', index), robot = h.mount(node.type, node.props);
    const axes = child(robot, 'CoordinateFrame'), frame = h.mount(axes.type, axes.props);
    assert.ok(textOf(frame.tree).includes(`${id} 원점`));
    assert.equal(robot.tree.props.rotation[1], index * Math.PI, 'coordinate directions follow the unchanged robot base rotation');
  }
  assert.ok(!textOf(scene.tree).includes('선택 지점'));
  assert.ok(!textOf(scene.tree).includes('거리'));
  scene.render({ ...scene.props, visual: { ...visual, hideTargetCoordinates: false } });
  assert.ok(textOf(scene.tree).includes('(350.0, -40.0, 220.0)'));
});

test('entering a reference-view level restores its overview once while playback and manual views stay stable', () => {
  const h = harness(); let resets = 0;
  const scene = h.mount(h.api.ProcessCellScene, { ...sceneProps(visualFor(2)), viewPreset: 'front', onViewFree: () => resets++ });
  assert.equal(resets, 0);
  const visual = visualFor(3);
  scene.render({ ...scene.props, visual });
  assert.equal(resets, 1); assert.equal(child(scene, 'CellCamera').props.scope, 'whole');
  const zoom = nodes(scene.tree).find(node => node.type === 'button' && textOf(node) === '인계점 확대');
  zoom.props.onClick(); scene.render();
  assert.equal(resets, 2); assert.equal(child(scene, 'CellCamera').props.scope, 'work');
  for (let index = 1; index <= 10; index++) scene.render({ ...scene.props, visual: { ...visual, frame: { ...visual.frame, atMs: index * 100 } } });
  assert.equal(resets, 2); assert.equal(child(scene, 'CellCamera').props.scope, 'work');
  scene.render({ ...scene.props, visual: visualFor(4) });
  assert.equal(resets, 3); assert.equal(child(scene, 'CellCamera').props.scope, 'work');
  scene.render({ ...scene.props, visual: visualFor(1) });
  assert.equal(resets, 4); assert.equal(child(scene, 'CellCamera').props.scope, 'whole');
  const work = nodes(scene.tree).find(node => node.type === 'button' && textOf(node) === '작업점 확대');
  work.props.onClick(); scene.render();
  assert.equal(resets, 5); assert.equal(child(scene, 'CellCamera').props.scope, 'work');
  scene.render({ ...scene.props, visual: { ...scene.props.visual, frame: { ...scene.props.visual.frame, atMs: 100 } } });
  assert.equal(resets, 5); assert.equal(child(scene, 'CellCamera').props.scope, 'work');
});

test('preview follows its moving target rather than the previously selected workpoint', () => {
  const h = harness(), visual = visualFor(1);
  visual.showCoordinates = true;
  visual.predictionPreview = { playing: false, progress: 40 };
  visual.focusPoint = visual.scenario.destination;
  visual.frame = { ...visual.frame, atMs: 1000, target: { x: 270, y: -90, z: 300, r: 0 } };
  visual.liveFrameRef = { current: visual.frame };
  const scene = h.mount(h.api.ProcessCellScene, sceneProps(visual));
  const targetNode = child(scene, 'Target'), target = h.mount(targetNode.type, targetNode.props);
  const object = new THREE.Group(); target.tree.props.ref.current = object; target.tick();
  assert.equal(targetNode.props.label, '예측 이동 지점');
  assert.deepEqual(object.position.toArray(), [270, 300, 90]);
  assert.match(textOf(scene.tree), /예측 미리보기 · 40%/);
  assert.match(textOf(scene.tree), /예측 TCP/);
  visual.liveFrameRef.current = { ...visual.frame, target: { x: 300, y: 90, z: 220, r: 0 } };
  target.tick();
  assert.deepEqual(object.position.toArray(), [300, 220, -90]);
});

test('route arrows follow each robot world-space direction including reverse vertical travel', () => {
  const h = harness(), visual = visualFor(3);
  const a = { x: 300, y: -90, z: 220, r: 0 }, b = { ...a, z: 300 }, c = { ...b, y: 90 };
  visual.predictedRoutes = [{ robot: 'A', segments: [{ from: a, to: b }, { from: b, to: c }] },
    { robot: 'B', segments: [{ from: b, to: a }] }];
  const scene = h.mount(h.api.ProcessCellScene, sceneProps(visual));
  for (const [index, node] of named(scene.tree, 'RouteSegment').entries()) {
    const segment = h.mount(node.type, node.props);
    const line = nodes(segment.tree).find(item => item.type === 'Line');
    const arrow = nodes(segment.tree).find(item => item.type === 'mesh');
    const start = new THREE.Vector3(...line.props.points[0]), end = new THREE.Vector3(...line.props.points[1]);
    const direction = end.clone().sub(start).normalize();
    assert.ok(new THREE.Vector3(0, 1, 0).applyQuaternion(arrow.props.quaternion).distanceTo(direction) < 1e-10);
    assert.ok(new THREE.Vector3(...arrow.props.position).distanceTo(start.lerp(end, 0.62)) < 1e-10);
    assert.equal(line.props.color, index === 2 ? '#0f766e' : '#6366f1');
    const points = line.props.points;
    segment.render();
    assert.equal(nodes(segment.tree).find(item => item.type === 'Line').props.points, points);
  }
});
