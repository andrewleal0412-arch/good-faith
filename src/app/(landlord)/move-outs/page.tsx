import Link from "next/link";
import type { Metadata } from "next";
import { InfoTip } from "@/components/info-tip";
import { Card, EmptyState, PageHead, Segmented, StatusChip, Table, Td, Th, Thumb, trClass } from "@/components/ui";
import { daysBetween, shortDate, whenText } from "@/lib/dates";
import { statementDue } from "@/lib/deductions";
import { closedOut } from "@/lib/next-step";
import { propertyStatus, splitAddress, stepLink, tabHref } from "@/lib/property-view";
import { loadThumbnails, loadUnits } from "@/lib/units";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Move-outs" };

// Every tenancy that is ending or has ended: the move-out, the 21-day statement and refund deadline, and the next step.
export default async function MoveOutsPage({ searchParams }: PageProps<"/move-outs">) {
  const sp = await searchParams;
  const view = sp.view === "closed" ? "closed" : "open";
  const { today, units } = await loadUnits();
  const ending = units.filter((u) => u.summary.noticeGivenOn || u.summary.tenantMoveOut || u.summary.moveOutDate || u.summary.statementDeliveredAt);
  const open = ending.filter((u) => !closedOut(u.summary));
  const closed = ending.filter((u) => closedOut(u.summary));
  const shown = view === "closed" ? closed : open;
  const thumbs = await loadThumbnails(shown.map((u) => u.summary.id));

  return (
    <>
      <PageHead title="Move-outs" />
      <div className="mb-3.5">
        <Segmented active={view} items={[
          { key: "open", label: "Open", count: open.length, href: "/move-outs" },
          { key: "closed", label: "Closed", count: closed.length, href: "/move-outs?view=closed" },
        ]} />
      </div>
      <Card>
        {shown.length ? (
          <Table minWidth={820}>
            <thead>
              <tr>
                <Th first>Property</Th><Th>Moved out</Th>
                <Th><span className="inline-flex items-center gap-1">Statement and refund due
                  <InfoTip title="21 days after move-out" cite="Civ. Code 1950.5(h)(1)">The itemized statement and the refund are due within 21 calendar days after the tenants leave.</InfoTip></span></Th>
                <Th>Status</Th><Th last>Next step</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => {
                const s = u.summary;
                const addr = splitAddress(s.address, s.city);
                const status = propertyStatus(s, u.next);
                const step = stepLink(s, u.next);
                const due = s.moveOutDate ? statementDue(s.moveOutDate) : null;
                return (
                  <tr key={s.id} className={trClass}>
                    <Td first className="whitespace-nowrap">
                      <Link href={tabHref(s.id, "move-out")} className="flex items-center gap-3">
                        <Thumb src={thumbs.get(s.id) ?? null} />
                        <span><span className="block font-medium">{addr.street}</span><span className="block text-xs text-ink-3">{s.tenants.join(", ")}</span></span>
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {s.moveOutDate ? shortDate(s.moveOutDate) : s.plannedMoveOut ? <span className="text-ink-3">Planned {shortDate(s.plannedMoveOut)}</span> : "--"}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {due ? <>{shortDate(due)}<span className="block text-xs text-ink-3">{s.statementDeliveredAt ? "Statement delivered" : whenText(daysBetween(today, due))}</span></> : <span className="text-ink-3">After move-out</span>}
                    </Td>
                    <Td><StatusChip tone={status.tone}>{status.label}</StatusChip></Td>
                    <Td last className="whitespace-nowrap"><Link href={step.href} className="font-medium text-brand hover:underline">{step.label}</Link></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState icon="key" title={view === "closed" ? "No closed move-outs" : "No move-outs in progress"}
            sub={view === "closed" ? "Closed move-outs show here once the statement and refund are out." : "A move-out starts when either side gives notice."} />
        )}
      </Card>
    </>
  );
}
