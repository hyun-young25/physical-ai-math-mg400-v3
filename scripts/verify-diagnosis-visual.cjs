require("./isolated-ui-fixtures.cjs");
// Isolated UI regression: test data only, all backend/socket traffic denied.
const {chromium}=require("playwright"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const base=process.env.DIAG_TEST_URL||"http://localhost/";
const shots=process.env.DIAG_SHOTS||path.resolve(__dirname,"../../diagnosis-qa");
const html='<!doctype html><html lang="ko"><head><meta charset="utf-8"/><style>body{margin:0;font-family:Arial,sans-serif;color:#334155;background:#f8fafc}button,select{padding:8px}.test-layout{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(360px,1fr);gap:14px;padding:12px}.test-scene{height:650px;position:sticky;top:0;border:1px solid #cbd5e1;border-radius:12px;overflow:hidden}.test-panel{min-width:0}@media(max-width:650px){.test-layout{display:block}.test-scene{position:relative;height:340px;margin-bottom:12px}}</style></head><body><div id="root"></div><script type="module">import R from "/@react-refresh";R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>t=>t;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/diagnosis-visual-fixture.tsx"></script></body></html>';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||"/repl/tools/bin/chromium",args:["--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
 try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 let writes=0,sockets=0;const errors=[],failed=[],passed=[];
 await context.routeWebSocket("**",ws=>{sockets++;ws.close();});
 await context.route("**/api/**",r=>{if(r.request().method()!=="GET")writes++;return r.fulfill({json:{}});});
 await context.route("**/__diagnosis-visual",r=>r.fulfill({contentType:"text/html",body:html}));
 const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));page.on("requestfailed",r=>failed.push({url:r.url(),error:r.failure()}));
 await page.goto(new URL("__diagnosis-visual",base).href);page.setDefaultTimeout(30000);
 try{await page.getByTestId("square-diagnosis").waitFor();}catch(e){console.error(JSON.stringify({errors,failed,body:await page.locator("body").innerText()}));throw e;}
 fs.mkdirSync(shots,{recursive:true});
 const panel=page.getByTestId("square-diagnosis");
 assert.equal(await panel.getAttribute("data-type"),"axis-swap");
 assert.match(await panel.innerText(),/조건[\s\S]*\+Y 200 mm[\s\S]*실행[\s\S]*−Y 100 mm/);
 assert.equal(await panel.locator("details").getAttribute("open"),null);
 try{await page.getByTestId("square-3d-dimension").waitFor();}catch(e){await page.screenshot({path:path.join(shots,"failure.png")});console.error(JSON.stringify({errors,failed,body:await page.locator("body").innerText()}));throw e;}
 assert.match(await page.getByTestId("square-3d-dimension").innerText(),/条件|조건 \+Y 200 mm/);
 await page.screenshot({path:path.join(shots,"01-open-path.png")});
 passed.push("1: open path + edge 4 + signed dimensions; preserved classifier returns axis-swap");
 await page.getByRole("button",{name:"arithmetic",exact:true}).click();
 assert.equal(await panel.getAttribute("data-type"),"arithmetic");assert.match(await panel.innerText(),/같은 오류 1회째/);
 for(const [button,level,n] of [["repeat2","task",2],["repeat3","process",3],["repeat4","worked",4]]){
  await page.getByRole("button",{name:button,exact:true}).click();assert.equal(await panel.getAttribute("data-level"),level);assert.match(await panel.innerText(),new RegExp("같은 오류 "+n+"회째"));
 }
 assert.match(await panel.innerText(),/선생님 화면에 도움 요청됨/);passed.push("2–3: arithmetic and unchanged challenge progression task/task/process/worked");
 await page.getByRole("button",{name:"unreachable",exact:true}).click();await page.getByText("도달 불가 · 관절 해 없음",{exact:true}).waitFor();
 assert.equal(await page.getByRole("button",{name:"비교 재생",exact:true}).isDisabled(),true);passed.push("4: rejected point marker, no invented observed path");
 await page.getByRole("button",{name:"match",exact:true}).click();await page.getByText("✓ 목표와 일치",{exact:true}).waitFor();assert.equal(await panel.getAttribute("data-level"),"self-regulation");passed.push("5: match + self-regulation");
 await page.getByRole("button",{name:"open",exact:true}).click();const before={writes,sockets,storage:await page.evaluate(()=>JSON.stringify(localStorage))};
 await page.getByRole("button",{name:"비교 재생",exact:true}).click();
 assert.equal(await page.evaluate(()=>!!window.__visualSnapshot().replay),true);
 await page.waitForTimeout(3300);await page.screenshot({path:path.join(shots,"02-replay.png")});
 await page.waitForTimeout(900);assert.equal(await page.evaluate(()=>window.__visualSnapshot().replay),null);
 assert.deepEqual({writes,sockets,storage:await page.evaluate(()=>JSON.stringify(localStorage))},before);passed.push("6: replay has zero network, socket or evidence writes");
 await page.getByTestId("button-ai-tutor-open").click();await page.locator(".ait-evidence-tag").click();
 assert.equal(await page.getByTestId("square-visual-summary").getAttribute("data-emphasized"),"true");
 await page.waitForTimeout(2200);assert.equal(await page.getByTestId("square-visual-summary").getAttribute("data-emphasized"),null);passed.push("7: tutor evidence tag highlights current scene/card for two seconds");
 await page.getByTestId("button-ai-tutor-close").click();await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:path.join(shots,"03-mobile.png"),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);passed.push("8: mobile layout has no horizontal overflow");
 await page.getByRole("button",{name:"hardware",exact:true}).click();assert.equal(await panel.getAttribute("data-type"),"model-real");await page.screenshot({path:path.join(shots,"04-controller-offset.png"),fullPage:true});
 await page.getByRole("button",{name:"revise",exact:true}).click();assert.equal(await page.getByTestId("square-scene-comparison").count(),0);passed.push("new prediction clears comparison state");
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed,errors,writes,sockets,shots},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
