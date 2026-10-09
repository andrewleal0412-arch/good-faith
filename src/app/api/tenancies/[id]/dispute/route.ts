import { negotiationDispute, readStamp, runningNow } from "@/lib/negotiation";
import { routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";

// Where the tenants' dispute stands, for the landlord's page while the agents negotiate and while it waits on the
// tenants (to accept the settlement, to answer an offer): it asks every few seconds and refreshes when the stamp it
// was rendered with no longer matches (a turn landed, the run ended, the tenants accepted). Read-only, and small: the
// dispute's row, a count of its turns and four columns of its settlement.
export async function GET(_req: Request, ctx: RouteContext<"/api/tenancies/[id]/dispute">) {
  const { id } = await ctx.params;
  const ws = await routeTenancy(id);
  if (ws instanceof Response) return ws;
  const d = await negotiationDispute(id);
  const { stamp, turns } = d ? await readStamp(d) : { stamp: null, turns: 0 };
  return Response.json(
    // A run whose process died reads as stopped, so the page stops waiting on it.
    { status: d?.status ?? null, negotiationStatus: d && runningNow(d) ? "running" : d?.negotiation_status === "running" ? "failed" : d?.negotiation_status ?? null, turns, stamp },
    { headers: { "Cache-Control": "no-store" } },
  );
}
