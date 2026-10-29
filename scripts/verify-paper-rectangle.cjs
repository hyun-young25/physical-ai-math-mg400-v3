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
 await page.getByRole("button",{name:/종이 위 사각형 · 직각 회전/}).click();
 assert.equal(await page.getByLabel("좌표 상황 선택").inputValue(),"advanced-paper-quarter");
 await page.getByRole("button",{name:/비스듬히 놓인 종이/}).click();
 const view=page.getByRole("region",{name:"종이 좌표 변환 학습"});
 await view.waitFor();assert.equal(await page.getByText("확장 탐구",{exact:true}).count(),0);
 assert.equal(await view.getByLabel("좌표 상황 선택").inputValue(),"advanced-paper-rotated");
 assert.equal(await page.locator(".paper-coordinate-host").evaluate(el=>el.scrollHeight>el.clientHeight),true);
 await view.getByRole("button",{name:"다음 단계",exact:true}).scrollIntoViewIfNeeded();
 await click("다음 단계");assert.match(await view.innerText(),/O\/X\/Y 기준점을 먼저 저장/);
 passed.push("advanced tabs replace extension entry; scrolling reaches the next-stage control");
 async function reference(deg,x=225,y=-90){
  const a=deg*Math.PI/180;
  for(const [name,px,py] of [["O",0,0],["X",100,0],["Y",0,100]]){
   const field=view.locator("fieldset.pcv-reference").nth(["O","X","Y"].indexOf(name));
   const values={X:x+px*Math.cos(a)-py*Math.sin(a),Y:y+px*Math.sin(a)+py*Math.cos(a),Z:60,R:0};
   for(const [axis,value] of Object.entries(values))await view.getByLabel(name+" 기준점 "+axis+" 좌표 ("+(axis==="R"?"°":"mm")+")").fill(String(value));
   await field.getByRole("button",{name:"입력값 저장",exact:true}).click();
  }
 }
 async function model(deg,x=225,y=-90){
  await view.getByLabel("원점 X (mm)",{exact:true}).fill(String(x));await view.getByLabel("원점 Y (mm)",{exact:true}).fill(String(y));
  await view.getByLabel("종이 x축이 향하는 방향").selectOption("x+");await view.getByLabel("1 cm당 길이 (mm)").fill("10");
  await view.getByLabel("추가 회전 (°)").fill(String(deg));await view.getByLabel("이 관계를 선택한 이유").fill("기록한 원점과 축 방향, 1 cm=10 mm 관계를 사용했습니다.");
  await click("관계 저장");await click("다음 단계");
  const a=deg*Math.PI/180;
  for(const [i,[px,py]] of [[2,2],[8,2],[8,6],[2,6]].entries()){
   await view.getByLabel("P"+(i+1)+" 예측 로봇 X · mm").fill(String(x+px*10*Math.cos(a)-py*10*Math.sin(a)));
   await view.getByLabel("P"+(i+1)+" 예측 로봇 Y · mm").fill(String(y+px*10*Math.sin(a)+py*10*Math.cos(a)));
  }
  await click("예측 저장");await click("다음 단계");
 }
 async function execute(){
  await view.getByLabel("펜 들기 높이",{exact:true}).fill("80");
  const physical=view.getByRole("button",{name:/실장비|실제 실행|모의 실행/}).filter({hasNotText:"DT"});
  assert.equal(await view.getByRole("button",{name:"실장비에서 확인",exact:true}).isDisabled(),true);
  await click("DT에서 확인");
  await page.waitForFunction(()=>{const all=JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith("physical-ai-paper-coordinate-v1")))||"[]");return all.at(-1)?.run?.status==="completed";},null,{timeout:30000});
  await click("다음 단계");await click("다음 단계");
 }
 await reference(30);await model(0);await execute();
 assert.equal(await page.getByTestId("paper-diagnosis-visual").getAttribute("data-type"),"rotation");
 assert.match(await page.getByTestId("paper-transform-estimate").innerText(),/회전 -30°/);
 assert.match(await page.getByTestId("paper-transform-estimate").innerText(),/종이 방향 30°/);
 await page.getByTestId("paper-diagnosis-visual").screenshot({path:path.join(shots,"05-paper-rotation.png")});
 passed.push("omitted 30° rotation is diagnosed by existing paper rules; relative -30° and measured paper +30° are shown");
 await view.getByLabel("내가 생각하는 이유 (원인을 단정하지 않고 후보로)").fill("회전항을 빠뜨렸다는 가설입니다.");
 await click("생각 저장");await click("다음 단계");
 await view.getByLabel("무엇을 다시 살펴볼까요?").fill("종이 방향 30도를 변환식에 반영합니다.");await click("이유와 수정 기록");
 await model(30);await execute();assert.equal(await page.getByTestId("paper-diagnosis-visual").getAttribute("data-type"),"match");
 assert.equal(await view.locator(".pcv-success").count(),0);
 passed.push("corrected model matches; same-placement correction is not marked as new-placement revalidation");
 await view.getByLabel("내가 생각하는 이유 (원인을 단정하지 않고 후보로)").fill("회전항을 넣으니 목표와 일치했습니다.");
 await click("생각 저장");await click("다음 단계");
 await view.getByLabel("무엇을 다시 살펴볼까요?").fill("종이를 다시 놓고 새 기준점으로 같은 관계를 검증합니다.");
 await click("종이를 옮겼어요 · 기준점 다시 기록");
 await reference(15,240,-100);await model(15,240,-100);await execute();
 await view.locator(".pcv-success").filter({hasText:"DT 재검증 완료 · 실측 아님"}).waitFor();
 const records=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.endsWith("physical-ai-paper-coordinate-v1")))));
 assert.equal(records.length,3);assert(records.every(r=>r.level==="advanced-paper-rotated"&&r.uiVersion==="diag-visual-v2"));
 assert.equal(records[0].diagnosis.pattern,"rotation");assert.equal(records[0].run.observations.length,4);assert.notEqual(records[0].frame.id,records[2].frame.id);
 passed.push("new measured-frame inputs revalidate in DT; original predictions and observations remain; level and version are recorded");
 await page.setViewportSize({width:390,height:844});
 await page.locator("main.curriculum-body").evaluate(el=>el.style.width="100%");
 await page.screenshot({path:path.join(shots,"06-paper-mobile.png"),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed,writes,errors},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
