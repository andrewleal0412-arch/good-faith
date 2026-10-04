// Which way money goes back to the tenants through PayPal. The close-out's refund (closeout.ts) and a dispute's
// settlement (settlement.ts) both decide by this one function, so the two can't drift: against the tenants' original
// payment while PayPal can still refund it (inside its window, paid from the account the tenants named where they named
// one, and with enough of it left), else a Payout to the account they named in writing, else nowhere yet. Pure: the
// callers read the facts from the database and PayPal, and word the reasons for their own page.

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
