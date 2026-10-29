const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const cache={};function load(name){if(cache[name])return cache[name];const out=cache[name]={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,name+'.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(out,n=>n.startsWith('./')?load(n.slice(2)):{});return out;}
// The rendering model has no persistence or robot service dependencies.
cache.useSquareVisual={};const m=load('paperSceneModel'),store=load('paperSceneStore'),rev=load('revisionSceneStore');
const frame={id:'rotated',samples:[['O',200,-60],['X',200,40],['Y',100,-60]].map(([point,x,y])=>({point,pose:{x,y,z:60,r:0}})),source:'teacher'};
const data=()=>({frame,samples:frame.samples,level:'advanced-paper-hardware',stage:3,targetPoints:[{name:'P1',xCm:0,yCm:0}],predictions:[{name:'P1',robotX:'200',robotY:'-60'}],running:false});
test('20 cm paper and 1 cm grid follow measured O/X/Y including a 90 degree rotation and Z',()=>{
 assert.deepEqual(m.paperCorners(frame),[{x:200,y:-60,z:60,r:0},{x:200,y:140,z:60,r:0},{x:0,y:140,z:60,r:0},{x:0,y:-60,z:60,r:0}]);
 assert.equal(m.paperGrid(frame).length,42);assert.equal(Math.hypot(m.paperGrid(frame)[2][0].x-200,m.paperGrid(frame)[2][0].y+60),10);
});
test('unknown frames and incomplete input cannot invent robot targets or a result',()=>{
 const d=data();d.frame=null;assert.deepEqual(m.paperSceneSeries(d,1),[]);d.frame=frame;d.predictions[0].robotY='';
 const s=m.paperSceneSeries(d,1);assert.equal(s[1].points[0].y,null);assert.equal(s[1].color,'#8b5cf6');assert.deepEqual(m.paperMismatchPoints(d,s),[]);
});
test('partial predictions connect consecutive valid points without bridging missing answers',()=>{
 const points=[{label:'P1',x:1,y:2},{label:'P2',x:3,y:4},{label:'P3',x:null,y:5},{label:'P4',x:6,y:7}];
 assert.equal(m.paperSeriesSegments(points).length,1);points[2].x=4;assert.equal(m.paperSeriesSegments(points).length,4);
});
test('mismatch highlights use the recorded diagnosis only for the displayed current run',()=>{
 const d=data();d.run={frameId:frame.id,status:'completed',observations:[{point:'P1',pose:{x:220,y:-60}}]};d.diagnosis={status:'complete',evidence:[{point:'P1',distance:0}],taskEvidence:[{point:'P1',distance:20}],toleranceMm:2};
 const series=[{label:'첫 실행',dashed:false,points:[{label:'P1',x:220,y:-60}]}];assert.deepEqual(m.paperMismatchPoints(d,series),['P1']);
 d.run.frameId='old';assert.deepEqual(m.paperMismatchPoints(d,series),[]);d.run.frameId=frame.id;d.diagnosis.status='invalidated';assert.deepEqual(m.paperMismatchPoints(d,series),[]);
});
test('point selection and camera reset are display-only and clear on leaving the owner',()=>{
 const d=data(),before=JSON.stringify(d);store.publishPaperScene('advanced',d);store.selectPaperPoint('P2','scene');assert.equal(rev.revisionSceneSnapshot().point,1);
 const key=store.paperSceneSnapshot().cameraKey;store.requestPaperCamera();assert.equal(store.paperSceneSnapshot().cameraKey,key+1);assert.equal(JSON.stringify(d),before);
 store.clearPaperScene('other');assert.ok(store.paperSceneSnapshot().data);store.clearPaperScene('advanced');assert.equal(store.paperSceneSnapshot().data,null);
});
