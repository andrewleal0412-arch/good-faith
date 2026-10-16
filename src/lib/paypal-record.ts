// PayPal's own record of a money event, shown beside the app's on the refund receipt and in a Payments row's details
// ("PayPal's record"): the fields PayPal returned when asked just now, and nothing else. Pure picks over PayPal's
// answers (src/lib/paypal.ts reads them; src/app/api/tenancies/[id]/paypal-record serves them), so no email, name or
// address can reach the browser: each pick copies the fields named here, by name, and drops the rest (a refund's
// payer and note, an invoice's recipients, invoicer and items, which name the unit, a Payout's items, which name the
// receivers). scripts/e2e-stubs-check.mjs feeds them answers full of such fields and checks that none comes through.

export type RecordKind = "refund" | "payout" | "invoice";

export type PayPalRecord =
  | { kind: "refund"; id: string; status: string; amount: string | null; createTime: string | null; updateTime: string | null; captureId: string | null }
  | { kind: "payout"; id: string; status: string; amount: string | null; createTime: string | null; completedTime: string | null }
  | { kind: "invoice"; id: string; invoiceNumber: string | null; status: string; amount: string | null; paid: string | null; refunded: string | null;
    paymentId: string | null; paymentDate: string | null; createTime: string | null; updateTime: string | null };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);
/** "3790.00 USD": PayPal's value and currency as it wrote them. */
const money = (v: unknown, currencyKey = "currency_code"): string | null => {
  const m = obj(v);
  const value = str(m.value);
  return value ? `${value}${str(m[currencyKey]) ? ` ${str(m[currencyKey])}` : ""}` : null;
};

/** A PayPal id as the screens take it: letters, digits, dashes and underscores. */
export const isPayPalId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{4,127}$/.test(v);

/** The capture a refund went against, from PayPal's own "up" link on it. */
export function captureFromLinks(raw: unknown): string | null {
  const links = Array.isArray(obj(raw).links) ? (obj(raw).links as unknown[]) : [];
  for (const l of links) {
    const { rel, href } = obj(l);
    if (rel === "up" && typeof href === "string") return href.match(/\/captures\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
  }
  return null;
}

/** PayPal's refund, its fields alone. Null when the answer isn't a refund. */
export function pickRefund(raw: unknown): PayPalRecord | null {
  const r = obj(raw);
  const id = str(r.id), status = str(r.status);
  if (!id || !status) return null;
  return { kind: "refund", id, status, amount: money(r.amount), createTime: str(r.create_time), updateTime: str(r.update_time), captureId: captureFromLinks(r) };
}

/** PayPal's Payout batch, its header's fields alone (its items, with the receivers, never). */
export function pickPayout(raw: unknown): PayPalRecord | null {
  const h = obj(obj(raw).batch_header);
  const id = str(h.payout_batch_id), status = str(h.batch_status);
  if (!id || !status) return null;
  return { kind: "payout", id, status, amount: money(h.amount, "currency"), createTime: str(h.time_created), completedTime: str(h.time_completed) };
}

/** PayPal's invoice (the deposit's), its fields alone: never its recipients, invoicer or items. */
export function pickInvoice(raw: unknown): PayPalRecord | null {
  const r = obj(raw);
  const id = str(r.id), status = str(r.status);
  if (!id || !status) return null;
  const detail = obj(r.detail), meta = obj(detail.metadata), payments = obj(r.payments);
  const txn = obj((Array.isArray(payments.transactions) ? payments.transactions : [])[0]);
  return {
    kind: "invoice", id, status, invoiceNumber: str(detail.invoice_number),
    amount: money(r.amount), paid: money(payments.paid_amount), refunded: money(obj(r.refunds).refund_amount),
    paymentId: str(txn.payment_id), paymentDate: str(txn.payment_date),
    createTime: str(meta.create_time), updateTime: str(meta.last_update_time),
  };
}

export const pickRecord = (kind: RecordKind, raw: unknown): PayPalRecord | null =>
  (kind === "refund" ? pickRefund(raw) : kind === "payout" ? pickPayout(raw) : pickInvoice(raw));

/** The record as the screens list it: a label, PayPal's value as it wrote it (or "Not given"), and whether the value is
 *  an id to copy. Every label says whose value it is. An invoice's times are listed only when PayPal gives them. */
export function recordRows(r: PayPalRecord): { label: string; value: string; id?: boolean }[] {
  const v = (x: string | null) => x ?? "Not given";
  if (r.kind === "refund") {
    return [
      { label: "PayPal's refund ID", value: r.id, id: true },
      { label: "PayPal's status", value: r.status },
      { label: "PayPal's amount", value: v(r.amount) },
      { label: "PayPal's create time", value: v(r.createTime) },
      { label: "PayPal's update time", value: v(r.updateTime) },
      { label: "PayPal's payment refunded", value: v(r.captureId), id: !!r.captureId },
    ];
  }
  if (r.kind === "payout") {
    return [
      { label: "PayPal's batch ID", value: r.id, id: true },
      { label: "PayPal's status", value: r.status },
      { label: "PayPal's amount", value: v(r.amount) },
      { label: "PayPal's create time", value: v(r.createTime) },
      { label: "PayPal's completed time", value: v(r.completedTime) },
    ];
  }
  return [
    { label: "PayPal's invoice ID", value: r.id, id: true },
    { label: "PayPal's invoice number", value: v(r.invoiceNumber) },
    { label: "PayPal's status", value: r.status },
    { label: "PayPal's amount", value: v(r.amount) },
    { label: "PayPal's paid amount", value: v(r.paid) },
    { label: "PayPal's refunded amount", value: v(r.refunded) },
    { label: "PayPal's payment ID", value: v(r.paymentId), id: !!r.paymentId },
    { label: "PayPal's payment date", value: v(r.paymentDate) },
    ...(r.createTime ? [{ label: "PayPal's create time", value: r.createTime }] : []),
    ...(r.updateTime ? [{ label: "PayPal's update time", value: r.updateTime }] : []),
  ];
}

/** The word for what the record is, for the section's own line. */
export const recordWord = (kind: RecordKind) => (kind === "refund" ? "refund" : kind === "payout" ? "Payout" : "invoice");
