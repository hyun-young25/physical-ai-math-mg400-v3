// Real lesson interactions with isolated storage, local resources and blocked external APIs.
require('./isolated-ui-fixtures.cjs');
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fixture=require('./verify-square-flow.cjs').fixture
 .replace('</head>',`<style>body{margin:0;font-family:Arial,sans-serif;color:#243f5b;background:#f3f6fa}.journey-fixture{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:14px;padding:12px}.journey-robot{height:850px;position:sticky;top:12px;border:1px solid #cbd5e1;border-radius:12px;overflow:hidden}.curriculum-body{min-width:0;display:flex;flex-direction:column}@media(max-width:900px){.journey-fixture{display:block;padding:6px}.journey-robot{position:relative;top:0;height:680px;margin-bottom:10px}}</style></head>`)
 .replace("const {RobotArm}=", "const {RobotScene}=await import('/src/Robot3D.tsx');const {revisionSceneSnapshot}=await import('/src/revisionSceneStore.ts');window.__revisionScene=revisionSceneSnapshot;const {RobotArm}=")
 .replace("h('main',{style:{height:1000,width:850}},h(RobotArm,{", "h('div',{className:'journey-fixture'},h('div',{className:'journey-robot'},h(RobotScene,{joints:joints.current,coords,endEffector:'pen',shapeStudyViewKey:1})),h('main',{className:'curriculum-body'},h(RobotArm,{")
 .replace("})),h(TutorHost)","}))),h(TutorHost)");
module.exports.fixture=fixture;
if(require.main===module)(async()=>{
 const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1080}}),errors=[];
  await context.route('**/api/**',r=>r.fulfill({json:{}}));
  await context.route('**/__revision',r=>r.fulfill({contentType:'text/html',body:fixture}));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(30000);
  await page.goto('http://localhost/__revision');
  await page.getByRole('button',{name:/종이 기준점 \(DT\)/}).click();
  const view=page.getByRole('region',{name:'종이 좌표 변환 학습'}),journey=page.getByTestId('revision-journey');
  const dock=page.getByTestId('revision-scene-dock');
  const report=async()=>{if(!await journey.locator('.revision-report').evaluate(el=>el.open))await journey.getByText('좌표·생각 변화 상세 기록',{exact:true}).click();};
  const click=name=>view.getByRole('button',{name,exact:true}).click();
  const shots=process.env.DIAG_SHOTS||path.resolve(__dirname,'../../diagnosis-qa');fs.mkdirSync(shots,{recursive:true});
  const records=()=>page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith('physical-ai-paper-coordinate-v1')))||'[]'));
  await page.getByRole('button',{name:'장면에서 P1 선택',exact:true}).waitFor();
  assert.equal(await view.locator('.paper-scene-map').getAttribute('data-frame')==='unknown',false);
  assert.equal(await page.locator('.paper-scene-legend').count(),2);
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
  assert.ok(await view.locator('.paper-scene-map [stroke="#ef4444"]').count()>0);
  assert.equal(await page.getByRole('button',{name:'장면에서 P2 선택',exact:true}).evaluate(el=>getComputedStyle(el).borderTopColor),'rgb(239, 68, 68)');
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(shots,'19-paper-first-mismatch.png')});
  await report();await dock.waitFor();
  const firstQuestion=await journey.locator('.revision-question').innerText();
  const diagnostic=page.getByTestId('square-diagnosis');
  assert.match(await diagnostic.locator('.square-decision-section').first().innerText(),/먼저 이 질문/);
  assert.equal(await diagnostic.getByText('규칙 기반 판정',{exact:true}).isVisible(),false);
  await view.getByLabel('차이가 생긴 이유').fill('피드백의 기준점 질문을 보고 모든 X에 20을 더한 부분을 찾았습니다.');await click('생각 저장');await click('다음 단계');
  await view.getByLabel('무엇을 다시 살펴볼까요?').fill('기준점 질문을 보고 불필요하게 더한 20 mm를 빼겠습니다.');
  await click('이유와 수정 기록');
  const reference=view.getByRole('complementary',{name:'수정하며 참고할 첫 시도와 피드백'});
  await reference.waitFor();await reference.getByText('처음 좌표와 예측 근거',{exact:true}).click();assert.match(await reference.innerText(),/200/);
  await reference.getByText('처음 좌표와 예측 근거',{exact:true}).click();
  await predict(0);
  assert.equal(await journey.getAttribute('data-result'),'pending');assert.equal(await journey.locator('.revision-result').count(),0);
  assert.equal((await records())[0].predictions[0].robotX,'200');
  await run();
  await report();
  assert.equal(await journey.getAttribute('data-result'),'complete');
  assert.equal(await journey.locator('[data-success="true"]').count(),1);
  assert.equal(await journey.locator('[data-journey-series]').count(),3);
  const final=await records();assert.equal(final[1].parentAttemptId,final[0].id);assert.equal(final[1].diagnosis.pattern,'match');
  assert.deepEqual(final[0].predictions,initial.predictions);assert.equal(final[0].transform.explanation,initial.transform.explanation);
  await page.getByRole('button',{name:'장면에서 P1 선택',exact:true}).waitFor();
  await dock.getByRole('button',{name:'P1',exact:true}).click();
  assert.match(await dock.innerText(),/첫 실행[\s\S]*200, -60[\s\S]*수정 후 실행[\s\S]*180, -60/);
  const before={records:await records(),moves:await page.evaluate(()=>window.__dt.length)};
  await dock.getByRole('button',{name:'P2',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="장면에서 P2 선택"]')?.getAttribute('aria-pressed')==='true');
  assert.equal(await page.getByRole('button',{name:'장면에서 P2 선택'}).getAttribute('aria-pressed'),'true');
  assert.match(await dock.innerText(),/310, -60[\s\S]*290, -60/);
  await dock.getByRole('button',{name:/3.*답 수정/}).click();
  await dock.getByText('┄ 저장한 수정 예측',{exact:true}).waitFor();
  assert.match(await dock.innerText(),/저장한 수정 예측/);
  await dock.getByRole('button',{name:/4.*재실행 결과/}).click();
  assert.deepEqual({records:await records(),moves:await page.evaluate(()=>window.__dt.length)},before,'phase/point selection must not execute or change records');
  await journey.getByText('좌표·생각 변화 상세 기록',{exact:true}).click();
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:path.join(shots,'09-revision-result-desktop.png')});
  await page.locator('.journey-robot').screenshot({path:path.join(shots,'13-robot-and-revision.png')});
  await journey.getByRole('button',{name:/2.*피드백/}).click();
  await page.waitForFunction(()=>window.__revisionScene().phase===1);
  await dock.getByText('━ 피드백 받은 실행',{exact:true}).waitFor();
  await journey.getByRole('button',{name:/4.*재실행 결과/}).click();
  await page.locator('.square-attempt-history').getByRole('button',{name:/시도 1 ·/}).click();
  await dock.waitFor({state:'hidden'});await page.getByTestId('square-scene-comparison').waitFor();
  await page.locator('.square-attempt-history').getByRole('button',{name:'현재 시도로 돌아가기',exact:true}).click();
  await dock.waitFor();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.locator('.journey-robot').screenshot({path:path.join(shots,'10-revision-result-mobile.png')});
  await view.getByLabel('차이가 생긴 이유').fill('기준점에 종이 이동량을 더하니 목표와 일치합니다.');await click('생각 저장');
  await click('다음 단계');await view.getByLabel('무엇을 다시 살펴볼까요?').fill('다음 수정도 처음 답과 질문을 참고합니다.');
  await report();
  assert.doesNotMatch(await journey.locator('.revision-flow > li').nth(2).innerText(),/다음 수정도/,'a new draft must not rewrite the completed comparison');
  assert.notEqual(await reference.locator('.revision-question').innerText(),firstQuestion,'the editing reference uses the latest feedback for the next revision');
  await reference.screenshot({path:path.join(shots,'11-revision-reference-mobile.png')});
  // Desktop scene, mobile scene and editing reference are already captured.
  // Avoid a redundant second GPU resize/capture in Linux headless Chromium.
  await page.getByRole('navigation',{name:'도형 수업 경로',exact:true}).getByRole('button').nth(1).click();
  await dock.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'장면에서 P2 선택'}).waitFor({state:'detached'});
  assert.equal(await page.getByRole('button',{name:'장면에서 P2 선택'}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: wrong DT attempt → question first → preserved reference while editing → pending result → corrected run and overlay; original evidence retained; mobile fits.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
