"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { useConfirm } from "@/components/confirm";
import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { WorkingDots } from "@/components/motion";
import { Card, CardHead, Money, Notice, StatusChip } from "@/components/ui";
import { dateIn, PACIFIC, shortDate } from "@/lib/dates";
import type { PayPalDisputeView } from "@/lib/chargeback-store";

// The tenants' PayPal dispute (or chargeback) of the deposit payment, on the property's Payments tab: what PayPal says,
// what the rules leave the landlord to keep, and the response the defense agent prepared, which goes to PayPal only
// when the landlord approves it as shown. Every amount and every choice here was computed and checked on the server
// (src/lib/chargeback.ts); this page shows it and sends the landlord's answer.

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const POLL_MS = 3000;

const STATUS_TONE: Record<string, "red" | "amber" | "green" | "gray"> = {
  WAITING_FOR_SELLER_RESPONSE: "red", OPEN: "red", UNDER_REVIEW: "amber", WAITING_FOR_BUYER_RESPONSE: "amber", RESOLVED: "green",
};

export function PayPalDisputeCard({ tenancyId, v, quiet, zone = PACIFIC }: { tenancyId: string; v: PayPalDisputeView; quiet: boolean; zone?: string }) {
  const dayOf = (ts: string) => dateIn(ts, zone); // the day where the property is
  const router = useRouter();
  const [busy, setBusy] = useState<null | "check" | "prepare" | "approve" | "decline" | "recheck">(null);
  const [polling, setPolling] = useState(v.running);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [confirm, dialog] = useConfirm();
  const r = v.response;

  // While the agent prepares (here, in another tab, or before a reload), ask the server and refresh when it is done.
  useEffect(() => {
    if (!polling) return;
    let n = 0;
    const t = setInterval(async () => {
      if (++n > 120) { clearInterval(t); setPolling(false); return; }
      const res = await fetch(`/api/tenancies/${tenancyId}/paypal-dispute`, { cache: "no-store" }).catch(() => null);
      const j = res?.ok ? await res.json().catch(() => null) : null;
      if (j?.response?.status && j.response.status !== "preparing") { clearInterval(t); setPolling(false); router.refresh(); }
    }, POLL_MS);
    return () => clearInterval(t);
  }, [polling, tenancyId, router]);

  async function post(action: string, extra: Record<string, unknown> = {}) {
    const res = await fetch(`/api/tenancies/${tenancyId}/paypal-dispute`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }),
    }).catch(() => null);
    return { res, j: res ? await res.json().catch(() => ({})) : {} };
  }

  async function check() {
    setError(""); setInfo(""); setBusy("check");
    const { res, j } = await post("check");
    setBusy(null);
    if (!res?.ok) return setError(j.error ?? "Couldn't reach PayPal. Try again.");
    setInfo(j.changed ? "PayPal's latest is below." : "Nothing new from PayPal.");
    router.refresh();
  }

  async function prepare() {
    setError(""); setInfo(""); setBusy("prepare"); setPolling(true);
    const { res, j } = await post("prepare");
    setBusy(null);
    if (!res) return; // the connection dropped; the run goes on, and the polling shows it
    if (!res.ok && !j.running) { setError(j.error ?? "The defense agent couldn't prepare a response."); setPolling(false); }
    router.refresh();
  }

  async function approve() {
    if (!r?.hash) return;
    const what = r.action === "provide_evidence" ? `The note and ${r.evidence.length} evidence item${r.evidence.length === 1 ? "" : "s"} go to PayPal's reviewer. No money moves.`
        : r.action === "accept_claim" ? `PayPal returns ${usd(r.amount ?? v.amount)} to the tenants and closes the dispute in their favor.`
          : `The tenants are offered ${usd(r.amount ?? 0)} back. Nothing moves unless they accept it in PayPal.`;
    const ok = await confirm({ title: "Send this response to PayPal?", body: `${what} This can't be undone.`, action: r.action === "accept_claim" ? `Approve and send ${usd(r.amount ?? 0)}` : "Approve and send" });
    if (!ok) return;
    setError(""); setInfo(""); setBusy("approve");
    const { res, j } = await post("approve", { responseId: r.id, hash: r.hash });
    setBusy(null);
    if (!res?.ok) setError(j.error ?? "Couldn't send that. Try again.");
    router.refresh();
  }

  async function recheck() {
    if (!r) return;
    const ok = await confirm({ title: "Check this response with PayPal?", body: "The app reads the dispute from PayPal. What PayPal shows went is not sent again; anything else goes again with the same request.", action: "Check with PayPal" });
    if (!ok) return;
    setError(""); setBusy("recheck");
    const { res, j } = await post("recheck", { responseId: r.id });
    setBusy(null);
    if (!res?.ok) setError(j.error ?? "Couldn't check that. Try again.");
    router.refresh();
  }

  async function decline() {
    if (!r) return;
    setError(""); setBusy("decline");
    const { res, j } = await post("decline", { responseId: r.id });
    setBusy(null);
    if (!res?.ok) setError(j.error ?? "Couldn't decline that.");
    router.refresh();
  }

  const tone = STATUS_TONE[v.statusCode ?? ""] ?? (v.open ? "amber" : "gray");
  const running = v.open && (polling || v.running || busy === "prepare");
  const canPrepare = v.open && !!v.options.length && !running && (!r || ["failed", "declined", "refused", "ready", "superseded"].includes(r.status) || (r.status === "sent" && v.statusCode === "WAITING_FOR_SELLER_RESPONSE"));
  // A response can be approved only while PayPal hasn't resolved the dispute.
  const ready = v.open && r?.status === "ready";
  const p = v.position;
  // The state's deadline for the statement and refund, while something is still to go: PayPal's hold doesn't pause it.
  const stateDue = v.open && v.stateDue && !(v.stateDue.delivered && p.owedBack <= 0.005) ? v.stateDue : null;

  return (
    <Card id="paypal-dispute" className="scroll-mt-8">
      <CardHead title="PayPal dispute" meta={<span className="max-sm:hidden">{v.id}</span>}
        right={<>
          <StatusChip tone={tone}>{v.status}</StatusChip>
          <InfoTip align="end" title="Answering a PayPal dispute">
            The tenants asked PayPal to return the deposit payment. The defense agent, a Claude agent working for you, reads the statement, the photos, the records and the dispute, and prepares one response. The app holds it to the rules: it never argues for keeping more than the lawful ranges allow, and gives back at least what is owed. Nothing goes to PayPal until you approve the response as shown. Not legal advice.
          </InfoTip>
        </>} />

      <div className={`grid grid-cols-2 gap-x-4 gap-y-3 border-b border-line-2 px-5 py-4 ${v.open ? "sm:grid-cols-3" : ""}`}>
        <div className="min-w-0">
          <p className="text-xs text-ink-3">Claimed</p>
          <Money value={v.amount} className="mt-0.5 block text-lg font-medium" />
          <p className="mt-0.5 truncate text-xs text-ink-3">{v.reason}{v.openedAt ? `, ${shortDate(dayOf(v.openedAt))}` : ""}</p>
        </div>
        {v.open && <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs text-ink-3">
            Owed back by the rules
            <InfoTip align="end" title="What the rules leave you">
              {p.phase === "tenancy"
                ? `The tenancy is still running, so the ${usd(p.held)} deposit is held as security and nothing is owed back yet.`
                : p.phase === "ended"
                  ? `The lease end or the planned move-out has passed, but no move-out date is on file, so this counts as after a move-out: the charges on file let you keep at most ${usd(p.lawfulKeep)} of the ${usd(p.held)} you hold. Record the move-out date (or the new lease end, if the tenancy goes on).`
                  : `You hold ${usd(p.held)} of the deposit. The lawful ranges of the statement's charges let you keep at most ${usd(p.lawfulKeep)}, so ${usd(p.owedBack)} is owed back whatever happens to the dispute.`}
            </InfoTip>
          </p>
          <Money value={p.owedBack} className="mt-0.5 block text-lg font-medium" />
          <p className="mt-0.5 text-xs text-ink-3">{usd(p.lawfulKeep)} kept within the rules</p>
        </div>}
        <div className={`min-w-0 ${v.open ? "max-sm:col-span-2" : ""}`}>
          <p className="text-xs text-ink-3">{v.open ? "Respond by" : "Outcome"}</p>
          <p className="mt-0.5 text-lg font-medium">{v.open ? (v.dueDate ? shortDate(v.dueDate) : "Not set") : v.outcome ?? "Resolved"}</p>
          <p className="mt-0.5 text-xs text-ink-3">{v.open ? (v.dueDate ? "PayPal's date" : "While PayPal reviews") : v.refunded ? `${usd(v.refunded)} refunded by PayPal` : "Nothing refunded by PayPal"}</p>
        </div>
      </div>

      {stateDue && (
        <div className="flex items-start gap-2 border-b border-line-2 px-5 py-3 text-sm text-ink-2">
          <Icon name="calendar" className="mt-0.5 size-3.5 shrink-0 text-ink-4" />
          <p className="min-w-0 flex-1">
            Your statement and refund are due {shortDate(stateDue.date)} under the state&apos;s rules. PayPal&apos;s hold doesn&apos;t pause that deadline.
            <span className="ml-1.5 inline-flex align-[-2px]"><InfoTip align="end" title={stateDue.title} cite={stateDue.cite ?? undefined}>{stateDue.text} Accepting the claim ends PayPal&apos;s hold now; evidence leaves the money with PayPal until it decides.</InfoTip></span>
          </p>
        </div>
      )}

      {v.buyerWords.length > 0 && (
        <div className="border-b border-line-2 px-5 py-4">
          <p className="text-xs text-ink-3">The tenants&apos; words to PayPal</p>
          {v.buyerWords.map((w, i) => <p key={i} className="mt-1 whitespace-pre-line text-sm text-ink-2">&ldquo;{w}&rdquo;</p>)}
        </div>
      )}

      {/* The response. */}
      <div className="border-b border-line-2 px-5 py-4">
        {running ? (
          <div role="status" className="flex items-center gap-2.5 text-sm">
            The defense agent is reading the case and preparing a response. This takes about a minute.
            <WorkingDots className="shrink-0 text-ink-4" />
          </div>
        ) : ready ? (
          <Prepared v={v} />
        ) : r?.status === "sending" ? (
          <div role="status" className="flex items-center gap-2.5 text-sm">
            Sending your response to PayPal.
            <WorkingDots className="shrink-0 text-ink-4" />
          </div>
        ) : r?.status === "sent" ? (
          <Sent v={v} zone={zone} />
        ) : r?.status === "unknown" ? (
          <>
            <p className="text-sm font-medium">{r.actionLabel}</p>
            <Notice tone="amber" className="mt-2">
              {r.error ? `${r.error} ` : ""}PayPal didn&apos;t confirm every step, so part of it may have gone. Check with PayPal reads the dispute and sends only what didn&apos;t go, with the same requests, so nothing is sent twice.
            </Notice>
          </>
        ) : v.open && v.options.length ? (
          <>
            {r && (r.status === "failed" || r.status === "refused" || r.status === "declined") && (
              <Notice tone={r.status === "declined" ? "gray" : "red"} className="mb-3">
                {r.status === "declined" ? "You declined the last response; nothing went to PayPal."
                  : r.status === "refused" ? `PayPal didn't take the last response, and nothing moved${r.error ? `: ${r.error}` : "."}`
                    : `The last preparation didn't finish${r.error ? `: ${r.error}` : "."}`}
              </Notice>
            )}
            <p className="text-sm font-medium">Let the defense agent prepare your response</p>
            <p className="mt-1 text-xs text-ink-3">
              It proposes one of what the rules and PayPal allow here: {v.options.map((o) => `${o.label.charAt(0).toLowerCase()}${o.label.slice(1)}${o.amount ? ` (${o.amount})` : ""}`).join("; ")}.
            </p>
            {v.evidenceWithheld && <p className="mt-1 text-xs text-ink-3">{v.evidenceWithheld}</p>}
          </>
        ) : (
          <>
            {!v.open && r && (r.status === "superseded" || r.status === "ready") && (
              <Notice tone="gray" className="mb-3">{r.error ?? "PayPal resolved the dispute first, so this response was never sent."}</Notice>
            )}
            <p className="text-sm text-ink-2">{v.open ? v.block ?? v.none ?? "No response is possible from here." : "PayPal resolved this dispute."}</p>
          </>
        )}

        {error && <Notice className="mt-3">{error}</Notice>}
        {info && !error && <p className="mt-3 text-xs text-ink-3">{info}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          {ready && !running && (
            <>
              <Button variant={quiet ? "secondary" : "primary"} disabled={!!busy} onClick={approve}>
                <Icon name="send" />{busy === "approve" ? "Sending..." : r.amount != null && r.action === "accept_claim" ? `Approve and send ${usd(r.amount)}` : "Approve and send"}
              </Button>
              <Button variant="link" disabled={!!busy} onClick={decline}>Decline</Button>
            </>
          )}
          {r?.status === "unknown" && (
            <Button variant={quiet ? "secondary" : "primary"} disabled={!!busy} onClick={recheck}><Icon name="search" />{busy === "recheck" ? "Checking..." : "Check with PayPal"}</Button>
          )}
          {canPrepare && (
            <Button variant={ready || quiet ? "link" : "primary"} disabled={!!busy} onClick={prepare}>
              {ready ? "Prepare again" : r ? "Prepare a new response" : "Prepare a response"}
            </Button>
          )}
          <Button variant="link" disabled={!!busy} onClick={check} className="ml-auto">{busy === "check" ? "Checking PayPal..." : "Check PayPal"}</Button>
        </div>
      </div>

      <p className="px-5 py-3 text-xs text-ink-3">
        {v.reportedAt ? `From PayPal, ${shortDate(dayOf(v.reportedAt))}. ` : ""}Nothing goes to PayPal until you approve a response.
      </p>
      {dialog}
    </Card>
  );
}

function Prepared({ v }: { v: PayPalDisputeView }) {
  const r = v.response!;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-sm font-medium">{r.actionLabel}</p>
        {r.amount != null && <span className="text-sm text-ink-2"><Money value={r.amount} /> back</span>}
        <StatusChip tone="amber" size="sm">Waiting for you</StatusChip>
      </div>
      {r.summary && <p className="mt-1.5 text-sm text-ink-2">{r.summary}</p>}
      {/* Why evidence alone isn't offered, in the record's terms, written by code (never left to the agent's words). */}
      {v.evidenceWithheld && <p className="mt-1.5 text-xs text-ink-3">{v.evidenceWithheld}</p>}
      <div className="mt-3 rounded-md bg-surface px-3.5 py-3">
        <p className="text-xs text-ink-3">What PayPal reads</p>
        <p className="mt-1 whitespace-pre-line text-sm text-ink">{r.note}</p>
      </div>
      {r.evidence.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-ink-3">Evidence attached</p>
          <ul className="mt-1 flex flex-col gap-1">
            {r.evidence.map((e) => (
              <li key={e.key} className="flex items-start gap-2 text-sm text-ink-2"><Icon name="doc" className="mt-0.5 size-3.5 shrink-0 text-ink-4" />{e.label}</li>
            ))}
          </ul>
        </div>
      )}
      {(r.adjustments.length > 0 || r.citations.length > 0) && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-3">
          {r.adjustments.length ? `The app changed ${r.adjustments.length} thing${r.adjustments.length === 1 ? "" : "s"} to fit the rules` : "Checked against the rules"}
          <InfoTip title="How this was checked" cite={r.citations.join("; ") || undefined}>
            {r.adjustments.length ? r.adjustments.join(" ") : "Every amount is inside what the rules allow and every figure in the note is one the record holds."}
          </InfoTip>
        </p>
      )}
    </div>
  );
}

function Sent({ v, zone }: { v: PayPalDisputeView; zone: string }) {
  const dayOf = (ts: string) => dateIn(ts, zone);
  const r = v.response!;
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-green-bg text-green"><Icon name="check" className="size-3.5" /></span>
      <div className="min-w-0 flex-[1_1_14rem]">
        <p className="text-sm font-medium">Sent to PayPal{r.sentAt ? ` ${shortDate(dayOf(r.sentAt))}` : ""}: {r.actionLabel?.toLowerCase()}</p>
        {r.evidenceSent && (
          <p className="mt-0.5 text-xs text-ink-3">
            {r.filesSent ? `${r.filesSent} file${r.filesSent === 1 ? "" : "s"} and the note sent` : "The note sent"}. PayPal decides from here.
          </p>
        )}
        {r.filesLeftOut.length > 0 && (
          <p className="mt-0.5 text-xs text-amber">Left out: {r.filesLeftOut.join("; ")} (missing, or over PayPal&apos;s 10 MB a file or 50 MB in all).</p>
        )}
        {r.action === "accept_claim" && <p className="mt-0.5 text-xs text-ink-3">PayPal returns {usd(r.amount ?? v.amount)} to the tenants and closes the dispute.</p>}
        {r.action === "make_offer" && <p className="mt-0.5 text-xs text-ink-3">The tenants decide in PayPal; nothing moves unless they accept.</p>}
      </div>
    </div>
  );
}

/** The banner every tab shows while the tenants' PayPal dispute is open. */
export function PayPalDisputeBanner({ href, amount, dueDate, response }: { href: string; amount: number; dueDate: string | null; response: string | null }) {
  const [text, link] = response === "ready" ? ["A response is prepared and waits on your approval.", "Review response"]
    : response === "sent" || response === "sending" ? ["Your response went to PayPal. PayPal decides from here.", "View dispute"]
      : response === "unknown" ? ["PayPal didn't confirm your response. Check it with PayPal.", "Check response"]
        : [`The tenants asked PayPal for ${usd(amount)} of the deposit back.${dueDate ? ` Respond by ${shortDate(dueDate)}.` : ""}`, "Prepare a response"];
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-line bg-red-bg px-4 py-3 text-sm">
      <span className="font-medium text-red">PayPal dispute</span>
      <span className="min-w-0 flex-1 text-ink">{text}</span>
      <a href={href} className="font-medium text-brand hover:underline">{link}</a>
    </div>
  );
}

/** On the Payments tab when no PayPal dispute is on file: the webhook reports one when it opens, and this asks PayPal
 *  directly. */
export function PayPalDisputeCheck({ tenancyId }: { tenancyId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "gray"; text: string } | null>(null);
  async function check() {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/tenancies/${tenancyId}/paypal-dispute`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check" }),
    }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setMsg({ tone: "red", text: j.error ?? "Couldn't reach PayPal. Try again." });
    if (j.found) router.refresh();
    else setMsg({ tone: "gray", text: "PayPal has no dispute of this payment." });
  }
  return (
    <Card className="px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            PayPal disputes
            <InfoTip title="Disputes and chargebacks">If the tenants dispute the deposit payment with PayPal, PayPal tells the app, and it shows here with a response for you to approve. Check PayPal asks PayPal directly.</InfoTip>
          </p>
          <p className="text-xs text-ink-3">None on file for this deposit.</p>
        </div>
        <Button size="sm" disabled={busy} onClick={check}>{busy ? "Checking..." : "Check PayPal"}</Button>
      </div>
      {/* What Check PayPal found, read out when it lands (an error at once). */}
      <div aria-live="polite" className="empty:hidden">
        {msg && <p role={msg.tone === "red" ? "alert" : undefined} className={`mt-2 text-xs ${msg.tone === "red" ? "text-red" : "text-ink-3"}`}>{msg.text}</p>}
      </div>
    </Card>
  );
}
