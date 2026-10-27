// Real student APIs + browser UI. Owner UI uses isolated browser-network fixtures,
// not an authentication bypass or changes to the workspace owner configuration.
const assert=require("node:assert/strict"),path=require("node:path"),fs=require("node:fs");
const {createRequire}=require("node:module"),{randomUUID}=require("node:crypto"),{chromium}=require("playwright");
const pg=createRequire(path.resolve("lib/db/package.json"))("pg"),pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const base=`https://${process.env.REPLIT_DEV_DOMAIN}`,suffix=randomUUID().slice(0,8),ids=[],errors=[],loadTimings=[];
let browser;
async function identity(page){return page.evaluate(async()=>{const c=await import("/src/learningClient.ts");return c.getLearningUser();});}
async function enter(page,login,realAccount=true){
  const started=Date.now();
  await page.goto(base);
  assert.equal(await page.locator("input").count(),1);
  await page.getByLabel("학생 아이디",{exact:true}).fill(login);
  await page.getByRole("button",{name:"학습 시작",exact:true}).click();
  await page.getByRole("button",{name:"학생 변경",exact:true}).waitFor({timeout:60000});
  await page.waitForFunction(()=>!document.body.textContent.includes("학습을 시작하는 중입니다."));
  const user=await identity(page);if(realAccount)ids.push(user.id);
  loadTimings.push({fixture:realAccount?"TEST real API":"isolated ID-only API",style:/^\d+$/.test(login)?"numeric":"text",lessonReadyMs:Date.now()-started});
  await page.evaluate(async()=>{window.testSync=await import("/src/learningSync.ts");});
  return user;
}
async function commit(page,z,id="TEST_UI_attempt"){
  await page.evaluate(({z,id})=>window.testSync.setEvidenceItem("physical-ai-inquiry-evidence-v1",JSON.stringify([{
    id,task:"TEST_foundation",prediction:{z},reason:"TEST 기록, 쉼표\n줄바꿈",runs:[],dataSource:"math"
  }])),{z,id});
}
(async()=>{
  try{
    browser=await chromium.launch({headless:true,...(fs.existsSync("/repl/tools/bin/chromium")?{executablePath:"/repl/tools/bin/chromium"}:{}),
      // The synthetic public parent is proxied to loopback in this container.
      // Exempt only this test browser from LNA classification, not app auth/CORS.
      args:["--no-sandbox","--disable-dev-shm-usage","--disable-webgl","--disable-features=LocalNetworkAccessChecks"]});
    const context=await browser.newContext(),page=await context.newPage();
    page.on("pageerror",e=>errors.push(e.message));
    const loginA=`TEST_UI_A_${suffix}`,loginB=`TEST_UI_B_${suffix}`,a=await enter(page,loginA);
    await context.setOffline(true);await commit(page,40);await commit(page,35);
    assert.equal(await page.evaluate(()=>window.testSync.flushLearningQueue()),false);
    assert.equal(await page.evaluate(()=>window.testSync.getLearningSaveState().state),"failed");
    await context.setOffline(false);assert.equal(await page.evaluate(()=>window.testSync.flushLearningQueue()),true);
    const saved=(await pool.query("SELECT event_id,payload FROM learning_events WHERE account_id=$1 ORDER BY sequence",[a.id])).rows;
    assert.deepEqual(saved.map(r=>r.payload.prediction.z),[40,35]);
    // Exercise the unchanged lesson itself, not just its evidence-writing utility.
    await page.getByRole("button",{name:"☰",exact:true}).click();
    await page.getByRole("button",{name:/용어.*기초수학/}).first().click();
    await page.getByLabel("① 목표 절대좌표 Z",{exact:true}).fill("40");
    await page.getByRole("button",{name:/답 확인.*다음 힌트/}).click();
    await page.evaluate(()=>window.testSync.flushLearningQueue());
    const activity=(await pool.query("SELECT chapter,data_source,payload FROM learning_events WHERE account_id=$1 AND event_id<>ALL($2::uuid[])",
      [a.id,saved.map(r=>r.event_id)])).rows;
    assert.ok(activity.length>0,"An actual lesson submission must automatically reach the server");
    assert.ok(activity.every(r=>r.chapter==="기초수학"&&r.data_source==="math"));
    await page.getByRole("button",{name:"학생 변경",exact:true}).click();
    await page.getByRole("button",{name:"학습 시작",exact:true}).waitFor();
    assert.ok(!await page.getByRole("button",{name:"내 학습 기록",exact:true}).count());
    const b=await enter(page,loginB);
    assert.equal(await page.evaluate(()=>window.testSync.getEvidenceItem("physical-ai-inquiry-evidence-v1")),null);
    await commit(page,15,"TEST_UI_B_attempt");await page.evaluate(()=>window.testSync.flushLearningQueue());
    const blocked=await page.evaluate(async()=>Promise.all(["/records","/teacher/students","/teacher/records","/teacher/csv"].map(async p=>{
      const r=await fetch("/api/learning"+p);return r.status;
    })));
    assert.deepEqual(blocked,[403,401,401,401]);
    await page.reload();await page.getByRole("button",{name:"학습 시작",exact:true}).waitFor();
    const again=await enter(page,loginA);assert.equal(again.id,a.id);assert.notEqual(again.visitId,a.visitId);
    assert.equal(await page.evaluate(()=>window.testSync.getEvidenceItem("physical-ai-inquiry-evidence-v1")),null);
    // Genuinely cross-site embedded preview; no student cookies/password required.
    const embedded=await browser.newContext(),outer=await embedded.newPage();
    await outer.route("https://test-mg400-parent.invalid/**",route=>route.fulfill({contentType:"text/html",
      body:`<iframe src="${base}/" style="width:1100px;height:900px"></iframe>`}));
    await outer.goto("https://test-mg400-parent.invalid/");
    const child=await(await outer.locator("iframe").elementHandle()).contentFrame();
    await child.getByLabel("학생 아이디").fill(loginB);
    await child.getByRole("button",{name:"학습 시작",exact:true}).click();
    await child.getByRole("button",{name:"학생 변경",exact:true}).waitFor({timeout:60000});
    assert.equal(await child.locator('input[type="password"]').count(),0);
    // Do not create visits or records on a real student's possible "1234" account.
    // The UI is real; only these exact-ID API responses are isolated fixtures.
    for(const login of ["1234","일반문자아이디"]){
      const isolated=await browser.newContext(),numericPage=await isolated.newPage();
      await numericPage.route("**/api/learning/**",r=>{
        const endpoint=new URL(r.request().url()).pathname;
        if(endpoint.endsWith("/student/enter")){
          const body=r.request().postDataJSON();
          assert.deepEqual(body,{login});
          return r.fulfill({json:{user:{id:randomUUID(),visitId:randomUUID(),role:"student",classCode:"",login}}});
        }
        if(endpoint.endsWith("/records")&&r.request().method()==="POST")
          return r.fulfill({json:{acknowledged:r.request().postDataJSON().events.map(e=>e.eventId)}});
        return r.fulfill({status:403,json:{error:"TEST fixture: no historical access"}});
      });
      assert.equal((await enter(numericPage,login,false)).login,login);
      assert.equal(await numericPage.locator('input[type="password"]').count(),0);
      await isolated.close();
    }
    // Owner UI/download contract, strictly network-mocked in this test browser.
    const owner=await browser.newContext({acceptDownloads:true}),ownerPage=await owner.newPage();
    ownerPage.on("pageerror",e=>errors.push(e.message));
    const authUser={id:"TEST_OWNER",firstName:"TEST_OWNER"};
    const rows=saved.map((r,i)=>({sequence:i+1,event_id:r.event_id,login:loginA,class_code:"",store_key:"physical-ai-inquiry-evidence-v1",
      record_id:"TEST_UI_attempt",chapter:"기초수학",task:"TEST_foundation",event_kind:"TEST 예측",occurred_at:new Date().toISOString(),
      received_at:new Date().toISOString(),content_version:"TEST_ONLY",data_source:"math",payload:r.payload,changed_paths:["prediction.z"]}));
    const csv="\uFEFF학생 아이디,최초 예측,수정값\r\n"+loginA+",40,35\r\n"+loginB+",15,\r\n";
    await ownerPage.route("**/api/auth/user",r=>r.fulfill({json:{user:authUser}}));
    await ownerPage.route("**/api/learning/session",r=>r.fulfill({json:{user:{...authUser,role:"teacher",classCode:"",login:"TEST_OWNER"}}}));
    await ownerPage.route("**/api/learning/teacher/**",r=>{
      const url=r.request().url();
      if(url.includes("/csv"))return r.fulfill({contentType:"text/csv;charset=utf-8",body:csv});
      return r.fulfill({json:url.includes("/students")?{students:[{id:a.id,login:loginA,record_count:2,attempt_count:1},{id:b.id,login:loginB,record_count:1,attempt_count:1}]}:{records:rows,total:2}});
    });
    await ownerPage.goto(base+"/?professor=1");
    await ownerPage.getByRole("button",{name:"전체 CSV",exact:true}).waitFor();
    assert.equal(await ownerPage.getByRole("button",{name:"수업 만들기",exact:true}).count(),0);
    const waiting=ownerPage.waitForEvent("download");
    await ownerPage.getByRole("button",{name:"전체 CSV",exact:true}).click();const file=await waiting;
    assert.equal(file.suggestedFilename(),"MG400-학습기록.csv");
    assert.ok((await require("node:fs/promises").readFile(await file.path(),"utf8")).includes(loginB));
    assert.deepEqual(errors,[]);
    console.log("ID-only lesson loading timings:",JSON.stringify(loadTimings));
    console.log("PASS browser: one ID field; immediate MG400 content; offline prediction/revision -> reconnect; student switch/reload/same-ID have fresh isolated UI; student history/list/CSV denied; cross-site iframe without password/cookies; owner screen and CSV download verified with browser-only fixtures (not a real owner sign-in).");
  }finally{
    if(browser)await browser.close();
    if(ids.length){
      await pool.query("DELETE FROM learning_events WHERE account_id=ANY($1::uuid[])",[ids]);
      await pool.query("DELETE FROM learning_visits WHERE account_id=ANY($1::uuid[])",[ids]);
      await pool.query("DELETE FROM learning_accounts WHERE id=ANY($1::uuid[])",[ids]);
    }
    await pool.end();
  }
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
