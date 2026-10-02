"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { missingDocs, RECEIPT_THRESHOLD, settle, statementDue, usd, type StoredDeduction } from "@/lib/deductions";

const TAG = { rent: "(b)(1) Unpaid rent", damage: "(b)(2) Damage", cleaning: "(b)(3) Cleaning" } as const;

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export function Settlement(p: {
  tenancyId: string;
  today: string;
  moveOutDate: string | null;
  depositHeld: number | null;
  refundTo: string | null;
  deductions: StoredDeduction[];
  returned: { amount: number; kind: string; id: string; at: string } | null;
  statement: { href: string; delivered: string | null }; // the itemized statement page, and how it went out once recorded
}) {
  const router = useRouter();
  const [date, setDate] = useState(p.moveOutDate ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function saveDate() {
    setBusy(true);
    setError("");
    const r = await fetch(`/api/tenancies/${p.tenancyId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ moveOutDate: date }),
    });
    setBusy(false);
    if (!r.ok) return setError((await r.json().catch(() => ({}))).error ?? "Couldn't save the date.");
    router.refresh();
  }

  const s = settle(p.depositHeld ?? 0, p.deductions);
  const due = p.moveOutDate ? statementDue(p.moveOutDate) : null;
  const daysLeft = due ? Math.round((Date.parse(due) - Date.parse(p.today)) / 86_400_000) : null;
  const missing = p.deductions.map((d) => [d, missingDocs(d, s.documentsRequired)] as const).filter(([, m]) => m.length);

  return (
    <section className="mt-10">
      <h2 className="text-[22px] font-semibold tracking-[-0.01em]">Deductions and refund</h2>
      <p className="mt-1 text-[14px] text-ink-2">
        You decide every deduction. The agent does the math, checks the paperwork the law asks for, and keeps the clock.
      </p>
      {error && <p className="mt-3 rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger">{error}</p>}

      <div className="mt-4 rounded-2xl bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] text-ink-2">Tenant moved out on</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="rounded-xl border border-line bg-bg px-3 py-1.5 text-[14px]" />
          {date && date !== p.moveOutDate && (
            <button onClick={saveDate} disabled={busy} className="rounded-xl bg-ink px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40">
              {busy ? "Saving..." : "Save"}
            </button>
          )}
        </div>
        {due && daysLeft != null && (
          <p className={`mt-2 text-[14px] ${daysLeft < 0 ? "text-danger" : daysLeft <= 5 ? "text-warn" : "text-ink-2"}`}>
            Statement and refund due by <b>{longDate(due)}</b>
            {daysLeft < 0 ? `, ${-daysLeft} day${daysLeft === -1 ? "" : "s"} late` : daysLeft === 0 ? ", today" : `, ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
            <span className="text-ink-3"> (21 days, Civ. Code 1950.5(h)(1))</span>
          </p>
        )}

        <ul className="mt-5 divide-y divide-line">
          {p.deductions.map((d) => (
            <li key={d.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold">{d.item}{d.room ? <span className="font-normal text-ink-3"> · {d.room}</span> : null}</p>
                <p className="text-[12px] text-ink-3">
                  {TAG[d.category]} · {d.math}{d.proration !== "none" ? " (DRE guidance)" : ""}{d.is_estimate ? " · good-faith estimate" : ""}
                </p>
              </div>
              <p className="text-[14px] font-semibold tabular-nums">{usd(Number(d.amount))}</p>
            </li>
          ))}
          {!p.deductions.length && <li className="py-3 text-[14px] text-ink-3">No deductions yet. Add them from the findings above.</li>}
        </ul>

        <dl className="mt-2 space-y-1.5 border-t border-line pt-4 text-[14px]">
          <Row label="Deposit held">{p.depositHeld == null ? "--" : usd(p.depositHeld)}</Row>
          <Row label="Deductions">{s.total ? `-${usd(s.total)}` : usd(0)}</Row>
          {s.balanceClaimed > 0 ? (
            <Row label="Balance claimed from tenant" strong>{usd(s.balanceClaimed)}</Row>
          ) : p.returned ? (
            <Row label={`Refunded by PayPal ${p.returned.kind === "payout" ? "Payout" : "refund"} on ${longDate(p.returned.at.slice(0, 10))}`} strong>{usd(p.returned.amount)}</Row>
          ) : (
            <Row label={p.refundTo ? "Refund by PayPal" : "Refund"} strong>{usd(s.refund)}</Row>
          )}
        </dl>
        {/* The PayPal address on its own line in small mono type, as the statement shows it, so the amount keeps its
            line on a phone instead of sharing it with a long address that breaks mid-word. */}
        {!p.returned && s.balanceClaimed <= 0 && p.refundTo && (
          <p className="mt-0.5 break-all font-mono text-[12px] text-ink-3">to {p.refundTo}</p>
        )}
        {p.returned && <p className="mt-1 text-right font-mono text-[11px] text-ink-3">{p.returned.id}</p>}
        {s.balanceClaimed > 0 && (
          <p className="mt-2 text-[12px] text-ink-3">
            The statement lists this as a claim, not a demand for payment. The agent never collects it on its own.
          </p>
        )}

        <div className="mt-4 flex flex-col items-start gap-3 border-t border-line pt-4 sm:flex-row sm:items-center">
          <Link href={p.statement.href} className="shrink-0 rounded-xl bg-ink px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90">
            Open the itemized statement
          </Link>
          <p className="text-[13px] text-ink-2 sm:min-w-0 sm:flex-1">
            {p.statement.delivered
              ? <>Statement delivered by {p.statement.delivered}.</>
              : "The 1950.5(h) statement with photos and invoices, ready to print, download as a PDF packet, and deliver."}
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2 text-[13px]">
        <p className="text-ink-2">
          {s.documentsRequired
            ? `Repair and cleaning deductions total more than ${usd(RECEIPT_THRESHOLD)}, so invoices, receipts and labor details go with the statement (1950.5(h)(2)).`
            : `Repair and cleaning deductions total ${usd(RECEIPT_THRESHOLD)} or less, so receipts aren't required, though the tenant can ask for them within 14 days (1950.5(h)(4)-(5)).`}
        </p>
        {missing.map(([d, m]) => (
          <p key={d.id} className="text-warn">Still needed for {d.item.toLowerCase()}: {m.join(", ")}.</p>
        ))}
      </div>
    </section>
  );
}

function Row({ label, strong, children }: { label: string; strong?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "text-[16px] font-semibold" : "text-ink-2"}`}>
      {/* A long PayPal address in the label wraps rather than pushing the amount off a phone screen. */}
      <dt className="min-w-0 break-words">{label}</dt>
      <dd className="shrink-0 tabular-nums">{children}</dd>
    </div>
  );
}
