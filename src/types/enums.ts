/**
 * Shared enum constants.
 *
 * Duplicated as Mongoose enum string-unions in each schema because Mongoose
 * validates against the string values, while these const objects give us
 * type-safe references in business logic.
 */

export const UserRole = {
  Buyer: "Buyer",
  Supplier: "Supplier",
  Admin: "Admin",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const SquadStatus = {
  Gathering: "Gathering",
  Voting: "Voting",
  Captured: "Captured",
  Voided: "Voided",
} as const;
export type SquadStatus = (typeof SquadStatus)[keyof typeof SquadStatus];

export const EscrowState = {
  Authorized: "Authorized",
  Captured: "Captured",
  Voided: "Voided",
  Refunded: "Refunded",
} as const;
export type EscrowState = (typeof EscrowState)[keyof typeof EscrowState];

export const OrderLogisticsStatus = {
  PendingDispatch: "Pending_Dispatch",
  Packed: "Packed",
  Shipped: "Shipped",
  OutForDelivery: "OutForDelivery",
  Delivered: "Delivered",
  Cancelled: "Cancelled",
  Returned: "Returned",
} as const;
export type OrderLogisticsStatus =
  (typeof OrderLogisticsStatus)[keyof typeof OrderLogisticsStatus];

export const DisputeIssueType = {
  ProductQuality: "ProductQuality",
  WrongItem: "WrongItem",
  DeliveryDelay: "DeliveryDelay",
  PaymentIssue: "PaymentIssue",
  Other: "Other",
} as const;
export type DisputeIssueType =
  (typeof DisputeIssueType)[keyof typeof DisputeIssueType];

export const DisputeStatus = {
  Open: "Open",
  UnderReview: "UnderReview",
  Resolved: "Resolved",
  Rejected: "Rejected",
  Refunded: "Refunded",
  Closed: "Closed",
} as const;
export type DisputeStatus = (typeof DisputeStatus)[keyof typeof DisputeStatus];

export const PaymentMethod = {
  SquadDeposit: "SquadDeposit",
  FullRetail: "FullRetail",
  COD: "COD",
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PurchaseType = {
  Squad: "Squad",
  Standard: "Standard",
} as const;
export type PurchaseType = (typeof PurchaseType)[keyof typeof PurchaseType];
