const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const read = name => fs.readFileSync(path.join(__dirname,name),'utf8');
const compile = source => ts.transpileModule(source,{compilerOptions:{
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const exported = {};
new Function('exports','require',compile(read('practiceSession.ts')))(exported,()=>{
  throw new Error('Unexpected runtime dependency');
});
const source = ts.createSourceFile('PracticeControls.tsx',read('PracticeControls.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const clockHook = source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='useNow');
assert.ok(clockHook);

test('measurement age uses render time between clock ticks, without widening freshness limits',()=>{
  const realNow = Date.now;
  try {
    Date.now = ()=>2000;
    const useNow = new Function('useState','useEffect',compile(clockHook.getText(source))+';return useNow;')(
      ()=>[1600,()=>{}],()=>{});
    const renderTime=useNow(true);
    assert.equal(renderTime,2000);
    assert.equal(exported.measurementFresh({receivedAt:2000,ageMs:0},renderTime),true,'new feedback is not falsely stale');
    assert.equal(exported.measurementFresh({receivedAt:499,ageMs:0},renderTime),false,'1501 ms old feedback stays blocked');
    assert.equal(exported.measurementFresh({receivedAt:2000,ageMs:1501},renderTime),false,'old PC samples stay blocked');
    assert.equal(exported.measurementFresh({receivedAt:2001,ageMs:0},renderTime),false,'future timestamps are not accepted');
  } finally { Date.now=realNow; }
});
