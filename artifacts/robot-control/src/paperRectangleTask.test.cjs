const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),ts=require("typescript");
const cache={};function load(name){if(cache[name])return cache[name];const out=cache[name]={};new Function("exports","require",ts.transpileModule(fs.readFileSync(path.join(__dirname,name+".ts"),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(out,dep=>load(dep.replace("./","")));return out;}
const p=load("paperCoordinateStudy"),v=load("paperRectangleTask"),now=Date.now();
const transform=(degrees=0)=>({originX:"225",originY:"-90",axisDirection:"x+",millimetersPerCentimeter:"10",rotationDegrees:String(degrees),explanation:"축 방향"});
function frame(degrees=30,offset=0){
 const a=degrees*Math.PI/180;return p.validatePaperFrame([["O",0,0],["X",100,0],["Y",0,100]].map(([point,x,y],i)=>({point,pose:{x:225+offset+x*Math.cos(a)-y*Math.sin(a),y:-90+x*Math.sin(a)+y*Math.cos(a),z:60,r:0},source:"teacher",seq:null,capturedAt:now-100+i+offset,ageMsAtCapture:null,user:0,tool:0,coordinateSystem:"teacher",verifiedCoordinates:false})),now).frame;
}
const targets=v.paperTaskTargets("advanced-paper-rotated","initial");
function run(f,t,at=now){
 const commands=targets.map(pt=>({point:pt.name,pose:{...p.studentTransformPoint(t,pt),z:60}}));
 return {id:crypto.randomUUID(),frameId:f.id,planHash:"plan",targetSet:"initial",source:"dt",status:"completed",startedAt:at,endedAt:at+10,startSequence:null,commands,observations:commands.map(c=>({...c,command:c.pose,source:"dt",kind:"dt",seq:null,ageMs:null,measuredAt:at+5}))};
}
test("rectangle targets are four corners; legacy triangle sets are not rewritten",()=>{
 assert.deepEqual(targets.map(t=>[t.xCm,t.yCm]),[[2,2],[8,2],[8,6],[2,6]]);
 assert.equal(v.paperTaskTargets("rotated","initial"),p.PAPER_TARGETS.initial);
 assert.equal(v.paperTaskTargets("basic","revalidation").length,3);
});
test("same paper classifier detects an omitted rotation and accepts its correction for four points",()=>{
 const f=frame(),wrong=transform(0),r=run(f,wrong);
 const d=p.diagnosePaperRun(r,f,"plan",{transform:wrong,targets});
 assert.equal(d.pattern,"rotation");assert.equal(d.taskEvidence.length,4);
 const e=v.paperTransformEstimate(f,targets,r);assert(Math.abs(e.relativeAngle+30)<1e-9);assert(Math.abs(e.paperAngle-30)<1e-9);
 const correct=transform(30);assert.equal(p.diagnosePaperRun(run(f,correct),f,"plan",{transform:correct,targets}).pattern,"match");
});
test("fourth corner is required; a bad or stale fourth packet is never accepted as complete",()=>{
 const f=frame(),r=run(f,transform(30));
 for(const mutate of [x=>x.observations.pop(),x=>x.observations[3].pose={...x.observations[3].pose,x:NaN},x=>x.observations[3].measuredAt=now-1]){
  const clone=structuredClone(r);mutate(clone);assert.ok(p.validatePaperRunForDiagnosis(clone,f,"plan",targets));
 }
 const changed=structuredClone(r);changed.observations[3].pose={...changed.observations[3].pose,x:350};
 assert.equal(p.diagnosePaperRun(changed,f,"plan",{transform:transform(30),targets}).pattern,"tracking");
});
test("display adapter retains recorded source and four real observations; a closing line is explicitly derived",()=>{
 const f=frame(),t=transform(),r=run(f,t),before=JSON.stringify(r),d=p.diagnosePaperRun(r,f,"plan",{transform:t,targets});
 const view=v.paperRectangleVisual(f,targets,r,d,6,"key",0);assert.ok(view);assert.equal(view.connectedVerticesOnly,true);
 assert.equal(view.diagnosis.evidence.source,"dt");assert.equal(view.target.length,5);assert.equal(view.observed.length,5);
 assert.equal(view.plan.level,"task");assert.equal(view.plan.teacherFlag,false);assert.equal(JSON.stringify(r),before);assert.equal(r.observations.length,4);
});
test("same generic revalidation checks require fresh linked observations under a new frame",()=>{
 const f=frame(),t=transform(30),r=run(f,t),parent={id:"old",frame:f,targetSet:"initial",run:r,studentHypothesis:"회전항",revisionReason:"새 배치로 확인"};
 const f2=frame(15,10),t2={...transform(15),originX:"235"},next=run(f2,t2,now+50);
 const record={id:"new",parentAttemptId:"old",frame:f2,targetSet:"initial",run:next,planHash:"plan",diagnosis:p.diagnosePaperRun(next,f2,"plan",{transform:t2,targets})};
 assert.match(p.paperRevalidationScope(record,parent,targets),/DT 재검증 완료/);
 assert.equal(p.paperRevalidationScope({...record,run:{...next,frameId:f.id}},parent,targets),null);
});
