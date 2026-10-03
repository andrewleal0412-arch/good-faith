import { audit, db } from "@/lib/db";
import { ADVOCATE_STALE_SECONDS, bad, caseIsCurrent, disputeFacts, firstTurn, liveDispute, tenantWrite } from "@/lib/disputes";
import { tokenNotFound } from "@/lib/tenant-links";

export const runtime = "nodejs";

// "Send to landlord": the draft becomes an open dispute, with the tenants' case as the first turn of the negotiation,
// every amount re-checked against the lawful range as it stands now. `withCase` sends the advocate's case, refused when
// it was written before the draft or the statement last changed; without it the tenants send their own reasons, and
// any case they had stays theirs. One database function locks the draft, refuses while the advocate is still writing,
// records the turn and opens the dispute, so a second tap sends nothing twice.
export async function POST(req: Request, ctx: RouteContext<"/api/t/[token]/dispute/send">) {
  const { token } = await ctx.params;
  const link = await tenantWrite(token);
  if (link instanceof Response) return link;
  const body: unknown = await req.json().catch(() => null);
  const withCase = !!body && typeof body === "object" && (body as { withCase?: unknown }).withCase === true;
  const [dispute, facts] = await Promise.all([liveDispute(link.tenancyId), disputeFacts(link.tenancyId)]);
  if (!facts) return tokenNotFound();
  if (!dispute) return bad("Save your reasons first.", 409);
  if (dispute.status !== "draft") return bad("Your dispute is already with your landlord.", 409);
  if (!facts.deliveredAt) return bad("A dispute opens once your landlord has sent the itemized statement.", 409);
  if (!dispute.deduction_ids.some((id) => facts.deductions.some((d) => d.id === id))) return bad("Pick at least one deduction first.");
  if (dispute.advocate_status === "running") return bad("Your advocate is still working. Send it once the case is in.", 409);
  if (withCase && !caseIsCurrent(dispute, facts)) {
    return bad(dispute.advocate
      ? "Your dispute changed after your advocate wrote this case. Ask again, or send your reasons as they are."
      : "Your advocate hasn't written a case yet.", 409);
  }

  const { turn, asked } = firstTurn(dispute, facts, withCase);
  const { data: turnId, error } = await db.rpc("send_dispute", { p_dispute: dispute.id, p_turn: turn, p_asked: asked });
  if (error) {
    console.error("dispute send failed", error.message);
    return bad("Couldn't send that. Try again.", 500);
  }
  if (!turnId) {
    // Refused under the lock: sent by a second tap, or the advocate started writing a moment ago.
    const { data: now } = await db.from("disputes").select("status, advocate_status, advocate_started_at").eq("id", dispute.id).maybeSingle();
    const writing = now?.status === "draft" && now.advocate_status === "running"
      && Date.parse(now.advocate_started_at as string) > Date.now() - ADVOCATE_STALE_SECONDS * 1000;
    return bad(writing ? "Your advocate is still working. Send it once the case is in." : "Your dispute is already with your landlord.", 409);
  }
  await audit(link.tenancyId, "tenant", "dispute_opened", {
    name: dispute.opened_by, lines: dispute.deduction_ids.length, amount_back: asked, by_advocate: turn.actor === "agent", link_id: link.linkId,
  });
  return Response.json({ ok: true, askedBack: asked });
}
