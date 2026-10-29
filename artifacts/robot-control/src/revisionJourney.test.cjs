const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const cache={};function load(n){if(cache[n])return cache[n];const out=cache[n]={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,n+'.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(out,d=>load(d.replace('./','')));return out;}
const j=load('revisionJourney'),p=load('paperCoordinateStudy'),m=load('paperMergedLesson'),r=load('paperRectangleTask');
function record(id,parent=null,shift=0){
 const frame=m.givenPaperFrame(),targets=r.paperTaskTargets('advanced-paper-dt','initial'),points=targets.map(t=>({...t,robotX:String(p.frameTransformPoint(frame,t).x+shift),robotY:String(p.frameTransformPoint(frame,t).y)}));
 return {id,parentAttemptId:parent,taskVersion:'v4-paper-merged',level:'advanced-paper-dt',targetSet:'initial',frame,planHash:id,predictions:points,
  transform:{originX:'180',originY:'-60',millimetersPerCentimeter:'10',axisDirection:'x+',rotationDegrees:'0',explanation:'내 계산 근거'},revisionReason:'질문을 보고 20을 뺌',studentHypothesis:'기준점 계산을 확인함',
  run:{id:'run-'+id,frameId:frame.id,planHash:id,source:'dt',status:'completed',observations:points.map(t=>({point:t.name,pose:{x:Number(t.robotX),y:Number(t.robotY)}}))},
  diagnosis:{status:'complete',candidate:shift?'목표와 차이':'목표와 일치',pattern:shift?'translation':'match',question:'기준점을 어떻게 더했나요?'}};
}
test('new prediction keeps the original and feedback, but cannot claim a new execution result',()=>{
 const a=record('a',null,20),b=record('b','a');delete b.run;delete b.diagnosis;
 const before=JSON.stringify([a,b]),out=j.paperRevisionJourney(b,[a,b],[],b.predictions,b.transform,3);
 assert.equal(out.first.points[0].x,200);assert.equal(out.draft[0].x,180);assert.equal(out.current.complete,false);assert.equal(out.current.match,false);
 assert.equal(out.previous.question,a.diagnosis.question);assert.equal(out.editing,true);assert.equal(JSON.stringify([a,b]),before);
});
test('completed correction is linked; different frames/targets are flagged instead of implying improvement',()=>{
 const a=record('a',null,20),b=record('b','a');
 let out=j.paperRevisionJourney(b,[a,b],[],b.predictions,b.transform,6);assert.equal(out.current.match,true);assert.equal(out.conditionsChanged,false);
 b.frame=m.givenPaperFrame(true);b.run.frameId=b.frame.id;
 out=j.paperRevisionJourney(b,[a,b],[],b.predictions,b.transform,6);assert.equal(out.conditionsChanged,true);
});
test('cancelled, partial, stale and invalidated runs cannot become successful comparison results',()=>{
 for(const mode of ['cancelled','partial','stale','invalidated']){
  const a=record('a'),b=record('b','a');
  if(mode==='stale')b.run.planHash='old';else if(mode==='invalidated')b.invalidatedRunIds=[b.run.id];else b.run.status=mode;
  const out=j.paperRevisionJourney(b,[a,b],[],b.predictions,b.transform,6);
  assert.equal(out.current.complete,false);assert.equal(out.current.match,false);assert.deepEqual(out.current.observed,[]);
 }
});
test('does not join unrelated lessons/versions or infinite parent cycles',()=>{
 const a=record('a'),b=record('b','a');a.level='advanced-paper-hardware';
 assert.equal(j.paperRevisionJourney(b,[a,b],[],b.predictions,b.transform,6).first.id,'b');
 a.level=b.level;a.taskVersion='legacy';assert.equal(j.paperRevisionJourney(b,[a,b],[],b.predictions,b.transform,6).revising,false);
 a.taskVersion=b.taskVersion;a.parentAttemptId='b';assert.equal(j.linkedAttempts(b,[a,b],r=>r.parentAttemptId,()=>true).length,2);
});
test('GPT text is read only from the matching run snapshot, with source preserved',()=>{
 const a=record('a'),b=record('b','a');b.run.source='hardware';
 const snaps=[{recordId:'a',runId:'wrong-run',questions:[{source:'openai',text:'다른 실행의 응답'}]},
 {recordId:'a',runId:a.run.id,questions:[{source:'openai',text:'실제로 표시한 질문'}]}];
 const out=j.paperRevisionJourney(b,[a,b],snaps,b.predictions,b.transform,6);
 assert.equal(out.previous.gptQuestion,'실제로 표시한 질문');assert.equal(out.current.source,'hardware');
});
