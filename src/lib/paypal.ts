import "server-only";
import { createHash } from "node:crypto";
import { fakePayPal } from "./e2e-paypal";
import { e2eStubs } from "./e2e-switch";
import { keepAliveFetch } from "./http";
import { isRefundId } from "./reconcile";

// PayPal REST in the sandbox (PAYPAL_ENVIRONMENT=SANDBOX). Invoices collect the deposit; at move-out the agent returns
// it through PayPal's Agent Toolkit (a refund of the original payment) or, past PayPal's refund window, a Payout.
// Proven against the sandbox by scripts/sandbox_smoke.py on 2026-10-01.
const BASE = process.env.PAYPAL_ENVIRONMENT === "LIVE" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const WEB = process.env.PAYPAL_ENVIRONMENT === "LIVE" ? "https://www.paypal.com" : "https://www.sandbox.paypal.com";

let cached: { token: string; until: number } | null = null;
/** The sign-in under way, shared by every request that finds no token while it runs. */
let signingIn: Promise<string> | null = null;

export const SANDBOX = process.env.PAYPAL_ENVIRONMENT !== "LIVE";

/** PayPal answered with an error status (its sign-in included), so the request did nothing there. A network failure
 *  is not one of these: PayPal may have acted before the answer was lost. `status` and `body` are PayPal's answer
 *  (0 and "" when the app refused on its own). */
export class PayPalRefused extends Error {
  constructor(message: string, readonly status = 0, readonly body = "") {
    super(message);
  }
}

/** How long a PayPal call may take before the app stops waiting, unless the caller says otherwise: every call here
 *  carries it, the writes included (a webhook delivery must finish well inside the five minutes after which
 *  claim_paypal_event hands its event to the next delivery; without it, undici's own five-minute limit was the only
 *  bound on a write that hung). */
const TIMEOUT_MS = 20_000;

/** OAuth access token (client credentials), cached until a minute before it expires. Cold requests that arrive at once
 *  share one sign-in rather than each making one. PayPal answering 401 to a call made with the token (the secret was
 *  rotated, or PayPal revoked it) drops it (forgetToken), so the next call signs in again instead of failing with it
 *  until it would have expired or the process restarts. The Agent Toolkit (agent.ts) is handed this token too. */
export async function accessToken(): Promise<string> {
  // The judges'-path test (src/lib/e2e-switch.ts, never on Render) talks to the fake PayPal, which needs no sign-in.
  if (e2eStubs()) return "e2e-stub-token-not-valid-at-paypal";
  if (cached && Date.now() < cached.until) return cached.token;
  signingIn ??= signIn().finally(() => { signingIn = null; });
  return signingIn;
}

/** One sign-in with PayPal. A refusal is thrown and not kept: the next call signs in again. */
async function signIn(): Promise<string> {
  const r = await keepAliveFetch(`${BASE}/v1/oauth2/token`, {
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

/** PayPal answered 401 to a call made with `token`: forget it, unless a newer one has replaced it already. */
function forgetToken(token: string) {
  if (cached?.token === token) cached = null;
}

/** A REST call. Every write passes `requestId`, sent as PayPal-Request-Id, always derived from our own record (the
 *  tenancy, the claim, the run), never random. PayPal's Payments and Payouts APIs answer the same request sent again
 *  with the first result instead of acting twice. Its Invoicing API ignores the header (tried in the sandbox on
 *  2026-10-05: two creates with one key made two invoices), so the deposit invoice is made once by its invoice number
 *  instead (depositInvoiceNumber). `timeoutMs` is how long each send may take, TIMEOUT_MS unless given. A 401 means
 *  PayPal refused the token before acting, so the call signs in again (TIMEOUT_MS) and goes once more, the same
 *  request and the same PayPal-Request-Id; a 401 to that is PayPal's refusal, like any other error status, and that
 *  token is forgotten too. */
export async function paypal<T = Record<string, unknown>>(method: string, path: string, body?: unknown, o: { requestId?: string; timeoutMs?: number } = {}): Promise<T> {
  // The judges'-path test: the same request, answered by the fake PayPal in this process (src/lib/e2e-paypal.ts).
  if (e2eStubs()) {
    const a = await fakePayPal(method, path, body, { requestId: o.requestId });
    const text = JSON.stringify(a.body ?? {});
    if (a.status >= 300) throw new PayPalRefused(`PayPal ${method} ${path} -> ${a.status}: ${text.slice(0, 300)}`, a.status, text.slice(0, 4000));
    return a.body as T;
  }
  const send = async () => {
    const token = await accessToken();
    const r = await keepAliveFetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`, "Content-Type": "application/json",
        ...(o.requestId ? { "PayPal-Request-Id": o.requestId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(o.timeoutMs ?? TIMEOUT_MS),
    });
    return { status: r.status, ok: r.ok, text: await r.text(), token };
  };
  let a = await send();
  if (a.status === 401) {
    forgetToken(a.token);
    a = await send();
    if (a.status === 401) forgetToken(a.token);
  }
  if (!a.ok) throw new PayPalRefused(`PayPal ${method} ${path} -> ${a.status}: ${a.text.slice(0, 300)}`, a.status, a.text.slice(0, 4000));
  return (a.text ? JSON.parse(a.text) : {}) as T;
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
  // What PayPal has refunded of the payment, whoever sent it (the close-out, a settlement, or the PayPal dashboard), and
  // each refund: PayPal names it by recipient_transaction_id (the refund's own id) and dates it by day (reconcile.ts).
  refunds?: { refund_amount?: { value?: string }; transactions?: { type?: string; refund_id?: string; recipient_transaction_id?: string; refund_date?: string; amount?: { value?: string } }[] };
};

export async function getInvoice(id: string, o: { timeoutMs?: number } = {}) {
  return paypal<Invoice>("GET", `/v2/invoicing/invoices/${id}`, undefined, o);
}

/** The webhook's read of an invoice: bounded, so a delivery can't outlive its claim (src/app/api/paypal/webhook). */
export const getInvoiceForWebhook = (id: string) => getInvoice(id, { timeoutMs: TIMEOUT_MS });

/** A refund as PayPal returns it (GET /v2/payments/refunds/{id}, the resource the Agent Toolkit's get_refund reads):
 *  the fields the app reads. The rest (the payer, the note, the breakdown) is left where it is. */
export type Refund = {
  id: string; status: string; amount?: { value?: string; currency_code?: string }; create_time?: string; update_time?: string;
  links?: { rel?: string; href?: string }[];
};

/** The invoice as PayPal has it now, bounded like the other reads behind PayPal's record. */
export const getInvoiceRecord = (id: string) => getInvoice(id, { timeoutMs: TIMEOUT_MS });

/** The refund as PayPal has it now, by its id. For PayPal's record on the receipt and in a Payments row's details
 *  (src/app/api/tenancies/[id]/paypal-record). */
export async function getRefund(id: string) {
  if (!isRefundId(id)) throw new PayPalRefused(`Not a PayPal refund id: ${String(id).slice(0, 40)}`);
  return paypal<Refund>("GET", `/v2/payments/refunds/${id}`, undefined, { timeoutMs: TIMEOUT_MS });
}

/** A Payout batch's header as PayPal returns it (GET /v1/payments/payouts/{batch id}?fields=batch_header): the batch
 *  alone, never its items, which name the receivers. */
export type PayoutBatch = {
  batch_header?: { payout_batch_id?: string; batch_status?: string; time_created?: string; time_completed?: string; amount?: { value?: string; currency?: string } };
};

/** A PayPal Payout batch id: letters and digits. */
export const isPayoutBatchId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9]{4,64}$/.test(v);

/** The Payout batch as PayPal has it now, its header only. */
export async function getPayoutBatch(id: string) {
  if (!isPayoutBatchId(id)) throw new PayPalRefused(`Not a PayPal Payout batch id: ${String(id).slice(0, 40)}`);
  return paypal<PayoutBatch>("GET", `/v1/payments/payouts/${id}?fields=batch_header`, undefined, { timeoutMs: TIMEOUT_MS });
}

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

/* ---------- PayPal disputes (v1/customer/disputes) ---------- */

// The tenants' PayPal disputes and chargebacks of the deposit payment. The app reads them through PayPal's Agent
// Toolkit (list_disputes, get_dispute over MCP: src/lib/chargeback-store.ts); these are the writes, which the toolkit
// doesn't offer in a form the app can use (v1.11.0 has no provide-evidence or make-offer, and its accept_dispute_claim
// takes no amount and checks its note against the dispute-id pattern, so a note with a space is refused). Each carries
// a PayPal-Request-Id from the approved response (gf-dispute-<response id>-<step>), though PayPal's Disputes API
// doesn't declare that header: the guard against a step going twice is the read of the dispute before any resend.

/** A PayPal dispute id as PayPal writes them (PP-D-27803, PP-R-UPH-10190332), safe in a URL path. */
export const isDisputeId = (id: unknown): id is string => typeof id === "string" && /^PP-[A-Z0-9][A-Z0-9-]{2,60}$/.test(id);

const disputePath = (id: string, action?: string) => {
  if (!isDisputeId(id)) throw new PayPalRefused(`Not a PayPal dispute id: ${String(id).slice(0, 40)}`);
  return `/v1/customer/disputes/${id}${action ? `/${action}` : ""}`;
};

/** The dispute as PayPal has it now (REST; the app's own reads go through the Agent Toolkit first). */
export const getDisputeRest = (id: string) => paypal<Record<string, unknown>>("GET", disputePath(id), undefined, { timeoutMs: TIMEOUT_MS });

/** Accept the tenants' claim: PayPal refunds them from the landlord's account and closes the dispute in their favor.
 *  REFUND is the whole disputed amount; PARTIAL_REFUND, where PayPal offers it, the amount given. */
export async function acceptDisputeClaim(id: string, o: { note: string; type: "REFUND" | "PARTIAL_REFUND"; amount?: number; requestId: string }) {
  return paypal<Record<string, unknown>>("POST", disputePath(id, "accept-claim"), {
    note: o.note,
    accept_claim_type: o.type,
    ...(o.type === "PARTIAL_REFUND" && o.amount != null ? { refund_amount: { currency_code: "USD", value: o.amount.toFixed(2) } } : {}),
  }, { requestId: o.requestId, timeoutMs: TIMEOUT_MS });
}

/** Offer the tenants a refund to settle the dispute (only while PayPal offers make_offer, in an inquiry). Nothing moves
 *  unless they accept it in PayPal. */
export async function makeDisputeOffer(id: string, o: { note: string; amount: number; requestId: string }) {
  return paypal<Record<string, unknown>>("POST", disputePath(id, "make-offer"), {
    note: o.note, offer_type: "REFUND", offer_amount: { currency_code: "USD", value: o.amount.toFixed(2) },
  }, { requestId: o.requestId, timeoutMs: TIMEOUT_MS });
}

export type EvidenceFile = { name: string; type: string; data: Uint8Array };

/** The multipart body PayPal's evidence calls take, as its documentation's request writes it (`-F 'input=<json>;
 *  type=application/json' -F 'file1=@<file>'`): an "input" field holding the JSON, typed application/json and with no
 *  file name, then the files as file1, file2, ... under the names the JSON's documents list. Built by hand because
 *  FormData gives a typed part a file name, and a parser may then read the JSON as one more file. File names come from
 *  evidenceName (letters, digits, dots and dashes), so none needs quoting. A check reads the body back without calling
 *  PayPal. */
export function evidenceBody(input: unknown, files: EvidenceFile[], boundary = `gf-${globalThis.crypto.randomUUID()}`): { body: Uint8Array<ArrayBuffer>; contentType: string } {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const head = (disposition: string, type: string) => enc.encode(`--${boundary}\r\nContent-Disposition: form-data; ${disposition}\r\nContent-Type: ${type}\r\n\r\n`);
  parts.push(head('name="input"', "application/json"), enc.encode(JSON.stringify(input)), enc.encode("\r\n"));
  files.forEach((f, i) => parts.push(head(`name="file${i + 1}"; filename="${f.name.replace(/["\r\n\\]/g, "-")}"`, f.type), f.data, enc.encode("\r\n")));
  parts.push(enc.encode(`--${boundary}--\r\n`));
  const body = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { body.set(p, at); at += p.length; }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Send the landlord's evidence (provide-evidence, while PayPal asks the seller for it) or supporting information
 *  (provide-supporting-info, while PayPal reviews the case), with its files. The PayPal-Request-Id goes with it, but
 *  PayPal's Disputes API doesn't promise to honor it: what keeps a resend from acting twice is that "Check with
 *  PayPal" reads the dispute first and sends only what it doesn't show (chargeback-store.ts). */
export async function sendDisputeEvidence(id: string, o: { route: "provide-evidence" | "provide-supporting-info"; input: unknown; files: EvidenceFile[]; requestId: string }) {
  if (e2eStubs()) throw new PayPalRefused("The e2e fake PayPal doesn't take dispute evidence.", 501);
  const { body, contentType } = evidenceBody(o.input, o.files);
  const token = await accessToken();
  const r = await fetch(`${BASE}${disputePath(id, o.route)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "PayPal-Request-Id": o.requestId, "Content-Type": contentType },
    body: new Blob([body]),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await r.text();
  if (r.status === 401) forgetToken(token);
  if (!r.ok) throw new PayPalRefused(`PayPal POST ${o.route} -> ${r.status}: ${text.slice(0, 300)}`, r.status, text.slice(0, 4000));
  return (text ? JSON.parse(text) : {}) as Record<string, unknown>;
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
  // The judges'-path test's server never asks PayPal: no delivery is genuine there.
  if (e2eStubs()) return "FAILURE";
  const body = `${JSON.stringify(fields).slice(0, -1)},"webhook_event":${rawBody}}`;
  const token = await accessToken();
  const r = await fetch(`${BASE}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // A 401 is the token's, not the delivery's: it is dropped, the delivery is answered with an error, and the one
  // PayPal sends again signs in anew.
  if (r.status === 401) forgetToken(token);
  if (r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 429) return "FAILURE";
  if (!r.ok) throw new Error(`PayPal couldn't check the webhook signature: ${r.status}`);
  const j = (await r.json().catch(() => null)) as { verification_status?: string } | null;
  return j?.verification_status === "SUCCESS" ? "SUCCESS" : "FAILURE";
}
