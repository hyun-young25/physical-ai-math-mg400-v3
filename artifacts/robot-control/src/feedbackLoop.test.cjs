const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function load(file,deps={}){deps={...require("./learningTestAdapter.cjs"),...deps};const exports={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(exports,n=>{assert.ok(n in deps,n);return deps[n]});return exports;}
const m=load('measurementReview.ts'),s=load('learningEvidenceStorage.ts'),g=load('inquiryFeedback.ts');
const c=load('curriculum.ts'),lift=load('transferLearning.ts',{'./curriculum':c});
const sample=error=>({label:'P1',target:{x:250,y:50,z:0,r:0},actual:{x:250+error,y:50,z:0,r:0}});
const record=(id,error,source='hardware')=>({id,sessionId:'s',problemId:'B1',source,samples:[sample(error)],plans:[],at:'t'});
test('same-condition hardware results compare with the plan written before the new result',()=>{
 const before=record('1',3),after={...record('2',1),previousPlan:{prediction:'smaller'}};
 const result=m.compareMeasurements(after,before);assert.equal(result.comparable,true);assert.equal(result.before,3);assert.equal(result.after,1);assert.equal(result.predictionConsistent,true);
 after.previousPlan.prediction='larger';assert.equal(m.compareMeasurements(after,before).predictionConsistent,false);
 after.previousPlan.prediction='unknown';assert.equal(m.compareMeasurements(after,before).predictionConsistent,null);
});
test('source changes, synthetic repeats and changed targets never become evidence of improvement',()=>{
 const a=record('1',3),b=record('2',0);
 assert.equal(m.compareMeasurements({...b,source:'virtual'},a).comparable,false);
 assert.equal(m.compareMeasurements({...b,source:'virtual'},{...a,source:'virtual'}).comparable,false);
 b.samples[0].target.x=260;assert.equal(m.compareMeasurements(b,a).comparable,false);
 assert.equal(m.compareMeasurements(record('3',0),undefined).comparable,false);
});
test('missing and nonfinite measurements cannot fabricate a zero error result',()=>{
 assert.equal(m.measurementRmse([]),null);assert.equal(m.measurementRmse([sample(NaN)]),null);
 assert.equal(m.compareMeasurements({...record('2',1),samples:[]},record('1',2)).comparable,false);
});
test('equal target coordinates are independent of object property insertion order',()=>{
 const a=record('1',3),b=record('2',2);b.samples[0].target={r:0,z:0,y:50,x:250};
 assert.equal(m.compareMeasurements(b,a).comparable,true);
});
test('feedback distinguishes a sign reversal and does not claim that every MoveJ path is curved',()=>{
 const f=g.inquiryGuidance('pick-place',{key:'carry',label:'운반 ΔY',prediction:'80',result:-80,matched:false});assert.match(f.question,/부호가 반대/);assert.match(f.hint,/도착 Y−출발 Y/);
 assert.match(g.inquiryGuidance('motion',{key:'path'}).hint,/겹칠 수도/);
 assert.match(g.inquiryGuidance('motion',{key:'method'}).hint,/끝점만 요구/);
 assert.match(g.inquiryGuidance('ik',{key:'restored'}).hint,/물리 측정/);
});
test('relative lift feedback uses the observed start, command and endpoint, not a generic wrong-answer message',()=>{
 const from={...lift.LIFT_START,r:0};const goal={...lift.LIFT_GOAL,r:0};
 const t={commands:{absolute:'60',relative:'60'},results:[{mode:'absolute',status:'completed',from,target:goal,observed:goal},{mode:'relative',status:'completed',from,target:{...goal,z:80},observed:{...goal,z:80}}]};
 const feedback=lift.liftFeedback(t);assert.equal(feedback.length,1);assert.match(feedback[0],/20.00/);assert.match(feedback[0],/ΔZ=60/);assert.match(feedback[0],/높습니다/);
 t.results[1].status='stopped';assert.deepEqual(lift.liftFeedback(t),[]);
});
test('local evidence round-trips without eviction and storage failures are reported',()=>{
 const previous=global.localStorage,values=new Map();global.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
 try{const all=Array.from({length:130},(_,i)=>({id:String(i)}));assert.equal(s.writeEvidence('t',all),true);assert.deepEqual(s.readEvidence('t',v=>typeof v.id==='string'),all);
 values.set('bad','{');assert.deepEqual(s.readEvidence('bad',()=>true),[]);
 global.localStorage.setItem=()=>{throw Error('quota')};assert.equal(s.writeEvidence('t',all),false);assert.equal(values.get('t'),JSON.stringify(all));
 }finally{global.localStorage=previous;}
});
