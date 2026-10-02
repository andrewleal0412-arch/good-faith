"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { describeNoticeGiven, NOTICE_INFO, NOTICE_METHODS, NOTICE_SLUG, type NoticeGiven, type NoticeKind, type NoticeMethod } from "@/lib/notices";

const input = "w-full rounded-xl border border-line bg-bg px-3 py-2 text-[14px] outline-none focus:border-accent";

// Records that a notice was given: the date, how, and to which adult tenant. Shared by the tenancy page and the
// printable draft. When it is already recorded, it shows the record and offers to undo it.
export function NoticeGivenForm(p: { tenancyId: string; kind: NoticeKind; tenants: string[]; today: string; given: NoticeGiven | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<NoticeMethod>("mail");
  const [date, setDate] = useState(p.today);
  const [to, setTo] = useState(p.tenants[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const url = `/api/tenancies/${p.tenancyId}/notices/${NOTICE_SLUG[p.kind]}`;

  async function save() {
    setBusy(true);
    setError("");
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, method, to }) });
    setBusy(false);
    if (!r.ok) return setError((await r.json().catch(() => ({}))).error ?? "Couldn't record that.");
    setOpen(false);
    router.refresh();
  }

  async function undo() {
    if (!confirm(`Remove the record that the ${NOTICE_INFO[p.kind].short} was given? The activity log keeps both entries.`)) return;
    setBusy(true);
    const r = await fetch(url, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) return setError((await r.json().catch(() => ({}))).error ?? "Couldn't change that.");
    router.refresh();
  }

  if (p.given) {
    return (
      <p className="text-[13px] text-ink-2">
        Given by <b className="text-ink">{describeNoticeGiven(p.given)}</b>.{" "}
        <button onClick={undo} disabled={busy} className="text-ink-3 underline underline-offset-2 hover:text-ink disabled:opacity-40">Undo</button>
        {error && <span className="ml-2 text-danger">{error}</span>}
      </p>
    );
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-xl border border-line bg-surface px-3 py-1.5 text-[13px] font-semibold text-ink hover:bg-bg">
        Mark as given
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-[14px] font-semibold">How the {NOTICE_INFO[p.kind].short} was given</p>
      <div className="mt-3 inline-flex flex-wrap gap-1 rounded-xl bg-bg p-1">
        {NOTICE_METHODS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setMethod(k)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${method === k ? "bg-surface text-ink shadow-sm" : "text-ink-3"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-3">Given to</span>
          <select className={input} value={to} onChange={(e) => setTo(e.target.value)}>
            {p.tenants.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-3">Date given</span>
          <input type="date" className={input} value={date} max={p.today} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      {error && <p className="mt-3 rounded-xl bg-danger-soft px-4 py-3 text-[13px] text-danger">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button onClick={save} disabled={busy} className="rounded-xl bg-ink px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-40">
          {busy ? "Saving..." : "Record it"}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-xl px-4 py-2 text-[14px] text-ink-2">Cancel</button>
      </div>
    </div>
  );
}
