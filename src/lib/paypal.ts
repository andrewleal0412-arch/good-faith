import "server-only";
import { createHash } from "node:crypto";

// PayPal REST in the sandbox (PAYPAL_ENVIRONMENT=SANDBOX). Invoices collect the deposit; at move-out the agent returns
// it through PayPal's Agent Toolkit (a refund of the original payment) or, past PayPal's refund window, a Payout.
// Proven against the sandbox by scripts/sandbox_smoke.py on 2026-10-01.
const BASE = process.env.PAYPAL_ENVIRONMENT === "LIVE" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const WEB = process.env.PAYPAL_ENVIRONMENT === "LIVE" ? "https://www.paypal.com" : "https://www.sandbox.paypal.com";

let cached: { token: string; until: number } | null = null;

export const SANDBOX = process.env.PAYPAL_ENVIRONMENT !== "LIVE";

/** PayPal answered with an error status (its sign-in included), so the request did nothing there. A network failure
 *  is not one of these: PayPal may have acted before the answer was lost. `status` and `body` are PayPal's answer
 *  (0 and "" when the app refused on its own). */
export class PayPalRefused extends Error {
  constructor(message: string, readonly status = 0, readonly body = "") {
    super(message);
  }
}

/** How long a PayPal call may take before the app stops waiting (a webhook delivery must finish well inside the five
 *  minutes after which claim_paypal_event hands its event to the next delivery). */
const TIMEOUT_MS = 20_000;

/** OAuth access token (client credentials), cached until a minute before it expires. */
export async function accessToken(): Promise<string> {
  if (cached && Date.now() < cached.until) return cached.token;
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new PayPalRefused(`PayPal auth failed: ${r.status}`, r.status);
  const j = await r.json();
  cached = { token: j.access_token, until: Date.now() + (j.expires_in - 60) * 1000 };
  return cached.token;
}

/** A REST call. Every write passes `requestId`, sent as PayPal-Request-Id, always derived from our own record (the
 *  tenancy, the claim, the run), never random. PayPal's Payments and Payouts APIs answer the same request sent again
 *  with the first result instead of acting twice. Its Invoicing API ignores the header (tried in the sandbox on
 *  2026-10-05: two creates with one key made two invoices), so the deposit invoice is made once by its invoice number
 *  instead (depositInvoiceNumber). `timeoutMs` stops waiting on a read that hangs. */
export async function paypal<T = Record<string, unknown>>(method: string, path: string, body?: unknown, o: { requestId?: string; timeoutMs?: number } = {}): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json",
      ...(o.requestId ? { "PayPal-Request-Id": o.requestId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...(o.timeoutMs ? { signal: AbortSignal.timeout(o.timeoutMs) } : {}),
  });
  const text = await r.text();
  if (!r.ok) throw new PayPalRefused(`PayPal ${method} ${path} -> ${r.status}: ${text.slice(0, 300)}`, r.status, text.slice(0, 4000));
  return (text ? JSON.parse(text) : {}) as T;
}

/** PayPal refused the invoice before creating it: nothing exists in the sandbox. */
export class InvoiceNotCreated extends Error {}

/** A tenancy's deposit invoice number: the tenancy and what the invoice says, hashed into PayPal's 25-character limit
 *  ("GF-" and 20 hex digits). PayPal refuses a second invoice with a number it already has (DUPLICATE_INVOICE_NUMBER,
 *  tried in the sandbox on 2026-10-05), so a retry of the same request (a lost answer, a double click in two tabs, an
 *  invoice made but not saved here or not sent) can't make a second invoice: it finds the first by its number. An
 *  invoice with other content (the lease was corrected in between) is a different invoice. */
export const depositInvoiceNumber = (tenancyId: string, content: unknown) =>
  `GF-${createHash("sha256").update(`${tenancyId}\n${JSON.stringify(content)}`).digest("hex").slice(0, 20)}`;

/** PayPal's answer to a second invoice with the same number. */
const duplicateNumber = (e: unknown) => e instanceof PayPalRefused && e.status === 422 && e.body.includes("DUPLICATE_INVOICE_NUMBER");

/** The invoice PayPal has under this number, or null. */
async function invoiceByNumber(number: string): Promise<{ id: string; status: string } | null> {
  const r = await paypal<{ items?: { id?: string; status?: string; detail?: { invoice_number?: string } }[] }>(
    "POST", "/v2/invoicing/search-invoices?page=1&page_size=5", { invoice_number: number }, { timeoutMs: TIMEOUT_MS });
  const hit = (r.items ?? []).find((i) => i.detail?.invoice_number === number && i.id);
  return hit ? { id: hit.id!, status: hit.status ?? "DRAFT" } : null;
}

/** Create and send the deposit invoice. Returns the invoice id, its number and the tenant's pay link. Made once at
 *  PayPal by its number (depositInvoiceNumber): when PayPal already has it, that invoice is the one used (`adopted`),
 *  and sent only if it is still a draft. Both calls also carry a PayPal-Request-Id from the same record. */
export async function sendDepositInvoice(opts: {
  tenancyId: string;
  tenantEmail: string; amount: number; landlordName: string; address: string; note: string;
  terms: string; // the state pack's terms line, e.g. "Security deposit held and returned under California Civil Code 1950.5."
}) {
  const content = {
    detail: {
      currency_code: "USD",
      note: opts.note,
      terms_and_conditions: opts.terms,
      payment_term: { term_type: "DUE_ON_RECEIPT" },
    },
    invoicer: { business_name: opts.landlordName },
    primary_recipients: [{ billing_info: { email_address: opts.tenantEmail } }],
    items: [{ name: `Security deposit: ${opts.address}`, quantity: "1", unit_amount: { currency_code: "USD", value: opts.amount.toFixed(2) } }],
  };
  const invoiceNumber = depositInvoiceNumber(opts.tenancyId, content);
  const body = { ...content, detail: { ...content.detail, invoice_number: invoiceNumber } };
  let id: string | undefined;
  let draft = true;
  let adopted = false;
  try {
    const created = await paypal<{ id?: string; href?: string }>("POST", "/v2/invoicing/invoices", body, { requestId: invoiceNumber });
    id = created.id ?? created.href?.split("/").pop();
  } catch (e) {
    if (!duplicateNumber(e)) throw e instanceof PayPalRefused ? new InvoiceNotCreated(e.message, { cause: e }) : e;
    // An earlier try made this invoice (its answer lost, its row not saved, or it is being made in another tab).
    const found = await invoiceByNumber(invoiceNumber);
    if (!found) throw new Error(`PayPal has invoice ${invoiceNumber} but didn't return it`);
    ({ id } = found);
    draft = found.status === "DRAFT";
    adopted = true;
  }
  if (!id) throw new Error("PayPal didn't return an invoice id");
  if (draft) {
    try {
      await paypal("POST", `/v2/invoicing/invoices/${id}/send`, { send_to_invoicer: false }, { requestId: `gf-invoice-send-${id}` });
    } catch (e) {
      // Sent meanwhile (the other tab's request): no longer a draft, so it went.
      const now = await getInvoice(id, { timeoutMs: TIMEOUT_MS }).catch(() => null);
      if (!now || now.status === "DRAFT") throw e;
    }
  }
  return { id, payLink: `${WEB}/invoice/p/#${id}`, invoiceNumber, ...(adopted ? { adopted: true } : {}) };
}

export type Invoice = {
  id: string;
  status: string;
  primary_recipients?: { billing_info?: { email_address?: string } }[];
  payments?: { paid_amount?: { value?: string }; transactions?: { payment_id: string; payment_date_time?: string; payment_date?: string; method?: string; amount: { value: string } }[] };
  // What PayPal has refunded of the payment, whoever sent it (the close-out, a settlement, or the PayPal dashboard).
  refunds?: { refund_amount?: { value?: string } };
};

export async function getInvoice(id: string, o: { timeoutMs?: number } = {}) {
  return paypal<Invoice>("GET", `/v2/invoicing/invoices/${id}`, undefined, o);
}

/** The webhook's read of an invoice: bounded, so a delivery can't outlive its claim (src/app/api/paypal/webhook). */
export const getInvoiceForWebhook = (id: string) => getInvoice(id, { timeoutMs: TIMEOUT_MS });

/** Send money to a PayPal account by email (Payouts). Used when the deposit can't be refunded against its original
 *  payment, e.g. it was paid more than 180 days ago. The batch id is the idempotency key, twice over: PayPal refuses a
 *  sender_batch_id it has seen in the last 30 days, and the same id goes as PayPal-Request-Id. */
export async function sendPayout(opts: { email: string; amount: number; note: string; batchId: string }) {
  const r = await paypal<{ batch_header: { payout_batch_id: string; batch_status: string } }>("POST", "/v1/payments/payouts", {
    sender_batch_header: { sender_batch_id: opts.batchId, email_subject: "Your security deposit refund", email_message: opts.note },
    items: [{
      recipient_type: "EMAIL", receiver: opts.email, note: opts.note, sender_item_id: opts.batchId,
      amount: { value: opts.amount.toFixed(2), currency: "USD" },
    }],
  }, { requestId: opts.batchId });
  return { id: r.batch_header.payout_batch_id, status: r.batch_header.batch_status, batch_status: r.batch_header.batch_status, sender_batch_id: opts.batchId };
}

/** The headers PayPal signs every webhook delivery with. */
export const WEBHOOK_HEADERS = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"] as const;

/** Whether PayPal signed this webhook delivery, asked of PayPal itself (verify-webhook-signature) with the webhook id
 *  the event was sent to. The event goes back exactly as it arrived, byte for byte: parsed and serialized again it
 *  could differ from what was signed. "FAILURE" for a missing header or a request PayPal won't check (a made-up
 *  certificate address); a throw when PayPal couldn't be asked, so the delivery is answered with an error and PayPal
 *  sends it again later. */
export async function verifyWebhookSignature(rawBody: string, headers: Headers, webhookId: string): Promise<"SUCCESS" | "FAILURE"> {
  const [auth_algo, cert_url, transmission_id, transmission_sig, transmission_time] = WEBHOOK_HEADERS.map((h) => headers.get(h)?.trim() ?? "");
  const fields = { auth_algo, cert_url, transmission_id, transmission_sig, transmission_time, webhook_id: webhookId };
  if (Object.values(fields).some((v) => !v)) return "FAILURE";
  const body = `${JSON.stringify(fields).slice(0, -1)},"webhook_event":${rawBody}}`;
  const r = await fetch(`${BASE}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 429) return "FAILURE";
  if (!r.ok) throw new Error(`PayPal couldn't check the webhook signature: ${r.status}`);
  const j = (await r.json().catch(() => null)) as { verification_status?: string } | null;
  return j?.verification_status === "SUCCESS" ? "SUCCESS" : "FAILURE";
}
