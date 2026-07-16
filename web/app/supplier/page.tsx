"use client";

import { useCallback, useEffect, useState } from "react";
import { RoleGuard } from "@/components/auth/RoleGuard";
import { PortalShell, type PortalTab } from "@/components/portal/PortalShell";
import { ProposeDealForm } from "@/components/supplier/ProposeDealForm";
import { OrderManifestTable } from "@/components/supplier/OrderManifestTable";
import { ToastStack, useToasts } from "@/components/ui/Toast";
import { useAuth } from "@/lib/AuthContext";
import { fetchSupplierManifests, submitSupplierVerification } from "@/lib/api";
import type { ManifestOrder } from "@/lib/types";

type Tab = "verification" | "propose" | "manifests";

const DROPSHIP_NETWORKS = [
  { value: "", label: "Select your dropship network…" },
  { value: "HHC", label: "HHC Distribution Co." },
  { value: "YourMart", label: "YourMart" },
  { value: "Daraz", label: "Daraz Dropship" },
  { value: "Other", label: "Other / Independent" },
];

function SupplierPortal() {
  const { user, token } = useAuth();
  const { toasts, pushToast, dismissToast } = useToasts();
  const [tab, setTab] = useState<Tab>("verification");
  const [orders, setOrders] = useState<ManifestOrder[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const verificationStatus = user?.verificationStatus ?? "Approved";
  const isVerified = verificationStatus === "Approved";

  // Build tabs — "Business Verification" is always present.
  // Other tabs are visible but locked when not verified.
  const allTabs: (PortalTab & { locked?: boolean })[] = [
    { id: "verification", label: "Business Verification", icon: "🛡️" },
    { id: "propose", label: "Propose Deal", icon: "📦", locked: !isVerified },
    { id: "manifests", label: "Order Manifests", icon: "📋", locked: !isVerified },
  ];

  // If user tries to switch to a locked tab, bounce back to verification
  function handleTabChange(id: string) {
    const target = allTabs.find((t) => t.id === id);
    if (target?.locked) {
      pushToast("Complete business verification first.", "error");
      return;
    }
    setTab(id as Tab);
  }

  const loadManifests = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setOrders(await fetchSupplierManifests(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load order manifests.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (isVerified && tab === "manifests") {
      const timer = window.setTimeout(() => void loadManifests(), 0);
      return () => window.clearTimeout(timer);
    }
  }, [isVerified, tab, loadManifests]);

  // Auto-redirect unverified users to the verification tab on mount
  useEffect(() => {
    if (!isVerified) setTab("verification");
  }, [isVerified]);

  function renderTabContent() {
    if (tab === "verification") {
      return (
        <BusinessVerificationTab
          status={verificationStatus}
          token={token ?? ""}
          onSubmitted={() => {
            pushToast("Verification submitted!", "success");
            window.location.reload();
          }}
        />
      );
    }

    if (!isVerified) {
      // Safety net — locked tabs should never render their content
      return (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm text-slate-500">
            This section unlocks after your business verification is approved.
          </p>
        </div>
      );
    }

    if (tab === "propose") {
      return (
        <div>
          <h1 className="font-heading text-2xl font-bold text-slate-900">Propose a Deal</h1>
          <p className="mt-1 text-sm text-slate-500">
            Submit a new product for admin review — it goes live once approved.
          </p>
          <div className="mt-6">
            <ProposeDealForm onSubmitted={(message, ok) => pushToast(message, ok ? "success" : "error")} />
          </div>
        </div>
      );
    }

    return (
      <div>
        <h1 className="font-heading text-2xl font-bold text-slate-900">Order Manifests</h1>
        <p className="mt-1 text-sm text-slate-500">Orders ready for dispatch from your catalog.</p>
        <div className="mt-6">
          {isLoading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : (
            <OrderManifestTable
              orders={orders}
              onUpdated={(updated) => setOrders((prev) => prev.map((o) => (o._id === updated._id ? updated : o)))}
              onNotify={(message, ok) => pushToast(message, ok ? "success" : "error")}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <PortalShell
      title="Supplier Portal"
      subtitle="Supplier account"
      tabs={allTabs}
      activeTab={tab}
      onTabChange={handleTabChange}
    >
      {renderTabContent()}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </PortalShell>
  );
}

function BusinessVerificationTab({
  status,
  token,
  onSubmitted,
}: {
  status: string;
  token: string;
  onSubmitted: () => void;
}) {
  if (status === "Approved") {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="rounded-3xl border border-mint/30 bg-mint/10 p-8 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-mint text-white">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="h-7 w-7">
              <path d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="mt-4 font-heading text-2xl font-bold text-slate-900">You are verified</h1>
          <p className="mt-2 text-sm text-slate-600">
            Your business is fully verified. All dashboard features are unlocked.
          </p>
        </div>
      </div>
    );
  }

  if (status === "Pending") {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-8 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-100 text-amber-700">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-7 w-7">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
          </div>
          <h1 className="mt-4 font-heading text-2xl font-bold text-slate-900">Documents under review</h1>
          <p className="mt-2 text-sm text-slate-600">
            Your documents are submitted and under review. Full dashboard access will unlock
            automatically upon verification approval.
          </p>
        </div>
      </div>
    );
  }

  // Unverified — show the KYC form
  return <KycForm token={token} onSubmitted={onSubmitted} />;
}

function KycForm({ token, onSubmitted }: { token: string; onSubmitted: () => void }) {
  const [dropshipNetworkId, setDropshipNetworkId] = useState("");
  const [cnicNtn, setCnicNtn] = useState("");
  const [proofUrls, setProofUrls] = useState<string[]>(["", "", "", ""]);
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateProofUrl(index: number, value: string) {
    setProofUrls((prev) => prev.map((u, i) => (i === index ? value : u)));
  }

  async function handleSubmit() {
    setError(null);
    if (!dropshipNetworkId) {
      setError("Please select your dropship network.");
      return;
    }
    if (!cnicNtn.trim()) {
      setError("CNIC / NTN number is required.");
      return;
    }
    setSubmitting(true);
    try {
      const filteredUrls = proofUrls.filter((u) => u.trim());
      await submitSupplierVerification(
        { dropshipNetworkId, cnicNtn: cnicNtn.trim(), businessProofUrls: filteredUrls },
        token,
      );
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit verification.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="inline-flex rounded-full bg-mint/15 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-mint-dark">
          Business Verification Required
        </div>

        <h1 className="mt-4 font-heading text-3xl font-bold text-slate-900">Verify your business</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          Complete your KYC verification to unlock the full supplier dashboard. Your documentation
          will be reviewed by our compliance team.
        </p>

        <div className="mt-8 space-y-6">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Dropship Network ID
            </label>
            <select
              value={dropshipNetworkId}
              onChange={(e) => setDropshipNetworkId(e.target.value)}
              className="input"
            >
              {DROPSHIP_NETWORKS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              CNIC / NTN Number
            </label>
            <input
              value={cnicNtn}
              onChange={(e) => setCnicNtn(e.target.value)}
              placeholder="e.g. 35202-1234567-8 or NTN-1234567"
              className="input"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Business Proof / CNIC Images (URLs)
            </label>
            <p className="mb-3 text-xs text-slate-400">
              Paste up to 4 direct image URLs of your CNIC, business registration, or proof documents.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {proofUrls.map((url, i) => (
                <input
                  key={i}
                  value={url}
                  onChange={(e) => updateProofUrl(i, e.target.value)}
                  placeholder={`Proof image ${i + 1} URL`}
                  className="input"
                />
              ))}
            </div>
          </div>

          {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="w-full rounded-2xl bg-oceanic px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-oceanic/20 transition hover:bg-oceanic-dark disabled:opacity-60"
          >
            {isSubmitting ? "Submitting…" : "Submit Business Verification"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SupplierPage() {
  return (
    <RoleGuard role="Supplier">
      <SupplierPortal />
    </RoleGuard>
  );
}
