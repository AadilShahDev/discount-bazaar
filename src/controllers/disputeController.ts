import { type Request, type Response } from "express";
import mongoose, { Types } from "mongoose";
import Dispute from "../models/Dispute.js";
import Order from "../models/Order.js";
import Transaction from "../models/Transaction.js";
import {
  DisputeStatus as DisputeStatusEnum,
  type DisputeIssueType,
  EscrowState as EscrowStateEnum,
  OrderLogisticsStatus as LogisticsEnum,
} from "../types/enums.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { refundFunds } from "../utils/safepay.js";

/* ------------------------------------------------------------------ */
/* Step 3.2 — createDispute (Buyer)                                   */
/* ------------------------------------------------------------------ */

interface CreateDisputeBody {
  orderId?: string;
  issueType?: DisputeIssueType;
  description?: string;
  evidenceUrls?: string[];
}

/**
 * POST /api/disputes
 * Protected (Buyer). Opens a dispute on a delivered order. Validates that the
 * order belongs to the authenticated buyer and is in Delivered status before
 * creating the Dispute document.
 */
export const createDispute = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const buyerId = req.user?.userId;
    const { orderId, issueType, description, evidenceUrls } = req.body as CreateDisputeBody;

    if (!buyerId) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    if (!orderId || !Types.ObjectId.isValid(orderId)) {
      res.status(400).json({ error: "A valid orderId is required." });
      return;
    }
    if (!issueType) {
      res.status(400).json({ error: "issueType is required." });
      return;
    }
    if (!description || description.trim().length < 10) {
      res.status(400).json({ error: "description must be at least 10 characters." });
      return;
    }

    const order = await Order.findById(orderId).lean();
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    if (order.buyerId.toString() !== buyerId) {
      res.status(403).json({ error: "This order does not belong to you." });
      return;
    }
    if (order.logisticsStatus !== LogisticsEnum.Delivered) {
      res.status(409).json({ error: "A dispute can only be opened on a delivered order." });
      return;
    }

    // One open dispute per order — avoid duplicate tickets.
    const existingOpen = await Dispute.findOne({
      orderId: order._id,
      status: { $in: [DisputeStatusEnum.Open, DisputeStatusEnum.UnderReview] },
    })
      .lean()
      .select("_id");
    if (existingOpen) {
      res.status(409).json({ error: "An open dispute already exists for this order." });
      return;
    }

    const dispute = await Dispute.create({
      orderId: order._id,
      buyerId: order.buyerId,
      supplierId: order.supplierId,
      issueType,
      description: description.trim(),
      evidenceUrls: Array.isArray(evidenceUrls) ? evidenceUrls : [],
      status: DisputeStatusEnum.Open,
    });

    res.status(201).json({
      message: "Dispute opened.",
      data: { disputeId: dispute._id, orderId: order._id, status: dispute.status },
    });
  },
);

/* ------------------------------------------------------------------ */
/* Step 3.3 — getAdminDisputes (Admin)                                */
/* ------------------------------------------------------------------ */

interface GetAdminDisputesQuery {
  status?: string;
  page?: string;
  limit?: string;
}

/**
 * GET /api/disputes
 * Protected (Admin). Returns a paginated list of open/under-review dispute
 * tickets for the admin command center, optionally filtered by status.
 */
export const getAdminDisputes = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { status, page, limit } = req.query as GetAdminDisputesQuery;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    // Default to open tickets only unless the admin requests otherwise.
    const filter: Record<string, unknown> = {};
    if (status) {
      filter.status = status;
    } else {
      filter.status = { $in: [DisputeStatusEnum.Open, DisputeStatusEnum.UnderReview] };
    }

    const [items, total] = await Promise.all([
      Dispute.find(filter)
        .populate({ path: "orderId", select: "purchaseType totals logisticsStatus" })
        .populate({ path: "buyerId", select: "phoneNumber fullName" })
        .populate({ path: "supplierId", select: "phoneNumber fullName" })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Dispute.countDocuments(filter),
    ]);

    res.status(200).json({
      data: items,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 0,
      },
    });
  },
);

/* ------------------------------------------------------------------ */
/* Step 2 — resolveDispute (Admin)                                    */
/* ------------------------------------------------------------------ */

interface ResolveDisputeBody {
  resolution?: "Refund" | "Reject";
  admin_notes?: string;
}

/**
 * PUT /api/disputes/:id/resolve
 * Protected (Admin). Resolves a dispute by either refunding the buyer or
 * rejecting the claim.
 *
 * - Reject: closes the dispute and records the admin's notes.
 * - Refund: in a Mongoose transaction, calls Safepay to refund the captured
 *   transaction, marks the Order as refunded, flips the Transaction escrow
 *   state to Refunded, and marks the dispute as Refunded.
 */
export const resolveDispute = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const adminId = req.user?.userId;
    const { id } = req.params;
    const { resolution, admin_notes } = req.body as ResolveDisputeBody;

    if (!adminId) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    if (!id || !Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: "A valid dispute id is required." });
      return;
    }
    if (resolution !== "Refund" && resolution !== "Reject") {
      res.status(400).json({ error: "resolution must be 'Refund' or 'Reject'." });
      return;
    }
    if (!admin_notes || admin_notes.trim().length < 5) {
      res.status(400).json({ error: "admin_notes must be at least 5 characters." });
      return;
    }

    const dispute = await Dispute.findById(id);
    if (!dispute) {
      res.status(404).json({ error: "Dispute not found." });
      return;
    }
    // Only active disputes can be resolved.
    if (
      dispute.status === DisputeStatusEnum.Closed ||
      dispute.status === DisputeStatusEnum.Refunded ||
      dispute.status === DisputeStatusEnum.Rejected
    ) {
      res.status(409).json({ error: "This dispute is already resolved." });
      return;
    }

    /* ---- Reject path (no money movement) ---- */
    if (resolution === "Reject") {
      dispute.status = DisputeStatusEnum.Closed;
      dispute.resolutionNote = admin_notes.trim();
      dispute.resolvedBy = new Types.ObjectId(adminId);
      dispute.resolvedAt = new Date();
      await dispute.save();

      res.status(200).json({
        message: "Dispute rejected and closed.",
        data: { disputeId: dispute._id, status: dispute.status },
      });
      return;
    }

    /* ---- Refund path (transactional money movement) ---- */
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const order = await Order.findById(dispute.orderId).session(session);
        if (!order) {
          throw new Error(`Order ${dispute.orderId} not found for dispute ${dispute._id}.`);
        }

        const txn = await Transaction.findById(order.transactionId).session(session);
        if (!txn) {
          throw new Error(
            `Transaction ${order.transactionId} not found for order ${order._id}.`,
          );
        }
        if (txn.escrowState !== EscrowStateEnum.Captured) {
          throw new Error(
            `Cannot refund: transaction escrow state is ${txn.escrowState}, expected Captured.`,
          );
        }

        // Mock Safepay refund of the captured deposit back to the buyer's card.
        await refundFunds(txn.safepayTrackerId, txn.holdAmount);

        txn.escrowState = EscrowStateEnum.Refunded;
        await txn.save({ session });

        order.isRefunded = true;
        order.refundedAt = new Date();
        await order.save({ session });

        dispute.status = DisputeStatusEnum.Refunded;
        dispute.resolutionNote = admin_notes.trim();
        dispute.resolvedBy = new Types.ObjectId(adminId);
        dispute.resolvedAt = new Date();
        await dispute.save({ session });
      });
    } finally {
      await session.endSession();
    }

    res.status(200).json({
      message: "Dispute resolved — buyer refunded.",
      data: { disputeId: dispute._id, status: DisputeStatusEnum.Refunded },
    });
  },
);
