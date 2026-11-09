"use client";

import Link from "@/components/link";
import { useState } from "react";
import { Button } from "@/components/button";
import { useConfirm } from "@/components/confirm";
import { FormField } from "@/components/field";
import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { NegotiationThread, Position } from "@/components/negotiation-thread";
import { useRefresh } from "@/components/refresh";
import { Card, CardHead, LineMark, Money, Notice, StatusChip, inputClass, textareaClass } from "@/components/ui";
import { useWatch } from "@/components/watch";
import { DEMO_EXAMPLE } from "@/lib/copy";
import { dateIn, PACIFIC, shortDate } from "@/lib/dates";
import type { LoadedNegotiation } from "@/lib/negotiation";

// The landlord's side of the negotiation, on the property's Move-out tab under the tenants' dispute: the policy the
// negotiator works under, the button that lets it answer, every turn as both agents make it, and then either the
// settlement (waiting on the tenants, then "Approve and pay") or, without agreement, both final positions, the state's
// process and the landlord's own offer. Every amount here was computed and checked on the server.

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function Negotiation({ tenancyId, v, tenantsLabel, landlordLabel, quiet, zone = PACIFIC }: {
  tenancyId: string; v: LoadedNegotiation; tenantsLabel: string; landlordLabel: string; quiet: boolean;
  zone?: string; // the property's time zone (its state pack's), which the dates are shown in
}) {
  const dayOf = (ts: string) => dateIn(ts, zone); // the day where the property is
  const refresh = useRefresh();
  const [autoConcede, setAutoConcede] = useState(v.policy?.autoConcede ?? true);
  const [limit, setLimit] = useState(v.policy?.limit != null ? String(v.policy.limit) : "");
  const [busy, setBusy] = useState<null | "run" | "pay" | "offer">(null);
  const [polling, setPolling] = useState(v.running);
  const [error, setError] = useState("");
  const [offerOpen, setOfferOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [confirm, dialog] = useConfirm();

  const s = v.settlement;
  const settled = v.status === "settled" || s?.status === "sent";
  // A page that arrives with the dispute already settled keeps the thread folded to one line (its turns and exchanges,
  // the first ask and the figure agreed) behind Show the thread, so the photo comparison and the deductions under this
  // card are not a thread's length down the settled tab; a page that watched it settle keeps the thread open, since
  // that is what it was reading. Read once, when the card mounts.
  const [threadOpen, setThreadOpen] = useState(!settled);
  const foldable = settled && v.turns.length > 1;
  const threadExchanges = Math.ceil((v.turns.length - 1) / 2);

  // While the agents negotiate (started here, in another tab, or before a reload), and for as long as the tenants may
  // still move it (accept the settlement, answer an offer, withdraw: any sent dispute that isn't settled or withdrawn),
  // the card asks the server every few seconds and refreshes the page when a turn landed, the run ended or the tenants
  // did something (components/watch.ts). So "Approve and pay" comes on by itself when they accept.
  useWatch({
    on: polling || (!settled && v.status !== "withdrawn"),
    url: `/api/tenancies/${tenancyId}/dispute`,
    stamp: v.stamp,
    running: polling || v.running,
    // The run this card was following is over (and its own request for it, if it made one, has answered).
    also: (j) => {
      if (!polling || j.negotiationStatus === "running" || busy === "run") return false;
      setPolling(false);
      return true;
    },
  });
  const negotiable = ["open", "negotiating", "no_agreement"].includes(v.status);
  const canRun = negotiable && v.agentTurnsLeft > 0 && !v.running && !polling;
  // No offer while a payment is on its way or PayPal hasn't confirmed one: the settlement holds until PayPal answers.
  const canOffer = ["open", "negotiating", "no_agreement", "agreed"].includes(v.status) && !v.running && !polling && s?.status !== "sending" && !s?.unconfirmed && !settled;
  const exchangesUsed = Math.ceil((6 - v.agentTurnsLeft) / 2);
  const names = { landlord: landlordLabel, tenants: tenantsLabel };
  const ownBack = v.landlordBack ?? v.minBack;
  // Once both sides are at the same figure, an offer withdraws from the agreement: anywhere in the lawful range.
  const withdraw = v.landlordBack != null && Math.abs(v.landlordBack - v.tenantBack) < 0.005;
  const lo = withdraw ? v.minBack : Math.min(ownBack, v.tenantBack), hi = withdraw ? v.maxBack : Math.max(ownBack, v.tenantBack);
  // A lawful range of one figure (New York after day 14: every charge $0) leaves no other offer once both are at it.
  const noOtherOffer = withdraw && v.maxBack - v.minBack < 0.005;

  async function run() {
    setError("");
    const n = limit.trim() === "" ? null : Number(limit.replace(/[$,\s]/g, ""));
    if (n != null && (!Number.isFinite(n) || n < 0)) return setError("Enter the limit as an amount, or leave it empty for none.");
    setBusy("run");
    setPolling(true);
    const r = await fetch(`/api/tenancies/${tenancyId}/dispute/negotiate`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ policy: { autoConcede, limit: n } }),
    }).catch(() => null);
    // The connection dropped mid-run: the run goes on on the server, and the polling shows it.
    if (!r) return setBusy(null);
    const j = await r.json().catch(() => ({}));
    if (!r.ok && !j.running) setError(j.error ?? "The agents couldn't negotiate. Try again.");
    // The run is over (it answered), so nothing is left to wait for: the typing row goes with this refresh.
    refresh(() => { setBusy(null); if (r.ok || !j.running) setPolling(false); });
  }

  async function pay() {
    if (!s) return;
    const ok = await confirm(s.unconfirmed ? {
      title: "Check this payment with PayPal?",
      body: `The same request goes to PayPal again, with the same key. If the first one went, PayPal answers with that payment and nothing more is sent; if it didn't, PayPal sends ${usd(s.amount)} now, once.`,
      action: "Check with PayPal",
    } : s.wholeBack ? {
      title: "Approve the settlement?",
      body: `The statement's refund was already the whole deposit, so no money moves: the amended statement records the settlement ${s.tenantName ?? "the tenants"} accepted.`,
      action: "Approve",
    } : {
      title: `Send ${usd(s.amount)} to ${tenantsLabel}?`,
      body: `The settlement ${s.tenantName ?? "the tenants"} accepted goes back through PayPal, on top of the statement's refund: a partial refund of their original deposit payment, or a Payout where that can't be refunded. This can't be undone.`,
      action: "Approve and pay",
    });
    if (!ok) return;
    setError("");
    setBusy("pay");
    const r = await fetch(`/api/tenancies/${tenancyId}/dispute/settle`, { method: "POST" }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) setError(j.error ?? "Couldn't send that. Try again.");
    refresh(() => setBusy(null));
  }

  async function offer(accept: boolean) {
    setError("");
    const n = accept ? null : Number(amount.replace(/[$,\s]/g, ""));
    if (!accept && (amount.trim() === "" || !Number.isFinite(n))) return setError("Enter how much goes back.");
    if (accept) {
      const ok = await confirm({
        title: `Accept their ask of ${usd(v.tenantBack)}?`,
        body: `That is the settlement, once ${tenantsLabel} accept it. Nothing moves until you approve and pay.`,
        action: "Accept their ask",
      });
      if (!ok) return;
    }
    setBusy("offer");
    const r = await fetch(`/api/tenancies/${tenancyId}/dispute/offer`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: n, accept, message: message.trim() || null }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) { setBusy(null); return setError(j.error ?? "Couldn't send that offer."); }
    refresh(() => { setBusy(null); setOfferOpen(false); setAmount(""); setMessage(""); });
  }

  const chip = settled ? <StatusChip live tone="green">Settled</StatusChip>
    : v.status === "withdrawn" ? <StatusChip live tone="gray">Withdrawn</StatusChip>
    : v.status === "agreed" ? <StatusChip live tone="amber">{s?.tenantAcceptedAt ? "Waiting for you" : "Agreed"}</StatusChip>
      : v.status === "no_agreement" ? <StatusChip live tone="red">No agreement</StatusChip>
        : v.running || polling ? <StatusChip live tone="amber">Negotiating</StatusChip>
          : v.turns.length > 1 ? <StatusChip live tone="amber">Negotiating</StatusChip> : <StatusChip live tone="amber">Waiting for you</StatusChip>;
  // While the run really goes on (the server says so, or this page's request for it is still open), the side whose
  // agent writes the next turn: the other side from the last turn's. Not while polling only waits to hear it ended.
  const working = v.running || busy === "run" ? (v.turns[v.turns.length - 1]?.side === "landlord" ? "tenant" : "landlord") : null;

  return (
    <Card id="negotiation" className="scroll-mt-8">
      <CardHead title="Negotiation" meta={v.turns.length > 1 ? <span className="max-sm:hidden">{exchangesUsed} of 3 exchanges</span> : undefined}
        right={<>{chip}
          <InfoTip align="end" title="Two agents, inside the law">
            Your negotiator, a Claude agent working for you, answers the tenants&apos; advocate charge by charge with your records. The app holds every figure to the charge&apos;s lawful range and to your limit, allows three exchanges at most, and stops early when the two agree or neither moves. Nothing takes effect until the tenants accept and you approve. Not legal advice.
          </InfoTip></>} />

      {/* The settlement, once the two sides agreed. */}
      {s && (
        <div className="border-b border-line-2 px-5 py-4">
          {settled ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-green-bg text-green"><Icon name="check" className="size-3.5" /></span>
              <div className="min-w-0 flex-[1_1_14rem]">
                <p className="text-sm font-medium">{s.wholeBack ? "Settled" : <>Settled: <Money value={s.amount} /> back</>}{s.sentAt ? ` ${shortDate(dayOf(s.sentAt))}` : ""}</p>
                {s.example ? (
                  <p className="flex items-center gap-1.5 text-xs text-ink-3">
                    {DEMO_EXAMPLE.short}
                    <InfoTip title="A recorded example">{DEMO_EXAMPLE.text}</InfoTip>
                  </p>
                ) : (
                  <p className="break-all text-xs text-ink-3">
                    {s.paypalId ? `PayPal ${s.rail === "payout" ? "payout" : "refund"} ${s.paypalId}` : s.wholeBack ? "No money moved: the whole deposit had already gone back" : "No money moved: the deposit was used in full"}
                  </p>
                )}
              </div>
              <Link href={`/tenancy/${tenancyId}/statement`} className="ml-auto text-sm font-medium text-brand hover:underline">Amended statement</Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                <Position label="Agreed back" value={s.amount} sub={s.wholeBack ? "Already back with the whole deposit" : v.wholeOwed ? "Part of the whole deposit owed back" : "On top of the statement's refund"} />
                <div className="min-w-0">
                  <p className="text-xs text-ink-3">{tenantsLabel}</p>
                  <p className="mt-0.5 text-lg font-medium">{s.tenantAcceptedAt ? "Accepted" : "Not yet"}</p>
                  <p className="mt-0.5 text-xs text-ink-3">{s.tenantAcceptedAt ? `${s.tenantName ?? "The tenants"}, ${shortDate(dayOf(s.tenantAcceptedAt))}` : "Their page asks them to accept"}</p>
                </div>
                <div className="min-w-0 max-sm:col-span-2">
                  <p className="text-xs text-ink-3">You</p>
                  <p className="mt-0.5 text-lg font-medium">
                    {s.unconfirmed ? "Approved, unconfirmed" : s.status === "sending" ? "Sending" : s.status === "failed" && s.landlordApprovedAt ? "Approved, not sent" : "Not yet"}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-3">
                    {s.unconfirmed ? "PayPal didn't confirm the payment"
                      : s.status === "failed" ? "PayPal refused it; nothing was sent"
                        : s.tenantAcceptedAt ? (v.wholeOwed ? "Send the refund, then approve" : "Approve and pay below") : "Approve once they accept"}
                  </p>
                </div>
              </div>
              {s.error && !s.unconfirmed && <Notice tone={s.retry ? "red" : "amber"} className="mt-3">{s.error}</Notice>}
              {s.unconfirmed && (
                <Notice tone="amber" className="mt-3">
                  {s.recheck
                    ? "PayPal didn't confirm the last attempt, so it may have gone. Check with PayPal sends the same request again: PayPal answers with the first payment if it went, and sends it once if it didn't. Until then the settlement can't change."
                    : "PayPal didn't confirm the last attempt, so it may have gone. Check the PayPal sandbox before anything is sent again."}
                </Notice>
              )}
              {v.payBlock && !s.unconfirmed && <Notice tone="amber" className="mt-3">{v.payBlock}</Notice>}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {s.unconfirmed ? (
                  <Button variant={quiet ? "secondary" : "primary"} disabled={!s.recheck || !!busy} onClick={pay}>
                    <Icon name="search" />{busy === "pay" ? "Checking..." : "Check with PayPal"}
                  </Button>
                ) : (
                  <Button variant={quiet ? "secondary" : "primary"} disabled={!s.tenantAcceptedAt || !!busy || s.status === "sending" || !!v.payBlock || v.wholeOwed} onClick={pay}>
                    <Icon name="send" />{busy === "pay" ? "Sending..." : s.wholeBack || v.wholeOwed ? "Approve" : s.retry ? `Try again: pay ${usd(s.amount)}` : `Approve and pay ${usd(s.amount)}`}
                  </Button>
                )}
                {!s.tenantAcceptedAt && <span className="text-xs text-ink-3">Waiting for {tenantsLabel} to accept.</span>}
              </div>
            </>
          )}
        </div>
      )}

      {/* Where the agents stopped, when they didn't agree. */}
      {!s && v.status === "no_agreement" && (
        <div className="border-b border-line-2 px-5 py-4">
          <div className="grid grid-cols-2 gap-x-4">
            <Position label="Your last offer" value={v.landlordBack ?? v.minBack} sub="Back to the tenants" />
            <Position label="Their last ask" value={v.tenantBack} />
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-sm text-ink-2">
            No agreement. Either side may still make an offer.
            <InfoTip align="end" title={v.forum.name} cite={v.forum.cite}>{v.forum.text} Not legal advice. This is the state&apos;s process as the law describes it, not a judgment of your case.</InfoTip>
          </p>
        </div>
      )}
      {v.status === "withdrawn" && (
        <p className="border-b border-line-2 px-5 py-4 text-sm text-ink-2">
          {v.openedBy ?? tenantsLabel} withdrew this dispute. The statement stands as you sent it, and its deductions can change again. The tenants may dispute it again from their link.
        </p>
      )}
      {!s && v.outcome?.reason === "limit" && v.status !== "no_agreement" && v.status !== "withdrawn" && v.outcome.wanted != null && (
        <div className="border-b border-line-2 px-5 py-4">
          <Notice tone="amber">
            Your negotiator would give back {usd(v.outcome.wanted)}, more than your {usd(v.outcome.limit ?? 0)} limit. Raise the limit to let it go on, or make an offer yourself.
          </Notice>
        </div>
      )}
      {v.failed && !v.running && !polling && (
        <div className="border-b border-line-2 px-5 py-4"><Notice>The last run stopped: {v.failed}</Notice></div>
      )}

      {/* The policy and the run. */}
      {canRun && (
        <div className="border-b border-line-2 px-5 py-4">
          <p className="text-sm font-medium">{v.turns.length > 1 ? "Let your negotiator go on" : "Let your negotiator answer"}</p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex flex-1 cursor-pointer items-start gap-2.5 text-sm">
              <LineMark><input type="checkbox" className="size-4 accent-brand" checked={autoConcede} onChange={(e) => setAutoConcede(e.target.checked)} /></LineMark>
              <span>
                <span className="block">Concede what the law and your records don&apos;t support</span>
                <span className="block text-xs text-ink-3">{v.minBack > 0 ? `${usd(v.minBack)} on this statement, even above your limit` : "Nothing on this statement as it stands"}</span>
              </span>
            </label>
            <div className="w-full sm:w-[220px]">
              <FormField label="Ask me before giving back more than" labelClass="mb-1 block text-xs text-ink-3">
                <input className={inputClass} inputMode="decimal" placeholder="No limit" value={limit} onChange={(e) => setLimit(e.target.value)} />
              </FormField>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button variant={quiet ? "secondary" : "primary"} disabled={!!busy} onClick={run}>
              {v.turns.length > 1 ? "Continue negotiating" : "Let my negotiator answer"}
            </Button>
            <span className="text-xs text-ink-3">{v.agentTurnsLeft === 6 ? "Up to 3 exchanges with their advocate" : `${Math.floor(v.agentTurnsLeft / 2)} exchange${Math.floor(v.agentTurnsLeft / 2) === 1 ? "" : "s"} left`}, each turn a live Claude call that lands below the moment it is done</span>
          </div>
        </div>
      )}

      {/* Not beside a settled dispute: nothing is left to do here, so a refusal from before it settled (a second
          "Approve and pay" that found the first one already paid, after a dropped connection) no longer applies. */}
      {error && !settled && <div className="border-b border-line-2 px-5 py-3"><Notice>{error}</Notice></div>}

      {/* Settled: one line over the thread (its turns and exchanges, counted from the thread itself, since a human
          turn is an exchange too; the first ask and the figure agreed) with the one toggle that folds and opens it. */}
      {foldable && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-2 px-5 py-3.5">
          <p className="min-w-0 flex-1 text-sm text-ink-2" data-thread-folded={threadOpen ? undefined : v.turns.length}>
            {v.turns.length} turns in {threadExchanges} exchange{threadExchanges === 1 ? "" : "s"}: from {usd(v.turns[0].amountBack)} asked back to {usd(s?.amount ?? v.tenantBack)} agreed.
          </p>
          <button type="button" aria-expanded={threadOpen} aria-controls="negotiation-thread" className="text-sm font-medium text-brand hover:underline" onClick={() => setThreadOpen((o) => !o)}>
            {threadOpen ? "Hide the thread" : "Show the thread"}
          </button>
        </div>
      )}
      {(!foldable || threadOpen) && (
        <div id="negotiation-thread" className="px-5 py-1">
          <NegotiationThread turns={v.turns} perspective="landlord" names={names} working={working} />
        </div>
      )}

      {canOffer && !noOtherOffer && (
        <div className="border-t border-line-2 px-5 py-3.5">
          {!offerOpen ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <button type="button" className="text-sm font-medium text-brand hover:underline" onClick={() => setOfferOpen(true)}>{withdraw ? "Make a different offer" : "Make an offer yourself"}</button>
              {v.tenantBack > ownBack + 0.005 && (
                <button type="button" disabled={!!busy} className="text-sm font-medium text-brand hover:underline" onClick={() => offer(true)}>
                  Accept their ask of {usd(v.tenantBack)}
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <FormField label="Back to the tenants" note={withdraw
                ? `Both sides are at ${usd(ownBack)}. An offer between ${usd(lo)} and ${usd(hi)} withdraws that agreement${s?.tenantAcceptedAt ? `, which ${s.tenantName ?? tenantsLabel} accepted` : ""}.`
                : `Between ${usd(lo)} and ${usd(hi)}, ${v.wholeOwed ? "already part of the whole deposit owed back" : "on top of the statement's refund"}.`}>
                <input className={`${inputClass} sm:max-w-[220px]`} inputMode="decimal" placeholder={withdraw ? "Amount" : usd(Math.round(((lo + hi) / 2) * 100) / 100)} value={amount} onChange={(e) => setAmount(e.target.value)} />
              </FormField>
              <FormField label={`Message to ${tenantsLabel}`} note="Optional.">
                <textarea className={textareaClass} rows={2} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
              </FormField>
              <div className="flex flex-wrap gap-2">
                <Button disabled={!!busy} onClick={() => offer(false)}>{busy === "offer" ? "Sending..." : "Send offer"}</Button>
                <Button variant="link" disabled={!!busy} onClick={() => { setOfferOpen(false); setError(""); }}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}
      {dialog}
    </Card>
  );
}
