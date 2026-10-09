#!/usr/bin/env node
// Checks for PayPal's webhooks (src/lib/paypal-webhook.ts): the recorded sample of every event the app handles
// (scripts/fixtures/paypal-webhooks.json, in PayPal's documented shapes) through the real handler, with PayPal's
// signature check and invoice read stubbed and an in-memory store standing in for the database. Covers each event's
// effect, a replayed event processed once, a forged event (the signature check fails) changing and storing nothing,
// an event about another workspace's payment leaving this one untouched (a pool deposit given back on Start over, a
// template's payment every copy shows, an id two tenancies hold), statuses that never move back, a failed try that
// PayPal's redelivery applies, two deliveries writing different keys of one row, a capture that comes before its
// invoice's event, the ledger's "From PayPal" mark, a reversed deposit on the Properties page, the signature request
// PayPal is sent, the idempotency keys and the deposit invoice's number, the rate limit (junk never counts), and log
// lines an unsigned request can't forge. No database, no PayPal, no Claude. Exit 1 if any fails.
//
//   node scripts/paypal-webhook-check.mjs
//   node scripts/paypal-webhook-check.mjs --db   also run the events against the Supabase database (.env.local) with
//                                                throwaway rows in a throwaway workspace, removed afterwards

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": join(ROOT, "src"), "server-only": join(ROOT, "node_modules/server-only/empty.js") } });
const lib = (n) => jiti.import(join(ROOT, "src/lib", `${n}.ts`));
const SAMPLES = JSON.parse(readFileSync(join(ROOT, "scripts/fixtures/paypal-webhooks.json"), "utf8"));
const DB = process.argv.includes("--db");

// .env.local into the environment for --db, before any module makes its database client. Never printed; variables
// already set win.
function loadEnvLocal() {
  const envFile = join(ROOT, ".env.local");
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^"(.*)"$/, "$1");
  }
}
if (DB) loadEnvLocal();

// The PayPal module reads its environment when it loads; the pure checks never reach PayPal (fetch is stubbed).
if (!DB) {
  process.env.PAYPAL_ENVIRONMENT = "SANDBOX";
  process.env.PAYPAL_CLIENT_ID ??= "test-client";
  process.env.PAYPAL_CLIENT_SECRET ??= "test-secret";
  // units.ts makes its database client when it loads; the pure checks never use it (nothing listens here).
  process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
  process.env.SUPABASE_SECRET_KEY ??= "test-key";
}

const [wh, ledger, rate] = await Promise.all(["paypal-webhook", "ledger", "rate-limit"].map(lib));

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) pass++;
  else { fail++; failures.push(`${name}${detail ? `: ${detail}` : ""}`); }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const clone = (x) => JSON.parse(JSON.stringify(x));

/* ---------- Samples ---------- */

let seq = 0;
/** A sample event with a fresh id (so it is a new delivery) and its resource changed by `edit`. */
function sample(type, edit = () => {}, id) {
  const e = clone(SAMPLES[type]);
  e.id = id ?? `WH-CHECK-${String(++seq).padStart(4, "0")}`;
  edit(e.resource, e);
  return e;
}
const refundOf = (refundId, captureId, status = "COMPLETED", amount = "3790.00") => (r) => {
  r.id = refundId; r.status = status; r.amount.value = amount;
  r.links = [
    { href: `https://api.sandbox.paypal.com/v2/payments/refunds/${refundId}`, rel: "self", method: "GET" },
    { href: `https://api.sandbox.paypal.com/v2/payments/captures/${captureId}`, rel: "up", method: "GET" },
  ];
};

/* ---------- 1. Reading events (pure) ---------- */

eq("refs: invoice paid (v2, resource.invoice)", wh.eventRefs(SAMPLES["INVOICING.INVOICE.PAID"]), { invoice: "INV2-BBBB-BBBB-BBBB-BBBB", capture: "CAP-B-0000000000001" });
{
  const flat = clone(SAMPLES["INVOICING.INVOICE.PAID"]);
  flat.resource = { id: "INV2-FLAT", status: "PAID", payments: [{ payment_id: "TXN-FLAT", amount: { value: "10.00" } }] };
  eq("refs: invoice paid (flat resource, payments as a list)", wh.eventRefs(flat), { invoice: "INV2-FLAT", capture: "TXN-FLAT" });
}
eq("refs: capture completed (the order's up link is not a capture)", wh.eventRefs(SAMPLES["PAYMENT.CAPTURE.COMPLETED"]), { capture: "CAP-A-0000000000001" });
eq("refs: capture refunded (refund, with its capture from the up link)", wh.eventRefs(SAMPLES["PAYMENT.CAPTURE.REFUNDED"]), { refund: "REF-A-0000000000001", capture: "CAP-A-0000000000001" });
eq("refs: capture reversed", wh.eventRefs(SAMPLES["PAYMENT.CAPTURE.REVERSED"]), { refund: "REV-A-0000000000001", capture: "CAP-A-0000000000001" });
eq("refs: payouts batch", wh.eventRefs(SAMPLES["PAYMENT.PAYOUTSBATCH.SUCCESS"]), { batch: "BATCH-F-000000001" });
eq("refs: payouts item", wh.eventRefs(SAMPLES["PAYMENT.PAYOUTS-ITEM.SUCCEEDED"]), { batch: "BATCH-F-000000001", item: "ITEM-F-000000001" });
eq("refs: dispute", wh.eventRefs(SAMPLES["CUSTOMER.DISPUTE.CREATED"]), { dispute: "PP-D-27803", capture: "CAP-A-0000000000001" });
eq("refs: an event this app doesn't act on", wh.eventRefs(SAMPLES["BILLING.SUBSCRIPTION.CREATED"]), {});
check("handles every registered type", wh.WEBHOOK_EVENT_TYPES.every((t) => wh.handles(t)));
check("doesn't handle a subscription event", !wh.handles("BILLING.SUBSCRIPTION.CREATED"));
for (const t of Object.keys(SAMPLES).filter((k) => !k.startsWith("_"))) check(`sample ${t} is that event`, SAMPLES[t].event_type === t);

eq("invoice status never moves back (PAID after PARTIALLY_REFUNDED)", wh.invoiceForward("PARTIALLY_REFUNDED", "PAID"), "PARTIALLY_REFUNDED");
eq("invoice status moves forward (SENT to PAID)", wh.invoiceForward("SENT", "PAID"), "PAID");
eq("refund status never moves back (COMPLETED, then a late PENDING)", wh.moneyForward("COMPLETED", "PENDING"), "COMPLETED");
eq("a completed Payout can still come back (SUCCESS to RETURNED)", wh.moneyForward("SUCCESS", "RETURNED"), "RETURNED");
eq("a refused one never turns completed (FAILED, then SUCCESS)", wh.moneyForward("FAILED", "SUCCESS"), "FAILED");

/* ---------- 2. Matching (pure) ---------- */

const P = (o) => ({ id: o.id, tenancy_id: o.t, workspace_id: o.ws, kind: o.kind ?? "deposit_invoice", paypal_id: o.pid ?? null, amount: o.amount ?? 100, status: o.status ?? "PAID", raw: o.raw ?? null });
{
  const rows = [P({ id: "1", t: "t-old", ws: "ws-old", pid: "INV2-P" }), P({ id: "2", t: "t-new", ws: "ws-new", pid: "INV2-P" })];
  const o = wh.pickOwner(rows, { invoice_id: "INV2-P", capture_id: "C", claimed_by: "ws-new" }, new Set());
  eq("pool deposit: the copy that claimed it, not the one that gave it back", [o.kind, o.tenancyId, o.rows?.map((r) => r.id)], ["tenancy", "t-new", ["2"]]);
  eq("pool deposit nobody holds: no tenancy", wh.pickOwner(rows, { invoice_id: "INV2-P", capture_id: "C", claimed_by: null }, new Set()).kind, "none");
  eq("pool deposit whose copy is gone: no tenancy", wh.pickOwner(rows, { invoice_id: "INV2-P", capture_id: "C", claimed_by: "ws-swept" }, new Set()).kind, "none");
}
{
  const rows = [P({ id: "c1", t: "t-copy1", ws: "ws-1", pid: "INV2-T" }), P({ id: "tp", t: "t-template", ws: "ws-owner", pid: "INV2-T" }), P({ id: "c2", t: "t-copy2", ws: "ws-2", pid: "INV2-T" })];
  const o = wh.pickOwner(rows, null, new Set(["t-template"]));
  eq("template's payment: the template, read only, never a copy", [o.kind, o.tenancyId, o.template, o.rows.map((r) => r.id)], ["tenancy", "t-template", true, ["tp"]]);
}
eq("an id two workspaces hold: no tenancy", wh.pickOwner([P({ id: "g", t: "t-g", ws: "ws-g" }), P({ id: "h", t: "t-h", ws: "ws-h" })], null, new Set()).kind, "none");
eq("no rows: no tenancy", wh.pickOwner([], null, new Set()).kind, "none");

/* ---------- 3. The world: workspaces, tenancies, payments ---------- */

const T = { A: "t-a", B: "t-b", C: "t-c", D: "t-d", TPL: "t-template", E: "t-e", F: "t-f", G: "t-g", H: "t-h" };
const WS = { [T.A]: "ws-a", [T.B]: "ws-b", [T.C]: "ws-c", [T.D]: "ws-d", [T.TPL]: "ws-owner", [T.E]: "ws-e", [T.F]: "ws-f", [T.G]: "ws-g", [T.H]: "ws-h" };
const txn = (capture, value) => ({ transactions: [{ payment_id: capture, method: "PAYPAL", payment_date: "2026-10-01", payment_date_time: "2026-10-01T10:00:00Z", amount: { value } }] });

function world() {
  const pay = (id, t, kind, pid, amount, status, raw) => ({ id, tenancy_id: t, kind, paypal_id: pid, amount, status, raw, created_at: "2026-10-02T17:00:00.000Z" });
  return {
    payments: [
      pay("a-dep", T.A, "deposit_invoice", "INV2-POOL-A", 4800, "PAID", { payLink: "x", ...txn("CAP-A-0000000000001", "4800.00") }),
      pay("a-ref", T.A, "refund", "REF-A-0000000000001", 3790, "PENDING", { id: "REF-A-0000000000001", status: "PENDING" }),
      pay("b-dep", T.B, "deposit_invoice", "INV2-BBBB-BBBB-BBBB-BBBB", 2000, "SENT", { payLink: "y" }),
      pay("c-dep", T.C, "deposit_invoice", "INV2-POOL-P2", 4800, "PAID", txn("CAP-P2-000000000001", "4800.00")),
      pay("d-dep", T.D, "deposit_invoice", "INV2-POOL-P2", 4800, "PAID", txn("CAP-P2-000000000001", "4800.00")),
      pay("tpl-dep", T.TPL, "deposit_invoice", "INV2-TPL", 2800, "PARTIALLY_REFUNDED", txn("CAP-TPL-00000000001", "2800.00")),
      pay("tpl-ref", T.TPL, "refund", "REF-TPL-00000000001", 1790, "COMPLETED", { id: "REF-TPL-00000000001" }),
      pay("e-dep", T.E, "deposit_invoice", "INV2-TPL", 2800, "PARTIALLY_REFUNDED", txn("CAP-TPL-00000000001", "2800.00")),
      pay("e-ref", T.E, "refund", "REF-TPL-00000000001", 1790, "COMPLETED", { id: "REF-TPL-00000000001" }),
      pay("f-pay", T.F, "payout", "BATCH-F-000000001", 1500, "PENDING", { id: "BATCH-F-000000001", status: "PENDING", batch_status: "PENDING", sender_batch_id: "deposit-tf" }),
      pay("f-spay", T.F, "settlement_payout", "BATCH-S-000000001", 270, "PENDING", { id: "BATCH-S-000000001", status: "PENDING" }),
      pay("g-dep", T.G, "deposit_invoice", "INV2-G", 900, "PAID", txn("CAP-DUP-00000000001", "900.00")),
      pay("h-dep", T.H, "deposit_invoice", "INV2-H", 900, "PAID", txn("CAP-DUP-00000000001", "900.00")),
    ],
    pool: [
      { invoice_id: "INV2-POOL-A", capture_id: "CAP-A-0000000000001", claimed_by: "ws-a" },
      { invoice_id: "INV2-POOL-P2", capture_id: "CAP-P2-000000000001", claimed_by: "ws-d" },
      { invoice_id: "INV2-POOL-P3", capture_id: "CAP-P3-000000000001", claimed_by: null },
    ],
    templates: new Set([T.TPL]),
    settlements: [{ tenancy_id: T.F, paypal_id: "BATCH-S-000000001", status: "sent", paypal_status: "PENDING" }],
    events: new Map(),
    disputes: new Map(),
    audits: [],
  };
}

/** The store, in memory, with the database functions' semantics (claim_paypal_event's new / retry / duplicate, the
 *  update under the old status). `faults` makes one call fail or conflict, as a database might. */
function memoryStore(w, faults = {}) {
  const ref = (p) => ({ id: p.id, tenancy_id: p.tenancy_id, workspace_id: WS[p.tenancy_id] ?? null, kind: p.kind, paypal_id: p.paypal_id, amount: p.amount, status: p.status, raw: clone(p.raw) });
  return {
    async claim(e) {
      const old = w.events.get(e.id);
      if (!old) { w.events.set(e.id, { status: "processing", attempts: 1, payload: clone(e) }); return "new"; }
      if (old.status === "failed") { old.status = "processing"; old.attempts++; return "retry"; }
      return "duplicate";
    },
    async finish(id, o) { Object.assign(w.events.get(id), o); },
    async paymentsByPayPalId(ids, kinds) { return w.payments.filter((p) => ids.includes(p.paypal_id) && kinds.includes(p.kind)).map(ref); },
    async depositsByCapture(c) { return w.payments.filter((p) => p.kind === "deposit_invoice" && (p.raw?.transactions ?? []).some((t) => t.payment_id === c)).map(ref); },
    async poolDeposit({ invoice, capture }) { return w.pool.find((x) => (invoice && x.invoice_id === invoice) || (capture && x.capture_id === capture)) ?? null; },
    async templateTenancies() { return w.templates; },
    async updatePayment(id, expect, patch) {
      if (faults.throwOnUpdate) { faults.throwOnUpdate = false; throw new Error("database unreachable"); }
      const p = w.payments.find((x) => x.id === id);
      // Another delivery wrote a key of its own between this one's read and its write, leaving the status as it was.
      if (faults.sneakKey) { p.raw = { ...(p.raw ?? {}), ...faults.sneakKey }; faults.sneakKey = null; }
      if (faults.conflictOnce) {
        faults.conflictOnce = false;
        p.raw = { ...(p.raw ?? {}), touched_by: "another delivery" }; // something else wrote first
        p.status = faults.conflictStatus ?? p.status;
        return false;
      }
      if (!p || p.status !== expect) return false;
      // merge_payment: the status, and the keys set merged into raw; nothing else in raw is replaced.
      p.status = patch.status; p.raw = { ...(p.raw ?? {}), ...clone(patch.set) };
      return true;
    },
    async reloadPayment(id) { const p = w.payments.find((x) => x.id === id); return p ? ref(p) : null; },
    async settlementStatus(t, pid, status) { for (const s of w.settlements) if (s.tenancy_id === t && s.paypal_id === pid && s.status === "sent") s.paypal_status = status; },
    async upsertDispute(row) {
      const old = w.disputes.get(row.id);
      if (old && old.tenancy_id !== row.tenancy_id) return null;
      if (old?.paypal_updated_at && row.paypal_updated_at && Date.parse(old.paypal_updated_at) > Date.parse(row.paypal_updated_at)) return null;
      w.disputes.set(row.id, clone(row));
      return { previousStatus: old?.status ?? null };
    },
    async audit(t, action, detail) { w.audits.push({ tenancy_id: t, action, detail: clone(detail) }); },
  };
}

const GOOD = new Headers({
  "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-1d93a270",
  "paypal-transmission-id": "69cd13f0-d67a-11e5-baa3-778b53f4ae55", "paypal-transmission-sig": "good-signature", "paypal-transmission-time": "2026-10-05T18:12:45Z",
});
const FORGED = new Headers([...GOOD.entries()].map(([k, v]) => [k, k === "paypal-transmission-sig" ? "made-up" : v]));
const quiet = { warn: () => {}, error: () => {} };

/** PayPal's invoices as a live read returns them. */
const INVOICES = {
  "INV2-BBBB-BBBB-BBBB-BBBB": { status: "PAID", payments: { transactions: SAMPLES["INVOICING.INVOICE.PAID"].resource.invoice.payments.transactions } },
  "INV2-POOL-P2": { status: "PAID", payments: { transactions: txn("CAP-P2-000000000001", "4800.00").transactions } },
  "INV2-TPL": { status: "PARTIALLY_REFUNDED", payments: { transactions: txn("CAP-TPL-00000000001", "2800.00").transactions } },
};

function harness(faults = {}) {
  const w = world();
  let verified = 0, admitted = 0;
  const lines = [];
  const deps = {
    store: memoryStore(w, faults),
    verify: async (raw, h) => { verified++; return h.get("paypal-transmission-sig") === "good-signature" ? "SUCCESS" : "FAILURE"; },
    fetchInvoice: async (id) => { if (faults.paypalDown || !INVOICES[id]) throw new Error("PayPal unreachable"); return clone(INVOICES[id]); },
    log: { warn: (...a) => lines.push(a.map(String).join(" ")), error: (...a) => lines.push(a.map(String).join(" ")) },
    now: () => Date.parse(faults.now ?? "2026-11-01T00:00:00Z"),
    admit: () => { admitted++; return !faults.limit || admitted <= faults.limit; },
  };
  const send = (e, headers = GOOD) => wh.handlePayPalWebhook(typeof e === "string" ? e : JSON.stringify(e), headers, deps);
  const row = (id) => w.payments.find((p) => p.id === id);
  const rowsOf = (t) => JSON.stringify(w.payments.filter((p) => p.tenancy_id === t));
  return { w, deps, send, row, rowsOf, verified: () => verified, admitted: () => admitted, lines };
}

/* ---------- 4. Each event through the handler ---------- */

{
  const h = harness();
  const aBefore = h.rowsOf(T.A);
  const paid = sample("INVOICING.INVOICE.PAID", () => {}, SAMPLES["INVOICING.INVOICE.PAID"].id);
  const r1 = await h.send(paid);
  eq("invoice paid: 200 applied", [r1.status, r1.body.outcome], [200, "applied"]);
  const b = h.row("b-dep");
  eq("invoice paid: the deposit row is PAID", b.status, "PAID");
  eq("invoice paid: PayPal's transaction recorded (the capture a refund goes back against)", b.raw.transactions?.[0]?.payment_id, "CAP-B-0000000000001");
  eq("invoice paid: marked as from PayPal, with the event's time", [b.raw.status_from?.source, b.raw.status_from?.event_id, b.raw.status_from?.at], ["paypal", paid.id, "2026-10-05T18:12:44.917Z"]);
  eq("invoice paid: the pay link kept", b.raw.payLink, "y");
  const paidAudits = h.w.audits.filter((a) => a.action === "deposit_paid");
  eq("invoice paid: one activity entry, from PayPal, on that tenancy", paidAudits.map((a) => [a.tenancy_id, a.detail.source, a.detail.amount, a.detail.capture_id]), [[T.B, "paypal", 2000, "CAP-B-0000000000001"]]);
  eq("invoice paid: the event recorded against its tenancy and workspace", [h.w.events.get(paid.id).status, h.w.events.get(paid.id).tenancyId, h.w.events.get(paid.id).workspaceId], ["applied", T.B, "ws-b"]);
  eq("invoice paid: another workspace's rows untouched", h.rowsOf(T.A), aBefore);

  // The same delivery again (PayPal's retry, or someone replaying the request): processed once.
  const verifiedBefore = h.verified();
  const bBefore = JSON.stringify(h.row("b-dep"));
  const r2 = await h.send(paid);
  eq("replay: 200, a duplicate", [r2.status, r2.body.duplicate], [200, true]);
  eq("replay: still verified first (a replayed request proves nothing by itself)", h.verified(), verifiedBefore + 1);
  eq("replay: no second activity entry", h.w.audits.filter((a) => a.action === "deposit_paid").length, 1);
  eq("replay: the row unchanged", JSON.stringify(h.row("b-dep")), bBefore);
  eq("replay: one stored event", h.w.events.size, 1);

  // A second, distinct PAID event for the same invoice (PayPal sends one per payment): no second "paid" entry.
  await h.send(sample("INVOICING.INVOICE.PAID"));
  eq("a later PAID event for an invoice already reported paid: no second activity entry", h.w.audits.filter((a) => a.action === "deposit_paid").length, 1);
}

{
  // Forged: the signature check fails. Nothing stored, nothing changed.
  const h = harness();
  const before = JSON.stringify(h.w.payments);
  const forged = sample("INVOICING.INVOICE.PAID");
  const r = await h.send(forged, FORGED);
  eq("forged: 401", r.status, 401);
  eq("forged: no event stored", h.w.events.size, 0);
  eq("forged: no row changed", JSON.stringify(h.w.payments), before);
  eq("forged: no activity", h.w.audits.length, 0);
  const bare = await h.send(sample("PAYMENT.CAPTURE.REFUNDED"), new Headers({ "content-type": "application/json" }));
  eq("no signature headers: 401 without asking PayPal", [bare.status, h.verified()], [401, 1]);
  eq("not JSON: 400", (await h.send("{not json", GOOD)).status, 400);
  eq("not an event: 400", (await h.send(JSON.stringify({ hello: "world" }), GOOD)).status, 400);
  eq("forged ones still store nothing", [h.w.events.size, JSON.stringify(h.w.payments) === before], [0, true]);
  // PayPal couldn't be asked: 502, so PayPal sends it again; nothing stored meanwhile.
  h.deps.verify = async () => { throw new Error("PayPal down"); };
  eq("signature check couldn't run: 502, nothing stored", [(await h.send(sample("INVOICING.INVOICE.PAID"))).status, h.w.events.size], [502, 0]);
}

{
  // One workspace's deposit: capture, refund, a refund made elsewhere, a reversal, a PayPal dispute. Nothing else
  // in any other workspace moves.
  const h = harness();
  const others = Object.values(T).filter((t) => t !== T.A).map((t) => [t, h.rowsOf(t)]);

  const cap = await h.send(sample("PAYMENT.CAPTURE.COMPLETED"));
  eq("capture completed: applied to the pool deposit's copy", [cap.body.outcome, h.row("a-dep").raw.capture?.status], ["applied", "COMPLETED"]);

  const ref = await h.send(sample("PAYMENT.CAPTURE.REFUNDED"));
  eq("refund completed: applied", ref.body.outcome, "applied");
  eq("refund completed: the refund row COMPLETED, from PayPal", [h.row("a-ref").status, h.row("a-ref").raw.status_from?.source], ["COMPLETED", "paypal"]);
  eq("refund completed: activity entry", h.w.audits.filter((a) => a.action === "refund_status").map((a) => [a.tenancy_id, a.detail.status, a.detail.previous]), [[T.A, "COMPLETED", "PENDING"]]);
  const late = await h.send(sample("PAYMENT.CAPTURE.REFUNDED", refundOf("REF-A-0000000000001", "CAP-A-0000000000001", "PENDING")));
  eq("a late PENDING for a completed refund: recorded, the status stays COMPLETED", [late.body.outcome, h.row("a-ref").status], ["recorded", "COMPLETED"]);

  const outside = await h.send(sample("PAYMENT.CAPTURE.REFUNDED", refundOf("REF-ELSEWHERE-00001", "CAP-A-0000000000001", "COMPLETED", "500.00")));
  eq("a refund made in PayPal: applied as an activity entry", outside.body.outcome, "applied");
  eq("a refund made in PayPal: no payment row made or changed", h.w.payments.filter((p) => p.tenancy_id === T.A).length, 2);
  eq("a refund made in PayPal: the entry names it", h.w.audits.filter((a) => a.action === "paypal_refund_unrecorded").map((a) => [a.tenancy_id, a.detail.refund_id, a.detail.amount]), [[T.A, "REF-ELSEWHERE-00001", 500]]);

  // A refund PayPal made seconds ago may be this app's own, still being recorded: PayPal is asked to send it again.
  const g = harness({ now: "2026-10-05T19:13:59Z" });
  const young = sample("PAYMENT.CAPTURE.REFUNDED", refundOf("REF-YOUNG-00000001", "CAP-A-0000000000001", "COMPLETED", "500.00"));
  const y1 = await g.send(young);
  eq("a refund not on record, 30 seconds old: 503 and nothing recorded yet", [y1.status, g.w.events.get(young.id).status, g.w.audits.length], [503, "failed", 0]);
  g.deps.now = () => Date.parse("2026-10-05T19:30:00Z");
  const y2 = await g.send(young);
  eq("the same event later, still not on record: a refund made elsewhere", [y2.status, y2.body.outcome, g.w.audits.map((a) => a.action)], [200, "applied", ["paypal_refund_unrecorded"]]);
  const g2 = harness({ now: "2026-10-05T19:13:59Z" });
  const own = sample("PAYMENT.CAPTURE.REFUNDED", refundOf("REF-A-0000000000001", "CAP-A-0000000000001"));
  g2.row("a-ref").status = "COMPLETED";
  eq("the app's own refund, already COMPLETED: PayPal's first word on it is on the activity and the bell",
    [(await g2.send(own)).body.outcome, g2.w.audits.map((a) => [a.action, a.detail.status, a.detail.previous])], ["applied", [["refund_status", "COMPLETED", "COMPLETED"]]]);
  eq("and its second word isn't", [(await g2.send(sample("PAYMENT.CAPTURE.REFUNDED", refundOf("REF-A-0000000000001", "CAP-A-0000000000001")))).body.outcome, g2.w.audits.length], ["recorded", 1]);

  const rev = await h.send(sample("PAYMENT.CAPTURE.REVERSED"));
  eq("reversed: applied, the deposit carries the reversal", [rev.body.outcome, h.row("a-dep").raw.reversal?.id, h.row("a-dep").status], ["applied", "REV-A-0000000000001", "PAID"]);
  eq("reversed: activity entry", h.w.audits.filter((a) => a.action === "deposit_reversed").length, 1);

  const created = await h.send(sample("CUSTOMER.DISPUTE.CREATED"));
  eq("dispute created: stored for the tenancy that holds the capture", [created.body.outcome, h.w.disputes.get("PP-D-27803")?.tenancy_id, h.w.disputes.get("PP-D-27803")?.status, h.w.disputes.get("PP-D-27803")?.amount], ["applied", T.A, "OPEN", 4800]);
  const sameStatus = await h.send(sample("CUSTOMER.DISPUTE.UPDATED", (r) => { r.status = "OPEN"; r.update_time = "2026-10-07T18:00:00.000Z"; }));
  eq("dispute updated, same status: stored, no new activity entry", [sameStatus.body.outcome, h.w.audits.filter((a) => a.action === "paypal_dispute").length], ["applied", 1]);
  await h.send(sample("CUSTOMER.DISPUTE.UPDATED"));
  eq("dispute updated, new status: activity entry", h.w.audits.filter((a) => a.action === "paypal_dispute").map((a) => a.detail.status), ["OPEN", "WAITING_FOR_SELLER_RESPONSE"]);
  await h.send(sample("CUSTOMER.DISPUTE.RESOLVED"));
  eq("dispute resolved: outcome kept", [h.w.disputes.get("PP-D-27803").status, h.w.disputes.get("PP-D-27803").outcome], ["RESOLVED", "RESOLVED_SELLER_FAVOUR"]);
  const stale = await h.send(sample("CUSTOMER.DISPUTE.UPDATED", (r) => { r.update_time = "2026-10-09T00:00:00.000Z"; }));
  eq("an older dispute update after it resolved: recorded, nothing overwritten", [stale.body.outcome, h.w.disputes.get("PP-D-27803").status], ["recorded", "RESOLVED"]);

  for (const [t, before] of others) eq(`workspace isolation: ${t} untouched by ${T.A}'s events`, h.rowsOf(t), before);
  check("workspace isolation: every activity entry is on the tenancy the event matched", h.w.audits.every((a) => a.tenancy_id === T.A));

  // The ledger shows where a status came from, and counts a reversed deposit as not held.
  const rows = ledger.ledgerRows(
    { id: T.A, tenants: [{ name: "Maya Torres" }], monthly_rent: 2400, move_out_date: "2026-10-01", statement_delivered_at: null, lease_terms: null, properties: { address: "1 Test St, Orange, CA 92866", city: "Orange", state: "CA" } },
    h.w.payments.filter((p) => p.tenancy_id === T.A), [],
  );
  const refundRow = rows.find((r) => r.kind === "refund");
  const payment = rows.find((r) => r.kind === "payment");
  check("ledger: the refund row says its status came from PayPal", !!refundRow?.fromPayPal && /status from PayPal/.test(refundRow.detail), JSON.stringify(refundRow));
  eq("ledger: a reversed deposit is not counted as held", [payment?.effect, payment?.status, ledger.ledgerTotals(rows).collected], ["failed", "reversed", 0]);
  const plain = ledger.ledgerRows({ id: T.G, tenants: [], monthly_rent: null, move_out_date: null, statement_delivered_at: null, lease_terms: null, properties: { address: "2 Test St", city: null, state: "CA" } },
    h.w.payments.filter((p) => p.tenancy_id === T.G), []);
  check("ledger: a row nothing reported has no mark (and reads as before)", plain.every((r) => !("fromPayPal" in r) && !/status from PayPal/.test(r.detail)));
}

{
  // Payouts: the batch, then its one item; the item's word wins, and nothing moves back.
  const h = harness();
  const step = async (type, edit) => { const r = await h.send(sample(type, edit)); return [r.body.outcome, h.row("f-pay").status]; };
  eq("payout batch success", await step("PAYMENT.PAYOUTSBATCH.SUCCESS"), ["applied", "SUCCESS"]);
  eq("payout item unclaimed after the batch succeeded: the item's status wins", await step("PAYMENT.PAYOUTS-ITEM.UNCLAIMED"), ["applied", "UNCLAIMED"]);
  eq("payout item succeeded", await step("PAYMENT.PAYOUTS-ITEM.SUCCEEDED"), ["applied", "SUCCESS"]);
  eq("a late unclaimed after it succeeded: no move back", await step("PAYMENT.PAYOUTS-ITEM.UNCLAIMED"), ["recorded", "SUCCESS"]);
  eq("the batch's success again: still the item's word", await step("PAYMENT.PAYOUTSBATCH.SUCCESS"), ["recorded", "SUCCESS"]);
  eq("payout item returned (unclaimed for 30 days)", await step("PAYMENT.PAYOUTS-ITEM.RETURNED"), ["applied", "RETURNED"]);
  eq("payout activity entries", h.w.audits.filter((a) => a.action === "payout_status").map((a) => a.detail.status), ["SUCCESS", "UNCLAIMED", "SUCCESS", "RETURNED"]);
  for (const t of ["HELD", "BLOCKED", "CANCELED", "DENIED", "FAILED", "REFUNDED"]) {
    const g = harness();
    await g.send(sample("PAYMENT.PAYOUTS-ITEM.UNCLAIMED", (r, e) => { e.event_type = `PAYMENT.PAYOUTS-ITEM.${t}`; r.transaction_status = t; }));
    eq(`payout item ${t.toLowerCase()}`, g.row("f-pay").status, { HELD: "ONHOLD", BLOCKED: "BLOCKED", CANCELED: "CANCELED", DENIED: "DENIED", FAILED: "FAILED", REFUNDED: "RETURNED" }[t]);
  }
  const denied = await h.send(sample("PAYMENT.PAYOUTSBATCH.DENIED"));
  eq("a settlement's Payout denied: the row and the sent settlement's PayPal status", [denied.body.outcome, h.row("f-spay").status, h.w.settlements[0].paypal_status], ["applied", "DENIED", "DENIED"]);
}

{
  // Other workspaces' payments: a pool deposit given back, a template's payment, an id two tenancies hold.
  const h = harness();
  const all = () => JSON.stringify(h.w.payments);
  const c = h.rowsOf(T.C);
  const r = await h.send(sample("INVOICING.INVOICE.PAID", (res) => { res.invoice.id = "INV2-POOL-P2"; res.invoice.payments.transactions[0].payment_id = "CAP-P2-000000000001"; }));
  eq("pool deposit given back on Start over: the event goes to the copy holding it now", [r.body.outcome, h.w.events.get([...h.w.events.keys()].at(-1)).tenancyId], ["applied", T.D]);
  eq("pool deposit given back: the old copy's row untouched", h.rowsOf(T.C), c);
  check("pool deposit given back: the new holder marked", h.row("d-dep").raw.status_from?.source === "paypal");

  const before = all();
  const tpl = await h.send(sample("PAYMENT.CAPTURE.REFUNDED", refundOf("REF-TPL-00000000001", "CAP-TPL-00000000001", "COMPLETED", "1790.00")));
  const ev = h.w.events.get([...h.w.events.keys()].at(-1));
  eq("template's refund: recorded against the template, read only", [tpl.body.outcome, ev.tenancyId, ev.note], ["recorded", T.TPL, wh.TEMPLATE_NOTE]);
  const tplPaid = await h.send(sample("INVOICING.INVOICE.PAID", (res) => { res.invoice.id = "INV2-TPL"; res.invoice.payments.transactions[0].payment_id = "CAP-TPL-00000000001"; }));
  eq("template's invoice: recorded, read only", tplPaid.body.outcome, "recorded");
  const tplRev = await h.send(sample("PAYMENT.CAPTURE.REVERSED", refundOf("REV-TPL-0000000001", "CAP-TPL-00000000001", "COMPLETED", "2800.00")));
  eq("template's capture reversed: recorded, read only", tplRev.body.outcome, "recorded");
  eq("template's events: neither the template nor any copy that shows its payments changed", all(), before);

  const dup = await h.send(sample("PAYMENT.CAPTURE.REVERSED", refundOf("REV-DUP-0000000001", "CAP-DUP-00000000001", "COMPLETED", "900.00")));
  eq("a capture two workspaces' rows name: unmatched, neither changed", [dup.body.outcome, all()], ["unmatched", before]);
  const pool3 = await h.send(sample("PAYMENT.CAPTURE.COMPLETED", (res) => { res.id = "CAP-P3-000000000001"; }));
  eq("a pool deposit no copy holds: unmatched", pool3.body.outcome, "unmatched");
  const unknown = await h.send(sample("PAYMENT.CAPTURE.COMPLETED", (res) => { res.id = "CAP-NOBODY-0000001"; }));
  eq("a capture nobody holds: unmatched", unknown.body.outcome, "unmatched");
  const sub = await h.send(sample("BILLING.SUBSCRIPTION.CREATED"));
  eq("an event this app doesn't act on: stored and ignored", [sub.status, sub.body.outcome, h.w.events.get([...h.w.events.keys()].at(-1)).status], [200, "ignored", "ignored"]);
  eq("nothing else changed", all(), before);
}

{
  // A try that fails is not lost: 500, the event stays failed, and PayPal's redelivery applies it once.
  const h = harness({ throwOnUpdate: true });
  const e = sample("PAYMENT.CAPTURE.REFUNDED");
  const r1 = await h.send(e);
  eq("failed try: 500 so PayPal sends it again, the event marked failed", [r1.status, h.w.events.get(e.id).status], [500, "failed"]);
  eq("failed try: nothing changed", h.row("a-ref").status, "PENDING");
  const r2 = await h.send(e);
  eq("redelivery: applied once", [r2.status, r2.body.outcome, h.row("a-ref").status, h.w.events.get(e.id).attempts], [200, "applied", "COMPLETED", 2]);
  eq("redelivery: one activity entry", h.w.audits.filter((a) => a.action === "refund_status").length, 1);
  eq("after that, a duplicate", (await h.send(e)).body.duplicate, true);
}

{
  // Another delivery changed the row between the read and the write: read again, worked out again, nothing lost.
  const h = harness({ conflictOnce: true });
  const r = await h.send(sample("PAYMENT.CAPTURE.REFUNDED"));
  eq("conflict: applied after reading the row again", [r.body.outcome, h.row("a-ref").status, h.row("a-ref").raw.touched_by], ["applied", "COMPLETED", "another delivery"]);
  const g = harness({ conflictOnce: true, conflictStatus: "COMPLETED" });
  const r2 = await g.send(sample("PAYMENT.CAPTURE.REFUNDED", refundOf("REF-A-0000000000001", "CAP-A-0000000000001", "PENDING")));
  eq("conflict that completed it meanwhile: a late PENDING doesn't undo it", [r2.body.outcome, g.row("a-ref").status], ["recorded", "COMPLETED"]);
}

{
  // PayPal unreachable for the invoice read: the event's own copy (verified with its signature) stands in.
  const h = harness({ paypalDown: true });
  const r = await h.send(sample("INVOICING.INVOICE.PAID"));
  eq("PayPal unreachable: the verified event's invoice is used", [r.body.outcome, h.row("b-dep").status, h.row("b-dep").raw.transactions?.[0]?.payment_id], ["applied", "PAID", "CAP-B-0000000000001"]);
  // An older PAID arriving after a refund: never moves the invoice back.
  const g = harness({ paypalDown: true });
  g.row("b-dep").status = "PARTIALLY_REFUNDED";
  const r2 = await g.send(sample("INVOICING.INVOICE.PAID"));
  eq("a PAID event after the refund: the invoice stays PARTIALLY_REFUNDED, not marked as PayPal's word", [r2.body.outcome, g.row("b-dep").status, g.row("b-dep").raw.status_from ?? null], ["applied", "PARTIALLY_REFUNDED", null]);
}

{
  // Two deliveries at once write different keys of one row under the same status (a capture and a reversal): both stay.
  const h = harness({ sneakKey: { reversal: { id: "REV-SNEAK", at: "2026-10-05T18:00:00.000Z" } } });
  const r = await h.send(sample("PAYMENT.CAPTURE.COMPLETED"));
  const a = h.row("a-dep");
  eq("merge: the capture written and the other delivery's reversal kept", [r.body.outcome, a.raw.capture?.status, a.raw.reversal?.id, a.raw.payLink], ["applied", "COMPLETED", "REV-SNEAK", "x"]);
  eq("merge: only the keys the event changed are written", wh.changedKeys({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 }, d: 4 }), { b: { c: 3 }, d: 4 });
}

{
  // A capture event read while PayPal's invoice still says SENT changes no status, so it marks none as PayPal's.
  const h = harness();
  h.row("b-dep").raw = { payLink: "y", ...txn("CAP-B-0000000000001", "2000.00") };
  h.deps.fetchInvoice = async () => ({ status: "SENT", payments: { transactions: [] } });
  const r = await h.send(sample("PAYMENT.CAPTURE.COMPLETED", (res) => { res.id = "CAP-B-0000000000001"; }));
  const b = h.row("b-dep");
  eq("capture while the invoice reads SENT: noted, status unchanged, not marked From PayPal", [r.body.outcome, b.status, b.raw.capture?.id, b.raw.status_from ?? null], ["applied", "SENT", "CAP-B-0000000000001", null]);
}

{
  // A capture before its invoice's PAID event (which records the capture): PayPal sends it again, and the redelivery
  // lands after; ten minutes on, a capture nobody holds is stored as unmatched.
  const h = harness({ now: "2026-10-05T18:13:00Z" });
  const early = sample("PAYMENT.CAPTURE.COMPLETED", (res) => { res.id = "CAP-B-0000000000001"; });
  const r1 = await h.send(early);
  eq("capture before its invoice's event: 503, so PayPal sends it again", [r1.status, h.w.events.get(early.id).status, h.w.audits.length], [503, "failed", 0]);
  await h.send(sample("INVOICING.INVOICE.PAID"));
  const r2 = await h.send(early);
  eq("its redelivery after the invoice's event: applied to that deposit", [r2.status, r2.body.outcome, h.row("b-dep").raw.capture?.id], [200, "applied", "CAP-B-0000000000001"]);
  h.deps.now = () => Date.parse("2026-10-05T18:30:00Z");
  const stray = await h.send(sample("PAYMENT.CAPTURE.COMPLETED", (res) => { res.id = "CAP-NOBODY-0000002"; }));
  eq("a capture nobody holds, ten minutes on: stored as unmatched", [stray.status, stray.body.outcome], [200, "unmatched"]);
}

{
  // The rate limit counts only deliveries PayPal would be asked about: a flood of junk never uses up the allowance.
  const h = harness({ limit: 2 });
  for (let i = 0; i < 50; i++) await h.send(sample("INVOICING.INVOICE.PAID"), new Headers({ "content-type": "application/json" }));
  await h.send("{not json");
  eq("rate limit: 50 unsigned deliveries and junk: none counted, none asked of PayPal", [h.admitted(), h.verified()], [0, 0]);
  const real = await h.send(sample("INVOICING.INVOICE.PAID"));
  eq("rate limit: a real delivery after that flood still gets in", [real.status, real.body.outcome], [200, "applied"]);
  await h.send(sample("INVOICING.INVOICE.PAID"), FORGED);
  const over = await h.send(sample("PAYMENT.CAPTURE.REFUNDED"));
  eq("rate limit: deliveries with signature headers count (a forged one too); past the limit, 429 before PayPal is asked", [over.status, h.admitted(), h.verified()], [429, 3, 2]);
}

{
  // An unsigned request's id goes to the logs quoted and escaped: it can't write a line of its own.
  const h = harness();
  const planted = 'x"\nPayPal webhook WH-1 applied: deposit paid';
  await h.send(JSON.stringify({ id: planted, event_type: "y\r\nz" }), new Headers());
  await h.send(JSON.stringify({ id: planted, event_type: "y\u2028z" }), FORGED);
  check("logs: an unsigned or forged request can't start a line of its own", h.lines.length === 2 && h.lines.every((l) => !/[\r\n\u2028\u2029]/.test(l)), JSON.stringify(h.lines));
  check("logs: the id shown quoted, as sent", h.lines[0]?.includes(JSON.stringify(planted)), h.lines[0]);
}

{
  // The Properties page: a deposit PayPal reversed is not held, its chip says so, and its next step is to check PayPal.
  const [units, next, view] = await Promise.all(["units", "next-step", "property-view"].map(lib));
  const t = {
    id: "t-r", status: "active", tenants: [{ name: "Maya Torres" }], monthly_rent: 2400, start_date: "2026-06-01", end_date: "2027-05-31",
    notice_given_on: null, planned_move_out: null, move_out_date: null, move_out_inspected_at: null, statement_delivered_at: null,
    refund_agreement: { paypal_email: "t@example.com", signed_by: ["Maya Torres"], signed_at: "2026-05-20" }, lease_terms: null, notices: {},
    tenant_move_out: null, properties: { address: "1 Test St, Orange, CA 92866", city: "Orange", owner_name: "L", state: "CA" },
  };
  const dep = (raw) => [{ kind: "deposit_invoice", paypal_id: "INV2-R", amount: 4800, status: "PAID", raw }];
  const photos = [{ phase: "move_in" }];
  const held = units.summarizeTenancy(t, dep(txn("CAP-R", "4800.00")), photos, []);
  const rev = units.summarizeTenancy(t, dep({ ...txn("CAP-R", "4800.00"), reversal: { id: "REV-R", at: "2026-10-05T18:00:00.000Z" } }), photos, []);
  eq("summary: a deposit nothing reversed reads as before (no reversed key)", "reversed" in held.deposit, false);
  eq("summary: a reversed deposit says so", rev.deposit.reversed, true);
  const n = next.nextStep(rev, "2026-10-05");
  const link = view.stepLink(rev, n);
  eq("reversed: the next step is to check PayPal", [n.label, n.level, link.label, link.title, link.href], [next.REVERSED_STEP, "urgent", "Check PayPal", next.REVERSED_STEP, "/tenancy/t-r?tab=payments#ledger"]);
  eq("reversed: the chip", view.propertyStatus(rev, n), { label: "Payment reversed", tone: "red", group: "move-in" });
  eq("reversed: nothing left to refund from it", next.refundLeft(rev), null);
  check("a held deposit's chip and step unchanged", view.propertyStatus(held, next.nextStep(held, "2026-10-05")).label !== "Payment reversed" && next.nextStep(held, "2026-10-05").label !== next.REVERSED_STEP);
}

/* ---------- 5. The signature request, the keys, the rate limit ---------- */

{
  const paypal = await lib("paypal");
  const calls = [];
  const realFetch = globalThis.fetch;
  let answer = { status: 200, body: { verification_status: "SUCCESS" } };
  // PayPal's answer by address, where a check needs more than one; null falls back to `answer`.
  let route = null;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    const routed = route?.(String(url), init);
    if (routed) return new Response(JSON.stringify(routed.body), { status: routed.status });
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  };
  try {
    const raw = `{"id":"WH-1","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"amount":{"value":"4800.0"}},"x":1.10}`;
    eq("verify: SUCCESS when PayPal says so", await paypal.verifyWebhookSignature(raw, GOOD, "WEBHOOK-123"), "SUCCESS");
    const v = calls.find((c) => c.url.endsWith("/v1/notifications/verify-webhook-signature"));
    check("verify: sent to PayPal's verify-webhook-signature in the sandbox", !!v && v.url.startsWith("https://api-m.sandbox.paypal.com"));
    check("verify: the event goes back byte for byte (4800.0 and 1.10 as sent)", !!v && v.init.body.endsWith(`"webhook_event":${raw}}`), v?.init.body);
    const sent = JSON.parse(v.init.body);
    eq("verify: the headers and the webhook id", [sent.auth_algo, sent.transmission_id, sent.transmission_sig, sent.webhook_id], ["SHA256withRSA", "69cd13f0-d67a-11e5-baa3-778b53f4ae55", "good-signature", "WEBHOOK-123"]);
    answer = { status: 200, body: { verification_status: "FAILURE" } };
    eq("verify: FAILURE when PayPal says so", await paypal.verifyWebhookSignature(raw, GOOD, "WEBHOOK-123"), "FAILURE");
    answer = { status: 400, body: { name: "VALIDATION_ERROR" } };
    eq("verify: a request PayPal won't check (a made-up certificate address) is a FAILURE", await paypal.verifyWebhookSignature(raw, GOOD, "WEBHOOK-123"), "FAILURE");
    answer = { status: 503, body: {} };
    let threw = false;
    try { await paypal.verifyWebhookSignature(raw, GOOD, "WEBHOOK-123"); } catch { threw = true; }
    check("verify: PayPal down throws (the delivery is answered 502 and comes again)", threw);
    const n = calls.length;
    eq("verify: a missing header is a FAILURE without asking PayPal", [await paypal.verifyWebhookSignature(raw, new Headers({ "paypal-auth-algo": "x" }), "W"), calls.length], ["FAILURE", n]);

    // The deposit invoice's number, from our own record: PayPal refuses a number twice, which PayPal-Request-Id
    // doesn't do for invoices (tried in the sandbox on 2026-10-05).
    const content = { items: [{ unit_amount: { value: "4800.00" } }] };
    const n1 = paypal.depositInvoiceNumber("t-1", content);
    check("invoice number: GF- and 20 hex digits, inside PayPal's 25 characters", /^GF-[0-9a-f]{20}$/.test(n1) && n1.length <= 25, n1);
    eq("invoice number: the same tenancy and invoice, the same number", paypal.depositInvoiceNumber("t-1", clone(content)), n1);
    check("invoice number: another amount, another number", paypal.depositInvoiceNumber("t-1", { items: [{ unit_amount: { value: "4700.00" } }] }) !== n1);
    check("invoice number: another tenancy, another number", paypal.depositInvoiceNumber("t-2", content) !== n1);

    calls.length = 0;
    answer = { status: 201, body: { batch_header: { payout_batch_id: "B1", batch_status: "PENDING" } } };
    const p = await paypal.sendPayout({ email: "t@example.com", amount: 10, note: "n", batchId: "deposit-t-1" });
    const post = calls.find((c) => c.url.endsWith("/v1/payments/payouts"));
    eq("payout: PayPal-Request-Id is the batch id", post?.init.headers["PayPal-Request-Id"], "deposit-t-1");
    eq("payout: the batch status kept for the webhook", [p.id, p.status, p.batch_status], ["B1", "PENDING", "PENDING"]);

    const OPTS = { tenancyId: "t-1", tenantEmail: "t@example.com", amount: 4800, landlordName: "L", address: "A", note: "N", terms: "T" };
    const invCalls = () => calls.filter((c) => c.url.includes("/v2/invoicing/"));
    calls.length = 0;
    route = (url) => (url.endsWith("/v2/invoicing/invoices") ? { status: 201, body: { id: "INV2-NEW" } } : url.endsWith("/send") ? { status: 200, body: {} } : null);
    const made = await paypal.sendDepositInvoice(OPTS);
    const [create, send] = invCalls();
    const number = JSON.parse(create.init.body).detail.invoice_number;
    check("invoice: created with its number", /^GF-[0-9a-f]{20}$/.test(number ?? ""), number);
    eq("invoice: the create's PayPal-Request-Id is the same record", create.init.headers["PayPal-Request-Id"], number);
    eq("invoice: send carries the invoice's key", [send?.url.endsWith("/v2/invoicing/invoices/INV2-NEW/send"), send?.init.headers["PayPal-Request-Id"]], [true, "gf-invoice-send-INV2-NEW"]);
    eq("invoice: made, not picked up", [made.id, made.invoiceNumber, made.adopted ?? false], ["INV2-NEW", number, false]);

    // PayPal already has that number (an earlier try's answer was lost, or its row wasn't saved): that invoice, sent once.
    const dup = { status: 422, body: { name: "UNPROCESSABLE_ENTITY", details: [{ field: "/detail/invoice_number", value: number, issue: "DUPLICATE_INVOICE_NUMBER" }] } };
    const found = (id, status) => ({ status: 200, body: { items: [{ id, status, detail: { invoice_number: number } }] } });
    calls.length = 0;
    route = (url) => (url.endsWith("/v2/invoicing/invoices") ? dup : url.includes("/search-invoices") ? found("INV2-OLD", "UNPAID") : null);
    const again = await paypal.sendDepositInvoice(OPTS);
    eq("invoice retry: the first invoice, found by its number, not a second", [again.id, again.adopted], ["INV2-OLD", true]);
    eq("invoice retry: already sent, so not sent again", invCalls().filter((c) => c.url.endsWith("/send")).length, 0);
    check("invoice retry: searched by that number", invCalls().some((c) => c.url.includes("/search-invoices") && JSON.parse(c.init.body).invoice_number === number));
    calls.length = 0;
    route = (url) => (url.endsWith("/v2/invoicing/invoices") ? dup : url.includes("/search-invoices") ? found("INV2-DRAFT", "DRAFT")
      : url.endsWith("/send") ? { status: 200, body: {} } : null);
    eq("invoice retry, made but never sent: sent now, once", [(await paypal.sendDepositInvoice(OPTS)).id, invCalls().filter((c) => c.url.endsWith("/INV2-DRAFT/send")).length], ["INV2-DRAFT", 1]);
    // Two tabs at once: the other one sent it first, so this send is refused, and the invoice is no longer a draft.
    route = (url, init) => (url.endsWith("/v2/invoicing/invoices") ? dup : url.includes("/search-invoices") ? found("INV2-RACE", "DRAFT")
      : url.endsWith("/send") ? { status: 422, body: { name: "UNPROCESSABLE_ENTITY" } }
        : url.endsWith("/v2/invoicing/invoices/INV2-RACE") && init?.method === "GET" ? { status: 200, body: { id: "INV2-RACE", status: "UNPAID" } } : null);
    eq("invoice, two tabs: the other tab's send counts", (await paypal.sendDepositInvoice(OPTS)).id, "INV2-RACE");
    // A plain refusal: nothing was made, so the day's unit goes back (InvoiceNotCreated).
    route = (url) => (url.endsWith("/v2/invoicing/invoices") ? { status: 400, body: { name: "INVALID_REQUEST" } } : null);
    let notCreated = false;
    try { await paypal.sendDepositInvoice(OPTS); } catch (e) { notCreated = e instanceof paypal.InvoiceNotCreated; }
    check("invoice refused outright: InvoiceNotCreated", notCreated);
    route = null;
  } finally {
    globalThis.fetch = realFetch;
  }
}

{
  const limited = rate.rateLimiter({ perAddress: 3, total: 5, ms: 60_000 });
  const t0 = 1_000_000;
  eq("rate limit: three from one address pass, the fourth doesn't", [1, 2, 3, 4].map((i) => limited("1.1.1.1", t0 + i)), [false, false, false, true]);
  eq("rate limit: the ceiling across addresses (five in all, then no address passes)", [limited("2.2.2.2", t0 + 5), limited("3.3.3.3", t0 + 6)], [false, true]);
  eq("rate limit: a new minute starts over", limited("1.1.1.1", t0 + 61_000), false);
}

/* ---------- 6. Against the database (--db) ---------- */

if (DB) await dbChecks();

console.log(`${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}

async function dbChecks() {
  const { db } = await lib("db");
  const { webhookStore, paypalAlerts } = await lib("paypal-webhook-store");
  const tag = `gfcheck-${Date.now().toString(36)}`;
  const ids = { ws: [], props: [], ten: [], events: [] };
  const must = (what, r) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };
  try {
    // Two throwaway demo workspaces, one tenancy each, nothing shared with the templates or the pool.
    const [wa, wb] = must("workspaces", await db.from("workspaces").insert([{ kind: "demo", label: `${tag} A` }, { kind: "demo", label: `${tag} B` }]).select("id"));
    ids.ws.push(wa.id, wb.id);
    const [pa, pb] = must("properties", await db.from("properties").insert([{ address: `${tag} A St`, workspace_id: wa.id }, { address: `${tag} B St`, workspace_id: wb.id }]).select("id"));
    ids.props.push(pa.id, pb.id);
    const [ta, tb] = must("tenancies", await db.from("tenancies").insert([{ property_id: pa.id, workspace_id: wa.id }, { property_id: pb.id, workspace_id: wb.id }]).select("id"));
    ids.ten.push(ta.id, tb.id);
    const cap = `CAP-${tag}`.slice(0, 30), inv = `INV2-${tag}`, refund = `REF-${tag}`, batch = `BATCH-${tag}`;
    must("payments", await db.from("payments").insert([
      { tenancy_id: ta.id, kind: "deposit_invoice", paypal_id: inv, amount: 4800, status: "SENT", raw: { payLink: "x" } },
      { tenancy_id: ta.id, kind: "refund", paypal_id: refund, amount: 3790, status: "PENDING", raw: { id: refund } },
      { tenancy_id: tb.id, kind: "deposit_invoice", paypal_id: `${inv}-B`, amount: 900, status: "PAID", raw: txn(`${cap}-B`, "900.00") },
      { tenancy_id: tb.id, kind: "payout", paypal_id: batch, amount: 900, status: "PENDING", raw: { id: batch, status: "PENDING", batch_status: "PENDING" } },
    ]));
    const read = async (t) => JSON.stringify(must("read", await db.from("payments").select("kind, paypal_id, status, raw").eq("tenancy_id", t).order("kind")));
    const bBefore = await read(tb.id);
    const deps = {
      store: webhookStore, log: quiet, now: () => Date.parse("2026-11-01T00:00:00Z"),
      verify: async (raw, h) => (h.get("paypal-transmission-sig") === "good-signature" ? "SUCCESS" : "FAILURE"),
      fetchInvoice: async () => ({ status: "PAID", payments: { transactions: txn(cap, "4800.00").transactions } }),
    };
    const send = async (e, headers = GOOD) => { ids.events.push(e.id); return wh.handlePayPalWebhook(JSON.stringify(e), headers, deps); };
    const evId = (n) => `WH-${tag}-${n}`;

    const paid = sample("INVOICING.INVOICE.PAID", (r) => { r.invoice.id = inv; r.invoice.payments.transactions[0].payment_id = cap; }, evId(1));
    eq("db: invoice paid applied", (await send(paid)).body.outcome, "applied");
    const aDep = must("a dep", await db.from("payments").select("status, raw").eq("tenancy_id", ta.id).eq("kind", "deposit_invoice").single());
    eq("db: the deposit PAID with its capture, marked from PayPal", [aDep.status, aDep.raw.transactions[0].payment_id, aDep.raw.status_from.source, aDep.raw.payLink], ["PAID", cap, "paypal", "x"]);
    eq("db: replay is a duplicate", (await send(paid)).body.duplicate, true);

    // merge_payment: only under the status read, and only the keys set; another writer's key stays.
    const depRow = must("dep row", await db.from("payments").select("id, raw").eq("tenancy_id", ta.id).eq("kind", "deposit_invoice").single());
    must("other writer", await db.from("payments").update({ raw: { ...depRow.raw, other_writer: 1 } }).eq("id", depRow.id).select("id"));
    const wrote = await webhookStore.updatePayment(depRow.id, "PAID", { status: "PAID", set: { capture: { id: cap, status: "COMPLETED" } } });
    const stale = await webhookStore.updatePayment(depRow.id, "SENT", { status: "PAID", set: { never: true } });
    const merged = must("merged", await db.from("payments").select("raw").eq("id", depRow.id).single()).raw;
    eq("db: merge_payment writes under the status read and keeps another writer's key",
      [wrote, stale, merged.capture?.id, merged.other_writer, merged.payLink, "never" in merged, merged.transactions?.[0]?.payment_id], [true, false, cap, 1, "x", false, cap]);
    must("unset", await db.rpc("merge_payment", { p_id: depRow.id, p_expect: "PAID", p_status: "PAID", p_set: {}, p_unset: ["other_writer"] }));
    eq("db: merge_payment drops the keys asked", "other_writer" in must("after unset", await db.from("payments").select("raw").eq("id", depRow.id).single()).raw, false);
    const stored = must("event", await db.from("paypal_webhook_events").select("status, tenancy_id, workspace_id, attempts").eq("id", paid.id).single());
    eq("db: the event stored once, against its tenancy and workspace", [stored.status, stored.tenancy_id, stored.workspace_id, stored.attempts], ["applied", ta.id, wa.id, 1]);

    const r = await send(sample("PAYMENT.CAPTURE.REFUNDED", refundOf(refund, cap), evId(2)));
    eq("db: refund found by its id and completed", [r.body.outcome, JSON.parse(await read(ta.id)).find((p) => p.kind === "refund").status], ["applied", "COMPLETED"]);
    eq("db: a refund made elsewhere found by the deposit's capture (jsonb contains)",
      (await send(sample("PAYMENT.CAPTURE.REFUNDED", refundOf(`${refund}-X`, cap, "COMPLETED", "10.00"), evId(3)))).body.outcome, "applied");
    eq("db: dispute stored", (await send(sample("CUSTOMER.DISPUTE.CREATED", (x) => { x.dispute_id = `PP-D-${tag}`; x.disputed_transactions[0].seller_transaction_id = cap; }, evId(4)))).body.outcome, "applied");
    const disp = must("dispute", await db.from("paypal_disputes").select("tenancy_id, workspace_id, status").eq("id", `PP-D-${tag}`).single());
    eq("db: dispute on the right tenancy and workspace", [disp.tenancy_id, disp.workspace_id, disp.status], [ta.id, wa.id, "OPEN"]);

    const forged = sample("PAYMENT.PAYOUTSBATCH.DENIED", (x) => { x.batch_header.payout_batch_id = batch; }, evId(5));
    eq("db: forged event refused", (await send(forged, FORGED)).status, 401);
    eq("db: forged event not stored", (await db.from("paypal_webhook_events").select("id").eq("id", forged.id)).data?.length, 0);
    eq("db: the other workspace untouched by all of it", await read(tb.id), bBefore);

    eq("db: the other workspace's own payout, by its batch id", (await send(sample("PAYMENT.PAYOUTSBATCH.SUCCESS", (x) => { x.batch_header.payout_batch_id = batch; }, evId(6)))).body.outcome, "applied");
    eq("db: payout SUCCESS", JSON.parse(await read(tb.id)).find((p) => p.kind === "payout").status, "SUCCESS");

    const alertsA = await paypalAlerts(wa.id);
    eq("db: the bell for workspace A", alertsA.map((a) => a.title).sort(), ["Deposit of $4,800.00 paid", "PayPal dispute opened", "Refund completed", "Refund made in PayPal"].sort());
    eq("db: the bell for workspace B shows only B's", (await paypalAlerts(wb.id)).map((a) => a.title), ["Payout completed"]);
  } finally {
    // Remove every throwaway row: the events by id, then the tenancies (their payments, activity and PayPal disputes
    // go with them), the properties and the workspaces.
    const errs = [];
    const del = async (what, q) => { const { error } = await q; if (error) errs.push(`${what}: ${error.message}`); };
    if (ids.events.length) await del("events", db.from("paypal_webhook_events").delete().in("id", ids.events));
    if (ids.ten.length) await del("tenancies", db.from("tenancies").delete().in("id", ids.ten));
    if (ids.props.length) await del("properties", db.from("properties").delete().in("id", ids.props));
    if (ids.ws.length) await del("workspaces", db.from("workspaces").delete().in("id", ids.ws).eq("kind", "demo"));
    check("db: throwaway rows removed", !errs.length, errs.join("; "));
  }
}
