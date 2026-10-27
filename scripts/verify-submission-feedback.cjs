// Submission feedback through the real shared controller and real 2-1/2-2 UI.
// All learning HTTP intercepted; browser-only sockets; no real AI or robot.
const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const {installMockBridge}=require("./mg400-mock-socket.cjs");
const URL=process.env.REPLIT_DEV_DOMAIN?`https://${process.env.REPLIT_DEV_DOMAIN}/`:"http://localhost:80/";
const fixture=`<!doctype html><html lang="ko"><meta charset="utf-8"><div id="root"></div><script type="module">
import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
const React=(await import('/node_modules/.vite/deps/react.js')).default;
const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
const {LearningAiFeedback,useLearningAi}=await import('/src/LearningAiFeedback.tsx');
const {TutorHost}=await import('/src/TutorHost.tsx');
const {setLearningUser}=await import('/src/learningClient.ts');
setLearningUser({id:"feedback-fixture",role:"student",login:"feedback-fixture",visitId:"feedback-fixture-visit"});
const h=React.createElement;
const base={task:"axis-x-plus",condition:JSON.stringify({problem:{task:{id:"x-plus"},condition:{relation:"same-half",reference:{axis:"x",sign:1,distance:50},goal:{axis:"x",sign:1,distance:25}}}}),
 answers:JSON.stringify({deltaX:50,deltaY:0,deltaZ:0}),reason:"",judgment:JSON.stringify({status:"incorrect",errors:["distance"]}),execution:"{}",initialPrediction:"{}",history:"[]",support:"guided",attempts:0};
function Test(){
 const [context,setContext]=React.useState(base),ai=useLearningAi(context);
 window.__ai=ai;window.__base=base;window.__set=setContext;window.__ctx=context;
 return h(React.Fragment,null,h("label",null,"편집 테스트",h("input",{"aria-label":"편집 테스트",onChange:e=>setContext({...context,answers:JSON.stringify({deltaX:e.target.value})})})),
  h(LearningAiFeedback,{ai}),h(TutorHost));
}
createRoot(document.getElementById("root")).render(h(Test));
</script></html>`;
let browser;
(async()=>{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||"/repl/tools/bin/chromium",args:["--disable-webgl","--disable-gpu"]});
  const context=await browser.newContext({viewport:{width:1536,height:900}});
  const mock=await installMockBridge(context),requests=[],errors=[],passed=[];
  let delay=false,release,fail=false;
  await context.route("**/__submission-feedback",route=>route.fulfill({contentType:"text/html",body:fixture}));
  await context.route("**/api/learning/**",async route=>{
    const req=route.request(),path=new globalThis.URL(req.url()).pathname;
    if(path.endsWith("/feedback")){
      requests.push(req.postDataJSON());
      if(delay)await new Promise(resolve=>{release=resolve;});
      try{return await route.fulfill(fail?{status:503,json:{error:"isolated failure"}}:{json:{provider:"openai",status:"provided",text:"시험용 직접 질문 응답",createdAt:new Date().toISOString()}});}catch{return;}
    }
    let data={};
    if(path.endsWith("/student/enter"))data={user:{id:"submit-ui-only",login:"submit-ui-only",role:"student",visitId:"submit-ui-isolated"}};
    if(path.endsWith("/records"))data={acknowledged:req.postDataJSON().events.map(e=>e.eventId)};
    return route.fulfill({json:data});
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on("pageerror",e=>errors.push(e.message));
  const id=name=>page.getByTestId(name),notice=()=>id("notice-ai-tutor-feedback"),panel=()=>id("panel-ai-tutor");
  const last=()=>page.locator(".ait-msg--tutor").last();
  const submit=(submissionId,correct=false)=>page.evaluate(({submissionId,correct})=>{
    const c={...window.__ctx,judgment:JSON.stringify({status:correct?"correct":"incorrect",errors:correct?[]:["distance"]})};
    return window.__ai.request("submit",c,"",submissionId);
  },{submissionId,correct});
  await page.goto(new globalThis.URL("__submission-feedback",URL).href);
  await id("button-ai-tutor-open").waitFor();
  await page.getByLabel("편집 테스트").fill("50");
  assert.equal(await notice().count(),0);
  await submit("one");
  await submit("double-tap-different-event-id");
  assert.match(await notice().innerText(),/방향은 맞아요.*절반/);
  await notice().click();
  assert.match(await last().innerText(),/오답 1회/);assert.doesNotMatch(await last().innerText(),/\b25\b/);
  const count=await page.locator(".ait-msg--tutor").count();
  await submit("one");assert.equal(await page.locator(".ait-msg--tutor").count(),count);
  await submit("one",true);assert.equal(await page.locator(".ait-msg--tutor").count(),count);
  await page.waitForTimeout(375);
  await page.evaluate(()=>window.__ai.request("result",window.__ctx,"","same-answer-execution-update"));
  assert.equal(await page.locator(".ait-msg--tutor").count(),count);
  await page.getByLabel("편집 테스트").fill("40");assert.equal(await page.locator(".ait-msg--tutor").count(),count);
  await submit("two");assert.match(await last().innerText(),/오답 2회.*|50 ÷ 2 = 25/s);
  assert.match(await last().innerText(),/50 ÷ 2 = 25/);
  await page.getByLabel("편집 테스트").fill("25");await submit("three",true);
  assert.match(await last().innerText(),/올바르게 고쳤/);
  assert.equal(requests.length,0);
  passed.push("typing is silent; first wrong gives targeted hint without 25; retry explains calculation; corrected answer identifies fixed distance; same submission ID never repeats");
  await page.evaluate(()=>window.__set({...window.__base,task:"axis-y-minus",condition:JSON.stringify({problem:{id:"different-task"}})}));
  assert.equal(await page.locator(".ait-msg--tutor").count(),0);
  await submit("different-task");
  assert.match(await last().innerText(),/오답 1회/);
  await page.evaluate(()=>window.__set(window.__base));
  assert.equal(await page.locator(".ait-msg--tutor").count(),3);
  passed.push("per-problem retry count and conversations survive returning, without a verdict on navigation");
  await page.evaluate(()=>window.__set({...window.__base,task:"axis-relation-review",condition:'{"problem":{"id":"review"}}'}));
  await submit("relation-wrong");
  await page.evaluate(async()=>{
    const corrected={...window.__ctx,answers:JSON.stringify({deltaX:25,deltaY:0,deltaZ:0}),judgment:JSON.stringify({status:"correct"})};
    await window.__ai.request("submit",corrected,"","relation-correct",true);
    window.__set({...window.__base,task:"axis-after-advance",condition:'{"problem":{"id":"next"}}'});
  });
  assert.match(await last().innerText(),/이전 문항·단계의 자동 피드백.*올바르게 고쳤/s);
  passed.push("correction followed by automatic lesson advance remains explicitly labeled previous-question feedback, not a new-question verdict");
  const outcomes=await page.evaluate(async()=>{
    const {submittedAssessment,automaticHint}=await import("/src/submissionFeedback.ts");
    const make=j=>({...window.__base,judgment:JSON.stringify(j)});
    return {
      prose:submittedAssessment(make({reasonProvided:false,teacherReviewRequested:true})),
      proseStatus:submittedAssessment({...make({status:"incorrect",reason:"자유 서술 교사 확인"}),task:"foundation"}),
      failure:submittedAssessment(make({status:"unavailable",error:"작업 범위 밖"})),
      editing:submittedAssessment(make({status:"unconfirmed",currentDraftPendingCheck:true})),
      numeric:submittedAssessment(make({fieldStatuses:{deltaX:"correct",deltaY:"incorrect"},reasonProvided:false})),
      coordinate:submittedAssessment(make({fields:[{field:"delta",axis:"x",correct:false,value:300,expected:50}],observed:false,comparisonCorrect:true,ruleCorrect:true})),
      comparison:submittedAssessment(make([{key:"a",matched:true},{key:"b",matched:false}])),
      direction:automaticHint(window.__base,{correct:false,errors:[{key:"sign",label:"sign"}],keys:[]},1,1),
      axis:automaticHint(window.__base,{correct:false,errors:[{key:"axis",label:"axis"}],keys:[]},1,1),
    };
  });
  assert.equal(outcomes.prose,null);assert.equal(outcomes.failure,null);assert.equal(outcomes.editing,null);
  assert.equal(outcomes.proseStatus,null);
  assert.equal(outcomes.numeric.correct,false);assert.equal(outcomes.coordinate.correct,false);assert.equal(outcomes.comparison.correct,false);
  assert.match(outcomes.direction,/부호/);assert.match(outcomes.axis,/축/);
  const progression=await page.evaluate(async()=>{
    const {automaticHint,submittedAssessment}=await import("/src/submissionFeedback.ts");
    const c=window.__base,a=submittedAssessment(c);
    return [2,3,4].map(n=>automaticHint(c,a,n,n).split("\n").slice(1).join("\n"));
  });
  assert.equal(new Set(progression).size,3);
  assert.match(progression[1],/역산/);assert.match(progression[2],/세 칸/);
  await id("select-ai-tutor-mode").selectOption("gpt");
  delay=true;
  await id("input-ai-tutor").fill("힌트만 주세요");await id("button-ai-tutor-send").click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="status-ai-tutor"]')?.textContent.includes("준비 중"));
  await page.evaluate(()=>window.__set({...window.__base,task:"axis-other",condition:'{"problem":{"id":"other"}}'}));
  delay=false;release();await page.waitForTimeout(150);
  assert.doesNotMatch(await panel().innerText(),/시험용 직접 질문 응답/);
  fail=true;await id("input-ai-tutor").fill("힌트만 주세요");await id("button-ai-tutor-send").click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="status-ai-tutor"]')?.textContent.includes("연결 오류"));
  await submit("available-during-outage");
  assert.match(await last().innerText(),/자동 피드백/);
  assert.doesNotMatch(await panel().innerText(),/시험용 직접 질문 응답/);
  passed.push("free prose, absent/failed motion and unconfirmed edits are not graded; axis/sign and coordinate errors use objective verdicts; late direct responses discarded; automatic hint survives feedback API failure");
  fail=false;
  await page.goto(URL);
  await page.getByLabel("학생 아이디",{exact:true}).fill("submit-ui-only");
  await page.getByRole("button",{name:"학습 시작",exact:true}).click();
  async function navigate(name){
    const nav=page.getByRole("navigation",{name:"학습 목차",exact:true});
    if(await nav.evaluate(e=>e.parentElement.style.transform.includes("-100%")))await page.getByRole("button",{name:"☰",exact:true}).click();
    await nav.getByRole("button",{name}).click();await id("button-task-start").waitFor();
  }
  await navigate(/좌표축과 이동 방향/);
  await id("button-ai-tutor-open").click();await id("select-ai-tutor-mode").selectOption("trial");await id("button-ai-tutor-close").click();
  for(const axis of ["X","Y","Z"])await page.getByLabel(`예상 변화량 ${axis}`,{exact:true}).fill(axis==="X"?"50":"0");
  await page.getByRole("radio",{name:"이동 방향은 같고, 이동 거리는 절반이다",exact:true}).check();
  assert.equal(await notice().count(),0);
  await page.getByRole("button",{name:"예측 저장 · DT 실행",exact:true}).click();
  await notice().waitFor();assert.match(await notice().innerText(),/50 mm의 절반/);
  for(const [width,height] of [[390,844],[844,390],[1536,900]]){
    await page.setViewportSize({width,height});await page.waitForTimeout(150);
    const n=await notice().boundingBox();
    const bottom=await page.locator(".workspace-layout").evaluate(e=>e.getBoundingClientRect().bottom);
    assert(n.x>=0&&n.y>=0&&n.x+n.width<=width+1&&n.y+n.height<=height+1&&bottom<=n.y+1);
    if(width===390)await page.screenshot({path:"/tmp/mg400-submission-notice-mobile.png"});
  }
  await notice().click();
  assert.match(await last().innerText(),/오답 1회/);
  for(const [value,correct] of [["40",false],["25",true]]){
    await id("button-ai-tutor-close").click();
    await page.locator(".axis-inline-revision").getByRole("button",{name:"이동 거리의 크기",exact:true}).click();
    await page.getByLabel("예상 변화량 X",{exact:true}).fill(value);
    await page.locator(".axis-inline-revision button.lesson-primary").click();
    await notice().waitFor();await notice().click();
    assert.match(await last().innerText(),correct?/올바르게 고쳤/:/오답 2회/);
  }
  await id("button-ai-tutor-close").click();
  await navigate(/절대좌표·상대좌표와 변화량/);assert.equal(await notice().count(),0);
  for(const input of await page.locator(".coordinate-learning input[type=number]").all())await input.fill("1");
  for(const select of await page.locator(".coordinate-learning select").all()){
    const value=await select.locator("option").evaluateAll(options=>options.find(o=>o.value)?.value);
    if(value)await select.selectOption(value);
  }
  assert.equal(await notice().count(),0);
  await page.getByRole("button",{name:/절대.*실행/}).first().click();
  await notice().waitFor();assert.match(await notice().innerText(),/좌표|변화량/);
  await notice().click();assert.match(await last().innerText(),/자동 피드백/);
  assert.doesNotMatch(await panel().innerText(),/50 mm의 절반/);
  for(const correct of [false,true]){
    await id("button-ai-tutor-close").click();
    await page.getByRole("button",{name:"입력·예측 수정하기",exact:true}).click();
    for(const input of await page.locator(".coordinate-learning input[type=number]").all()){
      const label=await input.getAttribute("aria-label");
      const axis=label.slice(-1).toLowerCase(),values=/Δ|변화량/.test(label)?{x:50,y:-100,z:0}:{x:300,y:-50,z:0};
      await input.fill(String(correct?values[axis]:2));
    }
    for(const select of await page.locator(".coordinate-learning select").all()){
      const value=await select.locator("option").evaluateAll(options=>options.find(o=>o.value)?.value);
      if(value)await select.selectOption(value);
    }
    await page.getByRole("button",{name:/절대.*실행/}).first().click();
    await notice().waitFor();await notice().click();
    assert.match(await last().innerText(),correct?/올바르게 고쳤/:/오답 2회/);
  }
  passed.push("actual 2-1 UI: wrong 50 → wrong 40 → correct 25; actual 2-2 UI: wrong → wrong → corrected coordinate submission; typing and chapter navigation alone produce no feedback");
  assert.equal(mock.requests.length,0);assert.deepEqual(errors,[]);
  await page.screenshot({path:"/tmp/mg400-submission-feedback.png"});
  console.log(JSON.stringify({passed,mockFeedbackRequests:requests.length,realRobotRequests:mock.requests.length,learningServerWrites:0,realAiCalls:0},null,2));
  await browser.close();
})().catch(async e=>{console.error(e);if(browser)await browser.close();process.exitCode=1;});
