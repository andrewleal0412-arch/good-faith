import "server-only";
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

/** The invoice with PayPal's current status, stored when it changed (unless `store` is false: a template tenancy, which
 *  nothing writes to). On a PayPal error the row comes back as stored. PayPal's transaction ids are kept with it: the
 *  move-out refund goes back against the original payment. `onLive` gets PayPal's invoice as read, when it was (its
 *  refunds are checked against the records: reconcile.ts). */
export async function refreshDepositInvoice<T extends DepositInvoiceRow>(invoice: T, opts: { store?: boolean; onLive?: (live: Invoice) => void } = {}): Promise<T> {
  if (!invoice.paypal_id) return invoice;
  try {
    const live = await getInvoice(invoice.paypal_id);
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
