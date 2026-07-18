"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
// Side-effect import only — registers safepay-card-atom and safepay-payer-auth-atom
// as custom elements in the browser. No React wrapper is imported; the components
// are created and owned entirely by Vanilla DOM so React's Virtual DOM never
// interferes with their internal Web Component lifecycle.
import "@sfpy/atoms";

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
  onPaymentSuccess?: (data: any) => void;
  onPaymentFailure?: (data: any) => void;
}

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
    // Holds the raw DOM node so the imperative handle and pay-click handler
    // can reach it without going through React state.
    const cardNodeRef = useRef<any>(null);

    const [isSubmitting, setSubmitting] = useState(false);
    const [validationError, setValidationError] = useState<string | null>(null);

    // ── Callback refs ────────────────────────────────────────────────────────
    // Updated on every render so that closures inside the Vanilla DOM node
    // always invoke the latest prop version. This avoids adding callbacks to
    // the useEffect dependency array, which would tear down and recreate the
    // Web Component on every parent state change.
    const onReadyRef = useRef(onReady);
    const onValidatedRef = useRef(onValidated);
    const onErrorRef = useRef(onError);
    const onPaymentSuccessRef = useRef(onPaymentSuccess);
    const onPaymentFailureRef = useRef(onPaymentFailure);
    onReadyRef.current = onReady;
    onValidatedRef.current = onValidated;
    onErrorRef.current = onError;
    onPaymentSuccessRef.current = onPaymentSuccess;
    onPaymentFailureRef.current = onPaymentFailure;

    // Expose imperative API so parent's ref (cardAtomRef) can trigger submit
    // / validate when needed.
    useImperativeHandle(
      ref,
      () => ({
        submit: () => cardNodeRef.current?.submit?.(),
        validate: () => cardNodeRef.current?.validate?.(),
        fetchValidity: () => cardNodeRef.current?.fetchValidity?.() ?? Promise.resolve(false),
        clear: () => cardNodeRef.current?.clear?.(),
      }),
      [],
    );

    // ── Vanilla DOM injection ────────────────────────────────────────────────
    // Only re-runs when the payment session changes (new tracker / authToken).
    // Callback prop changes do NOT re-run this effect — they're picked up live
    // through the callback refs above.
    useEffect(() => {
      if (!tracker || !authToken || !containerRef.current) return;

      // Clear stale content. Guards against React StrictMode double-invoke and
      // any previous session's DOM nodes lingering in the container.
      containerRef.current.innerHTML = "";

      // Create the raw Web Component — completely outside React's Virtual DOM.
      const cardAtom = document.createElement("safepay-card-atom") as any;

      // Assign session config directly to DOM properties (Safepay NPM docs pattern).
      cardAtom.environment = environment;
      cardAtom.tracker = tracker;
      cardAtom.authToken = authToken;
      cardAtom.inputStyle = INPUT_STYLE;
      cardAtom.validationEvent = "submit";

      // Assign event callbacks as DOM property functions. These route through
      // the callback refs so they always call the current prop version.
      cardAtom.onReady = () => onReadyRef.current?.();

      cardAtom.onValidated = (data: any) => {
        setValidationError(null);
        onValidatedRef.current?.(data);
      };

      cardAtom.onError = (raw: any) => {
        const message =
          typeof raw === "string" ? raw : raw?.message ?? raw?.error ?? "Payment error occurred.";
        setValidationError(message);
        setSubmitting(false);
        onErrorRef.current?.(message);
      };

      // 3DS / payer-auth handoff — injects the payer-auth atom when triggered.
      cardAtom.onProceedToAuthentication = (data: any) => injectPayerAuth(data);

      cardAtom.onPaymentSuccess = (data: any) => {
        setSubmitting(false);
        onPaymentSuccessRef.current?.(data);
      };

      cardAtom.onPaymentFailure = (data: any) => {
        setSubmitting(false);
        onPaymentFailureRef.current?.(data);
      };

      cardNodeRef.current = cardAtom;
      containerRef.current.appendChild(cardAtom);

      return () => {
        cardNodeRef.current = null;
        if (containerRef.current) containerRef.current.innerHTML = "";
      };
    }, [tracker, authToken, environment]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Payer Auth (3DS) injector ────────────────────────────────────────────
    // Called imperatively from cardAtom.onProceedToAuthentication, not from
    // React render — keeps the payer-auth element out of React's tree entirely.
    function injectPayerAuth(initData: any) {
      if (!containerRef.current) return;

      const authAtom = document.createElement("safepay-payer-auth-atom") as any;
      authAtom.environment = environment;
      authAtom.tracker = tracker;
      authAtom.authToken = authToken;
      authAtom.deviceDataCollectionJWT =
        initData?.deviceDataCollectionJWT ??
        initData?.device_data_collection_jwt ??
        initData?.accessToken ??
        "";
      authAtom.deviceDataCollectionURL =
        initData?.deviceDataCollectionURL ??
        initData?.device_data_collection_url ??
        initData?.actionUrl ??
        "";

      authAtom.onPayerAuthenticationSuccess = (data: any) => {
        setSubmitting(false);
        onPaymentSuccessRef.current?.(data);
      };
      authAtom.onPayerAuthenticationFailure = (data: any) => {
        setSubmitting(false);
        onPaymentFailureRef.current?.(data);
      };

      containerRef.current.appendChild(authAtom);
    }

    async function handlePayClick() {
      if (!cardNodeRef.current) return;
      setValidationError(null);
      setSubmitting(true);
      try {
        const isValid = await cardNodeRef.current.fetchValidity?.();
        if (!isValid) {
          cardNodeRef.current.validate?.();
          setSubmitting(false);
          return;
        }
        cardNodeRef.current.submit?.();
      } catch (err) {
        setSubmitting(false);
        const message = err instanceof Error ? err.message : "Payment could not be processed.";
        setValidationError(message);
        onErrorRef.current?.(message);
      }
    }

    return (
      <div className="safepay-atoms-root">
        {/* Mount point — React never renders children here; the Web Components
            are injected and owned entirely by the useEffect above. */}
        <div ref={containerRef} className="w-full min-h-[150px] relative" />

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
      </div>
    );
  },
);
