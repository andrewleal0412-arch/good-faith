"use client";

import { lazy, Suspense, useSyncExternalStore } from "react";
import { InfoTip } from "@/components/info-tip";
import { Bone } from "@/components/skeletons";
import { Card, CardHead } from "@/components/ui";
import type { EditLimits } from "@/lib/deduction-edit";
import { settle } from "@/lib/deductions";
import { packFor } from "@/lib/states";
import type { GridDeduction, TotalLine } from "./deductions-grid";

// AG Grid is most of a property page's JavaScript, and only this card uses it: it loads with the card (the Move-out
// tab), not with the page, and the card holds the grid's height in gray rows until it is in. AG Grid draws its rows
// in the browser only, so the server's HTML and the browser's first render show the gray rows as well.
const DeductionsGrid = lazy(() => import("./deductions-grid").then((m) => ({ default: m.DeductionsGrid })));
const noSubscribe = () => () => {};

/** The grid's place while its code loads: its header, a line per room and a row per charge, at the grid's own heights. */
function GridBones({ rooms, rows, totals }: { rooms: number; rows: number; totals: TotalLine[] }) {
  return (
    <div data-skeleton="" aria-busy="true">
      <span role="status" className="sr-only">Loading the deductions</span>
      <div className="flex h-10 items-center gap-6 border-b border-line px-5"><Bone w={90} h={10} /><Bone w={64} h={10} className="ml-auto" /></div>
      {Array.from({ length: rooms + rows }, (_, i) => (
        <div key={i} className={`flex items-center gap-3 border-b border-line-2 px-5 ${i < rooms ? "h-9 bg-surface" : "h-14"}`}>
          <Bone w={i < rooms ? 120 : `${54 - (i % 3) * 8}%`} h={i < rooms ? 10 : 13} />
          {i >= rooms && <Bone w={72} h={13} className="ml-auto" />}
        </div>
      ))}
      {totals.map((t) => (
        <div key={t.key} className={`flex items-center px-5 ${t.strong ? "h-12" : "h-[34px]"}`}><Bone w={110} h={11} /><Bone w={72} h={13} className="ml-auto" /></div>
      ))}
    </div>
  );
}

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
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  const bones = (
    <GridBones rooms={new Set([...p.deductions.map((d) => d.room ?? ""), ...p.wear.map((w) => w.room)]).size} rows={count + p.wear.length}
      totals={totals(settle(p.depositHeld ?? 0, p.deductions, pack))} />
  );
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
      {inBrowser ? (
      <Suspense fallback={bones}>
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
      </Suspense>
      ) : bones}
    </Card>
  );
}
