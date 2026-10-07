import "server-only";
import { randomBytes } from "node:crypto";
import { pacificDate } from "./dates";
import { db } from "./db";
import { e2eLog } from "./e2e-switch";

// A fake PayPal for the judges'-path end-to-end test (scripts/e2e-demo.py), used only while the e2e stubs are on
// (src/lib/e2e-switch.ts: GOOD_FAITH_E2E_STUBS=1, never on Render). Every PayPal call the app makes goes here instead
// of the network: the REST calls in src/lib/paypal.ts (its transport), and the Agent Toolkit's MCP tools, whose server
// is PayPal's own (PayPalAgentToolkit, with its tool names, descriptions and schemas, over the same in-process MCP
// transport) with only its PayPal API object swapped for runTool (src/lib/e2e-toolkit.ts). Nothing here opens a
// connection to PayPal.
//
// What it knows: an invoice is answered from the deposit invoice row the database holds (its amount, status and
// PayPal's transactions as stored), billed to the payer the pool row or the tenants' written agreement names; refunds
// are kept in this process. It refunds only the test's own fake deposits: a pool row the test inserts, already
// claimed by its workspace and marked used (so no visitor's copy can ever take it), whose invoice id starts with
// E2E_INVOICE_PREFIX and whose capture id starts with "E2E". A refund of any other capture (a template's, a real pool
// deposit's) is refused like a PayPal error, so even a wrong id in a test can't stand for a real refund. Anything the
// demo's path doesn't use answers 501 and is logged.

/** The invoice ids of the test's fake deposits (scripts/e2e-demo-db.mjs makes them). */
export const E2E_INVOICE_PREFIX = "INV2-E2E";
const E2E_CAPTURE = /^E2E[A-Z0-9]{12,29}$/;

type FakeRefund = { id: string; capture: string; amount: number; requestId: string | null; note: string | null; at: string };

// The refunds the fake made, by refund id, and by the PayPal-Request-Id they came with (PayPal answers a repeated key
// with the first refund). Fake ids only: no real workspace's deposit is refundable here.
const fakeRefunds = new Map<string, FakeRefund>();
const fakeRefundKeys = new Map<string, string>();

export type FakeAnswer = { status: number; body: unknown };

const cents = (n: number) => Math.round(n * 100) / 100;
const fakeId = (prefix: string) => `${prefix}${randomBytes(12).toString("hex").toUpperCase().slice(0, 14)}`;
const err = (status: number, name: string, message: string): FakeAnswer => ({ status, body: { name, message, details: [{ issue: name, description: message }] } });

const refundedOn = (capture: string) => cents([...fakeRefunds.values()].filter((r) => r.capture === capture).reduce((s, r) => s + r.amount, 0));

/** The test's fake deposit behind a capture id, or null for any other capture. */
async function e2eDeposit(capture: string): Promise<{ invoice: string; amount: number } | null> {
  if (!E2E_CAPTURE.test(capture)) return null;
  const { data } = await db.from("demo_deposit_pool").select("invoice_id, amount").eq("capture_id", capture).like("invoice_id", `${E2E_INVOICE_PREFIX}%`).maybeSingle();
  return data ? { invoice: data.invoice_id as string, amount: Number(data.amount) } : null;
}

async function invoice(id: string): Promise<FakeAnswer> {
  const { data: rows } = await db.from("payments").select("tenancy_id, amount, status, raw").eq("paypal_id", id).eq("kind", "deposit_invoice").order("created_at").limit(1);
  const row = rows?.[0];
  if (!row) return err(404, "RESOURCE_NOT_FOUND", `The e2e fake PayPal has no invoice ${id}.`);
  const raw = (row.raw ?? {}) as { transactions?: { payment_id?: string }[] };
  const transactions = raw.transactions ?? [];
  const capture = transactions[0]?.payment_id ?? "";
  // Billed to the account that paid: the pool row's payer, else the tenants' written PayPal account.
  const [{ data: pool }, { data: t }] = await Promise.all([
    db.from("demo_deposit_pool").select("payer_email").eq("invoice_id", id).maybeSingle(),
    db.from("tenancies").select("refund_agreement").eq("id", row.tenancy_id).maybeSingle(),
  ]);
  const email = (pool?.payer_email as string | undefined) ?? (t?.refund_agreement as { paypal_email?: string } | null)?.paypal_email ?? null;
  const amount = Number(row.amount);
  const ours = id.startsWith(E2E_INVOICE_PREFIX);
  const refunded = ours ? refundedOn(capture) : 0;
  const status = ours ? (refunded >= amount - 0.005 ? "REFUNDED" : refunded > 0 ? "PARTIALLY_REFUNDED" : "PAID") : String(row.status);
  return {
    status: 200,
    body: {
      id, status,
      detail: { currency_code: "USD" },
      primary_recipients: email ? [{ billing_info: { email_address: email } }] : [],
      amount: { currency_code: "USD", value: amount.toFixed(2) },
      payments: { paid_amount: { currency_code: "USD", value: amount.toFixed(2) }, transactions },
      // Each refund as PayPal's invoice lists it (read from the sandbox on 2026-10-07): its id as
      // recipient_transaction_id, its day, its amount. The app checks these against its records (reconcile.ts).
      ...(refunded > 0 ? { refunds: {
        refund_amount: { currency_code: "USD", value: refunded.toFixed(2) },
        transactions: [...fakeRefunds.values()].filter((r) => r.capture === capture)
          .map((r) => ({ type: "PAYPAL", recipient_transaction_id: r.id, refund_date: pacificDate(r.at), amount: { currency_code: "USD", value: r.amount.toFixed(2) } })),
      } } : {}),
    },
  };
}

async function refund(capture: string, body: unknown, requestId: string | null): Promise<FakeAnswer> {
  if (requestId && fakeRefundKeys.has(requestId)) {
    const r = fakeRefunds.get(fakeRefundKeys.get(requestId)!)!;
    e2eLog(`fake PayPal: refund ${r.id} answered again for its PayPal-Request-Id`);
    return { status: 200, body: refundBody(r) };
  }
  const deposit = await e2eDeposit(capture);
  if (!deposit) {
    e2eLog(`fake PayPal: refused a refund of capture ${capture.slice(0, 40)}, which isn't one of the test's fake deposits`);
    return err(422, "E2E_STUB_REFUSES", "The e2e fake PayPal refunds only the test's own fake deposits.");
  }
  const b = (body ?? {}) as { amount?: { value?: string }; note_to_payer?: string };
  const amount = cents(Number(b.amount?.value ?? deposit.amount - refundedOn(capture)));
  if (!Number.isFinite(amount) || amount <= 0) return err(422, "INVALID_PARAMETER_VALUE", "The refund amount isn't valid.");
  if (amount > cents(deposit.amount - refundedOn(capture)) + 0.005) return err(422, "REFUND_AMOUNT_EXCEEDED", "The refund amount is more than what is left of the payment.");
  const r: FakeRefund = { id: fakeId("E2E"), capture, amount, requestId, note: b.note_to_payer ?? null, at: new Date().toISOString() };
  fakeRefunds.set(r.id, r);
  if (requestId) fakeRefundKeys.set(requestId, r.id);
  e2eLog(`fake PayPal: refund ${r.id} of $${amount.toFixed(2)} against fake capture ${capture} (no money moved)`);
  return { status: 201, body: refundBody(r) };
}

const refundBody = (r: FakeRefund) => ({
  id: r.id, status: "COMPLETED", amount: { currency_code: "USD", value: r.amount.toFixed(2) }, note_to_payer: r.note ?? undefined,
  create_time: r.at, update_time: r.at,
  links: [{ rel: "self", method: "GET", href: `e2e-fake:/v2/payments/refunds/${r.id}` }, { rel: "up", method: "GET", href: `e2e-fake:/v2/payments/captures/${r.capture}` }],
});

/** One PayPal REST request, answered by the fake: what src/lib/paypal.ts would have sent to PayPal. */
export async function fakePayPal(method: string, path: string, body?: unknown, o: { requestId?: string | null } = {}): Promise<FakeAnswer> {
  const url = new URL(path, "https://e2e-fake.invalid");
  const p = url.pathname;
  let m: RegExpMatchArray | null;
  if (method === "GET" && (m = p.match(/^\/v2\/invoicing\/invoices\/([A-Za-z0-9_-]{1,127})$/))) return invoice(m[1]);
  if (method === "POST" && (m = p.match(/^\/v2\/payments\/captures\/([A-Za-z0-9_-]{1,40})\/refund$/))) return refund(m[1], body, o.requestId ?? null);
  if (method === "GET" && (m = p.match(/^\/v2\/payments\/refunds\/([A-Za-z0-9_-]{1,40})$/))) {
    const r = fakeRefunds.get(m[1]);
    return r ? { status: 200, body: refundBody(r) } : err(404, "RESOURCE_NOT_FOUND", `The e2e fake PayPal has no refund ${m[1]}.`);
  }
  // PayPal disputes: the test's fake deposits have none.
  if (method === "GET" && p === "/v1/customer/disputes") return { status: 200, body: { items: [] } };
  if (method === "GET" && p.startsWith("/v1/customer/disputes/")) return err(404, "RESOURCE_NOT_FOUND", "The e2e fake PayPal has no disputes.");
  if (method === "POST" && p === "/v2/invoicing/search-invoices") return { status: 200, body: { items: [] } };
  e2eLog(`fake PayPal: ${method} ${p} isn't part of the demo's path, answered 501`);
  return err(501, "E2E_NOT_STUBBED", `The e2e fake PayPal doesn't answer ${method} ${p}.`);
}

/** The Agent Toolkit's tools, as its PayPal API object runs them, against the fake (src/lib/e2e-toolkit.ts). */
export async function runTool(method: string, arg: Record<string, unknown>, requestId: string | null): Promise<string> {
  const call = (): Promise<FakeAnswer> => {
    switch (method) {
      case "get_invoice": return fakePayPal("GET", `/v2/invoicing/invoices/${String(arg.invoice_id ?? "")}`);
      case "create_refund": return fakePayPal("POST", `/v2/payments/captures/${String(arg.capture_id ?? "")}/refund`, arg, { requestId });
      case "get_refund": return fakePayPal("GET", `/v2/payments/refunds/${String(arg.refund_id ?? "")}`);
      case "list_disputes": return fakePayPal("GET", "/v1/customer/disputes");
      case "get_dispute": return fakePayPal("GET", `/v1/customer/disputes/${String(arg.dispute_id ?? "")}`);
      default: return fakePayPal("TOOL", `/${method}`);
    }
  };
  const a = await call();
  e2eLog(`fake PayPal: Agent Toolkit ${method} -> ${a.status}`);
  if (a.status < 300) return JSON.stringify(a.body);
  // The toolkit's own error shape for an HTTP error from PayPal (its LlmError, serialized).
  const b = a.body as { name?: string; message?: string };
  return JSON.stringify({ ok: false, status: a.status, code: "PAYPAL_API_HTTP_ERROR", message: `${b.message ?? b.name ?? "Error"}`.slice(0, 200) });
}
