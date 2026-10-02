import Link from "next/link";
import { InfoTip } from "@/components/info-tip";
import { Card, CardHead, EmptyState, Fact, FactStrip, Money, StatusChip, Table, Td, Th, trClass } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { ledgerTotals, type LedgerRow } from "@/lib/ledger";

// One tenancy's money, oldest first: the same rows the Payments ledger shows for every unit, with a way into it
// filtered to this tenancy. Inflows green, outflows ink with a minus; the status is plain text unless something failed.
export function MoneyTimeline({ tenancyId, rows }: { tenancyId: string; rows: LedgerRow[] }) {
  if (!rows.length) {
    return <Card><EmptyState icon="card" title="No payments yet" sub="The deposit invoice starts the record." /></Card>;
  }
  const t = ledgerTotals(rows);
  return (
    <div className="flex flex-col gap-6">
      <FactStrip cols={4}>
        <Fact label="Collected" value={<Money value={t.collected} />} />
        <Fact label="Deductions" value={<Money value={t.deducted} />} sub={t.drafted > 0 ? (t.drafted === t.deducted ? "Drafts" : `${shortMoney(t.drafted)} drafted`) : undefined} />
        <Fact label="Returned" value={<Money value={t.returned} />} sub={t.pending > 0 ? `${shortMoney(t.pending)} pending` : undefined} />
        <Fact label="Still held" big value={<Money value={t.held} cents="small" />} />
      </FactStrip>
      <Card>
        <CardHead title="Payments" meta={`${rows.length}`} right={<Link href={`/ledger?tenancy=${tenancyId}`} className="text-sm text-brand hover:underline">Open in Payments</Link>} />
        <Table minWidth={640}>
          <thead>
            <tr>
              <Th first>Date</Th>
              <Th>
                <span className="inline-flex items-center gap-1.5">
                  Type
                  <InfoTip title="Each row's rule" cite="Civ. Code 1950.5">
                    Hover a type for the part of Civil Code 1950.5 behind that row. The Payments export lists it for every row.
                  </InfoTip>
                </span>
              </Th>
              <Th>Detail</Th><Th>Status</Th><Th last align="right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={trClass}>
                <Td first className="whitespace-nowrap tabular-nums text-ink-2">{shortDate(r.date)}</Td>
                <Td className="whitespace-nowrap font-medium" title={r.tag ? `Civ. Code 1950.5${r.tag}: ${r.tagLabel}` : undefined}>{r.type}</Td>
                <Td>
                  {r.detail}
                  {r.paypalId && <span className="block text-xs text-ink-3">{r.paypalId}</span>}
                </Td>
                <Td className="whitespace-nowrap">
                  {r.effect === "failed" ? <StatusChip tone="red">Failed</StatusChip> : <span className="text-ink-2">{r.status.charAt(0).toUpperCase() + r.status.slice(1)}</span>}
                </Td>
                <Td last align="right" className={r.signed > 0 ? "text-green" : r.signed === 0 ? "text-ink-3" : ""}>
                  <Money value={r.amount} sign={r.signed < 0 ? "minus" : r.signed > 0 ? "plus" : undefined} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

const shortMoney = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
