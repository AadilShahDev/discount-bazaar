/* eslint-disable @next/next/no-img-element */
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useCart } from "@/lib/CartContext";
import { getShippingAddress, initiateEscrowCheckout } from "@/lib/api";
import { formatPKR, squadMaxDiscountPercent } from "@/lib/format";
import type { Product, ShippingAddress, Squad } from "@/lib/types";
import { ShippingAddressForm } from "@/components/checkout/ShippingAddressForm";
import { SafepayCardAtom, type SafepayCardAtomHandle } from "@/components/checkout/SafepayCardAtom";

type CheckoutStep = "idle" | "address" | "review" | "payment";

export function DualCheckout({ product, activeSquad }: { product: Product; activeSquad: Squad | null }) {
  const { user, token, openLogin } = useAuth();
  const { addItem } = useCart();
  const router = useRouter();

  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // State machine
  const [step, setStep] = useState<CheckoutStep>("idle");
  const [address, setAddress] = useState<ShippingAddress | null>(user?.shippingAddress ?? null);
  const [isInitiating, setInitiating] = useState(false);

  // Inline Safepay Atoms payment state
  const [paymentTracker, setPaymentTracker] = useState<string | null>(null);
  const [paymentAuthToken, setPaymentAuthToken] = useState<string | null>(null);
  const [paymentHoldAmount, setPaymentHoldAmount] = useState<number>(0);
  const cardAtomRef = useRef<SafepayCardAtomHandle>(null);

  const { marketAnchorPrice, maxSquadDiscount } = product.pricing;
  const targetMembers = activeSquad?.targetMembers ?? product.maxSquadMembers;
  const currentMembers = activeSquad?.currentMembers ?? 0;

  const maxDiscountPct = squadMaxDiscountPercent(maxSquadDiscount);
  const fullyDiscountedUnitPrice = Math.round(marketAnchorPrice * (1 - maxSquadDiscount));
  const subtotal = fullyDiscountedUnitPrice * quantity;

  const depositPct = product.deposit_percentage ?? 10;
  const totalDeposit = Math.round(subtotal * (depositPct / 100));
  const remainingCOD = Math.max(0, subtotal - totalDeposit);
  const progress = Math.min(100, Math.round((currentMembers / targetMembers) * 100));
  const isFull = currentMembers >= targetMembers;

  function adjustQty(delta: number) {
    setQuantity((q) => Math.max(1, Math.min(99, q + delta)));
  }

  // ─── Step 1: User clicks "Join this Squad" ────────────────────────
  async function handleJoinSquad() {
    if (!user || !token) {
      openLogin();
      return;
    }

    setError(null);

    if (!user.shippingAddress && !address) {
      try {
        const fetched = await getShippingAddress(token);
        if (fetched) {
          setAddress(fetched);
          setStep("review");
          return;
        }
      } catch {
        // ignore — will show form
      }
      setStep("address");
      return;
    }

    setStep("review");
  }

  function handleAddressSaved(addr: ShippingAddress) {
    setAddress(addr);
    setStep("review");
  }

  // ─── Step 3: Payment — initiate Safepay escrow, render Atoms inline ─
  async function handlePaySecurely() {
    if (!token) return;

    setError(null);
    setInitiating(true);
    try {
      const checkout = await initiateEscrowCheckout(product._id, activeSquad?._id, token, quantity);
      setPaymentTracker(checkout.trackerId);
      setPaymentAuthToken(checkout.authToken);
      setPaymentHoldAmount(checkout.holdAmount);
      setStep("payment");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the Squad checkout.");
    } finally {
      setInitiating(false);
    }
  }

  function handlePaymentSuccess() {
    setStep("idle");
    setPaymentTracker(null);
    setPaymentAuthToken(null);
    router.push(`/dashboard?success=true`);
  }

  function handlePaymentFailure(data: any) {
    setError(
      (data?.error ?? data?.errorMessage ?? "Payment failed. Please try a different card.") as string,
    );
  }

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <div className="mt-6 space-y-4">
      {/* Quantity selector */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-slate-600">Quantity</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => adjustQty(-1)}
            disabled={quantity <= 1}
            className="grid h-8 w-8 place-items-center rounded-full border border-slate-200 text-slate-500 transition hover:border-oceanic hover:text-oceanic disabled:opacity-40"
            aria-label="Decrease quantity"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
              <path d="M5 12h14" />
            </svg>
          </button>
          <span className="min-w-8 text-center text-sm font-bold text-slate-800">{quantity}</span>
          <button
            onClick={() => adjustQty(1)}
            disabled={quantity >= 99}
            className="grid h-8 w-8 place-items-center rounded-full border border-slate-200 text-slate-500 transition hover:border-oceanic hover:text-oceanic disabled:opacity-40"
            aria-label="Increase quantity"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
              <path d="M5 12h14M12 5v14" />
            </svg>
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Card 1 — Buy Now */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Buy Solo</p>
            <p className="mt-1 text-lg font-bold text-slate-900 sm:text-xl">
              {formatPKR(product.pricing.currentRetailPrice * quantity)}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {quantity > 1 ? `${quantity} × ${formatPKR(product.pricing.currentRetailPrice)} · ` : ""}Ships immediately at standard retail price.
            </p>
          </div>
          <button
            onClick={() => {
              for (let i = 0; i < quantity; i++) {
                addItem({
                  _id: product._id,
                  title: product.title,
                  pricing: product.pricing,
                  images: product.images,
                });
              }
              setAdded(true);
              setTimeout(() => setAdded(false), 1500);
            }}
            className="mt-4 w-full rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
          >
            {added ? "Added to Cart" : "Add to Cart"}
          </button>
        </div>

        {/* Card 2 — Join Squad */}
        <div className="flex flex-col justify-between rounded-2xl border-2 border-oceanic bg-oceanic/5 p-4 sm:p-5">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-oceanic">Buy as a Squad</p>
              <span className="rounded-full bg-mint px-2 py-0.5 text-[10px] font-bold text-oceanic-dark">
                Upto {maxDiscountPct}% OFF
              </span>
              {isFull && (
                <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                  LOCKED
                </span>
              )}
            </div>
            <p className="mt-1 text-lg font-bold text-oceanic-dark sm:text-xl">
              {formatPKR(subtotal)}
            </p>
            {quantity > 1 && (
              <p className="text-xs text-oceanic-dark/70">
                {quantity} × {formatPKR(fullyDiscountedUnitPrice)}
              </p>
            )}

            <div className="mt-3">
              <div className="h-2 w-full overflow-hidden rounded-full bg-white">
                <div className="h-full rounded-full bg-mint" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-1 text-xs text-oceanic-dark/80">
                {activeSquad
                  ? `${currentMembers}/${targetMembers} joined · Upto ${maxDiscountPct}% OFF`
                  : "Be the first to start this Squad"}
              </p>
            </div>

            <div className="mt-3 rounded-xl bg-white p-3 text-xs text-slate-600">
              <p className="font-medium text-slate-700">Secure 24-Hour Hold</p>
              <p className="mt-1">
                {formatPKR(totalDeposit)} today ({depositPct}% × {quantity} {quantity > 1 ? "units" : "unit"})
              </p>
              <p className="mt-0.5">{formatPKR(remainingCOD)} on delivery (COD)</p>
              <p className="mt-1 text-[10px] italic text-slate-400">Note: Delivery charges will be applied separately.</p>
            </div>
          </div>

          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

          <button
            onClick={handleJoinSquad}
            disabled={isFull}
            className="mt-4 w-full rounded-full bg-oceanic px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-oceanic-dark disabled:opacity-60"
          >
            {isFull ? "Squad Full" : "Join this Squad"}
          </button>
        </div>
      </div>

      {/* ─── Inline Address Form ────────────────────────────────────── */}
      {step === "address" && (
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">Shipping Address</h3>
            <button
              onClick={() => setStep("idle")}
              className="text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>
          <p className="mb-4 text-xs text-slate-500">
            We need your delivery address to calculate shipping and finalize your order.
          </p>
          <ShippingAddressForm
            initial={address}
            token={token!}
            onSave={handleAddressSaved}
            onCancel={() => setStep("idle")}
          />
        </div>
      )}

      {/* ─── Inline Order Summary ───────────────────────────────────── */}
      {step === "review" && address && (
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">Review Your Order</h3>
            <button
              onClick={() => setStep("idle")}
              className="text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              Back
            </button>
          </div>

          <div className="space-y-4">
            {/* Delivery address summary */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Delivering to</p>
                  <p className="mt-1 text-sm font-medium text-slate-800">{address.fullName}</p>
                  <p className="text-xs text-slate-500">
                    {address.area}, {address.city}, {address.province}
                  </p>
                  <p className="text-xs text-slate-500">{address.streetAddress}</p>
                  {address.landmark && <p className="text-xs text-slate-400">Landmark: {address.landmark}</p>}
                </div>
                <button
                  onClick={() => setStep("address")}
                  className="text-xs font-medium text-oceanic hover:underline"
                >
                  Edit
                </button>
              </div>
            </div>

            {/* Financial breakdown */}
            <div className="space-y-2 rounded-xl border border-slate-200 p-4">
              <SummaryRow label={`Subtotal (${quantity} × ${formatPKR(fullyDiscountedUnitPrice)})`} value={formatPKR(subtotal)} />
              <div className="my-2 border-t border-dashed border-slate-200" />
              <SummaryRow
                label={`Upfront Deposit (${depositPct}%)`}
                value={formatPKR(totalDeposit)}
                accent
              />
              <SummaryRow label="Remaining on Delivery (COD)" value={formatPKR(remainingCOD)} />
              <p className="pt-1 text-[10px] italic text-slate-400">Note: Delivery charges will be applied separately.</p>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <button
              onClick={handlePaySecurely}
              disabled={isInitiating}
              className="w-full rounded-full bg-oceanic px-6 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-oceanic-dark disabled:opacity-60"
            >
              {isInitiating ? "Preparing Payment…" : `Continue to Payment`}
            </button>
          </div>
        </div>
      )}

      {/* ─── Inline Secure Payment (Safepay Atoms) ──────────────────── */}
      {step === "payment" && paymentTracker && paymentAuthToken && (
        <div className="mt-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-2 flex items-center gap-2 text-lg font-semibold text-gray-900">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 text-green-600">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Secure Payment
          </h3>
          <p className="mb-4 text-xs text-slate-500">
            Pay a refundable {formatPKR(paymentHoldAmount)} deposit now to secure your spot. The remaining {formatPKR(remainingCOD)} is due on delivery (COD).
          </p>

          <SafepayCardAtom
            ref={cardAtomRef}
            tracker={paymentTracker}
            authToken={paymentAuthToken}
            environment="sandbox"
            amount={paymentHoldAmount}
            onPaymentSuccess={handlePaymentSuccess}
            onPaymentFailure={handlePaymentFailure}
          />

          <button
            onClick={() => {
              setStep("review");
              setPaymentTracker(null);
              setPaymentAuthToken(null);
            }}
            className="mt-3 w-full text-center text-xs font-medium text-slate-500 hover:text-slate-700"
          >
            Back to review
          </button>
        </div>
      )}
    </div>
  );
}

function SummaryRow({
  label,
  value,
  bold,
  accent,
}: {
  label: string;
  value: string;
  bold?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-xs ${bold ? "font-semibold text-slate-700" : "text-slate-500"}`}>{label}</span>
      <span
        className={`text-sm ${bold ? "font-bold text-slate-900" : accent ? "font-bold text-oceanic" : "font-medium text-slate-700"}`}
      >
        {value}
      </span>
    </div>
  );
}
