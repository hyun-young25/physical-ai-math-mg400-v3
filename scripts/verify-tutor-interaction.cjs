// Real pointer/keyboard interaction, isolated learning API and browser-only robot transport.
const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const {installMockBridge}=require("./mg400-mock-socket.cjs");
const URL=process.env.REPLIT_DEV_DOMAIN?`https://${process.env.REPLIT_DEV_DOMAIN}/`:"http://localhost:80/";
let browser;
(async()=>{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||"/repl/tools/bin/chromium",args:["--disable-webgl","--disable-gpu"]});
  const context=await browser.newContext({viewport:{width:1536,height:900}});
  const mock=await installMockBridge(context),requests=[],errors=[],passed=[];
  await context.route("**/api/learning/**",route=>{
    const req=route.request(),path=new globalThis.URL(req.url()).pathname;
    if(path.endsWith("/feedback")){
      const body=req.postDataJSON();requests.push(body);
      return route.fulfill({json:{provider:"openai",status:"provided",text:`모의 응답: ${body.question}`,createdAt:new Date().toISOString()}});
    }
    let data={};
    if(path.endsWith("/student/enter"))data={user:{id:"tutor-interaction",login:"tutor-interaction",role:"student",visitId:"tutor-interaction-isolated"}};
    if(path.endsWith("/records"))data={acknowledged:req.postDataJSON().events.map(e=>e.eventId)};
    return route.fulfill({json:data});
  });
  const page=await context.newPage();page.setDefaultTimeout(9000);page.on("pageerror",e=>errors.push(e.message));
  const id=n=>page.getByTestId(n),last=()=>page.locator(".ait-msg--tutor").last();
  async function navigate(name){
    const nav=page.getByRole("navigation",{name:"학습 목차",exact:true});
    if(await nav.evaluate(e=>e.parentElement.style.transform.includes("-100%")))await page.getByRole("button",{name:"☰",exact:true}).click();
    await nav.getByRole("button",{name}).click();await id("button-task-start").waitFor();
  }
  async function ask(text){
    const n=await page.locator(".ait-msg--tutor").count();
    await id("input-ai-tutor").fill(text);await id("button-ai-tutor-send").click();
    await page.waitForFunction(n=>document.querySelectorAll(".ait-msg--tutor").length>n,n);
    return last().innerText();
  }
  await page.goto(URL);await page.getByLabel("학생 아이디",{exact:true}).fill("tutor-interaction");
  await page.getByRole("button",{name:"학습 시작",exact:true}).click();
  await navigate(/좌표축과 이동 방향/);
  await id("button-ai-tutor-open").click();
  const x=page.getByLabel("예상 변화량 X",{exact:true});
  for(const [width,height] of [[1536,900],[1024,768],[390,844],[844,390]]){
    await page.setViewportSize({width,height});
    await x.click();await x.fill("50");
    assert.equal(await x.inputValue(),"50");
    await page.getByRole("radio",{name:"이동 방향은 같고, 이동 거리는 절반이다",exact:true}).check();
    assert(await id("panel-ai-tutor").isVisible());
    await id("input-ai-tutor").fill("작성 중 보존");
    await x.click();assert.equal(await id("input-ai-tutor").inputValue(),"작성 중 보존");
    await id("input-ai-tutor").click();
    await id("button-ai-tutor-collapse").click();assert.equal(await id("panel-ai-tutor").count(),0);
    await id("button-ai-tutor-open").click();assert.equal(await id("input-ai-tutor").inputValue(),"작성 중 보존");
    await id("button-ai-tutor-close").click();await x.click();
    await id("button-ai-tutor-open").click();
  }
  passed.push("real left-side clicks, numeric input, radio selection, chat return, minimize and close at desktop/tablet/phone/landscape");
  await page.setViewportSize({width:1536,height:900});
  await page.getByRole("button",{name:"탑뷰",exact:true}).click();
  for(const axis of ["Y","Z"])await page.getByLabel(`예상 변화량 ${axis}`,{exact:true}).fill("0");
  await page.getByRole("button",{name:"예측 저장 · DT 실행",exact:true}).click();
  await last().filter({hasText:"오답 1회"}).waitFor();
  const initial=await last().innerText();
  assert.doesNotMatch(initial,/\b25\b/);
  const count=await page.locator(".ait-msg--tutor").count();
  await id("button-ai-tutor-collapse").click();await id("button-ai-tutor-open").click();
  assert.equal(await page.locator(".ait-msg--tutor").count(),count);
  const reply=await ask("왜 2로 나누나요?");
  assert.match(reply,/절반|두.*같|나누/);
  assert.notEqual(reply,initial);
  const more=await ask("앞 설명을 한 단계 더 자세히 알려 주세요");
  assert.notEqual(more,reply);
  const applied=await ask("한 단계 더 자세히 설명해 주세요");
  assert.notEqual(applied,more);
  passed.push("single submission survives state changes/reopening without regeneration; question-specific trial follow-up advances its explanation");
  await id("select-ai-tutor-mode").selectOption("gpt");
  await ask("왜 2로 나누나요?");
  assert(requests.at(-1).conversation.some(m=>m.role==="tutor"&&/절반/.test(m.text)));
  await ask("방금 말한 기준을 다시 설명해 주세요");
  assert(requests.at(-1).conversation.some(m=>m.role==="student"&&m.text==="왜 2로 나누나요?"));
  assert(requests.at(-1).conversation.some(m=>m.role==="tutor"&&m.text==="모의 응답: 왜 2로 나누나요?"));
  passed.push("mock GPT request contains acknowledged automatic hint, current task and prior question/answer, exactly one request per question");
  await navigate(/절대좌표·상대좌표와 변화량/);
  assert(await id("panel-ai-tutor").isVisible());
  assert.doesNotMatch(await id("panel-ai-tutor").innerText(),/모의 응답: 왜 2로 나누나요/);
  const field=page.locator(".coordinate-learning input[type=number]").first();
  await field.click();await field.fill("12");
  await ask("현재 기준점 힌트를 주세요");
  assert.match(requests.at(-1).task,/^coordinate-/);
  assert.deepEqual(requests.at(-1).conversation,[]);
  passed.push("task transition stays open, left-side coordinate input remains clickable, and new requests contain only the current problem");
  assert.equal(mock.requests.length,0);assert.deepEqual(errors,[]);
  await page.screenshot({path:"/tmp/tutor-interaction.png"});
  console.log(JSON.stringify({passed,feedbackRequests:requests.length,robotOperations:mock.requests.length,realAiCalls:0,learningServerWrites:0},null,2));
  await browser.close();
})().catch(async e=>{console.error(e);if(browser)await browser.close();process.exitCode=1;});
