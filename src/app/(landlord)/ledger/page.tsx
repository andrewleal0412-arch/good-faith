import type { Metadata } from "next";
import { ButtonLink } from "@/components/button";
import { Icon } from "@/components/icons";
import { Card, EmptyState, Notice, PageHead } from "@/components/ui";
import { loadLedger } from "@/lib/ledger-load";
import { tabHref } from "@/lib/property-view";
import { loadUnits } from "@/lib/units";
import { LedgerGrid } from "./ledger-grid";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payments" };

// Payments: every money event and deduction across every unit in one AG Grid, filterable by any column, with the
// totals following the filters and a CSV for the accountant. Server-loaded and read-only; the grid gets plain rows.

export default async function LedgerPage({ searchParams }: PageProps<"/ledger">) {
  const sp = await searchParams;
  const focusId = typeof sp.tenancy === "string" ? sp.tenancy.toLowerCase() : null;
  const [ledger, { units }] = await Promise.all([loadLedger(), loadUnits()]);
  // Request deposit opens the unit still waiting for its invoice, or the lease check when every unit has one.
  const waiting = units.find((u) => u.summary.agreement && !u.summary.deposit) ?? units.find((u) => !u.summary.deposit);
  const focus = "error" in ledger || !focusId ? null : ledger.units.find((u) => u.id === focusId) ?? null;

  return (
    <>
      <PageHead title="Payments" actions={<ButtonLink variant="primary" href={waiting ? tabHref(waiting.summary.id, "overview", "move-in") : "/lease"}><Icon name="receive" />Request deposit</ButtonLink>} />

      {"error" in ledger ? (
        <Notice>{ledger.error}</Notice>
      ) : ledger.rows.length === 0 ? (
        <Card>
          <EmptyState icon="card" title="No payments yet" sub="Rows appear once a deposit invoice goes out through PayPal."
            action={<ButtonLink variant="primary" href="/lease"><Icon name="file-check" />Check a lease</ButtonLink>} />
        </Card>
      ) : (
        <LedgerGrid rows={ledger.rows} today={ledger.today} focus={focus} />
      )}
    </>
  );
}
