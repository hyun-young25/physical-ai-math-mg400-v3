// node --test src/transferLearning.test.cjs
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function load(name,deps={}){deps={...require("./learningTestAdapter.cjs"),...deps};const exports={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,name),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(exports,n=>{assert.ok(n in deps,n);return deps[n];});return exports;}
const c=load('curriculum.ts'),m=load('transferLearning.ts',{'./curriculum':c}),f=load('learningFramework.ts'),feedback=load('measurementFeedback.ts');
const from={...m.LIFT_START,r:76},goal={...m.LIFT_GOAL,r:76};
const result=mode=>({id:mode,mode,startedAt:'t1',finishedAt:'t2',from,target:goal,observed:goal,status:'completed'});
const trial=()=>({id:'trial',submittedAt:'t0',commands:{absolute:'60',relative:'40'},revisionReason:'',results:[result('absolute'),result('relative')]});
const record=t=>({id:'record',pairId:'pair',source:'dt',explanationReview:'teacher',explanations:[{text:'출발 위치에 변화량을 더하면 도착 위치다.',submittedAt:'t'}],trials:[t]});
test('absolute height and relative displacement use the actual start and preserve other axes and R',()=>{
  assert.deepEqual(m.liftTarget(from,'absolute','60'),goal);assert.deepEqual(m.liftTarget(from,'relative','40'),goal);
  assert.equal(m.liftTarget({...from,z:35},'relative','40').z,75);
  for(const v of ['', ' ', 'Infinity','NaN','abc'])assert.equal(m.liftTarget(from,'absolute',v),null);
});
test('both observed methods and a saved explanation are required; correct work needs no revision',()=>{
  assert.equal(m.transferLearningComplete(record(trial())),true);
  const r=record(trial());r.explanations=[];assert.equal(m.transferLearningComplete(r),false);
  for(const results of [[],[result('absolute')],[result('relative')]])assert.equal(m.transferLearningComplete(record({...trial(),results})),false);
});
test('the transfer review requires re-deriving the relative lift for a new starting height',()=>{
  const from={...m.TRANSFER_START,r:76},goal={...m.TRANSFER_GOAL,r:76};
  const makeResult=mode=>({id:mode,mode,startedAt:'t1',finishedAt:'t2',from,target:goal,observed:goal,status:'completed'});
  const t={id:'transfer-trial',submittedAt:'t0',commands:{absolute:'60',relative:'30'},revisionReason:'',results:[makeResult('absolute'),makeResult('relative')]};
  assert.equal(m.liftTrialResult(t,m.TRANSFER_START,m.TRANSFER_GOAL).correct,true);
  assert.equal(m.liftTrialResult(t).correct,false);
});

test('stopped, rejected and running results never complete, including a later interruption',()=>{
  for(const status of ['stopped','running','rejected']){
    const t=trial();t.results.push({...result('relative'),id:'later',status});assert.equal(m.liftTrialResult(t).correct,false);
  }
});
test('matching a wrong command is not satisfying the target; fabricated endpoint alone cannot pass',()=>{
  for(const field of ['target','observed','from']){const t=trial();t.results[1]={...t.results[1],[field]:{...t.results[1][field],z:80}};assert.equal(m.liftTrialResult(t).correct,false);}
  const t=trial();t.commands.relative='60';assert.equal(m.liftTrialResult(t).correct,false);
  t.results[1].target={...goal,z:80};assert.equal(m.liftTrialResult(t).correct,false);
});
test('FK display rounding is tolerated; a different origin, direction or nonfinite value is not',()=>{
  const t=trial();t.results[1].observed={...goal,x:300.02,z:59.99};assert.equal(m.liftTrialResult(t).correct,true);
  for(const p of [{...goal,x:310},{...goal,r:0},{...goal,z:NaN}]){t.results[1].observed=p;assert.equal(m.liftTrialResult(t).correct,false);}
});
test('first trial is preserved and latest trial determines completion',()=>{
  const first=trial(),snapshot=JSON.stringify(first),bad=trial();bad.commands.relative='60';
  const r=record(first);r.trials.push(bad);assert.equal(m.transferLearningComplete(r),false);
  r.trials.push({...trial(),revisionReason:'높이와 변화량의 기준을 구분했다.'});assert.equal(m.transferLearningComplete(r),true);assert.equal(JSON.stringify(first),snapshot);
});
test('seven-stage export metadata has one shared session and explicit source/support provenance',()=>{
  const a=f.learningRecordContext('dt'),b=f.learningRecordContext('hardware');assert.equal(a.sessionId,b.sessionId);
  assert.equal(a.framework.stages.length,7);assert.deepEqual([1,2,3,4,5,6,7].map(f.frameworkStage),[1,2,3,4,5,6,7]);
  assert.equal(a.framework.version,'seven-stage-v1');
  assert.equal(a.supportProvider,'rule-based');assert.equal(a.dataSource,'dt');assert.equal(b.dataSource,'hardware');
});
test('virtual feedback never claims physical validation and hardware feedback stays within reported coordinates',()=>{
  const low=[{errorX:1,errorY:0,errorZ:0,distanceError:1}];
  assert.match(feedback.measurementHint(low,'virtual'),/가상 센서/);assert.doesNotMatch(feedback.measurementHint(low,'virtual'),/안정적으로 재현/);
  assert.match(feedback.measurementHint(low,'hardware'),/장비가 보고한 좌표/);assert.match(feedback.measurementHint([],'virtual'),/확인/);
});
