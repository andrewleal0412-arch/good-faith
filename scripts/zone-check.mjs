#!/usr/bin/env node
// Time zones (Andrew, 2026-10-05): every state deadline is counted in the property's own zone, the one its pack names
// (California and Washington Pacific, New York and Florida Eastern, Texas Central), not in Pacific time. This checks the
// date helpers (src/lib/dates.ts) at chosen instants, an evening delivery or refund that is already tomorrow in New York
// while it is still today in California, the daylight-saving edges (a fixed offset would put each case on the wrong
// day), what that does to New York's day 14 in the close-out's rule, the ledger, Insights and the unit summary
// (including a refund on time with the statement late, and the settlement that sends the rest), the "recorded <date>"
// beside a delivery recorded on a later day and kept through a correction, and the close-out's note on a whole-deposit
// refund.
// Pure: no database, no PayPal, no Claude. The server modules load with placeholder settings and never connect.
//
//   node scripts/zone-check.mjs

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Placeholders so the server modules can load; nothing here reaches a network.
for (const [k, v] of Object.entries({ SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_SECRET_KEY: "placeholder", PAYPAL_CLIENT_ID: "placeholder", PAYPAL_CLIENT_SECRET: "placeholder" })) process.env[k] ??= v;

// The clock, set per case: new Date() and Date.now() answer NOW; a Date built from a value is untouched.
const RealDate = Date;
let NOW = null;
class Clock extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(NOW ?? RealDate.now()); }
  static now() { return NOW ? RealDate.parse(NOW) : RealDate.now(); }
}
globalThis.Date = Clock;
const at = (iso, fn) => { NOW = iso; try { return fn(); } finally { NOW = null; } };

const jiti = createJiti(import.meta.url, { alias: { "@": join(ROOT, "src"), "server-only": join(ROOT, "node_modules/server-only/empty.js") } });
const lib = (n) => jiti.import(join(ROOT, "src/lib", `${n}.ts`));
const [dates, states, ny, ledger, insights, delivery, nextStep, units, closeout] =
  await Promise.all(["dates", "states/server", "states/ny", "ledger", "insights", "delivery", "next-step", "units", "closeout"].map(lib));
const { todayIn, dateIn, timeIn, atTextIn, wallClockIn, paypalPaidAt, pacificToday, PACIFIC } = dates;
const { packFor, SUPPORTED, zoneOf, todayFor, dayFor, zoneWarnings } = states;

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) pass++;
  else { fail++; failures.push(`${name}${detail ? `: ${detail}` : ""}`); }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const LA = "America/Los_Angeles", NYZ = "America/New_York", CHI = "America/Chicago";
const CA = packFor("CA"), NY = packFor("NY"), TX = packFor("TX"), FL = packFor("FL"), WA = packFor("WA");

/* ---------- 1. Each pack's zone ---------- */
eq("zones: CA, NY, TX, FL, WA", SUPPORTED.map((c) => [c, packFor(c).timeZone.id]),
  [["CA", LA], ["FL", NYZ], ["NY", NYZ], ["TX", CHI], ["WA", LA]]);
eq("zone names", [CA, NY, TX, FL, WA].map((p) => p.timeZone.name), ["Pacific time", "Eastern time", "Central time", "Eastern time", "Pacific time"]);
eq("zoneOf follows the pack, California by default", [zoneOf("NY"), zoneOf("tx"), zoneOf(null)], [NYZ, CHI, LA]);
eq("exceptions: only Texas (El Paso, Mountain) and Florida (the panhandle, Central)",
  SUPPORTED.map((c) => [c, packFor(c).timeZone.exceptions.map((e) => e.zone)]), [["CA", []], ["FL", [CHI]], ["NY", []], ["TX", ["America/Denver"]], ["WA", []]]);
eq("warning, not a guess: El Paso is named, Austin isn't", [zoneWarnings(TX, "El Paso").length, zoneWarnings(TX, " el paso ").length, zoneWarnings(TX, "Austin").length], [1, 1, 0]);
eq("warning: Pensacola and Panama City Beach, not Miami or Tallahassee",
  [zoneWarnings(FL, "Pensacola").length, zoneWarnings(FL, "Panama City Beach").length, zoneWarnings(FL, "Miami").length, zoneWarnings(FL, "Tallahassee").length], [1, 1, 0, 0]);
eq("warning: none without a city, none in California", [zoneWarnings(FL, null).length, zoneWarnings(CA, "Orange").length], [0, 0]);
eq("warning: the rest of the Central-time panhandle, and Fort Bliss",
  [...["Perdido Key", "Cantonment", "Century", "Jay", "Ponce de Leon", "Cottondale", "Eglin AFB", "Hurlburt Field"].map((c) => zoneWarnings(FL, c).length), zoneWarnings(TX, "Fort Bliss").length],
  [1, 1, 1, 1, 1, 1, 1, 1, 1]);
check("Florida: a waiting period (the 15 days to object) ends at 11 PM local too, so wait for local midnight",
  /waiting period ends at 11 PM local time too/.test(FL.timeZone.exceptions[0].line) && /15 days to object/.test(FL.timeZone.exceptions[0].line), FL.timeZone.exceptions[0].line);
for (const e of [...TX.timeZone.exceptions, ...FL.timeZone.exceptions]) {
  check(`${e.area}: the warning says the app keeps its zone, and when a local day ends`, /doesn't change zones by city/.test(e.line) && /11 PM local time/.test(e.line), e.line);
  check(`${e.area}: no em dash`, !/—/.test(e.line));
}
check("the deadline is never moved by a city: El Paso still counts in Central time", zoneOf("TX") === CHI && TX.deadline.due({ moveOutDate: "2026-10-01", endDate: null, plannedMoveOut: null }) === "2026-10-31");

/* ---------- 2. The date helpers at chosen instants ---------- */
// 9:30 PM in California on October 19 is 12:30 AM on October 20 in New York.
eq("evening: New York is a day ahead", at("2026-10-20T04:30:00Z", () => [todayIn(NYZ), todayIn(LA), todayIn(CHI), pacificToday()]), ["2026-10-20", "2026-10-19", "2026-10-19", "2026-10-19"]);
eq("an hour earlier both are October 19", at("2026-10-20T03:30:00Z", () => [todayIn(NYZ), todayIn(LA)]), ["2026-10-19", "2026-10-19"]);
eq("todayFor and dayFor follow the property's state", at("2026-10-20T04:30:00Z", () => [todayFor("NY"), todayFor("CA"), dayFor("2026-10-20T04:30:00Z", "NY"), dayFor("2026-10-20T04:30:00Z", "WA")]),
  ["2026-10-20", "2026-10-19", "2026-10-20", "2026-10-19"]);
eq("pacificToday is todayIn(Pacific)", at("2026-10-20T06:59:00Z", () => [pacificToday(), todayIn(PACIFIC)]), ["2026-10-19", "2026-10-19"]);
// Falling back (November 1, 2026, 2 AM): New York is UTC-4 before, UTC-5 after.
eq("fall back: 04:30Z on Nov 1 is 12:30 AM EDT, Nov 1", dateIn("2026-11-01T04:30:00Z", NYZ), "2026-11-01");
eq("fall back: 04:30Z on Nov 2 is 11:30 PM EST, still Nov 1 (a fixed EDT offset says Nov 2)", dateIn("2026-11-02T04:30:00Z", NYZ), "2026-11-01");
eq("fall back: 05:00Z on Nov 2 is midnight EST, Nov 2", dateIn("2026-11-02T05:00:00Z", NYZ), "2026-11-02");
eq("fall back in California: 07:30Z on Nov 2 is 11:30 PM PST, Nov 1", dateIn("2026-11-02T07:30:00Z", LA), "2026-11-01");
// Springing forward (March 8, 2026, 2 AM): New York is UTC-5 before, UTC-4 after.
eq("spring forward: 04:30Z on Mar 8 is 11:30 PM EST, Mar 7", dateIn("2026-03-08T04:30:00Z", NYZ), "2026-03-07");
eq("spring forward: 04:30Z on Mar 9 is 12:30 AM EDT, Mar 9 (a fixed EST offset says Mar 8)", dateIn("2026-03-09T04:30:00Z", NYZ), "2026-03-09");
eq("spring forward in California: 07:30Z on Mar 9 is 12:30 AM PDT, Mar 9", dateIn("2026-03-09T07:30:00Z", LA), "2026-03-09");
eq("times: Pacific as before, other zones with their name", [timeIn("2026-10-20T04:30:00Z", LA), timeIn("2026-10-20T04:30:00Z", NYZ), timeIn("2026-11-02T04:30:00Z", NYZ), timeIn("2026-12-01T18:00:00Z", CHI)],
  ["9:30 PM", "12:30 AM EDT", "11:30 PM EST", "12:00 PM CST"]);
eq("atTextIn", [atTextIn("2026-10-20T04:30:00Z", NYZ), atTextIn("2026-10-20T04:30:00Z", LA)], ["Oct 20, 2026 at 12:30 AM EDT", "Oct 19, 2026 at 9:30 PM"]);
// A wall clock in a zone as a real timestamp, across the changes.
eq("wall clock: 1:30 AM on the fall-back day is the first one (PDT)", wallClockIn("2026-11-01T01:30:00", LA), "2026-11-01T08:30:00.000Z");
eq("wall clock: 3:00 AM on the fall-back day is PST", wallClockIn("2026-11-01T03:00:00", LA), "2026-11-01T11:00:00.000Z");
eq("wall clock: 2:30 AM in the spring gap reads as 3:30 AM PDT", wallClockIn("2026-03-08T02:30:00", LA), "2026-03-08T10:30:00.000Z");
eq("wall clock: New York noon in July is 16:00Z", wallClockIn("2026-07-04T12:00:00", NYZ), "2026-07-04T16:00:00.000Z");
eq("wall clock: New York 1:30 AM on Nov 1 is EDT", wallClockIn("2026-11-01T01:30:00", NYZ), "2026-11-01T05:30:00.000Z");
eq("PayPal's Pacific wall clock reads as before", paypalPaidAt({ payment_date_time: "2026-10-01T13:46:36Z", payment_date: "2026-10-01" }), "2026-10-01T20:46:36.000Z");
eq("PayPal's day alone is noon Pacific", paypalPaidAt({ payment_date: "2026-11-01" }), "2026-11-01T20:00:00.000Z");

/* ---------- 3. New York's day 14 on the property's clock ---------- */
// Moved out October 5, 2026: day 14 is Monday, October 19 (no holiday). The statement went October 16; the rest of the
// deposit is owed. A refund sent at 9:30 PM in California is sent at 12:30 AM on October 20 in New York.
const standing = (returnedAt, zone, today) => NY.close.standing({
  today, notices: {}, claimed: 400, statementDue: "2026-10-19", deliveredOn: "2026-10-16",
  returnedOn: returnedAt ? dateIn(returnedAt, zone) : null, refundOwed: true,
});
eq("NY day 14 is October 19", [NY.deadline.due({ moveOutDate: "2026-10-05", endDate: null, plannedMoveOut: null }), ny.nyLastDay("2026-10-19")], ["2026-10-19", "2026-10-19"]);
check("NY evening refund: late on New York's clock, the deductions forfeited", standing("2026-10-20T04:30:00Z", NYZ, "2026-10-20")?.forfeits === true);
eq("NY evening refund on Pacific's clock would have been on time", standing("2026-10-20T04:30:00Z", LA, "2026-10-20"), null);
eq("NY refund at 11:30 PM in New York: on time", standing("2026-10-20T03:30:00Z", NYZ, "2026-10-20"), null);
check("NY: nothing sent, and New York's today is past day 14: forfeited", at("2026-10-20T04:30:00Z", () => standing(null, NYZ, todayFor("NY")))?.forfeits === true);
eq("NY: nothing sent, Pacific's today would still be day 14", at("2026-10-20T04:30:00Z", () => standing(null, NYZ, todayFor("CA"))), null);
eq("forfeits hook: only New York's", SUPPORTED.map((c) => [c, typeof packFor(c).deadline.forfeits]), [["CA", "undefined"], ["FL", "undefined"], ["NY", "function"], ["TX", "undefined"], ["WA", "undefined"]]);
check("forfeits hook agrees with the standing", NY.deadline.forfeits({ moveOutDate: "2026-10-05", today: "2026-10-20", deliveredOn: "2026-10-16", returnedOn: "2026-10-20", refundOwed: true })
  && !NY.deadline.forfeits({ moveOutDate: "2026-10-05", today: "2026-10-20", deliveredOn: "2026-10-16", returnedOn: "2026-10-19", refundOwed: true }));
// Daylight saving on the deadline. Moved out October 18: day 14 is Sunday, November 1, run to Monday, November 2 (GCL
// 25-a). A refund at 04:30Z on November 3 is 11:30 PM EST on November 2: on time. EDT's offset would call it November 3.
eq("NY fall: day 14 on Sunday Nov 1 runs to Monday Nov 2", ny.nyLastDay(NY.deadline.due({ moveOutDate: "2026-10-18", endDate: null, plannedMoveOut: null })), "2026-11-02");
const fall = (ts) => NY.close.standing({ today: "2026-11-04", notices: {}, claimed: 400, statementDue: "2026-11-01", deliveredOn: "2026-10-30", returnedOn: dateIn(ts, NYZ), refundOwed: true });
eq("NY fall: 11:30 PM EST on Nov 2 is on time", fall("2026-11-03T04:30:00Z"), null);
check("NY fall: 12:30 AM EST on Nov 3 is late", fall("2026-11-03T05:30:00Z")?.forfeits === true);
eq("NY fall: today flips at midnight EST", [at("2026-11-03T04:59:00Z", () => todayFor("NY")), at("2026-11-03T05:00:00Z", () => todayFor("NY"))], ["2026-11-02", "2026-11-03"]);
// Moved out February 22: day 14 is Sunday, March 8 (the spring change), run to Monday, March 9. A refund at 04:30Z on
// March 10 is 12:30 AM EDT on March 10: late. EST's offset would call it 11:30 PM on March 9.
eq("NY spring: day 14 on Sunday Mar 8 runs to Monday Mar 9", ny.nyLastDay(NY.deadline.due({ moveOutDate: "2026-02-22", endDate: null, plannedMoveOut: null })), "2026-03-09");
const spring = (ts) => NY.close.standing({ today: "2026-03-11", notices: {}, claimed: 400, statementDue: "2026-03-08", deliveredOn: "2026-03-05", returnedOn: dateIn(ts, NYZ), refundOwed: true });
eq("NY spring: 11:30 PM EDT on Mar 9 is on time", spring("2026-03-10T03:30:00Z"), null);
check("NY spring: 12:30 AM EDT on Mar 10 is late", spring("2026-03-10T04:30:00Z")?.forfeits === true);

/* ---------- 4. The ledger, Insights and the unit summary ---------- */
const tenancy = (state, extra = {}) => ({
  id: `t-${state}`, tenants: [{ name: "Avery Kim" }], monthly_rent: 2000, move_out_date: "2026-10-05", statement_delivered_at: "2026-10-16T16:00:00Z",
  statement_delivery: { date: "2026-10-16" }, lease_terms: null, properties: { address: `17 Clinton St, Apt 2, Brooklyn, ${state} 11201`, city: null, state }, ...extra,
});
const deposit = { id: "inv", kind: "deposit_invoice", paypal_id: "INV-1", amount: 2000, status: "PAID", created_at: "2025-09-28T17:00:00Z",
  raw: { transactions: [{ payment_id: "CAP-1", payment_date: "2025-10-01", payment_date_time: "2025-10-01T10:00:00Z", method: "PAYPAL", amount: { value: "2000.00" } }] } };
const refundAt = (ts) => ({ id: "ref", kind: "refund", paypal_id: "REF-1", amount: 1600, status: "COMPLETED", created_at: ts, raw: {} });
const deds = [
  { id: "d1", category: "damage", room: "Living room", item: "Hole in the wall", amount: 250, is_estimate: false, created_at: "2026-10-08T17:00:00Z" },
  { id: "d2", category: "cleaning", room: "Kitchen", item: "Range", amount: 150, is_estimate: false, created_at: "2026-10-08T17:05:00Z" },
];
const late = ledger.ledgerRows(tenancy("NY"), [deposit, refundAt("2026-10-20T04:30:00Z")], deds);
const lateDeds = late.filter((r) => r.kind === "deduction");
eq("ledger NY evening refund: dated October 20, where the property is", late.find((r) => r.kind === "refund")?.date, "2026-10-20");
eq("ledger NY: the deductions are forfeited, not deducted", lateDeds.map((r) => [r.effect, r.signed, r.status]), [["forfeited", 0, "forfeited after day 14"], ["forfeited", 0, "forfeited after day 14"]]);
const lt = ledger.ledgerTotals(late);
eq("ledger NY: nothing deducted, $400 forfeited, $400 still held (owed back)", [lt.deducted, lt.forfeited, lt.held], [0, 400, 400]);
check("ledger NY: the refund's detail says late against the 14 days", /15 days after the Oct 5, 2026 move-out and past the 14 allowed/.test(late.find((r) => r.kind === "refund")?.detail ?? ""), late.find((r) => r.kind === "refund")?.detail);
const onTime = ledger.ledgerRows(tenancy("NY"), [deposit, refundAt("2026-10-20T03:30:00Z")], deds);
const ot = ledger.ledgerTotals(onTime);
eq("ledger NY refund at 11:30 PM in New York: deducted as claimed", [onTime.filter((r) => r.kind === "deduction").map((r) => r.effect), ot.deducted, "forfeited" in ot, ot.held], [["claimed", "claimed"], 400, false, 0]);
const ca = ledger.ledgerRows(tenancy("CA", { properties: { address: "482 N. Glassell St, Orange, CA 92866", city: "Orange", state: "CA" } }), [deposit, refundAt("2026-10-20T04:30:00Z")], deds);
eq("ledger CA, same instant: dated October 19 in California, deductions claimed", [ca.find((r) => r.kind === "refund")?.date, ca.filter((r) => r.kind === "deduction").map((r) => r.effect)], ["2026-10-19", ["claimed", "claimed"]]);
// Nothing sent yet: the ledger's own today is New York's.
const unsent = (iso) => at(iso, () => ledger.ledgerRows(tenancy("NY"), [deposit], deds));
eq("ledger NY, nothing sent, 9:30 PM in California: already forfeited (New York's October 20)", unsent("2026-10-20T04:30:00Z").filter((r) => r.kind === "deduction").map((r) => r.effect), ["forfeited", "forfeited"]);
eq("ledger NY, nothing sent, 11:30 PM in New York: still claimed", unsent("2026-10-20T03:30:00Z").filter((r) => r.kind === "deduction").map((r) => r.effect), ["claimed", "claimed"]);
eq("ledger owedBack NY, nothing sent and forfeited: the whole deposit", ledger.owedBack(unsent("2026-10-20T04:30:00Z")), 2000);
eq("ledger owedBack NY, nothing sent and on time: deposit less deductions", ledger.owedBack(unsent("2026-10-20T03:30:00Z")), 1600);
// Properties' "Deducted this year" counts claimed deductions only (src/app/(landlord)/units/page.tsx).
const deductedThisYear = (rows) => rows.filter((r) => r.kind === "deduction" && r.effect === "claimed" && r.date.startsWith("2026")).reduce((s, r) => s + r.amount, 0);
eq("Properties: Deducted this year leaves New York's forfeited deductions out", [deductedThisYear(late), deductedThisYear(onTime), deductedThisYear(ca)], [0, 400, 400]);
const m = insights.moneyOf(late);
eq("Insights: forfeited deductions aren't deducted or by category", [m.deducted, m.deductions, insights.byCategory(late).map((c) => c.amount)], [0, 0, [0, 0, 0]]);
eq("Insights: on time, they are", [insights.moneyOf(onTime).deducted, insights.byCategory(onTime).map((c) => c.amount)], [400, [250, 150, 0]]);
// The unit summary (Properties, Move-outs, the bell): forfeited, so the whole deposit is left to return.
const row = (state, extra = {}) => ({
  id: `t-${state}`, status: "statement_sent", tenants: [{ name: "Avery Kim" }], monthly_rent: 2000, start_date: "2025-10-01", end_date: "2026-09-30", notice_given_on: null,
  planned_move_out: null, move_out_date: "2026-10-05", move_out_inspected_at: "2026-10-07T17:00:00Z", statement_delivered_at: "2026-10-16T16:00:00Z", statement_delivery: { date: "2026-10-16" },
  refund_agreement: null, lease_terms: null, notices: {}, tenant_move_out: null, properties: { address: "17 Clinton St, Apt 2, Brooklyn, NY 11201", city: "Brooklyn", owner_name: "L", state }, ...extra,
});
const summaryAt = (iso, state) => at(iso, () => units.summarizeTenancy(row(state), [deposit], [], deds.map((d) => ({ category: d.category, amount: d.amount }))));
const s1 = summaryAt("2026-10-20T04:30:00Z", "NY"), s0 = summaryAt("2026-10-20T03:30:00Z", "NY");
eq("summary NY at 9:30 PM in California: forfeited, $2,000 left to return, not closed", [s1.forfeited, nextStep.refundLeft(s1), nextStep.closedOut(s1)], [true, 2000, false]);
eq("summary NY an hour earlier: not forfeited, $1,600 left", ["forfeited" in s0, nextStep.refundLeft(s0)], [false, 1600]);
eq("summary CA never carries it", "forfeited" in summaryAt("2026-10-20T04:30:00Z", "CA"), false);
eq("next step NY on New York's today vs California's", [nextStep.nextStep(s1, at("2026-10-20T04:30:00Z", () => todayFor("NY"))).label, nextStep.nextStep(s0, at("2026-10-20T04:30:00Z", () => todayFor("CA"))).label],
  ["Day 14 has passed: refund in full", "Send the refund"]);
eq("next step NY on California's today would be due today", [nextStep.nextStep(s0, "2026-10-19").daysLeft, nextStep.nextStep(s0, "2026-10-19").level], [0, "urgent"]);
// The tenants' notice through their link, dated where the property is.
eq("tenant notice sent at 9:30 PM in California: October 20 in New York", [
  units.summarizeTenancy(row("NY", { tenant_move_out: { name: "Avery Kim", planned_move_out: "2026-11-30", forwarding_address: "1 Main St", submitted_at: "2026-10-20T04:30:00Z", updated_at: "2026-10-20T04:30:00Z" } }), [deposit], [], []).tenantMoveOut.sentOn,
  units.summarizeTenancy(row("CA", { tenant_move_out: { name: "Avery Kim", planned_move_out: "2026-11-30", forwarding_address: "1 Main St", submitted_at: "2026-10-20T04:30:00Z", updated_at: "2026-10-20T04:30:00Z" } }), [deposit], [], []).tenantMoveOut.sentOn,
], ["2026-10-20", "2026-10-19"]);

/* ---------- 4b. Refund on time, statement after day 14, and a settlement ---------- */
// New York: $1,600 refunded on October 10 (on time), the statement delivered October 21 (after day 14): every deduction
// is forfeited, so the other $400 is owed too. A dispute's settlement can send it ($400 on October 24). It must come
// back as money toward the whole deposit, never as a negative deduction or a second $400 still held.
const lateStatement = { statement_delivered_at: "2026-10-21T16:00:00Z", statement_delivery: { date: "2026-10-21" } };
const onTimeRefund = refundAt("2026-10-10T17:00:00Z");
const settlementRow = (amount = 400, tenancyId = "t-NY") => ({ id: `set-${tenancyId}`, kind: "settlement_refund", paypal_id: "REF-2", amount, status: "COMPLETED", created_at: "2026-10-24T17:00:00Z", raw: {} });
const AFTER = "2026-10-25T17:00:00Z";
const nyShort = at(AFTER, () => ledger.ledgerRows(tenancy("NY", lateStatement), [deposit, onTimeRefund], deds));
const nySettled = at(AFTER, () => ledger.ledgerRows(tenancy("NY", lateStatement), [deposit, onTimeRefund, settlementRow()], deds));
const caSettled = at(AFTER, () => ledger.ledgerRows(tenancy("CA", { ...lateStatement, properties: { address: "482 N. Glassell St, Orange, CA 92866", city: "Orange", state: "CA" } }), [deposit, onTimeRefund, settlementRow(400, "t-CA")], deds));
const tot = (rows) => { const x = ledger.ledgerTotals(rows); return [x.deducted, x.held, x.forfeited ?? 0]; };
eq("ledger NY, refund on time and statement late: forfeited, $400 still held (owed)", [nyShort.filter((r) => r.kind === "deduction").map((r) => r.effect), tot(nyShort)], [["forfeited", "forfeited"], [0, 400, 400]]);
eq("ledger NY, and the settlement sent the $400: nothing deducted, nothing held", tot(nySettled), [0, 0, 400]);
eq("ledger CA, same rows: the settlement takes the $400 off the claimed deductions, as before", tot(caSettled), [0, 0, 0]);
eq("ledger owedBack (Payments' Due back): $400 for New York until the settlement, nothing for California", [ledger.owedBack(nyShort), ledger.owedBack(nySettled), ledger.owedBack(caSettled)], [400, 0, 0]);
const caPart = at(AFTER, () => ledger.ledgerRows(tenancy("CA", { properties: { address: "482 N. Glassell St, Orange, CA 92866", city: "Orange", state: "CA" } }),
  [deposit, onTimeRefund, settlementRow(270, "t-CA")], deds));
eq("ledger CA, a $270 settlement of $400 deducted: $130 as settled, $0 held", tot(caPart), [130, 0, 0]);
eq("settledOff: never more than a tenancy's claimed deductions", [ledger.settledOff(nySettled), ledger.settledOff(caSettled), ledger.settledOff(caPart)], [0, 400, 270]);
// Two units together: the New York settlement must not come off California's deductions.
const both = [...nySettled, ...caPart];
eq("ledger, both units: deducted is California's $130 alone, nothing held", tot(both), [130, 0, 400]);
const thisYear = (rows) => {
  const claimedY = rows.filter((r) => r.kind === "deduction" && r.effect === "claimed" && r.date.startsWith("2026")).reduce((s, r) => s + r.amount, 0);
  const settledY = rows.filter((r) => r.kind === "settlement" && (r.effect === "returned" || r.effect === "pending") && r.date.startsWith("2026"));
  return Math.max(0, Math.round((claimedY - ledger.settledOff(settledY, rows)) * 100) / 100);
};
eq("Properties: Deducted this year, both units: $400 less California's $270 (New York's settlement takes nothing off)", thisYear(both), 130);
eq("Insights NY settled: $1,600 back, $400 settled, nothing held or kept", (({ returned, settled, held, kept, deducted }) => [returned, settled, held, kept, deducted])(insights.moneyOf(nySettled)), [1600, 400, 0, 0, 0]);
eq("Insights CA $270 settled: $130 kept", (({ held, kept }) => [held, kept])(insights.moneyOf(caPart)), [0, 130]);
// The unit summary agrees: open with $400 owed until the rest of the deposit went back, then Done.
const sumOf = (state, pays, extra = lateStatement) => at(AFTER, () => units.summarizeTenancy(row(state, extra), pays, [{ phase: "move_out_before" }], deds.map((d) => ({ category: d.category, amount: d.amount }))));
const ns = sumOf("NY", [deposit, onTimeRefund]);
const nextOf = (s) => at(AFTER, () => nextStep.nextStep(s, todayFor(s.state)));
eq("summary NY, refund on time and statement late: $400 short, not closed", [ns.forfeited, nextStep.forfeitShort(ns), nextStep.closedOut(ns)], [true, 400, false]);
eq("next step NY: overdue, $400 more owed, to the statement", (({ label, level, action }) => [label, level, action?.path])(nextOf(ns)), ["Day 14 has passed: $400.00 more owed", "overdue", "statement"]);
check("next step NY: says what went back and that the close-out sends one refund", /\$1,600\.00 of the \$2,000\.00 deposit went back, so \$400\.00 more is owed/.test(nextOf(ns).detail) && /one refund per tenancy/.test(nextOf(ns).detail), nextOf(ns).detail);
const nss = sumOf("NY", [deposit, onTimeRefund, settlementRow()]);
eq("summary NY, the settlement sent the $400: nothing short, closed", [nss.settledBack, nextStep.forfeitShort(nss), nextStep.closedOut(nss), nextOf(nss).label], [400, 0, true, "Done"]);
check("Done NY: names the settlement", /\$1,600\.00 returned by PayPal, and \$400\.00 through the dispute's settlement/.test(nextOf(nss).detail), nextOf(nss).detail);
const nsFull = sumOf("NY", [deposit, refundAt("2026-10-22T17:00:00Z")].map((p) => (p.kind === "refund" ? { ...p, amount: 2000 } : p)));
eq("summary NY, the whole deposit refunded after day 14: closed", [nextStep.forfeitShort(nsFull), nextStep.closedOut(nsFull)], [0, true]);
const nsUndelivered = sumOf("NY", [deposit, onTimeRefund], { statement_delivered_at: null, statement_delivery: null });
eq("summary NY, refund on time and the statement not recorded yet: record it first", [nsUndelivered.forfeited, nextOf(nsUndelivered).label], [true, "Record the statement delivery"]);
const cs = sumOf("CA", [deposit, onTimeRefund, settlementRow(270, "t-CA")]);
eq("summary CA with a settlement: no settledBack, closed as before", ["settledBack" in cs, nextStep.forfeitShort(cs), nextStep.closedOut(cs)], [false, 0, true]);

/* ---------- 5. A delivery recorded on a later day ---------- */
const rec = { method: "mail", date: "2026-10-16", to: "Avery Kim", address: "500 Atlantic Ave, Brooklyn, NY 11217", address_kind: "forwarding", email: null, by_agreement: false };
eq("recorded four days later", delivery.recordedLater(rec, "2026-10-20T15:00:00Z", NYZ), "2026-10-20");
eq("recorded the same day, or before, or never: nothing shown", [delivery.recordedLater(rec, "2026-10-16T22:00:00Z", NYZ), delivery.recordedLater(rec, "2026-10-15T22:00:00Z", NYZ), delivery.recordedLater(rec, null, NYZ), delivery.recordedLater(null, "2026-10-20T15:00:00Z", NYZ)], [null, null, null, null]);
const evening = { ...rec, date: "2026-10-19" };
eq("recorded at 9:30 PM in California for a New York delivery dated Oct 19: the next day there", [delivery.recordedLater(evening, "2026-10-20T04:30:00Z", NYZ), delivery.recordedLater(evening, "2026-10-20T04:30:00Z", LA)], ["2026-10-20", null]);
eq("recorded at 11:30 PM in New York the same day: nothing shown", delivery.recordedLater(evening, "2026-10-20T03:30:00Z", NYZ), null);
eq("describeDelivery with the recorded day", delivery.describeDelivery(rec, "2026-10-20"),
  "first-class mail to 500 Atlantic Ave, Brooklyn, NY 11217 on October 16, 2026 (recorded October 20, 2026)");
eq("describeDelivery without it reads as before", delivery.describeDelivery(rec), "first-class mail to 500 Atlantic Ave, Brooklyn, NY 11217 on October 16, 2026");
eq("deliveryLine as before", delivery.deliveryLine(rec), "Mailed Oct 16, 2026 to the forwarding address");
eq("recordedWords", [delivery.recordedWords("2026-10-20"), delivery.recordedWords("2026-10-20", false)], ["recorded October 20, 2026", "recorded Oct 20, 2026"]);
// A correction keeps the first recording unless the date changes (the delivery route, recordedAtFor): recorded on the
// delivery day (Oct 16), its forwarding address fixed on Oct 20 with the same date, still nothing shown.
const first = "2026-10-16T22:00:00Z", fix = "2026-10-20T15:00:00Z";
eq("recordedAtFor: a first save is recorded now", delivery.recordedAtFor(null, "2026-10-16", null, first), first);
eq("recordedAtFor: a correction with the same date keeps the first recording", delivery.recordedAtFor(rec, "2026-10-16", first, fix), first);
eq("recordedAtFor: and then nothing shows beside the date", delivery.recordedLater(rec, delivery.recordedAtFor(rec, "2026-10-16", first, fix), NYZ), null);
eq("recordedAtFor: a correction that changes the date is recorded now, and shows", [delivery.recordedAtFor(rec, "2026-10-15", first, fix), delivery.recordedLater({ date: "2026-10-15" }, delivery.recordedAtFor(rec, "2026-10-15", first, fix), NYZ)], [fix, "2026-10-20"]);
eq("recordedAtFor: a record from before the column, corrected with its date, still reads as recorded on it", [delivery.recordedAtFor(rec, "2026-10-16", null, fix), delivery.recordedLater(rec, delivery.recordedAtFor(rec, "2026-10-16", null, fix), NYZ)], [null, null]);
// The delivery route's "not in the future" is the property's today: at 9:30 PM in California, October 20 is a New
// York delivery's today and a California delivery's tomorrow (src/app/api/tenancies/[id]/statement/delivery/route.ts).
eq("delivery dated Oct 20 at 9:30 PM in California: allowed in New York, future in California", at("2026-10-20T04:30:00Z", () => ["2026-10-20" > todayIn(NY.timeZone.id), "2026-10-20" > todayIn(CA.timeZone.id)]), [false, true]);

/* ---------- 6. The close-out's note on a whole-deposit refund, and the prompts ---------- */
const facts = (o) => ({
  today: "2026-10-20", tenancy: { address: "17 Clinton St", tenants: ["Avery Kim"], moveOutDate: "2026-10-05", statementDue: "2026-10-19", daysLeft: -1 },
  deposit: { invoiceId: "INV-1", status: "PAID", amount: 2000, paidAt: "2025-10-01T17:00:00Z", method: "PAYPAL", captureId: "CAP-1", daysSincePaid: 20, billedTo: "a@example.com", live: true },
  refundAgreement: null, deductions: [], totals: { depositHeld: 2000, deductions: 400, refund: 1600, balanceClaimed: 0, documentsRequired: false },
  alreadyReturned: null, plan: { rail: "blocked", amount: 0, why: "" }, blockers: [], warnings: [], rules: {}, ...o,
});
const whole = closeout.refundPlan(facts({ wholeDeposit: true }), NY);
eq("whole deposit (forfeited under a dispute): $2,000 against the payment", [whole.rail, whole.amount], ["refund_original_payment", 2000]);
check("whole deposit: the note says the whole deposit comes back", /whole security deposit, \$2,000\.00, is returned: nothing is kept/.test(whole.noteToPayer ?? ""), whole.noteToPayer);
check("whole deposit: the note is under 200 characters, no em dash", (whole.noteToPayer ?? "").length < 200 && !/—/.test(whole.noteToPayer ?? ""), String(whole.noteToPayer?.length));
const none = closeout.refundPlan(facts({ totals: { depositHeld: 2000, deductions: 0, refund: 2000, balanceClaimed: 0, documentsRequired: false } }), NY);
check("no deductions: the whole deposit, and the note says so", none.amount === 2000 && /whole security deposit/.test(none.noteToPayer ?? ""), JSON.stringify(none));
const less = closeout.refundPlan(facts({}), NY);
eq("deposit less deductions: no whole-deposit note", [less.amount, "noteToPayer" in less], [1600, false]);
const via = closeout.refundPlan(facts({ wholeDeposit: true, viaDispute: { amount: 500, disputeId: "PP-D-1", at: "2026-10-18T17:00:00Z", notKept: 0 } }), NY);
check("whole deposit after a PayPal dispute refund: the rest, and the note says the whole is back", via.amount === 1500 && /rest of your security deposit, \$1,500\.00/.test(via.noteToPayer ?? "") && (via.noteToPayer ?? "").length < 200, JSON.stringify(via));
const caWhole = closeout.refundPlan(facts({ totals: { depositHeld: 4800, deductions: 0, refund: 4800, balanceClaimed: 0, documentsRequired: false } }), CA);
check("California, nothing deducted: the note says the whole deposit too", /whole security deposit, \$4,800\.00/.test(caWhole.noteToPayer ?? ""), JSON.stringify(caWhole));
check("blocked: no note", !("noteToPayer" in closeout.refundPlan(facts({ blockers: ["x"], wholeDeposit: true }), NY)));
for (const p of [NY, TX, FL, WA]) {
  check(`${p.code} close-out prompt: its dates are in ${p.timeZone.name}`, p.ai.closeOutSystem.includes(`calendar day in ${p.timeZone.name}, where the property is`));
  check(`${p.code} close-out prompt: the whole-deposit note word for word`, /noteToPayer/.test(p.ai.closeOutSystem));
}
check("California's close-out prompt is unchanged (no zone line; ca-snapshot holds the rest)", !/calendar day in/.test(CA.ai.closeOutSystem));

/* ---------- 7. Concede in code: New York only ---------- */
eq("late.noDefense: New York's alone", SUPPORTED.map((c) => [c, !!packFor(c).dispute.late.noDefense]), [["CA", false], ["FL", false], ["NY", true], ["TX", false], ["WA", false]]);

console.log(`${pass} passed, ${fail} failed`);
if (fail) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}
