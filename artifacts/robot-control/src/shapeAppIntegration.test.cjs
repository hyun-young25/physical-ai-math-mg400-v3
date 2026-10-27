const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function load(name, dependencies = {}) {
  const exported = {};
  new Function('exports', 'require', compile(read(name)))(exported, dependency => {
    assert.ok(dependency in dependencies, `Unexpected dependency ${dependency}`);
    return dependencies[dependency];
  });
  return exported;
}
const processModel = load('processKinematics.ts');
const shapeModel = load('shapeKinematics.ts', { './processKinematics': processModel });
const source = ts.createSourceFile('App.tsx', read('App.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const app = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'AppInner');
assert.ok(app?.body, 'App component must exist');
const declarations = new Map(app.body.statements.filter(ts.isVariableStatement)
  .flatMap(statement => [...statement.declarationList.declarations])
  .map(declaration => [declaration.name.getText(source), declaration]));
function variable(name) {
  const declaration = declarations.get(name);
  assert.ok(declaration?.initializer, `Missing App initializer ${name}`);
  return `const ${name} = ${declaration.initializer.getText(source)};`;
}
const modelEffect = app.body.statements.find(statement => {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return false;
  const call = statement.expression;
  return call.expression.getText(source) === 'useEffect' && call.arguments[1] && ts.isArrayLiteralExpression(call.arguments[1])
    && call.arguments[1].elements.some(element => element.getText(source) === 'shapeKinematicsActive');
});
assert.ok(modelEffect, 'Coordinate-model switching effect must exist');
const coreSource = source.statements.filter(statement =>
  (ts.isFunctionDeclaration(statement) && ['fkMG400', 'ikMG400'].includes(statement.name?.text)) ||
  (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration =>
    ['ARM_L1', 'COORD_OX', 'COORD_OZ'].includes(declaration.name.getText(source)))))
  .map(statement => statement.getText(source)).join('\n');
const core = new Function(`${compile(coreSource)}; return {fkMG400, ikMG400, COORD_OX, COORD_OZ};`)();
const callbacks = ['moveTo', 'computeFK', 'getJoints', 'computeIK', 'moveToJoints', 'syncMoveEnd',
  'finishLessonMove', 'captureShapePose', 'restoreShapePose'];

// Evaluate the real App handlers without mounting its unrelated 3D, hardware,
// and lesson components. React state and refs stay separate until effects flush.
const makeCallbacks = new Function('env', compile(`
  const {activeNav, coordinateTopic, connectedTo, SHAPE_MODEL,
    jointsRef, coordsRef, displayJointsRef, liveJointsRef, liveCoordsRef,
    previousShapeModel, setJoints, setCoords, setDisplayJoints,
    fkMG400, ikMG400, COORD_OX, COORD_OZ} = env;
  const useCallback = callback => callback;
  const useEffect = callback => { env.effect = callback; };
  const practice = { hardware: false, snap: { busy: false, measurement: null } };
  const prRef = { current: practice };
  const setHwNotice = () => {};
  ${variable('isShapeLesson')}
  ${variable('shapeKinematicsActive')}
  ${callbacks.map(variable).join('\n')}
  ${modelEffect.getText(source)}
  return {${callbacks.join(', ')}};
`));
const clone = value => structuredClone(value);
const near = (actual, expected, message, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${message}: ${actual} versus ${expected}`);
function poseNear(actual, expected) {
  for (const key of ['x', 'y', 'z']) near(actual[key], expected[key], key);
  near(processModel.processAngle(actual.r - expected.r), 0, 'world tool yaw');
}
function legacyFK(joints) {
  const pose = core.fkMG400(joints.j1, joints.j2, joints.j3);
  return { x: pose.x + core.COORD_OX, y: pose.y, z: pose.z + core.COORD_OZ, r: joints.j4 };
}
function assertPenAndReadout(joints, pose) {
  // The assembly's suction-tip FK is independently checked against its actual
  // nested transforms in shapeKinematics.test.cjs. Account for the visible pen.
  const tip = processModel.processFK(joints), world = shapeModel.shapeWorldPoint(pose);
  near(tip.x, world[0], 'visible pen world X');
  near(tip.z - shapeModel.SHAPE_PEN_TIP_OFFSET, world[1], 'visible pen world height');
  near(-tip.y, world[2], 'visible pen world Z');
  near(processModel.processAngle(tip.r - pose.r), 0, 'visible tool yaw');
}
function mount({ shape = true, connectedTo = null } = {}) {
  const joints = { j1: 16.1234567, j2: 69.02, j3: -113.32, j4: -8.7654321 };
  const state = { joints: clone(joints), coords: legacyFK(joints),
    displayJoints: { j1: 12.34, j2: 23.45, j3: 34.56, j4: joints.j4 } };
  const env = { ...core, SHAPE_MODEL: shapeModel.SHAPE_MODEL,
    activeNav: '좌표와 로봇 이동', coordinateTopic: shape ? 'shapes' : 'axis', connectedTo,
    jointsRef: { current: clone(joints) }, coordsRef: { current: clone(state.coords) },
    displayJointsRef: { current: clone(state.displayJoints) },
    liveJointsRef: { current: null }, liveCoordsRef: { current: null },
    previousShapeModel: { current: false },
  };
  for (const [setter, key] of [['setJoints', 'joints'], ['setCoords', 'coords'], ['setDisplayJoints', 'displayJoints']]) {
    env[setter] = update => { state[key] = typeof update === 'function' ? update(state[key]) : update; };
  }
  let handlers;
  function render(update = {}) {
    Object.assign(env, update);
    handlers = makeCallbacks(env);
    env.effect();
    return handlers;
  }
  render();
  return { env, state, render, get handlers() { return handlers; },
    flushStateEffects() {
      env.jointsRef.current = state.joints;
      env.coordsRef.current = state.coords;
      env.displayJointsRef.current = state.displayJoints;
    },
  };
}

test('App MoveL uses the visible pen model along the complete square, including its closing edge', () => {
  const app = mount(), { env, handlers } = app;
  const corners = [[200, 100], [300, 100], [300, -100], [200, -100], [200, 100]];
  for (let segment = 1; segment < corners.length; segment++) {
    const [ax, ay] = corners[segment - 1], [bx, by] = corners[segment];
    for (let step = 0; step <= 20; step++) {
      const t = step / 20, target = { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, z: 0, r: 0 };
      handlers.moveTo(target.x, target.y, target.z, target.r);
      poseNear(env.liveCoordsRef.current, target);
      poseNear(handlers.computeFK(handlers.getJoints()), target);
      assertPenAndReadout(handlers.getJoints(), target);
    }
  }
});

test('App MoveJ solves and reports the same actual pen and world orientation at each interpolated joint pose', () => {
  const app = mount(), { handlers, env } = app;
  const from = handlers.computeIK(200, 100, 0, 25, -113.32);
  const to = handlers.computeIK(300, -100, 0, 25, from.j3);
  assert.ok(from && to);
  for (let step = 0; step <= 30; step++) {
    const t = step / 30;
    const joints = Object.fromEntries(Object.keys(from).map(key => [key, from[key] + (to[key] - from[key]) * t]));
    handlers.moveToJoints(joints);
    assert.deepEqual(handlers.getJoints(), joints);
    poseNear(env.liveCoordsRef.current, handlers.computeFK(joints));
    assertPenAndReadout(joints, env.liveCoordsRef.current);
    near(env.liveCoordsRef.current.r, 25, 'world yaw compensated by wrist');
  }
  poseNear(env.liveCoordsRef.current, { x: 300, y: -100, z: 0, r: 25 });
});

test('App motion completion flushes actual FK to readout and refs once, preserving calibrated joint display offsets', () => {
  const app = mount(), { env, state, handlers } = app;
  const before = clone(state);
  handlers.moveTo(240, -85, 10, 35);
  const finalJoints = clone(env.liveJointsRef.current), finalPose = handlers.computeFK(finalJoints);
  handlers.finishLessonMove();
  assert.equal(env.liveJointsRef.current, null);
  assert.equal(env.liveCoordsRef.current, null);
  assert.deepEqual(state.joints, finalJoints);
  assert.deepEqual(env.jointsRef.current, finalJoints);
  assert.deepEqual(state.coords, finalPose);
  assert.deepEqual(env.coordsRef.current, finalPose);
  for (const key of ['j1', 'j2', 'j3']) {
    assert.equal(state.displayJoints[key], Number((before.displayJoints[key] + finalJoints[key] - before.joints[key]).toFixed(2)));
  }
  assert.equal(state.displayJoints.j4, finalJoints.j4);
  assertPenAndReadout(state.joints, state.coords);
  const settled = clone(state);
  handlers.finishLessonMove();
  assert.deepEqual(state, settled, 'a second end callback cannot apply joint offsets twice');
});

for (const options of [{ shape: false }, { shape: true, connectedTo: 'device' }, { shape: false, connectedTo: 'device' }]) {
  test(`App retains legacy lesson/hardware coordinates for ${JSON.stringify(options)}`, () => {
    const app = mount(options), { handlers, env, state } = app;
    const target = { x: 300, y: 40, z: 20, r: 17 };
    const expected = { ...core.ikMG400(target.x - core.COORD_OX, target.y, target.z - core.COORD_OZ, state.joints.j3), j4: target.r };
    assert.deepEqual(handlers.computeFK(state.joints), legacyFK(state.joints));
    assert.deepEqual(handlers.computeIK(target.x, target.y, target.z, target.r, state.joints.j3), expected);
    handlers.moveTo(target.x, target.y, target.z, target.r);
    assert.deepEqual(env.liveJointsRef.current, expected);
    assert.deepEqual(env.liveCoordsRef.current, target);
    handlers.moveToJoints(expected);
    assert.deepEqual(env.liveCoordsRef.current, legacyFK(expected));
    handlers.finishLessonMove();
    assert.deepEqual(state.coords, legacyFK(expected));
  });
}

test('switching into and out of 2-4 updates the coordinate model without moving the robot or changing display joints', () => {
  const app = mount({ shape: false }), { env, state } = app;
  const joints = clone(state.joints), display = clone(state.displayJoints);
  app.render({ coordinateTopic: 'shapes' });
  poseNear(state.coords, shapeModel.shapeFK(joints));
  assertPenAndReadout(joints, state.coords);
  assert.deepEqual(state.joints, joints);
  assert.deepEqual(env.jointsRef.current, joints);
  assert.deepEqual(state.displayJoints, display);
  app.render({ coordinateTopic: 'axis' });
  assert.deepEqual(state.coords, legacyFK(joints));
  assert.deepEqual(state.joints, joints);
  assert.deepEqual(state.displayJoints, display);
});

test('model switching never overwrites connected hardware telemetry, and recomputes it on disconnect', () => {
  const app = mount(), { env, state } = app;
  const telemetry = { x: 222, y: -45, z: 83, r: 21 };
  state.coords = clone(telemetry); env.coordsRef.current = clone(telemetry);
  const joints = clone(state.joints);
  app.render({ connectedTo: 'device' });
  assert.deepEqual(state.coords, telemetry);
  assert.deepEqual(env.coordsRef.current, telemetry);
  assert.deepEqual(state.joints, joints);
  app.render({ connectedTo: null });
  poseNear(state.coords, shapeModel.shapeFK(joints));
  assert.deepEqual(state.joints, joints);
});

test('mid-run model changes use the synchronously flushed joint pose before React state effects settle', () => {
  for (const startsInShape of [true, false]) {
    const app = mount({ shape: startsInShape }), { env, state } = app;
    const oldHandlers = app.handlers;
    oldHandlers.moveTo(250, -70, 0, 15);
    const liveJoints = clone(env.liveJointsRef.current), previousStateJoints = clone(state.joints);
    assert.notDeepEqual(liveJoints, previousStateJoints);
    // Lesson cleanup uses the previous render's callback. The new coordinate
    // model's effect can then run before the state-to-ref synchronization effect.
    oldHandlers.finishLessonMove();
    assert.deepEqual(env.jointsRef.current, liveJoints);
    app.render({ coordinateTopic: startsInShape ? 'axis' : 'shapes' });
    const expected = startsInShape ? legacyFK(liveJoints) : shapeModel.shapeFK(liveJoints);
    assert.deepEqual(state.joints, liveJoints);
    assert.deepEqual(env.jointsRef.current, liveJoints);
    assert.deepEqual(state.coords, expected);
    assert.deepEqual(env.coordsRef.current, expected);
    assert.equal(env.liveJointsRef.current, null);
    assert.equal(env.liveCoordsRef.current, null);
    assert.deepEqual(app.handlers.computeFK(app.handlers.getJoints()), expected);
  }
});

test('saved shape pose restores exact joints, coordinates and calibrated display after end-of-motion flush', () => {
  const app = mount(), { handlers, env, state } = app;
  const saved = handlers.captureShapePose(), original = clone(saved);
  handlers.moveTo(200, -100, 0, 0);
  handlers.finishLessonMove(); app.flushStateEffects();
  assert.notDeepEqual(state.joints, original.joints);
  handlers.restoreShapePose(saved);
  assert.deepEqual(state.joints, original.joints);
  assert.deepEqual(state.coords, original.coords);
  assert.deepEqual(state.displayJoints, original.displayJoints);
  assert.deepEqual(env.jointsRef.current, original.joints);
  assert.deepEqual(env.coordsRef.current, original.coords);
  assert.deepEqual(env.displayJointsRef.current, original.displayJoints);
  assert.equal(env.liveJointsRef.current, null);
  assert.equal(env.liveCoordsRef.current, null);
  assert.deepEqual(saved, original);
  saved.joints.j1 = 999; saved.coords.x = 999; saved.displayJoints.j1 = 999;
  assert.deepEqual(handlers.captureShapePose(), original, 'restoration must not retain mutable snapshot aliases');
});

test('unreachable drawing commands preserve the last live pose and cannot corrupt the final readout', () => {
  const app = mount(), { handlers, env, state } = app;
  handlers.moveTo(240, 70, 0, 0);
  const joints = clone(env.liveJointsRef.current), pose = clone(env.liveCoordsRef.current);
  assert.equal(handlers.computeIK(1000, 0, 0, 0, joints.j3), null);
  handlers.moveTo(1000, 0, 0, 0);
  assert.deepEqual(env.liveJointsRef.current, joints);
  assert.deepEqual(env.liveCoordsRef.current, pose);
  handlers.finishLessonMove();
  assert.deepEqual(state.joints, joints);
  poseNear(state.coords, pose);
});

test('App passes connection and enabled-home readiness separately so a disabled device still locks DT execution', () => {
  let missionPanel = declarations.get('missionPanel')?.initializer;
  if (missionPanel && ts.isIdentifier(missionPanel)) missionPanel = declarations.get(missionPanel.text)?.initializer;
  assert.ok(missionPanel, 'Mission panel binding must exist');
  let robotArm;
  function visit(node) {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === 'RobotArm') robotArm = node;
    ts.forEachChild(node, visit);
  }
  visit(missionPanel);
  assert.ok(robotArm, 'Mission panel must render RobotArm');
  function propExpression(name) {
    const prop = robotArm.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === name);
    assert.ok(prop?.initializer && ts.isJsxExpression(prop.initializer) && prop.initializer.expression, `Missing ${name} binding`);
    return prop.initializer.expression.getText(source);
  }
  const evaluate = new Function('connectedTo', 'robotEnabled', 'robotHomed', compile(`
    const activeNav = '좌표와 로봇 이동', coordinateTopic = 'shapes';
    ${variable('isLive')}
    ${variable('isShapeLesson')}
    ${variable('shapeKinematicsActive')}
    return { shapeKinematicsActive, hardwareConnected: ${propExpression('hardwareConnected')},
      hardwareHomed: ${propExpression('hardwareHomed')} };
  `));
  for (const connectedTo of [null, { ip: '192.0.2.1', port: '29999' }]) {
    for (const enabled of [false, true]) {
      for (const homed of [false, true]) {
        const actual = evaluate(connectedTo, enabled, homed);
        assert.equal(actual.hardwareConnected, !!connectedTo, 'every device connection locks the DT run handler');
        assert.equal(actual.hardwareHomed, !!connectedTo && enabled && homed, 'hardware execution requires connection, enabled motors and homing');
        assert.equal(actual.shapeKinematicsActive, !actual.hardwareConnected, 'DT gate and shape-only model must use the same connection boundary');
      }
    }
  }
});


test('path-view reset changes only the camera request and leaves robot pose and execution untouched', () => {
  let preset = 'side', requestKey = 7;
  const restore = new Function('setViewPreset', 'setShapeStudyViewKey',
    compile(variable('restoreShapeStudyView')) + '; return restoreShapeStudyView;')(
      value => { preset = value; }, update => { requestKey = update(requestKey); });
  restore();
  assert.equal(preset, 'free');
  assert.equal(requestKey, 8);
  restore();
  assert.equal(requestKey, 9, 'each explicit click requests the path view again');
});
