import Link from "next/link";
import type { Metadata } from "next";
import { InfoTip } from "@/components/info-tip";
import { Card, EmptyState, PageHead, StatusChip, Table, Td, Th, trClass, type Tone } from "@/components/ui";
import { pacificDate, shortDate } from "@/lib/dates";
import { NOTICE_INFO, NOTICE_SLUG, type NoticeKind } from "@/lib/notices";
import { splitAddress, tabHref } from "@/lib/property-view";
import { loadUnits } from "@/lib/units";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Documents" };

// Every paper the law asks for, across every property: the lease, the refund agreement, the two written notices and
// the itemized statement, each with its state and where it opens.
export default async function DocumentsPage() {
  const { units } = await loadUnits();
  type Row = { key: string; name: string; street: string; status: string; tone: Tone; href: string; cite?: string };
  const rows: Row[] = units.flatMap((u) => {
    const s = u.summary;
    const street = splitAddress(s.address, s.city).street;
    const notice = (k: NoticeKind): Row => {
      const given = s.notices[k];
      const notNeeded = k === "electronic_refund" && s.refundNotice.needed === false;
      return {
        key: `${s.id}-${k}`, name: NOTICE_INFO[k].short.charAt(0).toUpperCase() + NOTICE_INFO[k].short.slice(1), street,
        status: given ? `Given ${shortDate(given.date)}` : notNeeded ? "Not needed" : s.noticeGivenOn ? "Draft" : "Not due yet",
        tone: given ? "green" : notNeeded || !s.noticeGivenOn ? "gray" : "amber",
        href: `/tenancy/${s.id}/notices/${NOTICE_SLUG[k]}`, cite: NOTICE_INFO[k].cite,
      };
    };
    return [
      { key: `${s.id}-lease`, name: "Lease", street, status: "Checked", tone: "green", href: tabHref(s.id, "documents") },
      { key: `${s.id}-agreement`, name: "Refund agreement", street, status: s.agreement ? "Signed" : "Not signed", tone: s.agreement ? "green" : "amber", href: tabHref(s.id, "overview", "move-in"), cite: "Civ. Code 1950.5(h)(1)(A), (h)(1)(C)" },
      notice("inspection"),
      notice("electronic_refund"),
      {
        key: `${s.id}-statement`, name: "Itemized statement", street,
        status: s.statementDeliveredAt ? `Delivered ${shortDate(pacificDate(s.statementDeliveredAt))}` : s.moveOutInspectedAt ? "Draft" : "Not started",
        tone: s.statementDeliveredAt ? "green" : s.moveOutInspectedAt ? "amber" : "gray",
        href: s.moveOutInspectedAt || s.statementDeliveredAt ? `/tenancy/${s.id}/statement` : tabHref(s.id, "documents"), cite: "Civ. Code 1950.5(h)(1)-(2)",
      },
    ] as Row[];
  });

  return (
    <>
      <PageHead title="Documents" />
      <Card>
        {rows.length ? (
          <Table minWidth={640}>
            <thead><tr><Th first>Document</Th><Th>Property</Th><Th>Status</Th><Th last /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={trClass}>
                  <Td first><span className="inline-flex items-center gap-1.5 font-medium">{r.name}{r.cite && <InfoTip title={r.name} cite={r.cite} />}</span></Td>
                  <Td className="whitespace-nowrap text-ink-2">{r.street}</Td>
                  <Td><StatusChip tone={r.tone}>{r.status}</StatusChip></Td>
                  <Td last align="right"><Link href={r.href} className="font-medium text-brand hover:underline">Open</Link></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : <EmptyState icon="doc" title="No documents yet" sub="Documents come in with the first lease." />}
      </Card>
    </>
  );
}
