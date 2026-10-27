const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),ts=require("typescript");
const A={id:"TEST-A",role:"student",login:"A",visitId:"11111111-1111-4111-8111-111111111111"};
const B={id:"TEST-B",role:"student",login:"B",visitId:"22222222-2222-4222-8222-222222222222"};
const KEY="physical-ai-inquiry-evidence-v1",pending=v=>`mg400:pending-visit:${v}`;
function fixture(){
  let user=A,fail=false,lostAck=false;
  const store=new Map(),requests=[],server=new Map();
  global.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k),
    key:i=>[...store.keys()][i]??null,get length(){return store.size;}};
  const client={getLearningUser:()=>user,learningRequest:async(url,method,body)=>{
    assert.equal(url,"/records");assert.equal(method,"POST","No historical GET is allowed");
    if(fail)throw new Error("TEST offline");
    requests.push(JSON.parse(JSON.stringify(body)));
    for(const e of body.events)server.set(`${body.visitId}:${e.eventId}`,e);
    if(lostAck){lostAck=false;throw new Error("TEST lost acknowledgement");}
    return {acknowledged:body.events.map(e=>e.eventId)};
  }};
  function load(){
    const out={},src=ts.transpileModule(fs.readFileSync(path.join(__dirname,"learningSync.ts"),"utf8"),
      {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
    new Function("exports","require",src)(out,()=>client);return out;
  }
  async function init(s){await s.initializeLearningSync(user);s.stopLearningSync();await new Promise(r=>setTimeout(r,0));}
  return {store,requests,server,load,init,setUser:v=>{user=v;},offline:v=>{fail=v;},loseAck:()=>{lostAck=true;}};
}
const evidence=z=>JSON.stringify([{id:"TEST-attempt",task:"foundation",prediction:{z},reason:z===40?"최초":"수정"}]);
test("initial prediction and revision survive offline reload and upload with original event IDs",async()=>{
  const f=fixture(),s=f.load();await f.init(s);f.offline(true);
  s.setEvidenceItem(KEY,evidence(40));s.setEvidenceItem(KEY,evidence(35));
  assert.equal(await s.flushLearningQueue(),false);
  const saved=JSON.parse(f.store.get(pending(A.visitId))).events;
  assert.deepEqual(saved.map(e=>e.payload.prediction.z),[40,35]);
  f.offline(false);const fresh=f.load();await f.init(fresh);await fresh.flushLearningQueue();
  assert.equal(f.server.size,2);assert.equal(f.requests[0].events[0].eventId,saved[0].eventId);
});
test("lost acknowledgement retry deduplicates, keeping the exact original upload IDs",async()=>{
  const f=fixture(),s=f.load();await f.init(s);s.setEvidenceItem(KEY,evidence(40));f.loseAck();
  assert.equal(await s.flushLearningQueue(),false);
  await s.flushLearningQueue();assert.equal(f.server.size,1);
  assert.equal(f.requests[0].events[0].eventId,f.requests[1].events[0].eventId);
});
test("inputs, prediction revisions and virtual execution transitions preserve visit, source and timestamps",async()=>{
  const f=fixture(),s=f.load();await f.init(s);
  const input=x=>JSON.stringify([{id:"TEST_fk_attempt",task:"TEST_fk",draft:{x:String(x)},prediction:{x},dataSource:"dt",runs:[]}]);
  s.setEvidenceItem(KEY,input(10));s.setEvidenceItem(KEY,input(15));
  s.recordLearningAction("TEST_fk","running",{id:"TEST_fk_run",runId:"TEST_run",startedAt:"2026-10-12T00:00:00Z"},"dt");
  s.recordLearningAction("TEST_fk","completed",{id:"TEST_fk_run",runId:"TEST_run",endedAt:"2026-10-12T00:00:01Z"},"dt");
  assert.equal(await s.flushLearningQueue(),true);
  const rows=[...f.server.values()];
  assert.equal(rows.length,4);
  assert.deepEqual(rows.slice(0,2).map(e=>[e.payload.draft.x,e.payload.prediction.x]),[["10",10],["15",15]]);
  assert.ok(!rows[0].eventKind.includes("실행"));
  assert.ok(rows[2].eventKind.includes("실행 시작"));assert.ok(rows[3].eventKind.includes("실행 완료"));
  assert.ok(rows.every(e=>e.dataSource==="dt"&&Number.isFinite(Date.parse(e.occurredAt))));
  assert.ok(f.requests.every(r=>r.visitId===A.visitId));
});
test("shared-PC switch retransmits A's pending visit as A, while B never sees A or anonymous records",async()=>{
  const f=fixture();f.store.set(KEY,'[{"id":"TEST-anonymous"}]');f.store.set("mg400:pending:TEST-A",'[{"id":"TEST-legacy"}]');
  const a=f.load();await f.init(a);f.offline(true);a.setEvidenceItem(KEY,evidence(40));await a.flushLearningQueue();
  f.setUser(B);const b=f.load();await f.init(b);
  assert.equal(b.getEvidenceItem(KEY),null);b.setEvidenceItem(KEY,evidence(15));
  f.offline(false);await b.flushLearningQueue();
  assert.equal(f.server.get([...f.server.keys()].find(k=>k.startsWith(A.visitId))).payload.prediction.z,40);
  assert.equal(f.server.get([...f.server.keys()].find(k=>k.startsWith(B.visitId))).payload.prediction.z,15);
  assert.ok(f.store.get(KEY).includes("TEST-anonymous"));assert.ok(f.store.get("mg400:pending:TEST-A").includes("TEST-legacy"));
});
test("typing the same ID creates a fresh cache namespace, not access to that ID's earlier work",async()=>{
  const f=fixture(),s=f.load();await f.init(s);s.setEvidenceItem(KEY,evidence(40));await s.flushLearningQueue();
  f.setUser({...A,visitId:B.visitId});const fresh=f.load();await f.init(fresh);
  assert.equal(fresh.getEvidenceItem(KEY),null);
});
test("unchanged and savedAt-only snapshots do not create fictitious activities; corrupted outbox is preserved",async()=>{
  const f=fixture(),s=f.load();await f.init(s);s.setEvidenceItem(KEY,evidence(40));s.setEvidenceItem(KEY,evidence(40));
  assert.equal(s.getLearningSaveState().pending,1);await s.flushLearningQueue();
  f.store.set(pending(A.visitId),"unreadable");const next=f.load();
  await assert.rejects(()=>f.init(next));assert.equal(f.store.get(pending(A.visitId)),"unreadable");
});
test("quota failure retains in-memory evidence and never claims successful durable queue cleanup",async()=>{
  const f=fixture(),s=f.load();await f.init(s);f.offline(true);
  global.localStorage.setItem=()=>{throw new Error("TEST quota");};
  assert.throws(()=>s.setEvidenceItem(KEY,evidence(40)));
  assert.equal(await s.flushLearningQueue(),false);f.offline(false);await s.flushLearningQueue();
  assert.equal(f.server.size,1);assert.equal(s.getLearningSaveState().state,"failed");
});
test("an unreadable older outbox is preserved without blocking a different student's valid upload",async()=>{
  const f=fixture();f.store.set(pending(A.visitId),"unreadable");f.setUser(B);
  const s=f.load();await f.init(s);s.setEvidenceItem(KEY,evidence(15));await s.flushLearningQueue();
  assert.ok([...f.server.keys()].some(key=>key.startsWith(B.visitId)));
  assert.equal(f.store.get(pending(A.visitId)),"unreadable");
});
