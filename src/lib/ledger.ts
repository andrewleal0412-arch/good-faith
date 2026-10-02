import { TAGS } from "./copy";
import { pacificDate, shortDate } from "./dates";
import { usd } from "./deductions";
import { paidElectronically, returnCompleted, returnFailed, wasPaid } from "./invoice-status";
import { lawfulDeposit, type LeaseTerms } from "./rules";

// The landlord's deposit ledger: one row per money event or deduction, with the subsection of Civ. Code 1950.5 that
// applies to it, so the grid can filter on it and the CSV can go to an accountant or a small claims clerk as it is.
// Pure, so the grid (in the browser) and the tenancy page (on the server) read the same rows. The database query is
// in ledger-load.ts.

export type LedgerKind = "deposit_invoice" | "payment" | "deduction" | "refund" | "payout" | "damage_invoice";

export const KIND_LABEL: Record<LedgerKind, string> = {
  deposit_invoice: "Deposit invoice",
  payment: "Payment",
  deduction: "Deduction",
  refund: "Refund",
  payout: "Payout",
  damage_invoice: "Balance invoice",
};

/** The chip for each kind, in the app's tokens: money in is green, what is kept is amber, money back and invoices
 *  are neutral (status colors only, one indigo for actions). */
export const KIND_TONE: Record<LedgerKind, string> = {
  deposit_invoice: "bg-surface-2 text-ink-2",
  payment: "bg-green-bg text-green",
  deduction: "bg-amber-bg text-amber",
  refund: "bg-surface-2 text-ink-2",
  payout: "bg-surface-2 text-ink-2",
  damage_invoice: "bg-red-bg text-red",
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
  detail: string;
  amount: number; // always positive; `signed` says which way it went
  signed: number; // money in is positive, money claimed or returned is negative, zero when nothing has moved
  effect: LedgerEffect;
  paypalId: string | null;
  status: string; // plain words
  tag: string; // the Civ. Code 1950.5 subsection, e.g. (b)(2)
  tagShort: string; // a word or two beside the tag, e.g. "damage"
  tagLabel: string; // what the subsection says, in a sentence
};

export type LedgerTenancy = {
  id: string;
  tenants: { name: string }[];
  monthly_rent: number | string | null;
  move_out_date: string | null;
  statement_delivered_at: string | null;
  lease_terms: LeaseTerms | null;
  properties: { address: string; city: string | null } | null;
};
export type LedgerPayment = {
  id: string;
  kind: string;
  paypal_id: string | null;
  amount: number | string;
  status: string;
  created_at: string;
  raw: { transactions?: { payment_id?: string; payment_date_time?: string; payment_date?: string; method?: string; transaction_status?: string; amount?: { value?: string } }[] } | null;
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

const words = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/_/g, " ");
const cents = (n: number) => Math.round(n * 100) / 100;
const ms = (ts: string) => Date.parse(ts);

/** The street line of an address: the lease spells out "..., Orange, CA 92866", which the tooltip and the CSV keep. */
export const streetLine = (address: string) => address.replace(/,\s*[^,]+,\s*CA\s*\d{5}(?:-\d{4})?\s*$/i, "");

/** PayPal's payment method codes in plain words (the landlord enters CASH or CHECK when marking an invoice paid). */
const METHOD_WORDS: Record<string, string> = {
  PAYPAL: "PayPal", BANK_TRANSFER: "bank transfer", CREDIT_CARD: "credit card", DEBIT_CARD: "debit card", WIRE_TRANSFER: "wire transfer",
  CASH: "cash", CHECK: "check", OTHER: "another method",
};
const methodWords = (m: string | null | undefined) => (m ? METHOD_WORDS[m] ?? words(m) : "");

/** PayPal's invoice statuses in plain words. After a refund PayPal says PARTIALLY_REFUNDED, which to a tenant sounds
 *  like a short refund; it was the lawful one after the itemized deductions, and the refund row carries the amount. */
const INVOICE_WORDS: Record<string, string> = {
  PAID: "paid", MARKED_AS_PAID: "marked as paid", PARTIALLY_REFUNDED: "paid, refund sent", REFUNDED: "paid, refunded in full",
  SENT: "sent, not paid", UNPAID: "sent, not paid", PAYMENT_PENDING: "payment pending",
};
const invoiceWords = (status: string) => INVOICE_WORDS[status] ?? words(status);

const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/** How long after the move-out the money went back, against the 21 days (h)(1) allows. */
function timing(moveOut: string | null, date: string): string {
  if (!moveOut) return "";
  const n = dayDiff(moveOut, date);
  if (n < 0) return ", before the move-out date on record";
  return `, ${n} day${n === 1 ? "" : "s"} after the ${shortDate(moveOut)} move-out${n > 21 ? " and past the 21 allowed" : " (21 allowed)"}`;
}

/** Every ledger row for one tenancy, oldest first. */
export function ledgerRows(t: LedgerTenancy, payments: LedgerPayment[], deductions: LedgerDeduction[]): LedgerRow[] {
  const address = t.properties?.address ?? t.lease_terms?.propertyAddress ?? "Address not recorded";
  const tenants = (t.tenants ?? []).map((x) => x.name).join(" and ") || "No tenants named";
  const base = { tenancyId: t.id, unit: streetLine(address), address, tenants };
  const lawful = t.lease_terms ? lawfulDeposit(t.lease_terms) : null;
  const rent = t.monthly_rent == null ? null : Number(t.monthly_rent);
  const rows: LedgerRow[] = [];
  const row = (r: Omit<LedgerRow, keyof typeof base | "type">) => rows.push({ ...base, ...r, type: KIND_LABEL[r.kind] });

  for (const p of payments) {
    const amount = Number(p.amount);
    const date = pacificDate(p.created_at);
    if (p.kind === "deposit_invoice") {
      // The cap the invoice was held to: two months only for the small natural-person owner (D3, D4).
      const cap = lawful && rent != null && lawful.cap > rent
        ? { tag: "(c)(5)(A)", tagShort: "two-month cap", tagLabel: "Two months' rent allowed: an owner of no more than two properties and four units" }
        : lawful ? { tag: "(c)(1)", tagShort: "one-month cap", tagLabel: "Security capped at one month's rent" }
          : { tag: "(b)", tagShort: "security", tagLabel: "Every move-in charge but first month's rent is security" };
      row({
        id: p.id, date, at: p.created_at, kind: "deposit_invoice", amount, signed: 0, effect: "none", paypalId: p.paypal_id,
        detail: lawful && lawful.charged > lawful.amount
          ? `PayPal invoice for the lawful amount; the lease asked ${usd(lawful.charged)}`
          : "PayPal invoice for the security deposit",
        status: invoiceWords(p.status), ...cap,
      });
      // The tenants' payment, from the invoice's transaction record: PayPal's own id, date and method. It is dated as
      // PayPal dates it (the statement says the same) and ordered after its invoice even when PayPal's clock puts the
      // payment earlier than the invoice was stored, as the sandbox does. A paid invoice with no transaction detail
      // still counts as collected, as the statement counts it.
      if (wasPaid(p.status)) {
        const txn = p.raw?.transactions?.[0];
        const paidAt = txn?.payment_date_time ?? (txn?.payment_date ? `${txn.payment_date}T12:00:00Z` : p.created_at);
        const paid = txn?.amount?.value ? Number(txn.amount.value) : amount;
        const electronic = paidElectronically(p.status, txn?.method);
        const method = methodWords(txn?.method) || "a method PayPal did not record";
        const onInvoice = p.paypal_id ? ` on invoice ${p.paypal_id}` : "";
        row({
          id: `${p.id}:paid`, date: pacificDate(paidAt), at: new Date(Math.max(ms(paidAt), ms(p.created_at))).toISOString(),
          kind: "payment", amount: paid, signed: paid, effect: "collected", paypalId: txn?.payment_id ?? p.paypal_id,
          detail: !txn ? `Deposit paid${onInvoice}; PayPal recorded no transaction detail`
            : electronic ? `Deposit paid by ${method}${onInvoice}` : `Deposit recorded as paid by ${method}${onInvoice}`,
          status: "received",
          tag: "(h)(1)(A)",
          // The rule, not a conclusion: (h)(1)(A)(ii)(I) turns on the security or the rent arriving electronically, and
          // a cash deposit with rent paid by card still gets an electronic refund (D16).
          ...(electronic
            ? { tagShort: "electronic refund", tagLabel: "Received electronically, so the refund goes electronically" }
            : { tagShort: "refund method", tagLabel: "Not recorded as an electronic payment. An electronic refund is still required if the security or the rent was received electronically; otherwise personal delivery, a mailed check, or a method agreed to in writing" }),
        });
      }
    } else if (p.kind === "refund" || p.kind === "payout") {
      const effect: LedgerEffect = returnCompleted(p.status) ? "returned" : returnFailed(p.status) ? "failed" : "pending";
      row({
        id: p.id, date, at: p.created_at, kind: p.kind, amount, signed: effect === "failed" ? 0 : -amount, effect, paypalId: p.paypal_id,
        detail: (p.kind === "refund" ? "Refund of the original PayPal payment" : "PayPal Payout to the account the tenants designated") + timing(t.move_out_date, date),
        status: effect === "returned" ? (p.kind === "refund" ? "completed" : "sent") : words(p.status),
        tag: "(h)(1)", tagShort: "21 days", tagLabel: "Statement and refund within 21 days of move-out",
      });
    } else if (p.kind === "damage_invoice") {
      row({
        id: p.id, date, at: p.created_at, kind: "damage_invoice", amount, signed: 0, effect: "none", paypalId: p.paypal_id,
        // The claim-not-demand wording is the DRE guide's (LEGAL_RULES B.12), not the subsection's, so it stays in the detail.
        detail: "PayPal invoice for the balance the deductions exceed the deposit by; recorded as a claim, not a demand for payment (DRE guide)",
        status: invoiceWords(p.status),
        tag: "(e)(1)", tagShort: "balance claimed", tagLabel: "Only amounts reasonably necessary for the (b) purposes may be claimed of the security",
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
      effect: claimed ? "claimed" : "draft", paypalId: null,
      detail: `${d.item}${d.room ? ` (${d.room})` : ""}`,
      status: d.is_estimate ? "good-faith estimate" : onStatement ? "on the statement" : final ? "final" : delivered != null ? "added after the statement" : "draft",
      tag: TAGS[d.category].tag, tagShort: TAGS[d.category].short, tagLabel: TAGS[d.category].label,
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
  const byTenancy = new Map<string, LedgerRow[]>();
  for (const r of rows) byTenancy.set(r.tenancyId, [...(byTenancy.get(r.tenancyId) ?? []), r]);
  let held = 0;
  for (const xs of byTenancy.values()) held += Math.max(0, cents(sum("collected", xs) - sum("claimed", xs) - sum("returned", xs) - sum("pending", xs)));
  const claimed = sum("claimed"), drafted = sum("draft");
  return { collected: sum("collected"), deducted: cents(claimed + drafted), drafted, returned: sum("returned"), pending: sum("pending"), held: cents(held), count: rows.length };
}
