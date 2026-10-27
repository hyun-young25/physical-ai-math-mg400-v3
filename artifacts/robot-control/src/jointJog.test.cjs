// Run from artifacts/robot-control: node --test src/jointJog.test.cjs
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const api={};
new Function('exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'jointJog.ts'),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText)(api);

test('R and J4 continuous controls use the same signed angular increment',()=>{
  for(const speed of [0,1,25,50,75,100,140]){
    for(const direction of [-1,1]){
      const r=api.rotationJogDelta(speed,direction);
      const j4=api.rotationJogDelta(speed,direction);
      assert.equal(r,j4);
    }
  }
  assert.equal(api.rotationJogDelta(50,1),1);
  assert.equal(api.rotationJogDelta(50,-1),-1);
  assert.equal(1000/api.JOG_INTERVAL_MS*api.rotationJogDelta(50,1),12.5);
});

test('J1-J3 keep their existing continuous speed',()=>{
  assert.equal(api.armJointJogDelta(50,1),0.25);
  assert.equal(api.armJointJogDelta(100,-1),-0.5);
});
