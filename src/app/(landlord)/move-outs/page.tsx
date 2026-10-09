import Link from "@/components/link";
import type { Metadata } from "next";
import { InfoTip } from "@/components/info-tip";
import { Card, EmptyState, PageHead, Segmented, StatusChip, Table, Td, Th, Thumb, trClass } from "@/components/ui";
import { paypalDisputeAlerts } from "@/lib/chargeback-store";
import { dayLabel, daysBetween, shortDate, whenText } from "@/lib/dates";
import { disputeAlerts, type DisputeAlert } from "@/lib/negotiation";
import { closedOut, dueLabelOf, dueOf, type TenancySummary } from "@/lib/next-step";
import { onePack } from "@/lib/states/server";
import { disputeStep, propertyStatus, splitAddress, stepLink, tabHref } from "@/lib/property-view";
import { loadThumbnails, loadUnits } from "@/lib/units";
import { currentWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Move-outs" };

// Every tenancy that is ending or has ended: the move-out, the statement and refund deadline under its state's pack
// (21 days in California), and the next step. A unit already closed out is open again while a dispute on it is live
// (the tenants' dispute of the statement, or their PayPal dispute of the deposit payment): its chip says so, and its
// next step is the dispute's while that waits on the landlord, as on Properties.
/** Which date a row's deadline is when it is not the statement and refund (Florida's claim notice, or the balance after
 *  it), as a prefix for the countdown; empty for the usual one. */
const track = (s: TenancySummary) => {
  const label = dueLabelOf(s);
  return label === "Statement and refund due" ? "" : `${label.replace(/ due$/, "")}: `;
};

export default async function MoveOutsPage({ searchParams }: PageProps<"/move-outs">) {
  const sp = await searchParams;
  const view = sp.view === "closed" ? "closed" : "open";
  // Each row's countdown is from the unit's own today (u.today, its state's zone). The disputes that wait on the
  // landlord are the bell's own entries, read once for the request (the shell reads them too).
  const ws = await currentWorkspace();
  const [{ units }, alerts] = await Promise.all([
    loadUnits(),
    ws ? Promise.all([
      disputeAlerts(ws.id).catch((e) => { console.error("Move-outs: couldn't load the disputes", e); return [] as DisputeAlert[]; }),
      paypalDisputeAlerts(ws.id).catch((e) => { console.error("Move-outs: couldn't load the PayPal disputes", e); return []; }),
    ]).then(([a, b]) => [...b, ...a] as DisputeAlert[]) : Promise.resolve([] as DisputeAlert[]),
  ]);
  // A PayPal dispute's step comes first: PayPal's date is the nearer one.
  const disputeOf = new Map([...alerts].reverse().map((a) => [a.tenancyId, a]));
  const stepOf = (u: (typeof units)[number]) => { const a = disputeOf.get(u.summary.id); return a ? disputeStep(a) : stepLink(u.summary, u.next); };
  const ending = units.filter((u) => u.summary.noticeGivenOn || u.summary.tenantMoveOut || u.summary.moveOutDate || u.summary.statementDeliveredAt);
  const isClosed = (s: TenancySummary) => closedOut(s) && !s.dispute && !s.paypalDispute;
  const open = ending.filter((u) => !isClosed(u.summary));
  const closed = ending.filter((u) => isClosed(u.summary));
  const shown = view === "closed" ? closed : open;
  const thumbs = await loadThumbnails(shown.map((u) => u.summary.id));
  // The column's tip speaks for the one state every row follows, or generally when they span several.
  const pack = onePack(ending.map((u) => u.summary.state));

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
          <>
          {/* Below 1024px: the property, its deadline and its status, one row each. */}
          <ul className="lg:hidden">
            {shown.map((u) => {
              const s = u.summary;
              const status = propertyStatus(s, u.next);
              const due = s.moveOutDate ? dueOf(s) : null;
              return (
                <li key={s.id} className="border-b border-line-2 last:border-b-0">
                  <Link href={tabHref(s.id, "move-out")} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface">
                    <Thumb src={thumbs.get(s.id) ?? null} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{splitAddress(s.address, s.city).street}</div>
                      <div className="truncate text-xs text-ink-3">
                        {due ? (s.statementDeliveredAt ? `Statement delivered, due ${shortDate(due)}` : `Due ${dayLabel(due, u.today)}, ${whenText(daysBetween(u.today, due))}`)
                          : s.plannedMoveOut ? `Moving out ${shortDate(s.plannedMoveOut)}` : "Move-out not set"}
                      </div>
                    </div>
                    <StatusChip tone={status.tone}>{status.label}</StatusChip>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="max-lg:hidden">
          <Table minWidth={820}>
            <thead>
              <tr>
                <Th first>Property</Th><Th>Moved out</Th>
                <Th><span className="inline-flex items-center gap-1">Statement and refund due
                  {pack ? <InfoTip title={pack.deadline.tip.title} cite={pack.deadline.tip.cite}>{pack.deadline.tip.text}</InfoTip>
                    : <InfoTip title="By each property's state">Each state sets its own deadline: 21 days in California, 14 in New York, 30 in Texas and Washington, 15 or 30 in Florida. Each row shows its own.</InfoTip>}</span></Th>
                <Th>Status</Th><Th last>Next step</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => {
                const s = u.summary;
                const addr = splitAddress(s.address, s.city);
                const status = propertyStatus(s, u.next);
                const step = stepOf(u);
                const due = s.moveOutDate ? dueOf(s) : null;
                return (
                  <tr key={s.id} className={trClass}>
                    <Td first className="whitespace-nowrap">
                      <Link href={tabHref(s.id, "move-out")} className="flex items-center gap-3">
                        <Thumb src={thumbs.get(s.id) ?? null} />
                        <span><span className="block font-medium">{addr.street}</span><span className="block text-xs text-ink-3">{s.tenants.join(", ")}</span></span>
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {s.moveOutDate ? shortDate(s.moveOutDate) : s.plannedMoveOut ? <span className="text-ink-3">Planned {shortDate(s.plannedMoveOut)}</span> : <span className="text-ink-3">Not set</span>}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {due ? <>{shortDate(due)}<span className="block text-xs text-ink-3">{s.statementDeliveredAt ? "Statement delivered" : `${track(s)}${whenText(daysBetween(u.today, due))}`}</span></> : <span className="text-ink-3">After move-out</span>}
                    </Td>
                    <Td><StatusChip tone={status.tone}>{status.label}</StatusChip></Td>
                    <Td last className="whitespace-nowrap"><Link href={step.href} className="font-medium text-brand hover:underline">{step.label}</Link></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          </div>
          </>
        ) : (
          <EmptyState icon="key" title={view === "closed" ? "No closed move-outs" : "No move-outs in progress"}
            sub={view === "closed" ? "Closed move-outs show here once the statement and refund are out." : "A move-out starts when either side gives notice."} />
        )}
      </Card>
    </>
  );
}
