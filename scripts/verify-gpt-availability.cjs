// Mock provider replies and isolated learning HTTP; no live AI, database writes or robot transport.
const {chromium}=require("playwright"),assert=require("node:assert/strict");
const {installMockBridge}=require("./mg400-mock-socket.cjs");
const URL=process.env.REPLIT_DEV_DOMAIN?`https://${process.env.REPLIT_DEV_DOMAIN}/`:"http://localhost:80/";
let browser;
(async()=>{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||"/repl/tools/bin/chromium",args:["--disable-webgl","--disable-gpu"]});
  const context=await browser.newContext({viewport:{width:1536,height:900}}),mock=await installMockBridge(context);
  const requests=[],errors=[],passed=[];let mode="provided";
  await context.route("**/api/learning/**",async route=>{
    const req=route.request(),path=new globalThis.URL(req.url()).pathname;
    if(path.endsWith("/feedback")){
      const c=req.postDataJSON();requests.push(c);
      if(mode==="network_error")return route.abort();
      const text=mode==="provided"?`모의 API 응답: ${c.question}`:"GPT 답변을 받지 못했습니다. 운영자 확인이 필요합니다.";
      return route.fulfill({json:{text,provider:mode==="provided"?"openai":"rules",status:mode==="provided"?"provided":mode.includes("limit")||mode==="provider_quota"?"limited":"unavailable",
        ...(mode!=="provided"?{failureReason:mode}:{}),providerAttempted:mode!=="app_ip_limit",httpStatus:mode==="invalid_credentials"?401:mode==="provided"?200:429,createdAt:new Date().toISOString()}});
    }
    let data={};
    if(path.endsWith("/student/enter"))data={user:{id:"gpt-ui",login:"gpt-ui",role:"student",visitId:"gpt-ui-isolated"}};
    if(path.endsWith("/records"))data={acknowledged:req.postDataJSON().events.map(e=>e.eventId)};
    if(path.endsWith("/feedback/status"))data={configured:true,model:"gpt-5-mini",
      latest:{status:"limited",failureReason:"provider_quota",providerAttempted:true,httpStatus:429,at:new Date().toISOString()},
      limits:{ipPerMinute:30,visitPerHour:120,globalPerDay:2000,concurrency:4,globalUsed:3,active:0}};
    return route.fulfill({json:data});
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on("pageerror",e=>errors.push(e.message));
  const id=n=>page.getByTestId(n),last=()=>page.locator(".ait-msg--tutor").last();
  async function ask(q){
    const n=await page.locator(".ait-msg--tutor").count(),calls=requests.length;
    await id("input-ai-tutor").fill(q);await id("button-ai-tutor-send").click();
    await page.waitForFunction(n=>document.querySelectorAll(".ait-msg--tutor").length>n,n);
    assert.equal(requests.length,calls+1);
  }
  await page.goto(URL);await page.getByLabel("학생 아이디",{exact:true}).fill("gpt-ui");
  await page.getByRole("button",{name:"학습 시작",exact:true}).click();
  await page.getByRole("button",{name:"☰",exact:true}).click();
  await page.getByRole("navigation",{name:"학습 목차"}).getByRole("button",{name:/좌표축과 이동 방향/}).click();
  await id("button-ai-tutor-open").click();await id("select-ai-tutor-mode").selectOption("gpt");
  for(const axis of ["X","Y","Z"])await page.getByLabel(`예상 변화량 ${axis}`,{exact:true}).fill(axis==="X"?"40":"0");
  await page.getByRole("radio",{name:"이동 방향은 같고, 이동 거리는 절반이다",exact:true}).check();
  await page.getByRole("button",{name:"예측 저장 · DT 실행",exact:true}).click();
  await last().filter({hasText:"오답 1회"}).waitFor();
  for(const q of ["이 값이 맞아?","힌트만 주세요","풀이 과정을 설명해 주세요","방금 설명에서 왜 나누나요?"]){
    await ask(q);assert.match(await last().innerText(),/모의 API 응답/);
    assert.match(await last().locator(".ait-source").innerText(),/AI 생성 힌트/);
    assert.match(await id("status-ai-tutor").innerText(),/OpenAI GPT.*응답 완료/);
    const c=requests.at(-1);assert.equal(Number(JSON.parse(c.answers).deltaX),40);
    assert.match(c.task,/^axis-/);assert(c.condition&&c.judgment&&c.initialPrediction&&c.history);
  }
  assert(requests.at(-1).conversation.some(t=>t.text==="모의 API 응답: 풀이 과정을 설명해 주세요"));
  passed.push("mock successful responses use GPT provenance; short checks, hints, solutions and follow-ups carry current task, supplied verdict, input and conversation");
  for(const [failure,label] of [["provider_quota","제공자 한도"],["provider_rate_limit","제공자 일시"],["app_ip_limit","앱 네트워크"],["invalid_credentials","API 인증"],["network_error","연결 오류"]]){
    mode=failure;await ask("이 값이 맞아?");
    assert.match(await last().locator(".ait-source").innerText(),/GPT 미응답/);
    assert((await id("status-ai-tutor").innerText()).includes(label));
    assert.doesNotMatch(await last().innerText(),/어떤 식이나 기준/);
    if(failure==="provider_quota")await page.screenshot({path:"/tmp/gpt-provider-quota.png"});
  }
  mode="provided";await ask("앞 풀이를 이어 설명해 주세요");
  assert(!requests.at(-1).conversation.some(t=>/운영자 확인이 필요/.test(t.text)));
  passed.push("quota, temporary rate limit, app limit, credentials and network errors are failure notices, never fake GPT success or repeated generic math hints; failures do not pollute subsequent math context");
  await page.screenshot({path:"/tmp/gpt-availability.png"});
  await context.route("**/__gpt-operator",route=>route.fulfill({contentType:"text/html",body:`<div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>t=>t;window.__vite_plugin_react_preamble_installed__=true;
const React=(await import('/node_modules/.vite/deps/react.js')).default;const Client=await import('/node_modules/.vite/deps/react-dom_client.js');const createRoot=Client.createRoot??Client.default.createRoot;
const Card=(await import('/src/FeedbackOperatorStatus.tsx')).default;createRoot(document.getElementById('root')).render(React.createElement(Card));</script>`}));
  await page.goto(new globalThis.URL("__gpt-operator",URL).href);
  await page.getByText(/제공자 한도·잔액 확인 필요/).waitFor().catch(async e=>{
    console.error({operatorFixtureText:await page.locator("body").innerText(),browserErrors:errors});throw e;
  });
  assert.match(await page.locator("body").innerText(),/크레딧.*결제/);
  const calls=requests.length;await page.getByRole("button",{name:"상태 새로고침"}).click();assert.equal(requests.length,calls);
  await page.screenshot({path:"/tmp/gpt-operator-status.png"});
  passed.push("operator card shows quota cause, billing/project/key checks and unchanged caps; refreshing status makes no paid API call");
  assert.equal(mock.requests.length,0);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed,mockedFeedbackRequests:requests.length,realRobotOperations:0,realAiCalls:0,learningServerWrites:0},null,2));
  await browser.close();
})().catch(async e=>{console.error(e);if(browser)await browser.close();process.exitCode=1;});
