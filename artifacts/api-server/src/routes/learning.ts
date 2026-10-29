import { ATTEMPT_HEADERS,attemptRows,parseAttemptFilter,matchesAttempt,attemptCsvLine } from "../lib/squareAttemptCsv";
import { Router, type Request, type Response, type IRouter } from "express";
import { pool } from "@workspace/db";
import { eraseCookie, COOKIE, digest, loginLimit } from "../lib/learningSecurity";
import { CSV_HEADERS, csvCell, csvRows } from "../lib/learningCsv";
import { requireLearningOwner } from "../lib/learningOwner";

const router: IRouter = Router();
const MAX_RECORD_BYTES = 2 * 1024 * 1024;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const validDate = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));

router.use("/learning", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
// Custom header is required for mutations (cross-site HTML forms cannot set it).
// CORS is not credential-enabled. Partitioned cookies also support the HTTPS
// embedded preview; mutations still require this header and same-origin check.
router.use("/learning", (req, res, next) => {
  if (req.method !== "GET" && req.get("X-Learning-Request") !== "1") {
    res.status(403).json({ error: "허용되지 않은 요청입니다." }); return;
  }
  const origin = req.get("Origin");
  const host = (req.get("X-Forwarded-Host") ?? req.get("Host") ?? "").split(",")[0].trim();
  if(origin){try{if(new URL(origin).host!==host)throw new Error("origin");}
    catch{res.status(403).json({error:"다른 사이트에서는 접근할 수 없습니다."});return;}}
  next();
});
router.get("/learning/session", async (req, res) => {
  const owner = requireLearningOwner(req,res);if(owner)res.json({user:owner});
});
// A shared-PC page reload locks the prior account before showing entry.
router.post("/learning/lock", async (req,res) => {
  const token: unknown = req.cookies?.[COOKIE];
  if (typeof token === "string") await pool.query("DELETE FROM learning_sessions WHERE token_hash=$1",[digest(token)]);
  eraseCookie(res); res.json({ok:true});
});
router.post("/learning/student/enter", async (req, res) => {
  if (!loginLimit(req, res)) return;
  const login = typeof req.body?.login==="string" ? req.body.login.trim() : "";
  if(!login || login.length>60 || /[\u0000-\u001f\u007f]/.test(login)){
    res.status(400).json({error:"학생 아이디를 1~60자로 입력하세요."});return;
  }
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    // A different role namespace prevents ID-only visitors from inheriting old
    // password-protected accounts or anonymously stored records.
    await client.query("INSERT INTO learning_accounts(role,class_code,login,password_hash) VALUES('learner','',$1,'ID_ONLY_NO_PASSWORD_AUTH') ON CONFLICT DO NOTHING",[login]);
    const found=await client.query("SELECT id,login FROM learning_accounts WHERE role='learner' AND class_code='' AND login=$1",[login]);
    const account=found.rows[0];
    const visit=await client.query("INSERT INTO learning_visits(account_id) VALUES($1) RETURNING id",[account.id]);
    await client.query("COMMIT");
    res.json({user:{id:account.id,role:"student",classCode:"",login:account.login,visitId:visit.rows[0].id}});
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
});
for(const path of ["/learning/teacher/enter","/learning/owner/setup"])
  router.post(path,(_req,res)=>{res.status(410).json({error:"공개 교수자 가입·초기 설정과 비밀번호 입장은 사용하지 않습니다. 교수자 버튼의 계정 인증을 사용하세요."});});
router.post("/learning/logout", async (req, res) => {
  const token=req.cookies?.[COOKIE];
  if(typeof token==="string")await pool.query("DELETE FROM learning_sessions WHERE token_hash=$1",[digest(token)]);
  eraseCookie(res); res.json({ ok: true });
});
router.get("/learning/classes", async (req, res) => {
  res.status(410).json({error:"수업 코드와 수업 개설은 더 이상 필요하지 않습니다."});
});
router.post("/learning/classes", async (req, res) => {
  res.status(410).json({error:"수업 개설은 더 이상 사용하지 않습니다. 기존 수업 자료는 보존됩니다."});
});
router.get("/learning/records", async (req, res) => {
  res.status(403).json({error:"학생 아이디는 로그 식별값이며 이전 기록 조회 권한을 주지 않습니다."});
});
router.post("/learning/records", async (req, res) => {
  // Opaque, server-issued visit is append-only. It grants no read/CSV/owner role.
  // Old pending visits can retry after the next student starts, without reattribution.
  const visitId=req.body?.visitId;
  if(typeof visitId!=="string"||!uuidPattern.test(visitId)){res.status(403).json({error:"학습 시작 정보를 확인하세요."});return;}
  const found=await pool.query("SELECT v.account_id FROM learning_visits v JOIN learning_accounts a ON a.id=v.account_id WHERE v.id=$1 AND a.role='learner'",[visitId]);
  if(!found.rowCount){res.status(403).json({error:"학습 시작 정보를 확인하세요."});return;}
  const accountId=found.rows[0].account_id;
  const events: unknown = req.body?.events;
  if (!Array.isArray(events) || events.length < 1 || events.length > 30) { res.status(400).json({ error: "기록 묶음이 올바르지 않습니다." }); return; }
  for (const e of events) {
    if (!e || typeof e !== "object" || !uuidPattern.test(e.eventId) || typeof e.storeKey !== "string"
      || !e.storeKey.startsWith("physical-ai-") || e.storeKey.length > 140 || typeof e.recordId !== "string" || e.recordId.length > 200
      || typeof e.chapter !== "string" || e.chapter.length > 100 || typeof e.task !== "string" || e.task.length > 200
      || typeof e.eventKind !== "string" || e.eventKind.length > 200 || !validDate(e.occurredAt)
      || typeof e.contentVersion !== "string" || e.contentVersion.length > 100 || typeof e.dataSource !== "string" || e.dataSource.length > 50
      || !Array.isArray(e.changedPaths) || e.changedPaths.length > 1000 || !e.changedPaths.every((p: unknown) => typeof p === "string" && p.length <= 1000)
      || !e.payload || typeof e.payload !== "object" || Array.isArray(e.payload)
       || Buffer.byteLength(JSON.stringify(e.payload),"utf8") > MAX_RECORD_BYTES) {
      res.status(400).json({ error: "기록 형식이나 크기를 확인해주세요." }); return;
    }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const e of events) {
      // Attribution comes exclusively from the original server-issued visit.
      await client.query(
        `INSERT INTO learning_events(event_id,account_id,store_key,record_id,chapter,task,event_kind,occurred_at,content_version,data_source,payload,changed_paths,visit_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(account_id,event_id) DO NOTHING`,
        [e.eventId,accountId,e.storeKey,e.recordId,e.chapter,e.task,e.eventKind,e.occurredAt,e.contentVersion,e.dataSource,JSON.stringify(e.payload),JSON.stringify(e.changedPaths),visitId]);
    }
    await client.query("COMMIT");
    res.json({ acknowledged: events.map(e => e.eventId) });
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
});

function filters(req: Request) {
  const values: unknown[] = [];
  const conditions = ["a.role IN ('student','learner')"];
  const field = (name: string, column: string) => {
    const value = req.query[name];
    if (value === undefined || value === "") return;
    if (typeof value !== "string" || value.length > 200) throw new Error("filter");
    values.push(value); conditions.push(`${column}=$${values.length}`);
  };
  field("classCode","a.class_code"); field("login","a.login"); field("chapter","e.chapter");
  for (const name of ["from","to"] as const) {
    const value = req.query[name];
    if (value === undefined || value === "") continue;
    if (!validDate(value)) throw new Error("filter");
    values.push(value); conditions.push(`e.occurred_at${name==="from"?">=":"<"}$${values.length}`);
  }
  return { values, where: conditions.join(" AND ") };
}
router.get("/learning/teacher/students", async (req, res) => {
  if(!requireLearningOwner(req,res))return;
  // One project owner sees all labelled IDs, including preserved legacy records.
  const result = await pool.query(
    `SELECT '' AS class_code,a.login,min(a.id::text) AS id,count(e.sequence)::int AS record_count,
      (count(DISTINCT (e.account_id,e.visit_id,e.store_key,e.record_id)) FILTER(WHERE e.sequence IS NOT NULL))::int AS attempt_count,max(e.occurred_at) AS last_activity
      FROM learning_accounts a LEFT JOIN learning_events e ON e.account_id=a.id
      WHERE a.role IN ('student','learner')
      GROUP BY a.login ORDER BY max(e.occurred_at) DESC NULLS LAST,a.login`);
  res.json({ students: result.rows });
});
router.get("/learning/teacher/records", async (req, res) => {
  if(!requireLearningOwner(req,res))return;
  let f; try { f = filters(req); } catch { res.status(400).json({ error: "필터가 올바르지 않습니다." }); return; }
  const offset = Number(req.query.offset ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) { res.status(400).json({ error: "페이지가 올바르지 않습니다." }); return; }
  const common = `FROM learning_events e JOIN learning_accounts a ON a.id=e.account_id WHERE ${f.where}`;
  const [records, total] = await Promise.all([
    pool.query(`SELECT e.*,a.class_code,a.login ${common} ORDER BY e.sequence DESC LIMIT 100 OFFSET $${f.values.length+1}`, [...f.values,offset]),
    pool.query(`SELECT count(*)::int AS total ${common}`, f.values),
  ]);
  res.json({ records: records.rows, total: total.rows[0].total, offset, limit: 100 });
});
router.get("/learning/teacher/csv", async (req, res) => {
  if(!requireLearningOwner(req,res))return;
  let f; try { f=filters(req); } catch { res.status(400).json({ error: "필터가 올바르지 않습니다." }); return; }
  // Same filter construction as the on-screen records; all matching pages are exported.
  res.set("Content-Type","text/csv; charset=utf-8");
  res.set("Content-Disposition",'attachment; filename="mg400-learning.csv"; filename*=UTF-8\'\'MG400-%ED%95%99%EC%8A%B5%EA%B8%B0%EB%A1%9D.csv');
  res.write("\uFEFF" + CSV_HEADERS.map(csvCell).join(",") + "\r\n");
  let after = 0;
  while (!res.destroyed) {
    const result = await pool.query(
       `SELECT e.*,a.class_code,a.login FROM learning_events e JOIN learning_accounts a ON a.id=e.account_id
        WHERE ${f.where} AND e.sequence>$${f.values.length+1}
       ORDER BY e.sequence LIMIT 100`, [...f.values,after]);
    if (!result.rowCount) break;
    for (const event of result.rows) {
      for (const row of csvRows(event)) {
        if(res.destroyed)break;
        if(!res.write(row)) await new Promise<void>(resolve=>{
          const done=()=>{res.off("drain",done);res.off("close",done);resolve();};
          res.once("drain",done);res.once("close",done);
          if(res.destroyed)done();
        });
      }
      after=Number(event.sequence);
    }
  }
  res.end();
});
router.get("/learning/teacher/attempts/csv", async (req,res)=>{
 if(!requireLearningOwner(req,res))return;
 let f;try{f=parseAttemptFilter(req.query);}catch{res.status(400).json({error:"시도 필터가 올바르지 않습니다."});return;}
 const login=req.query.login;
 if(login!==undefined&&(typeof login!=="string"||login.length>200)){res.status(400).json({error:"학생 필터가 올바르지 않습니다."});return;}
 const ceiling=await pool.query("SELECT COALESCE(max(sequence),0) AS n FROM learning_events");
 const limit=ceiling.rows[0].n;
 res.set("Content-Type","text/csv; charset=utf-8");
 res.set("Content-Disposition",'attachment; filename="mg400-square-attempts.csv"');
 res.write("\uFEFF"+ATTEMPT_HEADERS.map(csvCell).join(",")+"\r\n");
 let after=0;
 // Select the latest snapshot first, then filter by the attempt date. Stable ceiling prevents duplicate rows during updates.
 while(!res.destroyed){
 const result=await pool.query(
 `SELECT * FROM (
 SELECT DISTINCT ON (e.account_id,e.visit_id,e.store_key,e.record_id,
 CASE WHEN e.task='paper-coordinate' THEN e.payload->'run'->>'id' ELSE '' END) e.*
 FROM learning_events e JOIN learning_accounts a ON a.id=e.account_id
 WHERE a.role IN ('student','learner') AND ($1::text IS NULL OR a.login=$1)
 AND e.task IN ('square-attempt','square','paper-coordinate') AND e.sequence<=$2
 ORDER BY e.account_id,e.visit_id,e.store_key,e.record_id,
 CASE WHEN e.task='paper-coordinate' THEN e.payload->'run'->>'id' ELSE '' END,e.sequence DESC
 ) latest WHERE sequence>$3 ORDER BY sequence LIMIT 100`,[login||null,limit,after]);
 if(!result.rowCount)break;
 for(const event of result.rows){
 for(const row of attemptRows(event).filter(r=>matchesAttempt(r,f))){
 if(res.destroyed)break;
 if(!res.write(attemptCsvLine(row)))await new Promise<void>(resolve=>{const done=()=>{res.off("drain",done);res.off("close",done);resolve();};res.once("drain",done);res.once("close",done);if(res.destroyed)done();});
 }after=Number(event.sequence);
 }
 }res.end();
});
export default router;
