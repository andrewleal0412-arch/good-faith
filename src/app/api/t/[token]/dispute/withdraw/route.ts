import { audit, db } from "@/lib/db";
import { bad, canWithdraw, disputeFacts, tenantWrite } from "@/lib/disputes";
import { loadSettlement, NEGOTIATION_STALE_SECONDS, negotiationDispute, runningNow, unconfirmed } from "@/lib/negotiation";
import { tokenNotFound } from "@/lib/tenant-links";

export const runtime = "nodejs";

// "Withdraw dispute": the tenants take back a dispute they sent, so the statement stands as the landlord sent it. The
// landlord's page then shows it as withdrawn, its deductions may change again, and the tenants may dispute the
// statement again later from their link (a new dispute; src/app/api/t/[token]/dispute/route.ts). Refused while the
// agents are negotiating, after the tenants accepted a settlement, and while a settlement payment is on its way or
// unconfirmed: withdraw_dispute checks those under the dispute's row lock. Authorized by the link token alone.
export async function POST(req: Request, ctx: RouteContext<"/api/t/[token]/dispute/withdraw">) {
  const { token } = await ctx.params;
  const link = await tenantWrite(token);
  if (link instanceof Response) return link;
  const b = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const [d, facts] = await Promise.all([negotiationDispute(link.tenancyId), disputeFacts(link.tenancyId)]);
  if (!facts) return tokenNotFound();
  if (!d || !["open", "negotiating", "agreed"].includes(d.status)) return bad("There's no open dispute to withdraw.", 409);
  if (runningNow(d)) return bad("The agents are negotiating right now. Withdraw once they finish.", 409);
  const s = d.status === "agreed" ? await loadSettlement(d.id) : null;
  if (!canWithdraw({ status: d.status, running: false, settlement: s ? { status: s.status, tenantAccepted: !!s.tenant_accepted_at, unconfirmed: unconfirmed(s) } : null })) {
    return bad("A settlement you accepted, or its payment, holds this dispute, so it can't be withdrawn now.", 409);
  }
  const name = typeof b?.name === "string" && b.name ? b.name : d.opened_by ?? (facts.tenants.length === 1 ? facts.tenants[0] : "");
  if (!name || !facts.tenants.includes(name)) return bad("Pick your name as it appears on the lease.");

  const { data, error } = await db.rpc("withdraw_dispute", { p_dispute: d.id, p_stale_seconds: NEGOTIATION_STALE_SECONDS });
  if (error) {
    console.error("dispute withdrawal failed", error.message);
    return bad("Couldn't withdraw it. Try again.", 500);
  }
  if (!data) return bad("This dispute can't be withdrawn now: a settlement you accepted, or its payment, holds it. Reload the page.", 409);
  await audit(link.tenancyId, "tenant", "dispute_withdrawn", { dispute_id: d.id, name, link_id: link.linkId });
  return Response.json({ ok: true });
}
