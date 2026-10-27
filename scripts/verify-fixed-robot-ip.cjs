// Isolated browser storage, intercepted learning HTTP, browser-only bridge mock.
// Never opens a physical robot socket or writes to the learning server.
const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const {installMockBridge}=require("./mg400-mock-socket.cjs");
const URL=process.env.REPLIT_DEV_DOMAIN?`https://${process.env.REPLIT_DEV_DOMAIN}/`:"http://localhost:80/";
let browser;
(async()=>{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||"/repl/tools/bin/chromium",args:["--disable-webgl","--disable-gpu"]});
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  await context.addInitScript(()=>{
    localStorage.setItem("robotIp","10.0.0.99");
    localStorage.setItem("mg400-robot-ip","192.168.1.99");
    localStorage.setItem("mg400-practice-settings",JSON.stringify({robotIp:"172.16.0.8"}));
  });
  const mock=await installMockBridge(context);
  await context.route("**/api/learning/**",route=>{
    const path=new globalThis.URL(route.request().url()).pathname;
    const data=path.endsWith("/student/enter")
      ?{user:{id:"fixed-ip-test-only",role:"student",login:"fixed-ip-test-only",visitId:"fixed-ip-isolated-visit"}}
      :{};
    return route.fulfill({json:data});
  });
  const page=await context.newPage();page.setDefaultTimeout(12000);
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  const id=name=>page.getByTestId(name);
  async function enter(){
    if(await page.getByLabel("학생 아이디",{exact:true}).count()){
      await page.getByLabel("학생 아이디",{exact:true}).fill("fixed-ip-test-only");
      await page.getByRole("button",{name:"학습 시작",exact:true}).click();
    }
    await id("button-mode-virtual").waitFor();
    assert.equal(await id("button-mode-virtual").getAttribute("aria-pressed"),"true");
  }
  await page.goto(URL);await enter();
  assert.equal(mock.requests.length,0);
  await id("button-mode-hardware").click();
  assert.equal(mock.requests.length,0);
  await id("button-practice-panel").click();
  assert.equal(await id("input-robot-ip").inputValue(),"192.168.1.6");
  assert.equal(await id("input-robot-ip").evaluate(e=>e.readOnly),true);
  await id("input-robot-ip").focus();
  await page.keyboard.press("ControlOrMeta+A");await page.keyboard.type("192.168.1.77");
  assert.equal(await id("input-robot-ip").inputValue(),"192.168.1.6");
  assert.equal(mock.requests.length,0);
  // A DOM-mutated field is not trusted by the connection layer either.
  await id("input-robot-ip").evaluate(e=>{e.value="10.0.0.12";e.dispatchEvent(new Event("input",{bubbles:true}));});
  await id("button-bridge-connect").click();
  await id("button-bridge-disconnect").filter({hasText:"연결 해제"}).waitFor();
  assert.deepEqual(mock.requests.map(r=>({type:r.type,robotIp:r.robotIp})),[{type:"connect",robotIp:"192.168.1.6"}]);
  assert.equal(await page.getByRole("dialog").count(),0);
  await id("button-bridge-disconnect").click();
  await page.reload();await enter();
  assert.equal(mock.requests.length,1);
  await id("button-mode-hardware").click();
  assert.equal(mock.requests.length,1);
  await id("button-practice-panel").click();
  assert.equal(await id("input-robot-ip").inputValue(),"192.168.1.6");
  assert.equal(await id("input-robot-ip").evaluate(e=>e.readOnly),true);
  assert.equal(mock.requests.length,1); // no reconnect on reload/login/panel open
  await id("button-bridge-connect").click();
  await id("button-bridge-disconnect").filter({hasText:"연결 해제"}).waitFor();
  assert.deepEqual(mock.requests.map(r=>({type:r.type,robotIp:r.robotIp})),[
    {type:"connect",robotIp:"192.168.1.6"},{type:"connect",robotIp:"192.168.1.6"},
  ]);
  assert.equal(await id("input-robot-ip").inputValue(),"192.168.1.6");
  await page.screenshot({path:"/tmp/mg400-fixed-ip-preview.png"});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:[
    "기존 저장 주소를 무시하고 고정 IP 표시·읽기 전용",
    "키보드 수정 차단·DOM 변조도 실제 요청 대상에 영향 없음",
    "새로고침 후에도 고정 IP·가상 모드·미연결로 시작",
    "자동 연결 없음·사용자 연결 요청 2건 모두 192.168.1.6",
    "모의 통신 유지·준비 설정/서보/이동/흡착 요청 0건",
  ],mockConnectRequests:mock.requests.length,realRobotSockets:0,learningServerWrites:0},null,2));
  await browser.close();
})().catch(async error=>{console.error(error);if(browser)await browser.close();process.exitCode=1;});
