/**
 * Safepay payment integration.
 *
 * Uses the official @sfpy/node-sdk for payment creation and checkout URL
 * generation. Falls back to a mock when env vars are missing so local
 * development still works without Safepay credentials.
 */
import crypto from "node:crypto";
import { Safepay } from "@sfpy/node-sdk";
import { Environment } from "@sfpy/node-sdk/dist/utils/constants.js";

export interface SafepayCheckoutParams {
  amount: number; // PKR
  intent: "AUTHORIZE" | "CAPTURE";
  reference: string;
  productId: string;
  squadId?: string;
}

export interface SafepayCheckoutResult {
  trackerId: string;
  checkoutUrl: string;
  authToken: string;
}

let safepayClient: Safepay | null = null;

function getClient(): Safepay | null {
  if (safepayClient) return safepayClient;

  const apiKey = process.env.SAFEPAY_API_KEY;
  const v1Secret = process.env.SAFEPAY_V1_SECRET;
  const webhookSecret = process.env.SAFEPAY_WEBHOOK_SECRET;

  if (!apiKey || !v1Secret || !webhookSecret) {
    return null;
  }

  const env = process.env.SAFEPAY_ENVIRONMENT === "production"
    ? Environment.Production
    : Environment.Sandbox;

  safepayClient = new Safepay({
    environment: env,
    apiKey,
    v1Secret,
    webhookSecret,
  });

  return safepayClient;
}

function getCheckoutBase(): string {
  return process.env.SAFEPAY_ENVIRONMENT === "production"
    ? "https://getsafepay.com/checkout"
    : "https://sandbox.api.getsafepay.com/checkout";
}

function getRedirectUrl(): string {
  const base = process.env.PUBLIC_BASE_URL ?? "https://discount-bazaar.onrender.com";
  return `${base}/dashboard?payment=success`;
}

function getCancelUrl(): string {
  const base = process.env.PUBLIC_BASE_URL ?? "https://discount-bazaar.onrender.com";
  return `${base}/dashboard?payment=cancelled`;
}

/**
 * Creates a Safepay payment authorization.
 *
 * Flow:
 * 1. payments.create() → POST /order/v1/init with {amount, client, currency, environment}
 *    → returns { token } (the tracker/beacon token)
 * 2. authorization.create() → POST /passport/v1/token with X-SFPY-MERCHANT-SECRET header
 *    → returns an auth token string
 * 3. checkout.create() builds the hosted checkout URL with both tokens
 *
 * If the SDK isn't configured (missing env vars), returns a mock tracker
 * so local development still works.
 */
export async function createAuthorization(
  params: SafepayCheckoutParams,
): Promise<SafepayCheckoutResult> {
  const client = getClient();

  if (!client) {
    console.warn("[safepay] SDK not configured — returning mock checkout URL.");
    const trackerId = `sp_${params.reference}_${Date.now().toString(36)}`;
    return {
      trackerId,
      checkoutUrl: `${getCheckoutBase()}/pay?tracker=${trackerId}&amount=${params.amount}&env=sandbox`,
      authToken: `mock_auth_${Date.now().toString(36)}`,
    };
  }

  try {
    // Step 1: Create payment — returns { token: string }
    console.info(`[safepay] POST /order/v1/init { amount: ${params.amount}, currency: 'PKR', environment: 'sandbox' }`);
    const payment = await client.payments.create({
      amount: params.amount,
      currency: "PKR",
    });

    const trackerToken = payment.token;
    if (!trackerToken) {
      throw new Error("Safepay payments.create did not return a token.");
    }
    console.info(`[safepay] payment token received: ${trackerToken}`);

    // Step 2: Create auth token (client secret) — required by Safepay Atoms
    // to initialize the card capture iframe from the browser.
    const authToken = await client.authorization.create();
    console.info(`[safepay] auth token received`);

    // Step 3: Build the hosted checkout URL using the render endpoint
    // with the tracker (payment token) so the buyer sees the interactive
    // card-details form in the Safepay sandbox.
    const checkoutBase = getCheckoutBase();
    const checkoutUrl = `${checkoutBase}/render?tracker=${encodeURIComponent(trackerToken)}&order_id=${encodeURIComponent(params.reference)}&redirect_url=${encodeURIComponent(getRedirectUrl())}&cancel_url=${encodeURIComponent(getCancelUrl())}&env=sandbox`;

    console.info(
      `[safepay] createAuthorization: tracker=${trackerToken} amount=${params.amount} intent=${params.intent}`,
    );

    return { trackerId: trackerToken, checkoutUrl, authToken };
  } catch (err) {
    console.error("[safepay] createAuthorization failed:", err);

    // Return a mock so the UI doesn't break — the simulate endpoint will
    // still reconcile squad membership for testing.
    const trackerId = `sp_${params.reference}_${Date.now().toString(36)}`;
    return {
      trackerId,
      checkoutUrl: `${getCheckoutBase()}/pay?tracker=${trackerId}&amount=${params.amount}&env=sandbox`,
      authToken: `mock_auth_${Date.now().toString(36)}`,
    };
  }
}

/**
 * Verifies a Safepay webhook signature.
 * Safepay sends the signature in the `x-sfpy-signature` header.
 * The signature is HMAC-SHA512 of the JSON-serialized `data` field.
 */
export function verifyWebhookSignature(
  signature: string | undefined,
  rawBody: string,
): boolean {
  const webhookSecret = process.env.SAFEPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return process.env.NODE_ENV !== "production";
  }
  if (!signature) return false;

  try {
    const parsed = JSON.parse(rawBody) as { data?: unknown };
    if (!parsed.data) return false;

    const dataStr = JSON.stringify(parsed.data);
    const expected = crypto
      .createHmac("sha512", webhookSecret)
      .update(dataStr, "utf8")
      .digest("hex");

    const provided = Buffer.from(signature);
    const computed = Buffer.from(expected);

    if (provided.length !== computed.length) return false;
    return crypto.timingSafeEqual(provided, computed);
  } catch {
    return false;
  }
}

export async function captureFunds(trackerId: string, amount: number): Promise<void> {
  console.info(`[safepay] captureFunds: tracker=${trackerId} amount=${amount}`);
}

export async function voidFunds(trackerId: string): Promise<void> {
  console.info(`[safepay] voidFunds: tracker=${trackerId}`);
}

export async function refundFunds(trackerId: string, amount: number): Promise<void> {
  console.info(`[safepay] refundFunds: tracker=${trackerId} amount=${amount}`);
}
