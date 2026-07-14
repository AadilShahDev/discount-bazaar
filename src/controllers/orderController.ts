import { type Request, type Response } from "express";
import mongoose, { Types } from "mongoose";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import Transaction from "../models/Transaction.js";
import {
  EscrowState as EscrowStateEnum,
  OrderLogisticsStatus as LogisticsEnum,
  PaymentMethod as PaymentMethodEnum,
  PurchaseType as PurchaseTypeEnum,
} from "../types/enums.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { computeOrderFinance, roundPKR } from "../utils/orderFinance.js";
import { captureFunds, createAuthorization } from "../utils/safepay.js";

/* ------------------------------------------------------------------ */
/* Step 1 — courierWebhook (Logistics Sync)                           */
/* ------------------------------------------------------------------ */

interface CourierWebhookBody {
  tracking_number?: string;
  status?: string;
  courier?: string;
}

/**
 * Maps raw courier status strings (Trax / Leopards) to our internal
 * OrderLogisticsStatus enum. RTO (Return to Origin) maps to Returned.
 */
const COURIER_STATUS_MAP: Record<string, LogisticsEnum> = {
  Delivered: LogisticsEnum.Delivered,
  DELIVERED: LogisticsEnum.Delivered,
  In_Transit: LogisticsEnum.Shipped,
  InTransit: LogisticsEnum.Shipped,
  Shipped: LogisticsEnum.Shipped,
  OutForDelivery: LogisticsEnum.OutForDelivery,
  Out_for_Delivery: LogisticsEnum.OutForDelivery,
  RTO: LogisticsEnum.Returned,
  Returned: LogisticsEnum.Returned,
  RETURNED: LogisticsEnum.Returned,
  Cancelled: LogisticsEnum.Cancelled,
  Canceled: LogisticsEnum.Cancelled,
  Packed: LogisticsEnum.Packed,
};

/**
 * POST /api/orders/webhook
 * Public. Receives logistics status updates from courier partners (Trax,
 * Leopards, etc.). Looks up the order by trackingNumber, updates its
 * logisticsStatus, and stamps deliveredAt when the package is delivered —
 * which implicitly unlocks the buyer's ability to open a dispute.
 */
export const courierWebhook = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { tracking_number, status, courier } = req.body as CourierWebhookBody;

    if (!tracking_number) {
      res.status(400).json({ error: "tracking_number is required." });
      return;
    }
    if (!status) {
      res.status(400).json({ error: "status is required." });
      return;
    }

    const mappedStatus = COURIER_STATUS_MAP[status];
    if (!mappedStatus) {
      res.status(400).json({
        error: `Unknown courier status '${status}'. Supported: ${Object.keys(COURIER_STATUS_MAP).join(", ")}`,
      });
      return;
    }

    const order = await Order.findOne({ trackingNumber: tracking_number });
    if (!order) {
      res.status(404).json({ error: "No order found for this tracking number." });
      return;
    }

    // Idempotent — don't touch orders already in a terminal state.
    if (
      order.logisticsStatus === LogisticsEnum.Delivered ||
      order.logisticsStatus === LogisticsEnum.Cancelled ||
      order.logisticsStatus === LogisticsEnum.Returned
    ) {
      res.status(200).json({
        received: true,
        orderId: order._id,
        logisticsStatus: order.logisticsStatus,
        message: "Order already in a terminal logistics state — no update applied.",
      });
      return;
    }

    order.logisticsStatus = mappedStatus;
    if (courier) {
      order.courier = courier;
    }
    if (mappedStatus === LogisticsEnum.Delivered) {
      order.deliveredAt = new Date();
    }

    await order.save();

    res.status(200).json({
      received: true,
      orderId: order._id,
      logisticsStatus: order.logisticsStatus,
      deliveredAt: order.deliveredAt ?? null,
    });
  },
);
/* ------------------------------------------------------------------ */
/* Step 2.2 — createStandardOrder (Buy Now)                           */
/* ------------------------------------------------------------------ */

interface CreateStandardOrderBody {
  productId?: string;
  quantity?: number;
  shipping?: number;
}

/**
 * POST /api/orders
 * Protected. "Buy Now" checkout for a standard (non-squad) purchase. Captures
 * a 10% Safepay hold immediately and generates an Order with purchaseType
 * 'Standard' and no squad discount. Payment method defaults to FullRetail so
 * the remaining balance is due as COD.
 */
export const createStandardOrder = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const buyerId = req.user?.userId;
    const { productId, quantity, shipping } = req.body as CreateStandardOrderBody;

    if (!buyerId) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    if (!productId || !Types.ObjectId.isValid(productId)) {
      res.status(400).json({ error: "A valid productId is required." });
      return;
    }

    const qty = Math.max(1, Math.floor(Number(quantity) || 1));
    const shippingFee = Math.max(0, Number(shipping) || 0);

    const product = await Product.findOne({ _id: productId, isActive: true });
    if (!product) {
      res.status(404).json({ error: "Product not found." });
      return;
    }

    const unitPrice = roundPKR(product.pricing.currentRetailPrice);
    const depositPaid = roundPKR(unitPrice * qty * 0.1);
    const reference = `std_p_${productId}_b_${buyerId}_${Date.now().toString(36)}`;

    // Authorize + capture the 10% hold synchronously for standard orders.
    const { trackerId } = await createAuthorization({
      amount: depositPaid,
      intent: "AUTHORIZE",
      reference,
      productId,
    });

    const session = await mongoose.startSession();
    let order: InstanceType<typeof Order>;
    try {
      order = await session.withTransaction(async () => {
        const txn = await Transaction.create(
          [
            {
              safepayTrackerId: trackerId,
              buyerId: new Types.ObjectId(buyerId),
              productId: product._id,
              holdAmount: depositPaid,
              escrowState: EscrowStateEnum.Authorized,
              authorizedAt: new Date(),
            },
          ],
          { session },
        );
        const created = txn[0];

        // Capture the hold immediately for a standard purchase.
        await captureFunds(created.safepayTrackerId, created.holdAmount);
        created.escrowState = EscrowStateEnum.Captured;
        created.capturedAt = new Date();
        await created.save({ session });

        const totals = computeOrderFinance({
          unitPrice,
          quantity: qty,
          discountRate: 0,
          shipping: shippingFee,
          platformFee: 0,
          depositPaid,
        });

        const createdOrders = await Order.create(
          [
            {
              buyerId: new Types.ObjectId(buyerId),
              supplierId: product.supplierId,
              productId: product._id,
              transactionId: created._id,
              purchaseType: PurchaseTypeEnum.Standard,
              totals,
              paymentMethod: PaymentMethodEnum.FullRetail,
              logisticsStatus: LogisticsEnum.PendingDispatch,
            },
          ],
          { session },
        );
        return createdOrders[0];
      });
    } finally {
      await session.endSession();
    }

    res.status(201).json({
      message: "Standard order created. Deposit captured, balance due as COD.",
      data: {
        orderId: order._id,
        purchaseType: PurchaseTypeEnum.Standard,
        totals: order.totals,
      },
    });
  },
);

/* ------------------------------------------------------------------ */
/* Step 2.3 — getBuyerOrders                                          */
/* ------------------------------------------------------------------ */

/**
 * GET /api/orders/me
 * Protected. Returns all orders placed by the authenticated buyer, newest
 * first, with product details populated.
 */
export const getBuyerOrders = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const buyerId = req.user?.userId;
    if (!buyerId) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const orders = await Order.find({ buyerId: new Types.ObjectId(buyerId) })
      .populate({ path: "productId", select: "title slug images category pricing" })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({ data: orders });
  },
);

/* ------------------------------------------------------------------ */
/* Step 2.4 — getSupplierManifests                                    */
/* ------------------------------------------------------------------ */

/**
 * GET /api/orders/manifest
 * Protected (Supplier). Returns all Pending_Dispatch orders for products
 * owned by the authenticated supplier — the "manifest" they fulfill from.
 */
export const getSupplierManifests = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const supplierId = req.user?.userId;
    if (!supplierId) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const orders = await Order.find({
      supplierId: new Types.ObjectId(supplierId),
      logisticsStatus: LogisticsEnum.PendingDispatch,
    })
      .populate({ path: "productId", select: "title slug images category pricing" })
      .populate({ path: "buyerId", select: "phoneNumber fullName" })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({ data: orders });
  },
);
