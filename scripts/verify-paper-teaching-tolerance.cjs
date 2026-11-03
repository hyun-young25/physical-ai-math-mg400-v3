// Real React/storage flow, isolated from API writes and hardware sockets.
require('./isolated-ui-fixtures.cjs');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fixture = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import {PaperCoordinateStudy} from '/src/PaperCoordinateStudy.tsx';
import {PracticeProvider} from '/src/PracticeProvider.tsx';
import {setLearningUser} from '/src/learningClient.ts';
import {setEvidenceItem} from '/src/learningSync.ts';
const now=Date.now();
const samples=[['O',225,-60,127],['X',313.3,-60,100],['Y',225,28.3,120]].map(([point,x,y,r],i)=>({point,pose:{x,y,z:60,r},source:'mock',seq:i+1,capturedAt:now,ageMsAtCapture:0,user:0,tool:0,coordinateSystem:'User 0 / Tool 0',verifiedCoordinates:true}));
const record={id:'tolerance-test',task:'paper-coordinate',version:1,uiVersion:'diag-visual-v2',taskVersion:'v4-paper-merged',support:'guided',attempt:1,parentAttemptId:null,targetSet:'initial',level:'advanced-paper-hardware',status:'references',stage:1,dataSource:'mock',createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),referenceSamples:samples};
setLearningUser({id:'tolerance-test',login:'tolerance-test',role:'student',visitId:'isolated-tolerance'});
if(!sessionStorage.getItem('seeded')){setEvidenceItem('physical-ai-paper-coordinate-v1',JSON.stringify([record]));sessionStorage.setItem('seeded','yes');}
createRoot(document.getElementById('root')).render(<PracticeProvider><PaperCoordinateStudy initialLevel="advanced-paper-hardware" onBack={()=>{}} hardwareConnected={false} currentPose={samples[0].pose} canReach={()=>true} runDigitalTwin={async()=>{}}/></PracticeProvider>);
</script></body></html>`;
(async () => {
  const browser = await chromium.launch({ args: ['--disable-webgl', '--disable-gpu'] });
  try {
    const context = await browser.newContext();
    await context.route('**/api/**', r => r.fulfill({json:{}}));
    await context.route('**/__teaching', r => r.fulfill({contentType:'text/html',body:fixture}));
    const page = await context.newPage(), errors=[];
    page.on('pageerror', error=>errors.push(error.message));
    await page.goto('http://localhost/__teaching');
    const panel = page.locator('fieldset').filter({has:page.locator('legend', {hasText:'교사용 기준선 길이 허용오차'})});
    const input = page.getByLabel('기준선 길이 허용오차 ± (mm)', {exact:true});
    await input.waitFor({state:'attached'});
    await input.fill('12');
    assert.match(await panel.innerText(), /현재 적용: ±2 mm/);
    await panel.getByRole('button',{name:'허용오차 저장·적용'}).click();
    await page.locator('details').evaluateAll(elements=>elements.forEach(el=>el.open=true));
    await page.getByText(/현재 적용: ±12 mm/).waitFor({state:'attached'});
    assert.match(await panel.innerText(), /88.30 mm/);
    assert.equal(await panel.getByText(/길이 허용범위 안/).count(),2);
    await page.reload();
    await input.waitFor({state:'attached'});
    await page.locator('details').evaluateAll(elements=>elements.forEach(el=>el.open=true));
    await page.getByText(/현재 적용: ±12 mm/).waitFor({state:'attached'});
    assert.equal(await input.inputValue(),'12');
    await input.fill('0');
    await panel.getByRole('button',{name:'허용오차 저장·적용'}).click();
    assert.match(await panel.innerText(), /현재 적용: ±12 mm/);
    await page.getByText('기준선 길이 허용오차는 0보다 크고 100 mm 이하여야 합니다.',{exact:true}).waitFor({state:'attached'});
    assert.deepEqual(errors,[]);
    console.log('PASS: editable tolerance, explicit apply, XY results, reload persistence, invalid input');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
