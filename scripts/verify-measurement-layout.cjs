// Real PracticeDock/Provider, browser-only replay. No API writes or bridge sockets.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const fixture = `<!doctype html><html lang="ko"><head><meta charset="UTF-8">
<style>*{box-sizing:border-box}body{margin:0;font-family:sans-serif}header{height:50px;background:#0b2d5c;display:flex;justify-content:flex-end;align-items:center;padding:8px}</style>
</head><body><header id="root"></header><script type="module">
import RefreshRuntime from '/@react-refresh';
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;
window.__vite_plugin_react_preamble_installed__=true;
const React=(await import('/node_modules/.vite/deps/react.js')).default;
const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
const {PracticeProvider,usePractice}=await import('/src/PracticeProvider.tsx');
const {PracticeDock}=await import('/src/PracticeControls.tsx');
const NativeSocket=window.WebSocket;
window.__replay={requests:[],paused:false,index:0,seq:927,source:new URL(location.href).searchParams.get('source')};
const replay=window.__replay;
window.WebSocket=class {
  static OPEN=1;
  constructor(url,protocols){
    if(!String(url).includes('127.0.0.1:8765'))return new NativeSocket(url,protocols);
    this.readyState=0;this.connected=false;replay.socket=this;
    queueMicrotask(()=>{this.readyState=1;this.onopen?.(new Event('open'));});
    this.timer=setInterval(()=>{if(!replay.paused)this.publish();},80);
  }
  event(data){this.onmessage?.({data:JSON.stringify(data)});}
  publish(overrides={}){
    if(!this.connected)return;
    const i=replay.index++,values=[0.000001,-0.000001,345.6789123456789,-99999.99999,123456789.01234,1e20];
    if(i===20)replay.seq=9007199254740000;
    const m={source:replay.source,seq:++replay.seq,measuredAt:Date.now(),ageMs:3.0592997185885906,
      pose:{x:values[i%values.length],y:values[(i+1)%values.length],z:values[(i+2)%values.length],r:values[(i+3)%values.length]},
      joints:{j1:values[i%values.length],j2:values[(i+1)%values.length],j3:values[(i+2)%values.length],j4:values[(i+3)%values.length]},
      robotMode:i%2?7:4,enabled:i%2===1,moving:i%2===1,error:false,user:i%10,tool:(i+1)%10,
      inputBits:i%2?'65535':'0',outputBits:i%2?'32768':'1',...overrides};
    replay.sent=m;this.event({type:'measurement',measurement:m});
  }
  send(raw){
    const r=JSON.parse(raw);replay.requests.push(r);
    if(r.type!=='connect')throw new Error('Forbidden request in readout test: '+r.type);
    this.connected=true;
    this.event({type:'hello',protocol:2,model:'MG400',source:replay.source,capabilities:{jointStep:true}});
    this.publish();this.event({type:'reply',id:r.id,ok:true,result:{}});
  }
  close(){clearInterval(this.timer);this.readyState=3;this.onclose?.({});}
};
function Probe(){window.__snapshot=usePractice().snap;return null;}
createRoot(document.getElementById('root')).render(React.createElement(PracticeProvider,null,
  React.createElement(Probe),React.createElement(PracticeDock)));
</script></body></html>`;

async function geometry(page) {
  return page.evaluate(() => {
    const measurement=document.querySelector('[data-testid="live-measurement"]');
    const heading=document.querySelector('[data-testid="preparation-heading"]');
    const panel=document.querySelector('.pr-panel');
    const input=[...panel.querySelectorAll('label')].find(l=>l.textContent==='속도 %').querySelector('input');
    const r=measurement.getBoundingClientRect(), h=heading.getBoundingClientRect();
    return {height:r.height,headingTop:h.top,headingOffset:h.top-r.top,scrollTop:panel.scrollTop,
      focused:document.activeElement===input,overflow:panel.scrollWidth>panel.clientWidth,
      bitRows:[...measurement.querySelectorAll('.pr-bits')].map(b=>new Set([...b.children].map(i=>i.offsetTop)).size),
      seq:window.__snapshot.measurement?.seq};
  });
}

(async () => {
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,
    args:['--disable-webgl','--disable-gpu','--disable-features=LocalNetworkAccessChecks']});
  try {
    const results=[];
    for(const width of [1280,320]) for(const source of ['hardware','mock']) {
      const page=await browser.newPage({viewport:{width,height:1000}});
      const errors=[],apiRequests=[];
      page.on('pageerror',e=>{errors.push(e.message);console.error('FIXTURE_PAGE_ERROR',e.message);});
      page.on('console',m=>{if(m.type()==='error')console.error('FIXTURE_CONSOLE_ERROR',m.text());});
      await page.route('**/api/**',r=>{apiRequests.push(r.request().url());return r.abort();});
      // This document exists only in the test browser; no fixture route is shipped.
      await page.route('**/__test_measurement_layout?*',r=>r.fulfill({contentType:'text/html',body:fixture}));
      await page.goto(`http://localhost:80/__test_measurement_layout?source=${source}`);
      await page.getByTestId('button-mode-hardware').click();
      await page.getByTestId('button-practice-panel').click();
      assert.equal(await page.getByTestId('input-robot-ip').inputValue(), '192.168.1.6'); // WebSocket remains fully intercepted.
      await page.getByTestId('button-bridge-connect').click();
      await page.getByTestId('measurement-freshness').filter({hasText:'최신'}).waitFor();
      assert.match(await page.getByTestId('measurement-source').innerText(),source==='mock'?/모의.*실측 아님/:/실제 MG400 실측/);
      const input=page.getByLabel('속도 %',{exact:true});
      await input.fill('12');await input.press('ArrowLeft');
      const baseline=await geometry(page);
      if(baseline.overflow)console.log('OVERFLOW_DETAILS',width,await page.locator('.pr-panel').evaluate(panel=>
        [...panel.querySelectorAll('*')].filter(el=>el.getBoundingClientRect().right>panel.getBoundingClientRect().right)
          .slice(0,8).map(el=>({tag:el.tagName,class:el.className,text:el.textContent?.slice(0,55),width:el.getBoundingClientRect().width}))));
      for(let i=0;i<35;i++){
        await page.waitForTimeout(90);
        const g=await geometry(page);
        assert.equal(g.height,baseline.height,'readout height');
        assert.equal(g.headingTop,baseline.headingTop,'preparation screen position');
        assert.equal(g.scrollTop,baseline.scrollTop,'panel scroll position');
        assert.equal(g.focused,true,'input focus');
        assert.equal(g.overflow,false,'horizontal panel overflow');
        assert.deepEqual(g.bitRows,[2,2],'predictable 8+8 DI/DO rows');
      }
      assert.ok((await geometry(page)).seq>9007199254740000,'large seq exercised');
      await page.keyboard.type('7');
      assert.equal(await input.inputValue(),'172','caret survived all telemetry rerenders');
      await page.evaluate(()=>{
        window.__replay.paused=true;
        window.__replay.restoreNow=Date.now;
        const fixedNow=Date.now();Date.now=()=>fixedNow;
        window.__replay.socket.publish({
          moving:false,robotMode:4,pose:{x:345.6789123456789,y:-0.000001,z:0,r:90.123456789},ageMs:7.943299900740385});
      });
      await page.waitForFunction(()=>document.querySelector('[data-testid="measurement-age"]').textContent==='7.943 ms');
      assert.equal(await page.evaluate(()=>window.__snapshot.measurement.pose.x),345.6789123456789,'raw TCP precision');
      assert.equal(await page.evaluate(()=>window.__snapshot.measurement.ageMs),7.943299900740385,'raw age precision');
      assert.equal(await page.getByTestId('measurement-age').getAttribute('title'),'7.943299900740385 ms','raw display age precision');
      assert.match(await page.locator('.pr-measurement-axes').first().innerText(),/345\.68/);
      assert.doesNotMatch(await page.locator('.pr-measurement-axes').first().innerText(),/-0\.00/);
      assert.match(await page.getByTestId('measurement-age').innerText(),/^\d+\.\d{3} ms$/);
      await page.evaluate(()=>{Date.now=window.__replay.restoreNow;});
      const beforeStale=await geometry(page);
      await page.getByTestId('measurement-freshness').filter({hasText:'오래됨'}).waitFor();
      const stale=await geometry(page);
      assert.equal(stale.height,baseline.height,'stale height');
      assert.equal(stale.headingTop,beforeStale.headingTop,'stale preparation position');
      assert.equal(stale.scrollTop,beforeStale.scrollTop,'stale scroll');
      assert.equal(stale.focused,true,'stale focus');
      await page.evaluate(()=>{window.__replay.socket.publish({moving:false,robotMode:4});});
      await page.getByTestId('measurement-freshness').filter({hasText:'최신'}).waitFor();
      assert.equal((await geometry(page)).headingTop,beforeStale.headingTop,'recovery position');
      if(source==='hardware'){
        fs.mkdirSync('/tmp/measurement-layout',{recursive:true});
        await page.locator('.pr-panel').evaluate(el=>{el.scrollTop=document.querySelector('[data-testid="live-measurement"]').offsetTop-45;});
        await page.screenshot({path:`/tmp/measurement-layout/${width}.png`});
      }
      await page.evaluate(()=>window.__replay.socket.close());
      await page.getByTestId('measurement-freshness').filter({hasText:'미연결'}).waitFor();
      assert.equal((await geometry(page)).height,baseline.height,'disconnected height');
      assert.equal(await page.getByTestId('measurement-age').innerText(),'—');
      assert.equal(await page.getByTestId('measurement-seq').innerText(),'—');
      assert.equal(await page.locator('.pr-bits .unknown').count(),32,'unknown is not OFF');
      assert.deepEqual(await page.evaluate(()=>window.__replay.requests.map(r=>r.type)),['connect'],'no configure/servo/move/suction/stop');
      assert.deepEqual(apiRequests,[],'no student records or DB access');
      assert.deepEqual(errors,[],'browser errors');
      results.push({width,source,height:baseline.height,updates:35,stable:true});
      await page.close();
    }
    console.log(JSON.stringify({passed:true,results},null,2));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
