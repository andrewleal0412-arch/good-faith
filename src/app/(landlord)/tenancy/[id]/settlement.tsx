"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { InfoTip } from "@/components/info-tip";
import { Card, CardHead, Money, Notice, Table, Td, Th, trClass } from "@/components/ui";
import { basisOf, missingDocs, RECEIPT_THRESHOLD, settle, usd, type StoredDeduction } from "@/lib/deductions";
import { findingTitle } from "@/lib/findings";

/** A wear-and-tear finding, listed at $0.00 so the tenant sees what was looked at and not charged. */
export type WearRow = { id: string; n: number; item: string; full: string; room: string; photos: number };

// Deductions as Stripe's payment breakdown: Item (with its finding number and room), Evidence (photos and the invoice or labor
// record behind it), Basis (one short line, the full math as its tooltip) and Amount, then Deposit held, Deductions
// and Refund due. Wear and tear is listed at $0.00 and is never charged. Edit opens a Remove on each row until the
// deposit has gone back.
export function Settlement(p: {
  tenancyId: string;
  depositHeld: number | null;
  deductions: StoredDeduction[];
  numbers: Record<string, number>; // finding id to its number on the page
  wear: WearRow[];
  returned: { amount: number; kind: string; id: string; at: string } | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function remove(id: string) {
    setBusy(id);
    setError("");
    const r = await fetch(`/api/tenancies/${p.tenancyId}/deductions/${id}`, { method: "DELETE" });
    setBusy(null);
    if (!r.ok) setError((await r.json().catch(() => ({}))).error ?? "Couldn't remove it.");
    router.refresh();
  }

  const s = settle(p.depositHeld ?? 0, p.deductions);
  const locked = !!p.returned;
  const num = (d: StoredDeduction) => (d.finding?.id ? p.numbers[d.finding.id] : undefined);
  // Rows in finding order, so the table reads in the same order as the cards above; anything without a finding last.
  const rows = [
    ...p.deductions.map((d) => ({ kind: "d" as const, d, n: num(d) ?? 1e6 })),
    ...p.wear.map((w) => ({ kind: "w" as const, w, n: w.n })),
  ].sort((a, b) => a.n - b.n);

  return (
    <Card>
      <CardHead title="Deductions"
        right={!locked && p.deductions.length > 0 ? (
          <button type="button" onClick={() => setEditing((v) => !v)} className="text-sm text-brand hover:underline">{editing ? "Done" : "Edit"}</button>
        ) : undefined} />
      {error && <Notice className="mx-5 mt-3">{error}</Notice>}

      {rows.length ? (
        <Table>
          <thead>
            <tr>
              <Th first>Item</Th>
              <Th className="max-md:hidden">Evidence</Th>
              <Th className="max-sm:hidden">
                <span className="inline-flex items-center gap-1.5">
                  Basis
                  {/* One tip for the table: what may be deducted, and what has to go with it (the receipt rule). */}
                  <InfoTip title="What may be deducted"
                    cite={`Civ. Code 1950.5(b)(1)-(3), (h)(2)-(3); ${s.documentsRequired ? "(g)(2), (h)(2)" : "(g)(2), (h)(4)-(5)"}`}>
                    Unpaid rent, repair of damage beyond ordinary wear and tear, and cleaning back to move-in condition. Replacements are
                    prorated by the item&apos;s age; that proration and the paint schedule are DRE guidance, not statute. An estimate is
                    a good-faith figure whose invoice follows within 14 days of the work.
                    <span className="mt-1.5 block">
                      {s.documentsRequired
                        ? `Repair and cleaning total more than ${usd(RECEIPT_THRESHOLD)}, so invoices, receipts and labor details go with the statement, with the before and after photos.`
                        : `Repair and cleaning total ${usd(RECEIPT_THRESHOLD)} or less, so receipts aren't required, though the tenant can ask for them within 14 days. The before and after photos still go with it.`}
                    </span>
                  </InfoTip>
                </span>
              </Th>
              <Th last align="right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              if (r.kind === "w") {
                return (
                  <tr key={`w-${r.w.id}`} className={trClass}>
                    <Td first>
                      <div className="text-ink-3" title={r.w.full}>{r.w.item}</div>
                      <div className="text-xs text-ink-3">Finding {r.w.n}, {r.w.room}</div>
                      <div className="mt-0.5 text-xs text-ink-3 sm:hidden">Ordinary wear and tear, not deductible</div>
                    </Td>
                    <Td className="text-ink-3 max-md:hidden">{r.w.photos} photo{r.w.photos === 1 ? "" : "s"}</Td>
                    <Td className="max-sm:hidden"><div className="text-ink-3">Ordinary wear and tear</div><div className="text-xs text-ink-3">Not deductible</div></Td>
                    <Td last align="right" className="text-ink-3"><Money value={0} /></Td>
                  </tr>
                );
              }
              const d = r.d;
              const b = basisOf(d);
              const n = num(d);
              const photos = (d.finding?.moveInPath ? 1 : 0) + (d.finding?.moveOutPath ? 1 : 0) + (d.after_photo_paths?.length ?? 0);
              const paper = d.category === "rent" ? null : d.performer === "vendor"
                ? (d.receipt_path ? "vendor invoice" : d.is_estimate ? "estimate" : null)
                : d.labor_description ? "labor record" : null;
              const missing = missingDocs(d, s.documentsRequired);
              const evidenceSub = d.performer === "vendor" ? d.vendor?.name ?? null : d.category === "rent" ? null : "Your labor";
              return (
                <tr key={d.id} className={trClass}>
                  <Td first>
                    <div className="font-medium" title={d.item}>{d.finding ? findingTitle({ item: d.item, label: (d.finding as { label?: string | null }).label }) : d.item}</div>
                    <div className="text-xs text-ink-3">{n ? `Finding ${n}${d.room ? `, ${d.room}` : ""}` : d.room ?? (d.category === "rent" ? "Rent" : "")}</div>
                    <div className="mt-0.5 text-xs text-ink-3 sm:hidden" title={d.math}>{b.main}{d.is_estimate ? ", estimate" : ""}</div>
                    {missing.length > 0 && <div className="mt-0.5 text-xs text-amber md:hidden">Needs {missing.join(", ")}</div>}
                  </Td>
                  <Td className="max-md:hidden">
                    <div>{d.category === "rent" ? "Lease and rent ledger" : `${photos} photo${photos === 1 ? "" : "s"}${paper ? `, ${paper}` : ""}`}</div>
                    {missing.length > 0
                      ? <div className="text-xs text-amber">Needs {missing.join(", ")}</div>
                      : evidenceSub && <div className="text-xs text-ink-3">{evidenceSub}</div>}
                  </Td>
                  <Td className="max-sm:hidden">
                    <div title={d.math}>{b.main}</div>
                    <div className="text-xs text-ink-3">{b.sub}{d.is_estimate && <span className="text-amber">, estimate</span>}</div>
                  </Td>
                  <Td last align="right">
                    <Money value={Number(d.amount)} />
                    {editing && !locked && (
                      <button type="button" onClick={() => remove(d.id)} disabled={busy === d.id}
                        className="mt-0.5 block w-full text-right text-xs font-medium text-brand hover:underline disabled:opacity-50">
                        {busy === d.id ? "Removing..." : "Remove"}
                      </button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <p className="px-5 py-4 text-sm text-ink-3">No deductions yet. Add them from the findings above.</p>
      )}

      <div className="flex justify-end border-t border-line px-5 pb-[18px] pt-3.5">
        <dl className="grid grid-cols-[auto_120px] gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[auto_140px]">
          <dt className="text-right text-ink-3">Deposit held</dt><dd className="text-right">{p.depositHeld == null ? "--" : <Money value={p.depositHeld} />}</dd>
          <dt className="text-right text-ink-3">Deductions</dt><dd className="text-right"><Money value={s.total} sign={s.total ? "minus" : undefined} /></dd>
          <dt className="mt-0.5 border-t border-line pt-2 text-right font-medium leading-6 text-ink">
            {s.balanceClaimed > 0 ? "Balance claimed" : p.returned ? "Refunded" : "Refund due"}
          </dt>
          <dd className="mt-0.5 border-t border-line pt-2 text-right text-lg font-medium">
            <Money value={s.balanceClaimed > 0 ? s.balanceClaimed : p.returned ? p.returned.amount : s.refund} />
          </dd>
        </dl>
      </div>
      {s.balanceClaimed > 0 && (
        <p className="-mt-2 flex items-center justify-end gap-1.5 px-5 pb-3 text-xs text-ink-3">
          A claim, not a demand
          <InfoTip align="end" title="Balance claimed">The statement lists this as a claim, not a demand for payment. The agent never collects it on its own.</InfoTip>
        </p>
      )}
    </Card>
  );
}
