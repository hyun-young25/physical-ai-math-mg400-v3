const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),ts=require("typescript");
const target=path.join(__dirname,"paperAiAnalysis.ts");
const exports={};
new Function("exports","require",ts.transpileModule(fs.readFileSync(target,"utf8"),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText)(exports,name=>{
  assert.equal(name,"./paperCoordinateStudy");
  return {frameTransformPoint:(_frame,point)=>({x:point.xCm*10,y:point.yCm*10,z:12,r:0})};
});
const frame={id:"frame-new",source:"hardware",coordinateSystem:"User 0 / Tool 0",user:0,tool:0,capturedAt:20,samples:[
  {point:"O",pose:{x:0,y:0,z:12,r:0},source:"hardware",seq:8,capturedAt:10,ageMsAtCapture:5,user:0,tool:0,coordinateSystem:"User 0 / Tool 0"},
  {point:"X",pose:{x:100,y:0,z:12,r:0},source:"hardware",seq:9,capturedAt:15,ageMsAtCapture:5,user:0,tool:0,coordinateSystem:"User 0 / Tool 0"},
  {point:"Y",pose:{x:0,y:100,z:12,r:0},source:"hardware",seq:10,capturedAt:20,ageMsAtCapture:5,user:0,tool:0,coordinateSystem:"User 0 / Tool 0"},
]};
const targets=[{name:"A",xCm:3,yCm:2},{name:"B",xCm:9,yCm:2}];
const run={id:"run-current",planHash:"plan-current",frameId:frame.id,targetSet:"initial",source:"mock",status:"completed",startedAt:30,endedAt:40,
  startSequence:11,commands:[{point:"A",pose:{x:40,y:19,z:12,r:0}},{point:"B",pose:{x:90,y:20,z:12,r:0}}],
  observations:[{point:"A",pose:{x:42,y:23,z:12,r:0},source:"mock",seq:12,measuredAt:38,ageMs:2,command:{x:40,y:19,z:12,r:0},kind:"mock-bridge"}]};
const current={id:"attempt-current",task:"paper-coordinate",version:1,attempt:2,parentAttemptId:"attempt-old",targetSet:"initial",level:"advanced-paper-dt",
  status:"diagnosed",dataSource:"hardware",createdAt:"t1",updatedAt:"t2",frame,referenceSamples:frame.samples,
  transform:{originX:"0",originY:"0",axisDirection:"x+",millimetersPerCentimeter:"10",rotationDegrees:"0",explanation:"학생 변환식"},predictions:[],
  planHash:"plan-current",run,studentHypothesis:"원점이 어긋난 것 같아요."};
const previous={...current,id:"attempt-old",attempt:1,parentAttemptId:null,run:{...run,id:"run-old",planHash:"plan-old"},revisionReason:"이전 시도에서 원점 좌표를 검토함"};
const unrelated={...previous,id:"other-task",task:"foundation",parentAttemptId:null};

test("analysis is only ready for a complete diagnosis bound to the current plan and frame",()=>{
  assert.equal(exports.paperAnalysisReady(current,"plan-current",{status:"complete"}),true);
  assert.equal(exports.paperAnalysisReady({...current,run:{...run,status:"partial"}},"plan-current",{status:"complete"}),false);
  assert.equal(exports.paperAnalysisReady({...current,planHash:"old-plan"},"plan-current",{status:"complete"}),false);
  assert.equal(exports.paperAnalysisReady({...current,run:{...run,frameId:"old-frame"}},"plan-current",{status:"complete"}),false);
  assert.equal(exports.paperAnalysisReady(current,"plan-current",{status:"incomplete"}),false);
});

test("comparison data keeps target-to-command separate from command-to-observation and labels mock evidence",()=>{
  const rows=exports.paperRunComparisons(current,targets),first=rows[0];
  assert.deepEqual(first.targetRobotMm,{x:30,y:20,z:12,r:0});
  assert.deepEqual(first.targetVsCommandMm,{dx:10,dy:-1,distance:Math.hypot(10,1)});
  assert.deepEqual(first.commandVsReportedMm,{dx:2,dy:4,distance:Math.hypot(2,4)});
  assert.equal(first.observation.source,"mock");
  assert.equal(rows[1].controllerReportedMm,null);
});

test("AI context includes current frame, saved model, source, run and only parent-linked history",()=>{
  const context=exports.paperFeedbackContext(current,[unrelated,previous,current],targets);
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
  assert.equal(history[0].revisionReason,"이전 시도에서 원점 좌표를 검토함");
  assert(!context.history.includes("other-task"));
});
