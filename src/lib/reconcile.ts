import { paypalPaidAt } from "./dates";
import { returnCompleted, returnFailed } from "./invoice-status";

// Reconciling PayPal's refunds of a tenancy's deposit payment with the app's own records. PayPal can refund the
// payment without the app: the landlord does it in the PayPal dashboard, or a refund the close-out sent loses its answer
// and the plan changes before it is tried again. PayPal reports each refund twice over: its PAYMENT.CAPTURE.REFUNDED
// webhook (paypal-webhook.ts) and the deposit invoice's refunds, which every live read of the invoice returns (the
// close-out's facts, the Payments tab). A refund neither the close-out, a settlement, a PayPal dispute's record nor an
// earlier decision holds is "outside": it is kept once per tenancy (paypal_outside_refunds, outside-refunds.ts), and
// the landlord records it as this deposit's refund (a payments row of kind outside_refund) or marks it not this
// deposit. Never automatically: until then the close-out waits, since sending the refund owed on top of it could
// return money twice.
//
// Pure, so the pages, the close-out, the webhook and scripts/reconcile-check.mjs read the same rules.

/** One refund of the deposit payment as PayPal lists it: its id, amount and when it was made. */
export type PayPalRefund = { id: string; amount: number; at: string | null };

/** A payments row as far as reconciling reads it. */
export type RecordRow = { kind: string; paypal_id: string | null; amount: number | string; status: string; raw?: unknown; created_at?: string };

/** A refund PayPal reported that isn't on record as the app's own, as paypal_outside_refunds keeps it. */
export type OutsideNote = {
  refund_id: string; amount: number | string; refunded_at: string | null; status: "open" | "recorded" | "dismissed";
  capture_id?: string | null; paypal_status?: string | null; seen_via?: string[]; decided_at?: string | null;
};

const cents = (n: number) => Math.round(n * 100) / 100;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const money = (v: unknown): number | null => { const n = Number(obj(v).value); return Number.isFinite(n) && n > 0 ? cents(n) : null; };
/** A PayPal refund id: letters, digits and dashes (the database's check is the same). */
export const isRefundId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9-]{4,64}$/.test(v);

/** The refunds a PayPal invoice lists (refunds.transactions). PayPal names a refund of the payment by
 *  recipient_transaction_id (read from the sandbox on 2026-10-07: the same id the close-out's refund got back) and dates
 *  it by day only, which reads as noon Pacific, PayPal's account clock (dates.ts, paypalPaidAt), or now when that noon
 *  is still to come (a refund made this morning). A record the merchant marked as refunded outside PayPal (type
 *  EXTERNAL) moved no PayPal money and carries no id, so it is left out. */
export function invoiceRefunds(inv: unknown, now = Date.now()): PayPalRefund[] {
  const out: PayPalRefund[] = [];
  for (const t of list(obj(obj(inv).refunds).transactions)) {
    const r = obj(t);
    const id = [r.refund_id, r.recipient_transaction_id].find(isRefundId);
    const amount = money(r.amount);
    if (!id || amount == null || (typeof r.type === "string" && r.type !== "PAYPAL")) continue;
    const day = typeof r.refund_date === "string" ? r.refund_date.slice(0, 10) : undefined;
    const noon = paypalPaidAt({ payment_date: day });
    out.push({ id, amount, at: noon && Date.parse(noon) > now ? new Date(now).toISOString() : noon });
  }
  return out;
}

/** What PayPal says it has refunded of the payment in all (refunds.refund_amount), whoever sent it. */
export const invoiceRefunded = (inv: unknown) => money(obj(obj(inv).refunds).refund_amount) ?? 0;

/** The PayPal refund ids a tenancy's records hold as its own: the close-out's refund, a settlement's, one recorded
 *  from a refund made in PayPal, and the ones a PayPal dispute's refund lists. A failed one still names a refund PayPal
 *  made (or refused), so it is never offered as one made outside the app. */
export function refundIdsOnRecord(payments: RecordRow[]): Set<string> {
  const ids = new Set<string>();
  for (const p of payments) {
    if ((p.kind === "refund" || p.kind === "settlement_refund" || p.kind === "outside_refund") && p.paypal_id) ids.add(p.paypal_id);
    if (p.kind === "dispute_refund") for (const id of list(obj(p.raw).refund_ids)) if (typeof id === "string") ids.add(id);
  }
  return ids;
}

/** The refunds an invoice lists that the records don't hold, oldest first. PayPal's refund through a PayPal dispute
 *  that the dispute's record doesn't list by id yet (a claim accepted here that PayPal hasn't confirmed) is matched by
 *  amount, oldest first, against what those records hold without ids, as the close-out counted it before. */
export function unknownRefunds(inv: unknown, payments: RecordRow[], now = Date.now()): PayPalRefund[] {
  const ours = refundIdsOnRecord(payments);
  const listed = invoiceRefunds(inv, now);
  const disputeRows = payments.filter((p) => p.kind === "dispute_refund" && !returnFailed(p.status));
  const disputeIds = new Set(disputeRows.flatMap((p) => list(obj(p.raw).refund_ids).filter((x): x is string => typeof x === "string")));
  // What the dispute records hold that no listed refund carries by id.
  let unmatched = cents(disputeRows.reduce((s, p) => s + Number(p.amount), 0) - listed.filter((r) => disputeIds.has(r.id)).reduce((s, r) => s + r.amount, 0));
  const out: PayPalRefund[] = [];
  for (const r of [...listed].sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""))) {
    if (ours.has(r.id)) continue;
    if (unmatched >= r.amount - 0.005) { unmatched = cents(unmatched - r.amount); continue; }
    out.push(r);
  }
  return out;
}

/** The refunds still waiting for the landlord: noted and undecided, and not on record as the app's own by now (the
 *  close-out's own refund whose row was written after PayPal reported it). Oldest first. */
export function openNotes<T extends OutsideNote>(notes: T[], payments: RecordRow[]): T[] {
  const ours = refundIdsOnRecord(payments);
  return notes.filter((n) => n.status === "open" && !ours.has(n.refund_id))
    .sort((a, b) => (a.refunded_at ?? "").localeCompare(b.refunded_at ?? ""));
}

/** What PayPal's own total says it refunded beyond everything the records and the decisions account for: the app's
 *  refunds of the payment that didn't fail (the close-out's, a settlement's, a PayPal dispute's, the ones recorded from
 *  PayPal), and the ones the landlord marked not this deposit. Above zero only for a refund PayPal counts but doesn't
 *  list (an invoice without the detail), which still holds the close-out until someone looks. */
export function unaccounted(inv: unknown, payments: RecordRow[], notes: OutsideNote[]): number {
  const total = invoiceRefunded(inv);
  if (total <= 0) return 0;
  const back = payments.filter((p) => ["refund", "settlement_refund", "dispute_refund", "outside_refund"].includes(p.kind) && !returnFailed(p.status))
    .reduce((s, p) => s + Number(p.amount), 0);
  const listedOpen = notes.filter((n) => n.status !== "recorded").reduce((s, n) => s + Number(n.amount), 0);
  return cents(Math.max(0, total - back - listedOpen));
}

/** The refunds made in PayPal that the landlord recorded as this deposit's refund (payments of kind outside_refund
 *  that didn't fail), oldest first, with their total and PayPal's status for them all (COMPLETED once every one is,
 *  else the first that isn't, such as PENDING); null when there is none. A prior return, as a PayPal dispute's refund
 *  is: the close-out sends only what is still owed after it. */
export function outsideReturns(payments: RecordRow[]): { amount: number; refunds: PayPalRefund[]; status: string } | null {
  const rows = payments.filter((p) => p.kind === "outside_refund" && !returnFailed(p.status) && p.paypal_id)
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  if (!rows.length) return null;
  const refunds = rows.map((p) => ({ id: p.paypal_id!, amount: cents(Number(p.amount)), at: p.created_at ?? null }));
  const status = rows.find((p) => !returnCompleted(p.status))?.status ?? "COMPLETED";
  return { amount: cents(refunds.reduce((s, r) => s + r.amount, 0)), refunds, status };
}

/** When the refunds made in PayPal that the landlord recorded here finished returning what the statement owes back
 *  (`owed`, the deposit less the deductions), with PayPal's refunds through the tenants' PayPal dispute counted beside
 *  them: the moment, oldest first, their running total first reached it. For a deadline that turns on the day the
 *  rest of the deposit went (New York's day 14), when the close-out sent no refund or Payout of its own (that one's
 *  day is the day, and callers read it first). Null when none is recorded, nothing is owed, or they don't cover it. */
export function outsideReturnedAt(payments: { kind: unknown; amount: unknown; status: unknown; created_at?: unknown }[], owed: number): string | null {
  const ok = (p: (typeof payments)[number]) => !returnFailed(String(p.status ?? "")) && typeof p.created_at === "string";
  if (owed <= 0.005 || !payments.some((p) => p.kind === "outside_refund" && ok(p))) return null;
  const back = payments.filter((p) => (p.kind === "outside_refund" || p.kind === "dispute_refund") && ok(p))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  let sum = 0;
  for (const p of back) {
    sum = cents(sum + Number(p.amount));
    if (sum >= owed - 0.005) return p.created_at as string;
  }
  return null;
}

/** What a decision may do with a noted refund, before the database's own check under the row lock (decide_outside_refund
 *  answers the same): an error for the landlord, or null. */
export function decisionError(o: { note: OutsideNote | null; payments: RecordRow[]; template: boolean; owns: boolean }): { status: number; error: string } | null {
  if (o.template) return { status: 409, error: "This property is the template every demo copy is made from, so it doesn't change." };
  if (!o.note) return { status: 404, error: "No refund made in PayPal with that id is on this property." };
  if (o.note.status === "recorded") return { status: 409, error: "This refund is already recorded as this deposit's refund." };
  if (o.note.status === "dismissed") return { status: 409, error: "This refund is already marked not this deposit." };
  if (refundIdsOnRecord(o.payments).has(o.note.refund_id)) return { status: 409, error: "This refund is on record already, as one sent from here. Reload the page." };
  if (!o.owns) return { status: 409, error: "This deposit payment isn't this account's own, so a refund of it can't be recorded here." };
  return null;
}
