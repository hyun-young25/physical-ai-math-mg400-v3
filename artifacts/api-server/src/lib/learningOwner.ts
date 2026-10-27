import type { Request,Response } from "express";
// This is a private workspace configuration, not a first-login enrolment.
// Exactly one immutable OIDC subject is allowed. No username/email/legacy role fallback.
export function requireLearningOwner(req: Request,res: Response) {
  if (!req.isAuthenticated?.() || !req.user?.id) {
    res.status(401).json({error:"교수자 계정 인증이 필요합니다."});return null;
  }
  const owner=process.env.LEARNING_OWNER_REPLIT_ID?.trim();
  if(!owner || !/^[A-Za-z0-9_-]{1,100}$/.test(owner)){
    res.status(503).json({error:"프로젝트 소유자 확인 설정이 필요합니다. 비공개 환경 변수 LEARNING_OWNER_REPLIT_ID에 본인의 인증된 계정 ID를 지정하세요."});return null;
  }
  if(req.user.id!==owner){res.status(403).json({error:"프로젝트 소유자만 학습 기록을 조회할 수 있습니다."});return null;}
  return {id:req.user.id,role:"teacher" as const,classCode:"",login:req.user.firstName||"소유자"};
}
