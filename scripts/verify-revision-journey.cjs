// Real lesson interactions with isolated storage, local resources and blocked external APIs.
require('./isolated-ui-fixtures.cjs');
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fixture=require('./verify-square-flow.cjs').fixture.replace("style:{height:1000,width:850}","className:'curriculum-body',style:{width:1000,display:'flex',flexDirection:'column'}");
(async()=>{
 const browser=await chromium.launch({args:['--disable-webgl','--disable-gpu']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1080}}),errors=[];
  await context.route('**/api/**',r=>r.fulfill({json:{}}));
  await context.route('**/__revision',r=>r.fulfill({contentType:'text/html',body:fixture}));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  await page.goto('http://localhost/__revision');
  await page.getByRole('button',{name:/종이 기준점 \(DT\)/}).click();
  const view=page.getByRole('region',{name:'종이 좌표 변환 학습'}),journey=page.getByTestId('revision-journey');
  const click=name=>view.getByRole('button',{name,exact:true}).click();
  const shots=process.env.DIAG_SHOTS||path.resolve(__dirname,'../../diagnosis-qa');fs.mkdirSync(shots,{recursive:true});
  const records=()=>page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith('physical-ai-paper-coordinate-v1')))||'[]'));
  async function predict(shift){
   await view.getByLabel('원점 X (mm)',{exact:true}).fill('180');await view.getByLabel('원점 Y (mm)',{exact:true}).fill('-60');
   await view.getByLabel('1 cm당 길이 (mm)').fill('10');await view.getByLabel('이 관계를 선택한 이유').fill(shift?'기준점을 20 mm 더해서 예상했습니다.':'피드백을 보고 기준점 180 mm에 종이 이동량만 더했습니다.');
   await click('관계 저장');await click('다음 단계');
   await view.getByLabel('직선 경로 명령').selectOption('MoveL');await view.getByLabel('닫힌 경로 ΔX 합').fill('0');await view.getByLabel('닫힌 경로 ΔY 합').fill('0');
   for(const [i,[x,y]] of [[180+shift,-60],[290+shift,-60],[290+shift,90],[180+shift,90]].entries()){
    await view.getByLabel(`P${i+1} 예측 로봇 X · mm`).fill(String(x));await view.getByLabel(`P${i+1} 예측 로봇 Y · mm`).fill(String(y));
   }
   await click('예측 저장');await click('다음 단계');
  }
  async function run(){
   await click('DT에서 확인');
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith('physical-ai-paper-coordinate-v1')))||'[]').at(-1)?.run?.status==='completed',null,{timeout:45000});
   await click('다음 단계');await click('다음 단계');
  }
  await click('다음 단계');await predict(20);await run();
  assert.equal(await journey.getAttribute('data-result'),'pending');
  assert.match(await journey.innerText(),/첫 시도 → 피드백 → 답 수정 → 재실행 결과/);
  const initial=(await records())[0];assert.notEqual(initial.diagnosis.pattern,'match');
  const firstQuestion=await journey.locator('.revision-question').innerText();
  const diagnostic=page.getByTestId('square-diagnosis');
  assert.match(await diagnostic.locator('.square-decision-section').first().innerText(),/먼저 이 질문/);
  assert.equal(await diagnostic.getByText('규칙 기반 판정',{exact:true}).isVisible(),false);
  await view.getByLabel('차이가 생긴 이유').fill('피드백의 기준점 질문을 보고 모든 X에 20을 더한 부분을 찾았습니다.');await click('생각 저장');await click('다음 단계');
  await view.getByLabel('무엇을 다시 살펴볼까요?').fill('기준점 질문을 보고 불필요하게 더한 20 mm를 빼겠습니다.');
  await click('이유와 수정 기록');
  const reference=view.getByRole('complementary',{name:'수정하며 참고할 첫 시도와 피드백'});
  await reference.waitFor();assert.match(await reference.innerText(),/200/);
  await predict(0);
  assert.equal(await journey.getAttribute('data-result'),'pending');assert.equal(await journey.locator('.revision-result').count(),0);
  assert.equal((await records())[0].predictions[0].robotX,'200');
  await run();
  assert.equal(await journey.getAttribute('data-result'),'complete');
  assert.equal(await journey.locator('[data-success="true"]').count(),1);
  assert.equal(await journey.locator('[data-journey-series]').count(),3);
  const final=await records();assert.equal(final[1].parentAttemptId,final[0].id);assert.equal(final[1].diagnosis.pattern,'match');
  assert.deepEqual(final[0].predictions,initial.predictions);assert.equal(final[0].transform.explanation,initial.transform.explanation);
  await journey.screenshot({path:path.join(shots,'09-revision-result-desktop.png')});
  await page.setViewportSize({width:390,height:844});await page.locator('main.curriculum-body').evaluate(el=>el.style.width='100%');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await journey.screenshot({path:path.join(shots,'10-revision-result-mobile.png')});
  await view.getByLabel('차이가 생긴 이유').fill('기준점에 종이 이동량을 더하니 목표와 일치합니다.');await click('생각 저장');
  await click('다음 단계');await view.getByLabel('무엇을 다시 살펴볼까요?').fill('다음 수정도 처음 답과 질문을 참고합니다.');
  assert.doesNotMatch(await journey.locator('.revision-flow > li').nth(2).innerText(),/다음 수정도/,'a new draft must not rewrite the completed comparison');
  assert.notEqual(await reference.locator('.revision-question').innerText(),firstQuestion,'the editing reference uses the latest feedback for the next revision');
  await reference.screenshot({path:path.join(shots,'11-revision-reference-mobile.png')});
  await page.setViewportSize({width:1440,height:1080});await page.locator('main.curriculum-body').evaluate(el=>el.style.width='1000px');
  await view.locator('.revision-workspace').screenshot({path:path.join(shots,'12-revision-editing-desktop.png')});
  assert.deepEqual(errors,[]);
  console.log('PASS: wrong DT attempt → question first → preserved reference while editing → pending result → corrected run and overlay; original evidence retained; mobile fits.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
