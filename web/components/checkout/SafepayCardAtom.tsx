"use client";

// The @sfpy/atoms React wrappers (CardCapture / PayerAuthentication) crash
// with React error #31 when the library internally tries to render an Error
// object as a JSX child — a bug inside the compiled NPM package that we
// cannot patch. The IIFE global bundle (dist/components/index.global.js)
// registers the same logic as real Custom Elements without any React
// involvement, so we serve it from /public and inject the elements via
// Vanilla DOM. This file preserves the exact same public interface
// (SafepayCardAtomHandle + named SafepayCardAtom export) so both parent
// components (DualCheckout, CartDrawer) need zero changes.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import Script from "next/script";

export interface SafepayCardAtomHandle {
  submit: () => void;
  validate: () => void;
  fetchValidity: () => Promise<boolean>;
  clear: () => void;
}

interface SafepayCardAtomProps {
  tracker: string;
  authToken: string;
  environment?: string;
  amount: number;
  onReady?: () => void;
  onValidated?: (data: { bin: string; lastFour: string; cardType?: string }) => void;
  onError?: (error: string) => void;
  onPaymentSuccess?: (data: unknown) => void;
  onPaymentFailure?: (data: unknown) => void;
}

// Module-level constant so its object identity never changes between renders.
const INPUT_STYLE = {
  fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  color: "#111827",
  fontSize: "16px",
  background: "#ffffff",
};

export const SafepayCardAtom = forwardRef<SafepayCardAtomHandle, SafepayCardAtomProps>(
  function SafepayCardAtom(
    {
      tracker,
      authToken,
      environment = "sandbox",
      amount,
      onReady,
      onValidated,
      onError,
      onPaymentSuccess,
      onPaymentFailure,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);

    // Refs to the live DOM elements — updated after injection.
    const cardElRef = useRef<HTMLElement & Record<string, unknown>>(null);

    // Latest-value refs for all prop callbacks — updated synchronously on
    // every render so the web component always calls the current version
    // without us needing to re-inject the element when a callback changes.
    const cbRefs = useRef({ onReady, onValidated, onError, onPaymentSuccess, onPaymentFailure });
    cbRefs.current = { onReady, onValidated, onError, onPaymentSuccess, onPaymentFailure };

    const [scriptLoaded, setScriptLoaded] = useState(false);
    const [isSubmitting, setSubmitting] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [payerAuthActive, setPayerAuthActive] = useState(false);

    // Wire the forwardRef to the web component's imperative API.
    useImperativeHandle(
      ref,
      () => ({
        submit: () => (cardElRef.current as any)?.submit?.(),
        validate: () => (cardElRef.current as any)?.validate?.(),
        fetchValidity: () =>
          (cardElRef.current as any)?.fetchValidity?.() ?? Promise.resolve(false),
        clear: () => (cardElRef.current as any)?.clear?.(),
      }),
      [],
    );

    // Stable wrappers — created once, delegate to cbRefs so they never cause
    // the injection effect to re-run when a parent re-renders.
    const stableReady = useCallback(() => {
      cbRefs.current.onReady?.();
    }, []);

    const stableValidated = useCallback((data: { bin: string; lastFour: string; cardType?: string }) => {
      setValidationError(null);
      cbRefs.current.onValidated?.(data);
    }, []);

    const stableError = useCallback((error: string) => {
      setValidationError(error);
      setSubmitting(false);
      cbRefs.current.onError?.(error);
    }, []);

    const stableProceedToAuth = useCallback((data: unknown) => {
      const d = data as Record<string, string>;
      const jwt =
        d?.deviceDataCollectionJWT ??
        d?.device_data_collection_jwt ??
        d?.accessToken ??
        "";
      const url =
        d?.deviceDataCollectionURL ??
        d?.device_data_collection_url ??
        d?.actionUrl ??
        "";

      if (!jwt || !url) {
        // No 3DS challenge needed — treat as immediate success.
        setSubmitting(false);
        cbRefs.current.onPaymentSuccess?.(data);
        return;
      }

      // Reveal the payer-auth element and hand it the 3DS params.
      const authEl = containerRef.current?.querySelector("safepay-payer-auth-atom") as any;
      if (authEl) {
        authEl.deviceDataCollectionJWT = jwt;
        authEl.deviceDataCollectionURL = url;
        authEl.style.display = "";
      }
      setPayerAuthActive(true);
    }, []);

    const stableAuthSuccess = useCallback((data: unknown) => {
      setPayerAuthActive(false);
      setSubmitting(false);
      cbRefs.current.onPaymentSuccess?.(data);
    }, []);

    const stableAuthFailure = useCallback((data: unknown) => {
      setPayerAuthActive(false);
      setSubmitting(false);
      cbRefs.current.onPaymentFailure?.(data);
    }, []);

    // Inject the web components once the IIFE global bundle is loaded and
    // both required tokens are present. Re-runs only when those three values
    // change — never when a callback prop changes.
    useEffect(() => {
      if (!scriptLoaded || !tracker || !authToken || !containerRef.current) return;

      const container = containerRef.current;
      // Clear any previous mounts (Strict Mode double-invoke safety).
      container.innerHTML = "";

      // ── Card Capture ──────────────────────────────────────────────────────
      const cardEl = document.createElement("safepay-card-atom") as any;
      cardEl.environment = environment;
      cardEl.tracker = tracker;
      cardEl.authToken = authToken;
      cardEl.inputStyle = INPUT_STYLE;
      // Assign stable wrappers as JS properties (Stencil property callbacks).
      cardEl.onReady = stableReady;
      cardEl.onValidated = stableValidated;
      cardEl.onError = stableError;
      cardEl.onProceedToAuthentication = stableProceedToAuth;
      (cardElRef as React.MutableRefObject<any>).current = cardEl;
      container.appendChild(cardEl);

      // ── Payer Authentication (3DS) ────────────────────────────────────────
      const authEl = document.createElement("safepay-payer-auth-atom") as any;
      authEl.environment = environment;
      authEl.tracker = tracker;
      authEl.authToken = authToken;
      authEl.onPayerAuthenticationSuccess = stableAuthSuccess;
      authEl.onPayerAuthenticationFailure = stableAuthFailure;
      // Hidden until onProceedToAuthentication fires.
      authEl.style.display = "none";
      container.appendChild(authEl);

      return () => {
        (cardElRef as React.MutableRefObject<any>).current = null;
        container.innerHTML = "";
      };
    }, [
      scriptLoaded,
      tracker,
      authToken,
      environment,
      stableReady,
      stableValidated,
      stableError,
      stableProceedToAuth,
      stableAuthSuccess,
      stableAuthFailure,
    ]);

    async function handlePayClick() {
      const cardEl = cardElRef.current as any;
      if (!cardEl) return;
      setValidationError(null);
      setSubmitting(true);
      try {
        const isValid = await cardEl.fetchValidity?.();
        if (!isValid) {
          cardEl.validate?.();
          setSubmitting(false);
          return;
        }
        cardEl.submit?.();
      } catch (err) {
        setSubmitting(false);
        stableError(err instanceof Error ? err.message : "Payment could not be processed.");
      }
    }

    return (
      <>
        {/* Serve the IIFE global bundle from /public — no CDN dependency. */}
        <Script
          src="/sfpy-atoms.js"
          strategy="afterInteractive"
          onLoad={() => setScriptLoaded(true)}
        />

        <div className="safepay-atoms-root">
          <div ref={containerRef} className="w-full min-h-[150px] relative">
            {!scriptLoaded && (
              <div className="flex w-full min-h-[150px] animate-pulse items-center justify-center rounded-lg bg-gray-50 text-sm text-gray-400">
                Connecting to secure server…
              </div>
            )}
          </div>

          {validationError && !payerAuthActive && (
            <p className="mt-3 text-xs text-red-600" role="alert">
              {validationError}
            </p>
          )}

          {!payerAuthActive && (
            <button
              type="button"
              onClick={handlePayClick}
              disabled={isSubmitting || !scriptLoaded}
              className="mt-4 w-full rounded-full bg-oceanic px-6 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-oceanic-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Processing…" : `Pay PKR ${amount.toLocaleString("en-PK")}`}
            </button>
          )}
        </div>
      </>
    );
  },
);
