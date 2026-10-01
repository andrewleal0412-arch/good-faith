import { startCloseOut } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 300;

// Start the close-out agent. It runs until it finishes or asks the landlord to approve a money movement.
export async function POST(_req: Request, ctx: RouteContext<"/api/tenancies/[id]/close-out">) {
  const { id } = await ctx.params;
  try {
    return Response.json(await startCloseOut(id));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "The agent couldn't start." }, { status: 500 });
  }
}
