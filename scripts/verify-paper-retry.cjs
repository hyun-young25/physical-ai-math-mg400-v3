// Real lesson components, isolated storage/HTTP and simulated DT only. No live robot or publication.
require('./isolated-ui-fixtures.cjs');
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const fixture=require('./verify-revision-journey.cjs').fixture.replace('</head>',`<style>
html,body{height:100%;overflow:hidden}.journey-fixture{height:calc(100vh - 30px);box-sizing:border-box;overflow:hidden}
.journey-robot{height:100%;box-sizing:border-box;position:relative;top:0}.curriculum-body{height:100%;min-height:0;overflow:hidden}
</style></head>`);
const apiCache={};function api(n){if(apiCache[n])return apiCache[n];const out=apiCache[n]={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../artifacts/api-server/src/lib/'+n+'.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(out,d=>api(d.replace('./','')));return out;}
(async()=>{
 // Existing scene/readability/journey tests cover WebGL. Keep this longer
 // interaction suite deterministic on CI; opt in to GPU screenshots locally.
 const webgl=process.env.PAPER_RETRY_WEBGL==='1';
 const browser=await chromium.launch({args:webgl?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:['--disable-webgl','--disable-gpu']});
 const shots=process.env.DIAG_SHOTS||path.resolve(__dirname,'../../diagnosis-qa');fs.mkdirSync(shots,{recursive:true});
 try{
 for(const rotated of [false,true]){
  const context=await browser.newContext({viewport:{width:1280,height:720}}),errors=[];
  await context.route('**/api/**',r=>r.fulfill({json:{}}));await context.routeWebSocket('**',ws=>ws.close());
  await context.route('**/__paper-retry',r=>r.fulfill({contentType:'text/html',body:fixture}));
  const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost/__paper-retry');
  await page.getByRole('button',{name:rotated?/종이 위 경로 확인 \(MG400\)/:/종이 기준점 \(DT\)/}).click();
  const view=page.getByRole('region',{name:'종이 좌표 변환 학습'}),map=view.locator('.paper-scene-map');
  const click=async n=>{
   const button=view.getByRole('button',{name:n,exact:true});await button.scrollIntoViewIfNeeded();
   assert.ok(await button.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return el===hit||el.contains(hit);}),`${n}: actual pointer target must not be covered by the map`);
   await button.click();
  };
  const records=()=>page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith('physical-ai-paper-coordinate-v1')))||'[]'));
  const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith('physical-ai-square-attempts-v1')))||'[]'));
  const prefix=(webgl?'':'fallback-')+(rotated?'advanced2':'advanced1');
  assert.equal(await map.locator('[aria-pressed=true]').count(),0);
  assert.doesNotMatch(await map.getByRole('status').innerText(),/Y 선택/);
  const ox=rotated?240:180,oy=-60,a=(rotated?30:0)*Math.PI/180;
  if(rotated){
   for(const [name,x,y] of [['O',0,0],['X',100,0],['Y',0,100]]){
    for(const [axis,value] of [['X',ox+x*Math.cos(a)-y*Math.sin(a)],['Y',oy+x*Math.sin(a)+y*Math.cos(a)],['Z',60],['R',0]])await view.getByLabel(`${name} 기준점 ${axis} 좌표 (${axis==='R'?'°':'mm'})`,{exact:true}).fill(String(value));
    await view.locator(`[data-paper-row="${name}"]`).getByRole('button',{name:'입력값 저장',exact:true}).click();
   }
  }else await click('다음 단계');
  for(const [label,value] of [['원점 X (mm)',String(ox)],['원점 Y (mm)',String(oy)],['1 cm당 길이 (mm)','10'],['이 관계를 선택한 이유','종이 기준점과 이동량을 더합니다.']])await view.getByLabel(label,{exact:true}).fill(value);
  if(rotated){await view.getByLabel('종이 x축이 향하는 방향').selectOption('x+');await view.getByLabel('추가 회전 (°)',{exact:true}).fill('30');}
  await click('관계 저장');await click('다음 단계');
  await view.getByLabel('직선 경로 명령').selectOption('MoveL');await view.getByLabel('닫힌 경로 ΔX 합').fill('0');await view.getByLabel('닫힌 경로 ΔY 합').fill('0');
  const values=[[0,0],[110,0],[110,150],[0,150]].map(([x,y])=>[ox+x*Math.cos(a)-y*Math.sin(a),oy+x*Math.sin(a)+y*Math.cos(a)]);
  for(const [i,[x,y]] of values.entries()){
   await view.getByLabel(`P${i+1} 예측 로봇 X · mm`).fill(String(x+(i===2?20:0)));await view.getByLabel(`P${i+1} 예측 로봇 Y · mm`).fill(String(y));
  }
  const mapWidth=(await map.locator('svg').boundingBox()).width;assert.ok(mapWidth>=260&&mapWidth<=300,'compact diagram 260–300 px');
  const font=await map.locator('[aria-label="도면에서 P3 선택"] text').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)*el.getScreenCTM().a);assert.ok(font>=12);
  await map.getByRole('button',{name:'크게 보기',exact:true}).click();assert.ok((await map.locator('svg').boundingBox()).width>mapWidth);
  await page.screenshot({path:path.join(shots,`${prefix}-expanded-map.png`)});await map.getByRole('button',{name:'접기',exact:true}).click();
  await click('예측 저장');await click('다음 단계');if(rotated)await view.getByLabel('펜 들기 높이',{exact:true}).fill('80');
  async function run(){await click('DT에서 확인');await page.waitForFunction(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith('physical-ai-paper-coordinate-v1')))||'[]').at(-1)?.run?.status==='completed',null,{timeout:45000});await click('다음 단계');}
  await run();
  assert.match(await page.locator('.square-type-badge').innerText(),/대입·계산 차이 · P3/);
  await click('다음 단계');
  assert.match(await page.locator('.square-type-badge').innerText(),/대입·계산 차이 · P3/);
  assert.doesNotMatch(await page.getByTestId('paper-diagnosis-visual').innerText(),/축·길이 뒤바뀜/);
  assert.match(await page.getByTestId('paper-diagnosis-visual').innerText(),/내 변환식에 종이 좌표/);
  const first=(await records())[0];
  const judgment=await page.evaluate(()=>JSON.parse(window.__tutor().context.judgment));assert.equal(first.diagnosis.pattern,'calculation');assert.equal(judgment.method,'rule-based');assert.equal(judgment.status,'complete');assert.equal(judgment.firstMismatch,first.diagnosis.firstMismatch);assert.equal(judgment.candidate,first.diagnosis.candidate);assert.deepEqual(judgment.predictionEvidence,first.diagnosis.predictionEvidence);
  assert.match((await saved())[0].visual.diagnosis.label,/^대입·계산 차이 · P3/);
  await page.getByTestId('paper-diagnosis-visual').screenshot({path:path.join(shots,`${prefix}-diagnosis.png`)});
  await view.getByLabel('차이가 생긴 이유').fill('P3의 X 대입값을 다시 확인했습니다.');await click('생각 저장');await click('다음 단계');
  await view.getByLabel('무엇을 다시 살펴볼까요?').fill('피드백을 보고 P3의 X만 수정합니다.');await click('이유와 수정 기록');
  await view.getByTestId('paper-retry-note').waitFor();
  assert.equal(await view.getByLabel('직선 경로 명령').inputValue(),'MoveL');assert.equal(await view.getByLabel('닫힌 경로 ΔX 합').inputValue(),'0');
  const fields=await view.locator('[data-retry-difference=true]').evaluateAll(es=>es.map(e=>e.dataset.retryField));assert.deepEqual(fields,['P3.robotX']);
  assert.equal(await view.getByLabel('P3 예측 로봇 X · mm').evaluate(el=>el===document.activeElement),true);
  const afterRevision=(await records())[0],child=(await records())[1];
  assert.deepEqual(child.transform,first.transform);assert.deepEqual(child.predictions,first.predictions);assert.equal(child.planHash,undefined);assert.equal(child.run,undefined);assert.equal(child.dtRunPlanHash,undefined);
  for(const [i,[x,y]] of values.entries())assert.equal(await view.getByLabel(`P${i+1} 예측 로봇 X · mm`).inputValue(),String(x+(i===2?20:0)));
  await page.screenshot({path:path.join(shots,`${prefix}-retry-prefilled.png`)});
  // Returning to a saved retry must not autofocus or inherit a selected point.
  await page.getByRole('navigation',{name:'도형 수업 경로',exact:true}).getByRole('button').nth(0).click();
  await page.getByRole('button',{name:rotated?/종이 위 경로 확인 \(MG400\)/:/종이 기준점 \(DT\)/}).click();
  assert.equal(await map.locator('[aria-pressed=true]').count(),0);
  await page.getByTestId('revision-scene-dock').getByRole('button',{name:'P3',exact:true}).click();
  assert.equal(await map.getByRole('button',{name:'도면에서 P3 선택',exact:true}).getAttribute('aria-pressed'),'true');
  // Saving the same relationship must not erase the inherited coordinates.
  await click('관계식·이유 확인');assert.equal(await view.getByLabel('원점 X (mm)',{exact:true}).inputValue(),String(ox));await click('관계 저장');await click('다음 단계');
  assert.equal(await view.getByLabel('P3 예측 로봇 X · mm').inputValue(),String(values[2][0]+20));
  await view.getByLabel('P3 예측 로봇 X · mm').fill(String(values[2][0]));assert.equal(await view.locator('.pcv-retry-changed').count(),1);
  await click('예측 저장');await click('다음 단계');await run();await click('다음 단계');
  assert.match(await page.locator('.square-type-badge').innerText(),/예측과 실행 일치/);
  const final=await records();assert.equal(final[1].diagnosis.pattern,'match');assert.deepEqual(final[0],afterRevision,'first attempt remains byte-for-byte unchanged after correction');
  const dock=page.getByTestId('revision-scene-dock');await dock.getByRole('button',{name:/4.*재실행 결과/}).click();
  if(webgl)await page.getByRole('button',{name:'장면에서 P3 선택',exact:true}).click();
  else await map.getByRole('button',{name:'도면에서 P3 선택',exact:true}).click();
  assert.equal(await map.getByRole('button',{name:'도면에서 P3 선택',exact:true}).getAttribute('aria-pressed'),'true');
  assert.match(await dock.innerText(),/목표점[\s\S]*첫 실행[\s\S]*수정 후 실행/);
  assert.equal(await map.locator('[data-paper-series]').count(),3);
  await page.locator('.journey-robot').screenshot({path:path.join(shots,`${prefix}-rerun-robot.png`)});
  await map.screenshot({path:path.join(shots,`${prefix}-rerun-map.png`)});
  const attempts=await saved(),csv=api('squareAttemptCsv'),rows=attempts.flatMap(payload=>csv.attemptRows({account_id:'isolated-test',visit_id:'test',record_id:payload.recordId,payload}));
  assert.equal(rows.length,2);assert.equal(csv.ATTEMPT_HEADERS.length,26);
  assert.deepEqual(csv.ATTEMPT_HEADERS.slice(-4),['provenance','parentAttemptId','revisionReason','aiAnalyses']);
  assert.notEqual(rows[0].runId,rows[1].runId);
  assert.deepEqual(rows[0].predictions.points,first.predictions);assert.equal(rows[1].predictions.points[2].robotX,String(values[2][0]));
  fs.writeFileSync(path.join(shots,`${prefix}-attempts.csv`),csv.ATTEMPT_HEADERS.join(',')+'\r\n'+rows.map(csv.attemptCsvLine).join(''));
  await view.getByLabel('차이가 생긴 이유').fill('수정한 예측으로 목표와 일치했습니다.');await click('생각 저장');await click('다음 단계');await view.getByLabel('무엇을 다시 살펴볼까요?').fill('빈 입력으로도 확인합니다.');await click('이유와 수정 기록');
  await click('처음부터 다시 입력');assert.equal(await view.getByLabel('원점 X (mm)',{exact:true}).inputValue(),'');assert.deepEqual((await records())[0],afterRevision);
  // Re-entering a lesson with saved history must also start with no selected point.
  const nav=page.getByRole('navigation',{name:'도형 수업 경로',exact:true});await nav.getByRole('button').nth(0).click();
  assert.equal(await page.locator('[data-paper-sync]').count(),0);
  await page.getByRole('button',{name:rotated?/종이 위 경로 확인 \(MG400\)/:/종이 기준점 \(DT\)/}).click();
  assert.equal(await map.locator('[aria-pressed=true]').count(),0);
  await page.screenshot({path:path.join(shots,`${prefix}-entry-no-selection.png`)});
   assert.deepEqual(errors,[]);console.log(`PASS ${prefix}: single diagnosis, carry/focus/edit, immutable first run, linked 3D/2D result, separate 26-column CSV rows, reset, no initial selection, larger map.`);
  await context.close();
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
