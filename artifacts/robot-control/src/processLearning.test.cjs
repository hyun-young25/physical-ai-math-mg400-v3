const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(file, deps = {}) {
  const exports = {};
  new Function('exports', 'require', ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText)(exports, name => { assert.ok(name in deps, name); return deps[name]; });
  return exports;
}
const curriculum = load('curriculum.ts');
const cell = load('processCell.ts', { './curriculum': curriculum });
const learning = load('processLearning.ts', { './processCell': cell });
const model = load('processKinematics.ts').PROCESS_MODEL;
const answersFor = scenario => Object.fromEntries(scenario.questions.flatMap(q => q.fields.map(f => [f.key, f.expected])));
const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.2;

test('complete plan reviews every actual contact point in its own robot frame for all levels and variants', () => {
  for (const level of [1, 2, 3, 4]) for (const variant of [0, 1, 2]) {
    const scenario = cell.processScenario(level, variant), answers = answersFor(scenario);
    const plan = learning.processPlan(scenario, answers);
    const result = cell.compileProcess(model, scenario, answers);
    assert.equal(result.outcome.passed, true);
    const stops = learning.processPreviewStops(result);
    assert.equal(stops[0].index, 0);
    assert.equal(stops.at(-1).index, result.frames.length - 1);
    assert.ok(stops.every(stop => stop.atMs === result.frames[stop.index].atMs));
    const routes = learning.processPreviewRoutes(scenario, result);
    assert.equal(routes.length, scenario.robots.length);
    for (const route of routes) {
      const robot = scenario.robots.find(robot => robot.id === route.robot);
      const actual = result.frames.map(frame => cell.localToWorld(frame.robots[robot.id].pose, robot));
      for (const segment of route.segments) {
        assert.ok(actual.some(point => near(point, segment.from)), 'route starts at a computed TCP sample');
        assert.ok(actual.some(point => near(point, segment.to)), 'route ends at a computed TCP sample');
      }
    }
    for (const observation of result.outcome.observations) assert.ok(plan.some(row =>
      row.robot === observation.robot && near(row.pose, observation.target)),
    `unreviewed contact: ${level}/${variant} ${JSON.stringify(observation.target)}`);
    if (scenario.tray) {
      const tray = plan.filter(row => row.label.startsWith('B 포장'));
      assert.equal(tray.length, 4);
      assert.equal(tray[0].kind, 'given');
      tray.forEach((row, index) => assert.ok(near(cell.localToWorld(row.pose, scenario.robots[1]), scenario.tray.points[index])));
    }
  }
});

test('reviewed plan uses student mistakes verbatim and never substitutes target answers for blanks', () => {
  const scenario = cell.processScenario(4), answers = { ...answersFor(scenario), beltY: 12, handoffX: 301, columnStep: 17, rowStep: -24, packingX: 242, packingY: 62 };
  const plan = learning.processPlan(scenario, answers);
  assert.equal(plan.find(row => row.label === 'A 집기').pose.y, 12);
  assert.equal(plan.find(row => row.label === 'B 인계대에서 집기').pose.x, 301);
  const tray = plan.filter(row => row.label.startsWith('B 포장'));
  assert.equal(tray[1].pose.x - tray[0].pose.x, 17);
  assert.equal(tray[3].pose.x, 242);
  assert.equal(tray[2].pose.y - tray[0].pose.y, -24);
  assert.equal(tray[3].pose.y, 62);
  const empty = learning.processPlan(scenario, {});
  assert.ok(Number.isNaN(empty.find(row => row.label === 'A 집기').pose.y));
  assert.ok(Number.isNaN(empty.find(row => row.label === 'B 인계대에서 집기').pose.x));
  assert.equal(empty.filter(row => row.label.startsWith('B 포장')).length, 0, 'blank order must not be replaced with a default sequence');
});

test('each level has a distinct mathematical relation check, without supplying numerical answers', () => {
  const expected = [];
  for (const level of [1, 2, 3, 4]) {
    const structure = learning.processStructure(cell.processScenario(level));
    assert.equal(structure.options.filter(option => option.value === structure.expected).length, 1);
    assert.equal(structure.options.length, 3);
    assert.ok(structure.feedback.length > 20);
    expected.push(structure.expected);
  }
  assert.equal(new Set(expected).size, 4);
  assert.equal(learning.processEventLabel('B-grip'), 'B 블록 집기');
});

test('the planned route length follows geometry and every approach point preserves student input', () => {
  const scenario = cell.processScenario(1), answers = answersFor(scenario);
  const direct = cell.processTransport(scenario, answers);
  const axis = cell.processTransport(scenario, { ...answers, routeChoice: 1 });
  assert.ok(Math.abs(direct.length - Math.hypot(20, 190)) < 1e-8);
  assert.equal(axis.length, 210);
  const wrong = learning.processPlan(scenario, { ...answers, approachX: 333 });
  assert.equal(wrong.find(row => row.marker === 'P3').pose.x, 333);
  assert.equal(wrong.find(row => row.marker === 'P4').pose.x, 300);
  assert.ok(Number.isNaN(learning.processPlan(scenario, {}).find(row => row.marker === 'P3').pose.x));
});
