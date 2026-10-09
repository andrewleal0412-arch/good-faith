"use client";

import { useRouter } from "next/navigation";
import { lazy, Suspense, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/button";
import { useConfirm } from "@/components/confirm";
import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { Bone } from "@/components/skeletons";
import { Card, CardHead, Notice } from "@/components/ui";
import type { EditLimits } from "@/lib/deduction-edit";
import { settle, usd } from "@/lib/deductions";
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
// deposit has gone back. While the next step is to take every deduction off (New York after day 14), a line over the
// grid says so and removes them all after one question; the route allows it only then.
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
  // Refunds made in PayPal that the landlord recorded as this deposit's refund, and the deductions they cover past the
  // refund owed. When they cover what is owed they are `returned` (kind outside_refund) and read as the refund.
  outside?: { amount: number; notKept: number } | null;
  edit: { allowed: boolean; reason: string | null; limits: Record<string, EditLimits> };
  // The next step when it asks for every deduction to come off, in the state pack's words (the step's removeDeductions,
  // next-step.ts): the card then offers to remove them all at once.
  removeAll?: { title: string; detail: string; cite: string | null } | null;
}) {
  const router = useRouter();
  const [confirm, confirmDialog] = useConfirm();
  const [removing, setRemoving] = useState(false);
  const [message, setMessage] = useState<{ tone: "red" | "gray"; text: string } | null>(null);
  const pack = packFor(p.state);
  const s = settle(p.depositHeld ?? 0, p.deductions, pack);
  const tip = pack.documents.settlementTip(s.documentsRequired);
  const locked = !!p.returned;
  // The close-out's own refund or Payout (a dispute's refund that covers what is owed stands in for it as `returned`).
  const own = p.returned && p.returned.kind !== "dispute_refund" ? p.returned : null;
  const via = p.viaDispute ?? null;
  // A line of its own unless the refund made in PayPal is the refund itself.
  const outside = p.outside && p.returned?.kind !== "outside_refund" ? p.outside : null;
  const prior = (via?.amount ?? 0) + (outside?.amount ?? 0);
  const cents = (n: number) => Math.round(n * 100) / 100;

  // The lines under the grid, from the amounts as they stand while the inputs are edited (the grid passes them in).
  const totals = (live: { total: number; refund: number; balanceClaimed: number }): TotalLine[] => {
    const stillOwed = own ? cents((p.depositHeld ?? 0) - own.amount - prior) : 0;
    const claim = live.balanceClaimed > 0 && !p.forfeited;
    return [
      { key: "held", label: "Deposit held", amount: p.depositHeld },
      { key: "deductions", label: "Deductions", amount: live.total, sign: live.total ? "minus" : undefined },
      ...(p.forfeited ? [{ key: "forfeited", label: p.forfeited.label, amount: live.total, sign: "plus" as const, tip: { title: p.forfeited.label, text: p.forfeited.note } }] : []),
      // PayPal's refund through the tenants' PayPal dispute: past the refund owed, the deductions it covered aren't kept.
      ...(via && via.notKept > 0 ? [{ key: "not-kept", label: "Not kept, after the PayPal dispute", amount: via.notKept, sign: "plus" as const }] : []),
      ...(p.outside && p.outside.notKept > 0 ? [{ key: "not-kept-outside", label: "Not kept, after the refund in PayPal", amount: p.outside.notKept, sign: "plus" as const }] : []),
      ...(via ? [{ key: "via", label: "Through the PayPal dispute", amount: via.amount, sign: "minus" as const }] : []),
      ...(outside ? [{ key: "outside", label: "Refunded in PayPal", amount: outside.amount, sign: "minus" as const }] : []),
      {
        key: "final", strong: true,
        label: claim ? "Balance claimed" : own ? "Refunded" : p.forfeited ? "Owed back" : prior ? "Left to refund" : "Refund due",
        amount: claim ? live.balanceClaimed : own ? own.amount : Math.max(0, cents((p.forfeited ? p.depositHeld ?? 0 : live.refund) - prior)),
        ...(claim ? { tip: { title: "Balance claimed", text: "The statement lists this as a claim, not a demand for payment. The agent never collects it on its own." } } : {}),
      },
      ...(p.forfeited && own && stillOwed > 0.005 ? [{ key: "still", label: "Still owed", amount: stillOwed }] : []),
    ];
  };

  const count = p.deductions.length;
  // Offered exactly where a row's own Remove is: not once the deposit went back, under a dispute or on a template.
  const offer = !locked && p.edit.allowed && count > 0 ? p.removeAll ?? null : null;
  const one = count === 1;
  // One question, as a row's own Remove asks, then every line goes; the page then reads again, and the step moves on.
  const removeEvery = async () => {
    if (!(await confirm({
      title: one ? "Remove this deduction?" : `Remove all ${count} deductions?`,
      body: `${usd(s.total)}${one ? "" : " in all"}. ${one ? "Its receipt goes" : "Their receipts go"} too; the after-repair photos stay on file.`,
      action: one ? "Remove" : "Remove all",
    }))) return;
    setRemoving(true);
    setMessage(null);
    const r = await fetch(`/api/tenancies/${p.tenancyId}/deductions`, { method: "DELETE" }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) as { error?: string; removed?: number } : {};
    setRemoving(false);
    if (!r?.ok) setMessage({ tone: "red", text: j.error ?? `Couldn't remove ${one ? "it" : "them"}. Check the connection and try again.` });
    else setMessage({ tone: "gray", text: `Removed ${j.removed === 1 ? "the deduction" : `${j.removed ?? count} deductions`}. The refund is next.` });
    router.refresh();
  };
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
      {offer && (
        // The words take the line; on a phone the button drops under them, as the Refund card's does.
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3 border-b border-line-2 px-5 py-4">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-red-bg text-red"><Icon name="alert" className="size-3.5" /></span>
          <div className="min-w-0 flex-[1_1_14rem]">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              {offer.title}
              <InfoTip title={offer.title} cite={offer.cite ?? undefined}>{offer.detail}</InfoTip>
            </p>
            <p className="text-xs text-ink-3">{one ? "This deduction can't be kept." : "None of these deductions can be kept."}</p>
          </div>
          <Button onClick={removeEvery} disabled={removing} className="ml-auto max-sm:w-full">{removing ? "Removing..." : one ? "Remove deduction" : "Remove all deductions"}</Button>
        </div>
      )}
      <div aria-live="polite" className="empty:hidden">
        {message && <Notice tone={message.tone} className="mx-5 my-3">{message.text}</Notice>}
      </div>
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
      {confirmDialog}
    </Card>
  );
}
