const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), ts = require("typescript");
const mod = {};
new Function("exports", ts.transpileModule(fs.readFileSync(path.join(__dirname, "hardwareControls.ts"), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(mod);
const { hardwareToSceneJoints, hardwareStep } = mod;
const d = Math.PI / 180;
// Independent hardware FK: vertical-zero shoulder, absolute forearm angle.
function hardwareTip(q) {
  const reach = 175 * Math.sin(q.j2*d) + 175 * Math.cos(q.j3*d);
  return [reach*Math.cos(q.j1*d), reach*Math.sin(q.j1*d), 175*Math.cos(q.j2*d)-175*Math.sin(q.j3*d)];
}
function sceneTip(j) {
  const reach = 175*Math.cos(j.j2*d)+175*Math.cos((j.j2+j.j3)*d);
  return [reach*Math.cos(j.j1*d), reach*Math.sin(j.j1*d), 175*Math.sin(j.j2*d)+175*Math.sin((j.j2+j.j3)*d)];
}
test("hardware zero has vertical upper arm and horizontal forearm", () => {
  assert.deepEqual(hardwareToSceneJoints({j1:0,j2:0,j3:0,j4:0}), {j1:0,j2:90,j3:-90,j4:0});
});
test("scene follows physical X/Y/Z through shoulder and forearm changes without axis swaps", () => {
  for (const j1 of [-60,0,60]) for (const j2 of [0,20,40,70]) for (const j3 of [-10,0,30,60]) {
    const q = {j1,j2,j3,j4:17};
    const actual = hardwareTip(q), shown = sceneTip(hardwareToSceneJoints(q));
    actual.forEach((v,i) => assert.ok(Math.abs(v-shown[i]) < 1e-9));
    assert.equal(hardwareToSceneJoints(q).j4,17);
  }
});
test("all eight TCP buttons preserve robot axis and sign and defer target to fresh measurement", () => {
  for (const axis of ["x","y","z","r"]) for (const dir of [-1,1]) {
    const op=hardwareStep(axis,dir,0.5);
    assert.equal(op.kind,"move"); assert.equal(op.motion,"MoveL"); assert.equal(op.relative,true);
    for (const k of ["x","y","z","r"]) assert.equal(op.target[k],k===axis?dir*0.5:0);
  }
});
test("invalid step cannot create a movement", () => {
  for (const value of [0,-1,11,NaN,Infinity]) assert.throws(()=>hardwareStep("x",1,value));
});
test("App uses confirmed session path and measured scene conversion", () => {
  const app=fs.readFileSync(path.join(__dirname,"App.tsx"),"utf8");
  const hardware=app.slice(app.indexOf("const startJog ="), app.indexOf("dismissHomeIntro();",app.indexOf("const startJog =")));
  assert.match(hardware,/practice\.runOps\(\[hardwareStep\(axis, dir, stepValue\)\]/);
  assert.doesNotMatch(hardware,/setCoords|setJoints|bridgeRef|setInterval/);
  assert.match(app,/hardwareToSceneJoints\(m.joints\)/);
  assert.doesNotMatch(app,/m\.joints\.j2 \+ j2Off/);
});
