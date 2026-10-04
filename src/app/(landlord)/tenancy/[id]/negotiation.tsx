"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { useConfirm } from "@/components/confirm";
import { FormField } from "@/components/field";
import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { NegotiationThread, Position } from "@/components/negotiation-thread";
import { Card, CardHead, Money, Notice, StatusChip, inputClass, textareaClass } from "@/components/ui";
import { pacificDate, shortDate } from "@/lib/dates";
import type { LoadedNegotiation } from "@/lib/negotiation";

// The landlord's side of the negotiation, on the property's Move-out tab under the tenants' dispute: the policy the
// negotiator works under, the button that lets it answer, every turn as both agents make it, and then either the
// settlement (waiting on the tenants, then "Approve and pay") or, without agreement, both final positions, the state's
// process and the landlord's own offer. Every amount here was computed and checked on the server.

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const POLL_MS = 3000;
const POLL_LIMIT = 120;

export function Negotiation({ tenancyId, v, tenantsLabel, landlordLabel, quiet }: {
  tenancyId: string; v: LoadedNegotiation; tenantsLabel: string; landlordLabel: string; quiet: boolean;
}) {
  const router = useRouter();
  const [autoConcede, setAutoConcede] = useState(v.policy?.autoConcede ?? true);
  const [limit, setLimit] = useState(v.policy?.limit != null ? String(v.policy.limit) : "");
  const [busy, setBusy] = useState<null | "run" | "pay" | "offer">(null);
  const [polling, setPolling] = useState(v.running);
  const [error, setError] = useState("");
  const [offerOpen, setOfferOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [confirm, dialog] = useConfirm();
  const seen = useRef({ turns: v.turns.length, status: v.status });

  // While the agents negotiate (started here, in another tab, or before a reload), ask the server every few seconds and
  // refresh the page when a turn lands or the run ends.
  useEffect(() => {
    if (!polling) return;
    let n = 0;
    const t = setInterval(async () => {
      if (++n > POLL_LIMIT) { clearInterval(t); setPolling(false); return; }
      const r = await fetch(`/api/tenancies/${tenancyId}/dispute`, { cache: "no-store" }).catch(() => null);
      const j = r?.ok ? await r.json().catch(() => null) : null;
      if (!j) return;
      if (j.turns !== seen.current.turns || j.status !== seen.current.status) {
        seen.current = { turns: j.turns, status: j.status };
        router.refresh();
      }
      if (j.negotiationStatus !== "running" && busy !== "run") { clearInterval(t); setPolling(false); router.refresh(); }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [polling, tenancyId, router, busy]);

  const s = v.settlement;
  const settled = v.status === "settled" || s?.status === "sent";
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

  async function run() {
    setError("");
    const n = limit.trim() === "" ? null : Number(limit.replace(/[$,\s]/g, ""));
    if (n != null && (!Number.isFinite(n) || n < 0)) return setError("Enter the limit as an amount, or leave it empty for none.");
    setBusy("run");
    setPolling(true);
    const r = await fetch(`/api/tenancies/${tenancyId}/dispute/negotiate`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ policy: { autoConcede, limit: n } }),
    }).catch(() => null);
    setBusy(null);
    // The connection dropped mid-run: the run goes on on the server, and the polling shows it.
    if (!r) return;
    const j = await r.json().catch(() => ({}));
    if (!r.ok && !j.running) { setError(j.error ?? "The agents couldn't negotiate. Try again."); setPolling(false); }
    router.refresh();
  }

  async function pay() {
    if (!s) return;
    const ok = await confirm(s.unconfirmed ? {
      title: "Check this payment with PayPal?",
      body: `The same request goes to PayPal again, with the same key. If the first one went, PayPal answers with that payment and nothing more is sent; if it didn't, PayPal sends ${usd(s.amount)} now, once.`,
      action: "Check with PayPal",
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
    setBusy(null);
    if (!r?.ok) setError(j.error ?? "Couldn't send that. Try again.");
    router.refresh();
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
    setBusy(null);
    if (!r?.ok) return setError(j.error ?? "Couldn't send that offer.");
    setOfferOpen(false);
    setAmount("");
    setMessage("");
    router.refresh();
  }

  const chip = settled ? <StatusChip tone="green">Settled</StatusChip>
    : v.status === "agreed" ? <StatusChip tone="amber">{s?.tenantAcceptedAt ? "Waiting for you" : "Agreed"}</StatusChip>
      : v.status === "no_agreement" ? <StatusChip tone="red">No agreement</StatusChip>
        : v.running || polling ? <StatusChip tone="amber">Negotiating</StatusChip>
          : v.turns.length > 1 ? <StatusChip tone="amber">Negotiating</StatusChip> : <StatusChip tone="amber">Waiting on you</StatusChip>;

  return (
    <Card id="negotiation" className="scroll-mt-24">
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
                <p className="text-sm font-medium">Settled: <Money value={s.amount} /> back{s.sentAt ? ` ${shortDate(pacificDate(s.sentAt))}` : ""}</p>
                <p className="break-all text-xs text-ink-3">
                  {s.paypalId ? `PayPal ${s.rail === "payout" ? "payout" : "refund"} ${s.paypalId}` : "No money moved: the deposit was used in full"}
                </p>
              </div>
              <Link href={`/tenancy/${tenancyId}/statement`} className="ml-auto text-sm font-medium text-brand hover:underline">Amended statement</Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                <Position label="Agreed back" value={s.amount} sub="On top of the statement's refund" />
                <div className="min-w-0">
                  <p className="text-xs text-ink-3">{tenantsLabel}</p>
                  <p className="mt-0.5 text-lg font-medium">{s.tenantAcceptedAt ? "Accepted" : "Not yet"}</p>
                  <p className="mt-0.5 text-xs text-ink-3">{s.tenantAcceptedAt ? `${s.tenantName ?? "The tenants"}, ${shortDate(pacificDate(s.tenantAcceptedAt))}` : "Their page asks them to accept"}</p>
                </div>
                <div className="min-w-0 max-sm:col-span-2">
                  <p className="text-xs text-ink-3">You</p>
                  <p className="mt-0.5 text-lg font-medium">
                    {s.unconfirmed ? "Approved, unconfirmed" : s.status === "sending" ? "Sending" : s.status === "failed" && s.landlordApprovedAt ? "Approved, not sent" : "Not yet"}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-3">
                    {s.unconfirmed ? "PayPal didn't confirm the payment"
                      : s.status === "failed" ? "PayPal refused it; nothing was sent"
                        : s.tenantAcceptedAt ? "Approve and pay below" : "Approve once they accept"}
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
                  <Button variant={quiet ? "secondary" : "primary"} disabled={!s.tenantAcceptedAt || !!busy || s.status === "sending" || !!v.payBlock} onClick={pay}>
                    <Icon name="send" />{busy === "pay" ? "Sending..." : s.retry ? `Try again: pay ${usd(s.amount)}` : `Approve and pay ${usd(s.amount)}`}
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
            <InfoTip align="end" title={v.forum.name} cite={v.forum.cite}>{v.forum.text}</InfoTip>
          </p>
        </div>
      )}
      {!s && v.outcome?.reason === "limit" && v.status !== "no_agreement" && v.outcome.wanted != null && (
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
              <input type="checkbox" className="mt-[3px] size-4 shrink-0 accent-brand" checked={autoConcede} onChange={(e) => setAutoConcede(e.target.checked)} />
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
            <span className="text-xs text-ink-3">{v.agentTurnsLeft === 6 ? "Up to 3 exchanges with their advocate" : `${Math.floor(v.agentTurnsLeft / 2)} exchange${Math.floor(v.agentTurnsLeft / 2) === 1 ? "" : "s"} left`}</span>
          </div>
        </div>
      )}

      {(v.running || polling) && (
        <div role="status" className="flex items-center gap-2.5 border-b border-line-2 px-5 py-3.5 text-sm">
          <span aria-hidden className="size-4 shrink-0 animate-spin rounded-full border-2 border-brand-100 border-t-brand" />
          Your negotiator and their advocate are negotiating. Each turn appears below as it is made.
        </div>
      )}

      {error && <div className="border-b border-line-2 px-5 py-3"><Notice>{error}</Notice></div>}

      <div className="px-5 py-1">
        <NegotiationThread turns={v.turns} perspective="landlord" names={names} />
      </div>

      {canOffer && (
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
                : `Between ${usd(lo)} and ${usd(hi)}, on top of the statement's refund.`}>
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
