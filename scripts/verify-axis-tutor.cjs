// Real app, isolated learning HTTP and browser-only robot protocol. No live AI/device.
const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const {installMockBridge}=require("./mg400-mock-socket.cjs");
const URL=process.env.REPLIT_DEV_DOMAIN?`https://${process.env.REPLIT_DEV_DOMAIN}/`:"http://localhost:80/";
let browser;
(async()=>{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||"/repl/tools/bin/chromium",args:["--disable-webgl","--disable-gpu"]});
  const context=await browser.newContext({viewport:{width:1904,height:913}});
  const mock=await installMockBridge(context),requests=[],errors=[],passed=[];
  await context.route("**/api/learning/**",route=>{
    const req=route.request(),path=new globalThis.URL(req.url()).pathname;
    if(path.endsWith("/feedback")){
      const body=req.postDataJSON();requests.push(body);
      return route.fulfill({json:{provider:"openai",status:"provided",text:`시험용 응답 · ${body.task} · ${body.question}`,createdAt:new Date().toISOString()}});
    }
    let data={};
    if(path.endsWith("/student/enter"))data={user:{id:"axis-tutor-test",login:"axis-tutor-test",role:"student",visitId:"axis-tutor-isolated"}};
    if(path.endsWith("/records"))data={acknowledged:req.postDataJSON().events.map(e=>e.eventId)};
    return route.fulfill({json:data});
  });
  const page=await context.newPage();page.setDefaultTimeout(12000);
  page.on("pageerror",e=>errors.push(e.message));
  const id=name=>page.getByTestId(name),panel=()=>id("panel-ai-tutor");
  async function navigate(name){
    const nav=page.getByRole("navigation",{name:"학습 목차",exact:true});
    if(await nav.evaluate(e=>e.parentElement.style.transform.includes("-100%")))
      await page.getByRole("button",{name:"☰",exact:true}).click();
    await nav.getByRole("button",{name}).click();
    await id("button-task-start").waitFor();
  }
  async function ask(text){
    const count=panel().locator(".ait-msg--tutor").count();
    const before=await count;
    await id("input-ai-tutor").fill(text);await id("button-ai-tutor-send").click();
    await page.waitForFunction(n=>document.querySelectorAll(".ait-msg--tutor").length>n,before);
    return panel().locator(".ait-msg--tutor").last().innerText();
  }
  const prediction=()=>page.getByLabel("예상 변화량 X",{exact:true});
  const progress=()=>page.locator(".axis-status").innerText();
  const evidence=()=>page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.startsWith("mg400:visit:"))));
  async function geometry(width,height){
    await page.setViewportSize({width,height});
    await page.waitForTimeout(250);
    // ResizeObserver settles the injected preview banner and shared dock sizes.
    const rects=await page.evaluate(()=>{
      const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
      return {tutor:box('[data-testid="panel-ai-tutor"]'),root:box("#root"),lesson:box(".curriculum-panel"),
        settings:box(".practice-settings-host"),input:box('[data-testid="input-ai-tutor"]'),close:box('[data-testid="button-ai-tutor-close"]'),
        workspace:box(".workspace-layout")};
    });
    const t=rects.tutor;
    for(const [key,r] of Object.entries(rects).filter(([key])=>["tutor","input","close"].includes(key)))
      assert(r.x>=-1&&r.y>=-1&&r.right<=width+1&&r.bottom<=height+1,`${width}x${height} ${key}: ${JSON.stringify(rects)}`);
    for(const r of [rects.lesson,rects.settings]){
      // These panels intentionally scroll inside workspace; offscreen/clipped
      // child bounds are not visible content beneath the fixed tutor dock.
      const visible={x:Math.max(r.x,rects.workspace.x),right:Math.min(r.right,rects.workspace.right),
        y:Math.max(r.y,rects.workspace.y),bottom:Math.min(r.bottom,rects.workspace.bottom)};
      const overlap=Math.min(t.right,visible.right)-Math.max(t.x,visible.x)>1&&Math.min(t.bottom,visible.bottom)-Math.max(t.y,visible.y)>1;
      assert(!overlap,`${width}x${height} overlap: ${JSON.stringify(rects)}`);
    }
    assert(rects.lesson.width>=Math.min(380,width)-2);
    await id("input-ai-tutor").click();
    await id("button-ai-tutor-close").click();
    await page.waitForFunction(()=>{
      const launcher=document.querySelector('[data-testid="button-ai-tutor-open"]')?.getBoundingClientRect();
      const workspace=document.querySelector(".workspace-layout")?.getBoundingClientRect();
      return launcher&&workspace&&workspace.bottom<=launcher.top+1;
    });
    await id("button-ai-tutor-open").click();
    // Start control remains reachable by scrolling the same mounted lesson.
    await id("button-task-start").scrollIntoViewIfNeeded();
    assert(await id("button-task-start").isVisible());
  }
  await page.goto(URL);
  await page.getByLabel("학생 아이디",{exact:true}).fill("axis-tutor-test");
  await page.getByRole("button",{name:"학습 시작",exact:true}).click();
  await navigate(/좌표축과 이동 방향/);
  await prediction().fill("37");
  const phase=await progress(),records=await evidence();
  await id("button-ai-tutor-open").click();
  assert.match(await panel().innerText(),/2-1 좌표축과 이동 방향/);
  assert.match(await ask("힌트만 주세요"),/현재 2-1 문항 조건.*로봇|현재 2-1 문항 조건/);
  assert.equal(requests.length,0);
  assert.equal(await prediction().inputValue(),"37");assert.equal(await progress(),phase);
  assert.deepEqual(await evidence(),records);
  passed.push("2-1 reuses the existing tutor; trial hint uses axis condition and draft; no grading/progress reset");
  await id("select-ai-tutor-mode").selectOption("gpt");
  await ask("현재 축의 부호를 설명해 주세요");
  assert.match(requests.at(-1).task,/^axis-/);
  assert.equal(JSON.parse(requests.at(-1).answers).deltaX,"37");
  assert.match(requests.at(-1).condition,/2-1.*이동 방향/);
  const firstCondition=requests.at(-1).condition;
  await id("button-ai-tutor-close").click();
  await page.getByRole("navigation",{name:"좌표축 수업 경로",exact:true}).getByRole("button").nth(1).click();
  await id("button-ai-tutor-open").click();
  await ask("바뀐 조건에서 힌트만 주세요");
  assert.notEqual(requests.at(-1).condition,firstCondition);
  await navigate(/절대좌표·상대좌표와 변화량/);
  await ask("좌표 기준점 힌트만 주세요");
  assert.match(requests.at(-1).task,/^coordinate-/);
  assert.match(await panel().innerText(),/2-2 절대·상대좌표/);
  assert.doesNotMatch(await panel().innerText(),/시험용 응답 · axis-/);
  await navigate(/좌표축과 이동 방향/);
  assert.match(await panel().innerText(),/2-1 좌표축과 이동 방향/);
  assert.doesNotMatch(await panel().innerText(),/시험용 응답 · coordinate-/);
  await id("button-ai-tutor-close").click();await id("button-ai-tutor-open").click();
  assert.equal(mock.requests.length,0);
  passed.push("mock GPT receives the active 2-1 task/draft; task and 2-1/2-2 navigation replace context without cross-lesson messages or robot requests");
  // Check connection/setup preservation using ONLY the isolated in-browser mock.
  await id("button-ai-tutor-close").click();
  await id("button-mode-hardware").click();await id("button-practice-panel").click();
  await id("button-bridge-connect").click();await id("button-bridge-disconnect").waitFor();
  for(const flag of ["firmware","network","coordinates","tool","io","workspace"])await id(`check-${flag}`).check();
  await id("button-apply-setup").click();await id("button-confirm-ok").click();
  const baseline=mock.requests.length;
  await id("button-ai-tutor-open").click();
  for(const [width,height] of [[1904,913],[1536,864],[1280,900],[1024,768],[768,1024],[390,844],[844,390]]){
    await geometry(width,height);
    assert.equal(mock.requests.length,baseline);
    assert.equal(await id("button-bridge-disconnect").count(),1);
    assert(await id("check-workspace").isChecked());
    assert(!await page.getByRole("dialog").filter({hasText:"실제 실행 확인"}).count());
  }
  await page.screenshot({path:"/tmp/mg400-axis-tutor-mobile.png"});
  await page.setViewportSize({width:1904,height:913});
  await navigate(/절대좌표·상대좌표와 변화량/);await navigate(/좌표축과 이동 방향/);
  assert.equal(await id("button-bridge-disconnect").count(),1);assert.equal(mock.requests.length,baseline);
  await page.screenshot({path:"/tmp/mg400-axis-tutor-desktop.png"});
  passed.push("7 desktop/tablet/phone/landscape sizes: tutor input/close and start button accessible; lesson/settings/tutor do not overlap; mock connection and prepared state survive opening/closing and chapter navigation");
  assert.deepEqual(errors,[]);
  assert(mock.requests.every(r=>["connect","configure"].includes(r.type)));
  console.log(JSON.stringify({passed,mockRequests:mock.requests.map(r=>r.type),mockFeedbackRequests:requests.length,realRobotSockets:0,learningServerWrites:0,realAiCalls:0},null,2));
  await browser.close();
})().catch(async error=>{console.error(error);if(browser)await browser.close();process.exitCode=1;});
