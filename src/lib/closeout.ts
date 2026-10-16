import "server-only";
import { dateIn, daysBetween, paypalPaidAt, shortDate, todayIn } from "./dates";
import { db } from "./db";
import { depositBlock } from "./demo-pool";
import { missingDocs, settle, usd, type StoredDeduction } from "./deductions";
import { returnFailed, wasPaid } from "./invoice-status";
import type { Notices } from "./notices";
import { loadOutsideRefunds, noteFromInvoice } from "./outside-refunds";
import { getInvoice, type Invoice } from "./paypal";
import { invoiceRefunded, openNotes, outsideReturnedAt, outsideReturns, unaccounted, type RecordRow } from "./reconcile";
import { disputeReturns, railFor, refundOwed, REFUND_WINDOW_DAYS, wholeDepositOwed, type RailChoice } from "./refund-rail";
import { packFor, zoneWarnings } from "./states/server";
import type { Standing, StatePack } from "./states/types";
import type { TenantMoveOut } from "./tenant";

// The move-out close-out, in plain code. The agent reads these facts and drives PayPal, but what may be refunded,
// how, and to whom is decided here, and every money tool re-checks it at the moment it runs (guardRefund).
//
// The rules are the tenancy's state pack (src/lib/states/). California (docs/LEGAL_RULES.md): refund within 21 days of
// move-out (D15); paid electronically means refunded electronically, by PayPal only with the tenants' written agreement
// (D16, AB 414); one refund for all adults unless they agreed to split it (D19); deductions over $125 need their
// documents (D20, D22). Other states add their own blockers (a Texas forwarding address in writing, Florida's claim
// notice, New York's 14-day forfeiture, Washington's move-in checklist) through the pack.
// PayPal: a payment can be refunded against itself for 180 days; after that the money goes out as a Payout. Which of
// the two is decided by railFor (refund-rail.ts), the same function a dispute's settlement uses.

export { REFUND_WINDOW_DAYS };

export type Rail = "refund_original_payment" | "payout" | "nothing_to_refund" | "blocked";
export type PayoutReason = Extract<RailChoice, { rail: "payout" }>["because"];

export type CloseOutFacts = {
  today: string;
  tenancy: { address: string; tenants: string[]; moveOutDate: string | null; statementDue: string | null; daysLeft: number | null };
  deposit: { invoiceId: string; status: string; amount: number; paidAt: string | null; method: string | null; captureId: string | null;
    daysSincePaid: number | null; billedTo: string | null; live: boolean } | null;
  refundAgreement: { paypalEmail: string; signedBy: string[]; signedAt: string } | null;
  deductions: { item: string; room: string | null; category: string; amount: number; math: string; missingDocs: string[] }[];
  totals: { depositHeld: number; deductions: number; refund: number; balanceClaimed: number; documentsRequired: boolean };
  alreadyReturned: { kind: string; amount: number; paypalId: string; at: string } | null;
  // noteToPayer: the note PayPal shows the tenants, in code's words, when the plan returns the whole deposit (no
  // deduction kept, or New York's forfeited ones); the money tools send it in place of the agent's. Absent otherwise.
  // because: for a Payout, railFor's reason (refund-rail.ts), so the review can say it in its own words. Absent otherwise.
  plan: { rail: Rail; amount: number; captureId?: string; email?: string; why: string; noteToPayer?: string; because?: PayoutReason };
  blockers: string[];
  warnings: string[];
  rules: Record<string, string>;
  // How the claimed amounts stand when they are not plain deductions (Florida: disputed by a timely objection; New
  // York: forfeited once day 14 passed). Absent otherwise, and always in California.
  standing?: Standing;
  // The refund is the whole deposit although deductions are on file: they are forfeited (New York after day 14) and a
  // dispute the tenants sent holds them, so they can't be removed first. Absent otherwise.
  wholeDeposit?: boolean;
  // PayPal reversed the deposit payment (a chargeback or a bank reversal), as its webhook reported. Absent otherwise.
  reversed?: { at: string | null };
  // The tenants opened a PayPal dispute of the deposit payment that PayPal hasn't resolved. Absent otherwise.
  paypalDispute?: { id: string; status: string; amount: number };
  // Money PayPal itself returned to the tenants through their PayPal dispute (an accepted claim, an offer, PayPal's
  // decision): a prior return, so the close-out sends only what is still owed (the plan's amount is the refund less
  // this). notKept: what of the deductions the statement no longer keeps, once the money back passed the statement's
  // refund (the landlord accepted a claim for more than was owed). Absent when there is none.
  viaDispute?: { amount: number; disputeId: string | null; at: string; notKept: number };
  // What is left of the deposit payment to refund against, when PayPal already refunded part of it (whoever did).
  // Absent while none of it was refunded.
  paymentLeft?: number;
  // Refunds made in PayPal, not from here, that the landlord recorded as this deposit's refund (reconcile.ts): a prior
  // return like the dispute's, so the close-out sends only what is still owed after them. notKept: what of the
  // deductions they mean is no longer kept, beyond what the dispute's money already accounts for. Absent when none.
  outside?: { amount: number; refunds: { id: string; amount: number; at: string | null }[]; notKept: number };
  // Refunds of the deposit payment PayPal reported that aren't on record here and that the landlord hasn't decided
  // on: each is a blocker until it is recorded as the deposit's refund or marked not this deposit. Absent when none.
  outsideOpen?: { id: string; amount: number; at: string | null }[];
};


/** The only citations the agent may use: the tenancy's pack's. It cites from this list, never from memory (it once
 *  mixed up California's (g) and (h)). */
export const rulesFor = (pack: StatePack) => pack.close.rules;

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
/** How long ago a payment was, in words: today, yesterday, or so many days ago. */
export const paidAgo = (n: number) => (n <= 0 ? "today" : n === 1 ? "yesterday" : `${days(n)} ago`);

export async function closeOutFacts(tenancyId: string): Promise<CloseOutFacts> {
  return (await closeOutState(tenancyId)).facts;
}

/** The close-out's facts with what they were read from: the deposit invoice as PayPal returned it just now (null when
 *  PayPal couldn't be reached or there is none), the tenancy's payments, its workspace and its pack. A dispute's
 *  settlement (settlement.ts) reads the same facts this way, so both money paths see one picture. */
export type CloseOutState = {
  facts: CloseOutFacts; invoice: Invoice | null; workspaceId: string; pack: StatePack;
  payments: { kind: string; paypal_id: string | null; amount: number | string; status: string }[];
};

export async function closeOutState(tenancyId: string): Promise<CloseOutState> {
  const [{ data: t }, { data: payments }, { data: rows }, { data: ppDisputes }, outsideNotes] = await Promise.all([
    db.from("tenancies").select("*, properties(address, city, state)").eq("id", tenancyId).single(),
    db.from("payments").select("*").eq("tenancy_id", tenancyId).order("created_at"),
    db.from("deductions").select("*").eq("tenancy_id", tenancyId).order("created_at"),
    // The tenants' PayPal disputes of the deposit payment (chargeback-store.ts): while one is open, its response is
    // where money goes back, never the close-out.
    db.from("paypal_disputes").select("id, status, amount").eq("tenancy_id", tenancyId),
    // Refunds made in PayPal that the app has noted for this tenancy (reconcile.ts), decided or waiting.
    loadOutsideRefunds(tenancyId),
  ]);
  if (!t) throw new Error("No such tenancy.");
  const pack = packFor((t.properties as { state?: string | null } | null)?.state);
  // Every day here is a calendar day where the property is (its pack's zone): today, the day a refund went, the day a
  // forwarding address came in. California's is Pacific, as it always was.
  const zone = pack.timeZone.id;
  const today = todayIn(zone);
  const dayOf = (ts: string) => dateIn(ts, zone);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const notices = (t.notices ?? {}) as Notices;

  // The deadline, from the move-out and whatever else the state counts from (Florida: whether a claim is made, and
  // the day its notice went out).
  const moveOut = t.move_out_date as string | null;
  const due = moveOut ? pack.deadline.due({
    moveOutDate: moveOut, endDate: t.end_date as string | null, plannedMoveOut: t.planned_move_out as string | null,
    claimed: (rows ?? []).length > 0, claimNoticeDate: notices.claim_notice?.date ?? null,
  }) : null;
  const daysLeft = due ? daysBetween(today, due) : null;
  if (!moveOut) blockers.push(pack.deadline.moveOutFirst);
  if (due && daysLeft != null && daysLeft < 0) warnings.push(pack.deadline.lateWarning(-daysLeft, due));
  // A city on another clock than the state's (El Paso, Pensacola): the deadline is still counted in the pack's zone.
  for (const z of zoneWarnings(pack, (t.properties as { city?: string | null } | null)?.city)) warnings.push(z.line);

  // The deposit as PayPal reports it right now, not as we stored it. If PayPal can't be reached, the statement still
  // renders from what the tenancy page last stored, but no money moves on stale facts: the outage is a blocker.
  const inv = (payments ?? []).find((p) => p.kind === "deposit_invoice");
  let deposit: CloseOutFacts["deposit"] = null;
  let fetched: Invoice | null = null;
  let reversal: { at?: string | null } | null = null;
  let paypalDispute: CloseOutFacts["paypalDispute"] = undefined;
  if (inv?.paypal_id) {
    let live: Invoice, isLive = true;
    try {
      live = await getInvoice(inv.paypal_id);
      fetched = live;
    } catch (e) {
      console.error("PayPal invoice lookup failed; using the stored status", e);
      isLive = false;
      live = { id: inv.paypal_id, status: inv.status, payments: { transactions: (inv.raw as Invoice["payments"] | null)?.transactions ?? [] } };
      blockers.push("PayPal couldn't be reached, so the deposit's status is as last recorded. Try again in a minute before returning any money.");
    }
    const txn = live.payments?.transactions?.[0];
    const paidAt = paypalPaidAt(txn);
    deposit = {
      invoiceId: live.id, status: live.status, amount: Number(inv.amount), paidAt, method: txn?.method ?? null,
      captureId: txn?.payment_id ?? null,
      // The day it was paid where the property is, as every page shows it, so "Paid yesterday" and its date agree.
      daysSincePaid: paidAt ? daysBetween(dayOf(paidAt), today) : null,
      billedTo: live.primary_recipients?.[0]?.billing_info?.email_address ?? null,
      live: isLive,
    };
    if (!wasPaid(live.status)) blockers.push(`The deposit invoice is ${live.status.toLowerCase().replace(/_/g, " ")} in PayPal, not paid, so there's nothing to return through PayPal.`);
    // PayPal reversed the payment (a chargeback, or the bank took it back), as its webhook reported
    // (paypal-webhook.ts): the landlord no longer holds it, and nothing can go back against it.
    reversal = (inv.raw as { reversal?: { at?: string | null } } | null)?.reversal ?? null;
    if (reversal) {
      blockers.push(`PayPal reversed the deposit payment${reversal.at ? ` on ${shortDate(dayOf(reversal.at))}` : ""} (a chargeback or a bank reversal), so nothing goes back against it through PayPal. Check the PayPal account before returning any money.`);
    }
    const openDispute = ((ppDisputes ?? []) as { id: string; status: string | null; amount: number | string | null }[]).find((x) => !!x.status && x.status !== "RESOLVED");
    if (openDispute) {
      paypalDispute = { id: openDispute.id, status: openDispute.status!, amount: Number(openDispute.amount ?? 0) };
      // PayPal's hold doesn't stop the state's clock, and the landlord should know what waiting costs.
      blockers.push(`The tenants opened a PayPal dispute of the deposit payment (${openDispute.id}, ${usd(paypalDispute.amount)}). Answer it on the Payments tab first: money sent here meanwhile could go back twice.${due ? ` The state's deadline for the statement and refund is ${shortDate(due)}${pack.deadline.tip.cite ? ` (${pack.deadline.tip.cite})` : ""}, and PayPal's hold doesn't pause it.` : ""}`);
    }
  } else {
    blockers.push("No deposit was collected through PayPal for this tenancy.");
  }

  // A PayPal refund needs the tenants' written agreement where the pack says so (California's AB 414; Washington, as
  // product policy). Elsewhere a refund of the original payment needs none, and only a Payout to another account does.
  const agreement = t.refund_agreement as { paypal_email: string; signed_by: string[]; signed_at: string } | null;
  if (!agreement && pack.refund.agreementRequired) blockers.push(pack.refund.noAgreementBlocker);

  const deductions = (rows ?? []).map((d) => ({ ...d, amount: Number(d.amount) })) as StoredDeduction[];
  const depositHeld = deposit && wasPaid(deposit.status) ? deposit.amount : 0;
  const s = settle(depositHeld, deductions, pack);
  const items = deductions.map((d) => ({
    item: d.item, room: d.room, category: d.category, amount: d.amount, math: d.math, missingDocs: missingDocs(d, s.documentsRequired, pack),
  }));
  for (const d of items) if (d.missingDocs.length) blockers.push(`${d.item}: still needs ${d.missingDocs.join(", ")}. Add it or remove the deduction.`);

  const returned = (payments ?? []).find((p) => p.kind === "refund" || p.kind === "payout");
  const alreadyReturned = returned
    ? { kind: returned.kind, amount: Number(returned.amount), paypalId: returned.paypal_id, at: returned.created_at }
    : null;
  // Money PayPal itself sent back through the tenants' PayPal dispute: a prior return, which the plan takes off what
  // the close-out sends (below), never the close-out itself.
  const viaDispute = disputeReturns(payments ?? []);
  // A refund PayPal reports on the deposit payment that this app never recorded: one made in the PayPal dashboard, or
  // one whose answer never came back and whose plan then changed (a retry of the same refund carries the same
  // idempotency key and gets the first one back: agent.ts, closeOutRefundKey). The invoice just read lists each refund
  // by id; one the records don't hold is noted for this tenancy (reconcile.ts, outside-refunds.ts; the webhook notes
  // it too, once), and nothing more goes out until the landlord records it as this deposit's refund or marks it not
  // this deposit. PayPal's refunds through a dispute are on record (dispute refunds) and don't count. A refund PayPal
  // counts in its total but doesn't list still holds the close-out until someone looks.
  const records = (payments ?? []) as RecordRow[];
  const captureId = (inv?.raw as { transactions?: { payment_id?: string }[] } | null)?.transactions?.[0]?.payment_id ?? null;
  const notes = fetched && inv?.paypal_id
    ? await noteFromInvoice({ tenancyId, workspaceId: t.workspace_id as string, invoice: fetched, payments: records, notes: outsideNotes, depositInvoiceId: inv.paypal_id, captureId })
    : outsideNotes;
  const waiting = openNotes(notes, records);
  const outside = outsideReturns(records);
  for (const n of waiting) {
    blockers.push(`PayPal shows a ${usd(Number(n.amount))} refund of the deposit payment${n.refunded_at ? ` on ${shortDate(dayOf(n.refunded_at))}` : ""} (refund ${n.refund_id}) that wasn't sent from here. Record it as this deposit's refund, or mark it not this deposit, on the Payments tab before returning any money here.`);
  }
  const refundedByPayPal = fetched ? unaccounted(fetched, records, notes) : 0;
  if (!alreadyReturned && !waiting.length && refundedByPayPal > 0.005) {
    blockers.push(`PayPal shows ${usd(refundedByPayPal)} already refunded on the deposit payment, and this app has no record of it (a refund made in PayPal, or one whose answer was lost). Check the PayPal account before returning any money here.`);
  }
  // A demo copy refunds only a sandbox deposit of its own (src/lib/demo-pool.ts): one made when the pool was empty, and
  // every copy of the Texas unit, shows the template's deposit, which is never refunded from a copy.
  const demoBlock = !alreadyReturned && inv?.paypal_id ? await depositBlock(t.workspace_id as string, inv.paypal_id) : null;
  if (demoBlock) blockers.push(demoBlock);
  if (alreadyReturned) blockers.push(`The deposit was already returned: ${usd(alreadyReturned.amount)} by PayPal ${alreadyReturned.kind} ${alreadyReturned.paypalId} on ${dayOf(alreadyReturned.at)}, sent by this close-out after the landlord approved it. Don't send another.`);

  const tm = (t.tenant_move_out ?? null) as TenantMoveOut | null;
  const facts: CloseOutFacts = {
    today,
    tenancy: { address: (t.properties as { address: string }).address, tenants: (t.tenants as { name: string }[]).map((x) => x.name),
      moveOutDate: moveOut, statementDue: due, daysLeft },
    deposit,
    refundAgreement: agreement ? { paypalEmail: agreement.paypal_email, signedBy: agreement.signed_by, signedAt: agreement.signed_at } : null,
    deductions: items,
    totals: { depositHeld, deductions: s.total, refund: s.refund, balanceClaimed: s.balanceClaimed, documentsRequired: s.documentsRequired },
    alreadyReturned,
    plan: { rail: "blocked", amount: 0, why: "" },
    blockers,
    warnings,
    rules: rulesFor(pack),
  };
  // The state's own requirements: a written forwarding address (Texas), the claim notice and the objection window
  // (Florida), the 14-day forfeiture (New York), the move-in checklist (Washington). Before the already-returned line,
  // which reads last. A dispute the tenants sent that is still live freezes the deductions (disputes.ts), which the
  // New York forfeiture needs to know: they can't be removed then, so the close-out returns the whole deposit with them.
  const deliveredOn = (t.statement_delivery as { date?: string } | null)?.date ?? null;
  // With no refund from the close-out, the day refunds made in PayPal and recorded here (with the dispute's money)
  // returned what the deductions leave owed: the day the rest of the deposit went, for New York's day 14.
  const outsideAt = !alreadyReturned ? outsideReturnedAt(records, s.refund) : null;
  const outsideOn = outsideAt ? dayOf(outsideAt) : null;
  const { data: live } = t.statement_delivered_at && deductions.length
    ? await db.from("disputes").select("id").eq("tenancy_id", tenancyId).in("status", ["open", "negotiating", "agreed"]).limit(1)
    : { data: [] };
  const ctx = {
    today, notices, endDate: t.end_date as string | null, plannedMoveOut: t.planned_move_out as string | null, deductionsCount: deductions.length,
    forwarding: tm ? { address: tm.forwarding_address, date: dayOf(tm.updated_at) } : null,
    deliveredOn, disputeLive: !!live?.length, returnedOn: outsideOn,
  };
  const extra = pack.close.extraBlockers(facts, ctx);
  if (extra.length) {
    const at = alreadyReturned ? blockers.length - 1 : blockers.length;
    blockers.splice(at, 0, ...extra);
  }
  warnings.push(...pack.close.extraWarnings(facts, ctx));
  const standing = pack.close.standing?.({
    today, notices, claimed: s.total, statementDue: due, deliveredOn,
    returnedOn: alreadyReturned ? dayOf(alreadyReturned.at) : outsideOn, refundOwed: s.refund > 0,
  });
  if (standing) facts.standing = standing;
  if (reversal) facts.reversed = { at: reversal.at ?? null };
  if (paypalDispute) facts.paypalDispute = paypalDispute;
  if (waiting.length) facts.outsideOpen = waiting.map((n) => ({ id: n.refund_id, amount: Number(n.amount), at: n.refunded_at }));
  // Forfeited deductions a live dispute holds on file: the close-out returns the whole deposit with them (New York's
  // hard block, which otherwise waits for them to be removed). Its settlement then has nothing more to send
  // (settlement.ts).
  if (wholeDepositOwed({ forfeits: !!standing?.forfeits, disputeLive: !!ctx.disputeLive, alreadyReturned: !!alreadyReturned, depositHeld })) facts.wholeDeposit = true;
  // What PayPal returned through the tenants' PayPal dispute comes off what is still owed. Past the statement's refund
  // (a claim accepted for more than was owed), the rest of the deductions isn't kept: notKept, for the statement.
  const ownBack = alreadyReturned && !returnFailed(String(returned?.status ?? "")) ? alreadyReturned.amount : 0;
  const notKeptOf = (back: number) => { const owed = refundOwed(facts); return Math.round(Math.max(0, Math.min(Math.max(0, depositHeld - owed), back - owed)) * 100) / 100; };
  if (viaDispute) facts.viaDispute = { ...viaDispute, notKept: notKeptOf(viaDispute.amount + ownBack) };
  // Refunds made in PayPal that the landlord recorded as this deposit's refund: a prior return the same way. What they
  // add to what isn't kept is theirs (the dispute's own share stays on the dispute's line).
  if (outside) {
    const all = notKeptOf((viaDispute?.amount ?? 0) + outside.amount + ownBack);
    facts.outside = { ...outside, notKept: Math.round(Math.max(0, all - (facts.viaDispute?.notKept ?? 0)) * 100) / 100 };
  }
  // What is left of the payment for a refund against it: PayPal's own count and the records', whichever leaves less (a
  // refund the landlord marked not this deposit still took money off the payment). Only from a live read.
  if (fetched && deposit && !alreadyReturned) {
    const ours = records.filter((p) => ["refund", "settlement_refund", "dispute_refund", "outside_refund"].includes(p.kind) && !returnFailed(p.status))
      .reduce((s2, p) => s2 + Number(p.amount), 0);
    const paidAmount = Number(fetched.payments?.paid_amount?.value ?? deposit.amount);
    const left = Math.round((paidAmount - Math.max(invoiceRefunded(fetched), ours)) * 100) / 100;
    if (left < deposit.amount - 0.005) facts.paymentLeft = Math.max(0, left);
  }
  // Without a written designation (where the state needs none for a refund of the original payment), a payment that
  // can't be refunded against itself has nowhere lawful to go yet.
  const d = facts.deposit;
  if (!agreement && !pack.refund.agreementRequired && d && wasPaid(d.status) && refundStillOwed(facts) > 0 && !alreadyReturned
    && !(d.captureId && d.daysSincePaid != null && d.daysSincePaid <= REFUND_WINDOW_DAYS)) {
    blockers.push(pack.refund.noDesignationBlocker);
  }
  facts.plan = refundPlan(facts, pack);
  return { facts, invoice: fetched, workspaceId: t.workspace_id as string, pack, payments: payments ?? [] };
}

/** What the close-out still sends: the refund owed (refundOwed) less what PayPal already returned through the tenants'
 *  PayPal dispute and the refunds made in PayPal that the landlord recorded as this deposit's refund. */
export const refundStillOwed = (f: Pick<CloseOutFacts, "totals" | "wholeDeposit" | "viaDispute" | "outside">) =>
  Math.round(Math.max(0, refundOwed(f) - (f.viaDispute?.amount ?? 0) - (f.outside?.amount ?? 0)) * 100) / 100;

/** What went back before the close-out's own refund, in words: PayPal's money through the tenants' PayPal dispute,
 *  and the refunds made in PayPal that the landlord recorded here. Empty when nothing did. */
export function priorWords(f: Pick<CloseOutFacts, "viaDispute" | "outside">, zone: string): string {
  const parts = [
    f.viaDispute ? `PayPal returned ${usd(f.viaDispute.amount)} to the tenants through their PayPal dispute${f.viaDispute.disputeId ? ` ${f.viaDispute.disputeId}` : ""}` : "",
    f.outside ? `${usd(f.outside.amount)} was refunded in PayPal${f.outside.refunds.length === 1 && f.outside.refunds[0].at ? ` on ${shortDate(dateIn(f.outside.refunds[0].at, zone))}` : ""} and recorded as this deposit's refund` : "",
  ].filter(Boolean);
  return parts.join(", and ");
}

/** The refund plan from the facts: blocked, nothing to refund, or the rail and amount with its reason (and, for the
 *  whole deposit, the tenants' note). Pure; exported for scripts/zone-check.mjs. */
export function refundPlan(f: CloseOutFacts, pack: StatePack): CloseOutFacts["plan"] {
  if (f.blockers.length) return { rail: "blocked", amount: 0, why: "Resolve the blockers first." };
  const owed = refundOwed(f);
  const amount = refundStillOwed(f);
  const via = f.viaDispute;
  const outside = f.outside;
  const notKept = (via?.notKept ?? 0) + (outside?.notKept ?? 0);
  if (amount <= 0) {
    return { rail: "nothing_to_refund", amount: 0,
      why: via && !outside && owed > 0
        ? `PayPal returned ${usd(via.amount)} to the tenants through their PayPal dispute${via.disputeId ? ` ${via.disputeId}` : ""}, which covers the ${usd(owed)} refund owed${via.notKept > 0 ? `; ${usd(via.notKept)} of the deductions is not kept` : ""}. Nothing more goes back from here. The itemized statement still goes out.`
        : outside && owed > 0
          ? `${capFirst(priorWords(f, pack.timeZone.id))}, which covers the ${usd(owed)} refund owed${notKept > 0 ? `; ${usd(notKept)} of the deductions is not kept` : ""}. Nothing more goes back from here. The itemized statement still goes out.`
          : `Deductions use the whole deposit${f.totals.balanceClaimed ? `, leaving ${usd(f.totals.balanceClaimed)} claimed from the tenants` : ""}. The itemized statement still goes out.` };
  }
  const p = railPlan(f, pack, amount);
  if (p.rail === "blocked") return p;
  const lead = [
    f.wholeDeposit ? "None of the deductions may be kept, so the whole deposit goes back." : "",
    via && !outside ? `PayPal already returned ${usd(via.amount)} through the tenants' PayPal dispute, so ${usd(amount)} of the ${usd(owed)} owed is left to send.` : "",
    outside ? `${capFirst(priorWords(f, pack.timeZone.id))}, so ${usd(amount)} of the ${usd(owed)} owed is left to send.` : "",
  ].filter(Boolean).join(" ");
  const out = lead ? { ...p, why: `${lead} ${p.why}` } : p;
  // The whole deposit goes back (nothing deducted, or every deduction forfeited): the tenants' note says so, not
  // "less itemized deductions".
  const inFull = f.totals.depositHeld > 0 && owed >= f.totals.depositHeld - 0.005;
  return inFull ? { ...out, noteToPayer: wholeDepositNote(amount, outside ? "outside" : via ? "dispute" : null) } : out;
}

const capFirst = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** The note on a refund of the whole deposit, under PayPal's 200 characters. `after`: what went back before it, if
 *  anything (PayPal's money through the tenants' dispute, or a refund made in PayPal and recorded here). */
export const wholeDepositNote = (amount: number, after: "dispute" | "outside" | null) => (after === "dispute"
  ? `The rest of your security deposit, ${usd(amount)}. With what PayPal returned through your dispute, the whole deposit is back: nothing is kept. The itemized statement follows.`
  : after === "outside"
    ? `The rest of your security deposit, ${usd(amount)}. With the refund already sent, the whole deposit is back: nothing is kept. The itemized statement follows.`
    : `Your whole security deposit, ${usd(amount)}, is returned: nothing is kept from it. The itemized statement follows.`);

function railPlan(f: CloseOutFacts, pack: StatePack, amount: number): CloseOutFacts["plan"] {
  const d = f.deposit!;
  // The rail is railFor's (refund-rail.ts), shared with a dispute's settlement; the words are the close-out's.
  // No written designation, where the state needs none for a refund of the original payment: back against that
  // payment inside PayPal's window, or not at all (a Payout goes only to an account the tenants named in writing).
  // Only as much as is left of the payment can go back against it (PayPal refunded part of it already).
  const room = f.paymentLeft != null ? { amount, remaining: f.paymentLeft } : {};
  if (!f.refundAgreement) {
    const c = railFor(d, null, room);
    if (c.rail === "refund_original_payment") {
      return { rail: "refund_original_payment", amount, captureId: c.captureId,
        why: `Paid ${paidAgo(c.daysSincePaid)} through PayPal, inside PayPal's ${REFUND_WINDOW_DAYS}-day refund window, so the refund goes back against that payment, to the account the tenants paid from.` };
    }
    return { rail: "blocked", amount: 0, why: c.rail === "blocked" && c.because === "short"
      ? `Only ${usd(f.paymentLeft ?? 0)} of the tenants' original PayPal payment is left to refund, less than the ${usd(amount)} owed, and the tenants named no PayPal account for a Payout.`
      : pack.refund.noDesignationBlocker };
  }
  const email = f.refundAgreement.paypalEmail;
  const c = railFor(d, email, room);
  if (c.rail === "refund_original_payment") {
    return { rail: "refund_original_payment", amount, captureId: c.captureId, email,
      why: `Paid ${paidAgo(c.daysSincePaid)} through PayPal from the account the tenants designated, inside PayPal's ${REFUND_WINDOW_DAYS}-day refund window, so the refund goes back against that payment.` };
  }
  const because = c.rail === "payout" ? c.because : "past_window";
  return { rail: "payout", amount, email, because,
    why: because === "no_capture" ? "There's no PayPal payment to refund against, so the money goes out as a Payout to the designated account."
      : because === "other_account" ? `The deposit was billed to ${d.billedTo ?? "another address"}, not the account the tenants designated, so it goes out as a Payout to ${email}.`
        : because === "no_date" ? `PayPal has no payment date for the deposit, so it goes out as a Payout to ${email}.`
          : because === "short" ? `Only ${usd(f.paymentLeft ?? 0)} of the original payment is left to refund, so it goes out as a Payout to ${email}.`
          : `The deposit was paid ${days(d.daysSincePaid ?? 0)} ago, past PayPal's ${REFUND_WINDOW_DAYS}-day refund window, so it goes out as a Payout to ${email}.` };
}

export type RefundIntent = { rail: Rail; amount: string; captureId?: string; email?: string };

/** The last word before money moves: recomputed from the database and PayPal at that moment, so a deduction edited
 *  after the agent proposed the refund, a second click, or a model mistake all stop here. Null means go. */
export async function guardRefund(tenancyId: string, p: RefundIntent) {
  return guardWithFacts(await closeOutFacts(tenancyId), p);
}

/** guardRefund's check against facts already loaded: for a page that has just read them and shows the answer. The
 *  money routes always call guardRefund, which reads the facts fresh. */
export function guardWithFacts(f: CloseOutFacts, p: RefundIntent) {
  if (f.plan.rail === "blocked") return `Blocked: ${f.blockers.join(" ")}`;
  if (p.rail !== f.plan.rail) return `Blocked: the rules call for ${f.plan.rail.replace(/_/g, " ")}, not ${p.rail.replace(/_/g, " ")}. ${f.plan.why}`;
  if (p.amount !== f.plan.amount.toFixed(2)) {
    const basis = (f.wholeDeposit ? `the whole deposit: the ${usd(f.totals.deductions)} in deductions is forfeited` : `deposit ${usd(f.totals.depositHeld)} minus ${usd(f.totals.deductions)} in deductions`)
      + (f.viaDispute ? `, less the ${usd(f.viaDispute.amount)} PayPal returned through the tenants' PayPal dispute` : "")
      + (f.outside ? `, less the ${usd(f.outside.amount)} refunded in PayPal and recorded as this deposit's refund` : "");
    return `Blocked: the refund owed is ${usd(f.plan.amount)} (${basis}), not $${p.amount}.`;
  }
  if (p.rail === "refund_original_payment" && p.captureId !== f.plan.captureId) return `Blocked: the deposit payment is ${f.plan.captureId}, not ${p.captureId}.`;
  if (p.rail === "payout" && p.email?.toLowerCase() !== f.plan.email?.toLowerCase()) return `Blocked: the tenants designated ${f.plan.email}, not ${p.email}.`;
  return null;
}
