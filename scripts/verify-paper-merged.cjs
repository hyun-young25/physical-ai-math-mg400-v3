require("./isolated-ui-fixtures.cjs");
const {chromium}=require("playwright"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const fixture=require("./verify-square-flow.cjs").fixture.replace("style:{height:1000,width:850}","className:'curriculum-body',style:{height:700,width:850,display:'flex',flexDirection:'column',overflow:'hidden'}");
(async()=>{
 const browser=await chromium.launch({args:["--disable-webgl","--disable-gpu"]});
 try{
 const context=await browser.newContext({viewport:{width:1120,height:980}});
 let writes=0;const errors=[],passed=[],feedbackRequests=[];
 await context.route("**/api/**",r=>{
  const request=r.request();if(request.method()!=="GET")writes++;
  if(new URL(request.url()).pathname.endsWith("/learning/feedback")){
   feedbackRequests.push(request.postDataJSON());
   return r.fulfill({json:{provider:"openai",status:"provided",text:"검증용 모의 GPT 문장",createdAt:new Date().toISOString()}});
  }
  return r.fulfill({json:{}});
 });
 await context.route("**/__paper-rectangle",r=>r.fulfill({contentType:"text/html",body:fixture}));
 const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));page.setDefaultTimeout(15000);
 await page.goto("http://localhost/__paper-rectangle");
 const shots=process.env.DIAG_SHOTS||path.resolve(__dirname,"../../diagnosis-qa");fs.mkdirSync(shots,{recursive:true});
 const click=async name=>page.getByRole("button",{name,exact:true}).click();

 await page.getByRole("button",{name:/종이 기준점 \(DT\)/}).click();
 const view=page.getByRole("region",{name:"종이 좌표 변환 학습"});
 await view.waitFor();
 assert.equal(await view.locator(".pcv-back").count(),0);
 assert.equal(await view.getByLabel("좌표 상황 선택").inputValue(),"advanced-paper-dt");
 assert.match(await view.innerText(),/110 mm, 세로 150 mm/);
 assert.equal(await view.getByLabel("추가 회전 (°)").count(),0);
 await click("다음 단계");
 async function predict(shift=0){
 await view.getByLabel("원점 X (mm)",{exact:true}).fill("180");await view.getByLabel("원점 Y (mm)",{exact:true}).fill("-60");
 await view.getByLabel("1 cm당 길이 (mm)").fill("10");await view.getByLabel("이 관계를 선택한 이유").fill("종이 기준점에 이동량을 더하고 cm를 mm로 바꿉니다.");
 await click("관계 저장");await click("다음 단계");
 await view.getByLabel("직선 경로 명령").selectOption("MoveL");await view.getByLabel("닫힌 경로 ΔX 합").fill("0");await view.getByLabel("닫힌 경로 ΔY 합").fill("0");
 for(const [i,[x,y]] of [[180+shift,-60],[290+shift,-60],[290+shift,90],[180+shift,90]].entries()){
 await view.getByLabel("P"+(i+1)+" 예측 로봇 X · mm").fill(String(x));await view.getByLabel("P"+(i+1)+" 예측 로봇 Y · mm").fill(String(y));
 }
 await click("예측 저장");await click("다음 단계");
 assert.equal(await view.getByRole("button",{name:"실장비에서 확인",exact:true}).count(),0);
 await click("DT에서 확인");
 await page.waitForFunction(()=>{const k=Object.keys(localStorage).find(k=>k.endsWith("physical-ai-paper-coordinate-v1"));return JSON.parse(localStorage.getItem(k)||"[]").at(-1)?.run?.status==="completed";},null,{timeout:45000});
 await click("다음 단계");await click("다음 단계");
 }
 await predict(0);
 assert.equal(await page.getByTestId("square-diagnosis").getAttribute("data-type"),"match");
 assert.equal(await page.locator(".square-edge-cards article").count(),4);
 assert.equal(await page.locator(".square-type-chips span").count(),1);
 assert.equal(await page.locator(".square-decision-section").count(),5);
 await view.getByLabel("차이가 생긴 이유").fill("기준점 O를 더하니 목표와 일치했습니다.");await click("생각 저장");
 await page.getByTestId("paper-diagnosis-visual").screenshot({path:path.join(shots,"07-paper-v4-dt.png")});
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith("physical-ai-square-attempts-v1")))||"[]"));
 assert.equal(saved.length,1);assert.equal(saved[0].taskVersion,"v4-paper-merged");assert.equal(saved[0].taskIndex,4);assert.equal(saved[0].studentCause,"기준점 O를 더하니 목표와 일치했습니다.");assert.equal(saved[0].source,"dt");assert.equal(saved[0].questionSource,"rules");
 // Exercise the real analysis button and displayed-result persistence.
 // Only the HTTP response is mocked; never insert feedback into localStorage.
 const analysis=view.getByRole("region",{name:"실행자료 AI 분석",exact:true});
 await analysis.getByLabel("분석 방식").selectOption("gpt");
 assert.equal(feedbackRequests.length,0,"changing modes alone must not request AI");
 assert.equal(await analysis.getByTestId("execution-ai-result").count(),0);
 await analysis.getByRole("button",{name:"실행자료를 GPT에 보내 분석",exact:true}).click();
 const result=analysis.getByTestId("execution-ai-result");
 await result.waitFor();await result.scrollIntoViewIfNeeded();
 await result.getByText("검증용 모의 GPT 문장",{exact:true}).waitFor();
 assert.equal(feedbackRequests.length,1);
 const request=feedbackRequests[0],execution=JSON.parse(request.execution)[0],condition=JSON.parse(request.condition);
 assert.equal(request.task,"paper-coordinate");assert.equal(execution.source,"dt");
 assert.equal(execution.status,"completed");assert.equal(execution.frameId,condition.frame.id);
 assert.equal(execution.comparisons.length,4);assert.equal(condition.frame.samples.length,3);
 await page.waitForFunction(()=>{
  const key=Object.keys(localStorage).find(k=>k.endsWith("physical-ai-paper-coordinate-v1"));
  return JSON.parse(localStorage.getItem(key)||"[]")[0]?.aiAnalyses?.some(a=>a.text==="검증용 모의 GPT 문장"&&a.displayedAt);
 });
 const recorded=await page.evaluate(()=>{
  const key=Object.keys(localStorage).find(k=>k.endsWith("physical-ai-paper-coordinate-v1"));
  return JSON.parse(localStorage.getItem(key))[0];
 });
 const shown=recorded.aiAnalyses.find(a=>a.text==="검증용 모의 GPT 문장");
 assert.equal(shown.recordId,recorded.id);assert.equal(shown.runId,recorded.run.id);
 assert.equal(shown.planHash,recorded.run.planHash);assert.equal(shown.source,"dt");
 assert.equal(shown.provider,"openai");assert.equal(shown.status,"provided");
 passed.push("real analysis button requests current DT evidence; mocked response is visible in analysis panel and saved against the same attempt/run/plan (no real GPT call)");
 const writesBefore=writes,storedBefore=await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>k.includes("physical-ai")).map(k=>[k,localStorage.getItem(k)])));
 await page.locator(".square-attempt-history button").filter({hasText:"시도 1"}).click();
 await page.getByTestId("square-attempt-review").waitFor();
 assert.equal(await page.getByRole("button",{name:"DT에서 확인",exact:true}).count(),0);
 assert.equal(await page.getByLabel("차이가 생긴 이유").count(),0);
 await page.waitForTimeout(400);
 assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>k.includes("physical-ai")).map(k=>[k,localStorage.getItem(k)]))),storedBefore);
 assert.equal(writes,writesBefore);
 await click("현재 시도로 돌아가기");
 passed.push("DT advanced task uses given O, 110×150 mm targets, MoveL/closure inputs, shared five-section diagnosis and complete attempt snapshot");
 passed.push("history displays stored evidence read-only without executing, changing records or requesting AI");
 await click("다음 단계");
 await view.getByLabel("무엇을 다시 살펴볼까요?").fill("새 기준점에서도 같은 관계를 확인합니다.");
 await click("종이를 옮겼어요 · 기준점 다시 기록");
 assert.match(await view.innerText(),/O: \(200, -40\)/);
 const records=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith("physical-ai-paper-coordinate-v1")))||"[]"));
 assert.equal(records.length,2);assert.equal(records[0].diagnosis.pattern,"match");assert.notEqual(records[0].frame.id,records[1].frame.id);
 await page.getByRole("button",{name:/종이 위 경로 확인 \(MG400\)/}).click();
 assert.equal(await view.getByLabel("좌표 상황 선택").inputValue(),"advanced-paper-hardware");
 await click("다음 단계");assert.match(await view.innerText(),/O\/X\/Y 기준점을 먼저 저장/);
 assert.equal(await view.locator("fieldset.pcv-reference").count(),3);
 assert.match(await view.innerText(),/점 확인 방식/);
 await page.setViewportSize({width:390,height:844});await page.locator("main.curriculum-body").evaluate(el=>el.style.width="100%");
 await page.screenshot({path:path.join(shots,"08-paper-v4-mobile.png"),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 passed.push("new-placement trial preserves prior observations; advanced hardware requires O/X/Y and describes point checks honestly; mobile fits");
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed,writes,errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
