import Link from "next/link";
import { InfoTip } from "@/components/info-tip";
import { Card, CardHead, EmptyState, Fact, FactStrip, Money, StatusChip, Table, Td, Th, trClass } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { ledgerTotals, tagCite, type LedgerRow } from "@/lib/ledger";
import type { Tip } from "@/lib/states/types";

// One tenancy's money, oldest first: the same rows the Payments ledger shows for every unit, with a way into it
// filtered to this tenancy. Inflows green, outflows ink with a minus; the status is plain text unless something failed.
export function MoneyTimeline({ tenancyId, rows, typeTip }: { tenancyId: string; rows: LedgerRow[]; typeTip: Tip }) {
  if (!rows.length) {
    return <Card><EmptyState icon="card" title="No payments yet" sub="The deposit invoice starts the record." /></Card>;
  }
  const t = ledgerTotals(rows);
  // One hero: what is still held while the deposit is held, what went back once a refund or payout has gone out.
  const back = t.returned + t.pending > 0;
  const hero = (n: number) => <Money value={n} cents="small" phoneCents="full" />;
  return (
    <div className="flex flex-col gap-6">
      <FactStrip cols={4}>
        <Fact label="Collected" value={<Money value={t.collected} />} />
        <Fact label="Deductions" value={<Money value={t.deducted} />} sub={t.drafted > 0 ? (t.drafted === t.deducted ? "Drafts" : `${shortMoney(t.drafted)} drafted`) : undefined} />
        {/* The hero is always the last cell. */}
        {back ? <Fact label="Still held" value={<Money value={t.held} />} />
          : <Fact label="Returned" value={<Money value={t.returned} />} />}
        {back ? <Fact label="Returned" big value={hero(t.returned + t.pending)} sub={t.pending > 0 ? `${shortMoney(t.pending)} pending` : undefined} />
          : <Fact label="Still held" big value={hero(t.held)} />}
      </FactStrip>
      <Card>
        <CardHead title="Payments" meta={`${rows.length}`} right={<Link href={`/ledger?tenancy=${tenancyId}`} className="text-sm text-brand hover:underline">Open in Payments</Link>} />
        {/* Below 1024px, Mercury's transaction list: the type, the date and status under it, the amount on the right. */}
        <ul className="lg:hidden">
          {rows.map((r) => (
            <li key={r.id} title={r.detail} className="flex items-center gap-3 border-b border-line-2 px-4 py-3 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.type}</div>
                <div className="flex items-center gap-1.5 text-xs text-ink-3">
                  {shortDate(r.date)}, {r.effect === "failed" ? <StatusChip tone="red" size="sm">Failed</StatusChip> : r.status}
                </div>
              </div>
              <Money value={r.amount} sign={r.signed < 0 ? "minus" : r.signed > 0 ? "plus" : undefined}
                className={`text-sm ${r.signed > 0 ? "text-green" : r.signed === 0 ? "text-ink-3" : ""}`} />
            </li>
          ))}
        </ul>
        <div className="max-lg:hidden">
        <Table minWidth={640}>
          <thead>
            <tr>
              <Th first>Date</Th>
              <Th>
                <span className="inline-flex items-center gap-1.5">
                  Type
                  <InfoTip title={typeTip.title} cite={typeTip.cite}>{typeTip.text}</InfoTip>
                </span>
              </Th>
              <Th>Detail</Th><Th>Status</Th><Th last align="right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={trClass}>
                <Td first className="whitespace-nowrap tabular-nums text-ink-2">{shortDate(r.date)}</Td>
                <Td className="whitespace-nowrap font-medium" title={r.tag ? `${tagCite(r)}: ${r.tagLabel}` : undefined}>{r.type}</Td>
                <Td title={r.detail}>
                  {r.summary}
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
        </div>
      </Card>
    </div>
  );
}

const shortMoney = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
