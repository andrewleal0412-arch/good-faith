import { readJson } from "@/lib/body";
import { decideOutsideRefund } from "@/lib/outside-refunds";
import { isRefundId } from "@/lib/reconcile";
import { routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";

// A refund of the deposit payment made in PayPal, not from here (src/lib/reconcile.ts), on the property's Payments tab:
//   POST {refundId, decision: "record"}    record it as this deposit's refund: it then counts wherever the app's own
//                                          refunds count, and the close-out sends only what is still owed
//   POST {refundId, decision: "dismiss"}   mark it not this deposit: it counts nowhere here
// Only for a tenancy in the session's workspace (never a template), only for a refund PayPal reported on this
// tenancy's own deposit payment (a demo copy never decides for the template payment every copy shows), and once: the
// database decides under the refund's row lock (decide_outside_refund), with the audit entry in the same step. No
// PayPal call and no money moves here.
export async function POST(req: Request, ctx: RouteContext<"/api/tenancies/[id]/outside-refunds">) {
  const { id } = await ctx.params;
  const ws = await routeTenancy(id, { write: true });
  if (ws instanceof Response) return ws;
  const body = (await readJson(req, 16_000)) as { refundId?: unknown; decision?: unknown } | null;
  const decision = body?.decision === "record" || body?.decision === "dismiss" ? body.decision : null;
  if (!decision) return Response.json({ error: "Record it, or mark it not this deposit." }, { status: 400 });
  if (!isRefundId(body?.refundId)) return Response.json({ error: "Which refund?" }, { status: 400 });
  const r = await decideOutsideRefund({ tenancyId: id, workspaceId: ws.id, refundId: body!.refundId as string, decision });
  return r.ok ? Response.json(r) : Response.json({ error: r.error }, { status: r.status });
}
