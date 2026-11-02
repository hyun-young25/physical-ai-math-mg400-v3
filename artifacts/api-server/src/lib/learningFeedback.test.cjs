const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),ts=require("typescript");
const exports_={};
new Function("exports",ts.transpileModule(fs.readFileSync(__dirname+"/learningFeedback.ts","utf8"),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText)(exports_);
const {generateFeedback,basicFeedback,createFeedbackBudget,sanitizeFeedbackContext,FEEDBACK_INSTRUCTIONS}=exports_;
const context=(patch={})=>({task:"foundation",condition:'{"id":"height-practice","current":20,"target":60}',
  answers:'{"deltaZ":"60"}',reason:"목표 높이를 이동량으로 적었다",initialPrediction:'{"deltaZ":"60"}',
  history:"[]",judgment:'{"deltaZ":"incorrect"}',execution:"[]",support:"guided",trigger:"submit",attempts:0,...patch});
test("explicit basic helper explains concepts independently of unavailable GPT",async()=>{
  const explain=async c=>({text:basicFeedback(c)});
  const c=context({reason:"",question:"왜 2로 나누나요?",trigger:"hint",conversation:[]});
  const first=await explain(c);
  assert.match(first.text,/두 부분/);assert.doesNotMatch(first.text,/어떤 식이나 기준/);
  const second=await explain({...c,question:"한 단계 더 자세히 설명해 주세요",conversation:[{role:"tutor",text:first.text,source:"rules"}]});
  assert.match(second.text,/역산/);assert.notEqual(second.text,first.text);
  const third=await explain({...c,question:"한 단계 더 자세히 설명해 주세요",conversation:[{role:"tutor",text:second.text,source:"rules"}]});
  assert.notEqual(third.text,second.text);assert.match(third.text,/내 입력/);
  const coordinate=await explain({...c,question:"목표와 변화량은 왜 다르죠?"});
  assert.match(coordinate.text,/원점.*출발점/);
  assert.match(FEEDBACK_INSTRUCTIONS,/그대로 반복하지/);
});
test("missing key uses a clearly labelled rule hint without a network call or exposing the numeric answer",async()=>{
  const r=await generateFeedback(context(),{key:"",fetcher:()=>{throw Error("must not call");}});
  assert.equal(r.provider,"rules");assert.equal(r.status,"unconfigured");
  assert.match(r.text,/GPT 연결/);assert.equal(r.failureReason,"not_configured");assert.equal(r.providerAttempted,false);
  assert.doesNotMatch(r.text,/어떤 식이나 기준|40/);
});
test("empty reason asks a question and challenge has less support",()=>{
  assert.match(basicFeedback(context({reason:""})),/어떤 식이나 기준/);
  assert.ok(basicFeedback(context({support:"challenge"})).length<basicFeedback(context()).length);
  assert.match(basicFeedback(context({attempts:3})),/①.*②/);
});
test("follow-up question and delivered conversation reach model as untrusted redacted data",async()=>{
  let body;
  const result=await generateFeedback(context({question:"test@example.com 왜 틀렸나요?",
    conversation:[{role:"student",text:"010-1234-5678 질문"},{role:"tutor",text:"목표와 변화량을 비교하세요.",source:"rules"}]}),{
    key:"test-only",fetcher:async(_url,opts)=>{body=JSON.parse(opts.body);return {ok:true,json:async()=>({choices:[{message:{content:"목표와 변화량의 기준은 어떻게 다른가요?"}}]})};},
  });
  const sent=JSON.parse(body.messages[1].content);
  assert.equal(result.provider,"openai");assert.match(sent.question,/왜 틀렸/);
  assert.doesNotMatch(body.messages[1].content,/test@example.com|010-1234-5678/);
  assert.equal(sent.conversation[1].source,"rules");
  assert.match(FEEDBACK_INSTRUCTIONS,/question.*conversation/);
});
test("comparison without measurements and ungraded why-wrong never invent evidence or verdict",()=>{
  assert.match(basicFeedback(context({question:"예상과 실제 결과를 비교해 주세요",
    execution:'{"source":"virtual","measurement":false,"results":[]}'})),/아직.*없습니다/);
  assert.match(basicFeedback(context({question:"왜 틀렸나요?",judgment:'{"status":"미확정"}'})),/오답으로 확인된 판정이 없습니다/);
  assert.match(basicFeedback(context({judgment:'{"status":"correct"}'})),/기존.*실행 버튼/);
});
test("OpenAI success has bounded text and advisory-only request; no visit, tools, grade changes, or commands",async()=>{
  let body;
  const result=await generateFeedback(context(),{key:"test-only",fetcher:async(url,options)=>{
    assert.equal(url,"https://api.openai.com/v1/chat/completions");body=JSON.parse(options.body);
    return {ok:true,json:async()=>({choices:[{message:{content:"목표 높이와 변화량은 같은 뜻인가요?"}}]})};
  }});
  assert.equal(result.provider,"openai");assert.equal(result.status,"provided");
  assert.equal(body.model,"gpt-5-mini");assert.equal(body.max_completion_tokens,1200);
  assert.equal(body.tools,undefined);assert.equal(body.messages.length,2);
  assert.doesNotMatch(body.messages[1].content,/visitId|accountId/);
  assert.deepEqual(Object.keys(result).sort(),["createdAt","httpStatus","provider","providerAttempted","status","text"]);
  for(const text of ["판정","오래된","물체","challenge","확인된 사실"])assert.ok(FEEDBACK_INSTRUCTIONS.includes(text));
});
for(const [status,expected] of [[429,"limited"],[401,"unavailable"],[500,"unavailable"]])
test(`provider HTTP ${status} safely falls back`,async()=>{
  const r=await generateFeedback(context(),{key:"test-only",fetcher:async()=>({ok:false,status,json:async()=>({error:{code:"rate_limit_exceeded"}})})});
  assert.equal(r.provider,"rules");assert.equal(r.status,expected);
});
test("timeout and transport failures safely fall back",async()=>{
  const fetcher=(_url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener("abort",()=>reject(Error("timeout"))));
  assert.equal((await generateFeedback(context(),{key:"test-only",fetcher,timeoutMs:5})).status,"timeout");
  assert.equal((await generateFeedback(context(),{key:"test-only",fetcher:async()=>{throw Error("network");}})).status,"unavailable");
});
test("quota, rate limiting and credentials remain distinct without exposing provider messages",async()=>{
  for(const [status,error,failureReason] of [
    [429,{type:"insufficient_quota",message:"private provider message"},"provider_quota"],
    [429,{code:"rate_limit_exceeded"},"provider_rate_limit"],
    [401,{code:"invalid_api_key",message:"secret credentials"},"invalid_credentials"],
    [403,{},"provider_permission"],[500,{},"provider_error"],
  ]){
    let calls=0;
    const r=await generateFeedback(context(),{key:"test-only",fetcher:async()=>{
      calls++;return new Response(JSON.stringify({error}),{status});
    }});
    assert.equal(calls,1);assert.equal(r.failureReason,failureReason);
    assert.equal(r.providerAttempted,true);assert.equal(r.httpStatus,status);
    assert.equal(r.provider,"rules");assert.notEqual(r.status,"provided");
    assert(!/private provider|secret credentials|어떤 식이나 기준/.test(JSON.stringify(r)));
  }
  const r=await generateFeedback(context(),{key:"test-only",fetcher:async()=>{throw Error("private transport");}});
  assert.equal(r.failureReason,"network_error");assert.doesNotMatch(JSON.stringify(r),/private transport/);
});
test("short value checks, hints, solutions and follow-ups send current evidence and unchanged spend parameters",async()=>{
  for(const question of ["이 값이 맞아?","힌트만 주세요","풀이 과정을 설명해 주세요","방금 풀이에서 왜 빼나요?"]){
    let sent;
    const r=await generateFeedback(context({question,reason:"",conversation:[{role:"tutor",text:"이미 제공한 힌트",source:"rules"}]}),{
      key:"test-only",fetcher:async(_url,options)=>{
        sent=JSON.parse(options.body);
        return new Response(JSON.stringify({choices:[{message:{content:`모의 API 답변: ${question}`}}]}),{status:200});
      }});
    const data=JSON.parse(sent.messages[1].content);
    assert.equal(data.question,question);assert.equal(data.reason,"");
    assert.deepEqual(JSON.parse(data.answers),{deltaZ:"60"});
    assert.equal(data.conversation[0].text,"이미 제공한 힌트");assert(data.condition&&data.judgment&&data.initialPrediction&&data.history);
    assert.equal(r.provider,"openai");assert.equal(r.providerAttempted,true);assert.equal(r.httpStatus,200);
    assert.equal(sent.model,"gpt-5-mini");assert.equal(sent.max_completion_tokens,1200);
  }
  assert.match(FEEDBACK_INSTRUCTIONS,/이미 전달된 값/);assert.match(FEEDBACK_INSTRUCTIONS,/현재 문항에 한해/);
});
test("application denial reasons expose existing limits without raising them",()=>{
  const b=createFeedbackBudget(()=>0),held=Array.from({length:4},(_,i)=>b.acquire("p"+i,"v"+i));
  assert.equal(b.acquire("extra","extra"),null);assert.equal(b.denialReason(),"app_concurrency");
  held.forEach(release=>release());
  const visit=createFeedbackBudget(()=>0);
  for(let i=0;i<120;i++)visit.acquire("p"+i,"same")();
  assert.equal(visit.acquire("new","same"),null);assert.equal(visit.denialReason(),"app_visit_limit");
  const global=createFeedbackBudget(()=>0);
  for(let i=0;i<2000;i++)global.acquire("p"+i,"v"+i)();
  assert.equal(global.acquire("new","new"),null);assert.equal(global.denialReason(),"app_global_limit");
});
test("empty or excessive provider output uses rules instead",async()=>{
  for(const content of ["","a".repeat(701),null]) {
    const r=await generateFeedback(context(),{key:"test-only",fetcher:async()=>({ok:true,json:async()=>({choices:[{message:{content}}]})})});
    assert.equal(r.provider,"rules");
  }
});
test("result fallback never asserts movement, physical causes or grasp success",()=>{
  for(const source of ["virtual","mock","hardware"]) {
    const r=basicFeedback(context({trigger:"result",execution:JSON.stringify([{source,status:"unavailable",measurements:[]}])}));
    assert.match(r,/수학 오답도 아닙니다/);assert.match(r,/집기 성공은 알 수 없/);
  }
});
test("privacy drops identity and network metadata while retaining units, source and measurement times",()=>{
  const c=sanitizeFeedbackContext(context({condition:JSON.stringify({name:"PRIVATE_NAME",login:"PRIVATE_LOGIN",target:60}),
    reason:"이름: 홍길동, 풀이 test@example.com 010-1234-5678",
    execution:JSON.stringify([{source:"mock",ip:"192.168.1.6",measuredAt:123,ageMs:10,units:"mm"}])}));
  assert.doesNotMatch(JSON.stringify(c),/PRIVATE|example.com|010-1234|192.168/);
  assert.match(c.execution,/measuredAt|ageMs|units|mock/);
});
test("actual model request redacts identifiers but retains paper math and displayed linked feedback",async()=>{
  let body;
  const paper=context({task:"paper-coordinate",trigger:"hint",question:"이번 풀이와 앞 시도 피드백을 비교해 주세요",
    condition:JSON.stringify({name:"민감한 이름",studentId:"STU-2026-77",visitId:"VISIT-SECRET",
      targetPaperCm:[{name:"A",xCm:3,yCm:2}],units:{paper:"cm",robot:"mm"},
       frame:{coordinateSystem:"User 0 / Tool 0",samples:[{point:"O",pose:{x:180,y:-60,z:80,r:0}}]},
       verificationCriteria:{positionToleranceMm:2,rotationToleranceDeg:2,rationale:"독립 확인점은 2 mm 이내"}}),
    answers:JSON.stringify({savedStudentTransform:{originX:"180",originY:"-60",axisDirection:"y-",
      millimetersPerCentimeter:"10",rotationDegrees:"0",explanation:"이름: 김가을, X=원점X+10×종이x"},
      studentHypothesis:"학번: QA-12345; 축 방향을 다시 검토함",
       revisionReason:"연락처: 010-1234-5678; 1 cm는 10 mm",
       followupObservation:{text:"종이 눈금의 3.2 cm를 다시 읽음"},modelDecision:"revise",modelDecisionReason:"잉크와 TCP 차이"}),
    reason:"이메일 qa-person@example.com; 기준점 O와 X축을 다시 확인함",
    initialPrediction:JSON.stringify({points:[{name:"A",robotX:210,robotY:-40}]}),
    history:JSON.stringify([{taskVersion:"v4-paper-merged",attempt:1,studentId:"OTHER-STUDENT",
      previouslyDisplayedFeedback:[{mode:"gpt",provider:"rules",status:"limited",
        text:"시험용 대체 안내: 원점X+10×x를 확인하세요."}],
      revisionReason:"원점 좌표를 식에 다시 반영",run:{source:"dt",status:"completed"}}]),
    judgment:JSON.stringify({method:"rule-based",candidate:"원점 후보",pattern:"translation"}),
     execution:JSON.stringify([{recordId:"attempt-current",runId:"hardware-run",source:"hardware",status:"completed",
       verificationCriteria:{positionToleranceMm:2,rotationToleranceDeg:2,rationale:"독립 확인점"},
       observations:[{point:"A",kind:"controller-tcp",pose:{x:210,y:-40},measuredAt:1234}],
       inkReadings:[{recordId:"attempt-current",runId:"hardware-run",frameId:"frame-1",point:"A",unit:"cm",
         source:"student-manual-ink",status:"measured",xCm:3.2,yCm:2.1,rawX:"3.20",rawY:"2.10",recordedAt:1235}],
       inkComparisons:[{point:"A",targetVsInkMm:{dx:2,dy:1,distance:2.24},controllerReportedVsInkMm:{dx:1,dy:2,distance:2.24}}],
       sameAttemptEarlierRuns:[{recordId:"attempt-current",runId:"dt-prerequisite",source:"dt",status:"completed"}]}])});
  await generateFeedback(paper,{key:"test-only",fetcher:async(_url,options)=>{
    body=JSON.parse(options.body);
    return {ok:true,status:200,json:async()=>({choices:[{message:{content:"모의 API 응답"}}]})};
  }});
  const sent=JSON.parse(body.messages[1].content),condition=JSON.parse(sent.condition),answers=JSON.parse(sent.answers);
  const history=JSON.parse(sent.history);
  const serialized=body.messages[1].content;
  assert.doesNotMatch(serialized,/민감한 이름|김가을|STU-2026-77|VISIT-SECRET|QA-12345|010-1234-5678|qa-person@example.com|OTHER-STUDENT/);
  assert.equal(condition.targetPaperCm[0].name,"A");
  assert.deepEqual([condition.targetPaperCm[0].xCm,condition.targetPaperCm[0].yCm],[3,2]);
  assert.equal(condition.units.robot,"mm");
  assert.equal(condition.frame.coordinateSystem,"User 0 / Tool 0");
  assert.equal(answers.savedStudentTransform.axisDirection,"y-");
  assert.equal(answers.savedStudentTransform.millimetersPerCentimeter,"10");
  assert.match(answers.savedStudentTransform.explanation,/X=원점X\+10×종이x/);
  assert.match(answers.studentHypothesis,/축 방향을 다시 검토함/);
  assert.match(answers.revisionReason,/1 cm는 10 mm/);
  assert.match(answers.followupObservation.text,/3\.2 cm/);
  assert.equal(answers.modelDecision,"revise");
  assert.match(answers.modelDecisionReason,/잉크와 TCP 차이/);
  assert.match(sent.execution,/student-manual-ink/);
  assert.match(sent.execution,/targetVsInkMm/);
  assert.match(sent.execution,/sameAttemptEarlierRuns/);
  assert.match(sent.execution,/positionToleranceMm/);
  assert.equal(history[0].previouslyDisplayedFeedback[0].text,"시험용 대체 안내: 원점X+10×x를 확인하세요.");
  assert.equal(history[0].revisionReason,"원점 좌표를 식에 다시 반영");
  assert.equal(history[0].run.source,"dt");
});
test("the model payload preserves the current hardware observation separately from its command",async()=>{
  let body;
  const hardware=context({task:"paper-coordinate",trigger:"hint",
    condition:JSON.stringify({recordId:"attempt-current",runId:"hardware-run-current",source:"hardware",
      targetPaperCm:[{name:"D",xCm:2,yCm:3}],units:{paper:"cm",robot:"mm"}}),
    answers:JSON.stringify({transform:{explanation:"X=원점X+10×x"},revisionReason:"축 식을 다시 확인"}),
    reason:"학생 설명: 축 방향을 다시 검토함",
    history:JSON.stringify([{recordId:"attempt-before",runId:"hardware-run-before",
      previouslyDisplayedFeedback:[{text:"이전 시도의 질문"}],revisionReason:"이전 수정 이유",
      run:{source:"hardware",status:"completed",observations:[{pose:{x:999,y:888}}]}}]),
    execution:JSON.stringify([{recordId:"attempt-current",runId:"hardware-run-current",planHash:"plan-current",
      source:"hardware",status:"completed",commands:[{point:"D",pose:{x:120,y:230,z:50,r:0}}],
      observations:[{point:"D",kind:"controller-tcp",source:"hardware",seq:44,measuredAt:1234,ageMs:12,
        command:{x:120,y:230,z:50,r:0},pose:{x:121,y:229,z:50,r:0}}],
      comparisons:[{point:"D",commandVsReportedMm:{dx:1,dy:-1,distance:Math.sqrt(2)}}]}])});
  const result=await generateFeedback(hardware,{key:"test-only",fetcher:async(_url,options)=>{
    body=JSON.parse(options.body);
    return new Response(JSON.stringify({choices:[{message:{content:"모의 API 응답"}}]}),{status:200});
  }});
  const sent=JSON.parse(body.messages[1].content);
  assert.equal(result.provider,"openai");
  assert.equal(result.providerAttempted,true);
  assert.match(sent.execution,/"runId":"hardware-run-current"/);
  assert.match(sent.execution,/"source":"hardware"/);
  assert.match(sent.execution,/"x":121/);
  assert.match(sent.execution,/commandVsReportedMm/);
  assert.doesNotMatch(sent.execution,/999|888|hardware-run-before/);
  assert.match(sent.history,/이전 시도의 질문/);
  assert.match(sent.answers,/축 식을 다시 확인/);
});
test("public budget bounds concurrency, IP, visit and global calls; releases are idempotent",()=>{
  let time=100;const budget=createFeedbackBudget(()=>time),releases=[];
  for(let i=0;i<4;i++)releases.push(budget.acquire("ip","visit"));
  assert.equal(budget.acquire("ip","visit"),null);releases.forEach(f=>{f();f();});
  for(let i=4;i<30;i++)budget.acquire("ip","visit")();
  assert.equal(budget.acquire("ip","visit"),null);
  time+=60001;assert.equal(typeof budget.acquire("ip","visit"),"function");
});
