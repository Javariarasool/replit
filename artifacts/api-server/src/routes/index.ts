import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import storageRouter from "./storage";
import tendersRouter from "./tenders";
import evidenceRouter from "./evidence";
import proposalsRouter from "./proposals";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(storageRouter);
router.use(tendersRouter);
router.use(evidenceRouter);
router.use(proposalsRouter);

export default router;
