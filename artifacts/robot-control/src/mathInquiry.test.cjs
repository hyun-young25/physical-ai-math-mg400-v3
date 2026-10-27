const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function load(file,deps={}){deps={...require("./learningTestAdapter.cjs"),...deps};const exports={};new Function('exports','require',ts.transpileModule(fs.readFileSync(path.join(__dirname,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)(exports,n=>{assert.ok(n in deps,n);return deps[n]});return exports;}
const c=load('curriculum.ts'),f=load('learningFramework.ts'),m=load('MathInquiry.tsx',{'./LearningJudgment':load('LearningJudgment.tsx',{'react/jsx-runtime':{}}),'./ExplanationFeedbackPanel':{},'./explanationFeedback':load('explanationFeedback.ts'),'./curriculum':c,'./learningFramework':f,'./inquiryFeedback':load('inquiryFeedback.ts'),'./learningEvidenceStorage':load('learningEvidenceStorage.ts'),react:{},'react/jsx-runtime':{}});
const record=()=>({fields:[{key:'z',label:'상승 변화량'}],prediction:{z:'70'},runs:[{action:'mission',status:'completed',expected:{z:70}}]});
test('observed numeric comparison accepts display rounding but not a wrong reference or blank prediction',()=>{
 const r=record();r.runs[0].expected.z=69.998;assert.equal(m.compareInquiry(r)[0].matched,true);
 for(const prediction of ['60','',' ','NaN','Infinity']){r.prediction.z=prediction;assert.equal(m.compareInquiry(r)[0].matched,false);}
});
test('latest interruption never reuses a previous completed result for the same action',()=>{
 const r=record();r.runs.push({action:'mission',status:'stopped'});
 assert.deepEqual(m.compareInquiry(r),[]);assert.equal(m.latestInquiryRuns(r)[0].status,'stopped');
 assert.equal(r.runs[0].status,'completed');
});
test('two motion actions retain separate latest observations without overwriting original predictions',()=>{
 const r=record();r.fields=[{key:'end',label:'끝점'},{key:'path',label:'경로'}];r.prediction={end:'same',path:'same'};
 r.runs=[{action:'MoveJ',status:'completed',expected:{}},{action:'MoveL',status:'completed',expected:{end:'same',path:'different'}}];
 const before=JSON.stringify(r);assert.deepEqual(m.compareInquiry(r).map(x=>x.matched),[true,false]);assert.equal(JSON.stringify(r),before);
});
test('unreachable IK is a recorded model conclusion and contains no fabricated TCP result',()=>{
 const r=record();r.fields=[{key:'reachable',label:'해'},{key:'restored',label:'복원'}];r.prediction={reachable:'no',restored:'none'};
 r.runs=[{action:'kinematics',status:'unavailable',expected:{reachable:'no',restored:'none'},detail:{joints:null}}];
 assert.ok(m.compareInquiry(r).every(v=>v.matched));assert.equal(r.runs[0].status,'unavailable');assert.equal(r.runs[0].detail.observed,undefined);
});
test('same straight TCP path with different progress rates is not graded as a different geometry',()=>{
 const a={x:0,y:0,z:0},b={x:100,y:0,z:0};
 assert.equal(m.maximumLineDeviation([a,{x:10,y:0,z:0},{x:90,y:0,z:0},b],a,b),0);
 assert.equal(m.maximumLineDeviation([a,{x:50,y:20,z:0},b],a,b),20);
 assert.equal(m.maximumLineDeviation([{x:120,y:0,z:0}],a,b),20);
 assert.equal(m.maximumLineDeviation([a],a,a),0);
});

test('feedback review preserves the first prediction and only applies to its own execution',()=>{
 const r=record();r.prediction.z='60';r.answerReviews=[{answers:{z:'70'},runCount:1,at:'t'}];
 assert.equal(m.compareInquiry(r)[0].matched,false);assert.equal(m.currentInquiryComparison(r)[0].matched,true);
 assert.equal(r.prediction.z,'60');r.runs.push({action:'mission',status:'completed',expected:{z:80}});
 assert.equal(m.currentInquiryComparison(r)[0].prediction,'60');assert.equal(m.currentInquiryComparison(r)[0].matched,false);
});
test('a failed second judgment stays visible and is not replaced by an earlier successful review',()=>{
 const r=record();r.answerReviews=[{answers:{z:'70'},runCount:1,at:'t1'},{answers:{z:'60'},runCount:1,at:'t2'}];
 assert.equal(m.currentInquiryComparison(r)[0].matched,false);assert.equal(r.answerReviews.length,2);
});
