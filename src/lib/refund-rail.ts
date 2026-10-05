// Which way money goes back to the tenants through PayPal. The close-out's refund (closeout.ts) and a dispute's
// settlement (settlement.ts) both decide by this one function, so the two can't drift: against the tenants' original
// payment while PayPal can still refund it (inside its window, paid from the account the tenants named where they named
// one, and with enough of it left), else a Payout to the account they named in writing, else nowhere yet. Pure: the
// callers read the facts from the database and PayPal, and word the reasons for their own page.

import { returnFailed } from "./invoice-status";

/** PayPal policy, not law: a payment can be refunded against itself for 180 days; after that the money goes out as a
 *  Payout. */
export const REFUND_WINDOW_DAYS = 180;

/** The deposit payment as PayPal reports it. */
export type RailFacts = { captureId: string | null; daysSincePaid: number | null; billedTo: string | null };

export type RailChoice =
  | { rail: "refund_original_payment"; captureId: string; daysSincePaid: number }
  // Why a Payout and not a refund: no payment to refund against, paid from another account than the one named, no
  // payment date, past the window, or too little of the payment left (a settlement after the statement's refund).
  | { rail: "payout"; email: string; because: "no_capture" | "other_account" | "no_date" | "past_window" | "short" }
  // Nowhere yet: no written designation for a Payout, and the payment can't take the refund.
  | { rail: "blocked"; because: "no_designation" | "short" };

/** `designated` is the PayPal account the tenants named in writing, or null. `remaining` (with `amount`) is what is
 *  left of the payment to refund, for money sent after an earlier refund of it. */
export function railFor(d: RailFacts, designated: string | null, o: { amount?: number; remaining?: number } = {}): RailChoice {
  const inWindow = !!d.captureId && d.daysSincePaid != null && d.daysSincePaid <= REFUND_WINDOW_DAYS;
  const sameAccount = !designated || (!!d.billedTo && d.billedTo.toLowerCase() === designated.toLowerCase());
  const covers = o.remaining == null || o.amount == null || o.amount <= o.remaining + 0.005;
  if (inWindow && sameAccount && covers) return { rail: "refund_original_payment", captureId: d.captureId!, daysSincePaid: d.daysSincePaid! };
  if (designated) {
    return { rail: "payout", email: designated,
      because: !d.captureId ? "no_capture" : !sameAccount ? "other_account" : d.daysSincePaid == null ? "no_date" : !inWindow ? "past_window" : "short" };
  }
  return { rail: "blocked", because: inWindow ? "short" : "no_designation" };
}

/** What a settlement added to the money back, as the amended statement and the tenants' page count it: the agreed
 *  amount, but never more than the deposit left after the statement's refund. A close-out that returned the whole
 *  deposit (New York's forfeited deductions under a live dispute) leaves nothing, and its settlement moved no money
 *  (settlement.ts). */
export function settledExtra(o: { agreed: number; depositHeld: number; refunded: number }): number {
  return Math.round(Math.max(0, Math.min(o.agreed, o.depositHeld - o.refunded)) * 100) / 100;
}

/** What a settlement may still send: the deposit less every return that didn't fail (the statement's refund, an
 *  earlier Payout, PayPal's refunds through the tenants' PayPal dispute). The agreed amount goes only when it fits:
 *  a PayPal dispute refund can leave less of the deposit than the lawful range assumed, and paying the agreed amount
 *  then would send back money the deposit never held. The settlement pages show the same ceiling (settledExtra). */
export function settlementRoom(o: { amount: number; depositHeld: number; returned: number }): { left: number; fits: boolean } {
  const left = Math.round(Math.max(0, o.depositHeld - o.returned) * 100) / 100;
  return { left, fits: o.amount <= left + 0.005 };
}

/** Whether the close-out returns the whole deposit with deductions still on file: they are forfeited (New York after
 *  day 14) and a dispute the tenants sent holds them, so they can't be removed first. Otherwise a forfeiture blocks the
 *  refund until the landlord removes them, and the close-out never sends less than the whole deposit either way. */
export const wholeDepositOwed = (o: { forfeits: boolean; disputeLive: boolean; alreadyReturned: boolean; depositHeld: number }) =>
  o.forfeits && o.disputeLive && !o.alreadyReturned && o.depositHeld > 0;

/** What the close-out returns: the deposit less the deductions, or the whole deposit when wholeDepositOwed. The
 *  settlement reads the same figure for the refund that must go before it. */
export const refundOwed = (f: { totals: { depositHeld: number; refund: number }; wholeDeposit?: boolean }) =>
  (f.wholeDeposit ? f.totals.depositHeld : f.totals.refund);

/** Money PayPal returned through the tenants' PayPal disputes, from a tenancy's payments: every dispute refund that
 *  didn't fail (one an accepted claim left pending counts: PayPal sends it). Null when there is none. */
export function disputeReturns(payments: { kind: string; paypal_id: string | null; amount: number | string; status: string; created_at?: string }[]) {
  const rows = payments.filter((p) => p.kind === "dispute_refund" && !returnFailed(p.status));
  if (!rows.length) return null;
  return { amount: Math.round(rows.reduce((s, p) => s + Number(p.amount), 0) * 100) / 100, disputeId: rows[0].paypal_id, at: rows[0].created_at ?? "" };
}
