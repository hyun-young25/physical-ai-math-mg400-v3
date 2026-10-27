// Actual square UI + FK/IK + safety session. All HTTP writes and WebSockets are
// intercepted. A final scenario also exercises the real root application.
const {chromium}=require("playwright"),assert=require("node:assert/strict"),fs=require("node:fs");
const {fixture}=require("./verify-square-flow.cjs");
const {installMockBridge}=require("./mg400-mock-socket.cjs");
const base=process.env.REPLIT_DEV_DOMAIN?`https://${process.env.REPLIT_DEV_DOMAIN}/`:"http://localhost:80/";
let browser,page,context,mock;
const passed=[],errors=[],evidence=[];
(async()=>{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||"/repl/tools/bin/chromium",args:["--disable-webgl","--disable-gpu"]});
  const id=n=>page.getByTestId(n),active=()=>page.locator(".shape-step-active");
  const moves=()=>mock.requests.filter(r=>r.type==="execute"&&r.operation.kind==="move");
  async function boot(root=false){
    mock?.dispose();
    await context?.close();
    context=await browser.newContext({viewport:{width:1500,height:1000}});
    await context.routeWebSocket("**",ws=>ws.close());mock=await installMockBridge(context);
    await context.addInitScript(()=>{
      window.__sendTrace=[];window.__clockRate=40;window.__freeze=false;
      const send=WebSocket.prototype.send;
      WebSocket.prototype.send=function(raw){
        const data=JSON.parse(raw);
        if(data.type==="execute")window.__sendTrace.push({data,time:performance.now(),
          virtualEvidence:window.__readEvidence?.()??null,
          status:document.querySelector('[data-testid="square-continuous-status"]')?.textContent});
        return send.call(this,raw);
      };
      const raf=requestAnimationFrame.bind(window);let previous=0,clock=0;
      window.requestAnimationFrame=cb=>raf(t=>{clock+=(t-previous)*(window.__freeze?0:window.__clockRate);previous=t;cb(clock);});
    });
    const screen=fixture.replace("window.requestAnimationFrame=cb=>raf(t=>cb(t*8));","")
      .replace("onComputeIK:shapeIK","onComputeIK:(...args)=>window.__rejectIK?null:shapeIK(...args)")
      .replace("onRestorePose:p=>move(p.joints)","onRestorePose:p=>{move(p.joints);window.__beforePhysical?.();}");
    await context.route("**/__square-continuous",r=>r.fulfill({contentType:"text/html",body:screen}));
    await context.route("**/api/**",route=>{
      const req=route.request(),path=new URL(req.url()).pathname;
      let json={};
      if(path.endsWith("/feedback"))return route.fulfill({status:503,json:{error:"isolated AI failure"}});
      if(path.endsWith("/student/enter"))json={user:{id:"continuous-synthetic",login:"continuous-synthetic",role:"student",visitId:"continuous-synthetic"}};
      if(path.endsWith("/records"))json={acknowledged:req.postDataJSON().events.map(e=>e.eventId)};
      return route.fulfill({json});
    });
    page=await context.newPage();page.setDefaultTimeout(14000);page.on("pageerror",e=>errors.push(e.message));
    await page.goto(root?base:new URL("__square-continuous",base).href);
    if(root){
      await page.getByLabel("학생 아이디",{exact:true}).fill("continuous-synthetic");
      await page.getByRole("button",{name:"학습 시작",exact:true}).click();
      const nav=page.getByRole("navigation",{name:"학습 목차",exact:true});
      if(await nav.evaluate(e=>e.parentElement.style.transform.includes("-100%")))
        await page.getByRole("button",{name:"☰",exact:true}).click();
      await nav.getByRole("button",{name:/도형 경로 만들기/}).click();
    }
    await page.waitForFunction(()=>document.querySelector(".shape-step-progress")?.textContent.includes("1/7"));
    await page.evaluate(async()=>{
      const {getShapeLesson,shapeLessonExpected}=await import("/src/shapeLearning.ts");
      window.__lesson=getShapeLesson("사각형",0);window.__answers=shapeLessonExpected(window.__lesson);
      const {getEvidenceItem}=await import("/src/learningSync.ts");
      window.__readEvidence=()=>JSON.parse(getEvidenceItem("physical-ai-shape-runs-v1")??"[]").at(-1)??null;
    });
  }
  async function predict(overrides={}){
    const lesson=await page.evaluate(()=>window.__lesson),expected=await page.evaluate(()=>window.__answers);
    for(let n=1;n<=3;n++){
      for(const q of [...lesson.concept,...lesson.relations,...lesson.calculation,...lesson.prediction]){
        const field=active().getByLabel(q.label,{exact:true});if(!await field.count())continue;
        const v=String(Object.hasOwn(overrides,q.key)?overrides[q.key]:expected[q.key]);
        if(q.options)await field.selectOption(v);else await field.fill(v);
      }
      const reason=active().getByLabel("예측 근거",{exact:true});
      if(await reason.count())await reason.fill("변하는 축과 유지되는 좌표 및 각 변의 길이를 기준으로 확인했습니다.");
      await active().getByRole("button",{name:n===3?"예측 저장 · 실행 준비":"확인하고 다음",exact:true}).click();
    }
    await id("button-square-continuous-run").waitFor();
  }
  async function runVirtual(){
    await active().getByRole("button",{name:"▶ 실행",exact:true}).click();
    await active().getByRole("button",{name:"관찰 완료 · 비교하기",exact:true}).waitFor();
  }
  async function connect(){
    await id("button-mode-hardware").click();
    if(await id("button-practice-panel").getAttribute("aria-expanded")!=="true")await id("button-practice-panel").click();
    await id("button-bridge-connect").click();await id("button-bridge-disconnect").waitFor();
    for(const check of await page.locator('[data-testid^="check-"]').all())await check.check();
    await id("button-apply-setup").click();await id("button-confirm-ok").click();
    Object.assign(mock.measurement,{enabled:true,robotMode:5});mock.publish();
    await page.waitForTimeout(200);
    await id("button-practice-panel").click();
  }
  async function approve(freeze=false){
    await page.evaluate(f=>{window.__freeze=f;},freeze);
    await id("button-square-continuous-run").click();
    const dialog=page.getByRole("dialog",{name:/실행 확인/});
    assert.match(await dialog.innerText(),/DT에서 완주·닫힘·복귀 확인한 뒤, 같은 계획을 실제 장비에서 1회 실행/);
    assert.match(await dialog.innerText(),/속도.*User.*Tool/);
    assert.equal(moves().length,0);
    await id("button-confirm-ok").click();
  }
  async function blocked(label){
    await page.waitForFunction(()=>document.querySelector('[data-testid="square-continuous-status"]')?.textContent.includes("승인 폐기"));
    await page.evaluate(()=>{window.__freeze=false;});await page.waitForTimeout(550);
    assert.equal(moves().length,0,label);
    assert(await page.getByRole("alert").count(),`${label}: visible reason`);
    passed.push(label);
  }
  await boot();await predict({p2x:"300.05"});await connect();await approve(true);
  await id("square-continuous-status").filter({hasText:"1/2 가상"}).waitFor();
  await page.waitForTimeout(250);assert.equal(moves().length,0);
  // Repeated DOM clicks cannot reenter; no second approval or physical run.
  await id("button-square-continuous-run").evaluate(el=>{el.click();el.click();});
  await page.evaluate(()=>{window.__freeze=false;});
  await id("square-continuous-status").filter({hasText:"연속 실행 완료"}).waitFor();
  assert.equal(await page.getByRole("dialog").count(),0);
  assert.equal(moves().length,5);
  const expected=await page.evaluate(()=>window.__lesson.sequence.map((s,i)=>({...s.coords,x:i===1?300.05:s.coords.x})));
  assert.deepEqual(moves().map(r=>r.operation.target),expected);
  const trace=await page.evaluate(()=>window.__sendTrace);
  assert.equal(trace.length,5);
  for(const row of trace){
    assert(row.virtualEvidence?.closure?.closed);
    assert.equal(row.virtualEvidence.returnedToInitialPose,true);
    assert.equal(row.virtualEvidence.completedSteps,5);
  }
  await page.waitForTimeout(500);assert.equal(moves().length,5);
  evidence.push({scenario:"continuous",trace,targets:moves().map(r=>r.operation.target),noClickBetweenVirtualAndHardware:true});
  passed.push("correct decimal: zero physical commands during virtual; actual FK closure/return evidence precedes all five same-coordinate mock moves; one initial approval only; repeated clicks do not duplicate");
  // Comparison/reflection remain available only after both runs.
  await active().getByRole("button",{name:"관찰 완료 · 비교하기",exact:true}).click();
  await active().getByLabel("비교 후 내 판단",{exact:true}).selectOption("maintain");
  await active().getByRole("button",{name:"비교 확인 저장",exact:true}).click();
  passed.push("comparison/reflection continue after the combined result, never between the runs");

  await boot();await predict();await connect();
  await id("button-square-continuous-run").click();await id("button-confirm-cancel").click();
  await page.waitForTimeout(300);assert.equal(moves().length,0);
  assert.equal(await page.locator(".shape-run-status").count(),0);
  passed.push("cancel before initial approval starts neither virtual nor physical execution");

  await boot();await predict();await connect();await approve(true);
  await id("button-square-continuous-stop").click();await blocked("cancel during virtual prevents any subsequent physical command");

  await boot();await predict();await connect();await approve(true);
  await id("button-practice-panel").click();await id("button-practice-stop").click();
  await blocked("global practice stop during virtual cancels the pending physical continuation even though no physical command has started");

  await boot();await predict();await connect();await approve(true);
  await page.evaluate(()=>window.__practice.session.disconnect());
  await blocked("disconnect during virtual irreversibly discards approval");
  // Reconnection + preparation alone must never resume an old run.
  await id("button-practice-panel").click();await id("button-bridge-connect").click();await id("button-bridge-disconnect").waitFor();
  await page.waitForTimeout(400);assert.equal(moves().length,0);
  passed.push("reconnection alone never starts a previously cancelled physical path");

  await boot();await predict();await connect();await approve(true);
  await page.evaluate(()=>window.__practice.setSetupDraft({...window.__practice.setupDraft,speed:6}));
  await blocked("speed/setup input change invalidates approval during virtual playback");

  await boot();await predict();await connect();await id("button-square-continuous-run").click();
  await page.evaluate(()=>{
    // Inject a real UI draft revision while a modal is pending, as if another
    // in-app source changed the answer. Do not merely cancel the modal first.
    [...document.querySelectorAll("button")].find(b=>b.textContent==="예측 수정").click();
  });
  await blocked("answer revision while confirmation is pending cancels the permit, even if the same values are entered again");
  assert.equal(await page.getByRole("dialog").count(),0);
  // Re-saving exactly the same answer still requires a brand new approval.
  await predict();
  await page.waitForTimeout(250);assert.equal(moves().length,0);
  await id("button-square-continuous-run").click();
  await page.evaluate(()=>[...document.querySelectorAll(".shape-type-tabs button")].find(b=>b.textContent.includes("삼각형")).click());
  await page.getByRole("alert").filter({hasText:/변경|취소/}).waitFor();
  await page.waitForTimeout(250);assert.equal(moves().length,0);
  passed.push("task switch during pending approval discards the old square permit");
  assert.equal(await page.getByRole("dialog").count(),0);
  assert.equal(await id("button-square-continuous-run").count(),0);
  passed.push("continuous controls are square-only; triangle retains its own flow");

  await boot();await predict();await connect();await approve(true);
  await page.evaluate(()=>{window.__rejectIK=true;window.__freeze=false;});
  await blocked("virtual IK/path failure cannot be reported as a complete drawing or trigger physical motion");

  await boot();await predict();await connect();
  await page.evaluate(()=>{window.__rejectIK=true;});
  await approve();await blocked("virtual execution that cannot start sends zero physical commands");

  await boot();await predict();await connect();await approve(true);
  await page.waitForTimeout(700);assert.equal(moves().length,0);
  await id("button-square-continuous-stop").click();
  await blocked("virtual run without any completion notification cannot start physical execution");

  for(const condition of ["workspace","stale","servo","moving"]){
    await boot();await predict();await connect();
    await page.evaluate(condition=>{
      window.__beforePhysical=()=>{
        const snap=window.__practice.session.getSnapshot();
        if(condition==="workspace")snap.measurement.pose.x=900;
        if(condition==="stale")snap.measurement.receivedAt=Date.now()-5000;
        if(condition==="servo")snap.measurement.enabled=false;
        if(condition==="moving")snap.measurement.moving=true;
      };
    },condition);
    await approve();
    await blocked(`last-moment ${condition} change after actual virtual completion is rechecked before any physical command`);
  }

  await boot();await predict();await connect();mock.delay=350;
  await approve();await page.waitForFunction(()=>window.__sendTrace.length>=1);
  await id("button-square-continuous-stop").click();
  await page.waitForTimeout(600);
  assert(mock.requests.some(r=>r.type==="stop"),"physical phase cancellation must use existing stop request");
  assert(moves().length<5,"stop prevents remaining points");
  passed.push("cancel after physical motion begins issues the existing stop request and prevents the remainder of the path");

  await boot();await predict();await id("button-mode-hardware").click();
  if(await id("button-practice-panel").getAttribute("aria-expanded")!=="true")await id("button-practice-panel").click();
  await id("button-bridge-connect").click();await id("button-bridge-disconnect").waitFor();
  Object.assign(mock.measurement,{enabled:true,robotMode:5});mock.publish();
  await id("button-practice-panel").click();
  await id("button-square-continuous-run").click();
  await page.getByRole("alert").filter({hasText:/준비 설정/}).waitFor();
  assert.equal(moves().length,0);
  passed.push("connected/enabled but unconfirmed preparation cannot authorize a combined run");

  await boot();
  await page.locator(".shape-lesson-settings > summary").click();
  await page.getByLabel("도형 학습 지원",{exact:true}).selectOption("challenge");
  // P1=(200,100), P2=(330,100) gives a 130 mm wrong width while preserving
  // the remaining rectangle geometry. The browser socket is the mock bridge.
  await predict({p2x:"330",p3x:"330",p4x:"200",closeX:"200"});
  await connect();
  assert(await id("button-square-continuous-run").isDisabled(),"wrong plan cannot skip DT completion");
  assert.equal(moves().length,0);
  await runVirtual();
  assert.equal(await id("button-square-continuous-run").isDisabled(),false,
    "challenge wrong plan becomes eligible only after its DT run completes");
  assert.equal(await page.locator(".square-action-progress [aria-current='step']").count(),1,
    "only one square action card is current after the discrepant DT observation");
  await approve();
  await id("square-continuous-status").filter({hasText:"연속 실행 완료"}).waitFor();
  assert.equal(moves().length,5,"the approved mock run executes exactly one five-point path");
  assert.equal(moves()[0].operation.target.x,330,"the approved path uses the student's wrong 130 mm prediction");
  passed.push("challenge 130 mm wrong plan: DT first, then one human-approved same-plan five-point mock run; exactly one current action card");

  await boot();
  await page.locator(".shape-lesson-settings > summary").click();
  await page.getByLabel("도형 학습 지원",{exact:true}).selectOption("challenge");
  await predict({p2x:"330",p3x:"330",p4x:"200",closeX:"200"});
  await connect();
  await page.evaluate(()=>window.__practice.setSetupDraft({...window.__practice.setupDraft,
    workspace:{...window.__practice.setupDraft.workspace,xMax:290}}));
  await id("button-practice-panel").click();
  for(const check of await page.locator('[data-testid^="check-"]').all())await check.check();
  await id("button-apply-setup").click();await id("button-confirm-ok").click();await id("button-practice-panel").click();
  await id("button-square-continuous-run").click();
  await page.getByRole("alert").filter({hasText:/작업 범위|범위 밖/}).waitFor();
  assert.equal(moves().length,0);
  passed.push("challenge wrong path outside configured workspace is blocked before any mock movement");

  await boot();await predict();await connect();await approve(true);
  await page.evaluate(()=>window.__practice.setBridgeUrl("ws://127.0.0.1:8766"));
  await blocked("connection-target edit cancels the one-shot approval without contacting that target");

  await boot();await predict();await connect();
  // Virtual-only playback must also remain available while connected.
  await active().getByRole("button",{name:"▶ 실행",exact:true}).click();
  await active().getByRole("button",{name:"관찰 완료 · 비교하기",exact:true}).waitFor();
  assert.equal(moves().length,0);
  passed.push("existing virtual-only playback remains available with hardware connected and sends no robot operation");

  await boot();await predict();await connect();
  await page.getByRole("button",{name:"삼각형",exact:true}).click();
  await page.waitForTimeout(300);assert.equal(moves().length,0);

  await boot();await predict();await connect();
  await page.evaluate(()=>window.__practice.setSetupDraft({...window.__practice.setupDraft,
    workspace:{...window.__practice.setupDraft.workspace,xMax:290}}));
  await id("button-practice-panel").click();
  for(const check of await page.locator('[data-testid^="check-"]').all())await check.check();
  await id("button-apply-setup").click();await id("button-confirm-ok").click();await id("button-practice-panel").click();
  await id("button-square-continuous-run").click();
  await page.getByRole("alert").filter({hasText:/작업 범위|범위 밖/}).waitFor();
  assert.equal(moves().length,0);
  passed.push("out-of-range correct student path is rejected before virtual/physical combined start");

  await boot();await predict();await connect();await approve(true);
  Object.assign(mock.measurement,{error:true,robotMode:9});mock.publish();
  await blocked("robot fault during virtual cancels the continuation; clearing fault cannot restart it");
  Object.assign(mock.measurement,{error:false,robotMode:5});mock.publish();
  await page.waitForTimeout(350);assert.equal(moves().length,0);

  await boot();await predict();await connect();await approve(true);mock.pause=true;
  await page.waitForTimeout(2400);
  await page.evaluate(()=>{window.__freeze=false;});
  await blocked("stale telemetry during virtual never reaches a physical start");

  await boot();await predict();
  await id("button-square-continuous-run").click();
  await page.getByRole("alert").filter({hasText:/실제 로봇 모드/}).waitFor();
  assert.equal(moves().length,0);
  await active().getByRole("button",{name:"▶ 실행",exact:true}).click();
  await active().getByRole("button",{name:"관찰 완료 · 비교하기",exact:true}).waitFor();
  assert.equal(moves().length,0);
  passed.push("virtual-only execution still works without any connection; continuous run cannot bypass readiness");

  // Root-app proof: no fixture state machine, no physical button after DT.
  await boot(true);await predict({p2x:"300.05"});await connect();await approve();
  await id("square-continuous-status").filter({hasText:"연속 실행 완료"}).waitFor();
  assert.equal(moves().length,5);assert.deepEqual(moves().map(r=>r.operation.target),expected);
  const rootTrace=await page.evaluate(()=>window.__sendTrace);
  assert(rootTrace.every(t=>t.virtualEvidence?.closure?.closed&&t.virtualEvidence?.returnedToInitialPose));
  evidence.push({scenario:"real-root-app",trace:rootTrace,noClickBetweenVirtualAndHardware:true});
  passed.push("actual root app: student entry/navigation, correct decimal, one approval, virtual completion then automatic same-path mock execution with no intervening click");
  assert.deepEqual(errors,[]);
  fs.mkdirSync("generated-artifacts",{recursive:true});
  await page.screenshot({path:"generated-artifacts/square-continuous-root.png"});
  const report={passed,evidence,browserErrors:errors,realRobotCommands:0,serverWrites:0,realProviderCalls:0,
    entry:"synthetic browser response",hardware:"browser-only mock",virtual:"actual square FK/IK animation and saved closure/return evidence"};
  fs.writeFileSync("generated-artifacts/square-continuous.json",JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed,browserErrors:errors,realRobotCommands:0,serverWrites:0,realProviderCalls:0},null,2));
  mock.dispose();await context.close();await browser.close();
})().catch(async error=>{
  console.error(error);
  if(page)console.error((await page.locator("body").innerText().catch(()=>"")).slice(-4500));
  mock?.dispose();await browser?.close();process.exit(1);
});
