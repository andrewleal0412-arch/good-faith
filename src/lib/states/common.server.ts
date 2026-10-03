// The server half of what the New York, Texas, Florida and Washington packs share: the statement checklist's building
// blocks, graded from the statement model, and the close-out agent's instructions with the state's statute in them.

import { describeDelivery } from "../delivery";
import type { ChecklistItem, ChecklistState, Statement } from "../statement";
import { list, longDate, pacificDate, plural, usd } from "./common";
import type { StatementContext } from "./types";

/** One checklist item: its number, title and citation, and a function that grades it from the statement. */
export type ItemSpec = {
  n: number;
  title: string;
  short: string;
  cite: string;
  grade: (s: Statement, ctx: StatementContext) => [ChecklistState, string];
};

export const grade = (items: ItemSpec[]) => (s: Statement, ctx: StatementContext): ChecklistItem[] =>
  items.map((i) => { const [state, reason] = i.grade(s, ctx); return { n: i.n, title: i.title, cite: i.cite, state, reason }; });

export const shortOf = (items: ItemSpec[]) => Object.fromEntries(items.map((i) => [i.n, i.short]));

/* ---------- Checklist building blocks, graded from the statement model ---------- */

/** Parties, unit, move-out, statement date and the deadline. */
export const parties = (s: Statement): [ChecklistState, string] => {
  const missing = [!s.tenants.length ? "tenant names" : null, !s.property.address ? "unit address" : null, !s.moveOutDate ? "move-out date" : null].filter(Boolean) as string[];
  return missing.length ? ["missing", `Still needed: ${list(missing)}.`]
    : ["done", `${list(s.tenants)}; moved out ${longDate(s.moveOutDate!)}; statement dated ${longDate(s.statementDate)}; due ${s.statementDue ? longDate(s.statementDue) : "when the clock starts"}.`];
};

/** The deposit received, how and when. */
export const security = (s: Statement): [ChecklistState, string] => (s.security?.paid
  ? ["done", `${usd(s.security.amount)} paid ${s.security.paidAt ? longDate(pacificDate(s.security.paidAt)) : ""} through PayPal invoice ${s.security.invoiceId}.`]
  : s.security ? ["missing", `PayPal invoice ${s.security.invoiceId} is ${s.security.invoiceStatus.toLowerCase().replace(/_/g, " ")}, not paid.`]
    : ["missing", "No deposit was collected through PayPal for this tenancy."]);

/** One line per deduction with its basis. */
export const lines = (s: Statement): [ChecklistState, string] => (s.deductions.length
  ? ["done", `${plural(s.deductions.length, "deduction")}, each with its basis: ${list(s.deductions.map((d) => d.tagLabel.toLowerCase()))}.`]
  : ["not_applicable", s.totals.depositHeld === 0 ? "No deductions, and no security was collected through PayPal." : "No deductions; the whole deposit is refunded."]);

/** The wear-and-tear findings listed at $0, so the tenant sees they were considered and excluded (the deductions route
 *  refuses a wear deduction, so none is charged). */
export const wear = (s: Statement): [ChecklistState, string] => {
  const w = s.wear ?? [];
  return w.length
    ? ["done", `${plural(w.length, "wear-and-tear finding")} listed at $0 on the statement, none charged: ${list(w.map((x) => x.item.toLowerCase()))}.`]
    : ["not_applicable", "No wear-and-tear finding was made at move-out, so none is listed; none is charged."];
};

/** Evidence behind each repair or cleaning line: photos, an invoice or estimate, or the labor record. */
export const evidence = (required: boolean) => (s: Statement): [ChecklistState, string] => {
  const repairs = s.deductions.filter((d) => d.category !== "rent");
  if (!repairs.length) return ["not_applicable", "No repair or cleaning was deducted."];
  const thin = repairs.filter((d) => !d.photos.length || (d.vendor ? !d.vendor.invoicePath && !d.isEstimate : !d.labor?.description));
  if (!thin.length) return ["done", `${plural(repairs.length, "item")}, each with photos and an invoice, estimate or labor record.`];
  return ["missing", `${thin.map((d) => d.item).join("; ")}: ${required ? "each line needs photos and an invoice, estimate or labor record" : "unsupported; photos and an invoice or labor record make the amount easier to prove"}.`];
};

/** Labor and vendor records for every damage charge (Washington: estimates or invoices; time and hourly rate). */
export const documents = (s: Statement): [ChecklistState, string] => {
  const repairs = s.deductions.filter((d) => d.category !== "rent");
  if (!repairs.length) return ["not_applicable", "No repair or cleaning was deducted."];
  const short = repairs.filter((d) => (d.vendor ? !d.vendor.invoicePath && !d.isEstimate : !d.labor?.description || d.labor.hours == null || d.labor.hourlyRate == null));
  return short.length ? ["missing", `Still needed for ${list(short.map((d) => d.item))}: the invoice or estimate, or the time spent and hourly rate.`]
    : ["done", `${plural(repairs.length, "item")}, each with its invoice or estimate, or the time and rate of the landlord's own work.`];
};

/** Estimates marked as such. */
export const estimates = (s: Statement): [ChecklistState, string] => {
  const est = s.deductions.filter((d) => d.isEstimate);
  return est.length ? ["done", `${plural(est.length, "estimate")} marked; the final invoice follows when received.`] : ["not_applicable", "No deduction is an estimate; every cost is final."];
};

/** The refund: amount, method, payees. */
export const refund = (s: Statement): [ChecklistState, string] => (s.refund.state === "sent"
  ? ["done", `${usd(s.refund.amount)} sent by ${s.refund.method} (${s.refund.paypalId}) on ${longDate(pacificDate(s.refund.sentAt!))}, payable to ${list(s.refund.payees)}.`]
  : s.refund.state === "due" ? ["done", `${usd(s.refund.amount)} by ${s.refund.method}, payable to ${list(s.refund.payees)}.`]
    : ["done", s.refund.method]);

/** A balance over the deposit stated as a claim. */
export const claim = (s: Statement): [ChecklistState, string] => (s.balanceClaimed
  ? ["done", `${usd(s.balanceClaimed.amount)} is stated as a claim, not a demand for payment.`]
  : ["not_applicable", "The deductions do not exceed the deposit held."]);

/** The delivery record. */
export const delivered = (s: Statement): [ChecklistState, string] => (s.delivery
  ? ["done", `Delivered by ${describeDelivery(s.delivery)}.`]
  : ["missing", "Record how and when the statement was delivered, once it goes out."]);

/** The disclaimer line every page and document carries. */
export const disclaimer = (): [ChecklistState, string] => ["done", "The statement and the PDF carry the line that this is a template from the landlord's records, not legal advice."];

/* ---------- The close-out agent ---------- */

/** The close-out agent's instructions for a state pack: California's steps, with the state's name, its checklist and
 *  any step the state adds. The citations still come only from the facts' "rules". */
export function closeOutSystem(o: { name: string; items: number; note: string }): string {
  return `You are the close-out agent in Good Faith, which helps small ${o.name} landlords return security deposits correctly. You work for the landlord and you are fair to the tenant.

This tenancy follows ${o.name} law. ${o.note}

For this move-out:
1. Call get_close_out_facts. It comes from the rules engine and is authoritative for amounts, dates and the refund plan.
2. If it lists blockers, stop: in two or three sentences, tell the landlord what's blocking and what to do next. Don't call any PayPal tool. One exception: when the only blocker is that the deposit was already returned, the money is done, so skip to step 6.
3. Confirm the deposit with PayPal: call get_invoice for the deposit invoice and check that it is PAID and that its transaction id matches the facts.
4. Return the money on the plan's rail, for exactly the plan's amount:
   - refund_original_payment: call create_refund with capture_id set to the plan's captureId, amount {"currency_code": "USD", "value": the amount with two decimals}, invoice_id set to the deposit invoice id, and a note_to_payer under 200 characters saying this is the security deposit refund less itemized deductions and that the itemized statement follows.
   - payout: call send_payout to the plan's email.
   - nothing_to_refund: don't move any money.
   The landlord approves every money movement before it runs. Call a money tool once, and never retry it with a different amount.
5. After a refund goes through, call get_refund to confirm its status.
6. Call get_statement_checklist. It grades the itemized statement against the ${o.items} items the ${o.name} rules spec asks for, says what is still missing, and whether its delivery was recorded.
7. Finish with a short summary for the landlord: what was returned and how, the deductions, the statement deadline, and what the statement still needs before it is delivered (the checklist's stillMissing, in plain words). If nothing is missing, say the statement is complete and ready to deliver by the deadline. The landlord opens the statement with the "Open the itemized statement" button on this page, so never quote a path or link. Give every date as a full date, such as October 1, 2026, never "today" or "yesterday".

Before each tool call, say in one short sentence what you're about to check or do. Your text is shown as plain text, so write plain sentences for a non-lawyer with no markdown at all: no asterisks, no headings, no numbered or bulleted lists, no emojis. Keep the final summary to one or two short paragraphs.

Cite only the citations in the facts' "rules", word for word, and only where they apply. Never cite a code section from memory, and never cite another state's law. Don't give legal advice beyond those rules. If a tool returns an error or says "Blocked", explain it to the landlord and stop.`;
}

export const factsTool = (deadline: string) => `The tenancy's close-out file from the rules engine: move-out date and ${deadline} deadline, the deposit as PayPal reports it, the tenants' refund designation if any, every deduction with its math and any missing documents, totals, blockers, warnings, and the refund plan the rules allow (rail, amount, and the capture id or email). Call this first.`;

export const checklistTool = (items: number, statute: string) => `The itemized statement's completeness: the ${items} items of the rules spec's checklist (${statute}), each done, missing or not applicable with a one-line reason, what is still missing, and whether delivery was recorded. Read-only; call it after the refund, or when the deposit was already returned.`;

/** The wear-and-tear guide every pack's inspection shares, with the state's own definition at its head. */
export const inspectionGuide = (head: string) => `${head}
- A deposit may cover damage beyond ordinary (normal) wear and tear, and cleaning only back to the cleanliness at move-in.
- Never chargeable (wear and tear): faded or lightly scuffed paint, paint worn behind furniture, a few small nail or pin
  holes, minor nicks, carpet worn or matted from normal traffic, moderate carpet spotting, drapes or blinds faded or loose
  from age, appliances or fixtures that stopped working from age, grime that predates this tenancy.
- Chargeable damage: a large number of holes or large holes/gouges in walls, carpet rips, burns, pet urine or other
  indelible stains, blinds snapped or torn, broken fixtures, chewed trim.
- Chargeable cleaning: a dirty oven or range, greasy surfaces, mildew, unwashed floors, decals, fleas, left-behind trash,
  but only beyond how clean it was at move-in.
Report only what the photos show. If lighting or angle makes it uncertain, say "unclear".`;
