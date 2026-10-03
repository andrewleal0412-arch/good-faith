import { startCloseOut } from "@/lib/agent";
import { db } from "@/lib/db";
import { takeAllowance } from "@/lib/limits";

export const runtime = "nodejs";
export const maxDuration = 300;

// Start the close-out agent. It runs until it finishes or asks the landlord to approve a money movement.
export async function POST(_req: Request, ctx: RouteContext<"/api/tenancies/[id]/close-out">) {
  const { id } = await ctx.params;
  const { data: t } = await db.from("tenancies").select("id").eq("id", id).maybeSingle();
  if (!t) return Response.json({ error: "No such tenancy." }, { status: 404 });
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
