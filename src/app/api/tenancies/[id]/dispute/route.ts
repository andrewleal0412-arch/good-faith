import { loadTurns, negotiationDispute, runningNow } from "@/lib/negotiation";
import { routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";

// Where the tenants' dispute stands, for the landlord's page while the agents negotiate: it asks every few seconds and
// refreshes when a turn lands or the run ends. Read-only.
export async function GET(_req: Request, ctx: RouteContext<"/api/tenancies/[id]/dispute">) {
  const { id } = await ctx.params;
  const ws = await routeTenancy(id);
  if (ws instanceof Response) return ws;
  const d = await negotiationDispute(id);
  const turns = d ? await loadTurns(d.id) : [];
  return Response.json(
    // A run whose process died reads as stopped, so the page stops waiting on it.
    { status: d?.status ?? null, negotiationStatus: d && runningNow(d) ? "running" : d?.negotiation_status === "running" ? "failed" : d?.negotiation_status ?? null, turns: turns.length },
    { headers: { "Cache-Control": "no-store" } },
  );
}
