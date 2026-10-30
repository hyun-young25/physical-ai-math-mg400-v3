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
test('a new advanced lesson drops the previous point and scene scroll request',()=>{
 const d=data();store.publishPaperScene('dt',{...d,level:'advanced-paper-dt'});store.selectPaperPoint('P3','scene');
 assert.equal(store.paperSceneSnapshot().point,2);
 store.publishPaperScene('hardware',d);
 assert.equal(store.paperSceneSnapshot().point,null);assert.equal(store.paperSceneSnapshot().reference,null);
 assert.equal(store.paperSceneSnapshot().selectionOrigin,'lesson');assert.equal(rev.revisionSceneSnapshot().point,0);
 store.selectPaperPoint('P4','scene');store.clearPaperScene('hardware');store.publishPaperScene('dt',{...d,level:'advanced-paper-dt'});
 assert.equal(store.paperSceneSnapshot().point,null);assert.equal(store.paperSceneSnapshot().selectionOrigin,'lesson');
 store.clearPaperScene('dt');
});
test('paper translucency preserves transforms, shared materials and restores normal lessons',()=>{
 const THREE=require('three'),appearance=load('paperRobotAppearance'),group=new THREE.Group();
 const material=new THREE.MeshStandardMaterial({color:'white'}),geometry=new THREE.BoxGeometry();
 const arm=new THREE.Mesh(geometry,material),tool=new THREE.Mesh(geometry,[material,material]),otherScene=new THREE.Mesh(geometry,material);
 arm.position.set(350,0,60);arm.castShadow=true;arm.receiveShadow=true;group.add(arm,tool);
 const pose=arm.matrix.clone(),restore=appearance.softenPaperRobot(group);
 assert.notEqual(arm.material,material);assert.equal(arm.material.opacity,.32);assert.equal(arm.castShadow,false);
 assert.equal(otherScene.material.opacity,1);assert.equal(material.transparent,false);assert.ok(arm.matrix.equals(pose));assert.deepEqual(arm.position.toArray(),[350,0,60]);
 assert.equal(tool.material[0],arm.material);
 restore();assert.equal(arm.material,material);assert.equal(tool.material[0],material);assert.equal(arm.castShadow,true);assert.equal(arm.receiveShadow,true);
 material.dispose();geometry.dispose();
});
test('DT preview freezes the last current pose in original colours and changes only the animated copy',()=>{
 const THREE=require('three'),appearance=load('paperRobotAppearance'),source=new THREE.Group();
 const material=new THREE.MeshStandardMaterial({color:'#202020'}),geometry=new THREE.BoxGeometry();
 const arm=new THREE.Mesh(geometry,material);arm.position.set(350,0,60);source.add(arm);
 const preview=appearance.createPaperRobotPreview(source),fixed=preview.current.children[0];
 preview.syncCurrent();assert.equal(preview.current.visible,false);assert.notEqual(fixed.material,material);
 arm.position.x=340;preview.syncCurrent();assert.equal(fixed.position.x,340);
 // First animation frame must not move the frozen reference to the new preview pose.
 arm.position.x=310;preview.showPreview(true);preview.syncCurrent();
 assert.equal(fixed.position.x,340);assert.equal(arm.position.x,310);assert.equal(fixed.material.opacity,1);
 assert.equal(fixed.material.color.getHexString(),'202020');assert.equal(arm.material.color.getHexString(),'8b98a6');
 assert.equal(arm.material.opacity,.32);assert.equal(preview.current.visible,true);assert.equal(source.visible,true);
 assert.equal(fixed.geometry,geometry);assert.equal(material.opacity,1);
 preview.showPreview(false);assert.equal(source.visible,false);assert.equal(preview.current.visible,true);
 arm.position.x=290;preview.showPreview(true);assert.equal(fixed.position.x,340);
 const replacement=new THREE.MeshStandardMaterial({color:'blue'});arm.material=replacement;preview.showPreview(true);
 assert.equal(arm.material.opacity,.32);assert.equal(fixed.material.color.getHexString(),'202020');
 preview.dispose();assert.equal(source.visible,true);assert.equal(arm.material,replacement);assert.equal(arm.position.x,290);
 material.dispose();replacement.dispose();geometry.dispose();
});
