const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),ts=require("typescript");
function load(file,deps={}){const e={};new Function("exports","require",ts.transpileModule(fs.readFileSync(__dirname+"/"+file,"utf8"),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},
}).outputText)(e,n=>{assert.ok(n in deps,n);return deps[n];});return e;}
const ctx=load("learningAiContext.ts");
const tutorFollowUp=load("tutorFollowUp.ts",{"./learningAiContext":ctx});
const trial=load("trialTutorFeedback.ts",{"./learningAiContext":ctx,"./tutorFollowUp":tutorFollowUp});
const initial=()=>({task:"foundation",condition:'{"id":"height-practice"}',answers:'{"z":60}',reason:"목표와 변화량",initialPrediction:'{"z":60}',
  history:"[]",judgment:"미확정",execution:"[]",support:"guided",attempts:0});
function mount(startMode="gpt") {
  let mode=startMode;
  const slots=[],effects=[],rows=new Map();let cursor=0,dirty=false,input=initial(),edit="",result;
  const useEffect=(fn,deps)=>{const i=cursor++,old=slots[i];if(!old||deps.some((d,k)=>d!==old.deps[k]))effects.push(()=>{
    old?.cleanup?.();slots[i]={deps,cleanup:fn()};});};
  const react={
    useRef(v){const i=cursor++;return slots[i]??(slots[i]={current:v});},
    useState(v){const i=cursor++;slots[i]??={value:v};return [slots[i].value,x=>{slots[i].value=typeof x==="function"?x(slots[i].value):x;dirty=true;}];},
    useEffect,
  };
  let calls=0,resolve;
  global.fetch=()=>{calls++;return new Promise(r=>{resolve=r;});};
  const {useLearningAi}=load("LearningAiFeedback.tsx",{
    react,"react/jsx-runtime":{},"./learningAiContext":ctx,
    "./squareComparisonVisual":{squareEvidenceTag:()=>undefined},
    "./tutorMode":{useTutorMode:()=>mode},
    "./trialTutorFeedback":trial,
    "./useSubmissionFeedback":()=>({submit(){},providedMessages:()=>[],messages:[],storageFailed:false,
      unread:false,preview:undefined,acknowledge:()=>false}),
    "./tutorRegistry":{registerTutor:()=>()=>{}},
    "./learningClient":{getLearningUser:()=>({visitId:"test-visit"})},
    "./learningFramework":{learningRecordContext:()=>({source:"math"})},
    "./learningEvidenceStorage":{readEvidence:()=>structuredClone([...rows.values()]),
      writeEvidence:(_key,items)=>{items.forEach(x=>rows.set(x.id,structuredClone(x)));return true;}},
  });
  function render(next=input,nextEdit=edit){input=next;edit=nextEdit;let count=0;do{dirty=false;cursor=0;result=useLearningAi(input,edit);while(effects.length)effects.shift()();assert.ok(++count<15);}while(dirty);return result;}
  render();
  return {render,get ai(){return result;},get calls(){return calls;},rows,setMode(next){mode=next;return render();},
    resolve(text="시험용 AI 피드백"){resolve({ok:true,json:async()=>({text,provider:"openai",status:"provided",createdAt:"2026-10-19T00:00:00Z"})});},
    unmount(){for(const x of slots)x?.cleanup?.();}};
}
test("typing never calls the API and synchronous double request sends only one",async()=>{
  const h=mount();h.render({...initial(),reason:"입력 중"});assert.equal(h.calls,0);
  const pending=h.ai.request("hint");const duplicate=h.ai.request("hint");h.render();
  assert.equal(h.ai.pending,true);assert.equal(h.calls,1);h.resolve();await pending;await duplicate;h.render();
  assert.equal(h.ai.feedback.provider,"openai");assert.equal(h.rows.size,0);
  h.ai.acknowledge();h.render();assert.equal([...h.rows.values()][0].feedbackStatus,"displayed");
});
test("trial responds to real input and follow-up without API or durable learning records",async()=>{
  const h=mount("trial");
  await h.ai.ask("힌트만 주세요");h.render();
  assert.equal(h.ai.feedbackQuestion,"힌트만 주세요");
  const first=h.ai.messages.at(-1).text;
  assert.equal(h.calls,0);assert.equal(h.ai.feedback.provider,"rules");
  h.ai.acknowledge();h.render();assert.equal(h.rows.size,0);
  h.render({...initial(),answers:'{"z":55}',support:"challenge",judgment:'{"status":"incorrect"}'});
  await h.ai.ask("왜 틀렸나요?");h.render();h.ai.acknowledge();h.render();
  assert.match(h.ai.messages.at(-1).text,/55/);
  assert.match(h.ai.messages.at(-1).text,/도전 모드/);
  assert.notEqual(first,h.ai.messages.at(-1).text);
  assert.equal(h.rows.size,0);assert.equal(h.calls,0);
  h.render({...initial(),condition:'{"id":"another"}'});
  assert.equal(h.ai.messages.length,0);
  h.unmount();
});
test("square AI conversations are isolated by the actual attempt and run",()=>{
  const first={...initial(),task:"square",condition:'{"id":"rectangle"}',
    execution:JSON.stringify([{recordId:"attempt-a",runId:"run-1",planKey:"plan-1"}])};
  const second={...first,execution:JSON.stringify([{recordId:"attempt-a",runId:"run-2",planKey:"plan-2"}])};
  assert.notEqual(ctx.feedbackProblemKey(first),ctx.feedbackProblemKey(second));
});
test("mode switch discards pending GPT reply and isolates trial conversation from GPT history",async()=>{
  const h=mount(),pending=h.ai.ask("옛 GPT 질문");
  h.render();h.setMode("trial");h.resolve("폐기될 GPT 응답");await pending;h.render();
  assert.equal(h.ai.messages.length,0);assert.equal(h.rows.size,0);
  await h.ai.ask("힌트만 주세요");h.render();h.ai.acknowledge();h.render();
  assert.equal(h.ai.messages.length,2);
  h.setMode("gpt");assert.equal(h.ai.messages.length,0);
  const inputs=[];
  global.fetch=async(_url,opts)=>{inputs.push(JSON.parse(opts.body));return {ok:true,json:async()=>({provider:"openai",status:"provided",text:"시험 응답",createdAt:"now"})};};
  await h.ai.ask("다음 힌트");h.render();assert.deepEqual(inputs[0].conversation,[]);
  assert.equal(h.rows.size,0);
});
test("late reply after an answer, task, or reason change never labels the new answer",async()=>{
  for(const patch of [{answers:"다른 수치"},{condition:'{"id":"another"}'},{reason:"새 풀이"}]) {
    const h=mount(),pending=h.ai.request("submit");h.render({...initial(),...patch});h.resolve("옛 답안의 응답");await pending;h.render();
    assert.equal(h.ai.feedback,undefined);assert.equal(h.ai.pending,false);
    assert.equal(h.rows.size,0);
  }
});
test("unmount discards the request without recording a question or invented delivered hint",async()=>{
  const h=mount(),pending=h.ai.request("result");h.unmount();h.resolve();await pending;
  assert.equal(h.rows.size,0);
});
test("editing an unsaved result review also invalidates a pending reply",async()=>{
  const h=mount(),pending=h.ai.request("result");
  h.render(initial(),"수정 수치·근거 입력 중");h.resolve();await pending;h.render();
  assert.equal(h.ai.feedback,undefined);assert.equal(h.rows.size,0);
});
test("a failure offers clearly labelled local guidance and retry replaces it with AI",async()=>{
  const h=mount();global.fetch=async()=>{throw Error("test outage");};
  await h.ai.request("hint");h.render();assert.equal(h.ai.feedback.provider,"rules");assert.equal(h.ai.feedback.status,"unavailable");
  h.ai.acknowledge();h.render();
  global.fetch=async()=>({ok:true,json:async()=>({provider:"openai",status:"provided",text:"재시도 시험 응답",createdAt:"now"})});
  await h.ai.request("retry");h.render();assert.equal(h.ai.feedback.provider,"openai");
  h.ai.acknowledge();h.render();
  assert.equal(h.rows.size,2);assert.equal([...h.rows.values()].filter(x=>x.feedbackStatus==="displayed").length,2);
});
test("follow-up includes only delivered same-problem dialogue and retry keeps the question",async()=>{
  const h=mount(),inputs=[];
  global.fetch=async(_url,opts)=>{inputs.push(JSON.parse(opts.body));return {ok:true,json:async()=>({provider:"rules",status:"limited",text:"첫 기본 힌트",createdAt:"now"})};};
  await h.ai.ask("힌트만 주세요");h.render();assert.equal(h.rows.size,0);
  h.ai.acknowledge();h.render();
  await h.ai.ask("왜 목표 높이와 다른가요?");h.render();
  assert.deepEqual(inputs[1].conversation.map(t=>t.role),["student","tutor"]);
  assert.equal(inputs[1].conversation[1].source,"rules");
  h.ai.acknowledge();h.render();
  await h.ai.request("retry");h.render();
  assert.equal(inputs[2].question,"왜 목표 높이와 다른가요?");
  h.render({...initial(),condition:'{"id":"different-problem"}'});
  await h.ai.ask("힌트");h.render();assert.deepEqual(inputs.at(-1).conversation,[]);
  assert.equal(h.rows.size,2);
});
