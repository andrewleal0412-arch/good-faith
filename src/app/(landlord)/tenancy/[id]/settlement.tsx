"use client";

import { InfoTip } from "@/components/info-tip";
import { Card, CardHead } from "@/components/ui";
import type { EditLimits } from "@/lib/deduction-edit";
import { settle } from "@/lib/deductions";
import { packFor } from "@/lib/states";
import { DeductionsGrid, type GridDeduction, type TotalLine } from "./deductions-grid";

/** A wear-and-tear finding, listed at $0.00 so the tenant sees what was looked at and not charged. */
export type WearRow = { id: string; n: number; item: string; full: string; room: string; photos: number };

// Deductions: the card on the Move-out tab, an AG Grid of every charge grouped by room (deductions-grid.tsx) with its
// inputs editable in place, then Deposit held, Deductions and Refund due pinned under it and worked out live. Wear and
// tear is listed at $0.00 and is never charged. Each row's menu removes it, or edits its inputs in a drawer, until the
// deposit has gone back.
export function Settlement(p: {
  tenancyId: string;
  state: string; // the state whose documentation rule applies
  depositHeld: number | null;
  deductions: GridDeduction[];
  numbers: Record<string, number>; // finding id to its number on the page
  wear: WearRow[];
  returned: { amount: number; kind: string; id: string; at: string } | null;
  forfeited?: { label: string; note: string } | null; // New York after day 14: the deductions come back off, the whole deposit is owed
  // What PayPal returned through the tenants' PayPal dispute, and the deductions it covered past the refund owed.
  viaDispute?: { amount: number; notKept: number } | null;
  edit: { allowed: boolean; reason: string | null; limits: Record<string, EditLimits> };
}) {
  const pack = packFor(p.state);
  const s = settle(p.depositHeld ?? 0, p.deductions, pack);
  const tip = pack.documents.settlementTip(s.documentsRequired);
  const locked = !!p.returned;
  // The close-out's own refund or Payout (a dispute's refund that covers what is owed stands in for it as `returned`).
  const own = p.returned && p.returned.kind !== "dispute_refund" ? p.returned : null;
  const via = p.viaDispute ?? null;
  const cents = (n: number) => Math.round(n * 100) / 100;

  // The lines under the grid, from the amounts as they stand while the inputs are edited (the grid passes them in).
  const totals = (live: { total: number; refund: number; balanceClaimed: number }): TotalLine[] => {
    const stillOwed = own ? cents((p.depositHeld ?? 0) - own.amount - (via?.amount ?? 0)) : 0;
    const claim = live.balanceClaimed > 0 && !p.forfeited;
    return [
      { key: "held", label: "Deposit held", amount: p.depositHeld },
      { key: "deductions", label: "Deductions", amount: live.total, sign: live.total ? "minus" : undefined },
      ...(p.forfeited ? [{ key: "forfeited", label: p.forfeited.label, amount: live.total, sign: "plus" as const, tip: { title: p.forfeited.label, text: p.forfeited.note } }] : []),
      // PayPal's refund through the tenants' PayPal dispute: past the refund owed, the deductions it covered aren't kept.
      ...(via && via.notKept > 0 ? [{ key: "not-kept", label: "Not kept, after the PayPal dispute", amount: via.notKept, sign: "plus" as const }] : []),
      ...(via ? [{ key: "via", label: "Through the PayPal dispute", amount: via.amount, sign: "minus" as const }] : []),
      {
        key: "final", strong: true,
        label: claim ? "Balance claimed" : own ? "Refunded" : p.forfeited ? "Owed back" : via ? "Left to refund" : "Refund due",
        amount: claim ? live.balanceClaimed : own ? own.amount : Math.max(0, cents((p.forfeited ? p.depositHeld ?? 0 : live.refund) - (via?.amount ?? 0))),
        ...(claim ? { tip: { title: "Balance claimed", text: "The statement lists this as a claim, not a demand for payment. The agent never collects it on its own." } } : {}),
      },
      ...(p.forfeited && own && stillOwed > 0.005 ? [{ key: "still", label: "Still owed", amount: stillOwed }] : []),
    ];
  };

  const count = p.deductions.length;
  return (
    <Card>
      <CardHead title="Deductions" meta={count ? `${count} item${count === 1 ? "" : "s"}` : undefined}
        right={
          // One tip for the table: what may be deducted, and what has to go with it (the receipt rule).
          <InfoTip align="end" title="What may be deducted" cite={tip.cite}>
            {tip.text}
            <span className="mt-1.5 block">{tip.docs}</span>
            {!locked && p.edit.allowed && <span className="mt-1.5 block">Change an invoice, hours, rate, age or useful life in its cell; the amount is worked out again, held to the lawful range.</span>}
          </InfoTip>
        } />
      <DeductionsGrid
        tenancyId={p.tenancyId}
        pack={pack}
        deductions={p.deductions}
        numbers={p.numbers}
        wear={p.wear}
        depositHeld={p.depositHeld}
        allowed={!locked && p.edit.allowed}
        reason={p.edit.reason}
        locked={locked}
        limits={p.edit.limits}
        totals={totals}
      />
    </Card>
  );
}
