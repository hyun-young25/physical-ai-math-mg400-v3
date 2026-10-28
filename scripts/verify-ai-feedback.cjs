// Isolated real-app UI verification. All learning HTTP is intercepted;
// bridge sockets are browser-only protocol mocks, never a physical robot.
const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const {installMockBridge}=require("./mg400-mock-socket.cjs");
const URL=process.env.REPLIT_DEV_DOMAIN?`https://${process.env.REPLIT_DEV_DOMAIN}/`:"http://localhost:80/";
let browser;
(async()=>{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||"/repl/tools/bin/chromium",args:["--disable-webgl","--disable-gpu"]});
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  const mock=await installMockBridge(context);
  const requests=[],uploads=[],passed=[];
  let responseMode="ai",release;
  await context.route("**/api/learning/**",async route=>{
    const req=route.request(),path=new globalThis.URL(req.url()).pathname;
    if(path.endsWith("/feedback")){
      const body=req.postDataJSON();requests.push(body);
      if(responseMode==="delay")await new Promise(r=>{release=r;});
      if(responseMode==="failure")return route.fulfill({status:503,json:{error:"시험용 장애"}});
      return route.fulfill({json:responseMode==="rules"
        ?{provider:"rules",status:"unconfigured",text:"시험용 기본 안내: 목표 높이와 변화량을 구분하세요.",createdAt:new Date().toISOString()}
        :{provider:"openai",status:"provided",text:body.trigger==="result"
          ?"시험용 AI: 출처와 전후 위치를 확인하고 최초 예측과 어떤 차이가 있는지 비교해 보세요."
           :body.question?`시험용 AI 질문 응답: ${body.question} · 이전 대화 ${body.conversation?.length??0}개`
           :body.reason.trim()?"시험용 AI: 목표 높이와 변화량은 같은 뜻인가요?":"시험용 AI: 어떤 식이나 기준으로 수치를 정했나요?",createdAt:new Date().toISOString()}});
    }
    let data={};
    if(path.endsWith("/student/enter"))data={user:{id:"ai-test-only",role:"student",login:"ai-test-only",visitId:"ai-isolated-visit"}};
    if(path.endsWith("/records")){const body=req.postDataJSON();uploads.push(...body.events);data={acknowledged:body.events.map(e=>e.eventId)};}
    return route.fulfill({json:data});
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(URL);await page.getByLabel("학생 아이디",{exact:true}).fill("ai-test-only");
  await page.getByRole("button",{name:"학습 시작",exact:true}).click();
  await page.getByTestId("button-mode-virtual").waitFor();
  await page.getByText("☰",{exact:true}).click();
  await page.getByRole("navigation",{name:"학습 목차"}).getByRole("button",{name:/용어·기호와 기초수학/}).click();
  const lesson=page.locator(".math-start-lesson");
   const feedback=()=>page.getByRole("dialog",{name:"AI 수학 튜터",exact:true});
   const waitText=text=>feedback().getByText(text,{exact:false}).first().waitFor();
   await page.getByRole("button",{name:"AI 수학 튜터 열기",exact:true}).click();
   await feedback().waitFor();
   await page.getByTestId("select-ai-tutor-mode").selectOption("gpt");
   assert.equal(await page.getByRole("complementary",{name:"맞춤 학습 피드백"}).count(),0);
   await page.getByRole("button",{name:"AI 수학 튜터 접기",exact:true}).click();
   await page.getByRole("button",{name:"AI 수학 튜터 열기",exact:true}).click();
   assert.equal(await feedback().count(),1);
   assert.equal(await feedback().getByRole("button",{name:"왜 틀렸나요?",exact:true}).isEnabled(),false);
   assert.equal(await feedback().getByRole("button",{name:"예상과 실제 결과 비교",exact:true}).isEnabled(),false);
   passed.push("로봇 런처 열기·접기; 단일 대화창; 단계별 질문 버튼 비활성");
  await lesson.getByLabel("① 목표 절대좌표 Z",{exact:true}).fill("20");
  assert.equal(requests.length,0);
  await lesson.getByRole("button",{name:"답 확인 · 다음 힌트 보기 →",exact:true}).click();
  await waitText("자동 피드백");
  assert.equal(requests.length,0); // Objective submission hints do not wait for GPT.
  await feedback().getByRole("button",{name:"힌트만 주세요",exact:true}).click();
  await waitText("시험용 AI 질문 응답: 힌트만 주세요");
  assert.match(requests.at(-1).judgment,/incorrect/);
  assert.equal(requests.at(-1).reason,"");
  assert.equal(await lesson.getByLabel("① 목표 절대좌표 Z",{exact:true}).getAttribute("aria-invalid"),"true");
  assert.equal(mock.requests.length,0);
  passed.push("입력 중 호출 없음; 오답·빈 풀이 확인 질문; GPT 응답은 규칙 판정과 이동을 변경하지 않음");

  responseMode="delay";const oldCount=requests.length;
  const priorConversationCount=await feedback().getByText(/이전 대화/).count();
   await feedback().getByRole("button",{name:"힌트만 주세요",exact:true}).evaluate(b=>{b.click();b.click();});
   await page.waitForFunction(()=>document.querySelector('[data-testid=\"status-ai-tutor\"]')?.textContent.includes("준비 중"));
  assert.equal(requests.length,oldCount+1);
  await lesson.getByLabel("① 목표 절대좌표 Z",{exact:true}).fill("60");
  release();await page.waitForTimeout(150);
   assert.equal(await feedback().getByText(/이전 대화/).count(),priorConversationCount);
  passed.push("중복 요청 방지; 수정 후 오래된 응답은 새 답안에 표시하지 않음");

  responseMode="rules";
   await feedback().getByRole("button",{name:"힌트만 주세요",exact:true}).click();await waitText("OpenAI 미설정");
  responseMode="failure";
   await feedback().getByRole("button",{name:"다시 시도",exact:true}).click();await waitText("연결 오류");
  responseMode="ai";
   await feedback().getByRole("button",{name:"다시 시도",exact:true}).click();await waitText("AI 생성 힌트");
  await feedback().screenshot({path:require("node:path").join(require("node:os").tmpdir(),"mg400-ai-feedback-panel.png")});
  passed.push("API 미설정·장애 기본 안내와 재시도 UI");
   const question=feedback().getByRole("textbox",{name:"튜터에게 질문"});
   await question.fill("목표와 변화량은 왜 다르죠?");
   const countBeforeIme=requests.length;
   await question.dispatchEvent("compositionstart");
   await question.press("Enter");
   await page.waitForTimeout(100);
   assert.equal(requests.length,countBeforeIme);
   await question.dispatchEvent("compositionend");
   await question.press("Enter");
   await waitText("목표와 변화량은 왜 다르죠? · 이전 대화");
   assert.equal(requests.at(-1).question,"목표와 변화량은 왜 다르죠?");
   assert.ok(requests.at(-1).conversation.some(t=>t.source==="rules"));
   await question.fill("방금 설명을 한 단계만 더 알려주세요");
   await feedback().getByRole("button",{name:"질문 전송",exact:true}).click();
   await waitText("방금 설명을 한 단계만 더 알려주세요 · 이전 대화");
   assert.ok(requests.at(-1).conversation.some(t=>t.role==="student"&&t.text==="목표와 변화량은 왜 다르죠?"));
   assert.ok(requests.at(-1).initialPrediction);
   assert.equal(mock.requests.length,0);
   await page.screenshot({path:require("node:path").join(require("node:os").tmpdir(),"mg400-ai-tutor-desktop.png")});
   passed.push("한국어 조합 중 Enter 미전송; 자유 질문·후속 맥락; 실제 받은 기본/시험 AI 출처 유지");

  await lesson.getByRole("button",{name:"답 확인 · 다음 힌트 보기 →",exact:true}).click();
  for(const [label,value] of [["② X축 변화량 ΔX","0"],["③ Y축 변화량 ΔY","0"],["④ Z축 변화량 ΔZ","40"]])
    await lesson.getByLabel(label,{exact:true}).fill(value);
  await lesson.getByRole("button",{name:"답 확인 · 다음 힌트 보기 →",exact:true}).click();
  await lesson.getByLabel("⑤ 이동 명령",{exact:true}).selectOption("MoveL");
  await lesson.getByRole("button",{name:"답 확인 · 다음 힌트 보기 →",exact:true}).click();
  await lesson.getByLabel("예측 근거",{exact:true}).fill("목표 60에서 현재 20을 빼고 수직 직선 이동을 선택했다.");
  await lesson.getByRole("button",{name:"답 확인 · 다음 힌트 보기 →",exact:true}).click();
  await lesson.getByRole("button",{name:"예측·근거 저장",exact:true}).click();
  const final=()=>lesson.getByRole("region",{name:"최종 정답 확인과 로봇 이동"});
  await final().getByRole("button").click();
  await final().getByRole("status").filter({hasText:"가상 로봇이 목표 위치에 도달"}).waitFor();
   await feedback().getByRole("button",{name:"예상과 실제 결과 비교",exact:true}).click();
   await waitText("AI 생성 힌트");
  await page.waitForFunction(()=>document.querySelector('[data-testid="status-ai-tutor"]')?.textContent.includes("응답 완료"));
  const result=requests.filter(r=>r.question==="예상과 실제 결과를 비교해 주세요").at(-1);
  assert.ok(result);assert.match(result.execution,/virtual/);assert.match(result.execution,/before|after|coordinateSystem|mm/);
  assert.match(result.initialPrediction,/40/);
   await feedback().getByRole("button",{name:"예상과 실제 결과 비교",exact:true}).click();
   await waitText("예상과 실제 결과를 비교해 주세요 · 이전 대화");
   assert.match(requests.at(-1).execution,/virtual/);
  assert.equal(mock.requests.length,0);
  await page.getByTestId("button-mode-hardware").click();
  await final().getByRole("button").click();
  await final().getByRole("status").filter({hasText:"로봇 옆 PC에 연결"}).waitFor();
  await feedback().getByRole("button",{name:"예상과 실제 결과 비교",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="status-ai-tutor"]')?.textContent.includes("응답 완료"));
  const blocked=requests.filter(r=>r.question==="예상과 실제 결과를 비교해 주세요").at(-1);
  assert.match(blocked.execution,/motion-attempt|연결/);
   assert.equal(await page.getByRole("dialog").count(),1); // tutor only; no motion approval dialog
  assert.equal(mock.requests.length,0);
  passed.push("정답 가상 실행·전후 위치 비교; 실장비 미연결 차단은 수학 오답과 분리");
  const records=await page.evaluate(()=>JSON.parse(localStorage.getItem("mg400:visit:ai-isolated-visit:physical-ai-inquiry-evidence-v1")||"[]"));
  assert.equal(records[0].prediction.deltaZ,"40");assert.ok(records[0].runs.some(r=>r.status==="completed"));
  const activities=await page.evaluate(()=>JSON.parse(localStorage.getItem("mg400:visit:ai-isolated-visit:physical-ai-inquiry-feedback-v1")||"[]"));
   assert.ok(activities.every(a=>a.feedbackStatus==="displayed"));
  assert.ok(activities.some(a=>a.feedback?.provider==="rules"));
  assert.ok(activities.some(a=>a.feedback?.provider==="openai"&&a.feedbackStatus==="displayed"));
  await page.waitForTimeout(300);
  assert.ok(uploads.some(e=>e.storeKey==="physical-ai-inquiry-feedback-v1"));
  assert.deepEqual(errors,[]);
   passed.push("최초 답·풀이 보존; 실제 표시된 질문·힌트만 별도 교사용 전송; 폐기된 응답 제외");
  await page.getByTestId("button-mode-virtual").click();
  for(const [nav,taskPattern] of [["좌표와 로봇 이동",/^coordinate-/],["로봇 운동학",/^(fk|ik)$/]]) {
    responseMode="delay";
    await feedback().getByRole("textbox",{name:"튜터에게 질문"}).fill("전환 전 질문");
    await feedback().getByRole("button",{name:"질문 전송",exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-testid="status-ai-tutor"]')?.textContent.includes("준비 중"));
    await page.getByText("☰",{exact:true}).click();
    await page.getByRole("navigation",{name:"학습 목차"}).getByRole("button",{
      name:nav==="좌표와 로봇 이동"?/절대좌표·상대좌표와 변화량/:/순기구학\(FK\)/,
    }).click();
    release();responseMode="ai";
    await page.waitForTimeout(100);
     const panel=feedback();
     assert.equal(await panel.getByText(/전환 전 질문/).count(),0);
     await panel.getByRole("button",{name:"힌트만 주세요",exact:true}).click();
     await panel.getByText("AI 생성 힌트",{exact:true}).first().waitFor();
    assert.match(requests.at(-1).task,taskPattern);
    assert.deepEqual(requests.at(-1).conversation,[]);
    assert.equal(mock.requests.length,0);
  }
  assert.deepEqual(errors,[]);
  passed.push("좌표·벡터 비교 화면과 운동학 화면에서도 공통 피드백 동작; 실장비 명령 없음");
  const desktop=await page.evaluate(()=>{
    const panel=document.querySelector('[data-testid="panel-ai-tutor"]').getBoundingClientRect();
    const app=document.querySelector('#root > .h-screen').getBoundingClientRect();
    return {panelLeft:panel.left,appRight:app.right};
  });
  assert.ok(desktop.appRight<=desktop.panelLeft);
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(200);
  const mobile=await page.evaluate(()=>{
    const panel=document.querySelector('[data-testid="panel-ai-tutor"]').getBoundingClientRect();
    const app=document.querySelector('#root > .h-screen').getBoundingClientRect();
    const input=document.querySelector('[data-testid="input-ai-tutor"]').getBoundingClientRect();
    const close=document.querySelector('[data-testid="button-ai-tutor-close"]').getBoundingClientRect();
    return {panelTop:panel.top,appBottom:app.bottom,inputBottom:input.bottom,closeTop:close.top,width:document.documentElement.scrollWidth,
      appHeight:app.height,appTop:app.top,headerVariable:getComputedStyle(document.documentElement).getPropertyValue("--ai-tutor-header"),
      dockVariable:getComputedStyle(document.documentElement).getPropertyValue("--ait-dock-h"),bodyClass:document.body.className};
  });
  await page.screenshot({path:require("node:path").join(require("node:os").tmpdir(),"mg400-ai-tutor-mobile.png")});
  assert.ok(mobile.appBottom<=mobile.panelTop+2,JSON.stringify(mobile));
  assert.ok(mobile.inputBottom<=844&&mobile.closeTop>=0,JSON.stringify(mobile));
  assert.equal(mobile.width,390);
  await page.screenshot({path:require("node:path").join(require("node:os").tmpdir(),"mg400-ai-tutor-mobile.png")});
  await feedback().getByRole("button",{name:"AI 수학 튜터 닫기",exact:true}).click();
  await page.getByRole("button",{name:"AI 수학 튜터 열기",exact:true}).waitFor();
  await page.getByRole("button",{name:"AI 수학 튜터 열기",exact:true}).click();
  await feedback().getByRole("textbox",{name:"튜터에게 질문"}).press("Escape");
  assert.equal(await page.getByRole("button",{name:"AI 수학 튜터 열기",exact:true}).evaluate(el=>el===document.activeElement),true);
  passed.push("단원 전환 후 늦은 답변 폐기·맥락 분리; 데스크톱 비중첩; 모바일 입력·닫기·접기·초점 복귀");
  console.log(JSON.stringify({passed,requests:requests.length,activities:activities.length,realRobotSockets:0,learningServerWrites:0},null,2));
  await browser.close();
})().catch(async e=>{console.error(e);if(browser)await browser.close();process.exitCode=1;});
