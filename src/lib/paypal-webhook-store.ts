import "server-only";
import { audit, db } from "./db";
import { usd } from "./deductions";
import type { PaymentRef, PayPalEvent, WebhookStore } from "./paypal-webhook";

// The PayPal webhook's database side (src/lib/paypal-webhook.ts decides; this reads and writes), and what its events
// put in the bell. Every write is to rows the handler matched to one tenancy; nothing here picks a tenancy itself.

const PAYMENT_COLS = "id, tenancy_id, kind, paypal_id, amount, status, raw, tenancies!inner(workspace_id)";

type Row = { id: string; tenancy_id: string; kind: string; paypal_id: string | null; amount: number | string; status: string; raw: Record<string, unknown> | null;
  tenancies: { workspace_id: string | null } | { workspace_id: string | null }[] | null };

const ref = (r: Row): PaymentRef => {
  const t = Array.isArray(r.tenancies) ? r.tenancies[0] : r.tenancies;
  return { id: r.id, tenancy_id: r.tenancy_id, workspace_id: t?.workspace_id ?? null, kind: r.kind, paypal_id: r.paypal_id, amount: Number(r.amount), status: r.status, raw: r.raw };
};

/** A read the handler can't do without: an error stops it (the event is marked failed and PayPal sends it again),
 *  rather than reading as "no such row". */
function rows<T>(what: string, res: { data: T[] | null; error: { message: string } | null }): T[] {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data ?? [];
}

let templates: { ids: Set<string>; until: number } | null = null;

export const webhookStore: WebhookStore = {
  async claim(e: PayPalEvent) {
    const r = e.resource ?? {};
    const resourceId = typeof r.id === "string" ? r.id : typeof r.dispute_id === "string" ? r.dispute_id
      : typeof (r.batch_header as { payout_batch_id?: unknown } | undefined)?.payout_batch_id === "string" ? (r.batch_header as { payout_batch_id: string }).payout_batch_id
        : typeof (r.invoice as { id?: unknown } | undefined)?.id === "string" ? (r.invoice as { id: string }).id : null;
    const created = typeof e.create_time === "string" && !Number.isNaN(Date.parse(e.create_time)) ? e.create_time : null;
    const { data, error } = await db.rpc("claim_paypal_event", {
      p_id: e.id, p_type: e.event_type, p_resource_type: e.resource_type ?? null, p_resource_id: resourceId?.slice(0, 128) ?? null,
      p_summary: typeof e.summary === "string" ? e.summary.slice(0, 300) : null, p_created: created, p_payload: e,
    });
    if (error) throw new Error(`claim_paypal_event: ${error.message}`);
    return data as "new" | "retry" | "duplicate";
  },

  async finish(eventId, o) {
    const { error } = await db.from("paypal_webhook_events").update({
      status: o.status, tenancy_id: o.tenancyId ?? null, workspace_id: o.workspaceId ?? null,
      note: o.note?.slice(0, 300) ?? null, error: o.error?.slice(0, 300) ?? null, processed_at: new Date().toISOString(),
    }).eq("id", eventId);
    if (error) console.error("paypal webhook event not finished", eventId, error.message);
  },

  async paymentsByPayPalId(ids, kinds) {
    if (!ids.length) return [];
    return rows("payments by PayPal id", await db.from("payments").select(PAYMENT_COLS).in("paypal_id", ids).in("kind", kinds).limit(200)).map((r) => ref(r as Row));
  },

  async depositsByCapture(captureId) {
    // Any recorded transaction of a deposit invoice with this payment id (the capture the refund goes back against).
    return rows("deposits by capture", await db.from("payments").select(PAYMENT_COLS).eq("kind", "deposit_invoice")
      .contains("raw", { transactions: [{ payment_id: captureId }] }).limit(200)).map((r) => ref(r as Row));
  },

  async poolDeposit(o) {
    for (const [col, v] of [["invoice_id", o.invoice], ["capture_id", o.capture]] as const) {
      if (!v) continue;
      const { data, error } = await db.from("demo_deposit_pool").select("invoice_id, capture_id, claimed_by").eq(col, v).limit(1).maybeSingle();
      if (error) throw new Error(`demo deposit pool: ${error.message}`);
      if (data) return data as { invoice_id: string; capture_id: string | null; claimed_by: string | null };
    }
    return null;
  },

  async templateTenancies() {
    if (templates && templates.until > Date.now()) return templates.ids;
    const data = rows("demo templates", await db.from("demo_templates").select("tenancy_id"));
    templates = { ids: new Set(data.map((t) => String((t as { tenancy_id: string }).tenancy_id).toLowerCase())), until: Date.now() + 10 * 60_000 };
    return templates.ids;
  },

  async updatePayment(id, expect, patch) {
    // The status and only the keys this event changed, merged into raw in one statement under the old status.
    const { data, error } = await db.rpc("merge_payment", { p_id: id, p_expect: expect, p_status: patch.status, p_set: patch.set });
    if (error) throw new Error(`payment update: ${error.message}`);
    return data === true;
  },

  async reloadPayment(id) {
    const data = rows("payment", await db.from("payments").select(PAYMENT_COLS).eq("id", id).limit(1));
    return data.length ? ref(data[0] as Row) : null;
  },

  async settlementStatus(tenancyId, paypalId, status) {
    // Only a sent settlement's PayPal status: a pending, failed or unconfirmed one is the settlement's own business.
    const { error } = await db.from("settlements").update({ paypal_status: status, updated_at: new Date().toISOString() })
      .eq("tenancy_id", tenancyId).eq("paypal_id", paypalId).eq("status", "sent");
    if (error) throw new Error(`settlement status: ${error.message}`);
  },

  async upsertDispute(row) {
    const { data: old, error } = await db.from("paypal_disputes").select("tenancy_id, status, paypal_updated_at").eq("id", row.id).maybeSingle();
    if (error) throw new Error(`paypal dispute: ${error.message}`);
    if (old && old.tenancy_id !== row.tenancy_id) return null;
    if (old?.paypal_updated_at && row.paypal_updated_at && Date.parse(old.paypal_updated_at) > Date.parse(row.paypal_updated_at)) return null;
    const { error: we } = await db.from("paypal_disputes").upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (we) throw new Error(`paypal dispute: ${we.message}`);
    return { previousStatus: (old?.status as string | null) ?? null };
  },

  async audit(tenancyId, action, detail) {
    await audit(tenancyId, "system", action, detail);
  },
};

/* ---------- The bell ---------- */

export type PayPalAlert = { tenancyId: string; title: string; sub: string; href: string; tone: "green" | "amber" | "red" };

const ALERT_ACTIONS = ["deposit_paid", "refund_status", "payout_status", "paypal_refund_unrecorded", "deposit_reversed", "paypal_dispute"];

/** What PayPal reported lately for this workspace's tenancies, newest first: good news for two days, anything that
 *  needs a look for a week. Only entries a verified webhook made (detail.source "paypal"). */
export async function paypalAlerts(workspaceId: string, now = Date.now()): Promise<PayPalAlert[]> {
  const since = new Date(now - 7 * 86_400_000).toISOString();
  const { data, error } = await db.from("audit_log").select("tenancy_id, action, detail, created_at, tenancies!inner(workspace_id, properties(address))")
    .eq("tenancies.workspace_id", workspaceId).eq("actor", "system").in("action", ALERT_ACTIONS).gte("created_at", since)
    .order("created_at", { ascending: false }).limit(20);
  if (error) throw new Error(error.message);
  type R = { tenancy_id: string; action: string; detail: Record<string, unknown> | null; created_at: string;
    tenancies: { properties: { address: string } | null } | null };
  const out: PayPalAlert[] = [];
  for (const r of (data ?? []) as unknown as R[]) {
    const d = r.detail ?? {};
    if (d.source !== "paypal") continue;
    const a = alertFor(r.action, d);
    if (!a) continue;
    if (a.tone === "green" && now - Date.parse(r.created_at) > 2 * 86_400_000) continue;
    out.push({ tenancyId: r.tenancy_id, ...a, sub: r.tenancies?.properties?.address ?? "A property", href: `/tenancy/${r.tenancy_id}?tab=${a.tab}` });
    if (out.length >= 5) break;
  }
  return out;
}

const FAILED = ["FAILED", "CANCELLED", "CANCELED", "DENIED", "RETURNED", "REVERSED", "BLOCKED"];

function alertFor(action: string, d: Record<string, unknown>): { title: string; tone: PayPalAlert["tone"]; tab: string } | null {
  const amount = typeof d.amount === "number" ? usd(d.amount) : null;
  const status = String(d.status ?? "");
  switch (action) {
    case "deposit_paid": return { title: amount ? `Deposit of ${amount} paid` : "Deposit paid", tone: "green", tab: "overview" };
    case "refund_status":
      if (FAILED.includes(status)) return { title: "Refund did not go through", tone: "red", tab: "payments" };
      return status === "COMPLETED" ? { title: "Refund completed", tone: "green", tab: "payments" } : null;
    case "payout_status":
      if (FAILED.includes(status)) return { title: status === "RETURNED" ? "Payout came back" : "Payout did not go through", tone: "red", tab: "payments" };
      if (status === "UNCLAIMED") return { title: "Payout not claimed yet", tone: "amber", tab: "payments" };
      return status === "SUCCESS" ? { title: "Payout completed", tone: "green", tab: "payments" } : null;
    case "paypal_refund_unrecorded": return { title: "Refund made outside Good Faith", tone: "amber", tab: "payments" };
    case "deposit_reversed": return { title: "Deposit payment reversed", tone: "red", tab: "payments" };
    case "paypal_dispute":
      return d.event === "resolved" ? { title: "PayPal dispute resolved", tone: "green", tab: "payments" }
        : { title: d.event === "created" ? "PayPal dispute opened" : "PayPal dispute updated", tone: "red", tab: "payments" };
    default: return null;
  }
}
