import { atText, pacificDate, paypalPaidAt, shortDate } from "./dates";
import { usd } from "./deductions";
import { paidElectronically, returnCompleted, returnFailed, wasPaid } from "./invoice-status";
import { lawfulDeposit, type LeaseTerms } from "./rules";
import { packFor } from "./states";
import type { ClientPack } from "./states/types";

// The landlord's deposit ledger: one row per money event or deduction, with the part of the tenancy's state law that
// applies to it (California: the subsection of Civ. Code 1950.5, e.g. (h)(1); other states: the full citation), so
// the grid can filter on it and the CSV can go to an accountant or a small claims clerk as it is. Pure, so the grid
// (in the browser) and the tenancy page (on the server) read the same rows. The database query is in ledger-load.ts.

export type LedgerKind = "deposit_invoice" | "payment" | "deduction" | "refund" | "payout" | "damage_invoice" | "settlement";

export const KIND_LABEL: Record<LedgerKind, string> = {
  deposit_invoice: "Deposit invoice",
  payment: "Payment",
  deduction: "Deduction",
  refund: "Refund",
  payout: "Payout",
  damage_invoice: "Balance invoice",
  settlement: "Settlement",
};

/** What a row does to the money held for the tenants, which is what the totals add up. The security stays the
 *  tenants' until the statement claims part of it (1950.5(e)(1), (h)(1)), so a draft deduction takes nothing out
 *  yet, and a refund PayPal refused moved nothing. */
export type LedgerEffect =
  | "collected" // a payment received
  | "claimed" // a deduction once the statement went out (one added later is flagged in its status) or the refund did
  | "draft" // a deduction while no statement has gone out
  | "returned" // a refund or payout PayPal completed
  | "pending" // a refund or payout PayPal is still processing: it has left the landlord, not yet reached the tenants
  | "failed" // a refund or payout that did not go through
  | "none"; // an invoice: nothing has moved

export type LedgerRow = {
  id: string;
  date: string; // YYYY-MM-DD, Pacific
  at: string; // the timestamp, for ordering within a day
  tenancyId: string;
  unit: string; // the street line, e.g. "482 N. Glassell St, Unit B"
  address: string; // the whole address, for the tooltip and the CSV
  tenants: string;
  kind: LedgerKind;
  type: string; // KIND_LABEL[kind]: the word the grid shows and filters on
  detail: string; // the full sentence, for the tooltip, the search and the CSV
  summary: string; // the same in a few words, for a table cell (the tenancy's Payments tab)
  amount: number; // always positive; `signed` says which way it went
  signed: number; // money in is positive, money claimed or returned is negative, zero when nothing has moved
  effect: LedgerEffect;
  paypalId: string | null;
  method: string | null; // how the money moved, in words ("PayPal", "Credit card"); null for a deduction
  status: string; // plain words
  tag: string; // California: the Civ. Code 1950.5 subsection, e.g. (b)(2); other states: the full citation
  tagShort: string; // a word or two beside the tag, e.g. "damage"
  tagLabel: string; // what the subsection says, in a sentence
  example?: boolean; // a demo copy's recorded settlement: history only, no PayPal money moved
  fromPayPal?: string; // when PayPal itself reported this status (its webhook, src/lib/paypal-webhook.ts)
};

export type LedgerTenancy = {
  id: string;
  tenants: { name: string }[];
  monthly_rent: number | string | null;
  move_out_date: string | null;
  statement_delivered_at: string | null;
  lease_terms: LeaseTerms | null;
  properties: { address: string; city: string | null; state?: string | null } | null;
};
export type LedgerPayment = {
  id: string;
  kind: string;
  paypal_id: string | null;
  amount: number | string;
  status: string;
  created_at: string;
  raw: {
    transactions?: { payment_id?: string; payment_date_time?: string; payment_date?: string; method?: string; transaction_status?: string; amount?: { value?: string } }[];
    demo_example?: boolean;
    status_from?: { source?: string; at?: string }; // a status PayPal's webhook sent
    reversal?: { at?: string | null }; // the deposit payment reversed by PayPal (a chargeback)
  } | null;
};
export type LedgerDeduction = {
  id: string;
  category: "rent" | "damage" | "cleaning";
  room: string | null;
  item: string;
  amount: number | string;
  is_estimate: boolean;
  created_at: string;
};

/** A PayPal status in words; a payout item PayPal holds ("ONHOLD", its own word) reads "on hold". */
const words = (s: string | null | undefined) => (s === "ONHOLD" ? "on hold" : (s ?? "").toLowerCase().replace(/_/g, " "));
const cents = (n: number) => Math.round(n * 100) / 100;
const ms = (ts: string) => Date.parse(ts);

/** The street line of an address: the lease spells out "..., Orange, CA 92866" (or any state's two letters), which
 *  the tooltip and the CSV keep. */
export const streetLine = (address: string) => address.replace(/,\s*[^,]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?\s*$/i, "");

/** A row's tag as a full citation, for its tooltip: California's subsections read "Civ. Code 1950.5(h)(1)". */
export const tagCite = (r: Pick<LedgerRow, "tag">) => (r.tag.startsWith("(") ? `Civ. Code 1950.5${r.tag}` : r.tag);

/** PayPal's payment method codes in plain words (the landlord enters CASH or CHECK when marking an invoice paid). */
const METHOD_WORDS: Record<string, string> = {
  PAYPAL: "PayPal", BANK_TRANSFER: "bank transfer", CREDIT_CARD: "credit card", DEBIT_CARD: "debit card", WIRE_TRANSFER: "wire transfer",
  CASH: "cash", CHECK: "check", OTHER: "another method",
};
const methodWords = (m: string | null | undefined) => (m ? METHOD_WORDS[m] ?? words(m) : "");
const methodLabel = (m: string | null | undefined) => { const w = methodWords(m) || "PayPal"; return w.charAt(0).toUpperCase() + w.slice(1); };

/** PayPal's invoice statuses in plain words. After a refund PayPal says PARTIALLY_REFUNDED, which to a tenant sounds
 *  like a short refund; it was the lawful one after the itemized deductions, and the refund row carries the amount. */
const INVOICE_WORDS: Record<string, string> = {
  PAID: "paid", MARKED_AS_PAID: "marked as paid", PARTIALLY_REFUNDED: "paid, refund sent", REFUNDED: "paid, refunded in full",
  SENT: "sent, not paid", UNPAID: "sent, not paid", PAYMENT_PENDING: "payment pending",
};
const invoiceWords = (status: string) => INVOICE_WORDS[status] ?? words(status);

const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/** The same in a few words: "1 day after move-out", "23 days after move-out, late". */
function timingShort(moveOut: string | null, date: string, pack: ClientPack): string {
  if (!moveOut) return "";
  const n = dayDiff(moveOut, date);
  if (n < 0) return "before move-out";
  const allowed = pack.deadline.ledgerAllowed;
  return `${n} day${n === 1 ? "" : "s"} after move-out${allowed != null && n > allowed ? ", late" : ""}`;
}

/** How long after the move-out the money went back, against the days the state allows (California (h)(1): 21). A state
 *  whose deadline turns on more than the move-out (Florida's claim track) gets the days alone. */
function timing(moveOut: string | null, date: string, pack: ClientPack): string {
  if (!moveOut) return "";
  const n = dayDiff(moveOut, date);
  if (n < 0) return ", before the move-out date on record";
  const allowed = pack.deadline.ledgerAllowed;
  return `, ${n} day${n === 1 ? "" : "s"} after the ${shortDate(moveOut)} move-out${allowed == null ? "" : n > allowed ? ` and past the ${allowed} allowed` : ` (${allowed} allowed)`}`;
}

/** When PayPal's webhook reported a row's status: the moment, for the row's mark and its sentence. Absent otherwise,
 *  so a row nothing reported reads exactly as before. */
function reported(raw: LedgerPayment["raw"]): { fromPayPal?: string } {
  const s = raw?.status_from;
  return s?.source === "paypal" && typeof s.at === "string" && !Number.isNaN(Date.parse(s.at)) ? { fromPayPal: s.at } : {};
}
const withMark = (detail: string, mark: { fromPayPal?: string }) => (mark.fromPayPal ? `${detail}; status from PayPal, ${atText(mark.fromPayPal)}` : detail);

/** Every ledger row for one tenancy, oldest first. */
export function ledgerRows(t: LedgerTenancy, payments: LedgerPayment[], deductions: LedgerDeduction[]): LedgerRow[] {
  const address = t.properties?.address ?? t.lease_terms?.propertyAddress ?? "Address not recorded";
  const tenants = (t.tenants ?? []).map((x) => x.name).join(" and ") || "No tenants named";
  const base = { tenancyId: t.id, unit: streetLine(address), address, tenants };
  const pack = packFor(t.properties?.state);
  const lawful = t.lease_terms ? lawfulDeposit(t.lease_terms, pack) : null;
  const rent = t.monthly_rent == null ? null : Number(t.monthly_rent);
  const rows: LedgerRow[] = [];
  const row = (r: Omit<LedgerRow, keyof typeof base | "type">) => rows.push({ ...base, ...r, type: KIND_LABEL[r.kind] });

  for (const p of payments) {
    const amount = Number(p.amount);
    const date = pacificDate(p.created_at);
    if (p.kind === "deposit_invoice") {
      // The cap the invoice was held to (California: two months only for the small natural-person owner, D3, D4).
      const cap = pack.ledger.capTag(lawful, rent);
      const mark = reported(p.raw);
      row({
        id: p.id, date, at: p.created_at, kind: "deposit_invoice", amount, signed: 0, effect: "none", paypalId: p.paypal_id, method: "PayPal",
        detail: withMark(lawful && lawful.charged > lawful.amount
          ? `PayPal invoice for the lawful amount; the lease asked ${usd(lawful.charged)}`
          : "PayPal invoice for the security deposit", mark),
        summary: lawful && lawful.charged > lawful.amount ? "Capped at the lawful amount" : "Security deposit",
        status: invoiceWords(p.status), ...cap, ...mark,
      });
      // The tenants' payment, from the invoice's transaction record: PayPal's own id, date and method. It is dated as
      // PayPal dates it (the statement says the same) and ordered after its invoice even when PayPal's clock puts the
      // payment earlier than the invoice was stored, as the sandbox does. A paid invoice with no transaction detail
      // still counts as collected, as the statement counts it.
      if (wasPaid(p.status)) {
        const txn = p.raw?.transactions?.[0];
        const paidAt = paypalPaidAt(txn) ?? p.created_at;
        const paid = txn?.amount?.value ? Number(txn.amount.value) : amount;
        const electronic = paidElectronically(p.status, txn?.method);
        const method = methodWords(txn?.method) || "a method PayPal did not record";
        const onInvoice = p.paypal_id ? ` on invoice ${p.paypal_id}` : "";
        // PayPal reversed the payment (a chargeback): the money left the landlord again, so it no longer counts as held.
        const reversed = !!p.raw?.reversal;
        const mark = reported(p.raw);
        row({
          id: `${p.id}:paid`, date: pacificDate(paidAt), at: new Date(Math.max(ms(paidAt), ms(p.created_at))).toISOString(),
          kind: "payment", amount: paid, signed: reversed ? 0 : paid, effect: reversed ? "failed" : "collected", paypalId: txn?.payment_id ?? p.paypal_id, method: methodLabel(txn?.method),
          detail: withMark((!txn ? `Deposit paid${onInvoice}; PayPal recorded no transaction detail`
            : electronic ? `Deposit paid by ${method}${onInvoice}` : `Deposit recorded as paid by ${method}${onInvoice}`)
            + (reversed ? `; PayPal reversed the payment${p.raw?.reversal?.at ? ` on ${shortDate(pacificDate(p.raw.reversal.at))}` : ""}` : ""), mark),
          summary: reversed ? "Reversed by PayPal" : txn ? `Paid by ${method}` : "Paid",
          status: reversed ? "reversed" : "received",
          ...pack.ledger.paymentTag(electronic), ...mark,
        });
      }
    } else if (p.kind === "refund" || p.kind === "payout") {
      const effect: LedgerEffect = returnCompleted(p.status) ? "returned" : returnFailed(p.status) ? "failed" : "pending";
      const mark = reported(p.raw);
      row({
        id: p.id, date, at: p.created_at, kind: p.kind, amount, signed: effect === "failed" ? 0 : -amount, effect, paypalId: p.paypal_id, method: "PayPal",
        detail: withMark((p.kind === "refund" ? "Refund of the original PayPal payment" : "PayPal Payout to the account the tenants designated") + timing(t.move_out_date, date, pack), mark),
        summary: [p.kind === "refund" ? "To the original payment" : "To the tenants' account", timingShort(t.move_out_date, date, pack)].filter(Boolean).join(", "),
        status: effect === "returned" ? (p.kind === "refund" ? "completed" : "sent") : words(p.status),
        ...pack.ledger.refundTag, ...mark,
      });
    } else if (p.kind === "settlement_refund" || p.kind === "settlement_payout") {
      // The extra amount a settled dispute sent back, on top of the statement's refund, after the tenants accepted it
      // and the landlord approved it.
      const effect: LedgerEffect = returnCompleted(p.status) ? "returned" : returnFailed(p.status) ? "failed" : "pending";
      const refund = p.kind === "settlement_refund";
      // A demo copy's recorded settlement (its closed unit's history): counted as the amended statement counts it, but
      // nothing went through PayPal, and the row says so.
      if (p.raw?.demo_example === true) {
        row({
          id: p.id, date, at: p.created_at, kind: "settlement", amount, signed: -amount, effect: "returned", paypalId: null, method: null, example: true,
          detail: "Settlement of the tenants' dispute, on top of the statement's refund: the demo's recorded example, so no PayPal money moved for it",
          summary: "Dispute settled, demo example",
          status: "demo example",
          ...pack.ledger.refundTag,
        });
        continue;
      }
      const mark = reported(p.raw);
      row({
        id: p.id, date, at: p.created_at, kind: "settlement", amount, signed: effect === "failed" ? 0 : -amount, effect, paypalId: p.paypal_id, method: "PayPal",
        detail: withMark(`Settlement of the tenants' dispute: ${refund ? "a partial refund of the original PayPal payment" : "a PayPal Payout to the account the tenants designated"}, on top of the statement's refund${timing(t.move_out_date, date, pack)}`, mark),
        summary: refund ? "Dispute settled, to the original payment" : "Dispute settled, to the tenants' account",
        status: effect === "returned" ? (refund ? "completed" : "sent") : words(p.status),
        ...pack.ledger.refundTag, ...mark,
      });
    } else if (p.kind === "damage_invoice") {
      row({
        id: p.id, date, at: p.created_at, kind: "damage_invoice", amount, signed: 0, effect: "none", paypalId: p.paypal_id, method: "PayPal",
        detail: pack.ledger.balanceTag.detail,
        summary: "Balance over the deposit, a claim",
        status: invoiceWords(p.status),
        tag: pack.ledger.balanceTag.tag, tagShort: pack.ledger.balanceTag.tagShort, tagLabel: pack.ledger.balanceTag.tagLabel,
      });
    }
  }

  // Deductions are drafts until the statement goes out; from then on they count against what is held, as the units
  // page, the statement and the refund math count them, and they are final once a refund or payout went out (the
  // routes refuse changes then). One added after the delivery was never on the statement furnished, so its status says so.
  const final = payments.some((p) => (p.kind === "refund" || p.kind === "payout") && !returnFailed(p.status));
  const delivered = t.statement_delivered_at ? ms(t.statement_delivered_at) : null;
  for (const d of deductions) {
    const amount = Number(d.amount);
    const onStatement = delivered != null && ms(d.created_at) <= delivered;
    const claimed = delivered != null || final;
    row({
      id: d.id, date: pacificDate(d.created_at), at: d.created_at, kind: "deduction", amount, signed: claimed ? -amount : 0,
      effect: claimed ? "claimed" : "draft", paypalId: null, method: null,
      detail: `${d.item}${d.room ? ` (${d.room})` : ""}`,
      summary: `${d.item}${d.room ? ` (${d.room})` : ""}`,
      status: d.is_estimate ? "good-faith estimate" : onStatement ? "on the statement" : final ? "final" : delivered != null ? "added after the statement" : "draft",
      tag: pack.tags[d.category].tag, tagShort: pack.tags[d.category].short, tagLabel: pack.tags[d.category].label,
    });
  }

  // A stable sort, so a payment stored in the same instant as its invoice stays after it.
  return rows.sort((a, b) => ms(a.at) - ms(b.at));
}

export type LedgerTotals = {
  collected: number;
  deducted: number; // every deduction showing, drafts included
  drafted: number; // the part of `deducted` not on any statement yet
  returned: number; // refunds and payouts PayPal completed
  pending: number; // refunds and payouts still in flight
  held: number;
  count: number;
};

/** What a set of rows adds up to. "Still held" is what the landlord still has of the tenants' money: collected, less
 *  the deductions on a statement that went out and less what went back or is on its way back. Drafts take nothing
 *  out yet (the units page counts the same way), and a refund PayPal refused moved nothing. Each tenancy is clamped
 *  at zero on its own, as settle() in deductions.ts does: deductions past one deposit are a claim on those tenants,
 *  never money taken from another unit's. */
export function ledgerTotals(rows: LedgerRow[]): LedgerTotals {
  const sum = (effect: LedgerEffect, xs: LedgerRow[] = rows) => cents(xs.filter((r) => r.effect === effect).reduce((s, r) => s + r.amount, 0));
  // A settlement's money came out of what the statement deducted: the deductions as settled are that much less, and it
  // is counted once, as money returned.
  const settled = (xs: LedgerRow[]) => cents(xs.filter((r) => r.kind === "settlement" && (r.effect === "returned" || r.effect === "pending")).reduce((s, r) => s + r.amount, 0));
  const byTenancy = new Map<string, LedgerRow[]>();
  for (const r of rows) byTenancy.set(r.tenancyId, [...(byTenancy.get(r.tenancyId) ?? []), r]);
  let held = 0;
  for (const xs of byTenancy.values()) held += Math.max(0, cents(sum("collected", xs) - (sum("claimed", xs) - settled(xs)) - sum("returned", xs) - sum("pending", xs)));
  const claimed = sum("claimed"), drafted = sum("draft");
  return { collected: sum("collected"), deducted: cents(claimed + drafted - settled(rows)), drafted, returned: sum("returned"), pending: sum("pending"), held: cents(held), count: rows.length };
}

/** What a tenancy's rows say is still owed back to its tenants: the deposit collected less every deduction, drafts
 *  included (the refund the close-out would send), while no refund or payout has gone out. Zero once one has, or when
 *  the deductions use the whole deposit. */
export function owedBack(rows: LedgerRow[]): number {
  if (rows.some((r) => (r.kind === "refund" || r.kind === "payout") && r.effect !== "failed")) return 0;
  const collected = rows.filter((r) => r.effect === "collected").reduce((s, r) => s + r.amount, 0);
  const deducted = rows.filter((r) => r.kind === "deduction").reduce((s, r) => s + r.amount, 0);
  return Math.max(0, cents(collected - deducted));
}
