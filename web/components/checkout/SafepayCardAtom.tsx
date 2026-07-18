"use client";

// @sfpy/atoms exports React wrappers (dist/react/index.js) as its only ESM
// entry point. There is no separate ESM bundle that registers the custom
// elements — the React components ARE the integration layer.
//
// This file is loaded exclusively client-side via next/dynamic({ ssr: false })
// in DualCheckout.tsx and CartDrawer.tsx, so the library's browser-only code
// (iframe injection, window references) never runs during SSR.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { CardCapture, PayerAuthentication, type Environment } from "@sfpy/atoms";
import "@sfpy/atoms/styles";

export interface SafepayCardAtomHandle {
  submit: () => void;
  validate: () => void;
  fetchValidity: () => Promise<boolean>;
  clear: () => void;
}

interface PayerAuthState {
  deviceDataCollectionJWT: string;
  deviceDataCollectionURL: string;
}

interface SafepayCardAtomProps {
  tracker: string;
  authToken: string;
  environment?: Environment | string;
  amount: number;
  onReady?: () => void;
  onValidated?: (data: { bin: string; lastFour: string; cardType?: string }) => void;
  onError?: (error: string) => void;
  onPaymentSuccess?: (data: any) => void;
  onPaymentFailure?: (data: any) => void;
}

// Module-level constant — reference never changes between renders, so
// @sfpy/atoms will never treat a new object identity as a reason to
// re-mount the internal iframe.
const INPUT_STYLE: React.CSSProperties = {
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
    const cardRef = useRef<any>(null);
    const payerAuthRef = useRef<any>(null);

    const [isSafeToMount, setIsSafeToMount] = useState(false);
    const [isSubmitting, setSubmitting] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [payerAuth, setPayerAuth] = useState<PayerAuthState | null>(null);

    // Delay mounting by one tick so the parent DOM is fully painted and stable
    // before the iframe-injecting Web Component wrapper initialises. Without
    // this, React 18 Strict Mode's double-mount can destroy the iframe context
    // on the first mount before the second mount recreates it.
    useEffect(() => {
      const timer = setTimeout(() => setIsSafeToMount(true), 50);
      return () => clearTimeout(timer);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        submit: () => cardRef.current?.submit(),
        validate: () => cardRef.current?.validate(),
        fetchValidity: () => cardRef.current?.fetchValidity?.() ?? Promise.resolve(false),
        clear: () => cardRef.current?.clear?.(),
      }),
      [],
    );

    // All handlers are wrapped in useCallback so their identity stays stable
    // across parent re-renders. @sfpy/atoms watches callback props in a
    // useEffect dependency array internally — unstable references would
    // re-initialise the iframe on every parent state update, causing an
    // infinite re-render loop that trips the Error Boundary.
    const handleReady = useCallback(() => {
      onReady?.();
    }, [onReady]);

    const handleValidated = useCallback(
      (data: { bin: string; lastFour: string; cardType?: string }) => {
        setValidationError(null);
        onValidated?.(data);
      },
      [onValidated],
    );

    const handleError = useCallback(
      (error: string) => {
        setValidationError(error);
        setSubmitting(false);
        onError?.(error);
      },
      [onError],
    );

    const handleProceedToAuthentication = useCallback(
      (data: any) => {
        const jwt =
          data?.deviceDataCollectionJWT ??
          data?.device_data_collection_jwt ??
          data?.accessToken ??
          "";
        const url =
          data?.deviceDataCollectionURL ??
          data?.device_data_collection_url ??
          data?.actionUrl ??
          "";

        if (!jwt || !url) {
          // No 3DS challenge required — treat as immediate success.
          setSubmitting(false);
          onPaymentSuccess?.(data);
          return;
        }

        setPayerAuth({ deviceDataCollectionJWT: jwt, deviceDataCollectionURL: url });
      },
      [onPaymentSuccess],
    );

    const handlePayerAuthSuccess = useCallback(
      (data: any) => {
        setPayerAuth(null);
        setSubmitting(false);
        onPaymentSuccess?.(data);
      },
      [onPaymentSuccess],
    );

    const handlePayerAuthFailure = useCallback(
      (data: any) => {
        setPayerAuth(null);
        setSubmitting(false);
        onPaymentFailure?.(data);
      },
      [onPaymentFailure],
    );

    async function handlePayClick() {
      if (!cardRef.current) return;
      setValidationError(null);
      setSubmitting(true);
      try {
        const isValid = await cardRef.current.fetchValidity();
        if (!isValid) {
          cardRef.current.validate();
          setSubmitting(false);
          return;
        }
        cardRef.current.submit();
      } catch (err) {
        setSubmitting(false);
        handleError(err instanceof Error ? err.message : "Payment could not be processed.");
      }
    }

    // Render a structural placeholder while waiting for the mount-delay tick,
    // or if required tokens are not yet available.
    if (!isSafeToMount || !tracker || !authToken) {
      return (
        <div className="w-full min-h-[150px] animate-pulse rounded-lg bg-gray-50" />
      );
    }

    return (
      <div className="safepay-atoms-root">
        {payerAuth ? (
          <div className="w-full min-h-[150px] relative">
            <PayerAuthentication
              environment={environment}
              tracker={tracker}
              authToken={authToken}
              deviceDataCollectionJWT={payerAuth.deviceDataCollectionJWT}
              deviceDataCollectionURL={payerAuth.deviceDataCollectionURL}
              onPayerAuthenticationSuccess={handlePayerAuthSuccess}
              onPayerAuthenticationFailure={handlePayerAuthFailure}
              imperativeRef={payerAuthRef}
            />
          </div>
        ) : (
          <>
            <div className="w-full min-h-[150px] relative">
              <CardCapture
                environment={environment}
                authToken={authToken}
                tracker={tracker}
                validationEvent="submit"
                inputStyle={INPUT_STYLE}
                onReady={handleReady}
                onValidated={handleValidated}
                onError={handleError}
                onProceedToAuthentication={handleProceedToAuthentication}
                imperativeRef={cardRef}
              />
            </div>

            {validationError && (
              <p className="mt-3 text-xs text-red-600" role="alert">
                {validationError}
              </p>
            )}

            <button
              type="button"
              onClick={handlePayClick}
              disabled={isSubmitting}
              className="mt-4 w-full rounded-full bg-oceanic px-6 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-oceanic-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Processing…" : `Pay PKR ${amount.toLocaleString("en-PK")}`}
            </button>
          </>
        )}
      </div>
    );
  },
);
