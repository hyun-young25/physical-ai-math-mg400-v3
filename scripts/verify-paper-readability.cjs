// Exercise the real advanced lesson components in a bounded, scrollable lesson pane.
require('./isolated-ui-fixtures.cjs');
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fixture=require('./verify-revision-journey.cjs').fixture.replace('</head>',`<style>
html,body{height:100%;overflow:hidden}.journey-fixture{height:calc(100vh - 30px);box-sizing:border-box;overflow:hidden}
.journey-robot{height:100%;box-sizing:border-box;position:relative;top:0}.curriculum-body{height:100%;min-height:0;overflow:hidden}
@media(max-width:900px){.journey-fixture{display:grid;grid-template-columns:1fr;grid-template-rows:34% minmax(0,1fr)}.journey-robot{height:100%;margin:0}}
</style></head>`);
(async()=>{
 const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900}}),errors=[];let writes=0;
  await context.route('**/api/**',r=>{if(r.request().method()!=='GET')writes++;return r.fulfill({json:{}});});
  await context.route('**/__paper-readability',r=>r.fulfill({contentType:'text/html',body:fixture}));
  const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  const shots=process.env.DIAG_SHOTS||path.resolve(__dirname,'../../diagnosis-qa');fs.mkdirSync(shots,{recursive:true});
  await page.goto('http://localhost/__paper-readability');
  const dt=page.getByRole('button',{name:/종이 기준점 \(DT\)/}),hw=page.getByRole('button',{name:/종이 위 경로 확인 \(MG400\)/});
  await dt.click();
  const view=page.getByRole('region',{name:'종이 좌표 변환 학습'}),map=view.locator('.paper-scene-map'),host=page.locator('.paper-coordinate-host');
  const click=name=>view.getByRole('button',{name,exact:true}).click();
  await page.getByRole('button',{name:'장면에서 P3 선택',exact:true}).click();
  assert.equal(await map.getByRole('button',{name:'도면에서 P3 선택',exact:true}).getAttribute('aria-pressed'),'true');
  assert.match(await map.getByRole('status').innerText(),/P3 선택/);
  assert.equal(await map.locator('.paper-selection-halo').count(),1);
  await hw.click();
  await page.waitForFunction(()=>document.querySelector('.paper-coordinate-host').scrollTop===0);
  assert.equal(await map.locator('[aria-pressed=true]').count(),0,'no point from the previous level');
  await dt.click();await click('02 수학적 구조화');
  for(const [label,value] of [['원점 X (mm)','180'],['원점 Y (mm)','-60'],['1 cm당 길이 (mm)','10'],['이 관계를 선택한 이유','기준점과 종이 이동량을 더합니다.']])await view.getByLabel(label,{exact:true}).fill(value);
  await click('관계 저장');await click('03 표현·예측');
  const state=()=>page.evaluate(()=>({moves:window.__dt.length,records:JSON.stringify(localStorage)}));
  const before=await state(),writesBefore=writes;
  await page.getByRole('button',{name:'장면에서 P3 선택',exact:true}).click();
  await page.getByRole('button',{name:'↺ 종이 시점',exact:true}).click();
  assert.deepEqual(await state(),before);assert.equal(writes,writesBefore,'display controls do not persist or move');
  for(const [name,x,y] of [['P1',180,-60],['P2',290,-60],['P3',290,110],['P4',180,90]]){
   await view.getByLabel(`${name} 예측 로봇 X · mm`).fill(String(x));await view.getByLabel(`${name} 예측 로봇 Y · mm`).fill(String(y));
  }
  const visibleTogether=async name=>{
   const input=view.getByLabel(`${name} 예측 로봇 Y · mm`);await input.focus();
   // Focus itself does not promise scroll alignment. Reproduce typing, which does.
   await input.fill(await input.inputValue());
   const [m,i,h]=await Promise.all([map.boundingBox(),input.boundingBox(),host.boundingBox()]);
   assert.ok(m.y>=h.y-2&&m.y+m.height<=h.y+h.height+2,'whole compact map stays in lesson pane');
   assert.ok(i.y>=m.y+m.height-1&&i.y+i.height<=h.y+h.height+1,'focused input remains below the map and on screen');
  };
  await visibleTogether('P3');await page.screenshot({path:path.join(shots,'20-paper-pinned-input-desktop.png')});
  await page.setViewportSize({width:1280,height:800});await visibleTogether('P4');
  await page.screenshot({path:path.join(shots,'21-paper-pinned-input-laptop.png')});
  await page.setViewportSize({width:390,height:844});await visibleTogether('P3');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.screenshot({path:path.join(shots,'22-paper-pinned-input-mobile.png')});
  await page.setViewportSize({width:1440,height:900});await hw.click();
  await page.waitForFunction(()=>document.querySelector('.paper-coordinate-host').scrollTop===0);
  assert.equal(await map.locator('[aria-pressed=true]').count(),0);
  await page.screenshot({path:path.join(shots,'23-paper-level-reset.png')});
  for(const index of [0,1,2,3]){
   await page.getByRole('navigation',{name:'도형 수업 경로',exact:true}).getByRole('button').nth(index).click();
   assert.equal(await page.locator('[data-paper-sync]').count(),0);assert.equal(await page.locator('.paper-scene-toolbar').count(),0);
  }
  assert.deepEqual(errors,[]);console.log('PASS: prominent linked selection; no stale selection/scroll across levels; map and focused input visible at desktop/laptop/mobile; no moves or writes from display actions; basic/applied scope unchanged.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
