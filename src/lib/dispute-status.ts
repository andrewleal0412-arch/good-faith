// Where a tenants' dispute stands and what may happen next, in plain code with no database, so the routes, the pages
// and scripts/negotiation-check.mjs read the same rules. disputes.ts re-exports these.

export type DisputeStatus = "draft" | "open" | "negotiating" | "agreed" | "settled" | "no_agreement" | "withdrawn";
export const LIVE_STATUSES: DisputeStatus[] = ["draft", "open", "negotiating", "agreed"];
/** Sent to the landlord and not yet closed: the statement's deductions stay as they are (deductionsFrozen). */
export const SENT_LIVE_STATUSES: DisputeStatus[] = ["open", "negotiating", "agreed"];

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
