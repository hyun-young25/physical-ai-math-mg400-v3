const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),ts=require("typescript");
const cache={};function load(n){if(cache[n])return cache[n];const out=cache[n]={};new Function("exports","require",ts.transpileModule(fs.readFileSync(path.join(__dirname,n+".ts"),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(out,d=>load(d.replace("./","")));return out;}
const p=load("paperCoordinateStudy"),m=load("paperMergedLesson"),r=load("paperRectangleTask"),s=load("squareMismatchDiagnosis"),o=load("originMissing");
const targets=r.paperTaskTargets("advanced-paper-dt","initial");
function trial(omit=false,offset=0){const frame=m.givenPaperFrame(),start=Date.now(),commands=targets.map(t=>({point:t.name,pose:{...p.frameTransformPoint(frame,t),z:60,r:0}}));
 if(omit)for(const c of commands){c.pose.x-=180;c.pose.y+=60;}
 const run={id:"run",frameId:frame.id,planHash:"plan",targetSet:"initial",source:"dt",status:"completed",startedAt:start,endedAt:start+10,startSequence:null,commands,observations:commands.map(c=>({...c,pose:{...c.pose,x:c.pose.x+offset},command:c.pose,source:"dt",kind:"dt",seq:null,ageMs:null,measuredAt:start+5}))};
 return {frame,run};
}
const diagnose=(t,options={})=>p.diagnosePaperRun(t.run,t.frame,"plan",{targets,detectOriginMissing:true,...options});
test("new course keeps 110x150 mm corners and legacy rotation records retain their targets",()=>{
 assert.deepEqual(targets.map(t=>[t.xCm,t.yCm]),[[0,0],[11,0],[11,15],[0,15]]);
 assert.deepEqual(r.paperTaskTargets("advanced-paper-rotated","initial").map(t=>[t.xCm,t.yCm]),[[2,2],[8,2],[8,6],[2,6]]);
 assert.equal(m.PAPER_TASK_VERSION,"v4-paper-merged");
 assert.equal(m.paperConceptValid({motion:"MoveJ",closeX:"0",closeY:"0"}),false);
 assert.equal(m.paperConceptValid({motion:"MoveL",closeX:"0",closeY:"0"}),true);
});
test("origin omission requires all submitted coordinates to omit O and execution to follow that plan",()=>{
 const t=trial(true);assert.equal(diagnose(t).pattern,"origin-missing");
 const v=r.paperRectangleVisual(t.frame,targets,t.run,diagnose(t),6,"key",0);assert.equal(v.diagnosis.type,"origin-missing");
 t.run.commands[3].pose={...t.run.commands[3].pose,x:9};t.run.observations[3].command=t.run.commands[3].pose;t.run.observations[3].pose=t.run.commands[3].pose;
 assert.notEqual(diagnose(t).pattern,"origin-missing");
 assert.equal(o.omitsOrigin([{x:0,y:0}],[{x:180,y:-60}],{x:180,y:-60}),false);
});
test("constant equipment offset never becomes origin omission, even when student plan is wrong",()=>{
 for(const omitted of [false,true]){const t=trial(omitted,4),d=diagnose(t,{repeated:9});assert.equal(d.pattern,"tracking");assert.equal(d.supportLevel,1);
 const v=r.paperRectangleVisual(t.frame,targets,t.run,d,6,"key",9);assert.equal(v.diagnosis.type,"model-real");assert.equal(v.plan.teacherFlag,false);assert.equal(v.plan.level,"task");}
});
test("paper tolerance is recorded and is separate from 1mm hardware and .1mm mathematical edge comparisons",()=>{
 assert.equal(diagnose(trial(false,1.5)).pattern,"match");
 assert.equal(diagnose(trial(false,2.1)).pattern,"tracking");
 assert.equal(diagnose(trial(false,1.5),{toleranceMm:1}).pattern,"tracking");
 assert.equal(s.MODEL_REAL_THRESHOLD_MM,1);
});
test("same-type repetition escalates task/process/worked; challenge delays one attempt and match self-regulates",()=>{
 for(const [support,expected] of [["guided",[1,2,3,3]],["challenge",[1,1,2,3]]]){
 assert.deepEqual([0,1,2,3].map(repeated=>diagnose(trial(true),{support,repeated}).supportLevel),expected);
 }const t=trial();assert.equal(r.paperRectangleVisual(t.frame,targets,t.run,diagnose(t),6,"key",2).plan.level,"self-regulation");
});
test("stale, partial and incomplete observation is not classified as a learning error",()=>{
 const t=trial(true);t.run.status="partial";assert.equal(diagnose(t).status,"incomplete");
 t.run.status="completed";t.run.observations.pop();assert.equal(diagnose(t).status,"incomplete");
});
