"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ButtonLink } from "@/components/button";
import { Icon } from "@/components/icons";
import { InfoTip } from "@/components/info-tip";
import { Card, CardHead, Money, Notice, Table, Td, Th, inlineInputClass, trClass } from "@/components/ui";
import { missingDocs, RECEIPT_THRESHOLD, settle, statementDue, usd, type StoredDeduction } from "@/lib/deductions";

const KIND = { rent: "Unpaid rent", damage: "Damage", cleaning: "Cleaning" } as const;

/** A short basis for the row ("Prorated, 4 of 10 years left", "Vendor invoice", "3 h × $50.00"), read from the stored
 *  math; the full math is the cell's title and is printed on the statement. */
function basis(d: StoredDeduction): string {
  if (d.category === "rent") return "Unpaid rent";
  const life = d.math.match(/× ([\d.]+) years? left of a ([\d.]+)-year useful life/);
  if (d.proration === "useful_life" && life) return `Prorated, ${life[1]} of ${life[2]} years left`;
  const paint = d.math.match(/× (full cost|nothing|two thirds|one third) \(paint/);
  if (d.proration === "paint_schedule" && paint) return `Paint schedule, ${paint[1]}`;
  const labor = d.math.match(/^([\d.]+) hours? × (\$[\d,.]+)\/hour/);
  if (labor) return `${labor[1]} h × ${labor[2]}`;
  return d.performer === "vendor" ? "Vendor invoice" : d.math;
}

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

// Deductions as Stripe's payment breakdown: item, basis, amount, and the refund total under them. The move-out date that
// starts the 21-day clock is set here; the itemized statement opens from the foot.
export function Settlement(p: {
  tenancyId: string;
  today: string;
  moveOutDate: string | null;
  depositHeld: number | null;
  refundTo: string | null;
  deductions: StoredDeduction[];
  returned: { amount: number; kind: string; id: string; at: string } | null;
  statement: { href: string; delivered: string | null }; // the itemized statement page, and how it went out once recorded
}) {
  const router = useRouter();
  const [date, setDate] = useState(p.moveOutDate ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function saveDate() {
    setBusy(true);
    setError("");
    const r = await fetch(`/api/tenancies/${p.tenancyId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ moveOutDate: date }),
    });
    setBusy(false);
    if (!r.ok) return setError((await r.json().catch(() => ({}))).error ?? "Couldn't save the date.");
    router.refresh();
  }

  const s = settle(p.depositHeld ?? 0, p.deductions);
  const due = p.moveOutDate ? statementDue(p.moveOutDate) : null;
  const daysLeft = due ? Math.round((Date.parse(due) - Date.parse(p.today)) / 86_400_000) : null;
  const missing = p.deductions.map((d) => [d, missingDocs(d, s.documentsRequired)] as const).filter(([, m]) => m.length);

  return (
    <Card>
      <CardHead title="Deductions" meta={`${p.deductions.length} item${p.deductions.length === 1 ? "" : "s"}`}
        right={<InfoTip align="end" title={s.documentsRequired ? "Receipts go with the statement" : `${usd(RECEIPT_THRESHOLD)} or less`}
          cite={s.documentsRequired ? "Civ. Code 1950.5(h)(2)" : "Civ. Code 1950.5(h)(4)-(5)"}>
          {s.documentsRequired
            ? `Repair and cleaning deductions total more than ${usd(RECEIPT_THRESHOLD)}, so invoices, receipts and labor details go with the statement.`
            : `Repair and cleaning deductions total ${usd(RECEIPT_THRESHOLD)} or less, so receipts aren't required, though the tenant can ask for them within 14 days.`}
        </InfoTip>} />

      <div className="flex flex-wrap items-center gap-2 border-b border-line-2 px-5 py-3 text-sm">
        <span className="text-ink-3">Moved out</span>
        {/* Once the deposit has gone back the date is part of the record, not something to edit. */}
        {p.returned && p.moveOutDate ? <span>{longDate(p.moveOutDate)}</span> : (
          <>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Move-out date" className={`${inlineInputClass} h-8`} />
            {date && date !== p.moveOutDate && <Button size="sm" variant="primary" onClick={saveDate} disabled={busy}>{busy ? "Saving..." : "Save"}</Button>}
          </>
        )}
        {due && daysLeft != null && !p.statement.delivered && (
          <span className={`inline-flex items-center gap-1.5 sm:ml-auto ${daysLeft < 0 ? "text-red" : "text-ink-3"}`}>
            Due {longDate(due)}, {daysLeft < 0 ? `${-daysLeft} day${daysLeft === -1 ? "" : "s"} late` : daysLeft === 0 ? "today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
            <InfoTip align="end" title="21 days after move-out" cite="Civ. Code 1950.5(h)(1)">The statement and the refund are due within 21 calendar days after the tenants leave.</InfoTip>
          </span>
        )}
      </div>
      {error && <Notice className="mx-5 mt-3">{error}</Notice>}

      {p.deductions.length ? (
        <Table>
          <thead>
            <tr>
              <Th first>Item</Th>
              <Th className="max-sm:hidden">
                <span className="inline-flex items-center gap-1.5">
                  Basis
                  <InfoTip title="What may be deducted" cite="Civ. Code 1950.5(b)(1)-(3), (h)(2)-(3)">
                    Unpaid rent, repair of damage beyond ordinary wear and tear, and cleaning back to move-in condition. Replacements are
                    prorated by the item&apos;s age; that proration and the paint schedule are DRE guidance, not statute. An estimate is
                    a good-faith figure whose invoice follows within 14 days of the work.
                  </InfoTip>
                </span>
              </Th>
              <Th last align="right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {p.deductions.map((d) => (
              <tr key={d.id} className={trClass}>
                <Td first>
                  <div className="font-medium">{d.item}</div>
                  <div className="text-xs text-ink-3">{[d.room, KIND[d.category]].filter(Boolean).join(", ")}</div>
                  <div className="mt-0.5 text-xs text-ink-3 sm:hidden" title={d.math}>{basis(d)}{d.is_estimate ? ", estimate" : ""}</div>
                </Td>
                <Td className="max-sm:hidden">
                  <div title={d.math}>{basis(d)}</div>
                  {d.is_estimate && <div className="text-xs text-amber">Estimate</div>}
                </Td>
                <Td last align="right"><Money value={Number(d.amount)} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <p className="px-5 py-4 text-sm text-ink-3">No deductions yet. Add them from the findings above.</p>
      )}

      <div className="flex justify-end border-t border-line px-5 pb-[18px] pt-3.5">
        <dl className="grid grid-cols-[auto_140px] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-right text-ink-3">Deposit held</dt><dd className="text-right">{p.depositHeld == null ? "--" : <Money value={p.depositHeld} />}</dd>
          <dt className="text-right text-ink-3">Deductions</dt><dd className="text-right"><Money value={s.total} sign={s.total ? "minus" : undefined} /></dd>
          <dt className="mt-0.5 border-t border-line pt-2 text-right font-medium text-ink">
            {s.balanceClaimed > 0 ? "Balance claimed" : p.returned ? `Refunded by PayPal` : "Refund due"}
          </dt>
          <dd className="mt-0.5 border-t border-line pt-2 text-right text-lg font-medium">
            <Money value={s.balanceClaimed > 0 ? s.balanceClaimed : p.returned ? p.returned.amount : s.refund} />
          </dd>
        </dl>
      </div>
      {/* Where it goes: the tenants' PayPal account before the refund, PayPal's own id after it. */}
      {(p.returned || (s.balanceClaimed <= 0 && p.refundTo)) && (
        <p className="-mt-2 break-all px-5 pb-3 text-right text-xs text-ink-3">
          {p.returned ? `${p.returned.kind === "payout" ? "Payout" : "Refund"} ${p.returned.id}, ${longDate(p.returned.at.slice(0, 10))}` : `To ${p.refundTo}`}
        </p>
      )}
      {s.balanceClaimed > 0 && (
        <p className="-mt-2 flex items-center justify-end gap-1.5 px-5 pb-3 text-xs text-ink-3">
          A claim, not a demand
          <InfoTip align="end" title="Balance claimed">The statement lists this as a claim, not a demand for payment. The agent never collects it on its own.</InfoTip>
        </p>
      )}

      {missing.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-line-2 px-5 py-3">
          {missing.map(([d, m]) => <p key={d.id} className="text-xs text-amber">{d.item}: still needs {m.join(", ")}</p>)}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-line-2 px-5 py-3.5">
        <ButtonLink href={p.statement.href}><Icon name="doc" />Itemized statement</ButtonLink>
        <span className="text-sm text-ink-3">{p.statement.delivered ? `Delivered by ${p.statement.delivered}` : "With photos and invoices, ready to deliver"}</span>
      </div>
    </Card>
  );
}
