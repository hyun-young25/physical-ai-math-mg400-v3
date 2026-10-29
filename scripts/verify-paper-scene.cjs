// Local, isolated real components. No external API, real bridge or robot movement.
require('./isolated-ui-fixtures.cjs');
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fixture=require('./verify-revision-journey.cjs').fixture.replace('window.__revisionScene=revisionSceneSnapshot;',`window.__revisionScene=revisionSceneSnapshot;window.__paperScene=(await import('/src/paperSceneStore.ts')).paperSceneSnapshot;`);
(async()=>{
 const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1080}}),errors=[];let writes=0;
  await context.route('**/api/**',r=>{if(r.request().method()!=='GET')writes++;return r.fulfill({json:{}});});
  await context.route('**/__paper-scene',r=>r.fulfill({contentType:'text/html',body:fixture}));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000);
  await page.goto('http://localhost/__paper-scene');
  await page.getByRole('button',{name:/종이 기준점 \(DT\)/}).click();
  const view=page.getByRole('region',{name:'종이 좌표 변환 학습'}),map=view.locator('.paper-scene-map');
  const click=name=>view.getByRole('button',{name,exact:true}).click();
  const shots=process.env.DIAG_SHOTS||path.resolve(__dirname,'../../diagnosis-qa');fs.mkdirSync(shots,{recursive:true});
  await page.getByRole('button',{name:'장면에서 P1 선택',exact:true}).waitFor();
  assert.equal(await page.locator('.paper-scene-legend').count(),2);
  assert.match(await view.getByRole('complementary',{name:'현재 좌표 정보'}).innerText(),/DT · 실측 아님/);
  await click('다음 단계');
  for(const [label,value] of [['원점 X (mm)','180'],['원점 Y (mm)','-60'],['1 cm당 길이 (mm)','10'],['이 관계를 선택한 이유','기준점과 종이 이동량을 더합니다.']])await view.getByLabel(label,{exact:true}).fill(value);
  await click('관계 저장');await click('다음 단계');
  const moves=await page.evaluate(()=>window.__dt.length);
  await view.getByLabel('P2 예측 로봇 X · mm').fill('310');
  assert.equal(await map.locator('[data-paper-series="입력 중 예측"] circle').count(),0,'one coordinate must not become a zero-filled point');
  await view.getByLabel('P2 예측 로봇 Y · mm').fill('-60');
  await page.waitForFunction(()=>document.querySelector('[aria-label="장면에서 P2 선택"]')?.getAttribute('aria-pressed')==='true');
  assert.equal(await map.locator('[data-paper-series="입력 중 예측"] circle').count(),1);
  assert.doesNotMatch(await map.innerText(),/290|ΔX|20 mm/,'no correct robot coordinate or error value before execution');
  await page.getByRole('button',{name:'장면에서 P1 선택',exact:true}).click();
  assert.equal(await view.locator('[data-paper-row="P1"]').getAttribute('data-paper-selected'),'true');
  await map.getByRole('button',{name:'도면에서 P2 선택',exact:true}).click();
  await page.getByRole('button',{name:'↺ 종이 시점',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__dt.length),moves);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(shots,'14-paper-live-prediction.png')});
  await page.getByRole('button',{name:/종이 위 경로 확인 \(MG400\)/}).click();
  await page.waitForFunction(()=>window.__paperScene().data?.level==='advanced-paper-hardware');
  assert.equal(await map.getAttribute('data-frame'),'unknown');
  assert.match(await view.innerText(),/회전해 놓을 수/);
  assert.match(await page.locator('.paper-scene-toolbar').innerText(),/위치 미확인/);
  for(const p of ['O','X','Y'])assert.equal(await view.getByRole('button',{name:`${p} 기준점에 현재 위치 기록`}).isDisabled(),true,'DT fallback must not unlock capture');
  await page.screenshot({path:path.join(shots,'15-paper-unmeasured.png')});
  for(const [p,x,y] of [['O',240,-60],['X',326.60254,-10],['Y',190,26.60254]]){
   for(const [axis,value] of [['X',x],['Y',y],['Z',60],['R',0]])await view.getByLabel(`${p} 기준점 ${axis} 좌표 (${axis==='R'?'°':'mm'})`,{exact:true}).fill(String(value));
   await view.locator(`[data-paper-row="${p}"]`).getByRole('button',{name:'입력값 저장',exact:true}).click();
   await page.waitForFunction(p=>window.__paperScene().reference===p,p);
   if(p!=='Y')assert.equal(await map.getAttribute('data-frame'),'unknown');
  }
  assert.notEqual(await map.getAttribute('data-frame'),'unknown');
  await page.getByRole('button',{name:'장면에서 P2 선택',exact:true}).waitFor();
  assert.match(await map.innerText(),/교사 입력 · 측정값 아님/);
  assert.match(await map.innerText(),/로봇 X\+|로봇 Y\+/);
  assert.equal(await view.getByLabel('추가 회전 (°)',{exact:true}).count(),1);
  const before=await page.evaluate(()=>({records:Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)])),moves:window.__dt.length})),writesBefore=writes;
  await map.getByRole('button',{name:'도면에서 P2 선택',exact:true}).click();await page.getByRole('button',{name:'↺ 종이 시점',exact:true}).click();
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(shots,'16-paper-rotated-frame.png')});
  assert.deepEqual(await page.evaluate(()=>({records:Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)])),moves:window.__dt.length})),before);assert.equal(writes,writesBefore);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.locator('.journey-robot').screenshot({path:path.join(shots,'17-paper-mobile.png')});
  await page.getByRole('navigation',{name:'도형 수업 경로',exact:true}).getByRole('button').nth(1).click();
  await page.locator('.paper-scene-toolbar').waitFor({state:'detached'});assert.equal(await page.locator('[data-paper-sync]').count(),0);
  await view.waitFor({state:'detached'});await page.locator('main.curriculum-body').screenshot({path:path.join(shots,'18-basic-scope-preserved.png')});
  assert.deepEqual(errors,[]);console.log('PASS: initial live prediction; shared legends and selection; DT readout without capture permission; unknown/partial frames; recorded 30° rotation and provenance; camera and selection cause no writes/moves; mobile; scope cleanup.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
