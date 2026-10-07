import "server-only";
import { readDispute, type DisputeRead } from "./chargeback";
import { audit, db } from "./db";
import { usd } from "./deductions";
import { noteOutsideRefund } from "./outside-refunds";
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

  async afterDispute(row) {
    await disputeAftermath(row.tenancy_id, row.raw);
  },

  async disputeRefunds(tenancyId) {
    const [pays, disputes] = await Promise.all([
      db.from("payments").select(PAYMENT_COLS).eq("tenancy_id", tenancyId).eq("kind", "dispute_refund").order("created_at"),
      db.from("paypal_disputes").select("id, status, raw").eq("tenancy_id", tenancyId),
    ]);
    return {
      rows: rows("dispute refunds", pays).map((r) => ref(r as Row)),
      disputes: rows("paypal disputes", disputes).map((d) => ({ id: d.id as string, status: (d.status as string | null) ?? null, raw: (d.raw as Record<string, unknown> | null) ?? {} })),
    };
  },

  async addDisputeRefund(tenancyId, o) {
    // One record per dispute: if one appeared meanwhile, this refund only joins its ids.
    const { data: had } = await db.from("payments").select("id, raw").eq("tenancy_id", tenancyId).eq("kind", "dispute_refund").eq("paypal_id", o.disputeId).maybeSingle();
    if (had) {
      const ids = Array.isArray((had.raw as { refund_ids?: unknown } | null)?.refund_ids) ? ((had.raw as { refund_ids: string[] }).refund_ids) : [];
      if (o.refundId && !ids.includes(o.refundId)) {
        const { error } = await db.from("payments").update({ raw: { ...((had.raw as Record<string, unknown> | null) ?? {}), refund_ids: [...ids, o.refundId] } }).eq("id", had.id);
        if (error) throw new Error(`dispute refund: ${error.message}`);
      }
      return;
    }
    const { error } = await db.from("payments").insert({ tenancy_id: tenancyId, kind: "dispute_refund", paypal_id: o.disputeId, amount: o.amount, status: o.status, raw: o.raw });
    if (error) throw new Error(`dispute refund: ${error.message}`);
  },

  async noteOutsideRefund(tenancyId, o) {
    return noteOutsideRefund(tenancyId, { refundId: o.refundId, captureId: o.captureId, amount: o.amount, status: o.status, at: o.at, via: "webhook", eventId: o.eventId });
  },

  async audit(tenancyId, action, detail) {
    await audit(tenancyId, "system", action, detail);
  },
};

/* ---------- What follows a PayPal dispute ---------- */

const cents = (n: number) => Math.round(n * 100) / 100;

/** What follows PayPal's word on a dispute, from its webhook or from Check PayPal (chargeback-store.ts): the money it
 *  returned through it, and once it is resolved, the prepared responses nobody can send any more. */
export async function disputeAftermath(tenancyId: string, raw: unknown) {
  const d = readDispute(raw);
  if (!d.id) return;
  await recordDisputeOutcome(tenancyId, d);
  if (!d.open) await retireResponses(d.id);
}

/** Money PayPal itself sent back through the dispute (a claim the landlord accepted, an offer the tenants accepted,
 *  PayPal's own decision), in payments once, as one dispute refund per dispute: the refunds PayPal lists on the dispute
 *  (refund_details.transactions), or its outcome once resolved. A refund PayPal lists that is already on record as the
 *  close-out's or a settlement's, or that it made before the dispute opened, is not the dispute's and is left out, so
 *  money that went back before the dispute is never counted twice. A pending record an acceptance made is completed. */
export async function recordDisputeOutcome(tenancyId: string, d: DisputeRead) {
  const { data, error } = await db.from("payments").select("id, kind, paypal_id, amount, status, raw").eq("tenancy_id", tenancyId)
    .in("kind", ["refund", "settlement_refund", "dispute_refund", "outside_refund"]);
  if (error) throw new Error(`dispute refund: ${error.message}`);
  const pays = (data ?? []) as { id: string; kind: string; paypal_id: string | null; amount: number | string; status: string; raw: Record<string, unknown> | null }[];
  const ours = new Set(pays.filter((p) => p.kind !== "dispute_refund" && p.paypal_id).map((p) => p.paypal_id));
  const opened = d.createdAt ? Date.parse(d.createdAt) : NaN;
  const counted = d.refunds.filter((r) => !ours.has(r.id) && !(Number.isFinite(opened) && r.at && Date.parse(r.at) < opened));
  const listed = cents(counted.reduce((t, r) => t + r.amount, 0));
  const refunded = listed > 0 ? listed : !d.open && d.outcome?.refunded ? cents(d.outcome.refunded) : 0;
  if (refunded <= 0) return;
  const row = pays.find((p) => p.kind === "dispute_refund" && p.paypal_id === d.id);
  const had = Array.isArray(row?.raw?.refund_ids) ? (row!.raw!.refund_ids as string[]) : [];
  const ids = [...new Set([...had, ...counted.map((r) => r.id)])];
  const raw = { dispute_id: d.id, refund_ids: ids, outcome: d.outcome?.code ?? null, status_from: { source: "paypal", at: d.updatedAt ?? new Date().toISOString() } };
  if (row) {
    if (row.status === "COMPLETED" && Math.abs(Number(row.amount) - refunded) < 0.005 && ids.length === had.length) return;
    const { error: ue } = await db.from("payments").update({ status: "COMPLETED", amount: refunded, raw: { ...(row.raw ?? {}), ...raw } }).eq("id", row.id);
    if (ue) throw new Error(`dispute refund: ${ue.message}`);
  } else {
    const { error: ie } = await db.from("payments").insert({ tenancy_id: tenancyId, kind: "dispute_refund", paypal_id: d.id, amount: refunded, status: "COMPLETED", raw });
    if (ie) throw new Error(`dispute refund: ${ie.message}`);
  }
  await audit(tenancyId, "system", "dispute_refund_recorded", { source: "paypal", dispute_id: d.id, amount: refunded, refund_ids: ids, outcome: raw.outcome });
}

/** A dispute PayPal resolved: a response still waiting for the landlord's approval, or one PayPal never confirmed,
 *  can't be sent any more, so it is retired with the reason (and a new one can't be prepared either). */
export async function retireResponses(disputeId: string) {
  const at = new Date().toISOString();
  await db.from("paypal_dispute_responses").update({ status: "superseded", error: "PayPal resolved the dispute first, so this response was never sent.", updated_at: at })
    .eq("dispute_id", disputeId).eq("status", "ready");
  await db.from("paypal_dispute_responses").update({ status: "superseded", error: "PayPal resolved the dispute before it confirmed this response.", updated_at: at })
    .eq("dispute_id", disputeId).eq("status", "unknown");
}

/* ---------- The bell ---------- */

/** kind: the audit action behind it, and amount and at: its figure and when PayPal reported it, so the shell can show a
 *  report that needs the landlord under Needs you instead (a reversed deposit, a refund made in PayPal still waiting).
 *  refundId: the PayPal refund a refund-made-in-PayPal report names; handled: the landlord has since recorded it or
 *  marked it not this deposit, so it needs no look any more (src/lib/bell.ts leaves it out). */
export type PayPalAlert = {
  tenancyId: string; title: string; sub: string; href: string; tone: "green" | "amber" | "red"; kind: string; amount: number | null; at: string;
  refundId?: string; handled?: boolean;
};

const ALERT_ACTIONS = ["deposit_paid", "refund_status", "payout_status", "paypal_refund_unrecorded", "deposit_reversed", "paypal_dispute", "dispute_refund_recorded"];

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
    out.push({
      tenancyId: r.tenancy_id, title: a.title, tone: a.tone, sub: r.tenancies?.properties?.address ?? "A property", href: `/tenancy/${r.tenancy_id}?tab=${a.tab}`,
      kind: r.action, amount: typeof d.amount === "number" ? d.amount : null, at: r.created_at,
      ...(r.action === "paypal_refund_unrecorded" && typeof d.refund_id === "string" ? { refundId: d.refund_id } : {}),
    });
    // A few more than the bell shows: the shell moves what needs the landlord to Needs you.
    if (out.length >= 8) break;
  }
  // A refund made in PayPal that the landlord has since recorded as the deposit's refund or marked not this deposit is
  // handled: its report needs no look any more. Read only when such a report is in the list.
  const asked = out.filter((a) => a.refundId);
  if (asked.length) {
    const { data: decided, error: de } = await db.from("paypal_outside_refunds").select("tenancy_id, refund_id")
      .eq("workspace_id", workspaceId).neq("status", "open").in("refund_id", [...new Set(asked.map((a) => a.refundId!))]);
    if (de) throw new Error(de.message);
    const done = new Set((decided ?? []).map((n) => `${n.tenancy_id}:${n.refund_id}`));
    for (const a of asked) if (done.has(`${a.tenancyId}:${a.refundId}`)) a.handled = true;
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
    case "paypal_refund_unrecorded": return { title: "Refund made in PayPal", tone: "amber", tab: "payments" };
    case "deposit_reversed": return { title: "Deposit payment reversed", tone: "red", tab: "payments" };
    case "paypal_dispute":
      return d.event === "resolved" ? { title: "PayPal dispute resolved", tone: "green", tab: "payments" }
        : { title: d.event === "created" ? "PayPal dispute opened" : "PayPal dispute updated", tone: "red", tab: "payments" };
    case "dispute_refund_recorded": return { title: amount ? `${amount} returned through the PayPal dispute` : "Returned through the PayPal dispute", tone: "amber", tab: "payments" };
    default: return null;
  }
}
