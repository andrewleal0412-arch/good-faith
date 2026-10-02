import Link from "next/link";
import { DISCLAIMERS } from "@/lib/copy";
import { longDate } from "@/lib/dates";
import { loadLedger } from "@/lib/ledger-load";
import { LedgerGrid } from "./ledger-grid";

export const dynamic = "force-dynamic";

// The deposit ledger: every money event and deduction across every unit in one AG Grid, filterable by any column, with
// the totals following the filters and a CSV for the accountant. Server-loaded and read-only; the grid gets plain rows.

export default async function LedgerPage({ searchParams }: PageProps<"/ledger">) {
  const sp = await searchParams;
  const focusId = typeof sp.tenancy === "string" ? sp.tenancy.toLowerCase() : null;
  const ledger = await loadLedger();
  const focus = "error" in ledger || !focusId ? null : ledger.units.find((u) => u.id === focusId) ?? null;

  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-8 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.02em]">Ledger</h1>
          <p className="mt-1 max-w-2xl text-[15px] text-ink-2">
            Every deposit invoice, payment, deduction, refund and payout across your units, each with the part of Civil Code 1950.5 that
            applies to it.{"error" in ledger ? "" : ` As of ${longDate(ledger.today)}.`}
          </p>
        </div>
        <Link href="/units" className="rounded-xl border border-line bg-surface px-4 py-2 text-[14px] font-semibold text-ink hover:bg-bg">Your units</Link>
      </div>

      {"error" in ledger ? (
        <div className="mt-8 rounded-2xl border border-danger/30 bg-danger-soft px-6 py-8 text-center">
          <p className="text-[16px] font-semibold text-danger">The ledger could not be loaded</p>
          <p className="mx-auto mt-1 max-w-md text-[14px] leading-relaxed text-ink-2">{ledger.error}</p>
        </div>
      ) : ledger.rows.length === 0 ? (
        <div className="mt-8 rounded-2xl border-2 border-dashed border-line bg-surface px-6 py-12 text-center">
          <p className="text-[16px] font-semibold">Nothing in the ledger yet</p>
          <p className="mx-auto mt-1 max-w-md text-[14px] leading-relaxed text-ink-2">
            Rows appear once a deposit invoice goes out through PayPal. From then on every payment, deduction and refund lands here.
          </p>
          <Link href="/#lease" className="mt-5 inline-block rounded-xl bg-accent px-4 py-2 text-[14px] font-semibold text-white">Check a lease</Link>
        </div>
      ) : (
        <LedgerGrid rows={ledger.rows} today={ledger.today} focus={focus} />
      )}

      <p className="mt-10 text-[12px] leading-relaxed text-ink-3">{DISCLAIMERS[0]}</p>
    </main>
  );
}
