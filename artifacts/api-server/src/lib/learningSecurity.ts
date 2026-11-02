import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash, createHmac } from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response } from "express";
import { pool } from "@workspace/db";

const scrypt = promisify(scryptCallback);
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function verifyOwnerSetupSecret(configured: string | undefined, supplied: unknown) {
  if (!configured || configured.length < 32 || typeof supplied !== "string" || supplied.length > 512) return false;
  return timingSafeEqual(Buffer.from(digest(configured),"hex"),Buffer.from(digest(supplied),"hex"));
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [salt, hex] = encoded.split(":");
  if (!salt || !hex || hex.length !== 128) return false;
  const actual = await scrypt(password, salt, 64) as Buffer;
  return timingSafeEqual(actual, Buffer.from(hex, "hex"));
}
export const COOKIE = "mg400_learning";
export const VISIT_COOKIE = "mg400_learning_visit";
const VISIT_SESSION_MS = 12 * 60 * 60 * 1000;
const VISIT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function visitProofSecret() {
  const secret=process.env.SESSION_SECRET;
  if(!secret||secret.length<32)throw new Error("방문 복구를 위한 서버 세션 설정이 없습니다.");
  return secret;
}
export function createLearningVisitProof(visitId: string, now = Date.now()) {
  if(!VISIT_ID_PATTERN.test(visitId))throw new Error("유효하지 않은 방문 식별자입니다.");
  const payload=Buffer.from(JSON.stringify({visitId,expiresAt:now+VISIT_SESSION_MS})).toString("base64url");
  const signature=createHmac("sha256",visitProofSecret()).update(`mg400-learning-visit:${payload}`).digest("hex");
  return `${payload}.${signature}`;
}
export function readLearningVisitProof(value: unknown, now = Date.now()): string | null {
  if(typeof value!=="string"||value.length>512)return null;
  const [payload,signature,extra]=value.split(".");
  if(!payload||!signature||extra!==undefined||!/^[a-f0-9]{64}$/i.test(signature))return null;
  try{
    const expected=createHmac("sha256",visitProofSecret()).update(`mg400-learning-visit:${payload}`).digest();
    const received=Buffer.from(signature,"hex");
    if(received.length!==expected.length||!timingSafeEqual(received,expected))return null;
    const decoded=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
    if(!VISIT_ID_PATTERN.test(decoded?.visitId)||!Number.isSafeInteger(decoded?.expiresAt)||decoded.expiresAt<=now)return null;
    return decoded.visitId;
  }catch{return null;}
}
export type Account = { id: string; role: "student" | "teacher"; class_code: string; login: string };
export function publicAccount(a: Account) {
  return { id: a.id, role: a.role, classCode: a.class_code, login: a.login };
}
export async function accountFor(req: Request): Promise<Account | null> {
  const token: unknown = req.cookies?.[COOKIE];
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
  const result = await pool.query(
    `SELECT a.id,a.role,a.class_code,a.login FROM learning_sessions s
     JOIN learning_accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>now()`, [digest(token)]);
  return result.rows[0] ?? null;
}
export async function createSession(res: Response, a: Account) {
  const token = randomBytes(32).toString("hex");
  await pool.query("INSERT INTO learning_sessions(token_hash,account_id,expires_at) VALUES($1,$2,$3)",
    [digest(token), a.id, new Date(Date.now() + 12 * 60 * 60 * 1000)]);
  // Replit's HTTPS preview is embedded cross-site. A partitioned HttpOnly
  // cookie works there without sharing the session with unrelated top sites.
  // Mutations additionally require the same-origin/custom-header CSRF checks.
  res.cookie(COOKIE, token, { httpOnly: true, secure: true, partitioned: true,
    sameSite: "none", path: "/api/learning", maxAge: 12 * 60 * 60 * 1000 });
}
export function eraseCookie(res: Response) {
  res.clearCookie(COOKIE, { path: "/api/learning", httpOnly: true, sameSite: "none",
    secure: true, partitioned: true });
}
export function setLearningVisitCookie(res: Response, proof: string) {
  res.cookie(VISIT_COOKIE, proof, { httpOnly: true, secure: true, partitioned: true,
    sameSite: "none", path: "/api/learning", maxAge: VISIT_SESSION_MS });
}
export function eraseLearningVisitCookie(res: Response) {
  res.clearCookie(VISIT_COOKIE, { path: "/api/learning", httpOnly: true, sameSite: "none",
    secure: true, partitioned: true });
}

// Bounded rate limit; passwords are never logged or used as keys. Login is hashed.
const failures = new Map<string, { count: number; until: number }>();
export function loginLimit(req: Request, res: Response): boolean {
  const login = typeof req.body?.login === "string" ? req.body.login.slice(0,60) : "";
  const key = `${req.ip ?? "unknown"}:${digest(login)}`;
  const now = Date.now();
  for (const [ip, item] of failures) if (item.until < now) failures.delete(ip);
  if (failures.size > 10000) { res.status(429).json({ error: "잠시 뒤 다시 입장하세요." }); return false; }
  const entry = failures.get(key) ?? { count: 0, until: now + 15 * 60 * 1000 };
  entry.count++; failures.set(key, entry);
  if (entry.count > 50) { res.status(429).json({ error: "입장 시도가 너무 많습니다. 15분 뒤 다시 시도하세요." }); return false; }
  return true;
}
