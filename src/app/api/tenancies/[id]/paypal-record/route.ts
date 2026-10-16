import { db } from "@/lib/db";
import { getInvoiceRecord, getPayoutBatch, getRefund, isPayoutBatchId, PayPalRefused } from "@/lib/paypal";
import { isPayPalId, pickRecord, type RecordKind } from "@/lib/paypal-record";
import { rateLimiter } from "@/lib/rate-limit";
import { isRefundId, refundIdsOnRecord, type RecordRow } from "@/lib/reconcile";
import { routeTenancy } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PayPal's own record of one of this tenancy's money events, read from PayPal now, never from the database's copy and
// never from the model: a refund (the close-out's, a settlement's, one made in PayPal and recorded here), a Payout
// batch, or an invoice (the deposit's). Only an id this tenancy's own payment rows name is read, so the route can't
// look up any other PayPal record, and only the fields src/lib/paypal-record.ts picks leave the server. The session's
// workspace is checked first, as on every tenancy route. A workspace may ask thirty times a minute.

const KINDS: RecordKind[] = ["refund", "payout", "invoice"];
const limited = rateLimiter({ perAddress: 30, total: 300, ms: 60_000 });

/** Whether this tenancy's own payment rows name the id as a record of this kind. */
function onRecord(kind: RecordKind, id: string, payments: RecordRow[]): boolean {
  if (kind === "refund") return refundIdsOnRecord(payments).has(id);
  if (kind === "payout") return payments.some((p) => (p.kind === "payout" || p.kind === "settlement_payout") && p.paypal_id === id);
  return payments.some((p) => (p.kind === "deposit_invoice" || p.kind === "damage_invoice") && p.paypal_id === id);
}

export async function GET(req: Request, ctx: RouteContext<"/api/tenancies/[id]/paypal-record">) {
  const { id } = await ctx.params;
  const ws = await routeTenancy(id);
  if (ws instanceof Response) return ws;
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") as RecordKind | null;
  const pid = url.searchParams.get("id");
  if (!kind || !KINDS.includes(kind) || !isPayPalId(pid)) return Response.json({ error: "Say which PayPal record to read." }, { status: 400 });
  if (kind === "refund" && !isRefundId(pid)) return Response.json({ error: "Not a PayPal refund id." }, { status: 400 });
  if (kind === "payout" && !isPayoutBatchId(pid)) return Response.json({ error: "Not a PayPal Payout batch id." }, { status: 400 });
  if (limited(ws.id)) return Response.json({ error: "PayPal was asked many times in the last minute. Check again in a moment." }, { status: 429 });
  const { data: payments, error } = await db.from("payments").select("kind, paypal_id, amount, status, raw").eq("tenancy_id", id);
  if (error) return Response.json({ error: "The payment records couldn't be read. Check again in a moment." }, { status: 500 });
  if (!onRecord(kind, pid, (payments ?? []) as RecordRow[])) return Response.json({ error: "No PayPal record with that id is on this property." }, { status: 404 });
  try {
    const raw = kind === "refund" ? await getRefund(pid) : kind === "payout" ? await getPayoutBatch(pid) : await getInvoiceRecord(pid);
    const record = pickRecord(kind, raw);
    if (!record) return Response.json({ error: "PayPal answered without the record's fields. Check again in a moment." }, { status: 502 });
    return Response.json({ record, readAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("paypal record read failed", e instanceof Error ? e.message : e);
    const refused = e instanceof PayPalRefused ? e.status : 0;
    return Response.json({ error: refused === 404 ? "PayPal reports no record with this id." : refused ? `PayPal didn't answer the read (${refused}). Check again in a moment.` : "PayPal couldn't be reached. Check again in a moment." },
      { status: refused === 404 ? 404 : 502, headers: { "Cache-Control": "no-store" } });
  }
}
