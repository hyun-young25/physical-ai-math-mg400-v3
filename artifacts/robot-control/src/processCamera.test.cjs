const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const THREE = require('three');
function load(name, dependencies = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, name), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('exports', 'require', compiled)(exports, name => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  });
  return exports;
}
const curriculum = load('curriculum.ts');
const { processScenario } = load('processCell.ts', { './curriculum': curriculum });
const { processCameraBounds, processCameraFit } = load('processCamera.ts', { three: THREE });
function cameraFor(fit, aspect) {
  const camera = new THREE.PerspectiveCamera(41, aspect, 1, 10000);
  camera.position.set(...fit.position);
  camera.lookAt(...fit.target);
  camera.updateMatrixWorld(true);
  return camera;
}

test('all process workspaces and whole-cell bounds fit each camera preset with a 20% framing margin', () => {
  for (const level of [1, 2, 3, 4]) for (const variant of [0, 1, 2]) {
    const scenario = processScenario(level, variant);
    for (const scope of ['work', 'whole', 'frames', 'packing']) for (const preset of ['free', 'top', 'side', 'front']) {
      for (const aspect of [0.4, 0.75, 1.25, 2.2]) {
        const fit = processCameraFit(scenario, scope, preset, aspect);
        const camera = cameraFor(fit, aspect);
        for (const x of [fit.bounds.min.x, fit.bounds.max.x]) {
          for (const y of [fit.bounds.min.y, fit.bounds.max.y]) {
            for (const z of [fit.bounds.min.z, fit.bounds.max.z]) {
              const projected = new THREE.Vector3(x, y, z).project(camera);
              const context = `${level}/${variant}/${scope}/${preset}/${aspect}`;
              assert.ok(Math.abs(projected.x) <= 0.800001, `horizontal clipping: ${context}`);
              assert.ok(Math.abs(projected.y) <= 0.800001, `vertical clipping: ${context}`);
              assert.ok(projected.z > -1 && projected.z < 1, `depth clipping: ${context}`);
            }
          }
        }
      }
    }
  }
});

test('work framing includes every tray slot, both initial TCPs and the full conveyor beyond its stop point', () => {
  for (const variant of [0, 1, 2]) {
    const scenario = processScenario(4, variant);
    const bounds = processCameraBounds(scenario, 'work');
    for (const cell of scenario.tray.points) {
      for (const dx of [-35, 35]) for (const dy of [-35, 35]) {
        assert.ok(bounds.containsPoint(new THREE.Vector3(cell.x + dx, cell.z + 115, -cell.y + dy)));
      }
    }
    for (const robot of scenario.robots) {
      const a = robot.yaw * Math.PI / 180;
      const x = robot.origin.x + Math.cos(a) * robot.start.x - Math.sin(a) * robot.start.y;
      const y = robot.origin.y + Math.sin(a) * robot.start.x + Math.cos(a) * robot.start.y;
      assert.ok(bounds.containsPoint(new THREE.Vector3(x, robot.origin.z + robot.start.z + 40, -y)));
    }
    const beltCenterY = (scenario.belt.from.y + scenario.belt.to.y) / 2;
    for (const sign of [-1, 1]) {
      assert.ok(bounds.containsPoint(new THREE.Vector3(scenario.belt.from.x, scenario.belt.from.z,
        -(beltCenterY + sign * scenario.belt.length / 2))));
    }
    const work = processCameraFit(scenario, 'work', 'free', 1.25);
    const whole = processCameraFit(scenario, 'whole', 'free', 1.25);
    assert.ok(work.distance < whole.distance, 'work view enlarges the stations while retaining both arms');
  }
});

test('work framing follows changed station geometry without depending on playback targets', () => {
  const scenario = processScenario(4);
  const initial = processCameraFit(scenario, 'work', 'free', 1.25);
  const translated = structuredClone(scenario);
  for (const point of translated.tray.points) point.x += 400;
  const changed = processCameraFit(translated, 'work', 'free', 1.25);
  assert.ok(changed.bounds.max.x > initial.bounds.max.x + 100);
  assert.ok(changed.target[0] > initial.target[0]);
  assert.ok(initial.position[1] > initial.target[1]);
  const elevation = Math.atan2(initial.position[1] - initial.target[1], Math.hypot(
    initial.position[0] - initial.target[0], initial.position[2] - initial.target[2]));
  assert.ok(elevation > Math.PI / 4, 'default view must reveal the tabletop from above');
});

test('oblique work view separates pickup and destination horizontally instead of hiding one behind the tool', () => {
  for (const variant of [0, 1, 2]) {
    const scenario = processScenario(1, variant);
    const camera = cameraFor(processCameraFit(scenario, 'work', 'free', 1.05), 1.05);
    const projected = point => new THREE.Vector3(point.x, point.z, -point.y).project(camera);
    const source = projected(scenario.source), destination = projected(scenario.destination);
    const tool = projected(scenario.robots[0].start);
    assert.ok(Math.abs(source.x - destination.x) > 0.5, 'stations need distinct screen positions');
    assert.ok(destination.distanceTo(tool) > 0.5, 'initial tool must not cover the destination');
  }
});

test('all planned lift, corner and approach points fit the work view and show vertical separation', () => {
  for (const level of [1, 2]) for (const variant of [0, 1, 2]) for (const aspect of [.75, 1.25, 2.2]) {
    const scenario = processScenario(level, variant), camera = cameraFor(processCameraFit(scenario, 'work', 'free', aspect), aspect);
    const points = [scenario.source, { ...scenario.source, z: 300 },
      { x: scenario.destination.x, y: scenario.source.y, z: 300 },
      { x: scenario.source.x, y: scenario.destination.y, z: 300 },
      { ...scenario.destination, z: 300 }, scenario.destination];
    const projected = points.map(p => new THREE.Vector3(p.x, p.z, -p.y).project(camera));
    assert.ok(projected.every(p => Math.abs(p.x) <= .8 && Math.abs(p.y) <= .8));
    assert.ok(Math.abs(projected[1].y - projected[0].y) > .12, 'lift must be visibly above the block');
  }
});

test('cooperative overview shows facing robots near front-on while keeping the handoff distinct', () => {
  for (const level of [3, 4]) for (const variant of [0, 1, 2]) {
    const scenario = processScenario(level, variant);
    const fit = processCameraFit(scenario, 'whole', 'free', 1.05);
    const camera = cameraFor(fit, 1.05);
    const elevation = Math.atan2(fit.position[1] - fit.target[1], Math.hypot(
      fit.position[0] - fit.target[0], fit.position[2] - fit.target[2]));
    assert.ok(elevation > Math.PI / 15 && elevation < Math.PI / 8,
      'overview should show the robots facing each other with a slight downward view');
    const project = p => new THREE.Vector3(p.x, p.z, -p.y).project(camera);
    const [a, b] = scenario.robots.map(robot => project(robot.origin));
    const handoff = project(scenario.handoff);
    assert.ok(b.x - a.x > .8, 'robot bases must occupy distinct left and right positions');
    assert.ok(Math.abs(a.y - b.y) < .08, 'one base must not sit behind the other');
    for (const point of [scenario.source, scenario.destination])
      assert.ok(Math.abs(handoff.y - project(point).y) > .045, 'handoff must remain distinct from the front stations');
  }
});

test('packing close-up fits every tray cell and approach from above with the same B-axis orientation as the selector', () => {
  for (const variant of [0, 1, 2]) for (const aspect of [.5, 1, 2.2]) {
    const scenario = processScenario(4, variant);
    const fit = processCameraFit(scenario, 'packing', 'free', aspect);
    const camera = cameraFor(fit, aspect);
    const projected = scenario.tray.points.map(p => new THREE.Vector3(p.x, p.z, -p.y).project(camera));
    assert.ok(projected.every(p => Math.abs(p.x) < .8 && Math.abs(p.y) < .8));
    assert.ok(projected[1].x < projected[0].x, 'B +X increases toward the left');
    assert.ok(projected[2].y < projected[0].y, 'B +Y increases toward the bottom');
    assert.ok(fit.distance < processCameraFit(scenario, 'work', 'free', aspect).distance);
  }
});


test('coordinate comparison contains both origins, positive local axes and the shared handoff', () => {
  for (const level of [3, 4]) for (const variant of [0, 1, 2]) {
    const scenario = processScenario(level, variant), bounds = processCameraBounds(scenario, 'frames');
    for (const robot of scenario.robots) {
      const yaw = robot.yaw * Math.PI / 180;
      for (const [x, y] of [[0,0], [230,0], [0,230]]) {
        assert.ok(bounds.containsPoint(new THREE.Vector3(
          robot.origin.x + Math.cos(yaw)*x - Math.sin(yaw)*y, robot.origin.z,
          -(robot.origin.y + Math.sin(yaw)*x + Math.cos(yaw)*y))));
      }
    }
    const h = scenario.handoff;
    assert.ok(bounds.containsPoint(new THREE.Vector3(h.x,h.z,-h.y)));
  }
});
