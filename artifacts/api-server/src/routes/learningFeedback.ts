import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { RequestLearningFeedbackBody, RequestLearningFeedbackResponse, GetLearningFeedbackStatusResponse,
  type LearningFeedbackDiagnostic, type LearningFeedback } from "@workspace/api-zod";
import { createFeedbackBudget, fallback, generateFeedback } from "../lib/learningFeedback";
import { requireLearningOwner } from "../lib/learningOwner";

const router: IRouter = Router();
const budget = createFeedbackBudget();
let latest:LearningFeedbackDiagnostic|undefined,latestProvider:LearningFeedbackDiagnostic|undefined;
const note=(result:LearningFeedback)=>{
  latest={status:result.status,failureReason:result.failureReason,providerAttempted:!!result.providerAttempted,
    httpStatus:result.httpStatus,at:result.createdAt};
  if(result.providerAttempted)latestProvider=latest;
  return result;
};
router.get("/learning/feedback/status",(req,res)=>{
  if(!requireLearningOwner(req,res))return;
  res.json(GetLearningFeedbackStatusResponse.parse({configured:!!process.env.OPENAI_API_KEY,model:"gpt-5-mini",
    latest,latestProvider,limits:budget.status()}));
});
// Mounted after learning router: shares its same-origin/custom-header checks.
router.post("/learning/feedback", async (req,res): Promise<void> => {
  const input=RequestLearningFeedbackBody.safeParse(req.body);
  if(!input.success || Buffer.byteLength(JSON.stringify(req.body),"utf8")>34000) {
    res.status(400).json({error:"피드백 자료의 형식이나 길이를 확인하세요."});return;
  }
  const {visitId,...context}=input.data;
  const release=budget.acquire(req.ip??"unknown",visitId);
  if(!release) { res.json(RequestLearningFeedbackResponse.parse(note(fallback(context,"limited",budget.denialReason()??"app_global_limit"))));return; }
  try {
    const found=await pool.query("SELECT 1 FROM learning_visits WHERE id=$1",[visitId]);
    if(!found.rowCount){res.status(403).json({error:"학습 시작 정보를 확인하세요."});return;}
    res.json(RequestLearningFeedbackResponse.parse(note(await generateFeedback(context))));
  } finally { release(); }
});
export default router;
