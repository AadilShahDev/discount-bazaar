"use client";

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
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

// Defined outside the component so the object reference never changes between
// renders — avoids @sfpy/atoms treating a new `inputStyle` object as a reason
// to re-mount the Web Component.
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

    // ── Step 2 fix: wrap every callback passed to @sfpy/atoms in useCallback
    // so their identity stays stable across parent re-renders.
    //
    // @sfpy/atoms internally re-binds event listeners whenever its callback
    // props change (via a useEffect dependency array). Without stable references,
    // every parent state update creates new function objects → triggers a
    // CardCapture re-effect → potentially re-initialises the Web Component →
    // fires "ready" again → triggers another state update → infinite loop that
    // crashes the page within milliseconds of the widget mounting.
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
