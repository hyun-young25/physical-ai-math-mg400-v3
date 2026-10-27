// NODE_PATH=<installed dependencies> node --test src/axisPresentation.test.cjs
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),THREE=require('three');
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
function load(source,deps={}){
  const exports={},code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  new Function('exports','require',code)(exports,n=>{assert.ok(n in deps,`Unexpected ${n}`);return deps[n];});return exports;
}
const c=load(read('curriculum.ts')),axes=load(read('axisLesson.ts'),{'./curriculum':c});
const r=load(read('axisReasoning.ts'),{'./curriculum':c,'./axisLesson':axes});
const projection=load(read('axisSceneProjection.ts'));
const app=ts.createSourceFile('App.tsx',read('App.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const declarations=app.statements.filter(s=>(ts.isFunctionDeclaration(s)&&['fkMG400','ikMG400'].includes(s.name?.text))||
  (ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>['ARM_L1','COORD_OX','COORD_OZ'].includes(d.name.getText(app))))).map(s=>s.getText(app)).join('\n');
const core=load(declarations+'\nexport {fkMG400,ikMG400,COORD_OX,COORD_OZ};');
const model={fk(j){const p=core.fkMG400(j.j1,j.j2,j.j3);return {x:p.x+core.COORD_OX,y:p.y,z:p.z+core.COORD_OZ,r:j.j4};},
  ik(x,y,z,r,hint){const j=core.ikMG400(x-core.COORD_OX,y,z-core.COORD_OZ,hint);return j&&{...j,j4:r};}};
const home={x:350,y:0,z:0,r:25},task=axes.AXIS_LESSON_TASKS[1];
function attempt(task,delta,relation,command=null){return r.makeAxisNumericAttempt(task,home,{draft:Object.fromEntries(Object.entries(delta).map(([a,v])=>[a,String(v)])),relation,command,explanation:'조건 비교',view:'free',hints:0,supportIds:[]});}

// Build an independent Three.js matrix chain from the actual JSX and frame
// rotation assignments. This catches projection drift if the CAD chain changes.
const robot=ts.createSourceFile('Robot3D.tsx',read('Robot3D.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const urdf=robot.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='URDFRobot');
const defaultTool=urdf.parameters[0].name.elements.find(e=>e.name.getText(robot)==='endEffector').initializer.getText(robot);
const rotations=new Map();let chain;
const attr=(n,name)=>n.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.text===name)?.initializer?.expression;
function inspect(n,parents=[]){
  if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.EqualsToken){
    const match=n.left.getText(robot).match(/^(j\w+Ref)\.current\.rotation\.([xyz])$/);
    if(match)rotations.set(match[1],{axis:match[2],value:n.right.getText(robot)});
  }
  const opening=ts.isJsxElement(n)?n.openingElement:ts.isJsxSelfClosingElement(n)?n:null;
  const next=opening&&['group','mesh'].includes(opening.tagName.getText(robot))?[...parents,opening]:parents;
  if(opening&&attr(opening,'ref')?.getText(robot)==='endEffTrackerRef') chain=next;
  ts.forEachChild(n,child=>inspect(child,next));
}
inspect(urdf);
function renderedTcp(joints){
  assert.ok(chain?.length>=8);
  // Evaluate the real CAD chain using its own default tool, including the
  // conditional tracker offset. Do not discard that offset or relax tolerance.
  const evaluate=code=>new Function('a1','a2','a3','a4','dd','PI2',`const endEffector=${defaultTool};return (${code})`)(joints.j1,joints.j2,joints.j3,joints.j4,Math.PI/180,Math.PI/2);
  const root=new THREE.Group();let parent=root;
  for(const node of chain){
    const object=new THREE.Group();
    for(const name of ['position','rotation','scale']){
      const expression=attr(node,name);if(!expression)continue;
      const value=evaluate(expression.getText(robot));
      if(name==='scale'&&typeof value==='number')object.scale.setScalar(value);else object[name].set(...value);
    }
    const rotation=rotations.get(attr(node,'ref')?.getText(robot));
    if(rotation)object.rotation[rotation.axis]=evaluate(rotation.value);
    parent.add(object);parent=object;
  }
  return parent.getWorldPosition(new THREE.Vector3()).toArray();
}
const close=(a,b,tol=1e-8)=>assert.ok(Math.hypot(...a.map((v,i)=>v-b[i]))<tol,`${a} vs ${b}`);

test('projected TCP matches the existing rendered joint chain across J1/J2/J3 and J4',()=>{
  for(const j1 of [-120,-10,0,70])for(const [j2,j3] of [[69.02,-113.32],[20,-60],[30,25]])for(const j4 of [-180,0,90]){
    const joints={j1,j2,j3,j4};close(projection.axisSceneTcp(joints),renderedTcp(joints));
  }
});
test('Y−40 video case and all signed axes stay anchored to the real TCP, including replay',()=>{
  const from={...home,x:375.02},scenePoint=projection.createAxisSceneProjection(model,-113.32);
  const origin=scenePoint(from),anchor=renderedTcp(model.ik(from.x,from.y,from.z,from.r,-113.32));
  for(const axis of c.POSE_AXES)for(const sign of [-1,1]){
    const to=c.translatePose(from,{x:0,y:0,z:0,[axis]:sign*40});
    const frames=c.sampleLessonMotion(model,from,to,'MoveL',-113.32);assert.ok(frames);
    for(const frame of frames){
      const offset=scenePoint(frame.pose).map((v,i)=>v-origin[i]);
      close(anchor.map((v,i)=>v+offset[i]),renderedTcp(frame.joints));
    }
    const visual={key:'same-start',numeric:true,started:true,task,from,predictedEnd:to,result:{from,to},scenePoint};
    const points=r.axisDisplayPoints(visual);assert.deepEqual(points.map(p=>p.id),['a','d']);
    close(anchor.map((v,i)=>v+points[1].position[i]),renderedTcp(frames.at(-1).joints));
    assert.deepEqual(r.axisDisplayPoints({...visual,result:null}),[]);
    assert.deepEqual(r.axisDisplayPoints({...visual,started:false,result:null})[0].position,[0,0,0]);
  }
  const to={...from,y:-40},oldOffset=r.axisPointOffset(from,to);
  assert.ok(Math.hypot(...scenePoint(to).map((v,i)=>v-origin[i]-oldOffset[i]))>15,'reproduces the old translated-marker mismatch');
});
test('matching numeric answers cannot hide an incorrect relation or reverse command',()=>{
  const a=attempt(task,{x:0,y:-40,z:0},'opposite-half');
  assert.deepEqual(r.axisComparisonStatus(task,a),{prediction:true,target:true,relation:false});
  assert.deepEqual(r.diagnoseAxisNumeric(task,a),['relation']);
  const reverse=axes.AXIS_LESSON_TASKS[5],b=attempt(reverse,{x:30,y:0,z:0},'parallel',{axis:'x',sign:1,distance:30});
  assert.deepEqual(r.axisComparisonStatus(reverse,b),{prediction:true,target:false,relation:true});
  assert.deepEqual(r.axisComparisonStatus(task,attempt(task,{x:0,y:40,z:0},'same-half')),{prediction:false,target:true,relation:true});
});
test('merged labels preserve separate evidence and independent prediction visibility',()=>{
  const to={...home,y:-40},visual={key:'v',task,numeric:true,started:false,from:home,predictedEnd:to,result:null,independent:true};
  assert.deepEqual(r.axisDisplayPoints(visual).map(p=>p.id),['a']);
  const done={...visual,started:true,result:{from:home,to}};
  assert.deepEqual(r.axisDisplayPoints(done).map(p=>p.id),['a','d']);
  assert.match(r.axisDisplayPoints(done)[1].label,/P = D/);
  assert.deepEqual(r.axisComparisonPoints(done).map(p=>p.id),['a','p','d']);
  const wrong={...done,predictedEnd:{...to,y:-39}};
  assert.deepEqual(r.axisDisplayPoints(wrong).map(p=>p.id),['a','p','d']);
});
test('unreachable predictions stay unmodified in evidence and are not placed at a fake endpoint',()=>{
  const scenePoint=projection.createAxisSceneProjection(model,-113.32),predictedEnd={...home,x:4000};
  assert.equal(scenePoint(predictedEnd),null);
  const visual={key:'v',task,numeric:true,started:false,from:home,predictedEnd,result:null,scenePoint};
  assert.deepEqual(r.axisDisplayPoints(visual).map(p=>p.id),['a']);assert.equal(visual.predictedEnd.x,4000);
  assert.equal(scenePoint({...home,x:NaN}),null);
});
test('condition summaries retain the changed and fixed quantities for all seven tasks',()=>{
  assert.equal(axes.AXIS_LESSON_TASKS.map(r.axisConditionSummary).length,7);
  assert.match(r.axisConditionSummary(task),/거리만 절반.*−Y 방향 유지/);
  assert.match(r.axisConditionSummary(axes.AXIS_LESSON_TASKS[6]),/방향은 반대.*거리는 절반.*Y축 유지/);
});
test('the relation question compares the reference with observed movement, not prediction or absolute position',()=>{
  const trial=attempt(task,{x:0,y:10,z:0},'opposite-half');
  const initial=r.axisRelationContext(task);
  assert.equal(initial.rows[0].value,'−Y 방향으로 80 mm');
  assert.equal(initial.rows[1].label,'이번 이동 조건');
  assert.doesNotMatch(initial.rows[1].value,/40/);
  assert.deepEqual(r.axisRelationContext(task,trial),initial,'a planned or interrupted move is not an observed result');
  const completed={...trial,from:{...trial.from,y:90},to:{...trial.to,y:50},numeric:{...trial.numeric,executedAt:'2026-09-12T12:00:00Z'}};
  const original=structuredClone(completed),shown=r.axisRelationContext(task,completed);
  assert.equal(shown.rows[0].value,'−Y 방향으로 80 mm');
  assert.equal(shown.rows[1].value,'−Y 방향으로 40 mm');
  assert.match(shown.question,/기존 이동.*이번 이동의 방향과 거리/);
  assert.match(shown.feedback,/80 mm.*40 mm/);
  assert.deepEqual(completed,original);
  assert.deepEqual(r.axisRelationContext(axes.AXIS_LESSON_TASKS[2],completed),r.axisRelationContext(axes.AXIS_LESSON_TASKS[2]),'another task cannot supply the comparison');
});
test('comparison prompts respect axis changes, reverse-command targets, and independent prediction before execution',()=>{
  for(const t of axes.AXIS_LESSON_TASKS){
    const condition=r.axisCondition(t),goal=condition.goal;
    const delta={x:0,y:0,z:0,[goal.axis]:goal.sign*goal.distance};
    const trial=attempt(t,delta,condition.relation,t.reverse?goal:null);
    assert.ok(trial);
    const observed={...trial,numeric:{...trial.numeric,executedAt:'2026-09-12T12:00:00Z'}};
    const context=r.axisRelationContext(t,observed);
    assert.equal(context.rows[1].value,`${goal.sign>0?'+':'−'}${goal.axis.toUpperCase()} 방향으로 ${goal.distance} mm`);
    assert.equal(context.rows[1].label,'이번 이동 (DT)');
  }
  const independent=axes.AXIS_LESSON_TASKS[6],before=r.axisRelationContext(independent);
  assert.equal(before.rows[0].value,'+Y 방향으로 50 mm');assert.doesNotMatch(before.rows[1].value,/25/);
  assert.match(r.axisRelationContext(axes.AXIS_LESSON_TASKS[4]).question,/축과 거리/);
  const reverse=axes.AXIS_LESSON_TASKS[5],wrong=attempt(reverse,{x:30,y:0,z:0},'parallel',{axis:'x',sign:1,distance:30});
  const shown=r.axisRelationContext(reverse,{...wrong,numeric:{...wrong.numeric,executedAt:'2026-09-12T12:00:00Z'}});
  assert.equal(shown.rows[0].label,'목표');assert.match(shown.rows[0].value,/Z만 30 mm 감소/);
  assert.equal(shown.rows[1].value,'+X 방향으로 30 mm');assert.match(shown.question,/Z만 바꾸고 X·Y를 유지/);
  assert.doesNotMatch(shown.question,/기존 이동/);
});

test('2-2 predicted and observed endpoints stay on the CAD tip across both coordinate methods and reload origins',()=>{
  const coordinates=load(read('coordinateLearning.ts'),{'./curriculum':c});
  const labels=load(read('coordinateLabelLayout.ts'),{'./coordinateLearning':coordinates});
  const scenePoint=projection.createAxisSceneProjection(model,-113.32);
  for(const task of coordinates.COORDINATE_TASKS) {
    const from=coordinates.coordinateStart(task),expected=coordinates.coordinateExpected(task);
    for(const field of ['absolute','relative']) {
      const to={...expected[field],r:0};
      const visual={key:'comparison',from,fromLabel:'A',scenePoint,
        points:[{id:'predicted',label:'내 예상',pose:to,color:'#6366f1',kind:'prediction'}],
        results:{absolute:{from,to},relative:{from,to}}};
      const endpoint=coordinates.coordinateSceneOffset(visual,to);
      for(const current of [from,home,to]) {
        const currentTip=renderedTcp(model.ik(current.x,current.y,current.z,0,-113.32));
        const currentOffset=coordinates.coordinateSceneOffset(visual,current);
        const anchor=currentTip.map((v,i)=>v-currentOffset[i]);
        close(anchor.map((v,i)=>v+endpoint[i]),renderedTcp(model.ik(to.x,to.y,to.z,0,-113.32)));
      }
      const combined=labels.coordinateLabels(visual).find(label=>label.endpoint);
      close(combined.position,endpoint);
      assert.equal(labels.tcpSharesEndpoint([combined],endpoint),true);
      assert.deepEqual(visual.results.absolute.to,to,'display projection never modifies numerical evidence');
    }
  }
});

test('an unreachable prediction is retained in the answer but cannot create a fabricated CAD endpoint',()=>{
  const coordinates=load(read('coordinateLearning.ts'),{'./curriculum':c});
  const labels=load(read('coordinateLabelLayout.ts'),{'./coordinateLearning':coordinates});
  const point={id:'outside',label:'내 예상',pose:{x:10000,y:0,z:0,r:0},color:'#6366f1',kind:'prediction'};
  const visual={key:'outside',from:home,fromLabel:'A',scenePoint:projection.createAxisSceneProjection(model,-113.32),points:[point],results:{}};
  assert.equal(coordinates.coordinateSceneOffset(visual,point.pose),null);
  assert.equal(labels.coordinateLabels(visual).some(label=>label.id==='point-outside'),false);
  assert.equal(visual.points[0].pose.x,10000);
});
