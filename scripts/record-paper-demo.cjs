// Records the unchanged production-built student UI using synthetic entry/storage.
// Feedback is the app's actual local trial response, not a fabricated GPT response.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {install} = require('./paper-demo-runtime.cjs');
const output = path.resolve(process.env.PAPER_DEMO_DIR || `generated-artifacts/paper-demo-${Date.now()}`);
fs.mkdirSync(output,{recursive:true});
const recordingEnabled = process.env.PAPER_RECORD !== '0';
const webgl = process.env.PAPER_RENDERING !== 'svg';
const holdScale = Number(process.env.PAPER_HOLD_SCALE ?? '1');
assert.ok(Number.isFinite(holdScale) && holdScale >= 0);

(async()=>{
  const browser = await chromium.launch({
    executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args:webgl ? ['--single-process','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--in-process-gpu'] : ['--single-process','--disable-webgl','--disable-gpu'],
  });
  const context = await browser.newContext({viewport:{width:1600,height:900},deviceScaleFactor:1,
    ...(recordingEnabled ? {recordVideo:{dir:output,size:{width:1600,height:900}}} : {})});
  const events = await install(context), segments = [], errors = [];
  let externalAiRequests = 0;
  await context.route('**/api/learning/feedback',route=>{
    externalAiRequests++; return route.abort();
  });
  const page = await context.newPage(), video = page.video(), started = Date.now();
  page.setDefaultTimeout(30000);
  page.on('pageerror',error=>errors.push(error.message));
  const beat = async (title, detail, hold=4500) => {
    segments.push({start:(Date.now()-started)/1000,title,detail});
    fs.writeFileSync(path.join(output,'segments.json'),JSON.stringify(segments,null,2));
    console.log('SCENE',title);
    if(hold * holdScale) await page.waitForTimeout(hold * holdScale);
  };
  const records = ()=>page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith('physical-ai-paper-coordinate-v1')))||'[]'));
  try {
    await page.goto('http://localhost');
    if(process.env.PAPER_FONT_CSS) await page.addStyleTag({content:fs.readFileSync(process.env.PAPER_FONT_CSS,'utf8')});
    await page.addStyleTag({content:'html,body,*{scroll-behavior:auto!important}'});
    await page.getByLabel('학생 아이디').fill('시연용 학생');
    await page.getByRole('button',{name:'학습 시작',exact:true}).click();
    await page.locator('.learning-student-bar').waitFor();
    const close=page.getByRole('button',{name:'×',exact:true});
    if(await close.count()) await close.first().click();
    const nav=page.getByRole('navigation',{name:'학습 목차'});
    if(await nav.evaluate(el=>el.getBoundingClientRect().x<0)) await page.getByRole('button',{name:'☰',exact:true}).click();
    await nav.getByRole('button',{name:/2-4.*도형 경로 만들기/}).click();
    await page.getByRole('button',{name:'5. 종이 기준점 (DT)',exact:true}).click();
    const view=page.getByRole('region',{name:'종이 좌표 변환 학습'});
    const click=async name=>{
      const button=view.getByRole('button',{name,exact:true});
      await button.scrollIntoViewIfNeeded();await button.click();
    };
    const stage=n=>view.getByText(`단계 ${n} / 7`,{exact:false}).waitFor();
    await view.waitFor();
    await beat('수학적 예측을 로봇의 움직임으로 확인합니다','종이 좌표를 로봇 좌표로 바꾸고, 차이를 설명하며 다시 설계하는 학습',6000);
    await click('다음 단계'); await stage(2);
    for(const [name,value] of [['원점 X (mm)','180'],['원점 Y (mm)','-60'],['1 cm당 길이 (mm)','10']]) await view.getByLabel(name,{exact:true}).fill(value);
    await view.getByLabel(/이 관계를 선택한 이유/).fill('종이 좌표 x, y를 mm로 바꾸어 원점에 더합니다. X=180+10x, Y=-60+10y입니다. P3의 X를 계산해 310 mm라고 예측했습니다.');
    await view.getByLabel(/이 관계를 선택한 이유/).scrollIntoViewIfNeeded();
    await beat('01  학생이 관계식과 이유를 표현합니다','X=180+10x, Y=−60+10y  ·  식과 설명을 함께 저장합니다',7000);
    await click('관계 저장');await click('다음 단계');await stage(3);
    await view.getByLabel('직선 경로 명령').selectOption('MoveL');
    await view.getByLabel('닫힌 경로 ΔX 합').fill('0');await view.getByLabel('닫힌 경로 ΔY 합').fill('0');
    for(const [name,x,y] of [['P1',180,-60],['P2',290,-60],['P3',310,90],['P4',180,90]]) {
      await view.getByLabel(`${name} 예측 로봇 X · mm`,{exact:true}).fill(String(x));
      await view.getByLabel(`${name} 예측 로봇 Y · mm`,{exact:true}).fill(String(y));
    }
    await view.getByLabel('P3 예측 로봇 X · mm',{exact:true}).scrollIntoViewIfNeeded();
    await beat('02  첫 예측: P3의 X를 310 mm로 입력합니다','수정 전 좌표와 학생의 풀이를 첫 시도 기록으로 남깁니다',6000);
    await click('예측 저장');await click('다음 단계');await stage(4);
    await beat('03  푸른 고스트로 학생의 계획을 실행합니다','원래 로봇 위치는 고정  ·  파란 로봇은 DT 예측 이동  ·  실측 아님',1500);
    await click('DT에서 확인');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith('physical-ai-paper-coordinate-v1')))||'[]').at(-1)?.run?.status==='completed',null,{timeout:90000});
    if(webgl) await page.getByTestId('paper-preview-label').waitFor();
    await page.waitForTimeout(3000 * holdScale);
    await click('다음 단계');await click('다음 단계');await stage(6);
    const first=(await records())[0];
    assert.equal(first.diagnosis.pattern,'calculation');
    const dock=page.getByTestId('revision-scene-dock');
    await dock.getByRole('button',{name:'P3',exact:true}).click();
    await beat('04  목표와 실행의 차이를 비교합니다','P3 목표 X=290 mm  ·  첫 예측과 DT 실행 X=310 mm  ·  차이 20 mm',6500);
    const analysis=view.getByRole('region',{name:'실행자료 AI 분석'});
    await analysis.getByLabel('분석 방식').selectOption('trial');
    await analysis.getByRole('button',{name:'기본 체험 분석 보기',exact:true}).click();
    const result=analysis.getByTestId('execution-ai-result');
    await result.waitFor();await result.scrollIntoViewIfNeeded();
    assert.match(await result.innerText(),/규칙 기반 · 외부 AI 호출 없음/);
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith('physical-ai-paper-coordinate-v1')))||'[]').at(-1)?.aiAnalyses?.some(a=>a.displayedAt));
    const firstFeedback=(await records())[0].aiAnalyses.at(-1).text;
    await beat('05  실행자료를 근거로 다시 생각할 질문을 받습니다','현재 화면은 기본 체험의 실제 규칙 응답입니다. GPT를 호출하지 않았습니다.',9500);
    await view.getByLabel('차이가 생긴 이유',{exact:true}).fill('11 cm를 110 mm로 바꾸어 원점 180 mm에 더하면 290 mm입니다. 관계식은 유지하고 P3의 X 계산을 다시 확인했습니다.');
    await click('생각 저장');await click('다음 단계');await stage(7);
    await view.getByLabel('무엇을 다시 살펴볼까요?',{exact:true}).fill('피드백의 대입 질문을 보고 P3의 X를 310 mm에서 290 mm로 고칩니다. 180+10×11=290이며, Y=-60+10×15=90은 그대로 둡니다.');
    await view.getByLabel('무엇을 다시 살펴볼까요?',{exact:true}).scrollIntoViewIfNeeded();
    await beat('06  학생이 수정할 부분과 이유를 설명합니다','180+10×11=290  ·  무엇을 왜 바꾸는지 학생의 언어로 기록합니다',8000);
    await click('이유와 수정 기록');await view.getByTestId('paper-retry-note').waitFor();
    const parentBefore=JSON.stringify((await records())[0]);
    await click('관계식·이유 확인');await stage(2);
    await view.getByLabel(/이 관계를 선택한 이유/).fill('X=180+10x, Y=-60+10y입니다. P3(11,15)를 대입하면 X=180+110=290 mm, Y=-60+150=90 mm입니다.');
    await click('관계 저장');await click('다음 단계');await stage(3);
    await view.getByLabel('P3 예측 로봇 X · mm',{exact:true}).fill('290');
    await beat('07  필요한 답을 고치고 다시 실행합니다','P3의 X: 310 → 290 mm  ·  첫 시도의 풀이와 피드백은 보존됩니다',6500);
    await click('예측 저장');await click('다음 단계');await stage(4);await click('DT에서 확인');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith('physical-ai-paper-coordinate-v1')))||'[]').at(-1)?.run?.status==='completed',null,{timeout:90000});
    await click('다음 단계');await click('다음 단계');await stage(6);
    const final=await records();assert.equal(final[1].diagnosis.pattern,'match');assert.equal(JSON.stringify(final[0]),parentBefore);
    await dock.getByRole('button',{name:/4.*재실행 결과/}).click();await dock.getByRole('button',{name:'P3',exact:true}).click();
    await beat('08  같은 목표점에서 수정 전후를 비교합니다','첫 실행 310 mm → 수정 후 실행 290 mm  ·  새 시도에서 목표와 일치합니다',8000);
    await analysis.getByRole('button',{name:'기본 체험 분석 보기',exact:true}).click();await result.waitFor();await result.scrollIntoViewIfNeeded();
    const packet=JSON.parse(await analysis.locator('.execution-ai-evidence pre').textContent());
    fs.writeFileSync(path.join(output,'final-evidence.json'),JSON.stringify(packet,null,2));
    const previous=packet.linkedHistory;
    assert.ok(Array.isArray(previous));
    assert.equal(previous[0].previouslyDisplayedFeedback[0].text,firstFeedback);
    await beat('09  이전 피드백과 수정 이유가 다음 분석에 연결됩니다','예측 → 실행자료 → 피드백 → 이유 설명 → 수정 → 재실행의 순환을 기록합니다',9000);
    await dock.getByRole('button',{name:/4.*재실행 결과/}).click();await dock.getByRole('button',{name:'P3',exact:true}).click();
    assert.equal(externalAiRequests,0);assert.deepEqual(errors,[]);
    segments.push({start:(Date.now()-started)/1000,title:'시연 완료',detail:'DT 시뮬레이션 · 기본 체험 피드백 · 실물 로봇과 실제 GPT 호출 없음'});
    await page.waitForTimeout(5000 * holdScale);
    fs.writeFileSync(path.join(output,'recording.json'),JSON.stringify({sourceCommit:require('node:child_process').execFileSync('git',['rev-parse','HEAD']).toString().trim(),
      services:'synthetic student entry and storage acknowledgement',feedback:'actual application trial rules',renderer:webgl?'webgl':'svg',runSource:'dt',realRobotCommands:0,externalAiRequests,
      attempts:final.length,diagnosisBefore:first.diagnosis.pattern,diagnosisAfter:final[1].diagnosis.pattern,originalPreserved:true,previousFeedbackLinked:true,
      syncedEventCount:events.length,segments,errors},null,2));
    await page.close();await context.close();console.log('PASS', video ? await video.path() : 'recording scenario validated without video');
  } catch(error) {
    console.error('Scenario failed:',error);
    throw error;
  } finally {
    for(const p of context.pages()) await p.close().catch(()=>{});
    await context.close().catch(()=>{});await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
