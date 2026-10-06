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

// Payments: every deposit, refund, request and deduction across every unit in one AG Grid, with saved views, filter
// chips, a quick filter (the top bar's search lands in it), each row's details and a CSV for the accountant.
// Server-loaded and read-only; the grid gets plain rows and, per row, its PayPal ids and where its status came from.

export default async function LedgerPage({ searchParams }: PageProps<"/ledger">) {
  const sp = await searchParams;
  const focusId = typeof sp.tenancy === "string" ? sp.tenancy.toLowerCase() : null;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 120) : "";
  const view = typeof sp.view === "string" ? sp.view : null;
  const [ledger, { units }] = await Promise.all([loadLedger(true), loadUnits()]);
  // Request deposit opens the unit still waiting for its invoice, or the lease check when every unit has one.
  const waiting = units.find((u) => u.summary.agreement && !u.summary.deposit) ?? units.find((u) => !u.summary.deposit);
  const requestHref = waiting ? tabHref(waiting.summary.id, "overview", "move-in") : "/lease";

  if ("error" in ledger || ledger.rows.length === 0) {
    return (
      <>
        <PageHead title="Payments" actions={<ButtonLink variant="primary" href={requestHref}><Icon name="receive" />Request deposit</ButtonLink>} />
        {"error" in ledger ? (
          <Notice>{ledger.error}</Notice>
        ) : (
          <Card>
            <EmptyState icon="card" title="No payments yet" sub="Rows appear once a deposit invoice goes out through PayPal."
              action={<ButtonLink href="/lease"><Icon name="file-check" />Check a lease</ButtonLink>} />
          </Card>
        )}
      </>
    );
  }

  return <LedgerGrid rows={ledger.rows} today={ledger.today} units={ledger.units} details={ledger.details} focusId={focusId} q={q} initialView={view} requestHref={requestHref} />;
}
