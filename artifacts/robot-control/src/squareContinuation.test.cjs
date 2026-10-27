const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),ts=require("typescript");
const exportsObj={};
new Function("exports",ts.transpileModule(fs.readFileSync(require("node:path").join(__dirname,"squareContinuation.ts"),"utf8"),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText)(exportsObj);
const {SquareContinuation}=exportsObj;
test("one approval only: duplicate virtual completion never starts hardware twice",async()=>{
  const phases=[],run=new SquareContinuation("plan","answers",p=>phases.push(p));
  const done=run.waitForVirtual(()=>true);
  assert.throws(()=>run.beginHardware(),/완주/);
  run.completeVirtual("plan",true,true,5,5);
  run.completeVirtual("plan",true,true,5,5);
  await done;run.beginHardware();
  assert.throws(()=>run.beginHardware(),/완주/);
  run.completeVirtual("plan",true,true,5,5);run.finish();
  assert.deepEqual(phases,["virtual","verified","hardware","complete"]);
  assert.throws(()=>run.assertCurrent("plan","answers"));
});
for(const [label,key,closed,returned,steps] of [
  ["wrong plan","other",true,true,5],["open path","plan",false,true,5],
  ["no return","plan",true,false,5],["incomplete","plan",true,true,4],
])test(`${label} cannot cross the virtual/physical barrier`,async()=>{
  const run=new SquareContinuation("plan","answers",()=>{});
  const done=run.waitForVirtual(()=>true);
  run.completeVirtual(key,closed,returned,steps,5);
  await assert.rejects(done,/완주·닫힘·복귀/);
  assert.throws(()=>run.beginHardware());
});
test("cancel and changed input discard the permit permanently",async()=>{
  const run=new SquareContinuation("plan","answers",()=>{});
  const done=run.waitForVirtual(()=>true);
  assert.throws(()=>run.assertCurrent("plan","edited"),/변경/);
  run.cancel("입력 변경");
  run.completeVirtual("plan",true,true,5,5);
  await assert.rejects(done,/입력 변경/);
  assert.throws(()=>run.assertCurrent("plan","answers"),/입력 변경/);
  assert.throws(()=>run.beginHardware(),/입력 변경/);
});
test("virtual start rejection does not hang or permit a late completion",async()=>{
  const run=new SquareContinuation("plan","answers",()=>{});
  await assert.rejects(run.waitForVirtual(()=>false),/시작하지 못해/);
  run.completeVirtual("plan",true,true,5,5);
  assert.throws(()=>run.beginHardware());
});
