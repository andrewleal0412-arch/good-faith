import "server-only";
import { cache } from "react";
import { pacificToday } from "./dates";
import type { Notices } from "./notices";
import { packFor } from "./states/server";
import { db } from "./db";
import { ledgerRows, streetLine, type LedgerDeduction, type LedgerPayment, type LedgerRow, type LedgerTenancy } from "./ledger";
import { workspaceTenancies } from "./units";
import { currentWorkspace } from "./workspace";

// The whole ledger from the database alone: no PayPal round trip per row, so a status is as last stored (the tenancy
// page refreshes the deposit invoice from PayPal whenever it opens). Read-only. Only names, amounts, PayPal ids and
// statuses leave the server; tenant emails, lease text and the raw PayPal records stay here.

/** One tenancy, for the property filter and the "due back" tile: its street line, its tenants, when it began (to tell
 *  two tenancies at one address apart), and the day its statement and refund are due under its state's pack
 *  (California: 21 days after the move-out), if the tenants have moved out. */
export type LedgerUnit = { id: string; label: string; street: string; tenants: string; start: string | null; due: string | null };

/** What the Payments grid's details panel shows for a row beyond the row itself: every PayPal id behind it (to copy),
 *  where its status came from, and the PayPal webhook deliveries that touched it. Ids and the app's own notes only:
 *  no payload, no email, no address leaves the server. */
export type LedgerDetail = {
  ids: { label: string; id: string }[];
  source: { text: string; at: string | null; paypal: boolean; event: { id: string; type: string } | null };
  events: { id: string; type: string; at: string; status: string; note: string | null }[];
};
export type Ledger = { today: string; rows: LedgerRow[]; units: LedgerUnit[]; details: Record<string, LedgerDetail> };

/** The ledger, or the reason it could not be read. A query error is never shown as an empty ledger: to a landlord that
 *  would read as the records being gone. The tenancies and the payments and deductions under them come from the
 *  request's one workspace read (workspaceTenancies, shared with the shell and the page); only Payments asks for
 *  `details` (true), the PayPal webhook deliveries behind each row, which is one more read. */
export const loadLedger = cache(async (details = false): Promise<Ledger | { error: string }> => {
  // The session's workspace only: its tenancies, and the payments and deductions read through them.
  const ws = await currentWorkspace();
  if (!ws) return { today: pacificToday(), rows: [], units: [], details: {} };
  const [snap, events] = await Promise.all([
    workspaceTenancies(),
    // PayPal's webhook deliveries matched to this workspace, newest first: the details panel lists those that touched a
    // row. A failed read only leaves that list empty.
    details
      ? db.from("paypal_webhook_events").select("id, event_type, resource_id, tenancy_id, received_at, status, note")
        .eq("workspace_id", ws.id).order("received_at", { ascending: false }).limit(500)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (snap.error) {
    console.error("ledger: database read failed:", snap.error);
    return { error: "The ledger could not be loaded from the database. Refresh the page; if it keeps happening, check the Supabase connection." };
  }
  const ts = snap.rows as unknown as (LedgerTenancy & { end_date: string | null; planned_move_out: string | null; notices: Notices | null })[];
  const ps = snap.rows.flatMap((t) => t.payments.map((p) => ({ ...p, tenancy_id: t.id }))) as unknown as (LedgerPayment & { tenancy_id: string })[];
  const ds = snap.rows.flatMap((t) => t.ledger_deductions.map((d) => ({ ...d, tenancy_id: t.id }))) as unknown as (LedgerDeduction & { tenancy_id: string })[];
  // A stable sort, so each tenancy's own order (invoice before its payment) survives the merge.
  const rows = snap.rows.flatMap((t, i) => ledgerRows(ts[i], ps.filter((p) => p.tenancy_id === t.id), ds.filter((d) => d.tenancy_id === t.id)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const units = ts.map((t) => {
    const street = streetLine(t.properties?.address ?? t.lease_terms?.propertyAddress ?? "Address not recorded");
    const tenants = (t.tenants ?? []).map((x) => x.name).join(" and ") || "no tenants named";
    return {
      id: t.id, label: `${street} (${tenants})`, street, tenants, start: t.lease_terms?.tenancyStartDate ?? null,
      due: packFor(t.properties?.state).deadline.due({
        moveOutDate: t.move_out_date, endDate: t.end_date, plannedMoveOut: t.planned_move_out,
        claimed: ds.some((d) => d.tenancy_id === t.id), claimNoticeDate: t.notices?.claim_notice?.date ?? null,
      }),
    };
  });
  const evs = events.error ? [] : (events.data ?? []) as WebhookEventRow[];
  return { today: pacificToday(), rows, units, details: details ? ledgerDetails(rows, ps, evs) : {} };
});

type WebhookEventRow = { id: string; event_type: string; resource_id: string | null; tenancy_id: string | null; received_at: string; status: string; note: string | null };

/** A PayPal event type in words: "PAYMENT.CAPTURE.REFUNDED" reads "Payment capture refunded". */
export const eventWords = (t: string) => { const w = t.toLowerCase().replace(/[._]/g, " "); return w.charAt(0).toUpperCase() + w.slice(1); };

/** The capture a refund went back against, from PayPal's own "up" link on the refund it returned. */
function captureOf(raw: Record<string, unknown> | null): string | null {
  const links = Array.isArray(raw?.links) ? raw.links as { rel?: string; href?: string }[] : [];
  const up = links.find((l) => l.rel === "up" && typeof l.href === "string")?.href;
  return up?.match(/\/captures\/([A-Z0-9]+)/)?.[1] ?? null;
}

/** Each row's details: its PayPal ids, the source of its status, and the webhook deliveries that named one of them. */
function ledgerDetails(rows: LedgerRow[], payments: (LedgerPayment & { tenancy_id: string })[], events: WebhookEventRow[]): Record<string, LedgerDetail> {
  const out: Record<string, LedgerDetail> = {};
  const byId = new Map(payments.map((p) => [p.id, p]));
  for (const r of rows) {
    const p = byId.get(r.id.replace(/:paid$/, "")) ?? null;
    const raw = (p?.raw ?? null) as (LedgerPayment["raw"] & { links?: unknown; refund_ids?: unknown; status_from?: { source?: string; at?: string; event_id?: string; event_type?: string } }) | null;
    const ids: { label: string; id: string }[] = [];
    const add = (label: string, id: unknown) => { if (typeof id === "string" && id && !ids.some((x) => x.id === id)) ids.push({ label, id }); };
    if (r.kind === "deposit_invoice" || r.kind === "damage_invoice") add("Invoice", p?.paypal_id);
    if (r.kind === "payment") { add("Payment", raw?.transactions?.[0]?.payment_id); add("Invoice", p?.paypal_id); }
    if (r.kind === "refund") { add("Refund", p?.paypal_id); add("Payment refunded", captureOf(raw as Record<string, unknown> | null)); }
    if (r.kind === "payout") add("Payout batch", p?.paypal_id);
    if (r.kind === "settlement" && !r.example) { add(p?.kind === "settlement_payout" ? "Payout batch" : "Refund", p?.paypal_id); add("Payment refunded", captureOf(raw as Record<string, unknown> | null)); }
    if (r.kind === "dispute_refund") {
      add("PayPal dispute", p?.paypal_id);
      for (const id of Array.isArray(raw?.refund_ids) ? raw.refund_ids : []) add("Refund", id);
    }
    const from = raw?.status_from?.source === "paypal" ? raw.status_from : null;
    const source: LedgerDetail["source"] = from
      ? { text: "Reported by PayPal through its webhook", at: from.at ?? null, paypal: true, event: from.event_id ? { id: from.event_id, type: eventWords(from.event_type ?? "") } : null }
      : { at: null, paypal: false, event: null, text:
        r.kind === "deduction" ? "Your records: a deduction is the statement's, not a PayPal record"
          : r.example ? "The demo's recorded example: no PayPal money moved for it"
            : r.kind === "deposit_invoice" || r.kind === "damage_invoice" ? "PayPal's invoice, as last read: the property's page asks PayPal again whenever it opens"
              : r.kind === "payment" ? "PayPal's transaction record on the invoice, as last read"
                : r.kind === "refund" ? "PayPal's answer when the refund was sent through the Agent Toolkit"
                  : r.kind === "payout" ? "PayPal's answer when the Payout was sent"
                    : r.kind === "settlement" ? "PayPal's answer when the settlement was paid"
                      : "PayPal's dispute record, as last read" };
    const mine = new Set(ids.map((x) => x.id));
    const evs = events.filter((e) => e.tenancy_id === r.tenancyId && ((e.resource_id && mine.has(e.resource_id)) || e.id === from?.event_id))
      .slice(0, 10).map((e) => ({ id: e.id, type: eventWords(e.event_type), at: e.received_at, status: e.status, note: e.note }));
    out[r.id] = { ids, source, events: evs };
  }
  return out;
}
