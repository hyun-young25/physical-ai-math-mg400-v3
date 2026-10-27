const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),ts=require("typescript");
function load(file,deps={}) {
  const exports={};
  new Function("exports","require",ts.transpileModule(fs.readFileSync(__dirname+"/"+file,"utf8"),{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  }).outputText)(exports,name=>deps[name]);
  return exports;
}
const ctx=load("learningAiContext.ts");
const {trialTutorFeedback:feedback}=load("trialTutorFeedback.ts",{"./learningAiContext":ctx});
const initial=()=>ctx.makeFeedbackContext({task:"foundation",
  condition:{id:"height-practice",reasoning:{kind:"difference",start:20,target:60},support:"guided"},
  fields:[{key:"deltaZ",label:"Z 변화량",unit:"mm"}],answers:{deltaZ:"60"},reason:"목표 높이와 같은 값",record:null,history:[],
  judgment:{status:"incorrect",key:"deltaZ"}});
test("uses current values, existing judgment, height conditions and support rather than fixed playback",()=>{
  const c=initial(),a=feedback(c);
  assert.match(a,/60mm/);assert.match(a,/출발 높이 20mm/);assert.match(a,/기존 판정: 오답/);
  const b=feedback({...c,answers:'{"deltaZ":"55"}',support:"challenge",attempts:3,conversation:[{role:"student",text:"더 설명"}]});
  assert.match(b,/55mm/);assert.match(b,/도전 모드/);assert.match(b,/시도 3회/);assert.match(b,/앞 힌트/);
  assert.notEqual(a,b);assert.match(a,/목표 위치 − 현재 위치/);assert.doesNotMatch(b,/목표 위치 − 현재 위치/);
});
test("never independently grades edited answers and does not invent answers to unrelated questions",()=>{
  const c=initial();
  assert.match(feedback({...c,answers:'{"deltaZ":"40"}',judgment:'{"status":"미確定"}',question:"왜 틀렸나요?"}),/오답 판정이 없습니다/);
  const unknown=feedback({...c,question:"내일 주식 가격을 알려줘"});
  assert.match(unknown,/현재 과제/);assert.match(unknown,/만들어 내지/);
  assert.match(feedback({...c,judgment:'{"status":"correct"}'}),/기존 실행 버튼/);
});
test("recognizes the actual foundation stage fieldStatuses without calculating a new grade",()=>{
  const c=initial();
  const text=feedback({...c,judgment:JSON.stringify({fieldStatuses:{deltaZ:"incorrect"},mathematicalStatus:"현재 단계 다시 확인"}),question:"왜 틀렸나요?"});
  assert.match(text,/기존 판정: 오답/);assert.match(text,/Z 변화량/);
  assert.match(feedback({...c,judgment:'{"fieldStatuses":{"deltaZ":"correct"}}'}),/확인된 항목 정답/);
});
test("compares only supplied virtual evidence with immutable first prediction and current answer",()=>{
  const c=initial();
  const first=c.initialPrediction;
  const text=feedback({...c,answers:'{"deltaZ":"40"}',execution:JSON.stringify([
    {status:"completed",summary:"가상 Z=20에서 60으로 이동",details:{motion:{source:"virtual",before:{z:20},after:{z:60}}}},
  ])},true);
  assert.match(text,/출처: 가상/);assert.match(text,/최초 예측/);assert.match(text,/60/);assert.match(text,/40/);
  assert.match(text,/전 위치/);assert.match(text,/후 위치/);
  assert.equal(c.initialPrediction,first);
  assert.match(feedback(c,true),/실행 결과가 없습니다/);
  assert.match(feedback({...c,execution:'[{"status":"unavailable","summary":"미연결"}]'},true),/차단·미완료/);
  assert.match(feedback({...c,execution:'[{"status":"stopped"}]'},true),/취소·중단/);
});
test("judgment, attempts and support changes invalidate pending context",()=>{
  const c=initial();
  for(const patch of [{judgment:'{"status":"correct"}'},{attempts:2},{support:"challenge"}])
    assert.notEqual(ctx.feedbackVersion(c),ctx.feedbackVersion({...c,...patch}));
});
