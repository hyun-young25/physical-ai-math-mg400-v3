const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function load(file, deps = {}) {
  const exports = {};
  new Function("exports", "require", ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText)(exports, name => {
    if (name in deps) return deps[name];
    throw new Error(`Unexpected import: ${name}`);
  });
  return exports;
}

const protocol = load(path.join(__dirname, "mg400Protocol.ts"));
const validPose = "0,{GetPose()},100,200,300,0,0,0;";

class FakeSocket {
  static instances = [];
  listeners = new Map();
  onceListeners = new Map();
  writes = [];
  destroyed = false;

  constructor() { FakeSocket.instances.push(this); }
  setTimeout() {}
  on(event, callback) { this.listeners.set(event, callback); return this; }
  once(event, callback) { this.onceListeners.set(event, callback); return this; }
  connect() { queueMicrotask(() => this.emit("connect")); }
  write(value) { this.writes.push(value); }
  destroy() {
    this.destroyed = true;
    this.emit("close");
  }
  emit(event, value) {
    const once = this.onceListeners.get(event);
    if (once) {
      this.onceListeners.delete(event);
      once(value);
    }
    this.listeners.get(event)?.(value);
  }
}

function makeClient() {
  FakeSocket.instances = [];
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const loaded = load(path.join(__dirname, "mg400.ts"), {
    net: { Socket: FakeSocket, default: { Socket: FakeSocket } },
    "./logger": { logger },
    "./mg400Protocol": protocol,
  });
  return new loaded.MG400Client();
}

test("MG400 frames require an explicit error ID, command identity and complete terminator", () => {
  const response = protocol.parseMG400Response(validPose);
  assert.equal(response.errorId, 0);
  assert.equal(response.command, "GetPose()");
  assert.deepEqual(protocol.requireFiniteMG400Values(response, "GetPose", 6), [100, 200, 300, 0, 0, 0]);
  for (const malformed of [
    "0,{GetPose()},100,200,300,0,0,0",
    "oops,{GetPose()},100,200,300,0,0,0;",
    "0,100,200,300,0,0,0;",
    "0,{GetPose()},100,,300,0,0,0;",
  ]) assert.throws(() => protocol.parseMG400Response(malformed));
});

test("missing, non-finite, short and controller-error measurements are failures, never zero-filled poses", async t => {
  for (const response of [
    "0,{GetPose()},;",
    "0,{GetPose()},100,200,300,0,0;",
    "0,{GetPose()},100,200,not-a-number,0,0,0;",
    "17,{GetPose()},100,200,300,0,0,0;",
  ]) {
    const client = makeClient();
    t.after(() => client.disconnect());
    await client.connect("127.0.0.1");
    const socket = FakeSocket.instances.at(-1);
    const pending = client.getPose();
    socket.emit("data", Buffer.from(response));
    await assert.rejects(pending);
  }
});

test("a command timeout closes the connection so a late response cannot satisfy a later request", async t => {
  const client = makeClient();
  t.after(() => client.disconnect());
  await client.connect("127.0.0.1");
  const oldSocket = FakeSocket.instances.at(-1);

  await assert.rejects(client.send("GetPose()", 10), /command timeout/);
  assert.equal(client.isConnected(), false);
  assert.equal(oldSocket.destroyed, true);

  oldSocket.emit("data", Buffer.from(validPose));
  await assert.rejects(client.send("RobotMode()", 10), /Not connected/);
  assert.deepEqual(oldSocket.writes, ["GetPose()\n"]);
});

test("a response for another command rejects the request and closes the desynchronized connection", async t => {
  const client = makeClient();
  t.after(() => client.disconnect());
  await client.connect("127.0.0.1");
  const socket = FakeSocket.instances.at(-1);

  const pending = client.getPose();
  socket.emit("data", Buffer.from("0,{RobotMode()},5;"));
  await assert.rejects(pending, /응답 명령이 요청과 다릅니다/);
  assert.equal(client.isConnected(), false);
  assert.equal(socket.destroyed, true);
});

test("disconnect rejects pending requests instead of leaving them unresolved", async t => {
  const client = makeClient();
  await client.connect("127.0.0.1");
  const socket = FakeSocket.instances.at(-1);
  const first = client.send("GetPose()", 1000);
  const second = client.send("RobotMode()", 1000);
  await client.disconnect();
  await assert.rejects(first, /연결을 종료/);
  await assert.rejects(second, /연결을 종료/);
  assert.equal(socket.destroyed, true);
});
