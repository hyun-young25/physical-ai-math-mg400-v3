// Actual advanced lesson UI + URDF animation, with isolated HTTP and blocked sockets.
require('./isolated-ui-fixtures.cjs');
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fixture=require('./verify-revision-journey.cjs').fixture
 .replace('window.requestAnimationFrame=cb=>raf(t=>cb(t*8));','')
 .replace("const [coords,setCoords]=React.useState(shapeFK(joints.current));",
  "const liveJoints=React.useRef(null);const liveCoords=React.useRef(null);const [coords,setCoords]=React.useState(shapeFK(joints.current));")
 .replace("const move=j=>{joints.current={...j};const p=shapeFK(j);window.__dt.push(p);setCoords(p);};",
  "const move=j=>{liveJoints.current={...j};liveCoords.current=shapeFK(j);window.__dt.push(liveCoords.current);};const moveEnd=()=>{const pose=liveJoints.current;if(!pose)return;joints.current={...pose};liveJoints.current=null;setCoords(shapeFK(pose));liveCoords.current=null;};")
 .replace("const reset=()=>move({...SHAPE_HOME_JOINTS});",
  "const reset=()=>{move({...SHAPE_HOME_JOINTS});moveEnd();};")
 .replace("RobotScene,{joints:joints.current,coords,",
  "RobotScene,{joints:joints.current,liveJointsRef:liveJoints,liveCoordsRef:liveCoords,coords,")
 .replace("coords,onJointStart:noop,onJogStop:noop,onMoveEnd:noop,",
  "coords,onJointStart:noop,onJogStop:noop,onMoveEnd:moveEnd,")
 .replace("onMoveTo:(x,y,z,r)=>{const j=shapeIK(x,y,z,r,joints.current.j3);if(j)move(j);},",
  "onMoveTo:(x,y,z,r)=>{const j=shapeIK(x,y,z,r,(liveJoints.current??joints.current).j3);if(j)move(j);},")
 .replace("onGetJoints:()=>joints.current,",
  "onGetJoints:()=>liveJoints.current??joints.current,")
 .replace("onCapturePose:()=>({joints:{...joints.current},coords:shapeFK(joints.current)}),",
  "onCapturePose:()=>{const pose=liveJoints.current??joints.current;return {joints:{...pose},coords:shapeFK(pose)};},")
 .replace('</head>',`<style>html,body{height:100%;overflow:hidden}.journey-fixture{height:calc(100vh - 30px);box-sizing:border-box;overflow:hidden}.journey-robot{height:100%;position:relative;top:0;box-sizing:border-box}.curriculum-body{height:100%;overflow:hidden}</style></head>`)
 .replace("const React=",`const Fiber=await import('@react-three/fiber');
  window.__paperFrames=[];let sampled=0;
  const meshCache=new WeakMap(),appearanceCache=new WeakMap();
  const meshes=root=>{if(!root)return[];let found=meshCache.get(root);if(!found){found=[];root.traverse(o=>{if(o.isMesh)found.push(o);});meshCache.set(root,found);}return found;};
  const signature=root=>{let hash=2166136261;for(const o of meshes(root)){const e=o.matrixWorld.elements;for(let i=0;i<16;i++)hash=Math.imul(hash^Math.round(e[i]*10000),16777619);}return(hash>>>0).toString(36);};
  const appearance=root=>{if(!root)return{materials:[],outlines:[]};let found=appearanceCache.get(root);if(!found){const materialList=[],outlineList=[];root.traverse(o=>{if(o.isMesh){for(const m of(Array.isArray(o.material)?o.material:[o.material]))materialList.push({opacity:m.opacity,color:m.color?.getHexString(),transparent:m.transparent});}if(o.isLineSegments&&o.name==='paper-dt-ghost-outline'){const m=o.material;outlineList.push({opacity:m.opacity,color:m.color?.getHexString(),transparent:m.transparent});}});found={materials:materialList,outlines:outlineList};appearanceCache.set(root,found);}return found;};
 Fiber.addAfterEffect(()=>{for(const root of Fiber._roots.values()){
    if(performance.now()-sampled<140)continue;
   const scene=root.store.getState().scene,source=scene.getObjectByName('paper-robot-appearance');
     if(source){sampled=performance.now();const fixed=scene.getObjectByName('paper-current-position'),sourceAppearance=appearance(source),fixedAppearance=appearance(fixed),gl=root.store.getState().gl;window.__paperRobot={sourceVisible:source.visible,fixedVisible:fixed?.visible??false,source:signature(source),fixed:signature(fixed),sourceMaterials:sourceAppearance.materials,sourceOutlines:sourceAppearance.outlines,fixedMaterials:fixedAppearance.materials,renderBudget:{shadows:gl.shadowMap.enabled,pixelRatio:gl.getPixelRatio()}};
    if(fixed?.visible&&source.visible)window.__paperFrames.push(window.__paperRobot);}
 }});
 const React=`);

(async()=>{
 // GitHub's Linux runner has no hardware GPU; use the same explicit software
 // renderer as the existing paper-scene tests instead of driver auto-selection.
 const browser=await chromium.launch({args:process.platform==='linux'
  ?['--use-angle=swiftshader','--enable-unsafe-swiftshader']
  :['--enable-webgl','--ignore-gpu-blocklist']});
 const shots=process.env.DIAG_SHOTS||path.resolve(__dirname,'../diagnosis-qa/robot-preview');fs.mkdirSync(shots,{recursive:true});
 try{
  const levels=process.env.PREVIEW_LEVEL==='1'?[false]:process.env.PREVIEW_LEVEL==='2'?[true]:[false,true];
 if(fixture.includes("setCoords(p);")||!fixture.includes("liveJointsRef:liveJoints,liveCoordsRef:liveCoords"))
  throw new Error("Paper preview fixture did not adopt the production ref-based movement adapter.");
  for(const advanced2 of levels){
   console.log(`START advanced ${advanced2?2:1}: current-pose and animated-preview verification`);
   const context=await browser.newContext({viewport:{width:1600,height:900}}),errors=[];
   await context.route('**/api/**',r=>r.fulfill({json:{}}));
   await context.route('**/__robot-preview',r=>r.fulfill({contentType:'text/html',body:fixture}));
   const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://localhost/__robot-preview');
   await page.getByRole('button',{name:advanced2?/종이 위 경로 확인 \(MG400\)/:/종이 기준점 \(DT\)/}).click();
   const view=page.getByRole('region',{name:'종이 좌표 변환 학습'}),click=name=>view.getByRole('button',{name,exact:true}).click(),field=label=>view.getByLabel(label,{exact:true});
   if(advanced2){for(const [name,x,y] of [['O',180,-60],['X',280,-60],['Y',180,40]]){
    for(const [axis,value] of [['X',x],['Y',y],['Z',60],['R',0]])await field(`${name} 기준점 ${axis} 좌표 (${axis==='R'?'°':'mm'})`).fill(String(value));
    await view.locator(`[data-paper-row="${name}"]`).getByRole('button',{name:'입력값 저장',exact:true}).click();
   }}
   try { await page.waitForFunction(()=>window.__paperRobot?.sourceMaterials.length>10); }
   catch(error) { await page.screenshot({path:path.join(shots,'preview-failure.png')});console.error({errors,robot:await page.evaluate(()=>window.__paperRobot),text:(await page.locator('body').innerText()).slice(0,1200)});throw error; }
   const idle=await page.evaluate(()=>window.__paperRobot);
   assert.equal(idle.sourceVisible,true);assert.equal(idle.fixedVisible,false);
   assert.ok(idle.sourceMaterials.some(m=>m.opacity===1));
   assert.ok(new Set(idle.sourceMaterials.map(m=>m.color)).size>2,'original robot colours remain');
   if(!process.env.CI)await page.screenshot({path:path.join(shots,`advanced${advanced2?2:1}-current.png`),timeout:30000});
   await click('02 수학적 구조화');
   for(const [label,value] of [['원점 X (mm)','180'],['원점 Y (mm)','-60'],['1 cm당 길이 (mm)','10'],['이 관계를 선택한 이유','원점에 종이 이동량을 10배 하여 더합니다.']])await field(label).fill(value);
   if(advanced2){await view.getByLabel('종이 x축이 향하는 방향').selectOption('x+');await field('추가 회전 (°)').fill('0');}
   await click('관계 저장');await click('03 표현·예측');
   await field('직선 경로 명령').selectOption('MoveL');await field('닫힌 경로 ΔX 합').fill('0');await field('닫힌 경로 ΔY 합').fill('0');
   for(const [name,x,y] of [['P1',180,-60],['P2',290,-60],['P3',310,90],['P4',180,90]]){
    await field(`${name} 예측 로봇 X · mm`).fill(String(x));await field(`${name} 예측 로봇 Y · mm`).fill(String(y));
   }
   await click('예측 저장');await click('04 실행·측정');
   if(advanced2)await field('펜 들기 높이').fill('80');
   await view.getByRole('button',{name:'DT에서 확인',exact:true}).scrollIntoViewIfNeeded();
   await page.waitForTimeout(800);
   const before=await page.evaluate(()=>window.__paperRobot.source);
   const recording=!!process.env.RECORD_PREVIEW&&!advanced2;
   if(recording){await page.screencast.start({path:path.join(shots,'current-and-preview.webm'),size:{width:1600,height:900},quality:90});await page.waitForTimeout(2000);}
   await click('DT에서 확인');await page.getByTestId('paper-preview-label').waitFor();
   await page.waitForTimeout(1800);
   if(!process.env.CI)await page.screenshot({path:path.join(shots,`advanced${advanced2?2:1}-moving.png`),timeout:30000});
   try {
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith('physical-ai-paper-coordinate-v1')))||'[]').at(-1)?.run?.status==='completed');
   } catch(error) {
    console.error('DT completion diagnostics',await page.evaluate(()=>{
     const records=JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith('physical-ai-paper-coordinate-v1')))||'[]');
     const run=records.at(-1)?.run;
     return {status:run?.status,error:run?.error,observations:run?.observations?.length,
      recordStatus:records.at(-1)?.status,dtMoves:window.__dt?.length,
      movingFrames:window.__paperFrames?.length,visibleText:document.body.innerText.slice(-1800)};
    }));
    throw error;
   }
   await page.waitForTimeout(400);
   const frames=await page.evaluate(()=>window.__paperFrames),after=await page.evaluate(()=>window.__paperRobot);
   assert.ok(frames.length>8,'real intermediate preview motion is rendered');
   assert.equal(new Set(frames.map(f=>f.fixed)).size,1,'current position must not move during the preview');
   assert.equal(frames[0].fixed,before,'current reference is the exact last pose before starting');
   assert.ok(new Set(frames.map(f=>f.source)).size>6,'blue preview really moves');
   assert.ok(after.sourceMaterials.length>10,'the complete robot body is inspected');
   assert.ok(after.sourceMaterials.every(m=>m.transparent&&m.opacity>0&&m.opacity<=.42&&m.color==='bfdbfe'),
     'every robot-body material is translucent pale blue');
   assert.ok(after.sourceOutlines.length>10,'the complete robot outline is inspected');
   assert.ok(after.sourceOutlines.every(m=>m.transparent&&m.color==='3b82f6'&&m.opacity===.78),
     'every robot-body outline is visible blue');
    assert.ok(frames.some(frame=>!frame.renderBudget.shadows&&frame.renderBudget.pixelRatio<=.65),
      'DT preview enables the low-cost render budget without dropping robot geometry checks');
   assert.ok(frames.every(frame=>frame.sourceMaterials.length>10
     &&frame.sourceMaterials.every(m=>m.transparent&&m.opacity>0&&m.opacity<=.42&&m.color==='bfdbfe')
     &&frame.sourceOutlines.length>10
     &&frame.sourceOutlines.every(m=>m.transparent&&m.color==='3b82f6'&&m.opacity===.78)),
     'body tint and outline remain present at every sampled animated pose');
   assert.ok(after.fixedMaterials.some(m=>m.opacity===1));
   assert.ok(after.fixedMaterials.some(m=>m.color!=='bfdbfe'),'frozen current-pose reference keeps original colours');
   console.log(`VERIFIED advanced ${advanced2?2:1}: ${frames.length} moving poses, pale-blue body, blue outline, frozen current pose`);
   await click('06 비교·해석');
   await page.getByRole('button',{name:'장면에서 P3 선택',exact:true}).click();
   await page.screenshot({path:path.join(shots,`advanced${advanced2?2:1}-result.png`),timeout:60000});
   if(recording){await page.waitForTimeout(3000);await page.screencast.stop();}
   const records=await page.evaluate(()=>JSON.stringify(localStorage)),moves=await page.evaluate(()=>window.__dt.length);
   await page.getByRole('button',{name:'↺ 종이 시점',exact:true}).click();
   assert.equal(await page.evaluate(()=>JSON.stringify(localStorage)),records);assert.equal(await page.evaluate(()=>window.__dt.length),moves);
   await page.getByRole('navigation',{name:'도형 수업 경로',exact:true}).getByRole('button').nth(3).click();
   await page.getByTestId('paper-current-label').waitFor({state:'detached'});
   await page.waitForFunction(()=>window.__paperRobot?.sourceVisible&&!window.__paperRobot.fixedVisible&&window.__paperRobot.sourceMaterials.some(m=>m.opacity===1));
   if(!process.env.CI)await page.screenshot({path:path.join(shots,`advanced${advanced2?2:1}-exit-restored.png`),timeout:30000});
   assert.deepEqual(errors,[]);
   console.log(`PASS advanced ${advanced2?2:1}: original current-pose colours; frozen reference; ${frames.length} blue-body/blue-outline movement frames; original materials on exit; display controls do not write or move.`);
   await page.close();
   await context.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
