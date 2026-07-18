"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useCart } from "@/lib/CartContext";
import { fetchActiveSquadForProduct, getShippingAddress, initiateEscrowCheckout } from "@/lib/api";
import { formatPKR } from "@/lib/format";
import type { Product, ShippingAddress, Squad } from "@/lib/types";
import { ShippingAddressForm } from "@/components/checkout/ShippingAddressForm";
import { SafepayCardAtom, type SafepayCardAtomHandle } from "@/components/checkout/SafepayCardAtom";

interface CartDrawerProps {
  products: Product[];
}

type CheckoutStep = "idle" | "address" | "review" | "payment";

export function CartDrawer({ products }: CartDrawerProps) {
  const { items, subtotal, isOpen, closeDrawer, removeItem, updateQuantity, clear } = useCart();
  const { user, token, openLogin } = useAuth();
  const router = useRouter();

  const [squadMap, setSquadMap] = useState<Record<string, Squad | null>>({});
  const [step, setStep] = useState<CheckoutStep>("idle");
  const [address, setAddress] = useState<ShippingAddress | null>(user?.shippingAddress ?? null);
  const [isInitiating, setInitiating] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Inline Safepay Atoms payment state
  const [paymentTracker, setPaymentTracker] = useState<string | null>(null);
  const [paymentAuthToken, setPaymentAuthToken] = useState<string | null>(null);
  const [paymentHoldAmount, setPaymentHoldAmount] = useState<number>(0);
  const cardAtomRef = useRef<SafepayCardAtomHandle>(null);

  // Fetch active squads for upsell nudges
  useEffect(() => {
    if (!isOpen || items.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        items.map(async (item) => {
          const product = products.find((p) => p._id === item.productId);
          if (!product?.dualCheckoutEnabled || product.pricing.maxSquadDiscount <= 0) {
            return [item.productId, null] as const;
          }
          try {
            const squad = await fetchActiveSquadForProduct(item.productId);
            return [item.productId, squad] as const;
          } catch {
            return [item.productId, null] as const;
          }
        }),
      );
      if (cancelled) return;
      const map: Record<string, Squad | null> = {};
      for (const [id, squad] of entries) map[id] = squad;
      setSquadMap(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, items, products]);

  // Lock body scroll when drawer open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [isOpen]);

  // Reset checkout state when drawer closes
  useEffect(() => {
    if (!isOpen) {
      setStep("idle");
      setCheckoutError(null);
      setPaymentTracker(null);
      setPaymentAuthToken(null);
    }
  }, [isOpen]);

  // ─── Checkout flow entry ──────────────────────────────────────────
  async function handleCheckout() {
    setCheckoutError(null);

    if (!user || !token) {
      openLogin();
      return;
    }

    // Try to fetch saved address
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
  }

  function handleAddressSaved(addr: ShippingAddress) {
    setAddress(addr);
    setStep("review");
  }

  // ─── Initiate Safepay escrow, render Atoms inline ──────────────────
  async function handlePaySecurely() {
    if (!token || items.length === 0) return;

    setCheckoutError(null);
    setInitiating(true);
    try {
      // Use first cart item as escrow anchor for the standard cart flow.
      const first = items[0];
      const checkout = await initiateEscrowCheckout(first.productId, undefined, token, first.quantity);
      setPaymentTracker(checkout.trackerId);
      setPaymentAuthToken(checkout.authToken);
      setPaymentHoldAmount(checkout.holdAmount);
      setStep("payment");
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : "Could not start checkout.");
    } finally {
      setInitiating(false);
    }
  }

  function handlePaymentSuccess() {
    clear();
    setStep("idle");
    setPaymentTracker(null);
    setPaymentAuthToken(null);
    closeDrawer();
    router.push(`/dashboard?success=true`);
  }

  function handlePaymentFailure(data: any) {
    setCheckoutError(
      (data?.error ?? data?.errorMessage ?? "Payment failed. Please try a different card.") as string,
    );
  }

  function handleSwitchToSquad(productId: string) {
    removeItem(productId);
    closeDrawer();
    router.push(`/products/${productId}?action=join-squad`);
  }

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm transition-opacity"
          onClick={closeDrawer}
          aria-hidden
        />
      )}

      {/* Drawer */}
      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
        aria-label="Shopping cart"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="font-heading text-lg font-bold text-slate-900">
            {step === "idle" ? `Your Cart (${items.length})` : "Checkout"}
          </h2>
          <button
            onClick={() => {
              if (step !== "idle") setStep("idle");
              else closeDrawer();
            }}
            className="grid h-8 w-8 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label={step === "idle" ? "Close cart" : "Back to cart"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              {step === "idle" ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M15 18l-6-6 6-6" />}
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* ── Idle: cart items ── */}
          {step === "idle" && (
            <>
              {items.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <div className="grid h-16 w-16 place-items-center rounded-full bg-slate-50 text-slate-300">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-8 w-8">
                      <circle cx="9" cy="20" r="1.4" fill="currentColor" stroke="none" />
                      <circle cx="18" cy="20" r="1.4" fill="currentColor" stroke="none" />
                      <path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 8H6" />
                    </svg>
                  </div>
                  <p className="mt-4 text-sm font-medium text-slate-500">Your cart is empty</p>
                  <button
                    onClick={() => {
                      closeDrawer();
                      router.push("/products");
                    }}
                    className="mt-4 rounded-full bg-oceanic px-5 py-2 text-sm font-semibold text-white hover:bg-oceanic-dark"
                  >
                    Browse Products
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {items.map((item) => {
                    const product = products.find((p) => p._id === item.productId);
                    const squad = squadMap[item.productId];
                    const hasSquadPricing =
                      product?.dualCheckoutEnabled && product.pricing.maxSquadDiscount > 0;
                    const savings =
                      hasSquadPricing && product
                        ? Math.round(
                            product.pricing.marketAnchorPrice -
                              product.pricing.marketAnchorPrice * (1 - product.pricing.maxSquadDiscount),
                          )
                        : 0;
                    const showUpsell = hasSquadPricing && savings > 0;

                    return (
                      <div key={item.productId} className="space-y-2">
                        {/* Item row */}
                        <div className="flex gap-3 rounded-xl border border-slate-100 p-3">
                          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                            {item.image ? (
                              <img src={item.image} alt={item.title} className="h-full w-full object-cover" />
                            ) : (
                              <div className="grid h-full w-full place-items-center text-[10px] text-slate-300">
                                No img
                              </div>
                            )}
                          </div>

                          <div className="flex flex-1 flex-col">
                            <div className="flex items-start justify-between gap-2">
                              <p className="line-clamp-2 text-sm font-medium text-slate-800">{item.title}</p>
                              <button
                                onClick={() => removeItem(item.productId)}
                                className="shrink-0 text-slate-300 transition hover:text-red-500"
                                aria-label="Remove item"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
                                  <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                                </svg>
                              </button>
                            </div>

                            <div className="mt-auto flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => updateQuantity(item.productId, -1)}
                                  className="grid h-7 w-7 place-items-center rounded-full border border-slate-200 text-slate-500 hover:border-oceanic hover:text-oceanic"
                                  aria-label="Decrease quantity"
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3 w-3">
                                    <path d="M5 12h14" />
                                  </svg>
                                </button>
                                <span className="min-w-6 text-center text-sm font-semibold text-slate-700">
                                  {item.quantity}
                                </span>
                                <button
                                  onClick={() => updateQuantity(item.productId, 1)}
                                  className="grid h-7 w-7 place-items-center rounded-full border border-slate-200 text-slate-500 hover:border-oceanic hover:text-oceanic"
                                  aria-label="Increase quantity"
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3 w-3">
                                    <path d="M5 12h14M12 5v14" />
                                  </svg>
                                </button>
                              </div>
                              <p className="text-sm font-bold text-slate-900">
                                {formatPKR(item.price * item.quantity)}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Squad upsell nudge */}
                        {showUpsell && (
                          <button
                            onClick={() => handleSwitchToSquad(item.productId)}
                            className="flex w-full items-center justify-between gap-2 rounded-xl border-2 border-mint bg-mint/10 px-4 py-3 text-left transition hover:bg-mint/20"
                          >
                            <span className="text-xs font-bold text-mint-dark">
                              Switch to Squad &amp; Save {formatPKR(savings)}
                            </span>
                            <span className="shrink-0 text-xs font-bold text-oceanic-dark">→</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ── Address step ── */}
          {step === "address" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Shipping Address</h3>
                <p className="mt-1 text-xs text-slate-500">
                  We need your delivery address to calculate shipping and finalize your order.
                </p>
              </div>
              <ShippingAddressForm
                initial={address}
                token={token!}
                onSave={handleAddressSaved}
                onCancel={() => setStep("idle")}
              />
            </div>
          )}

          {/* ── Review step ── */}
          {step === "review" && address && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-slate-900">Review Your Order</h3>

              {/* Delivery address */}
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

              {/* Items list */}
              <div className="space-y-2">
                {items.map((item) => (
                  <div key={item.productId} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-700">{item.title}</span>
                      <span className="text-xs text-slate-400">× {item.quantity}</span>
                    </div>
                    <span className="text-sm font-medium text-slate-800">
                      {formatPKR(item.price * item.quantity)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Subtotal */}
              <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                <span className="text-sm font-medium text-slate-500">Subtotal</span>
                <span className="font-heading text-xl font-bold text-slate-900">{formatPKR(subtotal)}</span>
              </div>

              {checkoutError && <p className="text-xs text-red-600">{checkoutError}</p>}

              <button
                onClick={handlePaySecurely}
                disabled={isInitiating}
                className="w-full rounded-full bg-oceanic px-6 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-oceanic-dark disabled:opacity-60"
              >
                {isInitiating ? "Preparing Payment…" : "Continue to Payment"}
              </button>
            </div>
          )}

          {/* ── Payment step (inline Safepay Atoms) ── */}
          {step === "payment" && paymentTracker && paymentAuthToken && (
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <h3 className="mb-2 flex items-center gap-2 text-lg font-semibold text-gray-900">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 text-green-600">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  Secure Payment
                </h3>
                <p className="mb-4 text-xs text-slate-500">
                  Pay a refundable {formatPKR(paymentHoldAmount)} deposit now to secure your order. The remaining balance is due on delivery (COD).
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
              </div>

              {checkoutError && <p className="text-xs text-red-600">{checkoutError}</p>}

              <button
                onClick={() => {
                  setStep("review");
                  setPaymentTracker(null);
                  setPaymentAuthToken(null);
                }}
                className="w-full text-center text-xs font-medium text-slate-500 hover:text-slate-700"
              >
                Back to review
              </button>
            </div>
          )}
        </div>

        {/* Footer — only on idle step */}
        {step === "idle" && items.length > 0 && (
          <div className="border-t border-slate-100 px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-500">Subtotal</span>
              <span className="font-heading text-xl font-bold text-slate-900">{formatPKR(subtotal)}</span>
            </div>
            <button
              onClick={handleCheckout}
              className="w-full rounded-full bg-oceanic px-6 py-3 text-sm font-bold text-white shadow-lg shadow-oceanic/20 transition hover:bg-oceanic-dark"
            >
              Checkout
            </button>
            <p className="mt-2 text-center text-xs text-slate-400">
              Standard retail checkout · COD available
            </p>
          </div>
        )}
      </aside>
    </>
  );
}
