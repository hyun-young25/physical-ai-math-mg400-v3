const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const scene={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,'revisionSceneStore.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(scene,()=>({}));
const point=x=>({label:'P1',x,y:-60});
const attempt=(id,x,source='dt')=>({id,points:[point(x)],observed:[point(x)],target:[point(180)],source,complete:true,coordinateFrame:'base'});
const data=()=>({first:attempt('a',200),previous:attempt('a',200),current:attempt('b',180,'hardware'),draft:[point(190)],draftReason:'修正',revisionReason:'訂正',revising:true,editing:false,conditionsChanged:false});
test('new result requires a distinct completed run; predictions stay separate and sources are retained',()=>{
 const d=data();d.current.complete=false;d.editing=true;
 assert.deepEqual(scene.revisionSceneSeries(d,3).at(-1).points,[]);
 assert.equal(scene.revisionSceneSeries(d,2).at(-1).points[0].x,190);
 assert.equal(scene.revisionSceneSeries(d,2).at(-1).source,'예측 · 실행 전');
 d.current.complete=true;
 const result=scene.revisionSceneSeries(d,3);assert.equal(result[1].source,'dt');assert.equal(result[2].source,'hardware');assert.equal(result[2].points[0].x,180);
});
test('changed targets or coordinate systems cannot overlay previous observations as improvement',()=>{
 const d=data();d.conditionsChanged=true;
 assert.equal(scene.revisionSceneSeries(d,3).some(s=>s.label==='첫 실행'),false);
 assert.equal(scene.revisionSceneSeries(d,0)[1].points[0].x,200);
 d.conditionsChanged=false;d.previous.coordinateFrame='different-tool';
 assert.equal(scene.revisionSceneSeries(d,2).some(s=>s.label==='수정 전 실행'),false);
 d.previous.coordinateFrame='base';d.previous.target=[point(280)];
 assert.equal(scene.revisionSceneSeries(d,2).some(s=>s.label==='수정 전 실행'),false);
});
test('display selections preserve evidence, survive edits, and clear only for their owner',()=>{
 const d=data(),before=JSON.stringify(d);scene.publishRevisionScene('lesson',d);scene.selectRevisionPoint(2);scene.selectRevisionPhase(0);
 assert.equal(JSON.stringify(d),before);assert.equal(scene.revisionSceneSnapshot().phase,0);
 scene.publishRevisionScene('lesson',{...d,draftReason:'new thought'});assert.equal(scene.revisionSceneSnapshot().point,2);assert.equal(scene.revisionSceneSnapshot().phase,0);
 scene.clearRevisionScene('other');assert.ok(scene.revisionSceneSnapshot().data);
 scene.clearRevisionScene('lesson');assert.equal(scene.revisionSceneSnapshot().data,null);
});
