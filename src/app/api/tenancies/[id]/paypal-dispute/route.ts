import { approveDefense, checkPayPalDisputes, currentDispute, declineDefense, prepareDefense, recheckDefense } from "@/lib/chargeback-store";
import { db } from "@/lib/db";
import { takeAllowance } from "@/lib/limits";
import { isUuid, routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 300;

// The tenants' PayPal dispute of the deposit payment (src/lib/chargeback-store.ts), from the property's Payments tab:
//   GET                          where the dispute and its latest response stand, for the page to poll
//   POST {action: "check"}       ask PayPal (through the Agent Toolkit) for disputes of this deposit's payment
//   POST {action: "prepare"}     the defense agent prepares a response (one Claude job, today's close-out allowance)
//   POST {action: "approve", responseId, hash}   send that exact response to PayPal, claimed once and guarded
//   POST {action: "recheck", responseId}         a response PayPal never confirmed: what didn't go, with the same keys
//   POST {action: "decline", responseId}         nothing goes to PayPal
// Every write is to a tenancy in the session's workspace (never a template), and only for a deposit this workspace
// owns: a demo copy never answers for the shared template payment.
export async function GET(_req: Request, ctx: RouteContext<"/api/tenancies/[id]/paypal-dispute">) {
  const { id } = await ctx.params;
  const ws = await routeTenancy(id);
  if (ws instanceof Response) return ws;
  const d = await currentDispute(id);
  if (!d) return Response.json({ dispute: null }, { headers: { "Cache-Control": "no-store" } });
  const { data: r } = await db.from("paypal_dispute_responses").select("id, status, updated_at").eq("dispute_id", d.id).eq("tenancy_id", id)
    .neq("status", "superseded").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return Response.json({ dispute: { id: d.id, status: d.status, updated: d.updated_at }, response: r ?? null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request, ctx: RouteContext<"/api/tenancies/[id]/paypal-dispute">) {
  const { id } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const body = (await req.json().catch(() => null)) as { action?: unknown; responseId?: unknown; hash?: unknown } | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const responseId = isUuid(body?.responseId) ? body!.responseId as string : null;
  if (action === "check") {
    const r = await checkPayPalDisputes(id, ws);
    return r.ok ? Response.json(r) : Response.json({ error: r.error }, { status: r.status });
  }
  if (action === "prepare") {
    const r = await prepareDefense(id, ws, () => takeAllowance("close_out"));
    return r.ok ? Response.json(r) : Response.json({ error: r.error, ...(r.running ? { running: true } : {}) }, { status: r.status });
  }
  if (!responseId) return Response.json({ error: "Which response?" }, { status: 400 });
  if (action === "approve") {
    const hash = typeof body?.hash === "string" && /^[0-9a-f]{24}$/.test(body.hash) ? body.hash : null;
    if (!hash) return Response.json({ error: "Reload the page: the response you approve must be the one shown." }, { status: 400 });
    const r = await approveDefense(id, ws, responseId, hash);
    return r.ok ? Response.json(r) : Response.json({ error: r.error }, { status: r.status });
  }
  if (action === "recheck") {
    const r = await recheckDefense(id, ws, responseId);
    return r.ok ? Response.json(r) : Response.json({ error: r.error }, { status: r.status });
  }
  if (action === "decline") {
    const r = await declineDefense(id, responseId);
    return r.ok ? Response.json(r) : Response.json({ error: (r as { error: string }).error }, { status: (r as { status: number }).status });
  }
  return Response.json({ error: "Unknown action." }, { status: 400 });
}
