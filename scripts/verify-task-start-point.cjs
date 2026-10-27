// Real controls + provider, browser-only bridge mock; never contacts a robot.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { installMockBridge } = require("./mg400-mock-socket.cjs");
const URL = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/` : "http://localhost:80/";
const fixture = `<!doctype html><html lang="ko"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
const React=(await import('/node_modules/.vite/deps/react.js')).default;
const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
const {PracticeProvider,usePractice}=await import('/src/PracticeProvider.tsx');
const {PracticeDock}=await import('/src/PracticeControls.tsx');
const {TaskStartPoint}=await import('/src/TaskStartPoint.tsx');
const h=React.createElement, starts={A:{x:250,y:50,z:100,r:0},B:{x:230,y:80,z:30,r:5},zero:{x:250,y:50,z:0,r:0}};
function Test(){
 const p=usePractice();window.__practice=p;
 const [task,setTask]=React.useState("A"),[coords,setCoords]=React.useState({x:320,y:40,z:20,r:7});
 const [prediction,setPrediction]=React.useState("keep-my-prediction");
 const [show,setShow]=React.useState(true);
 return h(React.Fragment,null,h("header",{style:{background:"#0b2d5c",padding:12}},h(PracticeDock)),
  h("select",{"aria-label":"테스트 과제",value:task,onChange:e=>setTask(e.target.value)},...Object.keys(starts).map(k=>h("option",{key:k},k))),
  h("input",{"aria-label":"보존할 예측",value:prediction,onChange:e=>setPrediction(e.target.value)}),
  h("button",{onClick:()=>setShow(false)},"과제 떠나기"),
  show&&h(TaskStartPoint,{taskKey:task,start:starts[task],coords,onVirtualMove:setCoords}),
  h("output",{"data-testid":"fixture-coords"},JSON.stringify(coords)));
}
createRoot(document.getElementById("root")).render(h(PracticeProvider,null,h(Test)));
</script></body></html>`;
let browser;
(async () => {
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||"/repl/tools/bin/chromium",
    args:["--disable-webgl","--disable-gpu"]});
  const context = await browser.newContext({viewport:{width:1280,height:900}});
  const mock = await installMockBridge(context);
  await context.route("**/api/learning/**",route=>route.fulfill({json:{}}));
  await context.route("**/__task-start-fixture",route=>route.fulfill({contentType:"text/html",body:fixture}));
  const page=await context.newPage();page.setDefaultTimeout(12000);
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  const id=name=>page.getByTestId(name), button=()=>id("button-task-start"), status=()=>id("text-task-start-status");
  const ops=()=>mock.requests.filter(r=>r.type==="execute");
  const passed=[];
  async function statusHas(text){await page.waitForFunction(text=>document.querySelector('[data-testid="text-task-start-status"]')?.textContent.includes(text),text);}
  async function choose(task){await page.getByLabel("테스트 과제").selectOption(task);}
  async function publish(patch){Object.assign(mock.measurement,patch);mock.publish();await page.waitForTimeout(120);}
  async function showPanel(){if(await id("button-practice-panel").getAttribute("aria-expanded")!=="true")await id("button-practice-panel").click();}
  async function hidePanel(){if(await id("button-practice-panel").getAttribute("aria-expanded")==="true")await id("button-practice-panel").click();}
  async function configure(){
    await showPanel();
    // Test operator's known bounds: Z=0 MUST remain blocked.
    await page.locator(".pr-panel label").filter({hasText:/^zMin$/}).locator("input").fill("20");
    // Installation edits now invalidate related human checks; confirm AFTER editing.
    for(const flag of ["firmware","network","coordinates","tool","io","workspace"])await id(`check-${flag}`).check();
    await id("button-apply-setup").click();await id("button-confirm-ok").click();
    await page.waitForFunction(()=>!!window.__practice.snap.setup);
    await hidePanel();
  }
  async function recoverStop(){
    await showPanel();
    await id("button-ack-stop").click();
    await page.waitForFunction(()=>!!window.__practice.snap.measurement && !window.__practice.snap.measurement.moving);
    await configure();
  }
  await page.goto(new globalThis.URL("__task-start-fixture",URL).href);
  await button().waitFor().catch(async error=>{console.error({errors,html:(await page.content()).slice(-2000)});throw error;});
  await button().click();await statusHas("시작점 도착");
  assert.deepEqual(JSON.parse(await id("fixture-coords").innerText()),{x:250,y:50,z:100,r:0});
  await button().click();await statusHas("이미 시작점");
  await choose("B");assert.equal(JSON.parse(await id("fixture-coords").innerText()).x,250);
  await button().click();assert.deepEqual(JSON.parse(await id("fixture-coords").innerText()),{x:230,y:80,z:30,r:5});
  assert.equal(await page.getByLabel("보존할 예측").inputValue(),"keep-my-prediction");
  assert.equal(mock.requests.length,0);
  passed.push("different DT starts, already there, prediction preserved, no automatic movement or grading");
  await choose("A");await id("button-mode-hardware").click();
  await button().click();await statusHas("로봇 옆 PC");assert.equal(ops().length,0);
  await showPanel();await id("button-bridge-connect").click();await id("button-bridge-disconnect").waitFor();await hidePanel();
  await button().click();await statusHas("준비 설정");assert.equal(ops().length,0);
  await configure();
  await button().click();await statusHas("서보");assert.equal(ops().length,0);
  await publish({enabled:true,robotMode:5});
  await choose("zero");await button().click();await statusHas("작업 범위");assert.equal(await page.getByRole("dialog").count(),0);
  assert.equal(ops().length,0);assert.equal(await page.evaluate(()=>window.__practice.snap.setup.workspace.zMin),20);
  await choose("A");
  await publish({user:1});await button().click();await statusHas("User/Tool");assert.equal(ops().length,0);
  await publish({user:0});
  passed.push("disconnected/unprepared/servo off/wrong frame/Z=0 out-of-bounds blocked near button; bounds never widened");
  await button().dblclick();
  const dialog=page.getByRole("dialog");
  assert.match(await dialog.innerText(),/MoveJ/);
  assert.match(await dialog.innerText(),/X 250, Y 50, Z 100, R 0/);
  assert.equal(await button().isDisabled(),true);assert.equal(ops().length,0);
  await id("button-confirm-cancel").click();await statusHas("취소");assert.equal(await button().isEnabled(),true);
  await button().click();await choose("B");
  assert.equal(await dialog.count(),0);assert.equal(ops().length,0);
  await choose("A");await button().click();await publish({pose:{x:260,y:-150,z:300,r:0}});
  await id("button-confirm-ok").click();await statusHas("현재 위치가 달라");assert.equal(ops().length,0);
  passed.push("explicit target/method confirmation, duplicate suppression, cancel/task switch/confirmation-time displacement cancel without moves");
  await button().click();await id("button-confirm-ok").click();await statusHas("시작점 도착");
  assert.deepEqual(ops().map(r=>r.operation),[{kind:"move",motion:"MoveJ",target:{x:250,y:50,z:100,r:0}}]);
  assert.match(await status().innerText(),/모의 통신/);
  await button().click();await statusHas("이미 시작점");assert.equal(ops().length,1);
  mock.pause=true;
  await statusHas("오래");assert.doesNotMatch(await status().innerText(),/^시작점 도착/);mock.pause=false;mock.publish();
  await choose("B");mock.rejectNext="모의 브리지 이동 거절";
  await button().click();await id("button-confirm-ok").click();await statusHas("이동 거절");
  assert.equal(await button().isEnabled(),true);
  await recoverStop();
  mock.staleReply=true;
  await button().click();await id("button-confirm-ok").click();await statusHas("새 측정값");
  assert.doesNotMatch(await status().innerText(),/^시작점 도착/);
  assert.equal(await button().isEnabled(),true);
  await recoverStop();
  await button().click();await id("button-confirm-ok").click();await statusHas("시작점 도착");
  assert.deepEqual(ops().at(-1).operation.target,{x:230,y:80,z:30,r:5});
  passed.push("arrival requires fresh measured sequence, already-start sends nothing, stale arrival clears, reject/stale ACK retry succeeds");
  // Navigation while a mock move is in flight sends STOP and never marks new task arrived.
  await choose("A");mock.delay=1200;
  await button().click();await id("button-confirm-ok").click();
  await page.waitForFunction(()=>window.__practice.snap.busy);
  await choose("B");await page.waitForFunction(()=>!window.__practice.snap.busy);
  assert(mock.requests.some(r=>r.type==="stop"));
  assert.equal(await page.getByLabel("보존할 예측").inputValue(),"keep-my-prediction");
  assert(ops().every(r=>r.operation.kind==="move"));
  assert.equal(mock.requests.filter(r=>r.type==="connect")[0].robotIp,"192.168.1.6");
  assert.deepEqual(errors,[]);
  passed.push("in-flight task transition stops own operation; no servo/suction/lesson run and fixed IP retained");
  console.log(JSON.stringify({passed,mockMoveRequests:ops().length,realRobotSockets:0,learningServerWrites:0},null,2));
  await browser.close();
})().catch(async error=>{console.error(error);if(browser)await browser.close();process.exitCode=1;});
