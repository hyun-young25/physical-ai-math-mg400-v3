const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),ts=require("typescript");
const cache={};
function load(name){
  if(cache[name])return cache[name];
  const result=cache[name]={};
  new Function("exports","require",ts.transpileModule(fs.readFileSync(path.join(__dirname,name+".ts"),"utf8"),{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  }).outputText)(result,dep=>load(dep.replace("./","")));
  return result;
}
const {getShapeLesson,shapeLessonExpected}=load("shapeLearning");
const {diagnoseSquare,squareFeedbackPlan,squareFeedbackLevel,priorSquareDiagnoses,squarePlannedVertices}=load("squareMismatchDiagnosis");
const {submittedAssessment,automaticHint}=load("submissionFeedback");
const correct=lesson=>Object.fromEntries(Object.entries(shapeLessonExpected(lesson)).map(([k,v])=>[k,String(v)]));
// Lesson 2.1 (기초 1): P1(200,100), +X 100, −Y 200 → P2(300,100) P3(300,−100) P4(200,−100) close(200,100)
const lesson=getShapeLesson("사각형",0);
const withXY=(patch)=>({...correct(lesson),...Object.fromEntries(Object.entries(patch).map(([k,v])=>[k,String(v)]))});

test("2.1 correct plan is a match and gives no feedback",()=>{
  const d=diagnoseSquare(lesson,correct(lesson));
  assert.equal(d.type,"match");
  assert.equal(squareFeedbackPlan(d,0,"challenge"),null);
});

test("2.1 width/height swapped (video scene) is axis-swap at P1 → P2 with executed lengths",()=>{
  const d=diagnoseSquare(lesson,withXY({p2x:400,p2y:100,p3x:400,p3y:0,p4x:200,p4y:0,closeX:200,closeY:100}));
  assert.equal(d.type,"axis-swap");
  assert.equal(d.edge,"P1 → P2");
  assert.equal(d.evidence.executed.width,200);
  assert.equal(d.evidence.executed.height,100);
  const plan=squareFeedbackPlan(d,0,"guided");
  assert.equal(plan.level,"task");
  assert.match(plan.question,/X 방향 200 mm, Y 방향 100 mm/);
  assert.equal(plan.relationHint,undefined,"level 1 only asks what differs");
  assert(!/300|−100|-100/.test(plan.question),"never reveals the correct vertices");
});

test("direction sign error on P2 → P3",()=>{
  const d=diagnoseSquare(lesson,withXY({p3x:300,p3y:300,p4x:200,p4y:300}));
  assert.equal(d.type,"direction");
  assert.equal(d.edgeIndex,2);
  assert.match(squareFeedbackPlan(d,0,"guided").question,/Y가 커지는 쪽/);
});

test("displacement entered as a vertex",()=>{
  const d=diagnoseSquare(lesson,withXY({p2x:100,p2y:0}));
  assert.equal(d.type,"displacement-as-position");
  assert.match(squareFeedbackPlan(d,0,"guided").question,/도착할 위치.*이동한 양/);
});

test("closing point not returned to P1",()=>{
  const d=diagnoseSquare(lesson,withXY({closeX:200,closeY:-300}));
  assert.equal(d.type,"closure");
  assert.equal(d.edgeIndex,4);
});

test("other wrong length is arithmetic",()=>{
  const d=diagnoseSquare(lesson,withXY({p2x:310,p3x:310}));
  assert.equal(d.type,"arithmetic");
  assert.equal(d.edgeIndex,1);
});

test("unreachable DT target",()=>{
  const d=diagnoseSquare(lesson,correct(lesson),{rejected:{x:900,y:0}});
  assert.equal(d.type,"unreachable");
});

test("model–real gap only when the plan is correct and hardware deviates beyond 1 mm",()=>{
  const targets=[[200,100],[300,100],[300,-100],[200,-100],[200,100]];
  const small=targets.map(([x,y])=>({target:{x,y,z:0},actual:{x:x+0.01,y,z:0}}));
  assert.equal(diagnoseSquare(lesson,correct(lesson),{measurements:small}).type,"match");
  const offset=targets.map(([x,y])=>({target:{x,y,z:0},actual:{x:x+2,y:y+0.5,z:0}}));
  const d=diagnoseSquare(lesson,correct(lesson),{measurements:offset});
  assert.equal(d.type,"model-real");
  assert(Math.abs(d.evidence.measured.meanOffset.x-2)<1e-9);
  assert.match(squareFeedbackPlan(d,0,"guided").question,/평균 2\.06 mm/);
});

test("levels escalate with repeated same-type errors; challenge mode fades one step later",()=>{
  assert.deepEqual([0,1,2,3].map(n=>squareFeedbackLevel(n,"guided")),["task","process","worked","worked"]);
  assert.deepEqual([0,1,2,3].map(n=>squareFeedbackLevel(n,"challenge")),["task","task","process","worked"]);
  const d=diagnoseSquare(lesson,withXY({p3y:300,p4y:300}));
  const worked=squareFeedbackPlan(d,2,"guided");
  assert.equal(worked.teacherFlag,true);
  assert(worked.relationHint&&worked.example);
  assert.equal(squareFeedbackPlan(d,1,"guided").teacherFlag,false);
});

test("resolved after a mismatch asks a self-regulation question",()=>{
  const plan=squareFeedbackPlan(diagnoseSquare(lesson,correct(lesson)),0,"challenge","axis-swap");
  assert.equal(plan.level,"self-regulation");
  assert.match(plan.question,/관측과 과제 조건이 달랐던/); assert.doesNotMatch(plan.question,/때문|계산 오류/);
});

test("history counting re-derives diagnoses from same-plan DT observations only",()=>{
  const swap=withXY({p2x:400,p3x:400,p3y:0,p4y:0});
  const runFor=answers=>({action:"mission",status:"completed",detail:{
    planKey:"test-plan",observedVertices:squarePlannedVertices(lesson,answers),
  }});
  const history=[
    {id:"a",condition:{id:lesson.id},prediction:swap,runs:[runFor(swap)]},
    {id:"b",condition:{id:"square-v3-2"},prediction:swap,runs:[runFor(swap)]},
    {id:"c",condition:{id:lesson.id},prediction:swap,runs:[]},
    {id:"d",condition:{id:lesson.id},prediction:correct(lesson),runs:[runFor(correct(lesson))]},
  ];
  assert.deepEqual(priorSquareDiagnoses(history,lesson,"x"),["axis-swap","match"]);
  assert.deepEqual(priorSquareDiagnoses(history,lesson,"a"),["match"]);
});

test("incomplete plans are not diagnosed",()=>{
  assert.equal(squarePlannedVertices(lesson,{...correct(lesson),p3x:""}),null);
  assert.equal(diagnoseSquare(lesson,{...correct(lesson),p3x:""}),null);
});

test("automatic tutor text uses the diagnosis question instead of the answer list",()=>{
  const d=diagnoseSquare(lesson,withXY({p2x:400,p3x:400,p3y:0,p4y:0}));
  const plan=squareFeedbackPlan(d,1,"guided");
  const judgment={status:"incorrect",errorCount:3,fields:[{key:"p2x",label:"P2의 X",value:"400",matched:false,feedback:"x"}],
    diagnosis:{type:d.type,label:d.label,level:plan.level,levelLabel:plan.levelLabel,question:plan.question,relationHint:plan.relationHint}};
  const context={task:"square",condition:JSON.stringify({instruction:"조건"}),answers:"{}",judgment:JSON.stringify(judgment)};
  const text=automaticHint(context,submittedAssessment(context),1,1);
  assert.match(text,/실행 결과 비교 · 관계 확인/);
  assert(text.includes(plan.question));
  assert(text.includes(plan.relationHint));
  assert(!text.includes("내 입력 「400」"));
});

test("challenge-mode square hints describe the existing gated one-time wrong-plan comparison",()=>{
  const context={task:"square",support:"challenge",condition:JSON.stringify({instruction:"가로 100 mm"}),
    answers:'{"p2x":"330"}',judgment:'{"errorCount":1}'};
  const assessment={correct:false,errors:[{key:"p2x",label:"P2 X",value:"330"}],keys:["p2x"]};
  const text=automaticHint(context,assessment,1,1);
  assert.match(text,/오답 예측도 1회 비교 실행/);
  assert.match(text,/사람의 최종 승인/);
  assert.doesNotMatch(text,/오답 상태에서는 실제 로봇을 실행할 수 없어요/);
});
