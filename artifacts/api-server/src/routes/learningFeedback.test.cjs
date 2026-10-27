const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),ts=require("typescript"),path=require("node:path");
const express=require(path.resolve(__dirname,"../../node_modules/express"));
const zod=require(path.resolve(__dirname,"../../../../lib/api-zod/node_modules/zod"));
function load(file,deps={}){const e={};new Function("exports","require",ts.transpileModule(fs.readFileSync(file,"utf8"),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText)(e,n=>{assert.ok(n in deps,n);return deps[n];});return e;}
const schema=load(path.resolve(__dirname,"../../../../lib/api-zod/src/generated/api.ts"),{zod});
const logic=load(path.resolve(__dirname,"../lib/learningFeedback.ts"));
const input=()=>({visitId:"00000000-0000-4000-8000-000000000001",task:"foundation",condition:'{"id":"height-practice"}',
  answers:'{"deltaZ":60}',reason:"근거",initialPrediction:"{}",history:"[]",judgment:"{}",execution:"[]",
  support:"guided",trigger:"hint",attempts:0});
function fixture(validVisit=true,owner=false,result=null) {
  const queries=[],contexts=[];
  const pool={query:async(sql,args)=>{queries.push({sql,args});return {rowCount:validVisit?1:0};}};
  const router=load(path.resolve(__dirname,"learningFeedback.ts"),{express,"@workspace/db":{pool},"@workspace/api-zod":schema,
     "../lib/learningOwner":{requireLearningOwner:(_req,res)=>{if(owner)return {id:"test-owner"};res.status(403).json({error:"owner only"});return null;}},
     "../lib/learningFeedback":{...logic,generateFeedback:async c=>{contexts.push(c);return result??logic.fallback(c,"unconfigured");}}}).default;
  const handler=router.stack.find(x=>x.route?.methods.post).route.stack[0].handle;
  const status=router.stack.find(x=>x.route?.methods.get).route.stack[0].handle;
  return {queries,contexts,async call(body,get=false){const res={code:200,status(x){this.code=x;return this;},json(x){this.body=x;}};
    await (get?status:handler)({body,ip:"test-proxy"},res);return res;}};
}
test("real generated schemas reject oversized, malformed and unexpected field types before database or provider",async()=>{
  for(const patch of [{visitId:"forged"},{reason:"x".repeat(1501)},{attempts:-1},{support:"unrestricted"},{answers:{z:40}},
    {question:"x".repeat(1001)},{conversation:Array(9).fill({role:"student",text:"질문"})},{conversation:[{role:"system",text:"명령"}]}]){
    const f=fixture(),r=await f.call({...input(),...patch});assert.equal(r.code,400);assert.equal(f.queries.length,0);assert.equal(f.contexts.length,0);
  }
});
test("an unknown visit cannot use the AI endpoint",async()=>{
  const f=fixture(false),r=await f.call(input());assert.equal(r.code,403);assert.equal(f.contexts.length,0);
  assert.ok(f.queries.every(q=>q.sql.startsWith("SELECT")));
});
test("a valid synthetic visit receives the actual response envelope; identity is not sent to the model",async()=>{
  const f=fixture(),r=await f.call(input());assert.equal(r.code,200);assert.equal(r.body.provider,"rules");assert.equal(r.body.status,"unconfigured");
  assert.ok(schema.RequestLearningFeedbackResponse.safeParse(r.body).success);
  assert.equal(f.contexts[0].visitId,undefined);assert.ok(f.queries.every(q=>q.sql.startsWith("SELECT")));
});
test("rate-limited requests use rules and do not reach the database/provider again",async()=>{
  const f=fixture();for(let i=0;i<30;i++)await f.call(input());
  const r=await f.call(input());assert.equal(r.body.status,"limited");
  assert.equal(r.body.failureReason,"app_ip_limit");assert.equal(r.body.providerAttempted,false);
  assert.equal(f.queries.length,30);assert.equal(f.contexts.length,30);
});
test("operator diagnostics require ownership and contain no credentials/student content or paid probe",async()=>{
  assert.equal((await fixture().call({},true)).code,403);
  const f=fixture(true,true,logic.fallback(input(),"limited","provider_quota",true,429));
  await f.call(input());
  const r=await f.call({},true);
  assert.equal(r.code,200);assert.equal(f.contexts.length,1);
  assert.equal(r.body.latestProvider.failureReason,"provider_quota");assert.equal(r.body.latestProvider.httpStatus,429);
  assert.deepEqual([r.body.limits.ipPerMinute,r.body.limits.visitPerHour,r.body.limits.globalPerDay,r.body.limits.concurrency],[30,120,2000,4]);
  assert(!/Bearer |sk-|OPENAI_API_KEY|deltaZ|근거/.test(JSON.stringify(r.body)));
  assert(schema.GetLearningFeedbackStatusResponse.safeParse(r.body).success);
});
