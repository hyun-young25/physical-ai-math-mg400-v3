const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {chromium} = require(path.join(process.env.PICK_QA_MODULES, 'playwright'));
(async () => {
  const browser = await chromium.launch({channel:process.env.PICK_QA_BROWSER_CHANNEL || undefined,
    args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
  const page = await browser.newPage({viewport:{width:1280,height:800}}), errors=[];
  page.setDefaultTimeout(20000); page.on('pageerror', error=>errors.push(error.message));
  const output=process.env.PICK_QA_OUTPUT || 'pick-place-qa'; fs.mkdirSync(output,{recursive:true});
  const shot = name=>page.screenshot({path:path.join(output,`content-${name}.png`)});
  const navigate=async name=>{
    await page.getByRole('button',{name:'☰',exact:true}).click();
    await page.getByRole('navigation',{name:'학습 목차',exact:true}).getByRole('button',{name}).click();
  };
  const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('physical-ai-coordinate-evidence-v1'))?.[0]);
  try {
    await page.goto('http://127.0.0.1:5184',{waitUntil:'domcontentloaded'});
    await navigate(/용어·기호와 기초수학/);
    await page.getByRole('button',{name:/3\. 순기구학 확장/}).click();
    for(const [axis,value] of [['X','350'],['Y','50'],['Z','20']]) {
      await page.getByRole('button',{name:`TCP ${axis} 편집`,exact:true}).click();
      const input=page.getByRole('spinbutton',{name:`TCP ${axis}`,exact:true});
      await input.fill(value); await input.press('Enter');
    }
    const formula=await page.getByLabel('현재 X와 Y 계산',{exact:true}).innerText();
    assert.match(formula,/350\.0 mm/); assert.match(formula,/50\.0 mm/);
    const diagram=page.getByRole('img',{name:'팔 측면의 2D 링크와 수평 성분'});
    const box=await diagram.boundingBox(); assert.ok(box.height>=180,`2D height ${box.height}`);
    const stick=await page.getByText('TCP 좌표 제어',{exact:true}).boundingBox();
    assert.ok(stick.y+stick.height<800,'joysticks stay visible');
    await shot('basic-math');
    console.log('CONTENT_QA basic-math: nonzero-Y formula, 2D height and stick visibility');

    await navigate(/2-1.*좌표축과 이동 방향/);
    const axisNav=page.getByRole('navigation',{name:'좌표축 수업 경로'});
    assert.equal(await axisNav.getByRole('button').count(),7);
    await page.getByRole('spinbutton',{name:'예상 변화량 X',exact:true}).fill('25');
    await axisNav.getByRole('button').nth(1).click(); await axisNav.getByRole('button').first().click();
    assert.equal(await page.getByRole('spinbutton',{name:'예상 변화량 X',exact:true}).inputValue(),'25');
    for(const axis of ['Y','Z']) await page.getByRole('spinbutton',{name:`예상 변화량 ${axis}`,exact:true}).fill('0');
    await page.locator('.axis-relation-question input[value="same-half"]').check();
    await page.getByRole('button',{name:'예측 저장 · DT 실행',exact:true}).click();
    await page.getByRole('button',{name:'확인 · 다음 문항',exact:true}).click();
    const before=await saved(); assert.equal(before.axisRecords.length,1);
    const firstAttempt=before.axisAttempts['x-plus'][0];
    await page.reload({waitUntil:'domcontentloaded'}); await navigate(/2-1.*좌표축과 이동 방향/);
    await axisNav.getByRole('button').first().click();
    assert.ok(await page.getByText('이 문항 완료',{exact:true}).isVisible());
    assert.deepEqual((await saved()).axisAttempts['x-plus'][0],firstAttempt);
    await shot('axis-restored'); console.log('CONTENT_QA axis: draft navigation and completed evidence after reload');

    await navigate(/2-2.*절대좌표/);
    const taskNav=page.getByRole('navigation',{name:'절대·상대좌표 문항 선택'});
    await taskNav.getByRole('button').nth(1).click();
    const bridge=page.locator('.coordinate-concept-bridge');
    assert.ok(!(await bridge.innerText()).includes('(260, 30, 20)'),'unknown endpoint is not disclosed');
    assert.match(await bridge.innerText(),/주어진 변화량/);
    const fields=page.locator('.coordinate-learning input[type="number"]');
    assert.equal(await fields.count(),3);
    await fields.nth(0).fill('260');
    await taskNav.getByRole('button').nth(2).click();
    assert.match(await bridge.innerText(),/똑같이 넣을 숫자/);
    await taskNav.getByRole('button').nth(1).click();
    assert.equal(await fields.nth(0).inputValue(),'260');
    await fields.nth(1).fill('30'); await fields.nth(2).fill('20');
    await page.getByLabel('이 두 명령을 같은 출발점에서 실행하면 도착점이 같을까요?').selectOption('same');
    await shot('coordinate-endpoint');
    await page.getByRole('button',{name:/^절대.* 실행$/}).click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('physical-ai-coordinate-evidence-v1'))?.[0].coordinateAttempts.some(a=>a.taskId==='endpoint'&&a.results.absolute));
    const partial=(await saved()).coordinateAttempts.find(a=>a.taskId==='endpoint');
    assert.equal(partial.completed,false); assert.equal(partial.results.relative,undefined);
    await page.reload({waitUntil:'domcontentloaded'}); await navigate(/2-2.*절대좌표/);
    await taskNav.getByRole('button').nth(1).click();
    await page.getByRole('button',{name:/^상대.* 실행$/}).click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('physical-ai-coordinate-evidence-v1'))?.[0].coordinateAttempts.some(a=>a.taskId==='endpoint'&&a.results.relative));
    const resumed=(await saved()).coordinateAttempts.find(a=>a.id===partial.id);
    assert.deepEqual(resumed.draft,partial.draft); assert.ok(resumed.results.absolute && resumed.results.relative);
    // The shared result marker must coincide with the live TCP, so its duplicate
    // name is suppressed by the rendered 3D label layout (0.1 mm tolerance).
    await page.locator('svg text').filter({hasText:/^DT 도착.*절대=상대$/}).waitFor({state:'visible'});
    await page.locator('svg text').filter({hasText:/^현재 TCP$/}).waitFor({state:'hidden'});
    await shot('coordinate-resumed');
    console.log('CONTENT_QA coordinates: no answer disclosure, draft navigation and partial-run resume');

    await navigate(/2-4.*도형 경로/);
    for(const shape of ['사각형','삼각형','원']) {
      await page.getByRole('group',{name:'도형 선택',exact:true}).getByRole('button',{name:shape,exact:true}).click();
      const nav=page.getByRole('navigation',{name:'도형 수업 경로'});
      assert.equal(await nav.getByRole('button').count(),6);
      for(const index of [5,2,0]) {
        await nav.getByRole('button').nth(index).click();
        assert.equal(await nav.getByRole('button').nth(index).getAttribute('aria-current'),'step');
      }
    }
    await shot('shape-path');
    await page.getByRole('button',{name:'다음 단원 · 3-1 순기구학 →',exact:true}).click();
    const mapping=page.getByRole('group',{name:'기초수학과 관절 기호 연결'});
    await mapping.getByRole('button',{name:'상대 팔꿈치 θ₂ → θ₃',exact:true}).click();
    assert.equal(await mapping.getByRole('button',{name:'상대 팔꿈치 θ₂ → θ₃',exact:true}).getAttribute('aria-pressed'),'true');
    await shot('kinematics-mapping');
    await page.setViewportSize({width:390,height:844});
    const overflow=await page.locator('.curriculum-panel').evaluateAll(nodes=>nodes.map(node=>({client:node.clientWidth,scroll:node.scrollWidth})));
    assert.ok(overflow.length>0 && overflow.every(size=>size.scroll<=size.client+2),'narrow lesson panel must not overflow');
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'content-results.json'),JSON.stringify({passed:true,errors,firstAttempt:firstAttempt.id,partialAttempt:partial.id,diagramHeight:box.height,overflow},null,2));
    console.log('CONTENT_QA complete: all checks passed');
  } catch(error) {
    await shot('failure'); fs.writeFileSync(path.join(output,'content-failure.txt'),String(error)+'\n'+await page.locator('body').innerText()); throw error;
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
