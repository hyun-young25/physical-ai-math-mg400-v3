const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),ts=require("typescript");
const exports_={};new Function("exports",ts.transpileModule(fs.readFileSync(__dirname+"/learningAiContext.ts","utf8"),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText)(exports_);
const {makeFeedbackContext,numericFeedbackContext,feedbackVersion,localFeedback}=exports_;
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
