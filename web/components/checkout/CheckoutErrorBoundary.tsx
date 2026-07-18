"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  onBack?: () => void;
}

interface State {
  hasError: boolean;
}

/**
 * Isolates third-party Web Component (Safepay Atoms) render errors so that an
 * internal exception inside the payment widget cannot bring down the entire
 * checkout page. Renders a clean inline fallback instead of crashing.
 */
export class CheckoutErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    // Log for observability without surfacing internals to users.
    console.error("[CheckoutErrorBoundary] Payment widget error:", error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-center">
          <p className="text-sm font-semibold text-amber-800">
            Payment fields temporarily unavailable.
          </p>
          <p className="mt-1 text-xs text-amber-700">
            Please click &ldquo;Back to Review&rdquo; and retry. If the problem persists, refresh the
            page.
          </p>
          {this.props.onBack && (
            <button
              onClick={this.props.onBack}
              className="mt-3 rounded-full border border-amber-300 bg-white px-4 py-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
            >
              Back to Review
            </button>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
