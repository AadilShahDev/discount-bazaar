import mongoose, { Schema, type Document, type Model, type Types } from "mongoose";
import {
  type OrderLogisticsStatus,
  OrderLogisticsStatus as LogisticsEnum,
  type PaymentMethod,
  PaymentMethod as PaymentMethodEnum,
  type PurchaseType,
  PurchaseType as PurchaseTypeEnum,
} from "../types/enums.js";

/* ------------------------------------------------------------------ */
/* Locked financial snapshot                                          */
/* ------------------------------------------------------------------ */

export interface IOrderTotals {
  unitPrice: number; // PKR, price locked at purchase
  quantity: number;
  discountRate: number; // 0–1
  discountAmount: number; // PKR
  subtotal: number; // unitPrice * quantity - discountAmount
  shipping: number;
  platformFee: number;
  supplierPayout: number; // what the supplier receives post-capture
  total: number; // charged to buyer
  // Zero-wallet split: total is partitioned into the Safepay-captured deposit
  // and a cash-on-delivery balance settled by the courier.
  depositPaid: number; // PKR, captured from the 10% pre-auth
  codAmountDue: number; // PKR, remaining balance due on delivery
}

const OrderTotalsSchema = new Schema<IOrderTotals>(
  {
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    discountRate: { type: Number, required: true, min: 0, max: 1 },
    discountAmount: { type: Number, required: true, min: 0 },
    subtotal: { type: Number, required: true, min: 0 },
    shipping: { type: Number, required: true, default: 0, min: 0 },
    platformFee: { type: Number, required: true, default: 0, min: 0 },
    supplierPayout: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    depositPaid: { type: Number, required: true, default: 0, min: 0 },
    codAmountDue: { type: Number, required: true, default: 0, min: 0 },
  },
  { _id: false },
);

/* ------------------------------------------------------------------ */
/* Order                                                              */
/* ------------------------------------------------------------------ */

export interface IOrder extends Document {
  buyerId: Types.ObjectId;
  supplierId: Types.ObjectId;
  productId: Types.ObjectId;
  squadId?: Types.ObjectId;
  transactionId: Types.ObjectId; // the captured Safepay transaction
  purchaseType: PurchaseType; // Squad | Standard
  totals: IOrderTotals;
  paymentMethod: PaymentMethod;
  logisticsStatus: OrderLogisticsStatus;
  trackingNumber?: string;
  courier?: string;
  deliveredAt?: Date;
  isRefunded?: boolean;
  refundedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const OrderSchema = new Schema<IOrder>(
  {
    buyerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    supplierId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    squadId: { type: Schema.Types.ObjectId, ref: "Squad", index: true },
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: "Transaction",
      required: true,
    },
    purchaseType: {
      type: String,
      enum: Object.values(PurchaseTypeEnum),
      required: true,
      index: true,
    },
    totals: { type: OrderTotalsSchema, required: true },
    paymentMethod: {
      type: String,
      enum: Object.values(PaymentMethodEnum),
      default: PaymentMethodEnum.FullRetail,
      required: true,
    },
    logisticsStatus: {
      type: String,
      enum: Object.values(LogisticsEnum),
      default: LogisticsEnum.PendingDispatch,
      required: true,
      index: true,
    },
    trackingNumber: { type: String, trim: true, index: true },
    courier: { type: String, trim: true },
    deliveredAt: { type: Date },
    isRefunded: { type: Boolean, default: false },
    refundedAt: { type: Date },
  },
  { timestamps: true },
);

export const Order: Model<IOrder> = mongoose.model<IOrder>("Order", OrderSchema);
export default Order;
