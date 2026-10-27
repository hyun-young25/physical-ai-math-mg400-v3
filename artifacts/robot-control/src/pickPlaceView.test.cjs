const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = ts.createSourceFile('PickPlaceChapter.tsx',
  fs.readFileSync(path.join(__dirname,'PickPlaceChapter.tsx'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let initializer;
function visit(node) {
  if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='focusPoint') initializer=node.initializer.getText(source);
  ts.forEachChild(node,visit);
}
visit(source);assert.ok(initializer);
const code=ts.transpileModule(`const focusPoint=${initializer};`,{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const evaluate=new Function('useMemo','reviewObs','scenario','post','frame','stage','localToWorld',code+'return focusPoint;');
function memo() {
  let previous,value;
  return (compute,deps)=>{
    if(!previous||deps.some((d,i)=>!Object.is(d,previous[i]))) { value=compute();previous=deps; }
    return value;
  };
}
test('review focus keeps identity during parent-only renders and updates for a new observation',()=>{
  const useMemo=memo(),scenario={robots:[{id:'A'}],source:{x:1},destination:{x:2}};
  const frame={robots:{A:{pose:{x:3}}}};
  let conversions=0;
  const convert=pose=>{conversions++;return {...pose};};
  const observation={actual:{x:280,y:-100,z:220,r:0}};
  const render=obs=>evaluate(useMemo,obs,scenario,true,frame,'observation',convert);
  const focus=render(observation);
  for(let i=0;i<30;i++) assert.strictEqual(render(observation),focus,'visual publication cannot trigger another publication');
  assert.equal(conversions,1);
  const moved=render({actual:{x:280,y:80,z:295,r:0}});
  assert.notStrictEqual(moved,focus);assert.equal(moved.y,80);assert.equal(conversions,2);
  assert.strictEqual(render(undefined),frame.robots.A.pose);
  assert.strictEqual(evaluate(useMemo,undefined,scenario,false,frame,'plan',convert),scenario.destination);
  assert.strictEqual(evaluate(useMemo,undefined,scenario,false,frame,'task',convert),scenario.source);
});
