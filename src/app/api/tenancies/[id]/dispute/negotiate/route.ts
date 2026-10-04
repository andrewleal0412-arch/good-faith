import { takeAllowance } from "@/lib/limits";
import { negotiationDispute, policyOf, runNegotiator } from "@/lib/negotiation";
import { cleanPolicy } from "@/lib/negotiator";
import { routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 300;

// "Let my negotiator answer": the landlord's negotiator answers the tenants' case and the two agents negotiate, at
// most three exchanges in all, each turn checked against the lawful range and the landlord's policy and stored as it is
// made (src/lib/negotiation.ts). One run at a time per dispute, claimed in the database so a double click can't spend
// Claude calls twice, and counted against today's advocate allowance before the first call.
export async function POST(req: Request, ctx: RouteContext<"/api/tenancies/[id]/dispute/negotiate">) {
  const { id } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const body = (await req.json().catch(() => null)) as { policy?: unknown } | null;
  const d = await negotiationDispute(id);
  if (!d) return Response.json({ error: "The tenants haven't sent a dispute." }, { status: 404 });
  const policy = body && typeof body === "object" && body.policy !== undefined ? cleanPolicy(body.policy) : policyOf(d);
  const r = await runNegotiator(id, d, policy, () => takeAllowance("advocate"));
  if (!r.ok) return Response.json({ error: r.error, ...(r.running ? { running: true } : {}) }, { status: r.status });
  return Response.json({ ok: true, outcome: r.outcome, turns: r.turns });
}
