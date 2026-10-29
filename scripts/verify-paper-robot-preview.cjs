// Actual advanced lesson UI + URDF animation, with isolated HTTP and blocked sockets.
require('./isolated-ui-fixtures.cjs');
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fixture=require('./verify-revision-journey.cjs').fixture
 .replace('window.requestAnimationFrame=cb=>raf(t=>cb(t*8));','')
 .replace('</head>',`<style>html,body{height:100%;overflow:hidden}.journey-fixture{height:calc(100vh - 30px);box-sizing:border-box;overflow:hidden}.journey-robot{height:100%;position:relative;top:0;box-sizing:border-box}.curriculum-body{height:100%;overflow:hidden}</style></head>`)
 .replace("const React=",`const Fiber=await import('@react-three/fiber');
 window.__paperFrames=[];let sampled=0;
 const signature=root=>{const out=[];root?.traverse(o=>{if(o.isMesh)out.push(o.matrixWorld.elements.map(v=>Math.round(v*10000)/10000));});return JSON.stringify(out);};
 const materials=root=>{const out=[];root?.traverse(o=>{if(o.isMesh){const m=Array.isArray(o.material)?o.material[0]:o.material;out.push({opacity:m.opacity,color:m.color?.getHexString()});}});return out;};
 Fiber.addAfterEffect(()=>{for(const root of Fiber._roots.values()){
   const scene=root.store.getState().scene,source=scene.getObjectByName('paper-robot-appearance');
   if(source){const fixed=scene.getObjectByName('paper-current-position');window.__paperRobot={sourceVisible:source.visible,fixedVisible:fixed?.visible??false,source:signature(source),fixed:signature(fixed),sourceMaterials:materials(source),fixedMaterials:materials(fixed)};
    if(fixed?.visible&&source.visible&&performance.now()-sampled>80){sampled=performance.now();window.__paperFrames.push(window.__paperRobot);}}
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
  for(const advanced2 of process.env.PREVIEW_LEVEL==='2'?[true]:[false,true]){
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
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith('physical-ai-paper-coordinate-v1')))||'[]').at(-1)?.run?.status==='completed');
   await page.waitForTimeout(400);
   const frames=await page.evaluate(()=>window.__paperFrames),after=await page.evaluate(()=>window.__paperRobot);
   assert.ok(frames.length>8,'real intermediate preview motion is rendered');
   assert.equal(new Set(frames.map(f=>f.fixed)).size,1,'current position must not move during the preview');
   assert.equal(frames[0].fixed,before,'current reference is the exact last pose before starting');
   assert.ok(new Set(frames.map(f=>f.source)).size>6,'grey preview really moves');
   assert.ok(after.sourceMaterials.every(m=>m.opacity<=.32));
   assert.ok(after.fixedMaterials.some(m=>m.opacity===1));
   assert.ok(after.sourceMaterials.every(m=>!m.color||m.color==='8b98a6'));
   console.log(`VERIFIED advanced ${advanced2?2:1}: ${frames.length} motion samples, fixed pose and distinct materials`);
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
   console.log(`PASS advanced ${advanced2?2:1}: original colours; frozen current pose; ${frames.length} real grey movement frames; original materials on exit; display controls do not write or move.`);
   await context.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
