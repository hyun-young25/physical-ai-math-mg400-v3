const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const cache={};function load(n){if(cache[n])return cache[n];const out=cache[n]={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,n+'.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(out,d=>load(d.replace('./','')));return out;}
const p=load('paperCoordinateStudy'),g=load('paperExecutionGuards'),v=load('paperRectangleTask'),r=load('paperRotationVisual'),label=load('paperDiagnosisLabel');
const targets=v.paperTaskTargets('advanced-paper-hardware','initial');
function sample(angle){const a=angle*Math.PI/180,now=Date.now();return p.validatePaperFrame([['O',0,0],['X',100,0],['Y',0,100]].map(([point,x,y],i)=>({point,pose:{x:225+x*Math.cos(a)-y*Math.sin(a),y:-60+x*Math.sin(a)+y*Math.cos(a),z:60,r:0},source:'mock',seq:i+1,capturedAt:now,ageMsAtCapture:0,user:0,tool:0,coordinateSystem:'User 0 / Tool 0',verifiedCoordinates:true}))).frame;}
for(const angle of [0,15,90])test(`sheet boundary uses physical mm at ${angle} degrees`,()=>{
 const f=sample(angle),pose=(xCm,yCm)=>p.frameTransformPoint(f,{xCm,yCm});
 assert.equal(g.paperBoundary(f,pose(0,0)).outside,false);
 assert.equal(g.paperBoundary(f,pose(20,20)).outside,false);
 assert.ok(Math.abs(g.paperBoundary(f,pose(-2,10)).distance-20)<1e-6);
 assert.ok(g.paperBoundary(f,pose(-2.2,-2.2)).distance>30,'diagonal distance, not square expanded box');
 assert.equal(g.supervisedPaperBlockers(true,true,true,f,[{point:'P3',pose:pose(-2,10)}]).length,0);
 assert.match(g.supervisedPaperBlockers(true,true,true,f,[{point:'P3',pose:pose(-3.1,10)}])[0].message,/30 mm/);
 assert.equal(g.supervisedPaperBlockers(false,true,false,f,[{point:'P3',pose:pose(-3.1,10)}]).length,3);
});
function record(modelAngle,executionAngle){const f=sample(15),t={originX:'225',originY:'-60',axisDirection:'x+',millimetersPerCentimeter:'10',rotationDegrees:String(modelAngle),explanation:'회전 검증'},now=Date.now();
 const commands=targets.map(pt=>({point:pt.name,pose:p.studentTransformPoint({...t,rotationDegrees:String(executionAngle)},pt)}));
 const run={id:'test',frameId:f.id,planHash:'plan',targetSet:'initial',source:'dt',status:'completed',startedAt:now,endedAt:now+10,startSequence:null,commands,observations:commands.map(c=>({...c,command:c.pose,pose:{...c.pose},source:'dt',kind:'dt',seq:null,ageMs:null,measuredAt:now+5}))};return {f,t,run};
}
for(const [model,exec,expected] of [[15,0,'calculation'],[0,0,'rotation'],[15,15,'match']])test(`15° sheet: model ${model}, run ${exec} yields ${expected} consistently`,()=>{
 const {f,t,run}=record(model,exec),d=p.diagnosePaperRun(run,f,'plan',{transform:t,targets}),visual=v.paperRectangleVisual(f,targets,run,d,6,'key',0,'guided',true);
 assert.equal(d.pattern,expected);assert.equal(visual.plan.question,d.question);assert.ok(visual.diagnosis.label.startsWith(label.paperDiagnosisLabel(d)));
 const angle=r.paperRotationVisual(f,targets,run);
 if(expected==='match')assert.equal(angle,null);else {assert.ok(Math.abs(angle.relativeAngle+15)<1e-6);assert.match(angle.text,/15.0° 시계/);assert.ok(Math.abs(angle.scaleX-1)<1e-6);assert.equal(angle.arc.length,33);}
 assert.equal(r.paperRotationVisual(f,targets,{...run,status:'partial'}),null);
 assert.equal(r.paperRotationVisual({...f,id:'moved'},targets,run),null);
});
