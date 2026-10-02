import "server-only";
import { db } from "./db";
import { getInvoice } from "./paypal";

// The deposit invoice as stored, refreshed from PayPal. Shared by the landlord's tenancy page and the tenant's page,
// so "Paid" shows on both the moment the tenant pays.

export type DepositInvoiceRow = {
  id: string;
  paypal_id: string | null;
  amount: number | string;
  status: string;
  raw: { payLink?: string; transactions?: { payment_id?: string; payment_date_time?: string; method?: string }[] } | null;
};

/** The invoice with PayPal's current status, stored when it changed. On a PayPal error the row comes back as stored.
 *  PayPal's transaction ids are kept with it: the move-out refund goes back against the original payment. */
export async function refreshDepositInvoice<T extends DepositInvoiceRow>(invoice: T): Promise<T> {
  if (!invoice.paypal_id) return invoice;
  try {
    const live = await getInvoice(invoice.paypal_id);
    if (live.status === invoice.status) return invoice;
    const raw = { ...(invoice.raw ?? {}), transactions: live.payments?.transactions ?? [] };
    await db.from("payments").update({ status: live.status, raw }).eq("id", invoice.id);
    return { ...invoice, status: live.status, raw };
  } catch {
    return invoice;
  }
}
