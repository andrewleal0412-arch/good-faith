"use client";

import { useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/button";
import { useConfirm } from "@/components/confirm";
import { Icon } from "@/components/icons";
import { useRefresh } from "@/components/refresh";
import { Notice } from "@/components/ui";

// The review page's buttons: Back, the one primary (Prepare refund, which starts the close-out agent, or Send refund,
// which answers its approval request) and Decline. The routes behind them are the ones the property page used: the
// approval is claimed atomically and guardRefund re-checks the rules before PayPal is called.

export function RefundActions(p: {
  tenancyId: string;
  back: string;
  mode: "prepare" | "send";
  runId?: string;
  label: string; // the primary button's words
  disabled?: boolean; // a blocker, a failed rules check, or a run already in progress
  auth: string; // the sentence under the buttons
}) {
  const refresh = useRefresh();
  const [confirm, dialog] = useConfirm();
  const [busy, setBusy] = useState<"start" | "approve" | "decline" | null>(null);
  const [error, setError] = useState("");
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [busy]);
  const elapsed = Math.max(0, Math.round((now - startedAt) / 1000));

  async function call(kind: "start" | "approve" | "decline") {
    if (kind !== "start" && !p.runId) return;
    if (kind === "decline" && !(await confirm({ title: "Decline this refund?", body: "Nothing is sent, and the agent stops.", action: "Decline" }))) return;
    setStartedAt(Date.now());
    setNow(Date.now());
    setBusy(kind);
    setError("");
    const url = kind === "start" ? `/api/tenancies/${p.tenancyId}/close-out` : `/api/tenancies/${p.tenancyId}/close-out/${p.runId}`;
    const r = await fetch(url, kind === "start" ? { method: "POST" } : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved: kind === "approve" }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok || j.error) setError(j.error ?? "Something went wrong. Nothing was sent.");
    refresh(() => setBusy(null));
  }

  const progress = busy === "start" ? "Claude, the close-out agent, is reading the file and checking the deposit with PayPal. This usually takes under a minute"
    : busy === "approve" ? "Sending it through PayPal" : "Recording that";

  return (
    <>
      {error && <Notice className="mt-8">{error}</Notice>}
      <div className="mt-8 flex flex-wrap items-center gap-2.5">
        <ButtonLink size="lg" href={p.back}><Icon name="chev-left" />Back</ButtonLink>
        {/* The controls the demo's next-step bar points at (components/guide-bar.tsx). */}
        <Button variant="primary" size="lg" disabled={!!busy || p.disabled} data-guide-target={p.mode === "send" ? "send-refund" : "prepare-refund"}
          onClick={() => call(p.mode === "send" ? "approve" : "start")}>
          {busy === "approve" ? "Sending..." : busy === "start" ? "Preparing..." : p.label}
        </Button>
        {/* No run id yet: the review is still waiting for PayPal (the page's fallback), so there is nothing to decline. */}
        {p.mode === "send" && (
          <Button variant="link" className="ml-auto" disabled={!!busy || !p.runId} onClick={() => call("decline")}>
            {busy === "decline" ? "Declining..." : "Decline"}
          </Button>
        )}
      </div>
      {busy
        ? <p className="mt-4 text-sm text-ink-3" role="status" data-guide-target={busy === "start" ? "refund-working" : undefined}>{progress}... <span className="tabular-nums">{elapsed}s</span></p>
        : <p className="mt-4 text-sm text-ink-3">{p.auth}</p>}
      {dialog}
    </>
  );
}
