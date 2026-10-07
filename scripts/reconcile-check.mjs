#!/usr/bin/env node
// Checks for reconciling PayPal's refunds with the app's records (src/lib/reconcile.ts, src/lib/outside-refunds.ts):
// a refund of a tenancy's deposit payment that PayPal made outside the app (in the PayPal dashboard, or a refund sent
// from here whose answer was lost) is noted once per tenancy, whichever of PayPal's two reports sees it first (its
// webhook, or the invoice's refunds when a page reads PayPal), and waits for the landlord to record it as the
// deposit's refund or mark it not this deposit. Covers: PayPal's invoice refund detail as the sandbox returns it; the
// refunds on record (the close-out's, a settlement's, a PayPal dispute's, one recorded from here) never offered again;
// the same refund seen twice (webhook, then the live check, and the other way round) noted and announced once; a
// refund on a capture that isn't the tenancy's own (a template's, a pool deposit another copy holds, one two copies
// share) never noted or recorded there; a second workspace that never sees it; a recorded refund counted once, in
// full or in part, by the close-out's plan and guard, the ledger and its totals, Insights, the unit's summary and next
// step, and the deductions' lock; one marked not this deposit counting nowhere but in what is left of the payment;
// and the money tools waiting while one is open. PayPal is a stub (no request leaves the process), no Claude call.
// Exit 1 if any fails.
//
//   node scripts/reconcile-check.mjs        in memory: no database, no PayPal
//   node scripts/reconcile-check.mjs --db   also against the Supabase database (.env.local), through the app's own
//                                           modules and functions (note_outside_refund, decide_outside_refund), with
//                                           throwaway workspaces, tenancies and webhook events, removed afterwards;
//                                           PayPal still a stub

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.argv.includes("--db");
const SAMPLES = JSON.parse(readFileSync(join(ROOT, "scripts/fixtures/paypal-webhooks.json"), "utf8"));

// .env.local into the environment for --db, before any module makes its database client. Never printed.
if (DB) {
  const envFile = join(ROOT, ".env.local");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      const k = t.slice(0, i).trim();
      if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^"(.*)"$/, "$1");
    }
  }
  if (process.env.PAYPAL_ENVIRONMENT === "LIVE") { console.error("Refusing to run with PAYPAL_ENVIRONMENT=LIVE."); process.exit(2); }
} else {
  // The modules make their clients when they load; the in-memory checks never use them (nothing listens here).
  process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
  process.env.SUPABASE_SECRET_KEY ??= "test-key";
}
// PayPal is a stub in both modes: the app's credentials never leave the process.
process.env.PAYPAL_ENVIRONMENT = "SANDBOX";
process.env.PAYPAL_CLIENT_ID = "reconcile-check";
process.env.PAYPAL_CLIENT_SECRET = "reconcile-check";
delete process.env.GOOD_FAITH_E2E_STUBS;

/* ---------- The PayPal stub ---------- */

// Every request for a PayPal host is answered here; anything else goes to the real network only in --db mode (the
// database). The invoices the stub knows are set by the checks; a write to PayPal is refused and counted, and the
// checks require that none was made.
const realFetch = globalThis.fetch;
const fakeInvoices = new Map();
const paypalWrites = [];
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = (init.method ?? "GET").toUpperCase();
  if (/(^|\.)paypal\.com$/.test(url.hostname)) {
    if (method === "POST" && url.pathname === "/v1/oauth2/token") return json(200, { access_token: "stub", expires_in: 3600 });
    const m = url.pathname.match(/^\/v2\/invoicing\/invoices\/([A-Za-z0-9-]+)$/);
    if (method === "GET" && m) return fakeInvoices.has(m[1]) ? json(200, fakeInvoices.get(m[1])) : json(404, { name: "RESOURCE_NOT_FOUND" });
    paypalWrites.push(`${method} ${url.pathname}`);
    return json(501, { name: "STUB", message: "The reconcile check's PayPal stub answers invoice reads only." });
  }
  if (!DB) throw new Error(`no network in the in-memory checks: ${url.host}`);
  return realFetch(input, init);
};

const req = createRequire(join(ROOT, "package.json"));
const drawn = [];
const patchPdfLib = (pdfLib) => {
  if (!pdfLib?.PDFPage || pdfLib.PDFPage.prototype.__gfPatched) return;
  const orig = pdfLib.PDFPage.prototype.drawText;
  pdfLib.PDFPage.prototype.drawText = function (text, opts) { drawn.push(String(text)); return orig.call(this, text, opts); };
  pdfLib.PDFPage.prototype.__gfPatched = true;
};
patchPdfLib(req("pdf-lib"));
const jiti = createJiti(import.meta.url, { alias: { "@": join(ROOT, "src"), "server-only": join(ROOT, "node_modules/server-only/empty.js") }, moduleCache: true });
patchPdfLib(await jiti.import("pdf-lib"));
const lib = (n) => jiti.import(join(ROOT, "src/lib", `${n}.ts`));
const [rc, wh, closeout, ledger, insights, next, view, status, states, units] =
  await Promise.all(["reconcile", "paypal-webhook", "closeout", "ledger", "insights", "next-step", "property-view", "dispute-status", "states/server", "units"].map(lib));
const CA = states.packFor("CA"), TX = states.packFor("TX"), NY = states.packFor("NY");
const dates = await lib("dates");

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) pass++;
  else { fail++; failures.push(`${name}${detail ? `: ${detail}` : ""}`); }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const clone = (x) => JSON.parse(JSON.stringify(x));

/** PayPal's invoice refund detail, as the sandbox returned it on 2026-10-07 for the closed template's invoice. */
const listed = (id, value, day) => ({ type: "PAYPAL", recipient_transaction_id: id, refund_date: day, amount: { currency_code: "USD", value } });
const invoiceWith = (id, capture, refunds, paid = "4800.00") => ({
  id, status: refunds.length ? "PARTIALLY_REFUNDED" : "PAID",
  primary_recipients: [{ billing_info: { email_address: "tenant@example.com" } }],
  payments: { paid_amount: { currency_code: "USD", value: paid }, transactions: [{ type: "PAYPAL", payment_id: capture, payment_date: "2026-10-01", payment_date_time: "2026-10-01T10:00:00Z", method: "PAYPAL", amount: { currency_code: "USD", value: paid } }] },
  ...(refunds.length ? { refunds: {
    refund_amount: { currency_code: "USD", value: refunds.reduce((s, r) => s + Number(r.amount.value), 0).toFixed(2) },
    transactions: refunds,
  } } : {}),
});
const noonPacific = (day) => new Date(`${day}T19:00:00.000Z`).toISOString(); // noon PDT in October

/* ---------- 1. PayPal's refunds and the records (pure) ---------- */

{
  const inv = { refunds: { refund_amount: { value: "1790.00" }, transactions: [
    listed("4YW02063NH9636727", "1790.00", "2026-10-01"),
    { type: "PAYPAL", refund_id: "1AB23456CD789012E", refund_date: "2026-10-04", amount: { value: "10.00" } },
    { type: "EXTERNAL", refund_date: "2026-10-04", amount: { value: "99.00" } },
    { type: "PAYPAL", recipient_transaction_id: "bad id!", refund_date: "2026-10-04", amount: { value: "5.00" } },
    { type: "PAYPAL", recipient_transaction_id: "ZERO0000000000000", refund_date: "2026-10-04", amount: { value: "0.00" } },
  ] } };
  eq("invoice refunds: PayPal's shape (recipient_transaction_id, a day read as noon Pacific), refund_id too; EXTERNAL, a bad id and $0 left out",
    rc.invoiceRefunds(inv), [{ id: "4YW02063NH9636727", amount: 1790, at: noonPacific("2026-10-01") }, { id: "1AB23456CD789012E", amount: 10, at: noonPacific("2026-10-04") }]);
  eq("invoice refunds: none listed", rc.invoiceRefunds({ status: "PAID" }), []);
  const morning = Date.parse("2026-10-07T10:00:00Z"); // 3 AM in California: noon on PayPal's day hasn't come yet
  eq("invoice refunds: made this morning, dated now rather than at a noon still to come",
    rc.invoiceRefunds({ refunds: { transactions: [listed("3L7469711X109921V", "1000.00", "2026-10-07")] } }, morning).map((r) => r.at), ["2026-10-07T10:00:00.000Z"]);
  eq("invoice refunded total", [rc.invoiceRefunded(inv), rc.invoiceRefunded({})], [1790, 0]);
}

const pay = (kind, paypal_id, amount, status = "COMPLETED", raw = null, created_at = "2026-10-05T19:00:00.000Z") => ({ kind, paypal_id, amount, status, raw, created_at });
{
  const records = [
    pay("deposit_invoice", "INV2-A", 4800, "PARTIALLY_REFUNDED", { transactions: [{ payment_id: "CAP-A" }] }),
    pay("refund", "REF-OWN", 1000), pay("settlement_refund", "REF-SET", 100), pay("outside_refund", "REF-REC", 50),
    pay("dispute_refund", "PP-D-1", 30, "COMPLETED", { refund_ids: ["REF-DSP"] }), pay("refund", "REF-FAILED", 5, "FAILED"),
  ];
  const inv = invoiceWith("INV2-A", "CAP-A", [listed("REF-OWN", "1000.00", "2026-10-02"), listed("REF-SET", "100.00", "2026-10-03"), listed("REF-REC", "50.00", "2026-10-04"),
    listed("REF-DSP", "30.00", "2026-10-04"), listed("REF-FAILED", "5.00", "2026-10-04"), listed("REF-NEW", "200.00", "2026-10-06")]);
  eq("on record: the close-out's, a settlement's, one recorded from here, a dispute's listed ids, a failed one", [...rc.refundIdsOnRecord(records)].sort(), ["REF-DSP", "REF-FAILED", "REF-OWN", "REF-REC", "REF-SET"]);
  eq("unknown: only the refund no record holds", rc.unknownRefunds(inv, records).map((r) => r.id), ["REF-NEW"]);
  // A claim accepted here, PayPal's refund not yet listed on the dispute's record: matched by amount, oldest first.
  const pending = [pay("deposit_invoice", "INV2-B", 4800, "PAID"), pay("dispute_refund", "PP-D-2", 500, "PENDING", { refund_ids: [] })];
  const invB = invoiceWith("INV2-B", "CAP-B", [listed("REF-X1", "500.00", "2026-10-05"), listed("REF-X2", "200.00", "2026-10-06")]);
  eq("a PayPal dispute's refund without an id yet: its amount covers the first, the rest is unknown", rc.unknownRefunds(invB, pending).map((r) => r.id), ["REF-X2"]);
  eq("nothing listed: nothing unknown", rc.unknownRefunds({ status: "PAID" }, records), []);
}
{
  const notes = [
    { refund_id: "R-LATE", amount: 10, refunded_at: "2026-10-06T19:00:00Z", status: "open" },
    { refund_id: "R-EARLY", amount: 20, refunded_at: "2026-10-04T19:00:00Z", status: "open" },
    { refund_id: "R-REC", amount: 30, refunded_at: "2026-10-03T19:00:00Z", status: "recorded" },
    { refund_id: "R-DIS", amount: 40, refunded_at: "2026-10-03T19:00:00Z", status: "dismissed" },
    { refund_id: "R-OURS", amount: 50, refunded_at: "2026-10-02T19:00:00Z", status: "open" },
  ];
  eq("open: undecided, not on record by now (the close-out's own, written after PayPal reported it), oldest first",
    rc.openNotes(notes, [pay("refund", "R-OURS", 50)]).map((n) => n.refund_id), ["R-EARLY", "R-LATE"]);
  const inv = { refunds: { refund_amount: { value: "1000.00" } } };
  eq("unaccounted: a total PayPal counts but doesn't list", rc.unaccounted(inv, [], []), 1000);
  eq("unaccounted: the app's own refund accounts for it", rc.unaccounted(inv, [pay("refund", "R", 1000)], []), 0);
  eq("unaccounted: a refund marked not this deposit accounts for it", rc.unaccounted(inv, [], [{ refund_id: "R", amount: 1000, refunded_at: null, status: "dismissed" }]), 0);
  eq("unaccounted: a failed refund of ours doesn't", rc.unaccounted(inv, [pay("refund", "R", 1000, "FAILED")], []), 1000);
  eq("recorded returns: the outside refunds that didn't fail, oldest first, with the total and PayPal's status for them (one still pending)",
    rc.outsideReturns([pay("outside_refund", "O2", 300, "COMPLETED", null, "2026-10-06T00:00:00Z"), pay("outside_refund", "O1", 200, "PENDING", null, "2026-10-04T00:00:00Z"), pay("outside_refund", "O3", 99, "FAILED"), pay("refund", "R", 5)]),
    { amount: 500, refunds: [{ id: "O1", amount: 200, at: "2026-10-04T00:00:00Z" }, { id: "O2", amount: 300, at: "2026-10-06T00:00:00Z" }], status: "PENDING" });
  eq("recorded returns: completed once every one is", rc.outsideReturns([pay("outside_refund", "O2", 300), pay("outside_refund", "O1", 200)])?.status, "COMPLETED");
  eq("recorded returns: none", rc.outsideReturns([pay("refund", "R", 5)]), null);
  const open = { refund_id: "R1", amount: 10, refunded_at: null, status: "open" };
  eq("decision: a template, no such refund, recorded, dismissed, ours by now, a deposit not the workspace's, then fine", [
    rc.decisionError({ note: open, payments: [], template: true, owns: true })?.status,
    rc.decisionError({ note: null, payments: [], template: false, owns: true })?.status,
    rc.decisionError({ note: { ...open, status: "recorded" }, payments: [], template: false, owns: true })?.status,
    rc.decisionError({ note: { ...open, status: "dismissed" }, payments: [], template: false, owns: true })?.status,
    rc.decisionError({ note: open, payments: [pay("refund", "R1", 10)], template: false, owns: true })?.status,
    rc.decisionError({ note: open, payments: [], template: false, owns: false })?.status,
    rc.decisionError({ note: open, payments: [], template: false, owns: true }),
  ], [409, 404, 409, 409, 409, 409, null]);
  check("refund ids: PayPal's letters, digits and dashes only", rc.isRefundId("4YW02063NH9636727") && !rc.isRefundId("x'; drop") && !rc.isRefundId("abc"));
}

/* ---------- 2. The webhook and the live check: seen twice, noted once, on the right tenancy (in memory) ---------- */

const WS = { "t-a": "ws-a", "t-b": "ws-b", "t-tpl": "ws-owner", "t-copy": "ws-c", "t-old": "ws-old", "t-new": "ws-new", "t-g": "ws-g", "t-h": "ws-h" };
const txn = (capture) => ({ transactions: [{ payment_id: capture, method: "PAYPAL", payment_date: "2026-10-01", payment_date_time: "2026-10-01T10:00:00Z", amount: { value: "4800.00" } }] });
function world() {
  const p = (id, t, kind, pid, amount, status, raw) => ({ id, tenancy_id: t, kind, paypal_id: pid, amount, status, raw, created_at: "2026-10-02T17:00:00.000Z" });
  return {
    payments: [
      p("a-dep", "t-a", "deposit_invoice", "INV2-A", 4800, "PAID", txn("CAP-A-0000000000001")),
      p("b-dep", "t-b", "deposit_invoice", "INV2-B", 2000, "PAID", txn("CAP-B-0000000000001")),
      p("tpl-dep", "t-tpl", "deposit_invoice", "INV2-TPL", 2800, "PAID", txn("CAP-TPL-00000000001")),
      p("copy-dep", "t-copy", "deposit_invoice", "INV2-TPL", 2800, "PAID", txn("CAP-TPL-00000000001")),
      p("old-dep", "t-old", "deposit_invoice", "INV2-POOL", 4800, "PAID", txn("CAP-POOL-0000000001")),
      p("new-dep", "t-new", "deposit_invoice", "INV2-POOL", 4800, "PAID", txn("CAP-POOL-0000000001")),
      p("g-dep", "t-g", "deposit_invoice", "INV2-G", 900, "PAID", txn("CAP-DUP-00000000001")),
      p("h-dep", "t-h", "deposit_invoice", "INV2-H", 900, "PAID", txn("CAP-DUP-00000000001")),
    ],
    pool: [{ invoice_id: "INV2-POOL", capture_id: "CAP-POOL-0000000001", claimed_by: "ws-new" }],
    templates: new Set(["t-tpl"]),
    events: new Map(), notes: [], audits: [],
  };
}
/** The webhook's store in memory, with note_outside_refund's semantics: nothing on a template, 'ours' for a refund the
 *  tenancy's records hold, one row per tenancy and refund ('new' once, 'seen' after, seen_via growing). */
function memoryStore(w) {
  const ref = (x) => ({ id: x.id, tenancy_id: x.tenancy_id, workspace_id: WS[x.tenancy_id] ?? null, kind: x.kind, paypal_id: x.paypal_id, amount: x.amount, status: x.status, raw: clone(x.raw) });
  return {
    async claim(e) { if (!w.events.has(e.id)) { w.events.set(e.id, { status: "processing" }); return "new"; } return w.events.get(e.id).status === "failed" ? "retry" : "duplicate"; },
    async finish(id, o) { Object.assign(w.events.get(id), o); },
    async paymentsByPayPalId(ids, kinds) { return w.payments.filter((x) => ids.includes(x.paypal_id) && kinds.includes(x.kind)).map(ref); },
    async depositsByCapture(c) { return w.payments.filter((x) => x.kind === "deposit_invoice" && (x.raw?.transactions ?? []).some((t) => t.payment_id === c)).map(ref); },
    async poolDeposit({ invoice, capture }) { return w.pool.find((x) => (invoice && x.invoice_id === invoice) || (capture && x.capture_id === capture)) ?? null; },
    async templateTenancies() { return w.templates; },
    async updatePayment(id, expect, patch) {
      const x = w.payments.find((y) => y.id === id);
      if (!x || x.status !== expect) return false;
      x.status = patch.status; x.raw = { ...(x.raw ?? {}), ...clone(patch.set) };
      return true;
    },
    async reloadPayment(id) { const x = w.payments.find((y) => y.id === id); return x ? ref(x) : null; },
    async settlementStatus() {},
    async upsertDispute() { return { previousStatus: null }; },
    async noteOutsideRefund(t, o) { return note(w, t, { ...o, via: "webhook" }); },
    async audit(t, action, detail) { w.audits.push({ tenancy_id: t, action, detail: clone(detail) }); },
  };
}
function note(w, t, o) {
  if (w.templates.has(t)) return "template";
  if (rc.refundIdsOnRecord(w.payments.filter((x) => x.tenancy_id === t)).has(o.refundId)) return "ours";
  const had = w.notes.find((n) => n.tenancy_id === t && n.refund_id === o.refundId);
  if (had) { had.seen_via = [...new Set([...had.seen_via, o.via])].sort(); if (o.via === "webhook" && o.at && had.status === "open") had.refunded_at = o.at; return "seen"; }
  w.notes.push({ tenancy_id: t, refund_id: o.refundId, capture_id: o.captureId, amount: o.amount, refunded_at: o.at, status: "open", seen_via: [o.via] });
  return "new";
}
/** The live check as noteFromInvoice runs it: the invoice's unknown refunds noted for the tenancy (when its deposit is
 *  its own), each announced the first time either path sees it. */
function liveCheck(w, t, inv, owns = true) {
  if (!owns) return [];
  const mine = w.payments.filter((x) => x.tenancy_id === t);
  const out = [];
  for (const r of rc.unknownRefunds(inv, mine)) {
    const res = note(w, t, { refundId: r.id, captureId: null, amount: r.amount, at: r.at, via: "check" });
    if (res === "new") w.audits.push({ tenancy_id: t, action: "paypal_refund_unrecorded", detail: { source: "paypal_check", refund_id: r.id, amount: r.amount } });
    out.push(res);
  }
  return out;
}
const refundEvent = (id, refundId, capture, value = "1000.00", created = "2026-10-05T12:13:29-07:00") => {
  const e = clone(SAMPLES["PAYMENT.CAPTURE.REFUNDED"]);
  e.id = id;
  e.resource.id = refundId; e.resource.amount.value = value; e.resource.create_time = created; e.resource.update_time = created;
  e.resource.links = [{ rel: "self", method: "GET", href: `https://api.sandbox.paypal.com/v2/payments/refunds/${refundId}` }, { rel: "up", method: "GET", href: `https://api.sandbox.paypal.com/v2/payments/captures/${capture}` }];
  return e;
};
const GOOD = new Headers({ "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.sandbox.paypal.com/cert", "paypal-transmission-id": "t", "paypal-transmission-sig": "good-signature", "paypal-transmission-time": "2026-10-07T00:00:00Z" });
const quiet = { warn() {}, error() {} };
const depsFor = (store, now = Date.parse("2026-10-07T18:00:00Z")) => ({ store, log: quiet, now: () => now, verify: async () => "SUCCESS", fetchInvoice: async () => { throw new Error("not used"); } });
const send = (deps, e) => wh.handlePayPalWebhook(JSON.stringify(e), GOOD, deps);
const unrecordedAudits = (w, t) => w.audits.filter((a) => a.action === "paypal_refund_unrecorded" && (!t || a.tenancy_id === t));

{
  // The webhook first, then the live check, then PayPal delivering the same refund again under a new event id.
  const w = world(), deps = depsFor(memoryStore(w));
  const r1 = await send(deps, refundEvent("WH-R-1", "REFOUT000000000001", "CAP-A-0000000000001"));
  eq("webhook first: applied, noted on the tenancy whose deposit it came out of", [r1.status, r1.body.outcome, w.notes.map((n) => [n.tenancy_id, n.refund_id, n.amount, n.seen_via])], [200, "applied", [["t-a", "REFOUT000000000001", 1000, ["webhook"]]]]);
  eq("webhook first: announced once (activity and bell)", unrecordedAudits(w).map((a) => [a.tenancy_id, a.detail.refund_id, a.detail.source]), [["t-a", "REFOUT000000000001", "paypal"]]);
  eq("webhook first: the precise time kept", w.notes[0].refunded_at, "2026-10-05T19:13:29.000Z");
  eq("then the live check: the same refund, seen", liveCheck(w, "t-a", invoiceWith("INV2-A", "CAP-A-0000000000001", [listed("REFOUT000000000001", "1000.00", "2026-10-05")])), ["seen"]);
  eq("then the live check: still one note, both paths on it, the webhook's time kept", [w.notes.length, w.notes[0].seen_via, w.notes[0].refunded_at], [1, ["check", "webhook"], "2026-10-05T19:13:29.000Z"]);
  eq("then the live check: no second announcement", unrecordedAudits(w).length, 1);
  eq("the same event again: a duplicate, nothing new", [(await send(deps, refundEvent("WH-R-1", "REFOUT000000000001", "CAP-A-0000000000001"))).body.duplicate, w.notes.length, unrecordedAudits(w).length], [true, 1, 1]);
  const again = await send(deps, refundEvent("WH-R-2", "REFOUT000000000001", "CAP-A-0000000000001"));
  eq("the same refund under a new event id: applied, still one note, no second announcement", [again.body.outcome, w.notes.length, unrecordedAudits(w).length], ["applied", 1, 1]);
  check("the event's note says it was already waiting", /already waiting/.test(w.events.get("WH-R-2").note ?? ""), w.events.get("WH-R-2").note);
  eq("no other tenancy noted", [...new Set(w.notes.map((n) => n.tenancy_id))], ["t-a"]);
}
{
  // The live check first (a page read PayPal before its webhook arrived), then the webhook.
  const w = world(), deps = depsFor(memoryStore(w));
  eq("live check first: noted", liveCheck(w, "t-a", invoiceWith("INV2-A", "CAP-A-0000000000001", [listed("REFOUT000000000002", "500.00", "2026-10-05")])), ["new"]);
  eq("live check first: dated noon Pacific on PayPal's day, announced once", [w.notes[0].refunded_at, unrecordedAudits(w).map((a) => a.detail.source)], [noonPacific("2026-10-05"), ["paypal_check"]]);
  const r = await send(deps, refundEvent("WH-R-3", "REFOUT000000000002", "CAP-A-0000000000001", "500.00"));
  eq("then the webhook: applied, the same note, now with the webhook's exact time, no second announcement",
    [r.body.outcome, w.notes.length, w.notes[0].seen_via, w.notes[0].refunded_at, unrecordedAudits(w).length], ["applied", 1, ["check", "webhook"], "2026-10-05T19:13:29.000Z", 1]);
  eq("a second live check: still nothing new", [liveCheck(w, "t-a", invoiceWith("INV2-A", "CAP-A-0000000000001", [listed("REFOUT000000000002", "500.00", "2026-10-05")])), w.notes.length, unrecordedAudits(w).length], [["seen"], 1, 1]);
}
{
  // A refund on a capture that isn't the tenancy's own.
  const w = world(), deps = depsFor(memoryStore(w));
  const tpl = await send(deps, refundEvent("WH-R-4", "REFTPL000000000001", "CAP-TPL-00000000001"));
  eq("a template's capture (every copy shows it): recorded as the template's, noted nowhere, no copy touched", [tpl.body.outcome, w.notes.length, unrecordedAudits(w).length], ["recorded", 0, 0]);
  eq("the live check on a copy of it: its deposit isn't its own, so nothing is noted", [liveCheck(w, "t-copy", invoiceWith("INV2-TPL", "CAP-TPL-00000000001", [listed("REFTPL000000000001", "100.00", "2026-10-05")]), false), w.notes.length], [[], 0]);
  const pool = await send(deps, refundEvent("WH-R-5", "REFPOOL00000000001", "CAP-POOL-0000000001"));
  eq("a pool deposit: noted on the copy that holds it now, never on the copy that gave it back", [pool.body.outcome, w.notes.map((n) => n.tenancy_id)], ["applied", ["t-new"]]);
  const dup = await send(deps, refundEvent("WH-R-6", "REFDUP000000000001", "CAP-DUP-00000000001"));
  eq("a capture two tenancies hold: matched to neither, noted nowhere", [dup.body.outcome, w.notes.filter((n) => n.refund_id === "REFDUP000000000001").length], ["unmatched", 0]);
  w.pool[0].claimed_by = null;
  const free = await send(deps, refundEvent("WH-R-7", "REFPOOL00000000002", "CAP-POOL-0000000001"));
  eq("a pool deposit no copy holds: noted nowhere", [free.body.outcome, w.notes.filter((n) => n.refund_id === "REFPOOL00000000002").length], ["unmatched", 0]);
  eq("the other workspace (ws-b) untouched by all of it", [w.notes.filter((n) => WS[n.tenancy_id] === "ws-b").length, unrecordedAudits(w, "t-b").length, w.payments.find((x) => x.id === "b-dep").status], [0, 0, "PAID"]);
}
{
  // A refund the app sent, a refund already recorded from PayPal, and one made moments ago.
  const w = world();
  w.payments.push({ id: "a-own", tenancy_id: "t-a", kind: "refund", paypal_id: "REFOWN000000000001", amount: 3790, status: "PENDING", raw: {}, created_at: "2026-10-06T00:00:00Z" });
  w.payments.push({ id: "a-rec", tenancy_id: "t-a", kind: "outside_refund", paypal_id: "REFREC000000000001", amount: 1000, status: "PENDING", raw: { outside: { recorded_at: "2026-10-07T00:00:00Z" } }, created_at: "2026-10-05T19:00:00Z" });
  const deps = depsFor(memoryStore(w));
  const own = await send(deps, refundEvent("WH-R-8", "REFOWN000000000001", "CAP-A-0000000000001", "3790.00"));
  eq("the close-out's own refund: its status, never noted", [own.body.outcome, w.payments.find((x) => x.id === "a-own").status, w.notes.length], ["applied", "COMPLETED", 0]);
  const rec = await send(deps, refundEvent("WH-R-9", "REFREC000000000001", "CAP-A-0000000000001"));
  eq("a refund recorded from PayPal: its later status updates its row, and it is never offered again",
    [rec.body.outcome, w.payments.find((x) => x.id === "a-rec").status, w.notes.length, w.audits.at(-1).action, w.audits.at(-1).detail.kind], ["applied", "COMPLETED", 0, "refund_status", "outside_refund"]);
  const young = await send(depsFor(memoryStore(w), Date.parse("2026-10-05T19:14:00Z")), refundEvent("WH-R-10", "REFYOUNG0000000001", "CAP-A-0000000000001", "10.00", "2026-10-05T12:13:29-07:00"));
  eq("one made under two minutes ago: PayPal asked to send it again (it may be the app's own), nothing noted", [young.status, w.notes.length], [503, 0]);
}

/* ---------- 3. Recorded: the money counts once, in full or in part (pure) ---------- */

const facts = (o = {}) => ({
  today: "2026-10-07", tenancy: { address: "1140 E. Juniper Hollow Ln", tenants: ["Maya Torres"], moveOutDate: "2026-10-06", statementDue: "2026-10-27", daysLeft: 20 },
  deposit: { invoiceId: "INV2-A", status: "PARTIALLY_REFUNDED", amount: 4800, paidAt: "2026-10-01T17:00:00Z", method: "PAYPAL", captureId: "CAP-A", daysSincePaid: 6, billedTo: "tenant@example.com", live: true },
  refundAgreement: { paypalEmail: "tenant@example.com", signedBy: ["Maya Torres"], signedAt: "2025-10-01T17:00:00Z" },
  deductions: [], totals: { depositHeld: 4800, deductions: 1010, refund: 3790, balanceClaimed: 0, documentsRequired: true },
  alreadyReturned: null, plan: { rail: "blocked", amount: 0, why: "" }, blockers: [], warnings: [], rules: {}, ...o,
});
const recorded = (amount, notKept = 0) => ({ outside: { amount, refunds: [{ id: "REFOUT000000000001", amount, at: "2026-10-05T19:13:29.000Z" }], notKept } });
{
  const part = closeout.refundPlan(facts(recorded(1000)), CA);
  eq("partial ($1,000 of $3,790 refunded in PayPal): the close-out sends the rest against the payment", [part.rail, part.amount, part.captureId], ["refund_original_payment", 2790, "CAP-A"]);
  check("partial: the plan says what went and what is left", part.why.startsWith("$1,000.00 was refunded in PayPal on Oct 5, 2026 and recorded as this deposit's refund, so $2,790.00 of the $3,790.00 owed is left to send."), part.why);
  eq("still owed", closeout.refundStillOwed(facts(recorded(1000))), 2790);
  const f = { ...facts(recorded(1000)), plan: part };
  eq("the guard: the whole $3,790 refused, the rest goes", [/less the \$1,000\.00 refunded in PayPal/.test(closeout.guardWithFacts(f, { rail: "refund_original_payment", amount: "3790.00", captureId: "CAP-A" }) ?? ""),
    closeout.guardWithFacts(f, { rail: "refund_original_payment", amount: "2790.00", captureId: "CAP-A" })], [true, null]);
  const full = closeout.refundPlan(facts(recorded(3790)), CA);
  eq("in full: nothing more goes back from here", [full.rail, full.amount], ["nothing_to_refund", 0]);
  check("in full: the reason names it and the statement still going out", /refunded in PayPal on Oct 5, 2026 and recorded as this deposit's refund, which covers the \$3,790\.00 refund owed\. Nothing more goes back from here\. The itemized statement still goes out\./.test(full.why), full.why);
  const over = closeout.refundPlan(facts(recorded(4800, 1010)), CA);
  check("more than owed: nothing more, and the deductions it covers are not kept", over.rail === "nothing_to_refund" && /\$1,010\.00 of the deductions is not kept/.test(over.why), over.why);
  eq("waiting for the landlord (a blocker): nothing goes", closeout.refundPlan(facts({ blockers: ["PayPal shows a $1,000.00 refund..."] }), CA).rail, "blocked");
  // A refund marked not this deposit still took money off the payment: only what is left can go back against it.
  const short = closeout.refundPlan(facts({ paymentLeft: 3300 }), CA);
  check("marked not this deposit, $1,500 gone from the payment: the $3,790 goes as a Payout to the designated account", short.rail === "payout" && short.amount === 3790 && /Only \$3,300\.00 of the original payment is left/.test(short.why), JSON.stringify(short));
  const noDesignation = closeout.refundPlan(facts({ paymentLeft: 3300, refundAgreement: null }), TX);
  check("the same where no account was designated (Texas): nothing goes, and it says why", noDesignation.rail === "blocked" && /Only \$3,300\.00 .* left to refund, less than the \$3,790\.00 owed, and the tenants named no PayPal account/.test(noDesignation.why), JSON.stringify(noDesignation));
  eq("enough left of the payment: the refund as before", closeout.refundPlan(facts({ paymentLeft: 4000 }), CA).rail, "refund_original_payment");
  const whole = closeout.refundPlan(facts({ ...recorded(1000), totals: { depositHeld: 4800, deductions: 0, refund: 4800, balanceClaimed: 0, documentsRequired: false } }), CA);
  check("nothing deducted after a refund in PayPal: the rest, and the note says the whole deposit is back, under 200 characters",
    whole.amount === 3800 && /rest of your security deposit, \$3,800\.00\. With the refund already sent, the whole deposit is back/.test(whole.noteToPayer ?? "") && (whole.noteToPayer ?? "").length < 200, JSON.stringify(whole));
}

const T = { id: "t-a", tenants: [{ name: "Maya Torres" }], monthly_rent: 2400, move_out_date: "2026-10-06", statement_delivered_at: null, statement_delivery: null, lease_terms: null, properties: { address: "1140 E. Juniper Hollow Ln, Orange, CA 92866", city: "Orange", state: "CA" } };
const deposit = { id: "dep", kind: "deposit_invoice", paypal_id: "INV2-A", amount: 4800, status: "PARTIALLY_REFUNDED", created_at: "2026-10-01T17:00:00.000Z", raw: txn("CAP-A") };
const outsideRow = (id, amount, at = "2026-10-05T19:13:29.000Z", s = "COMPLETED") => ({ id, kind: "outside_refund", paypal_id: id, amount, status: s, created_at: at, raw: { outside: { recorded_at: "2026-10-07T17:00:00.000Z", capture_id: "CAP-A" } } });
const ded = [{ id: "d1", category: "damage", room: "Bedroom", item: "Carpet", amount: 1010, is_estimate: false, created_at: "2026-10-06T18:00:00.000Z" }];
{
  const rows = ledger.ledgerRows(T, [deposit, outsideRow("REFOUT000000000001", 1000)], ded, { today: "2026-10-07" });
  const r = rows.find((x) => x.kind === "outside_refund");
  eq("ledger: the recorded refund is a Refund row, dated when PayPal made it, money out", [r?.type, r?.date, r?.signed, r?.effect, r?.paypalId, r?.status], ["Refund", "2026-10-05", -1000, "returned", "REFOUT000000000001", "completed"]);
  check("ledger: its detail says it was made in PayPal and recorded here", /made in PayPal and recorded here Oct 7, 2026/.test(r?.detail ?? "") && /^Made in PayPal/.test(r?.summary ?? ""), `${r?.detail} | ${r?.summary}`);
  eq("ledger: one row for it, exactly once", rows.filter((x) => x.kind === "outside_refund").length, 1);
  eq("ledger totals, partial: $1,000 returned, $3,800 still held (the deductions still a draft)", [ledger.ledgerTotals(rows).returned, ledger.ledgerTotals(rows).held], [1000, 3800]);
  eq("owed back, partial: the deposit less the deductions less the refund in PayPal", ledger.owedBack(rows), 2790);
  eq("Insights, partial: returned and held as the ledger counts them", [insights.moneyOf(rows).returned, insights.moneyOf(rows).held, insights.moneyOf(rows).kept], [1000, 3800, 0]);
  const both = ledger.ledgerRows(T, [deposit, outsideRow("REFOUT000000000001", 1000), { id: "own", kind: "refund", paypal_id: "REFOWN", amount: 2790, status: "COMPLETED", created_at: "2026-10-07T18:00:00.000Z", raw: {} }], ded, { today: "2026-10-07" });
  eq("then the close-out's own $2,790: $3,790 returned in all, nothing held, nothing owed", [ledger.ledgerTotals(both).returned, ledger.ledgerTotals(both).held, ledger.owedBack(both)], [3790, 0, 0]);
  eq("Insights, after: returned $3,790 and the $1,010 kept", [insights.moneyOf(both).returned, insights.moneyOf(both).kept], [3790, 1010]);
  const cover = ledger.ledgerRows(T, [deposit, outsideRow("REFOUT000000000001", 3790)], ded, { today: "2026-10-07" });
  eq("in full from PayPal: the deductions final, nothing held, nothing owed", [cover.find((x) => x.kind === "deduction").status, ledger.ledgerTotals(cover).held, ledger.owedBack(cover)], ["final", 0, 0]);
  const failed = ledger.ledgerRows(T, [deposit, outsideRow("REFOUT000000000001", 1000, undefined, "FAILED")], ded, { today: "2026-10-07" });
  eq("a recorded refund PayPal then failed moved nothing", [failed.find((x) => x.kind === "outside_refund").effect, ledger.ledgerTotals(failed).returned, ledger.owedBack(failed)], ["failed", 0, 3790]);
}
{
  const t = { id: "t-a", status: "moving_out", tenants: [{ name: "Maya Torres" }], monthly_rent: 2400, start_date: "2025-10-01", end_date: "2026-09-30", notice_given_on: "2026-09-01", planned_move_out: "2026-10-06",
    move_out_date: "2026-10-06", move_out_inspected_at: "2026-10-06T20:00:00Z", statement_delivered_at: null, statement_delivery: null,
    refund_agreement: { paypal_email: "tenant@example.com", signed_by: ["Maya Torres"], signed_at: "2025-10-01T17:00:00Z" }, lease_terms: null, notices: {}, tenant_move_out: null,
    properties: { address: "1140 E. Juniper Hollow Ln, Orange, CA 92866", city: "Orange", owner_name: "Elena Marquez", state: "CA" } };
  const sum = (payments) => units.summarizeTenancy(t, payments, [{ phase: "move_in" }, { phase: "move_out_before" }], [{ category: "damage", amount: 1010 }]);
  const part = sum([deposit, outsideRow("REFOUT000000000001", 1000)]);
  eq("summary, partial: the refund in PayPal on it, the rest still to refund, not covered", [part.outside, next.refundLeft(part), next.outsideCovers(part)], [1000, 2790, false]);
  const full = sum([deposit, outsideRow("REFOUT000000000001", 3790)]);
  eq("summary, in full: nothing left, it stands for the refund, the statement is next", [next.refundLeft(full), next.outsideCovers(full), next.nextStep(full, "2026-10-07").label, view.propertyStatus(full, next.nextStep(full, "2026-10-07")).label],
    [0, true, "Record the statement delivery", "Statement due"]);
  const delivered = { ...full, statementDeliveredAt: "2026-10-07T18:00:00Z" };
  eq("summary, in full and delivered: closed out", [next.closedOut(delivered), next.nextStep(delivered, "2026-10-07").label], [true, "Done"]);
  check("the Done step says how the money went back", /\$3,790\.00 refunded in PayPal and recorded as the deposit's refund/.test(next.nextStep(delivered, "2026-10-07").detail), next.nextStep(delivered, "2026-10-07").detail);
  const lock = (payments) => status.deductionsLock({ payments, disputes: [], refundOwed: 3790 });
  eq("deductions: open after a partial refund in PayPal, final once it covers what is owed", [lock([deposit, outsideRow("A", 1000)]), lock([deposit, outsideRow("A", 3790)])?.code], [null, "paypal_refund"]);
}

/* ---------- 3b. New York's day 14: a recorded refund made in PayPal is the day the rest of the deposit went (pure) ---------- */

// Dated from today in New York, as the summary counts its forfeiture: the move-out 21 days ago, the statement delivered
// on day 6, a $2,000 deposit with a $500 deduction, so $1,500 is owed back by day 14 (General Construction Law 25-a can
// run that to day 17 at most, so a refund on day 19 is late whatever day of the week day 14 is).
{
  const nyToday = dates.todayIn(NY.timeZone.id);
  const moveOut = dates.addDays(nyToday, -21);
  const day = (n) => dates.addDays(moveOut, n);
  const at = (n) => `${day(n)}T17:00:00.000Z`; // midday in New York, summer or winter
  const nyT = (extra = {}) => ({
    id: "t-ny", status: "moving_out", tenants: [{ name: "Jordan Lee" }], monthly_rent: 2000, start_date: "2025-10-01", end_date: moveOut,
    notice_given_on: dates.addDays(moveOut, -40), notice_given_by: "tenant", planned_move_out: moveOut, move_out_date: moveOut, move_out_inspected_at: at(0),
    statement_delivered_at: at(6), statement_delivery: { method: "email", date: day(6), email: "t@example.com", to: "Jordan Lee" },
    refund_agreement: { paypal_email: "t@example.com", signed_by: ["Jordan Lee"], signed_at: "2025-10-01T17:00:00Z" }, lease_terms: null, notices: {}, tenant_move_out: null,
    properties: { address: "88 Pine St, Apt 4, Brooklyn, NY 11201", city: "Brooklyn", owner_name: "Harbor View", state: "NY" }, ...extra,
  });
  const nyDeposit = { id: "dep-ny", kind: "deposit_invoice", paypal_id: "INV2-NY", amount: 2000, status: "PAID", created_at: `${dates.addDays(moveOut, -300)}T17:00:00.000Z`,
    raw: { transactions: [{ payment_id: "CAP-NY", method: "PAYPAL", payment_date: "2025-10-01", payment_date_time: "2025-10-01T14:00:00Z", amount: { value: "2000.00" } }] } };
  const own = (amount, n) => ({ id: `own-${n}`, kind: "refund", paypal_id: `REFNYOWN${n}`, amount, status: "COMPLETED", created_at: at(n), raw: {} });
  const rec = (amount, n) => ({ id: `rec-${n}`, kind: "outside_refund", paypal_id: `REFNYREC${n}`, amount, status: "COMPLETED", created_at: at(n), raw: { outside: { recorded_at: at(n) } } });
  const nyDed = [{ category: "damage", amount: 500 }];
  const photos = [{ phase: "move_in" }, { phase: "move_out_before" }];
  const sum = (payments, extra) => units.summarizeTenancy(nyT(extra), [nyDeposit, ...payments], photos, nyDed);
  const step = (s2) => next.nextStep(s2, nyToday);

  const ownOnTime = sum([own(1500, 5)]);
  eq("NY: the close-out's own $1,500 on day 5, statement day 6: on time, Done", [!!ownOnTime.forfeited, step(ownOnTime).label], [false, "Done"]);
  const recOnTime = sum([rec(1500, 5)]);
  eq("NY: the same $1,500 made in PayPal on day 5 and recorded: on time too, closed out, Done (never 'refund in full')",
    [!!recOnTime.forfeited, recOnTime.outsideReturnedOn, next.refundLeft(recOnTime), next.closedOut(recOnTime), step(recOnTime).label, step(recOnTime).level], [false, day(5), 0, true, "Done", "done"]);
  eq("NY: the day it covered what is owed", rc.outsideReturnedAt([nyDeposit, rec(1500, 5)], 1500), at(5));
  const ledgerT = { ...nyT(), id: "t-ny" };
  const lded = [{ id: "d-ny", category: "damage", room: "Bedroom", item: "Wall", amount: 500, is_estimate: false, created_at: at(1) }];
  const lrows = ledger.ledgerRows(ledgerT, [nyDeposit, rec(1500, 5)], lded, { today: nyToday });
  eq("NY ledger: the deduction kept, not forfeited; nothing held or owed", [lrows.find((r) => r.kind === "deduction").effect, ledger.ledgerTotals(lrows).held, ledger.owedBack(lrows)], ["claimed", 0, 0]);
  // The close-out's own day-14 rule, given the day the refunds made in PayPal covered what is owed (closeout.ts passes it).
  const nyFacts = facts({ tenancy: { address: "88 Pine St", tenants: ["Jordan Lee"], moveOutDate: moveOut, statementDue: day(14), daysLeft: -7 },
    deductions: [{ item: "Wall", room: "Bedroom", category: "damage", amount: 500, math: "", missingDocs: [] }], totals: { depositHeld: 2000, deductions: 500, refund: 1500, balanceClaimed: 0, documentsRequired: false } });
  const ctx = (returnedOn) => ({ today: nyToday, notices: {}, forwarding: null, endDate: moveOut, plannedMoveOut: moveOut, deductionsCount: 1, deliveredOn: day(6), disputeLive: false, returnedOn });
  eq("NY close-out: no day-14 blocker when the refunds made in PayPal covered it on day 5; one without that day", [NY.close.extraBlockers(nyFacts, ctx(day(5))).length, NY.close.extraBlockers(nyFacts, ctx(null)).length], [0, 1]);
  eq("NY statement standing: none with the day-5 refund in PayPal, forfeited with it on day 19",
    [NY.close.standing({ today: nyToday, notices: {}, claimed: 500, statementDue: day(14), deliveredOn: day(6), returnedOn: day(5), refundOwed: true }), !!NY.close.standing({ today: nyToday, notices: {}, claimed: 500, statementDue: day(14), deliveredOn: day(6), returnedOn: day(19), refundOwed: true })?.forfeits], [null, true]);

  // In two parts, the second after day 14: the rest of the deposit went on day 19, late.
  const recLate = sum([rec(1000, 5), rec(500, 19)]);
  eq("NY: $1,000 on day 5 and $500 on day 19, both made in PayPal: covered on day 19, so forfeited and $500 more owed",
    [rc.outsideReturnedAt([nyDeposit, rec(1000, 5), rec(500, 19)], 1500), !!recLate.forfeited, next.refundLeft(recLate), step(recLate).label], [at(19), true, 500, "Day 14 has passed: refund in full"]);
  check("NY: the late step names the rest, not all of it", /remove the deductions and refund the rest, \$500\.00\./.test(step(recLate).detail), step(recLate).detail);
  const recWhole = sum([rec(2000, 19)]);
  eq("NY: the whole $2,000 made in PayPal on day 19: forfeited, but all of it is back, so no step asks for more", [!!recWhole.forfeited, next.refundLeft(recWhole), step(recWhole).label], [true, 0, "Done"]);
  const recPart = sum([rec(1000, 5)]);
  eq("NY: only $1,000 made in PayPal by day 21: not covered, so day 14 passed without the rest", [rc.outsideReturnedAt([nyDeposit, rec(1000, 5)], 1500), !!recPart.forfeited, step(recPart).label], [null, true, "Day 14 has passed: refund in full"]);

  // The close-out's own refund on time and the statement late: the rest is owed, and a refund made in PayPal and
  // recorded for it closes the unit.
  const lateStatement = { statement_delivered_at: at(19), statement_delivery: { method: "email", date: day(19), email: "t@example.com", to: "Jordan Lee" } };
  const short = sum([own(1500, 5)], lateStatement);
  eq("NY: own refund on time, statement on day 19: $500 more owed", [!!short.forfeited, step(short).label], [true, "Day 14 has passed: $500.00 more owed"]);
  const paidRest = sum([own(1500, 5), rec(500, 20)], lateStatement);
  eq("NY: the $500 then made in PayPal and recorded: nothing more owed, Done", [next.forfeitShort(paidRest), next.closedOut(paidRest), step(paidRest).label], [0, true, "Done"]);
}

/* ---------- 4. The bell: what needs the landlord shows once, with PayPal's detail (pure) ---------- */

{
  const bell = await lib("bell");
  const base = { status: "active", tenants: [{ name: "Maya Torres" }], monthly_rent: 2400, start_date: "2025-10-01", end_date: "2026-12-31", notice_given_on: null, planned_move_out: null,
    move_out_date: null, move_out_inspected_at: null, statement_delivered_at: null, statement_delivery: null,
    refund_agreement: { paypal_email: "tenant@example.com", signed_by: ["Maya Torres"], signed_at: "2025-10-01T17:00:00Z" }, lease_terms: null, notices: {}, tenant_move_out: null };
  const unit = (id, address, payments, extra = {}) => {
    const summary = units.summarizeTenancy({ ...base, ...extra, id, properties: { address, city: "Orange", owner_name: "Elena Marquez", state: "CA" } }, payments, [{ phase: "move_in" }], []);
    return { summary, next: next.nextStep(summary, "2026-10-07") };
  };
  const reversedDeposit = { ...deposit, status: "PAID", raw: { ...txn("CAP-R"), reversal: { id: "REV-1", amount: 4800, at: "2026-10-06T18:00:00Z" } } };
  const rev = unit("t-rev", "9 Rev St, Orange, CA 92866", [reversedDeposit]);
  const out = unit("t-out", "1140 E. Juniper Hollow Ln, Orange, CA 92866", [deposit]);
  const done = unit("t-done", "482 N. Glassell St, Unit B, Orange, CA 92866", [reversedDeposit], { move_out_date: "2026-09-01", statement_delivered_at: "2026-09-10T18:00:00Z", statement_delivery: { date: "2026-09-10" } });
  const report = (tenancyId, kind, title, tone, amount) => ({ tenancyId, kind, title, tone, amount, at: "2026-10-06T18:00:00Z", sub: "x, Orange, CA 92866", href: `/tenancy/${tenancyId}?tab=payments` });
  const reports = [
    report("t-rev", "deposit_reversed", "Deposit payment reversed", "red", 4800),
    report("t-out", "paypal_refund_unrecorded", "Refund made in PayPal", "amber", 1000),
    report("t-out", "deposit_paid", "Deposit of $4,800.00 paid", "green", 4800),
    report("t-done", "deposit_reversed", "Deposit payment reversed", "red", 2800),
  ];
  const b = bell.paypalBell({ units: [rev, out, done], reports, outside: [{ tenancyId: "t-out", address: "1140 E. Juniper Hollow Ln, Orange, CA 92866", refunds: [{ amount: "1000.00", refunded_at: "2026-10-05T19:13:29Z" }] }] });
  eq("bell: the reversed deposit once, under Needs you, with PayPal's amount and day; the refund made in PayPal once, with its amount and day",
    b.needsYou.map((l) => [l.title, l.sub, l.tone]), [["Deposit payment reversed", "9 Rev St, $4,800.00 reversed by PayPal Oct 6, 2026", "red"], ["Refund made in PayPal", "1140 E. Juniper Hollow Ln, $1,000.00 on Oct 5, 2026", "amber"]]);
  eq("bell: From PayPal keeps the rest, never the two lines above (a unit closed out keeps its reversal there)", b.fromPayPal.map((l) => l.title), ["Deposit of $4,800.00 paid", "Deposit payment reversed"]);
  eq("bell: the reversed unit's own step isn't a second line", [rev.next.label, b.coveredStep(rev), b.coveredStep(out)], ["Deposit payment reversed", true, false]);
  const decided = bell.paypalBell({ units: [out], reports: reports.map((r) => (r.kind === "paypal_refund_unrecorded" ? { ...r, handled: true } : r)), outside: [] });
  eq("bell: once the refund made in PayPal is decided, nothing under Needs you and nothing under From PayPal (Activity has the decision)",
    [decided.needsYou.length, decided.fromPayPal.map((l) => l.title).includes("Refund made in PayPal"), decided.fromPayPal.length], [0, false, 3]);
  const noNote = bell.paypalBell({ units: [out], reports, outside: [] });
  eq("bell: a report with no note to decide (no refund id, or older code) stays under From PayPal, by the same name", noNote.fromPayPal.map((l) => l.title).includes("Refund made in PayPal"), true);
  eq("bell: a reversal with no report this week still shows, with the deposit's amount", bell.paypalBell({ units: [rev], reports: [], outside: [] }).needsYou.map((l) => l.sub), ["9 Rev St, $4,800.00 reversed by PayPal"]);
}

/* ---------- 5. Against the database (--db) ---------- */

if (DB) await dbChecks();
eq("PayPal: no write ever reached the stub, and nothing reached PayPal", paypalWrites, []);

console.log(`reconcile-check: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}

async function dbChecks() {
  const [{ db }, outside, store, statement, statementPdf, tenantView, disputes, bell] = await Promise.all(["db", "outside-refunds", "paypal-webhook-store", "statement", "statement-pdf", "tenant-view", "disputes", "bell"].map(lib));
  const tag = `gfrec-${Date.now().toString(36)}`;
  const ids = { ws: [], props: [], ten: [], events: [], pool: [] };
  const must = (what, r) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const cap = (k) => `CAP${tag.replace(/[^a-z0-9]/gi, "").toUpperCase()}${k}`.slice(0, 30);
  const inv = (k) => `INV2-${tag}-${k}`;
  const ref = (k) => `REF${tag.replace(/[^a-z0-9]/gi, "").toUpperCase()}${k}`.slice(0, 30);
  try {
    // Four throwaway demo workspaces: A (the landlord's), B (another visitor's), C and D (two copies that both show one
    // payment, as copies of a template do).
    const wss = must("workspaces", await db.from("workspaces").insert(["A", "B", "C", "D"].map((k) => ({ kind: "demo", label: `${tag} ${k}` }))).select("id"));
    ids.ws.push(...wss.map((w) => w.id));
    const [wa, wb, wc, wd] = wss.map((w) => w.id);
    const props = must("properties", await db.from("properties").insert([wa, wa, wb, wc, wd].map((w, i) => ({ address: `${100 + i} Check St, Orange, CA 92866`, city: "Orange", owner_name: "Check Landlord", state: "CA", workspace_id: w }))).select("id"));
    ids.props.push(...props.map((p) => p.id));
    const tenancy = (p, w) => ({
      property_id: p, workspace_id: w, status: "moving_out", tenants: [{ name: "Check Tenant", email: "tenant@example.com" }], monthly_rent: 2400, deposit_amount: 4800,
      start_date: "2025-10-01", end_date: "2026-09-30", move_out_date: yesterday, move_out_inspected_at: new Date().toISOString(),
      refund_agreement: { method: "paypal", paypal_email: "tenant@example.com", signed_by: ["Check Tenant"], signed_at: "2025-10-01T17:00:00Z" },
    });
    const tens = must("tenancies", await db.from("tenancies").insert([tenancy(props[0].id, wa), tenancy(props[1].id, wa), tenancy(props[2].id, wb), tenancy(props[3].id, wc), tenancy(props[4].id, wd)]).select("id"));
    ids.ten.push(...tens.map((t) => t.id));
    const [tA, tA2, tB, tC, tD] = tens.map((t) => t.id);
    const depositRow = (t, invoice, capture) => ({ tenancy_id: t, kind: "deposit_invoice", paypal_id: invoice, amount: 4800, status: "PAID", raw: { payLink: "x", transactions: [{ payment_id: capture, method: "PAYPAL", payment_date: "2026-10-01", payment_date_time: "2026-10-01T10:00:00Z", amount: { value: "4800.00" } }] } });
    must("payments", await db.from("payments").insert([
      depositRow(tA, inv("A"), cap("A")), depositRow(tA2, inv("A2"), cap("A2")), depositRow(tB, inv("B"), cap("B")),
      depositRow(tC, inv("S"), cap("S")), depositRow(tD, inv("S"), cap("S")),
    ]));
    // One $100 cleaning deduction on A (an estimate: no after-repair photo needed), so the refund owed is $4,700.
    must("deduction", await db.from("deductions").insert({ tenancy_id: tA, category: "cleaning", room: "Kitchen", item: "Range", work: "clean", performer: "own_labor", billed: 0, hours: 2, hourly_rate: 50, labor_description: "Cleaned the range", amount: 100, math: "2 hours at $50.00 an hour", is_estimate: true }));
    // A2's deposit is a (throwaway) pre-paid pool deposit its workspace holds: a refund made outside the app marks it used.
    const poolRow = must("pool", await db.from("demo_deposit_pool").insert({ invoice_id: inv("A2"), capture_id: cap("A2"), amount: 4800, payer_email: "tenant@example.com", paid_at: "2026-10-01T10:00:00Z", raw: { id: inv("A2") }, claimed_by: wa, claimed_at: new Date().toISOString() }).select("id").single());
    ids.pool.push(poolRow.id);

    const R1 = ref("R1"), R2 = ref("R2"), R3 = ref("R3"), R5 = ref("R5"), R6 = ref("R6");
    fakeInvoices.set(inv("A"), invoiceWith(inv("A"), cap("A"), [listed(R1, "1000.00", "2026-10-05")]));
    fakeInvoices.set(inv("A2"), invoiceWith(inv("A2"), cap("A2"), [listed(R3, "500.00", "2026-10-05")]));
    fakeInvoices.set(inv("B"), invoiceWith(inv("B"), cap("B"), []));
    fakeInvoices.set(inv("S"), invoiceWith(inv("S"), cap("S"), [listed(R5, "200.00", "2026-10-05")]));
    const notesOf = async (t) => must("notes", await db.from("paypal_outside_refunds").select("refund_id, status, amount, seen_via, refunded_at, workspace_id, payment_id").eq("tenancy_id", t).order("created_at"));
    const auditsOf = async (t, action) => must("audit", await db.from("audit_log").select("actor, detail").eq("tenancy_id", t).eq("action", action));
    const outsidePays = async (t) => must("pays", await db.from("payments").select("paypal_id, amount, status, created_at, raw").eq("tenancy_id", t).eq("kind", "outside_refund"));

    // 1. The live check sees R1 first: noted, announced once, the close-out held.
    const f1 = await closeout.closeOutFacts(tA);
    eq("db: the live check notes the refund made in PayPal, and the close-out waits for the landlord",
      [(await notesOf(tA)).map((n) => [n.refund_id, n.status, Number(n.amount), n.seen_via, n.workspace_id]), f1.outsideOpen?.map((r) => r.id), f1.plan.rail, f1.blockers.some((b) => b.includes(R1) && /Record it as this deposit's refund, or mark it not this deposit/.test(b))],
      [[[R1, "open", 1000, ["check"], wa]], [R1], "blocked", true]);
    await closeout.closeOutFacts(tA);
    eq("db: read again: still one note, announced once", [(await notesOf(tA)).length, (await auditsOf(tA, "paypal_refund_unrecorded")).length], [1, 1]);
    // 2. Then PayPal's webhook reports the same refund.
    const deps = { store: store.webhookStore, log: quiet, verify: async () => "SUCCESS", fetchInvoice: async (id) => fakeInvoices.get(id) };
    const e1 = refundEvent(`WH-${tag}-1`, R1, cap("A"));
    ids.events.push(e1.id);
    const w1 = await wh.handlePayPalWebhook(JSON.stringify(e1), GOOD, deps);
    const n1 = (await notesOf(tA))[0];
    eq("db: the webhook after the live check: the same note, both paths on it, the webhook's time, no second announcement",
      [w1.body.outcome, (await notesOf(tA)).length, n1.seen_via, new Date(n1.refunded_at).toISOString(), (await auditsOf(tA, "paypal_refund_unrecorded")).length], ["applied", 1, ["check", "webhook"], "2026-10-05T19:13:29.000Z", 1]);
    const alertsA = await store.paypalAlerts(wa);
    eq("db: the bell's From PayPal has no second line for it (the live check's announcement is the one), and Needs you lists it once",
      [alertsA.filter((a) => a.kind === "paypal_refund_unrecorded").length, (await outside.openOutsideRefunds(wa)).map((o) => [o.tenancyId, o.refunds.map((r) => r.refund_id)])], [0, [[tA, [R1]]]]);

    // 3. The second workspace sees none of it, and can't decide it.
    eq("db: the other workspace's bell, list and tenancy: nothing", [(await outside.openOutsideRefunds(wb)).length, (await store.paypalAlerts(wb)).length, (await notesOf(tB)).length], [0, 0, 0]);
    const cross = await outside.decideOutsideRefund({ tenancyId: tB, workspaceId: wb, refundId: R1, decision: "record" });
    const crossRpc = must("rpc", await db.rpc("decide_outside_refund", { p_tenancy: tB, p_refund: R1, p_decision: "record" }));
    eq("db: recording A's refund on B's tenancy: no such refund there, nothing recorded", [cross.ok, cross.status, crossRpc.reason, (await outsidePays(tB)).length, (await outsidePays(tA)).length], [false, 404, "missing", 0, 0]);
    await closeout.closeOutFacts(tB);
    eq("db: B's own close-out reads PayPal and notes nothing", (await notesOf(tB)).length, 0);

    // 4. Recorded: once, with the payments row and the audit entry in the same step.
    const rec1 = await outside.decideOutsideRefund({ tenancyId: tA, workspaceId: wa, refundId: R1, decision: "record" });
    const again = await outside.decideOutsideRefund({ tenancyId: tA, workspaceId: wa, refundId: R1, decision: "record" });
    const dismissAfter = await outside.decideOutsideRefund({ tenancyId: tA, workspaceId: wa, refundId: R1, decision: "dismiss" });
    const p1 = await outsidePays(tA);
    eq("db: recorded once (a second click and a dismiss afterwards refused), dated when PayPal made it",
      [rec1.ok, again.status, dismissAfter.status, p1.map((p) => [p.paypal_id, Number(p.amount), p.status, new Date(p.created_at).toISOString()]), (await notesOf(tA))[0].status],
      [true, 409, 409, [[R1, 1000, "COMPLETED", "2026-10-05T19:13:29.000Z"]], "recorded"]);
    eq("db: the activity says who recorded it", (await auditsOf(tA, "outside_refund_recorded")).map((a) => [a.actor, a.detail.refund_id, Number(a.detail.amount)]), [["landlord", R1, 1000]]);

    // 5. Partial: the close-out continues with what is still owed.
    const f2 = await closeout.closeOutFacts(tA);
    eq("db: partial: the close-out continues for the rest, against the payment", [f2.outsideOpen, f2.outside?.amount, f2.plan.rail, f2.plan.amount, f2.blockers], [undefined, 1000, "refund_original_payment", 3700, []]);
    eq("db: partial: the guard refuses the whole $4,700 and takes the rest", [!!closeout.guardWithFacts(f2, { rail: "refund_original_payment", amount: "4700.00", captureId: cap("A") }), closeout.guardWithFacts(f2, { rail: "refund_original_payment", amount: "3700.00", captureId: cap("A") })], [true, null]);
    const s2 = await statement.buildStatement(tA);
    eq("db: partial: the statement's refund is the rest still due, with the refund in PayPal on its own line", [s2.refund.state, s2.refund.amount, s2.outside?.amount, s2.outside?.asRefund], ["due", 3700, 1000, false]);
    drawn.length = 0;
    await statementPdf.buildStatementPdf(s2);
    check("db: partial: the PDF lists the refund in PayPal, then what is left", drawn.includes("Refunded in PayPal") && drawn.includes("-$1,000.00") && drawn.includes("Left to refund") && drawn.some((t) => t.includes(`Refunded in PayPal: $1,000.00 (PayPal id ${R1})`)), drawn.filter((t) => /Refund|refund/.test(t)).join(" | "));
    const v2 = await tenantView.loadTenantView(tA);
    eq("db: partial: the tenants' page shows the refund in PayPal, not as the whole refund", [v2.outside?.amount, v2.returned], [1000, null]);

    // 6. A second refund made in PayPal covers the rest: recorded, it is the deposit's refund.
    fakeInvoices.set(inv("A"), invoiceWith(inv("A"), cap("A"), [listed(R1, "1000.00", "2026-10-05"), listed(R2, "3700.00", "2026-10-06")]));
    const f3a = await closeout.closeOutFacts(tA);
    eq("db: the second one noted and waiting", [f3a.outsideOpen?.map((r) => r.id), f3a.plan.rail], [[R2], "blocked"]);
    eq("db: recorded", (await outside.decideOutsideRefund({ tenancyId: tA, workspaceId: wa, refundId: R2, decision: "record" })).ok, true);
    const f3 = await closeout.closeOutFacts(tA);
    eq("db: in full: nothing more goes back from here", [f3.plan.rail, f3.plan.amount, f3.outside?.amount, f3.blockers], ["nothing_to_refund", 0, 4700, []]);
    must("deliver", await db.from("tenancies").update({ statement_delivered_at: new Date().toISOString(), statement_delivery: { method: "email", date: today, email: "tenant@example.com", to: "Check Tenant" } }).eq("id", tA).select("id"));
    const s3 = await statement.buildStatement(tA);
    eq("db: in full: the statement's refund is the refunds made in PayPal, sent", [s3.refund.state, s3.refund.amount, s3.refund.paypalId, s3.outside?.asRefund, s3.refund.method], ["sent", 4700, `${R1}, ${R2}`, true, "PayPal refunds of the original deposit payment, made in PayPal"]);
    drawn.length = 0;
    await statementPdf.buildStatementPdf(s3);
    check("db: in full: the PDF's refund line", drawn.includes("Refunded") && drawn.includes("$4,700.00") && !drawn.includes("Refunded in PayPal"), drawn.filter((t) => /Refund|refund|4,700/.test(t)).join(" | "));
    const v3 = await tenantView.loadTenantView(tA);
    eq("db: in full: the tenants' page shows it as their refund", [v3.returned?.amount, v3.returned?.kind, v3.outside, v3.statement?.refund], [4700, "refund", undefined, 4700]);
    const unit = await units.loadUnit(tA);
    eq("db: in full and delivered: the unit is closed out", [unit.outside, next.closedOut(unit), next.nextStep(unit, today).label], [4700, true, "Done"]);
    const locked = await disputes.deductionsLocked(tA);
    eq("db: in full: the deductions are final", locked?.status, 409);
    const { data: pays } = await db.from("payments").select("id, kind, paypal_id, amount, status, created_at, raw").eq("tenancy_id", tA).order("created_at");
    const { data: drows } = await db.from("deductions").select("id, category, room, item, amount, is_estimate, created_at").eq("tenancy_id", tA);
    const { data: trow } = await db.from("tenancies").select("id, tenants, monthly_rent, move_out_date, statement_delivered_at, statement_delivery, lease_terms, properties(address, city, state)").eq("id", tA).single();
    const lrows = ledger.ledgerRows(trow, pays, drows);
    eq("db: the ledger: two Refund rows made in PayPal, $4,700 returned, nothing held or owed",
      [lrows.filter((r) => r.kind === "outside_refund").map((r) => r.amount), ledger.ledgerTotals(lrows).returned, ledger.ledgerTotals(lrows).held, ledger.owedBack(lrows), insights.moneyOf(lrows).returned], [[1000, 3700], 4700, 0, 0, 4700]);

    // 7. Marked not this deposit: counted nowhere, but the payment has that much less left.
    const f4a = await closeout.closeOutFacts(tA2);
    eq("db: another tenancy's refund noted", f4a.outsideOpen?.map((r) => r.id), [R3]);
    const pool1 = must("pool row", await db.from("demo_deposit_pool").select("refunded_outside_at").eq("id", poolRow.id).single());
    check("db: its pool deposit is marked refunded outside the app, for good", !!pool1.refunded_outside_at);
    eq("db: and never goes back to the pool", must("release", await db.rpc("release_demo_deposit", { p_ws: wa })), 0);
    eq("db: dismissed", (await outside.decideOutsideRefund({ tenancyId: tA2, workspaceId: wa, refundId: R3, decision: "dismiss" })).ok, true);
    const f4 = await closeout.closeOutFacts(tA2);
    eq("db: dismissed: no payment row, no blocker, nothing taken off what is owed; only what is left of the payment can go back against it",
      [(await outsidePays(tA2)).length, f4.blockers, f4.outside, f4.paymentLeft, f4.plan.rail, f4.plan.amount], [0, [], undefined, 4300, "payout", 4800]);
    eq("db: dismissed: the activity says so", (await auditsOf(tA2, "outside_refund_dismissed")).map((a) => [a.actor, a.detail.refund_id]), [["landlord", R3]]);

    // 8. Two decisions at once: one wins.
    must("note R6", await db.rpc("note_outside_refund", { p_tenancy: tA2, p_refund: R6, p_capture: cap("A2"), p_amount: 50, p_status: "COMPLETED", p_refunded_at: "2026-10-06T19:00:00Z", p_via: "check", p_event: null }));
    const both = await Promise.all([1, 2, 3].map(() => db.rpc("decide_outside_refund", { p_tenancy: tA2, p_refund: R6, p_decision: "record" })));
    eq("db: three records at once: one recorded, the others refused as decided, one payment row", [both.filter((r) => r.data?.ok).length, both.filter((r) => r.data?.reason === "decided").length, (await outsidePays(tA2)).length], [1, 2, 1]);

    // 9. A capture that isn't the tenancy's own: two copies show one payment.
    const fc = await closeout.closeOutFacts(tC);
    eq("db: a payment two copies show: nothing noted on either, and the close-out still won't send",
      [(await notesOf(tC)).length, (await notesOf(tD)).length, fc.plan.rail], [0, 0, "blocked"]);
    const e5 = refundEvent(`WH-${tag}-5`, R5, cap("S"), "200.00");
    ids.events.push(e5.id);
    eq("db: its webhook matches neither", [(await wh.handlePayPalWebhook(JSON.stringify(e5), GOOD, deps)).body.outcome, (await notesOf(tC)).length, (await notesOf(tD)).length], ["unmatched", 0, 0]);
    const notOwned = await outside.decideOutsideRefund({ tenancyId: tC, workspaceId: wc, refundId: R5, decision: "record" });
    eq("db: and nothing to decide there", [notOwned.ok, notOwned.status], [false, 404]);

    // 10. A refund from here may be on its way (the close-out's run is running): a refund PayPal lists but the records
    //     don't hold yet isn't noted, and the close-out stays held by PayPal's total until the next read.
    const R7 = ref("R7");
    fakeInvoices.set(inv("B"), invoiceWith(inv("B"), cap("B"), [listed(R7, "4800.00", "2026-10-06")]));
    const run = must("run", await db.from("agent_runs").insert({ tenancy_id: tB, kind: "close_out", status: "running" }).select("id").single());
    const fb = await closeout.closeOutFacts(tB);
    eq("db: a close-out still running: nothing noted yet, and the close-out held by PayPal's total meanwhile",
      [(await notesOf(tB)).length, fb.outsideOpen, fb.blockers.some((b) => /PayPal shows \$4,800\.00 already refunded on the deposit payment, and this app has no record of it/.test(b))], [0, undefined, true]);
    must("run done", await db.from("agent_runs").update({ status: "failed", error: "check" }).eq("id", run.id).select("id"));
    const fb2 = await closeout.closeOutFacts(tB);
    eq("db: once it stopped (and nothing was recorded): noted for the landlord's decision", [(await notesOf(tB)).map((n) => n.refund_id), fb2.outsideOpen?.map((r) => r.id)], [[R7], [R7]]);

    // 11. PayPal's webhook reports a refund first (its announcement goes to the bell's From PayPal while it is open, and
    //     shows under Needs you instead); once the landlord decides it, the report is handled and shows nowhere.
    const R8 = ref("R8");
    const e8 = refundEvent(`WH-${tag}-8`, R8, cap("A2"), "25.00");
    ids.events.push(e8.id);
    eq("db: a refund the webhook sees first: noted and announced by PayPal", [(await wh.handlePayPalWebhook(JSON.stringify(e8), GOOD, deps)).body.outcome, (await notesOf(tA2)).find((n) => n.refund_id === R8)?.seen_via], ["applied", ["webhook"]]);
    const bellNow = async () => {
      const reports = await store.paypalAlerts(wa);
      return [reports.filter((r) => r.refundId === R8).map((r) => [r.title, !!r.handled]), bell.paypalBell({ units: [], reports, outside: await outside.openOutsideRefunds(wa) })];
    };
    const [open8, bell8] = await bellNow();
    eq("db: while it waits: PayPal's report named 'Refund made in PayPal', not handled; Needs you lists it, From PayPal doesn't",
      [open8, bell8.needsYou.filter((l) => l.title === "Refund made in PayPal").length, bell8.fromPayPal.filter((l) => l.title === "Refund made in PayPal").length], [[["Refund made in PayPal", false]], 1, 0]);
    eq("db: marked not this deposit", (await outside.decideOutsideRefund({ tenancyId: tA2, workspaceId: wa, refundId: R8, decision: "dismiss" })).ok, true);
    const [done8, bellDone] = await bellNow();
    eq("db: decided: the report is handled, and neither Needs you nor From PayPal shows it", [done8, bellDone.needsYou.length, bellDone.fromPayPal.filter((l) => l.title === "Refund made in PayPal").length], [[["Refund made in PayPal", true]], 0, 0]);
    eq("db: the other workspace's bell still has none of it", (await store.paypalAlerts(wb)).filter((r) => r.refundId === R8).length, 0);

    // 12. New York: $1,500 refunded in PayPal on day 5 and recorded, the statement delivered on day 6, today day 21.
    //     Every reader takes day 5 as the day the rest of the deposit went: nothing is forfeited.
    const nyToday = dates.todayIn(NY.timeZone.id);
    const nyDay = (n) => dates.addDays(dates.addDays(nyToday, -21), n);
    const nyAt = (n) => `${nyDay(n)}T17:00:00.000Z`;
    const nyProp = must("NY property", await db.from("properties").insert({ address: "88 Check St, Apt 4, Brooklyn, NY 11201", city: "Brooklyn", owner_name: "Check Landlord", state: "NY", workspace_id: wa }).select("id").single());
    ids.props.push(nyProp.id);
    const tNY = must("NY tenancy", await db.from("tenancies").insert({
      ...tenancy(nyProp.id, wa), monthly_rent: 2000, deposit_amount: 2000, move_out_date: nyDay(0), planned_move_out: nyDay(0), move_out_inspected_at: nyAt(0),
      statement_delivered_at: nyAt(6), statement_delivery: { method: "email", date: nyDay(6), email: "tenant@example.com", to: "Check Tenant" },
    }).select("id").single()).id;
    ids.ten.push(tNY);
    must("NY deposit", await db.from("payments").insert({ ...depositRow(tNY, inv("NY"), cap("NY")), amount: 2000,
      raw: { payLink: "x", transactions: [{ payment_id: cap("NY"), method: "PAYPAL", payment_date: "2026-10-01", payment_date_time: "2026-10-01T10:00:00Z", amount: { value: "2000.00" } }] } }));
    must("NY deduction", await db.from("deductions").insert({ tenancy_id: tNY, category: "cleaning", room: "Kitchen", item: "Range", work: "clean", performer: "own_labor", billed: 0, hours: 10, hourly_rate: 50, labor_description: "Cleaned the range", amount: 500, math: "10 hours at $50.00 an hour", is_estimate: true }));
    const RNY = ref("NY");
    fakeInvoices.set(inv("NY"), invoiceWith(inv("NY"), cap("NY"), [listed(RNY, "1500.00", nyDay(5))], "2000.00"));
    must("NY note", await db.rpc("note_outside_refund", { p_tenancy: tNY, p_refund: RNY, p_capture: cap("NY"), p_amount: 1500, p_status: "COMPLETED", p_refunded_at: nyAt(5), p_via: "check", p_event: null }));
    eq("db NY: recorded", (await outside.decideOutsideRefund({ tenancyId: tNY, workspaceId: wa, refundId: RNY, decision: "record" })).ok, true);
    const fNY = await closeout.closeOutFacts(tNY);
    eq("db NY: the close-out: no forfeiture, no day-14 blocker, nothing more to send", [fNY.standing ?? null, fNY.blockers.filter((x) => /Day 14/.test(x)).length, fNY.plan.rail, fNY.outside?.amount], [null, 0, "nothing_to_refund", 1500]);
    const sNY = await statement.buildStatement(tNY);
    eq("db NY: the statement: no forfeiture, the refund made in PayPal is the refund", [sNY.standing ?? null, sNY.refund.state, sNY.refund.amount], [null, "sent", 1500]);
    const vNY = await tenantView.loadTenantView(tNY);
    eq("db NY: the tenants' page: no forfeiture, refunded $1,500 as PayPal lists it", [vNY.statement?.standing ?? null, vNY.statement?.refund, vNY.returned?.amount, vNY.returned?.status], [null, 1500, 1500, "COMPLETED"]);
    const uNY = await units.loadUnit(tNY);
    eq("db NY: the unit: not forfeited, closed out, Done", [!!uNY.forfeited, next.closedOut(uNY), next.nextStep(uNY, nyToday).label], [false, true, "Done"]);
    const dNY = await disputes.disputeFacts(tNY);
    eq("db NY: a dispute's lawful ranges: the refund's day is day 5, nothing forfeited", [dNY.rangeInput.refundedOn, dNY.ranges.late.forfeits], [nyDay(5), false]);
  } finally {
    // Every throwaway row: the webhook events by id, the pool row, then the tenancies (their payments, notes, activity
    // and deductions go with them), the properties and the workspaces.
    const errs = [];
    const del = async (what, q) => { const { error } = await q; if (error) errs.push(`${what}: ${error.message}`); };
    if (ids.events.length) await del("events", db.from("paypal_webhook_events").delete().in("id", ids.events));
    if (ids.ten.length) await del("tenancies", db.from("tenancies").delete().in("id", ids.ten));
    if (ids.pool.length) await del("pool", db.from("demo_deposit_pool").delete().in("id", ids.pool));
    if (ids.props.length) await del("properties", db.from("properties").delete().in("id", ids.props));
    if (ids.ws.length) await del("workspaces", db.from("workspaces").delete().in("id", ids.ws).eq("kind", "demo"));
    const { count: left, error: le } = await db.from("paypal_outside_refunds").select("id", { count: "exact", head: true }).in("tenancy_id", ids.ten.length ? ids.ten : ["00000000-0000-0000-0000-000000000000"]);
    const { count: leftWs } = ids.ws.length ? await db.from("workspaces").select("id", { count: "exact", head: true }).in("id", ids.ws) : { count: 0 };
    check("db: throwaway rows removed", !errs.length && !le && !left && !leftWs, [...errs, le?.message, left ? `${left} notes left` : "", leftWs ? `${leftWs} workspaces left` : ""].filter(Boolean).join("; "));
  }
}
