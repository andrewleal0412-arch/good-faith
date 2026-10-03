import type { Metadata } from "next";
import { InfoTip, TipLabel } from "@/components/info-tip";
import { Card, PageHead } from "@/components/ui";
import { LeaseCheck } from "./lease-check";

export const metadata: Metadata = { title: "Check a lease" };

// Check a lease: the way every property comes in. Upload the lease, Claude reads the deposit terms, the rules engine
// flags what breaks Civil Code 1950.5, and the tenancy starts from it. The law behind the four steps is in the info
// tips; citations are the ones in docs/LEGAL_RULES.md (rules D9, D13, D14, D15, D16, D24).

const LAW = [
  {
    label: "Move-in photos",
    line: "Required since Jul 1, 2025",
    fact: "Required for tenancies that began on or after July 1, 2025, and before and after every repair or cleaning that is deducted.",
    cite: "Civ. Code 1950.5(g)(1)-(2), AB 2801",
  },
  {
    label: "Electronic refunds",
    line: "Since Jan 1, 2026, with written consent",
    fact: "Since January 1, 2026, a landlord who received the deposit or the rent electronically must refund the deposit electronically. PayPal counts only if the tenant agreed to it in writing.",
    cite: "Civ. Code 1950.5(h)(1)(A), AB 414",
  },
  {
    label: "21-day deadline",
    line: "Statement and refund due",
    fact: "The itemized statement and the refund are due within 21 days after the tenant leaves. Bad-faith retention can cost up to twice the deposit.",
    cite: "Civ. Code 1950.5(h)(1), (m)",
  },
];

const STEPS = [
  {
    title: "Check the lease",
    text: "Claude pulls out the deposit terms and the app flags what breaks the statute, with the statute's own words beside each flag.",
    cite: "Civ. Code 1950.5(b), (c), (n)",
  },
  {
    title: "Collect the lawful deposit",
    text: "The tenants agree in writing to a PayPal refund, then pay a PayPal invoice for the lawful amount, never more than the cap.",
    cite: "Civ. Code 1950.5(c)(1), (c)(5), (h)(1)(A)",
  },
  {
    title: "Compare photos at move-out",
    text: "Claude compares move-in and move-out photos room by room and sorts wear and tear, which is never charged, from damage and cleaning. Code computes each deduction.",
    cite: "Civ. Code 1950.5(b)(2)-(3), (e)(2)(A), (g)",
  },
  {
    title: "Close out with your approval",
    text: "The agent confirms the deposit with PayPal, proposes the refund the rules allow and checks the itemized statement. You approve; it refunds through PayPal.",
    cite: "Civ. Code 1950.5(h)(1)-(2)",
  },
];

export default function LeasePage() {
  return (
    <div className="max-w-[880px]">
      <PageHead title="Check a lease" sub="Nothing is saved until you start the tenancy." />

      <ol className="mb-6 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex items-center gap-2.5 rounded-md border border-line px-3 py-2.5">
            <span className={`flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-medium ${i === 0 ? "bg-brand text-white" : "bg-surface-2 text-ink-3"}`}>{i + 1}</span>
            {/* The step's name opens its tip: seven info icons on an empty page read as chrome. */}
            <span className="min-w-0 flex-1 text-sm font-medium">
              <InfoTip trigger={<TipLabel>{s.title}</TipLabel>} align={i % 2 ? "end" : "start"} title={s.title} cite={s.cite}>{s.text}</InfoTip>
            </span>
          </li>
        ))}
      </ol>

      <LeaseCheck />

      <Card soft className="mt-6 grid divide-y divide-line-2 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {LAW.map((l, i) => (
          <div key={l.label} className="px-4 py-3">
            <div className="text-sm font-medium">
              <InfoTip trigger={<TipLabel>{l.label}</TipLabel>} align={i === 2 ? "end" : "start"} title={l.label} cite={l.cite}>{l.fact}</InfoTip>
            </div>
            <div className="mt-0.5 text-xs text-ink-3">{l.line}</div>
          </div>
        ))}
      </Card>
    </div>
  );
}
