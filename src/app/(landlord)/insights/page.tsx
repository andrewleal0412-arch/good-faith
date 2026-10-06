import type { Metadata } from "next";
import { ButtonLink } from "@/components/button";
import { Icon } from "@/components/icons";
import { Card, EmptyState, Notice, PageHead } from "@/components/ui";
import type { InsightUnit } from "@/lib/insights";
import { loadLedger } from "@/lib/ledger-load";
import { streetLine } from "@/lib/ledger";
import { closedOut, dueOf } from "@/lib/next-step";
import { keepUnit, propertyStatus } from "@/lib/property-view";
import { dayFor, packFor } from "@/lib/states/server";
import { loadUnits } from "@/lib/units";
import { Insights } from "./insights";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Insights" };

// Insights: the portfolio in numbers. What is held now and how it moved over time, what went back as refunds and
// settlements, what the statements kept by category, and every property grouped by state, from the same ledger rows
// as Payments, so the figures agree. AG Charts Community draws the charts and AG Grid Community the table, both in the
// design's tokens; the grid exports a CSV. Read only.

export default async function InsightsPage() {
  const [ledger, { units }] = await Promise.all([loadLedger(), loadUnits()]);
  if ("error" in ledger) {
    return (
      <>
        <PageHead title="Insights" />
        <Notice>{ledger.error}</Notice>
      </>
    );
  }
  if (!units.length) {
    return (
      <>
        <PageHead title="Insights" />
        <Card>
          <EmptyState icon="split" title="Nothing to chart yet" sub="Insights fill in once a tenancy has a deposit."
            action={<ButtonLink href="/lease"><Icon name="file-check" />Check a lease</ButtonLink>} />
        </Card>
      </>
    );
  }
  const list: InsightUnit[] = units.map(({ summary: s, next }) => {
    const pack = packFor(s.state);
    return {
      id: s.id, state: pack.code, stateName: pack.name, street: keepUnit(streetLine(s.address)), address: s.address,
      tenants: s.tenants.join(" and ") || "No tenants named", start: s.startDate,
      status: (({ label, tone }) => ({ label, tone }))(propertyStatus(s, next)),
      due: s.moveOutDate && !closedOut(s) ? dueOf(s) : null,
      deliveredOn: s.statementDeliveredAt ? dayFor(s.statementDeliveredAt, s.state) : null,
    };
  });
  return <Insights units={list} rows={ledger.rows} today={ledger.today} />;
}
