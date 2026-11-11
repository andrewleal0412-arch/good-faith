import { readJson } from "@/lib/body";
import { bad, disputeFacts, tenantWrite } from "@/lib/disputes";
import { makeOffer, negotiationDispute } from "@/lib/negotiation";
import { tokenNotFound } from "@/lib/tenant-links";

export const runtime = "nodejs";

// The tenants' own answer to the landlord's last offer: accept it (which is their acceptance of the settlement too), or
// ask for an amount between the two sides' last figures. Checked against the lawful range like every turn.
export async function POST(req: Request, ctx: RouteContext<"/api/t/[token]/dispute/offer">) {
  const { token } = await ctx.params;
  const link = await tenantWrite(token);
  if (link instanceof Response) return link;
  const b = (await readJson(req, 16_000)) as { amount?: unknown; accept?: unknown; message?: unknown; name?: unknown } | null;
  if (!b || typeof b !== "object") return bad("Say how much you ask back.");
  const accept = b.accept === true;
  const amount = accept ? null : Number(b.amount);
  if (!accept && !Number.isFinite(amount)) return bad("Say how much you ask back.");
  const [d, facts] = await Promise.all([negotiationDispute(link.tenancyId), disputeFacts(link.tenancyId)]);
  if (!facts) return tokenNotFound();
  if (!d) return bad("There's no dispute here.", 409);
  const name = typeof b.name === "string" && b.name ? b.name : d.opened_by ?? (facts.tenants.length === 1 ? facts.tenants[0] : "");
  if (!name || !facts.tenants.includes(name)) return bad("Pick your name as it appears on the lease.");
  const message = typeof b.message === "string" ? b.message.slice(0, 600) : null;
  const r = await makeOffer(link.tenancyId, d, "tenant", { amount, accept, message, tenantName: name });
  if (!r.ok) return bad(r.error, r.status);
  return Response.json(r);
}
