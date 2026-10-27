const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function load(file,deps={}) {
  deps={...require("./learningTestAdapter.cjs"),...deps};
  const exports={};
  new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,file),'utf8'),{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},
  }).outputText)(exports,name=>{assert.ok(name in deps,name);return deps[name];});
  return exports;
}
const helpers=load('shapeRun.ts');
const shapeLearning=load('shapeLearning.ts',{'./curriculum':load('curriculum.ts')});
const initial={joints:{j1:33.692,j2:29.7,j3:23.4,j4:-5},coords:{x:336.92,y:29.7,z:23.4,r:-5},displayJoints:{j1:5,j2:70.12,j3:42.13,j4:-5}};
const clone=value=>JSON.parse(JSON.stringify(value));

test('saved joint branch and calibrated display survive the return without rewriting shape evidence',()=>{
  const snapshot=clone(initial),last={x:200,y:100,z:0,r:0};
  const path=[last,{x:300,y:100,z:0,r:0},last];
  const state=helpers.prepareShapeReturn(snapshot,{j1:20,j2:100,j3:0,j4:0},last,path);
  snapshot.joints.j1=999;path[0].x=999;
  assert.equal(helpers.sampleShapeReturn(state,500).done,false);
  assert.equal(helpers.sampleShapeReturn(state,950).done,false);
  const done=helpers.sampleShapeReturn(state,500+state.durationMs);
  assert.equal(done.done,true);assert.deepEqual(done.joints,initial.joints);
  assert.deepEqual(state.initialPose,initial);
  assert.equal(state.observedPath[0].x,200);assert.equal(state.closedAt.x,200);
});

const nodes=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children)];
const textOf=node=>node==null?'':typeof node!=='object'?String(node):Array.isArray(node)?node.map(textOf).join(''):textOf(node.props?.children);

/** Exercise the component's real event handlers with deterministic React hooks and RAF. */
function mountArm() {
  const slots=[],effects=[],pending=new Map(),cancelled=[];
  let cursor=0,rootHookCount=0,dirty=false,tree,time=0,nextId=0,current=clone(initial.joints),restored=[],moves=0,visual=null,storageFailure=false;
  const storage=new Map(),observations=[],downloads=[],hardwareCommands=[];
  global.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>{if(storageFailure)throw new Error('quota');storage.set(key,value);}};
  global.requestAnimationFrame=callback=>{const id=++nextId;pending.set(id,callback);return id;};
  global.cancelAnimationFrame=id=>{if(pending.has(id))cancelled.push(pending.get(id));pending.delete(id);};
  const changed=(a,b)=>!a||!b||a.length!==b.length||a.some((v,i)=>!Object.is(v,b[i]));
  const effect=(callback,deps)=>{
    const index=cursor++,old=slots[index];
    if(!old||changed(old.deps,deps))effects.push(()=>{old?.cleanup?.();slots[index]={deps,cleanup:callback()};});
  };
  const react={
    useState(initialValue){const index=cursor++;if(!(index in slots))slots[index]={value:typeof initialValue==='function'?initialValue():initialValue};
      return [slots[index].value,value=>{const next=typeof value==='function'?value(slots[index].value):value;if(!Object.is(next,slots[index].value)){slots[index].value=next;dirty=true;}}];},
    useRef(value){const index=cursor++;return slots[index]??(slots[index]={current:value});},
    useCallback(callback,deps){const index=cursor++,old=slots[index];if(!old||changed(old.deps,deps))slots[index]={value:callback,deps};return slots[index].value;},
    useMemo(factory,deps){const index=cursor++,old=slots[index];if(!old||changed(old.deps,deps))slots[index]={value:factory(),deps};return slots[index].value;},
    useEffect:effect,useLayoutEffect:effect,
  };
  const inquiry={ready:true,observed:false,checked:false,reviewed:false,draft:{},record:null,fields:[],interrupt(){},
    begin(){
      if(!this.ready)return false;
      this.record ??= {id:'saved-prediction',prediction:{},runs:[],reflections:[]};
      this.record.runs.push({action:'mission',status:'running'});this.observed=false;
      return true;
    },
    finish(...args){observations.push(args);const run=this.record.runs.at(-1);Object.assign(run,{status:'completed',summary:args[0],expected:args[1],detail:args[2]});this.observed=true;},
  };
  const jsx=(type,props)=>({type,props});
  const {RobotArm}=load('RobotArm.tsx',{
    './PracticeProvider':{usePractice:()=>({hardware:!!props.hardwareConnected,snap:{busy:false,connection:'disconnected',setup:null},
      cancelConfirmation(){},lockVirtual:()=>()=>{},session:{stop(){}},
      runOps(){throw new Error('Unexpected physical command in virtual regression test');}})},
    './PracticeControls':{sourceLabel:source=>source==='mock'?'모의 통신 · 실장비 아님':'실측'},
    './MeasurementFeedbackReview':{},'./MathInquiry':{useMathInquiry:()=>inquiry,MathInquiryPanel:'MathInquiryPanel'},
    './learningFramework':{LEARNING_STAGES:[],learningRecordContext:()=>({source:'dt'})},
    './ShapeLessonSteps':{ShapeLessonSteps:'ShapeLessonSteps'},
    './LessonCoursePath':{LessonCoursePath:'LessonCoursePath'},
    './shapeLearning':shapeLearning,
    './measurementFeedback':{},'./shapeRun':helpers,react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},
    './learningEvidenceStorage':{...load('learningEvidenceStorage.ts'),downloadEvidence:(name,records)=>downloads.push({name,records:clone(records)})},
  });
  const props={joints:clone(initial.joints),coords:clone(initial.coords),activity:'rect',resetKey:0,hardwareConnected:false,hardwareHomed:false,
    onJointStart(){},onJogStop(){},onMoveEnd(){},onMissionStart(){},onGetJoints:()=>({...current}),
    onComputeIK:(x,y,z,r)=>({j1:x/10,j2:y,j3:z,j4:r}),
    onComputeFK:j=>({x:j.j1*10,y:j.j2,z:j.j3,r:j.j4}),
    onMoveTo(x,y,z,r){moves++;current={j1:x/10,j2:y,j3:z,j4:r};},onMoveJoints(j){moves++;current={...j};},
    onCapturePose:()=>clone({...initial,joints:current}),onRestorePose:pose=>{restored.push(clone(pose));},
    onHardwareMove(type,coords){hardwareCommands.push({type,coords:clone(coords)});return Promise.resolve(coords);},onHardwareStop(){},onResetPose(){},
    onLearningVisualChange:value=>{visual=value;},
  };
  function render(){let count=0;do{dirty=false;cursor=0;tree=RobotArm(props);rootHookCount=cursor;while(effects.length)effects.shift()();assert.ok(++count<12,'render should settle');}while(dirty);return tree;}
  const find=predicate=>{const item=nodes(tree).find(predicate);assert.ok(item,'UI element not found');return item;};
  const component=name=>find(node=>node.type?.name===name).props;
  const button=label=>find(node=>node.type==='button'&&textOf(node).includes(label)).props;
  function flush(){assert.ok(pending.size,'expected scheduled animation');const [id,callback]=pending.entries().next().value;pending.delete(id);time+=350;callback(time);render();}
  function until(predicate){for(let count=0;!predicate();count++){assert.ok(count<100,'animation should finish');flush();}}
  function choose(shape){if(component('ShapeLearningPanel').shapeType!==shape){button(shape==='동그라미'?'원':shape).onClick();render();}}
  function saveCompletePrediction() {
    const lesson = component('ShapeLearningPanel').lesson;
    const prediction = Object.fromEntries(Object.entries(shapeLearning.shapeLessonExpected(lesson)).map(([key,value])=>[key,String(value)]));
    const id = `saved-${lesson.id}`;
    inquiry.record = {id,prediction,runs:inquiry.record?.id===id?inquiry.record.runs:[],reflections:[]};
    inquiry.draft = {...prediction};
    inquiry.fields = shapeLearning.shapeLessonFields(lesson);
    render();
    return prediction;
  }
  function start() {
    saveCompletePrediction();
    const panel = component('ShapeLearningPanel');
    assert.equal(panel.inquiry.ready, true, 'All shapes use the shared saved-prediction gate');
    panel.onRun();
    render();
  }
  render();
  return {choose,start,saveCompletePrediction,flush,until,component,button,render,
    get visual(){return visual;},get pose(){return current;},get restored(){return restored;},get moves(){return moves;},
    get storage(){return storage;},get observations(){return observations;},get pending(){return pending;},
    get returning(){return textOf(tree).includes('도형 완성 · 실행 전 자세로 복귀 중');},
    get complete(){return textOf(tree).includes('도형 완성 · 실행 전 자세로 복귀 완료');},
    get text(){return textOf(tree);},get downloads(){return downloads;},get hardwareCommands(){return hardwareCommands;},get inquiry(){return inquiry;},get tree(){return tree;},
    renderComponent(name){const item=find(node=>node.type?.name===name);cursor=rootHookCount;const rendered=item.type(item.props);while(effects.length)effects.shift()();return rendered;},
    componentType(name){return find(node=>node.type?.name===name).type;},
    updateInquiry(values){Object.assign(inquiry,values);render();},
    setStorageFailure(value){storageFailure=value;},
    update(values){Object.assign(props,values);render();},
    unmount(){for(const slot of slots)slot?.cleanup?.();},
  };
}

for(const shape of ['사각형','삼각형','동그라미'])test(`${shape}: close at P1, stop tracing, then restore exact pre-run pose`,()=>{
  const app=mountArm();app.choose(shape);app.start(shape);app.until(()=>app.returning);
  assert.equal(app.visual.traceActive,false);assert.equal(app.visual.traceVisible,true);assert.equal(app.restored.length,0);
  const closure=clone(app.pose);assert.notDeepEqual(closure,initial.joints);
  app.until(()=>app.complete);assert.deepEqual(app.pose,initial.joints);assert.deepEqual(app.restored,[initial]);
  const evidence=JSON.parse(app.storage.get('physical-ai-shape-runs-v1'))[0];
  assert.deepEqual(evidence.initialPose,initial);assert.equal(evidence.shape,shape);
  assert.notDeepEqual(evidence.closedAt,initial.coords);
  for(const axis of ['x','y','z','r'])assert.ok(Math.abs(evidence.observedPath[0][axis]-evidence.closedAt[axis])<1e-8);
  assert.deepEqual(evidence.observedPath.at(-1),evidence.closedAt);
  assert.deepEqual(app.observations[0][2].observed,evidence.closedAt);
  assert.equal(app.pending.size,0);assert.equal(app.hardwareCommands.length,0);app.unmount();
});

for(const interruption of ['stop','reset','unmount','connect'])test(`${interruption} during return invalidates even an already queued frame`,()=>{
  const app=mountArm();app.choose('삼각형');app.start('삼각형');app.until(()=>app.returning);
  const stale=[...app.pending.values()][0];
  if(interruption==='stop'){app.component('ShapeLearningPanel').onStop();app.render();}
  else if(interruption==='reset')app.update({resetKey:1});
  else if(interruption==='connect')app.update({hardwareConnected:true});
  else app.unmount();
  const moveCount=app.moves;stale(99999);
  assert.equal(app.moves,moveCount);assert.equal(app.pending.size,0);assert.equal(app.restored.length,0);
  assert.equal(app.storage.has('physical-ai-shape-runs-v1'),false);
});

test('repeat execution owns its new frames and retains both closed-path records',()=>{
  const app=mountArm();app.choose('동그라미');app.start('동그라미');
  const stale=[...app.pending.values()][0];app.until(()=>app.complete);
  app.start('동그라미');const moves=app.moves;stale(99999);assert.equal(app.moves,moves);
  app.until(()=>app.complete);assert.deepEqual(app.restored,[initial,initial]);
  assert.equal(JSON.parse(app.storage.get('physical-ai-shape-runs-v1')).length,2);app.unmount();
});

test('circle closing endpoint is read-only and follows edits to P1 without changing other endpoints',()=>{
  const app=mountArm();app.choose('동그라미');
  const panel=app.component('ShapeLearningPanel'),before=clone(panel.seq);
  const lessonSteps=nodes(app.renderComponent('ShapeLearningPanel')).find(node=>node.type==='ShapeLessonSteps');
  lessonSteps.props.onEditProgram(); app.render();
  const stepList=nodes(app.renderComponent('ShapeLearningPanel')).find(node=>node.type?.name==='StepList');
  const inputs=nodes(stepList.type(stepList.props)).filter(node=>node.type?.name==='CoordInput');
  assert.ok(inputs.slice(-3).every(node=>node.props.disabled));
  panel.onEditCoord(panel.seq.length-1,'x',222);app.render();
  assert.deepEqual(clone(app.component('ShapeLearningPanel').seq),before);
  app.component('ShapeLearningPanel').onEditCoord(0,'x',before[0].coords.x+10);app.render();
  const after=app.component('ShapeLearningPanel').seq;
  assert.deepEqual(after.at(-1).coords,after[0].coords);
  assert.deepEqual(clone(after.slice(1,-1)),before.slice(1,-1));app.unmount();
});

for(const edit of ['coordinates','motion mode'])test(`editing ${edit} after a completed shape clears the old completion and trace`,()=>{
  const app=mountArm();app.choose('삼각형');app.start('삼각형');app.until(()=>app.complete);
  const panel=app.component('ShapeLearningPanel');
  assert.equal(panel.status,'done');assert.equal(app.visual.traceVisible,true);
  if(edit==='coordinates')panel.onEditCoord(1,'x',panel.seq[1].coords.x+10);
  else panel.onMotionModeChange('MoveJ');
  app.render();
  const changed=app.component('ShapeLearningPanel');
  assert.equal(changed.status,'idle');assert.equal(changed.currentStep,-1);
  assert.equal(app.visual.traceActive,false);assert.equal(app.visual.traceVisible,false);
  assert.equal(app.complete,false);assert.equal(app.pending.size,0);
  assert.equal(JSON.parse(app.storage.get('physical-ai-shape-runs-v1')).length,1);
  app.unmount();
});

test('malformed open circle keeps its real endpoint and reports closure failure while returning the robot',()=>{
  const app=mountArm();app.choose('동그라미');
  const sequence=app.component('ShapeLearningPanel').seq;
  sequence.at(-1).coords.x-=20; // Simulate a malformed imported sequence, outside the locked UI.
  const actualEnd=clone(sequence.at(-1).coords);
  app.start('동그라미');app.until(()=>app.text.includes('경로 미완성 · 실행 전 자세로 복귀 중'));
  assert.equal(app.visual.traceActive,false);app.until(()=>app.pending.size===0);
  assert.ok(app.text.includes('도형이 닫히지 않았습니다'));assert.equal(app.complete,false);
  const record=JSON.parse(app.storage.get('physical-ai-shape-runs-v1'))[0];
  assert.equal(record.closure.closed,false);assert.ok(Math.abs(record.closure.positionErrorMm-20)<1e-8);
  for(const axis of ['x','y','z','r'])assert.ok(Math.abs(record.observedPath.at(-1)[axis]-actualEnd[axis])<1e-8);
  assert.notDeepEqual(record.observedPath[0],record.observedPath.at(-1));
  assert.deepEqual(app.observations[0][2].closure,record.closure);
  assert.ok(app.observations[0][0].includes('도형이 닫히지 않았습니다'));assert.deepEqual(app.restored,[initial]);app.unmount();
});

test('shape evidence retains earlier records beyond 100 and exports the complete stream',()=>{
  const app=mountArm(),earlier=Array.from({length:105},(_,id)=>({id,source:'dt'}));
  app.storage.set('physical-ai-shape-runs-v1',JSON.stringify(earlier));
  app.choose('삼각형');app.start('삼각형');app.until(()=>app.complete);
  const records=JSON.parse(app.storage.get('physical-ai-shape-runs-v1'));
  assert.equal(records.length,106);assert.deepEqual(records.slice(0,105),earlier);
  app.button('도형 실행 기록 내려받기').onClick();assert.deepEqual(app.downloads[0].records,records);app.unmount();
});

test('failed evidence write stays visible and downloadable, and the next successful write keeps both runs',()=>{
  const app=mountArm();app.setStorageFailure(true);app.choose('삼각형');app.start('삼각형');app.until(()=>app.complete);
  assert.ok(app.text.includes('기록을 브라우저에 저장하지 못했습니다'));
  app.button('도형 실행 기록 내려받기').onClick();assert.equal(app.downloads[0].records.length,1);
  app.setStorageFailure(false);app.start('삼각형');app.until(()=>app.complete);
  assert.equal(JSON.parse(app.storage.get('physical-ai-shape-runs-v1')).length,2);app.unmount();
});

test('closure tolerates model coordinate rounding but detects an open path or missing start',()=>{
  const start={x:200.024,y:100.02,z:0,r:0};
  assert.equal(helpers.measureShapeClosure(start,{...start,x:200.124}).closed,true);
  assert.equal(helpers.measureShapeClosure(start,{...start,x:200.224}).closed,false);
  assert.equal(helpers.measureShapeClosure(undefined,start).closed,false);
});

test('circle approach starts from the captured joint pose even when the displayed coordinate is stale',()=>{
  const app=mountArm();app.choose('동그라미');
  app.update({coords:{...initial.coords,x:500,z:80}});
  app.start();app.flush();
  assert.deepEqual(app.pose,initial.joints,'the first animation frame must not jump to a stale display coordinate');
  app.unmount();
});

test('shape motion timing grows with travel distance, eases at endpoints and rejects an IK branch jump',()=>{
  const ik=(x,y,z,r)=>({j1:x/10,j2:y,j3:z,j4:r}),fk=j=>({x:j.j1*10,y:j.j2,z:j.j3,r:j.j4});
  const from={x:200,y:0,z:0,r:0},joints=ik(200,0,0,0);
  const short=helpers.prepareShapeMotion(from,joints,{...from,x:250},'MoveL',undefined,ik,fk);
  const long=helpers.prepareShapeMotion(from,joints,{...from,x:300},'MoveL',undefined,ik,fk);
  assert.ok(long.durationMs>short.durationMs*1.9);
  assert.deepEqual(helpers.sampleShapeMotion(long,0).joints,joints);
  assert.deepEqual(helpers.sampleShapeMotion(long,long.durationMs).joints,ik(300,0,0,0));
  assert.ok(helpers.sampleShapeMotion(long,1000/60).joints.j1-joints.j1<0.02);
  const wrapped=(x,y,z,r)=>({j1:x<250?179:-179,j2:0,j3:-90,j4:r});
  assert.equal(helpers.prepareShapeMotion(from,wrapped(200,0,0,0),{...from,x:300},'MoveL',undefined,wrapped,fk),null);
  assert.equal(helpers.prepareShapeMotion(from,wrapped(200,0,0,0),{...from,x:300},'MoveJ',undefined,wrapped,fk),null);
});

test('all eighteen tasks stay continuous and speed bounded at 60 Hz with the rendered pen model',()=>{
  const {SHAPE_MODEL:model,SHAPE_HOME_JOINTS:home}=load('shapeKinematics.ts',{'./processKinematics':load('processKinematics.ts')});
  const {getShapeLesson}=load('shapeLearning.ts',{'./curriculum':load('curriculum.ts')});
  const frameMs=1000/60,axes=['j1','j2','j3','j4'];
  const distance=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
  const checkFrame=(previous,joints,seconds,label)=>{
    const speed=Math.max(...axes.map(axis=>Math.abs(joints[axis]-previous[axis])/seconds));
    assert.ok(speed<=helpers.SHAPE_JOINT_SPEED_DEG_S+0.1,`${label}: joint speed ${speed}`);
    const tcpSpeed=distance(model.fk(previous),model.fk(joints))/seconds;
    assert.ok(tcpSpeed<=helpers.SHAPE_TCP_SPEED_MM_S+0.1,`${label}: TCP speed ${tcpSpeed}`);
  };
  for(const shape of ['사각형','삼각형','동그라미'])for(let task=0;task<6;task++)for(const mode of ['MoveL','MoveJ']){
    const lesson=getShapeLesson(shape,task,undefined,undefined,mode),label=`${shape} ${task+1} ${mode}`;
    let joints={...home},from=model.fk(home),curved=false;
    for(const [index,step] of lesson.sequence.entries()){
      const plan=helpers.prepareShapeMotion(from,joints,step.coords,step.type,step.via,model.ik,model.fk);
      assert.ok(plan,`${label} segment ${index} must have a continuous plan`);
      assert.deepEqual(helpers.sampleShapeMotion(plan,0).joints,joints);
      let previous=joints,previousTime=0;
      for(let time=frameMs;time<plan.durationMs+frameMs;time+=frameMs){
        const currentTime=Math.min(time,plan.durationMs),frame=helpers.sampleShapeMotion(plan,currentTime);
        assert.ok(frame.joints);checkFrame(previous,frame.joints,(currentTime-previousTime)/1000,label);
        const point=model.fk(frame.joints),a=from,b=step.coords;
        if(index>0){
          const dx=b.x-a.x,dy=b.y-a.y;
          const offLine=Math.abs((point.x-a.x)*dy-(point.y-a.y)*dx)/Math.hypot(dx,dy);
          if(step.type==='MoveL')assert.ok(offLine<1e-7,`${label}: straight TCP path ${offLine}`);
          if(step.type==='MoveJ'&&offLine>1)curved=true;
          if(step.type==='MoveC'){
            const center=lesson.circleCenter,radius=Math.hypot(a.x-center.x,a.y-center.y);
            assert.ok(Math.abs(Math.hypot(point.x-center.x,point.y-center.y)-radius)<1e-7,`${label}: circle radius`);
          }
          if(step.type!=='MoveJ')assert.ok(Math.abs(point.z)<1e-7,`${label}: pen stays on drawing plane`);
        }
        previous=frame.joints;previousTime=currentTime;
      }
      joints=previous;assert.ok(distance(model.fk(joints),step.coords)<1e-7,`${label}: exact endpoint`);
      from={...step.coords};
    }
    if(mode==='MoveJ'&&shape!=='동그라미')assert.equal(curved,true,`${label}: keep the joint-space path distinct`);
    const closed=model.fk(joints),start=lesson.sequence[0].coords;
    assert.equal(helpers.measureShapeClosure(start,closed).closed,true);
    const saved={joints:{...home},coords:model.fk(home)},back=helpers.prepareShapeReturn(saved,joints,closed,[start,closed],model.fk);
    let previous=joints,previousTime=0;helpers.sampleShapeReturn(back,0);
    for(let time=frameMs;time<back.durationMs+frameMs;time+=frameMs){
      const currentTime=Math.min(time,back.durationMs),frame=helpers.sampleShapeReturn(back,currentTime);
      checkFrame(previous,frame.joints,(currentTime-previousTime)/1000,`${label} return`);
      previous=frame.joints;previousTime=currentTime;
    }
    assert.deepEqual(previous,home,`${label}: exact saved posture`);
  }
});

const sharedSteps = app => nodes(app.renderComponent('ShapeLearningPanel')).find(node => node.type === 'ShapeLessonSteps').props;

test('RobotArm routes every shape through the same panel and seven-stage component before and after execution', () => {
  const app = mountArm(), sharedPanel = app.componentType('ShapeLearningPanel');
  for (const shape of ['사각형', '삼각형', '동그라미']) {
    app.choose(shape);
    assert.equal(app.componentType('ShapeLearningPanel'), sharedPanel);
    assert.equal(nodes(app.tree).filter(node => node.type === sharedPanel).length, 1);
    for (const mode of ['guided', 'challenge']) {
      app.component('ShapeLearningPanel').onSupportModeChange(mode); app.render();
      const before = sharedSteps(app);
      assert.equal(before.supportMode, mode);
      assert.equal(before.lesson, app.component('ShapeLearningPanel').lesson);
      assert.equal(before.inquiry, app.inquiry);
      assert.equal(before.canAdvance, false);
      assert.equal(typeof before.onNewCondition, 'function');
      assert.equal(typeof before.onEditProgram, 'function');
      assert.equal(nodes(before.execution).some(node => node.type?.name === 'RunBtn'), true);
      app.start(); app.until(() => app.complete);
      const after = sharedSteps(app);
      assert.equal(after.inquiry, app.inquiry);
      assert.equal(after.supportMode, mode);
      assert.equal(after.canAdvance, true);
      assert.equal(nodes(after.observation).some(node => node.type?.name === 'ShapeDiagram'), true);
      assert.equal(app.componentType('ShapeLearningPanel'), sharedPanel);
    }
  }
  assert.equal(app.hardwareCommands.length, 0); app.unmount();
});

for (const shape of ['사각형','삼각형','동그라미']) test(`${shape}: parent execution handler requires a saved prediction and blocks DT while hardware is connected`, () => {
  const app = mountArm(); app.choose(shape);
  app.updateInquiry({ ready: false });
  app.component('ShapeLearningPanel').onRun(); app.render();
  assert.equal(app.pending.size, 0); assert.equal(app.moves, 0);
  app.updateInquiry({ ready: true }); app.saveCompletePrediction();
  app.update({ hardwareConnected: true, hardwareHomed: true });
  app.component('ShapeLearningPanel').onRun(); app.render();
  assert.equal(app.pending.size, 0); assert.equal(app.moves, 0);
  assert.equal(app.hardwareCommands.length, 0); app.unmount();
});

for (const shape of ['사각형','삼각형','동그라미']) test(`${shape}: every required waypoint and relation must be saved before the real execution handler can start`, () => {
  const app = mountArm(); app.choose(shape);
  const lesson = app.component('ShapeLearningPanel').lesson;
  const complete = app.saveCompletePrediction();
  assert.ok(lesson.pathPlan.requiredKeys.length > 0);
  for (const key of lesson.pathPlan.requiredKeys) {
    const prediction = {...complete}; delete prediction[key];
    app.updateInquiry({ready:true,draft:{...complete},record:{id:`incomplete-${key}`,prediction,runs:[],reflections:[]}});
    app.component('ShapeLearningPanel').onRun(); app.render();
    assert.equal(app.pending.size, 0, `${key}: must not schedule animation`);
    assert.equal(app.moves, 0, `${key}: must not move the robot`);
    assert.equal(app.inquiry.record.runs.length, 0, `${key}: must not begin or fabricate execution evidence`);
    assert.equal(app.observations.length, 0, `${key}: must not record an observation`);
    assert.equal(app.storage.has('physical-ai-shape-runs-v1'), false);
  }
  assert.equal(app.hardwareCommands.length, 0); app.unmount();
});

const xyzr = point => ({x:point.x,y:point.y,z:point.z,r:point.r});
for (const shape of ['사각형','삼각형','동그라미']) test(`${shape}: the 3D prediction exposes every entered waypoint and keeps the student's complete path after execution`, () => {
  const app = mountArm(); app.choose(shape);
  const lesson = app.component('ShapeLearningPanel').lesson, start = lesson.sequence[0].coords;
  app.component('ShapeLearningPanel').onStageChange(3); app.render();
  assert.deepEqual(app.visual.studentPoints.map(xyzr), [start], 'Only the given P1 may be shown before input');
  assert.deepEqual(app.visual.studentPath, []);
  const first = lesson.pathPlan.rows[0];
  app.updateInquiry({ready:false,record:null,draft:{[first.xKey]:'287'}});
  assert.deepEqual(app.visual.studentPoints.map(xyzr), [start], 'Missing Y must not come from an undisclosed program coordinate');
  assert.deepEqual(app.visual.studentPath, [], 'A partial point must not generate a synthetic full path');
  const prediction = Object.fromEntries(Object.entries(shapeLearning.shapeLessonExpected(lesson)).map(([key,value])=>[key,String(value)]));
  const predictedPoints = lesson.pathPlan.rows.map((row,index)=>{
    prediction[row.xKey] = String(Number(prediction[row.xKey])+index+1);
    prediction[row.yKey] = String(Number(prediction[row.yKey])-index-2);
    return {x:Number(prediction[row.xKey]),y:Number(prediction[row.yKey]),z:row.z,r:row.r};
  });
  app.updateInquiry({ready:true,draft:{},record:{id:'complete-own-prediction',prediction,runs:[],reflections:[]}});
  assert.deepEqual(app.visual.studentPoints.map(xyzr), [start,...predictedPoints], 'Incorrect predictions must still display exactly as entered');
  const predictedPath = clone(app.visual.studentPath).map(xyzr);
  assert.deepEqual(predictedPath[0], start);
  const vertices = lesson.pathPlan.rows.flatMap((row,index)=>row.kind==='via'?[]:[predictedPoints[index]]);
  assert.deepEqual(predictedPath.at(-1), vertices.at(-1), 'Closure prediction must not be silently replaced with P1');
  let previousIndex = 0;
  for (const vertex of vertices) {
    const index = predictedPath.findIndex((point,index)=>index>previousIndex&&Object.keys(vertex).every(key=>Math.abs(point[key]-vertex[key])<1e-8));
    assert.ok(index>previousIndex, 'Every predicted vertex belongs to the preview in order'); previousIndex=index;
  }
  if (shape!=='동그라미') assert.deepEqual(predictedPath, [start,...vertices]);
  else {
    // The first preview arc must use the entered via, not the ideal target circle.
    const rowIndex = lesson.pathPlan.rows.findIndex(row=>row.kind==='via'&&row.sequenceIndex===1);
    const via = predictedPoints[rowIndex], end = vertices[0];
    const ux=via.x-start.x,uy=via.y-start.y,vx=end.x-start.x,vy=end.y-start.y;
    const det=2*(ux*vy-uy*vx),u2=ux*ux+uy*uy,v2=vx*vx+vy*vy;
    const center={x:start.x+(u2*vy-v2*uy)/det,y:start.y+(ux*v2-vx*u2)/det};
    const radius=Math.hypot(start.x-center.x,start.y-center.y);
    const last = predictedPath.findIndex(point=>Math.hypot(point.x-end.x,point.y-end.y)<1e-8);
    assert.ok(last>1, 'The preview contains arc interiors');
    for (const point of predictedPath.slice(0,last+1)) assert.ok(Math.abs(Math.hypot(point.x-center.x,point.y-center.y)-radius)<1e-7);
  }
  app.component('ShapeLearningPanel').onRun(); app.render(); app.until(()=>app.complete);
  assert.deepEqual(app.visual.studentPath.map(xyzr), predictedPath, 'Execution must preserve the learner prediction for comparison');
  assert.deepEqual(app.inquiry.record.prediction, prediction);
  assert.notDeepEqual(app.visual.studentPath.map(xyzr), app.visual.programmedPath.map(xyzr), 'A complete prediction does not rewrite the diagnostic or commanded path');
  app.unmount();
});

test('the square diagnosis task requires coordinate repair and a fresh completed run before advancement', () => {
  const app = mountArm();
  app.component('ShapeLearningPanel').onLessonChange(5); app.render();
  assert.equal(app.component('ShapeLearningPanel').lessonIndex, 5);
  app.start(); app.until(() => app.complete);
  assert.equal(app.component('ShapeLearningPanel').completedShapeRun, true);
  assert.equal(sharedSteps(app).canAdvance, false, 'A closed but misshapen path is not a repaired target');
  app.updateInquiry({ reviewed: true });
  app.component('ShapeLearningPanel').onNewCondition(); app.render();
  assert.equal(app.component('ShapeLearningPanel').lessonIndex, 5);
  const lesson = app.component('ShapeLearningPanel').lesson;
  app.component('ShapeLearningPanel').onEditCoord(2, 'x', lesson.targetSequence[2].coords.x); app.render();
  assert.equal(sharedSteps(app).canAdvance, false, 'Repairing coordinates cannot reuse the old DT approval');
  app.component('ShapeLearningPanel').onNewCondition(); app.render();
  assert.equal(app.component('ShapeLearningPanel').lessonIndex, 5);
  app.start(); app.until(() => app.complete);
  assert.equal(sharedSteps(app).canAdvance, true);
  app.component('ShapeLearningPanel').onNewCondition(); app.render();
  assert.equal(app.component('ShapeLearningPanel').lessonIndex, 0);
  assert.equal(sharedSteps(app).canAdvance, false);
  assert.equal(JSON.parse(app.storage.get('physical-ai-shape-runs-v1')).length, 2);
  app.unmount();
});

test('hardware measurement handler cannot bypass completed-DT and verified-session gates via old home flags', async () => {
  const app = mountArm();
  app.updateInquiry({ reviewed: true });
  app.update({ hardwareConnected: true, hardwareHomed: true });
  app.component('ShapeLearningPanel').onStageChange(7); app.render();
  const beforeDT = app.button('안내·연결에서 준비 필요');
  assert.equal(beforeDT.disabled, true); await beforeDT.onClick();
  assert.equal(app.hardwareCommands.length, 0);
  app.update({ hardwareConnected: false, hardwareHomed: false });
  app.start(); app.until(() => app.complete);
  app.update({ hardwareConnected: true });
  app.component('ShapeLearningPanel').onStageChange(7); app.render();
  const unhomed = app.button('안내·연결에서 준비 필요');
  assert.equal(unhomed.disabled, true); await unhomed.onClick();
  assert.equal(app.hardwareCommands.length, 0);
  app.updateInquiry({ ready: false }); app.update({ hardwareHomed: true });
  app.component('ShapeLearningPanel').onStageChange(7); app.render();
  const invalidated = app.button('안내·연결에서 준비 필요');
  assert.equal(invalidated.disabled, true); await invalidated.onClick();
  assert.equal(app.hardwareCommands.length, 0); app.unmount();
});

for (const shape of ['사각형', '삼각형', '동그라미']) test(`${shape}: the editor labels and edits the destination waypoint P3`, () => {
  const app = mountArm(); app.choose(shape);
  sharedSteps(app).onEditProgram(); app.render();
  const list = nodes(app.renderComponent('ShapeLearningPanel')).find(node => node.type?.name === 'StepList');
  const rendered = list.type(list.props), rows = rendered.props.children;
  const p3Row = rows[2], expected = clone(app.component('ShapeLearningPanel').seq[2].coords);
  assert.equal(nodes(p3Row).some(node => node.type === 'span' && textOf(node) === (shape === '동그라미' ? 'P3 도착' : 'P3')), true);
  assert.equal(nodes(p3Row).some(node => node.type === 'span' && textOf(node) === (shape === '동그라미' ? 'P2 도착' : 'P2')), false);
  const x = nodes(p3Row).find(node => node.type?.name === 'CoordInput' && node.props.field === 'x');
  assert.equal(x.props.val, expected.x);
  const p2 = clone(app.component('ShapeLearningPanel').seq[1].coords);
  x.props.onChange(expected.x + 5); app.render();
  assert.equal(app.component('ShapeLearningPanel').seq[2].coords.x, expected.x + 5);
  assert.deepEqual(app.component('ShapeLearningPanel').seq[1].coords, p2);
  app.unmount();
});

for (const shape of ['사각형', '삼각형', '동그라미']) test(`${shape}: revising a saved prediction clears the completed run screen but retains its evidence`, () => {
  const app = mountArm(); app.choose(shape); app.start(); app.until(() => app.complete);
  const stored = app.storage.get('physical-ai-shape-runs-v1');
  assert.equal(app.component('ShapeLearningPanel').status, 'done');
  assert.equal(sharedSteps(app).canAdvance, true);
  // Real useMathInquiry.revise emits this state; the shared lesson tests exercise its UI and history.
  app.updateInquiry({ ready: false, observed: false, checked: false, reviewed: false, record: null });
  assert.equal(app.component('ShapeLearningPanel').status, 'idle');
  assert.equal(app.component('ShapeLearningPanel').currentStep, -1);
  assert.equal(sharedSteps(app).canAdvance, false);
  assert.equal(app.complete, false);
  assert.equal(app.visual.traceActive, false);
  assert.equal(app.visual.traceVisible, false);
  assert.equal(app.pending.size, 0);
  assert.equal(app.storage.get('physical-ai-shape-runs-v1'), stored);
  app.updateInquiry({ ready: true, record: { id: 'revised-prediction', prediction: {}, runs: [], reflections: [] } });
  assert.equal(app.component('ShapeLearningPanel').status, 'idle');
  assert.equal(app.complete, false);
  assert.equal(sharedSteps(app).canAdvance, false);
  app.unmount();
});
