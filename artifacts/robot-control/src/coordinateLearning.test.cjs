// Run from artifacts/robot-control: node --test src/coordinateLearning.test.cjs
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const read = name => fs.readFileSync(path.join(__dirname,name),'utf8');
function load(source,deps={}) {
  const exports = {}, code = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  new Function('exports','require',code)(exports,name=>{ assert.ok(name in deps); return deps[name]; }); return exports;
}
const curriculum=load(read('curriculum.ts'));
const c=load(read('coordinateLearning.ts'),{'./curriculum':curriculum});
const strategy=load(read('coordinateStrategies.ts'),{'./curriculum':curriculum,'./coordinateLearning':c});
const tasks=c.COORDINATE_TASKS;
const draftFor = task => {
  const draft=c.blankCoordinateDraft(), expected=c.coordinateExpected(task);
  for(const field of c.coordinateFields(task)) for(const axis of curriculum.POSE_AXES) draft[field][axis]=String(expected[field][axis]);
  return draft;
};
function submission(task,draft=draftFor(task),extra={}) {
  return c.makeCoordinateAttempt(task,draft,{
    comparison:['transfer','literal'].includes(task.kind)?'different':'same',rule:c.coordinateRule(task)??'',
    explanation:task.support==='independent'?'절대는 원점 기준 위치를 유지하고 상대는 새 출발점에서 같은 변화량만큼 이동한다.':'',hints:0,...extra,
  });
}
function observed(task,attempt=submission(task)) {
  const commands=c.coordinateCommands(task,attempt.draft);
  return {...attempt,results:Object.fromEntries(c.COORDINATE_MODES.map(mode=>[mode,{from:{...c.coordinateStart(task)},to:{...commands[mode]}}]))};
}

test('sequence teaches signed conversion before changed-start transfer and independent application',()=>{
  assert.deepEqual(tasks.map(t=>t.kind),['delta','endpoint','literal','transfer','transfer']);
  assert.deepEqual(tasks.map(t=>t.support),['guided','practice','practice','practice','independent']);
  assert.equal(new Set(tasks.map(t=>t.id)).size,5);
  assert.notDeepEqual(tasks[3].changedStart,tasks[4].changedStart);
  assert.notDeepEqual(tasks[3].a,tasks[4].a);
});

test('position and signed displacement form the same intended movement in both directions',()=>{
  assert.deepEqual(c.coordinateExpected(tasks[0]).delta,{x:50,y:-100,z:0});
  assert.deepEqual(c.coordinateExpected(tasks[1]).absolute,{x:260,y:30,z:20,r:0});
  for(const task of tasks.slice(0,2)) {
    const commands=c.coordinateCommands(task,draftFor(task));
    assert.deepEqual(commands.absolute,commands.relative);
  }
});

test('changing only the start holds the absolute endpoint and shifts the relative endpoint',()=>{
  for(const task of tasks.slice(3)) {
    const commands=c.coordinateCommands(task,draftFor(task));
    assert.deepEqual(commands.absolute,task.b);
    assert.deepEqual(curriculum.poseDifference(commands.absolute,commands.relative),curriculum.poseDifference(task.a,task.changedStart));
  }
  assert.deepEqual(c.coordinateCommands(tasks[3],draftFor(tasks[3])).relative,{x:280,y:-20,z:0,r:0});
  assert.deepEqual(c.coordinateCommands(tasks[4],draftFor(tasks[4])).relative,{x:260,y:40,z:20,r:0});
});

test('student coordinates drive conversion commands instead of being replaced with answers',()=>{
  const delta=draftFor(tasks[0]);delta.delta.x='60';
  assert.equal(c.coordinateCommands(tasks[0],delta).relative.x,310);
  assert.equal(c.coordinateCommands(tasks[0],delta).absolute.x,300);
  const endpoint=draftFor(tasks[1]);endpoint.absolute.y='40';
  assert.equal(c.coordinateCommands(tasks[1],endpoint).absolute.y,40);
  assert.equal(c.coordinateCommands(tasks[1],endpoint).relative.y,30);
  const transfer=draftFor(tasks[4]);transfer.relative.x='1000';
  assert.equal(c.coordinateCommands(tasks[4],transfer).relative.x,260,'Transfer inputs predict fixed commands; they do not rewrite them');
});

test('blank, partial, nonfinite inputs cannot be submitted or rendered as complete predictions',()=>{
  for(const task of tasks) assert.equal(submission(task,c.blankCoordinateDraft()),null);
  for(const value of ['', ' ', '-', 'Infinity', 'NaN', '1e999']) {
    const draft=draftFor(tasks[0]);draft.delta.z=value;
    assert.equal(c.coordinateCommands(tasks[0],draft),null);
    assert.equal(c.coordinatePreview(tasks[0],draft).filter(p=>p.kind==='prediction').length,0);
  }
  const draft=draftFor(tasks[0]);draft.delta.z='0';draft.delta.x='50.005';
  assert.ok(submission(tasks[0],draft));
});

test('scene preview exposes only given points and complete student inputs, with immediate input updates',()=>{
  assert.deepEqual(c.coordinatePreview(tasks[0],c.blankCoordinateDraft()).map(p=>p.id),['given-b']);
  for(const task of [tasks[1],tasks[3],tasks[4]]) assert.deepEqual(c.coordinatePreview(task,c.blankCoordinateDraft()),[]);
  const draft=c.blankCoordinateDraft();draft.absolute={x:'270',y:'20',z:'10'};
  const first=c.coordinatePreview(tasks[1],draft);
  assert.equal(first.length,1);assert.deepEqual(first[0].pose,{x:270,y:20,z:10,r:0});
  draft.absolute.x='290';assert.equal(c.coordinatePreview(tasks[1],draft)[0].pose.x,290);
  assert.equal(first[0].pose.x,270,'Old preview snapshots are not mutated');
});

test('feedback identifies endpoint-as-delta, reversed subtraction, and omitted starting position',()=>{
  let draft=draftFor(tasks[0]);draft.delta.x='300';
  assert.match(c.analyzeCoordinateAttempt(tasks[0],submission(tasks[0],draft)).fields[0].feedback,/도착 위치를 그대로/);
  draft.delta.x='-50';assert.match(c.analyzeCoordinateAttempt(tasks[0],submission(tasks[0],draft)).fields[0].feedback,/순서가 반대/);
  draft=draftFor(tasks[1]);draft.absolute.x='-40';
  assert.match(c.analyzeCoordinateAttempt(tasks[1],submission(tasks[1],draft)).fields[0].feedback,/변화량만/);
  draft=draftFor(tasks[3]);draft.absolute.x='280';draft.relative.x='300';
  const report=c.analyzeCoordinateAttempt(tasks[3],submission(tasks[3],draft));
  assert.match(report.fields[0].feedback,/새 출발점을 더/);assert.match(report.fields[3].feedback,/처음 출발점/);
});

test('both complete executions are required; stopping, stale endpoints, and different starts cannot complete',()=>{
  const task=tasks[0], good=observed(task);
  for(const results of [{}, {absolute:good.results.absolute}, {relative:good.results.relative},
    {...good.results,absolute:{...good.results.absolute,to:{...task.b,x:275}}},
    {...good.results,relative:{...good.results.relative,from:{...task.a,x:251}}},
    {...good.results,relative:{...good.results.relative,to:{...task.b,r:20}}},
  ]) assert.equal(c.completeCoordinateAttempt(task,{...good,results}),null);
  assert.equal(c.completeCoordinateAttempt(task,{...good,taskId:'other'}),null);
  assert.equal(c.completeCoordinateAttempt(task,{...good,source:'hardware'}),null);
  assert.ok(c.completeCoordinateAttempt(task,good));
});

test('observing a correctly predicted mismatch does not make an incorrect coordinate expression correct',()=>{
  const task=tasks[0], draft=draftFor(task);draft.delta.x='60';
  const result=c.analyzeCoordinateAttempt(task,observed(task,submission(task,draft,{comparison:'different'})));
  assert.equal(result.observed,true);assert.equal(result.comparisonCorrect,true);
  assert.equal(result.numericCorrect,false);assert.equal(result.canComplete,false);
  assert.equal(c.completeCoordinateAttempt(task,observed(task,submission(task,draftFor(task),{rule:'reverse'}))),null);
});

test('independent application requires a recorded reason and no hints; prose is not semantically graded',()=>{
  const task=tasks[4];
  assert.equal(submission(task,draftFor(task),{explanation:'  '}),null);
  assert.equal(c.completeCoordinateAttempt(task,observed(task,submission(task,draftFor(task),{hints:1}))),null);
  assert.equal(c.completeCoordinateAttempt(task,observed(task,submission(task,draftFor(task),{comparison:'same'}))),null);
  const record=c.completeCoordinateAttempt(task,observed(task,submission(task,draftFor(task),{explanation:'모르겠습니다.'})));
  assert.equal(record.explanation,'모르겠습니다.');
  assert.equal(record.completed,true,'Completion records activity and numerical evidence, not prose correctness');
});

test('submitted and completed records are snapshots; a later correction does not overwrite the first draft',()=>{
  const task=tasks[0], draft=draftFor(task), first=submission(task,draft);
  draft.delta.x='60';assert.equal(first.draft.delta.x,'50');
  const finished=c.completeCoordinateAttempt(task,observed(task,first));
  first.draft.delta.y='-999';assert.equal(finished.draft.delta.y,'-100');
  assert.equal(first.completed,false);assert.equal(finished.completed,true);
});

test('all command paths and moderate student errors are reachable using the existing actual FK/IK',()=>{
  const source=ts.createSourceFile('App.tsx',read('App.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const declarations=source.statements.filter(s=>(ts.isFunctionDeclaration(s)&&['fkMG400','ikMG400'].includes(s.name?.text)) ||
    (ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>['ARM_L1','COORD_OX','COORD_OZ'].includes(d.name.getText(source)))))
    .map(s=>s.getText(source)).join('\n');
  const core=load(declarations+'\nexport {fkMG400,ikMG400,COORD_OX,COORD_OZ};');
  const model={
    fk(j){const p=core.fkMG400(j.j1,j.j2,j.j3);return{x:p.x+core.COORD_OX,y:p.y,z:p.z+core.COORD_OZ,r:j.j4};},
    ik(x,y,z,r,hint){const j=core.ikMG400(x-core.COORD_OX,y,z-core.COORD_OZ,hint);return j&&{...j,j4:r};},
  };
  for(const task of tasks) for(const error of [0,10]) {
    const draft=draftFor(task), field=c.coordinateFields(task)[0];draft[field].x=String(Number(draft[field].x)+error);
    const commands=c.coordinateCommands(task,draft);
    for(const mode of c.COORDINATE_MODES) {
      const samples=curriculum.sampleLessonMotion(model,c.coordinateStart(task),commands[mode],'MoveL',-113.32);
      assert.equal(samples?.length,121,`${task.id}: ${mode}, error ${error}`);
      for(const frame of samples) {
        const actual=model.fk(frame.joints);
        assert.ok(Math.hypot(actual.x-frame.pose.x,actual.y-frame.pose.y,actual.z-frame.pose.z)<0.15);
        assert.equal(frame.pose.r,0);
      }
    }
  }
});

test('overlay displacement uses the same X/Y/Z orientation as the existing robot',()=>{
  assert.deepEqual(c.coordinateWorldOffset({x:50,y:-100,z:20}),[50,20,100]);
  const a=tasks[4].a,b=tasks[4].b;
  const wa=c.coordinateWorldOffset(a),wb=c.coordinateWorldOffset(b);
  assert.deepEqual(wb.map((v,i)=>v-wa[i]),c.coordinateWorldOffset(curriculum.poseDifference(a,b)));
});

test('display arguments distinguish a relative displacement from an equal resulting endpoint',()=>{
  const first=tasks[0],draft=draftFor(first),args=c.coordinateArguments(first,draft),commands=c.coordinateCommands(first,draft);
  assert.deepEqual(args.relative,{x:50,y:-100,z:0});
  assert.deepEqual(args.absolute,{x:300,y:-50,z:0,r:0});
  assert.deepEqual(commands.absolute,commands.relative);
  assert.notDeepEqual(args.relative,commands.relative);
  assert.equal(c.coordinateArguments(first,c.blankCoordinateDraft()).relative,null);
  const same=tasks[2],sameArgs=c.coordinateArguments(same,draftFor(same)),sameCommands=c.coordinateCommands(same,draftFor(same));
  assert.deepEqual(sameArgs.absolute,sameArgs.relative);
  assert.deepEqual(sameCommands.absolute,{x:240,y:20,z:0,r:0});
  assert.deepEqual(sameCommands.relative,{x:440,y:20,z:0,r:0});
  assert.ok(c.completeCoordinateAttempt(same,observed(same)));
});

const raw=v=>({x:String(v.x),y:String(v.y),z:String(v.z)});
function solutionFor(task,modes){
  let from=task.from;
  return task.steps.map((step,i)=>{
    from=step.start??from;const mode=modes[i],argument=mode==='absolute'?step.goal:curriculum.poseDifference(from,step.goal);
    from=step.goal;return{mode,argument:raw(argument)};
  });
}
function strategySubmission(task,commands,extra={}){
  return strategy.makeStrategyAttempt(task,commands,{requirement:task.requirement,explanation:'선택한 표현에 맞춰 위치와 변화량을 계산했습니다.',hints:0,
    predictions:task.support==='independent'?task.steps.map(s=>raw(s.goal)):undefined,...extra});
}
function strategyObserved(task,attempt){
  return{...attempt,results:strategy.strategyPlan(task,attempt.commands).map(p=>({from:{...p.from},to:{...p.to}}))};
}
function allModes(length){return Array.from({length:2**length},(_,mask)=>Array.from({length},(_,i)=>mask&(1<<i)?'relative':'absolute'));}

test('every scenario accepts all-absolute, all-relative, and mixed valid solutions',()=>{
  assert.deepEqual(strategy.COORDINATE_SCENARIOS.map(t=>t.requirement),['location','displacement','mixed']);
  for(const task of strategy.COORDINATE_SCENARIOS)for(const modes of allModes(task.steps.length)){
    const commands=solutionFor(task,modes),submitted=strategySubmission(task,commands);
    assert.ok(strategy.completeStrategyAttempt(task,strategyObserved(task,submitted)),`${task.id}: ${modes}`);
  }
});

test('a fixed destination keeps absolute inputs while relative inputs depend on the actual start',()=>{
  const task=strategy.COORDINATE_SCENARIOS[0];
  const absolute=solutionFor(task,['absolute','absolute']),relative=solutionFor(task,['relative','relative']);
  assert.deepEqual(absolute[0].argument,absolute[1].argument);
  assert.deepEqual(relative.map(c=>c.argument),[{x:'50',y:'-100',z:'0'},{x:'70',y:'-130',z:'0'}]);
  assert.deepEqual(strategy.strategyPlan(task,relative).map(s=>s.from),task.steps.map(s=>s.start));
});

test('repeating a displacement accumulates; repeating an absolute location does not',()=>{
  const task=strategy.COORDINATE_SCENARIOS[1];
  const relative=solutionFor(task,['relative','relative']);assert.deepEqual(relative[0].argument,relative[1].argument);
  assert.deepEqual(strategy.strategyPlan(task,relative).map(s=>s.to),task.steps.map(s=>s.goal));
  const absolute=solutionFor(task,['absolute','absolute']);absolute[1].argument={...absolute[0].argument};
  const attempt=strategyObserved(task,strategySubmission(task,absolute));
  assert.deepEqual(attempt.results[0].to,attempt.results[1].to);
  assert.equal(strategy.completeStrategyAttempt(task,attempt),null);
  assert.equal(strategy.analyzeStrategyAttempt(task,attempt).rows[1].correct,false);
});

test('the next relative segment starts at the student endpoint, including mistakes',()=>{
  const task=strategy.COORDINATE_SCENARIOS[1],commands=solutionFor(task,['relative','relative']);
  commands[0].argument.x='45';const plan=strategy.strategyPlan(task,commands);
  assert.equal(plan[0].to.x,265);assert.equal(plan[1].from.x,265);assert.equal(plan[1].to.x,300);
  const report=strategy.analyzeStrategyAttempt(task,strategyObserved(task,strategySubmission(task,commands)));
  assert.equal(report.canComplete,false);assert.equal(report.rows[1].requiredArgument.x,25);
  const visual=strategy.strategyVisual(task,commands,[],'test');
  assert.equal(visual.points[1].from.x,265);assert.equal(visual.points[1].pose.x,300);
  assert.deepEqual(visual.trails,[]);
});

test('changing representation clears incompatible numbers and blank drafts never expose answers',()=>{
  const task=strategy.COORDINATE_SCENARIOS[2],draft=strategy.blankStrategyCommands(task);
  assert.equal(strategy.strategyPlan(task,draft),null);
  assert.deepEqual(strategy.strategyVisual(task,draft,[],'test').points.map(p=>p.id),['goal-0']);
  const before={mode:'absolute',argument:{x:'240',y:'-40',z:'10'}};
  assert.deepEqual(strategy.changeStrategyMode(before,'relative'),{mode:'relative',argument:{x:'',y:'',z:''}});
  assert.deepEqual(before.argument,{x:'240',y:'-40',z:'10'});
  for(const value of ['', ' ', 'Infinity', 'NaN', '1e999']){
    const commands=solutionFor(task,['absolute','relative','relative']);commands[0].argument.z=value;
    assert.equal(strategySubmission(task,commands),null);assert.deepEqual(strategy.strategyPreviewPlan(task,commands),[]);
  }
});

test('all executions and task-condition interpretation are required, but choice of representation is not graded',()=>{
  const task=strategy.COORDINATE_SCENARIOS[0],commands=solutionFor(task,['relative','absolute']);
  const first=strategySubmission(task,commands),finished=strategyObserved(task,first);
  for(const results of [[],finished.results.slice(0,1),[...finished.results,finished.results[0]],
    finished.results.map((r,i)=>i===1?{...r,from:{...r.from,x:999}}:r),
    finished.results.map((r,i)=>i===1?{...r,to:{...r.to,r:1}}:r)])assert.equal(strategy.completeStrategyAttempt(task,{...finished,results}),null);
  assert.equal(strategy.completeStrategyAttempt(task,{...finished,requirement:'displacement'}),null);
  assert.equal(strategy.completeStrategyAttempt(task,{...finished,taskId:'other'}),null);
  assert.equal(strategy.completeStrategyAttempt(task,{...finished,source:'hardware'}),null);
  assert.ok(strategy.completeStrategyAttempt(task,finished));
});

test('independent design records an ungraded reason, original choices, and every corrected submission',()=>{
  const task=strategy.COORDINATE_SCENARIOS[2],commands=solutionFor(task,['absolute','relative','absolute']);
  assert.equal(strategySubmission(task,commands,{explanation:' '}),null);
  const first=strategySubmission(task,commands,{explanation:'모르겠습니다.'});
  assert.equal(first.explanationReview,'teacher');
  commands[0].mode='relative';commands[0].argument.x='40';
  assert.equal(first.commands[0].mode,'absolute');assert.equal(first.commands[0].argument.x,'240');
  const finished=strategy.completeStrategyAttempt(task,strategyObserved(task,first));assert.ok(finished);
  assert.equal(finished.explanation,'모르겠습니다.','Recording prose is not claiming conceptual correctness');
  assert.equal(strategy.completeStrategyAttempt(task,{...finished,hints:1}),null);
  first.commands[1].argument.y='500';assert.equal(finished.commands[1].argument.y,'60');
});

test('all representations of each scenario use reachable existing MoveL paths without changing FK/IK',()=>{
  const source=ts.createSourceFile('App.tsx',read('App.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const declarations=source.statements.filter(s=>(ts.isFunctionDeclaration(s)&&['fkMG400','ikMG400'].includes(s.name?.text)) ||
    (ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>['ARM_L1','COORD_OX','COORD_OZ'].includes(d.name.getText(source)))))
    .map(s=>s.getText(source)).join('\n');
  const core=load(declarations+'\nexport {fkMG400,ikMG400,COORD_OX,COORD_OZ};');
  const model={
    fk(j){const p=core.fkMG400(j.j1,j.j2,j.j3);return{x:p.x+core.COORD_OX,y:p.y,z:p.z+core.COORD_OZ,r:j.j4};},
    ik(x,y,z,r,hint){const j=core.ikMG400(x-core.COORD_OX,y,z-core.COORD_OZ,hint);return j&&{...j,j4:r};},
  };
  for(const task of strategy.COORDINATE_SCENARIOS)for(const modes of allModes(task.steps.length)){
    for(const step of strategy.strategyPlan(task,solutionFor(task,modes))){
      const samples=curriculum.sampleLessonMotion(model,step.from,step.to,'MoveL',-113.32);
      assert.equal(samples?.length,121,`${task.id}: ${modes}`);
      for(const frame of samples){const actual=model.fk(frame.joints);
        assert.ok(Math.hypot(actual.x-frame.pose.x,actual.y-frame.pose.y,actual.z-frame.pose.z)<0.15);assert.equal(frame.pose.r,0);
      }
    }
  }
});

test('comparison-only reviews reuse both executed moves and preserve every original judgment',()=>{
  for(const task of tasks){
    const original=observed(task,submission(task,draftFor(task),{comparison:['transfer','literal'].includes(task.kind)?'same':'different'}));
    const before=structuredClone(original);
    assert.equal(c.canReviewCoordinateJudgment(task,original),true);
    const reviewed=c.reviewCoordinateJudgment(task,original,{comparison:before.comparison==='same'?'different':'same',rule:before.rule,explanation:'DT 결과의 두 도착점을 비교해 판단을 고쳤다.'});
    assert.equal(reviewed.completed,true,task.id);assert.deepEqual(reviewed.results,before.results);
    assert.equal(reviewed.id,before.id);assert.equal(reviewed.comparison,before.comparison);assert.deepEqual(reviewed.draft,before.draft);
    assert.deepEqual(original,before);assert.equal(reviewed.judgmentReviews[0].of,before.id);
    assert.equal(c.analyzeCoordinateAttempt(task,reviewed).comparisonCorrect,false,'Original misconception remains analyzable');
    assert.ok(c.completeCoordinateAttempt(task,reviewed));
  }
});

test('rule-only and combined reviews record failed reviews without creating or changing execution evidence',()=>{
  for(const task of [tasks[0],tasks[3]]){
    const original=observed(task,submission(task,draftFor(task),{rule:task.kind==='transfer'?'both-fixed':'reverse'}));
    original.solutionViews=['2026-09-12T00:00:00.000Z'];
    const wrong=c.reviewCoordinateJudgment(task,original,{comparison:original.comparison,rule:original.rule,explanation:''});
    assert.equal(wrong.completed,false);assert.equal(wrong.judgmentReviews.length,1);
    const good=c.reviewCoordinateJudgment(task,wrong,{comparison:original.comparison,rule:c.coordinateRule(task),explanation:''});
    assert.equal(good.completed,true);assert.equal(good.judgmentReviews.length,2);assert.equal(wrong.judgmentReviews.length,1);
    assert.deepEqual(good.results,original.results);assert.deepEqual(good.solutionViews,original.solutionViews);
    assert.equal(good.rule,original.rule);
    const both=observed(task,submission(task,draftFor(task),{comparison:original.comparison==='same'?'different':'same',rule:original.rule}));
    const partial=c.reviewCoordinateJudgment(task,both,{comparison:original.comparison,rule:original.rule,explanation:''});
    assert.equal(partial.completed,false);
  }
});

test('coordinate judgment reviews cannot bypass wrong numbers, partial motion, wrong sources or stale review links',()=>{
  const task=tasks[0],raw=draftFor(task);raw.delta.x='60';
  const badNumeric=observed(task,submission(task,raw,{rule:'reverse',comparison:'different'}));
  const good=observed(task,submission(task,draftFor(task),{rule:'reverse'}));
  for(const attempt of [badNumeric,{...good,results:{}},{...good,results:{absolute:good.results.absolute}},
    {...good,source:'hardware'},{...good,taskId:'stale'},
    {...good,results:{...good.results,relative:{...good.results.relative,to:{...good.results.relative.to,r:15}}}},
  ]){
    assert.equal(c.canReviewCoordinateJudgment(task,attempt),false);
    assert.equal(c.reviewCoordinateJudgment(task,attempt,{comparison:'same',rule:'subtract',explanation:''}),null);
  }
  const reviewed=c.reviewCoordinateJudgment(task,good,{comparison:'same',rule:'subtract',explanation:''});
  reviewed.judgmentReviews[0].of='older-attempt';assert.equal(c.completeCoordinateAttempt(task,reviewed),null);
});

test('independent judgment review requires its own reason and retains the original ungraded explanation',()=>{
  const task=tasks[4],original=observed(task,submission(task,draftFor(task),{comparison:'same',explanation:'처음 생각'}));
  assert.equal(c.reviewCoordinateJudgment(task,original,{comparison:'different',rule:'',explanation:' '}),null);
  assert.equal(c.canReviewCoordinateJudgment(task,{...original,hints:1}),false);
  assert.equal(c.canReviewCoordinateJudgment(task,{...original,explanation:''}),false);
  const reviewed=c.reviewCoordinateJudgment(task,original,{comparison:'different',rule:'',explanation:'수정 생각'});
  assert.equal(reviewed.explanation,'처음 생각');assert.equal(reviewed.judgmentReviews[0].explanation,'수정 생각');
});

test('every strategy accepts a condition-only review while keeping all command and prediction snapshots',()=>{
  for(const task of strategy.COORDINATE_SCENARIOS){
    const commands=solutionFor(task,task.steps.map((_,i)=>i%2?'relative':'absolute'));
    const original=strategyObserved(task,strategySubmission(task,commands,{requirement:task.requirement==='location'?'mixed':'location'}));
    const before=structuredClone(original);
    assert.equal(strategy.canReviewStrategyJudgment(task,original),true);
    const wrong=strategy.reviewStrategyJudgment(task,original,{requirement:original.requirement,explanation:'조건 재검토'});
    assert.equal(wrong.completed,false);
    const reviewed=strategy.reviewStrategyJudgment(task,wrong,{requirement:task.requirement,explanation:'위치와 간격을 구간별로 구분했다.'});
    assert.equal(reviewed.completed,true);assert.equal(reviewed.judgmentReviews.length,2);
    assert.equal(reviewed.id,original.id);assert.equal(reviewed.requirement,original.requirement);
    assert.deepEqual(reviewed.commands,original.commands);assert.deepEqual(reviewed.predictions,original.predictions);
    assert.deepEqual(reviewed.results,original.results);assert.deepEqual(original,before);
    assert.equal(strategy.analyzeStrategyAttempt(task,reviewed).requirementsCorrect,false);
  }
});

test('strategy reviews cannot bypass wrong paths, wrong independent predictions, interrupted motion or missing reasons',()=>{
  const task=strategy.COORDINATE_SCENARIOS[2],commands=solutionFor(task,['absolute','relative','relative']);
  const good=strategyObserved(task,strategySubmission(task,commands,{requirement:'location'}));
  const incorrect=structuredClone(commands);incorrect[1].argument.x='45';
  const wrongCommand=strategyObserved(task,strategySubmission(task,incorrect,{requirement:'location'}));
  const prediction=structuredClone(good.predictions);prediction[0].x='241';
  for(const attempt of [wrongCommand,{...good,predictions:prediction},{...good,results:good.results.slice(0,2)},
    {...good,taskId:'other'},{...good,source:'hardware'},{...good,explanation:''},{...good,hints:1}]){
    assert.equal(strategy.canReviewStrategyJudgment(task,attempt),false);
    assert.equal(strategy.reviewStrategyJudgment(task,attempt,{requirement:'mixed',explanation:'다시 비교했다.'}),null);
  }
  assert.equal(strategy.reviewStrategyJudgment(task,good,{requirement:'mixed',explanation:' '}),null);
  const reviewed=strategy.reviewStrategyJudgment(task,good,{requirement:'mixed',explanation:'다시 비교했다.'});
  reviewed.judgmentReviews[0].of='older-attempt';assert.equal(strategy.completeStrategyAttempt(task,reviewed),null);
});
