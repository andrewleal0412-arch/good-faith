"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/button";
import { useConfirm } from "@/components/confirm";
import { FormField } from "@/components/field";
import { Notice, inputClass } from "@/components/ui";
import { describeNoticeGiven, NOTICE_INFO, NOTICE_METHODS, NOTICE_SLUG, type NoticeGiven, type NoticeKind, type NoticeMethod } from "@/lib/notices";

const input = inputClass;

// Records that a notice was given: the date, how, and to which adult tenant. Shared by the tenancy page and the
// printable draft. When it is already recorded, it shows the record and offers to undo it.
export function NoticeGivenForm(p: { tenancyId: string; kind: NoticeKind; tenants: string[]; today: string; given: NoticeGiven | null }) {
  const router = useRouter();
  const [confirm, dialog] = useConfirm();
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
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, method, to }) }).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setError((r ? (await r.json().catch(() => ({}))).error : null) ?? "Couldn't record that.");
    setOpen(false);
    router.refresh();
  }

  async function undo() {
    if (!(await confirm({ title: "Remove this record?", body: `The ${NOTICE_INFO[p.kind].short} goes back to a draft. The activity log keeps both entries.`, action: "Remove" }))) return;
    setBusy(true);
    const r = await fetch(url, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setError((r ? (await r.json().catch(() => ({}))).error : null) ?? "Couldn't change that.");
    router.refresh();
  }

  if (p.given) {
    return (
      <div>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
          Given by {describeNoticeGiven(p.given)}
          <Button variant="link" size="sm" onClick={undo} disabled={busy}>Undo</Button>
        </p>
        {error && <Notice className="mt-2">{error}</Notice>}
        {dialog}
      </div>
    );
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>Mark as given</Button>
    );
  }

  return (
    <div className="rounded-md border border-line p-4">
      <FormField group label={`How it was given`}>
        <div className="inline-flex flex-wrap gap-0.5 rounded-md bg-surface-2 p-[3px]">
          {NOTICE_METHODS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setMethod(k)} aria-pressed={method === k}
              className={`h-7 rounded-sm px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-100 ${method === k ? "bg-canvas font-medium text-ink shadow-sm" : "text-ink-3 hover:text-ink"}`}>
              {label}
            </button>
          ))}
        </div>
      </FormField>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <FormField label="Given to">
          <select className={input} value={to} onChange={(e) => setTo(e.target.value)}>
            {p.tenants.map((t) => <option key={t}>{t}</option>)}
          </select>
        </FormField>
        <FormField label="Date given">
          <input type="date" className={input} value={date} max={p.today} onChange={(e) => setDate(e.target.value)} />
        </FormField>
      </div>
      {error && <Notice className="mt-3">{error}</Notice>}
      <div className="mt-4 flex gap-2">
        <Button variant="primary" onClick={save} disabled={busy}>{busy ? "Saving..." : "Record it"}</Button>
        <Button onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
