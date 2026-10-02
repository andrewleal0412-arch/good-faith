"use client";

import { useState } from "react";
import { chargeable, defaultProration, suggestedLife, usd, type Performer, type Proration, type Work } from "@/lib/deductions";
import { mb, notAPhoto, shrinkPhoto, UPLOAD_BUDGET, uploadError } from "@/lib/uploads";

type Finding = { id: string; room: string; item: string; classification: string; remedy: string };

const input = "w-full rounded-xl border border-line bg-bg px-3 py-2 text-[14px] outline-none focus:border-accent";

export function DeductionForm({ tenancyId, finding, onDone, onCancel }: {
  tenancyId: string; finding: Finding; onDone: () => void; onCancel: () => void;
}) {
  const startWork: Work = finding.remedy === "replace" ? "replace"
    : finding.remedy === "clean" || finding.classification === "cleaning" ? "clean" : "repair";
  const [work, setWork] = useState<Work>(startWork);
  const [performer, setPerformer] = useState<Performer>(finding.classification === "cleaning" ? "own_labor" : "vendor");
  const [proration, setProration] = useState<Proration>(defaultProration(startWork));
  const [v, setV] = useState({
    invoiceTotal: "", hours: "", hourlyRate: "", itemAgeYears: "", usefulLifeYears: String(suggestedLife(finding.item) ?? ""),
    vendorName: "", vendorAddress: "", vendorPhone: "", laborDescription: "", note: "",
  });
  const [isEstimate, setIsEstimate] = useState(false);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [after, setAfter] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const n = (s: string) => (s.trim() === "" ? null : Number(s));
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const preview = chargeable({
    category: finding.classification === "cleaning" ? "cleaning" : "damage", work, performer, proration,
    invoiceTotal: n(v.invoiceTotal), hours: n(v.hours), hourlyRate: n(v.hourlyRate),
    itemAgeYears: n(v.itemAgeYears), usefulLifeYears: n(v.usefulLifeYears),
  });

  async function save() {
    setBusy(true);
    setError("");
    const fd = new FormData();
    fd.append("findingId", finding.id);
    fd.append("work", work);
    fd.append("performer", performer);
    fd.append("proration", proration);
    fd.append("isEstimate", String(isEstimate));
    for (const [k, val] of Object.entries(v)) fd.append(k, val);
    // One deduction is one request, so its files are shrunk in the browser (a PDF receipt stays as it is) and the
    // total is checked against the host's body limit before anything is sent (src/lib/uploads.ts). A file the browser
    // can't decode is refused here rather than stored blind.
    const receiptFile = receipt && receipt.type.startsWith("image/") ? await shrinkPhoto(receipt) : receipt;
    if (receipt && !receiptFile) { setBusy(false); return setError(notAPhoto(receipt.name)); }
    const afterFiles: File[] = [];
    for (const f of after) {
      const s = await shrinkPhoto(f);
      if (!s) { setBusy(false); return setError(notAPhoto(f.name)); }
      afterFiles.push(s);
    }
    const bytes = (receiptFile?.size ?? 0) + afterFiles.reduce((s, f) => s + f.size, 0);
    if (bytes > UPLOAD_BUDGET) {
      setBusy(false);
      return setError(`The receipt and photos total ${mb(bytes)}; one deduction can carry ${mb(UPLOAD_BUDGET)}. Add fewer after-repair photos, or a smaller receipt.`);
    }
    if (receiptFile) fd.append("receipt", receiptFile);
    for (const f of afterFiles) fd.append("after", f);
    const r = await fetch(`/api/tenancies/${tenancyId}/deductions`, { method: "POST", body: fd });
    setBusy(false);
    if (!r.ok) return setError(await uploadError(r, "Couldn't save it.", "That receipt and those photos are too large for one request. Add fewer after-repair photos, or a smaller receipt."));
    onDone();
  }

  return (
    <div className="mt-4 space-y-4 rounded-xl border border-line p-4">
      <Field label="What was done">
        <Segmented value={work} onChange={(w) => { setWork(w); setProration(defaultProration(w)); }}
          options={[["repair", "Repaired"], ["replace", "Replaced"], ["clean", "Cleaned"]]} />
      </Field>

      <Field label="Who did it">
        <Segmented value={performer} onChange={setPerformer} options={[["vendor", "A vendor"], ["own_labor", "You or your staff"]]} />
      </Field>

      {performer === "vendor" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Invoice total"><input className={input} inputMode="decimal" placeholder="1800" value={v.invoiceTotal} onChange={set("invoiceTotal")} /></Field>
          <Field label="Vendor name"><input className={input} value={v.vendorName} onChange={set("vendorName")} /></Field>
          <Field label="Vendor address"><input className={input} value={v.vendorAddress} onChange={set("vendorAddress")} /></Field>
          <Field label="Vendor phone"><input className={input} inputMode="tel" value={v.vendorPhone} onChange={set("vendorPhone")} /></Field>
          <Field label="Invoice or receipt (PDF or photo)">
            <input type="file" accept="application/pdf,image/*" className="text-[13px]" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} />
          </Field>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Hours"><input className={input} inputMode="decimal" placeholder="3" value={v.hours} onChange={set("hours")} /></Field>
          <Field label="Hourly rate"><input className={input} inputMode="decimal" placeholder="50" value={v.hourlyRate} onChange={set("hourlyRate")} /></Field>
          <div className="sm:col-span-2">
            <Field label="What you did">
              <textarea className={input} rows={2} placeholder="Degreased the range, oven door and control panel" value={v.laborDescription} onChange={set("laborDescription")} />
            </Field>
          </div>
        </div>
      )}

      <Field label="Why this work (optional)" hint="Goes on the statement with the cost, as part of the written explanation (Civ. Code 1950.5(h)(2)(D))">
        <textarea className={input} rows={2} placeholder="Spot cleaning didn't lift the stain, so the carpet was replaced" value={v.note} onChange={set("note")} />
      </Field>

      <Field label="Prorate by age" hint="Guidance from the DRE's California Tenants guide, not the statute">
        <Segmented value={proration} onChange={setProration}
          options={[["none", "No"], ["useful_life", "Useful life"], ["paint_schedule", "Paint schedule"]]} />
      </Field>
      {proration === "useful_life" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Age when damaged (years)"><input className={input} inputMode="decimal" placeholder="6" value={v.itemAgeYears} onChange={set("itemAgeYears")} /></Field>
          <Field label="Useful life (years)"><input className={input} inputMode="decimal" placeholder="10" value={v.usefulLifeYears} onChange={set("usefulLifeYears")} /></Field>
        </div>
      )}
      {proration === "paint_schedule" && (
        <Field label="Years since it was last painted"><input className={input} inputMode="decimal" value={v.itemAgeYears} onChange={set("itemAgeYears")} /></Field>
      )}

      <Field label="After-repair photos" hint="Required for every repair or cleaning deduction (Civ. Code 1950.5(g)(2))">
        <input type="file" accept="image/*" multiple className="text-[13px]" onChange={(e) => setAfter(Array.from(e.target.files ?? []))} />
      </Field>
      <label className="flex items-start gap-2 text-[13px] text-ink-2">
        <input type="checkbox" className="mt-0.5" checked={isEstimate} onChange={(e) => setIsEstimate(e.target.checked)} />
        The work isn&apos;t finished yet. Deduct a good-faith estimate, then send the invoice within 14 days of finishing (1950.5(h)(3)).
      </label>

      <div className="rounded-xl bg-bg px-4 py-3">
        {"error" in preview ? (
          <p className="text-[13px] text-ink-3">{preview.error}</p>
        ) : (
          <>
            <p className="text-[15px] font-semibold">Deduct {usd(preview.amount)}</p>
            <p className="mt-0.5 text-[13px] text-ink-2">{preview.math}{preview.guidance ? " (DRE guidance)" : ""}</p>
          </>
        )}
      </div>
      {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-[13px] text-danger">{error}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={busy || "error" in preview}
          className="rounded-xl bg-accent px-4 py-2 text-[14px] font-semibold text-white disabled:opacity-40">
          {busy ? "Saving..." : "Add deduction"}
        </button>
        <button onClick={onCancel} className="rounded-xl px-4 py-2 text-[14px] text-ink-2">Cancel</button>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-3">{label}</p>
      {children}
      {hint && <p className="mt-1 text-[12px] text-ink-3">{hint}</p>}
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl bg-bg p-1">
      {options.map(([k, label]) => (
        <button key={k} type="button" onClick={() => onChange(k)}
          className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${value === k ? "bg-surface text-ink shadow-sm" : "text-ink-3"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}
