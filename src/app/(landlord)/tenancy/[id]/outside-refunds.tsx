"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/button";
import { CopyId } from "@/components/copy-id";
import { InfoTip } from "@/components/info-tip";
import { PresenceList } from "@/components/motion";
import { Card, CardHead, Money, Notice } from "@/components/ui";
import { dateIn, PACIFIC, shortDate } from "@/lib/dates";

// A refund of the deposit payment that PayPal shows and Good Faith didn't send (src/lib/reconcile.ts): made in the
// PayPal dashboard, or a refund sent from here whose answer was lost. The landlord records it as this deposit's refund
// (it then counts wherever the app's own refunds count, and the close-out sends only what is still owed) or marks it
// not this deposit. One click each; the server decides once (decide_outside_refund) and nothing is recorded without it.

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type OutsideRefundView = { id: string; amount: number; at: string | null; status: "open" | "recorded" | "dismissed"; decidedAt: string | null };

const WHY = "PayPal shows this refund of the tenants' deposit payment, but it wasn't sent from Good Faith: it was made in PayPal, or a refund sent from here lost PayPal's answer. Record it if it returned part or all of this deposit: it then counts toward what goes back on the statement, the tenants' page and Payments, and the close-out sends only what is still owed. Mark it not this deposit if it was something else: it then counts nowhere here. Until you decide, the close-out and a settlement wait, so the same money can't go back twice.";

export function OutsideRefundsCard({ tenancyId, refunds, quiet, zone = PACIFIC }: { tenancyId: string; refunds: OutsideRefundView[]; quiet: boolean; zone?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const open = refunds.filter((r) => r.status === "open");
  const set = refunds.filter((r) => r.status === "dismissed");
  const dayOf = (ts: string) => shortDate(dateIn(ts, zone));

  async function decide(id: string, decision: "record" | "dismiss") {
    setError(""); setBusy(`${id}:${decision}`);
    const res = await fetch(`/api/tenancies/${tenancyId}/outside-refunds`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refundId: id, decision }),
    }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res?.ok) setError(j.error ?? "Couldn't save that. Try again.");
    router.refresh();
  }

  return (
    <Card id="outside-refunds" className="scroll-mt-24">
      <CardHead title={open.length > 1 ? "Refunds made in PayPal" : "Refund made in PayPal"} meta={open.length ? `${open.length} to review` : undefined}
        right={<InfoTip align="end" title="Not sent from here">{WHY}</InfoTip>} />
      <PresenceList>
        {open.map((r, i) => (
          <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line-2 px-5 py-4 last:border-b-0">
            <div className="min-w-0 flex-[1_1_14rem]">
              <p className="text-sm font-medium"><Money value={r.amount} /> refunded{r.at ? ` ${dayOf(r.at)}` : ""}, not from here</p>
              <div className="flex min-w-0 items-center gap-1 text-xs text-ink-3">
                <span className="shrink-0">PayPal refund</span>
                <CopyId text={r.id} label="Copy the PayPal refund ID" />
              </div>
            </div>
            <div className="flex items-center gap-2 max-sm:w-full">
              <Button size="sm" variant={quiet || i > 0 ? "secondary" : "primary"} disabled={!!busy} className="max-sm:flex-1"
                onClick={() => decide(r.id, "record")}>{busy === `${r.id}:record` ? "Recording..." : "Record as this deposit's refund"}</Button>
              <Button size="sm" disabled={!!busy} className="max-sm:flex-1" onClick={() => decide(r.id, "dismiss")}>{busy === `${r.id}:dismiss` ? "Saving..." : "Not this deposit"}</Button>
            </div>
          </div>
        ))}
        {set.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-2 px-5 py-3 last:border-b-0">
            <p className="min-w-0 flex-1 text-sm text-ink-2"><Money value={r.amount} /> refunded{r.at ? ` ${dayOf(r.at)}` : ""}, refund <span className="tabular-nums">{r.id}</span></p>
            <span className="text-xs text-ink-3" title={`Marked ${r.decidedAt ? dayOf(r.decidedAt) : ""}: it doesn't count toward this deposit's refund`}>Not this deposit{r.decidedAt ? `, ${dayOf(r.decidedAt)}` : ""}</span>
          </div>
        ))}
      </PresenceList>
      {error && <Notice className="mx-5 mb-4">{error}</Notice>}
    </Card>
  );
}

/** Above every tab but Payments while a refund made in PayPal waits for the landlord's decision. */
export function OutsideRefundsBanner({ href, count, amount }: { href: string; count: number; amount: number }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-line bg-amber-bg px-4 py-3 text-sm">
      <span className="font-medium text-amber">Refund made in PayPal</span>
      <span className="min-w-0 flex-1 text-ink">{count === 1 ? `PayPal shows a ${usd(amount)} refund of the deposit that wasn't sent from here.` : `PayPal shows ${count} refunds of the deposit, ${usd(amount)} in all, that weren't sent from here.`}</span>
      <a href={href} className="font-medium text-brand hover:underline">Review</a>
    </div>
  );
}
