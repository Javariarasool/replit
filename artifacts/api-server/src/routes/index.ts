import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import storageRouter from "./storage";
import tendersRouter from "./tenders";
import tenderRequirementsRouter from "./tender-requirements";
import evidenceRouter from "./evidence";
import proposalsRouter from "./proposals";
import libraryRouter from "./proposal-library";
import extractionRouter from "./document-extractions";
import requirementItemsRouter from "./requirement-items";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(storageRouter);
router.use(tendersRouter);
router.use(tenderRequirementsRouter);
router.use(evidenceRouter);
router.use(proposalsRouter);
router.use(libraryRouter);
router.use(extractionRouter);
router.use(requirementItemsRouter);

export default router;
