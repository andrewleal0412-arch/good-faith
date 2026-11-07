#!/usr/bin/env node
// Checks for the judges'-path test's stubs (src/lib/e2e-switch.ts, e2e-stubs.ts, e2e-paypal.ts, e2e-toolkit.ts,
// model.ts), with no database, no PayPal and no Claude:
//   - the switch: on only for GOOD_FAITH_E2E_STUBS=1, off on Render (any of Render's own variables) and with live
//     PayPal, whatever else is set; render.yaml never names it, and .env.example only as a comment;
//   - off, every Claude job is Claude; on, every job is its stub, and the jobs off the demo's path refuse;
//   - the close-out refund's idempotency key (agent.ts closeOutRefundKey): its retry count asks the audit log for the
//     refund's own refusals and leaves a Payout's out, read from the count queries it sends to a database stand-in;
//   - the stubs' answers through the app's own code: the lease check (the demo lease only), the close-out agent's steps
//     (the plan's own capture and amount, the approval, a decline), the advocate's case and the two negotiators'
//     turns on the demo's three charges (no adjustment by the code, agreed at $270 back);
//   - the PayPal client itself (src/lib/paypal.ts), with a scripted PayPal in fetch's place and the stubs off: cold
//     requests at once share one sign-in, a 401 drops the cached token and the call goes once more with a fresh one
//     and the same PayPal-Request-Id (once only, and never for another status), a failed sign-in is tried again by
//     the next call, every REST call carries a timeout, writes included, and a caller's own timeout stops the wait;
//   - the fake PayPal: no request leaves the process (fetch, http and https are trapped), a refund of any capture
//     that isn't the test's own is refused, through the REST path and through the Agent Toolkit's MCP server, and
//     the webhook check and dispute evidence never reach PayPal;
//   - PayPal's record (src/lib/paypal-record.ts): the picks over PayPal's answers keep the fields the screens list and
//     drop every email, name and address, and the reads behind them go to the fake;
//   - live PayPal is refused where the money comes in: the deposit invoice route, loaded with PAYPAL_ENVIRONMENT=LIVE,
//     answers 409 before it reads the session or the database, as the close-out, the settlement and the dispute
//     response refuse it, and in the sandbox it goes past that gate.
//   - the three tenant-link routes that build per request (the statement packet, a move-in photo and a dispute photo
//     at full size) refuse a flood from one address before any read, don't count the page's thumbs, and still serve
//     another address after it.
// Exit 1 if any fails.
//
//   node scripts/e2e-stubs-check.mjs

import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Nothing may leave the process: every outgoing request is counted and refused.
const leaks = [];
const trap = (name) => (...args) => { leaks.push(`${name} ${String(args[0]?.href ?? args[0]?.hostname ?? args[0]).slice(0, 80)}`); throw new Error(`e2e-stubs-check: ${name} is not allowed here`); };
globalThis.fetch = async (url) => { leaks.push(`fetch ${String(url).slice(0, 80)}`); throw new Error("e2e-stubs-check: fetch is not allowed here"); };
http.request = trap("http.request"); http.get = trap("http.get");
https.request = trap("https.request"); https.get = trap("https.get");

for (const k of Object.keys(process.env)) if (k.startsWith("RENDER") || k === "GOOD_FAITH_E2E_STUBS") delete process.env[k];
process.env.PAYPAL_ENVIRONMENT = "SANDBOX";
process.env.PAYPAL_CLIENT_ID = "check-client";
process.env.PAYPAL_CLIENT_SECRET = "check-secret";
process.env.SUPABASE_URL = "http://127.0.0.1:9";
process.env.SUPABASE_SECRET_KEY = "check-key";
process.env.ANTHROPIC_API_KEY = "check-not-a-key";

// The stubs' own loud lines, counted rather than printed.
const stubLines = [];
const realWarn = console.warn;
console.warn = (...a) => { if (String(a[0]).startsWith("[E2E STUBS ON]")) stubLines.push(String(a[0])); else realWarn(...a); };

const jiti = createJiti(import.meta.url, { alias: { "@": join(ROOT, "src"), "server-only": join(ROOT, "node_modules/server-only/empty.js") } });
const lib = (n) => jiti.import(join(ROOT, "src/lib", `${n}.ts`));
const [sw, model, stubs, fake, paypal, agent, extract, advocate, nego, range, states, leaseKeyLib, record] = await Promise.all(
  ["e2e-switch", "model", "e2e-stubs", "e2e-paypal", "paypal", "agent", "extract", "advocate", "negotiator", "lawful-range", "states/server", "lease-key", "paypal-record"].map(lib));
const CA = states.packFor("CA");

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) pass++;
  else { fail++; failures.push(`${name}${detail ? `: ${detail}` : ""}`); }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const stubsOn = (on) => { if (on) process.env.GOOD_FAITH_E2E_STUBS = "1"; else delete process.env.GOOD_FAITH_E2E_STUBS; };

/* ---------- 1. The switch ---------- */
{
  const on = (env) => sw.e2eStubs(env);
  eq("switch: off by default, on only for exactly \"1\"", [on({}), on({ GOOD_FAITH_E2E_STUBS: "1" }), on({ GOOD_FAITH_E2E_STUBS: "true" }), on({ GOOD_FAITH_E2E_STUBS: "yes" }), on({ GOOD_FAITH_E2E_STUBS: " 1" })],
    [false, true, false, false, false]);
  for (const k of sw.RENDER_MARKERS) check(`switch: off on Render (${k} set)`, !on({ GOOD_FAITH_E2E_STUBS: "1", [k]: "true" }));
  check("switch: off with live PayPal", !on({ GOOD_FAITH_E2E_STUBS: "1", PAYPAL_ENVIRONMENT: "LIVE" }));
  check("switch: on Render it says why it is ignored", /ignored/.test(sw.e2eStubsRefused({ GOOD_FAITH_E2E_STUBS: "1", RENDER: "true" }) ?? ""));
  eq("switch: nothing to say when it isn't asked for, or is on", [sw.e2eStubsRefused({}), sw.e2eStubsRefused({ GOOD_FAITH_E2E_STUBS: "1" })], [null, null]);
  const render = readFileSync(join(ROOT, "render.yaml"), "utf8");
  check("render.yaml never names GOOD_FAITH_E2E_STUBS", !render.includes("GOOD_FAITH_E2E_STUBS"));
  const example = readFileSync(join(ROOT, ".env.example"), "utf8");
  const lines = example.split("\n").filter((l) => l.includes("GOOD_FAITH_E2E_STUBS"));
  check(".env.example lists GOOD_FAITH_E2E_STUBS, commented out only", lines.length > 0 && lines.every((l) => l.trim().startsWith("#")), lines.join(" | "));
}

/* ---------- 2. Which model each job gets ---------- */
const JOBS = ["lease", "inspect", "close_out", "advocate", "negotiator", "chargeback"];
{
  stubsOn(false);
  check("off: every job is Claude", JOBS.every((j) => /anthropic/.test(model.claude(j).provider)), JOBS.map((j) => model.claude(j).provider).join(", "));
  eq("off: the record names the real model", model.modelName(), model.MODEL);
  process.env.GOOD_FAITH_E2E_STUBS = "1";
  process.env.RENDER = "true";
  check("asked for on Render: every job is still Claude", JOBS.every((j) => /anthropic/.test(model.claude(j).provider)));
  delete process.env.RENDER;
  stubsOn(true);
  check("on: every job is its stub", JOBS.every((j) => model.claude(j).provider === "e2e-stub" && model.claude(j).modelId === `e2e-stub-${j}`));
  eq("on: the record names the stub", model.modelName(), "e2e stub");
  for (const j of ["inspect", "chargeback"]) {
    let threw = "";
    try { await model.claude(j).doGenerate({ prompt: [] }); } catch (e) { threw = e.message; }
    check(`on: the ${j} job refuses (off the demo's path)`, /don't cover/.test(threw), threw);
  }
}

/* ---------- 3. The stubs through the app's own code ---------- */
stubsOn(true);
{
  const terms = await extract.extractLeaseTerms(new TextEncoder().encode("%PDF-1.4 stub"), "lease-single-owner.pdf");
  eq("lease: the demo lease's facts", [terms.state, terms.monthlyRent, terms.securityDeposit, terms.otherMoveInCharges[0].amount, terms.lateFee.amount, terms.ownerType],
    ["CA", 2400, 4800, 300, 120, "natural_person"]);
  let threw = "";
  try { await extract.extractLeaseTerms(new TextEncoder().encode("%PDF-1.4"), "someone-elses-lease.pdf"); } catch (e) { threw = e.message; }
  check("lease: any other file is refused", /reads only demo\/lease-single-owner\.pdf/.test(threw), threw);
  // The guard against a second tenancy of a lease a copy already has (src/lib/lease-key.ts): what the lease check
  // read keys the same as the tenancy the copy was made from, whose every date the copy moved, so the start opens that
  // tenancy instead of making another property at the same address.
  const { leaseKey } = leaseKeyLib;
  const read = { address: terms.propertyAddress, tenants: terms.tenants };
  eq("lease: the demo lease keys the same as a copy's own tenancy of it, whose dates the copy moved",
    leaseKey(read), leaseKey({ address: "1140 E. JUNIPER HOLLOW LN, Orange, CA  92867", tenants: ["Lane Forti", "Luke Jones"] }));
  check("lease: another unit at the same street number doesn't key the same",
    leaseKey(read) !== leaseKey({ address: "1140 E. Juniper Hollow Ln, Unit 2, Orange, CA 92867", tenants: terms.tenants }));
  check("lease: the same unit let to other tenants doesn't key the same",
    leaseKey(read) !== leaseKey({ address: terms.propertyAddress, tenants: ["Someone Else"] }));
  eq("lease: a lease with no address keys nothing", leaseKey({ address: null, tenants: terms.tenants }), null);
}
{
  // The close-out agent's steps, from what its tools answered.
  const m = model.claude("close_out");
  const tool = (name, value) => ({ role: "tool", content: [{ type: "tool-result", toolCallId: `${name}-1`, toolName: name, output: { type: "json", value } }] });
  const mcp = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj) }] });
  const facts = { plan: { rail: "refund_original_payment", amount: 3790, captureId: "E2EABCDEF1234567" }, deposit: { invoiceId: "INV2-E2E-AAAA-BBBB-CCCC" }, blockers: [] };
  const step = async (...tools) => (await m.doGenerate({ prompt: [{ role: "system", content: "x" }, { role: "user", content: [{ type: "text", text: "Close out." }] }, ...tools] })).content;
  const names = (c) => c.filter((p) => p.type === "tool-call").map((p) => [p.toolName, JSON.parse(p.input)]);
  eq("close-out: first it reads the facts", names(await step()), [["get_close_out_facts", {}]]);
  eq("close-out: then it checks the deposit with PayPal", names(await step(tool("get_close_out_facts", facts))), [["get_invoice", { invoice_id: "INV2-E2E-AAAA-BBBB-CCCC" }]]);
  const refund = names(await step(tool("get_close_out_facts", facts), tool("get_invoice", mcp({ id: "INV2-E2E-AAAA-BBBB-CCCC", status: "PAID" }))));
  eq("close-out: then proposes the plan's own refund, capture and amount", [refund[0]?.[0], refund[0]?.[1].capture_id, refund[0]?.[1].amount], ["create_refund", "E2EABCDEF1234567", { currency_code: "USD", value: "3790.00" }]);
  const denied = await step(tool("get_close_out_facts", facts), tool("get_invoice", mcp({ id: "x" })), { role: "tool", content: [{ type: "tool-result", toolCallId: "r", toolName: "create_refund", output: { type: "execution-denied" } }] });
  check("close-out: a decline ends it with nothing sent", denied[0]?.type === "text" && /nothing was sent/.test(denied[0].text), JSON.stringify(denied));
  const sent = tool("create_refund", mcp({ id: "E2EREFUND0000001", status: "COMPLETED" }));
  eq("close-out: after the refund, it confirms it with PayPal", names(await step(tool("get_close_out_facts", facts), tool("get_invoice", mcp({ id: "x" })), sent)), [["get_refund", { refund_id: "E2EREFUND0000001" }]]);
  const end = await step(tool("get_close_out_facts", facts), tool("get_invoice", mcp({ id: "x" })), sent, tool("get_refund", mcp({ id: "E2EREFUND0000001" })), tool("get_statement_checklist", { checklist: [] }));
  check("close-out: and ends with its summary", end[0]?.type === "text" && /\$3,790\.00 refund went back through PayPal/.test(end[0].text), JSON.stringify(end));
  const blocked = await step(tool("get_close_out_facts", { plan: { rail: "blocked", amount: 0, why: "Resolve the blockers first." }, blockers: ["The deposit isn't paid."] }));
  check("close-out: a blocked plan moves no money", blocked[0]?.type === "text" && /Nothing goes back/.test(blocked[0].text) && !blocked.some((p) => p.type === "tool-call"));
}
{
  // The demo's three charges, the carpet disputed: the advocate's case, then the negotiation, with the code's checks.
  const ded = (o) => ({ category: "damage", room: "Bedroom 1", work: "repair", performer: "vendor", proration: "none", is_estimate: false, receipt_path: "r.pdf", after_photo_paths: ["a.jpg"],
    vendor: { name: "V", address: "1 Main St", phone: "555" }, labor_description: null, note: null, billed: null, hours: null, hourly_rate: null, item_age_years: null, useful_life_years: null,
    finding: { id: "f", classification: "damage", remedy: "repair", confidence: 0.8, moveInPath: "in.jpg", moveOutPath: "out.jpg" }, ...o });
  const deductions = [
    ded({ id: "carpet", item: "Bedroom carpet near center of room", work: "replace", billed: 1800, amount: 720, proration: "useful_life", item_age_years: 6, useful_life_years: 10, math: "$1,800.00 × 4 years left = $720.00",
      finding: { id: "f1", classification: "damage", remedy: "clean", confidence: 0.8, moveInPath: "in1.jpg", moveOutPath: "out1.jpg" } }),
    ded({ id: "wall", room: "Living room", item: "Right wall below the clerestory window", billed: 140, amount: 140, math: "Vendor invoice: $140.00" }),
    ded({ id: "range", category: "cleaning", room: "Kitchen", item: "Range (cooktop, control panel, and oven door)", work: "clean", performer: "own_labor", hours: 3, hourly_rate: 50, billed: 150, amount: 150,
      math: "3 hours × $50.00/hour = $150.00", receipt_path: null, vendor: null, labor_description: "Degreased the range", finding: { id: "f3", classification: "cleaning", remedy: "clean", confidence: 0.6, moveInPath: "in3.jpg", moveOutPath: "out3.jpg" } }),
  ];
  const ranges = range.lawfulRanges({ deductions, depositHeld: 4800, today: "2026-10-03", moveOutDate: "2026-10-01", endDate: null, plannedMoveOut: null, notices: {}, deliveredOn: "2026-10-02", refundedOn: "2026-10-02" }, CA);
  const file = {
    state: "CA", today: "2026-10-03", address: "1140 E. Juniper Hollow Ln", landlord: "Teddy Buettner", tenants: ["Luke Jones"], moveOutDate: "2026-10-01", statementDue: "2026-10-22",
    delivery: { method: "personal", date: "2026-10-02" }, depositHeld: 4800, statementRefund: 3790, refunded: 3790, wearNotCharged: [], dispute: { message: null, evidence: [] }, ranges,
    lines: ranges.lines.map((r) => {
      const d = deductions.find((x) => x.id === r.id);
      return { n: r.n, id: r.id, title: r.title, room: r.room, category: r.category, item: d.item, work: d.work, performer: d.performer, amount: r.amount, math: d.math, basis: "basis", note: null,
        inputs: {}, documents: { receipt: !!d.receipt_path, vendor: null, laborDescription: d.labor_description, afterPhotos: 1, estimate: false },
        finding: { classification: d.finding.classification, label: null, summary: "A change", observation: null, reason: null, remedy: d.finding.remedy, severity: null, confidence: d.finding.confidence, box: null, moveInBox: null },
        photos: { moveIn: null, moveOut: null, after: [] }, disputed: r.id === "carpet", tenantReason: r.id === "carpet" ? "The stain was small." : null };
    }),
  };
  const c = await advocate.runAdvocate(file, CA, { model: model.claude("advocate"), loadPhoto: async () => null, jev: null });
  eq("advocate: half the disputed carpet back, the rest as charged, nothing changed by the code", [c.lines.map((l) => [l.verdict, l.keep]), c.amountBack, c.adjustments],
    [[["weak", 360], ["solid", 140], ["solid", 150]], 360, []]);
  const caseTurn = { n: 1, side: "tenant", actor: "agent", move: "case", proposal: c.lines.map((l) => ({ deduction_id: l.id, n: l.n, amount: l.amount, keep: l.keep, min: l.min, max: l.max })),
    total_keep: c.totalKeep, amount_back: c.amountBack, message: null, reasoning: null, citations: [], checks: { adjustments: [] } };
  const turns = [];
  const outcome = await nego.runNegotiation({ file, pack: CA, turns: [caseTurn], policy: nego.DEFAULT_POLICY, jev: null,
    models: { landlord: model.claude("negotiator"), tenant: model.claude("negotiator") }, persist: async (t) => { turns.push(t); return `t${t.n}`; } });
  eq("negotiation: $600 kept, then $450, and the landlord's negotiator meets it: agreed at $270 back", [outcome.reason, turns.map((t) => [t.side, t.move, t.amount_back])],
    ["agreed", [["landlord", "counter", 120], ["tenant", "counter", 270], ["landlord", "concede", 270]]]);
  check("negotiation: no turn adjusted by the code", turns.every((t) => !t.checks?.adjustments?.length), JSON.stringify(turns.map((t) => t.checks?.adjustments)));
}

/* ---------- 3b. The close-out refund's idempotency key ---------- */
{
  // closeOutRefundKey builds the refund's PayPal-Request-Id from the tenancy, the amount and how many earlier attempts
  // PayPal refused outright, counted in the audit log. A Payout's refusal (refund_failed with `payout: true`, the
  // send_payout tool's) is the Payout's own, with its own batch id for a key, so it must not move the refund's key:
  // a refund retried after a Payout was refused is the same request, and PayPal must answer it with the refund it
  // already made, if it did. The count is one HEAD query through supabase-js, which goes out through keepAliveFetch
  // (src/lib/http.ts) to whatever is in globalThis.fetch; here a stand-in that records the query and answers a count.
  const queries = [];
  let count = 0;
  const trapFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    queries.push({ method: init.method ?? "GET", url: String(url), prefer: new Headers(init.headers ?? {}).get("prefer") });
    return new Response(null, { status: 200, headers: { "content-range": count ? `0-${count - 1}/${count}` : "*/0" } });
  };
  try {
    const plain = await agent.closeOutRefundKey("t-check", "3790.00");
    count = 2;
    const retried = await agent.closeOutRefundKey("t-check", "3790.00");
    eq("refund key: the tenancy and the amount in cents, then the refusals so far", [plain, retried], ["closeout-t-check-379000", "closeout-t-check-379000-r2"]);
    const q = queries.map((x) => { const u = new URL(x.url); return { method: x.method, path: u.pathname, where: decodeURIComponent(u.search).slice(1).split("&").sort() }; });
    eq("refund key: one query each, of the audit log", q.map((x) => x.path), ["/rest/v1/audit_log", "/rest/v1/audit_log"]);
    eq("refund key: the count is of this tenancy's refund_failed rows PayPal refused outright, the refund's own and not a Payout's",
      q[0]?.where, ["action=eq.refund_failed", "detail->>payout=is.null", "detail->>refused=eq.true", "select=id", "tenancy_id=eq.t-check"]);
    check("refund key: the query asks for an exact count", /count=exact/.test(queries[0]?.prefer ?? ""), JSON.stringify(queries[0]));
  } finally {
    globalThis.fetch = trapFetch;
  }
}
/* ---------- 4. The fake PayPal ---------- */
stubsOn(true);
{
  eq("fake PayPal: no sign-in with PayPal", await paypal.accessToken(), "e2e-stub-token-not-valid-at-paypal");
  const real = await fake.fakePayPal("POST", "/v2/payments/captures/9YF61788W2043700U/refund", { amount: { currency_code: "USD", value: "3790.00" } }, { requestId: "x" });
  eq("fake PayPal: a refund of a real capture (a template's) is refused", [real.status, real.body.name], [422, "E2E_STUB_REFUSES"]);
  let refused = null;
  try { await paypal.paypal("POST", "/v2/payments/captures/9YF61788W2043700U/refund", { amount: { value: "1.00" } }); } catch (e) { refused = e; }
  check("fake PayPal: through the app's REST path too, as PayPal's refusal", refused instanceof paypal.PayPalRefused && refused.status === 422, String(refused));
  let payout = null;
  try { await paypal.sendPayout({ email: "a@example.com", amount: 1, note: "n", batchId: "b" }); } catch (e) { payout = e; }
  check("fake PayPal: a Payout isn't on the demo's path and is refused", payout instanceof paypal.PayPalRefused && payout.status === 501, String(payout));
  eq("fake PayPal: a webhook is never verified", await paypal.verifyWebhookSignature("{}", new Headers(Object.fromEntries(paypal.WEBHOOK_HEADERS.map((h) => [h, "x"]))), "W"), "FAILURE");
  let ev = null;
  try { await paypal.sendDisputeEvidence("PP-D-1234", { route: "provide-evidence", input: {}, files: [], requestId: "r" }); } catch (e) { ev = e; }
  check("fake PayPal: dispute evidence never goes", ev instanceof paypal.PayPalRefused);

  // PayPal's own toolkit server, answered by the fake, over the same MCP connection the close-out uses.
  const pp = await agent.connectPayPal({ requestId: "closeout-check-379000" });
  try {
    const tools = await pp.client.tools();
    eq("toolkit: the close-out's PayPal tools are the toolkit's own", Object.keys(tools).sort(), ["create_refund", "get_invoice", "get_refund"]);
    const out = await tools.create_refund.execute({ capture_id: "9YF61788W2043700U", amount: { currency_code: "USD", value: "3790.00" } }, { toolCallId: "c", messages: [] });
    const r = agent.mcpJson(out);
    eq("toolkit: a refund of a real capture comes back as PayPal's refusal", [r?.ok, r?.code, r?.status], [false, "PAYPAL_API_HTTP_ERROR", 422]);
  } finally {
    await pp.close();
  }
  stubsOn(false);
}
/* ---------- 4b. The PayPal client: one sign-in, a 401, the timeouts ---------- */
{
  // With the stubs off, paypal.ts signs in and calls PayPal through keepAliveFetch (src/lib/http.ts), which calls
  // whatever is in globalThis.fetch when that isn't the one Next.js patched; here that is a scripted PayPal, which
  // records every call (its method, path, headers, body and signal) and answers from a queue of statuses: the token
  // endpoint with a numbered token (t1, t2, ...), anything else with the next queued status, 200 when the queue is
  // empty. The client is loaded by a jiti of its own, so its token cache starts empty and ends here.
  const calls = [];
  const queue = [];
  let tokens = 0;
  let hang = false;
  const trapFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const call = { method: init.method ?? "GET", path: u.replace(/^https?:\/\/[^/]+/, ""), headers: init.headers ?? {}, body: init.body, signal: init.signal };
    calls.push(call);
    if (hang) return new Promise((_, reject) => { call.signal?.addEventListener("abort", () => reject(call.signal.reason)); });
    if (call.path === "/v1/oauth2/token") {
      const status = queue.length && queue[0].token ? queue.shift().status : 200;
      return new Response(JSON.stringify(status === 200 ? { access_token: `t${++tokens}`, expires_in: 32400 } : { error: "server_error" }), { status });
    }
    const status = queue.length && !queue[0].token ? queue.shift().status : 200;
    return new Response(JSON.stringify(status === 200 ? { id: call.path.endsWith("/invoices") ? "INV2-1" : call.path.split("/").pop(), status: "COMPLETED", batch_header: { payout_batch_id: "B1", batch_status: "PENDING" }, call: calls.length } : { name: status === 401 ? "INVALID_TOKEN" : "UNPROCESSABLE_ENTITY" }), { status });
  };
  const bearer = (c) => c.headers.Authorization;
  const since = (n) => calls.slice(n);
  try {
    const fresh = createJiti(import.meta.url, { moduleCache: false, alias: { "@": join(ROOT, "src"), "server-only": join(ROOT, "node_modules/server-only/empty.js") } });
    const client = await fresh.import(join(ROOT, "src/lib/paypal.ts"));

    // Three cold requests at once: one sign-in, and all three carry its token.
    await Promise.all(["R1", "R2", "R3"].map((id) => client.paypal("GET", `/v2/payments/refunds/${id}`).catch(() => null)));
    eq("client: cold requests at once share one sign-in", calls.map((c) => `${c.method} ${c.path} ${bearer(c) ?? ""}`.trim()).sort(),
      ["GET /v2/payments/refunds/R1 Bearer t1", "GET /v2/payments/refunds/R2 Bearer t1", "GET /v2/payments/refunds/R3 Bearer t1", "POST /v1/oauth2/token Basic Y2hlY2stY2xpZW50OmNoZWNrLXNlY3JldA=="]);
    check("client: the sign-in is Basic with the client id and secret, and nothing else carries them", bearer(calls[0]) === "Basic " + Buffer.from("check-client:check-secret").toString("base64") && calls.slice(1).every((c) => !String(bearer(c)).startsWith("Basic ")), JSON.stringify(calls.map(bearer)));
    let n = calls.length;
    await client.paypal("GET", "/v2/payments/refunds/R4").catch(() => null);
    eq("client: the next call reuses the token", since(n).map((c) => `${c.path} ${bearer(c)}`), ["/v2/payments/refunds/R4 Bearer t1"]);

    // PayPal answers 401 to a write (the secret was rotated, or PayPal revoked the token): the client forgets the
    // token, signs in again and sends the same request once more, with the same PayPal-Request-Id, and the caller
    // gets the second answer. The token it got is the one later calls carry.
    n = calls.length;
    queue.push({ status: 401 });
    let paid = null;
    try { paid = await client.sendPayout({ email: "a@example.com", amount: 12.5, note: "n", batchId: "batch-1" }); } catch (e) { paid = { id: String(e).slice(0, 80) }; }
    eq("client: a 401 is followed by one sign-in and the same request again, with the new token", since(n).map((c) => `${c.method} ${c.path} ${bearer(c)}`),
      ["POST /v1/payments/payouts Bearer t1", "POST /v1/oauth2/token Basic Y2hlY2stY2xpZW50OmNoZWNrLXNlY3JldA==", "POST /v1/payments/payouts Bearer t2"]);
    eq("client: the request sent again carries the same PayPal-Request-Id and body", [since(n)[2]?.headers["PayPal-Request-Id"], since(n)[2]?.body === since(n)[0].body], ["batch-1", true]);
    eq("client: the caller gets the answer to the request that went through", [paid?.id, paid?.status], ["B1", "PENDING"]);
    n = calls.length;
    await client.paypal("GET", "/v2/payments/refunds/R5").catch(() => null);
    eq("client: later calls carry the token the 401 brought", since(n).map(bearer), ["Bearer t2"]);

    // A second 401 in a row is PayPal's refusal, not a loop; any other error status is a refusal with no sign-in.
    n = calls.length;
    queue.push({ status: 401 }, { status: 401 });
    let twice = null;
    try { await client.paypal("GET", "/v2/payments/refunds/R6"); } catch (e) { twice = e; }
    check("client: a 401 after the new token is PayPal's refusal, with status 401", twice instanceof client.PayPalRefused && twice.status === 401, String(twice));
    eq("client: and the request went twice, no more", since(n).map((c) => `${c.path} ${bearer(c)}`), ["/v2/payments/refunds/R6 Bearer t2", "/v1/oauth2/token Basic Y2hlY2stY2xpZW50OmNoZWNrLXNlY3JldA==", "/v2/payments/refunds/R6 Bearer t3"]);
    n = calls.length;
    await client.paypal("GET", "/v2/payments/refunds/R6").catch(() => null);
    eq("client: the token refused twice is forgotten too, so the next call signs in anew", since(n).map((c) => `${c.path} ${bearer(c)}`), ["/v1/oauth2/token Basic Y2hlY2stY2xpZW50OmNoZWNrLXNlY3JldA==", "/v2/payments/refunds/R6 Bearer t4"]);
    n = calls.length;
    queue.push({ status: 422 });
    let other = null;
    try { await client.paypal("POST", "/v2/invoicing/invoices", { x: 1 }, { requestId: "inv-1" }); } catch (e) { other = e; }
    check("client: a 422 is PayPal's refusal, sent once, no sign-in", other instanceof client.PayPalRefused && other.status === 422 && since(n).length === 1 && since(n)[0].path === "/v2/invoicing/invoices", `${String(other)}; ${JSON.stringify(since(n).map((c) => c.path))}`);

    // A sign-in that fails is the refusal it got, and the next call signs in again rather than keeping the failure.
    n = calls.length;
    queue.push({ status: 401 }, { token: true, status: 500 });
    let auth = null;
    try { await client.paypal("GET", "/v2/payments/refunds/R7"); } catch (e) { auth = e; }
    check("client: a failed sign-in is PayPal's refusal, with its status", auth instanceof client.PayPalRefused && auth.status === 500 && /auth/.test(auth.message), String(auth));
    n = calls.length;
    await client.paypal("GET", "/v2/payments/refunds/R8").catch(() => null);
    eq("client: the next call signs in again and goes through", since(n).map((c) => `${c.path} ${bearer(c)}`), ["/v1/oauth2/token Basic Y2hlY2stY2xpZW50OmNoZWNrLXNlY3JldA==", "/v2/payments/refunds/R8 Bearer t5"]);

    // Every call carries a timeout, the deposit invoice's create and send and the Payout included (undici's own
    // five-minute limit was the only bound on those), and a caller's own timeout is the one that stops the wait.
    n = calls.length;
    await client.sendDepositInvoice({ tenancyId: "t1", tenantEmail: "t@example.com", amount: 4800, landlordName: "L", address: "A", note: "n", terms: "t" }).catch(() => null);
    eq("client: the deposit invoice is created, then sent", since(n).map((c) => c.path), ["/v2/invoicing/invoices", "/v2/invoicing/invoices/INV2-1/send"]);
    check("client: every call so far carried an AbortSignal, the sign-in, the writes and the reads alike", calls.length > 10 && calls.every((c) => c.signal instanceof AbortSignal), JSON.stringify(calls.filter((c) => !(c.signal instanceof AbortSignal)).map((c) => c.path)));
    hang = true;
    const started = Date.now();
    const keepAlive = setTimeout(() => {}, 5000); // AbortSignal.timeout's own timer never keeps the process alive
    let timedOut = null;
    try { await client.paypal("GET", "/v2/payments/refunds/R9", undefined, { timeoutMs: 50 }); } catch (e) { timedOut = e; }
    clearTimeout(keepAlive);
    hang = false;
    check("client: a caller's timeoutMs stops the wait on a call that hangs", timedOut?.name === "TimeoutError" && Date.now() - started < 5000, `${String(timedOut)} after ${Date.now() - started} ms`);

    // The webhook's signature check carries the same token: a 401 there drops it too, so the delivery PayPal sends
    // again signs in anew.
    n = calls.length;
    queue.push({ status: 401 });
    let wh = null;
    try { await client.verifyWebhookSignature("{}", new Headers(Object.fromEntries(client.WEBHOOK_HEADERS.map((h) => [h, "x"]))), "W"); } catch (e) { wh = e; }
    check("client: a 401 on the webhook's signature check is an error, so PayPal sends the delivery again", wh instanceof Error && /401/.test(String(wh)), String(wh));
    n = calls.length;
    await client.paypal("GET", "/v2/payments/refunds/R10").catch(() => null);
    eq("client: and the next call signs in anew", since(n).map((c) => c.path), ["/v1/oauth2/token", "/v2/payments/refunds/R10"]);
  } finally {
    globalThis.fetch = trapFetch;
  }
  eq("client: nothing was queued and left", queue, []);
}
/* ---------- 5. PayPal's record ---------- */
{
  // PayPal's answers as its documentation shapes them, with every field the screens must never show planted in them.
  const PII = ["tenant@example.com", "landlord@example.com", "Luke Jones", "Harbor View Rentals", "1140 E. Juniper Hollow Ln", "Orange, CA 92867", "receiver@example.com"];
  const leaked = (r) => PII.filter((w) => JSON.stringify(r).includes(w));
  const refund = {
    id: "1JU08902781691411", status: "COMPLETED", amount: { currency_code: "USD", value: "3790.00" },
    note_to_payer: "Your deposit, less itemized deductions. Luke Jones: 1140 E. Juniper Hollow Ln",
    seller_payable_breakdown: { gross_amount: { value: "3790.00" }, paypal_fee: { value: "0.00" }, net_amount: { value: "3790.00" } },
    payer: { email_address: "tenant@example.com", name: { given_name: "Luke", surname: "Jones" }, address: { address_line_1: "1140 E. Juniper Hollow Ln", admin_area_2: "Orange, CA 92867" } },
    invoice_id: "GF-1", create_time: "2026-10-16T18:22:03Z", update_time: "2026-10-16T18:22:03Z",
    links: [{ href: "https://api-m.sandbox.paypal.com/v2/payments/refunds/1JU08902781691411", rel: "self", method: "GET" }, { href: "https://api-m.sandbox.paypal.com/v2/payments/captures/9YF61788W2043700U", rel: "up", method: "GET" }],
  };
  eq("record: a refund keeps PayPal's id, status, amount, times and the capture it refunded, and nothing else",
    record.pickRefund(refund),
    { kind: "refund", id: "1JU08902781691411", status: "COMPLETED", amount: "3790.00 USD", createTime: "2026-10-16T18:22:03Z", updateTime: "2026-10-16T18:22:03Z", captureId: "9YF61788W2043700U" });
  eq("record: the refund's payer, note and breakdown never come through", leaked(record.pickRefund(refund)), []);
  const invoice = {
    id: "INV2-ABCD-EFGH-IJKL-MNOP", status: "PARTIALLY_REFUNDED",
    detail: { currency_code: "USD", invoice_number: "GF-0123456789abcdef0123", note: "Luke Jones, 1140 E. Juniper Hollow Ln", terms_and_conditions: "Held under Civil Code 1950.5.",
      metadata: { create_time: "2026-10-13T17:00:00Z", last_update_time: "2026-10-16T18:22:03Z", recipient_view_url: "https://www.sandbox.paypal.com/invoice/p/#INV2" } },
    invoicer: { business_name: "Harbor View Rentals", email_address: "landlord@example.com", address: { address_line_1: "1140 E. Juniper Hollow Ln" } },
    primary_recipients: [{ billing_info: { email_address: "tenant@example.com", name: { given_name: "Luke", surname: "Jones" }, address: { address_line_1: "1140 E. Juniper Hollow Ln", admin_area_2: "Orange, CA 92867" } } }],
    items: [{ name: "Security deposit: 1140 E. Juniper Hollow Ln, Orange, CA 92867", quantity: "1", unit_amount: { currency_code: "USD", value: "4800.00" } }],
    amount: { currency_code: "USD", value: "4800.00", breakdown: { item_total: { value: "4800.00" } } },
    payments: { paid_amount: { currency_code: "USD", value: "4800.00" }, transactions: [{ type: "PAYPAL", payment_id: "9YF61788W2043700U", payment_date: "2026-10-13", method: "PAYPAL", amount: { currency_code: "USD", value: "4800.00" } }] },
    refunds: { refund_amount: { currency_code: "USD", value: "4060.00" }, transactions: [{ type: "PAYPAL", recipient_transaction_id: "1JU08902781691411", refund_date: "2026-10-16", amount: { currency_code: "USD", value: "3790.00" } }] },
  };
  eq("record: an invoice keeps its id, number, status, amounts, payment and times, and nothing else",
    record.pickInvoice(invoice),
    { kind: "invoice", id: "INV2-ABCD-EFGH-IJKL-MNOP", status: "PARTIALLY_REFUNDED", invoiceNumber: "GF-0123456789abcdef0123", amount: "4800.00 USD", paid: "4800.00 USD", refunded: "4060.00 USD",
      paymentId: "9YF61788W2043700U", paymentDate: "2026-10-13", createTime: "2026-10-13T17:00:00Z", updateTime: "2026-10-16T18:22:03Z" });
  eq("record: the invoice's recipients, invoicer, items and note never come through", leaked(record.pickInvoice(invoice)), []);
  const payout = {
    batch_header: { payout_batch_id: "5RB36725KN831551L", batch_status: "SUCCESS", time_created: "2026-10-16T18:22:03Z", time_completed: "2026-10-16T18:22:40Z",
      sender_batch_header: { sender_batch_id: "deposit-1", email_subject: "Your security deposit refund", email_message: "Luke Jones" }, amount: { currency: "USD", value: "3790.00" }, fees: { currency: "USD", value: "0.25" } },
    items: [{ payout_item_id: "G9", transaction_status: "SUCCESS", payout_item: { receiver: "receiver@example.com", note: "Luke Jones, 1140 E. Juniper Hollow Ln", amount: { value: "3790.00", currency: "USD" } } }],
  };
  eq("record: a Payout keeps the batch's id, status, amount and times, and nothing else",
    record.pickPayout(payout), { kind: "payout", id: "5RB36725KN831551L", status: "SUCCESS", amount: "3790.00 USD", createTime: "2026-10-16T18:22:03Z", completedTime: "2026-10-16T18:22:40Z" });
  eq("record: the Payout's items, receivers and messages never come through", leaked(record.pickPayout(payout)), []);
  eq("record: an answer without an id or a status is no record", [record.pickRefund({}), record.pickInvoice({ id: "x" }), record.pickPayout({ batch_header: {} }), record.pickRefund("COMPLETED")], [null, null, null, null]);
  // The rows the screens list: every label says whose value it is, a missing value is a word, and an invoice's times
  // are listed only when PayPal gives them.
  const rows = record.recordRows(record.pickRefund({ id: "R1", status: "PENDING" }));
  check("record: every row is labelled as PayPal's", rows.every((r) => r.label.startsWith("PayPal's")), JSON.stringify(rows.map((r) => r.label)));
  eq("record: a value PayPal didn't give reads \"Not given\"", rows.map((r) => r.value), ["R1", "PENDING", "Not given", "Not given", "Not given", "Not given"]);
  eq("record: an invoice's times are listed only when PayPal gives them",
    record.recordRows(record.pickInvoice({ id: "INV2-1", status: "PAID" })).map((r) => r.label).filter((l) => /time/.test(l)), []);
  // Given the property's zone, each of PayPal's times carries the same moment on that clock; a date alone (an invoice's
  // payment_date names no instant), a value PayPal didn't give and the ids and amounts carry none. Without a zone, none.
  // (Nov 2, 2026, 03:01 UTC is Nov 1, 7:01 PM PST: clocks went back on Nov 1.)
  const inv = record.pickInvoice({ id: "INV2-1", status: "PAID", payments: { transactions: [{ payment_id: "P1", payment_date: "2026-10-29" }] },
    detail: { metadata: { create_time: "2026-11-02T03:01:47.442Z" } } });
  eq("record: the property's clock beside each of PayPal's times, and nothing else",
    Object.fromEntries(record.recordRows(inv, "America/Los_Angeles").filter((r) => r.local).map((r) => [r.label, r.local])), { "PayPal's create time": "Nov 1, 2026 at 7:01 PM" });
  eq("record: another state's clock carries its zone, and no zone means no clock",
    [record.recordRows(record.pickRefund({ id: "R1", status: "COMPLETED", create_time: "2026-11-02T03:01:47Z" }), "America/New_York")[3].local,
      record.recordRows(record.pickRefund({ id: "R1", status: "COMPLETED", create_time: "2026-11-02T03:01:47Z" }))[3].local],
    ["Nov 1, 2026 at 10:01 PM EST", undefined]);
  // The reads behind the section go to the fake, and an id that isn't PayPal's shape is refused before any call.
  stubsOn(true);
  let missing = null;
  try { await paypal.getRefund("E2ENOSUCHREFUND01"); } catch (e) { missing = e; }
  check("record: a refund the fake PayPal doesn't have is PayPal's 404, through the app's own read", missing instanceof paypal.PayPalRefused && missing.status === 404, String(missing));
  let bad = null;
  try { await paypal.getRefund("not a refund id"); } catch (e) { bad = e; }
  check("record: an id that isn't a PayPal refund id is refused before any call", bad instanceof paypal.PayPalRefused && bad.status === 0, String(bad));
  let batch = null;
  try { await paypal.getPayoutBatch("5RB36725KN831551L"); } catch (e) { batch = e; }
  check("record: a Payout batch isn't on the demo's path and the fake refuses it", batch instanceof paypal.PayPalRefused && batch.status === 501, String(batch));
  eq("record: ids the screens take", ["INV2-ABCD-EFGH-IJKL-MNOP", "1JU08902781691411", "a", "../x", "x y"].map(record.isPayPalId), [true, true, false, false, false]);
  stubsOn(false);
}

/* ---------- 6. Live PayPal is refused where money comes in, as where it goes out ---------- */
/** The deposit invoice route's answer to one POST with PAYPAL_ENVIRONMENT set to `env`: loaded by a jiti of its own
 *  with no module cache, since paypal.ts reads the environment when it loads; the variable is put back afterwards. */
async function askDepositInvoice(env) {
  process.env.PAYPAL_ENVIRONMENT = env;
  try {
    const fresh = createJiti(import.meta.url, { moduleCache: false, alias: { "@": join(ROOT, "src"), "server-only": join(ROOT, "node_modules/server-only/empty.js") } });
    const route = await fresh.import(join(ROOT, "src/app/api/tenancies/[id]/deposit-invoice/route.ts"));
    const res = await route.POST(new Request("http://localhost/api/tenancies/t-check/deposit-invoice", { method: "POST" }), { params: Promise.resolve({ id: "t-check" }) });
    return { status: res.status, error: (await res.json()).error };
  } catch (e) {
    return { threw: String(e).slice(0, 200) };
  } finally {
    process.env.PAYPAL_ENVIRONMENT = "SANDBOX";
  }
}
{
  // The close-out (agent.ts), the settlement (settlement.ts) and the dispute response (chargeback-store.ts) refuse
  // PAYPAL_ENVIRONMENT=LIVE until the app has a landlord sign-in. The deposit invoice route collects the money, so it
  // must refuse too, before it reads the session or the database. SANDBOX is read when paypal.ts loads, so the route
  // is loaded again by a jiti of its own, with LIVE set, and asked once; the fetch trap above would catch any call out.
  const answer = await askDepositInvoice("LIVE");
  check("live PayPal: the deposit invoice route refuses with 409 before any read (nothing below reaches the session or the database)", answer.status === 409, JSON.stringify(answer));
  check("live PayPal: the refusal says why (no landlord sign-in, live) and where (DEPLOY.md)", /sign-in/.test(answer.error ?? "") && /live/i.test(answer.error ?? "") && /DEPLOY\.md/.test(answer.error ?? ""), JSON.stringify(answer));
}

eq("nothing left the process (fetch, http, https)", leaks, []);

// The gate the right way round: in the sandbox the same request goes past it, to the workspace read, which has no
// database here and fails on its own (after the leaks check, since that read tries the database and the trap counts it).
{
  const answer = await askDepositInvoice("SANDBOX");
  check("sandbox: the deposit invoice route goes past the live gate", answer.status !== 409 || !/live PayPal invoice/.test(answer.error ?? ""), JSON.stringify(answer));
}

/* ---------- 7. The public link routes' rate limits ---------- */
// The tenants' statement packet, a move-in photo at full size and a dispute photo at full size are built per request
// from a link that needs no session, so each route counts its callers by address before it reads anything
// (src/lib/rate-limit.ts). Here each route is loaded as the app loads it and asked by one address until it refuses,
// with a database stand-in in fetch's place that records every read and answers an empty table (so a token nobody has
// is a 404 after one read, with no retry): the calls the limit lets through each make that read, the first refused
// call answers 429 with Retry-After and no read at all, the page's own ?size=thumb tiles are not counted, another
// address is still served, a refused address looping on can't use up the ceiling for that other address, and the
// limit is the route's own number.
{
  const trapFetch = globalThis.fetch;
  const reads = [];
  globalThis.fetch = async (url) => { reads.push(String(url).slice(0, 80)); return new Response("[]", { status: 200, headers: { "content-type": "application/json", "content-range": "*/0" } }); };
  try {
    const route = (p) => jiti.import(join(ROOT, "src/app/api/t/[token]", p));
    const [pdf, photo, evidence] = await Promise.all([route("statement.pdf/route.ts"), route("photos/[photoId]/route.ts"), route("dispute/evidence/[evidenceId]/route.ts")]);
    const call = async (mod, url, params, address) => {
      const before = reads.length;
      let res = null, threw = null;
      try { res = await mod.GET(new Request(url, { headers: { "x-forwarded-for": address } }), { params: Promise.resolve(params) }); } catch (e) { threw = e.message; }
      return { status: res?.status ?? null, retry: res?.headers.get("retry-after") ?? null, body: res ? await res.json().catch(() => null) : null, threw, read: reads.length > before };
    };
    const token = "E2EstubsCheckToken" + "x".repeat(25); // a token of the real shape (43 base64url characters), so the lookup is reached
    const id = "12345678-1234-1234-1234-123456789abc";
    const served = (r) => r.status === 404 && r.read && !r.threw;
    for (const [name, mod, url, params, perAddress, total] of [
      ["the statement packet", pdf, `http://localhost/api/t/${token}/statement.pdf`, { token }, 40, 200],
      ["a move-in photo at full size", photo, `http://localhost/api/t/${token}/photos/${id}`, { token, photoId: id }, 60, 600],
      ["a dispute photo at full size", evidence, `http://localhost/api/t/${token}/dispute/evidence/${id}`, { token, evidenceId: id }, 60, 600],
    ]) {
      const first = [];
      for (let i = 0; i < perAddress; i++) first.push(await call(mod, url, params, "203.0.113.7"));
      check(`${name}: the first ${perAddress} calls from one address in a minute are looked up, not refused`, first.every(served), JSON.stringify(first.filter((r) => !served(r)).slice(0, 2)));
      const over = await call(mod, url, params, "203.0.113.7");
      eq(`${name}: call ${perAddress + 1} answers 429 before any read, with Retry-After`, [over.status, over.retry, over.read, over.threw, /too many times.*Try again in a minute/.test(over.body?.error ?? "")], [429, "60", false, null, true]);
      if (mod !== pdf) eq(`${name}: the page's own ?size=thumb tiles are not counted (looked up from the refused address)`, served(await call(mod, `${url}?size=thumb`, params, "203.0.113.7")), true);
      for (let i = 0; i < total; i++) await call(mod, url, params, "203.0.113.7"); // a loop on the URL, every call refused
      const other = await call(mod, url, params, "203.0.113.8");
      eq(`${name}: another address is still served after ${total} refused calls from the first`, [other.status, other.read], [404, true]);
    }
    check("the stand-in saw only the token lookups", reads.every((r) => /\/rest\/v1\/tenant_links\?/.test(r)), reads.filter((r) => !/tenant_links/.test(r)).slice(0, 3).join("; "));
  } finally {
    globalThis.fetch = trapFetch;
  }
}

check("every stubbed model call and fake PayPal answer said so in the log", ["a lease call", "a close_out call", "a advocate call", "a negotiator call", "refused a refund of capture", "Agent Toolkit create_refund -> 422"].every((w) => stubLines.some((l) => l.includes(w))), `${stubLines.length} lines`);

console.log(`e2e-stubs-check: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}
