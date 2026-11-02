const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),ts=require("typescript");

function load(secret="TEST_SESSION_SECRET_FOR_VISIT_PROOF_ONLY_32_CHARS"){
  const exports={};
  const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,"learningSecurity.ts"),"utf8"),{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true},
  }).outputText;
  new Function("exports","require","process",source)(exports,name=>{
    if(name==="@workspace/db")return {pool:{query:async()=>({rows:[]})}};
    return require(name);
  },{env:secret?{SESSION_SECRET:secret}:{}});
  return exports;
}

test("same-visit proof is signed, HttpOnly, time-limited and not a client-visible visit ID",()=>{
  const security=load(),now=1_800_000_000_000,visitId="11111111-1111-4111-8111-111111111111";
  const proof=security.createLearningVisitProof(visitId,now);
  assert.notEqual(proof,visitId);
  assert.equal(security.readLearningVisitProof(proof,now+1),visitId);
  assert.equal(security.readLearningVisitProof(proof,now+12*60*60*1000),null);
  assert.equal(security.readLearningVisitProof(`${proof}x`,now+1),null);
  const response={cookie(name,value,options){this.saved={name,value,options};},clearCookie(name,options){this.cleared={name,options};}};
  security.setLearningVisitCookie(response,proof);
  assert.equal(response.saved.name,security.VISIT_COOKIE);
  assert.equal(response.saved.value,proof);
  assert.equal(response.saved.options.httpOnly,true);
  assert.equal(response.saved.options.secure,true);
  assert.equal(response.saved.options.partitioned,true);
  assert.equal(response.saved.options.sameSite,"none");
  assert.equal(response.saved.options.maxAge,12*60*60*1000);
  security.eraseLearningVisitCookie(response);
  assert.equal(response.cleared.name,security.VISIT_COOKIE);
});

test("visit proof fails closed when the signing secret is absent or too short",()=>{
  const security=load("");
  assert.equal(security.readLearningVisitProof("anything"),null);
  assert.throws(()=>security.createLearningVisitProof("11111111-1111-4111-8111-111111111111"),/서버 세션 설정/);
});
