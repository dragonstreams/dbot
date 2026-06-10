import { Router, type IRouter } from "express";
import healthRouter from "./health";
import jellyfinRouter from "./jellyfin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(jellyfinRouter);

export default router;
