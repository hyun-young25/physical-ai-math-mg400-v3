const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript");
const exportsTS = {};
new Function("exports", ts.transpileModule(fs.readFileSync(path.join(__dirname, "practiceSession.ts"), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(exportsTS);
const { PracticeSession, defaultPracticeSetup, measurementFresh, rotationDistance, targetProblem } = exportsTS;
const verified = () => { const s = defaultPracticeSetup(); for (const k in s.verified) s.verified[k] = true; return s; };
test("global stop notifies a scoped virtual continuation without creating a physical command",()=>{
  const session=new PracticeSession(()=>{throw new Error("must not open a socket");});
  let stopped=0;
  const unsubscribe=session.subscribeStop(()=>{stopped++;session.setVirtualBusy(false);});
  session.setVirtualBusy(true);session.stop();
  assert.equal(stopped,1);assert.equal(session.getSnapshot().busy,false);
  assert.equal(session.getSnapshot().uncertainMotion,false);
  unsubscribe();session.stop();assert.equal(stopped,1);session.dispose();
});

function fixture(options = {}) {
  let clock = 100000;
  let socket;
  class FakeSocket {
    readyState = 1; seq = 0; requests = [];
    pose = { x: 250, y: -150, z: 300, r: 0 };
    enabled = false; outputs = "0"; joints = { j1: 1, j2: 2, j3: 3, j4: 4 };
    constructor() { queueMicrotask(() => this.onopen?.({})); }
    event(e) { this.onmessage?.({ data: JSON.stringify(e) }); }
    measured(overrides = {}) {
      this.event({ type: "measurement", measurement: {
        source: "mock", seq: ++this.seq, measuredAt: clock, ageMs: 0,
        pose: { ...this.pose }, joints: { ...this.joints },
        robotMode: this.enabled ? 5 : 4, moving: false, enabled: this.enabled, error: false,
        inputBits: "0", outputBits: this.outputs, user: 0, tool: 0, ...overrides,
      } });
    }
    send(raw) {
      const request = JSON.parse(raw); this.requests.push(request);
      if (request.type === "connect") {
        this.event({ type: "hello", protocol: options.protocol ?? 2, model: "MG400", source: "mock", capabilities: { jointStep: options.jointStep === true } });
        this.measured();
      } else if (request.type === "configure") {
        if(options.holdConfigure)return;
        if(options.rejectConfigure){
          this.event({type:"reply",id:request.id,ok:false,error:"모의 설정 거부"});return;
        }
      } else if (request.type === "execute") {
        if (options.hold) return;
        const op = request.operation;
        if (op.kind === "jointStep" && !options.wrongJoints) this.joints[op.joint] += op.delta;
        if (op.kind === "enable") this.enabled = true;
        if (op.kind === "disable") this.enabled = false;
        if (op.kind === "move") this.pose = { ...op.target, x: op.target.x + (options.drift ?? 0), r: op.target.r + (options.rotationDrift ?? 0) };
        if (op.kind === "suction") this.outputs = op.on ? "1" : "0";
        this.measured();
      }
      this.event({ type: "reply", id: request.id, ok: true, result: { seq: this.seq } });
    }
    close() { this.readyState = 3; }
  }
  const session = new PracticeSession(() => socket = new FakeSocket(), () => clock);
  return { session, socket: () => socket, tick: ms => clock += ms };
}
async function prepare(f, servo = true) {
  f.session.setMode("hardware");
  await f.session.connect("ws://127.0.0.1:8765", "192.168.1.6");
  await f.session.applySetup(verified());
  if (servo) await f.session.execute([{ kind: "enable" }], true);
}

test("legacy caller addresses are ignored and every explicit connection uses the fixed MG400 IP", async t => {
  for (const previous of ["192.168.1.99", "10.0.0.5", "", "invalid", undefined]) {
    const f = fixture(); t.after(() => f.session.dispose());
    assert.equal(f.socket(), undefined);
    f.session.setMode("hardware");
    assert.equal(f.socket(), undefined); // mode selection never connects
    await f.session.connect("ws://127.0.0.1:8765", previous);
    assert.deepEqual(f.socket().requests.map(({type,robotIp})=>({type,robotIp})),
      [{type:"connect",robotIp:"192.168.1.6"}]);
    assert.equal(f.session.getSnapshot().setup, null);
    assert.equal(f.session.getSnapshot().measurement.enabled, false);
  }
});

test("defaults virtual; switching, connecting and preparing never enable/move/change vacuum", async t => {
  const f = fixture(); t.after(() => f.session.dispose());
  assert.equal(f.session.getSnapshot().mode, "virtual");
  await prepare(f, false);
  assert.deepEqual(f.socket().requests.map(r => r.type), ["connect", "configure"]);
  assert.equal(f.session.getSnapshot().measurement.enabled, false);
  f.session.setMode("virtual");
  assert.deepEqual(f.socket().requests.map(r => r.type), ["connect", "configure"]);
});
test("new defaults are 5%, workspace stays conservative and draft speed alone preserves human checks",()=>{
  const {changedSetup}=exportsTS,s=verified();
  assert.equal(s.speed,5);assert.equal(s.workspace.xMax,350);assert.equal(s.workspace.zMin,0);
  assert.deepEqual(changedSetup(s,{...s,speed:1}).verified,s.verified);
  const user=changedSetup(s,{...s,user:1});assert.equal(user.verified.coordinates,false);assert.equal(user.verified.workspace,false);assert.equal(user.verified.io,true);
  const tool=changedSetup(s,{...s,tool:1});assert.equal(tool.verified.tool,false);assert.equal(tool.verified.io,false);assert.equal(tool.verified.workspace,false);
});
test("speed is unconfirmed and execution locked until configure ACK; 1..20 only",async t=>{
  const options={holdConfigure:true},f=fixture(options);t.after(()=>f.session.dispose());
  f.session.setMode("hardware");await f.session.connect("ws://127.0.0.1:8765");
  const pending=f.session.applySetup(verified());
  assert.equal(f.session.getSnapshot().setup,null);assert.equal(f.session.getSnapshot().busy,true);
  await assert.rejects(()=>f.session.execute([{kind:"enable"}],true),/정지/);
  await assert.rejects(()=>f.session.applySetup(verified()),/정지/);
  const request=f.socket().requests.at(-1);
  f.socket().event({type:"reply",id:request.id,ok:true,result:{}});
  await pending;assert.equal(f.session.getSnapshot().setup.speed,5);
  options.holdConfigure=false;await f.session.applySpeed(1);
  assert.equal(f.session.getSnapshot().setup.speed,1);
  await assert.rejects(()=>f.session.applySpeed(0),/1~20/);
  await assert.rejects(()=>f.session.applySpeed(21),/1~20/);
  assert.equal(f.session.getSnapshot().setup.speed,1);
});
test("configure rejection, stale stop feedback and disconnect never report an applied speed",async t=>{
  const options={},f=fixture(options);t.after(()=>f.session.dispose());await prepare(f);
  options.rejectConfigure=true;
  await assert.rejects(()=>f.session.applySpeed(2),/모의 설정 거부/);
  assert.equal(f.session.getSnapshot().setup,null);
  options.rejectConfigure=false;options.holdConfigure=true;
  const pending=f.session.applySetup(verified());f.session.disconnect();
  await assert.rejects(()=>pending,/연결/);assert.equal(f.session.getSnapshot().setup,null);
});
test("moving telemetry rejects speed changes and mismatched applied-speed ACK is not success",async t=>{
  const options={},f=fixture(options);t.after(()=>f.session.dispose());await prepare(f);
  const count=f.socket().requests.length;
  f.socket().measured({moving:true,robotMode:7});
  await assert.rejects(()=>f.session.applySpeed(1),/정지/);
  assert.equal(f.socket().requests.length,count);
  f.socket().measured({moving:false,robotMode:5});
  options.holdConfigure=true;
  const pending=f.session.applySpeed(1),request=f.socket().requests.at(-1);
  f.socket().event({type:"reply",id:request.id,ok:true,result:{appliedSpeed:20}});
  await assert.rejects(()=>pending,/적용 속도.*다릅니다/);
  assert.equal(f.session.getSnapshot().setup,null);
});
test("every executed move carries the acknowledged speed, never an unrelated display speed",async t=>{
  const f=fixture();t.after(()=>f.session.dispose());await prepare(f);await f.session.applySpeed(2);
  for(const motion of ["MoveJ","MoveL","MoveJ"])await f.session.execute([{kind:"move",motion,target:{x:250,y:0,z:100,r:0}}],true);
  const requests=f.socket().requests.filter(r=>r.type==="execute"&&r.operation.kind==="move");
  assert.equal(requests.length,3);assert(requests.every(r=>r.expectedSpeed===2));
});
test("workspace diagnostics preserve raw coordinates, stage, axis and boundaries without epsilon expansion",()=>{
  const {workspaceFindings,describeWorkspaceFinding}=exportsTS,s=verified();
  const pose={x:350.000001,y:0,z:-0.0000001,r:0};
  const error=targetProblem(pose,s,"과제 단계 2");
  for(const text of ["과제 단계 2","X=","Z=","350.000001","-1e-7","반올림","[0, 320]"])assert(error.includes(text),text);
  const notes=workspaceFindings({x:250,y:0,z:0,r:0},s,"과제 시작점");
  assert.equal(notes[0].kind,"boundary");assert.match(describeWorkspaceFinding(notes[0]),/Z=0.*경계값/);
  assert.equal(s.workspace.zMin,0);assert(targetProblem(pose,s));
});
test("virtual animation locks mode and unlocks after stop", t => {
  const f = fixture(); t.after(() => f.session.dispose());
  f.session.setVirtualBusy(true);
  assert.throws(() => f.session.setMode("hardware"), /모드/);
  f.session.setVirtualBusy(false);
  f.session.setMode("hardware");
});
test("no confirmed execution before calibration, enable or explicit confirmation", async t => {
  const f = fixture(); t.after(() => f.session.dispose());
  f.session.setMode("hardware"); await f.session.connect("ws://127.0.0.1:8765", "192.168.1.6");
  const op = { kind: "move", motion: "MoveL", target: { x: 280, y: -100, z: 280, r: 0 } };
  await assert.rejects(f.session.execute([op], true), /준비/);
  await assert.rejects(f.session.applySetup(defaultPracticeSetup()), /모두 확인/);
  await f.session.applySetup(verified());
  await assert.rejects(f.session.execute([op], true), /서보/);
  await assert.rejects(f.session.execute([op], false), /확인/);
  assert.equal(f.socket().requests.some(r => r.type === "execute"), false);
});
test("relative steps resolve from each fresh measured start, not ideal previous endpoints", async t => {
  const f = fixture({ drift: 1 }); t.after(() => f.session.dispose()); await prepare(f);
  const observations = [];
  const results = await f.session.execute([
    { kind: "move", motion: "MoveJ", target: { x: 280, y: -100, z: 280, r: 0 } },
    { kind: "move", motion: "MoveL", target: { x: 10, y: 0, z: 0, r: 0 }, relative: true },
  ], true, (m, i, op) => observations.push({ m, op }));
  assert.equal(results[0].pose.x, 281);
  assert.equal(observations[1].op.target.x, 291);
  assert.equal(results[1].pose.x, 292);
  assert.ok(results.every(m => m.source === "mock"));
});
test("measured rotation and output confirmation, not command ACK, determine completion", async t => {
  const f = fixture({ rotationDrift: 10 }); t.after(() => f.session.dispose()); await prepare(f);
  await assert.rejects(f.session.execute([{ kind: "move", motion: "MoveL", target: { x: 280, y: -100, z: 280, r: 0 } }], true), /방향/);
  assert.ok(f.socket().requests.some(r => r.type === "stop"));
  const g = fixture(); t.after(() => g.session.dispose()); await prepare(g);
  const m = await g.session.execute([{ kind: "suction", on: true }, { kind: "suction", on: false }], true);
  assert.equal(m[0].outputBits, "1"); assert.equal(m[1].outputBits, "0");
});
test("stale or replayed feedback blocks execution without fabricated readings", async t => {
  const f = fixture(); t.after(() => f.session.dispose()); await prepare(f);
  const before = f.session.getSnapshot().measurement;
  f.tick(1600);
  assert.equal(measurementFresh(before, before.receivedAt + 1600), false);
  await assert.rejects(f.session.execute([{ kind: "suction", on: true }], true), /오래/);
  f.socket().measured({ seq: before.seq });
  assert.equal(f.session.getSnapshot().measurement.receivedAt, before.receivedAt);
  assert.match(f.session.getSnapshot().error, /패킷/);
  assert.equal(f.session.getSnapshot().setup, null);
});
test("robot fault is visible read-only and does not require a successful virtual result", async t => {
  const f = fixture(); t.after(() => f.session.dispose()); await prepare(f);
  f.socket().measured({ robotMode: 9, error: true });
  assert.equal(f.session.getSnapshot().measurement.error, true);
  assert.equal(f.session.getSnapshot().connection, "connected");
  await assert.rejects(f.session.execute([{ kind: "suction", on: true }], true), /오류/);
});
test("in-flight mode switch is blocked; disconnect rejects execution and does not release vacuum", async t => {
  const f = fixture(); t.after(() => f.session.dispose()); await prepare(f);
  f.socket().send = raw => { f.socket().requests.push(JSON.parse(raw)); };
  const run = f.session.execute([{ kind: "move", motion: "MoveL", target: { x: 280, y: -100, z: 280, r: 0 } }], true);
  assert.throws(() => f.session.setMode("virtual"), /실행 중/);
  f.session.disconnect();
  await assert.rejects(run);
  assert.equal(f.session.getSnapshot().measurement, null);
  assert.equal(f.session.getSnapshot().uncertainMotion, true);
  assert.equal(f.socket().requests.some(r => r.operation?.kind === "suction"), false);
});
test("old protocol, unverified bounds, direct joint moves and IO misconfiguration are rejected", async t => {
  const f = fixture({ protocol: 1 }); t.after(() => f.session.dispose()); f.session.setMode("hardware");
  await assert.rejects(f.session.connect("ws://127.0.0.1:8765", "192.168.1.6"), /프로토콜/);
  const g = fixture(); t.after(() => g.session.dispose()); await prepare(g);
  assert.ok(targetProblem({ x: 1000, y: 0, z: 100, r: 0 }, verified()));
  await assert.rejects(g.session.execute([{ kind: "joints", target: { j1: 0, j2: 0, j3: 0, j4: 0 } }], true), /관절/);
  const bad = verified(); bad.releaseDO = bad.suctionDO;
  await assert.rejects(g.session.applySetup(bad), /출력/);
  assert.equal(rotationDistance(179, -179), 2);
});

test("joint buttons require updated bridge and fresh measured completion", async t => {
  const old=fixture(); t.after(()=>old.session.dispose()); await prepare(old);
  await assert.rejects(old.session.execute([{kind:'jointStep',joint:'j1',delta:0.5}],true),/새 브리지/);
  const f=fixture({jointStep:true}); t.after(()=>f.session.dispose()); await prepare(f);
  for(const joint of ['j1','j2','j3','j4']) for(const delta of [-0.5,0.5]) {
    const before=f.session.getSnapshot().measurement.joints[joint];
    const result=await f.session.execute([{kind:'jointStep',joint,delta}],true);
    assert.equal(result[0].joints[joint],before+delta);
  }
  await assert.rejects(f.session.execute([{kind:'jointStep',joint:'j2',delta:11}],true),/10도/);
  await assert.rejects(f.session.execute([{kind:'jointStep',joint:'j1',delta:0.5}],false),/확인/);
});
test("joint ACK without matching measured joint target is not success",async t=>{
  const f=fixture({jointStep:true,wrongJoints:true});t.after(()=>f.session.dispose());await prepare(f);
  await assert.rejects(f.session.execute([{kind:'jointStep',joint:'j2',delta:1}],true),/실측 관절각/);
});
