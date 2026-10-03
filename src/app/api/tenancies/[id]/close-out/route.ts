import { startCloseOut } from "@/lib/agent";
import { POOL_EMPTY, tenancyDepositNotOurs } from "@/lib/demo-pool";
import { takeAllowance } from "@/lib/limits";
import { routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 300;

// Start the close-out agent. It runs until it finishes or asks the landlord to approve a money movement.
export async function POST(_req: Request, ctx: RouteContext<"/api/tenancies/[id]/close-out">) {
  const { id } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  // A demo copy made when the day's sandbox deposits were used up can't send its refund, so the agent isn't started
  // for it (no Claude call is spent on a refund that would be blocked). Everything else on the copy still works.
  if (await tenancyDepositNotOurs(ws.id, id)) return Response.json({ error: POOL_EMPTY }, { status: 409 });
  // Today's allowance, checked before the agent's first Claude call. The approval that resumes this run is part of
  // the same run and isn't counted again.
  const run = await takeAllowance("close_out");
  if (run.refused) return run.refused;
  try {
    return Response.json(await startCloseOut(id));
  } catch (e) {
    // startCloseOut throws only before the agent's first Claude call (a LIVE environment, the run row, the PayPal
    // connection); a failure after that is a failed run, which keeps its unit. So this one goes back.
    await run.giveBack();
    return Response.json({ error: e instanceof Error ? e.message : "The agent couldn't start." }, { status: 500 });
  }
}
