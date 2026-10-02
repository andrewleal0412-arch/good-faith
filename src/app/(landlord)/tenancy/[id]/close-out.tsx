"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/button";
import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { Card, CardHead, KV, Money, Notice } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import type { TimelineItem } from "@/lib/agent-timeline";

export type PendingView = {
  tool: string;
  amount: number;
  to: string;
  note: string | null;
  check: string | null; // null = matches the rules engine; otherwise why it doesn't
};

// The refund, as Mercury's Review transfer reads: the outcome first (the amount waiting for approval, or the refund that
// went out), and what the agent did behind a closed "Details" disclosure, one line per step. The agent's own notes sit
// at the foot of it with any quoted statute taken out (the citations go in a tip) and any raw page path made a link.

/** A quoted rule ("Civ. Code 1950.5(h)(1): the itemized statement...") with the words that lead into it. */
const QUOTED = /((?:As the rules? puts? it|In the rules' words|The rules? says?),?\s*)?(,?\s*\b(?:since|because|as|per|under)\s+)?["“](?:Cal\. )?Civ\. Code (?:§\s*)?([^:"”]+):[^"”]*?([.!?])?["”]/g;
const PATH = /(\/tenancy\/[0-9a-f-]{36}(?:\/[a-z-]+)*)/;

/** The text without quoted statute, and the citations it quoted. */
function stripQuotes(text: string): { text: string; cites: string[] } {
  const cites: string[] = [];
  const out = text.replace(QUOTED, (_m, sent?: string, clause?: string, cite = "", end?: string) => {
    cites.push(`Civ. Code ${cite.trim()}`);
    if (sent) return "";
    if (clause) return end ?? "";
    return `Civ. Code ${cite.trim()}${end ?? ""}`;
  }).replace(/\s{2,}/g, " ").replace(/\s+([.,])/g, "$1").trim();
  return { text: out, cites: [...new Set(cites)] };
}

/** A page path in the agent's words becomes a link: the statement by name, anything else as this property. */
function withLinks(text: string): ReactNode[] {
  return text.split(PATH).map((part, i) => {
    if (!PATH.test(part)) return <Fragment key={i}>{part}</Fragment>;
    return <Link key={i} href={part} className="font-medium text-brand hover:underline">{part.endsWith("/statement") ? "Itemized statement" : "this property"}</Link>;
  });
}

export function CloseOut(p: {
  tenancyId: string;
  run: { id: string; status: string; error: string | null; at: string | null; items: TimelineItem[]; pending: PendingView | null } | null;
  refunded: boolean;
  returned: { amount: number; kind: string; id: string | null; on: string } | null; // what PayPal sent back, once it has
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
  const awaiting = p.run?.status === "awaiting_approval" && !!p.run.pending;
  const canStart = !p.refunded && !active && !busy;
  const steps = (p.run?.items ?? []).filter((it): it is Extract<TimelineItem, { kind: "step" }> => it.kind === "step");
  const notes = (p.run?.items ?? []).filter((it): it is Extract<TimelineItem, { kind: "say" }> => it.kind === "say").map((it) => stripQuotes(it.text));
  const cites = [...new Set(notes.flatMap((n) => n.cites))];

  return (
    <Card>
      <CardHead title="Refund"
        right={<InfoTip align="end" title="Nothing moves without you">
          The agent checks the file against the law, confirms the deposit with PayPal and proposes the refund. A rules check runs
          again the moment you approve.
        </InfoTip>} />
      <div className="px-5 py-4">
        {error && <Notice className="mb-4">{error}</Notice>}

        {p.returned ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-green-bg text-green"><Icon name="check" className="size-3.5" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Refund of <Money value={p.returned.amount} /> sent {shortDate(p.returned.on)}</p>
              {p.returned.id && <p className="break-all text-xs text-ink-3">PayPal {p.returned.kind === "payout" ? "payout" : "refund"} {p.returned.id}</p>}
            </div>
            <Link href={`/tenancy/${p.tenancyId}/statement`} className="text-sm font-medium text-brand hover:underline">Itemized statement</Link>
          </div>
        ) : awaiting ? (
          <div className="rounded-lg border border-line p-5">
            <p className="text-sm text-ink-3">{p.run!.pending!.tool === "create_refund" ? "Refund to the tenants" : "Payout to the tenants"}</p>
            <Money value={p.run!.pending!.amount} className="mt-1 block text-2xl font-medium" />
            <div className="my-4 h-px bg-line" />
            <KV rows={[
              ["To", p.run!.pending!.to],
              ...(p.run!.pending!.note ? [["Note", p.run!.pending!.note] as [string, string]] : []),
              ["Rules check", <span key="c" className={p.run!.pending!.check ? "text-red" : "text-green"}>
                {p.run!.pending!.check ?? "Matches the deposit, the deductions and the refund agreement"}
              </span>],
            ]} />
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => call("approve")} disabled={!!busy || !!p.run!.pending!.check}>
                {busy === "approve" ? "Sending..." : <>Send refund of <Money value={p.run!.pending!.amount} /></>}
              </Button>
              <Button onClick={() => call("decline")} disabled={!!busy}>{busy === "decline" ? "Declining..." : "Decline"}</Button>
            </div>
          </div>
        ) : !busy && (
          <p className="text-sm text-ink-3">
            {p.refunded ? "The deposit has been returned." : p.run ? "No refund is waiting for approval." : "When the deductions are final, prepare the refund."}
          </p>
        )}

        {p.run?.status === "failed" && <Notice className="mt-3">The run stopped: {p.run.error}</Notice>}

        {busy && (
          <p className="mt-4 text-sm text-ink-3">
            The agent is {busy === "start" ? "working through the file" : busy === "approve" ? "sending it through PayPal" : "wrapping up"}... {elapsed}s
          </p>
        )}

        {canStart && (
          <Button variant={p.run ? "secondary" : "primary"} className="mt-4" onClick={() => call("start")}>
            {p.run ? "Run the close-out again" : "Prepare refund"}
          </Button>
        )}

        {(steps.length > 0 || notes.length > 0) && (
          <details open={awaiting} className="group mt-4 border-t border-line-2 pt-3">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-ink-2 [&::-webkit-details-marker]:hidden">
              Details
              <Icon name="chev-down" className="size-3.5 text-ink-4 transition-transform group-open:rotate-180" />
              {p.run?.at && <span className="ml-auto text-xs font-normal text-ink-3">Agent run, {shortDate(p.run.at)}</span>}
            </summary>
            <ol className="mt-2 flex flex-col">
              {steps.map((it) => {
                const d = stripQuotes(it.detail);
                return (
                  <li key={it.id} className="flex items-center gap-3 py-[7px]">
                    <span className={`flex size-5 shrink-0 items-center justify-center rounded-full ${
                      it.state === "ok" ? "bg-green-bg text-green" : it.state === "waiting" ? "bg-amber-bg text-amber" : it.state === "declined" ? "bg-surface-2 text-ink-3" : "bg-red-bg text-red"}`}>
                      <Icon name={it.state === "ok" ? "check" : it.state === "waiting" ? "clock" : it.state === "declined" ? "x" : "alert"} className="size-3" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink-2">{it.title}</p>
                      {d.text && <p className="truncate text-xs text-ink-3" title={d.text}>{d.text}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
            {notes.length > 0 && (
              <div className="mt-2 rounded-md bg-surface px-3.5 py-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-ink-3">
                  Agent notes
                  {cites.length > 0 && <InfoTip title="Rules the agent relied on" cite={cites.join("; ")}>The parts of Civil Code 1950.5 the agent checked this close-out against.</InfoTip>}
                </p>
                {notes.map((n, i) => n.text && <p key={i} className="mt-1.5 text-xs text-ink-2">{withLinks(n.text)}</p>)}
              </div>
            )}
          </details>
        )}
      </div>
    </Card>
  );
}
