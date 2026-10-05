// Where a tenants' dispute stands and what may happen next, in plain code with no database, so the routes, the pages
// and scripts/negotiation-check.mjs read the same rules. disputes.ts re-exports these.

import { returnFailed } from "./invoice-status";

export type DisputeStatus = "draft" | "open" | "negotiating" | "agreed" | "settled" | "no_agreement" | "withdrawn";
export const LIVE_STATUSES: DisputeStatus[] = ["draft", "open", "negotiating", "agreed"];
/** Sent to the landlord and not yet closed: the statement's deductions stay as they are (deductionsLock). */
export const SENT_LIVE_STATUSES: DisputeStatus[] = ["open", "negotiating", "agreed"];

export type DeductionsLock = { code: "returned" | "settled" | "paypal_dispute" | "disputed"; message: string };

/** Why the statement's deductions can't be added to, changed or removed any more, or null while they may. The three
 *  deduction routes (deductionsLocked in disputes.ts) and the Move-out tab read this one rule, so the page shows read
 *  only exactly what the routes refuse. Locked:
 *  - once the close-out's refund or Payout went out (any row of it, as the close-out reads it);
 *  - once a settlement sent money or the tenants' dispute was settled: the settlement was agreed over these lines, and a
 *    charge lowered afterwards would send the difference back on top of it (a statement whose own refund was $0 is
 *    settled with no refund row at all);
 *  - once PayPal's refund through the tenants' PayPal dispute covers the refund the statement owes (the Move-out tab
 *    then reads the deposit as returned); `refundOwed` is the statement's refund as it stands, null when no deposit was
 *    paid;
 *  - while a dispute the tenants sent is open. */
export function deductionsLock(o: {
  payments: { kind: string; amount: number | string; status: string | null }[];
  disputes: DisputeStatus[];
  refundOwed: number | null;
}): DeductionsLock | null {
  if (o.payments.some((p) => p.kind === "refund" || p.kind === "payout")) {
    return { code: "returned", message: "The deposit has already been returned, so the deductions are final." };
  }
  if (o.disputes.includes("settled") || o.payments.some((p) => p.kind === "settlement_refund" || p.kind === "settlement_payout")) {
    return { code: "settled", message: "The tenants' dispute of this statement was settled, so its deductions stay as they were settled." };
  }
  const via = o.payments.filter((p) => p.kind === "dispute_refund" && !returnFailed(p.status)).reduce((s, p) => s + Number(p.amount), 0);
  if (via > 0.005 && o.refundOwed != null && o.refundOwed - via <= 0.005) {
    return { code: "paypal_dispute", message: "PayPal returned the refund owed through the tenants' PayPal dispute, so the deductions are final." };
  }
  if (o.disputes.some((s) => SENT_LIVE_STATUSES.includes(s))) {
    return { code: "disputed", message: "The tenants disputed this statement, so its deductions stay as they are while the dispute is open." };
  }
  return null;
}

/** Ended: settled, no agreement or withdrawn. */
export const isClosed = (s: DisputeStatus) => !LIVE_STATUSES.includes(s);

/** One live dispute per statement at a time. A settled dispute and one that ended with no agreement stay closed; one the
 *  tenants withdrew may be opened again from their link, as a new dispute of the same statement (Andrew, 2026-10-04). */
export const reopens = (s: DisputeStatus) => s === "withdrawn";

/** What a save on the tenants' link does, given their latest dispute: change the draft, open a new one (none yet, or
 *  the last one withdrawn), or refuse (sent and still live, or closed for good). */
export function draftAction(latest: DisputeStatus | null): "update" | "create" | "sent" | "closed" {
  if (!latest || reopens(latest)) return "create";
  if (latest === "draft") return "update";
  return isClosed(latest) ? "closed" : "sent";
}

/** Whether the tenants may withdraw a dispute they sent: still live, the agents not running, no settlement they
 *  accepted, and no settlement payment on its way, sent or unconfirmed. The database's withdraw_dispute checks the same
 *  under the dispute's row lock (supabase/migrations/20261005071159_dispute_withdraw_and_reopen.sql). */
export function canWithdraw(o: {
  status: DisputeStatus; running: boolean;
  settlement: { status: string; tenantAccepted: boolean; unconfirmed: boolean } | null;
}): boolean {
  if (!SENT_LIVE_STATUSES.includes(o.status) || o.running) return false;
  const s = o.settlement;
  if (!s || s.status === "cancelled") return true;
  return !s.tenantAccepted && s.status !== "sending" && s.status !== "sent" && !s.unconfirmed;
}
