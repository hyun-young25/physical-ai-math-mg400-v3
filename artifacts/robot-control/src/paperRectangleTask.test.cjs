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
  const verification=v.paperTaskTargets("advanced-paper-rotated","revalidation");
  assert.deepEqual(verification.map(t=>[t.xCm,t.yCm]),[[3,3],[7,3],[7,5],[3,5]]);
  assert.notDeepEqual(verification.map(t=>[t.xCm,t.yCm]),targets.map(t=>[t.xCm,t.yCm]));
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
  assert.match(p.paperRevalidationScope(record,parent,targets),/DT 재실행 자료.*실측 재검증 아님/);
 assert.equal(p.paperRevalidationScope({...record,run:{...next,frameId:f.id}},parent,targets),null);
});

test("revalidation status uses the saved pre-run criteria and never calls DT a physical verification",()=>{
 const f=frame(),t=transform(30),prior=run(f,t,now),parent={id:"parent",frame:f,targetSet:"initial",run:{...prior,id:"prior",endedAt:now+10},
   studentHypothesis:"축 회전을 확인",revisionReason:"독립 점에서 다시 비교"};
 const checkTargets=v.paperTaskTargets("advanced-paper-hardware","revalidation"),startedAt=now+20;
 const criteria={recordId:"child",frameId:f.id,planHash:"plan",targetSet:"revalidation",modelConstructionPoints:["O","X","Y"],
   independentVerificationPoints:checkTargets.map(p=>p.name),positionToleranceMm:2,rotationToleranceDeg:2,
   rationale:"실행 전 독립 확인점을 2 mm 이내로 정함",confirmedAt:startedAt-1};
 const makeRecord=(source,runFrame=f)=>{
   const commands=checkTargets.map(pt=>({point:pt.name,pose:{...p.frameTransformPoint(runFrame,pt)}}));
   const next={id:"child-run",frameId:runFrame.id,planHash:"plan",targetSet:"revalidation",source,status:"completed",
     startedAt,endedAt:startedAt+10,startSequence:10,verificationCriteria:criteria,commands,
     observations:commands.map((c,i)=>({...c,command:c.pose,source,kind:source==="hardware"?"controller-tcp":"dt",
       seq:source==="hardware"?11+i:null,ageMs:0,measuredAt:startedAt+5+i}))};
   const record={id:"child",parentAttemptId:"parent",frame:runFrame,targetSet:"revalidation",run:next,planHash:"plan",
     diagnosis:p.diagnosePaperRun(next,runFrame,"plan",{transform:t,toleranceMm:criteria.positionToleranceMm,targets:checkTargets})};
   return record;
 };
 const dtParent={...parent,run:{...parent.run,source:"dt",observations:parent.run.observations.map(o=>({...o,source:"dt",kind:"dt"}))}};
 const dtRecord=makeRecord("dt");
 assert.ok(p.paperRevalidationScope(dtRecord,dtParent,checkTargets),JSON.stringify({diagnosis:dtRecord.diagnosis,validation:p.validatePaperRunForDiagnosis(dtRecord.run,f,"plan",checkTargets)}));
 const dt=p.paperRevalidationAssessment(dtRecord,dtParent,checkTargets,true);
 assert.equal(dt.result,"simulation-only");
 assert.match(dt.scope,/실측 재검증 아님/);
 const hardwareFrame={...f,source:"hardware",samples:f.samples.map((sample,i)=>({...sample,source:"hardware",verifiedCoordinates:true,seq:i+1}))};
 const physicalParent={...parent,frame:hardwareFrame,run:{...parent.run,source:"hardware",frameId:hardwareFrame.id,
   observations:parent.run.observations.map(o=>({...o,source:"hardware",kind:"controller-tcp",seq:2}))}};
 const physicalRecord=makeRecord("hardware",hardwareFrame);
 const physical=p.paperRevalidationAssessment(physicalRecord,physicalParent,checkTargets,true);
 assert.ok(physical,JSON.stringify({diagnosis:physicalRecord.diagnosis,validation:p.validatePaperRunForDiagnosis(physicalRecord.run,hardwareFrame,"plan",checkTargets),
   scope:p.paperRevalidationScope(physicalRecord,physicalParent,checkTargets)}));
 assert.equal(physical.result,"physical-verified");
 const missingInk=p.paperRevalidationAssessment(makeRecord("hardware",hardwareFrame),physicalParent,checkTargets,false);
 assert.equal(missingInk.result,"incomplete");
});
