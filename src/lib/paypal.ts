import "server-only";

// PayPal REST in the sandbox (PAYPAL_ENVIRONMENT=SANDBOX). Invoices collect the deposit; refunds and Payouts return
// it (wired in the move-out step). Proven against the sandbox by scripts/sandbox_smoke.py on 2026-10-01.
const BASE = process.env.PAYPAL_ENVIRONMENT === "LIVE" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const WEB = process.env.PAYPAL_ENVIRONMENT === "LIVE" ? "https://www.paypal.com" : "https://www.sandbox.paypal.com";

let cached: { token: string; until: number } | null = null;

async function token(): Promise<string> {
  if (cached && Date.now() < cached.until) return cached.token;
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`PayPal auth failed: ${r.status}`);
  const j = await r.json();
  cached = { token: j.access_token, until: Date.now() + (j.expires_in - 60) * 1000 };
  return cached.token;
}

export async function paypal<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(`PayPal ${method} ${path} -> ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data as T;
}

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
  });
  const id = created.id ?? created.href?.split("/").pop();
  if (!id) throw new Error("PayPal didn't return an invoice id");
  await paypal("POST", `/v2/invoicing/invoices/${id}/send`, { send_to_invoicer: false });
  return { id, payLink: `${WEB}/invoice/p/#${id}` };
}

export async function getInvoice(id: string) {
  return paypal<{ id: string; status: string; payments?: { transactions?: { payment_id: string; amount: { value: string } }[] } }>(
    "GET", `/v2/invoicing/invoices/${id}`);
}
