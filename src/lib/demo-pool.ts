import "server-only";
import { db } from "./db";

// The pre-paid sandbox deposits behind the demo copies (demo_deposit_pool, filled by scripts/demo-pool.mjs). Each copy
// of the move-out unit is made with one of them, so its refund runs against a payment of its own. A copy made when
// the pool was empty points at the template's deposit to look the same, and must never refund it: that money belongs
// to the template (and to every other copy that points at it). The Texas unit is copied before its move-out and never
// takes a pool deposit, so its copy always points at its template's deposit and never refunds it either.

/** The plain sentence a demo copy shows, and the close-out facts carry as a blocker, when it has no deposit of its own. */
export const POOL_EMPTY = "Today's sandbox deposits for the demo are used up, so this copy can't send a refund. Everything else works.";

/** The same for a unit that is copied without a deposit of its own by design (the Texas unit, copied at the notice):
 *  its deposit is the template's sandbox payment, which every copy shows. */
export const SHARED_DEPOSIT = "In the demo this unit's deposit is one sandbox payment every copy shares, so this copy can't send its refund. Everything else works.";

/** The sentences above: a blocker that stops only a demo copy's refund, never a real tenancy's. */
export const DEMO_REFUND_BLOCKS = [POOL_EMPTY, SHARED_DEPOSIT];

/** Why a demo copy's deposit is dated recently while its lease began a year ago: it is a real payment in the PayPal
 *  sandbox, made for the demo, and PayPal's dates are PayPal's (the refund goes back against that payment, inside
 *  PayPal's 180-day window, so they must stay). Shown in the deposit's tips on a demo copy. */
export const DEMO_DEPOSIT_DATE = "In this demo copy the deposit is a real PayPal sandbox payment made for the demo, so PayPal dates it recently, not on move-in day.";

/** Why a tenancy in a demo workspace may not refund this deposit invoice, or null when it may. Not refundable: a pool
 *  deposit claimed by another workspace (or by none: it went back to the pool); a template tenancy's own deposit, which
 *  every copy of that template shows (a copy of the move-out unit made with an empty pool, or the Texas unit, which
 *  never takes one); any other invoice another workspace's records point at too. A demo copy's own invoice, sent from
 *  its own tenancy, is refundable as in any workspace. The owner's workspace is never limited here. When the records
 *  can't be read, nothing is sent: the refund waits rather than risk another copy's deposit. */
export async function depositBlock(workspaceId: string, invoiceId: string | null | undefined): Promise<string | null> {
  if (!invoiceId) return null;
  const { data: ws } = await db.from("workspaces").select("kind").eq("id", workspaceId).maybeSingle();
  if (ws?.kind !== "demo") return null;
  const { data: pool, error } = await db.from("demo_deposit_pool").select("claimed_by").eq("invoice_id", invoiceId).maybeSingle();
  if (error) return POOL_EMPTY;
  if (pool) return pool.claimed_by === workspaceId ? null : POOL_EMPTY;
  // A template's own deposit: never refunded from a copy, whether or not any other copy still points at it.
  const { data: templates, error: e1 } = await db.from("demo_templates").select("tenancy_id, role");
  if (e1) return POOL_EMPTY;
  const ids = (templates ?? []).map((t) => t.tenancy_id as string);
  if (ids.length) {
    const { data: theirs, error: e2 } = await db.from("payments").select("tenancy_id").eq("paypal_id", invoiceId).in("tenancy_id", ids).limit(5);
    if (e2) return POOL_EMPTY;
    if (theirs?.length) {
      // Only the move-out unit's copies take a pool deposit; for the others there is never one to take.
      const roles = new Set((templates ?? []).filter((t) => theirs.some((p) => p.tenancy_id === t.tenancy_id)).map((t) => t.role as string));
      return roles.has("move_out") ? POOL_EMPTY : SHARED_DEPOSIT;
    }
  }
  const { data: shared, error: e3 } = await db.from("payments").select("id, tenancies!inner(workspace_id)")
    .eq("paypal_id", invoiceId).neq("tenancies.workspace_id", workspaceId).limit(1);
  return e3 || shared?.length ? POOL_EMPTY : null;
}

/** depositBlock for a tenancy's own deposit invoice: the reason this demo copy may not refund it, or null. The
 *  close-out route checks it before the agent starts, and the approval route before an approved run resumes (a copy
 *  that gave its deposit back on Start over keeps any refund it had prepared, which must not resume and spend a Claude
 *  call). */
export async function tenancyDepositBlock(workspaceId: string, tenancyId: string): Promise<string | null> {
  const { data: inv } = await db.from("payments").select("paypal_id").eq("tenancy_id", tenancyId).eq("kind", "deposit_invoice")
    .order("created_at").limit(1).maybeSingle();
  return depositBlock(workspaceId, inv?.paypal_id);
}
