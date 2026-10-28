require("./isolated-ui-fixtures.cjs");
const {chromium}=require("playwright"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const fixture=require("./verify-square-flow.cjs").fixture.replace("style:{height:1000,width:850}","className:'curriculum-body',style:{height:700,width:850,display:'flex',flexDirection:'column',overflow:'hidden'}");
(async()=>{
 const browser=await chromium.launch({args:["--disable-webgl","--disable-gpu"]});
 try{
 const context=await browser.newContext({viewport:{width:1120,height:980}});
 let writes=0;const errors=[],passed=[];
 await context.route("**/api/**",r=>{if(r.request().method()!=="GET")writes++;return r.fulfill({json:{}});});
 await context.route("**/__paper-rectangle",r=>r.fulfill({contentType:"text/html",body:fixture}));
 const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));page.setDefaultTimeout(15000);
 await page.goto("http://localhost/__paper-rectangle");
 const shots=path.resolve(__dirname,"../../diagnosis-qa");fs.mkdirSync(shots,{recursive:true});
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
 assert.equal(await page.locator(".square-type-chips span").count(),9);
 assert.equal(await page.locator(".square-decision-section").count(),5);
 await view.getByLabel("차이가 생긴 이유").fill("기준점 O를 더하니 목표와 일치했습니다.");await click("생각 저장");
 await page.getByTestId("paper-diagnosis-visual").screenshot({path:path.join(shots,"07-paper-v4-dt.png")});
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith("physical-ai-square-attempts-v1")))||"[]"));
 assert.equal(saved.length,1);assert.equal(saved[0].taskVersion,"v4-paper-merged");assert.equal(saved[0].taskIndex,4);assert.equal(saved[0].studentCause,"기준점 O를 더하니 목표와 일치했습니다.");assert.equal(saved[0].source,"dt");assert.equal(saved[0].questionSource,"rules");
 // A mocked response is recorded only after it has actually been displayed.
 await page.evaluate(()=>{
   const attemptKey=Object.keys(localStorage).find(k=>k.endsWith("physical-ai-square-attempts-v1")),a=JSON.parse(localStorage.getItem(attemptKey))[0];
   const [,condition,answers,execution]=JSON.parse(a.visual.feedbackKey),key=attemptKey.replace("physical-ai-square-attempts-v1","physical-ai-inquiry-feedback-v1");
   const row={id:"mock-gpt-visible",feedbackStatus:"requested",prediction:{task:"paper-coordinate",condition,answers,execution,judgment:JSON.stringify({candidate:"검증용 판정"})},feedback:{provider:"openai",text:"검증용 모의 GPT 문장",createdAt:new Date().toISOString()}};
   localStorage.setItem(key,JSON.stringify([row]));window.dispatchEvent(new CustomEvent("learning-evidence-written",{detail:{key:"physical-ai-inquiry-feedback-v1"}}));
 });
 assert.equal(await page.getByTestId("square-diagnosis").getByText("검증용 모의 GPT 문장",{exact:true}).count(),0);
 await page.evaluate(()=>{
   const key=Object.keys(localStorage).find(k=>k.endsWith("physical-ai-inquiry-feedback-v1")),rows=JSON.parse(localStorage.getItem(key));rows[0].feedbackStatus="displayed";
   localStorage.setItem(key,JSON.stringify(rows));window.dispatchEvent(new CustomEvent("learning-evidence-written",{detail:{key:"physical-ai-inquiry-feedback-v1"}}));
 });
 await page.getByTestId("square-diagnosis").getByText(/검증용 모의 GPT 문장/).waitFor();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith("physical-ai-square-attempts-v1"))))[0].questionSource==="rules+openai");
 passed.push("late displayed GPT wording updates the same attempt; unshown response is excluded (mocked, no paid API)");
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
