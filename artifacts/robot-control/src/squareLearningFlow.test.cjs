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
const {getShapeLesson,shapeLessonExpected,shapeLessonMatchesTarget}=load("shapeLearning");
const {assessSquare,squareStudentSequence,squareExecutionKey,squareAnswersUnchanged,squareTutorJudgment,squarePlanMatchesTarget}=load("squareLearningFlow");
const {submittedAssessment,automaticHint}=load("submissionFeedback");
const answers=lesson=>Object.fromEntries(Object.entries(shapeLessonExpected(lesson)).map(([k,v])=>[k,String(v)]));

for(let i=0;i<6;i++)test(`square ${i+1}: entered XY, not hidden target, feeds plan; existing Z/R/commands preserved`,()=>{
  const lesson=getShapeLesson("사각형",i),draft=answers(lesson);
  assert(assessSquare(lesson,draft).every(row=>row.matched));
  draft.p2x=String(Number(draft.p2x)+0.05);
  assert(assessSquare(lesson,draft).every(row=>row.matched));
  const original=JSON.stringify(lesson),plan=squareStudentSequence(lesson,draft);
  assert.equal(plan[1].coords.x,Number(draft.p2x));
  assert.notEqual(plan[1].coords.x,lesson.targetSequence[1].coords.x);
  assert(shapeLessonMatchesTarget({...lesson,sequence:plan}));
  for(let n=0;n<plan.length;n++){
    assert.equal(plan[n].coords.z,lesson.sequence[n].coords.z);
    assert.equal(plan[n].coords.r,lesson.sequence[n].coords.r);
    assert.equal(plan[n].type,lesson.sequence[n].type);
  }
  assert.equal(JSON.stringify(lesson),original);
});
test("blank, missing, nonnumeric and infinite fields can never be correct or silently filled",()=>{
  const lesson=getShapeLesson("사각형",0),good=answers(lesson);
  for(const key of ["p2x","p2y","p3x","p3y","p4x","p4y","closeX","closeY"]){
    for(const invalid of [""," ","abc","NaN","Infinity","-Infinity",undefined]){
      const draft={...good,[key]:invalid};
      assert.equal(assessSquare(lesson,draft).find(row=>row.key===key).matched,false);
      assert.equal(squareStudentSequence(lesson,draft),null);
    }
  }
  assert.equal(assessSquare(lesson,{...good,squareAxis:""}).every(row=>row.matched),false);
});
test("0.1 tolerance retained; wrong challenge plan preserved and fails physical target test",()=>{
  const lesson=getShapeLesson("사각형",0),draft=answers(lesson);
  draft.p2x=String(Number(draft.p2x)+0.1);
  assert(assessSquare(lesson,draft).every(row=>row.matched));
  assert(squarePlanMatchesTarget(lesson,squareStudentSequence(lesson,draft)));
  draft.p2x=String(Number(draft.p2x)+0.001);
  assert(!assessSquare(lesson,draft).every(row=>row.matched));
  assert(!squarePlanMatchesTarget(lesson,squareStudentSequence(lesson,draft)));
  draft.p2x="280";
  const plan=squareStudentSequence(lesson,draft);
  assert.equal(plan[1].coords.x,280);
  assert.equal(shapeLessonMatchesTarget({...lesson,sequence:plan}),false);
  draft.closeY="90";
  assert.equal(squareStudentSequence(lesson,draft).at(-1).coords.y,90);
});
test("execution proof changes with submission, lesson, plan, Z/R or commands",()=>{
  const lesson=getShapeLesson("사각형",0),draft=answers(lesson),seq=squareStudentSequence(lesson,draft);
  const key=squareExecutionKey("condition","submission-1",seq);
  assert.notEqual(key,squareExecutionKey("condition","submission-2",seq));
  assert.notEqual(key,squareExecutionKey("other","submission-1",seq));
  for(const field of ["x","y","z","r"]){
    const changed=structuredClone(seq);changed[1].coords[field]+=0.01;
    assert.notEqual(key,squareExecutionKey("condition","submission-1",changed));
  }
  assert(squareAnswersUnchanged(draft,{...draft},{}));
  assert(!squareAnswersUnchanged(draft,{...draft,p2x:"299"},{}));
  assert(!squareAnswersUnchanged(draft,draft,{p2x:""}));
});
test("objective mistakes yield valid bounded tutor context with student values and specific hints",()=>{
  const lesson=getShapeLesson("사각형",0),draft=answers(lesson);
  draft.p2x="250";draft.p3y="";draft.closeY="99";
  const judgment=squareTutorJudgment(assessSquare(lesson,draft));
  assert.equal(judgment.errorCount,3);
  assert(JSON.stringify(judgment).length<2000);
  const context={task:"square",judgment:JSON.stringify(judgment),answers:JSON.stringify(draft),
    condition:JSON.stringify({condition:{instruction:lesson.instruction}})};
  const assessment=submittedAssessment(context);
  assert.equal(assessment.correct,false);
  const hint=automaticHint(context,assessment,1,1);
  assert.match(hint,/P2의 X.*250/s);assert.match(hint,/미입력/);assert.match(hint,/문제 조건/);
  assert.match(hint,/1\\.|1\./);assert.match(hint,/실제 로봇을 실행할 수 없/);
  assert(!hint.includes("300"),"first hint must not supply P2X answer");
  const repeated=automaticHint(context,assessment,2,2,assessment);
  assert.match(repeated,/검산/);assert.notEqual(repeated,hint);
});
test("many missing fields retain an incorrect verdict rather than truncated/unparseable JSON",()=>{
  const lesson=getShapeLesson("사각형",4),rows=assessSquare(lesson,{});
  const judgment=squareTutorJudgment(rows);
  assert.equal(judgment.errorCount,rows.length);
  assert(JSON.stringify(judgment).length<2000);
  assert.equal(submittedAssessment({judgment:JSON.stringify(judgment),task:"square"}).correct,false);
});
test("other shapes do not acquire a square execution plan",()=>{
  for(const shape of ["삼각형","동그라미"])for(let i=0;i<6;i++){
    const lesson=getShapeLesson(shape,i);
    assert.equal(squareStudentSequence(lesson,answers(lesson)),null);
  }
});
