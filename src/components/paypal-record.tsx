"use client";

import { useEffect, useState } from "react";
import { recordRows, recordWord, type PayPalRecord, type RecordKind } from "@/lib/paypal-record";
import { Button } from "./button";
import { CopyId } from "./copy-id";
import { Icon, PayPalMark } from "./icons";
import { KV, Notice } from "./ui";

// "PayPal's record": a collapsed section on the refund receipt and in a Payments row's details that puts PayPal's own
// answer beside the app's. It reads nothing until it is opened; then it asks the tenancy's paypal-record route, which
// reads PayPal at that moment and returns the fields alone (src/lib/paypal-record.ts), each shown here as PayPal
// wrote it and labelled as PayPal's. "Read from PayPal just now" dates the read; Check again reads it again.

type State =
  | { status: "idle" }
  | { status: "reading"; record?: PayPalRecord; readAt?: number }
  | { status: "read"; record: PayPalRecord; readAt: number }
  | { status: "error"; error: string; record?: PayPalRecord; readAt?: number };

/** "just now" for the first minute, then the minutes. */
const agoWords = (readAt: number, now: number) => {
  const m = Math.floor((now - readAt) / 60_000);
  return m < 1 ? "just now" : m === 1 ? "1 minute ago" : `${m} minutes ago`;
};

/** `zone` is the property's time zone (its state pack's): each of PayPal's times, the stamp as PayPal wrote it (UTC, in
 *  practice), gets the same moment on that clock beside it, in gray, so a refund sent in the evening isn't read as
 *  tomorrow's. */
export function PayPalRecordSection({ tenancyId, kind, id, zone }: { tenancyId: string; kind: RecordKind; id: string; zone: string }) {
  const [s, setS] = useState<State>({ status: "idle" });
  const [now, setNow] = useState(0);
  const word = recordWord(kind);
  const readAt = "readAt" in s ? s.readAt : undefined;

  async function read() {
    const kept = s.status === "idle" ? {} : { record: s.record, readAt: s.readAt };
    setS({ status: "reading", ...kept });
    const r = await fetch(`/api/tenancies/${tenancyId}/paypal-record?kind=${kind}&id=${encodeURIComponent(id)}`, { cache: "no-store", signal: AbortSignal.timeout(25_000) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok || !j.record) {
      setS({ status: "error", error: j.error ?? "PayPal couldn't be reached. Check again in a moment.", ...kept });
      return;
    }
    const at = Date.now();
    setNow(at);
    setS({ status: "read", record: j.record, readAt: at });
  }

  // "Just now" ages: once a read is shown, the line follows the clock.
  useEffect(() => {
    if (!readAt) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [readAt]);

  const record = "record" in s ? s.record : undefined;
  const rows = record ? recordRows(record, zone) : [];
  const clocks = rows.some((x) => x.local);
  return (
    // The first read happens when the section is opened, never before.
    <details className="group/pp" onToggle={(e) => { if (e.currentTarget.open && s.status === "idle") void read(); }}>
      <summary className="flex min-h-6 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-ink-2 [&::-webkit-details-marker]:hidden">
        <PayPalMark size={14} />
        PayPal&apos;s record
        <Icon name="chev-down" className="size-3.5 text-ink-4 transition-transform group-open/pp:rotate-180" />
      </summary>
      <div className="mt-2">
        <p className="text-xs text-ink-3">What PayPal returns for this {word} when asked now, in PayPal&apos;s own words. Not the app&apos;s copy.{clocks && " The property's clock follows each of its times."}</p>
        {s.status === "error" && <Notice className="mt-3">{s.error}</Notice>}
        {record && (
          <KV className="mt-3" rows={rows.map((x) => [x.label, x.id ? <CopyId key={x.label} text={x.value} label={`Copy ${x.label}`} /> : (
            // PayPal's value first, as it wrote it; the property's clock after it, where the value is a time. Plain
            // inline spans with a space between, so the cell's break-words still holds a long stamp at phone width,
            // and the two read and copy as separate words.
            <span key={x.label}>
              <span data-paypal-value="" className="tabular-nums">{x.value}</span>
              {x.local && <>{" "}<span data-paypal-local="" className="ml-1 tabular-nums text-ink-3">{x.local}</span></>}
            </span>
          )])} />
        )}
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
          <span role="status">
            {s.status === "reading" ? "Reading from PayPal..." : readAt ? `Read from PayPal ${agoWords(readAt, Math.max(now, readAt))}` : ""}
          </span>
          <Button variant="link" size="sm" onClick={read} disabled={s.status === "reading"}>Check again</Button>
        </p>
      </div>
    </details>
  );
}
