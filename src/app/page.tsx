import Link from "next/link";
import { DISCLAIMERS } from "@/lib/copy";
import { LeaseCheck } from "./lease-check";

// The front door: what the product does in one line, the law that makes it necessary, the four steps, and the lease
// check that starts a tenancy. Citations are the ones in docs/LEGAL_RULES.md (rules D9, D13, D14, D15, D16, D24).

const LAW = [
  {
    label: "Photos are required",
    fact: "Move-in photos for tenancies that began on or after July 1, 2025, and photos before and after every repair or cleaning that is deducted.",
    cite: "Civ. Code 1950.5(g)(1)-(2), AB 2801",
  },
  {
    label: "Refunds go back electronically",
    fact: "Since January 1, 2026, a landlord who received the deposit or the rent electronically must refund the deposit electronically. PayPal counts only if the tenant agreed to it in writing.",
    cite: "Civ. Code 1950.5(h)(1)(A), AB 414",
  },
  {
    label: "The 21-day deadline",
    fact: "The itemized statement and the refund are due within 21 days after the tenant leaves. Bad-faith retention can cost up to twice the deposit.",
    cite: "Civ. Code 1950.5(h)(1), (m)",
  },
];

const STEPS = [
  {
    title: "Check the lease",
    text: "Upload the lease. Claude pulls out the deposit terms, and the app flags what breaks the statute, with the statute's own words beside each flag.",
    cite: "Civ. Code 1950.5(b), (c), (n)",
  },
  {
    title: "Collect the lawful deposit through PayPal",
    text: "The tenants agree in writing to a PayPal refund, then pay a PayPal invoice for the lawful amount, never more than the cap.",
    cite: "Civ. Code 1950.5(c)(1), (c)(5), (h)(1)(A)",
  },
  {
    title: "Compare photos at move-out",
    text: "Claude compares the move-in and move-out photos room by room and sorts ordinary wear and tear, which is never charged, from damage and cleaning. Code computes each deduction.",
    cite: "Civ. Code 1950.5(b)(2)-(3), (e)(2)(A), (g)",
  },
  {
    title: "Close out with the agent",
    text: "The agent confirms the deposit with PayPal, proposes the refund the rules allow, and checks the itemized statement against the 13-item checklist. You approve; it refunds through PayPal.",
    cite: "Civ. Code 1950.5(h)(1)-(2)",
  },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10 sm:py-16">
      <section className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-ink-3">For California landlords with one unit, or a few</p>
          <h1 className="mt-3 text-balance text-[38px] font-semibold leading-[1.02] tracking-[-0.025em] sm:text-[54px]">
            The security deposit, done by the book.
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-2">
            It checks the lease, collects the lawful deposit through PayPal, keeps the photos the law requires and returns
            the rest within 21 days with the itemized statement. You approve every dollar before it moves.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a href="#lease" className="rounded-xl bg-ink px-5 py-2.5 text-[14px] font-semibold text-white hover:opacity-90">Check a lease</a>
            <Link href="/units" className="rounded-xl border border-line bg-surface px-5 py-2.5 text-[14px] font-semibold text-ink hover:border-accent">Your units</Link>
          </div>
        </div>

        <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          {LAW.map((l) => (
            <div key={l.label} className="rounded-2xl bg-surface p-5 shadow-sm">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-accent">{l.label}</dt>
              <dd className="mt-1.5 text-[14px] leading-relaxed text-ink">{l.fact}</dd>
              <dd className="mt-2 text-[12px] text-ink-3">{l.cite}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-16">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[24px] font-semibold tracking-[-0.015em]">How it works</h2>
          <p className="text-[13px] text-ink-3">Four steps, all on one page per unit</p>
        </div>
        <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-2xl bg-surface p-5 shadow-sm">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[13px] font-semibold text-white">{i + 1}</span>
              <h3 className="mt-4 text-[17px] font-semibold leading-snug">{s.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{s.text}</p>
              <p className="mt-3 text-[12px] text-ink-3">{s.cite}</p>
            </li>
          ))}
        </ol>

        <div className="mt-4 grid gap-6 rounded-2xl bg-ink p-6 text-white sm:grid-cols-2">
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-white/60">Nothing moves without you</p>
            <p className="mt-2 text-[15px] leading-relaxed text-white/85">
              Code decides the amounts: the cap, the proration, the 21-day clock and the refund. The agent operates PayPal
              through PayPal&apos;s Agent Toolkit. The landlord approves every money movement, and a rules guard re-checks it
              against the records the moment it runs.
            </p>
          </div>
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-white/60">Tenants see their side</p>
            <p className="mt-2 text-[15px] leading-relaxed text-white/85">
              Tenants get a private page with the deposit they paid, the agreement they signed, the move-in photos, a form
              for their move-out date and forwarding address, and the itemized statement the day it is delivered.
            </p>
          </div>
        </div>
      </section>

      <section id="lease" className="mt-16 scroll-mt-6">
        <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-ink-3">Check a lease to add a unit</p>
        <h2 className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.02em]">Start with the lease.</h2>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-2">
          The agent reads the deposit terms and checks them against Civil Code 1950.5 as it stands in 2026. Nothing is
          saved until you start the tenancy.
        </p>
        <LeaseCheck />
      </section>

      <p className="mt-12 max-w-3xl text-[12px] leading-relaxed text-ink-3">{DISCLAIMERS[0]}</p>
    </main>
  );
}
