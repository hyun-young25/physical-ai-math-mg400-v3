// Prediction–execution diagnosis loop on square task 2.1 (기초 1), challenge mode.
// Real components in an isolated browser; HTTP/robot sockets intercepted, no paid AI,
// no DB writes and no physical motion. Optional screenshots: SQUARE_DIAGNOSIS_SHOTS=<dir>.
const {chromium}=require("playwright"),assert=require("node:assert/strict"),path=require("node:path"),fs=require("node:fs");
const {installMockBridge}=require("./mg400-mock-socket.cjs");
const {fixture}=require("./verify-square-flow.cjs");
const base=process.env.REPLIT_DEV_DOMAIN?`https://${process.env.REPLIT_DEV_DOMAIN}/`:"http://localhost:80/";
const shots=process.env.SQUARE_DIAGNOSIS_SHOTS;
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||"/repl/tools/bin/chromium",args:["--disable-webgl","--disable-gpu"]});
  const context=await browser.newContext({viewport:{width:1500,height:1000}});
  await context.routeWebSocket("**",ws=>ws.close());
  const mock=await installMockBridge(context),errors=[],passed=[];
  await context.route("**/__square-flow",r=>r.fulfill({contentType:"text/html",body:fixture}));
  await context.route("**/api/**",r=>r.fulfill(new URL(r.request().url()).pathname.endsWith("/feedback")
    ?{status:503,json:{error:"isolated"}}:{json:{acknowledged:[]}}));
  const page=await context.newPage();page.setDefaultTimeout(12000);
  page.on("pageerror",e=>errors.push(e.message));
  const id=n=>page.getByTestId(n),active=()=>page.locator(".shape-step-active");
  const moves=()=>mock.requests.filter(r=>r.type==="execute"&&r.operation.kind==="move");
  const shot=async name=>{if(shots){fs.mkdirSync(shots,{recursive:true});await page.screenshot({path:path.join(shots,name),fullPage:false});}};
  async function stage(n){await page.waitForFunction(n=>document.querySelector(".shape-step-progress")?.textContent.includes(n+"/7"),n);}
  async function fillStage(overrides={}){
    const lesson=await page.evaluate(()=>window.__lessons[0]),expected=await page.evaluate(()=>window.__expected[0]);
    for(const q of [...lesson.concept,...lesson.relations,...lesson.calculation,...lesson.prediction]){
      const input=active().getByLabel(q.label,{exact:true});
      if(await input.count()){
        const value=String(Object.hasOwn(overrides,q.key)?overrides[q.key]:expected[q.key]);
        if(q.options)await input.selectOption(value);else await input.fill(value);
      }
    }
    if(await active().getByLabel("예측 근거",{exact:true}).count())
      await active().getByLabel("예측 근거",{exact:true}).fill("P1에서 가로·세로 길이만큼 각 축으로 이동해 꼭짓점을 구했습니다.");
  }
  async function predict(overrides={},from=1){
    for(let n=from;n<=3;n++){
      await stage(n);await fillStage(overrides);
      await active().getByRole("button",{name:n===3?"예측 저장 · 실행 준비":"확인하고 다음",exact:true}).click();
    }
    await stage(4);
  }
  const records=()=>page.evaluate(()=>{
    const key=Object.keys(localStorage).find(k=>k.includes("physical-ai-inquiry-evidence-v1"));
    return JSON.parse(localStorage.getItem(key)??"[]").filter(r=>r.task==="square");
  });

  await page.goto(new URL("__square-flow",base).href);
  await page.locator(".shape-step-progress").waitFor();
  await page.locator(".shape-lesson-settings summary").click();
  await page.getByLabel("도형 학습 지원",{exact:true}).selectOption("challenge");

  // 1) The learner swaps width and height: P2(400, 100), P3(400, 0), P4(200, 0).
  await predict({p2x:"400",p3x:"400",p3y:"0",p4y:"0"});
  await shot("01-prediction-saved.png");
  await active().getByRole("button",{name:/실행/}).filter({hasText:/실행/}).first().click();
  await stage(5);
  await shot("02-dt-executed-wrong-shape.png");
  await active().getByRole("button",{name:"관찰 완료 · 비교하기",exact:true}).click();await stage(6);
  const panel=id("square-diagnosis");await panel.waitFor();
  assert.equal(await panel.getAttribute("data-type"),"axis-swap");
  assert.equal(await panel.getAttribute("data-level"),"task");
  const text=await panel.innerText();
  assert.match(text,/X 방향 200 mm, Y 방향 100 mm/);
  assert.match(text,/P1 → P2[\s\S]*\+X 100 mm[\s\S]*\+X 200 mm[\s\S]*다름/);
  assert.doesNotMatch(text,/\(300, 100\)|\(300, −100\)/,"correct vertices are not revealed");
  assert.equal(await id("button-shape-hardware-run").count(),0,"a wrong plan never qualifies for hardware");
  passed.push("wrong (axis-swapped) plan runs in DT only and is diagnosed from the executed edges, without revealing answers");
  // The tutor opens with the same leveled question (rule-based, no AI call needed).
  await page.getByText(/실행 결과 비교 · 1단계/).first().waitFor();
  assert.match(await page.getByText(/실행 결과 비교 · 1단계/).first().innerText(),/X 방향 200 mm, Y 방향 100 mm/);
  passed.push("tutor shows the diagnosis question (level 1: observe what differs)");
  await panel.scrollIntoViewIfNeeded();await shot("03-diagnosis-and-tutor.png");

  // 2) A cause explanation is required before revising; then only coordinates are re-planned.
  const revise=active().getByRole("button",{name:"이유 저장 · 예측 고쳐 다시 실행",exact:true});
  assert.equal(await revise.isDisabled(),true);
  for(const [label,value] of [["다시 판단 P2의 X","300"],["다시 판단 P3의 X","300"],["다시 판단 P3의 Y","-100"],["다시 판단 P4의 Y","-100"]])
    if(await active().getByLabel(label,{exact:true}).count())await active().getByLabel(label,{exact:true}).fill(value);
  await active().getByLabel("차이가 생긴 이유",{exact:true}).fill("가로는 X 방향 100 mm인데 세로 길이 200을 X에 더해서 눕혀진 사각형이 됐습니다.");
  await shot("04-cause-explained.png");
  await revise.click();await stage(3);
  let saved=await records();
  assert.equal(saved[0].mismatchDiagnoses[0].type,"axis-swap");
  assert.match(saved[0].mismatchDiagnoses[0].causeExplanation,/세로 길이 200을 X에/);
  assert.equal(saved[0].mismatchDiagnoses[0].supportMode,"challenge");
  passed.push("diagnosis type, level, question, evidence and the learner's cause explanation are stored in the learning record");

  // 3) Corrected plan → fresh DT run → match, with a self-regulation question.
  await predict({},3);
  await active().getByRole("button",{name:/실행/}).filter({hasText:/실행/}).first().click();
  await stage(5);
  await active().getByRole("button",{name:"관찰 완료 · 비교하기",exact:true}).click();await stage(6);
  await panel.waitFor();
  assert.equal(await panel.getAttribute("data-type"),"match");
  assert.equal(await panel.getAttribute("data-level"),"self-regulation");
  assert.match(await panel.innerText(),/축·길이 뒤바뀜/);
  await panel.scrollIntoViewIfNeeded();await shot("05-corrected-match.png");
  await active().getByLabel("차이가 생긴 이유",{exact:true}).fill("각 변에서 변하는 축과 길이를 먼저 표시하고 계산한다.");
  await active().getByLabel("비교 후 내 판단",{exact:true}).selectOption("maintain");
  await active().getByRole("button",{name:"비교 확인 저장",exact:true}).click();
  saved=await records();
  assert.equal(saved.length,2);assert.equal(saved[1].previousId,saved[0].id);
  assert.equal(saved[1].mismatchDiagnoses[0].level,"self-regulation");
  assert.match(saved[1].mismatchDiagnoses[0].causeExplanation,/먼저 표시하고/);
  passed.push("re-execution of the corrected plan matches; the loop closes with a self-regulation question");

  // 4) Repeated same-type errors in one session escalate: challenge mode keeps the observation
  //    question one step longer, then names the relation, then gives a worked example + teacher flag.
  await page.goto(new URL("__square-flow",base).href);await page.locator(".shape-step-progress").waitFor();
  await page.locator(".shape-lesson-settings summary").click();
  await page.getByLabel("도형 학습 지원",{exact:true}).selectOption("challenge");
  const swapped={p2x:"400",p3x:"400",p3y:"0",p4y:"0"};
  for(const [n,level] of [[1,"task"],[2,"task"],[3,"process"],[4,"worked"]]){
    await predict(swapped,n===1?1:3);
    await active().getByRole("button",{name:/실행/}).filter({hasText:/실행/}).first().click();await stage(5);
    await active().getByRole("button",{name:"관찰 완료 · 비교하기",exact:true}).click();await stage(6);
    await panel.waitFor();
    assert.equal(await panel.getAttribute("data-level"),level,`attempt ${n}`);
    if(level==="process")assert.match(await panel.innerText(),/관계 힌트/);
    if(level==="worked"){assert.match(await panel.innerText(),/선생님 화면에 도움 요청/);await panel.scrollIntoViewIfNeeded();await shot("06-level3-teacher.png");break;}
    await active().getByLabel("차이가 생긴 이유",{exact:true}).fill(`시도 ${n}: 아직 원인을 잘 모르겠습니다.`);
    await active().getByRole("button",{name:"이유 저장 · 예측 고쳐 다시 실행",exact:true}).click();await stage(3);
  }
  const flagged=(await records()).flatMap(r=>r.mismatchDiagnoses??[]);
  assert.deepEqual(flagged.map(d=>d.level),["task","task","process","worked"]);
  assert.equal(flagged.at(-1).teacherFlag,true);
  passed.push("same-type repetitions escalate task → process → worked example with a teacher flag (challenge mode fades one step later)");
  assert.equal(moves().length,0,"no robot motion");
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed,browserErrors:errors,realRobotCommands:moves().length},null,2));
  await browser.close();
})().catch(async error=>{console.error(error);process.exitCode=1;process.exit(1);});
