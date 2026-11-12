import { Shown, startCloseOut } from "@/lib/agent";
import { openDisputeBlock } from "@/lib/chargeback-store";
import { tenancyDepositBlock } from "@/lib/demo-pool";
import { takeAllowance } from "@/lib/limits";
import { routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 300;

// Start the close-out agent. It runs until it finishes or asks the landlord to approve a money movement.
export async function POST(_req: Request, ctx: RouteContext<"/api/tenancies/[id]/close-out">) {
  const { id } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  // A demo copy made when the pre-paid sandbox deposits were used up, or the Texas unit's copy (its deposit is the
  // template's), can't send its refund, so the agent isn't started for it (no Claude call is spent on a refund that
  // would be blocked); the settlement and the PayPal dispute's answer are held by the same block. Nor while the tenants' PayPal dispute of the deposit
  // payment is open: its response is where money goes back then (src/lib/chargeback-store.ts).
  const blocked = (await tenancyDepositBlock(ws.id, id)) ?? (await openDisputeBlock(id));
  if (blocked) return Response.json({ error: blocked }, { status: 409 });
  // Today's allowance, checked before the agent's first Claude call. The first approval answer that resumes this run is
  // part of it and isn't counted again; a later one is ([runId]/route.ts).
  const run = await takeAllowance("close_out");
  if (run.refused) return run.refused;
  try {
    return Response.json(await startCloseOut(id));
  } catch (e) {
    // startCloseOut throws only before the agent's first Claude call (a LIVE environment, the run row, the PayPal
    // connection); a failure after that is a failed run, which keeps its unit. So this one goes back.
    await run.giveBack();
    if (!(e instanceof Shown)) console.error("close-out didn't start", e);
    return Response.json({ error: e instanceof Shown ? e.message : "The agent couldn't start. Try again." }, { status: 500 });
  }
}
