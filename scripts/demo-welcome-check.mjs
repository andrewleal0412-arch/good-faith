#!/usr/bin/env node
// Unit checks for the welcome a judge's copy opens with (src/lib/demo-welcome.ts): the card's words and the tour's four
// stops, read off the copy's own units the way the demo guide reads them (the unit beat 1 of docs/DEMO_SCRIPT.md names,
// and the one in a second state), so the welcome and the guide always point at the same two units. Every figure and
// date in the words comes from those units and their state's pack, never from the demo's own numbers. Also the two
// sentences a copy with no sandbox deposit of its own shows (src/lib/demo-pool.ts), held to the phrase the settlement's
// and the dispute's code reword. Pure: no database, no PayPal, no Claude. Exit 1 if any fails.
//
//   node scripts/demo-welcome-check.mjs

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": join(ROOT, "src"), "server-only": join(ROOT, "node_modules/server-only/empty.js") } });
const lib = (n) => jiti.import(join(ROOT, "src/lib", `${n}.ts`));
// demo-pool.ts reads the database only inside its functions; its client wants the variables at load.
process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_SECRET_KEY ??= "test-secret";
const [welcome, guide, pool] = await Promise.all(["demo-welcome", "demo-guide", "demo-pool"].map(lib));
const { welcomeOf } = welcome;

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) pass++;
  else { fail++; failures.push(`${name}${detail ? `: ${detail}` : ""}`); }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

/* ---------- Fixtures: a fresh copy's three units ---------- */

const unit = (o) => ({
  id: "u", address: null, street: "", city: null, state: "CA", tenants: [], deposit: null, held: false,
  moveOutDate: null, inspected: false, due: null, closed: false, ...o,
});
const live = unit({
  id: "mo", address: "1140 E. Juniper Hollow Ln, Orange, CA 92867", street: "1140 E. Juniper Hollow Ln", city: "Orange",
  tenants: ["Luke Jones", "Lane Forti"], deposit: 4800, held: true, moveOutDate: "2026-10-06", inspected: true, due: "2026-10-27",
});
const closed = unit({
  id: "cl", address: "482 N. Glassell St, Unit B, Orange, CA 92866", street: "482 N. Glassell St, Unit B", city: "Orange",
  tenants: ["Marisol Vega"], deposit: 3200, moveOutDate: "2026-08-01", inspected: true,
});
const tx = unit({
  id: "tx", address: "2317 Mesquite Bend Dr, Unit 3, Austin, TX 78745", street: "2317 Mesquite Bend Dr, Unit 3", city: "Austin", state: "TX",
  tenants: ["Luis Ortega"], deposit: 1500, held: true,
});
const today = "2026-10-08";
const w = welcomeOf({ units: [closed, tx, live], account: "Harbor View Rentals", today, sandbox: true });

/* ---------- The card ---------- */

check("card: a copy with units has a welcome", !!w);
eq("card: its title names the demo landlord", w?.title, "You're the landlord at Harbor View Rentals");
eq("card: the lead names the tenants, the unit, the deposit and the state's clock", w?.lead,
  "Luke Jones and Lane Forti moved out of 1140 E. Juniper Hollow Ln. Close out their $4,800 deposit. California gives you 21 days.");
eq("card: three lines, the sandbox named, the seven beats counted", w?.lines, [
  "Claude compares the move-in and move-out photos. Code prices each charge against the statute.",
  "PayPal runs in its sandbox: real API calls, test money.",
  `${guide.BEATS.length} steps, ticked off in the checklist at the top of each page. Three of them wait on Claude: the refund under a minute, the tenants' case about a minute, the negotiation a turn at a time.`,
]);
eq("card: live PayPal is never called a sandbox", welcomeOf({ units: [live], account: "Harbor View Rentals", today, sandbox: false })?.lines[1], "PayPal is live here: real money moves.");
eq("card: the tour ends on the move-out photos, beat 1's own card", w?.start, guide.guideSteps([{ ...live, leaseChecked: true, statementDelivered: false, payments: [], disputesSent: [] }])
  .find((s) => s.n === 1).href);

/* ---------- The tour ---------- */

eq("tour: four stops, in order, on the live unit, the next steps, the second state, the guide", w?.stops.map((s) => s.anchor), [
  '[data-tour-unit="mo"]', '[data-tour="next-steps"]', '[data-tour-unit="tx"]', '[data-tour="guide"]',
]);
eq("tour: the stops' titles", w?.stops.map((s) => s.title), ["Your move-out", "What the law needs next", "A second state", "Your 7 steps"]);
eq("tour: the move-out stop, by first names, with the date in this year's short form", w?.stops[0].body,
  "Luke and Lane moved out on Oct 6. Their $4,800 deposit is held, and Claude has already boxed what changed in the photos.");
eq("tour: the next steps stop dates the live unit's clock from its pack", w?.stops[1].body,
  "Each card is one property's next step, from its own state's law. The clock on 1140 E. Juniper Hollow Ln runs out on Oct 27: 21 days after move-out.");
check("tour: the second state's stop names its city and its pack's own rule", w?.stops[2].body.startsWith("This unit is in Austin, so Texas law runs it. ")
  && w?.stops[2].body.includes("written forwarding address"), w?.stops[2].body);

/* ---------- What the copy holds changes the words ---------- */

const fresh = welcomeOf({ units: [{ ...live, inspected: false, held: false }], account: "Harbor View Rentals", today, sandbox: true });
eq("words: before the photos are compared, the stop says what comes next", fresh?.stops[0].body,
  "Luke and Lane moved out on Oct 6. Next, Claude compares the move-in and move-out photos.");
eq("words: a copy with one state has no second-state stop", fresh?.stops.map((s) => s.title), ["Your move-out", "What the law needs next", "Your 7 steps"]);
eq("words: a closed clock is not counted down", welcomeOf({ units: [{ ...live, due: null }], account: "Harbor View Rentals", today, sandbox: true })?.stops[1].body,
  "Each card is one property's next step, from its own state's law.");
eq("words: another year's date carries its year", welcomeOf({ units: [{ ...live, moveOutDate: "2025-12-30" }], account: "Harbor View Rentals", today, sandbox: true })?.stops[0].body.slice(0, 39),
  "Luke and Lane moved out on Dec 30, 2025");
eq("words: one tenant", welcomeOf({ units: [{ ...live, tenants: ["Luke Jones"] }], account: "Harbor View Rentals", today, sandbox: true })?.lead.slice(0, 30), "Luke Jones moved out of 1140 E");
eq("words: three tenants", welcomeOf({ units: [{ ...live, tenants: ["A B", "C D", "E F"] }], account: "Harbor View Rentals", today, sandbox: true })?.stops[0].body.slice(0, 26), "A, C and E moved out on Oc");
eq("words: cents kept when the deposit has them", welcomeOf({ units: [{ ...live, deposit: 4800.5 }], account: "Harbor View Rentals", today, sandbox: true })?.lead.includes("$4,800.50 deposit"), true);
// The account menu opens it again at any point of the demo, so what it says has to hold after the steps too.
const moving = welcomeOf({ units: [{ ...live, moveOutDate: null, due: null }], account: "Harbor View Rentals", today, sandbox: true });
eq("words: tenants still moving out are moving out, in the lead as in the stop", [moving?.lead, moving?.stops[0].body.slice(0, 29)], [
  "Luke Jones and Lane Forti are moving out of 1140 E. Juniper Hollow Ln. Close out their $4,800 deposit. California gives you 21 days.",
  "Luke and Lane are moving out.",
]);
const done = welcomeOf({ units: [{ ...live, held: false, due: null, closed: true }], account: "Harbor View Rentals", today, sandbox: true });
eq("words: once the unit is closed out, the lead says so instead of asking for it", done?.lead,
  "Luke Jones and Lane Forti moved out of 1140 E. Juniper Hollow Ln. Their $4,800 deposit is closed out.");
eq("words: a deposit no longer held is not called held", done?.stops[0].body,
  "Luke and Lane moved out on Oct 6. Claude has already boxed what changed in the photos.");
// "Held" (heldNow, as the server reads it off a unit's summary): paid, and nothing of it gone back by any route.
const { heldNow } = welcome;
const paid = { deposit: { amount: 4800, status: "PAID" }, returned: null };
eq("held: a paid deposit nothing has gone back from is held", heldNow?.(paid), true);
eq("held: not once any of it went back (a refund, the tenants' PayPal dispute, a refund recorded here, a settlement), nor reversed or unpaid",
  [{ returned: { amount: 3790, kind: "refund" } }, { viaDispute: 500 }, { outside: 200 }, { settledBack: 300 },
    { deposit: { ...paid.deposit, reversed: true } }, { deposit: { amount: 4800, status: "SENT" } }, { deposit: null }].map((o) => heldNow?.({ ...paid, ...o })),
  [false, false, false, false, false, false, false]);
eq("words: a copy with no tenancy has no welcome", welcomeOf({ units: [], account: "Harbor View Rentals", today, sandbox: true }), null);
check("words: no em dash anywhere", !JSON.stringify(w).includes("—"));

/* ---------- The sentences a copy with no sandbox deposit of its own shows (src/lib/demo-pool.ts) ---------- */
// The pool is not a day's allowance (a copy made with it empty stays without a deposit; the refund page's caption says
// Start over takes one once the pool is filled again), and the same block holds the settlement and the PayPal dispute's
// answer, each of which replaces "send its refund" with its own words (settlement.ts, negotiation.ts, chargeback-store.ts),
// so the sentence must promise only what works whatever the verb.
{
  const { POOL_EMPTY, SHARED_DEPOSIT, DEMO_REFUND_BLOCKS } = pool;
  eq("blocks: the two sentences, the pool's and the shared deposit's", DEMO_REFUND_BLOCKS, [POOL_EMPTY, SHARED_DEPOSIT]);
  const reworded = [["the settlement's", "send this settlement"], ["the negotiation's", "pay a settlement"], ["the dispute answer's", "answer its PayPal dispute"], ["the dispute check's", "check PayPal for disputes of its deposit"]];
  for (const [name, text] of [["the pool's", POOL_EMPTY], ["the shared deposit's", SHARED_DEPOSIT]]) {
    check(`blocks: ${name} carries "send its refund" for the settlement's and the dispute's own words`, text.includes(", so this copy can't send its refund. "), text);
    for (const [site, verb] of reworded) {
      const r = text.replace("send its refund", verb);
      check(`blocks: ${name}, as ${site} code shows it, reads "this copy can't ${verb}."`, r.includes(`so this copy can't ${verb}. `) && !r.includes("send its refund"), r);
    }
    check(`blocks: ${name} doesn't call the pool a day's`, !/today|the day's/i.test(text), text);
    check(`blocks: ${name} doesn't promise that everything else works (the settlement is held by the same block)`, !/everything else works/i.test(text), text);
    check(`blocks: ${name} says what still works, true whatever the verb`, /Everything that doesn't touch the deposit at PayPal still works\.$/.test(text), text);
    check(`blocks: ${name} has no em dash`, !text.includes("—"));
  }
  check("blocks: the pool's names the pool, not the day", /pre-paid sandbox deposits are used up/.test(POOL_EMPTY), POOL_EMPTY);
}

/* ---------- The guide's look beats (src/lib/demo-guide.ts) ---------- */

// A fresh copy already holds beats 1, 6 and 7 (the photo comparison, the lease Claude read, the Texas unit):
// guideSteps keeps them `held` from the start and `done` only once the browser's cookie says their page was opened, so
// the guide opens at none done rather than "3 of 7 done"; the other four are done by the rows alone.
{
  const { guideSteps, LOOK_BEATS, seenBeats, seenValue, pageBeat, SEEN_COOKIE, BEAT_EVENT } = guide;
  const g = (o) => ({ id: "mo", address: live.address, state: "CA", moveOutDate: "2026-10-06", leaseChecked: true, inspected: true, statementDelivered: false, payments: [{ kind: "deposit_invoice", status: "PAID" }], disputesSent: [], ...o });
  const txg = { id: "tx", address: tx.address, state: "TX", moveOutDate: null, leaseChecked: true, inspected: false, statementDelivered: false, payments: [], disputesSent: [] };
  const by = (steps) => Object.fromEntries(steps.map((s) => [s.n, [s.held, s.done]]));
  eq("guide: the look beats are 1, 6 and 7", [...LOOK_BEATS], [1, 6, 7]);
  const fresh = guideSteps([g(), txg]);
  eq("guide: a fresh copy holds beats 1, 6 and 7 and ticks none of them, the rest neither held nor done", by(fresh),
    { 1: [true, false], 2: [false, false], 3: [false, false], 4: [false, false], 5: [false, false], 6: [true, false], 7: [true, false] });
  eq("guide: with beats 1 and 7 opened in this browser, those two are ticked and the lease beat still waits", by(guideSteps([g(), txg], new Set([1, 7]))),
    { 1: [true, true], 2: [false, false], 3: [false, false], 4: [false, false], 5: [false, false], 6: [true, false], 7: [true, true] });
  eq("guide: an opened beat the copy doesn't hold stays unticked", by(guideSteps([g({ inspected: false }), txg], new Set([1])))[1], [false, false]);
  const sent = guideSteps([g({ payments: [{ kind: "deposit_invoice", status: "PAID" }, { kind: "refund", status: "COMPLETED" }] }), txg]);
  eq("guide: the refund, done by the copy's rows, is ticked with no cookie at all", by(sent)[2], [true, true]);
  eq("guide: the cookie reads the beats' numbers however they are joined, and nothing else", [...seenBeats("1.6.7")].sort(), [1, 6, 7]);
  eq("guide: a cookie with junk keeps only beat numbers", [...seenBeats("x,9.3;0..1")].sort(), [1, 3]);
  eq("guide: no cookie is no beat", [...seenBeats(undefined)], []);
  eq("guide: the cookie's value is the numbers in order, joined by dots", seenValue(new Set([7, 1, 6])), "1.6.7");
  eq("guide: the cookie's value reads back as the same set", [...seenBeats(seenValue(new Set([1, 7])))], [1, 7]);
  check("guide: the cookie's name and the lease check's event are named", SEEN_COOKIE === "gf_guide_seen" && BEAT_EVENT === "gf:demo-beat");
  eq("guide: the Move-out tab, by its ?tab, is beat 1's page", pageBeat(fresh, "/tenancy/mo", "tab=move-out"), 1);
  eq("guide: the Move-out tab with another query before its ?tab is still beat 1's page", pageBeat(fresh, "/tenancy/mo", "lease=existing&tab=move-out"), 1);
  eq("guide: the Texas unit is beat 7's page", pageBeat(fresh, "/tenancy/tx", ""), 7);
  eq("guide: Check a lease is nobody's page (beat 6 comes by the event, once a result shows)", pageBeat(fresh, "/lease", ""), null);
  eq("guide: the Overview, the Payments tab, Properties and the refund review are no look beat's page", [pageBeat(fresh, "/tenancy/mo", ""), pageBeat(fresh, "/tenancy/mo", "tab=payments"), pageBeat(fresh, "/units", ""), pageBeat(fresh, "/tenancy/mo/refund", "")], [null, null, null, null]);
}

/* ---------- The guide's state: this browser's choice, else the page's default (src/lib/demo-guide.ts) ---------- */

// Until a browser chooses, the guide shows its seven rows on Properties only and its one line on every other page, so
// the screen a beat opens is not pushed down by the checklist; a choice (open, shut, off), made on any page, holds on
// every page. The cookie is the choice alone: absent is no choice, and only its three words are read.
{
  const { guideChoice, guideDefault, guideView, GUIDE_HOME, GUIDE_COOKIE } = guide;
  eq("guide state: the cookie's name, and Properties, at /units and at the bare address the access gate lands on, as the one page whose default is open", [GUIDE_COOKIE, [...GUIDE_HOME]], ["gf_guide", ["/", "/units"]]);
  eq("guide state: the bare address renders Properties, so it opens the rows too", guideDefault("/"), "open");
  eq("guide state: no cookie is no choice", guideChoice(undefined), null);
  eq("guide state: the three choices read back as themselves", [guideChoice("open"), guideChoice("shut"), guideChoice("off")], ["open", "shut", "off"]);
  eq("guide state: any other value is no choice", [guideChoice(""), guideChoice("OPEN"), guideChoice("hidden")], [null, null, null]);
  eq("guide state: Properties opens the rows by default", guideDefault("/units"), "open");
  eq("guide state: every other page is one line by default", ["/tenancy/mo", "/tenancy/mo/refund", "/lease", "/ledger", "/insights", "/tenants", "/units/new", "/units/"].map(guideDefault), ["shut", "shut", "shut", "shut", "shut", "shut", "shut", "shut"]);
  eq("guide state: with no choice the page decides", [guideView(null, "/units"), guideView(null, "/tenancy/mo")], ["open", "shut"]);
  eq("guide state: a choice holds on every page, Properties included", [guideView("shut", "/units"), guideView("open", "/tenancy/mo"), guideView("off", "/units"), guideView("off", "/lease")], ["shut", "open", "off", "off"]);
}

console.log(`${pass} passed, ${fail} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(fail || failures.length ? 1 : 0);
