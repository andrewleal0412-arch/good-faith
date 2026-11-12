import { answerApproval, Shown } from "@/lib/agent";
import { openDisputeBlock } from "@/lib/chargeback-store";
import { db } from "@/lib/db";
import { tenancyDepositBlock } from "@/lib/demo-pool";
import { takeAllowance } from "@/lib/limits";
import { routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 300;

// The landlord approves or declines the money movement the agent proposed; the run then resumes.
export async function POST(req: Request, ctx: RouteContext<"/api/tenancies/[id]/close-out/[runId]">) {
  const { id, runId } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  // A body that isn't JSON answers 400 in words, like every sibling route, not a framework 500.
  const { approved } = ((await req.json().catch(() => null)) ?? {}) as { approved?: boolean };
  if (typeof approved !== "boolean") return Response.json({ error: "Approve or decline." }, { status: 400 });
  // A demo copy whose deposit went back to the pool (Start over) can't send the refund it prepared: refused here, before
  // the run resumes, rather than by guardRefund after another Claude call. Declining still works. A run id that isn't
  // this tenancy's goes on to answerApproval's "No such run."
  const { data: run } = await db.from("agent_runs").select("id, messages").eq("id", runId).eq("tenancy_id", id).maybeSingle();
  if (approved) {
    const blocked = run ? (await tenancyDepositBlock(ws.id, id)) ?? (await openDisputeBlock(id)) : null;
    if (blocked) return Response.json({ error: blocked }, { status: 409 });
  }
  // The first answer resumes the run its start paid for. Each later one (the landlord declined, the agent proposed
  // again) takes another close_out allowance, so declining over and over can't run the agent past the day's limit.
  const answered = ((run?.messages ?? []) as { role?: string; content?: unknown }[]).filter((m) => m.role === "tool" && Array.isArray(m.content)
    && m.content.some((c) => (c as { type?: string } | null)?.type === "tool-approval-response")).length;
  const allowance = answered ? await takeAllowance("close_out") : null;
  if (allowance?.refused) return allowance.refused;
  try {
    return Response.json(await answerApproval(id, runId, approved));
  } catch (e) {
    // answerApproval throws only before the agent's next Claude call (a failed run is returned, not thrown).
    await allowance?.giveBack();
    if (!(e instanceof Shown)) console.error("approval failed", e);
    return Response.json({ error: e instanceof Shown ? e.message : "Couldn't record that. Try again." }, { status: e instanceof Shown ? 400 : 500 });
  }
}
