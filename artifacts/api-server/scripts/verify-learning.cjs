// Only fresh, randomly suffixed TEST labels. Never queries actual student records.
const assert=require("node:assert/strict"),path=require("node:path");
const {createRequire}=require("node:module"),{randomUUID}=require("node:crypto");
const pg=createRequire(path.resolve("lib/db/package.json"))("pg");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const base=`https://${process.env.REPLIT_DEV_DOMAIN}`,suffix=randomUUID().slice(0,8),ids=[];
async function call(url,{body,expected=200,origin=base,extra={}}={}){
  const res=await fetch(`${base}/api/learning${url}`,{method:body===undefined?"GET":"POST",
    headers:{"Content-Type":"application/json","X-Learning-Request":"1",Origin:origin,...extra},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
  assert.equal(res.status,expected,`${url}: unexpected status ${res.status}`);
  return res.json();
}
const event=(id,z,source="math")=>({eventId:randomUUID(),storeKey:"physical-ai-inquiry-evidence-v1",recordId:id,
  chapter:"기초수학",task:"TEST-foundation",eventKind:"예측·수치 확정",occurredAt:new Date().toISOString(),
  contentVersion:"TEST_ONLY",dataSource:source,changedPaths:["prediction.z","reason"],payload:{id,prediction:{z},reason:"TEST 최초/수정"}});
(async()=>{
  try{
    const loginA=`TEST_ID_A_${suffix}`,loginB=`TEST_ID_B_${suffix}`;
    const a=(await call("/student/enter",{body:{login:loginA}})).user;ids.push(a.id);
    const b=(await call("/student/enter",{body:{login:loginB,role:"teacher"}})).user;ids.push(b.id);
    assert.equal(a.role,"student");assert.equal(b.role,"student");assert.notEqual(a.id,b.id);
    const first=event("TEST_A_attempt",40),revision=event("TEST_A_attempt",35),other=event("TEST_B_attempt",15,"TEST_hardware");
    await call("/records",{body:{visitId:a.visitId,events:[first]}});
    await call("/records",{body:{visitId:b.visitId,events:[other],accountId:a.id,login:loginA}});
    await call("/records",{body:{visitId:a.visitId,events:[first,revision]}});
    const saved=(await pool.query("SELECT * FROM learning_events WHERE account_id=ANY($1::uuid[]) ORDER BY sequence",[ids])).rows;
    assert.equal(saved.length,3);assert.equal(saved.find(e=>e.event_id===first.eventId).payload.prediction.z,40);
    assert.equal(saved.find(e=>e.event_id===revision.eventId).payload.prediction.z,35);
    assert.equal(saved.find(e=>e.event_id===other.eventId).account_id,b.id);
    assert.equal(saved.find(e=>e.event_id===other.eventId).data_source,"TEST_hardware");
    const again=(await call("/student/enter",{body:{login:loginA}})).user;
    assert.equal(again.id,a.id);assert.notEqual(again.visitId,a.visitId);
    await call("/records",{expected:403});
    await call("/records",{body:{visitId:randomUUID(),events:[first]},expected:403});
    for(const endpoint of ["/session","/teacher/students","/teacher/records","/teacher/csv"])
      await call(endpoint,{expected:401,extra:{"X-Learning-Account":a.id,"X-Teacher-Role":"teacher",Cookie:"mg400_learning=TEST_LEGACY_SESSION"}});
    for(const endpoint of ["/owner/setup","/teacher/enter"])
      await call(endpoint,{body:{role:"teacher",login:loginA},expected:410});
    await call("/classes",{body:{code:"TEST",title:"TEST"},expected:410});
    await call("/student/enter",{body:{login:loginA},origin:"https://evil.invalid",expected:403});
    await call("/records",{body:{visitId:a.visitId,events:[{...first,eventId:randomUUID(),occurredAt:"invalid"}]},expected:400});
    const login=await fetch(`${base}/api/login?returnTo=%2F%3Fprofessor%3D1`,{redirect:"manual",signal:AbortSignal.timeout(25000)});
    assert.equal(login.status,302);
    const target=new URL(login.headers.get("location"));
    assert.equal(target.searchParams.get("code_challenge_method"),"S256");
    assert.ok(target.searchParams.has("state")&&target.searchParams.has("nonce"));
    assert.ok(login.headers.get("set-cookie").includes("HttpOnly"));
    const invalid=await fetch(`${base}/api/callback?code=TEST-invalid&state=TEST-invalid`);
    assert.equal(invalid.status,401);
    console.log("PASS API: ID-only entry; two independent visits; immutable original/revision; retries deduplicated; attribution is server-owned; same-ID fresh visit; all history/list/CSV and legacy role bypasses denied; no public teacher issuance; CSRF; real OIDC discovery/PKCE redirect and invalid callback rejection.");
  }finally{
    if(ids.length){
      await pool.query("DELETE FROM learning_events WHERE account_id=ANY($1::uuid[])",[ids]);
      await pool.query("DELETE FROM learning_visits WHERE account_id=ANY($1::uuid[])",[ids]);
      await pool.query("DELETE FROM learning_accounts WHERE id=ANY($1::uuid[])",[ids]);
    }
    await pool.end();
  }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
