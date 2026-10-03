import { audit, db } from "@/lib/db";
import { deductionsFrozen } from "@/lib/disputes";
import { mayRemove, routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";

// Remove a deduction before the statement goes out. Its receipt goes too (when this workspace stored it); after-repair
// photos stay as evidence. Refused while a dispute the tenants sent is open: the negotiation is over these lines.
export async function DELETE(_req: Request, ctx: RouteContext<"/api/tenancies/[id]/deductions/[did]">) {
  const { id, did } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const { data: d } = await db.from("deductions").select("item, amount, receipt_path").eq("id", did).eq("tenancy_id", id).single();
  if (!d) return Response.json({ error: "No such deduction." }, { status: 404 });
  const { data: sent } = await db.from("payments").select("id").eq("tenancy_id", id).in("kind", ["refund", "payout"]).limit(1);
  if (sent?.length) return Response.json({ error: "The deposit has already been returned, so the deductions are final." }, { status: 409 });
  const frozen = await deductionsFrozen(id);
  if (frozen) return frozen;
  // Only a receipt this workspace uploaded for this tenancy is removed. A demo copy's deductions point at the template's
  // receipts, which every copy shares and none may delete.
  if (d.receipt_path && (await mayRemove(ws, id, d.receipt_path))) await db.storage.from("receipts").remove([d.receipt_path]);
  await db.from("deductions").delete().eq("id", did);
  await audit(id, "landlord", "deduction_removed", { item: d.item, amount: Number(d.amount) });
  return Response.json({ ok: true });
}
