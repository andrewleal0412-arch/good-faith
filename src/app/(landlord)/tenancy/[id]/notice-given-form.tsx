"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/button";
import { useConfirm } from "@/components/confirm";
import { FormField } from "@/components/field";
import { Notice, inputClass } from "@/components/ui";
import { longDate } from "@/lib/dates";
import { describeNoticeGiven, NOTICE_METHOD_LABEL, NOTICE_SLUG, recordFor, type NoticeGiven, type NoticeKind, type NoticeMethod } from "@/lib/notices";
import { packFor } from "@/lib/states";

const input = inputClass;

// Records that a notice was given, or that a record the state's pack names was made (a checklist signed, the account
// a deposit is held in, a claim notice sent by certified mail): the date, how, with whom, and what it names. Shared by
// the tenancy page and the record's own page. When it is already recorded, it shows the record and offers to undo it.
export function NoticeGivenForm(p: { tenancyId: string; state: string; kind: NoticeKind; tenants: string[]; today: string; given: NoticeGiven | null }) {
  const router = useRouter();
  const [confirm, dialog] = useConfirm();
  const def = recordFor(packFor(p.state), p.kind)!;
  const labels = def.form ?? { method: "How it was given", date: "Date given", button: "Mark as given" };
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<NoticeMethod>(def.methods.find(([m]) => m === "mail")?.[0] ?? def.methods[0][0]);
  const [date, setDate] = useState(p.today);
  const [to, setTo] = useState(def.toLabel ? p.tenants[0] ?? "" : "");
  const [detail, setDetail] = useState("");
  const [received, setReceived] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const url = `/api/tenancies/${p.tenancyId}/notices/${NOTICE_SLUG[p.kind]}`;

  async function save() {
    setBusy(true);
    setError("");
    const body = def.detail || def.received ? { date, method, to, detail, received: method === "email" ? date : received } : { date, method, to };
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setError((r ? (await r.json().catch(() => ({}))).error : null) ?? "Couldn't record that.");
    setOpen(false);
    router.refresh();
  }

  async function undo() {
    if (!(await confirm({ title: "Remove this record?", body: `The ${def.short} goes back to ${def.draft ? "a draft" : "not recorded"}. The activity log keeps both entries.`, action: "Remove" }))) return;
    setBusy(true);
    const r = await fetch(url, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setError((r ? (await r.json().catch(() => ({}))).error : null) ?? "Couldn't change that.");
    router.refresh();
  }

  if (p.given) {
    const g = p.given;
    return (
      <div>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
          {def.verb} by {describeNoticeGiven(g)}{g.detail ? ` (${def.detail?.label ?? "detail"}: ${g.detail})` : ""}{g.received ? `; received ${longDate(g.received)}` : ""}
          <Button variant="link" size="sm" onClick={undo} disabled={busy}>Undo</Button>
        </p>
        {error && <Notice className="mt-2">{error}</Notice>}
        {dialog}
      </div>
    );
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>{labels.button}</Button>
    );
  }

  return (
    <div className="rounded-md border border-line p-4">
      <FormField group label={labels.method}>
        <div className="inline-flex flex-wrap gap-0.5 rounded-md bg-surface-2 p-[3px]">
          {def.methods.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setMethod(k)} aria-pressed={method === k}
              className={`h-7 rounded-sm px-2.5 text-sm ${method === k ? "bg-canvas font-medium text-ink shadow-sm" : "text-ink-3 hover:text-ink"}`}>
              {label}
            </button>
          ))}
        </div>
      </FormField>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {def.toLabel && (
          <FormField label={def.toLabel}>
            <select className={input} value={to} onChange={(e) => setTo(e.target.value)}>
              {p.tenants.map((t) => <option key={t}>{t}</option>)}
            </select>
          </FormField>
        )}
        <FormField label={labels.date}>
          <input type="date" className={input} value={date} max={p.today} onChange={(e) => setDate(e.target.value)} />
        </FormField>
        {def.detail && (
          <div className="sm:col-span-2">
            <FormField label={def.detail.label}>
              <input className={input} value={detail} placeholder={def.detail.placeholder} onChange={(e) => setDetail(e.target.value)} />
            </FormField>
          </div>
        )}
        {def.received && method !== "email" && (
          <div className="sm:col-span-2">
            <FormField label={`Received by the tenant (${NOTICE_METHOD_LABEL[method]} delivery date)`}>
              <input type="date" className={input} value={received} min={date} max={p.today} onChange={(e) => setReceived(e.target.value)} />
            </FormField>
          </div>
        )}
      </div>
      {error && <Notice className="mt-3">{error}</Notice>}
      <div className="mt-4 flex gap-2">
        <Button variant="primary" onClick={save} disabled={busy || (!!def.detail?.required && !detail.trim())}>{busy ? "Saving..." : "Record it"}</Button>
        <Button onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
