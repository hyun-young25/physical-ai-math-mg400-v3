const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const THREE = require("three");
function load(name, deps = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, name), "utf8");
  new Function("exports", "require", ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText)(exports, name => { assert.ok(name in deps, name); return deps[name]; });
  return exports;
}
const curriculum = load("curriculum.ts");
const core = load("pickPlaceCore.ts", { "./curriculum": curriculum });
const model = load("processKinematics.ts").PROCESS_MODEL;
const camera = load("processCamera.ts", { three: THREE });
const relations = z => ({ coordinate: "B=A+Δ", contact: "TCP=top", height: "travelZ>=min", vertical: "XY constant", travelZ: String(z) });
function validPlan(level = 1, variant = 0, relative = false) {
  const scenario = core.designScenario(level, variant);
  const z = scenario.minimumTravelZ + 15;
  let from = scenario.robots[0].start;
  const plan = core.DESIGN_ROLES.map(({ role, action }, i) => {
    const target = core.designGoal(scenario, role, z) ?? { ...scenario.destination, z };
    const values = relative ? curriculum.poseDifference(from, target) : target;
    const step = { id: `c-${i}`, role, action, mode: relative ? "relative" : "absolute",
      motion: i === 0 ? "MoveJ" : "MoveL",
      x: String(values.x), y: String(values.y), z: String(values.z),
      expectedX: String(target.x), expectedY: String(target.y), expectedZ: String(target.z) };
    from = target; return step;
  });
  return { scenario, plan, relations: relations(z) };
}
const run = f => core.compileDesign(model, f.scenario, f.plan, f.relations);

test("single MG400 and single workpiece for all levels, changed conditions and coordinate modes", () => {
  for (const level of [1, 2, 3]) for (const variant of [0, 1, 2]) for (const relative of [false, true]) {
    const f = validPlan(level, variant, relative), result = run(f);
    assert.equal(result.outcome.passed, true, `${level}/${variant}/${relative}: ${result.outcome.issues}`);
    assert.equal(result.observations.length, 9);
    assert.equal(f.scenario.robots.length, 1);
    assert.equal(result.outcome.totalPieces, 1);
    assert.equal(f.scenario.belt, undefined);
    assert.equal(f.scenario.handoff, undefined);
    assert.equal(f.scenario.tray, undefined);
    assert.ok(result.frames.every((frame, i) => frame.workpieces.length === 1 && (!i || frame.atMs >= result.frames[i - 1].atMs)));
    for (const frame of result.frames) assert.deepEqual(frame.robots.A.pose, model.fk(frame.robots.A.joints));
    assert.equal(result.frames.at(-1).workpieces[0].owner, null);
    assert.equal(result.frames.at(-1).workpieces[0].placed, true);
  }
});

test("student's commands are executed, never replaced with expected answers", () => {
  const f = validPlan();
  f.plan[1].z = "225";
  const r = run(f);
  assert.equal(r.failure, "pickup");
  assert.ok(r.observations.some(o => o.role === "contact" && Math.abs(o.actual.z - 225) < .001));
  assert.ok(r.frames.every(frame => frame.workpieces[0].owner === null));
  assert.equal(r.outcome.passed, false);
});

test("a failed placement shows the commanded TCP and actual released position", () => {
  const f = validPlan();
  for (const i of [4, 5, 6]) { f.plan[i].y = "85"; f.plan[i].expectedY = "85"; }
  const r = run(f);
  assert.equal(r.failure, "target");
  assert.match(r.outcome.issues.join(" "), /목표 미도달/);
  assert.ok(Math.abs(r.outcome.finalFrame.workpieces[0].top.y - 85) < .001);
  assert.equal(r.outcome.finalFrame.workpieces[0].placed, false);
});

test("height violations are explicit, and no fabricated motion or observations occur before rejection", () => {
  const f = validPlan(); f.relations.travelZ = "240";
  const r = run(f);
  assert.equal(r.failure, "height");
  assert.equal(r.observations.length, 0);
  assert.ok(r.frames.every(frame => frame.robots.A.pose.z > 299.9));
});

test("a low student lift and MoveJ vertical deviation have distinct relation feedback", () => {
  const f = validPlan(2); f.plan[3].z = "250";
  assert.equal(run(f).failure, "height");
  const j = validPlan(2); j.plan[1].motion = "MoveJ";
  const r = run(j);
  assert.equal(r.failure, "target");
  assert.match(r.outcome.issues.join(" "), /MoveJ.*MoveL/);
  assert.equal(r.observations.at(-1).commandStatus, "interrupted");
  assert.equal(r.observations.at(-1).role, "contact");
  assert.ok(r.observations.at(-1).actual.z > j.scenario.source.z);
});

test("wrong absolute/relative interpretation is not silently corrected", () => {
  const f = validPlan(1, 0, true);
  f.plan[0].mode = "absolute";
  const r = run(f);
  assert.equal(r.outcome.passed, false);
  assert.ok(["unreachable", "target", "pickup", "collision"].includes(r.failure));
});

test("TCP/object/table collision stops before entering an occupied volume", () => {
  const f = validPlan(); f.plan[1].z = "195";
  const r = run(f);
  assert.equal(r.failure, "collision");
  assert.match(r.outcome.issues.join(" "), /물체|작업대/);
  assert.equal(r.outcome.finished, false);
  assert.equal(r.frames.at(-1).workpieces[0].owner, null);
});
test("pickup orientation, carried relative yaw and placement direction are physical virtual checks", () => {
  const wrong = validPlan();
  wrong.plan[1].r = "20"; wrong.plan[1].expectedR = "20";
  assert.equal(run(wrong).failure, "orientation");
  const placement = validPlan();
  placement.plan[4].r = "15"; placement.plan[4].expectedR = "15";
  placement.plan[5].r = "15"; placement.plan[5].expectedR = "15";
  placement.plan[6].r = "15"; placement.plan[6].expectedR = "15";
  placement.plan[7].expectedR = "15";
  const p = run(placement);
  assert.equal(p.failure, "orientation");
  assert.equal(p.frames.at(-1).workpieces[0].owner, null);
  assert.equal(p.frames.at(-1).workpieces[0].placed, false);
  assert.ok(Math.abs(p.frames.at(-1).workpieces[0].top.r - 15) < 0.01);
  const good = validPlan();
  const g = run(good);
  for (const frame of g.frames.filter(f => f.workpieces[0].owner)) {
    assert.ok(Math.abs(frame.workpieces[0].top.x - frame.robots.A.pose.x) < 1e-8);
    assert.ok(Math.abs(frame.workpieces[0].top.z - frame.robots.A.pose.z) < 1e-8);
  }
});
test("orientation prediction error never overrides actual transport and wraps at 360 degrees", () => {
  const f = validPlan(); f.plan[4].expectedR = "30";
  const r = run(f);
  assert.equal(r.outcome.finished, true);
  assert.equal(r.outcome.passed, false);
  assert.equal(r.observations.find(o => o.role === "transfer").rotationError, 30);
  assert.equal(core.angularError(179, -179), 2);
});

test("prediction mismatch is separate from successful physical virtual transport", () => {
  const f = validPlan(); f.plan[4].expectedZ = "999";
  const r = run(f);
  assert.equal(r.outcome.finished, true);
  assert.equal(r.outcome.completedPieces, 1);
  assert.equal(r.outcome.passed, false);
  assert.equal(r.failure, null);
  assert.ok(r.observations.find(o => o.role === "transfer").predictionError > 700);
});

test("empty inputs, missing roles and duplicate identifiers cannot enter execution", () => {
  const f = validPlan();
  assert.ok(core.validateDesignPlan(core.emptyDesignPlan(1), f.relations));
  assert.deepEqual(core.emptyDesignPlan(3), []);
  f.plan.pop(); assert.match(core.validateDesignPlan(f.plan, f.relations), /후퇴/);
  const dup = validPlan(); dup.plan[1].id = dup.plan[0].id;
  assert.match(core.validateDesignPlan(dup.plan, dup.relations), /중복/);
});

test("bad order, unreachable targets and correction/re-execution preserve the student's original plan", () => {
  const f = validPlan();
  [f.plan[2], f.plan[7]] = [f.plan[7], f.plan[2]];
  assert.equal(run(f).failure, "sequence");
  const bad = validPlan(); bad.plan[0].x = "9000";
  assert.equal(run(bad).failure, "unreachable");
  bad.plan[0].x = "280";
  const before = JSON.stringify(bad.plan);
  assert.equal(run(bad).outcome.passed, true);
  assert.equal(JSON.stringify(bad.plan), before);
  const extra = validPlan(); extra.plan.push({ ...extra.plan[0], id: "unexpected" });
  assert.equal(run(extra).failure, "sequence");
  assert.equal(run(extra).observations.at(-1).commandStatus, "rejected");
});

test("camera fit includes every student's actual TCP sample at desktop, tablet and phone aspect ratios", () => {
  for (const level of [1, 2, 3]) for (const variant of [0, 1, 2]) {
    const f = validPlan(level, variant), result = run(f), points = result.frames.map(frame => frame.robots.A.pose);
    for (const aspect of [0.65, 1, 1.7, 2.2]) for (const preset of ["free", "top", "side", "front"]) {
      const fit = camera.processCameraFit(f.scenario, "whole", preset, aspect, 41, points);
      const c = new THREE.PerspectiveCamera(41, aspect, 1, 10000);
      c.position.set(...fit.position); c.lookAt(...fit.target); c.updateMatrixWorld(true);
      for (const p of points) {
        const projected = new THREE.Vector3(p.x, p.z, -p.y).project(c);
        assert.ok(Math.abs(projected.x) < .81 && Math.abs(projected.y) < .81, `clipped ${level}/${variant}/${aspect}/${preset}`);
      }
    }
  }
});

module.exports = { core, model, validPlan };