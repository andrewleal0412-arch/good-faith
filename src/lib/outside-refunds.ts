import "server-only";
import { audit, db } from "./db";
import { depositBlock } from "./demo-pool";
import { pacificDate } from "./dates";
import type { Invoice } from "./paypal";
import { decisionError, openNotes, unknownRefunds, type OutsideNote, type PayPalRefund, type RecordRow } from "./reconcile";

// The database side of reconciling PayPal's refunds (src/lib/reconcile.ts decides): each refund PayPal reported on a
// tenancy's deposit payment that isn't on record as the app's own is kept once (paypal_outside_refunds, by
// note_outside_refund), and the landlord's decision on it is made in one locked step (decide_outside_refund), which
// writes the payments row and the audit entry together. Every function takes a tenancy its caller already scoped to
// the session's workspace (routeTenancy, pageTenancy) or that the webhook matched to one tenancy.

export type OutsideRefundRow = OutsideNote & { id: string; tenancy_id: string; workspace_id: string; created_at: string };

const COLS = "id, tenancy_id, workspace_id, refund_id, capture_id, amount, paypal_status, refunded_at, seen_via, status, decided_at, created_at";

/** Every refund made in PayPal on file for a tenancy, oldest first. An error reads as none, and the page says nothing
 *  about it rather than fail. */
export async function loadOutsideRefunds(tenancyId: string): Promise<OutsideRefundRow[]> {
  const { data, error } = await db.from("paypal_outside_refunds").select(COLS).eq("tenancy_id", tenancyId).order("created_at");
  if (error) {
    console.error("outside refunds not read", error.message);
    return [];
  }
  return (data ?? []) as OutsideRefundRow[];
}

/** One refund PayPal reported, noted once: 'new' the first time, 'seen' after, 'ours' when the records hold it, and
 *  'template' for a template (nothing is written). */
export type NoteResult = "new" | "seen" | "ours" | "template";

export async function noteOutsideRefund(tenancyId: string, r: { refundId: string; captureId: string | null; amount: number; status: string | null; at: string | null; via: "webhook" | "check"; eventId?: string | null }): Promise<NoteResult> {
  const { data, error } = await db.rpc("note_outside_refund", {
    p_tenancy: tenancyId, p_refund: r.refundId, p_capture: r.captureId, p_amount: r.amount, p_status: r.status,
    p_refunded_at: r.at, p_via: r.via, p_event: r.eventId ?? null,
  });
  if (error) throw new Error(`note_outside_refund: ${error.message}`);
  return data as NoteResult;
}

/** Template tenancies, which nothing writes to: kept ten minutes, as the webhook keeps them. */
let templates: { ids: Set<string>; until: number } | null = null;
async function templateIds(): Promise<Set<string>> {
  if (templates && templates.until > Date.now()) return templates.ids;
  const { data, error } = await db.from("demo_templates").select("tenancy_id");
  if (error) throw new Error(`demo templates: ${error.message}`);
  templates = { ids: new Set((data ?? []).map((t) => String(t.tenancy_id).toLowerCase())), until: Date.now() + 10 * 60_000 };
  return templates.ids;
}
export const isTemplateTenancy = async (tenancyId: string) => (await templateIds()).has(tenancyId.toLowerCase());

/** Whether a refund of this deposit payment is this tenancy's to record: not a template's, and in a demo copy only a
 *  pre-paid deposit the copy holds itself (depositBlock: never the template payment every copy shows, nor a pool
 *  deposit another copy holds). When the records can't be read, no. */
export async function ownsDeposit(workspaceId: string, tenancyId: string, invoiceId: string | null | undefined): Promise<boolean> {
  if (!invoiceId) return false;
  try {
    if (await isTemplateTenancy(tenancyId)) return false;
    return !(await depositBlock(workspaceId, invoiceId));
  } catch {
    return false;
  }
}

/** The live check: the refunds a PayPal invoice the app just read lists that the records don't hold, noted for this
 *  tenancy when its deposit is its own (each audited once, the first time either path sees it). Returns the notes as
 *  they stand afterwards. Never throws: a note that can't be written is noted the next time PayPal is read. */
export async function noteFromInvoice(o: {
  tenancyId: string; workspaceId: string; invoice: Invoice | null; payments: RecordRow[]; notes: OutsideRefundRow[];
  depositInvoiceId: string | null; captureId: string | null;
}): Promise<OutsideRefundRow[]> {
  if (!o.invoice) return o.notes;
  const known = new Set(o.notes.map((n) => n.refund_id));
  const fresh = unknownRefunds(o.invoice, o.payments).filter((r) => !known.has(r.id));
  if (!fresh.length) return o.notes;
  if (!(await ownsDeposit(o.workspaceId, o.tenancyId, o.depositInvoiceId))) return o.notes;
  // A refund sent from here is written to the records right after PayPal answers, and PayPal may list it first: while
  // the close-out's run or a settlement's payment is under way, nothing is noted yet (the close-out stays held by
  // PayPal's total meanwhile), and the next read notes it if it still isn't on record. The webhook waits the same way.
  if (await refundInFlight(o.tenancyId)) return o.notes;
  for (const r of fresh) await noteOne(o.tenancyId, r, o.captureId);
  return loadOutsideRefunds(o.tenancyId);
}

/** How long a running close-out may be sending its refund. */
const IN_FLIGHT_MS = 10 * 60_000;

/** Whether a refund from here may be on its way for this tenancy: a close-out run still running (it sends the refund
 *  after the approval) or a settlement being paid. When the records can't be read, yes: noting waits for the next read. */
async function refundInFlight(tenancyId: string): Promise<boolean> {
  const since = new Date(Date.now() - IN_FLIGHT_MS).toISOString();
  const [runs, sending] = await Promise.all([
    db.from("agent_runs").select("id").eq("tenancy_id", tenancyId).eq("status", "running").gte("updated_at", since).limit(1),
    db.from("settlements").select("id").eq("tenancy_id", tenancyId).eq("status", "sending").limit(1),
  ]);
  if (runs.error || sending.error) return true;
  return !!runs.data?.length || !!sending.data?.length;
}

async function noteOne(tenancyId: string, r: PayPalRefund, captureId: string | null) {
  try {
    const res = await noteOutsideRefund(tenancyId, { refundId: r.id, captureId, amount: r.amount, status: "COMPLETED", at: r.at, via: "check" });
    if (res === "new") {
      await audit(tenancyId, "system", "paypal_refund_unrecorded", {
        source: "paypal_check", refund_id: r.id, capture_id: captureId, amount: r.amount, status: "COMPLETED",
        ...(r.at ? { refunded_on: pacificDate(r.at) } : {}),
      });
    }
  } catch (e) {
    console.error("outside refund not noted", e instanceof Error ? e.message : e);
  }
}

export type DecideResult = { ok: true; status: "recorded" | "dismissed" } | { ok: false; status: number; error: string };

/** The landlord's decision on a refund made in PayPal: record it as this deposit's refund, or mark it not this
 *  deposit. Checked here first (decisionError) and again by the database under the refund's row lock, so a double
 *  click, a second tab or two people at once decide once. */
export async function decideOutsideRefund(o: { tenancyId: string; workspaceId: string; refundId: string; decision: "record" | "dismiss" }): Promise<DecideResult> {
  const [{ data: note }, { data: pays }, template] = await Promise.all([
    db.from("paypal_outside_refunds").select(COLS).eq("tenancy_id", o.tenancyId).eq("refund_id", o.refundId).maybeSingle(),
    db.from("payments").select("kind, paypal_id, amount, status, raw").eq("tenancy_id", o.tenancyId),
    isTemplateTenancy(o.tenancyId),
  ]);
  const payments = (pays ?? []) as RecordRow[];
  const inv = payments.find((p) => p.kind === "deposit_invoice");
  const owns = !template && (await ownsDeposit(o.workspaceId, o.tenancyId, inv?.paypal_id));
  const err = decisionError({ note: (note as OutsideNote | null) ?? null, payments, template, owns });
  if (err) return { ok: false, ...err };
  const { data, error } = await db.rpc("decide_outside_refund", { p_tenancy: o.tenancyId, p_refund: o.refundId, p_decision: o.decision });
  if (error) {
    console.error("outside refund decision failed", error.message);
    return { ok: false, status: 500, error: "Couldn't save that. Try again." };
  }
  const r = data as { ok: boolean; reason?: string; status?: string };
  if (r.ok) return { ok: true, status: r.status === "recorded" ? "recorded" : "dismissed" };
  const why: Record<string, [number, string]> = {
    decided: [409, r.status === "recorded" ? "This refund is already recorded as this deposit's refund." : "This refund is already marked not this deposit."],
    ours: [409, "This refund is on record already, as one sent from here. Reload the page."],
    missing: [404, "No refund made in PayPal with that id is on this property."],
    template: [409, "This property is the template every demo copy is made from, so it doesn't change."],
  };
  const [status, error2] = why[r.reason ?? ""] ?? [409, "Couldn't save that. Reload the page."];
  return { ok: false, status, error: error2 };
}

/** The refunds made in PayPal waiting for the landlord in a workspace, by tenancy, for the bell: open, and not on
 *  record by now as the app's own. */
export async function openOutsideRefunds(workspaceId: string): Promise<{ tenancyId: string; address: string; refunds: OutsideRefundRow[] }[]> {
  const { data, error } = await db.from("paypal_outside_refunds").select(`${COLS}, tenancies!inner(workspace_id, properties(address), payments(kind, paypal_id, amount, status, raw))`)
    .eq("workspace_id", workspaceId).eq("tenancies.workspace_id", workspaceId).eq("status", "open").order("created_at").limit(40);
  if (error) throw new Error(error.message);
  type R = OutsideRefundRow & { tenancies: { properties: { address: string } | null; payments: RecordRow[] | null } | null };
  const by = new Map<string, { tenancyId: string; address: string; refunds: OutsideRefundRow[]; payments: RecordRow[] }>();
  for (const r of (data ?? []) as unknown as R[]) {
    const t = by.get(r.tenancy_id) ?? { tenancyId: r.tenancy_id, address: r.tenancies?.properties?.address ?? "A property", refunds: [], payments: r.tenancies?.payments ?? [] };
    t.refunds.push(r);
    by.set(r.tenancy_id, t);
  }
  return [...by.values()].map((t) => ({ tenancyId: t.tenancyId, address: t.address, refunds: openNotes(t.refunds, t.payments) })).filter((t) => t.refunds.length);
}
