const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),ts=require("typescript");
const target=path.join(__dirname,"paperAiAnalysis.ts");
const moduleExports={};
new Function("exports","require",ts.transpileModule(fs.readFileSync(target,"utf8"),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText)(moduleExports,name=>{
  assert.equal(name,"./paperCoordinateStudy");
  return {frameTransformPoint:(frame,point)=>{
    const o=frame.samples.find(s=>s.point==="O").pose,x=frame.samples.find(s=>s.point==="X").pose,y=frame.samples.find(s=>s.point==="Y").pose;
    return {x:o.x+(x.x-o.x)*point.xCm/10+(y.x-o.x)*point.yCm/10,
      y:o.y+(x.y-o.y)*point.xCm/10+(y.y-o.y)*point.yCm/10,z:o.z,r:o.r};
  }};
});
const frame={id:"frame-new",source:"hardware",coordinateSystem:"User 0 / Tool 0",user:0,tool:0,capturedAt:20,samples:[
  {point:"O",pose:{x:0,y:0,z:12,r:0},source:"hardware",seq:8,capturedAt:10,ageMsAtCapture:5,user:0,tool:0,coordinateSystem:"User 0 / Tool 0"},
  {point:"X",pose:{x:100,y:0,z:12,r:0},source:"hardware",seq:9,capturedAt:15,ageMsAtCapture:5,user:0,tool:0,coordinateSystem:"User 0 / Tool 0"},
  {point:"Y",pose:{x:0,y:100,z:12,r:0},source:"hardware",seq:10,capturedAt:20,ageMsAtCapture:5,user:0,tool:0,coordinateSystem:"User 0 / Tool 0"},
]};
const targets=[{name:"A",xCm:3,yCm:2},{name:"B",xCm:9,yCm:2}];
const criteria=(recordId="attempt-current",planHash="plan-current",targetSet="initial",confirmedAt=25)=>({
  recordId,frameId:frame.id,planHash,targetSet,modelConstructionPoints:["O","X","Y"],
  independentVerificationPoints:targets.map(p=>p.name),positionToleranceMm:2,rotationToleranceDeg:2,
  rationale:"실행 전에 확인점 오차 2 mm 이내를 기준으로 정함",confirmedAt,
});
const run={id:"run-current",planHash:"plan-current",frameId:frame.id,targetSet:"initial",source:"mock",status:"completed",startedAt:30,endedAt:40,
  startSequence:11,commands:[{point:"A",pose:{x:40,y:19,z:12,r:0}},{point:"B",pose:{x:90,y:20,z:12,r:0}}],
  verificationCriteria:criteria(),
  observations:[{point:"A",pose:{x:42,y:23,z:12,r:0},source:"mock",seq:12,measuredAt:38,ageMs:2,command:{x:40,y:19,z:12,r:0},kind:"mock-bridge"}]};
const current={id:"attempt-current",task:"paper-coordinate",version:1,attempt:2,parentAttemptId:"attempt-old",targetSet:"initial",level:"advanced-paper-dt",
  status:"diagnosed",dataSource:"hardware",createdAt:"t1",updatedAt:"t2",frame,referenceSamples:frame.samples,
  transform:{originX:"0",originY:"0",axisDirection:"x+",millimetersPerCentimeter:"10",rotationDegrees:"0",explanation:"학생 변환식"},predictions:[],
   planHash:"plan-current",run,studentHypothesis:"원점이 어긋난 것 같아요.",
   inkReadings:[{recordId:"attempt-current",runId:"run-current",frameId:frame.id,point:"A",unit:"cm",source:"student-manual-ink",
     status:"measured",xCm:3.2,yCm:2.1,rawX:"3.20",rawY:"2.10",reason:"눈금 중심을 읽음",recordedAt:39}]};
const previous={...current,id:"attempt-old",attempt:1,parentAttemptId:null,run:{...run,id:"run-old",planHash:"plan-old"},
  studentHypothesis:"첫 실행은 원점을 더하지 않은 것 같음",revisionReason:"원점 좌표를 식에 다시 반영",
  revalidation:{parentAttemptId:"attempt-old",runId:"run-retry",source:"mock",checkedAt:50,scope:"모의 브리지 재검증"},
  aiAnalyses:[
    {id:"displayed-analysis",mode:"gpt",provider:"rules",status:"limited",question:"원점 항을 어떻게 확인했나요?",
      text:"시험용 대체 안내: 원점 좌표를 확인해 보세요.",requestedAt:"t2",displayedAt:"t3",
      recordId:"attempt-old",runId:"run-old",planHash:"plan-old",source:"mock"},
    {id:"unshown-analysis",mode:"gpt",provider:"openai",status:"provided",question:"미표시",
      text:"저장하면 안 되는 답",requestedAt:"t2",recordId:"attempt-old",runId:"run-old",planHash:"plan-old",source:"mock"},
    {id:"stale-analysis",mode:"gpt",provider:"openai",status:"provided",question:"낡은 계획",
      text:"다른 계획의 답",requestedAt:"t2",displayedAt:"t3",recordId:"attempt-old",runId:"old-run",planHash:"old-plan",source:"mock"},
  ]};
const unrelated={...previous,id:"other-task",task:"foundation",parentAttemptId:null};

test("analysis is only ready for a complete diagnosis bound to the current plan and frame",()=>{
  assert.equal(moduleExports.paperAnalysisReady(current,"plan-current",{status:"complete"}),true);
  assert.equal(moduleExports.paperAnalysisReady({...current,run:{...run,status:"partial"}},"plan-current",{status:"complete"}),false);
  assert.equal(moduleExports.paperAnalysisReady({...current,planHash:"old-plan"},"plan-current",{status:"complete"}),false);
  assert.equal(moduleExports.paperAnalysisReady({...current,run:{...run,frameId:"old-frame"}},"plan-current",{status:"complete"}),false);
  assert.equal(moduleExports.paperAnalysisReady(current,"plan-current",{status:"incomplete"}),false);
});

test("comparison data keeps target, command and report pairs distinct and labels mock evidence",()=>{
  const rows=moduleExports.paperRunComparisons(current,targets),first=rows[0];
  assert.deepEqual(first.targetRobotMm,{x:30,y:20,z:12,r:0});
  assert.deepEqual(first.targetVsCommandMm,{dx:10,dy:-1,distance:Math.hypot(10,1)});
  assert.deepEqual(first.commandVsReportedMm,{dx:2,dy:4,distance:Math.hypot(2,4)});
  assert.deepEqual(first.targetVsControllerReportedMm,{dx:12,dy:3,distance:Math.hypot(12,3)});
  assert.equal(first.observation.source,"mock");
  assert.equal(rows[1].controllerReportedMm,null);
});

test("ink is converted through measured O/X/Y, tied to the exact run, and missing is not zero",()=>{
  const comparisons=moduleExports.paperInkComparisons(current,targets);
  const first=comparisons[0];
  assert.deepEqual(first.inkAsMeasuredFrameRobotMm,{x:32,y:21});
  assert.deepEqual(first.targetVsInkMm,{dx:2,dy:1,distance:Math.sqrt(5)});
  assert.equal(first.controllerReportedVsInkMm.dx,-10);
  assert.equal(first.controllerReportedVsInkMm.dy,-2);
  assert.ok(Math.abs(first.controllerReportedVsInkMm.distance-Math.sqrt(104))<1e-12);
  const missing=moduleExports.paperInkComparisons({...current,inkReadings:[{
    ...current.inkReadings[0],runId:"old-run",xCm:0,yCm:0,
  }]},targets)[0];
  assert.equal(missing.inkAsMeasuredFrameRobotMm,null);
  assert.equal(missing.targetVsInkMm,null);
  assert.equal(missing.inkReading,null);
});

test("criteria must be confirmed before the exact run and bind independent points",()=>{
  assert.equal(moduleExports.paperAnalysisReady(current,"plan-current",{status:"complete"}),true);
  assert.equal(moduleExports.paperAnalysisReady({...current,run:{...run,verificationCriteria:undefined}},"plan-current",{status:"complete"}),false);
  assert.equal(moduleExports.paperAnalysisReady({...current,run:{...run,verificationCriteria:{...criteria(),confirmedAt:31}}},"plan-current",{status:"complete"}),false);
});

test("AI context includes current frame, saved model, source, run and only parent-linked history",()=>{
  const context=moduleExports.paperFeedbackContext(current,[unrelated,previous,current],targets);
  const condition=JSON.parse(context.condition),answers=JSON.parse(context.answers),execution=JSON.parse(context.execution)[0];
  const history=JSON.parse(context.history);
  assert.equal(condition.frame.id,"frame-new");
  assert.equal(condition.frame.samples.length,3);
  assert.equal(condition.recordId,"attempt-current");
  assert.equal(answers.savedStudentTransform.explanation,"학생 변환식");
  assert.equal(answers.savedPredictedRobotCoordinates.length,0);
  assert.equal(execution.source,"mock");
  assert.equal(execution.status,"completed");
  assert.equal(execution.observations[0].source,"mock");
  assert.equal(execution.comparisons[0].targetVsCommandMm.dx,10);
  assert.equal(execution.comparisons[0].commandVsReportedMm.dx,2);
  assert.equal(history.length,1);
  assert.equal(history[0].recordId,"attempt-old");
  assert.equal(history[0].revisionReason,"원점 좌표를 식에 다시 반영");
  assert.equal(history[0].studentHypothesis,"첫 실행은 원점을 더하지 않은 것 같음");
  assert.equal(history[0].previouslyDisplayedFeedback.length,1);
  assert.equal(history[0].previouslyDisplayedFeedback[0].text,"시험용 대체 안내: 원점 좌표를 확인해 보세요.");
  assert.equal(history[0].run.status,"completed");
  assert.equal(history[0].revalidation.runId,"run-retry");
  assert(!context.history.includes("other-task"));
});

test("first attempt has no previous feedback and a different paper assignment cannot enter the linked chain",()=>{
  const first={...current,id:"first-attempt",attempt:1,parentAttemptId:null,aiAnalyses:[]};
  const firstContext=moduleExports.paperFeedbackContext(first,[unrelated,previous,first],targets);
  assert.deepEqual(JSON.parse(firstContext.history),[]);
  const otherAssignment={...previous,id:"other-assignment",level:"advanced-paper-hardware"};
  const child={...current,parentAttemptId:otherAssignment.id};
  const changed=moduleExports.paperFeedbackContext(child,[otherAssignment,child],targets);
  assert.deepEqual(JSON.parse(changed.history),[]);
  const otherVersion={...previous,id:"other-version",taskVersion:"v3-paper"};
  const versionChild={...current,parentAttemptId:otherVersion.id,taskVersion:"v4-paper-merged"};
  const versionChanged=moduleExports.paperFeedbackContext(versionChild,[otherVersion,versionChild],targets);
  assert.deepEqual(JSON.parse(versionChanged.history),[]);
});

test("hardware feedback request carries only the current run's controller-reported pose",()=>{
  const hardwareFrame={...frame,source:"hardware"};
  const hardwareRun={...run,id:"physical-run-current",source:"hardware",status:"completed",
    observations:[{point:"A",pose:{x:43,y:24,z:12,r:0},source:"hardware",seq:22,measuredAt:39,ageMs:4,
      command:{x:40,y:19,z:12,r:0},kind:"controller-tcp"}]};
  const physical={...current,dataSource:"hardware",frame:hardwareFrame,run:hardwareRun};
  const context=moduleExports.paperFeedbackContext(physical,[unrelated,previous,physical],targets);
  const execution=JSON.parse(context.execution);
  assert.equal(execution.length,1);
  assert.equal(execution[0].recordId,physical.id);
  assert.equal(execution[0].runId,"physical-run-current");
  assert.equal(execution[0].source,"hardware");
  assert.equal(execution[0].observations[0].kind,"controller-tcp");
  assert.deepEqual(execution[0].observations[0].pose,{x:43,y:24,z:12,r:0});
  assert.deepEqual(execution[0].comparisons[0].controllerReportedMm,{x:43,y:24,z:12,r:0});
  const delta=execution[0].comparisons[0].commandVsReportedMm;
  assert.equal(delta.dx,3);
  assert.equal(delta.dy,5);
  assert.ok(Math.abs(delta.distance-Math.sqrt(34))<1e-12);
  assert(!context.execution.includes("run-old"));
});
