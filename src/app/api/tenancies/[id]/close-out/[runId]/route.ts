import { answerApproval } from "@/lib/agent";
import { db } from "@/lib/db";
import { POOL_EMPTY, tenancyDepositNotOurs } from "@/lib/demo-pool";
import { routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 300;

// The landlord approves or declines the money movement the agent proposed; the run then resumes.
export async function POST(req: Request, ctx: RouteContext<"/api/tenancies/[id]/close-out/[runId]">) {
  const { id, runId } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const { approved } = (await req.json()) as { approved?: boolean };
  if (typeof approved !== "boolean") return Response.json({ error: "Approve or decline." }, { status: 400 });
  // A demo copy whose deposit went back to the pool (Start over) can't send the refund it prepared: refused here, before
  // the run resumes, rather than by guardRefund after another Claude call. Declining still works. A run id that isn't
  // this tenancy's goes on to answerApproval's "No such run."
  if (approved) {
    const { data: run } = await db.from("agent_runs").select("id").eq("id", runId).eq("tenancy_id", id).maybeSingle();
    if (run && (await tenancyDepositNotOurs(ws.id, id))) return Response.json({ error: POOL_EMPTY }, { status: 409 });
  }
  try {
    return Response.json(await answerApproval(id, runId, approved));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Couldn't record that." }, { status: 400 });
  }
}
