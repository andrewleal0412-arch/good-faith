import "server-only";

// PayPal REST in the sandbox (PAYPAL_ENVIRONMENT=SANDBOX). Invoices collect the deposit; at move-out the agent returns
// it through PayPal's Agent Toolkit (a refund of the original payment) or, past PayPal's refund window, a Payout.
// Proven against the sandbox by scripts/sandbox_smoke.py on 2026-10-01.
const BASE = process.env.PAYPAL_ENVIRONMENT === "LIVE" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const WEB = process.env.PAYPAL_ENVIRONMENT === "LIVE" ? "https://www.paypal.com" : "https://www.sandbox.paypal.com";

let cached: { token: string; until: number } | null = null;

export const SANDBOX = process.env.PAYPAL_ENVIRONMENT !== "LIVE";

/** PayPal answered with an error status (its sign-in included), so the request did nothing there. A network failure
 *  is not one of these: PayPal may have acted before the answer was lost. */
export class PayPalRefused extends Error {}

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
  });
  if (!r.ok) throw new PayPalRefused(`PayPal auth failed: ${r.status}`);
  const j = await r.json();
  cached = { token: j.access_token, until: Date.now() + (j.expires_in - 60) * 1000 };
  return cached.token;
}

export async function paypal<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new PayPalRefused(`PayPal ${method} ${path} -> ${r.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** PayPal refused the invoice before creating it: nothing exists in the sandbox. */
export class InvoiceNotCreated extends Error {}

/** Create and send the deposit invoice. Returns the invoice id and the tenant's pay link. */
export async function sendDepositInvoice(opts: {
  tenantEmail: string; amount: number; landlordName: string; address: string; note: string;
}) {
  const created = await paypal<{ id?: string; href?: string }>("POST", "/v2/invoicing/invoices", {
    detail: {
      currency_code: "USD",
      note: opts.note,
      terms_and_conditions: "Security deposit held and returned under California Civil Code 1950.5.",
      payment_term: { term_type: "DUE_ON_RECEIPT" },
    },
    invoicer: { business_name: opts.landlordName },
    primary_recipients: [{ billing_info: { email_address: opts.tenantEmail } }],
    items: [{ name: `Security deposit: ${opts.address}`, quantity: "1", unit_amount: { currency_code: "USD", value: opts.amount.toFixed(2) } }],
  }).catch((e) => {
    throw e instanceof PayPalRefused ? new InvoiceNotCreated(e.message, { cause: e }) : e;
  });
  const id = created.id ?? created.href?.split("/").pop();
  if (!id) throw new Error("PayPal didn't return an invoice id");
  await paypal("POST", `/v2/invoicing/invoices/${id}/send`, { send_to_invoicer: false });
  return { id, payLink: `${WEB}/invoice/p/#${id}` };
}

export type Invoice = {
  id: string;
  status: string;
  primary_recipients?: { billing_info?: { email_address?: string } }[];
  payments?: { transactions?: { payment_id: string; payment_date_time?: string; method?: string; amount: { value: string } }[] };
};

export async function getInvoice(id: string) {
  return paypal<Invoice>("GET", `/v2/invoicing/invoices/${id}`);
}

/** Send money to a PayPal account by email (Payouts). Used when the deposit can't be refunded against its original
 *  payment, e.g. it was paid more than 180 days ago. The batch id doubles as an idempotency key. */
export async function sendPayout(opts: { email: string; amount: number; note: string; batchId: string }) {
  const r = await paypal<{ batch_header: { payout_batch_id: string; batch_status: string } }>("POST", "/v1/payments/payouts", {
    sender_batch_header: { sender_batch_id: opts.batchId, email_subject: "Your security deposit refund", email_message: opts.note },
    items: [{
      recipient_type: "EMAIL", receiver: opts.email, note: opts.note, sender_item_id: opts.batchId,
      amount: { value: opts.amount.toFixed(2), currency: "USD" },
    }],
  });
  return { id: r.batch_header.payout_batch_id, status: r.batch_header.batch_status };
}
