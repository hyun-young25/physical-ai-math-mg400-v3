// Run from artifacts/robot-control: node --test src/adaptiveLearning.test.cjs
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
function load(name,deps={}){
  const exports={},code=ts.transpileModule(read(name),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  new Function('exports','require',code)(exports,n=>{assert.ok(n in deps,`Unexpected ${n}`);return deps[n];});return exports;
}
const c=load('curriculum.ts'),axis=load('axisLesson.ts',{'./curriculum':c});
const coordinates=load('coordinateLearning.ts',{'./curriculum':c});
const strategy=load('coordinateStrategies.ts',{'./curriculum':c,'./coordinateLearning':coordinates});
const reasoning=load('axisReasoning.ts',{'./curriculum':c,'./axisLesson':axis});
const support=load('learningSupport.ts',{'./curriculum':c,'./axisLesson':axis,'./axisReasoning':reasoning,'./coordinateLearning':coordinates,'./coordinateStrategies':strategy});
const home={x:350,y:0,z:0,r:0},raw=v=>({x:String(v.x),y:String(v.y),z:String(v.z)});
const final=strategy.COORDINATE_SCENARIOS.at(-1);
const commands=()=>final.steps.map(s=>({mode:'absolute',argument:raw(s.goal)}));
const prediction=()=>final.steps.map(s=>raw(s.goal));
const input=()=>({requirement:final.requirement,explanation:'각 구간의 원점 기준 도착 위치를 계산했다.',hints:0,predictions:prediction()});
const observed=(task,a)=>({...a,results:strategy.strategyPlan(task,a.commands).map(s=>({from:s.from,to:s.to}))});

test('reverse reasoning replaces one exercise and keeps all lesson counts',()=>{
  assert.equal(axis.AXIS_LESSON_TASKS.length,7);
  assert.equal(axis.AXIS_LESSON_TASKS.filter(t=>t.reverse).length,1);
  assert.equal(axis.axisLearningMode(axis.AXIS_LESSON_TASKS.find(t=>t.reverse)),'practice');
  assert.equal(coordinates.COORDINATE_TASKS.length,5);assert.equal(strategy.COORDINATE_SCENARIOS.length,3);
});
test('every reverse choice drives its own movement; matching a wrong command is not achieving the goal',()=>{
  const task=axis.AXIS_LESSON_TASKS.find(t=>t.reverse);
  assert.equal(axis.axisCommandTarget(home,task,null),null);
  for(const a of c.POSE_AXES)for(const sign of [-1,1]){
    const command={axis:a,sign},to=axis.axisCommandTarget(home,task,command);
    assert.equal(to[a]-home[a],sign*task.distance);
    for(const fixed of c.POSE_AXES.filter(x=>x!==a))assert.equal(to[fixed],home[fixed]);
    const p=axis.observedAxisChanges(home,to),attempt={prediction:p,from:home,to,command};
    assert.equal(!!axis.completeAxisPractice(task,[attempt],p),a===task.axis&&sign===task.sign);
    if(a!==task.axis)assert.ok(support.axisErrorEvent(task,attempt,0).errors.includes('axis'));
    else if(sign!==task.sign)assert.ok(support.axisErrorEvent(task,attempt,0).errors.includes('sign'));
  }
});
test('reverse retry preserves the first command, prediction and support use',()=>{
  const task=axis.AXIS_LESSON_TASKS.find(t=>t.reverse),wrong={axis:'y',sign:1},right={axis:'z',sign:-1};
  const trials=[wrong,right].map((command,i)=>({id:`a${i}`,command,from:home,to:axis.axisCommandTarget(home,task,command),
    prediction:{x:0,y:0,z:-1},supportIds:i?['support-1']:[]}));
  const record=axis.completeAxisPractice(task,trials,{x:0,y:0,z:-1});assert.ok(record);
  trials[0].command.axis='x';trials[1].supportIds.push('changed');
  assert.equal(record.attempts[0].command.axis,'y');assert.deepEqual(record.attempts[1].supportIds,['support-1']);
});
test('independent design requires all endpoint predictions, command values and a reason before submission',()=>{
  for(const predictions of [undefined,[],prediction().slice(1),prediction().map((p,i)=>i? p:{...p,x:''}),prediction().map((p,i)=>i?p:{...p,z:'Infinity'})])
    assert.equal(strategy.makeStrategyAttempt(final,commands(),{...input(),predictions}),null);
  assert.equal(strategy.makeStrategyAttempt(final,commands(),{...input(),explanation:' '}),null);
  assert.equal(strategy.makeStrategyAttempt(final,strategy.blankStrategyCommands(final),input()),null);
  assert.ok(strategy.makeStrategyAttempt(final,commands(),input()));
});
test('independent endpoints are hidden until submission while practice keeps live previews',()=>{
  const draft=commands();
  assert.deepEqual(strategy.strategyVisual(final,draft,[],'before').points.map(p=>p.id),['goal-0']);
  assert.equal(strategy.strategyVisual(final,draft,[],'before').showPaths,false);
  assert.equal(strategy.strategyVisual(final,draft,[],'after',true).showPaths,true);
  assert.equal(strategy.strategyVisual(final,draft,[],'after',true).points.filter(p=>p.kind==='prediction').length,3);
  draft[0].argument.x='260';
  assert.equal(strategy.strategyVisual(final,draft,[],'before').points.filter(p=>p.kind==='prediction').length,0);
  assert.equal(strategy.strategyVisual(final,draft,[],'after',true).points.find(p=>p.id==='input-0').pose.x,260);
  const practice=strategy.COORDINATE_SCENARIOS[0],practiceDraft=practice.steps.map(s=>({mode:'absolute',argument:raw(s.goal)}));
  practiceDraft[0].argument.x='315';
  assert.equal(strategy.strategyVisual(practice,practiceDraft,[],'practice').points.find(p=>p.id==='input-0').pose.x,315);
  const task=coordinates.COORDINATE_TASKS.at(-1),answers=coordinates.blankCoordinateDraft();
  answers.absolute=raw(task.b);answers.relative={x:'260',y:'40',z:'20'};
  assert.deepEqual(coordinates.coordinatePreview(task,answers),[]);
  assert.equal(coordinates.coordinatePreview(task,answers,true).length,2);
});
test('correct commands with an incorrect independent endpoint prediction cannot complete',()=>{
  const firstInput=input();firstInput.predictions[1].x='999';
  const first=strategy.makeStrategyAttempt(final,commands(),firstInput);
  const full=observed(final,first),report=strategy.analyzeStrategyAttempt(final,full);
  assert.equal(report.numericCorrect,true);assert.equal(report.predictionsCorrect,false);
  assert.equal(strategy.completeStrategyAttempt(final,full),null);
  firstInput.predictions[1].x='280';assert.equal(first.predictions[1].x,'999');
  const second=strategy.makeStrategyAttempt(final,commands(),{...input(),supportIds:['support-1']});
  assert.notEqual(first.id,second.id);assert.ok(strategy.completeStrategyAttempt(final,observed(final,second)));
  second.predictions[0].x='0';assert.equal(first.predictions[0].x,'240');
});
test('error-contingent support counts distinct submissions, not fields, renders or unrelated errors',()=>{
  assert.equal(support.supportTrigger([{id:'a',errors:['axis','axis']}],[]),null);
  assert.equal(support.supportTrigger([{id:'a',errors:['axis']},{id:'a',errors:['axis']}],[]),null);
  assert.equal(support.supportTrigger([{id:'a',errors:['axis']},{id:'b',errors:['sign']}],[]),null);
  const events=[{id:'a',errors:['axis']},{id:'b',errors:['axis']}],trigger=support.supportTrigger(events,[]);
  assert.deepEqual(trigger,{error:'axis',ids:['a','b']});
  const record=support.openSupport('2-1','z-minus',trigger);
  assert.equal(support.supportTrigger(events,[record]),null);
  assert.equal(support.supportTrigger([...events,{id:'c',errors:['axis']}],[record]),null);
  assert.deepEqual(support.supportTrigger([...events,{id:'c',errors:['axis']},{id:'d',errors:['axis']}],[record]).ids,['c','d']);
});
test('support diagnoses signed subtraction, position/displacement, accumulation and prediction separately',()=>{
  const task=coordinates.COORDINATE_TASKS[0],draft=coordinates.blankCoordinateDraft();
  draft.delta={x:'-50',y:'100',z:'0'};
  const a=coordinates.makeCoordinateAttempt(task,draft,{comparison:'same',rule:'subtract',explanation:'',hints:0});
  assert.ok(support.coordinateErrorEvent(task,a).errors.includes('sign'));
  draft.delta=raw(task.b);assert.ok(support.coordinateErrorEvent(task,{...a,draft}).errors.includes('reference'));
  const sequence=strategy.COORDINATE_SCENARIOS[1];
  const cmds=sequence.steps.map(()=>({mode:'absolute',argument:raw(sequence.steps[0].goal)}));
  const s=strategy.makeStrategyAttempt(sequence,cmds,{requirement:'displacement',explanation:'같은 절대 위치',hints:0});
  assert.deepEqual(support.strategyErrorEvent(sequence,s).errors,['accumulation']);
  const wrong=input();wrong.predictions[0].x='999';
  assert.deepEqual(support.strategyErrorEvent(final,strategy.makeStrategyAttempt(final,commands(),wrong)).errors,['prediction']);
});
test('optional support requires practice, then a fresh unsupported condition; every response survives',()=>{
  for(const lesson of ['2-1','2-2'])for(const error of Object.keys(support.ERROR_LABEL)){
    const original=support.openSupport(lesson,'task',{error,ids:['a','b']});
    assert.equal(support.startSupportCheck(original),null);assert.equal(support.submitSupport(original,{}),null);
    const p=support.supportProblem(error,'practice',0,lesson),answers={...p.expected};
    const practiced=support.submitSupport(original,answers);assert.equal(practiced.status,'practice');
    assert.equal(original.practice.length,0);answers[Object.keys(answers)[0]]='changed';
    assert.deepEqual(practiced.practice[0].answers,p.expected);
    const check=support.startSupportCheck(practiced),q=support.supportProblem(error,'check',0,lesson);
    assert.notEqual(q.prompt,p.prompt);assert.equal(check.status,'check');
    const wrong=Object.fromEntries(q.fields.map(f=>[f.key,'999']));
    const failed=support.submitSupport(check,wrong);assert.equal(failed.status,'check');assert.equal(failed.checks[0].correct,false);
    const fresh=support.supportProblem(error,'check',1,lesson);assert.notEqual(fresh.prompt,q.prompt);
    const done=support.submitSupport(failed,fresh.expected);assert.equal(done.status,'complete');
    assert.equal(done.checks.length,2);assert.equal(done.checks[0].condition,q.prompt);assert.equal(done.checks[1].condition,fresh.prompt);
    assert.equal(done.practice.length,1);assert.deepEqual(done.triggerIds,['a','b']);assert.equal(support.submitSupport(done,{}),null);
    assert.equal(JSON.parse(JSON.stringify(done)).status,'complete','App/export round trip preserves progress');
  }
});
test('independent UI gates live computation and execution, and support checks omit the worked explanation',()=>{
  const ui=read('CoordinateStrategyLesson.tsx'),concept=read('AbsoluteRelativeLesson.tsx'),help=read('AdaptiveSupport.tsx');
  assert.match(ui,/const plan=revealed\?strategyPreviewPlan/);
  assert.match(ui,/if\(independent&&!attempt\)return;/);
  assert.match(concept,/if\(independent&&!attempt\)return;/);
  assert.match(ui,/setPredictions\(blankStrategyPredictions\(task\)\)/);
  assert.match(concept,/coordinatePreview\(task,attempt\?\.draft \?\? draft,!!attempt\)/);
  assert.match(help,/!checking&&<p className="lesson-formula"/);
  assert.doesNotMatch(help,/problem\.expected/);
  assert.match(read('AxisLessonOverlay.tsx'),/!visual\.independent && !visual\.task\.reverse && <Arrow/);
});
