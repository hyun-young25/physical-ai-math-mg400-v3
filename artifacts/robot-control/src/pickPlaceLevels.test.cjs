const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
function evaluate(source, deps = {}) {
  const exports = {};
  new Function('exports','require',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(exports,name=>{
    assert.ok(name in deps,name); return deps[name];
  }); return exports;
}
const curriculum = evaluate(read('curriculum.ts'));
const design = evaluate(read('pickPlaceDesign.ts'),{'./curriculum':curriculum});
const app = ts.createSourceFile('App.tsx',read('App.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const declarations = app.statements.filter(s=>(ts.isFunctionDeclaration(s)&&['fkMG400','ikMG400'].includes(s.name?.text))||(ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>['ARM_L1','COORD_OX','COORD_OZ'].includes(d.name.getText(app))))).map(s=>s.getText(app)).join('\n');
const core = evaluate(declarations+'\nexport {fkMG400,ikMG400,COORD_OX,COORD_OZ};');
const model = {
  fk(j){const p=core.fkMG400(j.j1,j.j2,j.j3);return {x:p.x+core.COORD_OX,y:p.y,z:p.z+core.COORD_OZ,r:j.j4};},
  ik(x,y,z,r,hint){const j=core.ikMG400(x-core.COORD_OX,y,z-core.COORD_OZ,hint);return j&&{...j,j4:r};},
};
const run = (level, plan=design.designPlan(level))=>design.compileDesign(model,level,plan,32,-90);
const record = (condition, outcome, extras={})=>({condition,outcome,prediction:String(condition.clearance),status:'completed',phase:'plan',...extras});

test('four difficulty levels have different operational conditions, not just different labels',()=>{
  const [one,two,three,four]=design.PICK_LEVELS;
  assert.equal(design.designTransfers(one).length,1);
  assert.equal(one.obstacles,undefined);
  assert.equal(two.obstacles.length,1);
  assert.equal(design.designTransfers(three).length,2);
  assert.equal(four.level,4);
  for(const c of design.PICK_LEVELS){
    const result=run(c);
    assert.equal(result.outcome.finished,true);
    assert.deepEqual(design.judgeDesign(result.outcome,String(c.clearance)),[]);
    assert.ok(result.frames.every(f=>f.pose.r===32));
  }
});
test('level 1 checks entered target Y and executes all seven ordered steps',()=>{
  const c=design.PICK_LEVELS[0];
  assert.equal(design.designPlan(c).length,7);
  assert.equal(designLevelPassed(run(c)),true);
  const bad=run(c,design.designPlan(c,c.clearance,-50));
  assert.equal(designLevelPassed(bad),false);
  assert.ok(bad.outcome.issues.some(i=>i.concept==='reference'));
  function designLevelPassed(result){return design.designLevelPassed(record(c,result.outcome));}
});
test('level 2 checks the carried block volume against the visible obstacle',()=>{
  const c=design.PICK_LEVELS[1];
  const bad=run(c,design.designPlan(c,50)); // top above obstacle but bottom intersects
  assert.ok(bad.outcome.issues.some(i=>i.concept==='collision'));
  assert.ok(bad.outcome.issues.some(i=>i.concept==='height'));
  const good=run(c,design.designPlan(c,60));
  assert.deepEqual(good.outcome.issues,[]);
  assert.equal(design.designHitsObstacle({x:300,y:0,z:50,r:0},c.obstacles[0],true),true);
  assert.equal(design.designHitsObstacle({x:300,y:0,z:60,r:0},c.obstacles[0],true),false);
});
test('level 3 keeps independent block snapshots and requires both ordered targets',()=>{
  const c=design.PICK_LEVELS[2], commands=design.designPlan(c), result=run(c,commands);
  assert.equal(commands.length,15);
  assert.equal(design.designSyntax(commands,'60','두 블록의 순서',c.maxCommands),null);
  assert.equal(result.outcome.completedTransfers,2);
  assert.ok(result.outcome.workpieces.every(w=>w.completed&&!w.attached&&design.designNear(w.top,w.place)));
  const duringB=result.frames.find(f=>f.workpieces[1].attached);
  assert.ok(duringB.workpieces[0].completed);
  assert.ok(design.designNear(duringB.workpieces[0].top,c.transfers[0].place));
  assert.equal(result.frames[0].workpieces[0].completed,false,'later changes must not mutate earlier scene snapshots');
  const incomplete=run(c,commands.slice(0,7));
  assert.equal(incomplete.outcome.completedTransfers,1);
  assert.equal(design.designLevelPassed(record(c,incomplete.outcome)),false);
  const reverse={...c,transfers:[...c.transfers].reverse()};
  const wrongOrder=run(c,design.designPlan(reverse));
  assert.ok(wrongOrder.outcome.issues.some(i=>i.concept==='sequence'&&i.message.includes('먼저')));
});
test('level 3 requires the first release retreat before leaving for the second block',()=>{
  const c=design.PICK_LEVELS[2], commands=design.designPlan(c);
  commands.splice(6,1);
  const result=run(c,commands);
  assert.ok(result.outcome.issues.some(i=>i.concept==='height'&&i.step===6));
  assert.equal(design.designLevelPassed(record(c,result.outcome)),false);
});
test('level 4 compares actual full TCP lengths and requires at least a ten percent reduction',()=>{
  const c=design.PICK_LEVELS[3];
  const base=run(c,design.designPlan(c,110)).outcome;
  const improved=run(c,design.designPlan(c,60)).outcome;
  assert.ok(Math.abs(base.pathLength-390)<0.15,base.pathLength);
  assert.ok(Math.abs(improved.pathLength-290)<0.15,improved.pathLength);
  assert.ok(design.designImprovement(improved.pathLength,base.pathLength)>25);
  assert.equal(design.designLevelPassed(record(c,improved)),false,'baseline measurement is required');
  assert.equal(design.designLevelPassed(record(c,base,{prediction:'110',baselineLength:base.pathLength})),false,'unchanged path cannot complete');
  assert.equal(design.designLevelPassed(record(c,improved,{baselineLength:base.pathLength})),true);
  const tooSmall=run(c,design.designPlan(c,100)).outcome;
  assert.equal(design.designLevelPassed(record(c,tooSmall,{prediction:'100',baselineLength:base.pathLength})),false);
  const unsafe=run(c,design.designPlan(c,40)).outcome;
  assert.equal(design.designLevelPassed(record(c,unsafe,{prediction:'40',baselineLength:base.pathLength})),false,'short collision path must fail');
});
test('submitted, stopped and baseline runs never count as completed difficulty levels',()=>{
  const c=design.PICK_LEVELS[0], outcome=run(c).outcome;
  for(const status of ['submitted','running','stopped','unavailable'])
    assert.equal(design.designLevelPassed(record(c,outcome,{status})),false,status);
  assert.equal(design.designLevelPassed(record(c,outcome,{phase:'baseline'})),false);
  assert.equal(design.designLevelPassed(record(c,{...outcome,finished:false})),false);
  assert.equal(design.designLevelPassed(record(c,outcome)),true);
});
test('unreachable multi-block plan stops at valid prefix and cannot count unexecuted blocks',()=>{
  const c=design.PICK_LEVELS[2], commands=design.designPlan(c);
  commands[7].values.x='5000';
  const {frames,outcome}=run(c,commands);
  assert.equal(outcome.finished,false);
  assert.equal(outcome.completedTransfers,1);
  assert.equal(outcome.workpieces[1].completed,false);
  assert.ok(frames.every(f=>f.step<7));
  assert.ok(design.designNear(outcome.workpieces[1].top,c.transfers[1].pick));
  assert.equal(design.designLevelPassed(record(c,outcome)),false);
});

test('descent into a released block cannot pass by rising afterward',()=>{
  const c=design.PICK_LEVELS[1], commands=design.designPlan(c);
  const down={...commands[6],id:design.designId(),values:{...commands[6].values,z:String(c.place.z-10)}};
  commands.splice(6,0,down);
  const result=run(c,commands);
  assert.ok(result.outcome.issues.some(i=>i.concept==='height'&&i.step===6));
  assert.equal(design.designLevelPassed(record(c,result.outcome)),false);
});
