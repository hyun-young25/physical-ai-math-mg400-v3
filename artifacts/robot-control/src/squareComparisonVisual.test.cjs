const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),ts=require("typescript");
const cache={};
function load(name){if(cache[name])return cache[name];const out=cache[name]={};new Function("exports","require",ts.transpileModule(fs.readFileSync(path.join(__dirname,name+".ts"),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(out,dep=>load(dep.replace("./","")));return out;}
const {getShapeLesson,shapeLessonExpected}=load("shapeLearning");
const {diagnoseSquare,squarePlannedVertices,squareCondition,squareFeedbackPlan}=load("squareMismatchDiagnosis");
const visual=load("squareComparisonVisual"),store=load("squareVisualizationStore");
const lesson=getShapeLesson("사각형",0),answers=Object.fromEntries(Object.entries(shapeLessonExpected(lesson)).map(([k,v])=>[k,String(v)]));
function sample(patch={},key="run-1"){const a={...answers,...patch};const observed=squarePlannedVertices(lesson,a);const diagnosis=diagnoseSquare(lesson,a,{observedVertices:observed,source:"dt"});return {key,feedbackKey:key,stage:6,diagnosis,plan:squareFeedbackPlan(diagnosis,0,"challenge"),target:squareCondition(lesson).target.map((p,i)=>({...p,label:"P"+i})),observed,priorSameType:0,supportMode:"challenge"};}
test("closure visualization preserves the measured open endpoint and the target rectangle",()=>{
 const v=sample({closeY:"-200"});assert.equal(v.diagnosis.type,"axis-swap","existing classification takes priority over the specification example");assert.equal(v.diagnosis.edgeIndex,4);
 assert.equal(v.diagnosis.evidence.edges[3].condition.delta,200);assert.equal(v.diagnosis.evidence.edges[3].executed.dy,-100);
 assert.equal(visual.squareClosureGap(v.observed),300);assert.equal(v.observed[4].y,-200);
 assert.deepEqual(visual.targetFromDiagnosis(v.diagnosis).map(({x,y})=>({x,y})),squareCondition(lesson).target);
});
test("replay samples two independent polylines and never forces an open path closed",()=>{
 const v=sample({closeY:"-200"});assert.deepEqual(visual.squareReplayPoint(v.observed,0),{x:200,y:100,z:0,edgeIndex:1});
 assert.equal(visual.squareReplayPoint(v.observed,1).y,-200);assert.equal(visual.squareReplayPoint(v.target,1).y,100);
 assert.equal(visual.squareReplayPoint(v.observed,.875).y,-150);
});
test("new attempt, hidden phase and revision clear replay and stale highlights",()=>{
 const before=JSON.stringify(sample({closeY:"-200"}));store.publishSquareVisual("lesson",JSON.parse(before));
 assert.equal(store.emphasizeSquareEvidence("run-1",4),true);assert.equal(store.replaySquareComparison(.5),true);
 store.publishSquareVisual("lesson",sample({closeY:"-200"},"run-2"));
 assert.equal(store.squareVisualSnapshot().replay,null);assert.equal(store.squareVisualSnapshot().emphasis,null);
 assert.equal(store.emphasizeSquareEvidence("run-1",4),false);
 store.clearSquareVisual("another-lesson");assert.ok(store.squareVisualSnapshot().visual);
 store.clearSquareVisual("lesson");assert.equal(store.squareVisualSnapshot().visual,null);
});
test("display replay leaves evidence unchanged and cannot initiate at the observation stage",()=>{
 const v=sample(),original=JSON.stringify(v);store.publishSquareVisual("lesson",{...v,stage:5});
 assert.equal(store.replaySquareComparison(1),false);
 store.publishSquareVisual("lesson",v);assert.equal(store.replaySquareComparison(1),true);
 store.toggleSquareVisual();assert.equal(store.squareVisualSnapshot().replay,null);
 assert.equal(JSON.stringify(v),original);store.clearSquareVisual("lesson");
});
test("no observed coordinates means no replay, including an unreachable point",()=>{
 const v=sample();v.observed=[];v.diagnosis=diagnoseSquare(lesson,answers,{rejected:{x:100,y:100},source:"dt"});
 store.publishSquareVisual("lesson",v);assert.equal(store.replaySquareComparison(1),false);
 assert.equal(visual.squareClosureGap([]),null);store.clearSquareVisual("lesson");
});
test("tutor evidence binds to the same observed attempt even when automatic context has no execution list",()=>{
 const v=sample({closeY:"-200"}),ctx={task:"square",answers:JSON.stringify(answers),attempts:1,history:"run1",execution:"[]",judgment:JSON.stringify({diagnosis:{...v.diagnosis,name:"닫힘 오류",levelLabel:"차이 관찰"}})};
 const tag=visual.squareEvidenceTag(ctx);assert.equal(tag.edgeIndex,4);assert.match(tag.label,/DT 관측/);
 assert.equal(tag.key,visual.squareFeedbackKey({...ctx,execution:"physical execution"},v.diagnosis.evidence));
 assert.notEqual(tag.key,visual.squareFeedbackKey({...ctx,history:"run2"},v.diagnosis.evidence));
 assert.equal(visual.squareEvidenceTag({...ctx,judgment:'{"diagnosis":'}),undefined);
});
test("DT, mock, and controller data keep distinct provenance",()=>{
 assert.match(visual.squareSourceLabel("dt"),/실물 측정 아님/);assert.match(visual.squareSourceLabel("mock"),/모의/);
 assert.match(visual.squareSourceLabel("hardware"),/제어기 보고/);assert.match(visual.squareSourceLabel("prediction"),/실행 관측 아님/);
});
test("CSV appends UI version without relabeling historical records or shifting existing columns",()=>{
 const out={};new Function("exports",ts.transpileModule(fs.readFileSync(path.join(__dirname,"../../api-server/src/lib/learningCsv.ts"),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(out);
 assert.equal(out.CSV_HEADERS.at(-1),"화면 버전");
 assert.match([...out.csvRows({payload:{value:1,uiVersion:"diag-visual-v2"}})][0],/"diag-visual-v2"\r\n$/);
 assert.match([...out.csvRows({payload:{value:1}})][0],/,""\r\n$/);
});
