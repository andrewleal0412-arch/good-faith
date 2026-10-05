import "server-only";
import { CATEGORY_ORDER, isDemoExample } from "./copy";
import { pacificDate, pacificToday, paypalPaidAt } from "./dates";
import { db } from "./db";
import { basisWords, chargeTitle, settle, type Performer, type Proration, type Work } from "./deductions";
import { refreshDepositInvoice, type DepositInvoiceRow } from "./deposit";
import { isTemplate } from "./workspace";
import { paidElectronically, returnFailed, wasPaid } from "./invoice-status";
import type { Notices } from "./notices";
import { disputeReturns, settledExtra } from "./refund-rail";
import { packFor } from "./states/server";
import type { Standing, StateCode } from "./states/types";
import type { Category, DeliveryRecord } from "./statement";
import type { TenantMoveOut } from "./tenant";

// The tenant-facing facts of one tenancy and nothing else. Every column is named: the lease flags, the activity log,
// the agent's runs, the landlord's draft deductions and every other tenancy stay out by construction, not by
// filtering afterwards. The tenancy id never leaves this module either: the page links only through its token.

export type TenantView = {
  state: StateCode; // the state whose law applies, which the page names
  today: string;
  address: string;
  landlord: string | null;
  tenants: string[];
  startDate: string | null;
  endDate: string | null;
  deposit: {
    amount: number; status: string; paid: boolean; electronic: boolean; paidAt: string | null; method: string | null;
    invoiceId: string | null; payLink: string | null; // the PayPal pay link, only while the invoice is unpaid
  } | null;
  agreement: { text: string | null; paypalEmail: string; signedBy: string[]; signedAt: string } | null;
  photos: { id: string; room: string }[]; // move-in photos, served through the token route
  noticeGivenOn: string | null; // the notice as the landlord recorded it
  plannedMoveOut: string | null;
  moveOutDate: string | null; // the actual move-out, which starts the 21-day clock
  inspectedAt: string | null; // when the move-out photos were compared (the date only reaches the page, never the findings)
  statementDue: string | null;
  moveOut: TenantMoveOut | null; // what the tenants sent through the link
  // The itemized statement, only once the landlord delivered it: until then the deductions are the landlord's draft.
  // Each line carries what the statement prints for it (the cost explanation, (h)(2)(D)), numbered as the PDF is.
  statement: {
    delivery: DeliveryRecord; deliveredAt: string; depositHeld: number;
    deductions: TenantDeduction[];
    total: number; refund: number; balanceClaimed: number; documentsRequired: boolean; // refund: what is owed back (the whole deposit when the deductions are forfeited)
    standing?: Standing; // a claim disputed (Florida) or forfeited after day 14 (New York); absent otherwise
  } | null;
  returned: { amount: number; kind: string; status: string; paypalId: string | null; at: string } | null;
  // What PayPal returned to them through the PayPal dispute they opened on the deposit payment: before or beside the
  // statement's refund, which is then what is left. Absent when there is none.
  viaDispute?: { amount: number; at: string };
  // The settlement of their dispute, once paid: the extra amount back on top of the statement's refund. Absent otherwise.
  settlement?: { amount: number; kind: "refund" | "payout" | null; status: string | null; paypalId: string | null; at: string; example: boolean };
};

export type TenantDeduction = {
  n: number; item: string; room: string | null; category: Category; amount: number;
  work: Work; performer: Performer; proration: Proration; math: string; note: string | null;
  title: string; where: string | null; basis: string; // the page's title, where it was and its basis in a few words
};

const TENANCY_COLUMNS = "tenants, start_date, end_date, notice_given_on, planned_move_out, move_out_date, move_out_inspected_at, statement_delivered_at, statement_delivery, refund_agreement, tenant_move_out, notices, properties(address, owner_name, state)";
const DEDUCTION_COLUMNS = "item, room, category, amount, work, performer, proration, math, note, hours, hourly_rate, item_age_years, useful_life_years";
type DeductionRow = {
  item: string; room: string | null; category: Category; amount: number | string; work: Work; performer: Performer; proration: Proration; math: string; note: string | null;
  hours: number | string | null; hourly_rate: number | string | null; item_age_years: number | string | null; useful_life_years: number | string | null;
};
const num = (v: number | string | null) => (v == null ? null : Number(v));

export async function loadTenantView(tenancyId: string): Promise<TenantView | null> {
  const { data: t } = await db.from("tenancies").select(TENANCY_COLUMNS).eq("id", tenancyId).single();
  if (!t) return null;
  const delivered = !!t.statement_delivered_at && !!t.statement_delivery;
  const prop = t.properties as unknown as { address: string; owner_name: string | null; state?: string | null } | null;
  const pack = packFor(prop?.state);
  const [{ data: payments }, { data: photos }, { data: deductionRows }, { count: deductionCount }] = await Promise.all([
    db.from("payments").select("id, kind, paypal_id, amount, status, raw, created_at").eq("tenancy_id", tenancyId).order("created_at"),
    db.from("photos").select("id, room").eq("tenancy_id", tenancyId).eq("phase", "move_in").order("created_at"),
    delivered ? db.from("deductions").select(DEDUCTION_COLUMNS).eq("tenancy_id", tenancyId).order("created_at") : Promise.resolve({ data: [] }),
    // Whether any deduction is drafted, for a state whose deadline turns on a claim (Florida); never shown.
    db.from("deductions").select("id", { count: "exact", head: true }).eq("tenancy_id", tenancyId),
  ]);

  const stored = (payments ?? []).find((p) => p.kind === "deposit_invoice") as DepositInvoiceRow | undefined;
  const inv = stored ? await refreshDepositInvoice(stored, { store: !(await isTemplate(tenancyId)) }) : null;
  const txn = inv?.raw?.transactions?.[0];
  const paid = !!inv && wasPaid(inv.status);
  const deposit: TenantView["deposit"] = inv ? {
    amount: Number(inv.amount), status: inv.status, paid, electronic: paidElectronically(inv.status, txn?.method ?? null),
    paidAt: paypalPaidAt(txn), method: txn?.method ?? null, invoiceId: inv.paypal_id,
    payLink: paid ? null : inv.raw?.payLink ?? null,
  } : null;

  const a = t.refund_agreement as { text?: string; paypal_email: string; signed_by: string[]; signed_at: string } | null;
  const ret = (payments ?? []).find((p) => p.kind === "refund" || p.kind === "payout") ?? null;
  const via = disputeReturns((payments ?? []) as { kind: string; paypal_id: string | null; amount: number | string; status: string; created_at: string }[]);

  const notices = (t.notices ?? {}) as Notices;
  const today = pacificToday();
  const statementDue = pack.deadline.due({
    moveOutDate: t.move_out_date, endDate: t.end_date, plannedMoveOut: t.planned_move_out,
    claimed: (deductionCount ?? 0) > 0, claimNoticeDate: notices.claim_notice?.date ?? null,
  });
  let statement: TenantView["statement"] = null;
  if (delivered) {
    // The statement's order and numbers: rent, then damage, then cleaning, each in the order entered.
    const rows: TenantDeduction[] = ((deductionRows ?? []) as DeductionRow[])
      .map((d) => ({
        item: d.item, room: d.room, category: d.category, amount: Number(d.amount), work: d.work, performer: d.performer, proration: d.proration, math: d.math, note: d.note ?? null,
        ...(d.category === "rent" ? { title: d.item, where: null } : chargeTitle(d.item, d.work)),
        basis: basisWords({ category: d.category, performer: d.performer, proration: d.proration, hours: num(d.hours), hourlyRate: num(d.hourly_rate), itemAgeYears: num(d.item_age_years), usefulLifeYears: num(d.useful_life_years) }),
      }))
      .sort((a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category])
      .map((d, i) => ({ n: i + 1, ...d }));
    const depositHeld = deposit?.paid ? deposit.amount : 0;
    const s = settle(depositHeld, rows, pack);
    // The day the money went back, as the close-out and the statement count it: a refund PayPal refused or reversed
    // returned nothing.
    const standing = pack.close.standing?.({
      today, notices, claimed: s.total, statementDue, deliveredOn: (t.statement_delivery as DeliveryRecord).date,
      returnedOn: ret && !returnFailed(ret.status as string) ? pacificDate(ret.created_at as string) : null, refundOwed: s.refund > 0,
    });
    // Forfeited deductions (New York after day 14) leave the whole deposit owed back, and no balance claimed over it.
    const forfeits = !!standing?.forfeits;
    statement = {
      delivery: t.statement_delivery as DeliveryRecord, deliveredAt: t.statement_delivered_at as string, depositHeld, deductions: rows,
      total: s.total, refund: forfeits ? depositHeld : s.refund, balanceClaimed: forfeits ? 0 : s.balanceClaimed, documentsRequired: s.documentsRequired,
      ...(standing ? { standing } : {}),
    };
  }

  // A settled dispute: what PayPal sent on top of the statement's refund.
  const { data: settled } = delivered
    ? await db.from("settlements").select("amount, rail, paypal_status, paypal_id, sent_at, raw").eq("tenancy_id", tenancyId).eq("status", "sent").order("sent_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };

  return {
    ...(settled ? { settlement: {
      // What it added: nothing when the statement's refund was already the whole deposit (settlement.ts).
      amount: settledExtra({ agreed: Number(settled.amount), depositHeld: deposit?.amount ?? Infinity, refunded: (ret && !returnFailed(ret.status as string) ? Number(ret.amount) : 0) + (via?.amount ?? 0) }), kind: settled.rail === "payout" ? "payout" as const : settled.rail ? "refund" as const : null,
      status: (settled.paypal_status as string | null) ?? null, paypalId: (settled.paypal_id as string | null) ?? null, at: settled.sent_at as string,
      example: isDemoExample(settled.raw),
    } } : {}),
    state: pack.code,
    today,
    address: prop?.address ?? "Address not recorded",
    landlord: prop?.owner_name ?? null,
    tenants: ((t.tenants ?? []) as { name: string }[]).map((x) => x.name),
    startDate: t.start_date, endDate: t.end_date,
    deposit,
    agreement: a ? { text: a.text ?? null, paypalEmail: a.paypal_email, signedBy: a.signed_by, signedAt: a.signed_at } : null,
    photos: (photos ?? []).map((p) => ({ id: p.id as string, room: p.room as string })),
    noticeGivenOn: t.notice_given_on, plannedMoveOut: t.planned_move_out, moveOutDate: t.move_out_date, inspectedAt: t.move_out_inspected_at,
    statementDue,
    moveOut: (t.tenant_move_out ?? null) as TenantMoveOut | null,
    statement,
    returned: ret ? { amount: Number(ret.amount), kind: ret.kind, status: ret.status, paypalId: ret.paypal_id, at: ret.created_at } : null,
    ...(via ? { viaDispute: { amount: via.amount, at: via.at } } : {}),
  };
}
