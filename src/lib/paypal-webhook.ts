import { returnCompleted, returnFailed, wasPaid } from "./invoice-status";

// PayPal's webhooks: the app hears about a payment, a refund, a payout or a PayPal dispute when PayPal does, not only
// when a page next reads PayPal. src/app/api/paypal/webhook/route.ts receives each delivery; this module decides what
// it means.
//
// 1. Verify. Every delivery is checked with PayPal itself (verify-webhook-signature, through deps.verify) before
//    anything is read from it. One PayPal didn't sign changes nothing and is not stored.
// 2. Once. A verified event is recorded by its id (claim_paypal_event): a redelivery, or the same request replayed,
//    is answered 200 and not processed again, unless the last try failed.
// 3. Match. The event's PayPal ids (an invoice, a capture, a refund, a payout batch) are looked up in the payments
//    table, and the event goes to the one tenancy that holds them, in its workspace, or to none:
//    - a pre-paid demo deposit (demo_deposit_pool) belongs to the copy that claimed it, whatever other copy still
//      points at it (a copy that gave it back on Start over keeps its old row); unclaimed, to nobody;
//    - an id a template tenancy holds is the template's: copies show the template's payments, and an event about
//      them changes no copy; templates are read only, so it is recorded and nothing changes;
//    - an id two tenancies hold otherwise is ambiguous and changes neither.
//    So an event about one workspace's payment can never change another's.
// 4. Apply, never moving a status back (events can arrive out of order):
//    INVOICING.INVOICE.PAID       the deposit invoice paid (PayPal's invoice read again for its status and
//                                 transactions), the activity entry and the bell; the next step follows from the status;
//    PAYMENT.CAPTURE.COMPLETED    the deposit payment's capture confirmed (one that arrives before its invoice's PAID
//                                 event, which records the capture, matches nothing yet: for ten minutes PayPal is
//                                 asked to send it again, so it lands after; later it is stored as unmatched);
//    PAYMENT.CAPTURE.REFUNDED     a refund this app sent, or one made in PayPal that the landlord recorded here: its
//                                 status; PayPal's own refund through a PayPal dispute (matchDisputeRefund): that
//                                 dispute's refund record; any other: noted once for the tenancy as a refund made in
//                                 PayPal (store.noteOutsideRefund, reconcile.ts), with an activity entry the first time,
//                                 for the landlord to record as the deposit's refund or mark not this deposit
//                                 (closeOutState holds the close-out until then), once it is two minutes old (younger,
//                                 it may be this app's own, its row not yet written, so PayPal is asked to send it again);
//    PAYMENT.CAPTURE.REVERSED     the deposit payment reversed (a chargeback): recorded on the deposit, which blocks
//                                 the close-out and a settlement;
//    PAYMENT.PAYOUTSBATCH.*,      a Payout's status (the item's, once PayPal reports one: a batch can succeed while
//    PAYMENT.PAYOUTS-ITEM.*       its one payment is unclaimed or returned);
//    CUSTOMER.DISPUTE.*           a PayPal dispute of the deposit payment, kept in paypal_disputes, with the money
//                                 PayPal returned through it and, once resolved, its waiting responses retired;
//    anything else                stored and ignored.
//    A status PayPal sent is marked on the row (raw.status_from), and the ledger and the tenancy pages say so. A row is
//    written only under the status it was read with, and only the raw keys the event changed are merged in
//    (merge_payment), so two deliveries at once (a capture and a reversal) can't drop each other's keys.
//
// No database import: the store is handed in (paypal-webhook-store.ts in the app; an in-memory one in
// scripts/paypal-webhook-check.mjs), so every path is checked without a database, PayPal or a real signature.

export type PayPalEvent = {
  id: string;
  event_type: string;
  resource_type?: string;
  summary?: string;
  create_time?: string;
  event_version?: string;
  resource_version?: string;
  resource?: Record<string, unknown>;
};

/** What the sandbox webhook is registered for (scripts/paypal-webhook.mjs). */
export const WEBHOOK_EVENT_TYPES = [
  "INVOICING.INVOICE.PAID",
  "PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED",
  "PAYMENT.PAYOUTSBATCH.SUCCESS", "PAYMENT.PAYOUTSBATCH.DENIED",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "PAYMENT.PAYOUTS-ITEM.UNCLAIMED", "PAYMENT.PAYOUTS-ITEM.HELD", "PAYMENT.PAYOUTS-ITEM.BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.CANCELED", "PAYMENT.PAYOUTS-ITEM.FAILED", "PAYMENT.PAYOUTS-ITEM.REFUNDED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED",
  "CUSTOMER.DISPUTE.CREATED", "CUSTOMER.DISPUTE.UPDATED", "CUSTOMER.DISPUTE.RESOLVED",
] as const;

/** The events this module acts on: the registered ones, a batch still processing, and any payout item status (PayPal
 *  documents a DENIED item event it doesn't offer for registration in the sandbox). */
export const handles = (type: string) => (WEBHOOK_EVENT_TYPES as readonly string[]).includes(type)
  || type === "PAYMENT.PAYOUTSBATCH.PROCESSING" || type.startsWith("PAYMENT.PAYOUTS-ITEM.");

export const INVOICE_KINDS = ["deposit_invoice", "damage_invoice"];
/** Refunds of the deposit payment on record here: the close-out's, a settlement's, and one made in PayPal that the
 *  landlord recorded as the deposit's refund (outside_refund), whose later status events update it like the others. */
export const REFUND_KINDS = ["refund", "settlement_refund", "outside_refund"];
export const PAYOUT_KINDS = ["payout", "settlement_payout"];

/* ---------- Reading an event ---------- */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** A PayPal id or word: a short non-empty string, else undefined. */
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() && v.length <= 128 ? v.trim() : undefined);
const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const iso = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

/** The PayPal ids an event names. */
export type Refs = { invoice?: string; capture?: string; refund?: string; batch?: string; item?: string; dispute?: string };

export type Txn = { payment_id?: string; payment_date?: string; payment_date_time?: string; method?: string; amount?: { value?: string } };

/** The invoice an INVOICING event carries: PayPal's v2 events wrap it (resource.invoice), older ones are the invoice. */
export function eventInvoice(e: PayPalEvent): Obj | null {
  const r = obj(e.resource);
  const inv = obj(r.invoice ?? r);
  return str(inv.id) ? inv : null;
}

/** An invoice's payments: v2's payments.transactions, or a plain list. */
export function invoiceTransactions(inv: Obj | null): Txn[] {
  const p = inv?.payments;
  return (Array.isArray(p) ? p : list(obj(p).transactions)).map(obj).filter((t) => !!str(t.payment_id)) as Txn[];
}

/** The capture a refund hangs off: its "up" link, .../v2/payments/captures/<id>. */
function upCapture(r: Obj): string | undefined {
  for (const l of list(r.links)) {
    const link = obj(l);
    if (link.rel !== "up") continue;
    const m = /\/captures\/([A-Za-z0-9-]{4,64})(?:[/?#]|$)/.exec(String(link.href ?? ""));
    if (m) return m[1];
  }
  return undefined;
}

export function eventRefs(e: PayPalEvent): Refs {
  const r = obj(e.resource);
  const t = e.event_type;
  if (t.startsWith("INVOICING.INVOICE.")) {
    const inv = eventInvoice(e);
    return { invoice: str(inv?.id), capture: str(invoiceTransactions(inv)[0]?.payment_id) };
  }
  if (t.startsWith("PAYMENT.CAPTURE.")) {
    // REFUNDED and REVERSED carry a refund whose "up" link is the capture; COMPLETED carries the capture itself.
    const up = upCapture(r);
    if (e.resource_type === "refund" || up) return { refund: str(r.id), capture: up };
    return { capture: str(r.id) };
  }
  if (t.startsWith("PAYMENT.PAYOUTSBATCH.")) return { batch: str(obj(r.batch_header).payout_batch_id) };
  if (t.startsWith("PAYMENT.PAYOUTS-ITEM.")) return { batch: str(r.payout_batch_id), item: str(r.payout_item_id) };
  if (t.startsWith("CUSTOMER.DISPUTE.")) {
    const txn = obj(list(r.disputed_transactions)[0]);
    return { dispute: str(r.dispute_id), capture: str(txn.seller_transaction_id) };
  }
  return {};
}

/* ---------- The store ---------- */

/** A payments row with its tenancy's workspace. */
export type PaymentRef = {
  id: string; tenancy_id: string; workspace_id: string | null; kind: string; paypal_id: string | null;
  amount: number; status: string; raw: Obj | null;
};
export type PoolRef = { invoice_id: string; capture_id: string | null; claimed_by: string | null };
export type EventStatus = "applied" | "recorded" | "unmatched" | "ignored" | "failed";
export type Finish = { status: EventStatus; tenancyId?: string | null; workspaceId?: string | null; note?: string | null; error?: string | null };
export type PayPalDisputeRow = {
  id: string; tenancy_id: string; workspace_id: string | null; capture_id: string | null; reason: string | null; status: string | null;
  stage: string | null; amount: number | null; currency: string | null; outcome: string | null;
  paypal_created_at: string | null; paypal_updated_at: string | null; last_event_id: string; raw: Obj;
};

export interface WebhookStore {
  /** 'new' the first time, 'retry' after a failed or stalled try, 'duplicate' otherwise (claim_paypal_event). */
  claim(e: PayPalEvent): Promise<"new" | "retry" | "duplicate">;
  finish(eventId: string, o: Finish): Promise<void>;
  /** Rows of these kinds whose paypal_id is one of these. */
  paymentsByPayPalId(ids: string[], kinds: string[]): Promise<PaymentRef[]>;
  /** Deposit invoices whose recorded payment is this capture. */
  depositsByCapture(captureId: string): Promise<PaymentRef[]>;
  poolDeposit(o: { invoice?: string; capture?: string }): Promise<PoolRef | null>;
  templateTenancies(): Promise<Set<string>>;
  /** Sets the row's status and merges `set`'s keys into its raw, only while its status is still `expect`; false when
   *  it changed meanwhile (merge_payment). Keys not in `set` stay as they are, whoever wrote them. */
  updatePayment(id: string, expect: string, patch: { status: string; set: Obj }): Promise<boolean>;
  reloadPayment(id: string): Promise<PaymentRef | null>;
  /** A sent settlement's PayPal status, for the settlement this payment is. */
  settlementStatus(tenancyId: string, paypalId: string, status: string): Promise<void>;
  /** Stores the dispute unless what is stored is newer or another tenancy's. The status it had, or null when skipped. */
  upsertDispute(row: PayPalDisputeRow): Promise<{ previousStatus: string | null } | null>;
  /** What follows a dispute PayPal reported: the money it lists as returned through it, or its outcome refunded once
   *  resolved, recorded as a dispute refund (refunds already on record as the close-out's or a settlement's, and any
   *  made before the dispute opened, left out), and once it is resolved, the responses still waiting retired.
   *  Optional. */
  afterDispute?(row: PayPalDisputeRow): Promise<void>;
  /** The tenancy's money back through its PayPal disputes and the disputes as last stored, for telling PayPal's
   *  refund through a dispute from one made outside the app. Optional. */
  disputeRefunds?(tenancyId: string): Promise<DisputeRefundInfo>;
  /** A refund PayPal made through a dispute that has no record yet: a new dispute refund for that dispute. Optional. */
  addDisputeRefund?(tenancyId: string, o: { disputeId: string; refundId: string | null; amount: number; status: string; raw: Obj }): Promise<void>;
  /** A refund of the deposit payment made outside the app, noted once per tenancy for the landlord's decision
   *  (note_outside_refund): 'new' the first time either path (this webhook, or a page's live read of PayPal) sees it,
   *  'seen' after, 'ours' when the tenancy's records hold it by now, 'template' for a template (nothing written).
   *  Optional: without it the refund is only on the activity, as before. */
  noteOutsideRefund?(tenancyId: string, o: { refundId: string; captureId: string | null; amount: number; status: string; at: string | null; eventId: string }): Promise<"new" | "seen" | "ours" | "template">;
  audit(tenancyId: string, action: string, detail: Obj): Promise<void>;
}

export type DisputeRefundInfo = { rows: PaymentRef[]; disputes: { id: string; status: string | null; raw: Obj }[] };

/** Which record a refund of the deposit payment that this app didn't send belongs to, if it came through a PayPal
 *  dispute: the dispute refund that already lists it, one an accepted claim left pending (PayPal's refund completes
 *  it), or a dispute that lists it among its refunds, or that PayPal resolved with more refunded than is on record
 *  (and this refund fits in what is missing). Null otherwise: a refund made in PayPal after the dispute closed is
 *  still one made outside Good Faith. Pure. */
export function matchDisputeRefund(refundId: string | undefined, amount: number | null, info: DisputeRefundInfo): { row: PaymentRef } | { dispute: string } | null {
  const idsOf = (r: PaymentRef) => list(r.raw?.refund_ids).map(String);
  if (refundId) {
    const known = info.rows.find((r) => idsOf(r).includes(refundId));
    if (known) return { row: known };
  }
  const pending = info.rows.find((r) => !returnCompleted(r.status) && !returnFailed(r.status));
  if (pending) return { row: pending };
  for (const d of info.disputes) {
    const listed = !!refundId && list(obj(d.raw.refund_details).transactions).some((t) => obj(t).id === refundId);
    const outcome = d.status === "RESOLVED" ? num(obj(obj(d.raw.dispute_outcome).amount_refunded).value) ?? 0 : 0;
    const recorded = info.rows.filter((r) => r.paypal_id === d.id && !returnFailed(r.status)).reduce((s, r) => s + r.amount, 0);
    const missing = Math.round((outcome - recorded) * 100) / 100;
    if (listed || (amount != null && missing > 0.005 && amount <= missing + 0.005)) {
      const row = info.rows.find((r) => r.paypal_id === d.id);
      return row ? { row } : { dispute: d.id };
    }
  }
  return null;
}

/** What the handler needs: the store, PayPal's signature check, and PayPal's invoice read. */
export type WebhookDeps = {
  store: WebhookStore;
  verify: (rawBody: string, headers: Headers) => Promise<"SUCCESS" | "FAILURE">;
  fetchInvoice: (id: string) => Promise<{ status: string; payments?: { transactions?: Txn[] } }>;
  /** The rate limit, asked only of a delivery that will cost a call to PayPal (one with an event and all five
   *  signature headers): false refuses it with a 429. Junk refused for free never counts, so it can't use up the
   *  allowance PayPal's real deliveries need. */
  admit?: () => boolean;
  log?: Pick<Console, "warn" | "error">;
  now?: () => number;
};

/** An event that arrived before the record it is about: answered with an error, so PayPal sends it again later. */
export class RetryLater extends Error {}

/** How long a refund this app may still be recording counts as possibly its own (its row is written right after
 *  PayPal answers, and PayPal can send the event first). */
const OWN_REFUND_GRACE_MS = 2 * 60_000;

/** How long a capture no deposit holds yet may be waiting for its invoice's PAID event (which records the capture). */
const CAPTURE_WAIT_MS = 10 * 60_000;

/** Whether the event's resource (or the event) was made less than `ms` ago. */
const youngerThan = (e: PayPalEvent, deps: WebhookDeps, ms: number) => {
  const made = iso(obj(e.resource).create_time) ?? iso(e.create_time);
  return !!made && (deps.now ?? Date.now)() - Date.parse(made) < ms;
};

/* ---------- Matching an event to one tenancy ---------- */

export const NO_HOLDER = "No tenancy holds this PayPal id.";

export type Owner =
  | { kind: "tenancy"; tenancyId: string; workspaceId: string | null; template: boolean; rows: PaymentRef[] }
  | { kind: "none"; note: string };

/** The one tenancy an event's matching rows belong to, by the rules at the top of this file. Pure. */
export function pickOwner(candidates: PaymentRef[], pool: PoolRef | null, templates: Set<string>): Owner {
  let rows = candidates;
  if (pool) {
    if (!pool.claimed_by) return { kind: "none", note: "A pre-paid demo deposit that no copy holds." };
    rows = rows.filter((r) => r.workspace_id === pool.claimed_by);
    if (!rows.length) return { kind: "none", note: "A pre-paid demo deposit whose copy no longer has it." };
  }
  if (!rows.length) return { kind: "none", note: NO_HOLDER };
  const template = rows.find((r) => templates.has(r.tenancy_id));
  if (template) {
    return { kind: "tenancy", tenancyId: template.tenancy_id, workspaceId: template.workspace_id, template: true,
      rows: rows.filter((r) => r.tenancy_id === template.tenancy_id) };
  }
  const tenancies = [...new Set(rows.map((r) => r.tenancy_id))];
  if (tenancies.length > 1) return { kind: "none", note: `${tenancies.length} tenancies hold this PayPal id, so it changes none of them.` };
  return { kind: "tenancy", tenancyId: tenancies[0], workspaceId: rows[0].workspace_id, template: false, rows };
}

const isRefundEvent = (e: PayPalEvent, refs: Refs) => e.event_type.startsWith("PAYMENT.CAPTURE.") && !!refs.refund;

async function locate(e: PayPalEvent, refs: Refs, store: WebhookStore): Promise<Owner> {
  const t = e.event_type;
  let rows: PaymentRef[] = [];
  if (t.startsWith("INVOICING.")) {
    if (refs.invoice) rows = await store.paymentsByPayPalId([refs.invoice], INVOICE_KINDS);
  } else if (t.startsWith("PAYMENT.PAYOUTS")) {
    if (refs.batch) rows = await store.paymentsByPayPalId([refs.batch], PAYOUT_KINDS);
  } else if (isRefundEvent(e, refs) && t === "PAYMENT.CAPTURE.REFUNDED") {
    // A refund this app sent is found by its own id; one it didn't send, by the deposit payment it came out of.
    rows = await store.paymentsByPayPalId([refs.refund!], REFUND_KINDS);
    if (!rows.length && refs.capture) rows = await store.depositsByCapture(refs.capture);
  } else if (refs.capture) {
    rows = await store.depositsByCapture(refs.capture);
  }
  if (!rows.length && !refs.invoice && !refs.capture) return { kind: "none", note: "The event names no PayPal id this app records." };
  // A pre-paid demo deposit, by the invoice or the capture the event names, or the invoice of the deposit it matched.
  const invoice = refs.invoice ?? rows.find((r) => r.kind === "deposit_invoice")?.paypal_id ?? undefined;
  const pool = invoice || refs.capture ? await store.poolDeposit({ invoice, capture: refs.capture }) : null;
  return pickOwner(rows, pool, await store.templateTenancies());
}

/* ---------- Statuses only move forward ---------- */

const INVOICE_RANK: Record<string, number> = {
  DRAFT: 0, SCHEDULED: 0, SENT: 1, UNPAID: 1, PAYMENT_PENDING: 2, PARTIALLY_PAID: 2, CANCELLED: 3,
  PAID: 4, MARKED_AS_PAID: 4, PARTIALLY_REFUNDED: 5, REFUNDED: 6, MARKED_AS_REFUNDED: 6,
};
/** The invoice's status after news of `incoming`: an older event (PAID after the refund made it PARTIALLY_REFUNDED)
 *  never moves it back. Statuses of one rank are one stage (SENT and UNPAID trade places as the due date passes).
 *  CANCELLED ends an invoice PayPal lets the sender cancel (sent, unpaid, a payment pending or partly paid), so it
 *  stands above every stage before PAID (a late SENT can't revive it) and below PAID (PayPal cancels no paid invoice,
 *  so a late CANCELLED can't unpay one). A status this map doesn't know ranks with SENT, so it never replaces a
 *  cancelled or paid one. */
export const invoiceForward = (stored: string, incoming: string) => ((INVOICE_RANK[incoming] ?? 1) >= (INVOICE_RANK[stored] ?? 1) ? incoming : stored);

/** A refund's or Payout's status by how final it is: still moving, done, or refused or undone. */
const moneyRank = (s: string) => (returnFailed(s) ? 3 : returnCompleted(s) ? 2 : 1);
export const moneyForward = (stored: string | null | undefined, incoming: string) => (!stored || moneyRank(incoming) >= moneyRank(stored) ? incoming : stored);

/** A payout item event's status as the row keeps it (PayPal's item statuses; a refunded item came back to the
 *  landlord, so it reads as returned). */
const ITEM_STATUS: Record<string, string> = {
  SUCCEEDED: "SUCCESS", UNCLAIMED: "UNCLAIMED", HELD: "ONHOLD", BLOCKED: "BLOCKED", CANCELED: "CANCELED", DENIED: "DENIED",
  FAILED: "FAILED", RETURNED: "RETURNED", REFUNDED: "RETURNED",
};

/** The mark a status PayPal sent carries on its row, which the ledger and the tenancy pages show. */
export type StatusFrom = { source: "paypal"; event_id: string; event_type: string; at: string };
const statusFrom = (e: PayPalEvent): StatusFrom => ({ source: "paypal", event_id: e.id, event_type: e.event_type, at: iso(e.create_time) ?? new Date().toISOString() });

/** Marks the row's status as PayPal's when this event set it, or confirmed one nothing had marked yet; a repeat of a
 *  status already marked leaves the row as it is. */
function mark(raw: Obj, e: PayPalEvent, o: { status: string; incoming: string; before: string }) {
  if (o.status === o.incoming && (o.status !== o.before || !raw.status_from)) raw.status_from = statusFrom(e);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

type Change = { status: string; raw: Obj };

/** The raw keys `next` sets that `cur` doesn't already hold as they are. */
export function changedKeys(cur: Obj | null, next: Obj): Obj {
  const set: Obj = {};
  for (const [k, v] of Object.entries(next)) if (!same(v, cur?.[k])) set[k] = v;
  return set;
}

/** Writes a row under its old status, so two deliveries at once can't undo each other: on a conflict the row is read
 *  again and the change worked out again. Only the raw keys the change sets are written (merged into what is there),
 *  so a key another delivery wrote meanwhile under the same status stays. `change` answers null when there is nothing
 *  to write. */
async function writePayment(store: WebhookStore, row: PaymentRef, change: (cur: PaymentRef) => Change | null): Promise<{ before: PaymentRef; after: Change } | null> {
  let cur = row;
  for (let i = 0; i < 3; i++) {
    const next = change(cur);
    if (!next) return null;
    if (await store.updatePayment(cur.id, cur.status, { status: next.status, set: changedKeys(cur.raw, next.raw) })) return { before: cur, after: next };
    const fresh = await store.reloadPayment(cur.id);
    if (!fresh) return null;
    cur = fresh;
  }
  throw new Error(`payment ${row.id} kept changing while the event was applied`);
}

/* ---------- Applying each event ---------- */

type Applied = { status: EventStatus; note: string };
const recorded = (note: string): Applied => ({ status: "recorded", note });
const source = (e: PayPalEvent) => ({ source: "paypal", event_id: e.id, event_type: e.event_type });

/** The deposit invoice paid (or paid further) as PayPal reports it: its status, its transactions, the mark, and the
 *  activity entry the first time it reads paid. */
async function invoiceStatus(e: PayPalEvent, row: PaymentRef, live: { status: string; transactions: Txn[] }, deps: WebhookDeps, extra: Obj = {}): Promise<Applied> {
  const res = await writePayment(deps.store, row, (cur) => {
    const status = invoiceForward(cur.status, live.status);
    const raw: Obj = { ...(cur.raw ?? {}), ...extra };
    if (live.transactions.length) raw.transactions = live.transactions;
    // PayPal's word on the status: when this event changed it, or confirmed it paid. A capture event read while the
    // invoice still says SENT changed nothing PayPal reported, so it marks nothing.
    if (status !== cur.status || wasPaid(status)) mark(raw, e, { status, incoming: live.status, before: cur.status });
    if (wasPaid(status) && !raw.paid_reported) raw.paid_reported = e.id;
    return status === cur.status && same(raw, cur.raw) ? null : { status, raw };
  });
  if (!res) return recorded("Already up to date.");
  if (res.after.raw.paid_reported === e.id) {
    const txn = (res.after.raw.transactions as Txn[] | undefined)?.[0];
    await deps.store.audit(row.tenancy_id, "deposit_paid", {
      ...source(e), kind: row.kind, invoice: row.paypal_id, status: res.after.status,
      amount: num(txn?.amount?.value) ?? row.amount, method: txn?.method ?? null, capture_id: txn?.payment_id ?? null,
    });
  }
  return { status: "applied", note: res.before.status === res.after.status ? `Invoice ${res.after.status}, confirmed by PayPal.` : `Invoice ${res.before.status} to ${res.after.status}.` };
}

async function onInvoicePaid(e: PayPalEvent, refs: Refs, rows: PaymentRef[], deps: WebhookDeps): Promise<Applied> {
  const row = rows.find((r) => INVOICE_KINDS.includes(r.kind) && r.paypal_id === refs.invoice);
  if (!row) return recorded("No invoice of this tenancy has this id.");
  // PayPal's invoice as it is now: the event says it changed, the invoice says what it is. If PayPal can't be read,
  // the event's own copy of the invoice (verified with its signature) stands in.
  let live: { status: string; transactions: Txn[] };
  try {
    const inv = await deps.fetchInvoice(refs.invoice!);
    live = { status: inv.status, transactions: inv.payments?.transactions ?? [] };
  } catch {
    const inv = eventInvoice(e);
    live = { status: str(inv?.status) ?? "PAID", transactions: invoiceTransactions(inv) };
  }
  return invoiceStatus(e, row, live, deps);
}

async function onCaptureCompleted(e: PayPalEvent, refs: Refs, rows: PaymentRef[], deps: WebhookDeps): Promise<Applied> {
  const row = rows.find((r) => r.kind === "deposit_invoice");
  if (!row) return recorded("No deposit of this tenancy was paid with this capture.");
  const r = obj(e.resource);
  const capture = { id: refs.capture, status: str(r.status) ?? "COMPLETED", at: iso(r.update_time) ?? iso(e.create_time) };
  // A deposit not yet stored as paid: the invoice is read now, as for its own event.
  if (!wasPaid(row.status) && row.paypal_id) {
    try {
      const inv = await deps.fetchInvoice(row.paypal_id);
      return await invoiceStatus(e, row, { status: inv.status, transactions: inv.payments?.transactions ?? [] }, deps, { capture });
    } catch { /* PayPal unreachable: the capture is still noted below */ }
  }
  const res = await writePayment(deps.store, row, (cur) => {
    const raw = { ...(cur.raw ?? {}), capture };
    return same(raw, cur.raw) ? null : { status: cur.status, raw };
  });
  return res ? { status: "applied", note: `Capture ${capture.status}.` } : recorded("Already up to date.");
}

async function onRefunded(e: PayPalEvent, refs: Refs, rows: PaymentRef[], deps: WebhookDeps): Promise<Applied> {
  const r = obj(e.resource);
  const incoming = str(r.status) ?? "COMPLETED";
  const amount = num(obj(r.amount).value);
  const own = rows.find((x) => REFUND_KINDS.includes(x.kind) && x.paypal_id === refs.refund);
  if (own) {
    const res = await writePayment(deps.store, own, (cur) => {
      const status = moneyForward(cur.status, incoming);
      const raw: Obj = { ...(cur.raw ?? {}) };
      mark(raw, e, { status, incoming, before: cur.status });
      return status === cur.status && same(raw, cur.raw) ? null : { status, raw };
    });
    if (!res) return recorded("Already up to date.");
    if (own.kind === "settlement_refund") await deps.store.settlementStatus(own.tenancy_id, refs.refund!, res.after.status);
    // On the activity (and the bell) when the status changed, or when PayPal confirms it for the first time.
    if (res.after.status !== res.before.status || !res.before.raw?.status_from) {
      await deps.store.audit(own.tenancy_id, "refund_status", {
        ...source(e), kind: own.kind, refund_id: refs.refund, amount: own.amount, status: res.after.status, previous: res.before.status,
      });
    }
    return { status: "applied", note: `Refund ${res.before.status} to ${res.after.status}.` };
  }
  // A refund of the deposit payment that this app didn't send (or whose answer never came back): on the activity and
  // the bell, and closeOutState blocks the close-out until someone has looked. No money row is made from it.
  if (!rows.some((x) => x.kind === "deposit_invoice")) return recorded("No refund or deposit of this tenancy has these ids.");
  // PayPal's refund through the tenants' PayPal dispute (a claim the landlord accepted here, an offer they accepted,
  // PayPal's own decision): it completes or makes that dispute's record, whose amount the dispute itself sets.
  const tenancyId = rows[0].tenancy_id;
  const match = deps.store.disputeRefunds ? matchDisputeRefund(refs.refund, amount, await deps.store.disputeRefunds(tenancyId)) : null;
  if (match && "row" in match) {
    const res = await writePayment(deps.store, match.row, (cur) => {
      const ids = list(cur.raw?.refund_ids).map(String);
      const status = moneyForward(cur.status, incoming);
      const raw: Obj = { ...(cur.raw ?? {}), refund_ids: refs.refund && !ids.includes(refs.refund) ? [...ids, refs.refund] : ids };
      mark(raw, e, { status, incoming, before: cur.status });
      return status === cur.status && same(raw, cur.raw) ? null : { status, raw };
    });
    if (!res) return recorded("Already up to date.");
    await deps.store.audit(tenancyId, "refund_status", {
      ...source(e), kind: "dispute_refund", refund_id: refs.refund ?? null, amount: amount ?? match.row.amount, status: res.after.status, previous: res.before.status,
    });
    return { status: "applied", note: `PayPal's refund through the dispute: ${res.before.status} to ${res.after.status}.` };
  }
  if (match && deps.store.addDisputeRefund && amount != null) {
    await deps.store.addDisputeRefund(tenancyId, {
      disputeId: match.dispute, refundId: refs.refund ?? null, amount, status: incoming,
      raw: { dispute_id: match.dispute, refund_ids: refs.refund ? [refs.refund] : [], status_from: statusFrom(e) },
    });
    await deps.store.audit(tenancyId, "dispute_refund_recorded", { ...source(e), dispute_id: match.dispute, amount, refund_ids: refs.refund ? [refs.refund] : [], status: incoming });
    return { status: "applied", note: `PayPal's refund through dispute ${match.dispute}, recorded.` };
  }
  // A refund made moments ago may be this app's own, its row not written yet: PayPal sends the event again later.
  if (youngerThan(e, deps, OWN_REFUND_GRACE_MS)) {
    throw new RetryLater(`refund ${refs.refund ?? "?"} is not on record yet; it may be this app's own, still being recorded`);
  }
  // Noted once for the tenancy (the page's live read of PayPal may have seen it first), for the landlord to record as
  // the deposit's refund or mark not this deposit: never recorded here. The activity entry goes with the first sight.
  const noted = deps.store.noteOutsideRefund && refs.refund && amount != null && amount > 0
    ? await deps.store.noteOutsideRefund(tenancyId, {
      refundId: refs.refund, captureId: refs.capture ?? null, amount, status: incoming,
      at: iso(r.create_time) ?? iso(e.create_time), eventId: e.id,
    })
    : "new";
  if (noted === "ours") return recorded("This refund is on record here by now.");
  if (noted === "template") return recorded(TEMPLATE_NOTE);
  if (noted === "new") {
    await deps.store.audit(tenancyId, "paypal_refund_unrecorded", {
      ...source(e), refund_id: refs.refund ?? null, capture_id: refs.capture ?? null, amount, status: incoming,
    });
  }
  return { status: "applied", note: noted === "seen"
    ? "A refund of the deposit payment this app didn't send, already waiting for the landlord's decision."
    : "A refund of the deposit payment this app didn't send: waiting for the landlord to record it or mark it not this deposit." };
}

async function onReversed(e: PayPalEvent, refs: Refs, rows: PaymentRef[], deps: WebhookDeps): Promise<Applied> {
  const row = rows.find((r) => r.kind === "deposit_invoice");
  if (!row) return recorded("No deposit of this tenancy was paid with this capture.");
  const r = obj(e.resource);
  const reversal = {
    id: refs.refund ?? null, amount: num(obj(r.amount).value), status: str(r.status) ?? null,
    at: iso(r.create_time) ?? iso(e.create_time), event_id: e.id,
  };
  const res = await writePayment(deps.store, row, (cur) => {
    if (obj(cur.raw?.reversal).id === reversal.id && obj(cur.raw?.reversal).id != null) return null;
    return { status: cur.status, raw: { ...(cur.raw ?? {}), reversal, status_from: statusFrom(e) } };
  });
  if (!res) return recorded("Already recorded.");
  await deps.store.audit(row.tenancy_id, "deposit_reversed", { ...source(e), invoice: row.paypal_id, capture_id: refs.capture ?? null, reversal_id: reversal.id, amount: reversal.amount ?? row.amount });
  return { status: "applied", note: "The deposit payment was reversed." };
}

async function onPayout(e: PayPalEvent, refs: Refs, rows: PaymentRef[], deps: WebhookDeps): Promise<Applied> {
  const row = rows.find((r) => PAYOUT_KINDS.includes(r.kind) && r.paypal_id === refs.batch);
  if (!row) return recorded("No Payout of this tenancy has this batch id.");
  const r = obj(e.resource);
  const item = e.event_type.startsWith("PAYMENT.PAYOUTS-ITEM.");
  const incoming = item
    ? ITEM_STATUS[e.event_type.slice("PAYMENT.PAYOUTS-ITEM.".length)] ?? str(r.transaction_status)
    : str(obj(r.batch_header).batch_status) ?? e.event_type.slice("PAYMENT.PAYOUTSBATCH.".length);
  if (!incoming) return recorded("The event carries no status.");
  const res = await writePayment(deps.store, row, (cur) => {
    const raw: Obj = { ...(cur.raw ?? {}) };
    // The row's status is the item's once PayPal reports one (the batch can succeed while its one payment is still
    // unclaimed, or comes back later), else the batch's. Each moves only forward.
    if (item) {
      const next = moneyForward(str(raw.item_status), incoming);
      if (next !== raw.item_status) {
        raw.item_status = next;
        raw.item = { id: refs.item ?? null, transaction_id: str(r.transaction_id) ?? null, status: next, at: iso(e.create_time) };
      }
    } else {
      raw.batch_status = moneyForward(str(raw.batch_status) ?? (raw.item_status ? null : cur.status), incoming);
    }
    const status = str(raw.item_status) ?? str(raw.batch_status) ?? cur.status;
    mark(raw, e, { status, incoming, before: cur.status });
    return status === cur.status && same(raw, cur.raw) ? null : { status, raw };
  });
  if (!res) return recorded("Already up to date.");
  if (row.kind === "settlement_payout") await deps.store.settlementStatus(row.tenancy_id, refs.batch!, res.after.status);
  if (res.after.status !== res.before.status || !res.before.raw?.status_from) {
    await deps.store.audit(row.tenancy_id, "payout_status", {
      ...source(e), kind: row.kind, payout_batch_id: refs.batch, item_id: refs.item ?? null, amount: row.amount, status: res.after.status, previous: res.before.status,
    });
  }
  return { status: "applied", note: `Payout ${res.before.status} to ${res.after.status}.` };
}

async function onDispute(e: PayPalEvent, refs: Refs, rows: PaymentRef[], owner: Extract<Owner, { kind: "tenancy" }>, deps: WebhookDeps): Promise<Applied> {
  if (!refs.dispute) return recorded("The event carries no dispute id.");
  if (!rows.some((r) => r.kind === "deposit_invoice")) return recorded("No deposit of this tenancy was paid with the disputed capture.");
  const r = obj(e.resource);
  const amount = obj(r.dispute_amount);
  const row: PayPalDisputeRow = {
    id: refs.dispute, tenancy_id: owner.tenancyId, workspace_id: owner.workspaceId, capture_id: refs.capture ?? null,
    reason: str(r.reason) ?? null, status: str(r.status) ?? null, stage: str(r.dispute_life_cycle_stage) ?? null,
    amount: num(amount.value), currency: str(amount.currency_code) ?? null, outcome: str(obj(r.dispute_outcome).outcome_code) ?? null,
    paypal_created_at: iso(r.create_time), paypal_updated_at: iso(r.update_time) ?? iso(e.create_time), last_event_id: e.id, raw: r,
  };
  const up = await deps.store.upsertDispute(row);
  if (!up) return recorded("A newer state of this dispute is already stored.");
  const what = e.event_type.slice("CUSTOMER.DISPUTE.".length).toLowerCase();
  if (what !== "updated" || up.previousStatus !== row.status) {
    await deps.store.audit(owner.tenancyId, "paypal_dispute", {
      ...source(e), event: what, dispute_id: row.id, reason: row.reason, status: row.status, amount: row.amount, outcome: row.outcome,
    });
  }
  // The money PayPal returned through it, and once it is resolved, the responses nobody can send any more.
  if (deps.store.afterDispute) await deps.store.afterDispute(row);
  return { status: "applied", note: `PayPal dispute ${row.id} ${what}${row.status ? ` (${row.status})` : ""}.` };
}

export const TEMPLATE_NOTE = "A demo template's payment: templates are read only, and the copies that show it are not its owner, so nothing changed.";

/** What one verified, claimed event does. */
export async function processEvent(e: PayPalEvent, deps: WebhookDeps): Promise<Finish> {
  if (!handles(e.event_type)) return { status: "ignored", note: "Not an event this app acts on." };
  const refs = eventRefs(e);
  const owner = await locate(e, refs, deps.store);
  if (owner.kind === "none") {
    // A deposit's capture can come before its invoice's PAID event, which records it: PayPal is asked to send it
    // again for a while, so it lands after.
    if (e.event_type === "PAYMENT.CAPTURE.COMPLETED" && owner.note === NO_HOLDER && youngerThan(e, deps, CAPTURE_WAIT_MS)) {
      throw new RetryLater(`capture ${refs.capture ?? "?"} is not on record yet; its invoice's PAID event may still be on its way`);
    }
    return { status: "unmatched", note: owner.note };
  }
  const at = { tenancyId: owner.tenancyId, workspaceId: owner.workspaceId };
  if (owner.template) return { ...at, status: "recorded", note: TEMPLATE_NOTE };
  const t = e.event_type;
  const out = t === "INVOICING.INVOICE.PAID" ? await onInvoicePaid(e, refs, owner.rows, deps)
    : t === "PAYMENT.CAPTURE.COMPLETED" ? await onCaptureCompleted(e, refs, owner.rows, deps)
      : t === "PAYMENT.CAPTURE.REFUNDED" ? await onRefunded(e, refs, owner.rows, deps)
        : t === "PAYMENT.CAPTURE.REVERSED" ? await onReversed(e, refs, owner.rows, deps)
          : t.startsWith("PAYMENT.PAYOUTS") ? await onPayout(e, refs, owner.rows, deps)
            : t.startsWith("CUSTOMER.DISPUTE.") ? await onDispute(e, refs, owner.rows, owner, deps)
              : recorded("Nothing to apply.");
  return { ...at, ...out };
}

/* ---------- One delivery ---------- */

export type WebhookAnswer = { status: number; body: { ok?: true; duplicate?: true; outcome?: EventStatus; error?: string } };

const SIGNATURE_HEADERS = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];

/** A value from a delivery, safe for one log line: quoted, its control characters and line breaks escaped, at most 64
 *  characters, so an unsigned request can't plant a line of its own in the logs. */
export const shown = (v: unknown) => JSON.stringify(String(v).slice(0, 64)).replace(/[\u2028\u2029]/g, "?");

/** One delivery, start to finish. 401 for anything PayPal didn't sign (nothing stored, nothing changed); 200 once a
 *  verified event is recorded, whether or not it changed anything (PayPal stops sending it); 5xx when it couldn't be
 *  checked or applied, so PayPal sends it again (it retries for three days). */
export async function handlePayPalWebhook(rawBody: string, headers: Headers, deps: WebhookDeps): Promise<WebhookAnswer> {
  const log = deps.log ?? console;
  let e: PayPalEvent;
  try {
    e = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "Not a PayPal event." } };
  }
  if (!e || typeof e !== "object" || Array.isArray(e) || !str(e.id) || !str(e.event_type)) return { status: 400, body: { error: "Not a PayPal event." } };
  // Not trusted until PayPal says it signed it: without its headers there is nothing to ask PayPal about.
  if (!SIGNATURE_HEADERS.every((h) => headers.get(h))) {
    log.warn(`PayPal webhook refused: no signature headers (event ${shown(e.id)})`);
    return { status: 401, body: { error: "Not signed by PayPal." } };
  }
  // Only now does the delivery count toward the rate limit: it is one PayPal would be asked about.
  if (deps.admit && !deps.admit()) return { status: 429, body: { error: "Too many requests." } };
  let verdict: "SUCCESS" | "FAILURE";
  try {
    verdict = await deps.verify(rawBody, headers);
  } catch (err) {
    log.error("PayPal webhook signature check failed to run", err);
    return { status: 502, body: { error: "Couldn't check the signature with PayPal. PayPal will send it again." } };
  }
  if (verdict !== "SUCCESS") {
    log.warn(`PayPal webhook refused: the signature didn't verify (event ${shown(e.id)}, ${shown(e.event_type)})`);
    return { status: 401, body: { error: "Not signed by PayPal." } };
  }

  let claim: Awaited<ReturnType<WebhookStore["claim"]>>;
  try {
    claim = await deps.store.claim(e);
  } catch (err) {
    log.error("PayPal webhook couldn't be recorded", err);
    return { status: 500, body: { error: "Couldn't record the event. PayPal will send it again." } };
  }
  if (claim === "duplicate") return { status: 200, body: { ok: true, duplicate: true } };
  try {
    const out = await processEvent(e, deps);
    await deps.store.finish(e.id, out);
    return { status: 200, body: { ok: true, outcome: out.status } };
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    await deps.store.finish(e.id, { status: "failed", error: message }).catch(() => {});
    if (err instanceof RetryLater) {
      log.warn(`PayPal webhook ${shown(e.id)} (${shown(e.event_type)}) waits for PayPal to send it again: ${message}`);
      return { status: 503, body: { error: "Not on record yet. PayPal will send it again." } };
    }
    log.error(`PayPal webhook ${shown(e.id)} (${shown(e.event_type)}) couldn't be applied`, err);
    return { status: 500, body: { error: "Couldn't apply the event. PayPal will send it again." } };
  }
}
