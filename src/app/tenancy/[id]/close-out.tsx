"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { TimelineItem } from "@/lib/agent-timeline";
import { usd } from "@/lib/deductions";

export type PendingView = {
  tool: string;
  amount: number;
  to: string;
  note: string | null;
  check: string | null; // null = matches the rules engine; otherwise why it doesn't
};

export function CloseOut(p: {
  tenancyId: string;
  run: { id: string; status: string; error: string | null; items: TimelineItem[]; pending: PendingView | null } | null;
  refunded: boolean;
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
    setStartedAt(Date.now());
    setNow(Date.now());
    setBusy(kind);
    setError("");
    const url = kind === "start" ? `/api/tenancies/${p.tenancyId}/close-out` : `/api/tenancies/${p.tenancyId}/close-out/${p.run!.id}`;
    const r = await fetch(url, kind === "start" ? { method: "POST" } : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved: kind === "approve" }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok || j.error) setError(j.error ?? "Something went wrong.");
    router.refresh();
  }

  const active = p.run && (p.run.status === "awaiting_approval" || p.run.status === "running");
  const canStart = !p.refunded && !active && !busy;

  return (
    <section className="mt-10">
      <h2 className="text-[22px] font-semibold tracking-[-0.01em]">Close out</h2>
      <p className="mt-1 text-[14px] text-ink-2">
        The agent checks the file against the law, confirms the deposit with PayPal, and returns the rest to the tenants.
        Nothing moves until you approve it.
      </p>
      {error && <p className="mt-3 rounded-xl bg-danger-soft px-4 py-3 text-[14px] text-danger">{error}</p>}

      <div className="mt-4 rounded-2xl bg-surface p-5 shadow-sm">
        {p.run?.items.length ? (
          <ol className="space-y-3">
            {p.run.items.map((it, i) => it.kind === "say" ? (
              <li key={i} className="text-[14px] leading-relaxed text-ink">{it.text}</li>
            ) : (
              <li key={it.id} className="flex gap-3 rounded-xl bg-bg px-3 py-2.5">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  it.state === "ok" ? "bg-accent" : it.state === "waiting" ? "bg-warn" : it.state === "declined" ? "bg-ink-3" : "bg-danger"}`} />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold">{it.title}</p>
                  {it.detail && <p className="break-words text-[12px] text-ink-2">{it.detail}</p>}
                </div>
              </li>
            ))}
          </ol>
        ) : !busy && (
          <p className="text-[14px] text-ink-3">
            {p.refunded ? "The deposit has been returned." : "When the deductions are final, start the close-out."}
          </p>
        )}

        {p.run?.status === "failed" && <p className="mt-3 text-[13px] text-danger">The run stopped: {p.run.error}</p>}

        {p.run?.pending && p.run.status === "awaiting_approval" && (
          <div className="mt-4 rounded-xl border-2 border-warn/40 p-4">
            <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-warn">Your approval</p>
            <p className="mt-1 text-[18px] font-semibold">{p.run.pending.tool === "create_refund" ? "Refund" : "Send"} {usd(p.run.pending.amount)}</p>
            <dl className="mt-2 space-y-1 text-[13px]">
              <div className="flex gap-2"><dt className="w-24 shrink-0 text-ink-3">To</dt><dd className="break-words">{p.run.pending.to}</dd></div>
              {p.run.pending.note && <div className="flex gap-2"><dt className="w-24 shrink-0 text-ink-3">Note</dt><dd>{p.run.pending.note}</dd></div>}
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-ink-3">Rules check</dt>
                <dd className={p.run.pending.check ? "text-danger" : "text-accent"}>
                  {p.run.pending.check ?? "Matches the deposit, the deductions and the tenants' refund agreement"}
                </dd>
              </div>
            </dl>
            <div className="mt-4 flex gap-2">
              <button onClick={() => call("approve")} disabled={!!busy || !!p.run.pending.check}
                className="rounded-xl bg-accent px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-40">
                {busy === "approve" ? "Sending..." : `Approve and send ${usd(p.run.pending.amount)}`}
              </button>
              <button onClick={() => call("decline")} disabled={!!busy} className="rounded-xl px-4 py-2 text-[14px] text-ink-2 disabled:opacity-40">
                {busy === "decline" ? "Declining..." : "Decline"}
              </button>
            </div>
          </div>
        )}

        {busy && (
          <p className="mt-4 text-[13px] text-ink-3">
            The agent is {busy === "start" ? "working through the file" : busy === "approve" ? "sending it through PayPal" : "wrapping up"}... {elapsed}s
          </p>
        )}

        {canStart && (
          <button onClick={() => call("start")} className="mt-4 rounded-xl bg-accent px-4 py-2 text-[14px] font-semibold text-white">
            {p.run ? "Run the close-out again" : "Close out the deposit"}
          </button>
        )}
      </div>
    </section>
  );
}
