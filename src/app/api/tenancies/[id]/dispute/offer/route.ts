import { makeOffer, negotiationDispute } from "@/lib/negotiation";
import { routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";

// The landlord's own offer to the tenants: an amount back between the two sides' last figures, or the tenants' ask
// accepted as it is. Checked against the lawful range like every turn; the landlord's policy limits its agent, not the
// landlord. An offer equal to the tenants' ask is an agreement, which then waits on the tenants' acceptance.
export async function POST(req: Request, ctx: RouteContext<"/api/tenancies/[id]/dispute/offer">) {
  const { id } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const b = (await req.json().catch(() => null)) as { amount?: unknown; accept?: unknown; message?: unknown } | null;
  if (!b || typeof b !== "object") return Response.json({ error: "Say how much goes back." }, { status: 400 });
  const accept = b.accept === true;
  const amount = accept ? null : Number(b.amount);
  if (!accept && !Number.isFinite(amount)) return Response.json({ error: "Say how much goes back." }, { status: 400 });
  const message = typeof b.message === "string" ? b.message.slice(0, 600) : null;
  const d = await negotiationDispute(id);
  if (!d) return Response.json({ error: "The tenants haven't sent a dispute." }, { status: 404 });
  const r = await makeOffer(id, d, "landlord", { amount, accept, message });
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json(r);
}
