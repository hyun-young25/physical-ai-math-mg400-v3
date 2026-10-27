// Full application with isolated learning traffic and a browser-only bridge.
const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const {installMockBridge}=require("./mg400-mock-socket.cjs");
const URL=process.env.REPLIT_DEV_DOMAIN?`https://${process.env.REPLIT_DEV_DOMAIN}/`:"http://localhost:80/";
let browser;
(async()=>{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||"/repl/tools/bin/chromium",
    args:["--disable-webgl","--disable-gpu"]});
  const context=await browser.newContext({viewport:{width:1904,height:913}});
  const mock=await installMockBridge(context),uploads=[];
  await context.route("**/api/learning/**",route=>{
    const req=route.request(),path=new globalThis.URL(req.url()).pathname;
    let data={};
    if(path.endsWith("/student/enter"))data={user:{id:"start-lessons-only",login:"start-lessons-only",role:"student",visitId:"start-lessons-isolated"}};
    if(path.endsWith("/records")){
      const events=req.postDataJSON().events;uploads.push(...events);
      data={acknowledged:events.map(e=>e.eventId)};
    }
    return route.fulfill({json:data});
  });
  const page=await context.newPage();page.setDefaultTimeout(12000);
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  const id=name=>page.getByTestId(name), target=()=>id("text-task-start-target"), current=()=>id("text-task-start-current");
  const status=()=>id("text-task-start-status");
  const passed=[];
  function assertPose(text,expected){
    const actual=Object.fromEntries([...text.matchAll(/([XYZR])=(-?[\d.]+)/g)].map(m=>[m[1].toLowerCase(),Number(m[2])]));
    for(const [axis,value] of Object.entries(expected))assert(Math.abs(actual[axis]-value)<=0.1,`${text}: expected ${axis}=${value}`);
  }
  async function navigate(name){
    console.log(`Checking lesson: ${name}`);
    const nav=page.getByRole("navigation",{name:"학습 목차",exact:true});
    if(await nav.evaluate(e=>e.parentElement.style.transform.includes("-100%")))
      await page.getByRole("button",{name:"☰",exact:true}).click();
    await nav.getByRole("button",{name}).click();
    await id("button-task-start").waitFor();
  }
  async function moveDt(){
    await id("button-task-start").click();
    await page.waitForFunction(()=>document.querySelector('[data-testid="text-task-start-status"]')?.textContent.startsWith("시작점 도착"))
      .catch(async error=>{console.error({target:await target().innerText(),current:await current().innerText(),status:await status().innerText()});throw error;});
    assert.equal(mock.requests.length,0);
  }
  const records=()=>page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.startsWith("mg400:visit:"))));
  await page.goto(URL);
  await page.getByLabel("학생 아이디",{exact:true}).fill("start-lessons-only");
  await page.getByRole("button",{name:"학습 시작",exact:true}).click();
  await navigate(/절대좌표·상대좌표와 변화량/);
  assert.match(await target().innerText(),/X=250 \/ Y=50 \/ Z=0 \/ R=0/);
  const prediction=page.locator(".coordinate-learning input[type=number]").first();
  await prediction.fill("17");
  const before=await records(),phase=await page.locator(".coordinate-stage-rail").innerText();
  await moveDt();
  assertPose(await current().innerText(),{x:250,y:50,z:0,r:0});
  assert.equal(await prediction.inputValue(),"17");
  assert.deepEqual(await records(),before);
  assert.equal(await page.getByRole("dialog").count(),0);
  assert.equal(await page.locator(".coordinate-stage-rail").innerText(),phase);
  await id("button-task-start").click();assert.match(await status().innerText(),/이미 시작점/);
  const taskNav=page.getByRole("navigation",{name:"절대·상대좌표 문항 선택",exact:true});
  await taskNav.getByRole("button").nth(3).click();
  assert.match(await target().innerText(),/X=230 \/ Y=80 \/ Z=0/);
  assertPose(await current().innerText(),{x:250,y:50,z:0});
  await moveDt();
  assertPose(await current().innerText(),{x:230,y:80,z:0});
  await taskNav.getByRole("button").first().click();
  assert.equal(await prediction.inputValue(),"17");
  passed.push("2-2 uses actual A=(250,50,0), changed-start C=(230,80,0); DT current updates, drafts/evidence preserved without grading");

  await id("button-mode-hardware").click();await id("button-practice-panel").click();
  assert.match(await status().innerText(),/로봇 옆 PC/);
  const boxes=await page.evaluate(()=>{
    const a=document.querySelector(".curriculum-panel").getBoundingClientRect(),b=document.querySelector(".practice-settings-host").getBoundingClientRect();
    return {lessonRight:a.right,settingsLeft:b.left};
  });
  assert(boxes.lessonRight<=boxes.settingsLeft+1);
  assert.equal(await id("input-robot-ip").inputValue(),"192.168.1.6");
  await id("button-practice-close").click();await id("button-mode-virtual").click();
  passed.push("start control and fixed-IP connection panel coexist without overlap; panel opening sends no commands");
  await page.locator(".lesson-scroll").evaluate(e=>{e.scrollTop=0;});
  await page.screenshot({path:"/tmp/mg400-task-start-wide.png"});

  for(const name of [/용어·기호와 기초수학/,/좌표축과 이동 방향/,/MoveJ·MoveL 비교/,/도형 경로 만들기/,/순기구학\(FK\)/,/역기구학\(IK\)/]){
    await navigate(name);
    const text=await target().innerText();
    await moveDt();
    passed.push(`${name.source}: start control uses visible task target (${text}) and DT arrives`);
  }
  // 2-2 sub-sections that own separate start conditions.
  await navigate(/절대좌표·상대좌표와 변화량/);
  const sections=page.getByRole("navigation",{name:"절대·상대좌표 학습 선택",exact:true});
  await sections.getByRole("button").nth(2).click();
  await moveDt();
  await sections.getByRole("button").nth(3).click();
  await moveDt();
  passed.push("2-2 situation-design and free-application starts work without invoking their reset/run actions");
  await page.setViewportSize({width:390,height:844});
  await id("button-task-start").scrollIntoViewIfNeeded();
  const bounds=await id("task-start-point").boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=391);
  await page.screenshot({path:"/tmp/mg400-task-start-mobile.png"});
  // The existing process renderer needs WebGL and creates Vite's dev overlay in
  // this GPU-free runner. Verify its actual handler and state, not pointer hit
  // testing or 3D appearance; other lessons above use normal user clicks.
  await page.setViewportSize({width:1904,height:913});
  await navigate(/운동학 종합과제/);
  await id("button-task-start").evaluate(button=>button.click());
  assert.match(await status().innerText(),/^시작점 도착/);
  await id("button-mode-hardware").evaluate(button=>button.click());
  await id("button-task-start").evaluate(button=>button.click());
  assert.match(await status().innerText(),/실장비 이동을 차단/);
  passed.push("process DT: start handler preserves initial frame; uncalibrated multi-robot hardware coordinates blocked (WebGL/pointer UI not verified)");
  assert.equal(mock.requests.length,0);
  assert.deepEqual(errors.filter(e=>e!=="Error creating WebGL context."),[]);
  assert(uploads.every(event=>!["실행 시작·진행","실행 완료","실행 취소·중단"].includes(event.eventKind)));
  console.log(JSON.stringify({passed,automaticRobotRequests:mock.requests.length,realRobotSockets:0,learningServerWrites:0},null,2));
  await browser.close();
})().catch(async error=>{console.error(error);if(browser)await browser.close();process.exitCode=1;});
