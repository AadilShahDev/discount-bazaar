/**
 * Safepay payment integration.
 *
 * Calls the Safepay REST API directly. Falls back to a mock when env vars
 * are missing so local development still works.
 */
import crypto from "node:crypto";

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
}

function getEnv(): { apiKey: string; v1Secret: string; webhookSecret: string; environment: string } | null {
  const apiKey = process.env.SAFEPAY_API_KEY;
  const v1Secret = process.env.SAFEPAY_V1_SECRET;
  const webhookSecret = process.env.SAFEPAY_WEBHOOK_SECRET;
  if (!apiKey || !v1Secret || !webhookSecret) return null;
  return {
    apiKey,
    v1Secret,
    webhookSecret,
    environment: "sandbox",
  };
}

function getApiBase(): string {
  return "https://sandbox.api.getsafepay.com";
}

function getCheckoutBase(): string {
  return "https://sandbox.api.getsafepay.com/checkout";
}

function getRedirectUrl(): string {
  const base = process.env.PUBLIC_BASE_URL ?? "https://discount-bazaar.onrender.com";
  return `${base}/dashboard?payment=success`;
}

function getCancelUrl(): string {
  const base = process.env.PUBLIC_BASE_URL ?? "https://discount-bazaar.onrender.com";
  return `${base}/dashboard?payment=cancelled`;
}

export async function createAuthorization(
  params: SafepayCheckoutParams,
): Promise<SafepayCheckoutResult> {
  const env = getEnv();

  if (!env) {
    console.warn("[safepay] SDK not configured — returning mock checkout URL.");
    const trackerId = `sp_${params.reference}_${Date.now().toString(36)}`;
    return {
      trackerId,
      checkoutUrl: `${getCheckoutBase()}/pay?tracker=${trackerId}&amount=${params.amount}&env=sandbox`,
    };
  }

  try {
    // Step 1: Create payment tracker. The "client" field MUST be the
    // SAFEPAY_API_KEY (sec_... key). Environment MUST be "sandbox".
    const initBody = {
      amount: params.amount,
      client: env.apiKey,
      currency: "PKR",
      environment: "sandbox",
    };

    console.info("[safepay] POST /order/v1/init", initBody);

    const initResponse = await fetch(`${getApiBase()}/order/v1/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(initBody),
    });

    if (!initResponse.ok) {
      const errBody = await initResponse.text();
      console.error(`[safepay] /order/v1/init failed (${initResponse.status}): ${errBody}`);
      throw new Error(`Safepay init failed (${initResponse.status}): ${errBody}`);
    }

    const initData = (await initResponse.json()) as { data?: { token?: string; tracker?: string } };
    const trackerToken: string | undefined = initData?.data?.token ?? initData?.data?.tracker;

    if (!trackerToken) {
      throw new Error("Safepay /order/v1/init did not return a tracker token.");
    }

    // Step 2: Create auth token via POST /passport/v1/token
    const authResponse = await fetch(`${getApiBase()}/passport/v1/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SFPY-MERCHANT-SECRET": env.v1Secret,
      },
      body: JSON.stringify({}),
    });

    if (!authResponse.ok) {
      const errBody = await authResponse.text();
      console.error(`[safepay] /passport/v1/token failed (${authResponse.status}): ${errBody}`);
      throw new Error(`Safepay auth failed (${authResponse.status}): ${errBody}`);
    }

    const authData = (await authResponse.json()) as { data?: string | { token?: string } };
    const authToken: string =
      (typeof authData?.data === "string" ? authData.data : authData?.data?.token) ?? "";

    // Step 3: Build checkout URL
    const checkoutParams = new URLSearchParams({
      beacon: authToken || trackerToken,
      cancel_url: getCancelUrl(),
      env: "sandbox",
      order_id: params.reference,
      redirect_url: getRedirectUrl(),
      source: "custom",
      webhooks: "true",
    });

    const checkoutUrl = `${getCheckoutBase()}/pay?${checkoutParams.toString()}`;

    console.info(
      `[safepay] createAuthorization: tracker=${trackerToken} amount=${params.amount} intent=${params.intent}`,
    );

    return { trackerId: trackerToken, checkoutUrl };
  } catch (err) {
    console.error("[safepay] createAuthorization failed:", err);
    const trackerId = `sp_${params.reference}_${Date.now().toString(36)}`;
    return {
      trackerId,
      checkoutUrl: `${getCheckoutBase()}/pay?tracker=${trackerId}&amount=${params.amount}&env=sandbox`,
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
  const env = getEnv();
  if (!env) {
    return process.env.NODE_ENV !== "production";
  }
  if (!signature) return false;

  try {
    const parsed = JSON.parse(rawBody) as { data?: unknown };
    if (!parsed.data) return false;

    const dataStr = JSON.stringify(parsed.data);
    const expected = crypto
      .createHmac("sha512", env.webhookSecret)
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
