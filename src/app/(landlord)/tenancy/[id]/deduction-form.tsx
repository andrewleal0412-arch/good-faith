"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { InfoTip } from "@/components/info-tip";
import { FormField } from "@/components/field";
import { FilePick } from "@/components/file-pick";
import { Money, Notice, inputClass, textareaClass } from "@/components/ui";
import { chargeable, defaultProration, suggestedLife, type Performer, type Proration, type Work } from "@/lib/deductions";
import { AFTER_PHOTOS_MAX, mb, notAPhoto, shrinkPhoto, UPLOAD_BUDGET, uploadError } from "@/lib/uploads";

type Finding = { id: string; room: string; item: string; classification: string; remedy: string };

const input = inputClass;

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
    // The same checks the server makes (src/app/api/tenancies/[id]/deductions/route.ts), with the same words.
    if (after.length > AFTER_PHOTOS_MAX) { setBusy(false); return setError(`Add at most ${AFTER_PHOTOS_MAX} after-repair photos.`); }
    if (receipt && receipt.type !== "application/pdf" && !receipt.type.startsWith("image/")) {
      setBusy(false);
      return setError(`${receipt.name} isn't a PDF or a photo. Add the receipt as a PDF or a photo.`);
    }
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

  // In its drawer: the fields scroll, and the amount with the save button stays pinned at the foot.
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!busy && !("error" in preview)) save(); }}>
      <Field label="What was done" group>
        <Segmented value={work} onChange={(w) => { setWork(w); setProration(defaultProration(w)); }}
          options={[["repair", "Repaired"], ["replace", "Replaced"], ["clean", "Cleaned"]]} />
      </Field>

      <Field label="Who did it" group>
        <Segmented value={performer} onChange={setPerformer} options={[["vendor", "A vendor"], ["own_labor", "You or your staff"]]} />
      </Field>

      {performer === "vendor" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Invoice total"><input className={input} inputMode="decimal" placeholder="1800" value={v.invoiceTotal} onChange={set("invoiceTotal")} /></Field>
          <Field label="Vendor name"><input className={input} value={v.vendorName} onChange={set("vendorName")} /></Field>
          <Field label="Vendor address"><input className={input} value={v.vendorAddress} onChange={set("vendorAddress")} /></Field>
          <Field label="Vendor phone"><input className={input} inputMode="tel" value={v.vendorPhone} onChange={set("vendorPhone")} /></Field>
          <Field label="Invoice or receipt (PDF or photo)">
            <FilePick label="Choose file" accept="application/pdf,image/*" files={receipt ? [receipt] : []} onChange={(f) => setReceipt(f[0] ?? null)} />
          </Field>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Hours"><input className={input} inputMode="decimal" placeholder="3" value={v.hours} onChange={set("hours")} /></Field>
          <Field label="Hourly rate"><input className={input} inputMode="decimal" placeholder="50" value={v.hourlyRate} onChange={set("hourlyRate")} /></Field>
          <div className="sm:col-span-2">
            <Field label="What you did">
              <textarea className={textareaClass} rows={2} placeholder="Degreased the range, oven door and control panel" value={v.laborDescription} onChange={set("laborDescription")} />
            </Field>
          </div>
        </div>
      )}

      <Field label="Why this work (optional)" hint={<InfoTip title="On the statement" cite="Civ. Code 1950.5(h)(2)(D)">Goes on the statement with the cost, as part of the written explanation.</InfoTip>}>
        <textarea className={textareaClass} rows={2} placeholder="Spot cleaning didn't lift the stain, so the carpet was replaced" value={v.note} onChange={set("note")} />
      </Field>

      <Field label="Prorate by age" group hint={<InfoTip title="DRE guidance, not statute">Useful-life proration and the paint schedule come from the DRE&apos;s California Tenants guide. A court may decide differently.</InfoTip>}>
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

      <Field label="After-repair photos" hint={<InfoTip title="Before and after" cite="Civ. Code 1950.5(g)(2)">Required for every repair or cleaning deduction.</InfoTip>}>
        <FilePick label="Add photos" icon="camera" accept="image/*" multiple files={after} onChange={setAfter} />
      </Field>
      <div className="flex items-center gap-1.5 text-sm text-ink-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-[15px]" checked={isEstimate} onChange={(e) => setIsEstimate(e.target.checked)} />
          Work not finished yet: deduct an estimate
        </label>
        <InfoTip title="Good-faith estimate" cite="Civ. Code 1950.5(h)(3)">Deduct a good-faith estimate now, then send the invoice within 14 days of finishing.</InfoTip>
      </div>

      {error && <Notice>{error}</Notice>}
      <div className="sticky -bottom-5 -mx-5 -mb-5 mt-6 border-t border-line-2 bg-canvas px-5 pb-4 pt-3.5">
        <div aria-live="polite" className="mb-3 min-h-[38px]">
          {"error" in preview ? (
            <p className="text-sm text-ink-3">{preview.error}</p>
          ) : (
            <>
              <p className="text-lg font-medium">Deduct <Money value={preview.amount} /></p>
              <p className="text-xs text-ink-3">{preview.math}{preview.guidance ? " (DRE guidance)" : ""}</p>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={busy || "error" in preview}>{busy ? "Saving..." : "Add deduction"}</Button>
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </form>
  );
}

function Field({ label, hint, group, children }: { label: string; hint?: React.ReactNode; group?: boolean; children: React.ReactNode }) {
  return <FormField label={label} hint={hint} group={group}>{children}</FormField>;
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex flex-wrap gap-0.5 rounded-md bg-surface-2 p-[3px]">
      {options.map(([k, label]) => (
        <button key={k} type="button" onClick={() => onChange(k)}
          className={`h-7 rounded-sm px-2.5 text-sm ${value === k ? "bg-canvas font-medium text-ink shadow-sm" : "text-ink-3 hover:text-ink"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}
