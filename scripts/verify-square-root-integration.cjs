// Whole application route, no component fixture or auth bypass in product code.
// All browser API traffic is intercepted; all sockets are denied except the
// browser-only mock. A separate cookie-free request checks real API rejection.
const {chromium}=require("playwright");
const assert=require("node:assert/strict"),fs=require("node:fs"),crypto=require("node:crypto");
const {installMockBridge}=require("./mg400-mock-socket.cjs");
const base=process.env.REPLIT_DEV_DOMAIN?`https://${process.env.REPLIT_DEV_DOMAIN}/`:"http://localhost:80/";
const visitId=crypto.randomUUID();
let browser,page;
(async()=>{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||"/repl/tools/bin/chromium",
    args:["--disable-webgl","--disable-gpu"]});
  const context=await browser.newContext({viewport:{width:1500,height:1000}});
  await context.routeWebSocket("**",ws=>ws.close());
  const mock=await installMockBridge(context),requests=[],errors=[],passed=[];
  let aiMode="failure",release;
  await context.addInitScript(()=>{
    const raf=window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame=cb=>raf(t=>cb(t*8));
  });
  await context.route("**/api/**",async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    const data=req.method()==="POST"?req.postDataJSON():null;
    requests.push({path,method:req.method(),data});
    if(path.endsWith("/feedback")){
      if(aiMode==="delay")await new Promise(resolve=>{release=resolve;});
      return route.fulfill(aiMode==="success"
        ?{json:{provider:"openai",status:"provided",text:"합성 응답: 문제의 기준점과 변하는 축을 나누어 확인해 보세요.",createdAt:new Date().toISOString()}}
        :{status:503,json:{error:"격리된 GPT 장애 응답"}});
    }
    if(path.endsWith("/student/enter"))return route.fulfill({json:{user:{
      id:"square-root-synthetic",login:"square-root-synthetic",role:"student",visitId}}});
    if(path.endsWith("/records"))return route.fulfill({json:{acknowledged:data.events.map(e=>e.eventId)}});
    return route.fulfill({json:{}});
  });
  page=await context.newPage();page.setDefaultTimeout(18000);
  page.on("pageerror",e=>errors.push(e.message));
  const id=n=>page.getByTestId(n),active=()=>page.locator(".shape-step-active");
  const moves=()=>mock.requests.filter(r=>r.type==="execute"&&r.operation.kind==="move");
  const stage=n=>page.waitForFunction(n=>document.querySelector(".shape-step-progress")?.textContent.includes(n+"/7"),n);
  await page.goto(base);
  await page.getByLabel("학생 아이디",{exact:true}).fill("square-root-synthetic");
  await page.getByRole("button",{name:"학습 시작",exact:true}).click();
  const nav=page.getByRole("navigation",{name:"학습 목차",exact:true});
  if(await nav.evaluate(e=>e.parentElement.style.transform.includes("-100%")))
    await page.getByRole("button",{name:"☰",exact:true}).click();
  await nav.getByRole("button",{name:/도형 경로 만들기/}).click();
  await stage(1);
  const lesson=await page.evaluate(async()=>{
    const {getShapeLesson}=await import("/src/shapeLearning.ts");
    return getShapeLesson("사각형",0);
  });
  async function fill(overrides={}){
    for(const q of [...lesson.concept,...lesson.relations,...lesson.calculation,...lesson.prediction]){
      const input=active().getByLabel(q.label,{exact:true});
      if(!await input.count())continue;
      const value=String(Object.hasOwn(overrides,q.key)?overrides[q.key]:q.answer);
      if(q.options)await input.selectOption(value);else await input.fill(value);
    }
    const reason=active().getByLabel("예측 근거",{exact:true});
    if(await reason.count())await reason.fill("변하는 축과 유지되는 축을 나누고 각 변의 길이와 좌표 변화량으로 확인했습니다.");
  }
  await fill({squareAxis:"y"});
  await active().getByRole("button",{name:"확인하고 다음",exact:true}).click();
  await id("panel-ai-tutor").waitFor();
  assert.match(await id("panel-ai-tutor").innerText(),/내 입력 「y」/);
  assert.match(await id("panel-ai-tutor").innerText(),/문제 조건|기준|방향/);
  assert.equal(moves().length,0);
  passed.push("root entry → chapter navigation → incorrect square submission opens real shared tutor with input-specific hints");
  await id("select-ai-tutor-mode").selectOption("gpt");aiMode="delay";
  await active().getByRole("button",{name:"확인하고 다음",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="panel-ai-tutor"]')?.textContent.includes("내 입력 「y」"));
  await page.waitForFunction(()=>document.querySelector('[data-testid="button-ai-tutor-send"]')?.disabled);
  assert.match(await id("panel-ai-tutor").innerText(),/내 입력 「y」/);
  aiMode="failure";release?.();
  await id("button-ai-tutor-send").waitFor();
  await page.waitForFunction(()=>!document.querySelector('[data-testid="select-ai-tutor-mode"]')?.disabled);
  assert.match(await id("panel-ai-tutor").innerText(),/내 입력 「y」/);
  aiMode="success";
  await id("input-ai-tutor").fill("이동 축을 어떤 기준으로 다시 확인하면 좋을까요?");
  await id("button-ai-tutor-send").click();
  await page.getByText("합성 응답: 문제의 기준점과 변하는 축을 나누어 확인해 보세요.",{exact:true}).waitFor();
  const feedback=requests.filter(r=>r.path.endsWith("/feedback"));
  assert(feedback.at(-1).data.conversation.some(t=>t.text.includes("내 입력 「y」")));
  passed.push("root tutor preserves immediate hint during delayed/failed GPT and carries it into follow-up conversation (provider response synthetic)");
  await id("select-ai-tutor-mode").selectOption("trial");
  await id("button-ai-tutor-close").click();
  for(let n=1;n<=3;n++){
    await stage(n);await fill({p2x:"300.05"});
    await active().getByRole("button",{name:n===3?"예측 저장 · 실행 준비":"확인하고 다음",exact:true}).click();
  }
  await stage(4);
  await page.getByText("내 예측 ↔ 실행 명령 좌표",{exact:true}).click();
  assert.match(await active().innerText(),/\(300\.05, 100\)/);
  await active().getByRole("button",{name:/실행/}).first().click();
  await stage(5);
  await active().getByRole("button",{name:"관찰 완료 · 비교하기",exact:true}).click();
  await stage(6);
  await active().getByLabel("비교 후 내 판단",{exact:true}).selectOption("maintain");
  await active().getByRole("button",{name:"비교 확인 저장",exact:true}).click();
  await active().getByRole("button",{name:"비교 완료 · 다음",exact:true}).click();
  await stage(7);
  passed.push("corrected student decimal → actual App DT → closure/return → comparison → stage 7");
  await page.getByText("추가 측정 · 실장비 / 가상 센서",{exact:true}).click();
  await id("button-mode-hardware").click();
  assert(await id("button-shape-hardware-run").isDisabled());
  if(await id("button-practice-panel").getAttribute("aria-expanded")!=="true")await id("button-practice-panel").click();
  await id("button-bridge-connect").click();await id("button-bridge-disconnect").waitFor();
  for(const check of await page.locator('[data-testid^="check-"]').all())await check.check();
  await id("button-apply-setup").click();await id("button-confirm-ok").click();
  await page.getByText(/현재 적용 속도 .*설정 적용됨/).waitFor();
  Object.assign(mock.measurement,{enabled:true,robotMode:5});mock.publish();
  await page.waitForTimeout(250);
  await id("button-practice-panel").click();
  await id("button-shape-hardware-run").click();
  const confirm=page.getByRole("dialog",{name:/모의 통신 실행 확인|실제 MG400 실행 확인/});
  assert.match(await confirm.innerText(),/300\.05/);
  await id("button-confirm-cancel").click();assert.equal(moves().length,0);
  await id("button-shape-hardware-run").click();
  await id("button-confirm-ok").click();
  await page.getByText("모의 통신 · 실측 아님: 이 값은 학습 증거로 저장하지 않습니다.",{exact:true}).waitFor();
  assert.equal(moves().length,5);
  const expected=lesson.sequence.map(s=>[s.coords.x,s.coords.y]);
  for(const row of lesson.pathPlan.rows){
    expected[row.sequenceIndex]=[row.xKey==="p2x"?300.05:lesson.calculation.find(q=>q.key===row.xKey).answer,
      lesson.calculation.find(q=>q.key===row.yKey).answer];
  }
  assert.deepEqual(moves().map(r=>[r.operation.target.x,r.operation.target.y]),expected);
  passed.push("disconnected block → mock setup → final confirmation cancel sends nothing → approval sends exact student plan to browser mock only");
  const events=requests.filter(r=>r.path.endsWith("/records")).flatMap(r=>r.data.events);
  const records=events.map(e=>e.payload);
  assert(records.some(r=>r.prediction?.p2x==="300.05"));
  assert(records.some(r=>r.prediction?.p2x==="300.05"&&r.runs?.some(run=>run.status==="completed")));
  passed.push("actual app learning-sync requests preserve submitted decimal and completed DT evidence; writes intercepted, never sent to server");
  // This direct request is NOT routed through the browser interception. It has
  // no cookies, a newly generated unissued visit, and does not create any data.
  const api=await context.request.post(new URL("api/learning/feedback",base).href,{
    headers:{"X-Learning-Request":"1"},data:feedback.at(-1).data});
  const rejected=await api.json();
  assert.equal(api.status(),403);assert.match(rejected.error,/학습 시작/);
  passed.push("real feedback API rejects unissued synthetic visit (403); no auth bypass, account creation or real provider call");
  assert.deepEqual(errors,[]);
  fs.mkdirSync("generated-artifacts",{recursive:true});
  await page.screenshot({path:"generated-artifacts/square-root-integration.png"});
  const report={passed,browserErrors:errors,entry:"real root UI; browser-only synthetic entry response",
    ai:"synthetic success/failure; real API blocked by unissued visit",realApiStatus:api.status(),
    interceptedRecordBatches:requests.filter(r=>r.path.endsWith("/records")).length,
    interceptedFeedbackRequests:feedback.length,mockMoveCount:moves().length,
    realRobotCommands:0,serverWrites:0,realProviderCalls:0};
  fs.writeFileSync("generated-artifacts/square-root-integration.json",JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));await browser.close();
})().catch(async e=>{
  console.error(e);
  if(page)console.error((await page.locator("body").innerText().catch(()=>"")).slice(-4500));
  await browser?.close();process.exit(1);
});
