// Isolated owner policy and real routes. Never changes the workspace owner config.
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {createRequire}=require("node:module"),ts=require("typescript");
const express=createRequire(path.resolve("artifacts/api-server/package.json"))("express");
function fixture(pin="TEST_OWNER"){
  const statements=[];
  const rows=[{event_id:"TEST_EVENT_A",login:"TEST_A",payload:{prediction:{z:40},reason:"최초"},changed_paths:["prediction.z"]},
    {event_id:"TEST_EVENT_B",login:"TEST_B",payload:{prediction:{z:35},reason:"수정"},changed_paths:["prediction.z"]}];
  const pool={query:async(sql,args)=>{
    statements.push(sql);
    if(sql.includes("COALESCE(max(sequence)"))return {rows:[{n:100}],rowCount:1};
    if(sql.includes("latest WHERE sequence>"))return {rows:args.at(-1)===0?[{sequence:1,account_id:"TEST_ACCOUNT",visit_id:"TEST_VISIT",record_id:"attempt",payload:{task:"square-attempt",taskIndex:4,taskVersion:"v4-paper-merged",createdAt:"2026-10-29T01:00:00Z",questionText:"실제 저장 질문"}}]:[],rowCount:args.at(-1)===0?1:0};
    if(sql.includes("max(e.occurred_at)"))return {rows:[{login:"TEST_A"},{login:"TEST_B"}],rowCount:2};
    if(sql.includes("count(*)::int AS total"))return {rows:[{total:2}],rowCount:1};
    if(sql.includes("e.sequence>"))return {rows:args.at(-1)===0?rows.map((r,i)=>({...r,sequence:i+1})):[],rowCount:args.at(-1)===0?2:0};
    return {rows,rowCount:2};
  }};
  // ID-only entry stays isolated from both real accounts and the owner binding.
  pool.connect=async()=>({
    query:async(sql,args)=>{
      statements.push(sql);
      if(sql.startsWith("SELECT id,login"))return {rows:[{id:"10000000-0000-4000-8000-000000000001",login:currentLogin}]};
      if(sql.startsWith("INSERT INTO learning_accounts"))currentLogin=args[0];
      if(sql.startsWith("INSERT INTO learning_visits"))return {rows:[{id:require("node:crypto").randomUUID()}]};
      return {rows:[]};
    },release(){}
  });
  let currentLogin;
  const fakeProcess={env:{LEARNING_OWNER_REPLIT_ID:pin}};
  function load(file,deps={}){
    const out={};
    const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,file),"utf8"),{compilerOptions:{
      target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
    new Function("exports","require","process",source)(out,name=>{
      if(name in deps)return deps[name];if(name.startsWith("node:"))return require(name);
      throw new Error("Unmapped dependency "+name);
    },fakeProcess);return out;
  }
  const owner=load("../lib/learningOwner.ts"),csv=load("../lib/learningCsv.ts");
  const attemptCsv=load("../lib/squareAttemptCsv.ts",{"./learningCsv":csv});
  const router=load("learning.ts",{"../lib/squareAttemptCsv":attemptCsv,express,"@workspace/db":{pool},"../lib/learningOwner":owner,
    "../lib/learningSecurity":{loginLimit:()=>true},"../lib/learningCsv":csv}).default;
  async function call(route,id,{role="teacher",body={},query={}}={}){
    const handler=router.stack.find(l=>l.route?.path===route).route.stack[0].handle;
    const res={statusCode:200,body:null,text:"",destroyed:false,status(n){this.statusCode=n;return this;},
      json(v){this.body=v;return this;},set(){return this;},write(v){this.text+=v;return true;},end(){}};
    await handler({user:id?{id,firstName:"TEST"}:undefined,isAuthenticated:()=>!!id,
      body:{role,...body},query,get:()=>undefined},res);
    return res;
  }
  return {call,statements,owner};
}
test("a first numeric ID 1234 and ordinary text IDs enter with only login, never credentials or a course code",async()=>{
  for(const login of ["1234","studentABC","일반문자아이디"]){
    const f=fixture(),res=await f.call("/learning/student/enter",undefined,{body:{login}});
    assert.equal(res.statusCode,200);assert.equal(res.body.user.login,login);
    assert.equal(res.body.user.role,"student");assert.equal(res.body.user.classCode,"");
    assert.match(res.body.user.visitId,/^[a-f0-9-]{36}$/);
    assert.ok(f.statements.some(sql=>sql.includes("ON CONFLICT DO NOTHING")));
    assert.ok(f.statements.every(sql=>!/\bUPDATE\b|\bDELETE\b/.test(sql)));
  }
});
test("missing owner binding stays closed even for a verified account; first visitor never gets elevated",async()=>{
  const f=fixture("");
  for(const route of ["/learning/session","/learning/teacher/students","/learning/teacher/records","/learning/teacher/csv","/learning/teacher/attempts/csv"])
    assert.equal((await f.call(route,"TEST_FIRST_VISITOR")).statusCode,503);
  assert.equal(f.statements.length,0);
});
test("anonymous, ID-only, legacy teacher role and forged role headers cannot read owner data",async()=>{
  const f=fixture();
  for(const route of ["/learning/session","/learning/teacher/students","/learning/teacher/records","/learning/teacher/csv","/learning/teacher/attempts/csv"]){
    assert.equal((await f.call(route,undefined)).statusCode,401);
    assert.equal((await f.call(route,"TEST_OTHER",{role:"teacher"})).statusCode,403);
  }
  assert.equal(f.statements.length,0);
});
test("only the configured, verified subject sees all labels and complete CSV",async()=>{
  const f=fixture();
  const records=await f.call("/learning/teacher/records","TEST_OWNER");
  assert.equal(records.statusCode,200);assert.equal(records.body.total,2);
  assert.deepEqual(records.body.records.map(r=>r.login),["TEST_A","TEST_B"]);
  const csv=await f.call("/learning/teacher/csv","TEST_OWNER");
  assert.ok(csv.text.startsWith("\uFEFF"));
  for(const value of ["TEST_A","TEST_B","TEST_EVENT_A","TEST_EVENT_B","최초","수정"])
    assert.ok(csv.text.includes(value));
  assert.ok(f.statements.every(sql=>!sql.includes("JOIN learning_classes")));
});
test("old teacher creation/password entry routes are gone and never issue or change credentials",async()=>{
  const f=fixture();
  for(const route of ["/learning/owner/setup","/learning/teacher/enter"])
    assert.equal((await f.call(route,"TEST_OWNER")).statusCode,410);
  assert.equal(f.statements.length,0);
});
test("student history is denied even when caller knows a label or a visit",async()=>{
  const f=fixture();
  assert.equal((await f.call("/learning/records","TEST_OWNER")).statusCode,403);
  assert.equal(f.statements.length,0);
});

test("attempt CSV uses owner policy, stable latest snapshots and validated filters",async()=>{const f=fixture();const out=await f.call("/learning/teacher/attempts/csv","TEST_OWNER",{query:{taskIndex:"4",taskVersion:"v4-paper-merged"}});assert.equal(out.statusCode,200);assert.match(out.text,/실제 저장 질문/);assert.match(out.text,/TEST_VISIT/);assert.equal(out.text.trim().split(/\r?\n/).length,2);assert(f.statements.some(s=>s.includes("DISTINCT ON")&&s.includes("e.sequence<=$2")));const invalid=await f.call("/learning/teacher/attempts/csv","TEST_OWNER",{query:{taskIndex:"0 OR 1=1"}});assert.equal(invalid.statusCode,400);});
