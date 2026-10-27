// Real square components, FK/IK, tutor and safety provider. HTTP and robot sockets
// are intercepted in the isolated browser; no DB writes, paid AI or physical motion.
const {chromium}=require("playwright"),assert=require("node:assert/strict");
const {installMockBridge}=require("./mg400-mock-socket.cjs");
const base=process.env.REPLIT_DEV_DOMAIN?`https://${process.env.REPLIT_DEV_DOMAIN}/`:"http://localhost:80/";
const fixture=`<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
const React=(await import('/node_modules/.vite/deps/react.js')).default;
const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
const {RobotArm}=await import('/src/RobotArm.tsx');
const {PracticeProvider,usePractice}=await import('/src/PracticeProvider.tsx');
const {PracticeDock}=await import('/src/PracticeControls.tsx');
const {TutorHost}=await import('/src/TutorHost.tsx');
const {getShapeLesson,shapeLessonExpected}=await import('/src/shapeLearning.ts');
const {shapeFK,shapeIK,SHAPE_HOME_JOINTS}=await import('/src/shapeKinematics.ts');
const {setLearningUser}=await import('/src/learningClient.ts');
const {tutorSnapshot}=await import('/src/tutorRegistry.ts');
setLearningUser({id:"square-isolated",login:"square-isolated",role:"student",visitId:"square-isolated-visit"});
window.__lessons=Array.from({length:6},(_,i)=>getShapeLesson('사각형',i));
window.__expected=window.__lessons.map(shapeLessonExpected);
window.__tutor=tutorSnapshot;window.__dt=[];window.__moves=[];window.__reset=0;
const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(t=>cb(t*8));
const h=React.createElement,noop=()=>{};
function Screen(){
 const practice=usePractice();window.__practice=practice;
 const joints=React.useRef({...SHAPE_HOME_JOINTS});
 const [coords,setCoords]=React.useState(shapeFK(joints.current));
 const stopHardware=React.useCallback(()=>practice.session.stop(),[practice.session]);
 const move=j=>{joints.current={...j};const p=shapeFK(j);window.__dt.push(p);setCoords(p);};
 const reset=()=>move({...SHAPE_HOME_JOINTS});
 return h(React.Fragment,null,h(PracticeDock),
 h('main',{style:{height:1000,width:850}},h(RobotArm,{
  joints:joints.current,coords,onJointStart:noop,onJogStop:noop,onMoveEnd:noop,
  onMoveTo:(x,y,z,r)=>{const j=shapeIK(x,y,z,r,joints.current.j3);if(j)move(j);},
  onGetJoints:()=>joints.current,onComputeIK:shapeIK,onComputeFK:shapeFK,onMoveJoints:move,
  onCapturePose:()=>({joints:{...joints.current},coords:shapeFK(joints.current)}),
  onRestorePose:p=>move(p.joints),onResetPose:reset,onHardwareStop:stopHardware,
  onHardwareMove:()=>{throw new Error('Legacy hardware path must not be used');},
  onLearningVisualChange:v=>{window.__visual=v;},
  hardwareConnected:practice.snap.connection==='connected',hardwareHomed:true,resetKey:0,activity:'rect',embedded:true
 })),h(TutorHost));
}
createRoot(document.getElementById('root')).render(h(PracticeProvider,null,h(Screen)));
</script></body></html>`;
let browser;
module.exports.fixture=fixture;
if(require.main===module)(async()=>{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||"/repl/tools/bin/chromium",args:["--disable-webgl","--disable-gpu"]});
  const context=await browser.newContext({viewport:{width:1500,height:1000}});
  // Deny every unrecognized socket; the last registered browser mock handles only localhost bridge.
  await context.routeWebSocket("**",ws=>ws.close());
  const mock=await installMockBridge(context),errors=[],passed=[],aiRequests=[];
  let aiMode="fail",release;
  await context.route("**/__square-flow",r=>r.fulfill({contentType:"text/html",body:fixture}));
  await context.route("**/api/**",async r=>{
    const path=new URL(r.request().url()).pathname;
    if(path.endsWith("/feedback")){
      aiRequests.push(r.request().postDataJSON());
      if(aiMode==="delay")await new Promise(resolve=>{release=resolve;});
      try{return await r.fulfill(aiMode==="fail"?{status:503,json:{error:"isolated failure"}}:
        {json:{provider:"openai",status:"provided",text:"시험 응답: 기준점과 이동 방향을 따로 확인해 보세요.",createdAt:new Date().toISOString()}});}catch{return;}
    }
    return r.fulfill({json:{acknowledged:[]}});
  });
  const page=await context.newPage();page.setDefaultTimeout(12000);
  page.on("pageerror",e=>errors.push(e.message));
  const id=n=>page.getByTestId(n),moves=()=>mock.requests.filter(r=>r.type==="execute"&&r.operation.kind==="move");
  const active=()=>page.locator(".shape-step-active");
  async function goto(){
    await page.goto(new URL("__square-flow",base).href);
    try{await page.locator(".shape-step-progress").waitFor();}
    catch(error){console.error({browserErrors:errors,body:(await page.locator("body").innerText()).slice(0,1800)});throw error;}
  }
  async function stage(n){
    try{await page.waitForFunction(n=>document.querySelector(".shape-step-progress")?.textContent.includes(n+"/7"),n);}
    catch(error){console.error({expectedStage:n,browserErrors:errors,screen:(await active().innerText()).slice(0,2000)});throw error;}
  }
  async function fillStage(index=0,overrides={}){
    const lesson=await page.evaluate(i=>window.__lessons[i],index);
    const expected=await page.evaluate(i=>window.__expected[i],index);
    for(const q of [...lesson.concept,...lesson.relations,...lesson.calculation,...lesson.prediction]){
      const input=active().getByLabel(q.label,{exact:true});
      if(await input.count()){
        const value=String(Object.hasOwn(overrides,q.key)?overrides[q.key]:expected[q.key]);
        if(q.options)await input.selectOption(value);else await input.fill(value);
      }
    }
    if(await active().getByLabel("예측 근거",{exact:true}).count())
      await active().getByLabel("예측 근거",{exact:true}).fill("각 변의 이동 방향과 좌표 변화량을 구분하고, 유지되는 좌표는 그대로 두었습니다.");
  }
  async function predict(index=0,overrides={},from=1){
    for(let n=from;n<=3;n++){
      await stage(n);await fillStage(index,overrides);
      await active().getByRole("button",{name:n===3?"예측 저장 · 실행 준비":"확인하고 다음",exact:true}).click();
    }
    await stage(4);
  }
  async function runDT(){
    await active().getByRole("button",{name:/실행/,exact:false}).filter({hasText:/실행/}).first().click();
    await stage(5);
  }
  async function compare(){
    await active().getByRole("button",{name:"관찰 완료 · 비교하기",exact:true}).click();await stage(6);
  }
  async function finishPractice(){
    await compare();
    const select=active().getByLabel("비교 후 내 판단",{exact:true});
    await select.selectOption("maintain");
    await active().getByRole("button",{name:"비교 확인 저장",exact:true}).click();
    await active().getByRole("button",{name:"비교 완료 · 다음",exact:true}).click();await stage(7);
    await page.getByText("추가 측정 · 실장비 / 가상 센서",{exact:true}).click();
  }
  async function connect(){
    await id("button-mode-hardware").click();
    if(await id("button-practice-panel").getAttribute("aria-expanded")!=="true")await id("button-practice-panel").click();
    await id("button-bridge-connect").click();await id("button-bridge-disconnect").waitFor();
    for(const check of await page.locator('[data-testid^="check-"]').all())await check.check();
    await id("button-apply-setup").click();await id("button-confirm-ok").click();
    await page.waitForFunction(()=>!!window.__practice.snap.setup);
    Object.assign(mock.measurement,{enabled:true,robotMode:5});mock.publish();
    await page.waitForFunction(()=>window.__practice.snap.measurement?.enabled);
    if(await id("button-practice-panel").getAttribute("aria-expanded")==="true")await id("button-practice-panel").click();
  }
  await goto();
  // A missing selection and a deliberately wrong selection both open the actual chat.
  await active().getByRole("button",{name:"확인하고 다음",exact:true}).click();
  await id("panel-ai-tutor").waitFor();
  assert.match(await page.locator("body").innerText(),/미입력/);
  await fillStage(0,{squareAxis:"y"});
  await active().getByRole("button",{name:"확인하고 다음",exact:true}).click();
  await page.waitForFunction(()=>window.__tutor()?.messages.some(m=>m.text.includes("내 입력 「y」")));
  assert.equal(moves().length,0);
  passed.push("missing/wrong stage submission opens actual tutor with input-specific immediate hints; zero moves");

  // Correct decimals must survive into DT samples, not be replaced with exact targets.
  await predict(0,{p2x:"300.05"});
  await page.getByText("내 예측 ↔ 실행 명령 좌표",{exact:true}).click();
  assert.match(await active().innerText(),/\(300\.05, 100\)/);
  await runDT();
  assert(await page.evaluate(()=>window.__dt.some(p=>Math.abs(p.x-300.05)<1e-6&&Math.abs(p.y-100)<1e-6)));
  await finishPractice();
  assert.equal(moves().length,0);
  passed.push("0.05-offset correct student XY preserved in displayed execution plan and actual calibrated DT path; complete closure/return/comparison");

  // Existing final confirmation and provider remain the only hardware path.
  await id("button-mode-hardware").click();
  assert(await id("button-shape-hardware-run").isDisabled());
  assert.equal(moves().length,0);
  await id("button-mode-virtual").click();
  await connect();
  await id("button-shape-hardware-run").click();
  assert.match(await page.getByRole("dialog",{name:/모의 통신 실행 확인|실제 MG400 실행 확인/}).innerText(),/300\.05/);
  await id("button-confirm-cancel").click();assert.equal(moves().length,0);
  await id("button-shape-hardware-run").click();await id("button-confirm-ok").click();
  await page.waitForFunction(()=>!window.__practice.snap.busy);
  await page.waitForFunction(()=>document.querySelector('[data-testid="button-shape-hardware-run"]')?.disabled===false);
  assert.equal(moves().length,5);assert.equal(moves()[1].operation.target.x,300.05);
  passed.push("disconnected execution disabled; cancellation sends nothing; final approved browser-only mock receives all five exact student points");

  // Even a confirmation that was already open cannot approve a changed/reverted plan.
  await id("button-shape-hardware-run").click();
  await page.getByRole("button",{name:/^(실행 좌표 보기·수정|이동 명령 수정)$/}).evaluate(button=>button.click());
  const coord=page.locator(".shape-coordinate-editor input[type=number]").first();
  const old=await coord.inputValue();await coord.fill(String(Number(old)+1),{force:true});await coord.fill(old,{force:true});
  const beforeStale=moves().length;
  await id("button-confirm-ok").click();
  assert.equal(moves().length,beforeStale);
  await page.getByRole("button",{name:"좌표 수정 마치기",exact:true}).click();
  await stage(1);
  assert.equal(await id("button-shape-hardware-run").count(),0);
  passed.push("execution-coordinate edit and revert invalidate old prediction/DT evidence and an already-open final confirmation");

  // Challenge intentionally permits a wrong DT prediction, never hardware qualification.
  await goto();
  await page.locator(".shape-lesson-settings summary").click();
  await page.getByLabel("도형 학습 지원",{exact:true}).selectOption("challenge");
  await predict(0,{p2x:"280"});await runDT();await compare();
  assert.equal(await id("button-shape-hardware-run").count(),0);
  // Execution-based diagnosis: the executed P1 → P2 edge is 80 mm, not the 100 mm condition.
  await id("square-diagnosis").waitFor();
  assert.equal(await id("square-diagnosis").getAttribute("data-type"),"arithmetic");
  assert.match(await id("square-diagnosis").innerText(),/P1 → P2에서 로봇이 그린 변의 길이는 80 mm/);
  const revise=active().getByRole("button",{name:"이유 저장 · 예측 고쳐 다시 실행",exact:true});
  await active().getByLabel("다시 판단 P2의 X",{exact:true}).fill("300.04");
  assert.equal(await revise.isDisabled(),true,"a cause explanation is required before revising");
  await active().getByLabel("차이가 생긴 이유",{exact:true}).fill("P1의 X에 가로 길이 100이 아니라 80을 더했습니다.");
  await revise.click();
  await stage(3);assert.equal(await id("button-shape-hardware-run").count(),0);
  await predict(0,{p2x:"300.04"},3);await runDT();await finishPractice();
  passed.push("wrong challenge plan stays virtual; the DT result is diagnosed, a cause is required, and correcting it needs a new prediction plus fresh DT and comparison");

  // A restrictive site range is not expanded to admit the correct student path.
  await connect();
  await page.evaluate(()=>{
    const p=window.__practice;
    p.setSetupDraft({...p.setupDraft,workspace:{...p.setupDraft.workspace,xMax:299}});
  });
  if(await id("button-practice-panel").getAttribute("aria-expanded")!=="true")await id("button-practice-panel").click();
  for(const check of await page.locator('[data-testid^="check-"]').all())await check.check();
  await id("button-apply-setup").click();await id("button-confirm-ok").click();
  await page.waitForFunction(()=>window.__practice.snap.setup?.workspace.xMax===299);
  await id("button-practice-panel").click();
  const before=moves().length;
  await id("button-shape-hardware-run").click();
  await page.getByRole("alert").filter({hasText:/범위|초과/}).waitFor();
  assert.equal(moves().length,before);
  assert.equal(await page.evaluate(()=>window.__practice.snap.setup.workspace.xMax),299);
  passed.push("correct but out-of-range path blocked with explicit reason; no range expansion or move");

  // Explicitly restore the test site's original range, then reject a mock operation.
  await page.evaluate(()=>{
    const p=window.__practice;p.setSetupDraft({...p.setupDraft,workspace:{...p.setupDraft.workspace,xMax:350}});
  });
  await id("button-practice-panel").click();
  for(const check of await page.locator('[data-testid^="check-"]').all())await check.check();
  await id("button-apply-setup").click();await id("button-confirm-ok").click();
  await page.waitForFunction(()=>window.__practice.snap.setup?.workspace.xMax===350);
  await id("button-practice-panel").click();
  mock.rejectNext="모의 장비가 이동을 거부했습니다.";
  await id("button-shape-hardware-run").click();await id("button-confirm-ok").click();
  await page.getByRole("alert").filter({hasText:/모의 장비가 이동을 거부/}).waitFor();
  assert.equal(await page.getByText("실장비 측정 결과",{exact:true}).count(),0);
  passed.push("mock move rejection remains an error, not a successful measurement");

  // Failure/delay still leaves the synchronous rules hint visible in the same chat.
  await goto();
  await fillStage(0,{squareAxis:"y"});
  await page.getByRole("button",{name:/AI.*튜터|AI.*질문|튜터.*열기/}).first().click().catch(()=>{});
  const mode=page.getByTestId("select-ai-tutor-mode");
  if(!await mode.isVisible()){
    await active().getByRole("button",{name:"확인하고 다음",exact:true}).click();
  }
  await mode.selectOption("gpt");aiMode="delay";
  await active().getByRole("button",{name:"확인하고 다음",exact:true}).click();
  await page.waitForFunction(()=>window.__tutor()?.messages.some(m=>m.text.includes("내 입력 「y」")));
  await page.waitForTimeout(150);
  assert(aiRequests.length>0);
  assert.match(JSON.stringify(aiRequests.at(-1).judgment),/false/);
  aiMode="fail";release?.();
  await page.waitForFunction(()=>window.__tutor()?.pending===false);
  assert(await page.evaluate(()=>window.__tutor().messages.some(m=>m.source==="rules"&&m.text.includes("내 입력 「y」"))));
  passed.push("delayed/failed GPT never removes immediate specific rule hint or changes verdict");
  aiMode="success";
  await id("input-ai-tutor").fill("이동 축을 고를 때 어떤 기준으로 다시 확인하면 좋을까요?");
  await id("button-ai-tutor-send").click();
  await page.waitForFunction(()=>window.__tutor()?.messages.some(m=>m.source==="openai"));
  assert(aiRequests.at(-1).conversation.some(turn=>turn.text.includes("내 입력 「y」")));
  passed.push("follow-up question carries the delivered square hint and current objective judgment into existing tutor path");
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed,browserErrors:errors,interceptedAiRequests:aiRequests.length,
    mockMoveCount:moves().length,realRobotCommands:0,serverWrites:0},null,2));
  await browser.close();
})().catch(async error=>{console.error(error);await browser?.close();process.exit(1);});
