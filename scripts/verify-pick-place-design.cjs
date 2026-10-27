// Full seven-stage lesson QA. Isolated browser storage; only MOCK robot replies.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { installMockBridge } = require('./mg400-mock-socket.cjs');
const URL = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/` : 'http://localhost:80/';
const KEY = 'physical-ai-pickplace-design-v1';
const roles = ['approach','contact','grip','lift','transfer','above','lower','release','retreat'];
const summaries = [], errors = [];
let browser, page;
const fixture = level => {
  const src = {x:280,y:-100,z:220,r:0}, dst = {x:280,y:80,z:level===1?220:240,r:0};
  const travel = Math.max(src.z,dst.z)+(level===1?40:55)+15;
  return { travel, targets:[{...src,z:travel},src,src,{...src,z:travel},{...dst,z:travel},
    {...dst,z:travel},dst,dst,{...dst,z:travel}] };
};
const records = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)||'[]'),KEY);
const last = async () => (await records()).sort((a,b)=>a.at.localeCompare(b.at)).at(-1);
const stage = async value => { await page.waitForFunction(v=>document.querySelector('.pick-place-chapter')?.dataset.stage===v,value); };
const chapter = () => page.locator('.pick-place-chapter');
const button = text => chapter().getByRole('button',{name:text,exact:true});
const confirm = () => page.getByTestId('button-confirm-ok').click();
async function plan(level, support, {bad=false,relative=false}={}) {
  const f=fixture(level);
  if(level<3) await chapter().getByLabel('학습 지원',{exact:true}).selectOption(support);
  assert.equal(await chapter().locator('.pp-stages button').count(),7);
  await button('관계 정하기').click(); await stage('relations');
  const selects=chapter().locator('.pp-field select');
  for(const [i,v] of ['B=A+Δ','TCP=top','travelZ>=min','XY constant'].entries()) await selects.nth(i).selectOption(v);
  await chapter().getByLabel('운반 Z (mm)',{exact:true}).fill(String(f.travel));
  await button('동작 계획으로').click(); await stage('plan');
  if(level===3) for(const role of roles) await chapter().getByLabel('역할 추가',{exact:true}).selectOption(role);
  let from={x:250,y:-150,z:300,r:0};
  for(let i=0;i<9;i++) {
    const row=chapter().locator('.pp-cmd').nth(i), target={...f.targets[i]};
    if(bad && i===1) target.z=225; // stays above the block: pickup must fail, never succeed.
    if(![2,7].includes(i)) {
      await row.getByLabel('입력 방식',{exact:true}).selectOption(relative?'relative':'absolute');
      await row.getByLabel('동작 종류',{exact:true}).selectOption(i===0?'MoveJ':'MoveL');
      for(const [k,axis] of ['x','y','z'].entries())
        await row.locator('.pp-xyz').nth(0).locator('input').nth(k).fill(String(relative?target[axis]-from[axis]:target[axis]));
    }
    for(const [k,axis] of ['x','y','z'].entries())
      await row.locator('.pp-xyz').last().locator('input').nth(k).fill(String(target[axis]));
    from=target;
  }
  await chapter().getByLabel('예측 이유',{exact:true}).fill('자동검증 전용: 접촉면에 도달하고 충분히 상승한 뒤 이송하고 수직으로 놓는다.');
  await button('실행 단계로').click(); await stage('execution');
  console.log(`PLAN level ${level}/${support}`);
  assert.equal(await chapter().getByRole('heading',{name:'실행 완료 · 성공',exact:true}).count(),0,'fresh plan cannot display an old result');
}
async function runVirtual(pass=true) {
  await button('가상 실행 시작').click({timeout:60000});
  await stage('observation');
  const r=await last();
  console.log(`OBSERVATION level ${r.level}: ${r.result?.passed ? 'pass' : 'expected failure'}`);
  assert.equal(r.source,'dt'); assert.equal(r.status,'completed'); assert.equal(r.result.passed,pass);
  if(pass) {
    assert.equal(r.observations.length,9);
    assert.ok(r.frames.some(f=>f.workpieces[0].owner==='A'),'block must actually be held during transport');
    assert.equal(r.frames.at(-1).workpieces[0].placed,true);
    assert.equal(r.frames.at(-1).workpieces[0].owner,null);
    assert.equal(await chapter().getByRole('heading',{name:'실행 완료 · 성공',exact:true}).count(),1);
    for(const index of [2,4,7]) {
      await chapter().locator('.pp-table tbody tr').nth(index).locator('button').click();
      assert.equal(await chapter().locator('.pp-table tbody tr').nth(index).getAttribute('aria-selected'),'true');
    }
    await button('마지막 상태 보기').click();
  } else assert.equal(await chapter().getByRole('heading',{name:'실행 완료 · 성공',exact:true}).count(),0);
  return r;
}
async function compareAndReflect() {
  await chapter().getByLabel('관찰한 점',{exact:true}).fill('자동검증 전용: 집기, 운반, 놓기의 TCP와 물체 상태를 비교했다.');
  await button('관찰 저장').click(); await button('비교로').click(); await stage('compare');
  await chapter().getByLabel('설명 (교사가 확인합니다)',{exact:true}).fill('자동검증 전용: 예측 좌표와 관찰 좌표의 차이를 확인했다.');
  await button('설명 저장').click();
  assert.equal((await last()).teacherReview.status,'pending','student explanations are not auto-graded');
}
async function revise(level) {
  await chapter().locator('.pp-stages button').nth(6).click(); await stage('revision');
  const before=await last();
  await chapter().getByLabel('수정 이유',{exact:true}).fill('자동검증 전용: 접촉 높이를 수정하고 좌표·예측을 다시 검증한다.');
  await button('수정해서 다시 시도').click(); await stage('plan');
  assert.equal(await chapter().locator('.pp-cmd').count(),9);
  const f=fixture(level);
  for(let i=0;i<9;i++) {
    const row=chapter().locator('.pp-cmd').nth(i);
    if(![2,7].includes(i)) for(const [k,a] of ['x','y','z'].entries())
      await row.locator('.pp-xyz').first().locator('input').nth(k).fill(String(f.targets[i][a]));
    for(const [k,a] of ['x','y','z'].entries())
      await row.locator('.pp-xyz').last().locator('input').nth(k).fill(String(f.targets[i][a]));
  }
  await chapter().getByLabel('예측 이유',{exact:true}).fill('자동검증 전용: 수정한 접촉 높이로 다시 집고 운반·놓기를 예측한다.');
  await button('실행 단계로').click(); await stage('execution'); await runVirtual();
  const after=await last(); assert.equal(after.revisionOf,before.id);
  assert.ok((await records()).some(r=>r.id===before.id),'revision preserves the previous attempt');
  await compareAndReflect();
}
async function interruptVirtual(kind) {
  const completed=await last();
  await chapter().locator('.pp-stages button').nth(6).click(); await stage('revision');
  await chapter().getByLabel('수정 이유',{exact:true}).fill(`자동검증 전용: 가상 실행 중 ${kind} 후 지연 결과가 남지 않는지 확인한다.`);
  await button('수정해서 다시 시도').click(); await stage('plan');
  await chapter().getByLabel('예측 이유',{exact:true}).fill('자동검증 전용: 이전 계획을 그대로 재실행하여 중단 동작을 확인한다.');
  await button('실행 단계로').click(); await stage('execution');
  await button('가상 실행 시작').click();
  await page.waitForFunction(()=>Number(document.querySelector('.pp-progress')?.getAttribute('aria-valuenow'))>0);
  const running=await last();assert.equal(running.status,'running');
  await button(kind==='reset'?'과제 초기화':'중지').click();
  await stage(kind==='reset'?'task':'observation');
  const stopped=await last();assert.equal(stopped.id,running.id);
  assert.equal(stopped.status,'stopped');assert.equal(stopped.result,undefined);
  assert.ok(stopped.observations.length<9);
  await page.waitForTimeout(1000);
  assert.deepEqual(await last(),stopped,'cancelled callbacks cannot add frames or a success later');
  assert.equal(await chapter().getByRole('heading',{name:'실행 완료 · 성공',exact:true}).count(),0);
  assert.deepEqual((await records()).find(r=>r.id===completed.id).result,completed.result);
  summaries.push({virtualInterrupt:kind,delayedSuccess:false,historyPreserved:true});
  console.log(`VIRTUAL ${kind}: stopped prefix only, no late success`);
}
async function mockCopy(mock, stopKind) {
  const original=await last(), before=await records(), requestCount=mock.requests.length;
  await page.getByTestId('button-reuse-hardware').click(); await stage('execution');
  assert.equal(mock.requests.length,requestCount,'copying a plan must not connect or actuate');
  assert.equal(await page.getByTestId('button-run-hardware').isDisabled(),true,'no measurement means no execution');
  await page.getByTestId('button-practice-panel').click();
  assert.equal(await page.getByTestId('input-robot-ip').inputValue(), '192.168.1.6');
  await page.getByTestId('button-bridge-connect').click();
  await page.getByText('모의 통신 · 실측 아님',{exact:true}).first().waitFor();
  for(const flag of ['firmware','network','coordinates','tool','io','workspace']) await page.getByTestId('check-'+flag).check();
  await page.getByTestId('button-apply-setup').click(); await confirm();
  assert.equal(mock.requests.slice(requestCount).filter(r=>r.type==='execute').length,0);
  await page.getByTestId('button-servo-on').click(); await confirm();
  await page.waitForFunction(()=>document.querySelector('[data-testid=button-servo-off]')?.disabled===false);
  await page.getByTestId('button-practice-panel').click();
  const base=mock.requests.length;
  await page.getByTestId('button-run-hardware').click(); await page.getByTestId('button-confirm-cancel').click();
  assert.equal(mock.requests.length,base); assert.deepEqual(await records(),before);
  if(stopKind) mock.delay=300;
  await page.getByTestId('button-run-hardware').click(); await confirm();
  if(stopKind) {
    // Allow approach/contact/grip measurements to be recorded before interrupting lift.
    while(mock.requests.slice(base).filter(r=>r.type==='execute').length<4) await page.waitForTimeout(50);
    if(stopKind==='drop') mock.drop(); else await button('중지').click();
  }
  await stage('observation');
  const r=await last();
  assert.equal(r.source,'mock'); assert.equal(r.physicalObjectVerified,false);
  assert.equal(r.virtualReferenceId,original.id); assert.equal(r.result,undefined);
  assert.deepEqual(r.commands,original.commands); assert.deepEqual(r.relations,original.relations);
  assert.ok(r.frames.every(f=>f.workpieces.length===0),'no predicted objects in measured evidence');
  assert.ok(r.observations.every(o=>o.state==='unknown'));
  if(stopKind) { assert.equal(r.status,'stopped'); assert.ok(r.observations.length<9); }
  else {
    assert.equal(r.status,'completed'); assert.equal(r.observations.length,9);
    assert.equal(await chapter().getByRole('heading',{name:'모의 기록 완료 · 물체 상태는 확인 안 됨',exact:true}).count(),1);
  }
  assert.deepEqual((await records()).find(r=>r.id===original.id),original,'virtual evidence must remain unchanged');
  assert.equal(await chapter().getByRole('heading',{name:'실행 완료 · 성공',exact:true}).count(),0);
  summaries.push({mock:stopKind||'complete',observations:r.observations.length,object:'unknown'});
  console.log(`MOCK ${stopKind||'complete'}: ${r.status}, ${r.observations.length} observations, no physical success`);
}
(async()=>{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/repl/tools/bin/chromium',
    args:['--disable-gpu','--enable-unsafe-swiftshader']});
  for(const support of ['guided','challenge']) {
    const context=await browser.newContext({viewport:{width:1440,height:960}});
    // Optional slow-frame device coverage; normal runs use the real browser RAF.
    const frameDelay=Number(process.env.QA_FRAME_DELAY_MS||0);
    if(frameDelay>0) await context.addInitScript(delay => {
      const timers=new Map();let id=0;
      window.requestAnimationFrame=callback=>{
        const key=++id;timers.set(key,setTimeout(()=>{timers.delete(key);callback(performance.now());},delay));return key;
      };
      window.cancelAnimationFrame=key=>{clearTimeout(timers.get(key));timers.delete(key);};
    },frameDelay);
    const mock=await installMockBridge(context);
    page=await context.newPage();page.setDefaultTimeout(60000);
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(URL);
    await page.getByText('☰',{exact:true}).click();
    await page.getByRole('navigation',{name:'학습 목차'}).getByRole('button',{name:/픽앤플레이스/}).click();
    await stage('task');
    for(const level of [1,2,3]) {
      console.log(`START level ${level}/${support}`);
      await plan(level,support,{bad:level===1});
      await runVirtual(level!==1); await compareAndReflect();
      await revise(level);
      summaries.push({level,support:level===3?'direct':support,sevenStages:true,revision:true});
      if(support==='guided' && level===1) await mockCopy(mock,null);
      if(support==='challenge' && level===1) await mockCopy(mock,'stop');
      if(support==='challenge' && level===3) await mockCopy(mock,'drop');
      if(level===2) await interruptVirtual(support==='guided'?'reset':'stop');
      if(await page.getByTestId('button-mode-hardware').getAttribute('aria-pressed')==='true') {
        await page.getByTestId('button-practice-panel').click();
        const ack=page.getByTestId('button-ack-stop'), disconnect=page.getByTestId('button-bridge-disconnect');
        if(await ack.count() && await ack.isEnabled()) await ack.click();
        if(await disconnect.count() && await disconnect.isEnabled()) await disconnect.click();
        await page.getByTestId('button-mode-virtual').click(); await page.getByTestId('button-practice-panel').click();
      }
      const count=(await records()).length;
      await button('과제 초기화').click(); await stage('task');
      assert.equal((await records()).length,count,'reset must not delete learning evidence');
      assert.equal(await chapter().getByRole('heading',{name:'실행 완료 · 성공',exact:true}).count(),0);
      console.log(`RESET level ${level}/${support}: history preserved`);
      if(level<3) await chapter().locator('.pp-levels button').nth(level).click();
    }
    await context.close();
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync('/tmp/mg400-chapter4-browser-results.json',JSON.stringify({summaries,errors},null,2));
  console.log('PASS '+JSON.stringify(summaries));
})().catch(async e=>{
  console.error(e);
  if(page) console.error((await page.locator('body').innerText().catch(()=>'' )).slice(-5500));
  process.exitCode=1;
}).finally(async()=>{if(browser)await browser.close();});
