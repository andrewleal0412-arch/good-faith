import { negotiationDispute } from "@/lib/negotiation";
import { paySettlement } from "@/lib/settlement";
import { routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 60;

// "Approve and pay": the landlord approves the settlement the tenants accepted, and the agreed amount goes back through
// PayPal (src/lib/settlement.ts). Claimed once in the database, so a double click pays once; refused for a deposit this
// workspace doesn't own, and re-checked against PayPal's live state right before the money moves.
export async function POST(_req: Request, ctx: RouteContext<"/api/tenancies/[id]/dispute/settle">) {
  const { id } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const d = await negotiationDispute(id);
  if (!d) return Response.json({ error: "The tenants haven't sent a dispute." }, { status: 404 });
  const r = await paySettlement(id, d.id);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json(r);
}
