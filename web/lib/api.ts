import type {
  Category,
  Dispute,
  AdminProduct,
  ManifestOrder,
  Order,
  Paginated,
  PendingProduct,
  Product,
  ShippingAddress,
  Squad,
  SquadProductSummary,
  SquadVote,
  SupplierApplication,
  SupplierSummary,
} from "./types";

/**
 * Server Components (and any server-side code) talk to the Express API
 * directly over the loopback interface — fast, and never crosses the proxy.
 * The value must be provided via BACKEND_INTERNAL_URL; we fail loudly if it is
 * missing rather than silently falling back to localhost, which can mask
 * misconfiguration in production.
 */
const INTERNAL_API_URL = process.env.BACKEND_INTERNAL_URL;

/**
 * Client Components must go through Next's own origin so the request stays
 * same-origin inside the preview's proxied iframe — see next.config.ts
 * rewrites, which forward `/api/*` to the Express server.
 */
function baseUrl(): string {
  if (typeof window !== "undefined") return "";
  if (!INTERNAL_API_URL) {
    throw new Error(
      "BACKEND_INTERNAL_URL is not set. Server-side API calls require this environment variable.",
    );
  }
  return INTERNAL_API_URL;
}

interface ApiFetchOptions extends RequestInit {
  token?: string | null;
}

async function apiFetch<T>(path: string, { token, ...init }: ApiFetchOptions = {}): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    // Homepage catalog data changes whenever the admin publishes — never
    // serve a stale cached response.
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Request to ${path} failed with ${res.status}`);
  }

  return (await res.json()) as T;
}

export async function fetchActiveSquads(limit = 10): Promise<Squad[]> {
  const result = await apiFetch<Paginated<Squad>>(`/api/squads?limit=${limit}`);
  return result.data;
}

export async function fetchCategories(): Promise<Category[]> {
  const result = await apiFetch<{ data: Category[] }>("/api/products/categories");
  return result.data;
}

export interface FetchProductsOptions {
  category?: string;
  limit?: number;
  page?: number;
  sort?: string;
}

export async function fetchProducts(options: FetchProductsOptions = {}): Promise<Paginated<Product>> {
  const params = new URLSearchParams();
  if (options.category) params.set("category", options.category);
  if (options.limit) params.set("limit", String(options.limit));
  if (options.page) params.set("page", String(options.page));
  if (options.sort) params.set("sort", options.sort);

  const query = params.toString();
  return apiFetch<Paginated<Product>>(`/api/products${query ? `?${query}` : ""}`);
}

export async function fetchAdminProducts(token: string): Promise<AdminProduct[]> {
  const result = await apiFetch<{ data: AdminProduct[] }>("/api/products/admin/all", {
    token,
  });
  return result.data;
}

export async function updateAdminProduct(
  productId: string,
  payload: Partial<ProposeProductPayload> & { isActive?: boolean; supplierId?: string },
  token: string,
): Promise<AdminProduct> {
  const result = await apiFetch<{ data: AdminProduct }>(`/api/products/admin/${productId}`, {
    method: "PUT",
    token,
    body: JSON.stringify(payload),
  });
  return result.data;
}

export async function deleteAdminProduct(productId: string, token: string): Promise<void> {
  await apiFetch(`/api/products/admin/${productId}`, {
    method: "DELETE",
    token,
  });
}

export async function fetchProductById(id: string): Promise<Product> {
  const result = await apiFetch<{ data: Product }>(`/api/products/${id}`);
  return result.data;
}

/** Finds the current Gathering squad for a product, if one exists, so the PDP can show its live progress. */
export async function fetchActiveSquadForProduct(productId: string): Promise<Squad | null> {
  const squads = await fetchActiveSquads(50);
  return squads.find((squad) => squad.productId._id === productId) ?? null;
}

export interface EscrowCheckoutResult {
  trackerId: string;
  checkoutUrl: string;
  authToken: string;
  holdAmount: number;
  productId: string;
  squadId: string | null;
}

export async function initiateEscrowCheckout(
  productId: string,
  squadId: string | undefined,
  token: string,
  quantity: number,
): Promise<EscrowCheckoutResult> {
  const result = await apiFetch<{ data: EscrowCheckoutResult }>("/api/escrow/checkout", {
    method: "POST",
    token,
    body: JSON.stringify({ productId, squadId, quantity }),
  });
  return result.data;
}

/**
 * In production, Safepay calls this webhook once the buyer authorizes the
 * hold on their hosted checkout page. There is no real payment gateway wired
 * up yet (see src/utils/safepay.ts), so nothing will ever call this
 * automatically in this environment — the frontend fires it itself right
 * after checkout to reconcile squad membership, exactly like Safepay would.
 */
export async function simulateEscrowAuthorization(params: {
  trackerId: string;
  amount: number;
  productId: string;
  squadId: string | null;
  buyerId: string;
  token: string;
}): Promise<void> {
  await apiFetch("/api/escrow/simulate", {
    method: "POST",
    token: params.token,
    body: JSON.stringify({
      trackerId: params.trackerId,
      amount: params.amount,
      productId: params.productId,
      squadId: params.squadId,
      buyerId: params.buyerId,
    }),
  });
}

export async function createStandardOrder(params: {
  productId: string;
  quantity?: number;
  shipping?: number;
  token: string;
}): Promise<{ orderId: string; purchaseType: string; totals: { total: number; depositPaid: number; codAmountDue: number } }> {
  const result = await apiFetch<{
    data: { orderId: string; purchaseType: string; totals: { total: number; depositPaid: number; codAmountDue: number } };
  }>("/api/orders", {
    method: "POST",
    token: params.token,
    body: JSON.stringify({
      productId: params.productId,
      quantity: params.quantity ?? 1,
      shipping: params.shipping ?? 0,
    }),
  });
  return result.data;
}

export async function fetchMySquads(token: string): Promise<Squad[]> {
  const result = await apiFetch<{ data: Squad[] }>("/api/squads/me", { token });
  return result.data;
}

export async function voteOnSquad(
  squadId: string,
  vote: SquadVote,
  token: string,
): Promise<{ squadId: string; vote: SquadVote; transactionState: string }> {
  const backendVote = vote === "OptOut" ? "Opt_Out" : "Proceed";
  const result = await apiFetch<{ data: { squadId: string; vote: SquadVote; transactionState: string } }>(
    `/api/squads/${squadId}/vote`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ vote: backendVote }),
    },
  );
  return result.data;
}

export async function fetchMyOrders(token: string): Promise<Order[]> {
  const result = await apiFetch<{ data: Order[] }>("/api/orders/me", { token });
  return result.data;
}

export async function saveShippingAddress(
  address: {
    fullName: string;
    phoneNumber: string;
    province: string;
    city: string;
    area: string;
    streetAddress: string;
    landmark?: string;
  },
  token: string,
): Promise<import("./types").ShippingAddress> {
  const result = await apiFetch<{ data: import("./types").ShippingAddress }>(
    "/api/users/profile/address",
    {
      method: "PUT",
      token,
      body: JSON.stringify(address),
    },
  );
  return result.data;
}

export async function getShippingAddress(
  token: string,
): Promise<import("./types").ShippingAddress | null> {
  const result = await apiFetch<{ data: import("./types").ShippingAddress | null }>(
    "/api/users/profile/address",
    { token },
  );
  return result.data;
}

/* ─── Admin: Squad Operations ─────────────────────────────────────── */

export interface AdminSquadDetail {
  _id: string;
  productId: SquadProductSummary;
  targetMembers: number;
  currentMembers: number;
  members: Array<{
    userId: string;
    joinedAt: string;
    vote?: SquadVote;
    name: string;
    phoneNumber: string;
    email?: string;
    shippingAddress: ShippingAddress | null;
  }>;
  expiresAt: string;
  status: string;
}

export async function adminListSquads(token: string): Promise<Squad[]> {
  const result = await apiFetch<{ data: Squad[] }>("/api/admin/squads", { token });
  return result.data;
}

export async function adminGetSquad(squadId: string, token: string): Promise<AdminSquadDetail> {
  const result = await apiFetch<{ data: AdminSquadDetail }>(`/api/admin/squads/${squadId}`, { token });
  return result.data;
}

export async function adminDispatchSquad(
  squadId: string,
  token: string,
): Promise<{ squadId: string; status: string; membersDispatched: number }> {
  const result = await apiFetch<{ data: { squadId: string; status: string; membersDispatched: number } }>(
    `/api/admin/squads/${squadId}/dispatch`,
    { method: "POST", token },
  );
  return result.data;
}

export async function adminCreateSquad(
  body: { productId: string; targetMembers?: number; expiryHours?: number },
  token: string,
): Promise<{ _id: string; status: string }> {
  const result = await apiFetch<{ data: { _id: string; status: string } }>(
    "/api/admin/squads/create",
    { method: "POST", token, body: JSON.stringify(body) },
  );
  return result.data;
}

/* ─── Admin: Financial Ledger ─────────────────────────────────────── */

export interface FinanceOverview {
  totalEscrowHolding: number;
  pendingSupplierPayouts: number;
  totalPlatformRevenue: number;
}

export interface LedgerEntry {
  date: string;
  transactionId: string;
  squadId: string | null;
  productName: string;
  type: string;
  colorClass: string;
  amount: number;
  commission: number;
}

export async function adminFinanceOverview(token: string): Promise<FinanceOverview> {
  const result = await apiFetch<{ data: FinanceOverview }>("/api/admin/finance/overview", { token });
  return result.data;
}

export async function adminFinanceLedger(token: string): Promise<LedgerEntry[]> {
  const result = await apiFetch<{ data: LedgerEntry[] }>("/api/admin/finance/ledger", { token });
  return result.data;
}

/* ─── Admin: Customer Directory ───────────────────────────────────── */

export interface AdminCustomer {
  _id: string;
  name: string;
  email: string;
  phoneNumber: string;
  activePledges: number;
  lifetimeSpend: number;
  accountStatus: "Active" | "Suspended";
  isSuspended: boolean;
}

export interface AdminCustomerDetail extends AdminCustomer {
  shippingAddress: ShippingAddress | null;
  createdAt: string;
  orderHistory: Array<{
    _id: string;
    date: string;
    productName: string;
    squadId: string | null;
    amount: number;
    escrowState: string;
  }>;
}

export async function adminListCustomers(token: string): Promise<AdminCustomer[]> {
  const result = await apiFetch<{ data: AdminCustomer[] }>("/api/admin/customers", { token });
  return result.data;
}

export async function adminGetCustomer(customerId: string, token: string): Promise<AdminCustomerDetail> {
  const result = await apiFetch<{ data: AdminCustomerDetail }>(`/api/admin/customers/${customerId}`, { token });
  return result.data;
}

export async function adminToggleSuspendCustomer(
  customerId: string,
  token: string,
): Promise<{ isSuspended: boolean }> {
  const result = await apiFetch<{ data: { isSuspended: boolean } }>(
    `/api/admin/customers/${customerId}/suspend`,
    { method: "PUT", token },
  );
  return result.data;
}

export async function sendWhatsappOtp(phoneNumber: string): Promise<{ message: string; devOtp?: string }> {
  return apiFetch("/api/auth/whatsapp/send", {
    method: "POST",
    body: JSON.stringify({ phoneNumber }),
  });
}

export async function verifyWhatsappOtp(
  phoneNumber: string,
  otp: string,
  name?: string,
): Promise<{ token: string; user: { id: string; phoneNumber: string; name: string; role: string } }> {
  return apiFetch("/api/auth/whatsapp/verify", {
    method: "POST",
    body: JSON.stringify({ phoneNumber, otp, name }),
  });
}

export async function loginB2B(
  identifier: string,
  password: string,
  role: "Admin" | "Supplier",
): Promise<{ token: string; user: { id: string; phoneNumber: string; name: string; role: string; verificationStatus?: "Pending" | "Approved" | "Rejected" } }> {
  return apiFetch("/api/auth/b2b/login", {
    method: "POST",
    body: JSON.stringify({ identifier, password, role }),
  });
}

export async function registerSupplierApplication(payload: {
  businessName: string;
  contactNumber: string;
  email: string;
  password: string;
}): Promise<{ message: string; data: { userId: string; contactNumber: string }; devOtp?: string }> {
  return apiFetch("/api/auth/supplier/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function verifySupplierOtp(
  contactNumber: string,
  otp: string,
): Promise<{ message: string; data: { userId: string; verified: boolean } }> {
  return apiFetch("/api/auth/supplier/verify-otp", {
    method: "POST",
    body: JSON.stringify({ contactNumber, otp }),
  });
}

export async function submitSupplierVerification(
  payload: {
    contactVerification: { emailVerified: boolean; phoneVerified: boolean };
    businessInfo: { businessName: string; website?: string; dropshipNetworkId: string };
    legalDocs: {
      ownerName: string;
      cnicNumber: string;
      cnicFrontUrl: string;
      cnicBackUrl: string;
      ntnNumber: string;
      ntnDocUrl: string;
    };
    bankDetails: { accountTitle: string; iban: string; bankCertUrl: string };
  },
  token: string,
): Promise<{ message: string; data: { verificationStatus: string } }> {
  const result = await apiFetch<{ message: string; data: { verificationStatus: string } }>(
    "/api/users/supplier/verify/submit",
    {
      method: "PUT",
      token,
      body: JSON.stringify(payload),
    },
  );
  return result;
}

/* Supplier deals + stock management */
export async function fetchSupplierMyDeals(token: string): Promise<{
  proposed: Product[];
  rejected: Product[];
  active: Product[];
}> {
  const result = await apiFetch<{ data: { proposed: Product[]; rejected: Product[]; active: Product[] } }>(
    "/api/products/supplier/my-deals",
    { token },
  );
  return result.data;
}

export async function updateSupplierStock(
  productId: string,
  stockAvailable: number,
  token: string,
): Promise<{ stockAvailable: number }> {
  const result = await apiFetch<{ data: { stockAvailable: number } }>(
    `/api/products/supplier/${productId}/stock`,
    { method: "PATCH", token, body: JSON.stringify({ stockAvailable }) },
  );
  return result.data;
}

/* Admin dispatched orders + cancel */
export async function adminFetchDispatchedOrders(token: string): Promise<ManifestOrder[]> {
  const result = await apiFetch<{ data: ManifestOrder[] }>("/api/orders/admin/dispatched", { token });
  return result.data;
}

export async function adminCancelOrder(orderId: string, token: string): Promise<{ logisticsStatus: string }> {
  const result = await apiFetch<{ data: { logisticsStatus: string } }>(
    `/api/orders/admin/${orderId}/cancel`,
    { method: "PUT", token },
  );
  return result.data;
}

/* ------------------------------------------------------------------ */
/* Supplier proposals + Admin proposal queue                          */
/* ------------------------------------------------------------------ */

export interface ProposeProductPayload {
  title: string;
  description: string;
  images: string[];
  category: string;
  market_anchor_price: number;
  base_wholesale_cost: number;
  max_squad_discount_percent: number;
  deposit_percentage?: number;
  dualCheckoutEnabled?: boolean;
  maxSquadMembers?: number;
}

export async function proposeProduct(payload: ProposeProductPayload, token: string): Promise<Product> {
  const result = await apiFetch<{ data: Product }>("/api/products/supplier/propose", {
    method: "PUT",
    token,
    body: JSON.stringify(payload),
  });
  return result.data;
}

export async function uploadProductDirect(
  payload: ProposeProductPayload & { supplierId: string },
  token: string,
): Promise<Product> {
  const result = await apiFetch<{ data: Product }>("/api/products/admin/upload", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
  return result.data;
}

export interface MediaUploadPayload {
  title: string;
  description: string;
  category: string;
  supplierId: string;
  market_anchor_price: number;
  base_wholesale_cost: number;
  max_squad_discount_percent: number;
  deposit_percentage?: number;
  dualCheckoutEnabled?: boolean;
  maxSquadMembers?: number;
  imageUrls: string[];
  mediaFiles: File[];
}

export async function uploadProductWithMedia(
  payload: MediaUploadPayload,
  token: string,
): Promise<Product> {
  const formData = new FormData();
  formData.append("title", payload.title);
  formData.append("description", payload.description);
  formData.append("category", payload.category);
  formData.append("supplierId", payload.supplierId);
  formData.append("market_anchor_price", String(payload.market_anchor_price));
  formData.append("base_wholesale_cost", String(payload.base_wholesale_cost));
  formData.append("max_squad_discount_percent", String(payload.max_squad_discount_percent));
  if (payload.deposit_percentage != null) formData.append("deposit_percentage", String(payload.deposit_percentage));
  if (payload.dualCheckoutEnabled != null) formData.append("dualCheckoutEnabled", String(payload.dualCheckoutEnabled));
  if (payload.maxSquadMembers != null) formData.append("maxSquadMembers", String(payload.maxSquadMembers));

  // Append pasted URLs as repeated fields
  for (const url of payload.imageUrls) {
    formData.append("imageUrls", url);
  }
  // Append actual files
  for (const file of payload.mediaFiles) {
    formData.append("mediaFiles", file);
  }

  const res = await fetch(`${baseUrl()}/api/products/admin/upload`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Upload failed." }));
    throw new Error(error.error ?? `Upload failed (${res.status})`);
  }

  const result = await res.json();
  return result.data as Product;
}

export async function fetchPendingProducts(token: string): Promise<PendingProduct[]> {
  const result = await apiFetch<{ data: PendingProduct[] }>("/api/products/admin/pending", { token });
  return result.data;
}

export async function approveProduct(productId: string, token: string): Promise<Product> {
  const result = await apiFetch<{ data: Product }>(`/api/products/${productId}/approve`, {
    method: "PUT",
    token,
  });
  return result.data;
}

export async function rejectProduct(productId: string, token: string): Promise<Product> {
  const result = await apiFetch<{ data: Product }>(`/api/products/${productId}/reject`, {
    method: "PUT",
    token,
  });
  return result.data;
}

export async function fetchSuppliers(token: string): Promise<SupplierSummary[]> {
  const result = await apiFetch<{ data: SupplierSummary[] }>("/api/users/suppliers", { token });
  return result.data;
}

export async function fetchSupplierApplications(token: string): Promise<SupplierApplication[]> {
  const result = await apiFetch<{ data: SupplierApplication[] }>("/api/users/supplier-applications", { token });
  return result.data;
}

export async function resolveSupplierApplication(
  applicationId: string,
  payload: { action: "Approve" | "Reject" | "Request_Changes"; feedback?: string },
  token: string,
): Promise<{ id: string; verificationStatus: string; adminFeedback?: string | null }> {
  const result = await apiFetch<{
    data: { id: string; verificationStatus: string; adminFeedback?: string | null };
  }>(`/api/users/supplier-applications/${applicationId}/decision`, {
    method: "PATCH",
    token,
    body: JSON.stringify(payload),
  });
  return result.data;
}

export async function messageSupplier(
  applicationId: string,
  message: string,
  token: string,
): Promise<{ sentTo: string }> {
  const result = await apiFetch<{ data: { id: string; sentTo: string } }>(
    `/api/users/supplier-applications/${applicationId}/message`,
    {
      method: "POST",
      token,
      body: JSON.stringify({ message }),
    },
  );
  return result.data;
}

/* ------------------------------------------------------------------ */
/* Supplier order manifests                                           */
/* ------------------------------------------------------------------ */

export async function fetchSupplierManifests(token: string): Promise<ManifestOrder[]> {
  const result = await apiFetch<{ data: ManifestOrder[] }>("/api/orders/manifest", { token });
  return result.data;
}

export async function updateOrderTracking(
  orderId: string,
  trackingNumber: string,
  courier: string,
  token: string,
): Promise<{ orderId: string; trackingNumber: string; courier?: string; logisticsStatus: string }> {
  const result = await apiFetch<{
    data: { orderId: string; trackingNumber: string; courier?: string; logisticsStatus: string };
  }>(`/api/orders/${orderId}/tracking`, {
    method: "PUT",
    token,
    body: JSON.stringify({ trackingNumber, courier }),
  });
  return result.data;
}

/* ------------------------------------------------------------------ */
/* Admin dispute / ledger console                                     */
/* ------------------------------------------------------------------ */

export async function fetchDisputes(token: string): Promise<Dispute[]> {
  const result = await apiFetch<{ data: Dispute[] }>("/api/disputes", { token });
  return result.data;
}

export async function resolveDispute(
  disputeId: string,
  resolution: "Refund" | "Reject",
  adminNotes: string,
  token: string,
): Promise<{ disputeId: string; status: string }> {
  const result = await apiFetch<{ data: { disputeId: string; status: string } }>(
    `/api/disputes/${disputeId}/resolve`,
    {
      method: "PUT",
      token,
      body: JSON.stringify({ resolution, admin_notes: adminNotes }),
    },
  );
  return result.data;
}
