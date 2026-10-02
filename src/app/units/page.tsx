import Link from "next/link";
import { longDate, shortDate, whenText } from "@/lib/dates";
import { usd } from "@/lib/deductions";
import { wasPaid } from "@/lib/invoice-status";
import { refundLeft, STATUS_LABEL, type Level, type TenancySummary } from "@/lib/next-step";
import { DISCLAIMERS } from "@/lib/statement";
import { loadUnits, UPCOMING_DAYS } from "@/lib/units";

export const dynamic = "force-dynamic";

// The landlord's home base: every tenancy, what it holds, and the next thing the law asks for, computed from the
// tenancy's own dates (src/lib/next-step.ts) so nothing depends on remembering to come back years later.

const LEVEL: Record<Level, { word: string; fg: string; bg: string; dot: string }> = {
  overdue: { word: "Overdue", fg: "text-danger", bg: "bg-danger-soft", dot: "bg-danger" },
  urgent: { word: "Now", fg: "text-warn", bg: "bg-warn-soft", dot: "bg-warn" },
  soon: { word: "Soon", fg: "text-info", bg: "bg-info-soft", dot: "bg-info" },
  later: { word: "Later", fg: "text-ink-2", bg: "bg-bg", dot: "bg-ink-3" },
  done: { word: "Done", fg: "text-accent", bg: "bg-accent-soft", dot: "bg-accent" },
};

/** What the unit holds right now, from the stored PayPal records and the deductions. */
function depositLine(s: TenancySummary): { text: string; held: number } {
  if (!s.deposit) return { text: "Not collected yet", held: 0 };
  if (s.returned) return { text: `${usd(s.returned.amount)} of ${usd(s.deposit.amount)} returned`, held: 0 };
  if (wasPaid(s.deposit.status)) {
    // Once the statement is out and the deductions used the whole deposit, nothing is held for the tenants any more.
    if (s.statementDeliveredAt && refundLeft(s) === 0) return { text: `${usd(s.deposit.amount)} applied to deductions`, held: 0 };
    return { text: `${usd(s.deposit.amount)} held`, held: s.deposit.amount };
  }
  return { text: `${usd(s.deposit.amount)} invoiced, ${s.deposit.status.toLowerCase().replace(/_/g, " ")}`, held: 0 };
}

export default async function UnitsPage() {
  const { today, units, upcoming } = await loadUnits();
  const attention = units.filter((u) => u.next.level === "overdue" || u.next.level === "urgent").length;
  const held = units.reduce((sum, u) => sum + depositLine(u.summary).held, 0);

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.02em]">Your units</h1>
          <p className="mt-1 max-w-xl text-[15px] text-ink-2">
            Every tenancy and the next thing the law asks for, worked out from its dates. As of {longDate(today)}.
          </p>
        </div>
        <Link href="/" className="rounded-xl bg-ink px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90">Check a lease to add a unit</Link>
      </div>

      {units.length > 0 && (
        <dl className="mt-6 grid grid-cols-3 gap-3">
          <Stat label={units.length === 1 ? "Unit" : "Units"} value={String(units.length)} />
          <Stat label="Deposits held" value={usd(held)} />
          <Stat label="Need attention" value={String(attention)} tone={attention ? "text-danger" : "text-accent"} />
        </dl>
      )}

      {units.length === 0 ? (
        <div className="mt-8 rounded-2xl border-2 border-dashed border-line bg-surface px-6 py-12 text-center">
          <p className="text-[16px] font-semibold">No units yet</p>
          <p className="mx-auto mt-1 max-w-md text-[14px] leading-relaxed text-ink-2">
            Check a lease to start the first tenancy. The agent reads the deposit terms, flags what breaks Civil Code 1950.5
            and collects the deposit through PayPal. From then on this page keeps the dates.
          </p>
          <Link href="/" className="mt-5 inline-block rounded-xl bg-accent px-4 py-2 text-[14px] font-semibold text-white">Check a lease</Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {units.map(({ summary: s, next: n, events }) => {
            const L = LEVEL[n.level];
            const dep = depositLine(s);
            return (
              <li key={s.id} className="rounded-2xl bg-surface p-5 shadow-sm">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.9fr)_minmax(0,1.2fr)]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-bg px-2.5 py-0.5 text-[12px] font-semibold text-ink-2">{STATUS_LABEL[s.status] ?? s.status}</span>
                      {s.city && <span className="text-[12px] text-ink-3">{s.city}</span>}
                    </div>
                    <Link href={`/tenancy/${s.id}`} className="mt-2 block text-[17px] font-semibold leading-snug hover:underline">{s.address}</Link>
                    <p className="mt-1 text-[14px] text-ink-2">
                      {s.tenants.join(" and ") || "No tenants named"}{s.monthlyRent != null && <> · {usd(s.monthlyRent)} a month</>}
                    </p>
                  </div>

                  <dl className="grid grid-cols-2 content-start gap-x-4 gap-y-2 text-[13px] lg:grid-cols-1 lg:gap-y-1.5">
                    <Fact label="Lease">{s.endDate ? `Ends ${shortDate(s.endDate)}` : "Month to month"}</Fact>
                    <Fact label="Deposit">{dep.text}</Fact>
                    {s.noticeGivenOn && <Fact label="Notice">Given {shortDate(s.noticeGivenOn)}{s.plannedMoveOut ? `, out ${shortDate(s.plannedMoveOut)}` : ""}</Fact>}
                    {s.tenantMoveOut && !s.moveOutDate && <Fact label="From tenant">Out {shortDate(s.tenantMoveOut.plannedMoveOut)}; forwarding address on file</Fact>}
                    {s.moveOutDate && <Fact label="Moved out">{shortDate(s.moveOutDate)}</Fact>}
                    {s.startDate && !s.noticeGivenOn && !s.moveOutDate && <Fact label="Since">{shortDate(s.startDate)}</Fact>}
                  </dl>

                  <div className={`rounded-xl px-4 py-3 ${L.bg}`}>
                    <p className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] ${L.fg}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${L.dot}`} />Next · {L.word}
                    </p>
                    <p className="mt-1 text-[15px] font-semibold leading-snug">{n.label}</p>
                    {n.due && n.daysLeft != null && (
                      <p className={`mt-0.5 text-[13px] font-semibold tabular-nums ${L.fg}`}>{n.dueLabel ? `${n.dueLabel} ` : ""}{longDate(n.due)} · {whenText(n.daysLeft, n.deadline)}</p>
                    )}
                    <p className="mt-1 text-[12px] leading-snug text-ink-2">{n.detail}</p>
                    {n.also.length > 0 && <p className="mt-1 text-[12px] leading-snug text-ink-2">Also open: {n.also.join("; ")}.</p>}
                    <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12px]">
                      <Link href={`/tenancy/${s.id}`} className="font-semibold text-ink underline underline-offset-2">Open</Link>
                      {events.length > 0 && <a href={`/api/tenancies/${s.id}/calendar`} className="font-semibold text-ink underline underline-offset-2">Add to calendar</a>}
                      {n.cite && <span className="ml-auto text-ink-3">{n.cite}</span>}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <section className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[20px] font-semibold tracking-[-0.01em]">Coming up</h2>
          <p className="text-[13px] text-ink-3">The next {UPCOMING_DAYS} days, across every unit</p>
        </div>
        {upcoming.length ? (
          <ol className="mt-3 divide-y divide-line rounded-2xl bg-surface px-5 shadow-sm">
            {upcoming.map((e) => (
              <li key={e.uid} className="grid grid-cols-[96px_minmax(0,1fr)] items-baseline gap-x-4 gap-y-0.5 py-3 sm:grid-cols-[108px_minmax(0,1fr)_auto]">
                <span className="text-[13px] font-semibold tabular-nums">{shortDate(e.date)}</span>
                <Link href={`/tenancy/${e.tenancyId}`} className="min-w-0 text-[14px] hover:underline">{e.summary}</Link>
                <span className="col-start-2 text-[12px] tabular-nums text-ink-3 sm:col-start-auto">{whenText(e.daysAway, false)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 rounded-2xl bg-surface px-5 py-4 text-[14px] text-ink-3 shadow-sm">
            Nothing dated in the next {UPCOMING_DAYS} days. Dates appear once a tenancy has a lease end, a notice or a move-out.
          </p>
        )}
      </section>

      <p className="mt-10 text-[12px] leading-relaxed text-ink-3">{DISCLAIMERS[0]}</p>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl bg-surface px-4 py-3 shadow-sm">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">{label}</dt>
      <dd className={`mt-0.5 text-[20px] font-semibold tabular-nums tracking-[-0.01em] ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">{label}</dt>
      <dd className="mt-0.5 leading-snug text-ink">{children}</dd>
    </div>
  );
}
