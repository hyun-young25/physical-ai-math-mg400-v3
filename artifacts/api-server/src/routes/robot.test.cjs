const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function createRouter() {
  const router = { stack: [] };
  for (const method of ["get", "post"]) {
    router[method] = function (routePath, handler) {
      this.stack.push({ route: { path: routePath, methods: { [method]: true }, stack: [{ handle: handler }] } });
      return this;
    };
  }
  return router;
}

function loadRoute(mg400) {
  const exports = {};
  new Function("exports", "require", ts.transpileModule(fs.readFileSync(path.join(__dirname, "robot.ts"), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText)(exports, name => {
    if (name === "express") return { Router: createRouter };
    if (name === "../lib/mg400") return { mg400 };
    if (name === "../lib/logger") return { logger: { info() {}, warn() {} } };
    throw new Error(`Unexpected import: ${name}`);
  });
  return exports.default;
}

test("controller-reported command failures are not returned as successful reset, speed or jog operations", async () => {
  const calls = [];
  const mg400 = {
    isConnected: () => true,
    reset: async () => { calls.push("reset"); return { errorId: 5, raw: "5,{ClearError()};" }; },
    setSpeed: async () => { calls.push("speed"); return { errorId: 6, raw: "6,{SpeedFactor(5)};" }; },
    moveJog: async axis => { calls.push(`jog:${axis}`); return { errorId: 7, raw: "7,{MoveJog(x+)};" }; },
    stopJog: async () => { calls.push("stop"); return { errorId: 8, raw: "8,{MoveJog()};" }; },
  };
  const router = loadRoute(mg400);
  for (const [routePath, body] of [
    ["/robot/reset", {}],
    ["/robot/speed", { ratio: 5 }],
    ["/robot/jog", { axis: "x+" }],
    ["/robot/stop-jog", {}],
  ]) {
    const handler = router.stack.find(entry => entry.route.path === routePath).route.stack[0].handle;
    const res = {
      code: 200,
      status(code) { this.code = code; return this; },
      json(value) { this.body = value; return this; },
    };
    await handler({ body, log: { info() {}, warn() {} } }, res);
    assert.equal(res.code, 422, routePath);
    assert.equal(res.body.ok, false, routePath);
    assert.ok(res.body.errorId > 0, routePath);
  }
  assert.deepEqual(calls, ["reset", "speed", "jog:x+", "stop"]);
});

test("successful controller command acknowledgements remain successful", async () => {
  const router = loadRoute({
    isConnected: () => true,
    setSpeed: async () => ({ errorId: 0, raw: "0,{SpeedFactor(5)};" }),
  });
  const handler = router.stack.find(entry => entry.route.path === "/robot/speed").route.stack[0].handle;
  const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  await handler({ body: { ratio: 5 }, log: { info() {}, warn() {} } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { ok: true, errorId: 0 });
});
