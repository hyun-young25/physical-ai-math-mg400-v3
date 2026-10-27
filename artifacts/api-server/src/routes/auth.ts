import { Router,type IRouter,type Request,type Response } from "express";
import { GetCurrentAuthUserResponse } from "@workspace/api-zod";
import { db,usersTable } from "@workspace/db";
import * as oidc from "openid-client";
import { getOidcConfig,createSession,clearSession,getSessionId,SESSION_COOKIE,SESSION_TTL } from "../lib/auth";
const router:IRouter=Router();
const flowCookie={httpOnly:true,secure:true,sameSite:"lax" as const,path:"/",maxAge:10*60*1000};
function origin(req:Request){
  const host=(req.get("x-forwarded-host")??req.get("host")??"").split(",")[0].trim();
  return `https://${host}`;
}
function returnTo(value:unknown){
  return typeof value==="string"&&value.startsWith("/")&&!value.startsWith("//")&&!/[\\\r\n]/.test(value)?value:"/";
}
router.get("/auth/user",(req,res)=>{
  res.set("Cache-Control","no-store");
  res.json(GetCurrentAuthUserResponse.parse({user:req.isAuthenticated()?req.user:null}));
});
router.get("/login",async(req,res)=>{
  const config=await getOidcConfig();
  const state=oidc.randomState(),nonce=oidc.randomNonce(),verifier=oidc.randomPKCECodeVerifier();
  const url=oidc.buildAuthorizationUrl(config,{
    redirect_uri:`${origin(req)}/api/callback`,scope:"openid email profile offline_access",
    code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:"S256",
    prompt:"login consent",state,nonce,
  });
  for(const [key,value]of Object.entries({code_verifier:verifier,nonce,state,return_to:returnTo(req.query.returnTo)}))
    res.cookie(key,value,flowCookie);
  res.redirect(url.href);
});
router.get("/callback",async(req,res)=>{
  const cookies=req.cookies??{};
  if(!cookies.code_verifier||!cookies.state||!cookies.nonce){res.status(401).send("인증 요청이 만료되었습니다. 교수자 버튼으로 다시 로그인하세요.");return;}
  try{
    const config=await getOidcConfig();
    const current=new URL(`${origin(req)}${req.originalUrl}`);
    // openid-client verifies signature, issuer, audience, nonce, state and expiry.
    const tokens=await oidc.authorizationCodeGrant(config,current,{
      pkceCodeVerifier:cookies.code_verifier,expectedNonce:cookies.nonce,expectedState:cookies.state,idTokenExpected:true,
    });
    const claims=tokens.claims();
    if(!claims?.sub||typeof claims.exp!=="number")throw new Error("Invalid identity");
    const data={id:claims.sub,email:typeof claims.email==="string"?claims.email:null,
      firstName:typeof claims.first_name==="string"?claims.first_name:null,
      lastName:typeof claims.last_name==="string"?claims.last_name:null,
      profileImageUrl:typeof claims.profile_image_url==="string"?claims.profile_image_url:null};
    await db.insert(usersTable).values(data).onConflictDoUpdate({target:usersTable.id,set:{...data,updatedAt:new Date()}});
    const sid=await createSession({user:data,access_token:tokens.access_token,refresh_token:tokens.refresh_token,expires_at:claims.exp});
    const old=getSessionId(req);if(old)await clearSession(res,old);
    res.cookie(SESSION_COOKIE,sid,{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:SESSION_TTL});
    const next=returnTo(cookies.return_to);
    for(const key of ["code_verifier","nonce","state","return_to"])res.clearCookie(key,{...flowCookie,maxAge:undefined});
    res.redirect(next);
  }catch{
    for(const key of ["code_verifier","nonce","state","return_to"])res.clearCookie(key,{...flowCookie,maxAge:undefined});
    res.status(401).send("계정 인증을 확인하지 못했습니다. 교수자 버튼으로 다시 로그인하세요.");
  }
});
router.get("/logout",async(req,res)=>{
  await clearSession(res,getSessionId(req));
  res.redirect(returnTo(req.query.returnTo));
});
export default router;
