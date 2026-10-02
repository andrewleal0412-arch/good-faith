import "server-only";
import { pacificToday } from "./dates";
import { db } from "./db";
import { ledgerRows, streetLine, type LedgerDeduction, type LedgerPayment, type LedgerRow, type LedgerTenancy } from "./ledger";

// The whole ledger from the database alone: no PayPal round trip per row, so a status is as last stored (the tenancy
// page refreshes the deposit invoice from PayPal whenever it opens). Read-only. Only names, amounts, PayPal ids and
// statuses leave the server; tenant emails, lease text and the raw PayPal records stay here.

export type LedgerUnit = { id: string; label: string };
export type Ledger = { today: string; rows: LedgerRow[]; units: LedgerUnit[] };

/** The ledger, or the reason it could not be read. A query error is never shown as an empty ledger: to a landlord that
 *  would read as the records being gone. */
export async function loadLedger(): Promise<Ledger | { error: string }> {
  const [tenancies, payments, deductions] = await Promise.all([
    db.from("tenancies").select("id, tenants, monthly_rent, move_out_date, statement_delivered_at, lease_terms, properties(address, city)").order("created_at"),
    db.from("payments").select("id, tenancy_id, kind, paypal_id, amount, status, raw, created_at").order("created_at"),
    db.from("deductions").select("id, tenancy_id, category, room, item, amount, is_estimate, created_at").order("created_at"),
  ]);
  const failed = [tenancies.error, payments.error, deductions.error].find(Boolean);
  if (failed) {
    console.error("ledger: database read failed:", failed.message);
    return { error: "The ledger could not be loaded from the database. Refresh the page; if it keeps happening, check the Supabase connection." };
  }
  const ts = (tenancies.data ?? []) as unknown as LedgerTenancy[];
  const ps = (payments.data ?? []) as (LedgerPayment & { tenancy_id: string })[];
  const ds = (deductions.data ?? []) as (LedgerDeduction & { tenancy_id: string })[];
  // A stable sort, so each tenancy's own order (invoice before its payment) survives the merge.
  const rows = ts.flatMap((t) => ledgerRows(t, ps.filter((p) => p.tenancy_id === t.id), ds.filter((d) => d.tenancy_id === t.id)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const units = ts.map((t) => ({
    id: t.id,
    label: `${streetLine(t.properties?.address ?? t.lease_terms?.propertyAddress ?? "Address not recorded")} (${(t.tenants ?? []).map((x) => x.name).join(" and ") || "no tenants named"})`,
  }));
  return { today: pacificToday(), rows, units };
}
