"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
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

    const [isReady, setIsReady] = useState(false);
    const [isSubmitting, setSubmitting] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [payerAuth, setPayerAuth] = useState<PayerAuthState | null>(null);

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

    function handleReady() {
      setIsReady(true);
      onReady?.();
    }

    function handleValidated(data: { bin: string; lastFour: string; cardType?: string }) {
      setValidationError(null);
      onValidated?.(data);
    }

    function handleError(error: string) {
      setValidationError(error);
      setSubmitting(false);
      onError?.(error);
    }

    function handleProceedToAuthentication(data: any) {
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
        // No challenge — treat as frictionless success
        setSubmitting(false);
        onPaymentSuccess?.(data);
        return;
      }

      setPayerAuth({ deviceDataCollectionJWT: jwt, deviceDataCollectionURL: url });
    }

    function handlePayerAuthSuccess(data: any) {
      setPayerAuth(null);
      setSubmitting(false);
      onPaymentSuccess?.(data);
    }

    function handlePayerAuthFailure(data: any) {
      setPayerAuth(null);
      setSubmitting(false);
      onPaymentFailure?.(data);
    }

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

    if (!isReady) {
      return (
        <div className="flex items-center justify-center py-8" aria-live="polite">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-oceanic" />
          <span className="ml-2 text-sm text-slate-500">Loading secure payment…</span>
        </div>
      );
    }

    return (
      <div className="safepay-atoms-root">
        {payerAuth ? (
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
        ) : (
          <>
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
