const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const moduleExports = {};
new Function("exports", ts.transpileModule(
  fs.readFileSync(path.join(__dirname, "paperDigitalTwinPlayback.ts"), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText)(moduleExports);

class FakeScheduler {
  constructor() {
    this.nextId = 0;
    this.frames = new Map();
    this.timers = new Map();
    this.cancelledFrames = [];
  }
  requestFrame(callback) {
    const id = ++this.nextId;
    this.frames.set(id, callback);
    return id;
  }
  cancelFrame(id) {
    const callback = this.frames.get(id);
    if (callback) this.cancelledFrames.push(callback);
    this.frames.delete(id);
  }
  setTimer(callback, delayMs) {
    const id = ++this.nextId;
    this.timers.set(id, { callback, delayMs });
    return id;
  }
  clearTimer(id) { this.timers.delete(id); }
  frame(now) {
    const [id, callback] = this.frames.entries().next().value ?? [];
    assert.ok(callback, "expected a queued animation frame");
    this.frames.delete(id);
    callback(now);
  }
  timeout() {
    const [id, timer] = this.timers.entries().next().value ?? [];
    assert.ok(timer, "expected a queued stall watchdog");
    this.timers.delete(id);
    timer.callback();
  }
  fireLateFrame(now) {
    const callback = this.cancelledFrames.shift();
    assert.ok(callback, "expected a cancelled late frame");
    callback(now);
  }
}

const start = { x: 0, y: 0, z: 0, r: 0 };
const pose = x => ({ x, y: 0, z: 0, r: 0 });

test("DT completes every waypoint and returns to its start", async () => {
  const scheduler = new FakeScheduler();
  const visited = [];
  let ended = 0;
  const run = moduleExports.startPaperDigitalTwinPlayback({
    start, commands: [pose(10), pose(20)],
    canReach: () => true, moveTo: value => visited.push(value.x), moveEnd: () => ended++,
    scheduler,
  });
  scheduler.frame(0); scheduler.frame(350);
  scheduler.frame(351); scheduler.frame(701);
  scheduler.frame(702); scheduler.frame(1052);
  await run.promise;
  assert.deepEqual(visited.filter(x => x === 10 || x === 20), [10, 20]);
  assert.equal(visited.at(-1), 0);
  assert.equal(ended, 3);
  assert.equal(scheduler.frames.size, 0);
  assert.equal(scheduler.timers.size, 0);
});

test("a stalled animation rejects, cancels its frame, and ignores late completion", async () => {
  const scheduler = new FakeScheduler();
  const visited = [];
  const run = moduleExports.startPaperDigitalTwinPlayback({
    start, commands: [pose(10)], canReach: () => true,
    moveTo: value => visited.push(value.x), moveEnd: () => {}, scheduler,
    frameStallTimeoutMs: 100,
  });
  const failed = assert.rejects(run.promise, /동안 진행되지 않아 중단했습니다/);
  scheduler.timeout();
  const beforeLateFrame = [...visited];
  scheduler.fireLateFrame(500);
  assert.deepEqual(visited, beforeLateFrame);
  await failed;
  assert.equal(scheduler.frames.size, 0);
  assert.equal(scheduler.timers.size, 0);
});

test("manual cancellation rejects and makes queued movement callbacks inert", async () => {
  const scheduler = new FakeScheduler();
  const visited = [];
  const run = moduleExports.startPaperDigitalTwinPlayback({
    start, commands: [pose(10)], canReach: () => true,
    moveTo: value => visited.push(value.x), moveEnd: () => {}, scheduler,
  });
  const failed = assert.rejects(run.promise, /실행이 중단되었습니다/);
  scheduler.frame(0);
  run.cancel();
  const beforeLateFrame = [...visited];
  scheduler.fireLateFrame(500);
  assert.deepEqual(visited, beforeLateFrame);
  await failed;
  assert.equal(scheduler.timers.size, 0);
});

test("an unreachable intermediate pose fails without claiming completion", async () => {
  const scheduler = new FakeScheduler();
  let ended = 0;
  const run = moduleExports.startPaperDigitalTwinPlayback({
    start, commands: [pose(10)], canReach: value => value.x <= 0,
    moveTo: () => {}, moveEnd: () => ended++, scheduler,
  });
  const failed = assert.rejects(run.promise, /도달 불가/);
  scheduler.frame(0);
  scheduler.frame(350);
  await failed;
  assert.equal(ended, 0);
});
