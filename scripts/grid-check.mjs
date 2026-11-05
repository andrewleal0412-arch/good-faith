#!/usr/bin/env node
// Unit checks for the AG Grid round: the deductions grid's edits (src/lib/deduction-edit.ts) against the lawful range
// in California, New York and Washington, including a sweep that proves the grid's live check and the route's second
// check (the range engine run again with the edit in place) never disagree, and the one New York case where they do
// on purpose; when the deductions are final (deductionsLock, src/lib/dispute-status.ts: refunded, settled, covered by
// PayPal's dispute refund, or under a live dispute); and Insights' figures (src/lib/insights.ts) against the Payments
// ledger's own totals. Pure: no database, no PayPal, no Claude. Exit 1 if any fails.
//
//   node scripts/grid-check.mjs

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": join(ROOT, "src"), "server-only": join(ROOT, "node_modules/server-only/empty.js") } });
const lib = (n) => jiti.import(join(ROOT, "src/lib", `${n}.ts`));
const [states, range, edit, deductions, insights, ledger, status] = await Promise.all(["states/server", "lawful-range", "deduction-edit", "deductions", "insights", "ledger", "dispute-status"].map(lib));
const { packFor } = states;
const { lawfulRanges } = range;
const { checkEdit, checkAdd, editableFields, editRowOf, limitsFor, rangeBreach, storedColumns, parseInput } = edit;
const CA = packFor("CA"), NY = packFor("NY"), WA = packFor("WA");

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) pass++;
  else { fail++; failures.push(`${name}${detail ? `: ${detail}` : ""}`); }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

/* ---------- Fixtures: the demo's three deductions ---------- */

const ded = (o) => ({
  category: "damage", room: "Bedroom 1", work: "repair", performer: "vendor", proration: "none", is_estimate: false, receipt_path: "r.pdf",
  after_photo_paths: ["after.jpg"], vendor: { name: "V", address: "1 Main St", phone: "555" }, labor_description: null, note: null,
  billed: null, hours: null, hourly_rate: null, item_age_years: null, useful_life_years: null,
  finding: { id: `f-${o.id}`, classification: o.category === "cleaning" ? "cleaning" : "damage", remedy: "repair", confidence: 0.8, moveInPath: "in.jpg", moveOutPath: "out.jpg" },
  ...o,
});
const carpet = (o = {}) => ded({ id: "carpet", item: "Bedroom carpet near center of room", work: "replace", billed: 1800, amount: 720, proration: "useful_life", item_age_years: 6, useful_life_years: 10,
  math: "$1,800.00 × 4 years left of a 10-year useful life (6 years old) = $720.00", ...o });
const wall = (o = {}) => ded({ id: "wall", room: "Living room", item: "Right wall below the window", billed: 140, amount: 140, math: "Vendor invoice: $140.00", ...o });
const stove = (o = {}) => ded({ id: "range", category: "cleaning", room: "Kitchen", item: "Range", work: "clean", performer: "own_labor", hours: 3, hourly_rate: 50, billed: 150, amount: 150,
  math: "3 hours × $50.00/hour = $150.00", receipt_path: null, vendor: null, labor_description: "Degreased the range", ...o });
const input = (ds, o = {}) => ({ deductions: ds, depositHeld: 4800, today: "2026-10-03", moveOutDate: "2026-10-01", endDate: null, plannedMoveOut: null, notices: {}, deliveredOn: null, refundedOn: null, ...o });
const limitsOf = (pack, ds, id, o = {}) => {
  const r = lawfulRanges(input(ds, o), pack);
  const d = ds.find((x) => x.id === id);
  return limitsFor(r.lines.find((l) => l.id === id), { delivered: !!o.deliveredOn, amount: d.amount, guidanceCite: pack.copy.guidanceCite });
};

/* ---------- What each method lets the grid change ---------- */

eq("fields: a vendor's replacement prorated by useful life", editableFields(editRowOf(carpet())), ["invoiceTotal", "itemAgeYears", "usefulLifeYears"]);
eq("fields: a vendor's repair", editableFields(editRowOf(wall())), ["invoiceTotal"]);
eq("fields: the landlord's own cleaning", editableFields(editRowOf(stove())), ["hours", "hourlyRate"]);
eq("fields: paint schedule takes the age only", editableFields(editRowOf(wall({ proration: "paint_schedule", item_age_years: 1 }))), ["invoiceTotal", "itemAgeYears"]);
eq("fields: unpaid rent has none", editableFields(editRowOf(ded({ id: "rent", category: "rent", item: "Rent", amount: 100, math: "" }))), []);
eq("parse: $1,800.50", parseInput("$1,800.50"), 1800.5);
check("parse: three decimals are refused", Number.isNaN(parseInput("1.234")));
check("parse: words are refused", Number.isNaN(parseInput("ten")));

/* ---------- The add form's inputs, held as an edit is (checkAdd; POST /api/tenancies/[id]/deductions) ---------- */
{
  const CITE = CA.copy.guidanceCite;
  const item = "Bedroom carpet near center of room";
  const vendor = (o) => ({ category: "damage", work: "replace", performer: "vendor", proration: "useful_life", invoiceTotal: "1800", itemAgeYears: "6", usefulLifeYears: "10", ...o });
  const ok = checkAdd(item, vendor({}), CITE);
  eq("add: the demo's carpet comes to $720 by chargeable()'s own math", ok.ok && [ok.amount, ok.math, ok.guidance], [720, "$1,800.00 × 4 years left of a 10-year useful life (6 years old) = $720.00", true]);
  eq("add: and the inputs are the numbers the form sent", ok.ok && ok.input, { category: "damage", work: "replace", performer: "vendor", proration: "useful_life", invoiceTotal: 1800, itemAgeYears: 6, usefulLifeYears: 10 });
  const over = checkAdd(item, vendor({ usefulLifeYears: "12" }), CITE);
  check("add: a carpet over a 12-year life is refused as the grid refuses it", !over.ok && /Over the lawful range/.test(over.reason) && /\$720\.00 at most/.test(over.reason), JSON.stringify(over));
  eq("add: with the guidance's citation and the field", !over.ok && [over.cite, over.field], ["DRE guide p. 84 (guidance, not statute)", "usefulLifeYears"]);
  eq("add: the same sentence the grid's edit gives", over.ok ? "the add went through" : over.reason, (() => { const r = checkEdit(editRowOf(carpet()), { usefulLifeYears: 12 }, limitsOf(CA, [carpet(), wall(), stove()], "carpet")); return r.ok ? "the edit went through" : r.reason; })());
  check("add: a rug with no guidance of its own takes a 12-year life", checkAdd("Bedroom rug", vendor({ usefulLifeYears: "12" }), CITE).ok);
  check("add: 1e400 is not an invoice total", (() => { const r = checkAdd(item, vendor({ invoiceTotal: "1e400" }), CITE); return !r.ok && /from \$0\.00 to \$100,000\.00/.test(r.reason) && r.field === "invoiceTotal"; })());
  check("add: a negative invoice is refused", !checkAdd(item, vendor({ invoiceTotal: "-5" }), CITE).ok);
  check("add: three decimals are refused", !checkAdd(item, vendor({ invoiceTotal: "1800.555" }), CITE).ok);
  check("add: an invoice over $100,000 is refused", !checkAdd(item, vendor({ invoiceTotal: "100000.01" }), CITE).ok);
  check("add: a 101-year life is refused", !checkAdd(item, vendor({ usefulLifeYears: "101", itemAgeYears: "6" }), CITE).ok && !checkAdd("Bedroom rug", vendor({ usefulLifeYears: "101" }), CITE).ok);
  check("add: words are refused", !checkAdd(item, vendor({ itemAgeYears: "six" }), CITE).ok);
  check("add: $1,800.50 with the dollar sign is read", (() => { const r = checkAdd(item, vendor({ invoiceTotal: "$1,800.50" }), CITE); return r.ok && r.input.invoiceTotal === 1800.5; })());
  eq("add: an empty invoice is chargeable()'s own refusal", (() => { const r = checkAdd(item, vendor({ invoiceTotal: "" }), CITE); return !r.ok && [r.reason, r.cite, r.field]; })(), ["Enter the invoice total.", null, null]);
  eq("add: an empty age on a prorated line too", (() => { const r = checkAdd(item, vendor({ itemAgeYears: "   " }), CITE); return !r.ok && r.reason; })(), "Enter the item's age and its useful life.");
  const labor = (o) => ({ category: "cleaning", work: "clean", performer: "own_labor", proration: "none", hours: "3", hourlyRate: "50", invoiceTotal: "999999", ...o });
  eq("add: the landlord's own cleaning, with the invoice the method doesn't read dropped", (() => { const r = checkAdd("Range", labor({}), CITE); return r.ok && [r.amount, r.math, r.input.invoiceTotal]; })(), [150, "3 hours × $50.00/hour = $150.00", undefined]);
  check("add: 0 hours is refused", (() => { const r = checkAdd("Range", labor({ hours: "0" }), CITE); return !r.ok && r.field === "hours"; })());
  check("add: 201 hours is refused", !checkAdd("Range", labor({ hours: "201" }), CITE).ok);
  check("add: a $1,001 rate is refused", (() => { const r = checkAdd("Range", labor({ hourlyRate: "1001" }), CITE); return !r.ok && r.field === "hourlyRate"; })());
  check("add: an age the method doesn't read is dropped, not refused", (() => { const r = checkAdd("Range", labor({ itemAgeYears: "-3" }), CITE); return r.ok && r.input.itemAgeYears === undefined; })());
  eq("add: a repair prorated by the paint schedule reads the age only", (() => { const r = checkAdd("Wall", { category: "damage", work: "repair", performer: "vendor", proration: "paint_schedule", invoiceTotal: "300", itemAgeYears: "0.75", usefulLifeYears: "12" }, CITE); return r.ok && [r.amount, r.input.usefulLifeYears]; })(), [200, undefined]);
}

/* ---------- California ---------- */
{
  const ds = [carpet(), wall(), stove()];
  const L = limitsOf(CA, ds, "carpet");
  eq("CA: no bar on the carpet", L.bar, null);
  const ok = checkEdit(editRowOf(carpet()), { usefulLifeYears: 8 }, L);
  check("CA: life 8 is in range", ok.ok);
  eq("CA: and comes to $450 by the same math", ok.ok && [ok.row.amount, ok.row.math], [450, "$1,800.00 × 2 years left of a 8-year useful life (6 years old) = $450.00"]);
  eq("CA: the same as chargeable()", ok.ok && ok.row.amount, deductions.chargeable({ category: "damage", work: "replace", performer: "vendor", proration: "useful_life", invoiceTotal: 1800, itemAgeYears: 6, usefulLifeYears: 8 }).amount);
  const over = checkEdit(editRowOf(carpet()), { usefulLifeYears: 12 }, L);
  check("CA: life 12 is over the guidance's 10 years", !over.ok && /Over the lawful range/.test(over.reason) && /\$720\.00 at most/.test(over.reason), JSON.stringify(over));
  eq("CA: citing the guidance", !over.ok && over.cite, "DRE guide p. 84 (guidance, not statute)");
  check("CA: a bigger invoice is fine (the range caps the life, not the cost)", checkEdit(editRowOf(carpet()), { invoiceTotal: 2000 }, L).ok);
  check("CA: an age past the life comes to $0 and is allowed", (() => { const r = checkEdit(editRowOf(carpet()), { itemAgeYears: 12 }, L); return r.ok && r.row.amount === 0; })());
  check("CA: hours on a vendor's line are refused", !checkEdit(editRowOf(carpet()), { hours: 2 }, L).ok);
  const S = limitsOf(CA, ds, "range");
  eq("CA: 4 hours at $50 is $200", (() => { const r = checkEdit(editRowOf(stove()), { hours: 4 }, S); return r.ok && r.row.amount; })(), 200);
  check("CA: 0 hours is refused", !checkEdit(editRowOf(stove()), { hours: 0 }, S).ok);
  check("CA: a $1,001 rate is refused", !checkEdit(editRowOf(stove()), { hourlyRate: 1001 }, S).ok);
  check("CA: a negative invoice is refused", !checkEdit(editRowOf(wall()), { invoiceTotal: -5 }, limitsOf(CA, ds, "wall")).ok);
  check("CA: an empty change is refused", !checkEdit(editRowOf(wall()), {}, limitsOf(CA, ds, "wall")).ok);
  // Two inputs at once (the drawer): age and life together, where either alone would read differently.
  const both = checkEdit(editRowOf(carpet()), { itemAgeYears: 2, usefulLifeYears: 10 }, L);
  eq("CA: age and life together", both.ok && both.row.amount, 1440);
  // A missing receipt is the record's gap, not a reason to refuse the numbers.
  const noReceipt = [carpet({ receipt_path: null }), wall(), stove()];
  const NR = limitsOf(CA, noReceipt, "carpet");
  eq("CA: missing documents set no bar", NR.bar, null);
  check("CA: and the edit goes through", checkEdit(editRowOf(noReceipt[0]), { usefulLifeYears: 9 }, NR).ok);
  // Once the statement is out, a charge may only go down.
  const D = limitsOf(CA, ds, "wall", { deliveredOn: "2026-10-02" });
  eq("CA: delivered: the ceiling is the amount on it", D.ceiling, 140);
  check("CA: delivered: raising it is refused", (() => { const r = checkEdit(editRowOf(wall()), { invoiceTotal: 150 }, D); return !r.ok && /can only go down/.test(r.reason); })());
  check("CA: delivered: lowering it is fine", checkEdit(editRowOf(wall()), { invoiceTotal: 120 }, D).ok);
  // Wear and tear: the law allows nothing.
  const wear = wall({ finding: { id: "w", classification: "wear_and_tear", remedy: "none", confidence: 0.9, moveInPath: "a", moveOutPath: "b" } });
  const W = limitsOf(CA, [wear], "wall");
  check("CA: wear and tear is a bar", !!W.bar && W.bar.cite.startsWith("Civ. Code 1950.5(b)(2)"), JSON.stringify(W));
  check("CA: so any amount over $0 is refused, with the range's reason", (() => { const r = checkEdit(editRowOf(wear), { invoiceTotal: 100 }, W); return !r.ok && /\$0\.00 for this charge/.test(r.reason); })());
  check("CA: and $0 is allowed", checkEdit(editRowOf(wear), { invoiceTotal: 0 }, W).ok);
  const rt = editRowOf(carpet());
  eq("CA: stored columns round-trip", editRowOf({ ...carpet(), ...storedColumns(rt) }), rt);
}

/* ---------- New York: after day 14 every charge is forfeited ---------- */
{
  const ds = [wall({ amount: 140 })];
  const late = { moveOutDate: "2026-09-01", today: "2026-10-03" };
  const L = limitsOf(NY, ds, "wall", late);
  check("NY: past day 14 is a bar", !!L.bar && /7-108/.test(L.bar.cite), JSON.stringify(L));
  check("NY: no amount over $0", !checkEdit(editRowOf(ds[0]), { invoiceTotal: 100 }, L).ok);
  const inTime = limitsOf(NY, ds, "wall", { moveOutDate: "2026-09-30" });
  eq("NY: inside 14 days there is no bar", inTime.bar, null);

  // A statement delivered in time that used the whole deposit owes no refund, so day 14 passing doesn't make it late.
  // Lowering a charge then leaves a refund owed and already late, which forfeits every line: the grid's check (limits
  // from before the edit) lets it through, and the route's second check refuses it, saying the change itself did it.
  const full = [wall({ billed: 1000, amount: 1000, math: "Vendor invoice: $1,000.00" })];
  const o = { depositHeld: 1000, moveOutDate: "2026-09-01", deliveredOn: "2026-09-10", today: "2026-10-03" };
  const F = limitsOf(NY, full, "wall", o);
  eq("NY: used in full and delivered in time: no bar", F.bar, null);
  const lower = checkEdit(editRowOf(full[0]), { invoiceTotal: 900 }, F);
  check("NY: the grid lets $900 through", lower.ok, JSON.stringify(lower));
  const after = lawfulRanges(input(full.map((x) => ({ ...x, ...storedColumns(lower.row) })), o), NY);
  const breach = rangeBreach(after.lines[0], { barredBefore: !!F.bar });
  check("NY: the route refuses it, as the change's own doing", !!breach && /^With this change the lawful range for this charge would be \$0\.00\./.test(breach.reason) && /7-108/.test(breach.cite), JSON.stringify(breach));
  check("NY: a bar already there keeps the usual words", /^Over the lawful range/.test(rangeBreach(after.lines[0], { barredBefore: true })?.reason ?? ""));
}

/* ---------- When the deductions are final (the routes and the Move-out tab) ---------- */
{
  const { deductionsLock } = status;
  const inv = { kind: "deposit_invoice", amount: 4800, status: "PAID" };
  const code = (o) => deductionsLock({ payments: [inv], disputes: [], refundOwed: 3790, ...o })?.code ?? null;
  eq("lock: nothing yet", code({}), null);
  eq("lock: the close-out's refund", code({ payments: [inv, { kind: "refund", amount: 3790, status: "COMPLETED" }] }), "returned");
  eq("lock: a live dispute", code({ disputes: ["negotiating"] }), "disputed");
  eq("lock: a withdrawn or failed dispute doesn't", [code({ disputes: ["withdrawn"] }), code({ disputes: ["no_agreement"] })], [null, null]);
  // The statement kept the whole deposit, so it owed no refund and the settlement went with no refund row: a lower
  // charge afterwards would send the difference back on top of the settlement.
  eq("lock: settled with a $0 refund owed", code({ refundOwed: 0, disputes: ["settled"], payments: [inv, { kind: "settlement_refund", amount: 300, status: "COMPLETED" }] }), "settled");
  eq("lock: a settlement's money alone", code({ refundOwed: 0, payments: [inv, { kind: "settlement_payout", amount: 300, status: "SUCCESS" }] }), "settled");
  eq("lock: settled with nothing sent", code({ refundOwed: 0, disputes: ["settled"] }), "settled");
  eq("lock: PayPal's dispute refund covering what is owed", code({ payments: [inv, { kind: "dispute_refund", amount: 3790, status: "COMPLETED" }] }), "paypal_dispute");
  eq("lock: a partial one doesn't (the rest is still the close-out's to send)", code({ payments: [inv, { kind: "dispute_refund", amount: 1010, status: "COMPLETED" }] }), null);
  eq("lock: a failed one doesn't", code({ payments: [inv, { kind: "dispute_refund", amount: 3790, status: "DENIED" }] }), null);
  eq("lock: no deposit paid, no covering", code({ refundOwed: null, payments: [{ kind: "dispute_refund", amount: 3790, status: "COMPLETED" }] }), null);
}

/* ---------- Washington: no damage charge without the signed move-in checklist ---------- */
{
  const ds = [wall()];
  const L = limitsOf(WA, ds, "wall");
  check("WA: no checklist is a bar", !!L.bar && /59\.18\.260/.test(L.bar.cite), JSON.stringify(L));
  const signed = limitsOf(WA, ds, "wall", { notices: { move_in_checklist: { date: "2025-08-01", method: "in_person", to: "T" } } });
  eq("WA: with the checklist there is none", signed.bar, null);
}

/* ---------- The grid and the route never disagree ---------- */
{
  // Every edit the grid's check allows, the range engine run again with it in place (the route's second check) allows
  // too; every edit the grid refuses as over the range, the engine refuses as well.
  let n = 0, agree = 0;
  for (const pack of [CA, NY, WA]) {
    for (const o of [{}, { moveOutDate: "2026-09-01" }, { deliveredOn: "2026-10-02" }]) {
      const ds = [carpet(), wall(), stove()];
      for (const id of ["carpet", "wall", "range"]) {
        const d = ds.find((x) => x.id === id);
        const L = limitsOf(pack, ds, id, o);
        for (const field of editableFields(editRowOf(d))) {
          for (const v of [0, 1, 3, 6, 9, 10, 11, 15, 50, 140, 900, 1800, 2500]) {
            const r = checkEdit(editRowOf(d), { [field]: v }, L);
            n++;
            if (!r.ok && !/^Over the lawful range/.test(r.reason)) { agree++; continue; } // an input's own bounds or the ceiling
            const cols = r.ok ? storedColumns(r.row) : storedColumns({ ...editRowOf(d), [field]: v, ...amountOf(editRowOf(d), field, v) });
            const after = lawfulRanges(input(ds.map((x) => (x.id === id ? { ...x, ...cols } : x)), o), pack);
            const breach = rangeBreach(after.lines.find((l) => l.id === id));
            if (r.ok === !breach) agree++;
            else failures.push(`sweep ${pack.code} ${JSON.stringify(o)} ${id}.${field}=${v}: grid ${r.ok ? "allows" : "refuses"}, engine ${breach ? "refuses" : "allows"}`);
          }
        }
      }
    }
  }
  check(`sweep: grid and engine agree on ${n} edits`, agree === n, `${n - agree} disagree`);
}

function amountOf(row, field, v) {
  const c = deductions.chargeable(edit.inputsOf({ ...row, [field]: v }));
  return "amount" in c ? { amount: c.amount, math: c.math } : {};
}

/* ---------- Insights against the ledger ---------- */
{
  const t = (id, state, extra = {}) => ({ id, tenants: [{ name: `T ${id}` }], monthly_rent: 2400, move_out_date: "2026-09-20", statement_delivered_at: "2026-09-25T18:00:00Z",
    lease_terms: null, properties: { address: `${id} Main St, Orange, ${state} 92866`, city: "Orange", state }, ...extra });
  const paid = (id, amount, at) => ({ id: `${id}-inv`, kind: "deposit_invoice", paypal_id: `INV-${id}`, amount, status: "PAID", created_at: at, raw: { transactions: [{ payment_id: `CAP-${id}`, method: "PAYPAL", amount: { value: String(amount) } }] } });
  const pay = (id, kind, amount, at, status = "COMPLETED") => ({ id: `${id}-${kind}`, kind, paypal_id: `${kind}-${id}`, amount, status, created_at: at, raw: {} });
  const dd = (id, category, amount, at) => ({ id: `${id}-${category}`, category, room: "Room", item: category, amount, is_estimate: false, created_at: at });
  const rows = [
    ...ledger.ledgerRows(t("a", "CA"), [paid("a", 4800, "2026-08-01T18:00:00Z"), pay("a", "refund", 3790, "2026-09-26T18:00:00Z"), pay("a", "settlement_refund", 270, "2026-09-30T18:00:00Z")],
      [dd("a", "damage", 860, "2026-09-21T18:00:00Z"), dd("a", "cleaning", 150, "2026-09-21T18:00:00Z")]),
    ...ledger.ledgerRows(t("b", "CA", { move_out_date: null, statement_delivered_at: null }), [paid("b", 2000, "2026-09-10T18:00:00Z")], []),
    ...ledger.ledgerRows(t("c", "TX", { move_out_date: null, statement_delivered_at: null }), [paid("c", 1850, "2026-10-01T18:00:00Z")], []),
  ];
  const units = ["a", "b", "c"].map((id) => ({ id, state: id === "c" ? "TX" : "CA", stateName: id === "c" ? "Texas" : "California", street: `${id} Main St`, address: `${id} Main St`, tenants: `T ${id}`, start: null, status: { label: "x", tone: "gray" }, due: null, deliveredOn: null }));
  const tree = insights.insightRows(units, rows);
  const a = tree.tenancies.find((x) => x.id === "a");
  eq("insights: a's money", [a.collected, a.returned, a.settled, a.held, a.kept, a.deducted], [4800, 3790, 270, 0, 740, 1010]);
  check("insights: every tenancy adds up (collected = returned + settled + kept + held)", tree.tenancies.every((x) => Math.abs(x.collected - x.returned - x.settled - x.kept - x.held) < 0.005));
  eq("insights: held is the ledger's held", tree.total.held, ledger.ledgerTotals(rows).held);
  eq("insights: states by name, each with its total", tree.groups.filter((g) => g.kind === "state").map((g) => [g.stateName, g.held, g.count]), [["California", 2000, 2], ["Texas", 1850, 1]]);
  eq("insights: by category", insights.byCategory(rows).map((c) => [c.category, c.amount, c.count]), [["damage", 860, 1], ["cleaning", 150, 1], ["rent", 0, 0]]);
  const w = insights.periods("2026-08-01", "2026-10-05");
  eq("insights: ten weeks of records read by week", [w.grain, w.list.length, w.list[w.list.length - 1].from], ["week", 11, "2026-10-05"]);
  const s = insights.series(rows, w.list);
  eq("insights: the last period's held is today's", s[s.length - 1].held, ledger.ledgerTotals(rows).held);
  eq("insights: refunds and settlements land in their weeks", [s.reduce((t, x) => t + x.refunds, 0), s.reduce((t, x) => t + x.settlements, 0)], [3790, 270]);
  eq("insights: a young portfolio still gets eight periods", insights.periods("2026-10-01", "2026-10-05").list.length, 8);
  eq("insights: a year reads by month", insights.periods("2025-10-15", "2026-10-05").grain, "month");
  eq("insights: three years read by quarter", insights.periods("2023-09-01", "2026-10-05").grain, "quarter");
  // The timeline starts where money first moved, not at a deposit request sent long before it was paid.
  const early = [...rows, ...ledger.ledgerRows(t("d", "CA", { move_out_date: null, statement_delivered_at: null }), [{ id: "d-inv", kind: "deposit_invoice", paypal_id: "INV-d", amount: 1000, status: "SENT", created_at: "2025-08-02T18:00:00Z", raw: {} }], [])];
  eq("insights: the first money moved, not the first request", insights.firstMoneyDate(early), "2026-08-01");
  // A span past a year repeats month names: the charts key each period by its first day, so every key must be unique.
  const long = insights.periods("2025-08-02", "2026-10-05").list;
  check("insights: period keys are unique past a year", new Set(long.map((x) => x.key)).size === long.length && new Set(long.map((x) => x.label)).size < long.length,
    JSON.stringify(long.map((x) => [x.key, x.label])));
  const two = insights.insightRows([...units, { ...units[0], id: "a2", start: "2025-01-01" }], rows);
  check("insights: a property with two tenancies is a group of its own", two.groups.some((g) => g.kind === "property" && g.count === 2));
  // Deductions entered a week and more before the statement went out: drafts until then, so the chart's held keeps the
  // whole deposit through those weeks and drops in the week of the delivery.
  const e = ledger.ledgerRows(t("e", "CA", { statement_delivered_at: "2026-09-25T18:00:00Z" }), [paid("e", 2000, "2026-08-03T18:00:00Z")],
    [dd("e", "damage", 500, "2026-09-08T18:00:00Z")]);
  const weeks = insights.periods("2026-08-03", "2026-10-05").list;
  const ew = insights.series(e, weeks, new Map([["e", "2026-09-25"]]));
  const weekOf = (s, d) => s.find((x) => x.from <= d && d <= x.to);
  eq("insights: a deduction counts from the statement's delivery", [weekOf(ew, "2026-09-08").held, weekOf(ew, "2026-09-15").held, weekOf(ew, "2026-09-25").held], [2000, 2000, 1500]);
  eq("insights: and the last point is still the ledger's", ew[ew.length - 1].held, ledger.ledgerTotals(e).held);
  // No delivery on record but the refund went: the ledger claims the deductions from then on, and so does the chart.
  const f = ledger.ledgerRows(t("f", "CA", { statement_delivered_at: null }), [paid("f", 2000, "2026-08-03T18:00:00Z"), pay("f", "refund", 1500, "2026-09-29T18:00:00Z")],
    [dd("f", "damage", 500, "2026-09-08T18:00:00Z")]);
  const fw = insights.series(f, weeks, new Map([["f", null]]));
  eq("insights: with no delivery, from the refund", [weekOf(fw, "2026-09-22").held, weekOf(fw, "2026-09-29").held], [2000, 0]);
}

console.log(`${pass} passed, ${fail} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(fail || failures.length ? 1 : 0);
