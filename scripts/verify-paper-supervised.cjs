// Isolated real React/PracticeProvider flow. All sockets terminate in a protocol mock.
require('./isolated-ui-fixtures.cjs');
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {installMockBridge}=require('./mg400-mock-socket.cjs');
const fixture=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
body{margin:0;font-family:Arial;color:#123;background:#f8fafc}.test-layout{display:grid;grid-template-columns:1fr 1fr;height:calc(100vh - 70px);gap:12px}.test-robot{position:relative;min-width:0}.paper-coordinate-host{height:100%;overflow:auto;min-width:0}.test-label{padding:8px;font-size:13px;background:#e0e7ff}
</style></head><body><div id="root"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';
import {PaperCoordinateStudy} from '/src/PaperCoordinateStudy.tsx';
import {PracticeProvider,usePractice} from '/src/PracticeProvider.tsx';import {PracticeDock} from '/src/PracticeControls.tsx';
import {RobotScene} from '/src/Robot3D.tsx';import {SHAPE_HOME_JOINTS,shapeIK} from '/src/shapeKinematics.ts';
import {setLearningUser} from '/src/learningClient.ts';import {setEvidenceItem} from '/src/learningSync.ts';
import {validatePaperFrame,studentTransformPoint,makePaperPlanHash,diagnosePaperRun} from '/src/paperCoordinateStudy.ts';
import {paperTaskTargets} from '/src/paperRectangleTask.ts';
const c=window.__case,now=Date.now(),a=(c.rotation??0)*Math.PI/180;
const samples=[['O',0,0],['X',100,0],['Y',0,100]].map(([point,x,y],i)=>({point,pose:{x:225+x*Math.cos(a)-y*Math.sin(a),y:-60+x*Math.sin(a)+y*Math.cos(a),z:60,r:0},source:'mock',seq:i+1,capturedAt:now,ageMsAtCapture:0,user:0,tool:0,coordinateSystem:'User 0 / Tool 0',verifiedCoordinates:true}));
const frame=validatePaperFrame(samples).frame,targets=paperTaskTargets('advanced-paper-hardware','initial');
const transform={originX:'225',originY:'-60',axisDirection:'x+',millimetersPerCentimeter:'10',rotationDegrees:String(c.model??0),explanation:'격리 시험용 학생 예측'};
const commands=targets.map(pt=>({point:pt.name,pose:studentTransformPoint({...transform,rotationDegrees:String(c.execution??0)},pt)}));
if(c.outside)commands[3].pose.x-=c.outside;
const predictions=commands.map((p,i)=>({...targets[i],robotX:String(p.pose.x),robotY:String(p.pose.y),robotZ:'',robotR:''}));
const planHash=makePaperPlanHash(frame.id,'initial',transform,predictions)+'|lift:'+(c.noHeight?'unset':80);
const run={id:'dt-fixture',frameId:frame.id,planHash,targetSet:'initial',source:'dt',status:'completed',startedAt:now,endedAt:now+10,startSequence:null,commands,observations:commands.map(p=>({...p,command:p.pose,pose:{...p.pose},source:'dt',kind:'dt',seq:null,ageMs:null,measuredAt:now+5}))};
const record={id:'paper-fixture',task:'paper-coordinate',version:1,uiVersion:'diag-visual-v2',taskVersion:'v4-paper-merged',support:'guided',attempt:1,parentAttemptId:null,targetSet:'initial',level:'advanced-paper-hardware',status:c.rotation?'diagnosed':'prediction',stage:c.rotation?6:4,dataSource:'dt',createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),frame,referenceSamples:samples,transform,predictions,planHash,pathConcept:{motion:'MoveL',closeX:'0',closeY:'0'},...(!c.noHeight?{liftHeight:{z:80,source:'mock',seq:4,capturedAt:now,ageMsAtCapture:0,user:0,tool:0,coordinateSystem:'User 0 / Tool 0'}}:{}),...(c.rotation?{run,dtRunPlanHash:planHash,diagnosis:diagnosePaperRun(run,frame,planHash,{transform,targets})}:{})};
setLearningUser({id:'supervised-test',login:'supervised-test',role:'student',visitId:'isolated-supervised'});setEvidenceItem('physical-ai-paper-coordinate-v1',JSON.stringify([record]));
window.__dt=[];
function Screen(){const pr=usePractice();window.__practice=pr;const [pose,setPose]=React.useState(samples[0].pose);return <><PracticeDock/><div className="test-label">격리 검증 · DT / 모의 통신만 사용 · 실장비 아님</div><div className="test-layout"><div className="test-robot"><RobotScene joints={SHAPE_HOME_JOINTS} coords={pose} endEffector="pen"/></div><div className="paper-coordinate-host"><PaperCoordinateStudy initialLevel="advanced-paper-hardware" onBack={()=>{}} hardwareConnected={false} currentPose={pose} canReach={p=>!!shapeIK(p.x,p.y,p.z,p.r)} runDigitalTwin={async commands=>{window.__dt.push(...commands);setPose(commands.at(-1));}}/></div></div></>}
createRoot(document.getElementById('root')).render(<PracticeProvider><Screen/></PracticeProvider>);
</script></body></html>`;
(async()=>{
 const webgl=process.env.PAPER_SUPERVISED_WEBGL==='1',browser=await chromium.launch({args:webgl?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:['--disable-webgl','--disable-gpu']});
 const shots=process.env.DIAG_SHOTS||path.resolve(__dirname,'../../diagnosis-qa');fs.mkdirSync(shots,{recursive:true});
 const prefix=webgl?'3d-':'';
 try{
 async function open(config){const context=await browser.newContext({viewport:{width:1280,height:720}});await context.addInitScript(c=>window.__case=c,config);await context.route('**/api/**',r=>r.fulfill({json:{}}));const mock=await installMockBridge(context);await context.route('**/__supervised',r=>r.fulfill({contentType:'text/html',body:fixture}));const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost/__supervised');await page.getByRole('region',{name:'종이 좌표 변환 학습'}).waitFor();return {context,mock,page,errors};}
 for(const [model,execution,expected] of [[15,0,/대입·계산 차이/],[0,0,/회전/],[15,15,/예측과 실행 일치/]]){
  const {context,page,errors}=await open({rotation:15,model,execution});
  assert.match(await page.locator('.square-type-badge').innerText(),expected);
  if(execution===0){assert.match(await page.getByTestId('paper-rotation-summary').innerText(),/15.0° 시계/);await page.getByTestId('paper-rotation-summary').scrollIntoViewIfNeeded();if(webgl)await page.getByTestId('paper-rotation-3d').waitFor();}
  else {assert.equal(await page.getByTestId('paper-rotation-summary').count(),0);assert.equal(await page.getByTestId('paper-rotation-3d').count(),0);}
  await page.screenshot({path:path.join(shots,prefix+'rotation-'+model+'-'+execution+'.png')});assert.deepEqual(errors,[]);await context.close();
 }
 if(process.env.PAPER_ROTATION_ONLY==='1'){console.log('PASS: 3D angle arc, diagnosis and disappearance after match.');return;}
 {
  const {context,page}=await open({outside:20,noHeight:true});
  assert.ok(await page.getByRole('button',{name:'DT에서 확인',exact:true}).isDisabled());assert.match(await page.getByRole('list',{name:'DT 실행 전 확인'}).innerText(),/펜 들기 높이\(Z\)를 먼저/);
  await page.getByRole('list',{name:'DT 실행 전 확인'}).getByRole('button',{name:'높이 입력으로',exact:true}).click();assert.equal(await page.getByLabel('펜 들기 높이',{exact:true}).evaluate(e=>e===document.activeElement),true);
  await page.getByRole('button',{name:'DT에서 확인',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(shots,prefix+'missing-height.png')});await context.close();
 }
 for(const mode of ['cancel','run','drift','outside']){
  const {context,page,mock,errors}=await open({outside:mode==='outside'?31:20});
  const physical=page.getByRole('button',{name:/^(실장비에서 확인|모의 브리지에서 시험)$/}),teacher=page.getByRole('checkbox',{name:'틀린 예측도 실장비로 확인 허용 (교사 감독)',exact:true});
  assert.ok(await physical.isDisabled());assert.match(await page.getByRole('list',{name:'실장비 실행 전 확인'}).innerText(),/허용이 꺼져/);
  await page.getByText('교사 감독 설정',{exact:true}).click();await teacher.check();assert.match(await page.getByRole('list',{name:'실장비 실행 전 확인'}).innerText(),/DT에서 먼저/);
  await page.getByRole('button',{name:'DT에서 확인',exact:true}).click();await page.getByText('실행 완료',{exact:true}).waitFor();
  await page.getByTestId('button-mode-hardware').click();if(await page.getByTestId('button-practice-panel').getAttribute('aria-expanded')!=='true')await page.getByTestId('button-practice-panel').click();await page.getByTestId('button-bridge-connect').click();await page.getByTestId('button-bridge-disconnect').waitFor();
  Object.assign(mock.measurement,{pose:{x:225,y:-60,z:60,r:0},enabled:true,robotMode:5});mock.publish();
  for(const check of await page.locator('[data-testid^="check-"]').all())await check.check();
  await page.getByTestId('button-apply-setup').click();await page.getByTestId('button-confirm-ok').click();await page.waitForFunction(()=>!!window.__practice.snap.setup);
  if(await page.getByTestId('button-practice-panel').getAttribute('aria-expanded')==='true')await page.getByTestId('button-practice-panel').click();
  const moves=()=>mock.requests.filter(r=>r.type==='execute'&&r.operation.kind==='move');
  if(mode==='outside'){assert.ok(await physical.isDisabled());assert.match(await page.getByRole('list',{name:'실장비 실행 전 확인'}).innerText(),/30 mm.*작업 범위/s);await physical.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(shots,'blocked-outside.png')});assert.equal(moves().length,0);}
  else {
   await physical.click();const dialog=page.getByRole('dialog');await dialog.waitFor();assert.match(await dialog.innerText(),/예측이 목표와 다릅니다/);assert.match(await dialog.innerText(),/P4: 종이 밖에서는 펜을 내리지/);assert.equal(moves().length,0);
   await page.screenshot({path:path.join(shots,'teacher-confirmation.png')});
   if(mode==='drift'){mock.measurement.pose.x=235;mock.publish();await page.waitForFunction(()=>window.__practice.snap.measurement?.pose.x===235);}
   await page.getByTestId(mode==='cancel'?'button-confirm-cancel':'button-confirm-ok').click();
   if(mode==='cancel'){await page.getByRole('alert').filter({hasText:'최종 확인이 취소됐습니다'}).waitFor();assert.equal(moves().length,0);}
   else if(mode==='drift'){await page.getByRole('alert').filter({hasText:'교사 확인 중 시작 위치'}).waitFor();assert.equal(moves().length,0);}
   else {await page.getByText('실행 완료',{exact:true}).waitFor();assert.ok(moves().length>0);const p4=moves().filter(r=>r.operation.target.x===205&&r.operation.target.y===90);assert.ok(p4.length>0);assert.ok(p4.every(r=>r.operation.target.z===80),'no lowering at outside P4');const xy=moves().map(r=>r.operation.target);for(let i=1;i<xy.length;i++)if(xy[i].x!==xy[i-1].x||xy[i].y!==xy[i-1].y)assert.ok(xy[i].z>=80&&xy[i-1].z>=80,'travel stays raised');}
   const events=await page.evaluate(()=>JSON.parse(localStorage.getItem('mg400:pending-visit:isolated-supervised')).events.map(e=>e.payload).filter(e=>e.task==='paper-supervised-execution'));
   const confirmed=events.filter(e=>e.status==='teacher-confirmed');assert.equal(confirmed.length,mode==='run'?1:0);
   assert.ok(events.some(e=>e.status==='dt-prerequisite'&&e.dtRun.source==='dt'&&e.dtRun.status==='completed'));
   if(mode==='run'){assert.equal(confirmed[0].hardwareRunOfMismatchedPrediction,false);assert.ok(confirmed[0].teacherConfirmedAt);assert.deepEqual(confirmed[0].raisedOnlyPoints,['P4']);fs.writeFileSync(path.join(shots,'supervised-audit.json'),JSON.stringify(events,null,2));}
  }
  assert.deepEqual(errors,[]);mock.dispose();await context.close();
 }
 console.log('PASS: 15° calculation/rotation/match UI; angle arc; missing-Z guidance/focus; opt-in off; DT required; mock confirmation/cancel; 30 mm/workspace blocks; raised-only outside; existing event audit without trial/CSV schema changes.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
