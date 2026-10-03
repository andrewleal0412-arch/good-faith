"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/button";
import { Icon } from "@/components/icons";
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
  const router = useRouter();
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
    if (kind === "decline" && !window.confirm("Decline this refund? Nothing is sent, and the agent stops.")) return;
    setStartedAt(Date.now());
    setNow(Date.now());
    setBusy(kind);
    setError("");
    const url = kind === "start" ? `/api/tenancies/${p.tenancyId}/close-out` : `/api/tenancies/${p.tenancyId}/close-out/${p.runId}`;
    const r = await fetch(url, kind === "start" ? { method: "POST" } : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved: kind === "approve" }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(null);
    if (!r?.ok || j.error) setError(j.error ?? "Something went wrong. Nothing was sent.");
    router.refresh();
  }

  const progress = busy === "start" ? "The agent is reading the file and checking the deposit with PayPal"
    : busy === "approve" ? "Sending it through PayPal" : "Recording that";

  return (
    <>
      {error && <Notice className="mt-8">{error}</Notice>}
      <div className="mt-8 flex flex-wrap items-center gap-2.5">
        <ButtonLink size="lg" href={p.back}><Icon name="chev-left" />Back</ButtonLink>
        <Button variant="primary" size="lg" disabled={!!busy || p.disabled}
          onClick={() => call(p.mode === "send" ? "approve" : "start")}>
          {busy === "approve" ? "Sending..." : busy === "start" ? "Preparing..." : p.label}
        </Button>
        {p.mode === "send" && (
          <Button variant="link" className="ml-auto" disabled={!!busy} onClick={() => call("decline")}>
            {busy === "decline" ? "Declining..." : "Decline"}
          </Button>
        )}
      </div>
      {busy
        ? <p className="mt-4 text-sm text-ink-3" role="status">{progress}... {elapsed}s</p>
        : <p className="mt-4 text-sm text-ink-3">{p.auth}</p>}
    </>
  );
}

/** The PayPal id with a copy button that turns into a check for a moment. */
export function CopyId({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      setDone(false);
    }
  }
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span className="break-all">{text}</span>
      <button type="button" onClick={copy} aria-label={done ? "Copied" : label} title={done ? "Copied" : label}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-4 hover:bg-surface-2 hover:text-ink-2">
        <Icon name={done ? "check" : "copy"} className="size-3.5" />
      </button>
    </span>
  );
}
