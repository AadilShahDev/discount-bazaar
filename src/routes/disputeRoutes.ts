import { Router } from "express";
import { createDispute, getAdminDisputes, resolveDispute } from "../controllers/disputeController.js";
import { requireAuth, requireRole } from "../middlewares/authMiddleware.js";

const router = Router();

// Protected (Buyer) — open a dispute on a delivered order.
router.post("/", requireAuth, createDispute);

// Protected (Admin) — view open dispute tickets.
router.get("/", requireAuth, requireRole("Admin"), getAdminDisputes);

// Protected (Admin) — resolve a dispute (refund or reject).
router.put("/:id/resolve", requireAuth, requireRole("Admin"), resolveDispute);

export default router;
