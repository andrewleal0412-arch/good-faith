#!/usr/bin/env node
// Checks for the judges'-path test's stubs (src/lib/e2e-switch.ts, e2e-stubs.ts, e2e-paypal.ts, e2e-toolkit.ts,
// model.ts), with no database, no PayPal and no Claude:
//   - the switch: on only for GOOD_FAITH_E2E_STUBS=1, off on Render (any of Render's own variables) and with live
//     PayPal, whatever else is set; render.yaml never names it, and .env.example only as a comment;
//   - off, every Claude job is Claude; on, every job is its stub, and the jobs off the demo's path refuse;
//   - the stubs' answers through the app's own code: the lease check (the demo lease only), the close-out agent's steps
//     (the plan's own capture and amount, the approval, a decline), the advocate's case and the two negotiators'
//     turns on the demo's three charges (no adjustment by the code, agreed at $270 back);
//   - the fake PayPal: no request leaves the process (fetch, http and https are trapped), a refund of any capture
//     that isn't the test's own is refused, through the REST path and through the Agent Toolkit's MCP server, and
//     the webhook check and dispute evidence never reach PayPal;
//   - PayPal's record (src/lib/paypal-record.ts): the picks over PayPal's answers keep the fields the screens list and
//     drop every email, name and address, and the reads behind them go to the fake.
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
    leaseKey(read), leaseKey({ address: "1140 E. JUNIPER HOLLOW LN, Orange, CA  92867", tenants: ["Daniel Okafor", "Priya Raman"] }));
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
    state: "CA", today: "2026-10-03", address: "1140 E. Juniper Hollow Ln", landlord: "Elena Marquez", tenants: ["Priya Raman"], moveOutDate: "2026-10-01", statementDue: "2026-10-22",
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
/* ---------- 5. PayPal's record ---------- */
{
  // PayPal's answers as its documentation shapes them, with every field the screens must never show planted in them.
  const PII = ["tenant@example.com", "landlord@example.com", "Priya Raman", "Harbor View Rentals", "1140 E. Juniper Hollow Ln", "Orange, CA 92867", "receiver@example.com"];
  const leaked = (r) => PII.filter((w) => JSON.stringify(r).includes(w));
  const refund = {
    id: "1JU08902781691411", status: "COMPLETED", amount: { currency_code: "USD", value: "3790.00" },
    note_to_payer: "Your deposit, less itemized deductions. Priya Raman: 1140 E. Juniper Hollow Ln",
    seller_payable_breakdown: { gross_amount: { value: "3790.00" }, paypal_fee: { value: "0.00" }, net_amount: { value: "3790.00" } },
    payer: { email_address: "tenant@example.com", name: { given_name: "Priya", surname: "Raman" }, address: { address_line_1: "1140 E. Juniper Hollow Ln", admin_area_2: "Orange, CA 92867" } },
    invoice_id: "GF-1", create_time: "2026-10-16T18:22:03Z", update_time: "2026-10-16T18:22:03Z",
    links: [{ href: "https://api-m.sandbox.paypal.com/v2/payments/refunds/1JU08902781691411", rel: "self", method: "GET" }, { href: "https://api-m.sandbox.paypal.com/v2/payments/captures/9YF61788W2043700U", rel: "up", method: "GET" }],
  };
  eq("record: a refund keeps PayPal's id, status, amount, times and the capture it refunded, and nothing else",
    record.pickRefund(refund),
    { kind: "refund", id: "1JU08902781691411", status: "COMPLETED", amount: "3790.00 USD", createTime: "2026-10-16T18:22:03Z", updateTime: "2026-10-16T18:22:03Z", captureId: "9YF61788W2043700U" });
  eq("record: the refund's payer, note and breakdown never come through", leaked(record.pickRefund(refund)), []);
  const invoice = {
    id: "INV2-ABCD-EFGH-IJKL-MNOP", status: "PARTIALLY_REFUNDED",
    detail: { currency_code: "USD", invoice_number: "GF-0123456789abcdef0123", note: "Priya Raman, 1140 E. Juniper Hollow Ln", terms_and_conditions: "Held under Civil Code 1950.5.",
      metadata: { create_time: "2026-10-13T17:00:00Z", last_update_time: "2026-10-16T18:22:03Z", recipient_view_url: "https://www.sandbox.paypal.com/invoice/p/#INV2" } },
    invoicer: { business_name: "Harbor View Rentals", email_address: "landlord@example.com", address: { address_line_1: "1140 E. Juniper Hollow Ln" } },
    primary_recipients: [{ billing_info: { email_address: "tenant@example.com", name: { given_name: "Priya", surname: "Raman" }, address: { address_line_1: "1140 E. Juniper Hollow Ln", admin_area_2: "Orange, CA 92867" } } }],
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
      sender_batch_header: { sender_batch_id: "deposit-1", email_subject: "Your security deposit refund", email_message: "Priya Raman" }, amount: { currency: "USD", value: "3790.00" }, fees: { currency: "USD", value: "0.25" } },
    items: [{ payout_item_id: "G9", transaction_status: "SUCCESS", payout_item: { receiver: "receiver@example.com", note: "Priya Raman, 1140 E. Juniper Hollow Ln", amount: { value: "3790.00", currency: "USD" } } }],
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

eq("nothing left the process (fetch, http, https)", leaks, []);
check("every stubbed model call and fake PayPal answer said so in the log", ["a lease call", "a close_out call", "a advocate call", "a negotiator call", "refused a refund of capture", "Agent Toolkit create_refund -> 422"].every((w) => stubLines.some((l) => l.includes(w))), `${stubLines.length} lines`);

console.log(`e2e-stubs-check: ${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}
