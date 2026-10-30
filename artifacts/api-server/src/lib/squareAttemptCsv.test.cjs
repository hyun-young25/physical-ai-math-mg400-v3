const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),ts=require("typescript");
const cache={};function load(n){if(cache[n])return cache[n];const out=cache[n]={};new Function("exports","require",ts.transpileModule(fs.readFileSync(path.join(__dirname,n+".ts"),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(out,d=>load(d.replace("./","")));return out;}
const c=load("squareAttemptCsv");
test("new attempts export one recorded row with server-bound identity and no forged student ID",()=>{
 const storedAnalysis={provider:"openai",status:"provided",question:"검토 질문",text:"표시된 응답",runId:"run-7"};
 const rows=c.attemptRows({account_id:"real",visit_id:"visit",record_id:"record",payload:{task:"square-attempt",studentId:"forged",taskVersion:"v4-paper-merged",diagnosisType:"match",questionSource:"rules",studentCause:"=HYPERLINK(1)",teacherFlag:false,parentAttemptId:"previous",revisionReason:"축 방향을 다시 확인",aiAnalyses:[storedAnalysis]}});
 assert.equal(rows.length,1);assert.equal(rows[0].studentId,"real");assert.equal(rows[0].visitId,"visit");assert.match(c.attemptCsvLine(rows[0]),/'=HYPERLINK/);
 assert.deepEqual(rows[0].aiAnalyses,[storedAnalysis]);assert.equal(rows[0].parentAttemptId,"previous");
 assert.equal(rows[0].revisionReason,"축 방향을 다시 확인");assert.match(c.attemptCsvLine(rows[0]),/표시된 응답/);
 assert.equal(c.ATTEMPT_HEADERS.length,26);
});
test("legacy questions and causes are preserved; unknown version, task index and metrics stay blank",()=>{
 const event={record_id:"old",payload:{task:"square",prediction:{x:"20"},reason:"옛 근거",mismatchDiagnoses:[{type:"axis-swap",question:"당시 질문",causeExplanation:"당시 가설",runCount:2}]}};
 const before=JSON.stringify(event),row=c.attemptRows(event)[0];assert.equal(row.questionText,"당시 질문");assert.equal(row.studentCause,"당시 가설");for(const key of ["taskVersion","taskIndex","meanError","maxError","createdAt"])assert.equal(row[key],undefined);
 assert.equal(JSON.stringify(event),before);
 assert.equal(c.attemptRows({payload:{task:"square",prediction:{x:999}}}).length,0);
 assert.equal(c.attemptRows({payload:{...event.payload,taskVersion:"v4-paper-merged"}}).length,0);
});
test("legacy paper export does not invent GPT, teacher flag or average error",()=>{
 const row=c.attemptRows({payload:{task:"paper-coordinate",diagnosis:{status:"complete",pattern:"translation",question:"옛 종이 질문",tutorSource:"default question"},run:{id:"old-run",source:"mock"}}})[0];
 assert.equal(row.questionSource,"default question");assert.equal(row.teacherFlag,undefined);assert.equal(row.meanError,undefined);
});
test("filters use attempt time, selected lesson and version; legacy unknown fields are explicit",()=>{
 const row={createdAt:"2026-10-29T01:00:00Z",taskIndex:4,taskVersion:"v4-paper-merged"};
 assert(c.matchesAttempt(row,c.parseAttemptFilter({from:"2026-10-29T00:00:00Z",to:"2026-10-30T00:00:00Z",taskIndex:"4",taskVersion:"v4-paper-merged"})));
 assert(!c.matchesAttempt(row,{taskIndex:"5"}));assert(!c.matchesAttempt(row,{taskVersion:"legacy"}));assert(c.matchesAttempt({}, {taskVersion:"legacy"}));
 assert(!c.matchesAttempt({}, {from:"2026-10-29T00:00:00Z"}));assert.throws(()=>c.parseAttemptFilter({taskIndex:"4 OR 1=1"}));assert.throws(()=>c.parseAttemptFilter({from:"bad"}));assert.throws(()=>c.parseAttemptFilter({from:["bad"]}));
});
