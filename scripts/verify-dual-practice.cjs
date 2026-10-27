// Browser-only MOCK protocol test. Never opens any robot or real PC bridge socket.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
let browser;
(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE||'/repl/tools/bin/chromium', args: ['--disable-webgl', '--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const requests = [];
  let paused = false, closeMock, moveTimer, moveDelay = 600;
  await page.routeWebSocket('**/127.0.0.1:8765/**', ws => {
    let seq = 0, connected = false;
    const m = { source:'mock',ageMs:0,pose:{x:250,y:-150,z:300,r:0},joints:{j1:0,j2:0,j3:0,j4:0},
      enabled:false,moving:false,error:false,robotMode:4,user:0,tool:0,inputBits:'0',outputBits:'0' };
    const publish = () => { if (connected && !paused) ws.send(JSON.stringify({ type:'measurement', measurement:{...m,seq:++seq,measuredAt:Date.now()} })); };
    const reply = id => ws.send(JSON.stringify({type:'reply',id,ok:true,result:{seq}}));
    const timer = setInterval(publish,100);
    closeMock = () => ws.close();
    ws.onClose(() => { clearInterval(timer); clearTimeout(moveTimer); });
    ws.onMessage(raw => {
      const r = JSON.parse(raw); requests.push(r);
      if (r.type === 'connect') {
        connected = true; ws.send(JSON.stringify({type:'hello',protocol:2,model:'MG400',source:'mock'})); publish(); reply(r.id);
      } else if (r.type === 'configure') { m.user=r.setup.user; m.tool=r.setup.tool; publish(); reply(r.id); }
      else if (r.type === 'stop') { clearTimeout(moveTimer); m.moving=false; m.robotMode=m.enabled?5:4; publish(); reply(r.id); }
      else if (r.type === 'execute') {
        const op=r.operation;
        if (op.kind==='move') {
          m.moving=true; m.robotMode=7; publish();
          moveTimer=setTimeout(()=>{m.pose=op.target;m.moving=false;m.robotMode=5;publish();reply(r.id);},moveDelay);
        } else {
          if (op.kind==='enable'||op.kind==='disable') {m.enabled=op.kind==='enable';m.robotMode=m.enabled?5:4;}
          if (op.kind==='suction') m.outputBits=op.on?'1':'0';
          publish();reply(r.id);
        }
      }
    });
  });
  const url = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/` : 'http://localhost:80/';
  const id = v => page.getByTestId(v);
  const confirm = async () => { await id('button-confirm-ok').click(); };
  const actuations = () => requests.filter(r=>r.type==='execute');
  await page.route('**/api/learning/**',route=>{
    const req=route.request(),path=new URL(req.url()).pathname;let data={};
    if(path.endsWith('/student/enter'))data={user:{id:'dual-practice-test',login:'dual-practice-test',role:'student',visitId:'dual-practice-isolated'}};
    if(path.endsWith('/records'))data={acknowledged:req.postDataJSON().events.map(e=>e.eventId)};
    return route.fulfill({json:data});
  });
  await page.goto(url);
  await page.getByLabel('학생 아이디',{exact:true}).fill('dual-practice-test');
  await page.getByRole('button',{name:'학습 시작',exact:true}).click();
  await id('button-mode-virtual').waitFor();
  assert.equal(await id('button-mode-virtual').getAttribute('aria-pressed'),'true');
  assert.equal(requests.length,0);
  for (const asset of ['mg400-bridge.zip','mg400-practice-guide.md']) assert.equal((await page.request.get(url+asset)).status(),200);
  await id('button-mode-hardware').click(); await id('button-practice-panel').click();
  assert.equal(await id('input-robot-ip').inputValue(), '192.168.1.6'); await id('button-bridge-connect').click();
  await page.getByText('모의 통신 · 실측 아님',{exact:true}).first().waitFor();
  assert.equal(actuations().length,0);
  for (const flag of ['firmware','network','coordinates','tool','io','workspace']) await id('check-'+flag).check();
  await id('button-apply-setup').click(); await confirm(); await id('button-servo-on').waitFor();
  assert.equal(actuations().length,0);
  await id('button-servo-on').click(); await id('button-confirm-cancel').click();
  assert.equal(actuations().length,0);
  await id('button-servo-on').click(); await confirm();
  await page.waitForFunction(()=>document.querySelector('[data-testid=button-servo-off]')?.disabled===false);
  assert.deepEqual(actuations().map(r=>r.operation.kind),['enable']);
  await id('button-move-l').click(); await id('button-confirm-cancel').click();
  assert.equal(actuations().length,1);
  await id('button-move-l').click(); await confirm();
  assert.equal(await id('button-mode-virtual').isDisabled(),true);
  await page.waitForFunction(()=>document.querySelector('[data-testid=button-move-l]')?.disabled===false);
  assert.ok((await id('list-journal').innerText()).includes('[모의]'));
  await id('button-suction-on').click(); await confirm();
  await page.waitForFunction(()=>document.querySelector('[data-testid=button-suction-on]')?.disabled===false);
  await id('button-move-j').click(); await confirm(); await id('button-practice-stop').click();
  await id('button-ack-stop').waitFor();
  assert.equal(actuations().filter(r=>r.operation.kind==='suction'&&!r.operation.on).length,0);
  assert.ok(requests.some(r=>r.type==='stop'));
  await id('button-ack-stop').click(); await id('button-bridge-disconnect').click();
  // Reconnect to a new mocked owner, then lose feedback in the middle of a
  // movement. No virtual pose or success row may stand in for missing data.
  await id('button-bridge-connect').click();
  await id('button-bridge-disconnect').waitFor();
  // A new connection no longer silently inherits human installation confirmations.
  for (const flag of ['firmware','network','coordinates','tool','io','workspace']) await id('check-'+flag).check();
  await id('button-apply-setup').click(); await confirm();
  await id('button-servo-on').click(); await confirm();
  await page.waitForFunction(()=>document.querySelector('[data-testid=button-servo-off]')?.disabled===false);
  const rowsBeforeStale = await id('list-journal').locator('li').count();
  moveDelay = 4000;
  await id('button-move-l').click(); await confirm();
  paused = true;
  await id('button-ack-stop').waitFor();
  assert.equal(await id('list-journal').locator('li').count(),rowsBeforeStale);
  closeMock(); await id('text-no-measurement').waitFor();
  assert.equal(await id('button-move-j').isDisabled(),true);
  await id('button-ack-stop').click();
  await id('button-mode-virtual').click();
  assert.equal(await id('button-mode-virtual').getAttribute('aria-pressed'),'true');
  await page.setViewportSize({width:420,height:850});
  assert.ok(await id('button-mode-virtual').isVisible()); assert.ok(await id('button-practice-panel').isVisible());
  assert.deepEqual(errors,[]);
  console.log('PASS: virtual default, no auto actuation, downloads, setup/enable/move/vacuum confirmation, mode lock, stop preserves vacuum, stale/disconnect block false completion, mock-source journal, 420px header');
  await browser.close();
})().catch(async e=>{console.error(e);if(browser)await browser.close();process.exit(1);});
