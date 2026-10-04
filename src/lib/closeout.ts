import "server-only";
import { pacificDate, paypalPaidAt } from "./dates";
import { db } from "./db";
import { depositBlock } from "./demo-pool";
import { missingDocs, settle, usd, type StoredDeduction } from "./deductions";
import { wasPaid } from "./invoice-status";
import type { Notices } from "./notices";
import { getInvoice, type Invoice } from "./paypal";
import { railFor, REFUND_WINDOW_DAYS } from "./refund-rail";
import { packFor } from "./states/server";
import type { StatePack } from "./states/types";
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

export type CloseOutFacts = {
  today: string;
  tenancy: { address: string; tenants: string[]; moveOutDate: string | null; statementDue: string | null; daysLeft: number | null };
  deposit: { invoiceId: string; status: string; amount: number; paidAt: string | null; method: string | null; captureId: string | null;
    daysSincePaid: number | null; billedTo: string | null; live: boolean } | null;
  refundAgreement: { paypalEmail: string; signedBy: string[]; signedAt: string } | null;
  deductions: { item: string; room: string | null; category: string; amount: number; math: string; missingDocs: string[] }[];
  totals: { depositHeld: number; deductions: number; refund: number; balanceClaimed: number; documentsRequired: boolean };
  alreadyReturned: { kind: string; amount: number; paypalId: string; at: string } | null;
  plan: { rail: Rail; amount: number; captureId?: string; email?: string; why: string };
  blockers: string[];
  warnings: string[];
  rules: Record<string, string>;
  // How the claimed amounts stand when they are not plain deductions (Florida: disputed by a timely objection; New
  // York: kept after day 14 under the landlord's acknowledgment). Absent otherwise, and always in California.
  standing?: { label: string; note: string };
};

/** The only citations the agent may use: the tenancy's pack's. It cites from this list, never from memory (it once
 *  mixed up California's (g) and (h)). */
export const rulesFor = (pack: StatePack) => pack.close.rules;

const pacificToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
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
  const today = pacificToday();
  const [{ data: t }, { data: payments }, { data: rows }] = await Promise.all([
    db.from("tenancies").select("*, properties(address, state)").eq("id", tenancyId).single(),
    db.from("payments").select("*").eq("tenancy_id", tenancyId).order("created_at"),
    db.from("deductions").select("*").eq("tenancy_id", tenancyId).order("created_at"),
  ]);
  if (!t) throw new Error("No such tenancy.");
  const pack = packFor((t.properties as { state?: string | null } | null)?.state);
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

  // The deposit as PayPal reports it right now, not as we stored it. If PayPal can't be reached, the statement still
  // renders from what the tenancy page last stored, but no money moves on stale facts: the outage is a blocker.
  const inv = (payments ?? []).find((p) => p.kind === "deposit_invoice");
  let deposit: CloseOutFacts["deposit"] = null;
  let fetched: Invoice | null = null;
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
      // The Pacific day it was paid, as every page shows it, so "Paid yesterday" and the payment's date agree.
      daysSincePaid: paidAt ? daysBetween(pacificDate(paidAt), today) : null,
      billedTo: live.primary_recipients?.[0]?.billing_info?.email_address ?? null,
      live: isLive,
    };
    if (!wasPaid(live.status)) blockers.push(`The deposit invoice is ${live.status.toLowerCase().replace(/_/g, " ")} in PayPal, not paid, so there's nothing to return through PayPal.`);
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
  // A demo copy refunds only a sandbox deposit of its own (src/lib/demo-pool.ts): one made when the pool was empty, and
  // every copy of the Texas unit, shows the template's deposit, which is never refunded from a copy.
  const demoBlock = !alreadyReturned && inv?.paypal_id ? await depositBlock(t.workspace_id as string, inv.paypal_id) : null;
  if (demoBlock) blockers.push(demoBlock);
  if (alreadyReturned) blockers.push(`The deposit was already returned: ${usd(alreadyReturned.amount)} by PayPal ${alreadyReturned.kind} ${alreadyReturned.paypalId} on ${alreadyReturned.at.slice(0, 10)}, sent by this close-out after the landlord approved it. Don't send another.`);

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
  // which reads last.
  const ctx = {
    today, notices, endDate: t.end_date as string | null, plannedMoveOut: t.planned_move_out as string | null, deductionsCount: deductions.length,
    forwarding: tm ? { address: tm.forwarding_address, date: pacificDate(tm.updated_at) } : null,
  };
  const extra = pack.close.extraBlockers(facts, ctx);
  if (extra.length) {
    const at = alreadyReturned ? blockers.length - 1 : blockers.length;
    blockers.splice(at, 0, ...extra);
  }
  warnings.push(...pack.close.extraWarnings(facts, ctx));
  const standing = pack.close.standing?.({ today, notices, claimed: s.total, statementDue: due });
  if (standing) facts.standing = standing;
  // Without a written designation (where the state needs none for a refund of the original payment), a payment that
  // can't be refunded against itself has nowhere lawful to go yet.
  const d = facts.deposit;
  if (!agreement && !pack.refund.agreementRequired && d && wasPaid(d.status) && s.refund > 0 && !alreadyReturned
    && !(d.captureId && d.daysSincePaid != null && d.daysSincePaid <= REFUND_WINDOW_DAYS)) {
    blockers.push(pack.refund.noDesignationBlocker);
  }
  facts.plan = plan(facts, pack);
  return { facts, invoice: fetched, workspaceId: t.workspace_id as string, pack, payments: payments ?? [] };
}

function plan(f: CloseOutFacts, pack: StatePack): CloseOutFacts["plan"] {
  if (f.blockers.length) return { rail: "blocked", amount: 0, why: "Resolve the blockers first." };
  const amount = f.totals.refund;
  if (amount <= 0) {
    return { rail: "nothing_to_refund", amount: 0,
      why: `Deductions use the whole deposit${f.totals.balanceClaimed ? `, leaving ${usd(f.totals.balanceClaimed)} claimed from the tenants` : ""}. The itemized statement still goes out.` };
  }
  const d = f.deposit!;
  // The rail is railFor's (refund-rail.ts), shared with a dispute's settlement; the words are the close-out's.
  // No written designation, where the state needs none for a refund of the original payment: back against that
  // payment inside PayPal's window, or not at all (a Payout goes only to an account the tenants named in writing).
  if (!f.refundAgreement) {
    const c = railFor(d, null);
    if (c.rail === "refund_original_payment") {
      return { rail: "refund_original_payment", amount, captureId: c.captureId,
        why: `Paid ${paidAgo(c.daysSincePaid)} through PayPal, inside PayPal's ${REFUND_WINDOW_DAYS}-day refund window, so the refund goes back against that payment, to the account the tenants paid from.` };
    }
    return { rail: "blocked", amount: 0, why: pack.refund.noDesignationBlocker };
  }
  const email = f.refundAgreement.paypalEmail;
  const c = railFor(d, email);
  if (c.rail === "refund_original_payment") {
    return { rail: "refund_original_payment", amount, captureId: c.captureId, email,
      why: `Paid ${paidAgo(c.daysSincePaid)} through PayPal from the account the tenants designated, inside PayPal's ${REFUND_WINDOW_DAYS}-day refund window, so the refund goes back against that payment.` };
  }
  const because = c.rail === "payout" ? c.because : "past_window";
  return { rail: "payout", amount, email,
    why: because === "no_capture" ? "There's no PayPal payment to refund against, so the money goes out as a Payout to the designated account."
      : because === "other_account" ? `The deposit was billed to ${d.billedTo ?? "another address"}, not the account the tenants designated, so it goes out as a Payout to ${email}.`
        : because === "no_date" ? `PayPal has no payment date for the deposit, so it goes out as a Payout to ${email}.`
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
  if (p.amount !== f.plan.amount.toFixed(2)) return `Blocked: the refund owed is ${usd(f.plan.amount)} (deposit ${usd(f.totals.depositHeld)} minus ${usd(f.totals.deductions)} in deductions), not $${p.amount}.`;
  if (p.rail === "refund_original_payment" && p.captureId !== f.plan.captureId) return `Blocked: the deposit payment is ${f.plan.captureId}, not ${p.captureId}.`;
  if (p.rail === "payout" && p.email?.toLowerCase() !== f.plan.email?.toLowerCase()) return `Blocked: the tenants designated ${f.plan.email}, not ${p.email}.`;
  return null;
}
