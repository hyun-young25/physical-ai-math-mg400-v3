const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),ts=require("typescript");
const exports_={};new Function("exports",ts.transpileModule(fs.readFileSync(__dirname+"/learningAiContext.ts","utf8"),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText)(exports_);
const {makeFeedbackContext,numericFeedbackContext,feedbackVersion,localFeedback,sanitizeFeedbackContext,feedbackHistoryEnvelope,fitFeedbackRequestBudget,feedbackFailureFromTransport,squareMeasurementLinkedToMission}=exports_;
const condition={id:"height-practice",prompt:"현재 높이 20, 목표 높이 60",support:"guided"};
const original={conditionKey:JSON.stringify(condition),prediction:{z:"60"},reason:"최초 풀이",runs:[],answerReviews:[],explanationReviews:[]};
const input=(patch={})=>({task:"foundation",condition,fields:[{key:"z",label:"변화량",unit:"mm"}],
  answers:{z:"40"},reason:"수정 풀이",record:null,history:[original],...patch});
test("first prediction remains intact and later answer/reason revisions are separate",()=>{
  const record={...original,answerReviews:[{answers:{z:"40"}}],explanationReviews:[{phase:"revision",text:"고친 풀이"}]};
  const c=makeFeedbackContext(input({record}));assert.match(c.answers,/40/);assert.match(c.reason,/고친/);
  assert.match(c.initialPrediction,/60/);assert.match(c.initialPrediction,/최초 풀이/);
  assert.deepEqual(original.prediction,{z:"60"});
});
test("response version changes on answer, reason, task and results; not history-only changes",()=>{
  const c=makeFeedbackContext(input());
  for(const patch of [{answers:{z:"9"}},{reason:"다른 풀이"},{condition:{id:"another"}},{record:{...original,runs:[{action:"motion",status:"stopped"}]}}])
    assert.notEqual(feedbackVersion(c),feedbackVersion(makeFeedbackContext(input(patch))));
  assert.equal(feedbackVersion(c),feedbackVersion({...c,history:"[]"}));
});
test("virtual, mock and missing/stale hardware data remain distinct and errors are preserved",()=>{
  for(const source of ["virtual","mock","hardware"]) {
    const record={...original,runs:[{action:"motion-attempt",status:"unavailable",summary:"초기 위치 불일치",
      detail:{motion:{source,measurements:[{ageMs:9000,measuredAt:100,source}]}}}]};
    const c=makeFeedbackContext(input({record}));assert.match(c.execution,new RegExp(source));
    assert.match(c.execution,/9000|초기 위치 불일치/);assert.doesNotMatch(localFeedback(c,true),/집었습니다|움직였습니다/);
  }
});
test("coordinate adapter explicitly states virtual-only support and strips PII",()=>{
  const c=numericFeedbackContext({task:"coordinate-test",condition:{name:"PRIVATE",from:{x:20}},
    answers:{x:60},reason:"test@example.com",history:[],execution:[],judgment:"미판정"});
  assert.match(c.condition,/실장비 실행 미지원/);assert.match(c.execution,/"source":"virtual"/);
  assert.doesNotMatch(JSON.stringify(c),/PRIVATE|test@example/);
});
test("privacy removes identity fields while preserving student math, coordinates, units and explanations",()=>{
  const context={task:"paper-coordinate",
    condition:JSON.stringify({name:"민감한 이름",studentId:"STU-2026-77",visitId:"VISIT-SECRET",
      targetPaperCm:[{name:"A",xCm:3,yCm:2}],frame:{coordinateSystem:"User 0 / Tool 0",samples:[{point:"O",pose:{x:180,y:-60,z:80,r:0}}]}}),
    answers:JSON.stringify({savedStudentTransform:{originX:"180",originY:"-60",axisDirection:"y-",millimetersPerCentimeter:"10",
      rotationDegrees:"0",explanation:"이름: 김가을, X=원점X+10×종이x"},studentHypothesis:"학번: QA-12345. 축 방향을 다시 검토함",
      revisionReason:"연락처: 010-1234-5678; 1 cm는 10 mm"}),
    reason:"이메일 qa-person@example.com; 원점과 축 방향을 설명함",initialPrediction:"{}",
    history:JSON.stringify([{studentId:"STU-OLD",previouslyDisplayedFeedback:[{provider:"rules",text:"원점X+10×x"}]}]),
    judgment:"{}",execution:"[]",support:"guided",attempts:1};
  const safe=sanitizeFeedbackContext(context);
  const serialized=JSON.stringify(safe);
  assert.doesNotMatch(serialized,/민감한 이름|김가을|STU-2026-77|VISIT-SECRET|QA-12345|010-1234-5678|qa-person@example.com|STU-OLD/);
  const condition=JSON.parse(safe.condition),answers=JSON.parse(safe.answers),history=JSON.parse(safe.history);
  assert.equal(condition.targetPaperCm[0].name,"A");
  assert.deepEqual([condition.targetPaperCm[0].xCm,condition.targetPaperCm[0].yCm],[3,2]);
  assert.equal(condition.frame.coordinateSystem,"User 0 / Tool 0");
  assert.equal(answers.savedStudentTransform.axisDirection,"y-");
  assert.equal(answers.savedStudentTransform.millimetersPerCentimeter,"10");
  assert.match(answers.savedStudentTransform.explanation,/X=원점X\+10×종이x/);
  assert.match(answers.studentHypothesis,/축 방향을 다시 검토함/);
  assert.match(answers.revisionReason,/1 cm는 10 mm/);
  assert.match(history[0].previouslyDisplayedFeedback[0].text,/원점X\+10×x/);
});
test("paper follow-up history stays valid and retains displayed feedback, revision and rerun evidence",()=>{
  const previous={
    recordId:"paper-attempt-1",parentAttemptId:null,attempt:1,taskVersion:"paper-v4",level:"advanced-paper-dt",
    targetSet:"initial",status:"revised",dataSource:"dt",
    transform:{originX:"180",originY:"-60",axisDirection:"x+",millimetersPerCentimeter:"10",explanation:"처음 풀이의 식"},
    predictions:[{name:"P3",xCm:6,yCm:7,robotX:"310",robotY:"90"}],
    studentHypothesis:"P3의 대입값을 다시 살펴봄",revisionReason:"축별 계산을 다시 적어 수정",
    followupObservation:{recordId:"paper-attempt-1",runId:"dt-run-2",text:"P3 눈금 6.0 cm를 다시 읽음",source:"student-manual-ink"},
    modelDecision:"revise",modelDecisionReason:"회전항을 식에 반영할 필요가 있음",
    verificationCriteria:{recordId:"paper-attempt-1",positionToleranceMm:2,rotationToleranceDeg:2,
      rationale:"실행 전 독립 확인점 기준",independentVerificationPoints:["P1","P2","P3","P4"]},
    revalidation:{parentAttemptId:"paper-attempt-1",runId:"dt-run-2",source:"dt",scope:"same-task"},
    previouslyDisplayedFeedback:[{mode:"gpt",provider:"openai",status:"provided",source:"dt",text:"X 좌표에 어떤 값을 대입했나요?"}],
    frame:{id:"frame-1",source:"teacher",coordinateSystem:"User 0 / Tool 0",user:0,tool:0,capturedAt:10,samples:[{point:"O",pose:{x:180,y:-60,z:60,r:0}}]},
    run:{id:"dt-run-2",planHash:"plan-2",source:"dt",status:"completed",startedAt:10,endedAt:12,
      verificationCriteria:{recordId:"paper-attempt-1",positionToleranceMm:2,rationale:"실행 전 독립 확인점 기준"},
      commands:[{point:"P3",pose:{x:290,y:90,z:60,r:0}}],
      observations:[{point:"P3",source:"dt",kind:"dt",seq:null,measuredAt:12,pose:{x:290,y:90,z:60,r:0}}]},
    runHistory:[{id:"prevalidation-dt",planHash:"plan-2",frameId:"frame-1",source:"dt",status:"completed",
      commands:[{point:"P3",pose:{x:290,y:90,z:60,r:0}}],observations:[{point:"P3",pose:{x:290,y:90,z:60,r:0},source:"dt"}]}],
    inkReadings:[{recordId:"paper-attempt-1",runId:"dt-run-2",point:"P3",unit:"cm",source:"student-manual-ink",
      status:"measured",rawX:"6.0",rawY:"7.0",xCm:6,yCm:7}],
    diagnosis:{method:"rule-based",status:"complete",candidate:"대입·계산 차이",firstMismatch:"P3",question:"어떤 수를 대입했나요?",why:"예측 좌표와 목표 좌표 비교",evidence:[{point:"P3",distance:20}]},
    unusedDiagnosticPayload:"x".repeat(4200),
  };
  const source=JSON.stringify([previous]);
  assert.ok(source.length>3500,"regression fixture must exceed the former truncation limit");
  const encoded=feedbackHistoryEnvelope({task:"paper-coordinate",history:source},[],[]);
  assert.ok(encoded.length<=6000);
  const envelope=JSON.parse(encoded),attempts=JSON.parse(envelope.attempts);
  assert.equal(attempts.length,1);
  assert.equal(attempts[0].previouslyDisplayedFeedback[0].text,"X 좌표에 어떤 값을 대입했나요?");
  assert.equal(attempts[0].revisionReason,"축별 계산을 다시 적어 수정");
  assert.equal(attempts[0].run.observations[0].pose.x,290);
  assert.equal(attempts[0].run.status,"completed");
  assert.equal(attempts[0].studentHypothesis,"P3의 대입값을 다시 살펴봄");
  assert.equal(attempts[0].followupObservation.text,"P3 눈금 6.0 cm를 다시 읽음");
  assert.equal(attempts[0].modelDecisionReason,"회전항을 식에 반영할 필요가 있음");
  assert.equal(attempts[0].run.verificationCriteria.positionToleranceMm,2);
  assert.equal(attempts[0].runHistory[0].id,"prevalidation-dt");
  assert.equal(attempts[0].inkReadings[0].source,"student-manual-ink");
});
test("very long multi-attempt paper history stays parseable and keeps the latest linked math evidence",()=>{
  const record={
    attempt:1,level:"advanced-paper-dt",targetSet:"initial",status:"revised",dataSource:"dt",
    transform:{originX:"190",originY:"-60",millimetersPerCentimeter:"10",rotationDegrees:"0",explanation:"x = 190 + 10u; y = -60 + 10v"},
    predictions:[{name:"P1",xCm:0,yCm:0,robotX:"190",robotY:"-60"}],
    studentHypothesis:"검증용 가설",revisionReason:"축과 원점을 다시 계산",
    previouslyDisplayedFeedback:[{provider:"openai",status:"provided",text:"왜 원점과 P1이 같은지 좌표로 확인해 보세요."}],
    run:{source:"dt",status:"completed",observations:[{point:"P1",pose:{x:190,y:-60,z:50,r:0}}]},
    runHistory:Array.from({length:20},(_,i)=>({id:`old-${i}`,source:"dt",status:"completed",observations:[{point:"P1",pose:{x:i,y:i,z:50,r:0}}]})),
    inkReadings:Array.from({length:20},(_,i)=>({point:`P${i}`,unit:"cm",source:"student-manual-ink",rawX:String(i),rawY:String(i)})),
    unusedDiagnosticPayload:"이전 기록 원문 ".repeat(2000),
  };
  const source=JSON.stringify(Array.from({length:8},(_,i)=>({...structuredClone(record),attempt:i+1,
    studentHypothesis:`시도 ${i+1}의 수학적 가설`,revisionReason:`시도 ${i+1}의 수정 이유`})));
  const before=source;
  const encoded=feedbackHistoryEnvelope({task:"paper-coordinate",history:source},["힌트 ".repeat(1000)],["답 ".repeat(1000)]);
  assert.ok(encoded.length<=6000);
  const envelope=JSON.parse(encoded),attempts=JSON.parse(envelope.attempts);
  assert.ok(attempts.length>=1&&attempts.length<=2);
  const latest=attempts.at(-1);
  assert.equal(latest.attempt,8);
  assert.equal(latest.studentHypothesis,"시도 8의 수학적 가설");
  assert.equal(latest.revisionReason,"시도 8의 수정 이유");
  assert.match(latest.transform.explanation,/x = 190/);
  assert.equal(latest.previouslyDisplayedFeedback[0].provider,"openai");
  assert.equal(latest.run.observations[0].pose.x,190);
  assert.equal(source,before,"compaction must not mutate or rewrite the saved history");
});
test("unsaved answer and explanation edits are current context, not a new verdict or overwritten prediction",()=>{
  const record=structuredClone(original);
  const c=makeFeedbackContext(input({record,reviewDraft:{z:"55"},reasonRevision:"새 기준으로 생각 중",
    judgment:{status:"correct"}}));
  assert.equal(JSON.parse(c.answers).z,"55");
  assert.equal(c.reason,"새 기준으로 생각 중");
  assert.match(c.judgment,/미확정/);assert.doesNotMatch(c.judgment,/correct/);
  assert.equal(JSON.parse(c.initialPrediction).answers.z,original.prediction.z);
  assert.deepEqual(record,original);
});
function squareFeedbackContext(runs){
  const squareCondition={id:"square-lesson",support:"guided"};
  const record={id:"square-attempt",task:"square",conditionKey:JSON.stringify(squareCondition),condition:squareCondition,
    fields:[{key:"p1",label:"P1 X",unit:"mm"}],prediction:{p1:"120"},reason:"처음 예측한 풀이",
    submittedAt:"2026-11-01T10:00:00.000Z",runs,reflections:[],answerReviews:[],explanationReviews:[]};
  return makeFeedbackContext({task:"square",condition:squareCondition,fields:record.fields,answers:record.prediction,
    reason:record.reason,record,history:[record]});
}
const squareDtRun=(id,planKey)=>({id,action:"mission",status:"completed",
  startedAt:"2026-11-01T10:00:00.000Z",endedAt:"2026-11-01T10:00:01.000Z",
  expected:{p1:120},detail:{source:"dt",planKey}});
const squareHardwareRun=(id,dtId,planKey,status="completed",actualX=121)=>({
  id,action:"square-measurement",status,startedAt:"2026-11-01T10:01:00.000Z",endedAt:"2026-11-01T10:01:02.000Z",
  detail:{runId:id,prevalidationRunId:dtId,planKey,source:"hardware",complete:status==="completed",
    observedVertices:status==="completed"?[{label:"P1",x:actualX,y:230,z:50}]:[],
    measurements:status==="completed"?[{label:"P1",target:{x:120,y:230,z:50,r:0},
      actual:{x:actualX,y:229,z:50,r:0},source:"hardware",seq:44,measuredAt:1234,ageMs:12}]:[],
    ...(status!=="completed"?{error:"제어기 회신 누락"}:{})},
});
test("square AI evidence uses the measurement linked to the latest same-plan DT; command and observation stay separate",()=>{
  const oldDt=squareDtRun("dt-old","same-plan");
  const oldMeasurement=squareHardwareRun("hardware-old","dt-old","same-plan","completed",999);
  const currentDt=squareDtRun("dt-current","same-plan");
  const currentMeasurement=squareHardwareRun("hardware-current","dt-current","same-plan","completed",121);
  assert.equal(squareMeasurementLinkedToMission(currentDt,currentMeasurement),true);
  const run=JSON.parse(squareFeedbackContext([oldDt,oldMeasurement,currentDt,currentMeasurement]).execution)[0];
  assert.equal(run.runId,"hardware-current");
  assert.equal(run.prevalidationRunId,"dt-current");
  assert.equal(run.measurement.isPhysicalMeasurement,true);
  assert.equal(run.commandCoordinates[0].target.x,120);
  assert.equal(run.measurement.observations[0].pose.x,121);
  assert.doesNotMatch(JSON.stringify(run),/hardware-old|999/);
});
test("a new same-plan DT without a new measurement cannot reuse the previous hardware result",()=>{
  const oldDt=squareDtRun("dt-old","same-plan");
  const oldMeasurement=squareHardwareRun("hardware-old","dt-old","same-plan","completed",999);
  const currentDt=squareDtRun("dt-current","same-plan");
  assert.equal(squareMeasurementLinkedToMission(currentDt,oldMeasurement),false);
  const run=JSON.parse(squareFeedbackContext([oldDt,oldMeasurement,currentDt]).execution)[0];
  assert.equal(run.runId,null);
  assert.equal(run.measurement,null);
  assert.equal(run.measurementStatus,"stale-or-unlinked");
  assert.doesNotMatch(JSON.stringify(run),/hardware-old|999/);
});
test("an exact-run hardware failure remains unavailable and is never promoted to an observation",()=>{
  const dt=squareDtRun("dt-current","same-plan");
  const failed=squareHardwareRun("hardware-failed","dt-current","same-plan","unavailable");
  const run=JSON.parse(squareFeedbackContext([dt,failed]).execution)[0];
  assert.equal(run.runId,"hardware-failed");
  assert.equal(run.measurement.status,"unavailable");
  assert.equal(run.measurement.isPhysicalMeasurement,false);
  assert.deepEqual(run.measurement.observations,[]);
  assert.match(run.measurement.detail.error,/제어기 회신 누락/);
});
test("direct paper parent survives privacy cleanup and API-size compaction with model, displayed feedback and revision evidence",()=>{
  const parent={recordId:"attempt-190",attempt:1,taskVersion:"paper-v3",level:"advanced-paper-dt",
    transform:{originX:"190",originY:"-60",millimetersPerCentimeter:"10",rotationDegrees:"0",
      explanation:"첫 시도의 원점 X=190 가정과 좌표 변환식"},
    predictions:[{name:"P1",xCm:2,yCm:3,robotX:210,robotY:-30}],
    studentHypothesis:"원점 기준이 어긋났을 수 있음",modelDecision:"revise",
    modelDecisionReason:"같은 실행에서 확인한 목표-명령 차이 10mm와 새 기준점 관측",
    followupObservation:{recordId:"attempt-190",runId:"run-190",source:"student-report",
      text:"종이 눈금에서 기준점 O와 P1을 다시 확인",recordedAt:10},
    revisionReason:"X=190 가정을 재검토하고 180으로 수정",
    previouslyDisplayedFeedback:[{recordId:"attempt-190",runId:"run-190",planHash:"plan-190",
      source:"dt",provider:"openai",status:"provided",displayedAt:11,
      text:"목표와 명령의 차이는 10mm입니다. 기준점 해석을 추가로 확인하세요."}],
    frame:{source:"dt",coordinateSystem:"paper-mm",samples:[{point:"O",pose:{x:190,y:-60,z:80,r:0}}]},
    run:{id:"run-190",planHash:"plan-190",frameId:"frame-190",source:"dt",status:"completed",
      verificationCriteria:{positionToleranceMm:2,rationale:"실행 전 2mm 허용오차"},
      commands:[{point:"P1",pose:{x:200,y:-30,z:80,r:0}}],
      observations:[{point:"P1",pose:{x:200,y:-30,z:80,r:0},source:"dt",measuredAt:12}]},
  };
  const context={task:"paper-coordinate",condition:JSON.stringify({taskVersion:"paper-v4",frame:{samples:Array(20).fill(parent.frame.samples[0])}}),
    answers:JSON.stringify({savedStudentTransform:{originX:"180",originY:"-60",explanation:"현재 시도 X=180"},revisionReason:"10mm 차이를 근거로 원점을 수정"}),
    reason:"학생 설명: 원점 X=180",initialPrediction:JSON.stringify({originX:"180",targets:Array(12).fill({name:"P1",xCm:2,yCm:3})}),
    history:JSON.stringify([parent]),judgment:JSON.stringify({toleranceMm:2,details:"세부".repeat(2000)}),
    execution:JSON.stringify(Array(20).fill({source:"dt",status:"completed",observations:Array(10).fill(parent.run.observations[0])})),
    support:"guided",attempts:2,question:"기준점을 어떻게 확인했나요?",conversation:Array(8).fill({role:"tutor",text:"이전 질문".repeat(300)})};
  const safe=sanitizeFeedbackContext(context);
  const boundedHistory=feedbackHistoryEnvelope(safe,[],[]);
  const history=JSON.parse(boundedHistory),prior=JSON.parse(history.attempts);
  assert.equal(prior.length,1);
  assert.equal(prior[0].transform.originX,"190");
  assert.match(prior[0].modelDecisionReason,/10mm/);
  assert.match(prior[0].followupObservation.text,/기준점/);
  assert.match(prior[0].revisionReason,/180/);
  assert.match(prior[0].previouslyDisplayedFeedback[0].text,/10mm/);
  assert.equal(prior[0].run.verificationCriteria.positionToleranceMm,2);
  const request=fitFeedbackRequestBudget({...safe,history:boundedHistory});
  assert.ok(Buffer.byteLength(JSON.stringify(request),"utf8")<30000);
  assert.match(request.answers,/180/);
  assert.equal(JSON.parse(request.execution).contextNote!==undefined,true);
  for(const key of ["condition","answers","initialPrediction","history","judgment","execution"])
    assert.doesNotThrow(()=>JSON.parse(request[key]),`${key} remains valid JSON`);
  assert.ok(request.condition.length<=6000);
  assert.ok(request.answers.length<=3000);
  assert.ok(request.initialPrediction.length<=3000);
  assert.ok(request.history.length<=6000);
  assert.ok(request.judgment.length<=2000);
  assert.ok(request.execution.length<=10000);
  assert.doesNotMatch(JSON.stringify(request),/연동검수|student-id-private/);
});
test("HTTP request failures are not mislabeled as network outages",()=>{
  assert.equal(feedbackFailureFromTransport(false,false),"network_error");
  assert.equal(feedbackFailureFromTransport(true,false),"timeout");
  assert.equal(feedbackFailureFromTransport(false,true,400),"invalid_request");
  assert.equal(feedbackFailureFromTransport(false,true,422),"invalid_request");
  assert.equal(feedbackFailureFromTransport(false,true,503),"invalid_response");
});
