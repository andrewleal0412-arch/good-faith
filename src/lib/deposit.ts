import "server-only";
import { createHash } from "node:crypto";
import { db } from "./db";
import { getInvoice, type Invoice } from "./paypal";

// The deposit invoice as stored, refreshed from PayPal. Shared by the landlord's tenancy page and the tenant's page,
// so "Paid" shows on both the moment the tenant pays.

export type DepositInvoiceRow = {
  id: string;
  paypal_id: string | null;
  amount: number | string;
  status: string;
  raw: { payLink?: string; transactions?: { payment_id?: string; payment_date_time?: string; method?: string }[] } | null;
};

// PayPal's deposit invoice as a property page last read it, for a minute, so opening a property again (or another
// tab's view of it) doesn't wait on PayPal each time. Kept per workspace (a demo copy that shows the template's
// invoice has its own entry, never another copy's) and only while nothing the app records about the deposit has
// changed: the key carries a digest of the tenancy's payment rows and its notes of refunds made in PayPal (recordsKey),
// so a refund sent from here, a webhook's report, a refund recorded or set aside, each reads PayPal again at once.
// Only the property page's display reads use it (refreshDepositInvoice with `reuse`): the statement, the refund
// review, the close-out, a settlement, a PayPal dispute's response and every route that moves money read PayPal
// themselves (closeOutState, getInvoice), so no button that moves money ever acts on it. A deposit not yet paid is
// always read live, so "Paid" shows the moment the tenants pay.
const REUSE_MS = 60_000;
const lastRead = new Map<string, { live: Invoice; until: number }>();

/** A digest of what the app records about a tenancy's deposit: its payment rows and its notes of refunds made in
 *  PayPal. Any change to them changes the digest. */
export function recordsKey(payments: unknown[], notes: unknown[]): string {
  return createHash("sha256").update(JSON.stringify([payments, notes])).digest("hex").slice(0, 32);
}

/** The invoice with PayPal's current status, stored when it changed (unless `store` is false: a template tenancy, which
 *  nothing writes to). On a PayPal error the row comes back as stored. PayPal's transaction ids are kept with it: the
 *  move-out refund goes back against the original payment. `onLive` gets PayPal's invoice as read, when it was (its
 *  refunds are checked against the records: reconcile.ts). `reuse` (the property page only, for a paid deposit): the
 *  workspace and recordsKey of the tenancy's records, under which PayPal's answer from the last minute may stand in
 *  for a new read (lastRead, above). */
export async function refreshDepositInvoice<T extends DepositInvoiceRow>(invoice: T, opts: { store?: boolean; onLive?: (live: Invoice) => void; reuse?: { workspaceId: string; records: string } } = {}): Promise<T> {
  if (!invoice.paypal_id) return invoice;
  try {
    const key = opts.reuse ? `${opts.reuse.workspaceId}|${invoice.id}|${invoice.paypal_id}|${invoice.status}|${opts.reuse.records}` : null;
    const hit = key ? lastRead.get(key) : undefined;
    let live: Invoice;
    if (hit && hit.until > Date.now()) live = hit.live;
    else {
      live = await getInvoice(invoice.paypal_id);
      if (key) {
        if (lastRead.size > 2000) lastRead.clear();
        lastRead.set(key, { live, until: Date.now() + REUSE_MS });
      }
    }
    opts.onLive?.(live);
    if (live.status === invoice.status) return invoice;
    // The status now comes from this read, not from a PayPal webhook, so the webhook's mark (status_from) goes.
    const kept: Record<string, unknown> = { ...(invoice.raw ?? {}) };
    delete kept.status_from;
    const transactions = live.payments?.transactions ?? [];
    const raw = { ...kept, transactions };
    // Only under the status this page read, and only the keys it changes: a webhook that wrote meanwhile (a reversal,
    // a capture) keeps what it wrote (merge_payment).
    if (opts.store !== false) {
      await db.rpc("merge_payment", { p_id: invoice.id, p_expect: invoice.status, p_status: live.status, p_set: { transactions }, p_unset: ["status_from"] });
    }
    return { ...invoice, status: live.status, raw };
  } catch {
    return invoice;
  }
}
