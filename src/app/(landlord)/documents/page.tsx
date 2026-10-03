import Link from "next/link";
import type { Metadata } from "next";
import { InfoTip } from "@/components/info-tip";
import { Card, EmptyState, PageHead, StatusChip, Table, Td, Th, trClass, type Tone } from "@/components/ui";
import { pacificDate, shortDate } from "@/lib/dates";
import { listedRecords, noticeInfoFor, NOTICE_SLUG, recordsFor, type NoticeKind } from "@/lib/notices";
import { packOf } from "@/lib/next-step";
import { onePack, refundRecordWords } from "@/lib/states/server";
import { splitAddress, tabHref } from "@/lib/property-view";
import { loadUnits } from "@/lib/units";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Documents" };

// Every paper the law asks for, across every property: the lease, the refund agreement (or account), the written notices and records
// the property's state pack names (California: the inspection and electronic-refund notices) and the itemized
// statement, each with its state and where it opens.
export default async function DocumentsPage() {
  const { units } = await loadUnits();
  type Row = { key: string; name: string; status: string; tone: Tone; href: string; cite?: string };
  // One group per property, in the Properties order, each with the same five papers.
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  const groups = units.map((u) => {
    const s = u.summary;
    const pack = packOf(s);
    const info = noticeInfoFor(pack);
    const notice = (k: NoticeKind): Row => {
      const given = s.notices[k];
      const notNeeded = k === "electronic_refund" && s.refundNotice.needed === false;
      return {
        key: `${s.id}-${k}`, name: cap(info[k]!.short),
        status: given ? `Given ${shortDate(given.date)}` : notNeeded ? "Not needed" : s.noticeGivenOn ? "Draft" : "Not due yet",
        tone: given ? "green" : notNeeded || !s.noticeGivenOn ? "gray" : "amber",
        href: `/tenancy/${s.id}/notices/${NOTICE_SLUG[k]}`, cite: info[k]!.cite,
      };
    };
    // The state's own records (a Washington checklist, the account a deposit is held in, a Florida claim notice).
    const record = (r: ReturnType<typeof recordsFor>[number]): Row => {
      const given = s.notices[r.kind];
      return {
        key: `${s.id}-${r.kind}`, name: cap(r.short), status: given ? `${r.verb} ${shortDate(given.date)}` : "Not recorded",
        tone: given ? "green" : r.phase === "move_in" ? "amber" : "gray", href: `/tenancy/${s.id}/notices/${NOTICE_SLUG[r.kind]}`, cite: r.cite,
      };
    };
    const rows: Row[] = [
      { key: `${s.id}-lease`, name: "Lease", status: "Checked", tone: "green", href: tabHref(s.id, "documents") },
      { key: `${s.id}-agreement`, name: refundRecordWords(pack).name, status: s.agreement ? "Signed" : "Not signed", tone: s.agreement ? "green" : "amber", href: tabHref(s.id, "overview", "move-in"), cite: pack.refund.documentsTip.cite },
      ...listedRecords(pack, "move_in", s.notices).map(record),
      ...(Object.keys(info) as NoticeKind[]).map(notice),
      ...listedRecords(pack, "move_out", s.notices).map(record),
      {
        key: `${s.id}-statement`, name: "Itemized statement",
        status: s.statementDeliveredAt ? `Delivered ${shortDate(pacificDate(s.statementDeliveredAt))}` : s.moveOutInspectedAt ? "Draft" : "Not started",
        tone: s.statementDeliveredAt ? "green" : s.moveOutInspectedAt ? "amber" : "gray",
        href: s.moveOutInspectedAt || s.statementDeliveredAt ? `/tenancy/${s.id}/statement` : tabHref(s.id, "documents"), cite: pack.statement.documentRow.cite,
      },
    ];
    return { id: s.id, street: splitAddress(s.address, s.city).street, tenants: s.tenants.join(", "), rows };
  });

  // The law behind each paper, once for the whole page rather than an icon on every row: the one state every property
  // follows, or a line per state when they span several (each row's own citation is its hover).
  const one = onePack(units.map((u) => u.summary.state));
  const why = one ? (
    <InfoTip title="What each document is for">
      <span className="flex flex-col gap-1">
        <span>{refundRecordWords(one).name}: {one.refund.documentsTip.cite}</span>
        {[...recordsFor(one, "move_in"), ...recordsFor(one, "notice"), ...recordsFor(one, "move_out")].filter((r) => !r.hiddenUntilRecorded).map((r) => (
          <span key={r.kind}>{cap(r.short)}: {r.cite}</span>
        ))}
        <span>Itemized statement: {one.statement.documentRow.cite}</span>
      </span>
    </InfoTip>
  ) : (
    <InfoTip title="What each document is for">Each property follows its own state&apos;s deposit law; hover a document for its citation.</InfoTip>
  );

  return (
    <>
      <PageHead title="Documents" />
      {groups.length ? (
        <Card>
          <ul className="lg:hidden">
            {groups.map((g) => (
              <li key={g.id}>
                <Link href={tabHref(g.id, "documents")} className="block border-b border-line-2 bg-surface px-4 py-2 text-xs font-medium text-ink-2 hover:text-ink">{g.street}</Link>
                <ul>
                  {g.rows.map((r) => (
                    <li key={r.key} className="border-b border-line-2">
                      <Link href={r.href} title={r.cite} className="flex items-center gap-3 px-4 py-3 hover:bg-surface">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.name}</span>
                        <StatusChip tone={r.tone}>{r.status}</StatusChip>
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <div className="max-lg:hidden">
            <Table minWidth={640}>
              <thead><tr><Th first><span className="inline-flex items-center gap-1.5">Document{why}</span></Th><Th>Status</Th><Th last /></tr></thead>
              {groups.map((g) => (
                <tbody key={g.id}>
                  <tr>
                    <td colSpan={3} className="border-y border-line-2 bg-surface px-5 py-2 text-xs">
                      <Link href={tabHref(g.id, "documents")} className="font-medium text-ink-2 hover:text-ink hover:underline">{g.street}</Link>
                      {g.tenants && <span className="text-ink-3">, {g.tenants}</span>}
                    </td>
                  </tr>
                  {g.rows.map((r) => (
                    <tr key={r.key} className={trClass}>
                      <Td first className="font-medium" title={r.cite}>{r.name}</Td>
                      <Td><StatusChip tone={r.tone}>{r.status}</StatusChip></Td>
                      <Td last align="right"><Link href={r.href} className="font-medium text-brand hover:underline">Open</Link></Td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </Table>
          </div>
        </Card>
      ) : <Card><EmptyState icon="doc" title="No documents yet" sub="Documents come in with the first lease." /></Card>}
    </>
  );
}

