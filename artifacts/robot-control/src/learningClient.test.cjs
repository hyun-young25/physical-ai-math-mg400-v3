const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),ts=require("typescript");

function load(){
  const exports={};
  const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,"learningClient.ts"),"utf8"),{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
  }).outputText;
  new Function("exports","require",source)(exports,name=>{throw new Error(`Unexpected dependency ${name}`);});
  return exports;
}

test("reload restores only the cookie-backed current visit and explicit lock clears it without robot calls",async()=>{
  const previousFetch=global.fetch,requests=[];
  global.fetch=async(url,options)=>{
    requests.push({url,options});
    const response=url.endsWith("/student/restore")
      ?{user:{id:"TEST_ACCOUNT",role:"student",classCode:"",login:"연동검수01",visitId:"11111111-1111-4111-8111-111111111111"}}
      :{ok:true};
    return {ok:true,json:async()=>response};
  };
  try{
    const client=load();
    const restored=await client.restoreStudentVisit();
    assert.equal(restored.login,"연동검수01");
    assert.equal(client.getLearningUser().visitId,restored.visitId);
    assert.equal(requests[0].url,"/api/learning/student/restore");
    assert.equal(requests[0].options.method,"GET");
    assert.equal(requests[0].options.credentials,"same-origin");
    assert.equal(requests[0].options.body,undefined);
    await client.lockStudentVisit();
    assert.equal(requests[1].url,"/api/learning/lock");
    assert.equal(requests[1].options.method,"POST");
    assert.equal(client.getLearningUser(),null);
    assert.ok(requests.every(({url})=>!/robot|move|motion/i.test(url)),"restoration must never start robot movement");
  }finally{global.fetch=previousFetch;}
});

test("missing or invalid restoration response does not bind a student visit",async()=>{
  const previousFetch=global.fetch;
  global.fetch=async()=>({ok:true,json:async()=>({user:null})});
  try{
    const client=load();
    assert.equal(await client.restoreStudentVisit(),null);
    assert.equal(client.getLearningUser(),null);
  }finally{global.fetch=previousFetch;}
});
