import type { AuthUser } from "@workspace/api-zod";
import type { NextFunction, Request, Response } from "express";
import * as oidc from "openid-client";
import { clearSession, getOidcConfig, getSession, getSessionId, updateSession, type SessionData } from "../lib/auth";
declare global {
  namespace Express {
    interface User extends AuthUser {}
    interface Request {
      isAuthenticated(): this is AuthedRequest;
      user?: User;
    }
    interface AuthedRequest { user: User; }
  }
}
async function refresh(sid: string, session: SessionData): Promise<SessionData | null> {
  const now = Math.floor(Date.now()/1000);
  if (!session.expires_at) return null;
  if (now < session.expires_at) return session;
  if (!session.refresh_token) return null;
  try {
    const tokens = await oidc.refreshTokenGrant(await getOidcConfig(), session.refresh_token);
    const claims=tokens.claims();
    if(claims?.sub&&claims.sub!==session.user.id)return null;
    session.access_token=tokens.access_token;
    session.refresh_token=tokens.refresh_token??session.refresh_token;
    if(!tokens.expiresIn())return null;
    session.expires_at=now+tokens.expiresIn()!;
    await updateSession(sid,session);
    return session;
  } catch { return null; }
}
export async function authMiddleware(req: Request,res: Response,next: NextFunction) {
  req.isAuthenticated = function(this: Request) {return this.user!=null;} as Request["isAuthenticated"];
  const sid=getSessionId(req);
  if(!sid){next();return;}
  const session=await getSession(sid);
  const live=session?.user?.id?await refresh(sid,session):null;
  if(!live){await clearSession(res,sid);next();return;}
  req.user=live.user;next();
}
