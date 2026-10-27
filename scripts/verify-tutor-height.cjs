// Layout-only root-app check. Synthetic entry/records, trial tutor only.
// No real API request or WebSocket is permitted.
const {chromium}=require("playwright");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const base=process.env.REPLIT_DEV_DOMAIN?`https://${process.env.REPLIT_DEV_DOMAIN}/`:"http://localhost:80/";
let browser,page;
(async()=>{
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||"/repl/tools/bin/chromium",
    args:["--disable-webgl","--disable-gpu"]});
  const context=await browser.newContext({viewport:{width:1920,height:1080}});
  const errors=[],requests=[],results=[];
  await context.routeWebSocket("**",ws=>ws.close());
  await context.route("**/api/**",route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    requests.push(path);
    assert(!path.endsWith("/feedback"),"trial mode must not request external feedback");
    let data={};
    if(path.endsWith("/student/enter"))data={user:{id:"height-synthetic",login:"height-synthetic",role:"student",visitId:"height-synthetic"}};
    if(path.endsWith("/records"))data={acknowledged:req.postDataJSON().events.map(e=>e.eventId)};
    return route.fulfill({json:data});
  });
  // Model the visible portion left by an overlay keyboard and viewport panning.
  // This is a synthetic API test, not a claim about a real phone keyboard.
  await context.addInitScript(()=>{
    const vv=window.visualViewport;
    window.setTestViewport=(height,top=0)=>{
      for(const [name,value] of [["height",height],["offsetTop",top]]){
        if(value===null)delete vv[name];
        else Object.defineProperty(vv,name,{configurable:true,value});
      }
      vv.dispatchEvent(new Event("resize"));
      vv.dispatchEvent(new Event("scroll"));
    };
  });
  page=await context.newPage();page.setDefaultTimeout(12000);
  page.on("pageerror",e=>errors.push(e.message));
  const id=n=>page.getByTestId(n);
  await page.goto(base);
  await page.getByLabel("학생 아이디",{exact:true}).fill("height-synthetic");
  await page.getByRole("button",{name:"학습 시작",exact:true}).click();
  const nav=page.getByRole("navigation",{name:"학습 목차",exact:true});
  if(await nav.evaluate(e=>e.parentElement.style.transform.includes("-100%")))
    await page.getByRole("button",{name:"☰",exact:true}).click();
  await nav.getByRole("button",{name:/좌표축과 이동 방향/}).click();
  await id("button-ai-tutor-open").click();
  await id("select-ai-tutor-mode").selectOption("trial");
  for(let i=0;i<16;i++){
    const n=await page.locator(".ait-msg").count();
    await id("input-ai-tutor").fill(`${i+1}번째 질문: ${"좌표축과 이동 거리의 관계를 자세히 설명해 주세요. ".repeat(12)}`);
    await id("button-ai-tutor-send").click();
    await page.waitForFunction(n=>document.querySelectorAll(".ait-msg").length>n,n);
  }
  await id("input-ai-tutor").fill("창 크기를 바꿔도 유지되는 작성 중 질문");
  fs.mkdirSync("generated-artifacts",{recursive:true});
  async function check(label,visibleHeight=null,visibleTop=0){
    await page.waitForTimeout(250);
    const metrics=await page.evaluate(()=>{
      const rect=s=>{
        const {x,y,width,height,bottom}=document.querySelector(s).getBoundingClientRect();
        return {x,y,width,height,bottom};
      };
      const log=document.querySelector(".ait-log"),vv=window.visualViewport;
      return {panel:rect(".ait-window"),head:rect(".ait-head"),input:rect(".ait-input"),
        send:rect(".ait-send"),close:rect('[data-testid="button-ai-tutor-close"]'),
        menu:rect(".robot-app-header"),log:rect(".ait-log"),
        scrollHeight:log.scrollHeight,clientHeight:log.clientHeight,
        windowHeight:innerHeight,width:innerWidth,visibleHeight:vv.height,visibleTop:vv.offsetTop};
    });
    const top=visibleTop,bottom=top+(visibleHeight??metrics.windowHeight);
    for(const key of ["panel","head","input","send","close"]){
      const r=metrics[key];
      assert(r.y>=top-1&&r.bottom<=bottom+1,`${label}: ${key} outside visible viewport: ${JSON.stringify(metrics)}`);
      assert(r.x>=-1&&r.x+r.width<=metrics.width+1,`${label}: ${key} horizontally clipped`);
    }
    assert(metrics.head.bottom<=metrics.input.y,`${label}: header/composer overlap`);
    assert(metrics.scrollHeight>metrics.clientHeight+100,`${label}: long conversation must scroll internally`);
    if(metrics.width>=768&&!visibleHeight){
      if(metrics.windowHeight-metrics.menu.bottom>=320)
        assert(metrics.panel.y>=metrics.menu.bottom+11,`${label}: top menu clearance`);
      assert(Math.abs(metrics.panel.bottom-(metrics.windowHeight-16))<2,`${label}: bottom margin`);
      assert.equal(metrics.panel.width,336,"existing desktop width");
    }
    // Real wheel event changes the conversation, not the page or fixed controls.
    await id("log-ai-tutor").evaluate(el=>{el.scrollTop=el.scrollHeight;});
    const before=await id("log-ai-tutor").evaluate(el=>el.scrollTop);
    await id("log-ai-tutor").hover();
    await page.mouse.wheel(0,-450);
    await page.waitForTimeout(200);
    const after=await id("log-ai-tutor").evaluate(el=>el.scrollTop);
    assert(after<before,`${label}: wheel must scroll conversation`);
    await id("input-ai-tutor").click();
    assert(await id("input-ai-tutor").evaluate(el=>el===document.activeElement),`${label}: input focus`);
    assert.equal(await id("input-ai-tutor").inputValue(),"창 크기를 바꿔도 유지되는 작성 중 질문");
    assert(await id("button-ai-tutor-send").isEnabled());
    const old=await page.locator(".ait-msg").count();
    await id("button-ai-tutor-send").click();
    await page.waitForFunction(n=>document.querySelectorAll(".ait-msg").length>n,old);
    await id("input-ai-tutor").fill("창 크기를 바꿔도 유지되는 작성 중 질문");
    await page.screenshot({path:`generated-artifacts/tutor-height-${label}.png`});
    await id("button-ai-tutor-close").click();
    await id("button-ai-tutor-open").click();
    assert.equal(await id("input-ai-tutor").inputValue(),"창 크기를 바꿔도 유지되는 작성 중 질문");
    results.push({label,...metrics});
  }
  for(const [width,height] of [[1920,1080],[1366,768],[1024,600],[390,844],[320,568],[844,390]]){
    await page.setViewportSize({width,height});
    await check(`${width}x${height}`);
  }
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.setTestViewport(360));
  await check("keyboard-overlay",360);
  await page.evaluate(()=>window.setTestViewport(360,70));
  await check("keyboard-panned",360,70);
  await page.evaluate(()=>window.setTestViewport(280));
  await check("keyboard-short",280);
  await page.evaluate(()=>window.setTestViewport(null,null));
  await check("keyboard-dismissed");
  await page.setViewportSize({width:390,height:360});
  await check("keyboard-resizes-layout");
  await page.setViewportSize({width:844,height:390});
  await page.evaluate(()=>window.setTestViewport(240));
  await check("keyboard-landscape",240);
  assert.deepEqual(errors,[]);
  const report={results,browserErrors:errors,interceptedApiRequests:requests.length,
    authentication:"browser-only synthetic entry",keyboard:"synthetic VisualViewport and layout resize",
    realRobotCommands:0,serverWrites:0,realProviderCalls:0};
  fs.writeFileSync("generated-artifacts/tutor-height.json",JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  await browser.close();
})().catch(async error=>{console.error(error);await browser?.close();process.exit(1);});
