#!/usr/bin/env node
// The settled dispute every demo copy's closed unit shows as history (482 N. Glassell St, Unit B): the tenants
// disputed the carpet and the range cleaning, their advocate wrote the case, the landlord's negotiator and the
// advocate agreed on $270 back in two exchanges, the tenants accepted and the landlord approved. Nothing here calls
// Claude or PayPal. The agents' answers are written below as a recorded example, and each goes through the app's own
// code exactly as a live answer does: the advocate's case through validateCase, the tenants' case through firstTurn,
// and the negotiation through runNegotiation (the loop, checkTurn and its stops) with the two agents stubbed by the AI
// SDK's mock model. Every figure is held to the template's lawful ranges; the script stops if the code changed a
// single answer, so the history shows the agents' turns as written, never an adjusted version.
//
// The result is one row in demo_template_history, keyed by the closed template. A new copy made by
// create_demo_copy_with_history (src/lib/workspace.ts) gets it as real rows (the dispute, its turns, the settlement,
// its ledger row and the activity) with the template's deduction ids mapped to the copy's and every date moved with
// the copy. The settlement is marked as the demo's recorded example: no PayPal id, and no money moved for it. The
// template itself is only read.
//
//   npm run demo:history               build it and print a summary (a dry run)
//   npm run demo:history -- --json     print the history as JSON
//   npm run demo:history -- --apply    store it (replacing an earlier one)
import { join } from "node:path";
import { createJiti } from "jiti";
import { MockLanguageModelV4 } from "ai/test";
import { dbClient, fail, loadEnv, ROOT } from "./demo-common.mjs";

const args = new Set(process.argv.slice(2));
for (const a of args) if (!["--apply", "--json"].includes(a)) fail(`Unknown option ${a}. Usage: npm run demo:history -- [--json | --apply]`);

const env = loadEnv();
const db = dbClient(env);
// The app's modules make their own client from the environment when they load.
process.env.SUPABASE_URL ??= env.SUPABASE_URL;
process.env.SUPABASE_SECRET_KEY ??= env.SUPABASE_SECRET_KEY;
const jiti = createJiti(import.meta.url, { alias: { "@": join(ROOT, "src"), "server-only": join(ROOT, "node_modules/server-only/empty.js") } });
const lib = (n) => jiti.import(join(ROOT, "src/lib", `${n}.ts`));
const [disputes, advocate, nego] = await Promise.all(["disputes", "advocate", "negotiator"].map(lib));

const { data: tpl, error: te } = await db.from("demo_templates").select("tenancy_id, anchor").eq("role", "closed").maybeSingle();
if (te || !tpl) fail(`No closed demo template is registered${te ? ` (${te.message})` : ""}. See docs/DEPLOY.md, section 9.`);
const TEMPLATE = tpl.tenancy_id;
const facts = await disputes.disputeFacts(TEMPLATE);
if (!facts) fail(`The closed template ${TEMPLATE} isn't readable.`);
if (!facts.deliveredAt || !facts.refunded) fail("The closed template's statement and refund must both have gone out before it can carry a settled dispute.");

// The demo seed's three deductions, found by what they are rather than by position.
const lineOf = (test, what) => facts.ranges.lines.find(test) ?? fail(`The closed template has no ${what} deduction; this history is written for the demo seed's three (README, The demo lease).`);
const carpet = lineOf((l) => /carpet/i.test(l.title) && l.category === "damage", "carpet");
const wall = lineOf((l) => /wall/i.test(l.title) && l.category === "damage", "wall");
const range = lineOf((l) => l.category === "cleaning", "cleaning");
if (facts.ranges.lines.length !== 3) fail(`The closed template has ${facts.ranges.lines.length} deductions; this history is written for three.`);
if (carpet.amount !== 720 || carpet.max !== 720 || range.amount !== 150 || wall.amount !== 140) fail("The closed template's amounts aren't the demo seed's ($720, $140, $150); review the answers below first.");

/* ---------- The story, on the template's own dates ---------- */

// The template closed out on its anchor day; the dispute comes the next day (Pacific), all of it before the copy.
const day = new Date(`${tpl.anchor}T12:00:00Z`);
day.setUTCDate(day.getUTCDate() + 1);
const at = (hhmm, sec = 0) => `${day.toISOString().slice(0, 10)}T${hhmm}:${String(sec).padStart(2, "0")}.000Z`; // UTC; 16:05 is 9:05 in Orange
const T = {
  drafted: at("16:05"), advocateStarted: at("16:09"), advocateDone: at("16:10", 40), sent: at("16:18"),
  negotiationStarted: at("17:30"), turn2: at("17:30", 35), turn3: at("17:31", 10), turn4: at("17:31", 45), negotiationEnded: at("17:31", 46),
  accepted: at("19:12"), approved: at("20:40"), paid: at("20:40", 4),
};
const TENANT = facts.tenants[0] ?? fail("The closed template names no tenants.");
const DISPUTE_ID = "8f0c2a61-3b7e-4c9d-a5e2-6d1b0f4c7a10"; // the history's own ids, mapped to new ones in each copy
const SETTLEMENT_ID = "2d7e9b40-6a1c-4f83-b2d5-9c0e4a7f1b38";

const reasons = {
  [carpet.id]: "The stain was one spot near the middle of the room. Nobody asked us about cleaning it, and the carpet was already six years old.",
  [range.id]: "We cleaned the kitchen before we left. Three hours for one stove seems like a lot.",
};
const message = "We'd rather settle this between us. Thanks for taking a look.";

// The advocate's case, as its model would return it (caseSchema), for every line on the statement.
const rawCase = {
  lines: [
    { line: carpet.n, verdict: "weak", keep: 360, citation: "Civ. Code 1950.5(b)(2)",
      reason: "The photo comparison suggested cleaning, and the carpet was replaced with no note saying cleaning was tried first. The charge is already prorated, so the case asks for half of it back." },
    { line: wall.n, verdict: "solid", keep: 140, citation: "Civ. Code 1950.5(b)(2)",
      reason: "Not one you disputed. The invoice and the photos show wall damage that wasn't there at move-in, repaired." },
    { line: range.n, verdict: "solid", keep: 150, citation: "Civ. Code 1950.5(b)(3), (e)(2)(C)",
      reason: "The photos show grease on the range that wasn't there at move-in, and the statement lists the hours, the rate and the work. This one is documented." },
  ],
  summary: "Your strongest point is the carpet: the photo comparison suggested cleaning, and nothing on file says cleaning was tried before it was replaced. The range cleaning and the wall repair are documented, so the case leaves them as charged. It proposes $360.00 back.",
};

// The negotiation's agent turns (turnSchema): the landlord's negotiator, the tenants' advocate, the negotiator again.
const L = (r, move, keep, reason, citation = r.citations[0]) => ({ line: r.n, move, keep, reason, citation });
const turnAnswers = {
  landlord: [
    {
      lines: [
        L(carpet, "counter", 600, "The photos show a stain beyond wear and the invoice is on file, prorated to the 4 years left. Cleaning was suggested first, so part of it is given back."),
        L(wall, "hold", 140, "Invoice and photos on file, and not disputed."),
        L(range, "hold", 150, "The photos show grease that wasn't there at move-in, and the hours and the rate are on the statement."),
      ],
      message: "The stain is damage the photos show, and the charge is already prorated for the carpet's age. Cleaning was suggested first, so we give back part of the carpet.",
      reasoning: "The carpet charge has an invoice, after photos and proration, which supports most of it. Its weak point is that the comparison suggested cleaning and no note says it was tried. Giving back part of it reflects that without conceding the replacement.",
    },
    {
      lines: [
        L(carpet, "concede", 450, "The record doesn't show the cleaning the comparison suggested, so meeting here is fair to both sides."),
        L(wall, "hold", 140, "Agreed as charged."),
        L(range, "hold", 150, "Agreed as charged."),
      ],
      message: "Agreed on the carpet. The wall and range charges stand as stated.",
      reasoning: "The tenants accepted the documented charges and moved on the carpet. Settling here ends the one open question in the record.",
    },
  ],
  tenant: [
    {
      lines: [
        L(carpet, "counter", 450, "No note says cleaning was tried, and the comparison suggested it. A figure closer to the middle reflects that gap."),
        L(wall, "hold", 140, "Not disputed."),
        L(range, "hold", 150, "Documented: the hours, the rate and the photos."),
      ],
      message: "The tenants accept the wall and range charges. On the carpet, the missing cleaning attempt is the gap in the record, so we propose meeting closer to the middle.",
      reasoning: "The landlord's records support a replacement charge, so holding at half back would likely stall. The gap is the cleaning the comparison suggested. A figure between the two positions closes it in one more step.",
    },
  ],
};

/* ---------- Through the app's own checks ---------- */

const problems = [];
const draft = {
  id: DISPUTE_ID, tenancy_id: TEMPLATE, workspace_id: null, link_id: null, status: "draft", opened_by: TENANT,
  deduction_ids: [carpet.id, range.id], reasons, message, evidence: [], statement_delivered_at: facts.deliveredAt,
  advocate: null, advocate_status: null, advocate_started_at: null, advocate_error: null, asked_back: null,
  created_at: T.drafted, updated_at: T.drafted, sent_at: null, closed_at: null,
};
const file = disputes.caseFile(facts, draft);
const c = advocate.validateCase(rawCase, file, facts.pack, { model: "recorded example", steps: 0, at: T.advocateDone });
if (c.adjustments.length) problems.push(`the advocate's case: ${c.adjustments.join(" ")}`);
draft.advocate = { ...c, basis: disputes.disputeBasis(draft, facts) };
draft.advocate_status = "done";
draft.advocate_started_at = T.advocateStarted;

const first = disputes.firstTurn(draft, facts, true);
if (first.turn.actor !== "agent") problems.push("the tenants' case didn't go out as their advocate's");
const turn1 = { n: 1, side: "tenant", actor: first.turn.actor, move: "case", ...first.turn, created_at: T.sent };

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } };
const model = (answers) => new MockLanguageModelV4({
  doGenerate: answers.map((a) => ({ content: [{ type: "text", text: JSON.stringify(a) }], finishReason: { unified: "stop", raw: undefined }, usage, warnings: [] })),
});
const policy = { autoConcede: true, limit: null };
const stamps = [T.turn2, T.turn3, T.turn4];
const turns = [turn1];
const outcome = await nego.runNegotiation({
  file, pack: facts.pack, turns: [turn1], policy,
  models: { landlord: model(turnAnswers.landlord), tenant: model(turnAnswers.tenant) },
  persist: async (turn) => {
    turns.push({ ...turn, created_at: stamps[turns.length - 1] });
    return `turn-${turn.n}`;
  },
});
for (const t of turns.slice(1)) if (t.checks?.adjustments?.length) problems.push(`turn ${t.n}: ${t.checks.adjustments.join(" ")}`);
if (outcome.reason !== "agreed") problems.push(`the agents stopped with "${outcome.reason}", not an agreement`);
if (turns.length !== 4) problems.push(`${turns.length} turns, not 4`);
if (problems.length) fail(`The app's checks changed or refused part of the recorded answers, so nothing was stored:\n- ${problems.join("\n- ")}`);

const last = turns[turns.length - 1];
const amount = last.amount_back;
const strip = (t) => ({
  n: t.n, side: t.side, actor: t.actor, move: t.move, proposal: t.proposal, total_keep: t.total_keep, amount_back: t.amount_back,
  message: t.message, reasoning: t.reasoning, citations: t.citations, checks: t.checks, created_at: t.created_at,
});

const history = {
  version: 1,
  note: "A recorded example made by scripts/demo-history.mjs: the agents' answers were written ahead and passed the app's checks unchanged. No PayPal money moved for the settlement.",
  dispute: {
    id: DISPUTE_ID, opened_by: TENANT, deduction_ids: draft.deduction_ids, reasons, message,
    advocate: draft.advocate, advocate_started_at: T.advocateStarted, asked_back: first.asked,
    negotiator_policy: policy, negotiation_started_at: T.negotiationStarted,
    negotiation_outcome: { reason: "agreed", landlord_back: outcome.landlordBack, tenant_back: outcome.tenantBack, at: T.negotiationEnded },
    created_at: T.drafted, updated_at: T.paid, sent_at: T.sent, closed_at: T.paid,
  },
  turns: turns.map(strip),
  settlement: {
    id: SETTLEMENT_ID, turn_n: last.n, amount, terms: last.proposal, rail: "refund_original_payment",
    tenant_accepted_at: T.accepted, tenant_name: TENANT, landlord_approved_at: T.approved, sent_at: T.paid,
    created_at: T.turn4, updated_at: T.paid,
  },
  payment: { kind: "settlement_refund", amount, created_at: T.paid },
  audit: [
    { actor: "tenant", action: "dispute_drafted", detail: { lines: draft.deduction_ids.length }, created_at: T.drafted },
    { actor: "agent", action: "advocate_case_written", detail: { dispute_id: DISPUTE_ID, lines: c.lines.length, amount_back: c.amountBack, adjustments: 0, steps: 0 }, created_at: T.advocateDone },
    { actor: "tenant", action: "dispute_opened", detail: { name: TENANT, lines: draft.deduction_ids.length, amount_back: first.asked, by_advocate: true }, created_at: T.sent },
    { actor: "landlord", action: "negotiation_started", detail: { dispute_id: DISPUTE_ID, policy, agent_turns_before: 0 }, created_at: T.negotiationStarted },
    ...turns.slice(1).map((t) => ({ actor: "agent", action: "negotiation_turn", detail: { dispute_id: DISPUTE_ID, n: t.n, side: t.side, move: t.move, amount_back: t.amount_back }, created_at: t.created_at })),
    { actor: "agent", action: "negotiation_ended", detail: { dispute_id: DISPUTE_ID, reason: "agreed", landlord_back: outcome.landlordBack, tenant_back: outcome.tenantBack, turns: turns.length - 1, calls: 0 }, created_at: T.negotiationEnded },
    { actor: "tenant", action: "settlement_accepted", detail: { dispute_id: DISPUTE_ID, amount, name: TENANT }, created_at: T.accepted },
    { actor: "landlord", action: "settlement_approved", detail: { settlement_id: SETTLEMENT_ID, amount }, created_at: T.approved },
    { actor: "agent", action: "settlement_paid", detail: { settlement_id: SETTLEMENT_ID, amount, demo_example: true }, created_at: T.paid },
  ],
};

if (args.has("--json")) {
  console.log(JSON.stringify(history, null, 2));
} else {
  console.log(`Closed template ${TEMPLATE} (${facts.address}), statement delivered ${facts.deliveredAt.slice(0, 10)}, refund ${facts.refunded.amount}.`);
  console.log(`  The tenants' case: ${first.asked} back (advocate: ${c.lines.map((l) => `line ${l.n} ${l.verdict} keep ${l.keep}`).join(", ")}).`);
  for (const t of turns.slice(1)) console.log(`  Turn ${t.n}, ${t.side}'s agent: ${t.move}, ${t.amount_back} back.`);
  console.log(`  Agreed: ${amount} back, accepted by ${TENANT}, approved by the landlord. Every answer passed the app's checks unchanged.`);
}

if (args.has("--apply")) {
  const { error } = await db.from("demo_template_history").upsert({ tenancy_id: TEMPLATE, history, updated_at: new Date().toISOString() });
  if (error) fail(`Couldn't store the history: ${error.message}. Apply supabase/migrations first.`);
  console.log("Stored. New demo copies show it on the closed unit; copies already made are unchanged.");
} else if (!args.has("--json")) {
  console.log("A dry run: nothing was stored. Run with --apply to store it.");
}
