#!/usr/bin/env node
// Unit checks for the state rule packs (src/lib/states/): deadline math on sample dates, the deposit caps, the steps
// and blockers each state adds, the documents rules, which state a lease is for, the shape every pack shares, and
// where each step's link opens (another page or a named section of a tab, never a bare tab).
// Pure: no database, no PayPal, no Claude. Exit 1 if any check fails.
//
//   node scripts/state-packs-check.mjs

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": join(ROOT, "src"), "server-only": join(ROOT, "node_modules/server-only/empty.js") } });
const lib = (n) => jiti.import(join(ROOT, "src/lib", `${n}.ts`));
// states/server.ts: each pack whole (its client half joined to its server half).
const [states, rules, deductions, nextStepLib, notices, findings, propertyView, bellLib] = await Promise.all(["states/server", "rules", "deductions", "next-step", "notices", "findings", "property-view", "bell"].map(lib));
const { packFor, SUPPORTED, stateCode, isSupported, unsupportedMessage, onePack } = states;

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) pass++;
  else { fail++; failures.push(`${name}${detail ? `: ${detail}` : ""}`); }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const CA = packFor("CA"), NY = packFor("NY"), TX = packFor("TX"), FL = packFor("FL"), WA = packFor("WA");
const PACKS = { CA, NY, TX, FL, WA };

/* ---------- Which state a lease is for ---------- */
eq("stateCode from a Texas address", stateCode("2104 Willow Bend Dr, Austin, TX 78745"), "TX");
eq("stateCode from a ZIP+4", stateCode("88 Pine St, Apt 4, Brooklyn, NY 11201-1234"), "NY");
eq("stateCode from a full name", stateCode("Florida"), "FL");
eq("stateCode from a city line", stateCode("Tacoma, Washington"), "WA");
eq("stateCode from a code", stateCode("ca"), "CA");
eq("stateCode of an unsupported state", stateCode("12 Oak Ave, Portland, OR 97201"), "OR");
eq("stateCode without a state", stateCode("12 Oak Ave"), null);
check("OR is not supported", !isSupported("OR"));
check("unsupported message names the state and the supported ones", /Oregon/.test(unsupportedMessage("OR")) && /California, Florida, New York, Texas and Washington/.test(unsupportedMessage("OR")));
let threw = false; try { packFor("OR"); } catch { threw = true; }
check("packFor refuses an unsupported state", threw);
eq("onePack of mixed states is null", onePack(["CA", "TX"]), null);
eq("onePack of one state", onePack(["TX", "TX"])?.code, "TX");
eq("supported states", SUPPORTED, ["CA", "FL", "NY", "TX", "WA"]);

/* ---------- Deadlines on sample dates ---------- */
const out = "2026-10-01";
eq("CA statement due 21 days after move-out", CA.deadline.due({ moveOutDate: out, endDate: null, plannedMoveOut: null }), "2026-10-22");
eq("NY due 14 days after move-out", NY.deadline.due({ moveOutDate: out, endDate: null, plannedMoveOut: null }), "2026-10-15");
eq("TX due 30 days after surrender", TX.deadline.due({ moveOutDate: out, endDate: null, plannedMoveOut: null }), "2026-10-31");
eq("WA due 30 days after move-out", WA.deadline.due({ moveOutDate: out, endDate: null, plannedMoveOut: null }), "2026-10-31");
eq("CA statementDue across February", deductions.statementDue("2026-02-10", CA), "2026-03-03");
eq("TX statementDue across a year end", deductions.statementDue("2026-12-15", TX), "2027-01-14");
eq("FL no claim: 15 days", FL.deadline.due({ moveOutDate: out, endDate: null, plannedMoveOut: null, claimed: false }), "2026-10-16");
eq("FL claim, no notice yet: 30 days", FL.deadline.due({ moveOutDate: out, endDate: null, plannedMoveOut: null, claimed: true }), "2026-10-31");
eq("FL claim noticed on 10-20: balance 30 days after the notice", FL.deadline.due({ moveOutDate: out, endDate: null, plannedMoveOut: null, claimed: true, claimNoticeDate: "2026-10-20" }), "2026-11-19");
eq("FL holdover past the lease end counts from the end", FL.deadline.due({ moveOutDate: "2026-10-10", endDate: "2026-09-30", plannedMoveOut: null, claimed: false }), "2026-10-15");
eq("FL early move-out counts from the move-out", FL.deadline.due({ moveOutDate: "2026-09-01", endDate: "2026-12-31", plannedMoveOut: null, claimed: false }), "2026-09-16");
eq("no move-out, no deadline", NY.deadline.due({ moveOutDate: null, endDate: "2026-12-31", plannedMoveOut: null }), null);
eq("CA inspection window opens two weeks before", notices.inspectionWindowOpens("2026-10-31", CA), "2026-10-17");
eq("NY inspection window closes one week before", notices.inspectionWindowCloses("2026-10-31", NY), "2026-10-24");
eq("TX has no inspection window", notices.inspectionWindowOpens("2026-10-31", TX), null);

/* ---------- Caps and the lease check ---------- */
const base = {
  propertyAddress: "1 Test St, Testville, CA 90000", city: "Testville", state: null, landlordName: "Pat Owner", ownerType: "natural_person",
  ownerPropertyCount: 1, ownerUnitCount: 1, buildingUnitCount: 2, tenants: ["A Tenant"], tenancyStartDate: "2026-01-01", leaseEndDate: "2026-12-31",
  monthlyRent: 2000, securityDeposit: 3000, otherMoveInCharges: [], nonrefundableLanguage: [], lateFee: null, mandatoryCleaningClause: null,
  electronicPaymentMethods: [], tenantIsServiceMember: false,
};
eq("CA small landlord: two months", rules.lawfulDeposit(base, CA), { amount: 3000, cap: 4000, charged: 3000 });
eq("CA corporation: one month", rules.lawfulDeposit({ ...base, ownerType: "corporation" }, CA), { amount: 2000, cap: 2000, charged: 3000 });
eq("NY: one month for the deposit and advance", rules.lawfulDeposit(base, NY), { amount: 2000, cap: 2000, charged: 3000 });
const nyFlags = rules.evaluateLease({ ...base, otherMoveInCharges: [{ label: "Pet fee", amount: 250, refundable: false, quote: "nonrefundable pet fee" }] }, NY);
check("NY over-cap deposit is a violation", nyFlags.some((f) => f.id === "N7" && f.severity === "violation"));
check("NY pet fee is barred (RPL 238-a)", nyFlags.some((f) => f.id === "N10" && f.severity === "violation"));
check("NY pet fee is not counted toward the deposit", rules.lawfulDeposit({ ...base, otherMoveInCharges: [{ label: "Pet fee", amount: 250, refundable: false, quote: "x" }] }, NY).charged === 3000);
eq("TX: no cap", rules.lawfulDeposit({ ...base, otherMoveInCharges: [{ label: "Pet deposit", amount: 500, refundable: true, quote: "x" }, { label: "Admin fee", amount: 150, refundable: false, quote: "nonrefundable admin fee" }] }, TX), { amount: 3500, cap: null, charged: 3500 });
eq("FL: no cap", rules.lawfulDeposit(base, FL), { amount: 3000, cap: null, charged: 3000 });
eq("WA: no statewide cap", rules.lawfulDeposit(base, WA), { amount: 3000, cap: null, charged: 3000 });
const txFlags = rules.evaluateLease({ ...base, otherMoveInCharges: [{ label: "Cleaning fee", amount: 200, refundable: false, quote: "nonrefundable cleaning fee" }], lateFee: { amount: 300, percentOfRent: null, deductibleFromDeposit: true, quote: "late fee $300" } }, TX);
check("TX nonrefundable fee is a warning, not a violation", txFlags.some((f) => f.id === "T2" && f.severity === "warning") && !txFlags.some((f) => f.severity === "violation"));
check("TX late fee warns with the safe harbor", txFlags.some((f) => f.id === "T25" && /12%/.test(f.detail)));
check("TX flags the forwarding address", txFlags.some((f) => f.id === "T6"));
const flFlags = rules.evaluateLease({ ...base, ownerUnitCount: 6, nonrefundableLanguage: ["The deposit is nonrefundable."] }, FL);
check("FL nonrefundable deposit clause is void", flFlags.some((f) => f.id === "F24" && f.severity === "violation"));
check("FL five or more units: holding notice", flFlags.some((f) => f.id === "F6" && f.severity === "info"));
check("FL unknown unit count asks", rules.evaluateLease({ ...base, ownerUnitCount: null }, FL).some((f) => f.id === "F6" && f.severity === "warning"));
const waFlags = rules.evaluateLease({ ...base, electronicPaymentMethods: ["PayPal"] }, WA);
check("WA flags the checklist before the deposit", waFlags.some((f) => f.id === "W2"));
check("WA flags electronic-only payment", waFlags.some((f) => f.id === "W16"));
check("WA flags installments over 25% of rent", waFlags.some((f) => f.id === "W10"));
check("every flag carries a citation", Object.values(PACKS).every((p) => rules.evaluateLease(base, p).every((f) => f.cite && f.title && f.detail)));

/* ---------- Documents rules ---------- */
const d = (o = {}) => ({ id: "d1", category: "damage", room: "Bedroom", item: "Carpet", work: "replace", performer: "vendor", amount: 500, math: "x", proration: "none", is_estimate: false, receipt_path: null, after_photo_paths: [], vendor: null, labor_description: null, note: null, finding: { moveOutPath: "p.jpg" }, ...o });
eq("CA: after photo always, invoice and contact over $125", deductions.missingDocs(d(), true, CA), ["after-repair photo", "invoice or receipt", "vendor name, address and phone"]);
eq("CA: $125 or less needs only the after photo", deductions.missingDocs(d(), false, CA), ["after-repair photo"]);
eq("WA: documents for every damage charge, at any amount", deductions.settle(1000, [{ category: "damage", amount: 50 }], WA).documentsRequired, true);
eq("WA: the invoice, not the vendor's contact", deductions.missingDocs(d(), true, WA), ["invoice or receipt"]);
eq("WA: an estimate stands in", deductions.missingDocs(d({ is_estimate: true }), true, WA), []);
eq("NY: nothing required by statute", deductions.settle(1000, [{ category: "damage", amount: 900 }], NY).documentsRequired, false);
eq("NY: nothing blocks", deductions.missingDocs(d(), false, NY), []);
eq("NY: evidence gaps flagged as unsupported", deductions.evidenceGaps(d({ finding: null }), NY), ["photos", "an invoice"]);
eq("TX: some evidence required (product policy)", deductions.missingDocs(d({ finding: null }), false, TX), ["evidence (photos, an invoice or a description of the work)"]);
eq("TX: a move-out photo is evidence", deductions.missingDocs(d(), false, TX), []);
eq("FL: nothing blocks", deductions.missingDocs(d({ finding: null }), false, FL), []);
eq("rent never needs documents", deductions.missingDocs(d({ category: "rent" }), true, CA), []);

/* ---------- Steps each state adds ---------- */
const today = "2026-10-03";
const sum = (o = {}) => ({
  id: "t1", state: "CA", address: "1 Test St, Testville, CA 90000", city: "Testville", landlord: "Pat Owner", tenants: ["A Tenant"], monthlyRent: 2000, status: "active",
  startDate: "2026-01-01", endDate: "2026-12-31", noticeGivenOn: null, plannedMoveOut: null, moveOutDate: null, moveOutInspectedAt: null, statementDeliveredAt: null,
  agreement: true, deposit: { amount: 2000, status: "PAID", paypalId: "INV2-TEST" }, depositElectronic: true, moveInPhotos: 4, moveOutPhotos: 0,
  deductions: [], returned: null, notices: {}, refundNotice: { needed: false, reason: "" }, tenantMoveOut: null, ...o,
});
// Every step reached through next(), with the summary it came from: the step links' check at the end reads them all.
const reached = [];
const next = (o) => {
  const s = sum(o), n = nextStepLib.nextStep(s, today);
  reached.push([s, n]);
  return n;
};
eq("WA: the checklist comes before the deposit invoice", next({ state: "WA", deposit: null, agreement: true }).label, "Record the signed move-in checklist");
eq("WA: then the invoice", next({ state: "WA", deposit: null, notices: { move_in_checklist: { date: "2026-01-01", method: "signed", to: "A Tenant", recorded_at: "x" } } }).label, "Send the PayPal deposit invoice");
eq("WA: then the trust account", next({ state: "WA", notices: { move_in_checklist: { date: "2026-01-01", method: "signed", to: "A Tenant", recorded_at: "x" } } }).label, "Record the trust account and send the receipt");
eq("WA: no agreement blocks first (product policy)", next({ state: "WA", agreement: false }).label, "Record the tenants' refund agreement");
eq("TX: no agreement step once the invoice is out", next({ state: "TX", agreement: false }).label, "Check in 60 days before the lease ends");
eq("TX: the PayPal account first when there is no invoice", next({ state: "TX", agreement: false, deposit: null }).label, "Record the tenants' PayPal account");
const moved = { moveOutDate: "2026-09-30", moveOutPhotos: 3, moveOutInspectedAt: "2026-10-01T18:00:00Z", noticeGivenOn: "2026-09-01", plannedMoveOut: "2026-09-30" };
eq("TX: a written forwarding address before the statement", next({ state: "TX", ...moved }).label, "Get the forwarding address in writing");
eq("TX: the tenant link's address counts", next({ state: "TX", ...moved, tenantMoveOut: { name: "A Tenant", plannedMoveOut: "2026-09-30", forwardingAddress: "9 Elm St, Austin, TX 78701", sentOn: "2026-09-01" } }).due, "2026-10-30");
const txNotice = { state: "TX", status: "moving_out", noticeGivenOn: "2026-09-13", plannedMoveOut: "2026-10-13" };
const askAddress = next(txNotice);
eq("TX: before the move-out, ask for the forwarding address", [askAddress.label, askAddress.due, askAddress.deadline, askAddress.dueLabel, askAddress.action?.path],
  ["Get the forwarding address in writing", "2026-10-13", false, "Planned move-out", "notices/forwarding-address"]);
eq("TX: a recorded address leaves the move-out", next({ ...txNotice, notices: { forwarding_address: { date: "2026-09-20", method: "email", to: "A Tenant", recorded_at: "x", detail: "9 Elm St, Austin, TX 78701" } } }).label, "Move-out");
eq("TX: the tenant link's address leaves the move-out", next({ ...txNotice, tenantMoveOut: { name: "A Tenant", plannedMoveOut: "2026-10-13", forwardingAddress: "9 Elm St, Austin, TX 78701", sentOn: "2026-09-13" } }).label, "Move-out");
eq("TX: from the move-out day, recording the move-out comes first", nextStepLib.nextStep(sum({ ...txNotice, plannedMoveOut: "2026-10-03" }), today).label, "Move-out");
eq("CA: no step of its own before the move-out", next({ status: "moving_out", noticeGivenOn: "2026-09-13", plannedMoveOut: "2026-10-13", notices: { inspection: { date: "2026-09-15", method: "mail", to: "A Tenant", recorded_at: "x" } } }).label, "Move-out");
eq("NY: offer the move-in inspection", next({ state: "NY" }).label, "Offer the move-in inspection");
const offered = { move_in_inspection: { date: "2025-12-20", method: "mail", to: "A Tenant", recorded_at: "x" }, deposit_account: { date: "2026-01-02", method: "mail", to: "A Tenant", recorded_at: "x", detail: "Bank" } };
eq("NY: the inspection-rights notice after notice", next({ state: "NY", notices: offered, noticeGivenOn: "2026-09-25", plannedMoveOut: "2026-10-31" }).label, "Send the inspection-rights notice");
eq("NY: no rights notice owed on the tenants' short notice", next({ state: "NY", notices: offered, noticeGivenOn: "2026-09-25", noticeGivenBy: "tenant", plannedMoveOut: "2026-10-05" }).label, "Move-out");
eq("NY: the landlord's short notice still owes it", next({ state: "NY", notices: offered, noticeGivenOn: "2026-09-25", noticeGivenBy: "landlord", plannedMoveOut: "2026-10-05" }).label, "Send the inspection-rights notice");
eq("NY: a short notice with no giver recorded still owes it", next({ state: "NY", notices: offered, noticeGivenOn: "2026-09-25", plannedMoveOut: "2026-10-05" }).label, "Send the inspection-rights notice");
check("NY: excused only for the tenants' short notice", nextStepLib.inspectionExcused(sum({ state: "NY", noticeGivenOn: "2026-09-25", noticeGivenBy: "tenant", plannedMoveOut: "2026-10-05" }))
  && !nextStepLib.inspectionExcused(sum({ state: "NY", noticeGivenOn: "2026-09-25", noticeGivenBy: "landlord", plannedMoveOut: "2026-10-05" }))
  && !nextStepLib.inspectionExcused(sum({ state: "CA", noticeGivenOn: "2026-09-25", noticeGivenBy: "tenant", plannedMoveOut: "2026-10-05" })));
eq("NY: statement due in 14 days", next({ state: "NY", notices: offered, ...moved }).due, "2026-10-14");
const claimed = { ...moved, deductions: [{ category: "damage", amount: 400 }] };
eq("FL: a claim needs the certified-mail notice", next({ state: "FL", ...claimed }).label, "Send the claim notice by certified mail");
eq("FL: the claim notice is due 30 days after the end", next({ state: "FL", ...claimed }).due, "2026-10-30");
eq("FL: certified mail needs the delivery date", next({ state: "FL", ...claimed, notices: { claim_notice: { date: "2026-10-02", method: "certified", to: "A Tenant", recorded_at: "x", detail: "9407" } } }).label, "Record when the tenants received the claim notice");
eq("FL: then the objection window", next({ state: "FL", ...claimed, notices: { claim_notice: { date: "2026-10-01", method: "certified", to: "A Tenant", recorded_at: "x", detail: "9407", received: "2026-10-02" } } }).due, "2026-10-17");
eq("FL: no claim, 15 days", next({ state: "FL", ...moved }).due, "2026-10-15");
eq("CA unchanged: statement due 21 days", next({ state: "CA", ...moved }).due, "2026-10-21");
// N21, a hard block since 2026-10-04: an old acknowledgment record (the override it replaced) changes nothing.
const ack = { late_acknowledgment: { date: "2026-10-20", method: "signed", to: null, recorded_at: "x", detail: "Keys came back on 10-05" } };
const nyLateStep = next({ state: "NY", notices: offered, ...moved, moveOutDate: "2026-09-10", deductions: [{ category: "damage", amount: 300 }] });
eq("NY: after day 14 the step is the full refund", [nyLateStep.label, nyLateStep.level, nyLateStep.cite, nyLateStep.action?.path], ["Day 14 has passed: refund in full", "overdue", "N.Y. GOL 7-108(1-a)(e)", "?tab=move-out#deductions"]);
eq("NY: an old acknowledgment no longer moves it on", next({ state: "NY", notices: { ...offered, ...ack }, ...moved, moveOutDate: "2026-09-10", deductions: [{ category: "damage", amount: 300 }] }).label, "Day 14 has passed: refund in full");
eq("NY: on the last day the statement is still the step", next({ state: "NY", notices: offered, ...moved, moveOutDate: "2026-09-19", deductions: [{ category: "damage", amount: 300 }] }).label, "Send the itemized statement and refund");
eq("NY: no deductions, nothing forfeited", next({ state: "NY", notices: offered, ...moved, moveOutDate: "2026-09-10" }).label, "Send the itemized statement and refund");
const nyOut = { state: "NY", notices: offered, ...moved, moveOutDate: "2026-09-10", deductions: [{ category: "damage", amount: 300 }] };
eq("NY: statement out on time, refund still owed after day 14: the full refund", next({ ...nyOut, statementDeliveredAt: "2026-09-20T17:00:00Z", statementDeliveredOn: "2026-09-20" }).label, "Day 14 has passed: refund in full");
eq("NY: statement out on day 15: the full refund", next({ ...nyOut, statementDeliveredAt: "2026-09-25T17:00:00Z", statementDeliveredOn: "2026-09-25", deductions: [{ category: "damage", amount: 2500 }] }).label, "Day 14 has passed: refund in full");
eq("NY: statement on time and the deductions use the whole deposit: done", next({ ...nyOut, statementDeliveredAt: "2026-09-20T17:00:00Z", statementDeliveredOn: "2026-09-20", deductions: [{ category: "damage", amount: 2500 }] }).label, "Done");
const nyDisputed = next({ ...nyOut, statementDeliveredAt: "2026-09-20T17:00:00Z", statementDeliveredOn: "2026-09-20", dispute: "open" });
eq("NY: under a live dispute the step is the whole deposit, sent as it is (the deductions can't be removed)", [nyDisputed.label, nyDisputed.action?.path, /whole deposit/.test(nyDisputed.detail)], ["Day 14 has passed: refund in full", "refund", true]);
eq("NY: a live dispute before day 14 leaves the usual refund step", next({ ...nyOut, moveOutDate: "2026-09-25", statementDeliveredAt: "2026-09-28T17:00:00Z", statementDeliveredOn: "2026-09-28", dispute: "open" }).label, "Send the refund");
// "Remove deductions" (a dead click until 2026-10-09: it linked to the Move-out tab it was shown on, with no section).
// The step opens the Deductions card, and it alone carries removeDeductions: the one rule the card's "Remove all
// deductions" and the route behind it (DELETE /api/tenancies/[id]/deductions) read, so neither runs in any other state.
const linkOf = (o) => propertyView.stepLink(sum(o), next(o));
eq("NY: Remove deductions opens the Deductions card on the Move-out tab", [linkOf(nyOut).label, linkOf(nyOut).href], ["Remove deductions", "/tenancy/t1?tab=move-out#deductions"]);
eq("NY: the same address tabHref gives every other section link", linkOf(nyOut).href, propertyView.tabHref("t1", "move-out", "deductions"));
const nyOutLate = { ...nyOut, statementDeliveredAt: "2026-09-20T17:00:00Z", statementDeliveredOn: "2026-09-20" };
eq("NY: the step asks for every deduction to come off, before the statement and after it", [nyLateStep.removeDeductions, next(nyOutLate).removeDeductions], [true, true]);
eq("NY: not under a live dispute, where the deductions stay on file", [nyDisputed.removeDeductions, nyDisputed.action?.label], [undefined, "Send refund"]);
eq("NY: not before day 14 has passed", next({ ...nyOut, moveOutDate: "2026-09-19" }).removeDeductions, undefined);
eq("NY: not once the refund went (the rest is owed from PayPal)", next({ ...nyOutLate, returned: { amount: 1700, kind: "refund" }, forfeited: true }).removeDeductions, undefined);
eq("NY: not once refunds made in PayPal returned the whole deposit", next({ ...nyOutLate, outside: 2000 }).removeDeductions, undefined);
eq("NY: with the deductions gone the step moves on to the refund", [next({ ...nyOut, deductions: [] }), next({ ...nyOutLate, deductions: [] })].map((n) => [n.label, n.removeDeductions]),
  [["Send the itemized statement and refund", undefined], ["Send the refund", undefined]]);
for (const state of ["CA", "FL", "TX", "WA"]) {
  const late = { state, ...moved, moveOutDate: "2026-07-01", deductions: [{ category: "damage", amount: 300 }], tenantMoveOut: { name: "A Tenant", plannedMoveOut: "2026-07-01", forwardingAddress: "9 Elm St", sentOn: "2026-06-01" } };
  check(`${state}: no step ever asks for every deduction to come off`, [late, { ...late, statementDeliveredAt: "2026-09-25T17:00:00Z" }, { ...late, dispute: "open" }].every((o) => !next(o).removeDeductions));
}
// The same kind of dead click: the PayPal account step (New York, Texas, Florida) linked to the Overview it is shown on.
eq("TX: Record the tenants' PayPal account opens the Move-in card", linkOf({ state: "TX", agreement: false, deposit: null }).href, "/tenancy/t1#move-in");
eq("CA: Record agreement still opens the Move-in card", [linkOf({ agreement: false }).label, linkOf({ agreement: false }).href], ["Record agreement", "/tenancy/t1#move-in"]);
const objected = (date) => ({ claim_notice: { date: "2026-09-15", method: "certified", to: "A", recorded_at: "x", detail: "9407", received: "2026-09-17" }, claim_objection: { date, method: "mail", to: "A", recorded_at: "x" } });
eq("FL: a timely objection: refund the undisputed balance", next({ state: "FL", ...claimed, moveOutDate: "2026-09-01", notices: objected("2026-09-25") }).label, "Refund the undisputed balance");
eq("FL: the undisputed balance is due 30 days after the notice", next({ state: "FL", ...claimed, moveOutDate: "2026-09-01", notices: objected("2026-09-25") }).due, "2026-10-15");
eq("FL: a late objection leaves the claim to be deducted", next({ state: "FL", ...claimed, moveOutDate: "2026-09-01", notices: objected("2026-10-05") }).label, "Send the itemized statement and refund");

/* ---------- Close-out blockers each state adds ---------- */
const facts = (o = {}) => ({ today, tenancy: { address: "x", tenants: ["A Tenant"], moveOutDate: "2026-09-10", statementDue: null, daysLeft: -9 }, deposit: { status: "PAID" }, refundAgreement: null, deductions: [{ item: "Carpet", category: "damage", amount: 400 }], totals: {}, alreadyReturned: null, plan: {}, blockers: [], warnings: [], rules: {}, ...o });
const ctx = (o = {}) => ({ today, notices: {}, forwarding: null, endDate: null, plannedMoveOut: null, deductionsCount: 1, ...o });
const nyFacts = (due, o = {}) => facts({ tenancy: { address: "x", tenants: ["A"], moveOutDate: "2026-09-10", statementDue: due, daysLeft: -9 }, totals: { deductions: 400 }, ...o });
check("NY: day 14 passed forfeits the deductions", NY.close.extraBlockers(nyFacts("2026-09-24"), ctx()).some((b) => /forfeits/.test(b) && /N\.Y\. GOL 7-108\(1-a\)\(e\)/.test(b)));
check("NY: nothing to forfeit without deductions", NY.close.extraBlockers(nyFacts("2026-09-24", { deductions: [] }), ctx()).length === 0);
eq("NY GCL 25-a: a Saturday day 14 before Columbus Day runs to Tuesday", NY.deadline.lastDay("2026-10-10"), "2026-10-13");
eq("NY GCL 25-a: general election day", NY.deadline.lastDay("2026-11-03"), "2026-11-04");
eq("NY GCL 25-a: a Sunday Independence Day moves to Monday", NY.deadline.lastDay("2027-07-04"), "2027-07-06");
eq("NY GCL 25-a: Lincoln's Birthday", NY.deadline.lastDay("2026-02-12"), "2026-02-13");
eq("NY GCL 25-a: a weekday is itself", NY.deadline.lastDay("2026-10-14"), "2026-10-14");
check("NY: no forfeiture on the day 25-a allows", NY.close.extraBlockers(nyFacts("2026-10-10"), ctx({ today: "2026-10-13" })).length === 0);
check("NY: forfeiture the day after it", NY.close.extraBlockers(nyFacts("2026-10-10"), ctx({ today: "2026-10-14" })).some((b) => /General Construction Law 25-a/.test(b)));
check("NY: the late warning says the extension holds", /still on time/.test(NY.deadline.lateWarning(2, "2026-10-10")) && /forfeits/.test(NY.deadline.lateWarning(4, "2026-10-10")));
// The hard block (N21, 2026-10-04): nothing the landlord records lifts it, the blocker names no way to keep a deduction,
// and the cases on both sides of day 14 (as GCL 25-a runs it) for the statement and for the rest of the deposit.
check("NY: an acknowledgment no longer lifts the block", NY.close.extraBlockers(nyFacts("2026-09-24"), ctx({ notices: ack })).length === 1);
check("NY: the blocker offers no override", NY.close.extraBlockers(nyFacts("2026-09-24"), ctx()).every((b) => !/acknowledg|record why/i.test(b) && /remove the deductions/.test(b)));
check("NY: no record lets a deduction stay", !NY.records.some((r) => r.kind === "late_acknowledgment"));
const owed = (o = {}) => nyFacts("2026-09-24", { totals: { deductions: 400, refund: 1600 }, ...o });
check("NY: statement on day 14, refund still owed on day 14: not yet late", NY.close.extraBlockers(owed(), ctx({ today: "2026-09-24", deliveredOn: "2026-09-24" })).length === 0);
check("NY: statement on time, refund still owed the day after: forfeited", NY.close.extraBlockers(owed(), ctx({ today: "2026-09-25", deliveredOn: "2026-09-20" })).some((b) => /before the rest of the deposit went back/.test(b)));
check("NY: statement on time, nothing left to refund: no block after day 14", NY.close.extraBlockers(nyFacts("2026-09-24", { totals: { deductions: 2000, refund: 0 } }), ctx({ deliveredOn: "2026-09-20" })).length === 0);
check("NY: statement delivered on day 15, nothing owed: forfeited", NY.close.extraBlockers(nyFacts("2026-09-24", { totals: { deductions: 2000, refund: 0 } }), ctx({ deliveredOn: "2026-09-25" })).some((b) => /before the itemized statement went out/.test(b)));
check("NY: the refund already sent: nothing more the close-out can do", NY.close.extraBlockers(nyFacts("2026-09-24", { alreadyReturned: { kind: "refund", amount: 1600, paypalId: "R", at: "2026-09-20T00:00:00Z" } }), ctx()).length === 0);
check("NY: a dispute the tenants sent: no block, and the refund is the whole deposit",
  NY.close.extraBlockers(owed(), ctx({ deliveredOn: "2026-09-20", disputeLive: true })).length === 0
  && NY.close.extraWarnings(owed(), ctx({ deliveredOn: "2026-09-20", disputeLive: true })).some((w) => /returns the whole deposit/.test(w) && /no more money/.test(w)));
check("NY: no dispute, no such warning", !NY.close.extraWarnings(owed(), ctx({ deliveredOn: "2026-09-20" })).some((w) => /settlement/.test(w)));
check("NY GCL 25-a: a Saturday day 14, statement on the Tuesday after Columbus Day: on time", NY.close.extraBlockers(nyFacts("2026-10-10", { totals: { deductions: 400, refund: 0 } }), ctx({ today: "2026-10-20", deliveredOn: "2026-10-13" })).length === 0);
check("NY GCL 25-a: on the Wednesday: forfeited", NY.close.extraBlockers(nyFacts("2026-10-10", { totals: { deductions: 400, refund: 0 } }), ctx({ today: "2026-10-20", deliveredOn: "2026-10-14" })).length === 1);
const nyStanding = (o) => NY.close.standing({ today, notices: ack, claimed: 400, statementDue: "2026-09-24", deliveredOn: null, returnedOn: null, refundOwed: true, ...o });
eq("NY: the statement prints the deductions as forfeited, the whole deposit owed", [nyStanding({})?.label, nyStanding({})?.forfeits, /N\.Y\. GOL 7-108\(1-a\)\(e\)/.test(nyStanding({})?.note ?? "")], ["Forfeited after day 14", true, true]);
eq("NY: no standing before day 14", nyStanding({ today: "2026-09-20" }), null);
eq("NY: no standing when the statement and the refund both went by day 14", nyStanding({ deliveredOn: "2026-09-23", returnedOn: "2026-09-24" }), null);
eq("NY: a refund sent on day 15 is forfeited", nyStanding({ deliveredOn: "2026-09-23", returnedOn: "2026-09-25" })?.label, "Forfeited after day 14");
eq("NY: no standing without deductions", nyStanding({ claimed: 0 }), null);
const nyLate = (await lib("states/ny")).nyLate;
eq("nyLate: day 14 itself is on time", nyLate({ due: "2026-10-15", today: "2026-10-15", deliveredOn: "2026-10-15", returnedOn: "2026-10-15", refundOwed: true })?.late, false);
eq("nyLate: day 15 is late", nyLate({ due: "2026-10-15", today: "2026-10-16", deliveredOn: "2026-10-16", returnedOn: null, refundOwed: false })?.missed, "statement");
eq("nyLate: an undone refund is late once the last day is behind", nyLate({ due: "2026-10-15", today: "2026-10-16", deliveredOn: "2026-10-14", returnedOn: null, refundOwed: true })?.missed, "refund");
eq("nyLate: an undone refund is not late before it", nyLate({ due: "2026-10-15", today: "2026-10-15", deliveredOn: "2026-10-14", returnedOn: null, refundOwed: true })?.late, false);
eq("nyLate: no move-out, no answer", nyLate({ due: null, today, deliveredOn: null, returnedOn: null, refundOwed: true }), null);
const flFacts = (o = {}) => facts({ tenancy: { address: "x", tenants: ["A"], moveOutDate: "2026-09-01", statementDue: "2026-10-15", daysLeft: 12 }, totals: { deductions: 400 }, ...o });
check("FL: an objection inside the window ends the wait", FL.close.extraBlockers(flFacts(), ctx({ today: "2026-09-25", notices: objected("2026-09-25") })).length === 0);
check("FL: a timely objection makes the claim disputed", FL.close.extraWarnings(flFacts(), ctx({ notices: objected("2026-09-25") })).some((w) => /undisputed balance/.test(w)));
eq("FL: the statement prints it as disputed", FL.close.standing({ today, notices: objected("2026-09-25"), claimed: 400, statementDue: "2026-10-15" })?.label, "Claimed, disputed");
eq("FL: a late objection is not a dispute", FL.close.standing({ today, notices: objected("2026-10-05"), claimed: 400, statementDue: "2026-10-15" }), null);
check("FL: a late objection is said to be late", FL.close.extraWarnings(flFacts(), ctx({ notices: objected("2026-10-05") })).some((w) => /after the 15 days/.test(w)));
eq("FL: the objection record says whether it came in time", FL.records.find((r) => r.kind === "claim_objection").status(objected("2026-09-25"))?.tone, "amber");
check("FL: the holding notice prints the (2)(d) disclosure", JSON.stringify(FL.records.find((r) => r.kind === "holding_notice").draftBody({ landlord: "L", tenants: "T", address: "A", today, noticeGivenOn: null, endDate: null, ends: null, windowOpens: null, windowCloses: null, due: null, deposit: null, claim: null, multipleTenants: false })).includes("THIS DISCLOSURE IS BASIC"));
eq("FL: deadline words with no claim", states.deadlineWords(FL, { moveOutDate: "2026-09-01", endDate: null, plannedMoveOut: null, claimed: false }).due, "Statement and refund due");
eq("FL: deadline words before the claim notice", states.deadlineWords(FL, { moveOutDate: "2026-09-01", endDate: null, plannedMoveOut: null, claimed: true }).due, "Claim notice due");
eq("FL: deadline words after it", states.deadlineWords(FL, { moveOutDate: "2026-09-01", endDate: null, plannedMoveOut: null, claimed: true, claimNoticeDate: "2026-09-15" }).within, "Within 30 days of the claim notice");
eq("CA: deadline words never change", states.deadlineWords(CA, { moveOutDate: "2026-09-01", endDate: null, plannedMoveOut: null, claimed: true }).within, "Within the 21 days");
eq("CA: the deadline's label is unchanged", states.deadlineWords(CA, { moveOutDate: "2026-09-01", endDate: null, plannedMoveOut: null }).due, "Statement and refund due");
eq("TX: the deadline in the statute's words", states.deadlineWords(TX, { moveOutDate: "2026-09-01", endDate: null, plannedMoveOut: null }), { due: "Refund and itemized list due", within: "Within the 30 days", title: "30-day deadline" });
// The tenants' signed refund record: an agreement where a PayPal refund needs one, otherwise their designation.
eq("CA: the refund record is an agreement", [states.refundRecordWords(CA).name, states.refundRecordWords(CA).check], ["Refund agreement", "Refund by PayPal agreed in writing"]);
eq("WA: an agreement too (product policy)", states.refundRecordWords(WA).name, "Refund agreement");
for (const k of ["TX", "NY", "FL"]) eq(`${k}: the refund record is the account, never an agreement`, [states.refundRecordWords(PACKS[k]).name, states.refundRecordWords(PACKS[k]).check], ["Refund account", "Refund account designated in writing"]);
eq("TX: no city on the interest line (no local deposit rules in Texas)", TX.statement.interest("Austin", { buildingUnits: 4, notices: {} }).city, null);
check("TX: the penalty says wrongfully", /wrongfully withheld/.test(TX.chip.text) && /wrongfully withheld/.test(TX.deadline.railText));
check("FL: the 7-day notice tip names the method", /certified mail or in person/.test(FL.tenant.mailTip(false).text));
check("FL: no notice by day 30 forfeits the claim", FL.close.extraBlockers(facts({ tenancy: { moveOutDate: "2026-08-20" } }), ctx()).some((b) => /forfeited/.test(b)));
check("FL: a notice sent after day 30 forfeits too", FL.close.extraBlockers(facts({ tenancy: { moveOutDate: "2026-08-20" } }), ctx({ notices: { claim_notice: { date: "2026-09-25", method: "certified", to: "A", recorded_at: "x", detail: "9407", received: "2026-09-27" } } })).some((b) => /forfeited/.test(b)));
check("FL: inside 30 days asks for the notice", FL.close.extraBlockers(facts({ tenancy: { moveOutDate: "2026-09-25" } }), ctx()).some((b) => /Send the claim notice first/.test(b)));
check("FL: the objection window holds the deduction", FL.close.extraBlockers(facts({ tenancy: { moveOutDate: "2026-09-25" } }), ctx({ notices: { claim_notice: { date: "2026-09-28", method: "email", to: "A", recorded_at: "x", detail: "a@b.c" } } })).some((b) => /may object until/.test(b)));
check("WA: no checklist bars damage deductions", WA.close.extraBlockers(facts(), ctx()).some((b) => /checklist/.test(b)));
check("WA: rent may stay without a checklist", WA.close.extraBlockers(facts({ deductions: [{ item: "Rent", category: "rent", amount: 400 }] }), ctx()).length === 0);
check("TX: no forwarding address blocks the refund", TX.close.extraBlockers(facts(), ctx()).some((b) => /forwarding address/.test(b)));
check("TX: a recorded address clears it", TX.close.extraBlockers(facts(), ctx({ notices: { forwarding_address: { date: "2026-09-12", method: "email", to: "A", recorded_at: "x", detail: "9 Elm St" } } })).length === 0);
check("CA adds no blockers", CA.close.extraBlockers(facts(), ctx()).length === 0);

/* ---------- The shape every pack shares ---------- */
const keys = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof RegExp) && !["rules", "findings", "short", "tags"].includes(k) ? keys(v, `${p}${k}.`) : [`${p}${k}`])).sort();
// Optional hooks a state has only when its rule does (an inspection notice, a claim track, a weekend extension).
const optional = (k) => k.startsWith("notices.inspection.") || k.startsWith("steps.flow.inspection") || k.startsWith("dispute.documentsCure."); // null where the state has none
const caKeys = keys(CA).filter((k) => !optional(k));
for (const [code, p] of Object.entries(PACKS)) {
  const pk = keys(p).filter((k) => !optional(k));
  const missing = caKeys.filter((k) => !pk.includes(k));
  check(`${code}: same shape as California`, !missing.length, `missing ${missing.join(", ")}`);
  check(`${code}: four disclaimers`, p.copy.disclaimers.length === 4);
  check(`${code}: the agent's rules name the deadline, refund method, roommates, documents and PayPal's window`, ["deadline", "electronicRefund", "roommates", "documents", "refundWindow"].every((k) => p.close.rules[k]));
  check(`${code}: the agent cites only its own state's rules`, Object.values(p.close.rules).every((r) => code === "CA" || !/Civ\. Code 1950\.5/.test(r)));
  check(`${code}: the agent prompt names the state`, p.ai.closeOutSystem.includes(p.name));
  const kinds = findings.kindsFor(p);
  check(`${code}: every finding kind cites a rule`, ["damage", "cleaning", "wear_and_tear", "unclear"].every((k) => kinds[k].cite && kinds[k].label));
  for (const r of p.records) {
    check(`${code}: record ${r.kind} is one the database accepts`, ["inspection", "electronic_refund", "move_in_inspection", "deposit_account", "holding_notice", "move_in_checklist", "forwarding_address", "claim_notice", "claim_objection", "late_acknowledgment"].includes(r.kind));
    if (r.draftBody) {
      const blocks = r.draftBody({ landlord: "L", tenants: "T", address: "A", today, noticeGivenOn: "2026-09-01", endDate: "2026-12-31", ends: "2026-10-31", windowOpens: "2026-10-17", windowCloses: "2026-10-24", due: "2026-11-14", deposit: { amount: 2000, paypalId: "INV2" }, claim: { total: 400, items: ["Carpet, $400.00"] }, multipleTenants: false });
      check(`${code}: ${r.kind} draft has text`, blocks.length > 0);
    }
  }
  // The checklist grades a statement without throwing, numbered 1 to n.
  const statement = { tenancyId: "t", state: code, today, statementDate: today, landlord: "L", property: { address: "A", city: "Seattle" }, tenants: ["T"], tenantContacts: [], moveOutDate: "2026-09-30", statementDue: "2026-10-30", daysLeft: 27,
    security: { amount: 2000, paid: true, electronic: true, live: true, paidAt: "2026-01-01T00:00:00Z", method: "PAYPAL", invoiceId: "INV2", invoiceStatus: "PAID", leaseAsked: 2000, cap: null, basisNote: null },
    deductions: [{ id: "x", n: 1, category: "damage", tag: "t", tagLabel: "Damage", room: "R", item: "Carpet", work: "replace", amount: 400, explanation: "x", note: null, proration: "none", guidance: false, isEstimate: false, labor: null, vendor: { name: "V", address: null, phone: null, invoicePath: "i.pdf" }, photos: [{ role: "move_out_before", label: "b", path: "p" }], missing: [] }],
    totals: { depositHeld: 2000, deductions: 400, refund: 1600, balanceClaimed: 0, documentsRequired: true, repairAndCleaning: 400 }, documents: { required: true, note: "n" },
    refund: { amount: 1600, state: "due", method: "m", paypalId: null, sentAt: null, paypalEmail: null, payees: ["T"], agreement: null, note: "note" }, balanceClaimed: null,
    interest: p.statement.interest("Seattle", { buildingUnits: 2, notices: {} }), delivery: null, deliveredAt: null, tenantForwarding: null, checklist: [] };
  const items = p.statement.checklist(statement, { moveInPhotosRequired: false, documentsRequired: true, notices: {} });
  check(`${code}: checklist numbered 1 to ${items.length}`, items.every((it, i) => it.n === i + 1 && ["done", "missing", "not_applicable"].includes(it.state) && it.reason));
  check(`${code}: checklist short labels cover every item`, items.every((it) => p.statement.short[it.n]));
}
{
  const st = (wear) => ({ tenants: ["T"], property: { address: "A" }, moveOutDate: "2026-09-30", statementDate: today, statementDue: "2026-10-30", deductions: [], totals: { depositHeld: 0 }, security: null, refund: { state: "none", method: "m", note: "" }, interest: { known: false, checkReason: "r" }, balanceClaimed: null, delivery: null, ...(wear ? { wear } : {}) });
  const item = (p, s, n) => p.statement.checklist(s, { moveInPhotosRequired: false, documentsRequired: false, notices: {} }).find((i) => i.n === n);
  eq("TX: wear findings listed at $0 grade done", item(TX, st([{ item: "Scuffed paint", room: "Hall" }]), 4).state, "done");
  eq("TX: no wear findings is not applicable", item(TX, st([]), 4).state, "not_applicable");
  const ny6 = (ending) => NY.statement.checklist(st(), { moveInPhotosRequired: false, documentsRequired: false, notices: {}, ending }).find((i) => i.n === 6).state;
  eq("NY item 6: the tenants' short notice excuses it", ny6({ givenOn: "2026-09-25", givenBy: "tenant", ends: "2026-10-05" }), "not_applicable");
  eq("NY item 6: owed after the landlord's notice and not recorded", ny6({ givenOn: "2026-09-25", givenBy: "landlord", ends: "2026-10-05" }), "missing");
}
check("California's checklist has 13 items", CA.statement.checklist({ tenants: [], property: { address: "" }, moveOutDate: null, deductions: [], totals: { depositHeld: 0 }, documents: { required: false }, security: null, refund: { agreement: null, state: "none", method: "m" }, interest: { known: false, checkReason: "r" }, balanceClaimed: null, delivery: null }, { moveInPhotosRequired: false, documentsRequired: false, notices: {} }).length === 13);

/* ---------- Copy rules: no em dashes, no emojis in the packs ---------- */
for (const f of readdirSync(join(ROOT, "src/lib/states")).filter((x) => x.endsWith(".ts"))) {
  const text = readFileSync(join(ROOT, "src/lib/states", f), "utf8");
  check(`${f}: no em dashes`, !text.includes("\u2014"));
  check(`${f}: no emojis`, !/\p{Extended_Pictographic}/u.test(text));
  // A step that opens one of the property's tabs can be shown on that very tab: without a section it would go nowhere.
  check(`${f}: a step that opens a tab names its section`, !/path: "\?[^"#]*"/.test(text));
}
check("Local overlays only warn: Seattle matches", states.localOverlays(WA, "Seattle").length === 1);
check("Local overlays only warn: New York City matches Brooklyn", states.localOverlays(NY, "Brooklyn").length === 1);
check("California shows no local overlay", states.localOverlays(CA, "San Francisco").length === 0);

/* ---------- Step links: another page, or a section of a tab ---------- */
// A step's link is shown on the property too (the record header, the Overview's Next step card) and in the bell on
// every page, so it can be clicked on the very tab it opens, where a link to the bare tab changes nothing (the dead
// clicks of 2026-10-09: Remove deductions, Review findings, View invoice, Check PayPal, View dates). So every step link
// opens another page of the property (a notice, the statement, the refund review) or names a section, and the section
// is an id that page draws. The one link with nothing to open is Nothing due's "View": a list's way into the property,
// which the property's own Next step card shows as words with no button.
const HOME = "/tenancy/t1";
const PAGES = join(ROOT, "src/app/(landlord)/tenancy/[id]");
// The ids a page draws: its own file and the pieces beside it ("" is the property, "/statement" the statement).
const idsOn = (page) => (existsSync(join(PAGES, page)) ? readdirSync(join(PAGES, page)).filter((f) => f.endsWith(".tsx")) : [])
  .flatMap((f) => [...readFileSync(join(PAGES, page, f), "utf8").matchAll(/\sid="([a-z-]+)"/g)].map((m) => m[1]));
const opens = (href) => {
  const u = new URL(href, "http://good-faith.test");
  const page = u.pathname.startsWith(HOME) ? u.pathname.slice(HOME.length) : null;
  const section = u.hash.slice(1);
  return page != null && (section ? idsOn(page).includes(section) : page.length > 1);
};
check("step links: a bare tab and the bare property open nothing new", !opens(`${HOME}?tab=move-out`) && !opens(HOME) && !opens(`${HOME}?tab=payments#no-such-card`));
check("step links: a section the tab draws, and another page, do", opens(`${HOME}?tab=move-out#deductions`) && opens(`${HOME}/refund`) && opens(`${HOME}/statement#delivery`));

// California's steps link by label (property-view.ts). Each label it names, one scenario each, so the labels there are
// the ones the engine really reaches, and each reached step's link is checked below with every other state's.
const viewSource = readFileSync(join(ROOT, "src/lib/property-view.ts"), "utf8");
const branches = viewSource.slice(viewSource.indexOf("function step(")).split("\n").filter((l) => /^\s*if \(L\b/.test(l));
const exact = branches.flatMap((l) => [...l.matchAll(/L === "([^"]+)"/g)].map((m) => m[1]));
const prefixes = branches.flatMap((l) => [...l.matchAll(/L\.startsWith\("([^"]+)"\)/g)].map((m) => m[1]));
check("step links: every label property-view.ts names is read here", branches.length >= 20
  && branches.every((l) => /L === "|L\.startsWith\("|L === REVERSED_STEP|L === packOf\(s\)\.refund\.agreementStep\.label/.test(l)), `${branches.length} branches`);
const noticed = { status: "moving_out", noticeGivenOn: "2026-09-13", plannedMoveOut: "2026-10-13" };
const inspectionSent = { inspection: { date: "2026-09-15", method: "mail", to: "A Tenant", recorded_at: "x" } };
const out2 = { ...moved, statementDeliveredAt: "2026-10-02T18:00:00Z" };
for (const o of [
  {}, { endDate: "2026-11-15" }, { endDate: "2026-09-01" }, { endDate: null }, { moveInPhotos: 0 }, { moveInPhotos: 0, startDate: "2025-01-01" },
  { deposit: { amount: 2000, status: "SENT", paypalId: "INV2-TEST" } }, { deposit: { amount: 2000, status: "PAID", paypalId: "INV2-TEST", reversed: true } }, { deposit: null }, { agreement: false },
  noticed, { ...noticed, notices: inspectionSent, refundNotice: { needed: true, reason: "" } }, { ...noticed, notices: inspectionSent, refundNotice: { needed: null, reason: "" } },
  { ...noticed, notices: inspectionSent, plannedMoveOut: null, endDate: null }, { ...noticed, notices: inspectionSent, plannedMoveOut: "2026-10-30" }, { ...noticed, notices: inspectionSent },
  { tenantMoveOut: { name: "A Tenant", plannedMoveOut: "2026-11-30", forwardingAddress: "9 Elm St", sentOn: "2026-10-01" } },
  { ...moved, moveOutPhotos: 0, moveOutInspectedAt: null }, { ...moved, moveOutInspectedAt: null }, moved, { ...moved, returned: { amount: 2000, kind: "refund" } },
  out2, { ...out2, returned: { amount: 2000, kind: "refund" } },
]) next(o);
const labels = reached.map(([, n]) => n.label);
eq("step links: every label property-view.ts names is a step the engine reaches",
  [...exact.filter((l) => !labels.includes(l)), ...prefixes.filter((p) => !labels.some((l) => l.startsWith(p)))], []);

// Every step this file reached, in all five states: its link opens something, and none falls through to its own words.
const links = reached.map(([s, n]) => ({ step: n.label, ...propertyView.stepLink(s, n) }));
check("step links: the scenarios cover every state and both kinds of step", links.length >= 50 && SUPPORTED.every((c) => reached.some(([s]) => s.state === c))
  && reached.some(([, n]) => n.action) && reached.some(([, n]) => !n.action), `${links.length} steps`);
eq("step links: every step reached opens another page or names a section its page draws; Nothing due alone has nothing to open",
  [...new Set(links.filter((l) => !opens(l.href)).map((l) => `${l.step}: ${l.label} ${l.href}`))], [`Nothing due: View ${HOME}`]);
const fallback = propertyView.tabHref("t1", "overview", "next-step");
eq("step links: a step nothing names opens the Overview's Next step card, under its own words",
  propertyView.stepLink(sum(), { label: "A step nothing names yet" }), { label: "A step nothing names yet", href: fallback, icon: "doc", title: "A step nothing names yet" });
check("step links: the Next step card is there to open", opens(fallback));
eq("step links: no step reached falls through to it", [...new Set(links.filter((l) => l.href === fallback).map((l) => l.step))], []);

// Every path a pack's own step names (and the engine's inspection notice), as written, whether or not a scenario
// above reaches it.
const stepPaths = [...readdirSync(join(ROOT, "src/lib/states")).map((f) => `states/${f}`), "next-step.ts"]
  .flatMap((f) => [...readFileSync(join(ROOT, "src/lib", f), "utf8").matchAll(/\bpath: "([^"]*)"/g)].map((m) => ({ file: f, path: m[1] })));
check("step links: the packs' own paths were found", stepPaths.length >= 10 && ["ny", "fl", "tx", "wa"].every((c) => stepPaths.some((p) => p.file === `states/${c}.server.ts`)), `${stepPaths.length} paths`);
eq("step links: every path a pack's step names opens another page or a section its page draws",
  stepPaths.filter((p) => !opens(propertyView.stepLink(sum(), { label: "x", action: { label: "x", path: p.path, icon: "doc" } }).href)).map((p) => `${p.file}: ${p.path}`), []);

// The bell's own lines (bell.ts) follow the same rule, and the reversed deposit's opens the card its step opens.
const reversedUnit = sum({ deposit: { amount: 2000, status: "PAID", paypalId: "INV2-TEST", reversed: true } });
const reversedNext = nextStepLib.nextStep(reversedUnit, today);
const bell = bellLib.paypalBell({ units: [{ summary: reversedUnit, next: reversedNext }], reports: [],
  outside: [{ tenancyId: "t1", address: "1 Test St, Testville, CA 90000", refunds: [{ amount: 100, refunded_at: null }] }] });
eq("the bell: a reversed deposit's line and a refund made in PayPal's each name a section", bell.needsYou.map((l) => [l.title, opens(l.href)]), [["Deposit payment reversed", true], ["Refund made in PayPal", true]]);
eq("the bell: the reversed deposit's line opens the card its step opens", bell.needsYou[0].href, propertyView.stepLink(reversedUnit, reversedNext).href);

console.log(`${pass} passed, ${fail} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(fail ? 1 : 0);
