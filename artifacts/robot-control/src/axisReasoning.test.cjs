// node --test src/axisReasoning.test.cjs
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
function load(source,deps={}){
  const exports={},code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  new Function('exports','require',code)(exports,n=>{assert.ok(n in deps,`Unexpected ${n}`);return deps[n];});return exports;
}
const c=load(read('curriculum.ts')),axes=load(read('axisLesson.ts'),{'./curriculum':c});
const r=load(read('axisReasoning.ts'),{'./curriculum':c,'./axisLesson':axes});
const coordinates=load(read('coordinateLearning.ts'),{'./curriculum':c});
const strategy=load(read('coordinateStrategies.ts'),{'./curriculum':c,'./coordinateLearning':coordinates});
const support=load(read('learningSupport.ts'),{'./curriculum':c,'./axisLesson':axes,'./axisReasoning':r,'./coordinateLearning':coordinates,'./coordinateStrategies':strategy});
const tasks=axes.AXIS_LESSON_TASKS,home={x:350,y:0,z:0,r:0},raw=v=>Object.fromEntries(c.POSE_AXES.map(a=>[a,String(v[a])]));
const expected=[{x:25,y:0,z:0},{x:0,y:-40,z:0},{x:0,y:0,z:30},{x:-50,y:0,z:0},{x:0,y:40,z:0},{x:0,y:0,z:-30},{x:0,y:-25,z:0}];
function attempt(i,overrides={},from=home){
  const task=tasks[i],condition=r.axisCondition(task);
  return r.makeAxisNumericAttempt(task,from,{draft:raw(expected[i]),relation:condition.relation,explanation:'기준축은 유지하고 방향과 거리 조건을 적용했다.',
    command:task.reverse?{axis:'z',sign:-1,distance:30}:null,view:'free',hints:0,supportIds:[],...overrides});
}
const executed=a=>({...a,numeric:{...a.numeric,executedAt:new Date().toISOString()}});

test('seven existing IDs and fading support cover half/double, opposite sign, axis change and independent combination',()=>{
  assert.deepEqual(tasks.map(t=>t.id),['x-plus','y-minus','z-plus','x-minus','y-plus','z-minus','independent-y-minus']);
  assert.deepEqual(tasks.map(axes.axisLearningMode),['guided','practice','practice','practice','practice','practice','independent']);
  assert.deepEqual(tasks.map(t=>r.axisCondition(t).relation),['same-half','same-half','same-double','opposite-same','axis-only','parallel','opposite-half']);
  for(const [i,task] of tasks.entries()){
    const a=attempt(i);assert.deepEqual(c.poseDifference(home,a.to),expected[i]);
    assert.deepEqual(r.diagnoseAxisNumeric(task,a),[]);
  }
});
test('zero and signed decimals are valid; a partial or nonfinite prediction cannot be submitted',()=>{
  assert.deepEqual(r.readAxisDelta({x:'0',y:'-12.5',z:'0'}),{x:0,y:-12.5,z:0});
  for(const value of ['', ' ', '-', 'NaN','Infinity','1e999']){
    assert.equal(attempt(0,{draft:{x:'25',y:value,z:'0'}}),null);
    assert.equal(r.axisNumericEndpoint(home,r.readAxisDelta({x:'25',y:value,z:'0'})),null);
  }
  assert.equal(attempt(0,{relation:''}),null);assert.equal(attempt(0,{relation:'unknown'}),null);
});
test('independent submission requires a reason; preview and completion do not depend on camera orientation',()=>{
  assert.equal(attempt(6,{explanation:' '}),null);
  for(const view of ['free','front','side','top']){
    const a=executed(attempt(6,{view})),record=r.completeAxisNumeric(tasks[6],[a]);
    assert.ok(record);assert.equal(record.attempts[0].view,view);assert.equal(record.explanationReview,'teacher');
  }
  assert.equal(r.completeAxisNumeric(tasks[6],[executed(attempt(6,{hints:1}))]),null);
});
test('reverse reasoning needs a valid learner command including its distance',()=>{
  for(const command of [null,{axis:'z',sign:-1},{axis:'z',sign:-1,distance:0},{axis:'z',sign:-1,distance:-30},{axis:'z',sign:-1,distance:Infinity}])
    assert.equal(attempt(5,{command}),null);
  for(const axis of c.POSE_AXES)for(const sign of [-1,1]){
    const a=attempt(5,{command:{axis,sign,distance:20}});
    assert.equal(a.to[axis]-home[axis],sign*20);
    for(const fixed of c.POSE_AXES.filter(a=>a!==axis))assert.equal(a.to[fixed],home[fixed]);
  }
});
test('P is entirely student-driven, blanks never reveal a goal, and D exists only after execution',()=>{
  const base={key:'v',task:r.axisCondition(tasks[0]).goal,from:home,numeric:true,started:false,prediction:{x:null,y:null,z:null},result:null};
  assert.deepEqual(r.axisComparisonPoints(base).map(p=>p.id),['a']);
  const wrong=r.axisNumericEndpoint(home,{x:70,y:-20,z:15});
  const points=r.axisComparisonPoints({...base,predictedEnd:wrong});
  assert.deepEqual(points.map(p=>p.id),['a','p']);assert.deepEqual(points[1].position,[70,15,20]);
  assert.deepEqual(r.axisComparisonPoints({...base,predictedEnd:wrong,independent:true}).map(p=>p.id),['a']);
  assert.deepEqual(r.axisComparisonPoints({...base,predictedEnd:wrong,independent:true,started:true}).map(p=>p.id),['a','p']);
  const result={from:home,to:{...home,x:375}},done=r.axisComparisonPoints({...base,predictedEnd:wrong,result});
  assert.deepEqual(done.map(p=>p.id),['a','p','d']);assert.deepEqual(done[2].position,[25,0,-0]);
  assert.notDeepEqual(done[1].position,done[2].position);
});
test('axis, sign, magnitude and condition reasoning are diagnosed separately or together',()=>{
  const issues=(delta,relation)=>r.diagnoseAxisNumeric(tasks[0],attempt(0,{draft:raw(delta),...(relation?{relation}:{})}));
  assert.deepEqual(issues({x:0,y:25,z:0}),['axis']);
  assert.deepEqual(issues({x:-25,y:0,z:0}),['sign']);
  assert.deepEqual(issues({x:50,y:0,z:0}),['distance']);
  assert.deepEqual(issues(expected[0],'position-half'),['relation']);
  assert.deepEqual(new Set(issues({x:-50,y:1,z:0},'position-half')),new Set(['axis','sign','distance','relation']));
  assert.equal(r.axisDiagnosisMatches(['sign','distance'],['sign']),false);
  assert.equal(r.axisDiagnosisMatches(['sign'],['sign','axis']),false);
  assert.equal(r.axisDiagnosisMatches(['sign','distance'],['distance','sign']),true);
});
test('a correct prediction of an incorrect reverse command still fails the target condition',()=>{
  for(const [command,delta,error] of [
    [{axis:'x',sign:1,distance:30},{x:30,y:0,z:0},'axis'],
    [{axis:'z',sign:1,distance:30},{x:0,y:0,z:30},'sign'],
    [{axis:'z',sign:-1,distance:15},{x:0,y:0,z:-15},'distance'],
  ]){
    const a=executed(attempt(5,{command,draft:raw(delta)}));
    assert.deepEqual(r.diagnoseAxisNumeric(tasks[5],a),[error]);assert.equal(r.completeAxisNumeric(tasks[5],[a]),null);
  }
});
test('planned and interrupted moves cannot complete; full executed endpoints and R are checked',()=>{
  const a=attempt(0);assert.equal(r.completeAxisNumeric(tasks[0],[a]),null);
  for(const patch of [{x:360},{x:NaN},{r:20}]){
    const partial=executed({...a,to:{...a.to,...patch}});assert.equal(r.completeAxisNumeric(tasks[0],[partial]),null);
  }
  assert.ok(r.completeAxisNumeric(tasks[0],[executed(a)]));
});
test('a correction must identify the previous error then rerun, preserving the original misconception',()=>{
  const first=executed(attempt(0,{draft:raw({x:50,y:0,z:0})})),correct=executed(attempt(0));
  assert.equal(r.completeAxisNumeric(tasks[0],[first,correct]),null);
  const revision={of:first.id,kinds:['distance'],explanation:'축과 부호를 유지하고 이동 거리만 절반으로 고친다.'};
  const second=executed(attempt(0,{revision,supportIds:['support-1']}));
  const record=r.completeAxisNumeric(tasks[0],[first,second]);assert.ok(record);assert.equal(record.independentResult,'revised');
  first.numeric.delta.x=25;revision.kinds.push('axis');second.supportIds.push('changed');
  assert.equal(record.attempts[0].numeric.delta.x,50);assert.deepEqual(record.attempts[1].numeric.revision.kinds,['distance']);
  assert.deepEqual(record.attempts[1].supportIds,['support-1']);assert.equal(record.numericVersion,1);
  assert.deepEqual(JSON.parse(JSON.stringify(record)),record);
});
test('every repeated mistake needs its own diagnosis; unrelated task evidence cannot complete this condition',()=>{
  const first=executed(attempt(0,{draft:raw({x:50,y:0,z:0})}));
  const second=executed(attempt(0,{draft:raw({x:-25,y:0,z:0}),revision:{of:first.id,kinds:['distance'],explanation:''}}));
  const stale=executed(attempt(0,{revision:{of:first.id,kinds:['distance'],explanation:''}}));
  assert.equal(r.completeAxisNumeric(tasks[0],[first,second,stale]),null);
  const third=executed(attempt(0,{revision:{of:second.id,kinds:['sign'],explanation:''}}));
  assert.ok(r.completeAxisNumeric(tasks[0],[first,second,third]));
  assert.equal(r.completeAxisNumeric(tasks[1],[third]),null);
});
test('independent correction requires a written revision without auto-grading its semantics',()=>{
  const first=executed(attempt(6,{draft:raw({x:0,y:25,z:0})}));
  const revision={of:first.id,kinds:['sign'],explanation:''};
  assert.equal(r.completeAxisNumeric(tasks[6],[first,executed(attempt(6,{revision}))]),null);
  revision.explanation='모르겠습니다.';
  const record=r.completeAxisNumeric(tasks[6],[first,executed(attempt(6,{revision}))]);assert.ok(record);
  assert.equal(record.explanationReview,'teacher');assert.equal(record.attempts[0].numeric.delta.y,25);
});
const review=(a,task,overrides={})=>({of:a.id,submittedAt:new Date().toISOString(),relation:r.axisCondition(task).relation,
  explanation:'좌표의 부호와 변화량의 크기를 나누어 설명을 고쳤다.',...overrides});
test('all seven relation-only errors can complete from one execution while preserving the original answer',()=>{
  for(const [i,task] of tasks.entries()){
    const wrong=r.axisCondition(task).options.find(o=>o.value!==r.axisCondition(task).relation).value;
    const first=executed(attempt(i,{relation:wrong})),before=structuredClone(first),correction=review(first,task);
    assert.equal(r.canReviewAxisRelation(task,first),true);
    assert.equal(r.completeAxisNumeric(task,[first]),null);
    const record=r.completeAxisNumeric(task,[first],correction);assert.ok(record,task.id);
    assert.deepEqual(first,before);assert.deepEqual(record.attempts,[before]);
    assert.equal(record.attempts.length,1);assert.equal(record.reasonAttempts,2);
    assert.equal(record.independentResult,'revised');assert.deepEqual(record.relationReview,correction);
    assert.equal(record.relationReview.executedAt,undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(record)),record);
    first.numeric.relation=correction.relation;correction.explanation='changed';
    assert.equal(record.attempts[0].numeric.relation,wrong);
    assert.notEqual(record.relationReview.explanation,'changed');
  }
});
test('relation review never bypasses numeric errors or a correctly predicted wrong movement command',()=>{
  for(const delta of [{x:0,y:25,z:0},{x:-25,y:0,z:0},{x:50,y:0,z:0}]){
    const a=executed(attempt(0,{draft:raw(delta),relation:'position-half'}));
    assert.equal(r.canReviewAxisRelation(tasks[0],a),false);
    assert.equal(r.completeAxisNumeric(tasks[0],[a],review(a,tasks[0])),null);
  }
  for(const [command,delta] of [
    [{axis:'x',sign:1,distance:30},{x:30,y:0,z:0}],
    [{axis:'z',sign:1,distance:30},{x:0,y:0,z:30}],
    [{axis:'z',sign:-1,distance:15},{x:0,y:0,z:-15}],
  ]){
    const a=executed(attempt(5,{command,draft:raw(delta),relation:'camera'}));
    assert.equal(r.axisComparisonStatus(tasks[5],a).prediction,true);
    assert.equal(r.canReviewAxisRelation(tasks[5],a),false);
    assert.equal(r.completeAxisNumeric(tasks[5],[a],review(a,tasks[5])),null);
  }
});
test('relation review must correct the latest completed execution, never a stopped move or stale answer',()=>{
  const task=tasks[1],a=executed(attempt(1,{relation:'opposite-half'}));
  for(const patch of [{relation:''},{relation:'unknown'},{relation:'opposite-half'},{of:'old-id'},{submittedAt:''}])
    assert.equal(r.completeAxisNumeric(task,[a],review(a,task,patch)),null);
  for(const invalid of [
    attempt(1,{relation:'opposite-half'}),
    {...a,id:undefined}, {...a,submittedAt:undefined},
    {...a,to:{...a.to,r:a.to.r+10}}, {...a,to:{...a.to,y:a.to.y+10}},
    {...a,numeric:{...a.numeric,delta:{x:NaN,y:-40,z:0}}},
  ])assert.equal(r.completeAxisNumeric(task,[invalid],review(invalid,task)),null);
  const correct=executed(attempt(1));
  assert.ok(r.completeAxisNumeric(task,[correct]));
  assert.equal(r.canReviewAxisRelation(task,correct),false);
  assert.equal(r.completeAxisNumeric(task,[correct],review(correct,task)),null);
});
test('a relation review after a numeric correction still requires the earlier diagnosis and rerun',()=>{
  const task=tasks[0],first=executed(attempt(0,{draft:raw({x:50,y:0,z:0})}));
  const missing=executed(attempt(0,{relation:'position-half'}));
  assert.equal(r.completeAxisNumeric(task,[first,missing],review(missing,task)),null);
  const second=executed(attempt(0,{relation:'position-half',revision:{of:first.id,kinds:['distance'],explanation:'거리만 절반'}}));
  const record=r.completeAxisNumeric(task,[first,second],review(second,task));assert.ok(record);
  assert.equal(record.attempts.length,2);assert.equal(record.reasonAttempts,3);
  assert.equal(record.attempts[0].numeric.delta.x,50);assert.equal(record.attempts[1].numeric.relation,'position-half');
  assert.equal(record.relationReview.of,second.id);assert.equal(record.independentResult,'revised');
});
test('independent relation review keeps original and revised reasons and does not waive independent evidence',()=>{
  const task=tasks[6],first=executed(attempt(6,{relation:'same-half'}));
  assert.equal(r.completeAxisNumeric(task,[first],review(first,task,{explanation:' '})),null);
  for(const invalid of [{...first,reasoning:''},{...first,numeric:{...first.numeric,hints:1}}])
    assert.equal(r.completeAxisNumeric(task,[invalid],review(invalid,task)),null);
  const record=r.completeAxisNumeric(task,[first],review(first,task,{explanation:'모르겠습니다.'}));assert.ok(record);
  assert.equal(record.attempts[0].reasoning,first.reasoning);
  assert.equal(record.relationReview.explanation,'모르겠습니다.');
  assert.equal(record.explanationReview,'teacher');
});
test('repeated magnitude errors trigger optional support with fresh signed-distance conditions',()=>{
  const a=executed(attempt(0,{draft:raw({x:50,y:0,z:0})})),b=executed(attempt(0,{draft:raw({x:100,y:0,z:0})}));
  const events=[a,b].map((a,i)=>support.axisErrorEvent(tasks[0],a,i));
  assert.deepEqual(events.map(e=>e.errors),[['distance'],['distance']]);
  assert.equal(support.supportTrigger([events[0]],[]),null);
  const trigger=support.supportTrigger(events,[]);assert.equal(trigger.error,'distance');
  const opened=support.openSupport('2-1',tasks[0].id,trigger);
  const practice=support.supportProblem('distance','practice',0,'2-1');
  assert.doesNotMatch(practice.prompt,/절대|상대|명령 X=/);
  const practiced=support.submitSupport(opened,practice.expected),check=support.startSupportCheck(practiced);
  const next=support.supportProblem('distance','check',0,'2-1');assert.notEqual(next.prompt,practice.prompt);
  assert.equal(support.submitSupport(check,next.expected).status,'complete');
  assert.equal(support.supportTrigger(events,[opened]),null);
  assert.equal(support.axisErrorEvent(tasks[0],attempt(0,{relation:'position-half'}),0).errors[0],'condition');
  assert.match(support.supportProblem('condition','practice',0,'2-1').prompt,/거리만/);
  assert.match(support.supportProblem('condition','practice',0,'2-2').prompt,/작업대/);
});
test('all seven changed-condition paths work sequentially and after HOME using the real FK/IK',()=>{
  const parsed=ts.createSourceFile('App.tsx',read('App.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const declarations=parsed.statements.filter(s=>(ts.isFunctionDeclaration(s)&&['fkMG400','ikMG400'].includes(s.name?.text))||
    (ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>['ARM_L1','COORD_OX','COORD_OZ'].includes(d.name.getText(parsed))))).map(s=>s.getText(parsed)).join('\n');
  const core=load(declarations+'\nexport {fkMG400,ikMG400,COORD_OX,COORD_OZ};');
  const model={fk(j){const p=core.fkMG400(j.j1,j.j2,j.j3);return {x:p.x+core.COORD_OX,y:p.y,z:p.z+core.COORD_OZ,r:j.j4};},
    ik(x,y,z,r,hint){const j=core.ikMG400(x-core.COORD_OX,y,z-core.COORD_OZ,hint);return j&&{...j,j4:r};}};
  let end={...home};
  for(const [i,task] of tasks.entries()){
    for(const from of [end,home]){
      const a=attempt(i,{},from),frames=c.sampleLessonMotion(model,from,a.to,'MoveL',-113.32);
      assert.ok(frames,task.id);assert.equal(frames.length,121);
      for(const frame of frames){const fk=model.fk(frame.joints);assert.ok(Math.hypot(fk.x-frame.pose.x,fk.y-frame.pose.y,fk.z-frame.pose.z)<0.15);assert.equal(frame.pose.r,from.r);}
      assert.deepEqual(c.poseDifference(frames[0].pose,frames.at(-1).pose),expected[i]);
    }
    end=attempt(i,{},end).to;
  }
  assert.deepEqual(end,{x:325,y:-25,z:0,r:0});
  const impossible=attempt(5,{command:{axis:'x',sign:1,distance:3000}});
  assert.equal(c.sampleLessonMotion(model,home,impossible.to,'MoveL',-113.32),null);
});
