import { Router, type IRouter } from "express";
import healthRouter from "./health";
import robotRouter from "./robot";
import learningRouter from "./learning";
import learningFeedbackRouter from "./learningFeedback";
import authRouter from "./auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(robotRouter);
router.use(learningRouter);
router.use(learningFeedbackRouter);
router.use(authRouter);

export default router;
