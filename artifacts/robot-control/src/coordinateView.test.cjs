// Run from artifacts/robot-control: node --test src/coordinateView.test.cjs
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const THREE=require('three');
// Use the same controls dependency as the installed Drei, including isolated pnpm layouts.
const {OrbitControls}=require(require.resolve('three-stdlib',{paths:[require.resolve('@react-three/drei')]}));
function load(name,deps={}){
  const exports={},source=fs.readFileSync(path.join(__dirname,name),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  new Function('exports','require',code)(exports,n=>{assert.ok(n in deps,`Unexpected dependency ${n}`);return deps[n];});return exports;
}
const curriculum=load('curriculum.ts');
const learning=load('coordinateLearning.ts',{'./curriculum':curriculum});
const strategy=load('coordinateStrategies.ts',{'./curriculum':curriculum,'./coordinateLearning':learning});
const layout=load('coordinateLabelLayout.ts',{'./coordinateLearning':learning});
const {CoordinateViewSession,COORDINATE_STUDY_VIEW:view}=load('coordinateStudyView.ts',{'three':THREE});
const pose=(x,y,z=0)=>({x,y,z,r:0});
const cameraAt=(position,width=1000,height=900,target=view.target)=>{
  const camera=new THREE.PerspectiveCamera(42,width/height,1,6000);
  camera.position.set(...position);camera.lookAt(...target);camera.updateMatrixWorld();return camera;
};
const project=(point,camera,w,h)=>{
  const p=new THREE.Vector3(...point).project(camera);return {x:(p.x+1)*w/2,y:(1-p.y)*h/2};
};
function verifyPlacement(input,w,h,previous){
  const reserved=[{x:w-180,y:h-194,width:180,height:194}];
  const placed=layout.placeCoordinateLabels(input,w,h,reserved,previous);
  assert.equal(placed.length,input.length);
  for(const [i,p] of placed.entries()){
    assert.ok(p.box.x>=8&&p.box.x+p.box.width<=w-8,`horizontal bounds: ${p.id}`);
    assert.ok(p.box.y>=72&&p.box.y+p.box.height<=h-54,`vertical bounds: ${p.id}`);
    for(const other of [...reserved,...placed.slice(0,i).map(l=>l.box)])
      assert.equal(layout.overlapArea(p.box,other),0,`overlap: ${p.id} at ${w}x${h}`);
    assert.equal(p.x,input[i].x);assert.equal(p.y,input[i].y);
    assert.ok(p.leader.x===p.box.x||p.leader.x===p.box.x+p.box.width||p.leader.y===p.box.y||p.leader.y===p.box.y+p.box.height);
  }
  return placed;
}

test('study view is oblique from above and frames the task plane at desktop and narrower sizes',()=>{
  const direction=new THREE.Vector3(...view.position).sub(new THREE.Vector3(...view.target));
  const elevation=Math.atan2(direction.y,Math.hypot(direction.x,direction.z))*180/Math.PI;
  assert.ok(elevation>40&&elevation<55);assert.ok(direction.length()<2200);
  for(const [w,h] of [[1180,1100],[760,900],[500,650]]){
    const camera=cameraAt(view.position,w,h);
    // Conservative bounds including robot base, shoulder, and all initial lesson points.
    for(const point of [[-100,0,-100],[100,550,100],[350,200,0],[250,200,-50],[300,200,50]]){
      const p=project(point,camera,w,h);assert.ok(p.x>8&&p.x<w-8&&p.y>72&&p.y<h-54);
    }
  }
});
test('view request converges with real OrbitControls, then leaves orbit untouched and restores the prior view',()=>{
  const camera=cameraAt([720,490,940]),controls=new OrbitControls(camera);
  controls.target.set(60,220,0);controls.update();
  const before=camera.position.clone(),target=controls.target.clone();
  const session=new CoordinateViewSession(camera,controls.target,()=>controls.update());
  session.request();for(let i=0;i<180;i++)session.step(1/60);
  assert.ok(camera.position.distanceTo(new THREE.Vector3(...view.position))<1e-6);
  assert.deepEqual(controls.target.toArray(),[...view.target]);
  // Completed animation must not fight manual camera changes or ordinary frames/Home.
  camera.position.set(900,700,600);controls.target.set(10,100,20);controls.update();
  const manual=camera.position.clone();for(let i=0;i<120;i++)session.step(1/60);
  assert.deepEqual(camera.position.toArray(),manual.toArray());
  session.request();for(let i=0;i<180;i++)session.step(1/60);
  assert.ok(camera.position.distanceTo(new THREE.Vector3(...view.position))<1e-6);
  session.restore();assert.ok(camera.position.distanceTo(before)<1e-6);assert.deepEqual(controls.target.toArray(),target.toArray());
});
test('cancel during an animated return yields immediately to a drag or another view preset',()=>{
  const camera=cameraAt([650,380,850]),target=new THREE.Vector3(60,220,0);
  const session=new CoordinateViewSession(camera,target,()=>camera.lookAt(target));
  session.request();session.step(1/60);session.cancel();
  camera.position.set(40,280,1500);target.set(60,200,0);
  for(let i=0;i<90;i++)session.step(1/60);
  assert.deepEqual(camera.position.toArray(),[40,280,1500]);assert.deepEqual(target.toArray(),[60,200,0]);
});
test('coincident endpoints share one label while start and axes remain readable through resize and free rotations',()=>{
  const visual={key:'layout',from:pose(250,50),fromLabel:'A',results:{absolute:{from:pose(250,50),to:pose(300,-50)},relative:{from:pose(250,50),to:pose(300,-50)}},
    points:[{id:'given-b',label:'B · 주어진 도착점',pose:pose(300,-50),color:'#64748b',kind:'given'},
      {id:'relative',label:'내 예상 · 상대 이동',pose:pose(300,-50),color:'#9333ea',kind:'prediction'}]};
  const labels=layout.coordinateLabels(visual);
  const endpoints=labels.filter(l=>l.endpoint);
  assert.equal(endpoints.length,1);assert.equal(endpoints[0].text,'B 도착 · 절대=상대');
  for(const original of ['B · 주어진 도착점','내 예상 · 상대 이동','DT · 절대 이동','DT · 상대 이동'])assert.ok(endpoints[0].fullText.includes(original));
  for(const [w,h] of [[1180,1100],[760,900],[500,650]])for(const position of [view.position,[650,900,850],[-650,900,850],[650,900,-850],[60,1800,1]]){
    const camera=cameraAt(position,w,h);
    const input=labels.map(l=>{
      const point=l.live?[250,200,-50]:[l.position[0],l.position[1]+200,l.position[2]];
      return {id:l.id,...project(point,camera,w,h),width:l.text.length*12+16,height:26};
    });
    const placed=verifyPlacement(input,w,h);
    const again=verifyPlacement(input,w,h,new Map(placed.map(p=>[p.id,p])));
    for(const [i,p] of placed.entries())for(const axis of ['x','y'])assert.ok(Math.abs(again[i].box[axis]-p.box[axis])<1e-7,'stationary labels should not jitter');
  }
});
test('dense identical projections retain all labels and leaders without moving the underlying points',()=>{
  const input=Array.from({length:12},(_,i)=>({id:`point-${i}`,x:330,y:350,width:92,height:26}));
  verifyPlacement(input,680,740);
  const nearCorner=input.slice(0,6).map(p=>({...p,x:500,y:550}));
  verifyPlacement(nearCorner,700,740);
});
test('short labels retain C, command order and DT provenance without revealing independent answers',()=>{
  const task=learning.COORDINATE_TASKS.at(-1),draft=learning.blankCoordinateDraft();
  draft.absolute={x:'240',y:'20',z:'30'};draft.relative={x:'260',y:'40',z:'20'};
  const visual={key:'independent',from:task.changedStart,fromLabel:'C',points:learning.coordinatePreview(task,draft),results:{},showPaths:false};
  const before=layout.coordinateLabels(visual);
  assert.ok(before.some(l=>l.text==='C 출발'));assert.equal(before.length,6);
  const after=layout.coordinateLabels({...visual,points:learning.coordinatePreview(task,draft,true)});
  assert.ok(after.some(l=>l.text==='예상 상대'));assert.equal(after.length,8);
  const scenario=strategy.COORDINATE_SCENARIOS.at(-1);
  const commands=scenario.steps.map(s=>({mode:'absolute',argument:{x:String(s.goal.x),y:String(s.goal.y),z:String(s.goal.z)}}));
  const hidden=layout.coordinateLabels(strategy.strategyVisual(scenario,commands,[],'hidden'));
  assert.equal(hidden.length,7);assert.ok(hidden.some(l=>l.text==='P 작업대'));assert.ok(!hidden.some(l=>l.id.startsWith('point-input')));
  const plan=strategy.strategyPlan(scenario,commands),results=plan.map(s=>({from:s.from,to:s.to}));
  const shown=layout.coordinateLabels(strategy.strategyVisual(scenario,commands,results,'shown',true));
  assert.ok(shown.some(l=>l.text==='1 명령 도착'));assert.ok(shown.some(l=>l.text==='3 DT 절대'));
});

test('distinct endpoints and wrong predictions do not gain an equality label',()=>{
  const from=pose(250,50),to=pose(300,-50);
  const visual={key:'different',from,fromLabel:'A',points:[{id:'wrong',label:'내 Δ로 만든 도착점',pose:pose(270,-50),color:'#9333ea',kind:'prediction'}],
    results:{absolute:{from,to},relative:{from,to:pose(300.02,-50)}}};
  const labels=layout.coordinateLabels(visual);
  assert.equal(labels.filter(l=>l.endpoint).length,3);
  assert.ok(labels.some(l=>l.text==='내 Δ 도착'));assert.ok(!labels.some(l=>l.text.includes('절대=상대')));
  const one=layout.coordinateLabels({...visual,results:{absolute:{from,to}},points:[{id:'b',label:'B · 주어진 도착점',pose:to,color:'#64748b',kind:'given'}]});
  assert.equal(one.filter(l=>l.endpoint).length,1);assert.equal(one.find(l=>l.endpoint).text,'B 도착 · DT 절대');
  assert.ok(!one.some(l=>l.text.includes('상대')));
});
test('TCP name coalesces only at visible endpoints and returns during motion, including FK rounding',()=>{
  const from=pose(250,50),to=pose(300,-50);
  const labels=layout.coordinateLabels({key:'tcp',from,fromLabel:'A',points:[],results:{absolute:{from,to}}});
  assert.equal(layout.tcpSharesEndpoint(labels,[300,0,50]),true);
  assert.equal(layout.tcpSharesEndpoint(labels,[300.02,0,50]),true);
  assert.equal(layout.tcpSharesEndpoint(labels,[301,0,50]),false);
  assert.equal(layout.tcpSharesEndpoint(labels,[250,0,-50]),false);
  assert.equal(layout.tcpSharesEndpoint(labels,[300,20,50]),false);
  assert.equal(layout.tcpSharesEndpoint(labels.filter(l=>!l.endpoint),[300,0,50]),false);
});
test('study view makes the robot larger while retaining the base and full lesson work area',()=>{
  const points=[[-100,0,-100],[100,550,100],[440,200,-20],[300,260,50],[300,260,-50]];
  for(const [w,h] of [[1180,1100],[760,900],[500,650]]){
    const current=cameraAt(view.position,w,h),old=cameraAt([420,1280,980],w,h,[110,200,0]);
    const span=camera=>{const ps=points.slice(0,2).map(p=>project(p,camera,w,h));return Math.hypot(ps[1].x-ps[0].x,ps[1].y-ps[0].y);};
    assert.ok(span(current)>span(old)*1.2,'robot should occupy at least 20% more of the viewport');
    for(const point of points){const p=project(point,current,w,h);assert.ok(p.x>8&&p.x<w-8&&p.y>72&&p.y<h-54,JSON.stringify({w,h,point,p}));}
  }
});
