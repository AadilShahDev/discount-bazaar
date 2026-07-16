"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/CartContext";
import { fetchActiveSquadForProduct } from "@/lib/api";
import { formatPKR } from "@/lib/format";
import type { Product, Squad } from "@/lib/types";

interface CartDrawerProps {
  products: Product[];
}

export function CartDrawer({ products }: CartDrawerProps) {
  const { items, subtotal, isOpen, closeDrawer, removeItem, updateQuantity } = useCart();
  const router = useRouter();
  const [squadMap, setSquadMap] = useState<Record<string, Squad | null>>({});

  // Fetch active squads for every cart item to show upsell nudges
  useEffect(() => {
    if (!isOpen || items.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        items.map(async (item) => {
          const product = products.find((p) => p._id === item.productId);
          // Check if the product has squad pricing enabled at all
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

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [isOpen]);

  function handleCheckout() {
    // Retail checkout flow is not yet built — show a clear message
    alert("Retail checkout coming soon! For now, use Squad Buy on the product page for secure escrow checkout.");
  }

  function handleSwitchToSquad(productId: string) {
    removeItem(productId);
    closeDrawer();
    router.push(`/products/${productId}?action=join-squad`);
  }

  return (
    <>
      {/* Backdrop overlay */}
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
            Your Cart ({items.length})
          </h2>
          <button
            onClick={closeDrawer}
            className="grid h-8 w-8 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close cart"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
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

                // Show upsell if: product has squad pricing AND there's an active
                // squad that's still gathering members (or even if no active squad
                // exists, as long as the product supports squads, we can nudge).
                const hasSquadPricing =
                  product?.dualCheckoutEnabled &&
                  product.pricing.maxSquadDiscount > 0;

                const hasActiveSquad = squad && squad.status === "Gathering";

                // Calculate savings: retail price - lowest squad price
                const savings = hasSquadPricing && product
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
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                              className="h-4 w-4"
                            >
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
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                                className="h-3 w-3"
                              >
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
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                                className="h-3 w-3"
                              >
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

                    {/* Squad upsell nudge — shown for every item that has squad pricing */}
                    {showUpsell && (
                      <button
                        onClick={() => handleSwitchToSquad(item.productId)}
                        className="flex w-full items-center justify-between gap-2 rounded-xl border-2 border-mint bg-mint/10 px-4 py-3 text-left transition hover:bg-mint/20"
                      >
                        <span className="text-xs font-bold text-mint-dark">
                          🔥 Switch to Squad &amp; Save {formatPKR(savings)}
                        </span>
                        <span className="shrink-0 text-xs font-bold text-oceanic-dark">→</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="border-t border-slate-100 px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-500">Subtotal</span>
              <span className="font-heading text-xl font-bold text-slate-900">
                {formatPKR(subtotal)}
              </span>
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
