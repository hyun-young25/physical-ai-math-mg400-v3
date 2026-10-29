const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const cache={};function load(n){if(cache[n])return cache[n];const out=cache[n]={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,n+'.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(out,d=>load(d.replace('./','')));return out;}
const p=load('paperCoordinateStudy'),m=load('paperMergedLesson'),v=load('paperRectangleTask'),r=load('paperRetry'),labels=load('paperDiagnosisLabel'),square=load('squareMismatchDiagnosis');
const targets=v.paperTaskTargets('advanced-paper-dt','initial');
function trial(angle,kind){
 const t={originX:'225',originY:'-90',axisDirection:'x+',millimetersPerCentimeter:'10',rotationDegrees:String(angle),explanation:'학생의 관계식'},a=angle*Math.PI/180;
 const samples=[['O',0,0],['X',100,0],['Y',0,100]].map(([point,x,y])=>({point,pose:{x:225+x*Math.cos(a)-y*Math.sin(a),y:-90+x*Math.sin(a)+y*Math.cos(a),z:60,r:0},source:'teacher',seq:null,capturedAt:Date.now(),ageMsAtCapture:null,user:0,tool:0,coordinateSystem:'teacher',verifiedCoordinates:false}));
 const frame=p.validatePaperFrame(samples).frame,commands=targets.map(pt=>({point:pt.name,pose:{...p.frameTransformPoint(frame,kind==='swap'?{...pt,xCm:pt.yCm,yCm:pt.xCm}:pt),z:60,r:0}}));
 if(kind==='single')commands[2].pose.x+=20;
 const at=Date.now(),run={id:crypto.randomUUID(),frameId:frame.id,planHash:'plan',targetSet:'initial',source:'dt',status:'completed',startedAt:at,endedAt:at+10,startSequence:null,commands,observations:commands.map(c=>({...c,command:c.pose,pose:{...c.pose},source:'dt',kind:'dt',seq:null,ageMs:null,measuredAt:at+5}))};
 const diagnosis=p.diagnosePaperRun(run,frame,'plan',{transform:t,targets,detectOriginMissing:true});
 return {id:'first',level:angle?'advanced-paper-hardware':'advanced-paper-dt',targetSet:'initial',frame,run,diagnosis,transform:t,predictions:commands.map((c,i)=>({...targets[i],robotX:String(c.pose.x),robotY:String(c.pose.y),robotZ:'',robotR:''})),pathConcept:{motion:'MoveL',closeX:'0',closeY:'0'}};
}
for(const angle of [0,30])for(const kind of ['single','swap','match'])test(`${angle}° ${kind}: paper result controls badge, question, snapshot and evidence`,()=>{
 const record=trial(angle,kind),d=record.diagnosis,vis=v.paperRectangleVisual(record.frame,targets,record.run,d,6,'key',0,'guided',true);
 const label=labels.paperDiagnosisLabel(d);
 assert.equal(d.pattern,kind==='match'?'match':'calculation');assert.equal(vis.plan.question,d.question);assert.equal(vis.plan.relationHint,d.why);
 assert.equal(square.squareDiagnosisName(vis.diagnosis,true),label);assert.equal(vis.diagnosis.label,label+'\n'+d.candidate);
 assert.equal(vis.diagnosis.type,kind==='single'?'arithmetic':kind==='swap'?'axis-swap':'match');
 if(kind==='single'){assert.equal(label,'대입·계산 차이 · P3');assert.deepEqual(r.paperRetryFields(record),['P3.robotX']);assert.doesNotMatch(vis.diagnosis.label,/축 뒤바뀜/);}
 if(kind==='swap'){assert.match(label,/축 뒤바뀜/);assert.match(d.question,/ΔX와 ΔY/);}
 if(kind==='match')assert.deepEqual(r.paperRetryFields(record),[]);
});
test('retry clones only submitted values under identical placement and targets; first evidence stays immutable',()=>{
 const parent=trial(30,'single'),before=JSON.stringify(parent),copy=r.paperRetryInputs(parent,parent.level,parent.frame,targets);
 assert.deepEqual(copy.predictions,parent.predictions);copy.predictions[2].robotX='changed';copy.transform.explanation='changed';copy.pathConcept.motion='MoveJ';assert.equal(JSON.stringify(parent),before);
 assert.equal(r.paperRetryInputs(parent,'basic',parent.frame,targets),null);
 assert.equal(r.paperRetryInputs(parent,parent.level,{...parent.frame,id:'moved'},targets),null);
 const shifted=structuredClone(parent.frame);shifted.samples[0].pose.x++;assert.equal(r.paperRetryInputs(parent,parent.level,shifted,targets),null);
 assert.equal(r.paperRetryInputs(parent,parent.level,parent.frame,targets.slice(1)),null);
 const tracking={...parent,diagnosis:{...parent.diagnosis,pattern:'tracking'}};assert.deepEqual(r.paperRetryFields(tracking),[]);
});
