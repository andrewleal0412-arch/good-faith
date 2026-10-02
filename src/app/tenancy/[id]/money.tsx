import Link from "next/link";
import { shortDate } from "@/lib/dates";
import { usd } from "@/lib/deductions";
import { KIND_TONE, ledgerTotals, type LedgerRow } from "@/lib/ledger";

// One tenancy's money, oldest first: the same rows the ledger shows for every unit, with a way into the grid filtered
// to this tenancy. Nothing to show until the deposit invoice goes out.
export function MoneyTimeline({ tenancyId, rows }: { tenancyId: string; rows: LedgerRow[] }) {
  if (!rows.length) return null;
  const t = ledgerTotals(rows);
  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-3">Money</h2>
        <Link href={`/ledger?tenancy=${tenancyId}`} className="text-[13px] font-semibold text-ink underline underline-offset-2">Open in the ledger</Link>
      </div>
      <ol className="mt-3 divide-y divide-line rounded-2xl bg-surface px-5 shadow-sm">
        {rows.map((r) => (
          // On a phone the date takes its own line above the text, so a PayPal id has room to stay whole.
          <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 py-3 text-[13px] sm:grid-cols-[88px_minmax(0,1fr)_auto]">
            <span className="col-span-2 text-[12px] tabular-nums text-ink-3 sm:col-span-1 sm:text-[13px]">{shortDate(r.date)}</span>
            <span className="min-w-0">
              <span className={`mr-1.5 inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${KIND_TONE[r.kind]}`}>{r.type}</span>
              <span className="text-ink-2">{r.detail}</span>
              <span className="block text-[12px] text-ink-3">
                {r.status} · {r.tag} {r.tagShort}{r.paypalId ? <> · <span className="whitespace-nowrap font-mono">{r.paypalId}</span></> : null}
              </span>
            </span>
            {/* Nothing moved yet for an invoice, a draft deduction or a failed refund, so the amount is grey; what was claimed or returned is a minus. */}
            <span className={`shrink-0 font-semibold tabular-nums ${r.signed === 0 ? "text-ink-3" : ""}`}>{r.signed < 0 ? `-${usd(r.amount)}` : usd(r.amount)}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[12px] text-ink-3">
        Collected {usd(t.collected)} · deductions {usd(t.deducted)}
        {t.drafted > 0 ? ` (${t.drafted === t.deducted ? "drafts" : `${usd(t.drafted)} drafted`}, not on a statement yet)` : ""}
        {" · "}returned {usd(t.returned)}{t.pending > 0 ? ` (${usd(t.pending)} pending)` : ""} · still held {usd(t.held)}.
      </p>
    </section>
  );
}
