import "server-only";
import { db } from "./db";

// The pre-paid sandbox deposits behind the demo copies (demo_deposit_pool, filled by scripts/demo-pool.mjs). Each copy
// of the move-out unit is made with one of them, so its refund runs against a payment of its own. A copy made when
// the pool was empty points at the template's deposit to look the same, and must never refund it: that money belongs
// to the template (and to every other copy that points at it).

/** The plain sentence a demo copy shows, and the close-out facts carry as a blocker, when it has no deposit of its own. */
export const POOL_EMPTY = "Today's sandbox deposits for the demo are used up, so this copy can't send a refund. Everything else works.";

/** Why a demo copy's deposit is dated recently while its lease began a year ago: it is a real payment in the PayPal
 *  sandbox, made for the demo, and PayPal's dates are PayPal's (the refund goes back against that payment, inside
 *  PayPal's 180-day window, so they must stay). Shown in the deposit's tips on a demo copy. */
export const DEMO_DEPOSIT_DATE = "In this demo copy the deposit is a real PayPal sandbox payment made for the demo, so PayPal dates it recently, not on move-in day.";

/** True when a tenancy in a demo workspace may not refund this deposit invoice: it is a pool deposit claimed by another
 *  workspace (or by none: it went back to the pool), or it is not a pool deposit and another workspace's records point
 *  at it too (the template's own, which a copy made with an empty pool shows). A demo copy's own invoice, sent from its
 *  own tenancy, is refundable as in any workspace. The owner's workspace is never limited here. */
export async function depositNotOurs(workspaceId: string, invoiceId: string | null | undefined): Promise<boolean> {
  if (!invoiceId) return false;
  const { data: ws } = await db.from("workspaces").select("kind").eq("id", workspaceId).maybeSingle();
  if (ws?.kind !== "demo") return false;
  const { data: pool, error } = await db.from("demo_deposit_pool").select("claimed_by").eq("invoice_id", invoiceId).maybeSingle();
  // When the pool can't be read, nothing is sent: the refund waits rather than risk another copy's deposit.
  if (error) return true;
  if (pool) return pool.claimed_by !== workspaceId;
  const { data: shared, error: e2 } = await db.from("payments").select("id, tenancies!inner(workspace_id)")
    .eq("paypal_id", invoiceId).neq("tenancies.workspace_id", workspaceId).limit(1);
  return !!e2 || !!shared?.length;
}

/** depositNotOurs for a tenancy's own deposit invoice: true when this demo copy may not refund it. The close-out route
 *  checks it before the agent starts, and the approval route before an approved run resumes (a copy that gave its
 *  deposit back on Start over keeps any refund it had prepared, which must not resume and spend a Claude call). */
export async function tenancyDepositNotOurs(workspaceId: string, tenancyId: string): Promise<boolean> {
  const { data: inv } = await db.from("payments").select("paypal_id").eq("tenancy_id", tenancyId).eq("kind", "deposit_invoice")
    .order("created_at").limit(1).maybeSingle();
  return depositNotOurs(workspaceId, inv?.paypal_id);
}
