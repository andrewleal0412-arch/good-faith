import { bad, disputeFacts, tenantWrite } from "@/lib/disputes";
import { acceptSettlement, negotiationDispute } from "@/lib/negotiation";
import { tokenNotFound } from "@/lib/tenant-links";

export const runtime = "nodejs";

// "Accept settlement": the tenants accept what the two sides agreed. Nothing moves until the landlord approves it too;
// then the agreed amount goes back through PayPal. Recorded once, with the name of the tenant who accepted.
export async function POST(req: Request, ctx: RouteContext<"/api/t/[token]/dispute/accept">) {
  const { token } = await ctx.params;
  const link = await tenantWrite(token);
  if (link instanceof Response) return link;
  const b = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const [d, facts] = await Promise.all([negotiationDispute(link.tenancyId), disputeFacts(link.tenancyId)]);
  if (!facts) return tokenNotFound();
  if (!d) return bad("There's no dispute to settle.", 409);
  const name = typeof b?.name === "string" && b.name ? b.name : d.opened_by ?? (facts.tenants.length === 1 ? facts.tenants[0] : "");
  if (!name || !facts.tenants.includes(name)) return bad("Pick your name as it appears on the lease.");
  const r = await acceptSettlement(link.tenancyId, d, name);
  if (!r.ok) return bad(r.error, r.status);
  return Response.json({ ok: true });
}
